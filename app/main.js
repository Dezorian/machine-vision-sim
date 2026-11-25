import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const deg = THREE.MathUtils.degToRad;
const rad = THREE.MathUtils.radToDeg;
const rand = (a, b) => a + Math.random() * (b - a);

// Default: the Rust sim is authoritative and the browser only renders/edits it.
// ?source=local restores the original in-browser simulation for comparison.
const params = new URLSearchParams(window.location.search);
const sourceMode = params.get('source') === 'local' ? 'local' : 'zenoh';
const bridgeBase = params.get('bridge') || `${location.protocol === 'https:' ? 'https' : 'http'}://${location.hostname}:8765`;

let paused = false;
let activeCameraId = 1;
let configSeq = 0;
let spawnSeq = 0;
let resetSeq = 0;
let pendingConfigSeq = 0;
let lastBeltStamp = null;
let configRetryTimer = null;
let lastConfigBody = null;

const vec = (v) => ({
  x: Number.isFinite(v?.x) ? v.x : 0,
  y: Number.isFinite(v?.y) ? v.y : 0,
  z: Number.isFinite(v?.z) ? v.z : 0,
});
const sizeFromVec = (v) => ({ l: vec(v).y, w: vec(v).x, h: vec(v).z });
const copySize = (s) => ({ l: s.l, w: s.w, h: s.h });
const sceneSize = (s) => ({ x: s.w, y: s.l, z: s.h });

function makeCamera(id, pos, rot, fovAlong, fovAcross, size = { l: 0.14, w: 0.14, h: 0.08 }) {
  return {
    id,
    pos: { ...vec(pos) },
    rot: { ...vec(rot) },
    size: copySize(size),
    fovAlong,
    fovAcross,
    distance: 1.0,
  };
}

function cloneCamera(cam) {
  return JSON.parse(JSON.stringify(cam));
}

function cameraLabel(cam) {
  if (cam.id === 1) return 'CAM 1 · TOP';
  if (cam.id === 2) return 'CAM 2 · SIDE';
  return `CAM ${cam.id}`;
}

// ---------------------------------------------------------------------------
// Coordinate system:
//   X = across belt, Y = transport direction (0 -> 4 m), Z = up.
// Sizes are { l: along Y, w: along X, h: along Z }. Rotations are in DEGREES.
// ---------------------------------------------------------------------------
const config = {
  conveyor: {
    pos: { x: 0, y: 2.0, z: -0.03 },
    rot: { x: 0, y: 0, z: 0 },
    size: { l: 4.0, w: 0.60, h: 0.06 },
    speed: 0.5,
  },
  cameras: [
    // Top view: local -Z points down world -Z.
    makeCamera(1, { x: 0, y: 2.0, z: 1.0 }, { x: 0, y: 0, z: 0 }, 0.60, 0.40),
    // Side view: same point, pitched 90 degrees down the belt. FOV Y is now
    // vertical (world Z) and FOV X stays across the belt (world X).
    makeCamera(2, { x: 0, y: 2.0, z: 1.0 }, { x: 90, y: 0, z: 0 }, 1.60, 0.60),
  ],
  scale: {
    pos: { x: 0, y: 2.60, z: 0.01 },
    rot: { x: 0, y: 0, z: 0 },
    size: { l: 0.60, w: 0.60, h: 0.02 },
  },
  sink: {
    pos: { x: 0, y: 4.28, z: -0.25 },
    rot: { x: 0, y: 0, z: 0 },
    size: { l: 0.55, w: 0.72, h: 0.50 },
  },
  boxes: {
    pos: { x: 0, y: 0.05, z: 0 },
    rot: { x: 0, y: 0, z: 0 },
    size: { l: 0.40, w: 0.40, h: 0.30 },
    randomSize: true,
    min: { l: 0.20, w: 0.20, h: 0.10 },
    max: { l: 0.60, w: 0.60, h: 0.50 },
    spawnEvery: 1.6,
  },
  labels: {
    pos: { x: 0, y: 0, z: 0 }, // offset from the parent object
    rot: { x: 0, y: 0, z: 0 }, // sprite rotation
    size: { l: 0.55, w: 0.14, h: 1 }, // sprite size from l/w
    show: true,
  },
};

