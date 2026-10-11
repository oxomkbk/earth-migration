import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadPBR, applyTriplanar, addWindowLights } from './fx/triplanar.js';
import { createVolumetricPlumes } from './fx/volplume.js';
import { createSmoke } from './fx/smoke.js';
import { createShockwave } from './fx/shock.js';
import { createAtmosphere } from './fx/atmosphere.js';
import { loadModel, bakeModel, instanceModel, placeModel } from './fx/models.js';
import { installAerialPerspective, updateAerial, AERIAL_GLSL, HAZE } from './fx/aerial.js';
window.__emStarted = true;

/* =====================================================================
   Constants & quality profile
   Scale: Earth radius R = 100 scene units (1 unit ≈ 63.7 km). Engines and
   structures are exaggerated so they read from orbit.
   ===================================================================== */
const R = 100;
const KM_PER_UNIT = 6371 / R;
const TEX = 'assets/earth/';      // three.js example planet maps (NASA Blue/Black Marble derived), vendored
const TEX_HD = 'assets/earth/';
const TOUCH = matchMedia('(pointer: coarse)').matches;
const MOBILE = TOUCH || Math.min(innerWidth, innerHeight) < 700;
const Q = MOBILE
  ? { dpr: Math.min(devicePixelRatio, 1.5), msaa: 2, engines: 900, exhaust: 5000, ships: 110, stars: 6000, sats: 300, dust: 900, asteroids: 160, sky: 512, shadow: 1024, rays: 20, earthSeg: [128, 96], glowW: 2048, hd: false }
  : { dpr: Math.min(devicePixelRatio, 2), msaa: 4, engines: 2200, exhaust: 14000, ships: 240, stars: 12000, sats: 600, dust: 2400, asteroids: 340, sky: 1024, shadow: 2048, rays: 36, earthSeg: [256, 160], glowW: 4096, hd: true };
let fxHigh = !MOBILE;
if (TOUCH) document.body.classList.add('touch');

const SUN_DIR = new THREE.Vector3(-0.92, 0.2, 0.34).normalize();
const MIGRATION_DIR = new THREE.Vector3(0.55, 0.15, -0.82).normalize();

/* ---------- small utilities ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(2075);
const rr = (a, b) => a + (b - a) * rand();
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
           l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
function fbm3(x, y, z, oct = 5) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }

// Three.js SphereGeometry UV convention ↔ direction
function uvToDir(u, v, out = new THREE.Vector3()) {
  const phi = u * Math.PI * 2, theta = (1 - v) * Math.PI;
  return out.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}
const latLonToUV = (lat, lon) => [(lon + 180) / 360, (lat + 90) / 180];
function dirToLatLon(d) {
  const v = 1 - Math.acos(clamp(d.y, -1, 1)) / Math.PI;
  let phi = Math.atan2(d.z, -d.x); if (phi < 0) phi += Math.PI * 2;
  const u = phi / (Math.PI * 2);
  return [v * 180 - 90, u * 360 - 180];
}
const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

/* =====================================================================
   Renderer, scenes, cameras
   ===================================================================== */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Q.dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // (AgX lifts near-black too much for deep space)
const EXPOSURE = 1.0;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const haze = installAerialPerspective(scene);   // planet-aware aerial perspective on every lit material
const uAerial = { value: new THREE.Vector3() }, uAerialAmt = { value: 0 }, uBeta = { value: 0.035 };
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 3000);
camera.position.set(140, 90, 1150);
// The distant universe lives in its own scene, drawn first from a camera that only rotates:
// it stays pin-sharp at any zoom and never competes with the near scene for depth precision.
const skyScene = new THREE.Scene();
const skyCam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 10, 30000);

const pointScale = { value: 1 };
const pxRatio = { value: Q.dpr };
function updatePointScale() {
  pointScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  pxRatio.value = renderer.getPixelRatio();
}
updatePointScale();

const uTime = { value: 0 };
const uPower = { value: 0.95 };
const uSun = { value: SUN_DIR.clone() };
// world state animated by the viewing mode (explore mode keeps the defaults: everything ignited, temperate Earth)
const uIgnite = { value: 10 }, uHero = { value: new THREE.Vector3(0, 1, 0) }, uFreeze = { value: 0 }, uLight = { value: 1 }, sunBoost = { value: 1 };

/* ---------- shared materials ---------- */
function canvasTex(w, h, draw, srgb = true, repeat = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8; return t;
}
const hullTex = canvasTex(512, 512, (x, w, h) => {
  x.fillStyle = '#cdd2d9'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) { const g = 168 + rand() * 62 | 0; x.fillStyle = `rgb(${g},${g + 4},${g + 9})`; x.fillRect(rand() * w, rand() * h, 16 + rand() * 90, 10 + rand() * 60); }
  x.strokeStyle = 'rgba(30,34,40,.55)'; x.lineWidth = 1;
  for (let i = 0; i <= 16; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 32); x.lineTo(w, i * 32); x.stroke(); }
}, true, 2);
const roughTex = canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#777'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { const g = 80 + rand() * 120 | 0; x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(rand() * w, rand() * h, 4 + rand() * 40, 4 + rand() * 30); }
}, false, 3);
const panelTex = canvasTex(256, 256, (x, w, h) => {
  x.fillStyle = '#0a1a3a'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const g = 22 + rand() * 18 | 0; x.fillStyle = `rgb(${g * 0.4 | 0},${g * 0.8 | 0},${g * 2})`; x.fillRect(i * 32 + 2, j * 32 + 2, 28, 28); }
  x.strokeStyle = '#8fa3b8'; x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2);
}, true, 1);
// Height field → tangent-space normal map: recessed panel seams on the same 32px grid as hullTex, plus raised plates.
const hullNormal = (() => {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true }), r2 = mulberry32(99);
  x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) { const v = 100 + r2() * 110 | 0; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(r2() * S, r2() * S, 6 + r2() * 58, 5 + r2() * 38); }
  x.fillStyle = '#2a2a2a';
  for (let i = 0; i <= 16; i++) { x.fillRect(i * 32 - 1, 0, 2, S); x.fillRect(0, i * 32 - 1, S, 2); }
  for (let i = 0; i < 900; i++) { x.fillRect(r2() * S, r2() * S, 1.5, 1.5); }             // rivets / vents
  const h = x.getImageData(0, 0, S, S).data, out = x.createImageData(S, S), o = out.data, k = 2.2 / 255;
  const H = (px, py) => h[(((py + S) % S) * S + ((px + S) % S)) * 4];
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const nx = -(H(px + 1, py) - H(px - 1, py)) * k, ny = (H(px, py + 1) - H(px, py - 1)) * k, l = Math.hypot(nx, ny, 1), i = (py * S + px) * 4;
    o[i] = (nx / l * 0.5 + 0.5) * 255; o[i + 1] = (ny / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 8; return t;
})();
const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r, g, b), toneMapped: false });
const MODELS = {};   // NASA 3D Resources (public domain), filled by loadModels()
async function loadModels() {
  const [launcher, iss, hubble] = await Promise.all(['launcher', 'iss', 'hubble'].map(n => loadModel(`assets/models/${n}.glb`)));
  if (launcher) MODELS.gantry = bakeModel(launcher, 1);
  if (iss) MODELS.iss = bakeModel(iss, 1, { byHeight: false });
  if (hubble) MODELS.hubble = bakeModel(hubble, 1, { byHeight: false });
}
let GROUND_DETAIL = null;
const PBR = {};   // scanned texture sets (Poly Haven, CC0), filled by loadMaterials()
async function loadMaterials() {
  const names = ['metal_plate_02', 'painted_metal_shutter', 'gray_rocks', 'blue_metal_plate'];
  const [sets, det] = await Promise.all([Promise.all(names.map(n => loadPBR('assets/textures', n))),
    new Promise(res => texLoader.load('assets/textures/aerial_ground_rock_diff_1k.jpg', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null)))]);
  if (!det) { const g = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); g.needsUpdate = true; GROUND_DETAIL = g; } else GROUND_DETAIL = det;   // neutral grey if missing
  names.forEach((n, i) => { PBR[n] = sets[i]; });
  const strip = m => { m.map = m.roughnessMap = m.normalMap = null; return m; };
  if (PBR.metal_plate_02) applyTriplanar(strip(MAT.hull), PBR.metal_plate_02, { scale: 0.32, key: 'hull', roughMul: 0.9, metalMul: 0.9 });
  if (PBR.painted_metal_shutter) applyTriplanar(strip(MAT.dark), PBR.painted_metal_shutter, { scale: 0.45, key: 'dark' });
  if (PBR.blue_metal_plate) applyTriplanar(MAT.white, PBR.blue_metal_plate, { scale: 0.8, key: 'radiator', metalMul: 0.5 });   // radiator panels
  if (PBR.gray_rocks) applyTriplanar(MAT.rock, PBR.gray_rocks, { scale: 1.4, key: 'rock', normalScale: 1.4 });
  else MAT.rock.onBeforeCompile = rockBumpShader;
}
const MAT = {
  hull: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, map: hullTex, roughnessMap: roughTex, normalMap: hullNormal, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.4, roughness: 0.5, envMapIntensity: 1.0 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x7d8692, map: hullTex, roughnessMap: roughTex, normalMap: hullNormal, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.35, roughness: 0.6, envMapIntensity: 0.8 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xe0b35e, metalness: 0.55, roughness: 0.38, envMapIntensity: 1.4, emissive: 0x1a1004, emissiveIntensity: 1 }), // MLI thermal blanket
  panel: new THREE.MeshStandardMaterial({ color: 0xffffff, map: panelTex, metalness: 0.3, roughness: 0.38, emissive: 0x06122a, emissiveIntensity: 0.8, envMapIntensity: 1.3 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x6a645e, roughness: 0.96, metalness: 0.02, envMapIntensity: 0.3 }), // carbonaceous: dark, per-instance tint, procedural relief (see buildMining)
  cyan: glow(0.55, 1.4, 2.8),
  warm: glow(2.6, 1.6, 0.75),
  white: new THREE.MeshStandardMaterial({ color: 0x9aa6b4, metalness: 0.2, roughness: 0.6 }), // radiators
  red: glow(3.0, 0.25, 0.2),
};

/* ---------- geometry helpers ---------- */
function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.setScalar(s);
  m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
function cleanGeo(g) {
  g = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  return g;
}
// Merge every plain mesh inside `group` into one mesh per material (fewer draw calls, same look).
function bake(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const buckets = new Map();
  group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const g = cleanGeo(o.geometry); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []); buckets.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, list] of buckets) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = m.receiveShadow = !mat.isMeshBasicMaterial; out.add(m); }
  return out;
}
function lathe(points, seg = 40) { return new THREE.LatheGeometry(points.map(p => new THREE.Vector2(p[0], p[1])), seg); }

/* ---------- GPU point helpers ---------- */
// NOTE: GLSL leaves smoothstep(e0, e1, x) undefined when e0 >= e1 — on Metal / many mobile GPUs it
// returns NaN, which turns every point sprite into a flickering black square. Falloffs below use
// exp() or 1.0 - smoothstep(lo, hi, x) only.
const pointVert = /* glsl */`
  attribute float aSize; attribute float aSeed; attribute vec3 aColor;
  uniform float uScale; uniform float uTime; uniform float uBlink;
  varying vec3 vColor; varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.001), 1.5, 48.0);
    float b = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
    vA = mix(1.0, step(0.15, b) * b, uBlink);
    vColor = aColor;
  }`;
const pointFrag = /* glsl */`
  varying vec3 vColor; varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.75, 1.0, d));
    gl_FragColor = vec4(vColor * a * vA, 1.0);
  }`;
function lightDots(positions, color, size = 0.35, blink = 0) {
  const n = positions.length, pos = new Float32Array(n * 3), sz = new Float32Array(n), sd = new Float32Array(n), col = new Float32Array(n * 3);
  positions.forEach((p, i) => { pos.set([p.x, p.y, p.z], i * 3); sz[i] = size * (0.7 + rand() * 0.6); sd[i] = rand(); col.set([color.r, color.g, color.b], i * 3); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({ vertexShader: pointVert, fragmentShader: pointFrag, uniforms: { uScale: pointScale, uTime, uBlink: { value: blink } }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const p = new THREE.Points(g, m); p.frustumCulled = false; return p;
}

/* =====================================================================
   Loading: 4K Earth maps (three.js repo, r170) on desktop, 2K maps (r160)
   on mobile / as fallback, and a procedural planet if both are unreachable.
   Surface data is packed like the r170 map: R relief · G land · B clouds.
   ===================================================================== */
const ldFill = document.getElementById('ld-fill'), ldStatus = document.getElementById('ld-status');
let ldProgress = 0;
function step(p, msg) { ldProgress = Math.max(ldProgress, p); ldFill.style.width = (ldProgress * 100).toFixed(0) + '%'; if (msg) ldStatus.textContent = msg; }
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const texLoader = new THREE.TextureLoader();
let texDone = 0;
function loadTex(url, srgb) {
  const name = url.split('/').pop();
  const p = new Promise(res => texLoader.load(url, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); res(t); }, undefined, () => res(null)));
  return Promise.race([p, new Promise(r => setTimeout(() => r(null), 25000))]).then(t => { texDone++; step(Math.min(0.48, 0.06 + texDone * 0.09), `RECEIVING ORBITAL SURVEY · ${name.toUpperCase()}`); return t; });
}
function blackTex() { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; }
function imageSampler(img, w = 1024, h = 512) {
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    return (u, v, ch = 0) => { const px = clamp(Math.floor(u * w), 0, w - 1), py = clamp(Math.floor((1 - v) * h), 0, h - 1); return d[(py * w + px) * 4 + ch] / 255; };
  } catch (e) { return null; }
}
const proceduralLand = (dir) => fbm3(dir.x * 1.7 + 3.1, dir.y * 1.7 + 1.7, dir.z * 1.7 + 5.2) - 0.53;
// r160 fallback maps → packed surface texture (G = land from the specular map, B = cloud cover)
function packSurf(specImg, cloudImg) {
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(specImg, 0, 0, W, H); const sp = x.getImageData(0, 0, W, H).data;
  x.clearRect(0, 0, W, H); x.drawImage(cloudImg, 0, 0, W, H); const cl = x.getImageData(0, 0, W, H).data;
  const out = x.createImageData(W, H), o = out.data;
  let aSum = 0; for (let i = 3; i < cl.length; i += 4 * 97) aSum += cl[i];
  const useAlpha = aSum / (cl.length / (4 * 97)) < 245;                 // clouds stored in alpha, or as brightness?
  for (let i = 0; i < o.length; i += 4) { o[i] = 0; o[i + 1] = 255 - sp[i]; o[i + 2] = useAlpha ? cl[i + 3] : cl[i]; o[i + 3] = 255; }
  x.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
}
function proceduralEarth() {
  const W = 1024, H = 512, v3 = new THREE.Vector3();
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const day = mk(), night = mk(), surf = mk();
  const cd = day.getContext('2d'), cn = night.getContext('2d'), cs = surf.getContext('2d');
  const id = cd.createImageData(W, H), inn = cn.createImageData(W, H), is = cs.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = 1 - (y + 0.5) / H; uvToDir(u, v, v3);
    const land = proceduralLand(v3), lat = Math.abs(v * 180 - 90), i = (y * W + x) * 4;
    const ice = smooth(62, 75, lat + land * 30);
    let r, g, b;
    if (land > 0) { const dry = smooth(0.0, 0.12, fbm3(v3.x * 6, v3.y * 6, v3.z * 6, 3) - 0.45 + (30 - Math.abs(lat - 25)) * 0.004); r = 60 + 90 * dry; g = 85 + 40 * dry; b = 45 + 20 * dry; }
    else { const dp = smooth(-0.15, 0, land); r = 8 + 20 * dp; g = 30 + 40 * dp; b = 70 + 50 * dp; }
    r = r + (235 - r) * ice; g = g + (240 - g) * ice; b = b + (245 - b) * ice;
    id.data.set([r, g, b, 255], i);
    const city = land > 0.02 && lat < 60 && hash3(x, y, 7) > 0.985 ? 255 : 0; inn.data.set([city, city * 0.8, city * 0.5, 255], i);
    const cv = smooth(0.48, 0.72, fbm3(v3.x * 3 + 9, v3.y * 6, v3.z * 3, 5));
    is.data.set([clamp(land * 600, 0, 255), land > 0 ? 255 : 0, cv * 255, 255], i);
  }
  cd.putImageData(id, 0, 0); cn.putImageData(inn, 0, 0); cs.putImageData(is, 0, 0);
  const t = (c, srgb) => { const tx = new THREE.CanvasTexture(c); if (srgb) tx.colorSpace = THREE.SRGBColorSpace; return tx; };
  return { day: t(day, true), night: t(night, true), surf: t(surf, false), land: (u, v) => proceduralLand(uvToDir(u, v, v3)) > 0.0 };
}

/* =====================================================================
   The distant universe (own scene, drawn first, rotates with the camera):
   Milky Way baked once into an HDR cube map, plus live pin-point stars,
   the Sun, a ringed gas giant and an ice world.
   ===================================================================== */
