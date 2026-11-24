import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Dimensions are in metres.
//   X = transport direction: spawn at x=0, sink at x=4.0
//   Z = across the belt: -0.30 .. +0.30
//   Y = up; belt surface is y=0
// ---------------------------------------------------------------------------
const M = {
  beltLength: 4.0,
  beltWidth: 0.60,
  speed: 0.50,        // m/s
  spawnEvery: 1.6,    // s -> ~0.8 m spacing at 0.5 m/s

  cameraX: 2.0,
  cameraHeight: 1.0,

  // FOV footprint on the belt. Interpreted as "600 x 400 mm (w x l),
  // width in the transport direction": 600 mm along X, 400 mm across Z.
  // If you meant the opposite, just swap fovAlong and fovAcross below.
  fovAlong: 0.60,
  fovAcross: 0.40,

  scaleWidth: 0.60,   // across belt (full belt width)
  scaleLength: 0.60,  // along belt
  scaleHeight: 0.02,

  // w = across belt (Z), l = along belt (X), h = height (Y)
  boxMin: { w: 0.20, l: 0.20, h: 0.10 },
  boxMax: { w: 0.60, l: 0.60, h: 0.50 },

  weightMin: 1.0,
  weightMax: 10.0,
};
M.scaleStartX = M.cameraX + M.fovAlong / 2; // 2.30 m: right after the FOV
const scaleEndX = M.scaleStartX + M.scaleLength;
const scaleMidX = M.scaleStartX + M.scaleLength / 2;

const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Renderer / scene / orbit camera
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
orbitCam.position.set(5.2, 3.2, 5.6);

const controls = new OrbitControls(orbitCam, renderer.domElement);
controls.target.set(2, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 1.2;
controls.maxDistance = 12;
controls.update();

// Keyboard / button zoom (the uConsole has no scroll wheel).
function zoomBy(factor) {
  const offset = orbitCam.position.clone().sub(controls.target);
  const next = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
  offset.setLength(next);
  orbitCam.position.copy(controls.target).add(offset);
  controls.update();
}

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202830, 1.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(3, 6, 4);
scene.add(keyLight);

const grid = new THREE.GridHelper(8, 16, 0x334455, 0x1d2833);
grid.position.y = -0.42;
scene.add(grid);

// ---------------------------------------------------------------------------
// Small canvas-text sprite helper
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
  sprite.scale.set(opts.scaleX ?? 0.7, opts.scaleY ?? 0.175, 1);

  function setText(value) {
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
    ctx.fillText(String(value), 256, 66);
    texture.needsUpdate = true;
  }

  sprite.userData.setText = setText;
  setText(text);
  return sprite;
}

// ---------------------------------------------------------------------------
// Conveyor
// ---------------------------------------------------------------------------
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
const belt = new THREE.Mesh(new THREE.BoxGeometry(M.beltLength, 0.06, M.beltWidth), beltMat);
belt.position.set(M.beltLength / 2, -0.03, 0);
scene.add(belt);

const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7, metalness: 0.15 });
for (const z of [-M.beltWidth / 2 - 0.02, M.beltWidth / 2 + 0.02]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(M.beltLength + 0.05, 0.09, 0.04), frameMat);
  rail.position.set(M.beltLength / 2, 0.045, z);
  scene.add(rail);
}
for (const x of [0.2, M.beltLength - 0.2]) {
  for (const z of [-0.25, 0.25]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.40, 0.06), frameMat);
    leg.position.set(x, -0.23, z);
    scene.add(leg);
  }
}
const rollerMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.5, metalness: 0.4 });
for (const x of [0.02, M.beltLength - 0.02]) {
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, M.beltWidth, 16), rollerMat);
  roller.rotation.x = Math.PI / 2;
  roller.position.set(x, -0.06, 0);
  scene.add(roller);
}

// ---------------------------------------------------------------------------
// Camera rig + the actual perspective camera used for FOV and the PiP view
// ---------------------------------------------------------------------------
const rigMat = new THREE.MeshStandardMaterial({ color: 0x2f3b46, roughness: 0.6, metalness: 0.3 });
const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), rigMat);
pole.position.set(M.cameraX, 0.525, 0.36);
scene.add(pole);
const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.36), rigMat);
arm.position.set(M.cameraX, 1.02, 0.18);
scene.add(arm);
const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), rigMat);
camBody.position.set(M.cameraX, 1.05, 0);
scene.add(camBody);
const camLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.05, 0.09, 16),
  new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 })
);
camLens.position.set(M.cameraX, 0.995, 0);
scene.add(camLens);