// ---------------------------------------------------------------------------
// Persistent settings.
//   current  = the values you are editing now (saved on every change)
//   defaults = what the Reset button restores (updated by a 3 s long-press)
// ---------------------------------------------------------------------------
const STORAGE_KEYS = {
  current: 'uconsole-scene-demo:current:v1',
  defaults: 'uconsole-scene-demo:defaults:v1',
};

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn(`[settings] cannot read ${key}`, err);
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[settings] cannot write ${key}`, err);
  }
}

function mergeConfig(target, source) {
  if (!source) return target;
  for (const section of Object.keys(target)) {
    const srcSection = source[section];
    if (!srcSection) continue;
    for (const key of Object.keys(target[section])) {
      const srcValue = srcSection[key];
      if (srcValue === undefined) continue;
      const targetValue = target[section][key];
      if (Array.isArray(srcValue)) {
        target[section][key] = cloneConfig(srcValue);
      } else if (targetValue && typeof targetValue === 'object') {
        Object.assign(targetValue, srcValue);
      } else {
        target[section][key] = srcValue;
      }
    }
  }
  return target;
}

function migrateLegacyCamera(target, stored) {
  if (!stored?.camera || stored?.cameras || !target.cameras?.length) return;
  const legacy = stored.camera;
  const first = target.cameras[0];
  target.cameras[0] = {
    ...first,
    pos: { ...vec(legacy.pos) },
    rot: { ...vec(legacy.rot) },
    size: legacy.size ? copySize(legacy.size) : copySize(first.size),
    fovAlong: legacy.fovAlong ?? first.fovAlong,
    fovAcross: legacy.fovAcross ?? first.fovAcross,
    distance: legacy.distance ?? first.distance,
  };
}

const FACTORY_CONFIG = cloneConfig(config);
let defaults = cloneConfig(FACTORY_CONFIG);
const storedDefaults = readStored(STORAGE_KEYS.defaults);
const storedCurrent = readStored(STORAGE_KEYS.current);
mergeConfig(defaults, storedDefaults);
migrateLegacyCamera(defaults, storedDefaults);
mergeConfig(config, defaults);
mergeConfig(config, storedCurrent);
migrateLegacyCamera(config, storedCurrent);

function saveCurrentConfig() {
  writeStored(STORAGE_KEYS.current, config);
}

function saveDefaultsFromCurrent() {
  defaults = cloneConfig(config);
  writeStored(STORAGE_KEYS.defaults, defaults);
}

function firstCamera() {
  if (!Array.isArray(config.cameras) || !config.cameras.length) {
    config.cameras = [makeCamera(1, { x: 0, y: 2, z: 1 }, { x: 0, y: 0, z: 0 }, 0.60, 0.40)];
  }
  return config.cameras[0];
}

function cameraById(id) {
  return config.cameras?.find((cam) => cam.id === id) || null;
}

function selectedCamera() {
  return cameraById(activeCameraId) || firstCamera();
}

let cameraControlSignature = '';

function refreshCameraControls(force = false) {
  const select = document.getElementById('pipCamera');
  if (!select) return;
  const cam = selectedCamera();
  const title = document.getElementById('pipTitle');
  const titleText = `${cameraLabel(cam)} · live view`;
  if (title && title.textContent !== titleText) title.textContent = titleText;

  const signature = config.cameras.map((entry) => `${entry.id}:${cameraLabel(entry)}`).join(',');
  if (force || signature !== cameraControlSignature) {
    select.innerHTML = '';
    for (const entry of config.cameras) {
      const option = document.createElement('option');
      option.value = String(entry.id);
      option.textContent = cameraLabel(entry);
      select.appendChild(option);
    }
    cameraControlSignature = signature;
  }
  if (select.value !== String(cam.id)) select.value = String(cam.id);
}

// ---------------------------------------------------------------------------
// Renderer / scene / orbit camera (Z is up)
// ---------------------------------------------------------------------------
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 8, 16);

const orbitCam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 100);
orbitCam.up.set(0, 0, 1);
orbitCam.position.set(5.2, 5.6, 3.2);

const controls = new OrbitControls(orbitCam, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 1.2;
controls.maxDistance = 12;
controls.update();

function zoomBy(factor) {
  const offset = orbitCam.position.clone().sub(controls.target);
  const next = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
  offset.setLength(next);
  orbitCam.position.copy(controls.target).add(offset);
  controls.update();
}

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202830, 1.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(3, 4, 6);
scene.add(keyLight);

const grid = new THREE.GridHelper(8, 16, 0x334455, 0x1d2833);
grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default; rotate into XY
grid.position.z = -0.42;
scene.add(grid);

// ---------------------------------------------------------------------------
// Shared unit geometry. Size is applied via mesh.scale so edits are live.
// scale mapping: X <- w, Y <- l, Z <- h
// ---------------------------------------------------------------------------
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitEdges = new THREE.EdgesGeometry(unitBox);
const boxEdgeMat = new THREE.LineBasicMaterial({ color: 0x0b0f14 });

function makeBox(size, pos, rot, material, edgeMat = null, parent = scene) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(size.w, size.l, size.h);
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.rotation.set(deg(rot.x), deg(rot.y), deg(rot.z));
  if (edgeMat) mesh.add(new THREE.LineSegments(unitEdges, edgeMat));
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// 3D labels (only scale + sink; FOV text label was removed)
// ---------------------------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeLabel(text, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(opts.scaleX ?? 0.55, opts.scaleY ?? 0.14, 1);

  let lastText = null;
  function setText(value) {
    const str = String(value);
    if (str === lastText) return;
    lastText = str;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(8,12,16,0.84)';
    roundRect(ctx, 4, 4, 504, 120, 18);
    ctx.fill();
    ctx.strokeStyle = opts.border ?? '#64d2ff';
    ctx.lineWidth = 3;
    roundRect(ctx, 4, 4, 504, 120, 18);
    ctx.stroke();
    ctx.fillStyle = opts.color ?? '#ffffff';
    ctx.font = 'bold 52px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, 256, 66);
    texture.needsUpdate = true;
  }

  sprite.userData.setText = setText;
  setText(text);
  return sprite;
}

// ---------------------------------------------------------------------------
// Conveyor
// ---------------------------------------------------------------------------
const conveyorGroup = new THREE.Group();
conveyorGroup.userData.objectKey = 'conveyor';
scene.add(conveyorGroup);

function makeBeltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#30363d';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#3a424b';
  for (let i = 0; i < 128; i += 16) ctx.fillRect(i, 0, 8, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const beltTexture = makeBeltTexture();
const beltMat = new THREE.MeshStandardMaterial({ map: beltTexture, roughness: 0.92, metalness: 0.05 });
const belt = makeBox(config.conveyor.size, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, beltMat, null, conveyorGroup);

const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7, metalness: 0.15 });
const rails = [
  makeBox({ l: 1, w: 0.04, h: 0.09 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, frameMat, null, conveyorGroup),
  makeBox({ l: 1, w: 0.04, h: 0.09 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, frameMat, null, conveyorGroup),
];
const legs = [];
for (let i = 0; i < 4; i++) {
  legs.push(makeBox({ l: 0.06, w: 0.06, h: 0.40 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, frameMat, null, conveyorGroup));
}
const rollerGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 16);
const rollerMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.5, metalness: 0.4 });
const rollers = [new THREE.Mesh(rollerGeo, rollerMat), new THREE.Mesh(rollerGeo, rollerMat)];
rollers.forEach((r) => { r.rotation.z = Math.PI / 2; conveyorGroup.add(r); }); // axis along X

// ---------------------------------------------------------------------------
// Camera rigs + PiP camera
// ---------------------------------------------------------------------------
const cameraRigs = new Map();
const rigMat = new THREE.MeshStandardMaterial({ color: 0x2f3b46, roughness: 0.6, metalness: 0.3 });
const lensGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.09, 16);
const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });

function makeCameraRig(cam) {
  const group = new THREE.Group();
  group.userData.objectKey = `camera:${cam.id}`;
  const body = makeBox(cam.size, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, rigMat, boxEdgeMat, group);
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2; // cylinder axis -> Z
  group.add(lens);
  const pole = makeBox({ l: 0.05, w: 0.05, h: 1 }, { x: 0.36, y: 0, z: -0.5 }, { x: 0, y: 0, z: 0 }, rigMat, null, group);
  const arm = makeBox({ l: 0.05, w: 0.36, h: 0.05 }, { x: 0.18, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, rigMat, null, group);
  scene.add(group);
  const rig = { group, body, lens, pole, arm };
  cameraRigs.set(cam.id, rig);
  return rig;
}

function updateCameraRig(rig, cam) {
  rig.group.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
  rig.group.rotation.set(deg(cam.rot.x), deg(cam.rot.y), deg(cam.rot.z));
  rig.body.scale.set(cam.size.w, cam.size.l, cam.size.h);
  rig.lens.position.set(0, 0, -cam.size.h * 0.6);
  rig.pole.scale.set(0.05, 0.05, Math.max(0.05, cam.pos.z));
  rig.pole.position.set(0.36, 0, -cam.pos.z / 2);
  rig.arm.position.set(0.18, 0, cam.size.h / 2);
  rig.arm.scale.set(0.36, 0.05, 0.05);
}

function syncCameraRigs() {
  const ids = new Set(config.cameras.map((cam) => cam.id));
  for (const [id, rig] of cameraRigs) {
    if (!ids.has(id)) {
      scene.remove(rig.group);
      cameraRigs.delete(id);
    }
  }
  for (const cam of config.cameras) {
    updateCameraRig(cameraRigs.get(cam.id) || makeCameraRig(cam), cam);
  }
}

const demoCam = new THREE.PerspectiveCamera(33.4, 0.667, 0.02, 8);
const camHelper = new THREE.CameraHelper(demoCam);
scene.add(camHelper);

const footprint = new THREE.LineLoop(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffd54a })
);
scene.add(footprint);

// ---------------------------------------------------------------------------
// Scale + sink + labels
// ---------------------------------------------------------------------------
const scaleGroup = new THREE.Group();
scaleGroup.userData.objectKey = 'scale';
scene.add(scaleGroup);
const scaleMat = new THREE.MeshStandardMaterial({ color: 0x2b5c66, roughness: 0.55, metalness: 0.25 });
const scaleEdgeMat = new THREE.LineBasicMaterial({ color: 0x48e0a0 });
const platform = makeBox(config.scale.size, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, scaleMat, scaleEdgeMat, scaleGroup);

const sinkGroup = new THREE.Group();
sinkGroup.userData.objectKey = 'sink';
scene.add(sinkGroup);
const sinkMat = new THREE.MeshStandardMaterial({ color: 0x5a2027, roughness: 0.85, transparent: true, opacity: 0.78 });
const sinkEdgeMat = new THREE.LineBasicMaterial({ color: 0xff6b6b });
const sinkMesh = makeBox(config.sink.size, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, sinkMat, sinkEdgeMat, sinkGroup);

const scaleLabel = makeLabel('--- kg', { border: '#48e0a0', color: '#48e0a0' });
const sinkLabel = makeLabel('SINK', { border: '#ff6b6b', color: '#ff6b6b' });
scaleLabel.userData.objectKey = 'labels';
sinkLabel.userData.objectKey = 'labels';
scene.add(scaleLabel, sinkLabel);

// Selection outline
const selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0x64d2ff);
selectionBox.visible = false;
scene.add(selectionBox);

// ---------------------------------------------------------------------------
// Apply config to the scene
// ---------------------------------------------------------------------------
function updateFootprint() {
  const cam = selectedCamera();
  const e = new THREE.Euler(deg(cam.rot.x), deg(cam.rot.y), deg(cam.rot.z));
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(e).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyEuler(e).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyEuler(e).normalize();
  const center = new THREE.Vector3(cam.pos.x, cam.pos.y, cam.pos.z)
    .addScaledVector(forward, Math.max(0.01, cam.distance));
  const hw = Math.max(0.01, cam.fovAcross) / 2; // camera-local X
  const hh = Math.max(0.01, cam.fovAlong) / 2;  // camera-local Y
  const pts = [
    center.clone().addScaledVector(right, -hw).addScaledVector(up, -hh),
    center.clone().addScaledVector(right, hw).addScaledVector(up, -hh),
    center.clone().addScaledVector(right, hw).addScaledVector(up, hh),
    center.clone().addScaledVector(right, -hw).addScaledVector(up, hh),
  ];
  footprint.geometry.setFromPoints(pts);
}

function applyConfig() {
  const c = config;

  // Conveyor
  conveyorGroup.position.set(c.conveyor.pos.x, c.conveyor.pos.y, c.conveyor.pos.z);
  conveyorGroup.rotation.set(deg(c.conveyor.rot.x), deg(c.conveyor.rot.y), deg(c.conveyor.rot.z));
  const cl = c.conveyor.size.l, cw = c.conveyor.size.w, ch = c.conveyor.size.h;
  belt.scale.set(cw, cl, ch);
  rails.forEach((r, i) => {
    const sign = i === 0 ? -1 : 1;
    r.position.set(sign * (cw / 2 + 0.02), 0, ch / 2 + 0.045);
    r.scale.set(0.04, cl + 0.05, 0.09);
  });
  legs.forEach((leg, i) => {
    const sx = i < 2 ? -1 : 1;
    const sy = i % 2 === 0 ? -1 : 1;
    leg.position.set(sx * (cw / 2 - 0.05), sy * (cl / 2 - 0.2), -ch / 2 - 0.20);
    leg.scale.set(0.06, 0.06, 0.40);
  });
  rollers.forEach((roller, i) => {
    roller.position.set(0, (i === 0 ? -1 : 1) * (cl / 2 - 0.02), -ch / 2 - 0.03);
    roller.scale.y = cw;
  });

  // Camera rigs + PiP camera
  firstCamera();
  syncCameraRigs();
  if (!cameraById(activeCameraId)) activeCameraId = firstCamera().id;
  const cam = selectedCamera();
  const distance = Math.max(0.01, cam.distance);
  const along = Math.max(0.01, cam.fovAlong);
  const across = Math.max(0.01, cam.fovAcross);

  demoCam.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
  demoCam.rotation.set(deg(cam.rot.x), deg(cam.rot.y), deg(cam.rot.z));
  demoCam.fov = rad(2 * Math.atan((along / 2) / distance));
  demoCam.aspect = across / along;
  demoCam.near = 0.02;
  demoCam.far = Math.max(distance * 1.25 + 0.25, c.conveyor.size.l + 1.0);
  demoCam.updateProjectionMatrix();
  demoCam.updateMatrixWorld(true);
  camHelper.update();
  updateFootprint();

  // Scale
  scaleGroup.position.set(c.scale.pos.x, c.scale.pos.y, c.scale.pos.z);
  scaleGroup.rotation.set(deg(c.scale.rot.x), deg(c.scale.rot.y), deg(c.scale.rot.z));
  platform.scale.set(c.scale.size.w, c.scale.size.l, c.scale.size.h);

  // Sink
  sinkGroup.position.set(c.sink.pos.x, c.sink.pos.y, c.sink.pos.z);
  sinkGroup.rotation.set(deg(c.sink.rot.x), deg(c.sink.rot.y), deg(c.sink.rot.z));
  sinkMesh.scale.set(c.sink.size.w, c.sink.size.l, c.sink.size.h);

  // Labels
  scaleLabel.visible = c.labels.show;
  sinkLabel.visible = c.labels.show;
  scaleLabel.scale.set(c.labels.size.l, c.labels.size.w, 1);
  sinkLabel.scale.copy(scaleLabel.scale);
  scaleLabel.position.set(
    c.scale.pos.x + c.labels.pos.x,
    c.scale.pos.y + c.labels.pos.y,
    c.scale.pos.z + c.scale.size.h / 2 + 0.4 + c.labels.pos.z
  );
  sinkLabel.position.set(
    c.sink.pos.x + c.labels.pos.x,
    c.sink.pos.y + c.labels.pos.y,
    c.sink.pos.z + c.sink.size.h / 2 + 0.3 + c.labels.pos.z
  );
  scaleLabel.material.rotation = deg(c.labels.rot.z);
  sinkLabel.material.rotation = deg(c.labels.rot.z);

  document.getElementById('speedValue').textContent = `${c.conveyor.speed.toFixed(2)} m/s`;
  document.getElementById('fovValue').textContent =
    `${cam.fovAlong.toFixed(2)} × ${cam.fovAcross.toFixed(2)} m`;
  refreshCameraControls();
  maybeRefreshTree();
  // Persistence is handled by the editor/sim commit path, not by every snapshot.
}

// ---------------------------------------------------------------------------
// Sim bridge: the browser sends edits; snapshots are the only scene state.
// ---------------------------------------------------------------------------
function sceneConfigFromEditor(options = {}) {
  const c = config;
  const primary = firstCamera();
  return {
    conveyor_pos: vec(c.conveyor.pos),
    conveyor_rot_deg: vec(c.conveyor.rot),
    conveyor_size: sceneSize(c.conveyor.size), // x = W, y = L, z = H
    conveyor_speed: c.conveyor.speed,

    camera_pose: vec(primary.pos),
    camera_rot_deg: vec(primary.rot),
    camera_size: sceneSize(primary.size),
    fov_y_m: primary.fovAlong,
    fov_x_m: primary.fovAcross,
    fov_distance: primary.distance,
    cameras: c.cameras.map((cam) => ({
      id: cam.id,
      pose: vec(cam.pos),
      rot_deg: vec(cam.rot),
      size: sceneSize(cam.size),
      fov_y_m: cam.fovAlong,
      fov_x_m: cam.fovAcross,
      fov_distance: cam.distance,
    })),

    scale_pose: vec(c.scale.pos),
    scale_rot_deg: vec(c.scale.rot),
    scale_size: sceneSize(c.scale.size),

    sink_pose: vec(c.sink.pos),
    sink_rot_deg: vec(c.sink.rot),
    sink_size: sceneSize(c.sink.size),

    boxes_pos: vec(c.boxes.pos),
    boxes_rot_deg: vec(c.boxes.rot),
    boxes_size: sceneSize(c.boxes.size),
    boxes_random_size: !!c.boxes.randomSize,
    boxes_min: sceneSize(c.boxes.min),
    boxes_max: sceneSize(c.boxes.max),
    spawn_interval: c.boxes.spawnEvery,

    labels_show: !!c.labels.show,
    paused,
    config_seq: configSeq,
    spawn_seq: spawnSeq,
    reset_seq: resetSeq,
    box_overrides: options.boxOverrides ?? [],
  };
}

async function sendConfigBody(body) {
  try {
    const response = await fetch(`${bridgeBase}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    document.getElementById('sourceValue').textContent = 'sim';
  } catch (err) {
    console.warn('[sim] config publish failed', err);
    document.getElementById('sourceValue').textContent = 'sim offline';
  }
}

