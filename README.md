# uConsole conveyor / camera FOV demo

A lightweight Three.js scene served from Docker. First cut runs the simulation
in the browser; the scene state is deliberately simple so it can later be
replaced by a Hiroz/Rust sim publishing the same data over Zenoh.

## Run

```bash
cd /home/cpi/uconsole-scene-demo
docker compose up -d
```

Open:

- on the uConsole: `http://localhost:8080`
- from another machine: `http://<uconsole-ip>:8080`

For a kiosk-style launch on the uConsole:

```bash
chromium --kiosk --window-size=1280,720 http://localhost:8080
```

> Three.js is loaded from unpkg in `app/index.html`. The browser needs internet
> access on first load. For fully offline use, download `three.module.js` and
> the `OrbitControls.js` addon into `app/vendor/` and point the import map at
> local paths.

Controls: drag to orbit, `+` / `-` or `PageUp` / `PageDown` to zoom (there are
also **Zoom +** / **Zoom −** buttons in the HUD — useful on the uConsole because
it has no scroll wheel), `Space` to pause, `S` to spawn a box.

## Geometry / coordinate system

All units are metres.

| Item | Value |
|---|---|
| Conveyor | 4.00 m along X, 0.60 m across Z, belt surface at Y=0 |
| Spawn | x = 0, random Z within belt minus half box width |
| Sink | just past x = 4.0 (boxes fall into a bin) |
| Camera position | x = 2.00 m, y = 1.00 m, z = 0, looking straight down |
| Camera FOV on belt | 0.60 m along X (transport) × 0.40 m across Z |
| FOV footprint | x = 1.70 .. 2.30, z = -0.20 .. +0.20 |
| Weighing scale | starts at x = 2.30 m (immediately after FOV), 0.60 m along X × 0.60 m across Z |
| Belt speed | 0.50 m/s |
| Spawn interval | 1.6 s (~0.8 m spacing) |
| Box size | w (Z) 0.20..0.60, l (X) 0.20..0.60, h (Y) 0.10..0.50 |

### FOV interpretation

I read `600x400 mm (wxl), width in the transport direction` as:

- **600 mm along the conveyor (X)**
- **400 mm across the conveyor (Z)**

The perspective camera is built from that footprint:

```js
verticalFov = 2 * atan((0.40 / 2) / 1.0); // ~22.62 deg, across belt
aspect      = 0.60 / 0.40;                // 1.5
```

Camera `up` is set to `(0, 0, -1)` so image-right maps to world +X. If you meant
the opposite (600 mm across, 400 mm along), swap `fovAlong` and `fovAcross` in
`app/main.js` — everything else (footprint, scale position, PiP) follows.

### Weight mapping

Weight is **linear in box volume** between the smallest and largest allowed boxes:

```
Vmin = 0.20 * 0.20 * 0.10 = 0.004 m^3  -> 1.0 kg
Vmax = 0.60 * 0.60 * 0.50 = 0.180 m^3  -> 10.0 kg
weight = 1 + 9 * (V - Vmin) / (Vmax - Vmin)
```

The scale shows the weight of the box with the largest overlap with the scale
platform, or `--- kg` when empty.

## Visual cues

- Yellow rectangle on the belt: exact camera FOV footprint.
- Cyan frustum helper: camera frustum in the 3D view.
- Bottom-right panel: live view from the camera, including the scale label.
- Green platform + label: weighing scale and current reading.
- Red translucent bin at the end: sink.

## Tuning

Edit the `M` object at the top of `app/main.js`:

- `speed`, `spawnEvery`
- `fovAlong`, `fovAcross`, `cameraHeight`
- `boxMin`, `boxMax`
- `weightMin`, `weightMax`

Then refresh the browser (no rebuild needed — the volume is bind-mounted).

## Next step: Hiroz

To move the simulation out of the browser:

1. Rust binary using `hiroz` publishes `objects`, `camera_info`, and `image`
   messages to a Zenoh router.
2. A tiny Zenoh → WebSocket bridge forwards those to the page.
3. `main.js` consumes the stream instead of running `spawnBox()` locally.

The Three.js rendering, FOV helper, footprint, scale label, and PiP view stay
exactly the same.
