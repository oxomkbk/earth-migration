// The director: Earth's flight path, the continuous camera path (no cuts — every shot hands over to the
// next through the scale ladder), world state over time, narration and mission telemetry.
import * as THREE from 'three';
import { mulberry32, clamp, lerp, smooth, smoother, crWeights, EARTH_R, K0, ART_PER_LY, au2art, art2au, SKY, GC_DIST } from './util.js';
import { bodyPos } from './solar.js';
import { toSpinFrame, SPIN0, SPIN_RATE, TILT } from './earth.js';

const Y = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const DURATION = 174;
export const CHAPTERS = [
  { n: 1, title: 'The Wandering Earth', label: 'Chapter 1 — The Wandering Earth', t: 0, kicker: 'YEAR 2078 · ORBIT OF EARTH · 1 AU' },
  { n: 2, title: 'The Solar System', label: 'Chapter 2 — The Solar System', t: 32, kicker: 'YEAR 2079–2093 · 1 → 10 AU' },
  { n: 3, title: 'Beyond the Outer Planets', label: 'Chapter 3 — Beyond the Outer Planets', t: 66, kicker: 'YEAR 2101–2156 · 30 → 120 AU' },
  { n: 4, title: 'Interstellar Voyage', label: 'Chapter 4 — Interstellar Voyage', t: 88, kicker: 'YEAR 2160–2580 · 0.002 → 1.6 LY' },
  { n: 5, title: 'The Milky Way', label: 'Chapter 5 — The Milky Way', t: 112, kicker: 'ORION SPUR · 26,700 LY FROM THE GALACTIC CENTRE' },
  { n: 6, title: 'A New Sun', label: 'Chapter 6 — A New Sun', t: 147, kicker: 'YEAR 4578 · ALPHA CENTAURI · 4.37 LY' },
];
export const CAPTIONS = [
  [1.5, 7.5, 'The Sun is dying. Ten thousand fusion engines turn its light into our way out.'],
  [10.6, 16.5, 'Space elevator: 36,000 km from the equator to geostationary orbit.'],
  [17.2, 22.8, 'The climbers carry the last of the surface up to the stars.'],
  [23.4, 28, 'Tianshu Station: docks and habitats on the geostationary ring.'],
  [28.4, 31.5, 'Ahead of the planet flies its escort, the Navigator fleet.'],
  [30.5, 33.5, 'We left with the whole world on board.'],
  [34, 40, 'One planet, sailing outwards through the system that raised it.'],
  [40.5, 46, 'Years pass in seconds. The planets wheel around a swelling Sun.'],
  [47, 53, 'Behind us, the Sun convulses: flares, loops and storms of plasma.'],
  [54, 58.5, 'Jupiter\'s gravity bends our course and flings us on.'],
  [58.5, 64.5, 'Saturn\'s rings, lit from behind, the last warm light we will see.'],
  [67.5, 73.5, 'Neptune. Sunlight here is nine hundred times weaker.'],
  [74.5, 80, 'The Kuiper Belt: ice, dark, and silence.'],
  [80.5, 86.5, 'At 120 AU the solar wind stalls. We cross the heliopause.'],
  [89.5, 96.5, 'Interstellar space. Earth punches a bow shock into the thin gas between the stars.'],
  [97.5, 103.5, 'Four centuries. A hundred generations born under frozen skies.'],
  [104.5, 110.5, 'Ahead, Alpha Centauri grows brighter every year.'],
  [113, 119, 'Pull back, and the whole voyage is a line a few light-years long.'],
  [120, 126, 'Our neighbourhood: the Orion Spur, a minor arm of stars and gas.'],
  [128, 136, 'And beyond it, four hundred billion suns. The Milky Way.'],
  [137.5, 145, 'A small journey across the Galaxy, and a beginning.'],
  [148, 153.5, 'Twenty-five centuries after we left.'],
  [155, 160.5, 'Alpha Centauri. A new sun.'],
  [161.5, 167, 'Daylight on the ice, for the first time in a hundred generations.'],
  [168, 173.5, 'The Wandering Earth has found its harbour.'],
];