function scheduleConfigRetry() {
  clearTimeout(configRetryTimer);
  configRetryTimer = setTimeout(() => {
    if (pendingConfigSeq && lastConfigBody) void sendConfigBody(lastConfigBody);
    if (pendingConfigSeq) scheduleConfigRetry();
  }, 1000);
}

function publishConfig(options = {}) {
  if (sourceMode === 'local') return;
  configSeq += 1;
  pendingConfigSeq = configSeq;
  lastConfigBody = JSON.stringify(sceneConfigFromEditor(options));
  void sendConfigBody(lastConfigBody);
  scheduleConfigRetry(); // retry until the sim echoes this config_seq
}

function onConfigChanged(full = '') {
  saveCurrentConfig();
  // Labels are viewer-only (not in SceneConfig), so keep them local.
  if (sourceMode === 'local' || full.startsWith('labels.')) applyConfig();
  else void publishConfig();
}

function setPaused(value) {
  paused = !!value;
  document.getElementById('btnPause').textContent = paused ? 'Resume' : 'Pause';
}

function applyCameraConfig(cam, wire) {
  const pos = vec(wire.pose ?? wire.pos ?? cam.pos);
  cam.pos.x = pos.x; cam.pos.y = pos.y; cam.pos.z = pos.z;
  const rot = vec(wire.rot_deg ?? wire.rot ?? cam.rot);
  cam.rot.x = rot.x; cam.rot.y = rot.y; cam.rot.z = rot.z;
  const size = wire.size ? sizeFromVec(wire.size) : copySize(cam.size);
  cam.size.l = size.l; cam.size.w = size.w; cam.size.h = size.h;
  cam.fovAlong = wire.fov_y_m ?? wire.fovAlong ?? cam.fovAlong;
  cam.fovAcross = wire.fov_x_m ?? wire.fovAcross ?? cam.fovAcross;
  cam.distance = wire.fov_distance ?? wire.distance ?? cam.distance;
}

