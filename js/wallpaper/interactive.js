// Landing view (mode A): the Earth and its planetary engines, with the camera choosing between three designed views
// by where the cursor is (left third · centre · right third), or a view pinned from the control panel, plus a little
// lean towards the cursor inside each view. Every camera parameter follows its target through a damped spring
// (slight overshoot, never a snap) inside a safe envelope (above the atmosphere, the array framed). When the mouse
// rests the camera settles back to the hero view and drifts slowly round it.
// Also: createBlend — the eased camera transition used for every change of camera driver (mode switches).
import * as THREE from 'three';
import { K0, clamp } from '../beyond/util.js';

export const T_WORLD = 11;      // the moment of the voyage the landing lives in: ignition complete, every engine burning

// views in the hero array's frame: N (up from the ground), T (along the ground towards the Sun), B = N × T. L0 units (63.7 km)
export const VIEWS = [
  { name: 'LOW', off: [10, 6, -34], look: [9, -4, 30], fov: 52 },      // low beside the array, side-lit, the plumes towering across the frame
  { name: 'HERO', off: [40, -20, -40], look: [-4, 30, 0], fov: 48 },   // three-quarter over the array, the limb and the elevator behind (default)
  { name: 'ORBIT', off: [140, -30, -120], look: [-30, 22, 0], fov: 46 }, // high orbit, the ignition field across the terminator
];
const DEFAULT = 1;

// under-damped spring: ω 2.4 rad/s, ζ 0.72 → ~4 % overshoot, settles in ~2 s
function spring(s, target, dt, w = 2.4, z = 0.72) {
  for (let i = 0; i < s.x.length; i++) { const a = w * w * (target[i] - s.x[i]) - 2 * z * w * s.v[i]; s.v[i] += a * dt; s.x[i] += s.v[i] * dt; }
}

export function createInteractive(B) {
  const st = { x: new Array(8).fill(0), v: new Array(8).fill(0) }, tgt = new Array(8).fill(0);
  const N = new THREE.Vector3(), T = new THREE.Vector3(), Bv = new THREE.Vector3(), d = new THREE.Vector3(), lk = new THREE.Vector3();
  const A = new THREE.Vector3(), camL0 = new THREE.Vector3(), q = new THREE.Quaternion();
  const mouse = { x: 0.5, y: 0.5, at: -1e9 };
  let zone = DEFAULT, pinned = null, idleSec = 8, sens = 1;

  function frame() {          // the hero array's local frame, from the Earth layer (L0 axes = art axes)
    N.copy(B.earth.world.heroN).normalize();
    T.copy(B.S.sunDir).addScaledVector(N, -B.S.sunDir.dot(N)).normalize(); Bv.crossVectors(N, T);
  }
  // camera state vector: [dir xyz (unit), log10 distance, look xyz (L0 units), fov] → written into `out`
  function viewTarget(i, px, py, out) {
    const V = VIEWS[i];
    d.set(0, 0, 0).addScaledVector(N, V.off[0]).addScaledVector(T, V.off[1]).addScaledVector(Bv, V.off[2]);
    const dist = d.length(); d.divideScalar(dist);
    d.applyQuaternion(q.setFromAxisAngle(N, clamp(px, -1, 1) * 0.16));                 // lean: a small orbit round the array's axis …
    const up = clamp(d.dot(N) + clamp(py, -1, 1) * 0.08, 0.1, 0.97); d.addScaledVector(N, up - d.dot(N)).normalize();   // … and a little crane
    lk.set(0, 0, 0).addScaledVector(N, V.look[0]).addScaledVector(T, V.look[1]).addScaledVector(Bv, V.look[2]);
    out[0] = d.x; out[1] = d.y; out[2] = d.z; out[3] = Math.log10(dist); out[4] = lk.x; out[5] = lk.y; out[6] = lk.z; out[7] = V.fov;
  }
  function reset() { frame(); zone = pinned ?? DEFAULT; viewTarget(zone, 0, 0, st.x); st.v.fill(0); }

  function update(cam, dt, now) {
    frame();
    const idle = now - mouse.at > idleSec * 1000;
    zone = pinned ?? (idle ? DEFAULT : mouse.x < 1 / 3 ? 0 : mouse.x > 2 / 3 ? 2 : 1);
    let px, py;
    if (idle) { px = 0.35 * Math.sin(now * 1.1e-4); py = 0.2 * Math.sin(now * 0.7e-4 + 1); }        // idle drift: a slow sway round the view
    else { const cx = pinned != null ? 0.5 : (zone - 1) / 3 + 0.5; px = (mouse.x - cx) * (pinned != null ? 2 : 6) * sens; py = (0.5 - mouse.y) * 2 * sens; }
    viewTarget(zone, px, py, tgt);
    spring(st, tgt, Math.min(dt, 0.05));
    d.set(st.x[0], st.x[1], st.x[2]).normalize();
    const dist = Math.pow(10, st.x[3]);
    B.anchorArtInto('hero', B.app.t, A);
    camL0.copy(B.earth.world.hero).addScaledVector(d, dist);
    if (camL0.length() < 101.5) camL0.setLength(101.5);          // envelope: never below the top of the atmosphere
    cam.pos.copy(A).addScaledVector(camL0.sub(B.earth.world.hero), K0);
    cam.target.copy(A).add(lk.set(st.x[4], st.x[5], st.x[6]).multiplyScalar(K0));
    cam.up.copy(N); cam.fov = st.x[7];
    cam.d = cam.pos.distanceTo(cam.target); cam.logd = Math.log10(cam.d);
  }

  return {
    reset, update,
    setIdle(s) { idleSec = s; }, setSensitivity(k) { sens = k; },
    pin(i) { pinned = i; }, get pinned() { return pinned; },
    move(x, y, now) { mouse.x = x; mouse.y = y; mouse.at = now; },
    settle() { for (let i = 0; i < 8; i++) { st.x[i] = tgt[i]; st.v[i] = 0; } },     // (tests: jump to the current target view)
    get zone() { return zone; },
  };
}

