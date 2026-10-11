// Hard-surface hero assets for the Earth layer, kitbashed from hundreds of primitives and merged per material
// (see fx/kit.js): the elevator climber, the tether truss, waystations, the ring hub stations and the
// Navigator-class flagship. Units are L0 units (1 ≈ 63.7 km); every model is built around its own origin.
import * as THREE from 'three';
import { Kit } from '../fx/kit.js';

const Yv = new THREE.Vector3(0, 1, 0);
const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V4 = new THREE.Vector3(), S4 = new THREE.Vector3(1, 1, 1);
const hex = (rt, rb, h, open = false) => new THREE.CylinderGeometry(rt, rb, h, 6, 1, open);
const box = new THREE.BoxGeometry(1, 1, 1);
/** a part oriented so its local Y axis runs along dir */
function along(kit, geo, mat, pos, dir, scale = S4) { Q4.setFromUnitVectors(Yv, V4.copy(dir).normalize()); M4.compose(new THREE.Vector3(...pos), Q4, scale); kit.addM(geo, mat, M4); }
/** a beam between two points (box section w × d) */
function beam(kit, mat, a, b, w, d = w) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), L = dir.length();
  Q4.setFromUnitVectors(Yv, dir.divideScalar(L)); M4.compose(A.add(B).multiplyScalar(0.5), Q4, new THREE.Vector3(w, L, d)); kit.addM(box, mat, M4);
}

