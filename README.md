# uConsole conveyor / camera FOV demo

A lightweight Three.js scene served from Docker. The simulation runs in the
browser; later it can be replaced by a Hiroz/Rust sim publishing the same data
over Zenoh.

## Run

```bash
cd /home/cpi/uconsole-scene-demo
docker compose up -d
```

Open:

- on the uConsole: `http://localhost:8080`
- from another machine: `http://<uconsole-ip>:8080`

Kiosk-style launch:

```bash
chromium --kiosk --window-size=1280,720 http://localhost:8080
```

> Three.js is loaded from unpkg in `app/index.html`. For fully offline use,
> download `three.module.js` and `OrbitControls.js` into `app/vendor/` and point
> the import map at local paths.

Controls: drag to orbit, `+` / `-` or `PageUp` / `PageDown` to zoom (also
**Zoom +** / **Zoom −** buttons), `Space` to pause, `S` to spawn. Click any object
in the 3D view to select and edit it. The vertical **PANEL** tab on the right
edge opens/closes the sidebar.

## Coordinate system

All units are metres.

| Axis | Meaning |
|---|---|
| **X** | across the belt (-0.30 .. +0.30) |
| **Y** | transport direction (0 = spawn, 4.0 = sink) |
| **Z** | up; belt surface is Z = 0 |

| Item | Value |
|---|---|
| Conveyor | 4.00 m along Y, 0.60 m across X |
| Camera | x = 0, y = 2.00, z = 1.00, looking down -Z |
| FOV on belt | 0.60 m along Y (transport) × 0.40 m across X |
| FOV footprint | y = 1.70 .. 2.30, x = -0.20 .. +0.20 |
| Scale | starts at y = 2.30, 0.60 m along Y × 0.60 m across X |
| Sink | just past y = 4.0 (boxes fall in) |
| Belt speed | 0.50 m/s |
| Spawn interval | 1.6 s (~0.8 m spacing) |
| Box size | L(Y) 0.20..0.60, W(X) 0.20..0.60, H(Z) 0.10..0.50 |

Camera perspective is built from the footprint:

```js
verticalFov = 2 * atan((fovAlong / 2) / distance); // ~33.4 deg, along Y
aspect      = fovAcross / fovAlong;                // 0.4 / 0.6
```

The camera rotation is identity (`RX=RY=RZ=0`) because its local `-Z` already
points down world `-Z`. Editing any camera/FOV field automatically re-places the
scale right after the new FOV footprint.

## Sidebar (selection-based)

The sidebar shows **only the object currently selected**. Click an object in the
3D viewer (conveyor, camera, scale, sink, a box, or a 3D label) to select it;
the selected object gets a cyan bounding outline. Click empty space to clear the
selection.

Every section exposes:

- position `X ac`, `Y tr`, `Z up`
- rotation `RX°`, `RY°`, `RZ°` (degrees)
- size `L(Y)`, `W(X)`, `H(Z)` (metres)

| Selection | Extra fields |
|---|---|
| `conveyor` | `speed` (m/s) |
| `camera` | `FOV Y`, `FOV X`, `FOV dist` |
| `scale` | — |
| `sink` | — |
| `box:<id>` | size/pose of that individual box + live weight readout |
| `labels` | `show labels` (show/hide the 3D scale + sink labels) |

The spawner defaults (random size, min/max L/W/H, spawn interval) live in the
`boxes` object in `app/main.js`; individual boxes are edited by selecting them
in the 3D view.

## Weight mapping

Weight is linear in box volume between smallest and largest allowed boxes:

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
- Cyan bounding box: currently selected object.
- Bottom-right panel: live camera view, including the scale label.
- Green platform + label: weighing scale and current reading.
- Red translucent bin at the end: sink.
- No FOV text label in the 3D view — only the footprint rectangle.

## Tuning

Preferred: use the sidebar. Defaults live in the `config` object at the top of
`app/main.js`. The Docker volume is bind-mounted, so refresh the browser after
code edits (no rebuild).

## Git checkpoints

```
0f5ba11 Add hideable per-object sidebar; remove FOV label
c3b6080 Checkpoint: working conveyor/camera demo before sidebar step
```

Roll back with `git reset --hard <hash>`.

## Next step: Hiroz

To move the simulation out of the browser:

1. Rust binary using `hiroz` publishes `objects`, `camera_info`, and `image`
   messages to a Zenoh router.
2. A tiny Zenoh → WebSocket bridge forwards those to the page.
3. `main.js` consumes the stream instead of running `spawnBox()` locally.

The Three.js rendering, selection, sidebar, footprint, and PiP view stay the same.