// --------------------------------------------------------------------------------- Earth's path (art-AU)
const ACEN = SKY.acen.clone();
function ecl(lon, r, y = 0) { const l = THREE.MathUtils.degToRad(lon); return V(Math.cos(l) * r, y, -Math.sin(l) * r); }
function radialTangent(p) { const r = p.clone().setY(0).normalize(); return { r, tg: V(-r.z, 0, r.x).negate() }; }   // tangent in the direction of orbital motion
const flyby = (key, t, dr, dt_, dy) => () => { const p = bodyPos(key, t, new THREE.Vector3()); const { r, tg } = radialTangent(p); return p.addScaledVector(r, dr).addScaledVector(tg, dt_).add(V(0, dy, 0)); };
const COARSE = [
  [-6, () => ecl(144, 2.2)],
  [0, () => ecl(150, 2.2)],
  [14, () => ecl(157, 2.26)],
  [26, () => ecl(164, 2.55)],
  [38, () => ecl(178, 3.9, 0.05)],
  [47, () => ecl(192, 5.8, 0.1)],
  [55.8, flyby('jupiter', 55.8, -0.13, 0.17, 0.03)],
  [62.4, flyby('saturn', 62.4, 0.2, 0.16, 0.06)],
  [70.2, flyby('neptune', 70.2, 0.1, 0.12, 0.02)],
  [77, flyby('pluto', 77, -0.03, 0.05, 0.012)],
  [84, () => ACEN.clone().multiplyScalar(82)],
  [90, () => ACEN.clone().multiplyScalar(150)],
].map(([t, f]) => ({ t, p: f() }));
// slow the planet through each flyby so the camera can hold the encounter
const LINGER = { 55.8: [1.7, 0.05], 62.4: [1.7, 0.06], 70.2: [1.5, 0.045], 77: [1.3, 0.008] };
const PATH = COARSE.flatMap((k, i) => {
  const L = LINGER[k.t]; if (!L) return [k];
  const v = COARSE[i + 1].p.clone().sub(COARSE[i - 1].p).normalize();
  return [{ t: k.t - L[0], p: k.p.clone().addScaledVector(v, -L[1]) }, k, { t: k.t + L[0], p: k.p.clone().addScaledVector(v, L[1]) }];
});
// beyond the heliopause the distance grows by orders of magnitude: interpolate log(r) along α Cen
const LOGR = [[84, 82], [90, 150], [96, 900], [102, 12000], [108, 60000], [114, 96000], [124, 104000], [140, 160000], [150, 262000], [156, 273800], [170, 274300], [200, 274500]].map(([t, r]) => [t, Math.log(r)]);
function hermite(keys, t, get) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(i - 1, 0)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(i + 2, keys.length - 1)];
  const t0m = i > 0 ? k0.t : k1.t - (k2.t - k1.t), t1p = i + 2 < keys.length ? k3.t : k2.t + (k2.t - k1.t);
  const w = crWeights(t0m, k1.t, k2.t, t1p, clamp(t, k1.t, k2.t));
  return { w, ks: [k0, k1, k2, k3], s: w[4], i };
}
export function earthPos(t, out = new THREE.Vector3()) {
  if (t <= 86) {
    const { w, ks } = hermite(PATH, Math.max(t, PATH[0].t), null);
    out.set(0, 0, 0); ks.forEach((k, j) => out.addScaledVector(k.p, w[j]));
    if (t > 84) { const r = Math.exp(logR(t)); out.lerp(ACEN.clone().multiplyScalar(r), smooth(84, 86, t)); }
    return out;
  }
  return out.copy(ACEN).multiplyScalar(Math.exp(logR(t)));
}
function logR(t) { const keys = LOGR.map(([t, v]) => ({ t, v })); const { w, ks } = hermite(keys, t); return ks.reduce((a, k, j) => a + k.v * w[j], 0); }
export function earthVel(t) { const a = earthPos(t - 0.05), b = earthPos(t + 0.05); return b.sub(a).normalize(); }