// Vertical FOV from the required footprint at 1 m distance.
// Local camera Y is world -Z (across belt); local camera X is world +X (transport).
const verticalFovRad = 2 * Math.atan((M.fovAcross / 2) / M.cameraHeight);
const demoCam = new THREE.PerspectiveCamera(
  THREE.MathUtils.radToDeg(verticalFovRad),
  M.fovAlong / M.fovAcross,
  0.05,
  1.25
);
demoCam.up.set(0, 0, -1);
demoCam.position.set(M.cameraX, M.cameraHeight, 0);
demoCam.lookAt(new THREE.Vector3(M.cameraX, 0, 0));
demoCam.updateProjectionMatrix();
demoCam.updateMatrixWorld(true);

const camHelper = new THREE.CameraHelper(demoCam);
scene.add(camHelper);

// Bright rectangle showing the exact FOV footprint on the belt.
const footprint = (() => {
  const x0 = M.cameraX - M.fovAlong / 2;
  const x1 = M.cameraX + M.fovAlong / 2;
  const z0 = -M.fovAcross / 2;
  const z1 = M.fovAcross / 2;
  const y = 0.004;
  const points = [
    new THREE.Vector3(x0, y, z0),
    new THREE.Vector3(x1, y, z0),
    new THREE.Vector3(x1, y, z1),
    new THREE.Vector3(x0, y, z1),
  ];
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xffd54a })
  );
  scene.add(line);
  return line;
})();

const fovLabel = makeLabel('FOV 600x400 mm', {
  scaleX: 0.85, scaleY: 0.21, border: '#ffd54a', color: '#ffd54a',
});
fovLabel.position.set(M.cameraX, 0.28, 0.28);
scene.add(fovLabel);

// ---------------------------------------------------------------------------
// Weighing scale
// ---------------------------------------------------------------------------
const scaleMat = new THREE.MeshStandardMaterial({ color: 0x2b5c66, roughness: 0.55, metalness: 0.25 });
const platform = new THREE.Mesh(
  new THREE.BoxGeometry(M.scaleLength, M.scaleHeight, M.scaleWidth),
  scaleMat
);
platform.position.set(scaleMidX, M.scaleHeight / 2, 0);
scene.add(platform);
const platformEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(platform.geometry),
  new THREE.LineBasicMaterial({ color: 0x48e0a0 })
);
platformEdge.position.copy(platform.position);
scene.add(platformEdge);

const scaleLabel = makeLabel('--- kg', {
  scaleX: 0.55, scaleY: 0.14, border: '#48e0a0', color: '#48e0a0',
});
scaleLabel.position.set(scaleMidX, 0.42, 0);
scene.add(scaleLabel);

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------
const sinkMat = new THREE.MeshStandardMaterial({
  color: 0x5a2027, roughness: 0.85, transparent: true, opacity: 0.78,
});
const sink = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.50, 0.72), sinkMat);
sink.position.set(M.beltLength + 0.28, -0.25, 0);
scene.add(sink);
const sinkEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(sink.geometry),
  new THREE.LineBasicMaterial({ color: 0xff6b6b })
);
sinkEdge.position.copy(sink.position);
scene.add(sinkEdge);
const sinkLabel = makeLabel('SINK', {
  scaleX: 0.5, scaleY: 0.125, border: '#ff6b6b', color: '#ff6b6b',
});
sinkLabel.position.set(M.beltLength + 0.28, 0.45, 0);
scene.add(sinkLabel);

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------
const boxes = [];
const palette = [0x4fc3f7, 0xffb74d, 0x81c784, 0xba68c8, 0xe57373, 0x9575cd];
const boxEdgeMat = new THREE.LineBasicMaterial({ color: 0x0b0f14 });

const minVolume = M.boxMin.w * M.boxMin.l * M.boxMin.h; // 0.004 m^3
const maxVolume = M.boxMax.w * M.boxMax.l * M.boxMax.h; // 0.180 m^3