const GLSL_NOISE = /* glsl */`
  float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;
// Real sky: NASA SVS Deep Star Maps 2020 (public domain) — the Milky Way panorama plus ~42,000
// Hipparcos/Tycho stars with their true positions and colours (see tools/convert-sky.html).
const SKY = { milky: null, stars: null };
async function loadSky() {
  const [milky, stars] = await Promise.all([
    new Promise(res => texLoader.load('assets/sky/milkyway_4k.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; res(t); }, undefined, () => res(null))),
    fetch('assets/sky/stars.bin').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
  ]);
  SKY.milky = milky; SKY.stars = stars && new Float32Array(stars);
}
// equatorial (RA, Dec in degrees) → direction in the map's own frame
function mapDir(ra, dec) {
  const lon = (((0.5 - ra / 360) % 1) + 1) % 1 * Math.PI * 2, lat = THREE.MathUtils.degToRad(dec);
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}
function realSky(galN, galC) {
  // rotate the real sky so the galactic centre / pole land where the composition wants them
  const c = mapDir(266.405, -28.936), n0 = mapDir(192.859, 27.128), n = n0.addScaledVector(c, -n0.dot(c)).normalize();
  const tn = galN.clone().addScaledVector(galC, -galN.dot(galC)).normalize();
  const from = new THREE.Matrix4().makeBasis(c, n, new THREE.Vector3().crossVectors(c, n));
  const to = new THREE.Matrix4().makeBasis(galC, tn, new THREE.Vector3().crossVectors(galC, tn));
  const rot = to.multiply(from.transpose());
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(12000, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uMap: { value: SKY.milky }, uInv: { value: new THREE.Matrix3().setFromMatrix4(rot).transpose() }, uGain: { value: 0.055 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform mat3 uInv; uniform float uGain; varying vec3 vDir;
      void main(){
        vec3 d = uInv * normalize(vDir);
        vec2 uv = vec2(fract(atan(-d.z, d.x) / 6.2831853), asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
        vec3 c = textureLod(uMap, uv, 0.0).rgb;
        c = max(c - vec3(0.012, 0.012, 0.014), 0.0);                       // remove the map's scattered-light floor
        gl_FragColor = vec4(c * uGain, 1.0);
      }`
  }));
  sphere.frustumCulled = false; sphere.renderOrder = -2; skyScene.add(sphere);
  // stars as crisp points: brightness from measured flux, size grows gently for the brightest
  const S = SKY.stars, N = S.length / 6, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), mag = new Float32Array(N), v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    v.set(S[i * 6], S[i * 6 + 1], S[i * 6 + 2]).applyMatrix4(rot).multiplyScalar(11000); pos.set([v.x, v.y, v.z], i * 3);
    const r = S[i * 6 + 3], g = S[i * 6 + 4], b = S[i * 6 + 5], f = r + g + b;
    const k = 0.11 * Math.pow(f, 0.85) / f;                                                // mild compression of the brightest
    col.set([r * k, g * k, b * k], i * 3); mag[i] = Math.min(1, Math.log10(1 + f) / 1.8);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: { uPx: pxRatio }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    vertexShader: `attribute vec3 aColor; attribute float aMag; uniform float uPx; varying vec3 vC; varying float vK;
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float s = 1.7 + aMag * 4.5; gl_PointSize = s * uPx; vK = max(0.3 * s * s, 2.5); vC = aColor; }`,
    fragmentShader: `varying vec3 vC; varying float vK;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vC * exp(-d * d * vK) * (1.0 - smoothstep(0.6, 1.0, d)), 1.0); }`
  }));
  stars.frustumCulled = false; skyScene.add(stars);
}
// Offline fallback: procedural Milky Way baked into a cube map + synthetic stars
function proceduralSky(galN, galC) {
  const bake = new THREE.Scene();
  bake.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { uGal: { value: galN }, uCore: { value: galC } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uGal, uCore; varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float b = dot(d, uGal), c = dot(d, uCore);
        float bw = b + (fbm(d * 2.0 + 1.7) - 0.5) * 0.09;                  // ragged disc edge
        float disc = exp(-bw * bw * 38.0);
        float bulge = exp(-(1.0 - c) * 5.0) * exp(-b * b * 14.0);
        float n1 = fbm(d * 3.5), n2 = fbm(d * 11.0 + 4.0);
        float glow = disc * (0.4 + 0.6 * n1) * (0.7 + 0.3 * n2) + bulge * 1.6;
        float lane = smoothstep(0.45, 0.7, fbm(d * 7.0 + vec3(2.0, 7.0, 1.0))) * exp(-bw * bw * 140.0);
        float lane2 = smoothstep(0.5, 0.75, fbm(d * 16.0 + 3.0)) * disc;
        vec3 cool = vec3(0.55, 0.62, 0.85), warm = vec3(1.0, 0.8, 0.58);
        vec3 col = mix(cool, warm, clamp(bulge * 1.4 + (c * 0.5 + 0.5) * 0.25, 0.0, 1.0)) * glow * 0.032;
        col *= 1.0 - 0.8 * lane - 0.35 * lane2;                            // dust lanes
        col += cool * pow(fbm(d * 60.0), 5.0) * disc * 0.12;               // unresolved star haze
        col += vec3(0.6, 0.14, 0.2) * smoothstep(0.58, 0.82, fbm(d * 5.0 + 11.0)) * disc * 0.028 * (1.0 - lane);
        col += vec3(0.15, 0.4, 0.5) * smoothstep(0.62, 0.86, fbm(d * 4.0 + 3.0)) * disc * 0.012;
        col += vec3(0.0015, 0.0019, 0.003);
        gl_FragColor = vec4(col, 1.0);
      }`
  })));
  const rt = new THREE.WebGLCubeRenderTarget(Q.sky, { type: THREE.HalfFloatType, generateMipmaps: false });
  new THREE.CubeCamera(1, 1000, rt).update(renderer, bake);
  bake.children[0].geometry.dispose(); bake.children[0].material.dispose();
  skyScene.background = rt.texture;

  // --- stars: real colour temperatures, power-law brightness, fixed pixel size (crisp at any zoom) ---
  const n = Q.stars, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n);
  const temps = [[0.62, 0.74, 1.0], [0.8, 0.87, 1.0], [1, 1, 1], [1, 0.93, 0.8], [1, 0.8, 0.58], [1, 0.64, 0.42]];
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set(gauss(), gauss(), gauss()).normalize();
    if (rand() < 0.5) v.addScaledVector(galN, -v.dot(galN) * (0.8 + rand() * 0.2)).normalize();
    v.multiplyScalar(10000); pos.set([v.x, v.y, v.z], i * 3);
    const m = Math.pow(rand(), 9); mag[i] = m;
    const k = rand(), t = temps[k < 0.1 ? 0 : k < 0.3 ? 1 : k < 0.6 ? 2 : k < 0.8 ? 3 : k < 0.94 ? 4 : 5];
    const I = 0.05 + rand() * 0.07 + m * 2.6;
    col.set([t[0] * I, t[1] * I, t[2] * I], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: { uPx: pxRatio }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    vertexShader: `attribute vec3 aColor; attribute float aMag; uniform float uPx; varying vec3 vC; varying float vK; varying float vHalo;
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float s = 1.6 + aMag * 9.0; gl_PointSize = s * uPx; vK = max(0.3 * s * s, 2.5); vHalo = aMag; vC = aColor; }`,
    fragmentShader: `varying vec3 vC; varying float vK; varying float vHalo;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0;
        float i = exp(-d * d * vK) + vHalo * 0.05 * exp(-d * d * 3.0);
        gl_FragColor = vec4(vC * i * (1.0 - smoothstep(0.6, 1.0, d)), 1.0); }`
  }));
  stars.frustumCulled = false; skyScene.add(stars);

}
let sunMesh, centauri, skyGiant = [];
function buildSky() {
  const galN = new THREE.Vector3(0.25, 0.92, -0.3).normalize();
  const galC = new THREE.Vector3(0.3, -0.15, -1).addScaledVector(galN, -new THREE.Vector3(0.3, -0.15, -1).dot(galN)).normalize(); // galactic centre: behind Earth in the opening shot
  if (SKY.milky && SKY.stars) realSky(galN, galC); else proceduralSky(galN, galC);

  // --- the Sun: limb-darkened HDR disc + corona; bloom and the lens pass do the rest ---
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.ShaderMaterial({
    uniforms: { uTime, uBoost: sunBoost }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uBoost; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
        const float rd = 0.028;
        float x = clamp(r / rd, 0.0, 1.0), mu = sqrt(1.0 - x * x);
        float disk = 1.0 - smoothstep(0.96, 1.0, r / rd);
        vec2 q = p / rd;
        float gran = vnoise(vec3(q * 9.0, uTime * 0.25)) * 0.6 + vnoise(vec3(q * 24.0, uTime * 0.45)) * 0.4;   // convection cells
        float spots = smoothstep(0.8, 0.86, vnoise(vec3(q * 4.5 + 7.0, uTime * 0.015))) * (0.6 + 0.4 * vnoise(vec3(q * 14.0, 1.0)));
        vec3 photo = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.9, 0.74), mu) * (0.5 + 0.5 * mu) * (0.78 + 0.4 * gran) * (1.0 - 0.8 * spots);
        vec3 col = photo * disk * 40.0 * uBoost;
        float a = atan(p.y, p.x + 1e-6);
        float stream = 0.55 + 0.9 * vnoise(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 0.05));
        float h = max(r - rd, 0.0);
        float loops = smoothstep(0.72, 0.92, vnoise(vec3(cos(a) * 14.0, sin(a) * 14.0, uTime * 0.08)));                  // a few active regions
        float strand = smoothstep(0.45, 0.8, vnoise(vec3(cos(a) * 60.0, sin(a) * 60.0, h * 220.0 - uTime * 0.3)));        // thin plasma strands
        float prom = loops * strand * exp(-h * 260.0) * step(rd * 0.99, r);
        float chromo = exp(-abs(r - rd) * 900.0);
        col += vec3(1.0, 0.86, 0.68) * (exp(-r * 30.0) * 2.2 * stream + exp(-r * 8.0) * 0.22 + exp(-r * 2.5) * 0.03) * sqrt(uBoost);
        col += vec3(1.0, 0.3, 0.12) * (prom * 9.0 + chromo * 1.4) * sqrt(uBoost);
        gl_FragColor = vec4(col * (1.0 - smoothstep(0.75, 1.0, r)), 1.0);
      }`
  }));
  sun.position.copy(SUN_DIR).multiplyScalar(9000); sun.lookAt(0, 0, 0); skyScene.add(sun); sunMesh = sun;
  // Alpha / Proxima Centauri: the destination, revealed at the end of the journey
  centauri = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.ShaderMaterial({
    uniforms: { uStar: { value: 0 }, uTime }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uStar, uTime; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
        vec2 o = vec2(0.016, 0.006), d1 = p - o, d2 = p + o;
        float stars = exp(-dot(d1, d1) * 5000.0) + exp(-dot(d2, d2) * 8000.0) * 0.55;
        float spikes = (exp(-abs(p.x) * 300.0) + exp(-abs(p.y) * 300.0)) * exp(-r * 5.0) * 0.5;
        float halo = exp(-r * 22.0) * 0.18 + exp(-r * 5.0) * 0.015;
        vec3 col = vec3(1.0, 0.94, 0.82) * stars * 40.0 + vec3(0.85, 0.92, 1.0) * (spikes + halo) * (0.92 + 0.08 * sin(uTime * 3.0));
        gl_FragColor = vec4(col * (1.0 - smoothstep(0.7, 1.0, r)) * uStar, 1.0);
      }`
  }));
  centauri.position.copy(MIGRATION_DIR).multiplyScalar(9200); centauri.lookAt(0, 0, 0); centauri.visible = false; skyScene.add(centauri);

  // --- gas giant with rings ---
  const giantDir = new THREE.Vector3(0.62, -0.1, -0.78).normalize();
  const giant = new THREE.Mesh(new THREE.SphereGeometry(520, 96, 64), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; varying vec3 vN; varying vec3 vP; varying vec3 vW;
      ${GLSL_NOISE}
      void main(){
        vec3 q = normalize(vP); float lat = q.y;
        float turb = fbm(vec3(q.x * 3.0, lat * 18.0, q.z * 3.0)) - 0.5;
        float w = sin(lat * 34.0 + turb * 2.2) * 0.5 + 0.5;
        float w2 = sin(lat * 95.0 + turb * 4.0) * 0.5 + 0.5;
        vec3 col = mix(mix(vec3(0.78, 0.66, 0.5), vec3(0.55, 0.38, 0.27), w), vec3(0.92, 0.88, 0.8), w2 * 0.3);
        float spot = 1.0 - smoothstep(0.0, 0.12, length(vec2(q.x - 0.35, (lat + 0.32) * 1.8)));
        col = mix(col, vec3(0.72, 0.34, 0.22), spot * 0.8);
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        float d = max(dot(N, uSun), 0.0);
        float term = smoothstep(0.0, 0.25, d);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        gl_FragColor = vec4(col * d * 1.1 * mix(vec3(1.0, 0.75, 0.55), vec3(1.0), term) + vec3(1.0, 0.75, 0.5) * rim * d * 0.25 + col * 0.004, 1.0);
      }`
  }));
  giant.position.copy(giantDir).multiplyScalar(7200); giant.rotation.set(0.35, 0.2, 0.28); skyScene.add(giant);
  const ring = new THREE.Mesh(new THREE.RingGeometry(700, 1150, 160, 1), new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vP;
      void main(){ float r = (length(vP) - 700.0) / 450.0;
        float bands = 0.5 + 0.5 * sin(r * 90.0) * sin(r * 23.0 + 1.0);
        float gap = 1.0 - smoothstep(0.42, 0.46, r) * (1.0 - smoothstep(0.48, 0.52, r));
        float a = smoothstep(0.0, 0.05, r) * (1.0 - smoothstep(0.85, 1.0, r)) * (0.25 + 0.6 * bands) * gap;
        gl_FragColor = vec4(vec3(0.85, 0.75, 0.6) * 0.6, a * 0.7); }`
  }));
  ring.position.copy(giant.position); ring.rotation.set(Math.PI / 2 - 0.35, 0.2, 0.28); skyScene.add(ring); skyGiant.push(giant, ring);
  const ice = new THREE.Mesh(new THREE.SphereGeometry(140, 48, 32), new THREE.MeshStandardMaterial({ color: 0x9cc8e8, roughness: 0.6 }));
  ice.position.set(-0.72, 0.36, -0.6).normalize().multiplyScalar(6600); skyScene.add(ice);
  const sl = new THREE.DirectionalLight(0xfff0dd, 2.2); sl.position.copy(SUN_DIR); skyScene.add(sl);
  skyScene.add(new THREE.AmbientLight(0x223344, 0.03));
}

/* ---------- HDR environment for PBR reflections ---------- */
function buildEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float s = max(dot(d, uSun), 0.0);
        vec3 col = vec3(0.004, 0.006, 0.012);
        col += vec3(1.0, 0.92, 0.8) * pow(s, 600.0) * 4.0 + vec3(1.0, 0.82, 0.6) * pow(s, 10.0) * 0.35;   // direct light already draws the sun's highlight
        col += vec3(0.2, 0.3, 0.55) * pow(clamp(-d.y * 0.5 + 0.5, 0.0, 1.0), 3.0) * 0.35;
        col += vec3(0.4, 0.42, 0.5) * pow(1.0 - abs(d.y), 8.0) * 0.06;
        gl_FragColor = vec4(col, 1.0); }`
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(env, 0, 0.1, 100).texture; pm.dispose(); return t;
}

/* =====================================================================
   Earth: surface (relief, ocean glint, terminator, night grid), clouds,
   atmosphere
   ===================================================================== */
const earthTilt = new THREE.Group(); earthTilt.rotation.z = THREE.MathUtils.degToRad(23.4); scene.add(earthTilt);
const earthSpin = new THREE.Group(); earthSpin.rotation.y = -1.55; earthTilt.add(earthSpin);
let earthMesh, cloudMesh, atmoMesh;
const cloudShift = { value: 0 };
let landAt = null;

function buildEarth(T) {
  const geo = new THREE.SphereGeometry(R, Q.earthSeg[0], Q.earthSeg[1]);
  const vert = /* glsl */`
    varying vec2 vUv; varying vec3 vNw; varying vec3 vTw; varying vec3 vPw; varying vec3 vL;
    void main(){
      vUv = uv; vL = normalize(position);
      vec3 n = normalize(normal);
      vec3 t = cross(vec3(0.0, 1.0, 0.0), n); t = length(t) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(t);
      vNw = normalize(mat3(modelMatrix) * n); vTw = normalize(mat3(modelMatrix) * t);
      vec4 wp = modelMatrix * vec4(position, 1.0); vPw = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const uniforms = {
    uDay: { value: T.day }, uNight: { value: T.night }, uSurf: { value: T.surf }, uGlow: { value: T.glow },
    uTexel: { value: new THREE.Vector2(1 / T.surf.image.width, 1 / T.surf.image.height) },
    uDetail: { value: GROUND_DETAIL },
    uSun, uCloudShift: cloudShift, uPower, uTime, uIgnite, uHero, uFreeze, uLight, uAerial, uAerialAmt, uBeta,
    uSteerIg: uSteer, uSteerHero: { value: steerers[0].dir.clone() }, uElevL: { value: elevatorDir.clone() },
  };
  earthMesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: vert,
    fragmentShader: /* glsl */`
      uniform sampler2D uDay, uNight, uSurf, uGlow;
      uniform vec2 uTexel; uniform sampler2D uDetail; uniform vec3 uSun, uHero, uAerial, uSteerHero, uElevL; uniform float uSteerIg; uniform float uCloudShift, uPower, uTime, uIgnite, uFreeze, uLight, uAerialAmt, uBeta;
      ${AERIAL_GLSL}
      varying vec2 vUv; varying vec3 vNw; varying vec3 vTw; varying vec3 vPw; varying vec3 vL;
      ${GLSL_NOISE}
      void main(){
        vec3 N0 = normalize(vNw);
        vec3 Tg = vTw - N0 * dot(vTw, N0); Tg = dot(Tg, Tg) > 1e-8 ? normalize(Tg) : vec3(1.0, 0.0, 0.0);
        vec3 Bt = cross(N0, Tg);
        vec4 surf = texture2D(uSurf, vUv);
        float land = smoothstep(0.08, 0.3, surf.g), ocean = 1.0 - land;
        // relief from the height channel
        float hx = texture2D(uSurf, vUv + vec2(uTexel.x, 0.0)).r, hy = texture2D(uSurf, vUv + vec2(0.0, uTexel.y)).r;
        vec3 N = normalize(N0 - (Tg * (hx - surf.r) + Bt * (hy - surf.r)) * 4.0 * land);
        vec3 L = normalize(uSun), V = normalize(cameraPosition - vPw);
        float ndl0 = dot(N0, L), ndl = max(dot(N, L), 0.0);
        vec3 albedo = texture2D(uDay, vUv).rgb;
        albedo = mix(albedo, albedo * vec3(0.5, 0.72, 1.0), ocean * 0.45);           // deeper oceans
        float camDist = length(cameraPosition - vPw);
        float closeF = 1.0 - smoothstep(14.0, 90.0, camDist);                            // close-range ground detail
        if (closeF > 0.001) {                                                            // scanned aerial rock at close range (triplanar on the sphere)
          vec3 w = pow(abs(vL), vec3(6.0)); w /= w.x + w.y + w.z; vec3 q = vL * 260.0, q2 = vL * 1300.0;
          vec3 d1 = texture2D(uDetail, q.zy).rgb * w.x + texture2D(uDetail, q.xz).rgb * w.y + texture2D(uDetail, q.xy).rgb * w.z;
          vec3 d2 = texture2D(uDetail, q2.zy).rgb * w.x + texture2D(uDetail, q2.xz).rgb * w.y + texture2D(uDetail, q2.xy).rgb * w.z;
          vec3 det = d1 * 0.6 + d2 * 0.4;
          albedo = mix(albedo, albedo * det / max(dot(det, vec3(0.333)), 0.05) * (0.55 + 0.9 * dot(det, vec3(0.333))), closeF * land * 0.85);
        }
        // the long night: oceans and continents freeze over
        float fz = clamp(uFreeze * (0.8 + 0.4 * vnoise(vL * 30.0)) - ocean * 0.08 * (1.0 - uFreeze), 0.0, 1.0);
        albedo = mix(albedo, mix(vec3(0.7, 0.78, 0.88), vec3(0.9, 0.94, 0.98), vnoise(vL * 160.0)), fz);
        ocean *= 1.0 - fz;
        float cs = texture2D(uSurf, vUv + vec2(uCloudShift, 0.0)).b;
        cs = smoothstep(0.1, 0.9, cs) * (1.0 - 0.7 * uFreeze);
        // sunlight reddens towards the terminator (long path through the atmosphere)
        vec3 sunCol = mix(vec3(1.0, 0.42, 0.18), vec3(1.0, 0.96, 0.9), smoothstep(-0.02, 0.32, ndl0)) * 2.0 * uLight;
        vec3 col = albedo * sunCol * ndl * (1.0 - 0.55 * cs);
        // ocean sun glint
        vec3 H = normalize(L + V);
        float nh = max(dot(N0, H), 0.0);
        float fr = 0.02 + 0.98 * pow(1.0 - max(dot(N0, V), 0.0), 5.0);
        float Fv = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
        col += sunCol * (pow(nh, 320.0) * 9.0 + pow(nh, 45.0) * 0.5) * Fv * ocean * (1.0 - cs) * smoothstep(0.0, 0.1, ndl0);
        // night side: dimmed cities (humanity moved underground) + the planetary-engine grid
        float nightMask = 1.0 - smoothstep(-0.15, 0.06, ndl0);
        col += texture2D(uNight, vUv).rgb * vec3(1.0, 0.66, 0.36) * 0.28 * nightMask * (1.0 - 0.6 * cs) * (1.0 - 0.85 * uFreeze);
        float flick = 0.92 + 0.08 * sin(uTime * 2.3 + vUv.x * 50.0 + vUv.y * 21.0);
        // ignition wave: engines light up in a ring spreading from Engine Array 017
        float ang = acos(clamp(dot(vL, uHero), -1.0, 1.0));
        float ign = 1.0 - smoothstep(uIgnite - min(0.14, 0.5 * uIgnite), uIgnite, ang);   // engines spool up behind the front
        col += texture2D(uGlow, vUv).rgb * uPower * flick * (0.08 + 3.0 * nightMask) * (1.0 + 0.5 * closeF) * ign;   // light pools around the engines
        float sk = (ang - uIgnite) / 0.022;
        col += vec3(0.45, 0.75, 1.6) * exp(-sk * sk) * step(uIgnite, 3.3) * step(0.005, uIgnite) * (0.35 + 1.8 * nightMask) * (0.35 + 0.65 * land);
        // the steering belt lights the ground around each tower — strongest on the east side, under the slanted jet
        if (abs(vL.y) < 0.2) {
          float phi = atan(vL.z, -vL.x); phi += phi < 0.0 ? 6.2831853 : 0.0;
          float cell = 6.2831853 / 72.0, lat = asin(clamp(vL.y, -1.0, 1.0)) * 100.0, k0 = floor(phi / cell);
          vec3 pool = vec3(0.0);
          for (int j = -1; j <= 1; j++) {
            float pc = (k0 + float(j) + 0.5) * cell; vec3 cd = vec3(-cos(pc), 0.0, sin(pc));
            float on = step(dot(cd, uElevL), 0.9613) * (1.0 - smoothstep(uSteerIg - 0.05, uSteerIg, acos(clamp(dot(cd, uSteerHero), -1.0, 1.0))));
            vec2 o = vec2((phi - pc) * 100.0 - 2.5, lat);
            float r2 = dot(o, o);
            pool += on * (vec3(0.55, 0.8, 1.6) * exp(-r2 / 14.0) * 1.3 + vec3(0.25, 0.45, 1.0) * exp(-r2 / 80.0) * 0.18);
          }
          col += albedo * pool * flick * (0.4 + 0.6 * smoothstep(0.3, -0.1, ndl0));
        }
        // aerial perspective towards the limb
        float mu = max(dot(N0, V), 0.0);
        float rim = pow(1.0 - mu, 4.5);
        float litA = smoothstep(-0.2, 0.4, ndl0);
        vec3 rayleigh = vec3(0.16, 0.4, 1.0);
        vec3 dusk = vec3(1.0, 0.38, 0.12) * smoothstep(-0.2, 0.04, ndl0) * (1.0 - smoothstep(0.04, 0.3, ndl0));
        col = mix(col, (rayleigh * 1.1 * litA + dusk * 0.45) * uLight, rim * 0.12 * smoothstep(-0.3, 0.1, ndl0));
        col += vec3(0.05, 0.18, 0.6) * uPower * rim * nightMask * 0.12 * smoothstep(0.5, 3.0, uIgnite);
        if (uAerialAmt > 0.001) col = mix(col, aerialPerspective(col, vPw, cameraPosition, uAerial, uBeta, ${HAZE.R.toFixed(1)}, ${HAZE.H.toFixed(2)}, ${HAZE.night.toFixed(2)}), uAerialAmt);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  earthMesh.castShadow = true;
  earthMesh.name = 'Earth';
  earthSpin.add(earthMesh);

  cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.008, Q.earthSeg[0], Q.earthSeg[1]), new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uGlowShift: { value: 0 } }, vertexShader: vert, transparent: true, depthWrite: false,
    fragmentShader: /* glsl */`
      uniform sampler2D uSurf, uGlow; uniform vec3 uSun, uHero; uniform float uPower, uGlowShift, uIgnite, uFreeze, uLight;
      varying vec2 vUv; varying vec3 vNw; varying vec3 vTw; varying vec3 vPw; varying vec3 vL;
      void main(){
        float d = smoothstep(0.08, 0.9, texture2D(uSurf, vUv).b) * (1.0 - 0.7 * uFreeze);
        vec3 N = normalize(vNw), L = normalize(uSun), V = normalize(cameraPosition - vPw);
        float ndl = dot(N, L);
        float lit = smoothstep(-0.12, 0.3, ndl);
        vec3 sunCol = mix(vec3(1.0, 0.45, 0.22), vec3(1.0, 0.97, 0.93), smoothstep(-0.02, 0.32, ndl));
        vec3 col = sunCol * lit * 1.3 * uLight + vec3(0.003, 0.005, 0.01);
        float ign = 1.0 - smoothstep(uIgnite - min(0.14, 0.5 * uIgnite), uIgnite, acos(clamp(dot(vL, uHero), -1.0, 1.0)));
        col += texture2D(uGlow, vUv + vec2(uGlowShift, 0.0)).rgb * uPower * 1.5 * (1.0 - lit) * ign;   // engine light under the deck
        float mu = max(dot(N, V), 0.0);
        gl_FragColor = vec4(col, d * mix(0.3, 0.92, smoothstep(0.0, 0.3, mu)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  earthSpin.add(cloudMesh);

  atmoMesh = createAtmosphere({ R, thickness: 6, uSun, uLight, uPower, steps: MOBILE ? 10 : 16, lightSteps: MOBILE ? 4 : 6 });
  earthTilt.add(atmoMesh);
}

/* =====================================================================
   Planetary engine model — built procedurally, exported to GLB and
   loaded back through GLTFLoader (a real GLTF pipeline, no external file)
   ===================================================================== */
function buildEngineSource() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ name: 'metal', color: 0x8d949e, metalness: 0.9, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ name: 'dark', color: 0x2c3038, metalness: 0.8, roughness: 0.5 });
  const core = new THREE.MeshStandardMaterial({ name: 'core', color: 0x000000, emissive: 0x7fd0ff, emissiveIntensity: 6 });
  const m = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); };
  const box = (w, h, d, mat, x, y, z, ry = 0, rz = 0, parent = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.rotation.set(0, ry, rz); parent.add(o); return o; };
  // plinth with radial flame trenches
  m(new THREE.CylinderGeometry(0.74, 0.82, 0.06, 6), dark, 0, 0.03, 0);
  m(new THREE.CylinderGeometry(0.62, 0.69, 0.05, 6), metal, 0, 0.085, 0);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; box(0.42, 0.1, 0.07, dark, Math.cos(a) * 0.6, 0.12, Math.sin(a) * 0.6, -a); }
  // podium with lit control decks
  m(new THREE.CylinderGeometry(0.5, 0.56, 0.2, 8), dark, 0, 0.21, 0);
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; box(0.05, 0.028, 0.008, core, Math.cos(a) * 0.523, 0.24, Math.sin(a) * 0.523, -a + Math.PI / 2); }
  // tapered main tower, wrapped in ribs and gallery rings
  m(lathe([[0.43, 0.3], [0.37, 0.6], [0.32, 0.95], [0.305, 1.18], [0.33, 1.26]], 48), metal, 0, 0, 0);
  for (let i = 0; i < 16; i++) {
    const b = new THREE.Group(); b.rotation.y = i / 16 * Math.PI * 2; g.add(b);
    box(0.02, 0.96, 0.035, dark, 0.38, 0.77, 0, 0, 0.12, b);
  }
  for (const [y, r] of [[0.45, 0.41], [0.75, 0.358], [1.04, 0.325]]) {
    m(new THREE.TorusGeometry(r, 0.02, 6, 64), dark, 0, y, 0, Math.PI / 2);
    m(new THREE.TorusGeometry(r + 0.006, 0.006, 4, 64), core, 0, y + 0.032, 0, Math.PI / 2);      // lit gallery
  }
  // four buttress legs leaning into the tower
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group(); b.rotation.y = i / 4 * Math.PI * 2 + Math.PI / 4; g.add(b);
    box(0.09, 1.0, 0.13, dark, 0.56, 0.55, 0, 0, 0.3, b);
    box(0.16, 0.12, 0.2, dark, 0.7, 0.1, 0, 0, 0, b);
  }
  // nozzle collar, bell and white-hot throat
  m(new THREE.CylinderGeometry(0.36, 0.34, 0.08, 48), dark, 0, 1.28, 0);
  m(lathe([[0.2, 1.3], [0.24, 1.34], [0.31, 1.39], [0.38, 1.43], [0.43, 1.46]], 48), dark, 0, 0, 0);
  m(lathe([[0.15, 1.31], [0.18, 1.335], [0.21, 1.355]], 48), core, 0, 0, 0);   // small glowing throat deep inside the bell
  g.traverse(o => { if (o.isMesh) o.geometry.computeVertexNormals(); });
  return g;
}
function exportAndLoadGLB(object) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(object, (glb) => {
      new GLTFLoader().parse(glb, '', (gltf) => resolve({ gltf, bytes: glb.byteLength }), reject);
    }, reject, { binary: true });
  });
}
function engineGeometryFromGLTF(root) {
  root.updateMatrixWorld(true);
  const order = ['metal', 'dark', 'core'], buckets = { metal: [], dark: [], core: [] };
  root.traverse(o => { if (o.isMesh) { const g = cleanGeo(o.geometry); g.applyMatrix4(o.matrixWorld); (buckets[o.material.name] || buckets.metal).push(g); } });
  return mergeGeometries(order.map(k => mergeGeometries(buckets[k], false)), true);
}

/* =====================================================================
   Engine placement on continents
   ===================================================================== */
const engines = []; // { dir: Vector3 (earth-local), u, v, s, hero }
let heroDir, elevatorDir;
function placeEngines() {
  const [eu, ev] = latLonToUV(0, 22); elevatorDir = uvToDir(eu, ev);
  const near = (d, other, deg) => d.dot(other) > Math.cos(THREE.MathUtils.degToRad(deg));
  // hero array (a hex grid formation)
  let [hu, hv] = latLonToUV(36, 104);
  if (!landAt(hu, hv)) { for (let i = 0; i < 400; i++) { const u = rand(), v = rr(0.3, 0.75); if (landAt(u, v)) { hu = u; hv = v; break; } } }
  heroDir = uvToDir(hu, hv);
  const t1 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), heroDir).normalize(), t2 = new THREE.Vector3().crossVectors(heroDir, t1);
  const spacing = 1.9 / R;
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
    if (Math.abs(q + r) > 2) continue;
    const x = (q + r * 0.5) * spacing, y = r * 0.866 * spacing;
    const d = heroDir.clone().addScaledVector(t1, x).addScaledVector(t2, y).normalize();
    engines.push({ dir: d, s: q === 0 && r === 0 ? 1.9 : 1.45, hero: true });
  }
  // continental clusters
  const clusters = [];
  for (let i = 0; i < 6000 && clusters.length < 170; i++) {
    const z = rr(-0.92, 0.92), lat = Math.asin(z), u = rand(), v = lat / Math.PI + 0.5;
    if (!landAt(u, v)) continue;
    const d = uvToDir(u, v);
    if (near(d, heroDir, 5) || near(d, elevatorDir, 4)) continue;
    clusters.push({ u, v, d, w: 0.4 + rand() });
  }
  const total = Q.engines - engines.length;
  for (let i = 0, tries = 0; engines.length < Q.engines && tries < total * 12; tries++) {
    const c = clusters[(rand() * clusters.length) | 0]; if (!c) break;
    const lat = (c.v - 0.5) * Math.PI;
    const u = c.u + gauss() * 0.012 / Math.max(0.25, Math.cos(lat)), v = c.v + gauss() * 0.011;
    if (v < 0.06 || v > 0.94) continue;
    const uu = (u + 1) % 1;
    if (!landAt(uu, v)) continue;
    const d = uvToDir(uu, v);
    if (near(d, elevatorDir, 1.6)) continue;
    engines.push({ dir: d, s: rr(0.55, 1.05), hero: false }); i++;
  }
  for (const e of engines) { const ll = dirToLatLon(e.dir); [e.u, e.v] = latLonToUV(ll[0], ll[1]); }
}
// Night-side engine grid: a crisp hot core per engine with a faint scattered halo
function buildGlowTexture() {
  const W = Q.glowW, H = W / 2, k = W / 2048;
  return canvasTex(W, H, (x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'lighter';
    for (const e of [...engines, ...steerers]) {
      const lat = (e.v - 0.5) * Math.PI, sx = 1 / Math.max(0.12, Math.cos(lat));
      const rad = (e.steer ? 3.4 : e.hero ? 8 : 5) * e.s * k;
      for (const off of [0, -W, W]) {
        const cx = e.u * W + off, cy = (1 - e.v) * H; if (cx < -60 * k || cx > W + 60 * k) continue;
        x.save(); x.translate(cx, cy); x.scale(sx, 1);
        const gr = x.createRadialGradient(0, 0, 0, 0, 0, rad);
        gr.addColorStop(0, 'rgba(225,245,255,0.95)'); gr.addColorStop(0.18, 'rgba(120,195,255,0.55)');
        gr.addColorStop(0.45, 'rgba(50,120,255,0.14)'); gr.addColorStop(1, 'rgba(20,60,255,0)');
        x.fillStyle = gr; x.beginPath(); x.arc(0, 0, rad, 0, Math.PI * 2); x.fill(); x.restore();
      }
    }
  }, true, 1);
}

/* ---------- engine instances, plasma jets, exhaust particles ---------- */
const jetMat = new THREE.ShaderMaterial({
  uniforms: { uTime, uPower, uIntensity: { value: 1.35 }, uFar: { value: 0 }, uFlame: { value: 0 }, uIgnite, uHero, uSun },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute float aSeed;
    uniform float uTime, uPower, uIgnite, uFar; uniform vec3 uHero, uSun;
    varying vec2 vUv; varying float vSeed; varying vec3 vN; varying vec3 vV; varying float vDist; varying float vIgn; varying float vFace; varying float vDay;
    void main(){
      vUv = uv; vSeed = aSeed;
      vec3 p = position;
      float flick = 0.9 + 0.07 * sin(uTime * 7.0 + aSeed * 40.0) + 0.03 * sin(uTime * 23.0 + aSeed * 13.0);
      vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float ang = acos(clamp(dot(normalize(base), uHero), -1.0, 1.0));
      float ig = 1.0 - smoothstep(uIgnite - 0.05, uIgnite, ang);
      float fk = (ang - uIgnite + 0.035) / 0.03, flash = exp(-fk * fk) * step(uIgnite, 3.3);   // ignition overshoot
      vIgn = ig * (1.0 + flash * 1.5);
      float y = p.y;
      p.y *= flick * uPower * max(ig * (1.0 + flash * 0.5), 0.001) * mix(1.0, 0.5, uFar);   // from orbit: short glowing tails, not rain
      // billowing silhouette: the plume breathes and ripples as it climbs
      p.xz *= 1.0 + 0.13 * (0.6 * sin(uTime * 5.0 + aSeed * 20.0 + y * 9.0) + 0.4 * sin(uTime * 8.3 + aSeed * 7.0 + y * 21.0)) * smoothstep(0.0, 0.25, y);
      mat4 m = modelMatrix * instanceMatrix;
      vec4 wp = m * vec4(p, 1.0);
      vN = normalize(mat3(m) * normal); vV = normalize(cameraPosition - wp.xyz); vDist = length(cameraPosition - wp.xyz);
      vec3 site = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vFace = smoothstep(0.08, 0.4, dot(normalize(site), normalize(cameraPosition - site)));
      vDay = dot(uSun, uSun) > 0.25 ? smoothstep(-0.05, 0.35, dot(normalize(site), normalize(uSun))) : 0.0;   // in full sunlight the exhaust is drowned out   // edge-on at the limb: thin streaks alias into glitter
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uIntensity, uFar, uFlame;
    varying vec2 vUv; varying float vSeed; varying vec3 vN; varying vec3 vV; varying float vDist; varying float vIgn; varying float vFace; varying float vDay;
    ${GLSL_NOISE}
    void main(){
      float ndv = abs(dot(normalize(vN), normalize(vV)));
      float along = vUv.y, a = vUv.x * 6.2831853;                           // seamless around the plume
      float spd = mix(7.0, 16.0, uFlame), sc = mix(10.0, 4.0, uFlame);
      vec3 q = vec3(cos(a) * 1.6, sin(a) * 1.6, along * sc - uTime * spd + vSeed * 9.0);
      float turb = vnoise(q) * 0.55 + vnoise(q * 2.7 - vec3(0.0, 0.0, uTime * 4.0)) * 0.3 + vnoise(q * 6.1 - vec3(0.0, 0.0, uTime * 9.0)) * 0.15;
      // ragged, flame-tongue edges instead of a hard cylinder silhouette
      float edge = smoothstep(0.08, 0.62, ndv + (turb - 0.5) * 0.5);
      float core = pow(ndv, 5.0), body = pow(ndv, 2.0);
      float fade = exp(-along * mix(2.0, 4.5, uFlame)) * smoothstep(0.0, 0.07, along) * (1.0 - smoothstep(0.7, 1.0, along));
      float diamonds = pow(0.5 + 0.5 * sin(along * 55.0 - uTime * 20.0 + vSeed * 10.0), 10.0) * exp(-along * 9.0) * core * (1.0 - uFlame);
      float hot = exp(-along * mix(14.0, 6.0, uFlame)) * smoothstep(0.0, mix(0.01, 0.06, uFlame), along);                        // white-hot just above the throat
      vec3 col = mix(vec3(0.17, 0.18, 0.9), vec3(0.28, 0.6, 1.0), body);   // violet-blue sheath → electric blue
      col = mix(col, vec3(0.92, 0.97, 1.0), clamp(core * 1.3 * exp(-along * 4.0) + hot * 0.7, 0.0, 1.0));
      float i = (core * 2.3 + body * 0.5) * fade * edge * (0.45 + 0.95 * turb) + diamonds * 2.0 + hot * core * edge * 1.2 * smoothstep(0.0, 0.05, along);
      i *= mix(1.0, 1.5, uFlame);
      col = mix(col, vec3(0.22, 0.48, 1.0), uFar);                          // from orbit: a slim blue thread
      i *= smoothstep(0.6, 4.0, vDist) * vIgn * mix(1.0, vFace, uFar) * mix(1.0, 0.3, vDay);       // never a bar across the lens
      gl_FragColor = vec4(col * i * 2.1 * uIntensity * mix(1.0, 0.21, uFar), 1.0);
    }`
});
// Rocket-plume profile (unit length, unit nozzle radius): flares just above the throat, pinches at the
// first shock, then rises as a slowly widening column.
function plumeGeometry() {
  const pts = [];
  for (let j = 0; j <= 48; j++) {
    const y = Math.pow(j / 48, 1.6);
    const r = 0.85 + 0.8 * Math.pow(y, 0.8);
    pts.push(new THREE.Vector2(r, y));
  }
  return new THREE.LatheGeometry(pts, 28);
}
function jetGeometry() { const g = new THREE.CylinderGeometry(0.3, 0.09, 1, 20, 16, true); g.translate(0, 0.5, 0); return g; }

