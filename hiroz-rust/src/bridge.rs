use std::sync::Arc;

use crate::messages::{SceneConfig, SceneSnapshot};
use hiroz::{Builder, Result, context::ZContextBuilder};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream, tcp::{OwnedReadHalf, OwnedWriteHalf}},
    sync::{broadcast, mpsc},
};

pub struct BridgeOptions {
    pub router: String,
    pub scene_topic: String,
    pub config_topic: String,
    pub addr: String,
}

const CORS: &str = concat!(
    "Access-Control-Allow-Origin: *\r\n",
    "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n",
    "Access-Control-Allow-Headers: content-type\r\n",
);

type HttpResult = Result<()>;

pub async fn run_bridge(opts: BridgeOptions) -> Result<()> {
    let ctx = ZContextBuilder::default()
        .with_mode("client")
        .with_connect_endpoints([opts.router.as_str()])
        .build()?;
    let node = ctx.create_node("conveyor_bridge").build()?;
    let zsub_scene = node.create_sub::<SceneSnapshot>(&opts.scene_topic).build()?;
    let zpub_config = node.create_pub::<SceneConfig>(&opts.config_topic).build()?;

    let (scene_tx, _) = broadcast::channel::<Arc<SceneSnapshot>>(16);
    let (config_tx, mut config_rx) = mpsc::channel::<SceneConfig>(32);

    let scene_forwarder = scene_tx.clone();
    tokio::spawn(async move {
        loop {
            match zsub_scene.async_recv().await {
                Ok(snapshot) => {
                    let _ = scene_forwarder.send(Arc::new(snapshot));
                }
                Err(err) => {
                    eprintln!("[bridge] scene receive failed: {err}");
                    break;
                }
            }
        }
    });

    tokio::spawn(async move {
        while let Some(config) = config_rx.recv().await {
            if let Err(err) = zpub_config.async_publish(&config).await {
                eprintln!("[bridge] config publish failed: {err}");
            }
        }
    });

    let listener = TcpListener::bind(opts.addr.as_str()).await?;
    println!(
        "Bridge on http://{}: SSE /scene, POST /config ({} -> browser, browser -> {})",
        opts.addr, opts.scene_topic, opts.config_topic
    );

    loop {
        let (stream, peer) = listener.accept().await?;
        let scene_tx = scene_tx.clone();
        let config_tx = config_tx.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_connection(stream, scene_tx, config_tx).await {
                eprintln!("[bridge] {peer}: {err}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    scene_tx: broadcast::Sender<Arc<SceneSnapshot>>,
    config_tx: mpsc::Sender<SceneConfig>,
) -> HttpResult {
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);
    let (method, path, content_length) = read_request(&mut reader).await?;

    match (method.as_str(), path.as_str()) {
        ("GET", "/scene") => serve_sse(&mut write, scene_tx).await,
        ("OPTIONS", "/scene" | "/config") => {
            respond(&mut write, "204 No Content", "", "").await
        }
        ("POST", "/config") => {
            let mut body = vec![0_u8; content_length];
            reader.read_exact(&mut body).await?;
            let config: SceneConfig = match serde_json::from_slice(&body) {
                Ok(config) => config,
                Err(err) => {
                    return respond(
                        &mut write,
                        "400 Bad Request",
                        "Content-Type: text/plain\r\n",
                        &format!("invalid SceneConfig: {err}"),
                    )
                    .await;
                }
            };
            match config_tx.send(config).await {
                Ok(()) => {
                    respond(
                        &mut write,
                        "200 OK",
                        "Content-Type: application/json\r\n",
                        "{\"ok\":true}",
                    )
                    .await
                }
                Err(_) => {
                    respond(
                        &mut write,
                        "503 Service Unavailable",
                        "Content-Type: text/plain\r\n",
                        "config publisher unavailable",
                    )
                    .await
                }
            }
        }
        _ => {
            respond(
                &mut write,
                "404 Not Found",
                "Content-Type: text/plain\r\n",
                "not found",
            )
            .await
        }
    }
}

async fn read_request(reader: &mut BufReader<OwnedReadHalf>) -> std::io::Result<(String, String, usize)> {
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await? == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "empty request",
        ));
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let path = target.split('?').next().unwrap_or("").to_string();

    let mut content_length = 0_usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await? == 0 {
            break;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    Ok((method, path, content_length))
}

async fn serve_sse(write: &mut OwnedWriteHalf, scene_tx: broadcast::Sender<Arc<SceneSnapshot>>) -> HttpResult {
    write
        .write_all(
            format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: text/event-stream\r\n\
                 Cache-Control: no-cache\r\n\
                 Connection: keep-alive\r\n\
                 {CORS}\r\n"
            )
            .as_bytes(),
        )
        .await?;
    write.flush().await?;

    let mut rx = scene_tx.subscribe();
    loop {
        match rx.recv().await {
            Ok(snapshot) => {
                let json = serde_json::to_string(snapshot.as_ref())?;
                write.write_all(format!("data: {json}\n\n").as_bytes()).await?;
                write.flush().await?;
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
    Ok(())
}

async fn respond(
    write: &mut OwnedWriteHalf,
    status: &str,
    extra_headers: &str,
    body: &str,
) -> HttpResult {
    let header = format!(
        "HTTP/1.1 {status}\r\n{CORS}{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.as_bytes().len()
    );
    write.write_all(header.as_bytes()).await?;
    write.write_all(body.as_bytes()).await?;
    write.flush().await?;
    Ok(())
}