// Blinking navigation / running lights: tiny emissive spheres whose colour and blink phase come from position.
export function navLightMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
    vertexShader: `varying vec3 vO; void main(){ vO = position; vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: `uniform float uTime; varying vec3 vO;
      float h(vec3 p){ return fract(sin(dot(floor(p * 3.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){ float k = h(vO); float blink = step(0.86, fract(uTime * (0.6 + k * 0.5) + k * 7.0));
        vec3 c = k < 0.33 ? vec3(3.0, 0.25, 0.15) : k < 0.55 ? vec3(0.25, 3.0, 0.7) : vec3(2.6, 2.7, 3.0);
        gl_FragColor = vec4(c * (0.3 + 1.2 * blink), 1.0); }`,
  });
}

// Volumetric-looking light cone (floodlights, docking beams): additive, soft at the rim and the far end.
export function beamMaterial(color = [0.9, 0.95, 1.2], k = 0.5) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vY; varying float vF; varying float vD;
      void main(){ vY = uv.y; mat4 m = modelViewMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vec4 mv = m * vec4(position, 1.0); vec3 n = normalize(mat3(m) * normal); vF = abs(dot(n, normalize(-mv.xyz))); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vY; varying float vF; varying float vD;
      void main(){ float a = vY * vY * vF * vF * smoothstep(1.0, 8.0, vD);
        gl_FragColor = vec4(vec3(${color.map(c => c.toFixed(3)).join(',')}) * a * ${k.toFixed(3)}, 1.0); }`,
  });
}

/* ------------------------------------------------------------------ the elevator climber
   ~5.6 units tall (360 km). Its three traction drives ride the cables at radius 1.25. */
export function climberKit(M, rnd) {
  const k = new Kit(), lights = new Kit(), beams = new Kit();
  const r6 = Math.PI / 6;
  // pressure hull: three decks with window bands and armoured rims
  k.add(hex(0.82, 0.82, 3.0), M.white, [0, 0, 0], [0, r6, 0]);
  for (const y of [-1.0, 0, 1.0]) k.add(hex(0.835, 0.835, 0.22, true), M.win, [0, y, 0], [0, r6, 0]);
  for (const y of [-1.5, -0.5, 0.5, 1.5]) k.add(hex(0.88, 0.88, 0.07), M.dark, [0, y, 0], [0, r6, 0]);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.add(box, M.dark, [Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82], [0, -a, 0], [0.08, 3.0, 0.1]); }   // corner ribs
  // chamfered caps
  k.add(hex(0.5, 0.82, 0.55), M.white, [0, 1.78, 0], [0, r6, 0]);
  k.add(hex(0.82, 0.5, 0.55), M.white, [0, -1.78, 0], [0, r6, 0]);
  // top: docking collar with a lit ring, sensor dome, mast and dish
  k.add(new THREE.CylinderGeometry(0.4, 0.46, 0.32, 20), M.dark, [0, 2.2, 0]);
  k.add(new THREE.TorusGeometry(0.43, 0.035, 6, 28), M.dock || M.glow, [0, 2.37, 0], [Math.PI / 2, 0, 0]);
  k.add(new THREE.SphereGeometry(0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, [0, 2.36, 0]);
  k.add(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), M.dark, [0.32, 2.85, 0.1]);
  k.add(new THREE.CylinderGeometry(0.2, 0.02, 0.1, 14), M.white, [0.32, 3.45, 0.1], [0.5, 0, 0]);
  lights.add(new THREE.SphereGeometry(0.06, 6, 4), M.nav, [0.32, 3.5, 0.1]);
  // bottom: drive and reactor module, four floodlights shining down the cables
  k.add(new THREE.CylinderGeometry(0.5, 0.68, 0.6, 18), M.dark, [0, -2.3, 0]);
  k.add(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14), M.warm, [0, -2.64, 0]);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 0.6, z = Math.sin(a) * 0.6;
    k.add(new THREE.CylinderGeometry(0.1, 0.13, 0.18, 10), M.dark, [x, -2.12, z]);
    k.add(new THREE.CircleGeometry(0.09, 10), M.lamp, [x, -2.215, z], [Math.PI / 2, 0, 0]);
    beams.add(new THREE.CylinderGeometry(0.09, 1.1, 7, 14, 1, true), M.beam, [x, -2.2 - 3.5, z], [0, 0, 0]);
  }
  // three traction drives on the cables: housings, pinch wheels, struts to the hull
  for (let c = 0; c < 3; c++) {
    const a = c / 3 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cx = ca * 1.25, cz = sa * 1.25;
    const tan = new THREE.Vector3(-sa, 0, ca);
    for (const s of [-1, 1]) {
      k.add(box, M.dark, [cx + ca * 0.3, s * 1.45, cz + sa * 0.3], [0, -a, 0], [0.16, 1.2, 0.62]);   // housing cheeks either side of the cable
      k.add(box, M.dark, [cx - ca * 0.3, s * 1.45, cz - sa * 0.3], [0, -a, 0], [0.16, 1.2, 0.62]);
      k.add(box, M.white, [cx, s * 2.1, cz], [0, -a, 0], [0.78, 0.18, 0.7]);
      for (const y of [s * 1.1, s * 1.75]) for (const r of [-0.24, 0.24])
        along(k, new THREE.CylinderGeometry(0.22, 0.22, 0.2, 18), M.metal, [cx + ca * r, y, cz + sa * r], tan);
      beam(k, M.dark, [ca * 0.72, s * 1.2, sa * 0.72], [cx - ca * 0.38, s * 1.3, cz - sa * 0.38], 0.12);
      lights.add(new THREE.SphereGeometry(0.05, 6, 4), M.nav, [cx + ca * 0.42, s * 2.22, cz + sa * 0.42]);
    }
    beam(k, M.dark, [ca * 0.72, 0, sa * 0.72], [cx - ca * 0.38, 0.2, cz - sa * 0.38], 0.1);
    // radiator wings between the drives, glowing a dull red where the coolant is hottest
    const b = a + Math.PI / 3, cb = Math.cos(b), sb = Math.sin(b);
    for (const y of [-0.75, 0.75]) k.add(box, M.rad, [cb * 1.45, y, sb * 1.45], [0, -b, 0], [1.15, 1.25, 0.03]);
    k.add(box, M.dark, [cb * 0.95, 0, sb * 0.95], [0, -b, 0], [0.3, 2.9, 0.08]);
  }
  // greebles on the hex faces
  for (let i = 0; i < 60; i++) {
    const f = (rnd() * 6 | 0), a = f / 6 * Math.PI * 2 + r6, y = (rnd() - 0.5) * 2.7, t = (rnd() - 0.5) * 0.6;
    const w = 0.06 + rnd() * 0.16, h = 0.04 + rnd() * 0.08, l = 0.08 + rnd() * 0.4;
    k.add(box, rnd() < 0.6 ? M.dark : M.metal, [Math.cos(a) * 0.72 - Math.sin(a) * t, y, Math.sin(a) * 0.72 + Math.cos(a) * t], [0, -a, 0], [h * 2, l, w]);
  }
  return { body: k, lights, beams };
}