let engineMesh, jetMesh, exhaust, volHero, volSteer, gantries, smokeHero, smokeSteer;
const heroAge = { value: 1e4 }, steerAge = { value: 1e4 };
let shock, steerLight;
const VOL_STEPS = MOBILE ? 14 : 28;
function buildEngines(engineGeo) {
  const metal = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0x7c838c, metalness: 0.35, roughness: 0.55, envMapIntensity: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0x50565e, metalness: 0.3, roughness: 0.65, envMapIntensity: 0.6 });
  applyTriplanar(metal, PBR.painted_metal_shutter, { scale: 7, key: 'eng-metal', metalMul: 0.8 });
  if (PBR.painted_metal_shutter) addWindowLights(metal, { rows: 150, cols: 220, intensity: { value: 1.1 } });   // kilometre-scale towers need human-scale lights
  applyTriplanar(dark, PBR.metal_plate_02, { scale: 6, key: 'eng-dark', metalMul: 0.8 });
  const core = glow(0.18, 0.5, 1.15);
  engineMesh = new THREE.InstancedMesh(engineGeo, [metal, dark, core], engines.length);
  engineMesh.castShadow = engineMesh.receiveShadow = false; // tiny on the planet, and the planet receives no shadows
  const jg = plumeGeometry();
  const seeds = new Float32Array(engines.length);
  jetMesh = new THREE.InstancedMesh(jg, jetMat, engines.length);
  jetMesh.frustumCulled = false;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const n = Q.exhaust, ePos = new Float32Array(n * 3), eDir = new Float32Array(n * 3), eSeed = new Float32Array(n * 2), eKind = new Float32Array(n);
  engines.forEach((e, i) => {
    q.setFromUnitVectors(Y, e.dir); qy.setFromAxisAngle(Y, rand() * Math.PI * 2); q.multiply(qy);
    p.copy(e.dir).multiplyScalar(R - 0.03); s.setScalar(e.s);
    m.compose(p, q, s); engineMesh.setMatrixAt(i, m);
    e.nozzle = e.dir.clone().multiplyScalar(R - 0.03 + 1.44 * e.s);
    const len = (e.hero ? 13 : rr(5, 10)) * e.s, w = 0.36 * e.s;
    if (e.hero) { e.vol = { q: q.clone(), len, r: 0.8 * e.s }; s.set(0, 0, 0); } else s.set(w, len, w);
    m.compose(e.nozzle, q, s); jetMesh.setMatrixAt(i, m);
    seeds[i] = rand();
  });
  jg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  for (let i = 0; i < n; i++) {
    const e = engines[i % engines.length];
    rand(); const kind = 0; // no smoke puffs — they read as fuzzy balls
    const base = kind ? e.dir.clone().multiplyScalar(R + 0.2 * e.s) : e.nozzle;
    ePos.set([base.x, base.y, base.z], i * 3); eDir.set([e.dir.x, e.dir.y, e.dir.z], i * 3);
    eSeed.set([rand(), rand() * (e.hero ? 1.5 : 1) * e.s], i * 2); eKind[i] = kind;
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(ePos, 3)); eg.setAttribute('aDir', new THREE.BufferAttribute(eDir, 3));
  eg.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 2)); eg.setAttribute('aKind', new THREE.BufferAttribute(eKind, 1));
  exhaust = new THREE.Points(eg, new THREE.ShaderMaterial({
    uniforms: { uTime, uPower, uScale: pointScale, uIgnite, uHero }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aDir; attribute vec2 aSeed; attribute float aKind;
      uniform float uTime, uPower, uScale, uIgnite; uniform vec3 uHero;
      varying float vA; varying float vLife; varying float vKind;
      void main(){
        float speed = mix(0.35, 0.85, fract(aSeed.x * 7.13)) * (aKind > 0.5 ? 0.12 : 1.0);
        float life = fract(uTime * speed + aSeed.x);
        vec3 s1 = normalize(cross(aDir, vec3(0.31, 0.71, 0.63)) + vec3(1e-4));
        vec3 s2 = cross(aDir, s1);
        float ang = aSeed.x * 80.0 + uTime * (aKind > 0.5 ? 0.3 : 0.0);
        vec3 radial = s1 * cos(ang) + s2 * sin(ang);
        float len = aKind > 0.5 ? 1.3 * aSeed.y : (6.0 + 7.0 * fract(aSeed.x * 3.7)) * aSeed.y * uPower;
        float spread = aKind > 0.5 ? 2.0 * aSeed.y : 0.22 * aSeed.y;
        vec3 p = position + aDir * (life * len) + radial * pow(life, 0.8) * spread;
        p += (s1 * sin(uTime * 1.9 + aSeed.x * 20.0) + s2 * cos(uTime * 1.3 + aSeed.x * 13.0)) * 0.1 * life * (1.0 + aKind * 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = aKind > 0.5 ? mix(0.4, 1.4, life) * aSeed.y : mix(0.22, 0.04, life) * aSeed.y;
        gl_PointSize = clamp(size * uScale / max(-mv.z, 0.001), 1.0, 14.0);
        vA = smoothstep(1.0, 4.0, -mv.z) * (aKind > 0.5 ? life * (1.0 - life) * 4.0 * 0.025 : pow(1.0 - life, 1.6) * 0.55);
        vA *= 1.0 - smoothstep(uIgnite - 0.05, uIgnite, acos(clamp(dot(normalize(position), uHero), -1.0, 1.0)));
        vec3 wsite = (modelMatrix * vec4(position, 1.0)).xyz;   // edge-on at the limb (seen from orbit): sub-pixel sparks alias into glitter
        vA *= mix(1.0, smoothstep(0.05, 0.35, dot(normalize(wsite), normalize(cameraPosition - wsite))), smoothstep(25.0, 150.0, length(cameraPosition) - 100.0));
        vLife = life; vKind = aKind;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vLife; varying float vKind;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
        vec3 plasma = mix(vec3(1.6, 1.9, 2.4), vec3(0.2, 0.42, 1.5), smoothstep(0.0, 0.45, vLife));
        gl_FragColor = vec4(mix(plasma, vec3(0.08, 0.16, 0.38), vKind) * a * vA, 1.0);
      }`
  }));
  exhaust.frustumCulled = false;
  const heroes = engines.filter(e => e.vol);
  volHero = createVolumetricPlumes(heroes.length, { uTime, uPower, uIgnite, uHero, uIntensity: { value: 0.28 } }, VOL_STEPS);
  heroes.forEach((e, k) => { m.compose(e.nozzle, e.vol.q, s.set(e.vol.r, e.vol.len, e.vol.r)); volHero.setMatrixAt(k, m); });
  if (MODELS.gantry) {
    const mats = [], Yv = new THREE.Vector3(0, 1, 0);
    heroes.forEach((e, k) => {
      const base = new THREE.Quaternion().setFromUnitVectors(Yv, e.dir);
      for (const a of [0.6 + k, 2.9 + k]) {
        const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(base);
        const p = e.dir.clone().multiplyScalar(R - 0.03).addScaledVector(side, 0.78 * e.s);
        const q2 = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Yv, -a + Math.PI / 2));
        mats.push(new THREE.Matrix4().compose(p, q2, new THREE.Vector3().setScalar(1.75 * e.s)));
      }
    });
    gantries = instanceModel(MODELS.gantry, mats); earthSpin.add(gantries);
  }
  earthSpin.add(engineMesh, jetMesh, exhaust, volHero);
  // launch-pad clouds rolling out of the trenches, and steam boiling up the outside of each plume
  const em = [];
  for (const e of heroes) {
    em.push({ pos: e.dir.clone().multiplyScalar(R + 0.05), up: e.dir, axis: e.dir, s: e.s * 1.1, kind: 0 });
    em.push({ pos: e.nozzle, up: e.dir, axis: e.dir, s: e.s, kind: 1, len: e.vol.len, rad: e.vol.r });
  }
  smokeHero = createSmoke(em, { uTime, uIgnite, uHero, uSun, uLight, uPower, uAge: heroAge }, { perEmitter: MOBILE ? [12, 8] : [22, 14], speed: 0.11, seed: 3 });
  earthSpin.add(smokeHero);
  // local blue light at the hero array for close-ups
  const hl = new THREE.PointLight(0x6fc4ff, 45, 18, 2); hl.position.copy(heroDir).multiplyScalar(R + 4); earthSpin.add(hl);
}

/* =====================================================================
   Equatorial steering engines: a belt of colossal tilted towers that
   brake (and later steer) the planet's spin. Each fires a slanted jet
   eastward; they ignite in a wave that races around the equator.
   ===================================================================== */
const STEER_N = 72, STEER_S = 4.6, STEER_TILT = THREE.MathUtils.degToRad(48);
const steerers = [], uSteer = { value: 10 }, uSteerFar = { value: 0 };
let steerMesh, steerBase, steerJets;
function placeSteering() {
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < STEER_N; i++) {
    const [u, v] = latLonToUV(0, -180 + (i + 0.5) * 360 / STEER_N), d = uvToDir(u, v);
    if (d.dot(elevatorDir) > Math.cos(THREE.MathUtils.degToRad(16))) continue;   // keep the elevator corridor clear of the slanted plumes
    const east = new THREE.Vector3().crossVectors(up, d).normalize();
    const n = east.clone().multiplyScalar(Math.sin(STEER_TILT)).addScaledVector(d, Math.cos(STEER_TILT)).normalize();
    steerers.push({ dir: d, east, n, u, v, s: STEER_S, steer: true });
  }
}
function buildSteering(engineGeo) {
  const mats = engineMesh.material, Yv = new THREE.Vector3(0, 1, 0);
  steerMesh = new THREE.InstancedMesh(engineGeo, mats, steerers.length);
  steerBase = new THREE.InstancedMesh(new THREE.CylinderGeometry(4.4, 5.2, 1.4, 6), mats[1], steerers.length);
  const jg = plumeGeometry(), seeds = new Float32Array(steerers.length);
  steerJets = new THREE.InstancedMesh(jg, jetMat, steerers.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), s = new THREE.Vector3();
  steerers.forEach((e, i) => {
    q.setFromUnitVectors(Yv, e.dir); m.compose(e.dir.clone().multiplyScalar(R - 0.45), q, s.set(1, 1, 1)); steerBase.setMatrixAt(i, m);
    q.setFromUnitVectors(Yv, e.n); qy.setFromAxisAngle(Yv, i * 0.7); q.multiply(qy);
    m.compose(e.dir.clone().multiplyScalar(R - 0.2), q, s.setScalar(e.s)); steerMesh.setMatrixAt(i, m);
    e.nozzle = e.dir.clone().multiplyScalar(R - 0.2).addScaledVector(e.n, 1.44 * e.s);
    m.compose(e.nozzle, q, s.set(1.65, 46, 1.65)); steerJets.setMatrixAt(i, m);
    e.volM = new THREE.Matrix4().compose(e.nozzle, q, new THREE.Vector3(3.4, 50, 3.4));
    seeds[i] = rand();
  });
  jg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const jm = jetMat.clone();
  jm.uniforms = { uTime, uPower: { value: 1 }, uIntensity: { value: 0.7 }, uFar: uSteerFar, uFlame: { value: 0 }, uIgnite: uSteer, uHero: { value: steerers[0].dir.clone() }, uSun };
  steerJets.material = jm; steerJets.frustumCulled = false;
  volSteer = createVolumetricPlumes(steerers.length, { uTime, uPower: { value: 1 }, uIgnite: uSteer, uHero: jm.uniforms.uHero, uIntensity: { value: 0.42 }, decay: 4.2 }, VOL_STEPS);
  steerers.forEach((e, i) => volSteer.setMatrixAt(i, e.volM));
  steerJets.visible = false;   // the volumes replace the shell beams
  const em = [];
  for (const e of steerers) {
    em.push({ pos: e.dir.clone().multiplyScalar(R + 0.3), up: e.dir, axis: e.dir, s: e.s * 0.5, kind: 0 });
    em.push({ pos: e.nozzle, up: e.dir, axis: e.n, s: e.s, kind: 1, len: 50, rad: 2.0 });
  }
  shock = createShockwave({ uSun, uLight, uTime }); earthSpin.add(shock);
  // the lead tower is lit by its own jet (the close-up in chapter 3)
  steerLight = new THREE.PointLight(0x7fb6ff, 0, 34, 1.6); steerLight.position.copy(steerers[0].nozzle).addScaledVector(steerers[0].n, 6); earthSpin.add(steerLight);
  smokeSteer = createSmoke(em, { uTime, uIgnite: uSteer, uHero: jm.uniforms.uHero, uSun, uLight, uAge: steerAge }, { perEmitter: MOBILE ? [10, 0] : [20, 0], speed: 0.09, seed: 5 });
  earthSpin.add(smokeSteer);
  earthSpin.add(volSteer);
  steerMesh.castShadow = steerBase.receiveShadow = true;
  earthSpin.add(steerBase, steerMesh, steerJets);
}

/* =====================================================================
   Space elevator: equatorial anchor, triple cable, climbers, apex station
   ===================================================================== */
const CABLE_LEN = 430, STATION_H = 380;   // apex at geostationary orbit (≈ 36,000 km)
let elevator, climbers = [], stationRings = [];
function makeGravityRing(r, tube, spokes, windows) {
  const ring = new THREE.Group(), s = new THREE.Group();
  add(s, new THREE.TorusGeometry(r, tube, 18, 120), MAT.hull, 0, 0, 0, Math.PI / 2);
  add(s, new THREE.TorusGeometry(r, tube * 0.28, 8, 120), MAT.dark, 0, tube * 0.85, 0, Math.PI / 2);
  add(s, new THREE.TorusGeometry(r, tube * 0.28, 8, 120), MAT.dark, 0, -tube * 0.85, 0, Math.PI / 2);
  add(s, new THREE.TorusGeometry(r + tube * 0.95, tube * 0.12, 6, 120), MAT.gold, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < spokes; i++) {
    const a = i / spokes * Math.PI * 2;
    const sp = add(s, new THREE.CylinderGeometry(tube * 0.22, tube * 0.22, r, 10), i % 2 ? MAT.hull : MAT.dark, Math.cos(a) * r / 2, 0, Math.sin(a) * r / 2);
    sp.rotation.set(0, -a, Math.PI / 2);
    add(s, new THREE.BoxGeometry(tube * 1.6, tube * 1.4, tube * 2.4), MAT.dark, Math.cos(a) * r, 0, Math.sin(a) * r, 0, -a, 0);
  }
  ring.add(bake(s));
  const win = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, tube * 0.32, tube * 0.42), MAT.warm, windows);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < windows; i++) {
    const a = i / windows * Math.PI * 2, y = (i % 2 ? 0.28 : -0.28) * tube;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(new THREE.Vector3(Math.cos(a) * (r + tube * 0.98), y, Math.sin(a) * (r + tube * 0.98)), q, new THREE.Vector3(1, 1, 1));
    win.setMatrixAt(i, m);
  }
  ring.add(win);
  return ring;
}
function solarWing(len, width, parent, x, y, z, ry = 0) {
  const w = new THREE.Group(); w.position.set(x, y, z); w.rotation.y = ry; parent.add(w);
  add(w, new THREE.BoxGeometry(len, 0.12, 0.12), MAT.dark, len / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    add(w, new THREE.BoxGeometry(len / 4 - 0.15, 0.04, width), MAT.panel, len / 8 + i * len / 4, 0, width / 2 + 0.15);
    add(w, new THREE.BoxGeometry(len / 4 - 0.15, 0.04, width), MAT.panel, len / 8 + i * len / 4, 0, -width / 2 - 0.15);
  }
  return w;
}
function buildApexStation() {
  const g = new THREE.Group(), st = new THREE.Group();
  add(st, new THREE.CylinderGeometry(1.7, 1.7, 9, 28), MAT.hull, 0, 0, 0);
  add(st, new THREE.SphereGeometry(1.7, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), MAT.hull, 0, 4.5, 0);
  add(st, new THREE.SphereGeometry(1.7, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), MAT.dark, 0, -4.5, 0);
  for (const y of [-3.6, -0.2, 3.2]) add(st, new THREE.CylinderGeometry(2.35, 2.35, 0.55, 28), MAT.dark, 0, y, 0);
  add(st, new THREE.CylinderGeometry(0.35, 0.35, 6, 10), MAT.dark, 0, 7.5, 0);
  add(st, lathe([[0.05, 0], [1.2, 0.35], [2.2, 0.95], [2.4, 1.05]], 36), MAT.hull, 0, 10.2, 0, Math.PI);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    add(st, new THREE.BoxGeometry(5.5, 0.55, 0.55), MAT.hull, Math.cos(a) * 4.4, -5.2, Math.sin(a) * 4.4, 0, -a, 0);
    add(st, new THREE.CylinderGeometry(0.75, 0.75, 1.4, 16), MAT.dark, Math.cos(a) * 7.2, -5.2, Math.sin(a) * 7.2, 0, -a, Math.PI / 2);
    add(st, new THREE.BoxGeometry(1.4, 0.9, 3.2), MAT.gold, Math.cos(a) * 2.6, 1.6, Math.sin(a) * 2.6, 0, -a, 0);
  }
  solarWing(16, 2.6, st, 2.0, 5.6, 0, 0);
  solarWing(16, 2.6, st, -2.0, 5.6, 0, Math.PI);
  solarWing(12, 2.2, st, 0, 5.0, 2.0, -Math.PI / 2);
  solarWing(12, 2.2, st, 0, 5.0, -2.0, Math.PI / 2);
  for (let i = 0; i < 3; i++) add(st, new THREE.BoxGeometry(0.08, 6, 2.2), MAT.white, 0, -9.5 + i * 0.2, 0, 0, i * Math.PI / 3, 0).castShadow = false;
  g.add(bake(st));
  const ringA = makeGravityRing(8.5, 0.62, 6, 80); ringA.position.y = -1.6;
  const ringB = makeGravityRing(12.5, 0.72, 8, 120); ringB.position.y = 1.8;
  g.add(ringA, ringB); stationRings.push([ringA, 0.12], [ringB, -0.08]);
  const dots = [];
  for (let i = 0; i < 70; i++) { const a = rand() * Math.PI * 2, rad = [1.8, 2.4, 8.6, 12.6][i % 4]; dots.push(new THREE.Vector3(Math.cos(a) * rad, rr(-5, 5), Math.sin(a) * rad)); }
  g.add(lightDots(dots, new THREE.Color().setRGB(3, 2.2, 1.2), 0.35, 0.6));
  g.add(lightDots([new THREE.Vector3(18, 5.6, 0), new THREE.Vector3(-18, 5.6, 0), new THREE.Vector3(0, 5, 14), new THREE.Vector3(0, 5, -14), new THREE.Vector3(0, 11.6, 0)], new THREE.Color().setRGB(3.5, 0.3, 0.25), 0.45, 1));
  const pl = new THREE.PointLight(0xffd2a0, 60, 40, 2); pl.position.set(0, -8, 6); g.add(pl);
  return g;
}
function buildElevator() {
  elevator = new THREE.Group();
  elevator.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), elevatorDir);
  elevator.position.copy(elevatorDir).multiplyScalar(R - 0.05);
  earthSpin.add(elevator);
  // anchor complex
  const base = new THREE.Group();
  add(base, new THREE.CylinderGeometry(2.6, 3.0, 0.35, 6), MAT.dark, 0, 0.17, 0);
  add(base, new THREE.CylinderGeometry(1.8, 2.2, 0.3, 6), MAT.hull, 0, 0.5, 0);
  add(base, new THREE.CylinderGeometry(0.22, 0.75, 5.2, 16), MAT.hull, 0, 3.2, 0);
  add(base, new THREE.CylinderGeometry(0.9, 0.9, 0.35, 20), MAT.dark, 0, 1.6, 0);
  add(base, new THREE.CylinderGeometry(0.6, 0.6, 0.3, 20), MAT.dark, 0, 4.0, 0);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const p = add(base, new THREE.BoxGeometry(0.22, 3.6, 0.22), MAT.hull, Math.cos(a) * 1.25, 2.0, Math.sin(a) * 1.25);
    p.lookAt(0, 6, 0); p.rotateX(Math.PI / 2);
    add(base, new THREE.BoxGeometry(1.2, 0.6, 0.8), MAT.dark, Math.cos(a + 0.5) * 2.2, 0.75, Math.sin(a + 0.5) * 2.2, 0, -a, 0);
  }
  elevator.add(bake(base));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.05, 6, 64), MAT.cyan); ring.rotation.x = Math.PI / 2; ring.position.y = 0.7; elevator.add(ring);
  // cable strands
  const strandMat = new THREE.MeshStandardMaterial({ color: 0x9fb2c8, metalness: 0.9, roughness: 0.3, emissive: 0x1c3550, emissiveIntensity: 1.2 });
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, CABLE_LEN, 6, 1, true), strandMat);
    c.position.set(Math.cos(a) * 0.24, CABLE_LEN / 2 + 0.5, Math.sin(a) * 0.24); elevator.add(c);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, CABLE_LEN, 4, 1, true), glow(0.4, 1.0, 2.0)); core.position.y = CABLE_LEN / 2 + 0.5; elevator.add(core);
  // light pulses running along the cable (GPU)
  const n = 700, aT = new Float32Array(n), aSp = new Float32Array(n), aSt = new Float32Array(n), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { aT[i] = rand(); aSp[i] = (rand() < 0.5 ? 1 : -1) * rr(0.006, 0.02); aSt[i] = (rand() * 3) | 0; }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  bg.setAttribute('aSp', new THREE.BufferAttribute(aSp, 1)); bg.setAttribute('aSt', new THREE.BufferAttribute(aSt, 1));
  const beads = new THREE.Points(bg, new THREE.ShaderMaterial({
    uniforms: { uTime, uScale: pointScale, uLen: { value: CABLE_LEN } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aT, aSp, aSt; uniform float uTime, uScale, uLen; varying float vA; varying float vUp;
      void main(){ float t = fract(aT + uTime * aSp); float a = aSt * 2.0944;
        vec3 p = vec3(cos(a) * 0.24, 0.5 + t * uLen, sin(a) * 0.24);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.22 * uScale / -mv.z, 1.0, 16.0);
        vA = smoothstep(0.0, 0.01, t) * (1.0 - smoothstep(0.98, 1.0, t)) * (1.0 - smoothstep(12.0, 45.0, -mv.z)) * 0.7; vUp = step(0.0, aSp);   // from orbit the tether is a thread, not a laser
        if (vA < 0.001) gl_Position = vec4(0.0, 0.0, -2.0, 1.0); }`,
    fragmentShader: `varying float vA; varying float vUp; void main(){ float d = length(gl_PointCoord - 0.5); float a = (1.0 - smoothstep(0.0, 0.5, d));
      gl_FragColor = vec4(mix(vec3(2.6,1.6,0.8), vec3(0.6,1.6,3.0), vUp) * a * a * vA, 1.0); }`
  }));
  beads.frustumCulled = false; elevator.add(beads);
  // climbers
  const cg = new THREE.Group();
  add(cg, new THREE.CylinderGeometry(0.55, 0.55, 1.1, 6), MAT.hull, 0, 0, 0);
  add(cg, new THREE.CylinderGeometry(0.7, 0.7, 0.18, 6), MAT.dark, 0, 0.62, 0);
  add(cg, new THREE.CylinderGeometry(0.7, 0.7, 0.18, 6), MAT.dark, 0, -0.62, 0);
  add(cg, new THREE.CylinderGeometry(0.57, 0.57, 0.08, 6), MAT.cyan, 0, 0.25, 0);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; add(cg, new THREE.BoxGeometry(0.4, 0.9, 0.5), MAT.gold, Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75, 0, -a, 0); }
  const climberProto = bake(cg);
  for (let i = 0; i < 16; i++) {
    const c = climberProto.clone(); c.userData = { phase: i / 16 + rand() * 0.04, speed: rr(0.004, 0.007), up: i % 2 === 0 };
    c.add(lightDots([new THREE.Vector3(0, 0.75, 0), new THREE.Vector3(0, -0.75, 0)], new THREE.Color().setRGB(3, 3, 3.2), 0.55, 0.5));
    elevator.add(c); climbers.push(c);
  }
  // apex station + counterweight
  const station = buildApexStation(); station.position.y = STATION_H; elevator.add(station); elevator.userData.station = station;
  if (MODELS.iss) {
    const iss = placeModel(MODELS.iss); iss.scale.setScalar(34); iss.position.set(31, 2, -6); iss.rotation.set(0.25, 0.9, Math.PI / 2); station.add(iss);
    add(station, new THREE.CylinderGeometry(0.35, 0.35, 15, 10), MAT.dark, 15.5, 2, -2.5, 0, 0.3, Math.PI / 2);   // docking truss
  }
  if (MODELS.hubble) { const hb = placeModel(MODELS.hubble); hb.scale.setScalar(5); hb.position.set(-22, 14, 18); hb.rotation.set(0.4, 1.2, 0.2); station.add(hb); }
  const cw = new THREE.Mesh(asteroidGeometry(4, 3, 9), MAT.rock); cw.position.y = CABLE_LEN + 2; cw.castShadow = cw.receiveShadow = true; elevator.add(cw);
  const clamp1 = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.3, 8, 32), MAT.dark); clamp1.position.y = CABLE_LEN - 0.6; clamp1.rotation.x = Math.PI / 2; elevator.add(clamp1);
  // floodlights from the anchor
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); gl_FragColor = vec4(vec3(0.45, 0.75, 1.4) * pow(1.0 - vUv.y, 3.0) * edge * 0.12, 1.0); }`
  });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(1.4, 0.15, 22, 16, 1, true); g.translate(0, 11, 0);
    const b = new THREE.Mesh(g, beamMat); b.userData.flood = true; const a = i / 3 * Math.PI * 2;
    b.position.set(Math.cos(a) * 1.9, 0.8, Math.sin(a) * 1.9); b.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); elevator.add(b);
  }
  const al = new THREE.PointLight(0x9fdcff, 50, 16, 2); al.position.set(0, 3, 3); elevator.add(al);
  const dots = []; for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; dots.push(new THREE.Vector3(Math.cos(a) * 2.95, 0.4, Math.sin(a) * 2.95)); }
  elevator.add(lightDots(dots, new THREE.Color().setRGB(0.6, 1.6, 3.0), 0.25, 0.3));
}

/* =====================================================================
   Asteroids, mining platform, habitats, deep-space array, Moon
   ===================================================================== */
function asteroidGeometry(r, detail, seed) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const d = v.clone().normalize();
    const n = fbm3(d.x * 1.8 + seed, d.y * 1.8, d.z * 1.8 - seed, 5);
    const crater = Math.pow(Math.max(0, vnoise(d.x * 4 + seed, d.y * 4, d.z * 4) - 0.6), 2) * 1.2;
    v.copy(d).multiplyScalar(r * (0.72 + n * 0.55 - crater * 0.4) * (1 + d.y * 0.12)); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const w = mergeVertices(g); w.computeVertexNormals(); return w;
}
const MINE_POS = new THREE.Vector3(430, 40, -330);
const COMM_POS = new THREE.Vector3(-360, 150, 250);
let asteroidField, miningRig, habitats = [], comm, moonPivot, moon, beamComm;
const rockRand = mulberry32(4242);
const rockBumpShader = (sh) => {   // fallback relief when the scanned rock set is unavailable
  // object-space fbm relief + fine regolith grain, applied as a derivative bump (no UVs needed)
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRockP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockP = position;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 vRockP;
    ${GLSL_NOISE}
    vec3 rockBump(vec3 n, vec3 p, float h){
      vec3 dpx = dFdx(p), dpy = dFdy(p); float dhx = dFdx(h), dhy = dFdy(h);
      vec3 r1 = cross(dpy, n), r2 = cross(n, dpx); float det = dot(dpx, r1);
      return normalize(abs(det) * n - sign(det) * (dhx * r1 + dhy * r2));
    }`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    { vec3 q = vRockP * (1.0 / max(length(vRockP), 1e-3)) * 2.6 + vRockP * 0.35;
      float h = (fbm(q * 1.7) * 0.7 + vnoise(q * 7.0) * 0.14) * 0.34;
      normal = rockBump(normal, -vViewPosition, h); }`);
};
function buildMining() {
  asteroidField = new THREE.Group(); asteroidField.position.copy(MINE_POS); scene.add(asteroidField);
  const geos = [asteroidGeometry(1, 3, 1.3), asteroidGeometry(1, 3, 7.7), asteroidGeometry(1, 3, 4.1)];
  const per = Math.ceil(Q.asteroids / 3), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  geos.forEach((g, k) => {
    const im = new THREE.InstancedMesh(g, MAT.rock, per); im.castShadow = false; im.receiveShadow = true; // no blotchy shadows on the mined body, cheaper shadow pass
    for (let i = 0; i < per; i++) {
      const a = rand() * Math.PI * 2, rad = rr(18, 95), h = gauss() * 7;
      const s = 0.15 + Math.pow(rand(), 4) * 4.6;
      const tone = 0.55 + rockRand() * 0.5, warm = rockRand() * 0.08;
      im.setColorAt(i, new THREE.Color(tone + warm, tone + warm * 0.4, tone - warm * 0.3));
      q.setFromEuler(e.set(rand() * 6, rand() * 6, rand() * 6));
      m.compose(new THREE.Vector3(Math.cos(a) * rad, h, Math.sin(a) * rad), q, new THREE.Vector3(s, s * rr(0.6, 1), s * rr(0.7, 1.1)));
      im.setMatrixAt(i, m);
    }
    asteroidField.add(im);
  });
  // the mined body + rig
  miningRig = new THREE.Group(); miningRig.position.copy(MINE_POS); scene.add(miningRig);
  const big = new THREE.Mesh(asteroidGeometry(11, 4, 3.3), MAT.rock); big.castShadow = big.receiveShadow = true; miningRig.add(big);
  const rig = new THREE.Group(); rig.position.set(0, 9.6, 0); miningRig.add(rig);
  const st = new THREE.Group();
  add(st, new THREE.BoxGeometry(14, 0.5, 9), MAT.dark, 0, 0, 0);
  for (const x of [-6, -2, 2, 6]) for (const z of [-3.6, 3.6]) add(st, new THREE.CylinderGeometry(0.25, 0.4, 4, 8), MAT.hull, x, -2, z);
  for (let i = 0; i < 4; i++) add(st, new THREE.CylinderGeometry(1.2, 1.2, 3.6, 20), MAT.hull, -5 + i * 2.7, 2.1, -2.2);
  for (let i = 0; i < 4; i++) add(st, new THREE.SphereGeometry(1.2, 20, 12), MAT.gold, -5 + i * 2.7, 3.9, -2.2);
  add(st, new THREE.BoxGeometry(5, 3, 4), MAT.hull, 4, 1.75, 2);
  add(st, new THREE.BoxGeometry(5.2, 0.3, 4.2), MAT.dark, 4, 3.4, 2);
  add(st, new THREE.CylinderGeometry(0.3, 0.3, 9, 8), MAT.dark, 6, 4.5, -3.5);
  add(st, new THREE.BoxGeometry(0.4, 0.4, 9), MAT.hull, 6, 9, 0.5);
  add(st, new THREE.BoxGeometry(1.6, 1.4, 1.6), MAT.dark, 0, 2.5, 3);
  for (let i = 0; i < 6; i++) add(st, new THREE.BoxGeometry(1.2, 1.0, 2.4), [MAT.gold, MAT.dark, MAT.hull][i % 3], -5.5 + i * 1.4, 0.75, 3.2);
  solarWing(10, 2, st, 7, 1.5, 0, 0);
  rig.add(bake(st));
  const laserG = new THREE.CylinderGeometry(0.12, 0.12, 1, 8, 1, true); laserG.translate(0, -0.5, 0);
  const laser = new THREE.Mesh(laserG, new THREE.ShaderMaterial({
    uniforms: { uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float f = 0.75 + 0.25 * sin(uTime * 40.0 + vUv.y * 30.0); gl_FragColor = vec4(vec3(3.2, 1.2, 0.5) * f, 1.0); }`
  }));
  laser.position.set(0, 2.5, 3); laser.scale.set(1, 6.5, 1); rig.add(laser);
  // sparks at the cutting point (GPU burst)
  const n = 600, pos = new Float32Array(n * 3), sd = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const d = new THREE.Vector3(gauss(), Math.abs(gauss()) * 1.6, gauss()).normalize(); sd.set([d.x, d.y, d.z, rand()], i * 4); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aD', new THREE.BufferAttribute(sd, 4));
  const sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: { uTime, uScale: pointScale }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec4 aD; uniform float uTime, uScale; varying float vA;
      void main(){ float life = fract(uTime * 0.9 + aD.w); vec3 p = vec3(0.0, -4.0, 3.0) + aD.xyz * life * 4.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(0.18 * uScale / -mv.z, 1.0, 16.0); vA = 1.0 - life; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(3.0, 1.4, 0.4) * (1.0 - smoothstep(0.0, 0.5, d)) * vA, 1.0); }`
  }));
  sparks.frustumCulled = false; rig.add(sparks);
  const ol = new THREE.PointLight(0xff8a3a, 70, 16, 2); ol.position.set(0, -3, 3); rig.add(ol);
  const wl = new THREE.PointLight(0x9fd8ff, 40, 22, 2); wl.position.set(0, 7, 0); rig.add(wl);
  const dots = []; for (let i = 0; i < 40; i++) dots.push(new THREE.Vector3(rr(-7, 7), rr(0.3, 4), rr(-4.5, 4.5)));
  rig.add(lightDots(dots, new THREE.Color().setRGB(3, 2.1, 1.1), 0.3, 0.5));
}
function buildHabitat(scale) {
  const g = new THREE.Group(), s = new THREE.Group();
  add(s, new THREE.CylinderGeometry(1.1, 1.1, 10, 20), MAT.hull, 0, 0, 0);
  add(s, new THREE.SphereGeometry(1.6, 20, 12), MAT.dark, 0, 5.3, 0);
  add(s, new THREE.SphereGeometry(1.6, 20, 12), MAT.dark, 0, -5.3, 0);
  solarWing(13, 2.4, s, 1.2, -3.5, 0, 0);
  solarWing(13, 2.4, s, -1.2, -3.5, 0, Math.PI);
  add(s, new THREE.BoxGeometry(0.15, 3, 6), MAT.white, 0, 3.8, 0).castShadow = false;
  g.add(bake(s));
  const ring = makeGravityRing(9, 1.0, 6, 110); g.add(ring);
  const ring2 = makeGravityRing(6.2, 0.6, 4, 60); ring2.position.y = 2.8; g.add(ring2);
  const dots = []; for (let i = 0; i < 40; i++) { const a = rand() * Math.PI * 2; dots.push(new THREE.Vector3(Math.cos(a) * 10, rr(-0.8, 0.8), Math.sin(a) * 10)); }
  g.add(lightDots(dots, new THREE.Color().setRGB(0.7, 1.5, 3.0), 0.4, 0.7));
  g.scale.setScalar(scale);
  return { group: g, spin: [ring, ring2] };
}
function buildHabitats() {
  const defs = [
    { name: 'HABITAT RING AURORA', r: 150, inc: 0.32, node: 0.6, phase: 0.4, scale: 1.0 },
    { name: 'HABITAT RING HELIOS', r: 182, inc: -0.5, node: 2.2, phase: 2.5, scale: 0.85 },
    { name: 'HABITAT RING KUAFU', r: 236, inc: 0.12, node: 4.0, phase: 4.4, scale: 1.25 },
  ];
  for (const d of defs) {
    const carrier = new THREE.Group(); scene.add(carrier);
    const h = buildHabitat(d.scale); carrier.add(h.group);
    const plane = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.inc, d.node, 0));
    h.group.quaternion.copy(plane).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4));
    habitats.push({ ...d, carrier, plane, spin: h.spin, speed: 0.012 * Math.pow(R / d.r, 1.5) * 4 });
  }
}
function buildComm() {
  comm = new THREE.Group(); comm.position.copy(COMM_POS); scene.add(comm);
  const look = new THREE.Vector3(-0.35, 0.55, 0.76).normalize();
  comm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), look);
  const s = new THREE.Group();
  add(s, new THREE.BoxGeometry(0.6, 0.6, 44), MAT.dark, 0, -1.5, 0);
  add(s, new THREE.BoxGeometry(2.2, 2.2, 6), MAT.hull, 0, -1.5, 0);
  solarWing(14, 3, s, 1.2, -1.5, 4, 0); solarWing(14, 3, s, -1.2, -1.5, 4, Math.PI);
  for (let i = 0; i < 5; i++) {
    const z = -18 + i * 9, big = i === 2;
    const r = big ? 7 : 4.2;
    add(s, new THREE.CylinderGeometry(0.35, 0.5, 2, 10), MAT.hull, 0, -0.5, z);
    const dish = add(s, lathe([[0.01, 0], [r * 0.4, r * 0.03], [r * 0.7, r * 0.1], [r, r * 0.22], [r * 1.02, r * 0.22]], 48), MAT.hull, 0, 0.6, z);
    dish.material = MAT.hull;
    add(s, new THREE.CylinderGeometry(0.05, 0.05, r * 0.85, 6), MAT.dark, r * 0.35, 0.6 + r * 0.4, z, 0, 0, 0.35);
    add(s, new THREE.CylinderGeometry(0.05, 0.05, r * 0.85, 6), MAT.dark, -r * 0.35, 0.6 + r * 0.4, z, 0, 0, -0.35);
    add(s, new THREE.SphereGeometry(r * 0.08, 12, 8), MAT.cyan, 0, 0.6 + r * 0.75, z).castShadow = false;
  }
  comm.add(bake(s));
  const bg = new THREE.CylinderGeometry(0.25, 0.25, 1, 10, 1, true); bg.translate(0, 0.5, 0);
  beamComm = new THREE.Mesh(bg, new THREE.ShaderMaterial({
    uniforms: { uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){ float pulse = pow(fract(vUv.y * 14.0 - uTime * 0.6), 10.0); float fade = (1.0 - smoothstep(0.0, 1.0, vUv.y));
        gl_FragColor = vec4(vec3(0.5, 1.2, 2.6) * (0.15 + pulse * 2.2) * fade, 1.0); }`
  }));
  beamComm.position.set(0, 6, 0); beamComm.scale.set(1, 900, 1); comm.add(beamComm); diagram.push(beamComm);
  const dots = []; for (let i = 0; i < 24; i++) dots.push(new THREE.Vector3(rr(-1, 1), -1.5 + rr(-0.4, 0.4), rr(-22, 22)));
  comm.add(lightDots(dots, new THREE.Color().setRGB(3.2, 0.4, 0.3), 0.45, 1));
}
function buildMoon(tex) {
  moonPivot = new THREE.Group(); scene.add(moonPivot);
  const mat = tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.98, metalness: 0 }) : new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1 });
  moon = new THREE.Mesh(new THREE.SphereGeometry(22, 96, 64), mat); moon.position.set(-900, 230, -850); moon.castShadow = moon.receiveShadow = true;
  moonPivot.add(moon);
}

