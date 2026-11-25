mod bridge;
mod messages;
mod sim;

use bridge::BridgeOptions;
use clap::{Parser, Subcommand};
use hiroz::Result;
use sim::{MonitorOptions, SimOptions};

#[derive(Debug, Parser)]
#[command(name = "hiroz-conveyor", about = "Hiroz/Zenoh conveyor scene publisher")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Publish a simulated conveyor scene over Zenoh.
    Sim {
        #[arg(long, env = "ZENOH_ROUTER", default_value = "tcp/127.0.0.1:7447")]
        router: String,
        #[arg(long, default_value = "/conveyor/scene")]
        topic: String,
        #[arg(long, default_value = "/conveyor/config")]
        config_topic: String,
        #[arg(long, default_value_t = 10, value_parser = clap::value_parser!(u64).range(1..))]
        hz: u64,
        #[arg(long, default_value_t = 0.5)]
        speed: f64,
        #[arg(long, default_value_t = 1.6)]
        spawn_interval: f64,
    },
    /// Print scenes received from the sim.
    Monitor {
        #[arg(long, env = "ZENOH_ROUTER", default_value = "tcp/127.0.0.1:7447")]
        router: String,
        #[arg(long, default_value = "/conveyor/scene")]
        topic: String,
    },
    /// Expose the Zenoh scene as SSE and accept browser config edits.
    Bridge {
        #[arg(long, env = "ZENOH_ROUTER", default_value = "tcp/127.0.0.1:7447")]
        router: String,
        #[arg(long, default_value = "/conveyor/scene")]
        scene_topic: String,
        #[arg(long, default_value = "/conveyor/config")]
        config_topic: String,
        #[arg(long, default_value = "0.0.0.0:8765")]
        addr: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Sim {
            router,
            topic,
            config_topic,
            hz,
            speed,
            spawn_interval,
        } => {
            sim::run_sim(SimOptions {
                router,
                topic,
                config_topic,
                hz,
                speed,
                spawn_interval,
            })
            .await
        }
        Command::Monitor { router, topic } => {
            sim::run_monitor(MonitorOptions { router, topic }).await
        }
        Command::Bridge {
            router,
            scene_topic,
            config_topic,
            addr,
        } => {
            bridge::run_bridge(BridgeOptions {
                router,
                scene_topic,
                config_topic,
                addr,
            })
            .await
        }
    }
}