// --------------------------------------------------------------------------------- world state
const KEYF = (keys, t) => { const ks = keys.map(([t, v]) => ({ t, v })); if (t <= ks[0].t) return ks[0].v; if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v; let i = 0; while (t > ks[i + 1].t) i++; const s = smooth(0, 1, (t - ks[i].t) / (ks[i + 1].t - ks[i].t)); return Array.isArray(ks[i].v) ? ks[i].v.map((v, j) => lerp(v, ks[i + 1].v[j], s)) : lerp(ks[i].v, ks[i + 1].v, s); };
const EXPOSURE = [[-4, 0.42], [1, 0.42], [6, 0.7], [11, 0.9], [26, 1.05], [36, 1.25], [42.5, 1.1], [46, 0.032], [50.5, 0.036], [53.5, 1.0], [58, 1.25], [63, 1.6], [69, 2.2], [76, 2.8], [84, 2.6], [92, 1.6], [104, 1.4], [108, 1.2], [114, 1.5], [122, 2.2], [128, 1.0], [140, 0.95]];
const BLOOM = [[0, 0.85], [43, 0.7], [46, 0.4], [50.5, 0.4], [53, 0.75], [76, 0.9], [92, 1.0], [116, 0.95], [130, 1.15]];
const GRADE = [   // lift, gamma, gain (rgb), saturation — lift stays near zero so space stays black, never a grey veil
  [0, [[0.0, 0.001, 0.004], [1.0, 1.0, 1.03], [1.03, 1.0, 0.97], 1.03]],
  [30, [[0.0, 0.001, 0.004], [1.0, 1.0, 1.03], [1.03, 1.0, 0.97], 1.03]],
  [44, [[0.002, 0.001, 0.0], [1.02, 1.0, 0.97], [1.04, 1.0, 0.95], 1.04]],
  [56, [[0.001, 0.001, 0.003], [1.0, 1.0, 1.0], [1.03, 1.0, 0.97], 1.03]],
  [70, [[0.0, 0.002, 0.006], [0.98, 1.0, 1.05], [0.95, 1.0, 1.06], 0.96]],
  [92, [[0.001, 0.0, 0.006], [0.98, 0.98, 1.06], [0.98, 0.99, 1.04], 1.04]],
  [116, [[0.001, 0.001, 0.003], [1.0, 1.0, 1.02], [1.02, 1.0, 0.99], 1.05]],
];
const FREEZE = [[0, 0.12], [30, 0.28], [56, 0.5], [72, 0.72], [90, 0.92], [158, 0.92], [174, 0.68]];
const SPEED_KMS = [[0, 30], [40, 34], [55, 52], [62, 48], [84, 60], [92, 400], [100, 1500], [146, 1500], [152, 300], [158, 22]];
const YEARS = [[0, 2078], [26, 2079], [55.5, 2088], [62, 2093], [70, 2121], [77, 2134], [84, 2156], [90, 2165], [102, 2290], [110, 2580], [146, 2620], [152, 4578], [174, 4578]];

export function regionAt(t, camLy) {
  if (t > 150) return 'ALPHA CENTAURI SYSTEM';
  if (camLy > 30000) return 'MILKY WAY · OUTER HALO VIEW';
  if (camLy > 1200) return 'ORION SPUR · LOCAL ARM';
  if (camLy > 6) return 'LOCAL BUBBLE · SOLAR NEIGHBOURHOOD';
  if (t < 30) return 'INNER SOLAR SYSTEM · EARTH ORBIT';
  if (t < 47) return 'SOLAR SYSTEM · ORRERY VIEW';
  if (t < 58) return 'JOVIAN SPACE';
  if (t < 66) return 'SATURN SYSTEM';
  if (t < 72) return 'OUTER PLANETS · NEPTUNE';
  if (t < 81) return 'KUIPER BELT';
  if (t < 88) return 'HELIOPAUSE';
  return 'INTERSTELLAR MEDIUM · G-CLOUD';
}