/* ------------------------------------------------------------------ one bay of the tether truss
   collar triangle + sleeves + one diagonal brace on each face, bay height `h` (cables at radius 1.25) */
export function trussBayKit(M, h = 4) {
  const k = new Kit(), P = [0, 1, 2].map(c => { const a = c / 3 * Math.PI * 2; return [Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25]; });
  for (let c = 0; c < 3; c++) {
    const A = P[c], B = P[(c + 1) % 3];
    beam(k, M.dark, A, B, 0.07, 0.12);
    beam(k, M.metal, [A[0], 0.08, A[2]], [B[0], h - 0.08, B[2]], 0.035);
    k.add(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 8), M.dark, A);
  }
  return k;
}

/* ------------------------------------------------------------------ a waystation around the tether */
export function waystationKit(M, rnd) {
  const k = new Kit(), lights = new Kit();
  k.add(new THREE.CylinderGeometry(2.2, 2.2, 3.4, 24), M.white, [0, 0, 0]);
  k.add(new THREE.CylinderGeometry(2.25, 2.25, 0.5, 24, 1, true), M.win, [0, 0.6, 0]);
  k.add(new THREE.CylinderGeometry(1.6, 2.2, 1.0, 24), M.dark, [0, 2.2, 0]);
  k.add(new THREE.CylinderGeometry(2.2, 1.6, 1.0, 24), M.dark, [0, -2.2, 0]);
  // habitat torus with a lit window band, six spokes, solar wings
  k.add(new THREE.TorusGeometry(6.2, 0.75, 14, 64), M.white, [0, 0, 0], [Math.PI / 2, 0, 0]);
  k.add(new THREE.TorusGeometry(6.2, 0.77, 6, 64), M.winT, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.25]);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; beam(k, M.dark, [Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2], [Math.cos(a) * 5.5, 0, Math.sin(a) * 5.5], 0.32); k.add(box, M.dark, [Math.cos(a) * 6.2, 0, Math.sin(a) * 6.2], [0, -a, 0], [0.5, 1.9, 0.9]); lights.add(new THREE.SphereGeometry(0.12, 6, 4), M.nav, [Math.cos(a) * 7.05, 0, Math.sin(a) * 7.05]); }
  for (const s of [-1, 1]) {
    beam(k, M.metal, [s * 6.9, 0, 0], [s * 15, 0, 0], 0.18);
    for (let j = 0; j < 4; j++) k.add(box, M.panel, [s * (8.2 + j * 1.9), 0, 0], [0, 0, 0], [1.75, 0.05, 3.4]);
  }
  for (let i = 0; i < 40; i++) { const a = rnd() * Math.PI * 2, y = (rnd() - 0.5) * 3; k.add(box, rnd() < 0.5 ? M.dark : M.metal, [Math.cos(a) * 2.25, y, Math.sin(a) * 2.25], [0, -a, 0], [0.15, 0.2 + rnd() * 0.5, 0.2 + rnd() * 0.5]); }
  return { body: k, lights };
}

/* ------------------------------------------------------------------ a hub station on the geostationary ring
   (faces +Z; the ring runs along X) */