/* =====================================================================
   Satellites (GPU orbits), orbital traffic (instanced ships), cosmic dust
   ===================================================================== */
let ships, shipFlames, shipData = [];
const diagram = [];   // schematic overlays (orbit trails, data beams): explore mode only, never in the film
function orbitLine(r, rot, opts) {
  const pts = [], ts = [];
  for (let i = 0; i <= 384; i++) { const a = i / 384 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); ts.push(i / 384); }
  const g = new THREE.BufferGeometry().setFromPoints(pts); g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  const l = new THREE.Line(g, new THREE.ShaderMaterial({
    uniforms: { uTime, uPhase: { value: opts.phase }, uSpeed: { value: opts.speed }, uBase: { value: opts.base }, uTrail: { value: opts.trail }, uColor: { value: opts.color } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uPhase, uSpeed, uBase, uTrail; uniform vec3 uColor; varying float vT;
      void main(){
        float s = fract((uPhase + uTime * uSpeed) / 6.2831853 - vT);   // distance behind the moving head
        gl_FragColor = vec4(uColor * (uBase + exp(-s * uTrail) * 0.9), 1.0);
      }`
  }));
  l.rotation.copy(rot); l.frustumCulled = false; scene.add(l); diagram.push(l);
  return l;
}
function buildSatellites() {
  const n = Q.sats, pos = new Float32Array(n * 3), o = new Float32Array(n * 4), sd = new Float32Array(n);
  const shells = [[108, 0.9], [114, 0.95], [121, 0.35], [129, 1.2], [140, 0.6], [190, 0.05]];
  for (let i = 0; i < n; i++) { const sh = shells[i % shells.length]; const planes = 12; const pl = (i / shells.length | 0) % planes;
    o.set([sh[0] + rr(-0.6, 0.6), sh[1] + rr(-0.03, 0.03), pl / planes * Math.PI * 2 + i % shells.length, rand() * Math.PI * 2], i * 4); sd[i] = rand(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aO', new THREE.BufferAttribute(o, 4)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const sats = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime, uScale: pointScale }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aO; attribute float aSeed; uniform float uTime, uScale; varying float vA;
      void main(){
        float r = aO.x, inc = aO.y, node = aO.z;
        float ang = aO.w + uTime * 0.6 * pow(100.0 / r, 1.5) * 0.25;
        vec3 p = vec3(cos(ang) * r, 0.0, sin(ang) * r);
        p = vec3(p.x, -p.z * sin(inc), p.z * cos(inc));
        p = vec3(p.x * cos(node) + p.z * sin(node), p.y, -p.x * sin(node) + p.z * cos(node));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.28 * uScale / max(-mv.z, 0.001), 1.2, 6.0);
        vA = 0.16 + 0.9 * step(0.95, fract(uTime * 0.7 + aSeed * 13.0));        // occasional solar-panel glint
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.85, 1.0, 1.3) * exp(-d * d * 9.0) * (1.0 - smoothstep(0.6, 1.0, d)) * vA, 1.0); }`
  }));
  sats.frustumCulled = false; scene.add(sats);
  // habitat orbits: the trail head rides on the habitat itself
  for (const h of habitats) orbitLine(h.r, new THREE.Euler(h.inc, h.node, 0), { phase: h.phase, speed: h.speed, base: 0.012, trail: 6, color: new THREE.Color(0.3, 0.75, 1.3) });
}
function buildShips() {
  const sg = new THREE.Group();
  add(sg, new THREE.BoxGeometry(0.34, 0.24, 1.5), MAT.hull, 0, 0, 0);
  add(sg, new THREE.ConeGeometry(0.17, 0.5, 8), MAT.hull, 0, 0, 1.0, Math.PI / 2);
  add(sg, new THREE.CylinderGeometry(0.16, 0.21, 0.32, 10), MAT.dark, 0, 0, -0.9, Math.PI / 2);
  add(sg, new THREE.BoxGeometry(0.12, 0.12, 0.95), MAT.dark, 0.27, 0, -0.1);
  add(sg, new THREE.BoxGeometry(0.12, 0.12, 0.95), MAT.dark, -0.27, 0, -0.1);
  add(sg, new THREE.BoxGeometry(0.9, 0.03, 0.4), MAT.gold, 0, 0, -0.4);
  add(sg, new THREE.BoxGeometry(0.36, 0.04, 0.5), MAT.cyan, 0, 0.11, 0.35);
  const baked = bake(sg);
  const mats = [], geos = [];
  baked.children.forEach(m => { mats.push(m.material); geos.push(m.geometry); });
  const geo = mergeGeometries(geos, true);
  const n = Q.ships;
  ships = new THREE.InstancedMesh(geo, mats, n); ships.castShadow = ships.receiveShadow = true; ships.frustumCulled = false;
  const fg = jetGeometry(); fg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(n).map(() => rand()), 1));
  const fm = jetMat.clone(); fm.uniforms = { uTime, uPower: { value: 1 }, uIntensity: { value: 1.4 }, uFar: { value: 0 }, uFlame: { value: 0 }, uIgnite: { value: 10 }, uHero: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3() } };   // zero: no daylight dimming
  shipFlames = new THREE.InstancedMesh(fg, fm, n); shipFlames.frustumCulled = false;
  scene.add(ships, shipFlames); diagram.push(ships, shipFlames);   // ~60 km hulls at this scale: they read as debris in the film
  for (let i = 0; i < n; i++) {
    const k = rand();
    if (k < 0.5) shipData.push({ type: 'orbit', r: rr(106, 205), inc: rr(-1.1, 1.1), node: rand() * 6.28, ph: rand() * 6.28, s: rr(0.6, 1.3) });
    else if (k < 0.8) shipData.push({ type: 'route', a: (rand() * 6) | 0, b: (rand() * 6) | 0, ph: rand(), sp: rr(0.012, 0.03), s: rr(0.8, 1.6), off: new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(2.5) });
    else shipData.push({ type: 'convoy', ph: rand(), lane: new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(14), sp: rr(0.006, 0.01), s: rr(1.6, 2.8) });
  }
}
function buildDust() {
  const n = Q.dust, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([rr(0, 1), rr(0, 1), rr(0, 1)], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime, uScale: pointScale, uCam: { value: camera.position }, uBox: { value: 60 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime, uScale, uBox; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 p = position * uBox + vec3(uTime * 0.35, uTime * 0.12, -uTime * 0.22);
        p = mod(p - uCam, uBox) - uBox * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float d = max(-mv.z, 0.001); gl_PointSize = clamp(0.06 * uScale / d, 0.8, 3.0);
        vA = (1.0 - smoothstep(uBox * 0.15, uBox * 0.5, length(p - uCam))) * smoothstep(0.3, 2.0, d);
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * exp(-d * d * 4.0) * (1.0 - smoothstep(0.6, 1.0, d)) * vA * 0.35, 1.0); }`
  }));
  dust.frustumCulled = false; scene.add(dust);
}

/* =====================================================================
   Journey content: Jupiter (gravity-assist encounter) and the combined
   propulsion plume that trails the planet once it leaves orbit
   ===================================================================== */
const JUP_DIR = new THREE.Vector3(0.25, 0.1, 0.95).normalize(), JUP_R = 1100;
const JUP_SIDE = new THREE.Vector3().crossVectors(JUP_DIR, new THREE.Vector3(0, 1, 0)).normalize();
let jupiter, plume;
function buildJupiter() {
  jupiter = new THREE.Group(); jupiter.visible = false; jupiter.rotation.z = 0.05; scene.add(jupiter);
  // real cloud bands (Solar System Scope, CC BY 4.0) once loaded; the procedural bands stand in until then
  const jMap = { value: null }, jHas = { value: 0 };
  texLoader.load('assets/planets/jupiter_4k.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; jMap.value = t; jHas.value = 1; });
  jupiter.add(new THREE.Mesh(new THREE.SphereGeometry(JUP_R, 160, 120), new THREE.ShaderMaterial({
    uniforms: { uSun, uTime, uLight, uMap: jMap, uHas: jHas },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vP = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uTime, uLight, uHas; uniform sampler2D uMap; varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        float lat = vP.y, cl = sqrt(max(1.0 - lat * lat, 0.0));
        float lo = atan(vP.z, vP.x + 1e-5) + uTime * 0.012 * (0.6 + 0.8 * sin(lat * 17.0));   // differential rotation
        vec3 q = vec3(cos(lo) * cl, lat, sin(lo) * cl);                                         // seamless band space
        float warp = fbm(q * vec3(3.0, 9.0, 3.0) + 3.0) - 0.5;
        float edd = fbm(q * vec3(9.0, 34.0, 9.0) + vec3(0.0, warp * 2.0, uTime * 0.01)) - 0.5;
        float y = lat + warp * 0.07 + edd * 0.035;
        float bandN = fbm(vec3(y * 13.0, 0.5, 2.0)) + 0.1 * sin(y * 23.0);            // irregular belt / zone widths
        float b1 = smoothstep(0.4, 0.6, bandN), b2 = sin(y * 61.0 + edd * 6.0) * 0.5 + 0.5;
        vec3 col = mix(vec3(0.6, 0.42, 0.3), vec3(0.9, 0.85, 0.76), b1);
        col = mix(col, vec3(0.76, 0.5, 0.32), b2 * 0.28 * (1.0 - abs(lat)));
        col = mix(col, vec3(0.42, 0.3, 0.24), smoothstep(0.62, 0.8, fbm(q * vec3(6.0, 50.0, 6.0) + 9.0)) * 0.35);   // dark festoons
        col *= 0.8 + 0.4 * (edd + 0.5);
        col = mix(col, vec3(0.52, 0.5, 0.52), smoothstep(0.62, 0.9, abs(lat)));
        // Great Red Spot
        float gl = lo - 1.2;
        vec2 gs = vec2(atan(sin(gl), cos(gl)) * 2.2, (lat + 0.36) * 9.0);
        float grs = 1.0 - smoothstep(0.5, 1.0, length(gs));
        col = mix(col, vec3(0.75, 0.33, 0.2) * (0.85 + 0.3 * fbm(vec3(gs * 1.6, uTime * 0.03))), grs * 0.9);
        if (uHas > 0.5) col = texture2D(uMap, vUv + vec2(uTime * 0.0006 * (0.6 + 0.8 * sin(lat * 17.0)), 0.0)).rgb * 1.05;   // zonal jets drift
        // a thick atmosphere: soft terminator, limb darkening, blue-white haze at the rim
        vec3 N = normalize(vN), L = normalize(uSun), V = normalize(cameraPosition - vW);
        float ndl = dot(N, L), mu = max(dot(N, V), 0.0);
        float d = smoothstep(-0.05, 0.25, ndl) * max(ndl, 0.0) * 0.7 + smoothstep(-0.08, 0.15, ndl) * 0.3;
        vec3 c = col * d * 1.6 * uLight * (0.6 + 0.4 * pow(mu, 0.4));
        c += vec3(0.55, 0.65, 0.9) * pow(1.0 - mu, 3.0) * smoothstep(-0.1, 0.3, ndl) * 0.35 * uLight;
        // night side: lightning in the storm belts
        c += vec3(0.6, 0.7, 1.0) * step(0.985, vnoise(q * 40.0 + floor(uTime * 3.0))) * (1.0 - smoothstep(-0.2, 0.0, ndl)) * 2.0;
        gl_FragColor = vec4(c, 1.0);
      }`
  })));
  const io = new THREE.Mesh(new THREE.SphereGeometry(32, 48, 32), new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.9 }));
  io.position.set(-1500, 160, -900); jupiter.add(io);
}
function buildPlume() {
  const H = 1500, g = new THREE.CylinderGeometry(330, 92, H, 64, 24, true); g.translate(0, H / 2, 0);
  plume = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { uTime, uAmt: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vDist = length(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uAmt; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist;
      ${GLSL_NOISE}
      void main(){
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float along = vUv.y, a = vUv.x * 6.2831853;
        float streak = vnoise(vec3(cos(a) * 5.0, sin(a) * 5.0, along * 9.0 - uTime * 0.7)) * 0.7 + vnoise(vec3(cos(a) * 13.0, sin(a) * 13.0, along * 22.0 - uTime * 1.6)) * 0.3;
        float body = pow(ndv, 1.8) * exp(-along * 2.2) * smoothstep(0.0, 0.05, along) * (1.0 - smoothstep(0.45, 1.0, along));
        float i = body * (0.35 + 0.9 * streak) * smoothstep(40.0, 320.0, vDist) * uAmt;
        gl_FragColor = vec4(mix(vec3(0.5, 0.75, 1.6), vec3(0.18, 0.32, 1.0), smoothstep(0.0, 0.5, along)) * i * 0.32, 1.0);
      }`
  }));
  plume.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), MIGRATION_DIR.clone().negate());
  plume.position.copy(MIGRATION_DIR).multiplyScalar(-R * 0.55);
  plume.frustumCulled = false; plume.visible = false; scene.add(plume);
}

/* =====================================================================
   Lighting
   ===================================================================== */
const sunLight = new THREE.DirectionalLight(0xfff4e8, 5.2); // ≈ π × the Earth shader's sun, so hardware and planet share one exposure
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(Q.shadow, Q.shadow);
sunLight.shadow.bias = -0.0002; sunLight.shadow.normalBias = 0.02;
sunLight.shadow.camera.near = 1; sunLight.shadow.camera.far = 1100;
scene.add(sunLight, sunLight.target);
scene.add(new THREE.AmbientLight(0x161c28, 0.3));
const earthshine = new THREE.PointLight(0x6f8fd8, 0.6, 0, 0); scene.add(earthshine); // Earth + engine glow bouncing onto orbiting structures

/* =====================================================================
   Post-processing — HDR, MSAA, one bloom, a restrained lens model
   sky → scene → NaN guard → bloom → god rays/flare → ACES → finish
   ===================================================================== */
const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: fxHigh ? Q.msaa : 0 }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
const skyPass = new RenderPass(skyScene, skyCam);
const scenePass = new RenderPass(scene, camera); scenePass.clear = false; scenePass.clearDepth = true;
// Any NaN/Inf that slips through a shader would be smeared into blocks by the bloom mip chain.
const sanitizePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } }, vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    float ok(float x){ return (x >= 0.0 && x < 60000.0) ? x : 0.0; }
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(min(vec3(ok(c.r), ok(c.g), ok(c.b)), vec3(64.0)), 1.0); }`
});
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.35, 2.2);
// three's blur kernels use sigma == kernel radius (cut off at 1σ ≈ a box filter → square halos around tiny HDR
// sources like the Sun). Re-weight them as proper Gaussians that fall off inside the kernel.
[3, 5, 7, 9, 11].forEach((kr, i) => {
  const sigma = kr / 2.6, c = [];
  for (let j = 0; j < kr; j++) c.push(0.39894 * Math.exp(-0.5 * j * j / (sigma * sigma)) / sigma);
  const u = bloomPass.separableBlurMaterials[i] && bloomPass.separableBlurMaterials[i].uniforms.gaussianCoefficients;
  if (u) u.value = c;
}); // only emitters bloom, never sunlit paint
const lensDirt = canvasTex(1024, 512, (x, w, h) => {
  const r2 = mulberry32(77); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {                                     // soft smudges
    const cx = r2() * w, cy = r2() * h, rad = 30 + r2() * 140, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad), a = 0.04 + r2() * 0.08;
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 260; i++) {                                    // dust specks with soft halos
    const cx = r2() * w, cy = r2() * h, rad = 1.5 + Math.pow(r2(), 3) * 9, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.5, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
}, false, 1);
lensDirt.wrapS = lensDirt.wrapT = THREE.ClampToEdgeWrapping;
const lensPass = new ShaderPass({
  defines: { RAYS: Q.rays },
  uniforms: { tDiffuse: { value: null }, tDirt: { value: lensDirt }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uVis: { value: 0 }, uAspect: { value: innerWidth / innerHeight }, uTime: { value: 0 }, uHeat: { value: 1 } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDirt; uniform vec2 uSun; uniform float uVis, uAspect, uTime, uHeat; varying vec2 vUv;
    float disc(vec2 c, float r0, float r1){ float d = length((vUv - c) * vec2(uAspect, 1.0)); return 1.0 - smoothstep(r0, r1, d); }
    float ring(float d, float r, float w){ float k = (d - r) / w; return exp(-k * k); }
    void main(){
      // heat shimmer: air around very hot plasma refracts and ripples
      float hm = 0.0;
      for (int k = 0; k < 4; k++) { float a = float(k) * 1.5708 + 0.785; vec3 s = texture2D(tDiffuse, vUv + vec2(cos(a) / uAspect, sin(a)) * 0.03).rgb; hm += max(dot(s, vec3(0.3, 0.55, 0.15)) - 2.0, 0.0); }
      hm = min(max(hm - 2.0, 0.0) * 0.06, 0.35) * uHeat;
      vec2 hoff = vec2(sin(vUv.y * 230.0 - uTime * 11.0 + sin(vUv.x * 70.0 + uTime * 3.0) * 2.0), cos(vUv.x * 190.0 + uTime * 8.0 + sin(vUv.y * 50.0) * 2.0)) * 0.0016 * hm;
      vec3 base = texture2D(tDiffuse, vUv + hoff).rgb;
      // lens dirt, lit by the brightest light around this point of the frame
      vec3 glowN = vec3(0.0);
      for (int k = 0; k < 8; k++) { float a = float(k) * 0.785398; glowN += texture2D(tDiffuse, clamp(vUv + vec2(cos(a), sin(a)) * vec2(0.11 / uAspect, 0.11), 0.0, 1.0)).rgb; }
      glowN = max(glowN / 8.0 - 0.6, 0.0);
      base += texture2D(tDirt, vUv).r * min(glowN, vec3(2.0)) * 0.035;
      if (uVis < 0.002) { gl_FragColor = vec4(base, 1.0); return; }
      // screen-space light shafts from the bright sun only
      vec2 delta = (vUv - uSun) / float(RAYS) * 0.85; vec2 uv = vUv; float decay = 1.0, rays = 0.0;
      for (int i = 0; i < RAYS; i++) {
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float w = exp(-length((uv - uSun) * vec2(uAspect, 1.0)) * 4.0);
        rays += min(max(dot(s, vec3(0.3, 0.55, 0.15)) - 1.5, 0.0), 6.0) * w * decay; decay *= 0.94;
      }
      vec3 add = vec3(1.0, 0.88, 0.72) * rays * 0.018;
      // optical artefacts — kept faint, like a real coated lens
      vec2 axis = vec2(0.5) - uSun;
      add += vec3(0.3, 0.55, 1.0) * disc(uSun + axis * 0.7, 0.02, 0.05) * 0.05;
      add += vec3(0.45, 0.3, 1.0) * disc(uSun + axis * 1.3, 0.05, 0.09) * 0.025;
      add += vec3(1.0, 0.6, 0.3) * ring(length((vUv - (uSun + axis * 1.75)) * vec2(uAspect, 1.0)), 0.11, 0.008) * 0.025;
      add += vec3(0.5, 0.75, 1.0) * ring(length((vUv - uSun) * vec2(uAspect, 1.0)), 0.38, 0.03) * 0.01;
      add += vec3(0.35, 0.6, 1.4) * exp(-abs(vUv.y - uSun.y) * 650.0) * exp(-abs(vUv.x - uSun.x) * 6.0) * 0.09;   // anamorphic streak
      add += texture2D(tDirt, vUv).r * vec3(1.0, 0.9, 0.75) * exp(-length((vUv - uSun) * vec2(uAspect, 1.0)) * 3.5) * 0.1;   // dirt catching the sun
      gl_FragColor = vec4(base + add * uVis, 1.0);
    }`
});
const outputPass = new OutputPass();
const finishPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uCA: { value: 1 }, uGrain: { value: 0.012 } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uCA, uGrain; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; vec2 off = c * dot(c, c) * 0.012 * uCA;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.92, 1.0, 1.08), (1.0 - smoothstep(0.0, 0.4, l)) * 0.5);   // cool, deep shadows
      col = mix(vec3(l), col, 1.06);
      col *= 1.0 - smoothstep(0.45, 1.1, length(c * vec2(1.0, 0.8))) * 0.6;                 // vignette
      float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime * 7.0) * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      gl_FragColor = vec4(clamp(col + g * uGrain, 0.0, 1.0), 1.0);                           // grain doubles as dither
    }`
});
for (const p of [skyPass, scenePass, sanitizePass, bloomPass, lensPass, outputPass, finishPass]) composer.addPass(p);

/* =====================================================================
   Landmarks & camera system
   ===================================================================== */
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const worldOf = (obj, local = new THREE.Vector3()) => obj.localToWorld(local.clone());
const landmarks = [];
function defineLandmarks() {
  const surfaceView = (getPos, dist, lift, side = 1, aim = 0.18) => () => {
    const t = getPos(); const up = t.clone().normalize();
    const tangent = new THREE.Vector3().crossVectors(up, SUN_DIR).normalize();
    const toward = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const cam = t.clone().addScaledVector(up, dist * lift).addScaledVector(tangent, dist * 0.75 * side).addScaledVector(toward, -dist * 0.45);
    return { target: t.clone().addScaledVector(up, dist * aim), cam };
  };
  const spaceView = (getPos, dist, sun = 0.55) => () => {
    const t = getPos(); const out = t.clone().normalize();
    const side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
    const dir = out.clone().multiplyScalar(0.35).addScaledVector(side, 0.8).addScaledVector(SUN_DIR, sun).add(new THREE.Vector3(0, 0.3, 0)).normalize();
    return { target: t, cam: t.clone().addScaledVector(dir, dist) };
  };
  const station = elevator.userData.station;
  landmarks.push(
    { key: 'overview', name: 'EARTH', kicker: 'PLANETARY ENGINE NETWORK', sub: `${engines.length.toLocaleString()} propulsion units · 0.0094 g sustained thrust`, radius: R, frame: null,
      pos: () => new THREE.Vector3(), view: () => ({ target: new THREE.Vector3(0, 0, 0), cam: new THREE.Vector3(70, 55, 330) }) },
    { key: 'engines', name: 'ENGINE ARRAY 017', kicker: 'HEAVY PROPULSION CLUSTER', sub: '19 heavy-fusion engines · 11,000 km plasma plumes', radius: 6, frame: earthSpin,
      pos: () => worldOf(earthSpin, heroDir.clone().multiplyScalar(R + 0.6)), view: surfaceView(() => worldOf(earthSpin, heroDir.clone().multiplyScalar(R + 0.6)), 12, 0.34, 1, 0.36) },
    { key: 'steering', name: 'EQUATORIAL STEERING ARRAY', kicker: 'ROTATION CONTROL', sub: `${steerers.length} steering engines ring the equator`, radius: 8, frame: earthSpin,
      pos: () => worldOf(earthSpin, steerers[0].dir.clone().multiplyScalar(R + 3)),
      view: () => { const p = worldOf(earthSpin, steerers[0].dir.clone().multiplyScalar(R)), up = p.clone().normalize(), N = new THREE.Vector3(0, 1, 0).applyQuaternion(earthTilt.quaternion), e = new THREE.Vector3().crossVectors(N, up).normalize();
        return { cam: p.clone().addScaledVector(e, -22).addScaledVector(N, 15).addScaledVector(up, 3), target: p.clone().addScaledVector(e, 22).addScaledVector(up, 9).addScaledVector(N, -2) }; } },
    { key: 'elevator', name: 'EQUATORIAL ANCHOR', kicker: 'SPACE ELEVATOR · GROUND SEGMENT', sub: 'Triple carbon-nanotube tether · 36,000 km to geostationary orbit', radius: 4, frame: earthSpin,
      pos: () => worldOf(elevator, new THREE.Vector3(0, 5, 0)), view: surfaceView(() => worldOf(elevator, new THREE.Vector3(0, 4, 0)), 15, 0.7, -1) },
    { key: 'station', name: 'TIANSHU APEX STATION', kicker: 'SPACE ELEVATOR TERMINUS', sub: 'Twin counter-rotating gravity rings · 0.92 g', radius: 14, frame: earthSpin,
      pos: () => worldOf(station), view: spaceView(() => worldOf(station), 46) },
    { key: 'habitat', name: 'HABITAT RING AURORA', kicker: 'ORBITAL COLONY', sub: '1.2 million residents · spin gravity 0.95 g', radius: 10, frame: habitats[0].carrier,
      pos: () => habitats[0].carrier.position.clone(), view: spaceView(() => habitats[0].carrier.position.clone(), 40, 0.7) },
    { key: 'mining', name: 'KUIPER-7 MINING PLATFORM', kicker: 'ASTEROID RESOURCE OPERATIONS', sub: 'Heavy-element ore for the fusion engines', radius: 14, frame: null,
      pos: () => MINE_POS.clone().add(new THREE.Vector3(0, 6, 0)), view: () => ({ target: MINE_POS.clone().add(new THREE.Vector3(0, 6, 0)), cam: MINE_POS.clone().add(new THREE.Vector3(-26, 22, 44)) }) },
    { key: 'comm', name: 'DEEP SPACE ARRAY', kicker: 'INTERSTELLAR COMMUNICATIONS', sub: 'Laser uplink to the Proxima relay chain', radius: 12, frame: null,
      pos: () => COMM_POS.clone(), view: () => ({ target: COMM_POS.clone(), cam: COMM_POS.clone().add(new THREE.Vector3(38, -10, -30)) }) },
    { key: 'moon', name: 'LUNA', kicker: 'GRAVITATIONAL ESCORT', sub: 'Retained in a bound orbit for the voyage', radius: 22, frame: null,
      pos: () => worldOf(moon), view: () => { const t = worldOf(moon); return { target: t, cam: t.clone().add(SUN_DIR.clone().multiplyScalar(40)).add(new THREE.Vector3(30, 10, 60)) }; } },
  );
  // invisible pick volumes
  for (const lm of landmarks) {
    if (lm.key === 'overview') continue;
    lm.proxy = new THREE.Mesh(new THREE.SphereGeometry(lm.radius * 1.15, 12, 8), new THREE.MeshBasicMaterial());
    lm.proxy.visible = false; lm.proxy.userData.lm = lm; scene.add(lm.proxy);
  }
}

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.07; controls.rotateSpeed = 0.55; controls.zoomSpeed = 1.1;
controls.zoomToCursor = true; controls.minDistance = 0.8; controls.maxDistance = 1500; controls.enablePan = true;
let mode = 'intro', focus = null, followLocal = null, fly = null, tourIndex = 0, tourTimer = 0, introT = 0;
const fp = { yaw: 0, pitch: 0, vel: new THREE.Vector3(), keys: {}, drag: null, thrust: 0 };

function setCaption(lm, kicker) {
  const cap = document.getElementById('caption');
  document.getElementById('cap-k').textContent = kicker || lm.kicker;
  document.getElementById('cap-t').textContent = lm.name;
  document.getElementById('cap-s').textContent = lm.sub;
  cap.classList.add('show'); clearTimeout(setCaption.t); setCaption.t = setTimeout(() => cap.classList.remove('show'), 6500);
}
function flyTo(lm, dur = 3.6, caption = true) {
  const v = lm.view();
  fly = { lm, t: 0, dur, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), arc: Math.min(camera.position.distanceTo(v.cam) * 0.18, 120) };
  focus = lm; followLocal = null;
  if (caption) setCaption(lm);
  document.querySelectorAll('.marks .btn').forEach(b => b.classList.toggle('active', b.dataset.key === lm.key));
}
function setMode(m) {
  if (m === mode) return;
  mode = m;
  document.body.classList.toggle('cinematic', m === 'cinematic');
  document.body.classList.toggle('fp', m === 'fp');
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  controls.enabled = m !== 'fp' && m !== 'story' && m !== 'attract';
  document.body.classList.toggle('story', m === 'story');
  if (m === 'fp') {
    fly = null; focus = null; followLocal = null;
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); fp.yaw = e.y; fp.pitch = e.x; fp.vel.set(0, 0, 0);
  }
  if (m === 'cinematic') { tourTimer = 0; if (!fly) flyTo(landmarks[tourIndex % landmarks.length], 4.5); }
  document.getElementById('h-mode').textContent = { cinematic: 'CINEMATIC', explore: 'EXPLORE', fp: 'FIRST PERSON', intro: 'INTRO', attract: 'STANDBY', story: 'JOURNEY' }[m];
}
const TOUR = ['overview', 'engines', 'steering', 'elevator', 'station', 'habitat', 'mining', 'comm', 'moon'];