const NS_DIR = new THREE.Vector3();
export function worldState(t, S) {
  S.t = t;
  earthPos(t, S.earth); S.vel.copy(earthVel(t)); S.thrust.copy(S.vel);
  S.sunDir.copy(S.earth).negate().normalize();
  const r = S.earth.length();
  S.sunI = clamp(Math.pow(2.2 / r, 0.8), 0.015, 1.2);
  S.newSun = smooth(150, 157, t);
  if (S.newSun > 0) {
    NS_DIR.copy(ACEN).multiplyScalar(4.37 * ART_PER_LY).sub(S.earth).normalize();
    S.sunDir.lerp(NS_DIR, S.newSun).normalize(); S.newSunDir = NS_DIR;
    S.sunI = lerp(S.sunI, 1.05, S.newSun);
  }
  S.atmoI = S.sunI;
  S.freeze = KEYF(FREEZE, t);
  S.power = 1.0 + 0.04 * Math.sin(t * 1.7) + 0.03 * Math.sin(t * 4.3 + 1.0);
  S.orbits = smooth(30, 35, t) * (1 - smooth(47, 51, t)) * 0.9;
  S.trail = smooth(35, 38, t) * (1 - smooth(46, 49, t));
  S.belts = 1;
  S.track = smooth(28, 33, t) * (1 - smooth(88, 94, t));
  S.trackProg = clamp((t + 6) / 92);
  S.helio = smooth(78, 82.5, t) * (1 - smooth(86, 89, t));
  S.dust = Math.max(0, smooth(73, 78, t) * 0.5 + smooth(86, 90, t) * 0.5 - smooth(110, 114, t));
  S.dustSpeed = t < 88 ? 120 : 380;
  S.shards = smooth(73, 75.5, t) * (1 - smooth(80, 82, t));
  S.shock = smooth(87, 91, t) * (1 - smooth(116, 120, t));
  S.key2 = smooth(86, 92, t) * (1 - smooth(150, 156, t));   // cold starlight from α Centauri on the ice
  S.aurora = (smooth(66, 72, t) * 0.5 + smooth(86, 90, t) * 0.5) * (1 - smooth(150, 156, t));
  S.nebula = smooth(88, 94, t);
  S.oort = smooth(112.3, 114, t) * (1 - smooth(121, 124, t));     // the Sun's comet cloud, seen whole as we pull back past it
  S.route = smooth(116.5, 119, t) * (1 - smooth(126, 129, t));
  S.routeProg = clamp(Math.exp(logR(Math.max(t, 84))) / ART_PER_LY / 4.37);
  S.galRot = -0.006 * clamp(t - 124, 0, 23) * (1 - smooth(147.5, 153, t));   // settle back before diving to the planet
  S.flare = Math.exp(-Math.pow((t - 50.1) / 0.7, 2)) * 1.0 + smooth(47.5, 49.9, t) * (1 - smooth(50.5, 54, t)) * 0.3;
  S.cmeAge = t > 49.9 ? (t - 49.9) * 1.1 : -1;
  S.exposure = KEYF(EXPOSURE, t);
  S.evBias = KEYF([[0, 0.8], [8, 1.0], [10.5, 0.78], [23.5, 0.78], [26, 0.95], [45.5, 0.75], [48, 0.75], [53, 0.75], [55, 1.0], [80, 1.1], [92, 0.85], [112, 1.0], [124, 0.9], [130, 0.55], [147, 0.55], [152, 1.0]], t);   // the galaxy's bias ends with the galaxy
  S.bloom = KEYF(BLOOM, t);
  S.evMax = KEYF([[0, 2.6], [84, 2.6], [90, 1.5], [111, 1.5], [114, 2.6], [148, 2.6], [153, 1.5], [200, 1.5]], t);   // look-dev exposure ceiling around the planet in chapters 4 and 6
  const g = KEYF(GRADE.map(([t, v]) => [t, [...v[0], ...v[1], ...v[2], v[3]]]), t);
  S.grade = g;
  S.wake = 1;
  // ignition: the hero array lights at 0.4 s, then the front races across the hemisphere
  S.ignite = igniteAt(t);          // the title shows the quiet planet; the voyage begins with ignition
  S.shockP = t > 0.45 && t < 5 ? (t - 0.45) / 4.2 : 0;
  S.shake = t > 0.4 && t < 6 ? Math.exp(-(t - 0.45) * 0.9) : 0;
  S.climbH = smoother((t - 10.5) / 12.5);
  S.squad = t > 16.5 && t < 20.5 ? (t - 16.5) / 4 : t > 94 && t < 98.5 ? (t - 94) / 4.5 : -1;
  S.steer = 1 - 0.55 * smooth(84, 92, t);      // the spin trim eases off in deep space
  S.heroLight = 1 - smooth(10, 14, t);
  S.speed = KEYF(SPEED_KMS, t);
  S.year = Math.round(KEYF(YEARS, t));
  return S;
}
/** ignition front (radians from the hero array) at time t after the countdown; the hero array lights at 0.4 s */
export function igniteAt(t) { return t < 0.4 ? 0 : t < 1.6 ? 0.14 * (t - 0.4) / 1.2 : Math.min(0.14 + (t - 1.6) * 0.34, 10); }
export function newState() { return { earth: V(0, 0, 0), vel: V(0, 0, 1), thrust: V(0, 0, 1), sunDir: V(1, 0, 0) }; }

