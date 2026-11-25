# Hiroz conveyor sim

Rust/Zenoh side of the uConsole conveyor demo. It publishes the same scene the
browser currently simulates, using [Hiroz](https://github.com/ZettaScaleLabs/hiroz)
0.2.1 message types over a Zenoh router.

## Run

From this directory:

```bash
# Start the Zenoh router
docker compose up -d zenoh

# Build the Rust image (slow the first time on CM4: ~25-35 min)
docker compose --profile tools build app

# Publish the simulated scene
docker compose --profile tools run --rm app sim

# In a second terminal, watch it
docker compose --profile tools run --rm app monitor
```

The router REST/UI is at `http://<uconsole-ip>:8000`; Zenoh clients use
`tcp/<uconsole-ip>:7447`.

To run the publisher as a service instead:

```bash
docker compose --profile tools up -d app
docker compose --profile tools logs -f app
```

`ZENOH_ROUTER` is preset to `tcp/zenoh:7447` inside Compose. Outside Compose,
pass `--router tcp/127.0.0.1:7447` or set the same environment variable.

Useful options:

```bash
hiroz-conveyor sim --help
hiroz-conveyor sim --hz 20 --speed 0.75 --spawn-interval 1.2
hiroz-conveyor monitor --topic /conveyor/scene
```

## Topic and messages

Topic: `/conveyor/scene`

Custom messages live in `src/messages.rs`:

| Type | Fields |
|---|---|
| `conveyor_demo/msg/Vec3` | `x`, `y`, `z` |
| `conveyor_demo/msg/BoxState` | `id`, `pose`, `size`, `weight_kg` |
| `conveyor_demo/msg/CameraState` | `pose`, `fov_y_deg`, `fov_x_deg`, `fov_distance` |
| `conveyor_demo/msg/SceneSnapshot` | `stamp_sec`, `conveyor_speed`, `camera`, `boxes`, `scale_kg` |

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

1. Add a Zenoh → WebSocket bridge that republishes `SceneSnapshot` to the page.
2. Change `../app/main.js` to consume that stream instead of `spawnBox()`.
3. Optionally add `sensor_msgs/Image`/`CameraInfo` publishers for the PiP view.