function keepOutsideEarth(p, margin = 0.35) { const d = p.length(); if (d < R + margin) p.multiplyScalar((R + margin) / d); return p; }

function updateCamera(dt) {
  if (mode === 'story') return;                                  // the director (updateStory) owns the camera
  if (mode === 'attract') {                                      // slow orbit behind the start screen
    attractT += dt; const a = 0.21 + attractT * 0.03;
    camera.position.set(Math.sin(a) * 337, 55, Math.cos(a) * 337); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0);
    return;
  }
  if (mode === 'intro') {
    introT += dt;
    const e = easeInOut(Math.min(introT / 9, 1));
    const start = new THREE.Vector3(140, 90, 1150), end = landmarks[0].view().cam;
    camera.position.lerpVectors(start, end, e); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0);
    if (introT > 9) { if (startOpen) setMode('attract'); else { tourIndex = 1; setMode('cinematic'); flyTo(landmarks[1], 5); } }
    return;
  }
  if (mode === 'fp') { updateFP(dt); return; }
  if (fly) {
    fly.t += dt; const e = easeInOut(Math.min(fly.t / fly.dur, 1));
    const v = fly.lm.view();
    const p = new THREE.Vector3().lerpVectors(fly.fromPos, v.cam, e);
    p.addScaledVector(p.clone().normalize(), Math.sin(Math.PI * e) * fly.arc);
    keepOutsideEarth(p, 3 * Math.sin(Math.PI * e) + 0.4);
    camera.position.copy(p); controls.target.lerpVectors(fly.fromTarget, v.target, e); camera.lookAt(controls.target);
    if (fly.t >= fly.dur) { fly = null; tourTimer = 0; }
    return;
  }
  // follow the focused landmark in its moving frame
  if (focus && focus.frame) {
    if (followLocal) camera.position.copy(focus.frame.localToWorld(followLocal.clone()));
    controls.target.copy(focus.view().target);
  }
  if (mode === 'cinematic') {
    tourTimer += dt;
    const axis = controls.target.lengthSq() > 1 ? controls.target.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const off = camera.position.clone().sub(controls.target).applyAxisAngle(axis, dt * 0.045);
    camera.position.copy(controls.target).add(off.multiplyScalar(1 - dt * 0.004));
    if (tourTimer > 11) { tourIndex = (tourIndex + 1) % TOUR.length; flyTo(landmarks.find(l => l.key === TOUR[tourIndex]), 5.5); }
  }
  controls.update();
  keepOutsideEarth(camera.position, 0.35);
  if (focus && focus.frame) followLocal = focus.frame.worldToLocal(camera.position.clone());
}
function updateFP(dt) {
  const k = fp.keys, alt = Math.max(camera.position.length() - R, 0.3);
  const speed = clamp(alt * 0.6, 0.8, 120) * (k.ShiftLeft || k.ShiftRight ? 4 : 1);
  const dir = new THREE.Vector3((k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), (k.KeyE || k.Space ? 1 : 0) - (k.KeyQ || k.ControlLeft ? 1 : 0), (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0) - fp.thrust);
  if (dir.lengthSq() > 1) dir.normalize();
  camera.quaternion.setFromEuler(new THREE.Euler(fp.pitch, fp.yaw, 0, 'YXZ'));
  dir.applyQuaternion(camera.quaternion).multiplyScalar(speed);
  fp.vel.lerp(dir, 1 - Math.exp(-dt * 3));
  camera.position.addScaledVector(fp.vel, dt);
  keepOutsideEarth(camera.position, 0.3);
}