// Update camera objects in place so any open sidebar inputs stay bound to them.
function applyCamerasFromWire(wireCameras, sc) {
  const incoming = Array.isArray(wireCameras) ? wireCameras : [];
  if (!incoming.length) {
    applyCameraConfig(firstCamera(), sc);
    return;
  }

  const existing = new Map(config.cameras.map((cam) => [cam.id, cam]));
  const usedIds = new Set();
  const next = [];
  for (const wire of incoming) {
    let id = Number(wire.id) || 1;
    while (usedIds.has(id)) id += 1;
    usedIds.add(id);
    let cam = existing.get(id);
    if (!cam) cam = makeCamera(id, wire.pose, wire.rot_deg, 0.60, 0.40);
    applyCameraConfig(cam, wire);
    existing.delete(id);
    next.push(cam);
  }
  config.cameras = next;

  if (selectedKey?.startsWith('camera:') && !cameraById(Number(selectedKey.slice(7)))) {
    selectedKey = null;
    selectedObj = null;
    selectionBox.visible = false;
  }
}

function applySceneConfig(sc) {
  if (!sc) return;
  config.conveyor.pos = vec(sc.conveyor_pos ?? config.conveyor.pos);
  config.conveyor.rot = vec(sc.conveyor_rot_deg ?? config.conveyor.rot);
  config.conveyor.size = sc.conveyor_size ? sizeFromVec(sc.conveyor_size) : copySize(config.conveyor.size);
  config.conveyor.speed = sc.conveyor_speed ?? config.conveyor.speed;

  applyCamerasFromWire(sc.cameras, sc);

  config.scale.pos = vec(sc.scale_pose ?? config.scale.pos);
  config.scale.rot = vec(sc.scale_rot_deg ?? config.scale.rot);
  config.scale.size = sc.scale_size ? sizeFromVec(sc.scale_size) : copySize(config.scale.size);

  config.sink.pos = vec(sc.sink_pose ?? config.sink.pos);
  config.sink.rot = vec(sc.sink_rot_deg ?? config.sink.rot);
  config.sink.size = sc.sink_size ? sizeFromVec(sc.sink_size) : copySize(config.sink.size);

  config.boxes.pos = vec(sc.boxes_pos ?? config.boxes.pos);
  config.boxes.rot = vec(sc.boxes_rot_deg ?? config.boxes.rot);
  config.boxes.size = sc.boxes_size ? sizeFromVec(sc.boxes_size) : copySize(config.boxes.size);
  config.boxes.randomSize = sc.boxes_random_size ?? config.boxes.randomSize;
  config.boxes.min = sc.boxes_min ? sizeFromVec(sc.boxes_min) : copySize(config.boxes.min);
  config.boxes.max = sc.boxes_max ? sizeFromVec(sc.boxes_max) : copySize(config.boxes.max);
  config.boxes.spawnEvery = sc.spawn_interval ?? config.boxes.spawnEvery;

  config.labels.show = sc.labels_show ?? config.labels.show;
  applyConfig();
}