// --------------------------------------------------------------------------------- earth-layer story choices
/** Pick the hero engine site and elevator longitudes so the opening shots are lit the way the story wants. */
export function earthChoices() {
  const at = t => { const e = earthPos(t), s = e.clone().negate().normalize(), f = earthVel(t); return { s, f }; };
  const rnd = mulberry32(42);
  const pick = (score) => { let best = null, bs = -1e9; for (let i = 0; i < 6000; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, n = V(Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a)); const sc = score(n); if (sc > bs) { bs = sc; best = n; } } return best; };
  const a0 = at(3);
  // hero: trailing hemisphere, just on the morning side of the terminator, northern mid-latitudes
  const heroW = pick(n => -Math.pow(n.dot(a0.s) - 0.06, 2) * 30 + n.dot(a0.f.clone().negate()) * 1.2 + Math.max(0, 0.45 - Math.abs(n.y - 0.45)));
  const heroDirL = toSpinFrame(heroW, 3);
  // elevator 0: on the equator, in low morning light at t ≈ 15
  const a1 = at(15);
  let bestE = null, bsE = -1e9;
  for (let i = 0; i < 360; i++) {
    const a = i / 360 * Math.PI * 2, dL = V(Math.cos(a), 0, Math.sin(a));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, TILT)).multiply(new THREE.Quaternion().setFromAxisAngle(Y, SPIN0 + 15 * SPIN_RATE));
    const w = dL.clone().applyQuaternion(q);
    const sc = -Math.pow(w.dot(a1.s) - 0.3, 2) * 10 + 0.4 * w.dot(a1.f.clone().negate()) - 2 * Math.max(0, w.dot(heroW) - 0.7);
    if (sc > bsE) { bsE = sc; bestE = dL; }
  }
  const elevDirsL = [0, 1, 2].map(k => bestE.clone().applyAxisAngle(Y, k * Math.PI * 2 / 3));
  return { heroDirL, elevDirsL };
}

