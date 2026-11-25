use std::{collections::{HashMap, HashSet}, time::{Duration, Instant}};

use crate::messages::{BoxState, CameraConfig, CameraState, SceneConfig, SceneSnapshot, Vec3};
use hiroz::{Builder, Result, context::ZContextBuilder};
use tokio::select;

const GRAVITY: f64 = 9.81;
const FALL_SPIN_RAD_PER_S: f64 = 0.8;
const RAD_TO_DEG: f64 = 180.0 / std::f64::consts::PI;

pub struct SimOptions {
    pub router: String,
    pub topic: String,
    pub config_topic: String,
    pub hz: u64,
    pub speed: f64,
    pub spawn_interval: f64,
}

pub struct MonitorOptions {
    pub router: String,
    pub topic: String,
}

struct SimState {
    config: SceneConfig,
    boxes: Vec<BoxState>,
    falling_vz: HashMap<u64, f64>,
    next_id: u64,
    next_spawn: Instant,
    last_spawn_seq: u64,
    last_reset_seq: u64,
    last: Instant,
    rng: Lcg,
}

impl SimState {
    fn new(opts: &SimOptions, now: Instant) -> Self {
        Self {
            config: default_config(opts.speed, opts.spawn_interval),
            boxes: Vec::new(),
            falling_vz: HashMap::new(),
            next_id: 1,
            next_spawn: now,
            last_spawn_seq: 0,
            last_reset_seq: 0,
            last: now,
            rng: Lcg::new(0xC0FFEE),
        }
    }
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
    let zsub_config = node.create_sub::<SceneConfig>(&opts.config_topic).build()?;

    let period = Duration::from_secs_f64(1.0 / opts.hz as f64);
    let started = Instant::now();
    let mut state = SimState::new(&opts, started);
    let mut tick = tokio::time::interval(period);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut log_at = started;
    let mut ticks = 0_u64;

    println!(
        "Publishing SceneSnapshot on {} via {} at {} Hz (config: {})",
        opts.topic, opts.router, opts.hz, opts.config_topic
    );