export function hubKit(M, rnd) {
  const k = new Kit(), lights = new Kit(), spinK = new Kit(), wings = new Kit();
  // spinning habitat wheel (built separately so it can turn)
  spinK.add(new THREE.TorusGeometry(16, 2.4, 20, 120), M.white, [0, 0, 0]);
  spinK.add(new THREE.TorusGeometry(16, 2.44, 6, 120), M.winT, [0, 0, 0], [0, 0, 0], [1, 1, 0.22]);
  for (let s = 0; s < 24; s++) { const a = s / 24 * Math.PI * 2; spinK.add(new THREE.TorusGeometry(2.5, 0.16, 6, 20), M.dark, [Math.cos(a) * 16, Math.sin(a) * 16, 0], [0, Math.PI / 2, a]); }   // pressure-hull frames
  for (let s = 0; s < 6; s++) { const a = s / 6 * Math.PI * 2; beam(spinK, M.dark, [Math.cos(a) * 3.2, Math.sin(a) * 3.2, 0], [Math.cos(a) * 13.8, Math.sin(a) * 13.8, 0], 0.7, 0.9); spinK.add(new THREE.CylinderGeometry(1.0, 1.0, 1.8, 14), M.white, [Math.cos(a) * 9, Math.sin(a) * 9, 0], [0, 0, a + Math.PI / 2]); }
  for (let i = 0; i < 120; i++) { const a = rnd() * Math.PI * 2, b = rnd() * Math.PI * 2, r = 16 + Math.cos(b) * 2.45; spinK.add(box, rnd() < 0.6 ? M.dark : M.metal, [Math.cos(a) * r, Math.sin(a) * r, Math.sin(b) * 2.45], [0, 0, a], [0.3 + rnd() * 0.6, 0.15, 0.3 + rnd() * 0.9]); }
  // fixed spindle: docking cores at both ends, inner service ring, radiators and solar wings
  k.add(new THREE.CylinderGeometry(3, 3, 26, 24), M.white, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (const z of [-11, -6, 6, 11]) k.add(new THREE.CylinderGeometry(3.25, 3.25, 0.6, 24), M.dark, [0, 0, z], [Math.PI / 2, 0, 0]);
  k.add(new THREE.CylinderGeometry(3.05, 3.05, 1.2, 24, 1, true), M.win, [0, 0, 3], [Math.PI / 2, 0, 0]);
  k.add(new THREE.TorusGeometry(9, 1.0, 12, 64), M.dark, [0, 0, -8]);
  for (const s of [-1, 1]) {
    k.add(new THREE.CylinderGeometry(1.7, 2.3, 3, 18), M.dark, [0, 0, s * 14.5], [Math.PI / 2, 0, 0]);
    k.add(new THREE.TorusGeometry(1.8, 0.12, 6, 28), M.dock || M.glow, [0, 0, s * 16.1]);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; beam(k, M.metal, [Math.cos(a) * 3, Math.sin(a) * 3, s * 10], [Math.cos(a) * 7, Math.sin(a) * 7, s * 12.5], 0.25); k.add(new THREE.CylinderGeometry(0.9, 0.9, 3.2, 12), M.white, [Math.cos(a) * 7.6, Math.sin(a) * 7.6, s * 13], [Math.PI / 2, 0, 0]); lights.add(new THREE.SphereGeometry(0.25, 6, 4), M.nav, [Math.cos(a) * 7.6, Math.sin(a) * 7.6, s * 14.7]); }
    beam(k, M.metal, [0, s * 3, 0], [0, s * 25, 0], 0.4);
    for (let j = 0; j < 3; j++) { wings.add(box, M.panel, [-3.4, s * (9 + j * 5.2), 0], [0, 0, 0], [5.8, 4.9, 0.08]); wings.add(box, M.panel, [3.4, s * (9 + j * 5.2), 0], [0, 0, 0], [5.8, 4.9, 0.08]); }
    wings.add(box, M.dark, [0, s * 16.3, 0], [0, 0, 0], [12.4, 0.18, 0.18]);
    for (let j = 0; j < 3; j++) k.add(box, M.rad, [s * (5 + j * 3.6), 0, -8], [0, 0, 0], [3.3, 0.06, 6]);
  }
  for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI * 2, z = (rnd() - 0.5) * 22; k.add(box, rnd() < 0.5 ? M.dark : M.metal, [Math.cos(a) * 3.05, Math.sin(a) * 3.05, z], [0, 0, a], [0.2, 0.3 + rnd() * 0.5, 0.4 + rnd() * 1.6]); }
  return { body: k, wheel: spinK, wings, lights };
}