// --------------------------------------------------------------------------------- camera path
// A key: anchor name, offset of the camera from the anchor (art-AU, world frame), look offset (art-AU), fov, up.
// Anchors are evaluated at the current time, so moving subjects are tracked through the blend.
export function buildCameraKeys(ctx) {
  const { spinQ, heroDirL, elevDirsL } = ctx;
  const L0 = (v) => v.clone().multiplyScalar(K0);          // L0 units → art
  const frameE = t => { const s = earthPos(t).negate().normalize(), f = earthVel(t), side = new THREE.Vector3().crossVectors(f, Y).normalize(), up = new THREE.Vector3().crossVectors(side, f); return { s, f, side, up }; };
  const keys = [];
  const K = (t, anchor, off, look, fov = 42, up = Y) => keys.push({ t, anchor, off, look, fov, up: up.clone() });

  // --- Chapter 1: over the engines, up the elevator, out to the ring, pull back
  {
    const t = 0, N = heroDirL.clone().applyQuaternion(spinQ(t)), s = frameE(t).s;
    const T = s.clone().addScaledVector(N, -s.dot(N)).normalize(), B = new THREE.Vector3().crossVectors(N, T);
    // open in high orbit, side-lit, the terminator through the frame: the ignition front is seen racing across the
    // whole hemisphere, then the camera dives in among the plumes
    K(-14, 'hero', L0(N.clone().multiplyScalar(240).addScaledVector(T, -10).addScaledVector(B, -230)), L0(N.clone().multiplyScalar(-70).addScaledVector(T, 14)), 44, N);   // the title: the whole quiet planet, before ignition
    K(-4, 'hero', L0(N.clone().multiplyScalar(175).addScaledVector(T, -20).addScaledVector(B, -150)), L0(N.clone().multiplyScalar(-40).addScaledVector(T, 18)), 46, N);
    K(0, 'hero', L0(N.clone().multiplyScalar(140).addScaledVector(T, -30).addScaledVector(B, -120)), L0(N.clone().multiplyScalar(-30).addScaledVector(T, 22)), 48, N);
    const N2 = heroDirL.clone().applyQuaternion(spinQ(6.5)), T2 = s.clone().addScaledVector(N2, -s.dot(N2)).normalize(), B2 = new THREE.Vector3().crossVectors(N2, T2);
    K(6.5, 'hero', L0(N2.clone().multiplyScalar(40).addScaledVector(T2, -20).addScaledVector(B2, -40)), L0(N2.clone().multiplyScalar(-4).addScaledVector(T2, 30)), 48, N2);   // the array on the left third, the elevator rising behind it
  }
  {   // skim the equator past the steering array
    const t = 8.3, Ne = elevDirsL[0].clone().applyQuaternion(spinQ(t));
    const N = ctx.steerDirL ? ctx.steerDirL.clone().applyQuaternion(spinQ(t)) : Ne;
    const E = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0).applyQuaternion(spinQ(t)), N).normalize(), Nn = new THREE.Vector3().crossVectors(N, E);
    const toward = Math.sign(Ne.clone().sub(N).dot(E)) || 1;          // look along the belt towards the elevator
    K(8.3, 'steer', L0(N.clone().multiplyScalar(9).addScaledVector(E, -26 * toward).addScaledVector(Nn, 16)), L0(N.clone().multiplyScalar(14).addScaledVector(E, 36 * toward)), 50, N);
  }
  {
    const e = (t) => { const Ne = elevDirsL[0].clone().applyQuaternion(spinQ(t)), Se = new THREE.Vector3().crossVectors(Ne, Y).normalize(), Ue = new THREE.Vector3().crossVectors(Se, Ne); return { Ne, Se, Ue }; };
    // one continuous ride, surface to station (the climber is scripted by S.climbH: 10.5 s → 23 s)
    let { Ne, Se, Ue } = e(11);
    K(11, 'climber', L0(Se.clone().multiplyScalar(11).addScaledVector(Ue, 5).addScaledVector(Ne, 4)), L0(Ne.clone().multiplyScalar(-6).addScaledVector(Se, -2)), 50, Ne);
    ({ Ne, Se, Ue } = e(14.5));
    K(14.5, 'climber', L0(Se.clone().multiplyScalar(9).addScaledVector(Ue, 6).addScaledVector(Ne, -5)), L0(Ne.clone().multiplyScalar(22).addScaledVector(Se, -3)), 52, Se);
    ({ Ne, Se, Ue } = e(18.5));
    K(18.5, 'climber', L0(Ne.clone().multiplyScalar(9).addScaledVector(Se, 8).addScaledVector(Ue, 4)), L0(Ne.clone().multiplyScalar(-90).addScaledVector(Se, 4)), 50, Ue);
    ({ Ne, Se, Ue } = e(22));
    K(22, 'climber', L0(Ne.clone().multiplyScalar(-11).addScaledVector(Se, 8).addScaledVector(Ue, 5)), L0(Ne.clone().multiplyScalar(45).addScaledVector(Se, -2)), 48, Se);
    ({ Ne, Se, Ue } = e(25.5));
    K(25.5, 'hub0', L0(Ne.clone().multiplyScalar(60).addScaledVector(Se, 22).addScaledVector(Ue, 14)), L0(Ne.clone().multiplyScalar(-120).addScaledVector(Ue, -4)), 46, Ue);   // the station big in the foreground, the whole Earth behind it
  }
  {   // the flagship as the hero: big on the left third, side-lit (Sun 100° off axis) so a terminator runs along the
      // hull. The fleet leads the planet away from the Sun, so the planet is always sunward of the ship: shooting from
      // ahead with the planet behind was straight into the Sun — a black silhouette. The next shot gives the planet.
    const { f, side, up } = frameE(28.6);
    K(28.6, 'flagship', L0(side.clone().multiplyScalar(-62).addScaledVector(up, 14)), L0(f.clone().multiplyScalar(-24)), 44, up);
  }
  {
    const { s, f, side, up } = frameE(31);
    K(31.5, 'earth', s.clone().multiplyScalar(-0.42).addScaledVector(side, 0.8).addScaledVector(up, 0.42).normalize().multiplyScalar(EARTH_R * 22), f.clone().multiplyScalar(EARTH_R * 2.2), 40);
  }
  // --- Chapter 2: the system revealed, the Sun up close, Jupiter, Saturn
  {
    const { f, side } = frameE(37);
    K(37, 'earth', V(0, 1, 0).multiplyScalar(0.8).addScaledVector(side, 0.45).addScaledVector(f, -0.4).normalize().multiplyScalar(3.2), V(0, 0, 0), 46);
    const A = V(0.0, 0.62, 0).add(ecl(205, 0.78)).normalize();
    K(41.5, 'sun', A.clone().add(V(0, 0.4, 0)).normalize().multiplyScalar(74), V(0, 0, 0), 48);      // the whole system on one screen
    K(45.5, 'sun', A.clone().applyAxisAngle(Y, 0.8).add(V(0, 0.55, 0)).normalize().multiplyScalar(66), V(0, 0, 0), 50);
    const c = V(0, 0.22, 0).add(ecl(150, 1)).normalize();
    K(49, 'sun', c.clone().multiplyScalar(0.5), new THREE.Vector3().crossVectors(Y, c).normalize().multiplyScalar(0.07), 40);
    K(52, 'sun', c.clone().applyAxisAngle(Y, 0.25).multiplyScalar(0.38), new THREE.Vector3().crossVectors(Y, c).normalize().multiplyScalar(0.05), 42);
    ctx.flareDir = new THREE.Vector3().crossVectors(Y, c).normalize().multiplyScalar(0.92).addScaledVector(Y, 0.25).addScaledVector(c, 0.3).normalize();
    for (const [t, key, d, side0, upk, look, fov] of [[55.8, 'jupiter', 0.03, 0.42, 0.16, 0.13, 46], [62.4, 'saturn', 0.04, 0.5, 0.6, 0.14, 46], [70.2, 'neptune', 0.035, 0.5, 0.18, 0.08, 44]]) {
      const E = earthPos(t), P = bodyPos(key, t, new THREE.Vector3()), to = P.clone().sub(E).normalize(), sd = new THREE.Vector3().crossVectors(to, Y).normalize();
      K(t, 'earth', to.clone().negate().addScaledVector(sd, side0).addScaledVector(Y, upk).normalize().multiplyScalar(d), to.clone().multiplyScalar(look), fov);
    }
  }
  // --- Chapter 3: Kuiper ice, the heliopause
  {
    const t = 77, E = earthPos(t), P = bodyPos('pluto', t, new THREE.Vector3()), to = P.clone().sub(E).normalize(), sd = new THREE.Vector3().crossVectors(to, Y).normalize();
    K(76.5, 'earth', to.clone().negate().addScaledVector(sd, 0.75).addScaledVector(Y, 0.3).normalize().multiplyScalar(EARTH_R * 1.75), to.clone().multiplyScalar(0.016), 50);
    const { f, side } = frameE(84);
    K(84.5, 'earth', f.clone().multiplyScalar(-0.8).addScaledVector(side, 0.5).addScaledVector(Y, 0.3).normalize().multiplyScalar(2.6), f.clone().multiplyScalar(0.8), 52);
  }
  // --- Chapter 4: deep space with the planet
  {
    let { f, side, up } = frameE(92);
    K(91.5, 'earth', f.clone().multiplyScalar(-0.55).addScaledVector(side, 0.7).addScaledVector(up, 0.42).normalize().multiplyScalar(EARTH_R * 8), f.clone().multiplyScalar(EARTH_R * 2.6), 40);
    ({ f, side, up } = frameE(99));
    K(99, 'earth', f.clone().multiplyScalar(0.25).addScaledVector(side, -0.85).addScaledVector(up, 0.3).normalize().multiplyScalar(EARTH_R * 3.4), f.clone().multiplyScalar(EARTH_R * 0.9).addScaledVector(side, -EARTH_R * 0.6), 44);
    // scale: the deep-space observatory fills the foreground, the planet hangs beyond it at 19,000 km —
    // gibbous, its terminator and engine glow both in view — and the stars sit behind everything
    ({ f, side, up } = frameE(103));
    {
      const toE = f.clone().multiplyScalar(-250).addScaledVector(side, 150).addScaledVector(up, -70).normalize();   // observatory → Earth
      const camO = toE.clone().multiplyScalar(-62).addScaledVector(up, 20).addScaledVector(side, -25);
      K(102.8, 'observatory', L0(camO), L0(toE.clone().multiplyScalar(90).sub(camO)), 50, up);
    }
    ({ f, side, up } = frameE(106));
    K(106.5, 'earth', f.clone().multiplyScalar(-0.95).addScaledVector(up, 0.2).addScaledVector(side, 0.18).normalize().multiplyScalar(EARTH_R * 4.6), f.clone().multiplyScalar(EARTH_R * 7), 46);
  }
  // --- Chapter 5: the great pull-back
  {
    const { f, side, up } = frameE(112);
    K(112, 'earth', f.clone().multiplyScalar(-0.6).addScaledVector(up, 0.55).addScaledVector(side, 0.45).normalize().multiplyScalar(0.35), V(0, 0, 0), 46);
    const ngp = SKY.ngp.clone(), gcd = SKY.gc.clone();
    K(118, 'sol', ngp.clone().multiplyScalar(0.55).addScaledVector(side, 0.7).addScaledVector(f, -0.4).normalize().multiplyScalar(13 * ART_PER_LY), ACEN.clone().multiplyScalar(2.0 * ART_PER_LY), 46);
    K(124, 'sol', ngp.clone().multiplyScalar(0.62).addScaledVector(gcd, -0.6).addScaledVector(side, 0.3).normalize().multiplyScalar(2800 * ART_PER_LY), V(0, 0, 0), 48, ngp);
    const solFromGC = gcd.clone().negate(), l90 = new THREE.Vector3().crossVectors(ngp, gcd).normalize();
    K(131.5, 'gc', ngp.clone().multiplyScalar(0.62).addScaledVector(solFromGC, 0.72).addScaledVector(l90, 0.2).normalize().multiplyScalar(62000 * ART_PER_LY), V(0, 0, 0), 50, ngp);
    K(139, 'gc', ngp.clone().multiplyScalar(0.78).addScaledVector(solFromGC, 0.5).addScaledVector(l90, -0.38).normalize().multiplyScalar(88000 * ART_PER_LY), V(0, 0, 0), 48, ngp);
    K(147.5, 'gc', ngp.clone().multiplyScalar(0.84).addScaledVector(solFromGC, 0.32).addScaledVector(l90, -0.62).normalize().multiplyScalar(98000 * ART_PER_LY), V(0, 0, 0), 47, ngp);
  }
  {   // Chapter 6: back down through the scales to the planet, arriving at α Centauri, and a sunrise
    const E = earthPos(160), D = ACEN.clone().multiplyScalar(4.37 * ART_PER_LY).sub(E).normalize();
    const side = new THREE.Vector3().crossVectors(D, Y).normalize(), up = new THREE.Vector3().crossVectors(side, D);
    K(154, 'earth', D.clone().multiplyScalar(-0.5).addScaledVector(up, 0.6).addScaledVector(side, 0.6).normalize().multiplyScalar(0.6), V(0, 0, 0), 46);
    // from the night side, a classic orbital sunrise: the new sun climbs out from behind the limb
    const cam0 = D.clone().multiplyScalar(-0.93).addScaledVector(up, 0.36).normalize().multiplyScalar(EARTH_R * 2.7);
    K(159.5, 'earth', cam0, D.clone().multiplyScalar(EARTH_R * 0.4).addScaledVector(up, EARTH_R * 0.85).sub(cam0), 44, up);
    const cam1 = D.clone().multiplyScalar(-0.9).addScaledVector(up, 0.44).normalize().multiplyScalar(EARTH_R * 2.75);
    K(166, 'earth', cam1, D.clone().multiplyScalar(EARTH_R * 0.6).addScaledVector(up, EARTH_R * 1.0).sub(cam1), 42, up);
    const cam2 = D.clone().multiplyScalar(-0.4).addScaledVector(side, 0.8).addScaledVector(up, 0.45).normalize().multiplyScalar(EARTH_R * 4.2);
    K(174, 'earth', cam2, D.clone().multiplyScalar(EARTH_R * 0.6), 44);
    K(185, 'earth', cam2.clone().applyAxisAngle(up, 0.15), D.clone().multiplyScalar(EARTH_R * 0.6), 44);
  }
  keys.sort((a, b) => a.t - b.t);
  for (const k of keys) { k.d = k.off.length(); k.dir = k.off.clone().normalize(); k.lookN = k.look.clone().divideScalar(k.d); k.logd = Math.log10(k.d); }
  return keys;
}