    loop {
        select! {
            cfg = zsub_config.async_recv() => {
                match cfg {
                    Ok(cfg) => apply_config(&mut state, cfg, Instant::now()),
                    Err(err) => eprintln!("[sim] config receive failed: {err}"),
                }
            }
            _ = tick.tick() => {
                let now = Instant::now();
                let dt = now.duration_since(state.last).as_secs_f64();
                state.last = now;

                step(&mut state, dt, now);
                let snapshot = make_snapshot(&state, now.duration_since(started).as_secs_f64());
                zpub.async_publish(&snapshot).await?;

                ticks += 1;
                if now.duration_since(log_at) >= Duration::from_secs(1) {
                    let elapsed = now.duration_since(log_at).as_secs_f64();
                    println!(
                        "[{:6.2}s] {:6.1} Hz boxes={:2} scale={:5.2} kg",
                        snapshot.stamp_sec,
                        ticks as f64 / elapsed,
                        snapshot.boxes.len(),
                        snapshot.scale_kg
                    );
                    log_at = now;
                    ticks = 0;
                }
            }
        }
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

// Keep older clients working: the classic camera_* fields always mirror
// cameras[0], and a config without cameras gets one synthesized from them.
fn sanitize_cameras(cfg: &mut SceneConfig) {
    if cfg.cameras.is_empty() {
        cfg.cameras.push(CameraConfig {
            id: 1,
            name: "CAM 1".to_string(),
            pose: cfg.camera_pose.clone(),
            rot_deg: cfg.camera_rot_deg.clone(),
            size: cfg.camera_size.clone(),
            fov_y_m: cfg.fov_y_m,
            fov_x_m: cfg.fov_x_m,
            fov_distance: cfg.fov_distance,
        });
    }

    let mut used = HashSet::new();
    let mut next_id = 1_u64;
    for cam in &mut cfg.cameras {
        if cam.id == 0 || used.contains(&cam.id) {
            cam.id = next_id;
        }
        while used.contains(&cam.id) {
            cam.id += 1;
        }
        used.insert(cam.id);
        next_id = cam.id + 1;

        if cam.name.trim().is_empty() {
            cam.name = format!("CAM {}", cam.id);
        }
        if cam.fov_distance <= 0.0 { cam.fov_distance = 1.0; }
        if cam.fov_y_m <= 0.0 { cam.fov_y_m = 0.6; }
        if cam.fov_x_m <= 0.0 { cam.fov_x_m = 0.4; }
    }

    let primary = cfg.cameras[0].clone();
    cfg.camera_pose = primary.pose.clone();
    cfg.camera_rot_deg = primary.rot_deg.clone();
    cfg.camera_size = primary.size.clone();
    cfg.fov_y_m = primary.fov_y_m;
    cfg.fov_x_m = primary.fov_x_m;
    cfg.fov_distance = primary.fov_distance;
}

fn camera_state(cam: &CameraConfig) -> CameraState {
    let distance = cam.fov_distance.max(0.01);
    CameraState {
        pose: cam.pose.clone(),
        rot_deg: cam.rot_deg.clone(),
        fov_y_deg: 2.0 * ((cam.fov_y_m / 2.0) / distance).atan() * RAD_TO_DEG,
        fov_x_deg: 2.0 * ((cam.fov_x_m / 2.0) / distance).atan() * RAD_TO_DEG,
        fov_distance: cam.fov_distance,
    }
}

fn apply_config(state: &mut SimState, cfg: SceneConfig, now: Instant) {
    let mut cfg = cfg;
    sanitize_cameras(&mut cfg);
    let old_interval = state.config.spawn_interval;

    if cfg.reset_seq > state.last_reset_seq {
        state.boxes.clear();
        state.falling_vz.clear();
        state.next_id = 1;
        state.next_spawn = now;
        state.last_reset_seq = cfg.reset_seq;
    }
    state.last_reset_seq = state.last_reset_seq.max(cfg.reset_seq);

    if cfg.spawn_seq > state.last_spawn_seq {
        let box_state = spawn_box(&mut state.rng, state.next_id, &cfg);
        state.next_id += 1;
        state.boxes.push(box_state);
        state.last_spawn_seq = cfg.spawn_seq;
    }
    state.last_spawn_seq = state.last_spawn_seq.max(cfg.spawn_seq);

    for override_box in &cfg.box_overrides {
        if let Some(b) = state.boxes.iter_mut().find(|b| b.id == override_box.id) {
            b.pose = override_box.pose.clone();
            b.rot_deg = override_box.rot_deg.clone();
            b.size = override_box.size.clone();
            b.weight_kg = weight_from_volume(b.size.x * b.size.y * b.size.z, &cfg);
            state.falling_vz.remove(&b.id);
        }
    }

    if (old_interval - cfg.spawn_interval).abs() > 1e-9 {
        state.next_spawn = now + Duration::from_secs_f64(cfg.spawn_interval.max(0.01));
    }

    state.config = cfg;
}

fn step(state: &mut SimState, dt: f64, now: Instant) {
    if state.config.paused {
        return;
    }

    let cfg = &state.config;

    if now >= state.next_spawn {
        let box_state = spawn_box(&mut state.rng, state.next_id, cfg);
        state.next_id += 1;
        state.boxes.push(box_state);
        state.next_spawn = now + Duration::from_secs_f64(cfg.spawn_interval.max(0.01));
    }

    let end_y = cfg.conveyor_pos.y + cfg.conveyor_size.y / 2.0;
    let belt_z = cfg.conveyor_pos.z + cfg.conveyor_size.z / 2.0;

    {
        let boxes = &mut state.boxes;
        let falling = &mut state.falling_vz;
        for b in boxes.iter_mut() {
            if b.pose.y <= end_y && b.pose.z >= belt_z - 0.05 {
                b.pose.y += cfg.conveyor_speed * dt;
                falling.remove(&b.id);
            } else {
                let vz = falling.entry(b.id).or_insert(0.0);
                *vz -= GRAVITY * dt;
                b.pose.z += *vz * dt;
                b.rot_deg.z += FALL_SPIN_RAD_PER_S * dt * RAD_TO_DEG;
            }
        }
    }

    let mut despawn = Vec::new();
    for b in &state.boxes {
        if b.pose.z < -0.65 {
            despawn.push(b.id);
        }
    }
    for id in despawn {
        state.falling_vz.remove(&id);
    }
    state.boxes.retain(|b| b.pose.z >= -0.65);
}

fn make_snapshot(state: &SimState, stamp_sec: f64) -> SceneSnapshot {
    let cfg = &state.config;
    let primary = cfg.cameras.first().cloned().unwrap_or_default();

    SceneSnapshot {
        stamp_sec,
        conveyor_speed: cfg.conveyor_speed,
        camera: camera_state(&primary),
        cameras: cfg.cameras.clone(),
        scale_pose: cfg.scale_pose.clone(),
        scale_kg: scale_reading(&state.boxes, cfg),
        config: cfg.clone(),
        boxes: state.boxes.clone(),
    }
}

fn default_config(speed: f64, spawn_interval: f64) -> SceneConfig {
    let top = CameraConfig {
        id: 1,
        name: "TOP".to_string(),
        pose: Vec3 { x: 0.0, y: 2.0, z: 1.0 },
        rot_deg: Vec3::default(),
        size: Vec3 { x: 0.14, y: 0.14, z: 0.08 },
        fov_y_m: 0.60,
        fov_x_m: 0.40,
        fov_distance: 1.0,
    };
    // Same point as the top camera, pitched 90 degrees down the belt so it
    // sees the sides of boxes as they travel toward the sink.
    let side = CameraConfig {
        id: 2,
        name: "SIDE".to_string(),
        pose: top.pose.clone(),
        rot_deg: Vec3 { x: 90.0, y: 0.0, z: 0.0 },
        size: top.size.clone(),
        fov_y_m: 1.60,
        fov_x_m: 0.60,
        fov_distance: 1.0,
    };
    let cameras = vec![top.clone(), side];

    SceneConfig {
        conveyor_pos: Vec3 { x: 0.0, y: 2.0, z: -0.03 },
        conveyor_rot_deg: Vec3::default(),
        conveyor_size: Vec3 { x: 0.60, y: 4.0, z: 0.06 },
        conveyor_speed: speed,

        camera_pose: top.pose.clone(),
        camera_rot_deg: top.rot_deg.clone(),
        camera_size: top.size.clone(),
        fov_y_m: top.fov_y_m,
        fov_x_m: top.fov_x_m,
        fov_distance: top.fov_distance,
        cameras,

        scale_pose: Vec3 { x: 0.0, y: 2.60, z: 0.01 },
        scale_rot_deg: Vec3::default(),
        scale_size: Vec3 { x: 0.60, y: 0.60, z: 0.02 },

        sink_pose: Vec3 { x: 0.0, y: 4.28, z: -0.25 },
        sink_rot_deg: Vec3::default(),
        sink_size: Vec3 { x: 0.72, y: 0.55, z: 0.50 },

        boxes_pos: Vec3 { x: 0.0, y: 0.05, z: 0.0 },
        boxes_rot_deg: Vec3::default(),
        boxes_size: Vec3 { x: 0.40, y: 0.40, z: 0.30 },
        boxes_random_size: true,
        boxes_min: Vec3 { x: 0.20, y: 0.20, z: 0.10 },
        boxes_max: Vec3 { x: 0.60, y: 0.60, z: 0.50 },
        spawn_interval,

        labels_show: true,
        paused: false,
        config_seq: 0,
        spawn_seq: 0,
        reset_seq: 0,
        box_overrides: Vec::new(),
    }
}

fn spawn_box(rng: &mut Lcg, id: u64, cfg: &SceneConfig) -> BoxState {
    let length = if cfg.boxes_random_size {
        lerp(cfg.boxes_min.y, cfg.boxes_max.y, rng.next_f64())
    } else {
        cfg.boxes_size.y
    };
    let width = if cfg.boxes_random_size {
        lerp(cfg.boxes_min.x, cfg.boxes_max.x, rng.next_f64())
    } else {
        cfg.boxes_size.x
    };
    let height = if cfg.boxes_random_size {
        lerp(cfg.boxes_min.z, cfg.boxes_max.z, rng.next_f64())
    } else {
        cfg.boxes_size.z
    };

    let half_width = cfg.conveyor_size.x / 2.0;
    let x_limit = (half_width - width / 2.0).max(0.0);
    let x = cfg.boxes_pos.x + (rng.next_f64() * 2.0 - 1.0) * x_limit;

    BoxState {
        id,
        pose: Vec3 {
            x,
            y: cfg.boxes_pos.y,
            z: cfg.boxes_pos.z + height / 2.0,
        },
        rot_deg: cfg.boxes_rot_deg.clone(),
        size: Vec3 {
            x: width,
            y: length,
            z: height,
        },
        weight_kg: weight_from_volume(length * width * height, cfg),
    }
}

fn weight_from_volume(volume: f64, cfg: &SceneConfig) -> f64 {
    let min_v = cfg.boxes_min.x * cfg.boxes_min.y * cfg.boxes_min.z;
    let max_v = cfg.boxes_max.x * cfg.boxes_max.y * cfg.boxes_max.z;
    let (low, high) = if min_v <= max_v {
        (min_v, max_v)
    } else {
        (max_v, min_v)
    };
    if (high - low).abs() < 1e-9 {
        return 1.0;
    }
    1.0 + 9.0 * (volume.clamp(low, high) - low) / (high - low)
}

fn scale_reading(boxes: &[BoxState], cfg: &SceneConfig) -> f64 {
    let belt_x0 = cfg.conveyor_pos.x - cfg.conveyor_size.x / 2.0;
    let belt_x1 = cfg.conveyor_pos.x + cfg.conveyor_size.x / 2.0;
    let belt_y0 = cfg.conveyor_pos.y - cfg.conveyor_size.y / 2.0;
    let belt_y1 = cfg.conveyor_pos.y + cfg.conveyor_size.y / 2.0;

    let mut best_area = 0.0;
    let mut best_weight = 0.0;

    for b in boxes {
        let y0 = (b.pose.y - b.size.y / 2.0)
            .max(cfg.scale_pose.y - cfg.scale_size.y / 2.0)
            .max(belt_y0);
        let y1 = (b.pose.y + b.size.y / 2.0)
            .min(cfg.scale_pose.y + cfg.scale_size.y / 2.0)
            .min(belt_y1);
        let x0 = (b.pose.x - b.size.x / 2.0)
            .max(cfg.scale_pose.x - cfg.scale_size.x / 2.0)
            .max(belt_x0);
        let x1 = (b.pose.x + b.size.x / 2.0)
            .min(cfg.scale_pose.x + cfg.scale_size.x / 2.0)
            .min(belt_x1);
        let area = (y1 - y0).max(0.0) * (x1 - x0).max(0.0);
        if area > best_area {
            best_area = area;
            best_weight = b.weight_kg;
        }
    }

    best_weight
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t.clamp(0.0, 1.0)
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