/* ------------------------------------------------------------------ the Navigator-class flagship (+Z forward) */
export function flagshipKit(M, rnd) {
  const k = new Kit(), lights = new Kit(), ringA = new Kit(), ringB = new Kit(), glow = new Kit();
  const lathe = (prof, seg = 48) => { const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg); g.rotateX(Math.PI / 2); return g; };
  // main hull: a long ogive with a waisted midsection and a broad engine skirt
  k.add(lathe([[0, 30], [0.8, 29], [1.7, 26.5], [2.3, 22], [2.5, 16], [2.4, 4], [2.6, 0], [2.6, -6], [2.2, -9], [2.3, -16], [2.9, -18], [3.1, -20.5], [0, -20.6]]), M.white);
  for (const z of [-17, -12, -8, 2, 6, 9, 15, 21]) k.add(new THREE.TorusGeometry(z > 20 ? 2.32 : 2.58, 0.13, 8, 48), M.dark, [0, 0, z]);
  k.add(new THREE.CylinderGeometry(2.63, 2.63, 1.4, 48, 1, true), M.win, [0, 0, 12], [Math.PI / 2, 0, 0]);
  k.add(new THREE.CylinderGeometry(2.45, 2.45, 0.8, 48, 1, true), M.win, [0, 0, 24], [Math.PI / 2, 0, 0]);
  k.add(new THREE.CylinderGeometry(2.63, 2.63, 0.5, 48, 1, true), M.win, [0, 0, 4.5], [Math.PI / 2, 0, 0]);
  // dorsal superstructure: bridge tower, sensor masts, a keel spine with hangar doors
  k.add(box, M.white, [0, 2.6, 18], [0, 0, 0], [2.2, 1.0, 6]);
  k.add(box, M.white, [0, 3.3, 19], [0, 0, 0], [1.4, 0.8, 3.4]);
  k.add(box, M.win, [0, 3.42, 20.72], [0, 0, 0], [1.3, 0.22, 0.02]);
  k.add(new THREE.SphereGeometry(0.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, [0, 3.7, 18.6]);
  for (const [x, z, h] of [[0.4, 17.2, 2.2], [-0.5, 17.8, 1.4], [0, 16.4, 3.0]]) { k.add(new THREE.CylinderGeometry(0.04, 0.06, h, 5), M.dark, [x, 3.7 + h / 2, z]); lights.add(new THREE.SphereGeometry(0.09, 6, 4), M.nav, [x, 3.7 + h, z]); }
  k.add(box, M.dark, [0, -2.5, 2], [0, 0, 0], [1.6, 0.9, 26]);
  for (let i = 0; i < 6; i++) k.add(box, M.lampDim, [0, -2.96, -8 + i * 4], [0, 0, 0], [1.2, 0.02, 2.6]);
  // cargo cylinders in two rows, with end caps and clamp bands
  for (let c = 0; c < 6; c++) {
    const sx = c % 2 ? 1 : -1, z = -4 + (c >> 1) * 5.2;
    k.add(new THREE.CylinderGeometry(1.0, 1.0, 4.4, 28), M.dark, [sx * 3.5, -0.4, z], [Math.PI / 2, 0, 0]);
    for (const dz of [-1.6, 0, 1.6]) k.add(new THREE.CylinderGeometry(1.04, 1.04, 0.22, 28), M.white, [sx * 3.5, -0.4, z + dz], [Math.PI / 2, 0, 0]);
    k.add(new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, [sx * 3.5, -0.4, z + 2.2], [Math.PI / 2, 0, 0]);
    beam(k, M.dark, [sx * 2.4, -0.4, z], [sx * 2.6, -0.4, z], 0.5, 0.9);
  }
  // radiator wings, glowing where hot
  for (const s of [-1, 1]) {
    beam(k, M.metal, [s * 2.4, 0.6, -13], [s * 9.5, 0.6, -13], 0.3);
    for (let j = 0; j < 4; j++) k.add(box, M.rad, [s * (3.6 + j * 1.6), 0.6, -13], [0, 0, 0], [1.45, 0.05, 4.2]);
    lights.add(new THREE.SphereGeometry(0.14, 6, 4), M.nav, [s * 9.7, 0.6, -13]);
  }
  // hull greebles: plates, conduits, sensor blisters
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2, z = -19 + rnd() * 38, rr = z > 22 ? 2.3 : 2.5;
    const w = 0.15 + rnd() * 0.5, h = 0.06 + rnd() * 0.16, l = 0.25 + rnd() * 2.2;
    k.add(box, rnd() < 0.55 ? M.dark : M.metal, [Math.cos(a) * (rr + h * 0.3), Math.sin(a) * (rr + h * 0.3), z], [0, 0, a + Math.PI / 2], [w, h, l]);
  }
  for (let i = 0; i < 12; i++) { const a = rnd() * Math.PI * 2, z = -16 + rnd() * 34; k.add(new THREE.SphereGeometry(0.22, 10, 6), M.glass, [Math.cos(a) * 2.55, Math.sin(a) * 2.55, z]); }
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; k.add(new THREE.CylinderGeometry(0.09, 0.09, 30, 6), M.metal, [Math.cos(a) * 2.75, Math.sin(a) * 2.75, -2], [Math.PI / 2, 0, 0]); }
  // two counter-rotating habitat rings
  for (const [kk, z] of [[ringA, -3], [ringB, -9.5]]) {
    kk.add(new THREE.TorusGeometry(8, 0.6, 12, 120), M.white, [0, 0, 0]);
    kk.add(new THREE.TorusGeometry(8, 0.62, 4, 120), M.winT, [0, 0, 0], [0, 0, 0], [1, 1, 0.3]);
    for (let s = 0; s < 8; s++) { const a = s / 8 * Math.PI * 2; beam(kk, M.dark, [Math.cos(a) * 2.75, Math.sin(a) * 2.75, 0], [Math.cos(a) * 7.5, Math.sin(a) * 7.5, 0], 0.22, 0.3); kk.add(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 14), M.white, [Math.cos(a) * 8, Math.sin(a) * 8, 0], [0, 0, a + Math.PI / 2]); }
    kk.add(new THREE.TorusGeometry(2.78, 0.25, 8, 40), M.dark, [0, 0, 0]);
    kk.userData = { z };
  }
  // engine block: thrust frame, six bells with glowing throats
  k.add(new THREE.CylinderGeometry(3.4, 3.0, 4, 32), M.dark, [0, 0, -21.5], [Math.PI / 2, 0, 0]);
  k.add(new THREE.TorusGeometry(3.3, 0.18, 8, 48), M.white, [0, 0, -20]);
  for (let e = 0; e < 6; e++) {
    const a = e / 6 * Math.PI * 2, x = Math.cos(a) * 2.4, y = Math.sin(a) * 1.8;
    k.add(lathe([[0.55, 0], [0.62, -0.3], [0.9, -1.0], [1.25, -1.9], [1.32, -2.0]], 28), M.metal, [x, y, -23.4], [Math.PI / 2, 0, 0]);   // open bell along -Z, the throat glowing inside
    k.add(new THREE.TorusGeometry(1.29, 0.05, 6, 28), M.dark, [x, y, -25.35]);
    glow.add(new THREE.CircleGeometry(1.2, 28), M.throat, [x, y, -25.2], [0, Math.PI, 0]);
  }
  // running lights
  for (let i = 0; i < 36; i++) { const a = rnd() * Math.PI * 2, z = -18 + rnd() * 40; lights.add(new THREE.SphereGeometry(0.06, 5, 4), M.nav, [Math.cos(a) * 2.62, Math.sin(a) * 2.62, z]); }
  lights.add(new THREE.SphereGeometry(0.18, 8, 6), M.nav, [0, 0, 30.1]);
  return { body: k, lights, rings: [ringA, ringB], glow };
}

