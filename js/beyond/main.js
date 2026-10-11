// BEYOND THE WANDERING EARTH — Humanity's Journey from a Dying Sun to the Galactic Sea.
// Entry point: renderer, the three-layer scale ladder, story/free camera, interaction, HUD and audio.
import * as THREE from 'three';
import { clamp, lerp, smooth, EARTH_R, K0, ART_PER_LY, art2au, SKY, GC_DIST, W2EQ3, eqMap } from './util.js';
import { buildEarthLayer, SPIN0, SPIN_RATE, TILT } from './earth.js';
import { buildSolarLayer, PLANETS, DWARFS, SUN_R, ORRERY } from './solar.js';
import { buildGalaxyLayer } from './galaxy.js';
import { createPipeline } from './post.js';
import { CHAPTERS, CAPTIONS, DURATION, worldState, newState, earthChoices, buildCameraKeys, evalCamera, regionAt, earthPos, igniteAt } from './story.js';
import { loadModel, bakeModel } from '../fx/models.js';
import { loadPBR } from '../fx/triplanar.js';
import { Sound } from './audio.js';
import { createDash } from './dash.js';
window.__emStarted = true;

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TOUCH = matchMedia('(pointer: coarse)').matches;
const MOBILE = TOUCH || Math.min(innerWidth, innerHeight) < 700;
const WP = !!window.__WALLPAPER;            // running as a desktop wallpaper (Wallpaper Engine): no page UI, controlled by js/wallpaper
// Quality tiers: only cost changes between them, never the look (same lights, materials, colour pipeline).
// scale = render pixels per CSS pixel (capped by maxPx), msaa samples, shadow map size (0 = off) and refresh
// interval, bloom mip levels, ray-march steps, and instance budgets.
const TIERS = {
  low: { scale: 0.75, maxPx: 1.2e6, msaa: 2, shadowMap: 0, shadowEvery: 0, bloomLevels: 5, fps: 30, engines: 1100, hero: 26, volSteps: 10, atmoSteps: 7, atmoLight: 3, earthSeg: [160, 100], climbers: 4, steer: 48, ringSeg: 720, sats: 500, ships: 90, dust: 600, shards: 30, cme: 2000, asteroids: 10000, kuiper: 12000, galaxy: 90000, localArm: 14000, hii: 450, dustLanes: 8000, mc: 3000, ism: 1000, nebSteps: 16, stars: 6000 },
  medium: { scale: 1.0, maxPx: 2.1e6, msaa: 4, shadowMap: 1024, shadowEvery: 2, bloomLevels: 6, fps: 30, engines: 1800, hero: 26, volSteps: 14, atmoSteps: 9, atmoLight: 4, earthSeg: [200, 128], climbers: 5, steer: 60, ringSeg: 1080, sats: 1000, ships: 180, dust: 1100, shards: 50, cme: 3500, asteroids: 20000, kuiper: 24000, galaxy: 200000, localArm: 28000, hii: 900, dustLanes: 16000, mc: 5500, ism: 2000, nebSteps: 18, stars: 9000 },
  high: { scale: 1.25, maxPx: 3.3e6, msaa: 4, shadowMap: 2048, shadowEvery: 1, bloomLevels: 7, fps: 60, engines: 2600, hero: 26, volSteps: 18, atmoSteps: 11, atmoLight: 6, earthSeg: [256, 160], climbers: 6, steer: 72, ringSeg: 1440, sats: 1500, ships: 260, dust: 1600, shards: 70, cme: 5000, asteroids: 30000, kuiper: 34000, galaxy: 300000, localArm: 40000, hii: 1300, dustLanes: 24000, mc: 8000, ism: 3000, nebSteps: 22, stars: 12000 },
  ultra: { scale: 1.5, maxPx: 5.0e6, msaa: 4, shadowMap: 2048, shadowEvery: 1, bloomLevels: 7, fps: 60, engines: 3000, hero: 26, volSteps: 22, atmoSteps: 12, atmoLight: 6, earthSeg: [320, 200], climbers: 6, steer: 72, ringSeg: 1440, sats: 1800, ships: 300, dust: 1800, shards: 80, cme: 6000, asteroids: 36000, kuiper: 40000, galaxy: 360000, localArm: 48000, hii: 1500, dustLanes: 28000, mc: 9000, ism: 3500, nebSteps: 24, stars: 12000 },
};
const TIER = TIERS[params.get('q')] ? params.get('q') : WP ? (TIERS[window.__WALLPAPER.quality] ? window.__WALLPAPER.quality : 'medium') : MOBILE ? 'low' : 'high';
const LOW = TIER === 'low';
const Q = { ...TIERS[TIER], tier: TIER };
// on a desktop page the tier scale is a ceiling on the device's own pixel ratio; as a wallpaper it is the scale itself
Q.dpr = WP ? Q.scale : Math.min(devicePixelRatio, Math.max(Q.scale, 1));
if (params.get('msaa')) Q.msaa = +params.get('msaa');
if (params.get('dpr')) { Q.dpr = +params.get('dpr'); Q.maxPx = Infinity; }
// render-pixel budget: a 4K or high-DPI screen renders at most ~2.4 Mpx (≈ 2048×1152) and is upscaled by the
// browser — the temporal stabiliser and MSAA keep edges clean, and the frame rate stays even
const baseDpr = () => Math.min(Q.dpr, Math.sqrt(Q.maxPx / Math.max(innerWidth * innerHeight, 1)));
if (TOUCH) document.body.classList.add('touch');

/* ------------------------------------------------------------------ renderer */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(baseDpr()); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;   // always on (stable programs); a tier without shadows parks the map instead renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // one fitted sun shadow (see earth.js)

/* ------------------------------------------------------------------ shared uniforms */
const U = {
  uTime: { value: 0 }, uSunW: { value: new THREE.Vector3(1, 0, 0) }, uSunI: { value: 1 }, uAtmoI: { value: 1 }, uFreeze: { value: 0.5 }, uPower: { value: 1 },
  uAtmoDir: { value: new THREE.Vector3(1, 0, 0) }, uKeyCol: { value: new THREE.Color(1, 1, 1) }, uPx: { value: 0.001 }, uView: { value: new THREE.Vector2(1, 1) }, uPxR: { value: Q.dpr }, uDust: { value: 0 }, uShock: { value: 0 }, uAurora: { value: 0 }, uEarthV: { value: new THREE.Vector3() },
  uSunHot: { value: 0.7 }, uSunIL1: { value: 1 }, uOrbits: { value: 0 }, uBelts: { value: 1 }, uTrack: { value: 0 }, uMarker: { value: 0 }, uHelio: { value: 0 },
  uPano: { value: 1 }, uOutside: { value: 0 }, uStarFar: { value: 0 }, uLocalArm: { value: 0 }, uSteer: { value: 1 }, uTrail: { value: 0 }, uIgnite: { value: 10 }, uIgnAge: { value: 1e4 }, uKey2: { value: new THREE.Vector3(1, 0, 0) }, uKey2I: { value: 0 }, uVolSteps: { value: Q.volSteps }, uNightGain: { value: 1 }, uAmb: { value: new THREE.Vector3() }, uLocalStars: { value: 1 }, uNebula: { value: 0 }, uOort: { value: 0 }, uGalaxy: { value: 0 }, uRoute: { value: 0 }, uMarker2: { value: 0 },
};

/* ------------------------------------------------------------------ loading */
const status = (p, s) => { $('ld-fill').style.width = (p * 100).toFixed(0) + '%'; $('ld-status').textContent = s; };
const texLoader = new THREE.TextureLoader();
const tex = (url, srgb) => new Promise(res => texLoader.load(url, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); res(t); }, undefined, () => res(null)));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

let earth, solar, galaxy, pipe, keys, spinQ, dash = null;
const layers = [
  { name: 'L2', scene: null, cam: new THREE.PerspectiveCamera(45, 1, 1e-3, 1e6), active: true },
  { name: 'L1', scene: null, cam: new THREE.PerspectiveCamera(45, 1, 1e-4, 400), active: true },
  { name: 'L0', scene: null, cam: new THREE.PerspectiveCamera(45, 1, 0.05, 6000), active: true },
];
const [L2, L1, L0] = layers;
const master = new THREE.PerspectiveCamera(45, 1, 1e-9, 1e12);   // the art-AU camera (only used for projection maths)