function weightFor(w, l, h) {
  const volume = w * l * h;
  const t = THREE.MathUtils.clamp((volume - minVolume) / (maxVolume - minVolume), 0, 1);
  return M.weightMin + t * (M.weightMax - M.weightMin);
}

function spawnBox() {
  const w = rand(M.boxMin.w, M.boxMax.w); // across belt (Z)
  const l = rand(M.boxMin.l, M.boxMax.l); // along belt (X)
  const h = rand(M.boxMin.h, M.boxMax.h); // up (Y)

  const zLimit = M.beltWidth / 2 - w / 2;
  const z = rand(-zLimit, zLimit);
  const weight = weightFor(w, l, h);

  const geometry = new THREE.BoxGeometry(l, h, w);
  const material = new THREE.MeshStandardMaterial({
    color: palette[Math.floor(Math.random() * palette.length)],
    roughness: 0.72,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0.05, h / 2, z);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), boxEdgeMat));
  scene.add(mesh);

  boxes.push({ mesh, w, l, h, weight, vy: 0 });
}

function disposeBox(b) {
  scene.remove(b.mesh);
  b.mesh.geometry.dispose();
  b.mesh.material.dispose();
  b.mesh.children.forEach((child) => child.geometry.dispose());
}

function updateScale() {
  let best = null;
  let bestOverlap = 0;

  for (const b of boxes) {
    const overlap =
      Math.min(b.mesh.position.x + b.l / 2, scaleEndX) -
      Math.max(b.mesh.position.x - b.l / 2, M.scaleStartX);
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
// Picture-in-picture camera view (second, small WebGL renderer)
// ---------------------------------------------------------------------------
const pipRenderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('pip'),
  antialias: false,
});
pipRenderer.setPixelRatio(1);
pipRenderer.setSize(320, 213, false);
pipRenderer.outputColorSpace = THREE.SRGBColorSpace;

function renderPip() {
  const hidden = [camHelper, camBody, camLens, footprint, fovLabel];
  hidden.forEach((obj) => { obj.visible = false; });
  pipRenderer.render(scene, demoCam);
  hidden.forEach((obj) => { obj.visible = true; });
}

// ---------------------------------------------------------------------------
// Controls / animation
// ---------------------------------------------------------------------------
let paused = false;
let spawnTimer = 0;
let last = performance.now();

function togglePause() {
  paused = !paused;
  document.getElementById('btnPause').textContent = paused ? 'Resume' : 'Pause';
}

document.getElementById('btnPause').addEventListener('click', togglePause);
document.getElementById('btnSpawn').addEventListener('click', () => spawnBox());
document.getElementById('btnReset').addEventListener('click', () => {
  while (boxes.length) disposeBox(boxes.pop());
  spawnTimer = 0;
  updateScale();
});
document.getElementById('btnZoomIn').addEventListener('click', () => zoomBy(0.85));
document.getElementById('btnZoomOut').addEventListener('click', () => zoomBy(1.15));

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') { event.preventDefault(); togglePause(); }
  if (event.key === 's' || event.key === 'S') spawnBox();
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

// Start with one box already on the belt so the scene is not empty.
spawnBox();
boxes[0].mesh.position.x = 1.1;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (!paused) {
    spawnTimer += dt;
    if (spawnTimer >= M.spawnEvery) {
      spawnTimer -= M.spawnEvery;
      spawnBox();
    }

    beltTexture.offset.x = (beltTexture.offset.x + (dt * M.speed) / 0.25) % 1;

    for (const b of boxes) {
      if (b.mesh.position.x <= M.beltLength) {
        b.mesh.position.x += M.speed * dt;
      } else {
        b.vy -= 9.81 * dt;
        b.mesh.position.y += b.vy * dt;
        b.mesh.rotation.z += dt * 0.8;
      }
    }

    for (let i = boxes.length - 1; i >= 0; i--) {
      if (boxes[i].mesh.position.y < -0.65) {
        disposeBox(boxes[i]);
        boxes.splice(i, 1);
      }
    }

    updateScale();
  }

  camHelper.update();
  controls.update();
  renderer.render(scene, orbitCam);
  renderPip();

  document.getElementById('count').textContent = String(boxes.length);
}

requestAnimationFrame(animate);