/* ---------- interaction ---------- */
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
function pick(x, y) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...landmarks.filter(l => l.proxy).map(l => l.proxy), earthMesh], false);
  return hits[0] || null;
}
canvas.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (mode === 'fp') { fp.drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); }
});
canvas.addEventListener('pointermove', e => {
  if (mode === 'fp' && fp.drag) {
    fp.yaw -= (e.clientX - fp.drag.x) * 0.0032; fp.pitch = clamp(fp.pitch - (e.clientY - fp.drag.y) * 0.0032, -1.5, 1.5);
    fp.drag = { x: e.clientX, y: e.clientY }; return;
  }
  if (TOUCH || down) return;
  const now = performance.now(); if (now - (pick.last || 0) < 60) return; pick.last = now;
  const h = pick(e.clientX, e.clientY), tip = document.getElementById('tooltip');
  const lm = h && h.object.userData.lm;
  document.body.classList.toggle('hover', !!lm);
  if (lm) { tip.textContent = lm.name; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.classList.add('show'); }
  else tip.classList.remove('show');
});
canvas.addEventListener('pointerup', e => {
  fp.drag = null;
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 450;
  down = null;
  if (moved > 6 || !quick || mode === 'fp' || mode === 'intro' || mode === 'story' || mode === 'attract') return;
  const h = pick(e.clientX, e.clientY); if (!h) return;
  if (h.object.userData.lm) { setMode('explore'); flyTo(h.object.userData.lm); return; }
  // clicked the planet: fly down to that surface sector
  const local = earthSpin.worldToLocal(h.point.clone()).normalize();
  const [lat, lon] = dirToLatLon(local);
  const count = engines.filter(en => en.dir.dot(local) > Math.cos(700 / 6371)).length;
  const sector = { key: 'sector', name: `SECTOR ${fmtLatLon(lat, lon)}`, kicker: 'SURFACE SURVEY', sub: `${count} planetary engines within 700 km`, radius: 3, frame: earthSpin,
    pos: () => worldOf(earthSpin, local.clone().multiplyScalar(R)), view: null };
  sector.view = () => { const t = worldOf(earthSpin, local.clone().multiplyScalar(R + 0.5)); const up = t.clone().normalize();
    const side = new THREE.Vector3().crossVectors(up, SUN_DIR).normalize();
    return { target: t, cam: t.clone().addScaledVector(up, 9).addScaledVector(side, 11) }; };
  setMode('explore'); flyTo(sector);
});
controls.addEventListener('start', () => { if (mode === 'cinematic') { fly = null; setMode('explore'); } });
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('button') && (e.code === 'Space' || e.code === 'Enter')) return;
  if (story.on) { storyKey(e); return; }
  if (startOpen) return;
  if (e.code === 'KeyJ') { startStory(); return; }
  fp.keys[e.code] = true;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= landmarks.length && mode !== 'intro') { setMode(mode === 'fp' ? 'explore' : mode === 'cinematic' ? 'explore' : mode); flyTo(landmarks[n - 1]); }
  if (e.code === 'KeyC') setMode('cinematic');
  if (e.code === 'KeyO') setMode('explore');
  if (e.code === 'KeyF') setMode(mode === 'fp' ? 'explore' : 'fp');
  if (e.code === 'Escape' && mode === 'fp') setMode('explore');
  if (e.code === 'KeyH') toggleHUD();
  if (e.code === 'KeyG') toggleFX();
});
addEventListener('keyup', e => { fp.keys[e.code] = false; });
addEventListener('blur', () => { fp.keys = {}; fp.thrust = 0; });
for (const [id, v] of [['fp-fwd', 1], ['fp-back', -1]]) {
  const b = document.getElementById(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); fp.thrust = v; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { fp.thrust = 0; });
}

/* ---------- UI wiring ---------- */
function toggleHUD() {
  const hidden = document.body.classList.toggle('hud-hidden');
  document.getElementById('btn-hud').classList.toggle('active', !hidden);
}
function applyFX() {
  const n = fxHigh ? Q.msaa : 0;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== n) { rt.samples = n; rt.dispose(); }
  lensPass.enabled = fxHigh;
  finishPass.uniforms.uCA.value = fxHigh ? 1 : 0;
  const b = document.getElementById('btn-fx');
  b.innerHTML = `<kbd>G</kbd>FX ${fxHigh ? 'HIGH' : 'LOW'}`; b.classList.toggle('active', fxHigh);
}
function toggleFX() { fxHigh = !fxHigh; applyFX(); }