function syncBoxes(simBoxes) {
  const incoming = Array.isArray(simBoxes) ? simBoxes : [];
  const seen = new Set();

  for (const sb of incoming) {
    const id = Number(sb.id);
    if (!Number.isFinite(id)) continue;
    seen.add(id);

    const pose = vec(sb.pose);
    const rot = vec(sb.rot_deg);
    const size = sizeFromVec(sb.size);
    let rec = boxes.find((b) => b.id === id);

    if (!rec) {
      const material = new THREE.MeshStandardMaterial({
        color: palette[id % palette.length],
        roughness: 0.72,
        metalness: 0.05,
      });
      const mesh = makeBox(size, pose, rot, material, boxEdgeMat);
      mesh.userData.objectKey = `box:${id}`;
      rec = { id, mesh, l: size.l, w: size.w, h: size.h, weight: 0, vz: 0 };
      mesh.userData.boxRecord = rec;
      boxes.push(rec);
      nextBoxId = Math.max(nextBoxId, id + 1);
    }

    rec.mesh.position.set(pose.x, pose.y, pose.z);
    rec.mesh.rotation.set(deg(rot.x), deg(rot.y), deg(rot.z));
    rec.mesh.scale.set(size.w, size.l, size.h);
    rec.l = size.l;
    rec.w = size.w;
    rec.h = size.h;
    rec.weight = Number.isFinite(sb.weight_kg) ? sb.weight_kg : weightFor(size.l, size.w, size.h);
    if (boxWeightEl && selectedKey === `box:${id}`) {
      boxWeightEl.textContent = `weight: ${rec.weight.toFixed(1)} kg`;
    }
  }

  for (let i = boxes.length - 1; i >= 0; i--) {
    if (!seen.has(boxes[i].id)) {
      disposeBox(boxes[i]);
      boxes.splice(i, 1);
    }
  }
  maybeRefreshTree();
}

function applySnapshot(snapshot) {
  const sSeq = snapshot.config?.config_seq ?? 0;
  if (pendingConfigSeq && sSeq < pendingConfigSeq) return; // wait for our edit to round-trip
  if (pendingConfigSeq) {
    clearTimeout(configRetryTimer);
    configRetryTimer = null;
    pendingConfigSeq = 0;
  }

  applySceneConfig(snapshot.config);
  syncBoxes(snapshot.boxes);

  const kg = Number.isFinite(snapshot.scale_kg) ? snapshot.scale_kg : 0;
  const text = kg > 0 ? `${kg.toFixed(1)} kg` : '--- kg';
  scaleLabel.userData.setText(text);
  document.getElementById('scaleValue').textContent = text;

  const simPaused = !!snapshot.config?.paused;
  if (lastBeltStamp !== null && !simPaused) {
    const elapsed = Math.max(0, snapshot.stamp_sec - lastBeltStamp);
    beltTexture.offset.x = (beltTexture.offset.x + (elapsed * snapshot.conveyor_speed) / 0.25) % 1;
  }
  lastBeltStamp = snapshot.stamp_sec;
  setPaused(simPaused);
  document.getElementById('count').textContent = String(boxes.length);
}

let uiRefs = {};

// ---------------------------------------------------------------------------
// Sidebar: only the selected object is shown
// ---------------------------------------------------------------------------
const baseFields = [
  ['pos.x', 'X ac', 0.01], ['pos.y', 'Y tr', 0.01], ['pos.z', 'Z up', 0.01],
  ['rot.x', 'RX°', 1], ['rot.y', 'RY°', 1], ['rot.z', 'RZ°', 1],
  ['size.l', 'L(Y)', 0.01], ['size.w', 'W(X)', 0.01], ['size.h', 'H(Z)', 0.01],
];

