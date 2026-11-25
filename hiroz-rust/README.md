# Hiroz conveyor sim

Rust/Zenoh side of the uConsole conveyor demo. It is the source of truth for
the scene: the sim owns boxes, motion, camera/scale state and the scale reading;
the browser renders snapshots and publishes editor changes back. It uses
[Hiroz](https://github.com/ZettaScaleLabs/hiroz) 0.2.1 message types over a
Zenoh router.

## Run

From this directory:

```bash
# Build the Rust image (slow the first time on CM4: ~25-35 min)
docker compose build

# Router + HTTP bridge, then the sim publisher
docker compose up -d
docker compose --profile tools up -d app   # sim publisher at 60 Hz
```

The bridge listens on `http://<uconsole-ip>:8765`:

- `GET /scene` — SSE stream of `SceneSnapshot` JSON (CORS enabled)
- `POST /config` — JSON `SceneConfig` from the browser editor

The router REST/UI is at `http://<uconsole-ip>:8000`; Zenoh clients use
`tcp/<uconsole-ip>:7447`.

To watch snapshots from a terminal:

```bash
docker compose --profile tools run --rm app monitor
```

`ZENOH_ROUTER` is preset to `tcp/zenoh:7447` inside Compose. Outside Compose,
pass `--router tcp/127.0.0.1:7447` or set the same environment variable.

Useful options:

```bash
hiroz-conveyor sim --help
hiroz-conveyor sim --hz 20 --speed 0.75 --spawn-interval 1.2
hiroz-conveyor bridge --addr 0.0.0.0:8765
hiroz-conveyor monitor --topic /conveyor/scene
```

The sim logs its achieved publish rate once per second. Measured on the
uConsole: the Zenoh publisher is stable through `--hz 32000` (requesting 64 kHz
degrades to roughly 50-57 kHz), but the SSE bridge saturates near 5.8k
snapshots/s (~11 MB/s). Compose therefore runs the viewer sim at 60 Hz so each
snapshot lands near one display frame; no interpolation is needed at that rate.

## Topic and messages

Topics: `/conveyor/scene` (sim → bridge/browser) and `/conveyor/config`
(browser/bridge → sim).

Custom messages live in `src/messages.rs`:

| Type | Fields |
|---|---|
| `conveyor_demo/msg/Vec3` | `x`, `y`, `z` |
| `conveyor_demo/msg/BoxState` | `id`, `pose`, `rot_deg`, `size`, `weight_kg` |
| `conveyor_demo/msg/CameraState` | `pose`, `rot_deg`, `fov_y_deg`, `fov_x_deg`, `fov_distance` (for older clients) |
| `conveyor_demo/msg/CameraConfig` | `id`, `name`, `pose`, `rot_deg`, `size`, `fov_y_m`, `fov_x_m`, `fov_distance` |
| `conveyor_demo/msg/SceneConfig` | conveyor/camera/scale/sink/box poses and sizes, `cameras`, FOV footprint, spawner settings, `paused`, `config_seq`, `spawn_seq`, `reset_seq`, `box_overrides` |
| `conveyor_demo/msg/SceneSnapshot` | `stamp_sec`, `conveyor_speed`, `camera`, `cameras`, `scale_pose`, `scale_kg`, `config`, `boxes` |

`SceneSnapshot.config` is the authoritative copy of every editable static
setting. The browser sends `SceneConfig` on every edit; `config_seq` lets it
ignore stale snapshots until the sim echoes that edit. `spawn_seq` and
`reset_seq` are edge-triggered in the sim, and `box_overrides` carries a
selected box's pose/size edit. `cameras` is the authoritative editable camera
list; the classic `camera`/`camera_*` fields mirror `cameras[0]`, and a config
without `cameras` gets one synthesized from those fields. The default list has
a top-down camera (id 1, `TOP`) and a side camera (id 2, `SIDE`) at the same
pose, pitched 90° down the belt. Names are editable in the sidebar; empty names
get a `CAM <id>` fallback in the sim.

Coordinates match the viewer: **X** across the belt, **Y** transport direction,
**Z** up. Box size is `(x=width, y=length, z=height)`. Weight is linear in box
volume from 1 kg (smallest allowed box) to 10 kg (largest allowed box).

## Build notes

- No Rust toolchain is installed on the host; the multi-stage `Dockerfile`
  builds with `rust:1.91-bookworm` and copies only the binary to a slim runtime.
- Rust 1.91 is required because a transitive Hiroz dependency uses syntax newer
  than Rust 1.85. `Cargo.lock` was generated with Cargo 1.91.
- The first full release build is slow on an ARM CM4; Cargo caches make later
  source-only rebuilds fast.

## Next steps

1. Rate measurements are done; keep the browser sim at 60 Hz and leave
   interpolation off unless a higher-rate viewer is needed.
2. Optionally add `sensor_msgs/Image`/`CameraInfo` publishers for the PiP view.