/* ---------- holographic landmark markers (screen-space, occluded by the Earth) ---------- */
const markerEls = [], mkV = new THREE.Vector3(), mkD = new THREE.Vector3(), mkFwd = new THREE.Vector3();
let mkTextT = 1;
function buildMarkers() {
  const wrap = document.getElementById('markers');
  landmarks.forEach((lm, i) => {
    if (lm.key === 'overview') return;
    const el = document.createElement('div'); el.className = 'mk';
    el.innerHTML = `<b></b><span class="mk-l"><em>${String(i + 1).padStart(2, '0')}</em>${lm.name}<small>—</small></span>`;
    el.addEventListener('click', () => { if (mode !== 'explore') setMode('explore'); flyTo(lm); });
    wrap.appendChild(el);
    markerEls.push({ lm, el, dist: el.querySelector('small'), on: false });
  });
}
function updateMarkers(dt) {
  const show = mode !== 'intro' && mode !== 'attract' && mode !== 'story' && !fly && !document.body.classList.contains('hud-hidden');
  camera.getWorldDirection(mkFwd);
  mkTextT += dt; const txt = mkTextT > 0.25; if (txt) mkTextT = 0;
  for (const m of markerEls) {
    const p = m.lm.pos(), dist = camera.position.distanceTo(p);
    let vis = show && !(focus === m.lm && dist < m.lm.radius * 8);
    if (vis) {
      mkD.subVectors(p, camera.position);
      if (mkD.dot(mkFwd) <= 0) vis = false;
      else {
        const t = clamp(-camera.position.dot(mkD) / mkD.lengthSq(), 0, 1);
        if (mkV.copy(camera.position).addScaledVector(mkD, t).length() < R * 0.995) vis = false;   // behind the planet
      }
    }
    if (vis) {
      mkV.copy(p).project(camera);
      const x = (mkV.x * 0.5 + 0.5) * innerWidth, y = (-mkV.y * 0.5 + 0.5) * innerHeight;
      if (x < 0 || x > innerWidth - 40 || y < 30 || y > innerHeight) vis = false;
      else m.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
    if (vis !== m.on) { m.on = vis; m.el.classList.toggle('on', vis); }
    if (vis && txt) m.dist.textContent = fmtKm(dist * KM_PER_UNIT);
  }
}

const SHORT = { overview: 'Earth', engines: 'Engines', steering: 'Steering', elevator: 'Elevator', station: 'Apex', habitat: 'Habitat', mining: 'Mining', comm: 'Array', moon: 'Luna' };
const SECTORS = [
  { name: 'AMERICAS', test: (lat, lon) => lon < -30 },
  { name: 'EUROPE', test: (lat, lon) => lon >= -30 && lon < 60 && lat >= 35 },
  { name: 'AFRICA', test: (lat, lon) => lon >= -30 && lon < 60 && lat < 35 },
  { name: 'ASIA', test: (lat, lon) => lon >= 60 && lat >= -10 },
  { name: 'OCEANIA', test: (lat, lon) => lon >= 60 && lat < -10 },
];
let meterCells = [], sectorEls = [];
function buildUI() {
  const marks = document.getElementById('marks');
  landmarks.forEach((lm, i) => {
    const b = document.createElement('button'); b.className = 'btn'; b.dataset.key = lm.key; b.title = lm.name;
    b.innerHTML = `<kbd>${i + 1}</kbd>${SHORT[lm.key] || lm.name}`;
    b.addEventListener('click', () => { if (mode !== 'explore') setMode('explore'); flyTo(lm); });
    marks.appendChild(b);
  });
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.getElementById('btn-hud').addEventListener('click', toggleHUD);
  document.getElementById('btn-fx').addEventListener('click', toggleFX);
  document.getElementById('btn-hud').classList.add('active');
  const meter = document.getElementById('h-meter');
  for (let i = 0; i < 24; i++) meterCells.push(meter.appendChild(document.createElement('i')));
  const counts = SECTORS.map(() => 0);
  for (const e of engines) { const lat = e.v * 180 - 90, lon = e.u * 360 - 180; const k = SECTORS.findIndex(s => s.test(lat, lon)); if (k >= 0) counts[k]++; }
  const max = Math.max(1, ...counts), wrap = document.getElementById('h-sectors');
  SECTORS.forEach((s, k) => {
    const row = document.createElement('div'); row.className = 'sector';
    row.innerHTML = `<span>${s.name}</span><div class="bar"><i></i></div><span>0%</span>`;
    wrap.appendChild(row);
    sectorEls.push({ bar: row.querySelector('i'), val: row.lastElementChild, share: counts[k] / max, seed: rand() * 10 });
  });
  // static trajectory: Earth → Jupiter transfer arc
  const pts = []; for (let i = 0; i <= 60; i++) { const [x, y] = spiralAt(i / 60); pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`); }
  document.getElementById('o-spiral').setAttribute('d', pts.join(''));
  const [jx, jy] = spiralAt(1); const jup = document.getElementById('o-jup'); jup.setAttribute('cx', jx); jup.setAttribute('cy', jy);
}
function spiralAt(f) { const th = Math.PI / 2 * (1 - f), r = 30 + 66 * Math.pow(f, 1.15); return [70 + Math.cos(th) * r, 59 + Math.sin(th) * r, th]; }

/* =====================================================================
   Init
   ===================================================================== */
async function init() {
  step(0.02, 'CALIBRATING DEEP-SPACE OPTICS'); await nextFrame();
  await Promise.all([loadSky(), loadMaterials(), loadModels()]);
  buildSky();
  scene.environment = buildEnvironment();
  step(0.06, 'RECEIVING ORBITAL SURVEY');
  const moonP = loadTex(TEX + 'moon_1024.jpg', true);
  let T = null;
  if (Q.hd) {
    const [day, night, surf] = await Promise.all([loadTex(TEX_HD + 'earth_day_4096.jpg', true), loadTex(TEX_HD + 'earth_night_4096.jpg', true), loadTex(TEX_HD + 'earth_bump_roughness_clouds_4096.jpg', false)]);
    const s = day && surf ? imageSampler(surf.image) : null;
    if (s) { T = { day, night: night || blackTex(), surf }; landAt = (u, v) => s(u, v, 1) > 0.3; }
  }
  if (!T) {
    const [day, spec, clouds, night] = await Promise.all([loadTex(TEX + 'earth_atmos_2048.jpg', true), loadTex(TEX + 'earth_specular_2048.jpg', false), loadTex(TEX + 'earth_clouds_1024.png', false), loadTex(TEX + 'earth_lights_2048.png', true)]);
    try {
      const s = day && spec && clouds ? imageSampler(spec.image) : null;
      if (s) { T = { day, night: night || blackTex(), surf: packSurf(spec.image, clouds.image) }; landAt = (u, v) => s(u, v) < 0.5; }
    } catch (err) { console.warn('Surface maps unreadable, synthesising terrain', err); T = null; }
  }
  if (!T) {
    step(0.5, 'SURVEY LINK DOWN · SYNTHESISING TERRAIN'); await nextFrame();
    const P = proceduralEarth(); T = { day: P.day, night: P.night, surf: P.surf }; landAt = P.land;
  }
  const moonTex = await moonP;
  step(0.52, 'SURVEYING CONTINENTAL BEDROCK'); await nextFrame();
  placeEngines(); placeSteering(); uHero.value.copy(heroDir); T.glow = buildGlowTexture(); buildEarth(T);
  step(0.6, 'FABRICATING PLANETARY ENGINES · GLTF'); await nextFrame();
  let engineGeo;
  try { const { gltf } = await exportAndLoadGLB(buildEngineSource()); engineGeo = engineGeometryFromGLTF(gltf.scene); }
  catch (err) { console.warn('GLB round-trip failed, using source geometry', err); engineGeo = engineGeometryFromGLTF(buildEngineSource()); }
  buildEngines(engineGeo); buildSteering(engineGeo);
  step(0.7, 'RAISING SPACE ELEVATOR'); await nextFrame();
  buildElevator();
  step(0.78, 'DEPLOYING ORBITAL INFRASTRUCTURE'); await nextFrame();
  buildMining(); buildHabitats(); buildComm(); buildMoon(moonTex);
  step(0.86, 'ROUTING ORBITAL TRAFFIC'); await nextFrame();
  buildSatellites(); buildShips(); buildDust(); buildJupiter(); buildPlume();
  defineLandmarks(); buildUI(); buildMarkers(); buildStoryUI();
  applyFX();
  step(0.94, 'COMPILING SHADERS'); await nextFrame();
  updateWorld(0, 0);
  applyWorld();
  updateCamera(0);
  updateLighting(0);
  composer.render(0);
  step(1, 'IGNITION');
  await nextFrame();
  document.getElementById('loader').classList.add('done');
  window.__emReady = true;
  document.getElementById('start').classList.add('show');
  clock.start();
  requestAnimationFrame(loop);
}

/* =====================================================================
   Per-frame world update
   ===================================================================== */
const clock = new THREE.Clock(false);
const ZERO = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
const FLAME_ROT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), fq = new THREE.Quaternion(), sp = new THREE.Vector3(), sv = new THREE.Vector3(), ss = new THREE.Vector3(), fpPos = new THREE.Vector3();
const hubs = Array.from({ length: 6 }, () => new THREE.Vector3());
let climbUp = 0, climbDown = 0;

function orbitPos(r, inc, node, ang, out) {
  const x = Math.cos(ang) * r, z0 = Math.sin(ang) * r;
  const y = -z0 * Math.sin(inc), z = z0 * Math.cos(inc);
  return out.set(x * Math.cos(node) + z * Math.sin(node), y, -x * Math.sin(node) + z * Math.cos(node));
}
function setShip(i, pos, dir, s, flame) {
  sm.lookAt(dir, ZERO, Math.abs(dir.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : UPV); sq.setFromRotationMatrix(sm);
  ss.setScalar(s); sm.compose(pos, sq, ss); ships.setMatrixAt(i, sm);
  fq.copy(sq).multiply(FLAME_ROT);
  sv.set(0, 0, -1).applyQuaternion(sq).multiplyScalar(1.05 * s).add(pos);
  ss.set(0.32 * s, flame * s, 0.32 * s); sm.compose(sv, fq, ss); shipFlames.setMatrixAt(i, sm);
}
function updateShips(t) {
  hubs[0].copy(worldOf(elevator.userData.station));
  for (let k = 0; k < 3; k++) hubs[k + 1].copy(habitats[k].carrier.position);
  hubs[4].copy(MINE_POS); hubs[5].copy(COMM_POS);
  shipData.forEach((d, i) => {
    if (d.type === 'orbit') {
      const ang = d.ph + t * 0.15 * Math.pow(100 / d.r, 1.5);
      orbitPos(d.r, d.inc, d.node, ang, sp); orbitPos(d.r, d.inc, d.node, ang + 0.01, sv);
      sv.sub(sp).normalize(); setShip(i, sp, sv, d.s, 0.9);
    } else if (d.type === 'route') {
      const A = hubs[d.a], B = hubs[d.a === d.b ? (d.b + 3) % 6 : d.b];
      const f = (d.ph + t * d.sp) % 1, fade = smooth(0, 0.04, f) * smooth(1, 0.96, f);
      sp.lerpVectors(A, B, f).addScaledVector(d.off, Math.sin(Math.PI * f));
      sv.copy(A).add(B); if (sv.lengthSq() > 1) sp.addScaledVector(sv.normalize(), Math.sin(Math.PI * f) * 30);
      keepOutsideEarth(sp, 8);
      sv.subVectors(B, A).normalize(); setShip(i, sp, sv, d.s * Math.max(fade, 0.001), 2.6);
    } else {
      const f = (d.ph + t * d.sp) % 1, fade = smooth(0, 0.03, f) * smooth(1, 0.9, f);
      sp.copy(MIGRATION_DIR).multiplyScalar(140 + f * 1360).add(d.lane);
      setShip(i, sp, MIGRATION_DIR, d.s * Math.max(fade, 0.001), 3.2);
    }
  });
  ships.instanceMatrix.needsUpdate = true; shipFlames.instanceMatrix.needsUpdate = true;
}

function updateWorld(t, dt) {
  uTime.value = t;
  uPower.value = 0.93 + 0.04 * Math.sin(t * 0.37) + 0.015 * Math.sin(t * 1.7);
  earthSpin.rotation.y += dt * 0.012;
  cloudMesh.rotation.y += dt * 0.0025;
  cloudShift.value = -cloudMesh.rotation.y / (Math.PI * 2);
  cloudMesh.material.uniforms.uGlowShift.value = cloudMesh.rotation.y / (Math.PI * 2);
  for (const [ring, speed] of stationRings) ring.rotation.y += dt * speed;
  for (const h of habitats) {
    const a = h.phase + t * h.speed;
    h.carrier.position.set(Math.cos(a) * h.r, 0, Math.sin(a) * h.r).applyQuaternion(h.plane);
    h.spin[0].rotation.y += dt * 0.15; h.spin[1].rotation.y -= dt * 0.22;
  }
  climbUp = climbDown = 0;
  const y0 = 1.5, y1 = STATION_H - 15;
  if (elevator) elevator.children.forEach(o => { if (o.userData.flood) o.visible = true; });
  for (const c of climbers) {
    c.visible = true;
    const u = c.userData, f = (u.phase + t * u.speed) % 1;
    c.position.y = u.up ? y0 + f * (y1 - y0) : y1 - f * (y1 - y0);
    c.rotation.y += dt * 0.2;
    if (u.up) climbUp++; else climbDown++;
  }
  moonPivot.rotation.y += dt * 0.004; moon.rotation.y += dt * 0.01;
  asteroidField.rotation.y += dt * 0.006; miningRig.rotation.y += dt * 0.01;
  updateShips(t);
  for (const lm of landmarks) if (lm.proxy) lm.proxy.position.copy(lm.pos());
  // from orbit the engines are kilometres-small: show only their light, not geometry specks
  const alt = camera.position.length() - R;
  if (gantries) gantries.visible = engineMesh.visible;
  engineMesh.visible = exhaust.visible = alt < (engineMesh.visible ? 28 : 24);
  jetMat.uniforms.uFar.value = smooth(25, 150, alt);
  steerMesh.visible = steerBase.visible = alt < (steerMesh.visible ? 48 : 42);
  uSteerFar.value = smooth(60, 320, alt) * 0.6;
}

/* ---------- camera-dependent lighting & post FX ---------- */
const sunNdc = new THREE.Vector3(), camFwd = new THREE.Vector3(), fpFocus = new THREE.Vector3(), snapPt = new THREE.Vector3();
const SUN_RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
const SUN_UP = new THREE.Vector3().crossVectors(SUN_DIR, SUN_RIGHT);
function updateLighting(dt) {
  camera.updateMatrixWorld();
  camera.getWorldDirection(camFwd);
  const focusPt = mode === 'fp' ? fpFocus.copy(camera.position).addScaledVector(camFwd, 20) : controls.target;
  const dist = camera.position.distanceTo(focusPt);
  // near plane follows the viewing distance: depth precision where it matters, no z-fighting shimmer
  const near = mode === 'fp' ? 0.05 : clamp(dist * 0.004, 0.03, 1.5);
  if (Math.abs(camera.near - near) > near * 0.2) { camera.near = near; camera.updateProjectionMatrix(); }
  // shadow frustum: power-of-two extent + texel-snapped centre, so shadow edges never crawl or flicker
  const ext = clamp(2 ** Math.ceil(Math.log2(Math.max(dist * 0.8, 1))), 8, 256), sc = sunLight.shadow.camera;
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix(); }
  const texel = 2 * ext / Q.shadow;
  snapPt.copy(SUN_RIGHT).multiplyScalar(Math.round(focusPt.dot(SUN_RIGHT) / texel) * texel)
    .addScaledVector(SUN_UP, Math.round(focusPt.dot(SUN_UP) / texel) * texel)
    .addScaledVector(SUN_DIR, focusPt.dot(SUN_DIR));
  sunLight.target.position.copy(snapPt); sunLight.position.copy(snapPt).addScaledVector(SUN_DIR, 500);
  sunLight.shadow.normalBias = texel * 0.8;
  // the distant sky shares only the camera's orientation
  skyCam.quaternion.copy(camera.quaternion);
  if (skyCam.fov !== camera.fov || skyCam.aspect !== camera.aspect) { skyCam.fov = camera.fov; skyCam.aspect = camera.aspect; skyCam.updateProjectionMatrix(); }
  // lens: sun position on screen, softly occluded by the Earth's limb
  const FL = W.flareDir;
  sunNdc.copy(camera.position).addScaledVector(FL, 1000).project(camera);
  const front = camFwd.dot(FL);
  let vis = 0;
  if (front > 0) {
    const b = camera.position.dot(FL), closest = b < 0 ? Math.sqrt(Math.max(camera.position.lengthSq() - b * b, 0)) : Infinity;
    vis = smooth(R * 0.99, R * 1.07, closest) * (1 - smooth(0.9, 1.4, Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y)))) * smooth(0, 0.3, front) * W.flare;
  }
  const lu = lensPass.uniforms;
  lu.uVis.value += (vis - lu.uVis.value) * Math.min(1, dt * 6);
  lu.uSun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
  finishPass.uniforms.uTime.value = uTime.value; lu.uTime.value = uTime.value;
  // aerial perspective: everything near the ground sits inside the atmosphere
  updateAerial(haze, uSun.value, uLight.value, uBeta.value);
  uAerial.value.copy(uSun.value).multiplyScalar(uLight.value);
  uAerialAmt.value = 1 - smooth(20, 90, camera.position.length() - R);
}

/* ---------- HUD telemetry ---------- */
const $ = id => document.getElementById(id);
const fmtKm = km => km < 1e5 ? `${Math.round(km).toLocaleString('en-US')} km` : `${(km / 1e6).toFixed(2)}M km`;
let hudT = 0, fpsFrames = 0, fpsT0 = performance.now();
function updateHUD(t, dt) {
  fpsFrames++; const fpsDt = (performance.now() - fpsT0) / 1000;
  if (fpsDt >= 0.5) { $('h-fps').textContent = `${Math.round(fpsFrames / fpsDt)} fps`; fpsFrames = 0; fpsT0 = performance.now(); }
  hudT += dt; if (hudT < 0.2) return; hudT = 0;
  const now = new Date();
  $('h-utc').textContent = now.toISOString().slice(11, 19);
  $('h-day').textContent = `T+${String(Math.floor(1248 + t * 0.5)).padStart(4, '0')} D`;
  // voyage
  const f = Math.min(0.004 + t * 0.00005, 0.98), au = 1 + 4.2 * Math.pow(f, 1.15);
  const [ex, ey, th] = spiralAt(f);
  $('o-earth').setAttribute('cx', ex.toFixed(1)); $('o-earth').setAttribute('cy', ey.toFixed(1));
  $('h-au').textContent = `${au.toFixed(4)} AU`;
  $('h-vel').textContent = `${(29.78 + 2.4 * f + 0.004 * Math.sin(t * 0.7)).toFixed(2)} km/s`;
  $('h-ecl').textContent = `${((90 - th * 180 / Math.PI) % 360).toFixed(2)}° / ${(0.02 * Math.sin(t * 0.05)).toFixed(2)}°`;
  $('h-rot').textContent = `${(((earthSpin.rotation.y * 180 / Math.PI) % 360 + 360) % 360).toFixed(1)}°`;
  $('h-jup').textContent = `${Math.round((1 - f) * 540)} D`;
  $('h-flux').textContent = `${(100 / (au * au)).toFixed(1)}%`;
  $('h-prog').textContent = `${(0.512 + t * 0.00001).toFixed(3)}%`;
  // engines
  const pw = uPower.value;
  $('h-power').textContent = (pw * 100).toFixed(1);
  const on = Math.round(pw * 24); meterCells.forEach((c, i) => c.classList.toggle('on', i < on));
  $('h-active').textContent = `${(engines.length - 3 - Math.floor(2 * (1 + Math.sin(t * 0.21)))).toLocaleString('en-US')} / ${engines.length.toLocaleString('en-US')}`;
  $('h-thrust').textContent = `${(engines.length * 6.8e16 * pw).toExponential(2).replace('+', '')} N`;
  $('h-core').textContent = `${(3.9e8 * (0.95 + 0.05 * pw)).toExponential(3).replace('+', '')} K`;
  $('h-fuel').textContent = `${Math.max(0, 71.42 - t * 0.0005).toFixed(2)}%`;
  for (const s of sectorEls) {
    const out = clamp(pw * 100 * (0.97 + 0.03 * Math.sin(t * 0.6 + s.seed)), 0, 100);
    s.bar.style.width = `${(s.share * out).toFixed(1)}%`; s.val.textContent = `${out.toFixed(0)}%`;
  }
  // elevator
  $('h-up').textContent = climbUp; $('h-down').textContent = climbDown;
  $('h-tension').textContent = `${(86.5 + 1.2 * Math.sin(t * 0.3)).toFixed(1)}%`;
  const rem = Math.floor(180 - (t % 180));
  $('h-next').textContent = `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`;
  $('h-traffic').textContent = `${Q.ships.toLocaleString('en-US')} craft`;
  // observer
  $('h-focus').textContent = mode === 'fp' ? 'FREE FLIGHT' : focus ? focus.name : 'FREE';
  $('h-alt').textContent = fmtKm(Math.max(0, camera.position.length() - R) * KM_PER_UNIT);
  $('h-range').textContent = mode === 'fp' ? '—' : fmtKm(camera.position.distanceTo(controls.target) * KM_PER_UNIT);
}

/* =====================================================================
   VIEWING MODE — "The Journey": a directed film of the whole migration.
   Chapters drive the world state (ignition wave, sun size, freeze,
   Jupiter, plume, destination star), the camera, subtitles and sound.
   Everything is a pure function of the story clock, so seeking and
   replays always frame identically.
   ===================================================================== */
const W0 = { atmoI: 16, jupDir: JUP_DIR, steer: 10, ignite: 10, freeze: 0, light: 1, sunScale: 1, sunBoost: 1, exposure: 1, jupiter: 0, plume: 0, star: 0, flareDir: SUN_DIR, flare: 1, far: 3000, skyGiant: 1, heroAge: 1e4, steerAge: 1e4, shock: 0, shockAt: 'hero' };
const W = { ...W0 };
function applyWorld() {
  atmoMesh.material.uniforms.uSunI.value = W.atmoI;
  heroAge.value = W.heroAge; steerAge.value = W.steerAge;
  steerLight.intensity = W.steer > 0.05 ? 140 * Math.min(1, W.steerAge < 1e3 ? W.steerAge / 0.4 : 1) : 0;
  { const d = W.shockAt === 'steer' ? steerers[0].dir : heroDir; shock.set(d.clone().multiplyScalar(R), d, W.shock, W.shockAt === 'steer' ? 34 : 48); }
  uSteer.value = W.steer; uIgnite.value = W.ignite; uFreeze.value = W.freeze; uLight.value = W.light; sunBoost.value = W.sunBoost;
  sunMesh.scale.setScalar(W.sunScale);
  sunLight.intensity = 5.2 * W.light;
  renderer.toneMappingExposure = W.exposure * EXPOSURE;
  jupiter.visible = W.jupiter > 0; if (jupiter.visible) jupiter.position.copy(W.jupDir).multiplyScalar(W.jupiter);
  plume.visible = W.plume > 0.002; plume.material.uniforms.uAmt.value = W.plume;
  centauri.visible = W.star > 0.002; centauri.material.uniforms.uStar.value = W.star;
  for (const o of skyGiant) o.visible = W.skyGiant > 0.5;
  for (const o of diagram) o.visible = !story.on;
  if (camera.far !== W.far) { camera.far = W.far; camera.updateProjectionMatrix(); }
}

/* ---------- procedural soundtrack (Web Audio; starts on the user's click) ---------- */
const Sound = (() => {
  let ctx = null, master, drone, rumble, pad, crackle, muted = false;
  const to = (p, v, tc) => p.setTargetAtTime(v, ctx.currentTime, tc);
  function init() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp).connect(ctx.destination);
    // rumble: brown noise through a low-pass — the planet-sized engine roar
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    rumble = ctx.createGain(); rumble.gain.value = 0; src.connect(lp).connect(rumble).connect(master); src.start();
    // drone: detuned saws under a slowly breathing filter
    drone = ctx.createGain(); drone.gain.value = 0;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 300; dlp.Q.value = 2;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.05; lfoG.gain.value = 140; lfo.connect(lfoG).connect(dlp.frequency); lfo.start();
    for (const fq of [41.2, 41.5, 61.7, 82.4, 82.9]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq; const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g).connect(dlp); o.start(); }
    dlp.connect(drone).connect(master);
    // pad: a soft, slowly shimmering chord
    pad = ctx.createGain(); pad.gain.value = 0;
    for (const fq of [146.8, 220, 277.2, 329.6, 440]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fq;
      const g = ctx.createGain(); g.gain.value = 0.035;
      const t = ctx.createOscillator(), tg = ctx.createGain(); t.frequency.value = 0.07 + Math.random() * 0.1; tg.gain.value = 0.02; t.connect(tg).connect(g.gain); t.start();
      o.connect(g).connect(pad); o.start();
    }
    pad.connect(master);
    // crackle: the harsh, popping shock-train of a huge rocket exhaust — sparse random impulses, band-passed
    const cl = ctx.sampleRate * 3, cb = ctx.createBuffer(2, cl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = cb.getChannelData(c); let env = 0, sgn = 1;
      for (let i = 0; i < cl; i++) { if (Math.random() < 0.0016) { env = Math.random() ** 2; sgn = -sgn; } env *= 0.985; d[i] = (sgn * env * 0.9 + (Math.random() * 2 - 1) * 0.04) * (0.6 + 0.4 * Math.sin(i / cl * Math.PI * 6)); } }
    const cs = ctx.createBufferSource(); cs.buffer = cb; cs.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 3200;
    crackle = ctx.createGain(); crackle.gain.value = 0; cs.connect(bp).connect(lp2).connect(crackle).connect(master); cs.start();
  }
  return {
    start() { try { if (!ctx) init(); if (!ctx) return; ctx.resume(); to(master.gain, muted ? 0 : 0.9, 0.6); } catch (e) { console.warn('Audio unavailable', e); } },
    level(d, r, p, c = 0) { if (!ctx) return; to(drone.gain, d * 0.6, 1.2); to(rumble.gain, r * 0.9, 1.2); to(pad.gain, p * 0.5, 1.5); to(crackle.gain, c * 0.35, 0.8); },
    crack(c) { if (ctx) to(crackle.gain, c * 0.35, 0.25); },
    boom(f0 = 70) {
      if (!ctx) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.37, t + 2.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      o.connect(g).connect(master); o.start(t); o.stop(t + 4.2); to(rumble.gain, 0.95, 0.3);
    },
    stop() { if (ctx) to(master.gain, 0, 0.5); },
    toggle() { muted = !muted; if (ctx) to(master.gain, muted ? 0 : 0.9, 0.2); return !muted; },
  };
})();

/* ---------- camera helpers ---------- */
const Y = new THREE.Vector3(0, 1, 0), V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PERP = new THREE.Vector3().crossVectors(SUN_DIR, Y).normalize();
const SIDE = new THREE.Vector3().crossVectors(MIGRATION_DIR, Y).normalize();
const LM = key => landmarks.find(l => l.key === key);
const heroAt = a => heroDir.clone().applyAxisAngle(Y, a).applyQuaternion(earthTilt.quaternion);   // hero direction (world) for a given spin
const stationWorld = () => elevator.userData.station.getWorldPosition(V());
const SUB = (at, text, dur = 5.5) => ({ at, text, dur });

/* ---------- the script: one minute, six beats ---------- */
const dirAt = (local, a) => local.clone().applyAxisAngle(Y, a).applyQuaternion(earthTilt.quaternion);   // earth-local direction → world, for a given spin
const spinOf = (local, cost) => { let best = 0, bc = Infinity; for (let i = 0; i < 720; i++) { const a = i / 720 * Math.PI * 2, c = cost(dirAt(local, a)); if (c < bc) { bc = c; best = a; } } return best; };
const NORTH = () => Y.clone().applyQuaternion(earthTilt.quaternion);
const elevW = (x, y, z) => elevator.localToWorld(V(x, y, z));
const rideY = u => 7 * Math.pow((STATION_H - 16) / 7, Math.sin(clamp(u / 0.95, 0, 1) * Math.PI / 2));   // log-height: a hard launch that eases into the station
const shakeOf = (t0, amp, decay = 0.9, floor = 0.0006) => ts => ts < t0 ? 0 : amp * Math.exp(-(ts - t0) * decay) + floor;
const CHAPTERS = [
  { num: '01', title: 'The Dying Sun', year: '2061', dur: 8, sound: [0.45, 0.12, 0.45], spin: () => -1.55, spinRate: 0.012,
    state: (t, w) => {
      w.ignite = 0; w.steer = 0; w.exposure = 1.1; w.heroAge = 0;
      if (t < 4.2) { w.sunScale = 6.4 + t * 0.45; w.sunBoost = 0.022 * (1 + 0.12 * Math.sin(t * 3)) * (1 + Math.max(0, t - 2.6) * 1.6); }   // a slow swell, never a white-out
      else { w.sunScale = 2.6; w.sunBoost = 1.2; w.atmoI = 55; }
    },
    shots: [
      { dur: 4.2, fadeIn: 0.8, fadeOut: 0.6, cam: u => { const pos = SUN_DIR.clone().multiplyScalar(R + 260); return { pos, target: pos.clone().addScaledVector(SUN_DIR, 1000).addScaledVector(Y, 6 * (1 - u)), fov: 13 - 3 * u }; } },
      { dur: 3.8, fadeIn: 0.7, cam: u => { const e = easeInOut(u), d = 600 - 110 * e, x = 122 * smooth(0.15, 1.0, u);
        return { pos: SUN_DIR.clone().multiplyScalar(-d).addScaledVector(PERP, x).addScaledVector(Y, 12), target: PERP.clone().multiplyScalar(x * 0.15), fov: 38 }; } },
    ],
    subs: [SUB(0.4, '2061. The Sun is dying.', 3.4), SUB(4.6, 'So we will take the Earth with us.', 3.3)] },

  { num: '02', title: 'Ignition', year: 'YEAR 0', dur: 12, sound: [0.25, 0.12, 0.25], spinRate: 0,
    spin: () => spinOf(heroDir, h => -h.dot(SUN_DIR.clone().multiplyScalar(-0.42).addScaledVector(PERP, 0.9).normalize())),
    state: (t, w) => { w.steer = 0; w.steerAge = 0; w.heroAge = t - 1.8; w.shock = clamp((t - 1.85) / 3.8, 0, 1); w.exposure = 1.15; w.ignite = t < 1.8 ? 0 : t < 5.5 ? 0.075 * smooth(1.8, 4.6, t) : 0.075 + 3.25 * easeInOut(clamp((t - 5.5) / 6.5, 0, 1)); },
    events: [{ at: 1.8, fn: () => { Sound.boom(); Sound.crack(1); } }, { at: 5.6, fn: () => Sound.level(0.4, 0.95, 0.2, 0.25) }],
    shots: [
      { dur: 5.5, fadeIn: 0.6, fadeOut: 0.25, shake: shakeOf(1.8, 0.006, 1.1),
        cam: u => {   // low and close, looking toward the hidden sun: the towers stand in silhouette against the twilight band
          const c = worldOf(earthSpin, heroDir.clone().multiplyScalar(R)), up = c.clone().normalize();
          const sp = SUN_DIR.clone().addScaledVector(up, -SUN_DIR.dot(up)).normalize(), sd = V().crossVectors(up, sp);
          const e = easeInOut(u), back = sp.clone().multiplyScalar(-Math.cos(0.35 + 0.1 * u)).addScaledVector(sd, Math.sin(0.35 + 0.1 * u));
          const pos = c.clone().addScaledVector(back, 13 - 3 * e).addScaledVector(up, 0.75 + 0.35 * e);
          return { pos, target: c.clone().addScaledVector(up, 2.6 + 2.6 * smooth(0.3, 0.85, u)), up, fov: 48 - 6 * e }; } },
      { dur: 6.5, fadeIn: 0.25, cam: u => { const h = heroAt(earthSpin.rotation.y), e = easeInOut(u), side = V().crossVectors(h, Y).normalize();
        return { pos: h.clone().multiplyScalar(R + 140 + 220 * e).addScaledVector(side, 60 + 40 * e).addScaledVector(Y, -40 * e), target: h.clone().multiplyScalar(R * 0.75 * (1 - e)), fov: 40 }; } },
    ],
    subs: [SUB(2.0, 'Ignition.', 3.2), SUB(6.0, '12,000 planetary engines light up, continent by continent.', 5.6)] },

  { num: '03', title: 'Turning the World', year: 'YEAR 0 · DAY 3', dur: 11, sound: [0.5, 0.9, 0.2], spinRate: 0,
    spin: () => spinOf(steerers[0].dir, h => { const e = V().crossVectors(NORTH(), h).normalize(); return (h.dot(SUN_DIR) + 0.1) ** 2 + 0.3 * (e.dot(SUN_DIR) + 0.7) ** 2; }),
    state: (t, w) => { w.exposure = 1.15; w.steerAge = t - 0.7; w.shock = clamp((t - 0.75) / 3.2, 0, 1); w.shockAt = 'steer'; w.steer = t < 0.7 ? 0 : 0.002 + Math.PI * easeInOut(clamp((t - 0.7) / 8.5, 0, 1)); },
    events: [{ at: 0.7, fn: () => { Sound.boom(52); Sound.crack(0.8); } }, { at: 6.0, fn: () => Sound.crack(0.2) }],
    shots: [
      { dur: 5.6, fadeIn: 0.35, fadeOut: 0.25, shake: shakeOf(0.7, 0.007, 0.8, 0.0012),
        cam: u => { const p = earthSpin.localToWorld(steerers[0].dir.clone().multiplyScalar(R)), up = p.clone().normalize(), N = NORTH(), e = V().crossVectors(N, up).normalize();
          const pos = p.clone().addScaledVector(e, -15 + 3 * u).addScaledVector(N, 11).addScaledVector(up, 1.0 + 0.4 * u);   // low, looking up: the towers loom
          return { pos, target: p.clone().addScaledVector(e, 8).addScaledVector(up, 8.5).addScaledVector(N, -1), up, fov: 44 - 4 * u }; } },
      { dur: 5.4, fadeIn: 0.25, cam: u => { const N = NORTH(), g = SUN_DIR.clone().multiplyScalar(-0.75).addScaledVector(PERP, 0.66).normalize(), e = easeInOut(u);
        return { pos: g.multiplyScalar(300 - 40 * e).addScaledVector(N, 105 - 25 * e), target: N.clone().multiplyScalar(-10), fov: 42 }; } },
    ],
    subs: [SUB(1.0, 'Equatorial steering engines.', 3.8), SUB(5.9, 'For the first time in 4.5 billion years, the Earth stops turning.', 4.9)] },

  { num: '04', title: 'The Space Elevator', year: 'YEAR 1', dur: 12, sound: [0.5, 0.75, 0.35], spinRate: 0,
    spin: () => spinOf(elevatorDir, h => (h.dot(SUN_DIR) - 0.22) ** 2 + 0.2 * (h.dot(PERP) - 0.9) ** 2),
    state: (t, w) => {
      w.sunScale = 0.8; const y = rideY(t / 12); climbers[0].visible = false;   // the camera rides the tether itself
      for (let i = 1; i < climbers.length; i++) if (Math.abs(climbers[i].position.y - y) < 10 + y * 0.08) climbers[i].visible = false;
      elevator.children.forEach(o => { if (o.userData.flood) o.visible = y > 40; });
    },
    events: [{ at: 0.4, fn: () => Sound.boom(95) }],
    shots: [
      { dur: 12, fadeIn: 0.35, fadeOut: 0.45, shake: ts => 0.004 * Math.exp(-ts * 1.1) + 0.0005,
        cam: u => {
          const y = rideY(u), d = 3.2 + y * 0.018, az = 0.6 + 0.8 * u, up = elevW(0, 1, 0).sub(elevW(0, 0, 0)).normalize();
          const pos = elevW(Math.cos(az) * d, y, Math.sin(az) * d), toAxis = elevW(0, y, 0).sub(pos).normalize();
          // look up the tether at lift-off → down at the curving Earth mid-climb → up at the station on arrival
          let p = 1.05 - 2.05 * smooth(0.03, 0.17, u); p += (0.9 - p) * smooth(0.66, 0.9, u);
          const fwd = toAxis.multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p));
          return { pos, target: pos.clone().addScaledVector(fwd, 20), up, fov: 50 - 8 * u };
        } },
    ],
    subs: [SUB(0.6, 'Space elevator · 36,000 km to geostationary orbit.', 4.2), SUB(5.2, 'One continuous climb, from the equator to the stars.', 3.6), SUB(9.3, 'Tianshu Apex Station.', 2.4)] },

  { num: '05', title: 'Jupiter', year: 'YEAR 17', dur: 10, sound: [0.85, 0.45, 0.15], spinRate: 0,
    spin: () => spinOf(heroDir, h => { const b = h.dot(SUN_DIR) + 0.07; return b * b - 0.05 * h.dot(JUP_DIR); }),
    state: (t, w) => {
      if (t >= 4) { const h = heroAt(earthSpin.rotation.y), tj = V().crossVectors(SUN_DIR, h).normalize(); w.jupDir = tj.multiplyScalar(Math.cos(0.02)).addScaledVector(h, Math.sin(0.02)).normalize(); }
      w.jupiter = t < 4 ? 20000 - 13000 * easeInOut(t / 4) : 7000 - 2800 * easeInOut((t - 4) / 6);
      w.plume = 1; w.sunScale = 0.32; w.light = 0.8; w.exposure = 1.05; w.far = 60000; w.skyGiant = 0;
    },
    shots: [
      { dur: 4, fadeIn: 0.4, fadeOut: 0.3, cam: u => ({ pos: JUP_DIR.clone().multiplyScalar(-330).addScaledVector(Y, 80).addScaledVector(JUP_SIDE, -120 + 40 * u), target: JUP_DIR.clone().multiplyScalar(1500), fov: 46 }) },
      { dur: 6, fadeIn: 0.3, shake: () => 0.0008, cam: u => { const h = heroAt(earthSpin.rotation.y), tj = W.jupDir.clone().addScaledVector(h, -W.jupDir.dot(h)).normalize(), e = easeInOut(u);
        const pos = h.clone().multiplyScalar(R + 6 + 2 * e).addScaledVector(tj, -14 + 5 * e), pitch = -0.2 + 0.06 * e, fwd = tj.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(h, Math.sin(pitch));
        return { pos, target: pos.clone().addScaledVector(fwd, 100), up: h, fov: 50 }; } },
    ],
    subs: [SUB(0.5, 'Year 17 · Jupiter.', 3.2), SUB(4.4, 'Its gravity flings us out of the Solar System.', 5.4)] },

  { num: '06', title: 'The Long Night', year: 'YEAR 2500', dur: 9, sound: [0.35, 0.25, 0.95], spinRate: 0.01, titleAt: 5.0,
    spin: () => spinOf(heroDir, h => -h.dot(SUN_DIR.clone().multiplyScalar(-0.6).addScaledVector(PERP, 0.8).normalize())),
    state: (t, w) => { w.freeze = 1; w.steer = 0; w.plume = 0.45; w.sunScale = 0.07; w.sunBoost = 2.2; w.light = 0.3; w.exposure = 1.1; w.star = 0.3 + 0.7 * smooth(0, 6, t); w.flareDir = MIGRATION_DIR; w.flare = 0.8; w.far = 20000; },
    shots: [
      { dur: 4, fadeIn: 0.5, fadeOut: 0.3, cam: u => { const g = SUN_DIR.clone().multiplyScalar(-0.6).addScaledVector(PERP, 0.8), a = Math.atan2(g.x, g.z) + 0.12 * u;
        return { pos: V(Math.sin(a) * 300, 85 - 10 * u, Math.cos(a) * 300), target: V(0, -8, 0), fov: 42 }; } },
      { dur: 5, fadeIn: 0.3, fadeOut: 1.4, cam: u => { const e = easeInOut(u), dir = MIGRATION_DIR.clone().multiplyScalar(-0.35).addScaledVector(SIDE, 0.85).addScaledVector(Y, 0.4).normalize();
        return { pos: dir.multiplyScalar(380 * Math.pow(16, e)), target: MIGRATION_DIR.clone().multiplyScalar(-380 * e), fov: 40 }; } },
    ],
    subs: [SUB(0.4, 'Frozen, dark — and still burning. Destination: Proxima Centauri.', 4.6)] },
];
const chStart = []; let STORY_LEN = 0; for (const c of CHAPTERS) { chStart.push(STORY_LEN); STORY_LEN += c.dur; }

/* ---------- director ---------- */
let startOpen = true, attractT = 0, subT = 0, cardT = 0, idleT = 0;
const story = { on: false, t: 0, paused: false, ended: false, ch: -1, sub: null, fired: new Set() };
const $s = id => document.getElementById(id);
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function storyLocate(t) { let i = CHAPTERS.length - 1; while (i > 0 && t < chStart[i]) i--; return [i, t - chStart[i]]; }
function enterChapter(ci) {
  const c = CHAPTERS[ci]; story.ch = ci;
  if (c._spin === undefined) c._spin = c.spin();
  for (const id of [...story.fired]) if (id.startsWith(ci + ':')) story.fired.delete(id);
  $s('stc-num').textContent = `CHAPTER ${c.num}`; $s('stc-title').textContent = c.title; $s('stc-year').textContent = c.year;
  const card = $s('st-card'); card.classList.add('show'); clearTimeout(cardT); cardT = setTimeout(() => card.classList.remove('show'), 2700);
  document.querySelectorAll('#sb-ticks button').forEach((b, i) => b.classList.toggle('on', i === ci));
  Sound.level(...c.sound);
}
function setSub(text) {
  if (text === story.sub) return;
  story.sub = text; const el = $s('st-sub'); el.classList.remove('show');
  clearTimeout(subT); subT = setTimeout(() => { el.textContent = text; if (text) el.classList.add('show'); }, 380);
}
function updateStory(dt) {
  Object.assign(W, W0);
  if (!story.on) return;
  if (!story.paused && !story.ended) story.t += dt;
  if (story.t >= STORY_LEN) { story.t = STORY_LEN - 0.001; if (!story.ended) endStory(); }
  const [ci, tc] = storyLocate(story.t), c = CHAPTERS[ci];
  if (ci !== story.ch) enterChapter(ci);
  earthSpin.rotation.y = c._spin + tc * c.spinRate;
  earthTilt.updateMatrixWorld(true);
  c.state(tc, W);
  (c.events || []).forEach((ev, k) => { const id = ci + ':' + k; if (tc >= ev.at && !story.fired.has(id)) { story.fired.add(id); if (tc - ev.at < 0.5) ev.fn(); } });
  let acc = 0, si = 0; while (si < c.shots.length - 1 && tc >= acc + c.shots[si].dur) acc += c.shots[si++].dur;
  const sh = c.shots[si], ts = tc - acc, v = sh.cam(clamp(ts / sh.dur, 0, 1));
  camera.up.copy(v.up || Y); camera.position.copy(v.pos); controls.target.copy(v.target); camera.lookAt(v.target);
  if (sh.shake) { const k = sh.shake(ts), q = story.t * 31; camera.rotateX(k * (Math.sin(q * 1.7) + 0.5 * Math.sin(q * 4.3))); camera.rotateY(k * (Math.sin(q * 1.3 + 2) + 0.5 * Math.sin(q * 3.7 + 1))); }
  const fov = v.fov || 45; if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); updatePointScale(); }
  const fin = sh.fadeIn ? 1 - ts / sh.fadeIn : 0, fout = sh.fadeOut ? 1 - (sh.dur - ts) / sh.fadeOut : 0;
  const fade = $s('fade'); fade.style.opacity = clamp(Math.max(fin, fout), 0, 1).toFixed(3);
  fade.style.background = (fout > fin ? sh.outColor : sh.inColor) || '#000';
  const s = (c.subs || []).find(x => tc >= x.at && tc < x.at + x.dur); setSub(s ? s.text : '');
  const titleOn = c.titleAt !== undefined && tc >= c.titleAt && !story.ended;
  $s('st-title').classList.toggle('show', titleOn);
  if (titleOn) $s('st-card').classList.remove('show');
  $s('sb-fill').style.width = (story.t / STORY_LEN * 100).toFixed(2) + '%';
  $s('sb-time').textContent = `${fmtT(story.t)} / ${fmtT(STORY_LEN)}`;
  idleT += dt; if (idleT > 2.8) $s('story').classList.remove('active');
}
function hideStart() { startOpen = false; $s('start').classList.remove('show'); }
function startStory() {
  hideStart(); $s('end').classList.remove('show');
  Object.assign(story, { on: true, t: 0, paused: false, ended: false, ch: -1, sub: null }); story.fired.clear();
  fly = null; focus = null; followLocal = null;
  setMode('story'); Sound.start(); updatePlayBtn(); poke();
}
function endStory() { story.ended = true; $s('end').classList.add('show'); Sound.level(0, 0, 0.25); setSub(''); }
function exitStory() {
  story.on = false; story.ended = false; $s('end').classList.remove('show'); $s('fade').style.opacity = 0; $s('st-title').classList.remove('show'); setSub('');
  Object.assign(W, W0); Sound.stop();
  camera.up.set(0, 1, 0); camera.fov = 45; camera.updateProjectionMatrix(); updatePointScale();
  startExplore(0);
}
function startExplore(index = 0) {
  hideStart(); $s('hud').classList.add('on');
  tourIndex = index; mode = 'explore'; setMode('cinematic');
}
function seekTo(t) { story.t = clamp(t, 0, STORY_LEN - 0.01); story.ended = false; $s('end').classList.remove('show'); if (story.paused) Sound.level(0, 0, 0); }
function seekChapter(dir) {
  const [ci, tc] = storyLocate(story.t);
  const ni = dir > 0 ? ci + 1 : (tc > 3 ? ci : ci - 1);
  if (ni >= CHAPTERS.length) { story.t = STORY_LEN - 0.01; return; }
  story.ch = -1; seekTo(chStart[Math.max(0, ni)] + 0.01);
}
function updatePlayBtn() { $s('sb-play').textContent = story.paused ? '▶ PLAY' : '❚❚ PAUSE'; }
function togglePause() { story.paused = !story.paused; updatePlayBtn(); if (!story.paused) Sound.level(...CHAPTERS[Math.max(0, story.ch)].sound); else Sound.level(0.15, 0.05, 0.15); }
function toggleSound() { $s('sb-sound').textContent = Sound.toggle() ? 'SOUND ON' : 'SOUND OFF'; }
function poke() { idleT = 0; $s('story').classList.add('active'); }
function storyKey(e) {
  poke();
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.code === 'ArrowRight') seekChapter(1);
  else if (e.code === 'ArrowLeft') seekChapter(-1);
  else if (e.code === 'Escape') exitStory();
  else if (e.code === 'KeyM') toggleSound();
}
function buildStoryUI() {
  const ticks = $s('sb-ticks');
  CHAPTERS.forEach((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.style.left = (chStart[i] / STORY_LEN * 100) + '%';
    b.innerHTML = `<span><b>${c.num}</b><em> ${c.title}</em></span>`; b.title = `Chapter ${c.num} · ${c.title}`;
    b.addEventListener('click', e => { e.stopPropagation(); story.ch = -1; seekTo(chStart[i] + 0.01); });
    ticks.appendChild(b);
  });
  $s('sb-track').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); story.ch = -1; seekTo((e.clientX - r.left) / r.width * STORY_LEN); });
  const click = (id, fn) => $s(id).addEventListener('click', e => { fn(); e.currentTarget.blur(); poke(); });
  click('sb-play', togglePause); click('sb-prev', () => seekChapter(-1)); click('sb-next', () => seekChapter(1));
  click('sb-sound', toggleSound); click('sb-exit', exitStory);
  click('btn-watch', startStory); click('btn-explore', () => startExplore(0));
  click('btn-again', startStory); click('btn-explore2', exitStory);
  click('btn-journey', startStory);
  addEventListener('pointermove', () => { if (story.on) poke(); });
  addEventListener('pointerdown', () => { if (story.on) poke(); });
}

/* ---------- adaptive resolution: hold a smooth frame rate on any GPU ---------- */
let renderScale = 1, perfT = 0, perfN = 0, perfHold = 3;
function setRenderScale(s) {
  renderScale = s;
  const pr = Q.dpr * s;
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
  updatePointScale();
}
function adaptQuality(raw) {
  if (raw > 0.5) return;                       // tab was hidden / stalled — not a real frame time
  if (perfHold > 0) { perfHold -= raw; return; }
  perfT += raw; perfN++;
  if (perfT < 2) return;
  const fps = perfN / perfT; perfT = 0; perfN = 0;
  if (fps < 42 && renderScale > 0.55) setRenderScale(Math.max(0.55, renderScale - 0.15));
  else if (fps > 58 && renderScale < 1) setRenderScale(Math.min(1, renderScale + 0.1));
}

/* ---------- main loop ---------- */
function loop() {
  requestAnimationFrame(loop);
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1), t = clock.elapsedTime;
  updateWorld(t, dt);
  updateStory(dt);
  applyWorld();
  updateCamera(dt);
  updateLighting(dt);
  composer.render(dt);
  updateMarkers(dt);
  updateHUD(t, dt);
  adaptQuality(raw);
}

addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setSize(w, h);
  lensPass.uniforms.uAspect.value = w / h;
  updatePointScale();
});

init().catch(err => {
  console.error(err);
  ldStatus.style.color = '#ff8a8a';
  ldStatus.textContent = `SYSTEM FAULT · ${err && err.message ? err.message : err}`;
});