/** Evaluate the camera path at time t. anchorArt(name, t) → Vector3 (art-AU, float64). */
export function evalCamera(keys, t, anchorArt, out) {
  t = clamp(t, keys[0].t, keys[keys.length - 1].t);
  const { w, ks, s } = hermite(keys, t);
  const A = new THREE.Vector3(), dir = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3();
  let logd = 0, fov = 0;
  ks.forEach((k, j) => {
    dir.addScaledVector(k.dir, w[j]); up.addScaledVector(k.up, w[j]); look.addScaledVector(k.lookN, w[j]);
    logd += k.logd * w[j]; fov += k.fov * w[j];
  });
  // between distant anchors, rise out and come back in (a van Wijk–style zoom-and-pan)
  const k1 = ks[1], k2 = ks[2];
  const ss = s * s * (3 - 2 * s);
  // continuous (Catmull-Rom) aim, clamped near the two keys so it never swings past them
  for (const c of ['x', 'y', 'z']) { const a = Math.min(k1.lookN[c], k2.lookN[c]), b = Math.max(k1.lookN[c], k2.lookN[c]), m = (b - a) * 0.15 + 0.02; look[c] = clamp(look[c], a - m, b + m); }
  A.copy(anchorArt(k1.anchor, t)).lerp(anchorArt(k2.anchor, t), k1.anchor === k2.anchor ? 0 : ss);   // never mix in a distant third subject
  if (k1.anchor !== k2.anchor) {
    const sep = anchorArt(k1.anchor, t).distanceTo(anchorArt(k2.anchor, t));
    const bump = Math.max(0, Math.log10(sep / Math.max(k1.d, k2.d)) - 0.6) * 0.8;
    logd += bump * Math.sin(Math.PI * s) ** 1.5;
  }
  const d = Math.pow(10, logd);
  dir.normalize();
  out.pos.copy(A).addScaledVector(dir, d);
  out.target.copy(A).addScaledVector(look, d);
  out.up.copy(up.lengthSq() > 1e-6 ? up.normalize() : Y);
  out.fov = fov; out.d = d; out.logd = logd;
  return out;
}
