# uConsole conveyor / camera FOV demo

A lightweight Three.js scene served from Docker. By default the Rust/Hiroz sim
is the source of truth: it owns boxes, motion, camera/scale state, and the scale
reading; the browser only renders snapshots and sends editor changes back. The
PiP view can switch between cameras, and cameras can be added from the UI.
`?source=local` restores the original in-browser simulation for comparison.

## Run

```bash
# viewer
cd ~/Developer/uconsole-scene-demo
docker compose up -d

# sim + bridge (Zenoh router included)
cd ~/Developer/uconsole-scene-demo/hiroz-rust
docker compose up -d          # zenoh + bridge (:8765)
docker compose --profile tools up -d app   # sim publisher at 60 Hz
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
edge opens/closes the sidebar. A short **Reset** restores the saved defaults;
holding **Reset** for 3 s saves the current values as the new defaults.

Cameras live under the **cameras** group in the sidebar tree. Select one to edit
its pose/FOV, use the dropdown above the PiP view to switch the live view, or
press **+ CAM** (also available as **+ add camera** in the tree) to add another
camera. The default pair shares the same pose: CAM 1 looks down, CAM 2 is the
same point pitched 90° down the belt to see box sides.

The top-left general panel has a `−` / `+` button to collapse or expand it, plus
**FOV** and **LABELS** buttons to show/hide the camera FOV overlays and the
scale/sink labels. Both visibility settings are viewer-only and persist in
localStorage.

The HUD shows the active `source`: `sim` (default, via the bridge on port 8765),
`local` (`?source=local`), or `sim offline`.

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
| Camera 1 (top) | x = 0, y = 2.00, z = 1.00, looking down -Z |
| Camera 2 (side) | same point, pitched 90° down +Y to see box sides |
| FOV on belt (top) | 0.60 m along Y (transport) × 0.40 m across X |
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
points down world `-Z`. The camera and scale are fully decoupled: editing any
camera/FOV field never moves the scale, and editing the scale never moves the
camera.

## Sidebar (selection-based)

The sidebar shows **only the object currently selected**. Click an object in the
3D viewer (conveyor, camera, scale, sink, a box, or a 3D label) to select it;
the selected object gets a cyan bounding outline. Click empty space to clear the
selection and show a tree of all objects instead: `conveyor`, `camera`, `scale`,
`sink`, a `boxes` group with each live `box:<id>` nested under it, and `labels`.
Click a tree item to select that object. The tree refreshes automatically as
boxes spawn and despawn.

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

## Settings persistence

All editable object parameters — conveyor, camera, scale, sink, `boxes` spawner
defaults, and labels — are saved in the browser's `localStorage` on every
change, so they survive a reload:

- `uconsole-scene-demo:current:v1` — the values you are editing now.
- `uconsole-scene-demo:defaults:v1` — what **Reset** restores.

Individual spawned boxes are transient and are not persisted.

**Reset** (short press) copies the saved defaults into the current values,
clears the boxes, and re-renders the sidebar. **Hold Reset for 3 s** instead
copies the current values into the defaults; the button fills yellow while
held and shows `Saved ✓` when done. Those values then survive future short
resets and reloads. To go back to the original factory settings, clear both
localStorage keys (or run `localStorage.clear()` in the browser console) and
refresh.

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

Preferred: use the sidebar. Factory defaults live in the `config` object at the
top of `app/main.js`; saved current/default values live in localStorage (see
above). The Docker volume is bind-mounted, so refresh the browser after code
edits (no rebuild).

## Git checkpoints

```
0b41ffa Add object tree when nothing selected; decouple camera and scale
1da6012 Switch to Y=transport Z=up; click-to-select sidebar with vertical tab
0f5ba11 Add hideable per-object sidebar; remove FOV label
c3b6080 Checkpoint: working conveyor/camera demo before sidebar step
```

Roll back with `git reset --hard <hash>`.

## Hiroz / Rust setup

The Rust side lives in [`hiroz-rust/`](hiroz-rust/README.md). The sim publishes
`SceneSnapshot` on `/conveyor/scene`; the bridge exposes it as SSE at
`http://<uconsole-ip>:8765/scene` and accepts editor changes at `POST /config`,
which it publishes as `SceneConfig` on `/conveyor/config`.

The browser never advances boxes itself in the default mode. It renders the
latest snapshot directly (no interpolation), syncing boxes by `id`, and sends
sidebar changes, Pause/Spawn/Reset, and camera add/edit operations to the sim.
Boxes, scale reading, camera list/state, belt motion, and falling into the sink
all come from Rust. The PiP camera selection is viewer-only. Label offsets
remain viewer-only.

No interpolation is used yet. Measured on the uConsole: the sim publisher holds
`--hz 32000` (requesting 64 kHz degrades to roughly 50-57 kHz), while the SSE
bridge saturates near 5.8k snapshots/s (~11 MB/s). Because the browser applies
every snapshot and renders at roughly one frame per display refresh, Compose
runs the sim at 60 Hz -- one update per typical frame -- as the practical
no-interpolation setting. Optionally, `sensor_msgs/Image` / `CameraInfo` could
later drive the PiP view.