/* ------------------------------------------------------------------ a hero planetary engine (Y up, base at 0, ~2.4 tall, nozzle on top) */
export function engineTowerKit(M, rnd) {
  const k = new Kit(), lights = new Kit();
  const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  // stepped hexagonal foundation
  k.add(hex(1.55, 1.7, 0.12), M.dark, [0, 0.06, 0], [0, Math.PI / 6, 0]);
  k.add(hex(1.3, 1.45, 0.12), M.hull, [0, 0.18, 0], [0, Math.PI / 6, 0]);
  k.add(new THREE.TorusGeometry(1.5, 0.025, 4, 48), M.glow, [0, 0.125, 0], [Math.PI / 2, 0, 0]);
  // hyperbolic main shaft (cooling-tower profile) and a darker armoured skirt
  k.add(lathe([[1.08, 0.24], [0.98, 0.5], [0.86, 0.95], [0.78, 1.45], [0.76, 1.8], [0.8, 2.05], [0.0, 2.05]]), M.hull);
  k.add(lathe([[1.12, 0.24], [1.05, 0.42], [0.0, 0.42]], 40), M.dark);
  for (const [y, r] of [[0.7, 0.93], [1.2, 0.83], [1.65, 0.78]]) {
    k.add(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.06, 40, 1, true), M.win, [0, y, 0]);
    k.add(new THREE.TorusGeometry(r + 0.06, 0.03, 6, 40), M.dark, [0, y + 0.06, 0], [Math.PI / 2, 0, 0]);
  }
  // buttresses
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    beam(k, i % 2 ? M.dark : M.hull, [c * 1.42, 0.24, s * 1.42], [c * 0.86, 1.25, s * 0.86], 0.09, 0.2);
    lights.add(new THREE.SphereGeometry(0.03, 5, 4), M.nav, [c * 1.48, 0.3, s * 1.48]);
  }
  // nozzle: a flared bell with a white-hot throat, ringed by magnetic coils
  k.add(lathe([[0.62, 2.0], [0.55, 2.12], [0.6, 2.3], [0.74, 2.42], [0.0, 2.42]]).scale(1, 1, 1), M.metal);
  for (const y of [2.1, 2.22, 2.34]) k.add(new THREE.TorusGeometry(0.64 + (y - 2.1) * 0.5, 0.035, 6, 32), M.dark, [0, y, 0], [Math.PI / 2, 0, 0]);
  k.add(new THREE.CircleGeometry(0.66, 32), M.throat, [0, 2.43, 0], [-Math.PI / 2, 0, 0]);
  // service gantries and antennae
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.4, c = Math.cos(a), s = Math.sin(a);
    k.add(box, M.dark, [c * 0.95, 1.05, s * 0.95], [0, -a, 0], [0.12, 1.7, 0.12]);
    k.add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), M.dark, [c * 0.95, 2.15, s * 0.95]);
    lights.add(new THREE.SphereGeometry(0.03, 5, 4), M.nav, [c * 0.95, 2.4, s * 0.95]);
  }
  for (let i = 0; i < 40; i++) { const a = rnd() * Math.PI * 2, y = 0.5 + rnd() * 1.4, r = 0.95 - (y - 0.5) * 0.14; k.add(box, rnd() < 0.5 ? M.dark : M.metal, [Math.cos(a) * r, y, Math.sin(a) * r], [0, -a, 0], [0.05, 0.08 + rnd() * 0.18, 0.08 + rnd() * 0.2]); }
  return { body: k, lights };
}
