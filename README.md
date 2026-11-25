# machine-vision-sim

A quick and easy way to setup camera and moving objects in a visual environment to test if your machine vision idea could work

## uConsole conveyor / camera FOV demo

A lightweight Three.js scene served from Docker. By default the Rust/Hiroz sim
is the source of truth: it owns boxes, motion, camera/scale state, scale reading,
box label data, and camera trigger settings; the browser only renders snapshots
and sends editor changes back. The PiP view can switch between cameras, and
cameras can be added from the UI. `?source=local` restores the original
in-browser simulation for comparison.

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

Keyboard shortcuts are active only while the 3D viewer has focus (click the
canvas first); this keeps `+` and `-` usable in text inputs. With the viewer
focused: drag to orbit, `+` / `-` or `PageUp` / `PageDown` to zoom (also
**Zoom +** / **Zoom −** buttons), `Space` to pause, `S` to spawn. Click any object
in the 3D view to select and edit it. The vertical **OBJECTS** tab on the right
edge opens/closes the sidebar. A short **Reset** restores the saved defaults;
holding **Reset** for 3 s saves the current values as the new defaults.

Cameras live under the **cameras** group in the sidebar tree. Select one to edit
its name, pose, FOV, and OCR trigger (`trigger at`, `trig offset m`); the name
appears in the tree and PiP dropdown. Use the dropdown above the PiP view to
switch the live view, or press **+ CAM** (also available as **+ add camera** in
the tree) to add another camera. CAM 1 looks down from above; CAM 2 looks
exactly along **+Y** from box height. CAM 1 has its trigger off; CAM 2 captures
a box's `middle` once the box has moved far enough to enter that camera's view.

The PiP **LIVE / TRIGGER** button toggles between the selected camera's live
view and that camera's latest cropped trigger image. Switching the camera
dropdown in trigger mode switches the image too. The ↗ button opens the
selected camera's JPEG in a new browser tab. The browser keeps one latest crop
per camera from its own captures, polls `GET /label_image/latest` once a second,
and updates immediately after posting its own crop.

The top-left general panel has a `−` / `+` button to collapse or expand it, plus
**FOV** and **LABELS** buttons to show/hide the camera FOV overlays and all text
labels (scale, sink, and box shipping labels). Both visibility settings are
viewer-only and persist in localStorage. A short **Reset** restores all saved
defaults, including any extra cameras; holding **Reset** for 3 s saves the full
current setup as the new defaults. **Save Setup** exports the whole editor
configuration (cameras included) to a JSON file, and **Load Setup** imports it
again.

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
| Camera 2 (side) | x = 0, y = 2.00, z = 0.15, looking exactly along +Y |
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
| `camera` | `FOV Y`, `FOV X`, `FOV dist`, `trigger at`, `trig offset m` |
| `scale` | — |
| `sink` | — |
| `box:<id>` | size/pose of that individual box + live weight readout |
| `labels` | `show labels` (show/hide the 3D scale, sink, and box labels) |

The spawner defaults (random size, min/max L/W/H, spawn interval) live in the
`boxes` object in `app/main.js`; individual boxes are edited by selecting them
in the 3D view.

## Box labels and OCR triggers

Every spawned box gets one white shipping label on a randomly chosen vertical
face: `+X`, `-X`, `+Y`, or `-Y` (never top/bottom). The sim owns the label data:
weight, country code, barcode, and order number. The browser draws the text onto
a texture and applies a deterministic per-box amount of Gaussian blur and skew,
so a label looks the same every time its box is re-rendered.

Order data is arbitrary by default. To supply real values, start `sim` with:

```bash
hiroz-conveyor sim --labels-file /path/to/labels.txt
```

Each non-empty, non-comment line is `ORDER COUNTRY BARCODE`, for example:

```
ORD-000123 NL 8712345678902
ORD-000124 DE 4006381333931
```

Each camera has two trigger fields:

| Field | Values | Meaning |
|---|---|---|
| `trigger at` | `off`, `middle`, `begin`, `end` | Which box reference point triggers a crop |
| `trig offset m` | metres | Offset along **+Y** from that reference point |

The browser watches the box reference point (plus offset) and captures when
that point first enters the camera's frustum. This lets a SIDE camera look
exactly along **+Y** and still wait until the box is visible, instead of firing
at the camera's own Y plane. On entry it renders that camera, crops around the
label face of that box, JPEG-encodes only that crop, and POSTs it to the bridge
at `POST /label_image`. The full PiP stream stays in the browser for viewing;
it is never sent to OCR. A box/camera pair is captured at most once per run.

The crop contract is:

```json
{
  "stamp_sec": 12.34,
  "camera_id": 2,
  "box_id": 7,
  "trigger_anchor": "middle",
  "trigger_offset": 0.0,
  "trigger_y": 2.0,
  "image_encoding": "jpeg",
  "image_width": 160,
  "image_height": 120,
  "image_b64": "<base64 JPEG bytes>"
}
```

`trigger_y` is the box reference point's world Y at capture, and `stamp_sec` is
browser capture time in seconds. `GET /label_image/latest` returns the latest
crop (or HTTP 404 before the first one). The separate ROS2 package in [`ros2_label_ocr/`](ros2_label_ocr/README.md)
polls that endpoint, republishes the crop on `/conveyor/label_image`, and passes
it to a stub `YOLOLabelOCR` that will read weight, country code, and order number
once model weights and an OCR engine are supplied. See that package's README for
build/run commands.

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
resets and reloads. Arrays such as the camera list are stored in full, so
cameras added with **+ CAM** are included. To go back to the original factory
settings, clear both localStorage keys (or run `localStorage.clear()` in the
browser console) and refresh.

**Save Setup** writes the same editor configuration to a portable JSON file
with a `config` object and `active_camera_id`. **Load Setup** restores that
file as the current setup, saves it to `localStorage`, clears transient boxes,
and publishes it to the sim. Missing fields fall back to factory defaults.

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
- White side label: weight, country code, barcode, and order number on a box.
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
4697c13 Checkpoint before PiP trigger view, default camera persistence, and setup JSON
3de836a Add box labels, focus-gated zoom, and OCR trigger scaffold
ad1bf31 Checkpoint before zoom gating, box labels, and OCR prep
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
which it publishes as `SceneConfig` on `/conveyor/config`. Cropped trigger frames
arrive at `POST /label_image`, are cached for `GET /label_image/latest`, and are
published as `LabelImage` on `/conveyor/label_image` for the ROS2 bridge.

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
