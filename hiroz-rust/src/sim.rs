use std::time::{Duration, Instant};

use crate::messages::{BoxState, CameraState, SceneSnapshot, Vec3};
use hiroz::{Builder, Result, context::ZContextBuilder};

const BELT_LENGTH: f64 = 4.0;
const BELT_HALF_WIDTH: f64 = 0.30;
const SCALE_Y: f64 = 2.30;
const SCALE_HALF_Y: f64 = 0.30;
const MIN_VOLUME: f64 = 0.20 * 0.20 * 0.10;
const MAX_VOLUME: f64 = 0.60 * 0.60 * 0.50;

pub struct SimOptions {
    pub router: String,
    pub topic: String,
    pub hz: u64,
    pub speed: f64,
    pub spawn_interval: f64,
}

pub struct MonitorOptions {
    pub router: String,
    pub topic: String,
}

fn context(router: &str) -> Result<hiroz::context::ZContext> {
    ZContextBuilder::default()
        .with_mode("client")
        .with_connect_endpoints([router])
        .build()
}

pub async fn run_sim(opts: SimOptions) -> Result<()> {
    let ctx = context(&opts.router)?;
    let node = ctx
        .create_node("conveyor_sim")
        .with_type_description_service()
        .build()?;
    let zpub = node.create_pub::<SceneSnapshot>(&opts.topic).build()?;

    let period = Duration::from_secs_f64(1.0 / opts.hz as f64);
    let started = Instant::now();
    let mut last = started;
    let mut next_spawn = started;
    let mut next_id = 1_u64;
    let mut rng = Lcg::new(0xC0FFEE);
    let mut boxes: Vec<BoxState> = Vec::new();

    println!(
        "Publishing SceneSnapshot on {} via {} at {} Hz",
        opts.topic, opts.router, opts.hz
    );

    loop {
        tokio::time::sleep(period).await;
        let now = Instant::now();
        let dt = now.duration_since(last).as_secs_f64();
        last = now;

        if now >= next_spawn {
            boxes.push(spawn_box(&mut rng, next_id));
            next_id += 1;
            next_spawn = now + Duration::from_secs_f64(opts.spawn_interval);
        }

        for b in &mut boxes {
            b.pose.y += opts.speed * dt;
        }
        boxes.retain(|b| b.pose.y <= BELT_LENGTH + 0.4);

        let snapshot = SceneSnapshot {
            stamp_sec: now.duration_since(started).as_secs_f64(),
            conveyor_speed: opts.speed,
            camera: CameraState {
                pose: Vec3 {
                    x: 0.0,
                    y: 2.0,
                    z: 1.0,
                },
                fov_y_deg: 33.4,
                fov_x_deg: 22.6,
                fov_distance: 1.0,
            },
            boxes: boxes.clone(),
            scale_kg: scale_reading(&boxes),
        };

        zpub.async_publish(&snapshot).await?;
        println!(
            "[{:6.2}s] boxes={:2} scale={:5.2} kg",
            snapshot.stamp_sec,
            snapshot.boxes.len(),
            snapshot.scale_kg
        );
    }
}

pub async fn run_monitor(opts: MonitorOptions) -> Result<()> {
    let ctx = context(&opts.router)?;
    let node = ctx.create_node("conveyor_monitor").build()?;
    let zsub = node.create_sub::<SceneSnapshot>(&opts.topic).build()?;

    println!("Listening for SceneSnapshot on {} via {}", opts.topic, opts.router);

    loop {
        let snapshot = zsub.async_recv().await?;
        println!(
            "[{:6.2}s] speed={:.2} m/s boxes={} scale={:.2} kg",
            snapshot.stamp_sec,
            snapshot.conveyor_speed,
            snapshot.boxes.len(),
            snapshot.scale_kg
        );
        for b in &snapshot.boxes {
            println!(
                "  box:{:<4} pos=({:.2}, {:.2}, {:.2}) size=({:.2}, {:.2}, {:.2}) {:.2} kg",
                b.id, b.pose.x, b.pose.y, b.pose.z, b.size.x, b.size.y, b.size.z, b.weight_kg
            );
        }
    }
}

fn spawn_box(rng: &mut Lcg, id: u64) -> BoxState {
    let length = 0.20 + 0.40 * rng.next_f64(); // along Y
    let width = 0.20 + 0.40 * rng.next_f64(); // along X
    let height = 0.10 + 0.40 * rng.next_f64(); // along Z
    let x = (rng.next_f64() - 0.5) * 2.0 * (BELT_HALF_WIDTH - width / 2.0);

    BoxState {
        id,
        pose: Vec3 {
            x,
            y: 0.0,
            z: height / 2.0,
        },
        size: Vec3 {
            x: width,
            y: length,
            z: height,
        },
        weight_kg: weight_from_volume(length * width * height),
    }
}

fn weight_from_volume(volume: f64) -> f64 {
    let clamped = volume.clamp(MIN_VOLUME, MAX_VOLUME);
    1.0 + 9.0 * (clamped - MIN_VOLUME) / (MAX_VOLUME - MIN_VOLUME)
}

fn scale_reading(boxes: &[BoxState]) -> f64 {
    let mut best_area = 0.0;
    let mut best_weight = 0.0;

    for b in boxes {
        let y0 = (b.pose.y - b.size.y / 2.0).max(SCALE_Y - SCALE_HALF_Y);
        let y1 = (b.pose.y + b.size.y / 2.0).min(SCALE_Y + SCALE_HALF_Y);
        let x0 = (b.pose.x - b.size.x / 2.0).max(-BELT_HALF_WIDTH);
        let x1 = (b.pose.x + b.size.x / 2.0).min(BELT_HALF_WIDTH);
        let area = (y1 - y0).max(0.0) * (x1 - x0).max(0.0);
        if area > best_area {
            best_area = area;
            best_weight = b.weight_kg;
        }
    }

    best_weight
}

struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_f64(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1_u64 << 53) as f64)
    }
}