const cameraFields = [...baseFields,
  ['fovAlong', 'FOV Y', 0.01], ['fovAcross', 'FOV X', 0.01], ['distance', 'FOV dist', 0.01]];

const fieldDefs = {
  conveyor: [...baseFields, ['speed', 'speed m/s', 0.01]],
  scale: [...baseFields],
  sink: [...baseFields],
  boxes: [...baseFields,
    ['randomSize', 'random size', null],
    ['min.l', 'min L', 0.01], ['min.w', 'min W', 0.01], ['min.h', 'min H', 0.01],
    ['max.l', 'max L', 0.01], ['max.w', 'max W', 0.01], ['max.h', 'max H', 0.01],
    ['spawnEvery', 'every s', 0.1]],
  labels: [...baseFields, ['show', 'show labels', null]],
};

let selectedKey = null;
let selectedObj = null;
let boxWeightEl = null;
let lastTreeCount = -1;
let lastCameraCount = -1;

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function addSection(sidebar, sectionKey, target, defs, onChange) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  const heading = document.createElement('h3');
  heading.textContent = sectionKey;
  sec.appendChild(heading);
  const grid = document.createElement('div');
  grid.className = 'grid';

  for (const [path, label, step] of defs) {
    const full = `${sectionKey}.${path}`;
    if (step === null) {
      const wrap = document.createElement('label');
      wrap.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!getPath(target, path);
      input.addEventListener('change', () => {
        setPath(target, path, input.checked);
        onChange(full);
      });
      wrap.appendChild(input);
      wrap.appendChild(document.createTextNode(label));
      grid.appendChild(wrap);
      uiRefs[full] = input;
    } else {
      const wrap = document.createElement('label');
      wrap.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(step);
      input.value = getPath(target, path);
      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        if (Number.isNaN(value)) return;
        setPath(target, path, value);
        onChange(full);
      });
      wrap.appendChild(input);
      grid.appendChild(wrap);
      uiRefs[full] = input;
    }
  }
  sec.appendChild(grid);
  sidebar.appendChild(sec);
}

function makeBoxConfig(rec) {
  return {
    pos: { x: rec.mesh.position.x, y: rec.mesh.position.y, z: rec.mesh.position.z },
    rot: { x: rad(rec.mesh.rotation.x), y: rad(rec.mesh.rotation.y), z: rad(rec.mesh.rotation.z) },
    size: { l: rec.l, w: rec.w, h: rec.h },
  };
}

function commitBoxConfig(rec, bc) {
  if (sourceMode === 'local') {
    applyBoxConfig(rec, bc);
    return;
  }
  void publishConfig({
    boxOverrides: [{
      id: rec.id,
      pose: vec(bc.pos),
      rot_deg: vec(bc.rot),
      size: { x: bc.size.w, y: bc.size.l, z: bc.size.h },
      weight_kg: rec.weight,
    }],
  });
}

function applyBoxConfig(rec, bc) {
  rec.mesh.position.set(bc.pos.x, bc.pos.y, bc.pos.z);
  rec.mesh.rotation.set(deg(bc.rot.x), deg(bc.rot.y), deg(bc.rot.z));
  rec.mesh.scale.set(bc.size.w, bc.size.l, bc.size.h);
  rec.l = bc.size.l;
  rec.w = bc.size.w;
  rec.h = bc.size.h;
  rec.weight = weightFor(rec.l, rec.w, rec.h);
  if (boxWeightEl) boxWeightEl.textContent = `weight: ${rec.weight.toFixed(1)} kg`;
}

function makeTreeItem(label, key, isGroup = false, isChild = false, onClick = null) {
  const item = document.createElement('div');
  item.className = 'item' + (isGroup ? ' group' : '') + (isChild ? ' child' : '') + (onClick ? ' add' : '');
  item.textContent = label;
  item.addEventListener('click', () => (onClick ? onClick() : selectByKey(key)));
  return item;
}

function addCamera() {
  const base = cameraById(activeCameraId) || firstCamera();
  const nextId = config.cameras.reduce((max, cam) => Math.max(max, Number(cam.id) || 0), 0) + 1;
  const cam = cloneCamera(base);
  cam.id = nextId;
  cam.pos = { ...base.pos };
  cam.rot = { ...base.rot };
  cam.size = copySize(base.size);
  config.cameras.push(cam);
  activeCameraId = nextId;
  saveCurrentConfig();
  applyConfig();
  refreshCameraControls(true);
  selectByKey(`camera:${nextId}`);
  if (sourceMode !== 'local') publishConfig();
}

function selectByKey(key) {
  if (key === 'cameras') {
    selectedKey = null;
    selectedObj = null;
    selectionBox.visible = false;
    rebuildSidebar();
    return;
  }
  selectedKey = key;
  if (key.startsWith('box:')) {
    const rec = boxes.find((b) => `box:${b.id}` === key);
    selectedObj = rec ? rec.mesh : null;
  } else if (key.startsWith('camera:')) {
    selectedObj = cameraRigs.get(Number(key.slice(7)))?.group || null;
  } else if (key === 'boxes' || key === 'labels') {
    selectedObj = null; // pseudo-objects: no 3D outline
  } else {
    selectedObj = scene.children.find((obj) => obj.userData.objectKey === key) || null;
  }

  if (selectedObj) {
    selectionBox.box.setFromObject(selectedObj);
    selectionBox.visible = !selectionBox.box.isEmpty();
  } else {
    selectionBox.visible = false;
  }
  rebuildSidebar();
}

function rebuildSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = '';
  uiRefs = {};
  boxWeightEl = null;

  if (!selectedKey) {
    const tree = document.createElement('div');
    tree.className = 'tree';
    tree.appendChild(makeTreeItem('conveyor', 'conveyor'));
    tree.appendChild(makeTreeItem('cameras', 'cameras', true));
    config.cameras.forEach((cam) => {
      tree.appendChild(makeTreeItem(cameraLabel(cam), `camera:${cam.id}`, false, true));
    });
    tree.appendChild(makeTreeItem('+ add camera', null, false, true, addCamera));
    tree.appendChild(makeTreeItem('scale', 'scale'));
    tree.appendChild(makeTreeItem('sink', 'sink'));
    tree.appendChild(makeTreeItem('boxes', 'boxes', true));
    boxes.forEach((b) => tree.appendChild(makeTreeItem(`box:${b.id}`, `box:${b.id}`, false, true)));
    tree.appendChild(makeTreeItem('labels', 'labels'));
    sidebar.appendChild(tree);
    lastTreeCount = boxes.length;
    lastCameraCount = config.cameras.length;
    return;
  }

  if (selectedKey.startsWith('camera:')) {
    const cam = cameraById(Number(selectedKey.slice(7)));
    if (!cam) {
      selectedKey = null;
      selectedObj = null;
      selectionBox.visible = false;
      rebuildSidebar();
      return;
    }
    addSection(sidebar, selectedKey, cam, cameraFields, onConfigChanged);
    return;
  }

  if (selectedKey.startsWith('box:')) {
    const rec = boxes.find((b) => `box:${b.id}` === selectedKey);
    if (!rec) {
      selectedKey = null;
      selectedObj = null;
      selectionBox.visible = false;
      rebuildSidebar();
      return;
    }
    const bc = makeBoxConfig(rec);
    addSection(sidebar, selectedKey, bc, baseFields, () => commitBoxConfig(rec, bc));
    boxWeightEl = document.createElement('div');
    boxWeightEl.className = 'check';
    boxWeightEl.textContent = `weight: ${rec.weight.toFixed(1)} kg`;
    sidebar.appendChild(boxWeightEl);
    return;
  }

  addSection(sidebar, selectedKey, config[selectedKey], fieldDefs[selectedKey], onConfigChanged);
}

function maybeRefreshTree() {
  if (!selectedKey && (boxes.length !== lastTreeCount || config.cameras.length !== lastCameraCount)) {
    rebuildSidebar();
  }
}

const sidebarTab = document.getElementById('sidebarTab');
sidebarTab.addEventListener('click', () => {
  const open = document.body.classList.toggle('sidebar-open');
  sidebarTab.textContent = open ? 'CLOSE' : 'PANEL';
});

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------
const boxes = [];
const palette = [0x4fc3f7, 0xffb74d, 0x81c784, 0xba68c8, 0xe57373, 0x9575cd];
let nextBoxId = 1;

function weightFor(l, w, h) {
  const b = config.boxes;
  const minV = b.min.l * b.min.w * b.min.h;
  const maxV = b.max.l * b.max.w * b.max.h;
  const t = THREE.MathUtils.clamp((l * w * h - minV) / (maxV - minV), 0, 1);
  return 1 + 9 * t;
}

function spawnBox() {
  const b = config.boxes;
  let l, w, h;
  if (b.randomSize) {
    l = rand(b.min.l, b.max.l);
    w = rand(b.min.w, b.max.w);
    h = rand(b.min.h, b.max.h);
  } else {
    l = b.size.l;
    w = b.size.w;
    h = b.size.h;
  }

  const halfWidth = config.conveyor.size.w / 2;
  const xLimit = Math.max(0, halfWidth - w / 2);
  const x = THREE.MathUtils.clamp(b.pos.x + rand(-xLimit, xLimit), -xLimit, xLimit);
  const material = new THREE.MeshStandardMaterial({
    color: palette[Math.floor(Math.random() * palette.length)],
    roughness: 0.72,
    metalness: 0.05,
  });
  const mesh = makeBox({ l, w, h }, { x, y: b.pos.y, z: b.pos.z + h / 2 }, b.rot, material, boxEdgeMat);
  const id = nextBoxId++;
  mesh.userData.objectKey = `box:${id}`;
  const rec = { id, mesh, l, w, h, weight: weightFor(l, w, h), vz: 0 };
  mesh.userData.boxRecord = rec;
  boxes.push(rec);
}

function disposeBox(b) {
  if (selectedKey === `box:${b.id}`) {
    selectedKey = null;
    selectedObj = null;
    selectionBox.visible = false;
    rebuildSidebar();
  }
  scene.remove(b.mesh);
  b.mesh.material.dispose(); // unitBox / unitEdges are shared
}

function updateScale() {
  const s = config.scale;
  const sy0 = s.pos.y - s.size.l / 2;
  const sy1 = s.pos.y + s.size.l / 2;
  const sx0 = s.pos.x - s.size.w / 2;
  const sx1 = s.pos.x + s.size.w / 2;

  let best = null;
  let bestOverlap = 0;
  for (const b of boxes) {
    const oy = Math.min(b.mesh.position.y + b.l / 2, sy1) - Math.max(b.mesh.position.y - b.l / 2, sy0);
    const ox = Math.min(b.mesh.position.x + b.w / 2, sx1) - Math.max(b.mesh.position.x - b.w / 2, sx0);
    const overlap = oy > 0 && ox > 0 ? Math.min(oy, ox) : 0;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = b;
    }
  }
  const text = best && bestOverlap > 0 ? `${best.weight.toFixed(1)} kg` : '--- kg';
  scaleLabel.userData.setText(text);
  document.getElementById('scaleValue').textContent = text;
}

// ---------------------------------------------------------------------------
// Click-to-select in the 3D viewer
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (moved > 5) return; // it was an orbit drag, not a click

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, orbitCam);
  const hits = raycaster.intersectObjects(scene.children, true);

  let picked = null;
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !obj.userData.objectKey) obj = obj.parent;
    if (obj && obj.userData.objectKey) {
      picked = obj;
      break;
    }
  }

  selectedObj = picked;
  selectedKey = picked ? picked.userData.objectKey : null;
  if (!picked) {
    selectionBox.visible = false;
  } else {
    selectionBox.box.setFromObject(picked);
    selectionBox.visible = !selectionBox.box.isEmpty();
  }
  rebuildSidebar();
});

// ---------------------------------------------------------------------------
// PiP camera view
// ---------------------------------------------------------------------------
const pipRenderer = new THREE.WebGLRenderer({ canvas: document.getElementById('pip'), antialias: false });
pipRenderer.setPixelRatio(1);
pipRenderer.setSize(320, 213, false);
pipRenderer.outputColorSpace = THREE.SRGBColorSpace;

