import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const deg = THREE.MathUtils.degToRad;
const rad = THREE.MathUtils.radToDeg;
const rand = (a, b) => a + Math.random() * (b - a);

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
  camera: {
    pos: { x: 0, y: 2.0, z: 1.0 },
    rot: { x: 0, y: 0, z: 0 }, // local -Z already points down world -Z
    size: { l: 0.14, w: 0.14, h: 0.08 },
    fovAlong: 0.60,  // footprint along Y (transport)
    fovAcross: 0.40, // footprint along X (across belt)
    distance: 1.0,
  },
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
// Camera rig + FOV camera
// ---------------------------------------------------------------------------
const cameraRig = new THREE.Group();
cameraRig.userData.objectKey = 'camera';
scene.add(cameraRig);
const rigMat = new THREE.MeshStandardMaterial({ color: 0x2f3b46, roughness: 0.6, metalness: 0.3 });
const camBody = makeBox(config.camera.size, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, rigMat, boxEdgeMat, cameraRig);
const camLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.05, 0.09, 16),
  new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 })
);
camLens.rotation.x = Math.PI / 2; // cylinder axis -> Z
cameraRig.add(camLens);
const pole = makeBox({ l: 0.05, w: 0.05, h: 1 }, { x: 0.36, y: 0, z: -0.5 }, { x: 0, y: 0, z: 0 }, rigMat, null, cameraRig);
const arm = makeBox({ l: 0.05, w: 0.36, h: 0.05 }, { x: 0.18, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, rigMat, null, cameraRig);

const demoCam = new THREE.PerspectiveCamera(33.4, 0.667, 0.02, 1.5);
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
  const e = new THREE.Euler(deg(config.camera.rot.x), deg(config.camera.rot.y), deg(config.camera.rot.z));
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(e).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyEuler(e).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyEuler(e).normalize();
  const center = new THREE.Vector3(config.camera.pos.x, config.camera.pos.y, config.camera.pos.z)
    .addScaledVector(forward, config.camera.distance);
  const hw = config.camera.fovAcross / 2; // X
  const hh = config.camera.fovAlong / 2;  // Y
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

  // Camera rig + FOV camera
  cameraRig.position.set(c.camera.pos.x, c.camera.pos.y, c.camera.pos.z);
  camBody.scale.set(c.camera.size.w, c.camera.size.l, c.camera.size.h);
  camLens.position.set(0, 0, -c.camera.size.h * 0.6);
  pole.scale.set(0.05, 0.05, Math.max(0.05, c.camera.pos.z));
  pole.position.set(0.36, 0, -c.camera.pos.z / 2);
  arm.position.set(0.18, 0, c.camera.size.h / 2);
  arm.scale.set(0.36, 0.05, 0.05);

  demoCam.position.set(c.camera.pos.x, c.camera.pos.y, c.camera.pos.z);
  demoCam.rotation.set(deg(c.camera.rot.x), deg(c.camera.rot.y), deg(c.camera.rot.z));
  const vFov = 2 * Math.atan((c.camera.fovAlong / 2) / c.camera.distance);
  demoCam.fov = rad(vFov);
  demoCam.aspect = c.camera.fovAcross / c.camera.fovAlong;
  demoCam.near = 0.02;
  demoCam.far = c.camera.distance * 1.25 + 0.25;
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
    `${c.camera.fovAlong.toFixed(2)} × ${c.camera.fovAcross.toFixed(2)} m`;
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

const fieldDefs = {
  conveyor: [...baseFields, ['speed', 'speed m/s', 0.01]],
  camera: [...baseFields,
    ['fovAlong', 'FOV Y', 0.01], ['fovAcross', 'FOV X', 0.01], ['distance', 'FOV dist', 0.01]],
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

function makeTreeItem(label, key, isGroup = false, isChild = false) {
  const item = document.createElement('div');
  item.className = 'item' + (isGroup ? ' group' : '') + (isChild ? ' child' : '');
  item.textContent = label;
  item.addEventListener('click', () => selectByKey(key));
  return item;
}

function selectByKey(key) {
  selectedKey = key;
  if (key.startsWith('box:')) {
    const rec = boxes.find((b) => `box:${b.id}` === key);
    selectedObj = rec ? rec.mesh : null;
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
    ['conveyor', 'camera', 'scale', 'sink'].forEach((key) => {
      tree.appendChild(makeTreeItem(key, key));
    });
    tree.appendChild(makeTreeItem('boxes', 'boxes', true));
    boxes.forEach((b) => tree.appendChild(makeTreeItem(`box:${b.id}`, `box:${b.id}`, false, true)));
    tree.appendChild(makeTreeItem('labels', 'labels'));
    sidebar.appendChild(tree);
    lastTreeCount = boxes.length;
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
    addSection(sidebar, selectedKey, bc, baseFields, () => applyBoxConfig(rec, bc));
    boxWeightEl = document.createElement('div');
    boxWeightEl.className = 'check';
    boxWeightEl.textContent = `weight: ${rec.weight.toFixed(1)} kg`;
    sidebar.appendChild(boxWeightEl);
    return;
  }

  addSection(sidebar, selectedKey, config[selectedKey], fieldDefs[selectedKey], () => applyConfig());
}

function maybeRefreshTree() {
  if (!selectedKey && boxes.length !== lastTreeCount) rebuildSidebar();
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
  const hidden = [camHelper, cameraRig, footprint, selectionBox];
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

rebuildSidebar();
spawnBox();
boxes[0].mesh.position.y = 1.1;

function animate(now) {
  requestAnimationFrame(animate);
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