async function load() {
  status(0.04, 'CALIBRATING DEEP-SPACE OPTICS');
  const [day, night, surf, cloudT, milky, starsBuf, issM, hubM] = await Promise.all([
    tex('assets/planets/earth_day_4k.jpg', true), tex('assets/earth/earth_night_4096.jpg', true), tex('assets/earth/earth_bump_roughness_clouds_4096.jpg', false), tex('assets/planets/earth_clouds_4k.jpg', false),
    new Promise(res => texLoader.load('assets/sky/milkyway_4k.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; res(t); }, undefined, () => res(null))),
    fetch('assets/sky/stars.bin').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
    loadModel('assets/models/iss.glb'), loadModel('assets/models/hubble.glb'),
  ]);
  status(0.45, 'PLOTTING THE ESCAPE TRAJECTORY'); await nextFrame();
  const models = { iss: issM && bakeModel(issM, 1, { byHeight: false }), hubble: hubM && bakeModel(hubM, 1, { byHeight: false }) };
  const choice = earthChoices();
  U.heroDirL = choice.heroDirL; U.elevDirsL = choice.elevDirsL;
  const T = { day, night, surf, clouds: cloudT };
  if (!day || !surf) throw new Error('Earth textures missing (assets/earth)');
  status(0.55, 'IGNITING 10,000 PLANETARY ENGINES'); await nextFrame();
  const ptex = {};
  await Promise.all(['sun', 'mercury', 'venus:venus_atmosphere', 'mars', 'jupiter:jupiter_4k', 'saturn', 'uranus', 'neptune', 'pluto', 'eris', 'makemake', 'moon', 'ceres', 'haumea'].map(async k => {
    const [key, file] = k.includes(':') ? k.split(':') : [k, k + '_2k'];
    ptex[key] = await tex(`assets/planets/${file.endsWith('4k') ? file : file.endsWith('_2k') ? file : file + '_2k'}.jpg`, true);
  }));
  ptex.saturnRing = await new Promise(res => texLoader.load('assets/planets/saturn_ring.png', t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));
  T.moon = ptex.moon; ptex.earth = day;
  const pbrNames = ['metal_plate_02', 'painted_metal_shutter', 'blue_metal_plate'];
  const pbrSets = await Promise.all(pbrNames.map(n => loadPBR('assets/textures', n)));
  const pbr = Object.fromEntries(pbrNames.map((n, i) => [n, pbrSets[i]]));
  earth = buildEarthLayer({ T, models, Q, U, pbr, renderer, milky }); L0.scene = earth.scene;
  status(0.68, 'CHARTING THE SOLAR SYSTEM'); await nextFrame();
  solar = buildSolarLayer({ Q, U, tex: ptex }); L1.scene = solar.scene;
  status(0.8, 'MAPPING FOUR HUNDRED BILLION STARS'); await nextFrame();
  const [galTex, galImg] = await new Promise(res => texLoader.load('assets/sky/milkyway_top_2k.jpg', t => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); x.drawImage(t.image, 0, 0, 512, 512);
    res([t, { data: x.getImageData(0, 0, 512, 512).data, w: 512, h: 512 }]);
  }, undefined, () => res([null, null])));
  galaxy = buildGalaxyLayer({ Q, U, sky: { milky, stars: starsBuf && new Float32Array(starsBuf), galTex, galImg } }); L2.scene = galaxy.scene;
  // Earth beacon for galactic distances
  {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    galaxy.earthMark = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uA: U.uMarker2, uPxR: U.uPxR }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uPxR; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = 26.0 * uPxR; }`,
      fragmentShader: `uniform float uA; void main(){ vec2 q = (gl_PointCoord - 0.5) * 2.0; float r = length(q); if (r > 1.0) discard; float c = exp(-r * r * 50.0) * 3.0 + exp(-r * 7.0) * 0.3 + (exp(-abs(q.y) * 70.0) + exp(-abs(q.x) * 70.0)) * exp(-r * 3.0) * 0.5; gl_FragColor = vec4(vec3(0.5, 0.8, 1.6) * c * uA, 1.0); }`,
    }));
    galaxy.earthMark.frustumCulled = false; galaxy.earthMark.renderOrder = 9; galaxy.scene.add(galaxy.earthMark);
  }
  status(0.88, 'COMPOSING THE VOYAGE'); await nextFrame();
  spinQ = t => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, TILT)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SPIN0 + t * SPIN_RATE));
  const ctx = { spinQ, heroDirL: choice.heroDirL, elevDirsL: choice.elevDirsL, steerDirL: earth.world.steerDir };
  keys = buildCameraKeys(ctx);
  S.flareDir = ctx.flareDir;
  // the trajectory, drawn in the Solar layer
  const pts = []; for (let t = -6; t <= 86; t += 0.25) pts.push(earthPos(t));
  solar.setTrack(pts);
  pipe = createPipeline(renderer, layers, Q);
  status(0.94, 'WARMING SHADERS');
  // compile everything once so the first chapter doesn't stutter
  frame(0, 0, true);
  // compile for the target the layers really draw into (HDR, no tone mapping, linear): programs depend on it, and
  // compiling for the canvas produced variants that were never used, while the real ones compiled mid-film
  renderer.setRenderTarget(pipe.layerTarget);
  for (const L of layers) if (L.scene) {        // every program, including objects first seen minutes in: no hitch on first appearance
    const hidden = []; L.scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    renderer.compile(L.scene, L.cam);
    for (const o of hidden) o.visible = false;
  }
  renderer.compile(earth.haze.scene, L0.cam);
  renderer.setRenderTarget(null);
  pipe.warm();
  await nextFrame();
  status(1, 'READY');
}

/* ------------------------------------------------------------------ state */
const S = newState();
const app = { mode: 'intro', playing: false, t: 0, target: null, speed: 1, hud: true, lastChapter: -1, lastCap: -1, free: null, look: { yaw: 0, pitch: 0, vy: 0, vp: 0 }, ended: false, hooks: {}, par: null, audio: 0, evMul: 1, renderScale: 1 };
const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 45, d: 1, logd: 0 };
let prevLogd = 0, zoomBlur = 0;

/* anchors in art-AU (float64) */
function anchorArt(name, t) {
  const E = S.earth;
  switch (name) {
    case 'earth': return E.clone();
    case 'sun': case 'sol': return new THREE.Vector3();
    case 'hero': case 'climber': case 'hub0': case 'fleet': case 'observatory': case 'steer': case 'flagship': case 'moon': {
      const w = earth.world[name]; return w ? w.clone().multiplyScalar(K0).add(E) : E.clone();
    }
    case 'elevMid': { const n = earth.world.elevN0; return n ? n.clone().multiplyScalar(210 * K0).add(E) : E.clone(); }
    case 'acen': return galaxy.anchors.acen.clone().multiplyScalar(ART_PER_LY);
    case 'proxima': return galaxy.anchors.proxima.clone().multiplyScalar(ART_PER_LY);
    case 'gcloud': return galaxy.anchors.gcloud.clone().multiplyScalar(ART_PER_LY);
    case 'nebula': return galaxy.anchors.nebula.clone().multiplyScalar(ART_PER_LY);
    case 'gc': return galaxy.anchors.gc.clone().multiplyScalar(ART_PER_LY);
    case 'solGal': return (galaxy.anchors.solGal || new THREE.Vector3()).clone().multiplyScalar(ART_PER_LY);
    case 'lmc': return galaxy.anchors.lmc.clone().multiplyScalar(ART_PER_LY);
    case 'smc': return galaxy.anchors.smc.clone().multiplyScalar(ART_PER_LY);
    default: { const b = solar.bodies[name]; if (b) return b.group.position.clone(); const m = solar.moons.find(m => m.key === name); if (m) return m.obj.position.clone(); const g = galaxy.anchors[name]; return g ? g.clone().multiplyScalar(ART_PER_LY) : E.clone(); }
  }
}

/* ------------------------------------------------------------------ hotspots */
const HOT = [
  { key: 'engines', anchor: 'hero', name: 'HEAVY ENGINE ARRAY', kicker: 'PLANETARY PROPULSION', range: [0.0002, 0.05], frame: 0.0058, text: 'Twenty-six heavy fusion engines, each a 150-kilometre tower. Their plasma jets climb clear of the atmosphere. Across the planet, 10,000 engines fire from the trailing hemisphere.', data: 'THRUST 1.5 × 10¹⁶ N · PLUME 3,300 km' },
  { key: 'elevator', anchor: 'elevMid', name: 'SPACE ELEVATOR', kicker: 'SURFACE ↔ ORBIT', range: [0.0006, 0.12], frame: 0.0024, text: 'Three equatorial tethers rise 35,786 km to the geostationary ring. Climbers carry the last of the surface cargo into orbit.', data: '3 TETHERS · 18 CLIMBERS · 1,200 km/h' },
  { key: 'ring', anchor: 'hub0', name: 'GEOSTATIONARY RING', kicker: 'ORBITAL MEGASTRUCTURE', range: [0.0006, 0.12], frame: 0.0095, text: 'A 265,000-kilometre hoop of habitats, docks and shipyards. It turns with the planet and anchors the elevators.', data: 'Ø 84,300 km · 6 HUB STATIONS' },
  { key: 'steer', anchor: 'steer', name: 'EQUATORIAL STEERING ARRAY', kicker: 'ATTITUDE CONTROL', range: [0.0002, 0.05], frame: 0.0068, text: 'Seventy-two steering engines ring the equator. Their jets are canted 34° eastward, so together they hold the planet\'s spin and trim its heading.', data: '72 ENGINES · 34° CANT' },
  { key: 'flagship', anchor: 'flagship', name: 'NAVIGATOR · FLAGSHIP', kicker: 'FLEET COMMAND', range: [0.0003, 0.1], frame: 0.0065, text: 'The 2,000 km command carrier of the escort fleet. Its twin habitat rings counter-rotate for gravity, and six fusion drives keep it on station ahead of the planet.', data: 'CREW 1.1 M · 6 FUSION DRIVES' },
  { key: 'fleet', anchor: 'fleet', name: 'ESCORT FLEET', kicker: 'NAVIGATOR CLASS', range: [0.0004, 0.1], frame: 0.0012, text: 'Carriers and survey ships fly ahead of the planet, scouting for debris and relaying the course.', data: '8 CARRIERS · 260 CRAFT' },
  { key: 'observatory', anchor: 'observatory', name: 'DEEP-SPACE OBSERVATORY', kicker: 'SCIENCE STATION', range: [0.0003, 0.06], frame: 0.0012, text: 'A 50-kilometre radio and optical array that holds station off the leading limb. Its dish never leaves the destination.', data: 'TARGET α CENTAURI · BASELINE 50 km' },
  { key: 'earth', anchor: 'earth', name: 'EARTH', kicker: 'THE WANDERING PLANET', range: [EARTH_R * 2.6, 60], frame: EARTH_R * 5, text: 'A planet turned into a ship. Its oceans are frozen and its cities have moved underground. It carries 3.5 billion people to a new star.', data: 'MASS 5.97 × 10²⁴ kg' },
  { key: 'moon', anchor: 'moon', name: 'THE MOON', kicker: 'ESCORTED SATELLITE', range: [0.004, 2], frame: 0.0085, text: 'Kept in a tight orbit for the voyage, the Moon travels with the planet. Its far side now hosts the fleet\'s deep-space yards.', data: '3,474 km · 384,400 km out', nearHide: 0 },
  { key: 'sun', anchor: 'sun', name: 'THE SUN', kicker: 'G2V · AGEING STAR', range: [SUN_R * 3, 420], frame: SUN_R * 6, text: 'Unstable and swelling. Its flares and coronal mass ejections now reach far past the orbit of Mars.', data: '5,772 K · 3.83 × 10²⁶ W' },
  ...[...PLANETS, ...DWARFS].map(b => ({ key: b.key, anchor: b.key, name: b.name, nearHide: 0.35, kicker: b.key === 'pluto' || b.key === 'eris' || b.key === 'makemake' ? 'DWARF PLANET' : (b.au > 5 ? (b.au > 15 ? 'ICE GIANT' : 'GAS GIANT') : 'TERRESTRIAL PLANET'), range: [b.r * 3, 95], frame: b.r * (b.ring ? 9 : 6), text: ({ mercury: 'Scorched, airless, and tidally locked to a swelling Sun.', venus: 'A runaway greenhouse under sulphuric clouds.', mars: 'The red planet, home to the last surface outposts.', jupiter: 'Its gravity gives the Wandering Earth the slingshot it needs to escape.', saturn: 'Ice rings 280,000 km wide, glowing when lit from behind.', uranus: 'The tilted ice giant, rolling around the Sun on its side.', neptune: 'The last planet. Winds here reach 2,100 km/h.', pluto: 'A dwarf world of nitrogen ice, with a bright heart-shaped plain.', eris: 'A frozen dwarf at the edge of the scattered disc.', makemake: 'A reddish dwarf planet in the Kuiper Belt.' })[b.key], data: `${b.au} AU` })),
  { key: 'acen', farOnly: 0.02 * ART_PER_LY, anchor: 'acen', name: 'ALPHA CENTAURI A · B', kicker: 'DESTINATION SYSTEM', range: [0.02 * ART_PER_LY, 60 * ART_PER_LY], frame: 0.4 * ART_PER_LY, text: 'Two Sun-like stars 4.37 light-years away. Proxima Centauri, a red dwarf, circles them, and the new home orbits Proxima.', data: '4.37 ly · G2V + K1V' },
  { key: 'gcloud', farOnly: 0.02 * ART_PER_LY, anchor: 'gcloud', name: 'G-CLOUD', kicker: 'INTERSTELLAR CLOUD', range: [2 * ART_PER_LY, 40 * ART_PER_LY], frame: 6 * ART_PER_LY, text: 'The thin, warm cloud that surrounds Alpha Centauri, drawn here far denser than it really is. Earth\'s bow shock lights it as the planet passes.', data: 'n ≈ 0.1 cm⁻³ · 7,000 K' },
  { key: 'earthDeep', anchor: 'earth', name: 'EARTH', kicker: 'EN ROUTE', range: [0.6 * ART_PER_LY, 400 * ART_PER_LY], frame: EARTH_R * 6, text: 'Two and a half thousand years from home to Proxima, and halfway there in under six centuries.', data: '' },
  { key: 'solGal', anchor: 'solGal', name: 'SOL · YOU ARE HERE', kicker: 'ORION SPUR', range: [0.8 * ART_PER_LY, 400000 * ART_PER_LY], frame: 40 * ART_PER_LY, text: 'The Sun, 26,700 light-years from the galactic centre, completes one orbit of the Milky Way every 230 million years.', data: '8.2 kpc · 230 km/s' },
  { key: 'gc', farOnly: 3000 * ART_PER_LY, anchor: 'gc', name: 'SAGITTARIUS A*', kicker: 'GALACTIC CENTRE', range: [6000 * ART_PER_LY, 400000 * ART_PER_LY], frame: 30000 * ART_PER_LY, text: 'A black hole of four million solar masses, at the heart of the Galaxy\'s bar.', data: '4.3 × 10⁶ M☉' },
  { key: 'lmc', farOnly: 3000 * ART_PER_LY, anchor: 'lmc', name: 'LARGE MAGELLANIC CLOUD', kicker: 'SATELLITE GALAXY', range: [30000 * ART_PER_LY, 600000 * ART_PER_LY], frame: 40000 * ART_PER_LY, text: 'The largest of the Milky Way\'s satellite galaxies, 163,000 light-years away.', data: '1 × 10¹⁰ M☉' },
  { key: 'orion', farOnly: 2.5 * ART_PER_LY, anchor: 'orion', name: 'ORION NEBULA', kicker: 'STELLAR NURSERY · M42', range: [40 * ART_PER_LY, 9000 * ART_PER_LY], frame: 120 * ART_PER_LY, text: 'The nearest large star-forming region, 1,344 light-years away in our own spiral arm.', data: '1,344 ly · 24 ly across' },
  { key: 'pleiades', farOnly: 2.5 * ART_PER_LY, anchor: 'pleiades', name: 'PLEIADES', kicker: 'OPEN CLUSTER · M45', range: [25 * ART_PER_LY, 6000 * ART_PER_LY], frame: 60 * ART_PER_LY, text: 'A young cluster of hot blue stars, still wrapped in the dust it drifts through.', data: '444 ly · 100 Myr old' },
  { key: 'carina', farOnly: 2.5 * ART_PER_LY, anchor: 'carina', name: 'CARINA NEBULA', kicker: 'GIANT HII REGION', range: [300 * ART_PER_LY, 40000 * ART_PER_LY], frame: 900 * ART_PER_LY, text: 'One of the largest nebulae in the Galaxy, and home to the hypergiant Eta Carinae.', data: '7,500 ly' },
  { key: 'orrery', anchor: 'sun', name: 'THE WHOLE SYSTEM', kicker: 'ORRERY · TIME-LAPSE', range: [1, 2], frame: 72, text: 'The Solar System from above, with time sped up so that a year passes in three seconds. Mercury whips around the Sun, and the giants barely move.', data: '8 PLANETS · 5 DWARF PLANETS', noMarker: true, orrery: 0.35 },
  { key: 'milkyway', anchor: 'gc', name: 'THE MILKY WAY', kicker: 'BARRED SPIRAL GALAXY', range: [1e12, 1e9 * ART_PER_LY], frame: 95000 * ART_PER_LY, text: 'Four hundred billion stars in a barred spiral 100,000 light-years across. The Sun sits in a minor arm, about halfway out.', data: '100,000 ly · 4 × 10¹¹ stars', noMarker: true },
  { key: 'smc', farOnly: 3000 * ART_PER_LY, anchor: 'smc', name: 'SMALL MAGELLANIC CLOUD', kicker: 'SATELLITE GALAXY', range: [30000 * ART_PER_LY, 600000 * ART_PER_LY], frame: 30000 * ART_PER_LY, text: 'A dwarf irregular galaxy that is being pulled apart by the Milky Way and the LMC.', data: '200,000 ly' },
];
function buildHotspots() {
  const root = $('hotspots');
  for (const h of HOT) {
    if (h.noMarker) { h.el = document.createElement('i'); continue; }
    const el = document.createElement('button'); el.className = 'hs'; el.type = 'button';
    el.innerHTML = `<i></i><span><b>${h.name}</b><small>${h.kicker}</small></span>`;
    el.addEventListener('click', e => { e.stopPropagation(); focusHotspot(h); });
    root.appendChild(el); h.el = el;
  }
}
const vP = new THREE.Vector3();
function updateHotspots() {
  if (WP) return;
  const W = innerWidth, H = innerHeight;
  const now = performance.now();
  if (!updateHotspots.avoid || now - updateHotspots.at > 500) { updateHotspots.at = now; updateHotspots.avoid = ['data', 'dest', 'modes', 'info', 'dash-l', 'dash-r', 'dash-h'].map(id => $(id)).filter(e => e && getComputedStyle(e).opacity > 0.1).map(e => e.getBoundingClientRect()); }
  const avoid = updateHotspots.avoid;
  const show = app.mode !== 'intro' && app.hud && !(app.mode === 'story' && app.playing && app.t < 8);   // the opening shot plays clean
  let shown = 0; const placed = [];
  for (const h of HOT) {
    if (h.noMarker) continue;
    let vis = false;
    if (show) {
      const p = anchorArt(h.anchor, app.t), D = p.distanceTo(cam.pos);
      const nearEarth = (h.farOnly && cam.pos.length() < h.farOnly && app.mode !== 'free') || h.nearHide && S.earth.distanceTo(cam.pos) < h.nearHide && !(app.free && app.free.anchor === h.anchor);
      if (D > h.range[0] && D < h.range[1] && !nearEarth) {
        vP.copy(p).applyMatrix4(master.matrixWorldInverse);
        if (vP.z < 0) {
          vP.applyMatrix4(master.projectionMatrix);
          const x = (vP.x * 0.5 + 0.5) * W, y = (-vP.y * 0.5 + 0.5) * H;
          // hidden behind the planet?
          let occ = false;
          if (h.anchor !== 'earth' && D < 1) { const ro = cam.pos, rd = p.clone().sub(ro).normalize(), oc = S.earth.clone().sub(ro); const tt = oc.dot(rd); if (tt > 0 && tt < D) { const dd = oc.addScaledVector(rd, -tt).length(); occ = dd < EARTH_R * 0.98; } }
          if (!occ && x > 30 && x < W - 30 && y > 60 && y < H - 90 && !avoid.some(r => x > r.left - 190 && x < r.right + 10 && y > r.top - 20 && y < r.bottom + 20) && shown < (app.mode === 'free' || S.trail > 0.4 ? 9 : 2) && !placed.some(([px, py]) => Math.abs(px - x) < 175 && Math.abs(py - y) < 40)) { vis = true; shown++; placed.push([x, y]); h.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; }
        }
      }
    }
    if (vis !== h.vis) { h.el.classList.toggle('on', vis); h.vis = vis; }
  }
}
function focusHotspot(h) {
  dash && dash.event(`TARGET LOCK · ${h.name}`);
  Sound.start();
  enterFree(h.anchor, h.frame);
  const N0 = earth.world.elevN0, sideE = N0 ? new THREE.Vector3().crossVectors(N0, S.sunDir).normalize() : null;
  if (sideE && sideE.dot(S.sunDir) < 0) sideE.negate();
  const vd = h.key === 'elevator' && N0 ? sideE.clone().multiplyScalar(0.5).addScaledVector(S.sunDir, 0.3).addScaledVector(N0, 0.8).normalize()      // above and beside the tether, looking down it to the planet
    : h.key === 'ring' && N0 ? N0.clone().multiplyScalar(0.7).addScaledVector(S.sunDir, 0.55).addScaledVector(sideE, 0.35).addScaledVector(new THREE.Vector3(0, 1, 0), 0.2).normalize()   // outside the ring, sunlit side, Earth behind the station
    : h.key === 'engines' && earth.world.heroN ? earth.world.heroN.clone().multiplyScalar(0.55).add(new THREE.Vector3().crossVectors(earth.world.heroN, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.84)).normalize()
    : h.key === 'steer' && earth.world.steerN ? earth.world.steerN.clone().multiplyScalar(0.5).addScaledVector(new THREE.Vector3(0, 1, 0), 0.6).normalize() : null;
  if (vd) { const a = dirToAngles(vd); app.free.yaw = a.yaw; app.free.pitch = clamp(a.pitch, -1.3, 1.3); }   // a designed approach angle for the big structures
  if (h.orrery != null) { ORRERY.speed = h.orrery; document.querySelectorAll('.seg3 button').forEach(x => x.classList.toggle('on', +x.dataset.v === h.orrery)); app.free.pitch = 0.95; }
  $('info').innerHTML = `<div class="i-k">${h.kicker}</div><div class="i-t">${h.name}</div><p>${h.text}</p>${h.data ? `<div class="i-d">${h.data}</div>` : ''}<button class="i-x" type="button" aria-label="Close">✕</button>`;
  $('info').classList.add('on');
  $('info').querySelector('.i-x').onclick = () => $('info').classList.remove('on');
  clearTimeout(focusHotspot.t); focusHotspot.t = setTimeout(function fade() { if ($('info').matches(':hover')) { focusHotspot.t = setTimeout(fade, 2000); return; } $('info').classList.remove('on'); }, 11000);   // the card steps aside once read
}

/* ------------------------------------------------------------------ free camera */
function dirToAngles(d, up) { return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y, -1, 1)) }; }
const fromAngles = (yaw, pitch) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
function enterFree(anchor, d) {
  const was = app.mode;
  setMode('free');
  const A = anchorArt(anchor, app.t);
  const nd = d ?? cam.pos.distanceTo(A);
  let dir = cam.pos.clone().sub(A); if (dir.lengthSq() < 1e-30) dir.set(0, 0.3, 1); dir.normalize();
  const ang = dirToAngles(dir);
  const target = { anchor, d: nd, yaw: ang.yaw, pitch: clamp(ang.pitch, -1.35, 1.35) };
  if (app.free && was === 'free') { app.free.fly = { from: snapshot(), t0: performance.now(), dur: flyDur(app.free, target) }; Object.assign(app.free, target); }
  else app.free = { ...target, fly: { from: snapshot(), t0: performance.now(), dur: d != null ? flyDur(null, target) : 0 } };
}
function snapshot() { return { pos: cam.pos.clone(), target: cam.target.clone(), up: cam.up.clone(), fov: cam.fov }; }
function flyDur(from, to) { const a = cam.pos, b = anchorArt(to.anchor, app.t); const r = Math.abs(Math.log10(Math.max(a.distanceTo(b), 1e-9) / to.d)); return clamp(1800 + r * 450, 1800, 6500); }
function freeCamera(out, dt = 0) {
  const F = app.free, A = anchorArt(F.anchor, app.t);
  if (!F.fly) {                                                      // inertia: ease towards the dragged / scrolled targets
    if (performance.now() - (app.lastInput || 0) > 6000) F.ty = (F.ty ?? F.yaw) + dt * (app.orbitSpeed ?? 0.03);   // left alone, the camera drifts slowly round its subject
    const k = 1 - Math.exp(-dt * 7);
    if (F.ty != null) F.yaw += (F.ty - F.yaw) * k;
    if (F.tp != null) F.pitch += (F.tp - F.pitch) * k;
    if (F.td != null) F.d = Math.exp(Math.log(F.d) + (Math.log(F.td) - Math.log(F.d)) * k);
  } else { F.ty = F.yaw; F.tp = F.pitch; F.td = F.d; }
  const gal = ['gc', 'lmc', 'smc', 'solGal'].includes(F.anchor) || F.d > 3000 * ART_PER_LY;
  const upV = gal ? SKY.ngp : new THREE.Vector3(0, 1, 0);
  const dir = fromAngles(F.yaw, F.pitch);
  if (gal) dir.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), SKY.ngp));
  const pos = A.clone().addScaledVector(dir, F.d);
  out.pos.copy(pos); out.target.copy(A); out.up.copy(upV); out.fov = 45;
  if (F.fly && F.fly.dur > 0) {
    const k = clamp((performance.now() - F.fly.t0) / F.fly.dur), e = k * k * (3 - 2 * k);
    if (k >= 1) F.fly = null;
    else {
      const fr = F.fly.from;
      // fly in log-distance around a sliding focus, rising out between distant subjects
      const fromD = fr.pos.distanceTo(fr.target), sep = fr.target.distanceTo(A);
      const bump = Math.max(0, Math.log10(sep / Math.max(fromD, F.d)) - 0.4) * 0.8 * Math.sin(Math.PI * e);
      const tgt = fr.target.clone().lerp(A, e);
      const logd = lerp(Math.log10(fromD), Math.log10(F.d), e) + bump;
      const d0 = fr.pos.clone().sub(fr.target).normalize(), d1 = dir.clone();
      const qd = new THREE.Quaternion().setFromUnitVectors(d0, d1); const dd = d0.clone().applyQuaternion(new THREE.Quaternion().slerp(qd, e));
      out.pos.copy(tgt).addScaledVector(dd, Math.pow(10, logd)); out.target.copy(tgt);
      out.up.copy(fr.up).lerp(upV, e).normalize(); out.fov = lerp(fr.fov, 45, e);
    }
  }
  // never inside a body: push the camera out of the Earth (with its atmosphere), the Moon, the Sun and the planets
  const push = (c, r) => { const d = out.pos.distanceTo(c); if (d < r) out.pos.sub(c).multiplyScalar(r / Math.max(d, 1e-12)).add(c); };
  push(S.earth, EARTH_R * 1.07);
  if (earth.world.moon) push(earth.world.moon.clone().multiplyScalar(K0).add(S.earth), 27 * K0 * 1.25);
  push(new THREE.Vector3(), SUN_R * 1.6);
  for (const b of [...PLANETS, ...DWARFS]) push(solar.bodies[b.key].group.position, solar.bodies[b.key].group.scale.x * 1.25);
  out.d = out.pos.distanceTo(out.target); out.logd = Math.log10(out.d);
  return out;
}

/* ------------------------------------------------------------------ per frame */
const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const EARTH_EI = 0.95;          // exposure × key intensity × planet albedo for every Earth-layer shot: the planet's one look-dev preset
let lastHud = 0;
function frame(dt, now, warm = false) {
  // --- time
  if (!warm) {
    // the prelude (title → countdown): the camera glides on along its own path, a little faster until the countdown starts
    if (app.mode === 'story' && app.playing) app.t += dt * app.speed * (app.t < -3 ? 1 + 2.2 * smooth(0, 3, -3 - app.t) : 1);
    if (app.target != null) { const k = 1 - Math.exp(-dt * 3.2); app.t += (app.target - app.t) * k; if (Math.abs(app.target - app.t) < 0.01) app.target = null; }
    if (app.prelude && app.t >= 0.5) app.prelude = false;
    if (app.mode !== 'intro') app.t = clamp(app.t, app.prelude ? -14 : 0, DURATION);
    if (app.mode === 'story' && app.t >= DURATION - 0.01 && app.playing) endStory();
    if (app.mode === 'intro') app.t = -14 + 10 * (1 - Math.exp(-U.uTime.value / 18));   // behind the title: a slow push in on the quiet planet
  }
  U.uTime.value += dt;
  if (app.mode === 'free' && ORRERY.speed) ORRERY.extra += dt * ORRERY.speed;
  const t = app.t;
  worldState(t, S);
  if (app.audio) S.power *= 1 + app.audio;           // wallpaper: the engines breathe with the music
  // --- earth layer first (anchors for the camera), with last frame's camera
  // The Earth layer's key light — one dominant light, continuous across the whole film: the Sun while it
  // matters, then α Centauri as a cold key that brightens as we close in (chapter 4), which becomes the warm
  // new sun in chapter 6. Every Earth-layer material, the shadowing DirectionalLight and the reflection
  // capture read this one light, so the planet never goes grey and flat for lack of light.
  {
    const kA = (S.key2 || 0) * (0.3 + 0.32 * smooth(98, 146, t)), kS = S.sunI;
    S.keyDir = (S.keyDir || new THREE.Vector3()).copy(S.sunDir).multiplyScalar(kS).addScaledVector(SKY.acen, kA).normalize();
    S.keyI = kS + kA * (1 - Math.min(kS, 1));
    const cold = kA / Math.max(kS + kA, 1e-6);
    S.keyCol = (S.keyCol || new THREE.Color()).setRGB(1 - 0.24 * cold, 1 - 0.13 * cold, 1);
  }
  U.uSunW.value.copy(S.keyDir); U.uSunI.value = S.keyI; U.uKeyCol.value.copy(S.keyCol); U.uAtmoI.value = S.keyI; U.uFreeze.value = S.freeze; U.uPower.value = S.power;
  U.uDust.value = S.dust; U.uShock.value = S.shock; U.uAurora.value = S.aurora; U.uOrbits.value = S.orbits; U.uTrack.value = S.track; U.uHelio.value = S.helio;
  U.uNebula.value = S.nebula; U.uRoute.value = S.route; U.uOort.value = S.oort ?? 0;
  // α Centauri is only a bright star until chapter 6: a cold rim and glints on the ice, never a daylight key.
  // In deep space the planet is lit by its own engines; the night stays night.
  U.uKey2.value.copy(SKY.acen); U.uKey2I.value = 0;          // folded into the key light above
  U.uAtmoDir.value.copy(S.keyDir);
  // ignition: the film's clock in the film and behind the title; in free flight its own clock, started when you launch straight into it
  if (app.mode === 'free') { const ti = app.freeIgn != null ? (performance.now() - app.freeIgn) / 1000 : 1e4; if (ti > 40) app.freeIgn = null; U.uIgnite.value = igniteAt(ti); U.uIgnAge.value = Math.max(ti - 0.4, 0); S.shockP = ti > 0.45 && ti < 5 ? (ti - 0.45) / 4.2 : 0; }
  else { U.uIgnite.value = S.ignite; U.uIgnAge.value = Math.max(t - 0.4, 0); } U.uSteer.value = S.steer ?? 1; U.uTrail.value = app.mode === 'free' ? (ORRERY.speed ? 0.9 : 0) : S.trail;
  U.uAmb.value.set(0.014 + 0.03 * S.nebula + 0.05 * (S.newSun || 0), 0.016 + 0.034 * S.nebula + 0.048 * (S.newSun || 0), 0.022 + 0.045 * S.nebula + 0.042 * (S.newSun || 0));   // at α Cen, the companion star B lights the night side faintly
  S.destDir = SKY.acen;
  S.focusL0 = app.focusL0;                   // what the camera looks at, in Earth-layer units (last frame): the shadow box and reflection capture follow it
  earth.update(t, dt, S, L0.cam);
  solar.update(t, S, L1.cam);
  // --- camera
  if (app.hooks.camera) app.hooks.camera(cam, dt, t);          // wallpaper: mouse-driven views and the hand-over into the film
  else if (app.mode === 'free' && app.free) freeCamera(cam, dt); else evalCamera(keys, t, anchorArt, cam);
  // look-around (drag) and a whisper of handheld motion
  const lk = app.look;
  if (!app.dragging) { lk.yaw *= Math.exp(-dt * (app.mode === 'story' ? 1.2 : 0)); lk.pitch *= Math.exp(-dt * (app.mode === 'story' ? 1.2 : 0)); }
  master.position.copy(cam.pos); master.up.copy(cam.up);
  tmpM.lookAt(cam.pos, cam.target, cam.up); master.quaternion.setFromRotationMatrix(tmpM);
  if (app.mode !== 'free') {
    const tt = U.uTime.value, sh = 0.003 * S.flare + 0.012 * (S.shake || 0);      // no idle hand-held wobble: shake only on events
    master.quaternion.multiply(tmpQ.setFromEuler(tmpE.set(Math.sin(tt * 0.7) * sh + Math.sin(tt * 1.9) * sh * 0.4, Math.sin(tt * 0.53 + 1) * sh, 0, 'XYZ')));
    master.quaternion.multiply(tmpQ.setFromEuler(tmpE.set(lk.pitch, lk.yaw, 0, 'YXZ')));
  }
  if (app.par) master.quaternion.multiply(tmpQ.setFromEuler(tmpE.set(app.par.y, app.par.x, 0, 'YXZ')));   // wallpaper: mouse parallax (eased by the controller)
  // a damped camera: orientation and lens follow the path with a short time constant, so no key ever jerks
  if (!app.camQ || app.snapCam || warm) { app.camQ = master.quaternion.clone(); app.camFov = cam.fov; app.snapCam = false; }
  else { const k = 1 - Math.exp(-dt * (app.mode === 'free' ? 14 : 7)); app.camQ.slerp(master.quaternion, k); app.camFov += (cam.fov - app.camFov) * k; }
  master.quaternion.copy(app.camQ); cam.fov = app.camFov;
  master.fov = cam.fov; master.aspect = innerWidth / innerHeight;
  master.near = Math.max(cam.d * 1e-4, 1e-9); master.far = cam.d * 1e6 + 1e3;
  master.updateProjectionMatrix(); master.updateMatrixWorld(true);
  const pxAngle = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / innerHeight;
  U.uPx.value = pxAngle; U.uPxR.value = renderer.getPixelRatio(); U.uView.value.set(innerWidth, innerHeight);
  // --- layer cameras
  const camArt = cam.pos;
  // L0 (Earth layer)
  L0.cam.position.copy(camArt).sub(S.earth).divideScalar(K0);
  const d0 = L0.cam.position.length();
  app.focusL0 = (app.focusL0 || new THREE.Vector3()).copy(cam.target).sub(S.earth).divideScalar(K0);
  // skip the whole Earth layer when nothing in it can show: the planet (with ring, fleet and Moon) is out of
  // frame, or so small that the solar layer's Earth proxy is drawing it
  {
    const ePx = EARTH_R / Math.max(camArt.distanceTo(S.earth), 1e-12) / pxAngle;
    _frus.setFromProjectionMatrix(_pm.multiplyMatrices(master.projectionMatrix, master.matrixWorldInverse));
    const inView = _frus.intersectsSphere(_sph.set(S.earth, EARTH_R * 40));
    L0.active = d0 < 4e5 && inView && (ePx > 2.5 || d0 < 5000);
  }
  // near plane from the closest real object (surface, climber, stations, ships), so nothing close is ever clipped
  let n0 = Math.max(d0 - 100, 0.5);
  for (const k of ['climber', 'hub0', 'flagship', 'fleet', 'observatory', 'moon']) { const w = earth.world[k]; if (w) n0 = Math.min(n0, Math.max(L0.cam.position.distanceTo(w) - (k === 'moon' ? 30 : k === 'flagship' ? 40 : 25), 0.3)); }
  L0.cam.near = clamp(n0 * 0.08, 0.02, 60); L0.cam.far = d0 + 6000;
  // L1 (Solar layer)
  L1.cam.position.copy(camArt);
  const r1 = camArt.length();
  L1.active = r1 < 4.2e4;
  let nearest = Math.max(r1 - SUN_R, 1e-9);
  for (const b of [...PLANETS, ...DWARFS]) nearest = Math.min(nearest, Math.max(solar.bodies[b.key].group.position.distanceTo(camArt) - b.r * 2.4, b.r * 0.05));
  L1.cam.near = clamp(nearest * 0.3, 1e-6, 2); L1.cam.far = Math.max(400, r1 * 1.3 + 260);
  // L2 (Galaxy layer)
  L2.cam.position.copy(camArt).divideScalar(ART_PER_LY);
  const r2 = L2.cam.position.length();
  L2.cam.near = clamp(r2 * 2e-4, 1e-3, 100); L2.cam.far = r2 + 4e5;
  for (const L of layers) { L.cam.quaternion.copy(master.quaternion); L.cam.fov = cam.fov; L.cam.aspect = master.aspect; L.cam.updateProjectionMatrix(); L.cam.updateMatrixWorld(true); }
  // scale-dependent layer visibility
  U.uPano.value = 1 - smooth(500, 5000, r2);
  U.uLocalStars.value = 1 - smooth(2500, 9000, r2);
  U.uGalaxy.value = smooth(120, 2500, r2);
  U.uStarFar.value = smooth(15, 400, r2);
  U.uLocalArm.value = smooth(40, 400, r2) * (1 - smooth(9000, 30000, r2));
  U.uOutside.value = smooth(25000, 90000, galaxy.anchors.gc.distanceTo(L2.cam.position));
  const earthPx = (EARTH_R / Math.max(S.earth.distanceTo(camArt), 1e-12)) / pxAngle;
  const mk = 1 - smooth(1.2, 3.5, earthPx);
  U.uMarker.value = L1.active ? mk : 0; U.uMarker2.value = L1.active ? 0 : mk * (1 - smooth(20000, 60000, r2)) * (app.mode === 'intro' ? 0 : 1);
  galaxy.earthMark.geometry.attributes.position.setXYZ(0, S.earth.x / ART_PER_LY, S.earth.y / ART_PER_LY, S.earth.z / ART_PER_LY); galaxy.earthMark.geometry.attributes.position.needsUpdate = true;
  S.solVis = smooth(1.5e4, 4e4, r1);
  S.starFlare = 1 - (S.newSun || 0);
  if (app.mode === 'free') { app.galRot = (app.galRot ?? S.galRot) - dt * 0.012 * smooth(15000, 40000, r2); S.galRot = app.galRot; } else app.galRot = null;   // the Galaxy keeps turning while you watch it
  S.corona = clamp(1.05 - Math.log10(Math.max(r1, 0.1) / 0.25) * 0.6, 0.18, 1);
  S.viewScale = cam.d / ART_PER_LY * 1.2;
  galaxy.update(t, S, L2.cam);
  // L0 view-space Earth centre (analytic shadows)
  U.uEarthV.value.set(0, 0, 0).applyMatrix4(L0.cam.matrixWorldInverse);
  // --- post: exposure, bloom, grade, lens lights, zoom blur
  // eye adaptation (as in UE): meter the HDR frame, expose so the bright content sits in the mid-tones.
  // Darkening is fast and brightening is slow, so a Sun sliding into frame never whites out the screen.
  const lum = pipe && pipe.meter.lum;
  if (lum) {
    // the metered key is itself filtered (log-domain, ~0.4 s) and ignored inside a ±4 % deadband, so a Sun
    // disc sliding across a few meter cells can never make the exposure breathe or flicker
    const raw = Math.max(lum.p85, lum.p97 * 0.22, 2e-4);
    if (lum !== app.lumSeen) { app.lumSeen = lum; app.keyF = app.keyF == null || app.snapEye || app.snapSeq ? raw : app.keyF * Math.exp(Math.log(raw / app.keyF) * (1 - Math.exp(-Math.max(dt, 1 / 60) / 0.4))); }
    if (app.keyA == null || Math.abs(Math.log(app.keyF / app.keyA)) > 0.04 || app.snapSeq) app.keyA = app.keyF;
    const key = app.snapSeq ? raw : app.keyA;
    const sunBig = L1.active ? smooth(30, 130, solar.sunPx || 0) : 0;          // a Sun filling the frame is exposed for its surface, not its glow
    const metered = clamp(0.4 / key, 0.012, S.evMax ?? 2.6) * (S.evBias ?? 1) * (1 - 0.72 * sunBig);   // ceiling: dark frames stay dark, never lifted grey
    // Earth look-dev lock: when the Earth layer is the subject, expose for its sunlit surface — the same on-screen
    // brightness of the lit planet in every chapter, whatever else is in frame (a Sun in shot cannot plunge a
    // backlit ship into black, a dark frame is never lifted grey). Wide solar-system and galaxy shots meter.
    const wE = L0.active ? 1 - smooth(40, 150, camArt.distanceTo(S.earth) / EARTH_R) : 0;   // camera distance in Earth radii
    const albedo = 1 + 0.8 * smooth(0.25, 0.95, S.freeze ?? 0);          // ocean-and-land ≈ 0.3 → ice sheet ≈ 0.55 (relative)
    const anchored = clamp(EARTH_EI / (Math.max(S.keyI ?? S.sunI, 0.05) * albedo), 0.05, 4) * (S.evBias ?? 1);
    const target = Math.exp(lerp(Math.log(metered), Math.log(anchored), wE));
    // GPU→CPU readbacks are a sync point: none at all while the exposure is anchored to the Earth, and at most
    // ~5 per second otherwise (the exposure is filtered over ~0.4 s anyway)
    const nowM = performance.now(), meterDue = !app.meterAt || nowM - app.meterAt > 200;
    pipe.meter.skip = !app.snapSeq && !app.snapEye && (wE > 0.98 || !meterDue); if (!pipe.meter.skip) app.meterAt = nowM;
    if (app.snapSeq && pipe.meter.synced >= app.snapSeq) { app.eye = target; app.snapSeq = 0; }   // the first measurement of the new view (async, a frame or two after a jump)
    if (app.snapEye) {      // a jump: start from the film's designed exposure for this moment, refine when the first measurement of the new view lands
      pipe.meter.forceSync = true; app.snapSeq = pipe.meter.seq + 1; app.snapEye = false;
      app.eye = Math.exp(lerp(Math.log(clamp(S.exposure, 0.012, S.evMax ?? 2.6) * (S.evBias ?? 1) * (1 - 0.72 * sunBig)), Math.log(anchored), wE));
    }
    if (app.eye == null) app.eye = target;
    else if (!app.snapSeq) { const k = Math.log(target / app.eye); app.eye *= Math.exp(k * (1 - Math.exp(-dt * (k < 0 ? 3.0 : 1.2)))); }   // eased (exponential) approach: no linear ramps that stop dead
    S.exposure = app.eye;
  }
  renderer.toneMappingExposure = S.exposure * app.evMul;
  U.uNightGain.value = clamp(0.95 / Math.max(S.exposure, 0.05), 1, 2.2);   // the night side's city lights stay readable when a bright key lowers the exposure
  if (!pipe) return;
  pipe.bloom.strength = S.bloom * 0.32; pipe.bloom.threshold = 1.5 / Math.max(S.exposure, 0.02); pipe.bloom.knee = 0.5; pipe.bloom.radius = 0.6;   // only what is brighter than white after exposure, and gently   // bloom what is bright on screen, not in absolute HDR
  const g = S.grade, gu = pipe.grade.uniforms;
  gu.uLift.value.set(g[0], g[1], g[2]); gu.uGamma.value.set(g[3], g[4], g[5]); gu.uGain.value.set(g[6], g[7], g[8]); gu.uSat.value = g[9];
  gu.uTime.value = U.uTime.value; pipe.lens.uniforms.uTime.value = U.uTime.value;
  const rate = dt > 0 ? Math.abs(cam.logd - prevLogd) / dt : 0; prevLogd = cam.logd;
  zoomBlur += (clamp((rate - 0.35) * 0.012, 0, 0.022) - zoomBlur) * (1 - Math.exp(-dt * 6));   // only on the very fastest scale jumps, and gently
  pipe.lens.uniforms.uZoom.value = zoomBlur;
  pipe.temporal.feedback = 0.5 * (1 - clamp(rate * 1.5, 0, 0.8));
  // heat haze over the engines: render the offset field only when it can be seen
  const hz = earth.haze, hzOn = L0.active && hz.amp.value > 0.003;
  pipe.distort.enabled = hzOn;
  if (hzOn) { const rt0 = renderer.getRenderTarget(); renderer.setRenderTarget(pipe.hazeRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); renderer.render(hz.scene, L0.cam); renderer.setRenderTarget(rt0); }
  setLensLights(r1);
}
function project(pArt, out) { out.copy(pArt).applyMatrix4(master.matrixWorldInverse); const behind = out.z > 0; out.applyMatrix4(master.projectionMatrix); return !behind; }
function occlusion(lightArt, center, radius) {
  const ro = cam.pos, rd = lightArt.clone().sub(ro), L = rd.length(); rd.divideScalar(L);
  const oc = center.clone().sub(ro), tt = oc.dot(rd); if (tt < 0 || tt > L) return 1;
  const dd = oc.addScaledVector(rd, -tt).length(); return smooth(radius * 0.97, radius * 1.1, dd);
}
function setLensLights(r1) {
  const Ls = pipe.lens.uniforms.uL.value, Cs = pipe.lens.uniforms.uLC.value;
  const src = [];
  // the Sun
  const sunP = new THREE.Vector3();
  if (L1.active) {
    let I = 0.3 * clamp(2.2 / Math.max(r1, 0.05), 0.04, 1.6) * (1 - smooth(1.5e4, 4e4, r1)); const I0 = I;
    const occE = occlusion(sunP, S.earth, EARTH_R * 1.04); I *= occE;
    S.sunGlare = 0.3 + 0.7 * occE;                                  // (used by the Sun's glare next frame)
    for (const b of PLANETS) I *= occlusion(sunP, solar.bodies[b.key].group.position, b.r);
    src.push([sunP, I, [1.0, 0.85, 0.65], I0]);
  }
  if ((S.newSun || 0) > 0.05 && S.newSunDir) {                     // the new sun: flares only once it clears the limb
    const p = S.newSunDir.clone().multiplyScalar(5200 * K0).add(S.earth);
    src.push([p, 0.55 * S.newSun * occlusion(p, S.earth, EARTH_R * 1.03), [1.0, 0.86, 0.66], 0.55 * S.newSun]);
  }
  for (const s of galaxy.stars) if ((s.key === 'acen' || (s.key === 'sol' && !L1.active)) && s.I > 0.05) {
    let I = Math.min(s.I, 4) * 0.22;
    const pa = s.pos.clone().multiplyScalar(ART_PER_LY);
    if (L0.active) I *= occlusion(pa, S.earth, EARTH_R * 1.04);
    src.push([pa, I, s.key === 'acen' ? [1.0, 0.92, 0.78] : [1.0, 0.9, 0.75]]);
  }
  // crepuscular rays from the dominant light, cast past whatever crosses it (the Earth's limb, rings, ships)
  const rs = src[0] && (src[0][3] ?? src[0][1]) > 0.01 ? src[0] : null, B = pipe.bloom;
  if (rs && project(rs[0], tmpV)) {
    const x = tmpV.x * 0.5 + 0.5, y = tmpV.y * 0.5 + 0.5, on = 1 - smooth(0.0, 0.35, Math.max(-x, x - 1, -y, y - 1, 0));
    B.rayPos.set(x, y); B.rayCol.setRGB(...rs[2]); B.rayThr = 7;                 // only the disc itself casts shafts, never its glare
    const occ = rs[3] ? clamp(rs[1] / rs[3], 0, 1) : 1, graze = 4 * occ * (1 - occ);       // shafts only while a limb, ring or hull is crossing the disc
    app.rayI = (app.rayI ?? 0) + (0.45 * graze * on - (app.rayI ?? 0)) * 0.15;
  } else app.rayI = (app.rayI ?? 0) * 0.85;
  B.rayI = app.rayI;
  for (let i = 0; i < 3; i++) {
    const s = src[i];
    if (!s || s[1] < 0.01) { Ls[i].set(0, 0, 0, 0); continue; }
    const front = project(s[0], tmpV);
    const x = tmpV.x * 0.5 + 0.5, y = tmpV.y * 0.5 + 0.5;
    const on = front ? (1 - smooth(0.0, 0.25, Math.max(-x, x - 1, -y, y - 1, 0) )) : 0;
    Ls[i].set(x, y, s[1], on); Cs[i].setRGB(...s[2]);
  }
}

/* ------------------------------------------------------------------ UI */
function setMode(m) {
  app.mode = m;
  document.body.classList.toggle('free', m === 'free');
  document.body.classList.toggle('cinematic', m === 'story');
  $('m-film').classList.toggle('on', m !== 'free'); $('m-explore').classList.toggle('on', m === 'free');
  if (m === 'free') $('voyage').value = app.t;
  updatePlay();
  dash && dash.sync();
}
function goFilm() { if (app.mode === 'free') { setMode('story'); app.free = null; $('info').classList.remove('on'); ORRERY.extra = 0; ORRERY.speed = 0; document.querySelectorAll('.seg3 button').forEach((x, i) => x.classList.toggle('on', i === 0)); } if (app.ended) startStory(0); else { app.playing = true; updatePlay(); } }
function goExplore() {
  clearTimeout(goExplore.t); goExplore.t = setTimeout(() => document.body.classList.add('hinted'), 14000);
  if (app.mode === 'free') return;
  Sound.start();
  if (app.mode === 'intro') { $('start').classList.add('gone'); $('hud').classList.add('on'); app.t = 0; }
  app.playing = false; $('end').classList.remove('on');
  const a = currentAnchor(), h = HOT.find(h => h.anchor === a);
  enterFree(a, h ? Math.max(h.frame, Math.min(cam.pos.distanceTo(anchorArt(a, app.t)), h.frame * 4)) : undefined);
}
function updatePlay() { $('b-play').innerHTML = app.mode === 'story' && app.playing ? '❚❚' : '▶'; $('b-play').title = app.playing ? 'Pause (Space)' : 'Play (Space)'; }
function startStory(from = 0) {
  // from the title, the film flows straight on from the title's camera (no cut): countdown, then ignition
  const flow = app.mode === 'intro' && from === 0;
  app.snapCam = !flow; app.prelude = flow;
  Sound.start();
  $('start').classList.add('gone'); $('end').classList.remove('on'); $('hud').classList.add('on');
  app.ended = false; if (!flow) app.t = from; app.target = null; app.playing = true; app.free = null; app.lastChapter = -1; app.lastCap = -1;
  $('info').classList.remove('on');
  setMode('story');
  dash && dash.sync();
}
function endStory() { if (app.hooks.onEnd) { app.hooks.onEnd(); return; } app.playing = false; app.ended = true; updatePlay(); $('end').classList.add('on'); Sound.boom(48, 7); dash && dash.sync(); }
function seek(t) {
  app.snapCam = true; app.snapEye = true; pipe && pipe.temporal.reset(); if (app.mode !== 'story') { setMode('story'); app.free = null; } app.target = clamp(t, 0, DURATION); $('end').classList.remove('on'); }
function chapterAt(t) { let c = 0; CHAPTERS.forEach((ch, i) => { if (t >= ch.t) c = i; }); return c; }
function buildUI() {
  const segs = $('segs');
  CHAPTERS.forEach((c, i) => {
    const s = document.createElement('button'); s.type = 'button'; s.className = 'seg';
    const next = CHAPTERS[i + 1] ? CHAPTERS[i + 1].t : DURATION; s.style.flexGrow = String(next - c.t);
    s.innerHTML = `<i></i><span>${String(c.n).padStart(2, '0')} · ${c.title}</span>`;
    s.addEventListener('click', () => { seek(c.t + 0.01); if (!app.playing) { app.playing = true; updatePlay(); } });
    segs.appendChild(s); c.el = s;
  });
  $('b-begin').onclick = () => startStory(+params.get('t') || 0);
  $('b-explore').onclick = () => {          // launch: the planet ignites while the camera pulls back to reveal it, the ring and the fleet
    Sound.start(); $('start').classList.add('gone'); $('hud').classList.add('on'); app.ended = false; app.playing = false; app.prelude = false;
    app.t = 0; app.freeIgn = performance.now(); enterFree('earth', EARTH_R * 5.2); if (app.free.fly) app.free.fly.dur = 4600;
  };
  $('b-again').onclick = () => startStory(0);
  $('b-free2').onclick = () => { $('end').classList.remove('on'); enterFree('gc', 90000 * ART_PER_LY); };
  $('b-play').onclick = () => { if (app.mode !== 'story') { goFilm(); return; } if (app.ended) startStory(0); else { app.playing = !app.playing; updatePlay(); } };
  $('m-film').onclick = goFilm;
  $('m-explore').onclick = goExplore;
  buildDestinations(); buildScale();
  $('voyage').addEventListener('input', e => { app.t = +e.target.value; app.target = null; });
  document.querySelectorAll('.seg3 button').forEach(b => b.onclick = () => { ORRERY.speed = +b.dataset.v; document.querySelectorAll('.seg3 button').forEach(x => x.classList.toggle('on', x === b)); });
  $('b-sound').onclick = () => { const on = Sound.toggle(); $('b-sound').classList.toggle('off', !on); };
  $('b-hud').onclick = () => toggleHud();
  $('b-fs').onclick = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); };
  buildHotspots();
}
const DEST = [
  ['EARTH & FLEET', [['earth', '#7fc6ff'], ['moon', '#d8d8d8'], ['engines', '#8fb4ff'], ['steer', '#a99cff'], ['elevator', '#cfe8ff'], ['ring', '#ffd59a'], ['flagship', '#9fe3ff'], ['fleet', '#9fe3ff'], ['observatory', '#ffe6b0']]],
  ['SOLAR SYSTEM', [['orrery', '#ffd27a'], ['sun', '#ffb347'], ['mercury', '#b9b4ae'], ['venus', '#f2d79a'], ['mars', '#ff7a4a'], ['jupiter', '#e7c79c'], ['saturn', '#f0dc9a'], ['uranus', '#9fe6ef'], ['neptune', '#5d8cff'], ['pluto', '#e8c7a8'], ['eris', '#eeeeee']]],
  ['INTERSTELLAR', [['acen', '#fff0c8'], ['gcloud', '#b07cff'], ['pleiades', '#9ec2ff'], ['orion', '#ff7aa0'], ['carina', '#ff9a7a']]],
  ['MILKY WAY', [['solGal', '#ffe9b0'], ['gc', '#ffcf8a'], ['milkyway', '#d9c8ff'], ['lmc', '#c8d8ff'], ['smc', '#c8d8ff']]],
];
function buildDestinations() {
  const root = $('dest-list'); let k = 0;
  for (const [grp, items] of DEST) {
    const g = document.createElement('div'); g.className = 'd-grp'; g.textContent = grp; root.appendChild(g);
    for (const [key, col] of items) {
      const h = HOT.find(h => h.key === key); if (!h) continue;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'd-it'; b.style.setProperty('--k', Math.min(k++, 12));
      b.innerHTML = `<i class="d-ic" style="color:${col}"></i><span class="d-nm">${h.name.replace(' · YOU ARE HERE', '')}<small>${h.kicker}</small></span><span class="d-ds"></span>`;
      b.onclick = () => focusHotspot(h);
      root.appendChild(b); h.dEl = b; h.dDist = b.querySelector('.d-ds');
    }
  }
}
// "Powers of ten": camera distance → a physical length, piecewise log-linear through the scale ladder
const SCALE = [[1e-6, 0.67], [EARTH_R, 6371], [0.5, 0.5 / K0 * 63.71], [2.2, 1.496e8], [80, 1.8e10], [ART_PER_LY, 9.46e12], [1e5 * ART_PER_LY, 9.46e17]].map(([a, k]) => [Math.log10(a), Math.log10(k)]);
function artToKmLog(a) { const x = Math.log10(Math.max(a, 1e-12)); let i = 0; while (i < SCALE.length - 2 && x > SCALE[i + 1][0]) i++; const [x0, y0] = SCALE[i], [x1, y1] = SCALE[i + 1]; return y0 + (x - x0) / (x1 - x0) * (y1 - y0); }
function kmLogToArt(y) { let i = 0; while (i < SCALE.length - 2 && y > SCALE[i + 1][1]) i++; const [x0, y0] = SCALE[i], [x1, y1] = SCALE[i + 1]; return Math.pow(10, x0 + (y - y0) / (y1 - y0) * (x1 - x0)); }
const RULER = { lo: 2, hi: 18.3 };
const MARKS = [[3.2, 'PLANET'], [5.3, 'ORBIT'], [8.17, '1 AU'], [10.25, 'HELIOPAUSE'], [12.98, '1 LIGHT-YEAR'], [16.2, 'LOCAL ARM'], [17.98, 'MILKY WAY']];
function buildScale() {
  const f = y => (y - RULER.lo) / (RULER.hi - RULER.lo);
  for (const [y, t] of MARKS) {
    const m = document.createElement('div'); m.className = 'r-mk'; m.style.left = (f(y) * 100).toFixed(2) + '%'; m.innerHTML = `<span>${t}</span>`; $('r-marks').appendChild(m);
    const l = document.createElement('div'); l.className = 'l-mk'; l.style.top = ((1 - f(y)) * 100).toFixed(2) + '%'; l.textContent = t; $('ld-marks').appendChild(l);
  }
  $('ruler').addEventListener('click', e => {
    const r = $('ruler').getBoundingClientRect(), y = RULER.lo + clamp((e.clientX - r.left) / r.width) * (RULER.hi - RULER.lo);
    const d = kmLogToArt(y);
    if (app.mode !== 'free') goExplore();
    const big = d > 3000 * ART_PER_LY, anchor = big ? 'gc' : (d > 4 * ART_PER_LY ? 'sol' : app.free.anchor);
    enterFree(anchor, Math.max(d, minDist(anchor)));
  });
}
function updateScale() {
  const y = artToKmLog(cam.d), f = clamp((y - RULER.lo) / (RULER.hi - RULER.lo));
  $('r-cursor').style.left = (f * 100).toFixed(2) + '%';
  $('ld-cursor').style.top = ((1 - f) * 100).toFixed(2) + '%';
  $('ld-val').textContent = fmtSpan(2 * cam.d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
}
function currentAnchor() { const i = keys.findIndex(k => k.t > app.t); const k = keys[Math.max(0, i - 1)] || keys[0]; return ['hero', 'climber', 'hub0'].includes(k.anchor) ? 'earth' : k.anchor; }
// ◐ / H: show or hide the mission-control dashboards (open by default; the choice is kept for the session)
function toggleHud() { if (!dash) return; const on = dash.setEnabled(!dash.enabled); $('b-hud').classList.toggle('off', !on); $('b-hud').title = on ? 'Hide dashboards (H)' : 'Show dashboards (H)'; }
const fmt = (x, d = 1) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtLen(km) {
  const ly = km / 9.46e12;
  if (ly >= 0.05) return ly >= 1000 ? `${fmt(ly, 0)} ly` : `${fmt(ly, ly < 10 ? 2 : 1)} ly`;
  if (km >= 1.5e7) { const au = km / 1.496e8; return `${fmt(au, au < 10 ? 2 : 1)} AU`; }
  return km >= 1e6 ? `${fmt(km / 1e6, 1)} M km` : `${fmt(km, 0)} km`;
}
function fmtDist(art) { return art < 1e-12 ? '—' : fmtLen(Math.pow(10, artToKmLog(art))); }
function fmtSpan(art) { return fmtLen(Math.pow(10, artToKmLog(art))); }   // width of the field of view
function galCoords(p) {   // galactic l, b of a direction
  const x = SKY.gc, z = SKY.ngp, y = new THREE.Vector3().crossVectors(z, x);
  const d = p.clone().normalize(); const l = (Math.atan2(d.dot(y), d.dot(x)) * 180 / Math.PI + 360) % 360, b = Math.asin(clamp(d.dot(z), -1, 1)) * 180 / Math.PI;
  return [l, b];
}
function updateHud(now) {
  const t = app.t, ci = chapterAt(t);
  // chapter card + audio cue
  if (app.mode === 'story' && ci !== app.lastChapter && t >= 1.2) {      // (chapter 1's card waits for the ignition)
    app.lastChapter = ci; const c = CHAPTERS[ci];
    $('cd-n').textContent = `CHAPTER ${c.n}`; $('cd-k').textContent = c.kicker;
    const gl = [...c.title], mid = (gl.length - 1) / 2;
    $('cd-t').innerHTML = gl.map((ch, i) => `<span style="--i:${i};--x:${((i - mid) / Math.max(mid, 1)).toFixed(3)}">${ch === ' ' ? ' ' : ch}</span>`).join('');
    $('cd-t').setAttribute('aria-label', c.title);
    const card = $('card'); card.classList.remove('on'); void card.offsetWidth; card.classList.add('on');
    clearTimeout(app.cardT); app.cardT = setTimeout(() => card.classList.remove('on'), 4800);
    Sound.chapter(ci); if (ci > 0) Sound.boom(ci === 4 ? 44 : 58, ci === 4 ? 7 : 4.5);
  }
  CHAPTERS.forEach((c, i) => {            // progress bars: a compositor-only transform, written only when it changes
    const next = CHAPTERS[i + 1] ? CHAPTERS[i + 1].t : DURATION, v = (clamp((t - c.t) / (next - c.t))).toFixed(3);
    if (c.bar !== v) { c.bar = v; (c.barEl || (c.barEl = c.el.querySelector('i'))).style.transform = `scaleX(${v})`; }
    if (c.cur !== (i === ci)) { c.cur = i === ci; c.el.classList.toggle('cur', c.cur); }
  });
  // the countdown: 3 · 2 · 1 · IGNITION, only on the flow in from the title
  { const on = app.mode === 'story' && t > -3.2 && t < 1.6 && (app.prelude || t > 0), k = t < 0 ? String(Math.ceil(-t)) : 'IGNITION';
    if (on !== app.ctOn) { app.ctOn = on; $('count').classList.toggle('on', on); }
    if (on && k !== app.ctK && t > -3) { app.ctK = k; const n = $('ct-n'); n.textContent = k; n.classList.toggle('word', t >= 0); $('count').classList.remove('tick'); void n.offsetWidth; $('count').classList.add('tick'); }
    if (!on) app.ctK = null; }
  // captions
  let cap = -1; CAPTIONS.forEach(([a, b], i) => { if (t >= a && t <= b) cap = i; });
  if (app.mode !== 'story') cap = -1;
  if (cap !== app.lastCap) { app.lastCap = cap; const el = $('caption'); el.classList.remove('on'); if (cap >= 0) setTimeout(() => { el.textContent = CAPTIONS[cap][2]; el.classList.add('on'); }, 350); }
  // music levels
  Sound.level({ drone: ci >= 3 ? 0.35 : 0.6, rumble: ci === 0 ? 0.7 : ci === 1 ? 0.35 : 0.15, pad: 0.55 + 0.1 * ci, shimmer: ci >= 3 ? 0.8 : 0.1 });
  updateScale();
  if (app.mode === 'story' && app.lastT != null && app.lastT < 0.45 && t >= 0.45 && t < 2) { Sound.boom(46, 6); }
  app.lastT = t;
  if (now - lastHud < 200) return; lastHud = now;
  if (app.mode === 'free') {
    for (const h of HOT) if (h.dDist) { h.dDist.textContent = fmtDist(anchorArt(h.anchor, t).distanceTo(cam.pos)); h.dEl.classList.toggle('cur', !!app.free && app.free.anchor === h.anchor && h.key !== 'earthDeep'); }
    $('voyage-y').textContent = `${S.year} CE`;
    if (document.activeElement !== $('voyage')) $('voyage').value = t;
  }
  const tp = Math.max(t, 0), m = Math.floor(tp / 60), s = Math.floor(tp % 60);
  $('time').textContent = `${m}:${String(s).padStart(2, '0')} / ${Math.floor(DURATION / 60)}:${String(Math.floor(DURATION % 60)).padStart(2, '0')}`;
  const thrust = 97.6 * S.power;
  $('d-engine').textContent = `${fmt(thrust, 1)}% · 10,000 ONLINE`;
  $('d-engine-bar').style.width = clamp(thrust, 0, 100) + '%';
  $('d-speed').textContent = S.speed >= 300 ? `${fmt(S.speed / 299792 * 100, 2)}% c` : `${fmt(S.speed, 1)} km/s`;
  $('d-dist').textContent = fmtDist(S.earth.length());
  const camLy = (app.mode === 'free' || t >= 112) ? cam.pos.length() / ART_PER_LY : 0;
  $('d-region').textContent = regionAt(t, camLy);
  const [l, b] = galCoords(S.earth.length() > 1e-6 ? S.earth : SKY.acen);
  $('d-coord').textContent = `l ${fmt(l, 1)}°  b ${b >= 0 ? '+' : '−'}${fmt(Math.abs(b), 1)}°`;
  $('d-year').textContent = `${S.year} CE`;
  $('d-fov').textContent = fmtSpan(2 * cam.d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
}

/* ------------------------------------------------------------------ input */
function bindInput() {
  if (WP) return;            // the wallpaper controller owns input (parallax, clicks)
  let down = null, moved = 0;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; moved = 0; app.dragging = true; canvas.setPointerCapture(e.pointerId); });
  // film mode: the controls fade away after a few still seconds, and come back on any movement
  { let idleT = 0; const wake = () => { app.lastInput = performance.now(); document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (app.mode === 'story' && app.playing) document.body.classList.add('idle'); }, 3200); };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, wake, { passive: true }); wake(); }
  canvas.addEventListener('pointermove', e => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y; down.x = e.clientX; down.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (app.mode === 'free' && app.free) { const F = app.free; F.ty = (F.ty ?? F.yaw) - dx * 0.005; F.tp = clamp((F.tp ?? F.pitch) + dy * 0.004, -1.4, 1.4); F.fly = null; }
    else if (TOUCH && Math.abs(dy) > Math.abs(dx) * 1.6 && app.mode === 'story') { scrub(-dy * 0.06); }
    else { app.look.yaw = clamp(app.look.yaw - dx * 0.0025, -0.9, 0.9); app.look.pitch = clamp(app.look.pitch - dy * 0.0025, -0.6, 0.6); }
  });
  const up = () => { down = null; app.dragging = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  addEventListener('wheel', e => {
    if (app.mode === 'intro') return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    if (app.mode === 'free' && app.free) { const F = app.free; F.td = clamp((F.td ?? F.d) * Math.exp(dy * 0.0016), minDist(F.anchor), 1.6e5 * ART_PER_LY); F.fly = null; }
    else scrub(dy * 0.012);
  }, { passive: false });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); if (app.mode === 'intro') startStory(0); else $('b-play').click(); }
    else if (e.code === 'ArrowRight') { const c = chapterAt(app.t); if (CHAPTERS[c + 1]) seek(CHAPTERS[c + 1].t + 0.01); }
    else if (e.code === 'ArrowLeft') { const c = chapterAt(app.t); seek(app.t - CHAPTERS[c].t > 2 ? CHAPTERS[c].t + 0.01 : CHAPTERS[Math.max(0, c - 1)].t + 0.01); }
    else if (e.code === 'KeyF') { if (app.mode === 'free') goFilm(); else goExplore(); }
    else if (e.code === 'KeyH') toggleHud();
    else if (e.code === 'KeyM') $('b-sound').click();
    else if (e.code === 'Escape' && app.mode === 'free') goFilm();
  });
}
function minDist(anchor) { const h = HOT.find(h => h.anchor === anchor); return h ? Math.max(h.range[0] * 1.2, h.frame * 0.4) : EARTH_R * 1.3; }
function scrub(ds) {
  if (app.mode !== 'story') return;
  app.playing = false; updatePlay();
  app.target = clamp((app.target ?? app.t) + ds, 0, DURATION);
  showHint('SCROLLING THROUGH TIME · PRESS ▶ TO RESUME');
}
let hintT = 0;
function showHint(s) { const h = $('hint'); h.textContent = s; h.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => h.classList.remove('on'), 1800); }

/* ------------------------------------------------------------------ adaptive resolution */
const perf = { acc: 0, n: 0, k: 1, slow: 0 };
function adapt(dt) {
  if (params.get('dpr') || !pipe) return;
  perf.acc += dt; perf.n++;
  const capped = !!app.frameBudget, budget = (app.frameBudget || 1000 / 60) / 1000;   // as a wallpaper: the fps cap's frame interval
  if (perf.n < Math.max(45, Math.round(1.5 / budget))) return;                        // ~1.5 s windows
  const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
  // smoothness first: frames arriving 25 % late for two windows → step down; the order of sacrifice is
  // resolution (down to 60 %), then the shadow map's refresh rate. Recovery is slow, and when frames are capped
  // (arriving on time says nothing about headroom) it never retries a scale that failed in the last two minutes.
  perf.slow = avg > budget * 1.25 ? perf.slow + 1 : 0;
  perf.fast = (capped ? avg < budget * 1.06 : avg < 0.0125) ? (perf.fast || 0) + 1 : 0;
  let k = 0; const now = performance.now();
  if (perf.slow >= 2) {
    perf.slow = 0;
    if (perf.k > 0.6) { k = Math.max(0.6, perf.k * 0.85); perf.failK = perf.k; perf.failAt = now; }
    else if (Q.shadowMap && (S.shadowEvery || Q.shadowEvery) < 4) S.shadowEvery = 4;
  } else if (perf.fast >= (capped ? 12 : 4) && perf.k < 1) {
    const nk = Math.min(1, perf.k * 1.08);
    if (!capped || !(perf.failK && nk >= perf.failK - 1e-6 && now - perf.failAt < 120000)) { perf.fast = 0; k = nk; }
  }
  if (k) { perf.k = k; resize(); }
}
// Live quality change (no reload, no scene rebuild): resolution and pixel budget, MSAA, the sun's shadow map,
// bloom levels, plume ray-march steps and the frame cap. Instance budgets and the sky's ray-march steps stay as
// loaded (they size buffers / compile into shaders); they follow the tier at the next start.
function setTier(name) {
  const T = TIERS[name]; if (!T || !pipe) return;
  Object.assign(Q, { scale: T.scale, maxPx: T.maxPx, msaa: T.msaa, shadowMap: T.shadowMap, shadowEvery: T.shadowEvery, bloomLevels: T.bloomLevels, fps: T.fps, volSteps: T.volSteps, tier: name });
  Q.dpr = WP ? T.scale : Math.min(devicePixelRatio, Math.max(T.scale, 1));
  pipe.setSamples(T.msaa); earth.setShadowSize(T.shadowMap); S.shadowEvery = 0;
  pipe.bloom.levels = Math.min(T.bloomLevels, pipe.bloom.mips.length); U.uVolSteps.value = T.volSteps;
  perf.k = 1; perf.failK = null; perf.slow = perf.fast = 0; resize(); pipe.temporal.reset();
}
function resize() {
  renderer.setPixelRatio(baseDpr() * perf.k * app.renderScale);
  renderer.setSize(innerWidth, innerHeight);
  pipe && pipe.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

/* ------------------------------------------------------------------ boot */
let last = performance.now();
function loop(now) {
  if (app.hooks.gate && !app.hooks.gate(now)) { requestAnimationFrame(loop); return; }   // wallpaper: paused, or over the fps limit
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  pipe.collect();                 // exposure readbacks first, while the GPU queue holds only last frame's work
  frame(dt, now);
  pipe.render(dt);
  updateHotspots();
  if (app.mode !== 'intro') updateHud(now);
  if (dash) dash.tick(now);          // dashboards: throttled inside (≤ 20 Hz bars / canvas, ≤ 10 Hz text); free when inactive
  adapt(dt);
  requestAnimationFrame(loop);
}
(async () => {
  try {
    buildUIShell();
    await load();
    buildUI(); bindInput();
    // intro: a slow drift over the engine field behind the title
    dash = createDash({ app, S, cam, U, CHAPTERS, DURATION, WP, artToKmLog, fmt, fmtDist, fmtSpan, fmtLen, galCoords, regionAt, chapterAt, ART_PER_LY, SKY, tmpV: new THREE.Vector3() });
    if (!dash.enabled) $('b-hud').classList.add('off');
    window.__emReady = true;
    $('loader').classList.add('done');
    window.__beyond = { app, S, cam, snap: () => { app.snapEye = true; pipe.temporal.reset(); }, anchorArt, layers, U, keys, evalCamera, earth, solar, galaxy, get pipe() { return pipe; }, renderer, Q, TIERS, setTier, minDist, ART_PER_LY, anchorArtInto: (n, t, out) => (earth.world[n] && n !== 'earth' ? out.copy(earth.world[n]).multiplyScalar(K0).add(S.earth) : out.copy(anchorArt(n, t))), startStory, enterFree, setMode, resize, focus: key => { const h = HOT.find(h => h.key === key); if (h) focusHotspot(h); }, HOT, Sound, CHAPTERS, DURATION, seek: t => { if (app.mode === 'intro') startStory(t); app.t = t; app.target = null; app.playing = false; updatePlay(); app.snapEye = true; app.snapCam = true; pipe.temporal.reset(); }, free: (a, d) => enterFree(a, d), get dash() { return dash; } };
    if (params.has('autoplay')) startStory(+params.get('t') || 0);
    requestAnimationFrame(t => { last = t; loop(t); });
  } catch (e) {
    console.error(e);
    $('ld-status').style.color = '#ff8a8a'; $('ld-status').textContent = 'SYSTEM FAULT · ' + (e.message || e);
  }
})();
function buildUIShell() { /* markup lives in beyond.html */ }