function renderPip() {
  const hidden = [camHelper, footprint, selectionBox, ...Array.from(cameraRigs.values(), (rig) => rig.group)];
  hidden.forEach((obj) => { obj.visible = false; });
  pipRenderer.render(scene, demoCam);
  hidden.forEach((obj) => { obj.visible = true; });
}

document.getElementById('pipCamera').addEventListener('change', (event) => {
  activeCameraId = Number(event.target.value) || firstCamera().id;
  applyConfig();
});
document.getElementById('btnAddCamera').addEventListener('click', addCamera);

// ---------------------------------------------------------------------------
// Controls / animation
// ---------------------------------------------------------------------------
let spawnTimer = 0;
let last = performance.now();

function requestSpawn() {
  if (sourceMode === 'local') {
    spawnBox();
    return;
  }
  spawnSeq += 1;
  void publishConfig();
}

function togglePause() {
  if (sourceMode === 'zenoh') {
    setPaused(!paused);
    void publishConfig();
    return;
  }
  setPaused(!paused);
}

document.getElementById('btnPause').addEventListener('click', togglePause);
document.getElementById('btnSpawn').addEventListener('click', requestSpawn);

// Reset: short press restores the saved defaults; holding for 3 s makes the
// current values the new defaults.
const btnReset = document.getElementById('btnReset');
const RESET_HOLD_MS = 3000;
let resetHoldTimer = null;
let resetHoldTriggered = false;
let suppressResetClick = false;
let resetLabelTimer = null;

function stopResetHold() {
  clearTimeout(resetHoldTimer);
  resetHoldTimer = null;
}

function resetHoldVisual(mode) {
  btnReset.classList.toggle('holding', mode === 'holding');
  btnReset.classList.toggle('saved', mode === 'saved');
  btnReset.textContent = mode === 'holding' ? 'Hold 3s…' : mode === 'saved' ? 'Saved ✓' : 'Reset';
}

function resetToDefaults() {
  mergeConfig(config, defaults);
  saveCurrentConfig();
  applyConfig();
  while (boxes.length) disposeBox(boxes.pop());
  spawnTimer = 0;
  if (sourceMode === 'local') {
    updateScale();
  } else {
    resetSeq += 1;
    nextBoxId = 1;
    void publishConfig();
  }
  rebuildSidebar();
}

btnReset.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  clearTimeout(resetLabelTimer);
  stopResetHold();
  resetHoldTriggered = false;
  suppressResetClick = false;
  resetHoldVisual('holding');
  resetHoldTimer = setTimeout(() => {
    resetHoldTriggered = true;
    saveDefaultsFromCurrent();
    stopResetHold();
    resetHoldVisual('saved');
    resetLabelTimer = setTimeout(() => resetHoldVisual('idle'), 1400);
  }, RESET_HOLD_MS);
});

btnReset.addEventListener('pointerup', () => {
  stopResetHold();
  if (resetHoldTriggered) suppressResetClick = true;
  else resetHoldVisual('idle');
});

btnReset.addEventListener('pointerleave', () => {
  if (!resetHoldTimer) return;
  stopResetHold();
  resetHoldVisual('idle');
});

btnReset.addEventListener('pointercancel', () => {
  stopResetHold();
  resetHoldVisual('idle');
  suppressResetClick = true;
});

btnReset.addEventListener('contextmenu', (event) => event.preventDefault());

btnReset.addEventListener('click', () => {
  if (suppressResetClick) {
    suppressResetClick = false;
    return;
  }
  resetToDefaults();
});

document.getElementById('btnZoomIn').addEventListener('click', () => zoomBy(0.85));
document.getElementById('btnZoomOut').addEventListener('click', () => zoomBy(1.15));

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') { event.preventDefault(); togglePause(); }
  if (event.key === 's' || event.key === 'S') requestSpawn();
  if (event.key === '+' || event.key === '=' || event.code === 'PageUp') {
    event.preventDefault();
    zoomBy(0.85);
  }
  if (event.key === '-' || event.key === '_' || event.code === 'PageDown') {
    event.preventDefault();
    zoomBy(1.15);
  }
});

window.addEventListener('resize', () => {
  orbitCam.aspect = window.innerWidth / window.innerHeight;
  orbitCam.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function startSceneStream() {
  const sourceValue = document.getElementById('sourceValue');
  if (sourceMode === 'local') {
    sourceValue.textContent = 'local';
    return;
  }

  sourceValue.textContent = 'connecting…';
  const stream = new EventSource(`${bridgeBase}/scene`);
  stream.onopen = () => {
    sourceValue.textContent = 'sim';
    void publishConfig();
  };
  stream.onmessage = (event) => {
    try {
      applySnapshot(JSON.parse(event.data));
    } catch (err) {
      console.warn('[sim] bad snapshot', err);
    }
  };
  stream.onerror = () => {
    sourceValue.textContent = 'sim offline';
  };
}

applyConfig();
rebuildSidebar();
if (sourceMode === 'local') {
  spawnBox();
  boxes[0].mesh.position.y = 1.1;
  updateScale();
}
startSceneStream();

function animate(now) {
  requestAnimationFrame(animate);

  if (sourceMode === 'local') {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (!paused) {
      spawnTimer += dt;
      if (spawnTimer >= config.boxes.spawnEvery) {
        spawnTimer -= config.boxes.spawnEvery;
        spawnBox();
      }

      beltTexture.offset.x = (beltTexture.offset.x + (dt * config.conveyor.speed) / 0.25) % 1;

      const endY = config.conveyor.pos.y + config.conveyor.size.l / 2;
      for (const b of boxes) {
        if (b.mesh.position.y <= endY) {
          b.mesh.position.y += config.conveyor.speed * dt;
        } else {
          b.vz -= 9.81 * dt;
          b.mesh.position.z += b.vz * dt;
          b.mesh.rotation.z += dt * 0.8;
        }
      }

      for (let i = boxes.length - 1; i >= 0; i--) {
        if (boxes[i].mesh.position.z < -0.65) {
          disposeBox(boxes[i]);
          boxes.splice(i, 1);
        }
      }

      updateScale();
      maybeRefreshTree();
    }
  }

  if (selectedObj && selectionBox.visible) {
    selectionBox.box.setFromObject(selectedObj);
  }

  camHelper.update();
  controls.update();
  renderer.render(scene, orbitCam);
  renderPip();

  document.getElementById('count').textContent = String(boxes.length);
}

requestAnimationFrame(animate);