// Eased camera transition between two drivers: the new driver computes its camera every frame, and for `dur` ms the
// result is blended from a snapshot of where the camera was. Positions travel round the planet (direction slerp and
// log-radius about the Earth's centre, lifted mid-way so the path clears the surface); aim, up and lens ease across.
export function createBlend(B) {
  const from = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(), fov: 45 };
  const E = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), u0 = new THREE.Vector3(), u1 = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  let t0 = 0, dur = 0;
  return {
    start(ms) { const c = B.cam; from.pos.copy(c.pos); from.target.copy(c.target); from.up.copy(c.up); from.fov = c.fov; t0 = performance.now(); dur = ms; },
    stop() { dur = 0; },
    get active() { return dur > 0; },
    apply(cam) {
      if (!dur) return;
      const k = clamp((performance.now() - t0) / dur), e = k * k * k * (k * (k * 6 - 15) + 10);
      if (k >= 1) { dur = 0; return; }
      E.copy(B.S.earth);
      p0.copy(from.pos).sub(E); p1.copy(cam.pos).sub(E);
      const r0 = p0.length(), r1 = p1.length(), lift = 1 + 0.35 * Math.sin(Math.PI * e) * (1 - Math.max(p0.dot(p1) / (r0 * r1), 0));
      u0.copy(p0).normalize(); u1.copy(p1).normalize();
      u0.applyQuaternion(qa.identity().slerp(qb.setFromUnitVectors(u0, u1), e));
      cam.pos.copy(E).addScaledVector(u0, Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * e) * lift);
      cam.target.copy(from.target).lerp(cam.target, e);
      cam.up.copy(from.up).lerp(cam.up, e).normalize(); cam.fov = from.fov + (cam.fov - from.fov) * e;
      cam.d = cam.pos.distanceTo(cam.target); cam.logd = Math.log10(cam.d);
    },
  };
}
