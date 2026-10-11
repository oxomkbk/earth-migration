// L1 — the Solar System layer ("art-AU": orbit radii compressed 2.2·r^0.75, bodies enlarged for legibility).
// A violent, ageing Sun (granulation, sunspots, prominence loops, flares and a coronal mass ejection),
// procedurally shaded planets with storm bands and rings, the asteroid and Kuiper belts, comets with
// ion and dust tails, zodiacal dust, the heliopause, and the Wandering Earth's own trajectory.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, mulberry32, gaussFn, au2art, eclDir, clamp } from './util.js';

export const SUN_R = 0.08;
// planets: orbit (AU), radius (art-AU), obliquity, period (yr), shading type
export const PLANETS = [
  { key: 'mercury', name: 'MERCURY', au: 0.387, r: 0.0042, tilt: 0.0, yr: 0.24, type: 0, tint: [0.75, 0.72, 0.7], lon: 40 },
  { key: 'venus', name: 'VENUS', au: 0.723, r: 0.009, tilt: 3.1, yr: 0.62, type: 1, tint: [1.0, 0.9, 0.7], lon: 330 },
  { key: 'mars', name: 'MARS', au: 1.524, r: 0.0058, tilt: 0.44, yr: 1.88, type: 2, tint: [1.0, 0.55, 0.35], lon: 165 },
  { key: 'jupiter', name: 'JUPITER', au: 5.203, r: 0.07, tilt: 0.05, yr: 11.86, type: 3, tint: [0.95, 0.85, 0.7], lon: 200 },
  { key: 'saturn', name: 'SATURN', au: 9.537, r: 0.058, tilt: 0.6, yr: 29.4, type: 4, tint: [0.95, 0.88, 0.68], lon: 228, ring: [1.24, 2.32] },
  { key: 'uranus', name: 'URANUS', au: 19.19, r: 0.032, tilt: 1.71, yr: 84, type: 5, tint: [0.65, 0.9, 0.95], lon: 120, ring: [1.6, 2.0] },
  { key: 'neptune', name: 'NEPTUNE', au: 30.07, r: 0.031, tilt: 0.49, yr: 165, type: 6, tint: [0.4, 0.6, 1.0], lon: 238 },
];
export const DWARFS = [
  { key: 'pluto', name: 'PLUTO', au: 35.5, r: 0.0042, type: 7, tint: [0.95, 0.85, 0.75], lon: 247, inc: -0.06 },
  { key: 'eris', name: 'ERIS', au: 68, r: 0.0036, type: 9, tint: [0.95, 0.95, 0.95], lon: 30, inc: 0.4 },
  { key: 'makemake', name: 'MAKEMAKE', au: 45.5, r: 0.0026, type: 7, tint: [0.95, 0.75, 0.6], lon: 190, inc: 0.3 },
];
const TIME_SCALE = 1 / 2400;    // orbital years per story-second (planets drift subtly)
const ss01 = x => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (x * 6 - 15) + 10); };
export const ORRERY = { extra: 0 };   // extra orbital years (explore mode's time-lapse)
// story time → orbital years: in chapter 2 the clock races ahead 2.6 years, so the whole system visibly turns
export function orbitYears(t) { return t * TIME_SCALE + 2.6 * ss01((t - 35) / 11) + ORRERY.extra; }
export function orbitAngle(lon, yr, t) { return THREE.MathUtils.degToRad(lon) + orbitYears(t) / yr * Math.PI * 2; }
export function orbitPos(au, lon, yr, t, inc = 0, out = new THREE.Vector3()) {
  const a = orbitAngle(lon, yr, t);
  const r = au2art(au);
  return out.set(Math.cos(a) * r, Math.sin(a) * r * Math.sin(inc), -Math.sin(a) * r * Math.cos(inc));
}
export const bodyPos = (key, t, out) => { const b = PLANETS.find(p => p.key === key) || DWARFS.find(p => p.key === key); return orbitPos(b.au, b.lon, b.yr || 250, t, b.inc || 0, out); };

const PLANET_GLSL = /* glsl */`
  vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
  vec3 surface(int type, vec3 p, float t, out float rough){
    float lat = p.y; rough = 0.0;
    if (type == 0) {        // Mercury: grey, cratered
      float n = sfbm(p * 6.0); float cr = smoothstep(0.55, 0.62, vnoise(p * 22.0)) - smoothstep(0.62, 0.7, vnoise(p * 22.0));
      rough = 1.0; return vec3(0.52, 0.5, 0.48) * (0.75 + 0.3 * n + 0.25 * cr);
    }
    if (type == 1) {        // Venus: sulphuric cloud deck, sheared into a sideways Y
      vec3 q = rotY(p, t * 0.02 + lat * 1.4);
      float n = sfbm(q * vec3(3.0, 9.0, 3.0) + sfbm(q * 4.0) * 0.6);
      return mix(vec3(0.86, 0.74, 0.52), vec3(0.98, 0.94, 0.82), 0.5 + 0.5 * n);
    }
    if (type == 2) {        // Mars: rust, dark maria, polar caps
      float n = sfbm(p * 3.0), m = smoothstep(0.05, 0.35, sfbm(p * 2.2 + 3.0));
      vec3 c = mix(vec3(0.72, 0.36, 0.2), vec3(0.42, 0.22, 0.14), m) * (0.85 + 0.25 * n);
      c = mix(c, vec3(0.95, 0.93, 0.92), smoothstep(0.86, 0.92, abs(lat) + 0.04 * n));
      rough = 1.0; return c;
    }
    if (type == 3) {        // Jupiter: alternating jets, festoons and the Great Red Spot
      float jet = sin(lat * 22.0) * 0.035 + sin(lat * 53.0) * 0.012;
      vec3 q = rotY(p, t * jet);
      float w = sfbm(q * vec3(5.0, 20.0, 5.0)) * 0.045 + sfbm(q * vec3(14.0, 44.0, 14.0)) * 0.012;
      float b = lat + w;
      float B1 = 0.5 + 0.5 * sin(b * 36.0 + 0.6), B2 = 0.5 + 0.5 * sin(b * 83.0 + 1.7);
      vec3 c = mix(vec3(0.72, 0.55, 0.4), vec3(0.97, 0.93, 0.85), smoothstep(0.25, 0.75, B1));
      c = mix(c, vec3(0.55, 0.36, 0.25), smoothstep(0.55, 0.95, B2) * 0.45 * (1.0 - smoothstep(0.1, 0.0, abs(lat))));
      c *= 0.88 + 0.24 * sfbm(q * vec3(16.0, 48.0, 16.0));
      c = mix(c, vec3(0.5, 0.48, 0.5), smoothstep(0.62, 0.95, abs(lat)) * 0.7);
      // Great Red Spot
      float lon = atan(q.z, q.x);
      vec2 d = vec2(sin(lon - 1.2) * sqrt(max(1.0 - lat * lat, 0.0)), lat + 0.38);
      float e = length(d / vec2(0.2, 0.085));
      float sw = atan(d.y, d.x) + (1.0 - e) * 6.0 + t * 0.2;
      float swirl = sfbm(vec3(cos(sw) * e * 3.0, sin(sw) * e * 3.0, 2.0));
      c = mix(c, mix(vec3(0.75, 0.33, 0.2), vec3(0.88, 0.55, 0.38), 0.5 + 0.5 * swirl), (1.0 - smoothstep(0.55, 1.0, e)) * 0.9);
      c = mix(c, vec3(0.98, 0.94, 0.88), smoothstep(0.9, 1.0, e) * (1.0 - smoothstep(1.0, 1.2, e)) * 0.6);
      return c;
    }
    if (type == 4) {        // Saturn: pale butterscotch bands, the polar hexagon
      vec3 q = rotY(p, t * sin(lat * 18.0) * 0.02);
      float b = lat + sfbm(q * vec3(4.0, 22.0, 4.0)) * 0.02;
      float B = 0.5 + 0.5 * sin(b * 30.0), B2 = 0.5 + 0.5 * sin(b * 75.0 + 2.0);
      vec3 c = mix(vec3(0.8, 0.67, 0.45), vec3(0.95, 0.88, 0.7), B) * (0.92 + 0.12 * B2);
      float lon = atan(p.z, p.x); float hex = cos(3.14159 / 6.0) / cos(mod(lon + t * 0.01, 1.0472) - 0.5236);
      c = mix(c, vec3(0.55, 0.6, 0.62), smoothstep(0.86, 0.9, lat * hex) * 0.6);
      return c;
    }
    if (type == 5) {        // Uranus: pale cyan haze
      float b = 0.5 + 0.5 * sin(lat * 14.0 + sfbm(p * 3.0) * 0.4);
      return mix(vec3(0.58, 0.84, 0.88), vec3(0.7, 0.92, 0.94), b * 0.5);
    }
    if (type == 6) {        // Neptune: azure, dark spot, cirrus streaks
      vec3 q = rotY(p, t * 0.05 * sin(lat * 6.0));
      float b = 0.5 + 0.5 * sin(lat * 18.0 + sfbm(q * vec3(3.0, 10.0, 3.0)) * 1.2);
      vec3 c = mix(vec3(0.16, 0.32, 0.85), vec3(0.3, 0.5, 0.98), b);
      float lon = atan(q.z, q.x);
      float spot = length(vec2(sin(lon - 2.0) * 1.0, (lat + 0.33) * 2.2) / vec2(0.22, 0.25));
      c = mix(c, vec3(0.06, 0.12, 0.42), (1.0 - smoothstep(0.6, 1.0, spot)) * 0.8);
      float streak = smoothstep(0.62, 0.8, sfbm(q * vec3(2.0, 26.0, 2.0) + 4.0));
      return mix(c, vec3(0.92, 0.96, 1.0), streak * 0.85);
    }
    if (type == 7) {        // Pluto-like: tholin red-brown with a bright nitrogen-ice heart
      float n = sfbm(p * 4.0);
      vec3 c = mix(vec3(0.55, 0.38, 0.28), vec3(0.85, 0.75, 0.62), smoothstep(-0.2, 0.4, n));
      float heart = 1.0 - smoothstep(0.32, 0.4, length((p.xz - vec2(0.45, 0.35)) * vec2(1.0, 1.3)) - 0.06 * n);
      c = mix(c, vec3(0.96, 0.94, 0.9), heart * step(0.0, p.y + 0.6));
      return mix(c, vec3(0.25, 0.14, 0.1), smoothstep(0.1, 0.5, -p.y - 0.1 * n) * 0.6);
    }
    if (type == 8) {        // generic icy moon
      float n = sfbm(p * 5.0); rough = 1.0; return vec3(0.7, 0.68, 0.66) * (0.8 + 0.3 * n);
    }
    if (type == 10) { float n = sfbm(p * 4.0); return mix(vec3(0.85, 0.75, 0.3), vec3(0.95, 0.9, 0.6), n * 0.5 + 0.5) * (1.0 - 0.6 * smoothstep(0.6, 0.65, vnoise(p * 9.0))); }  // Io
    if (type == 11) { float l = smoothstep(0.47, 0.5, vnoise(p * 7.0)) - smoothstep(0.5, 0.53, vnoise(p * 7.0)); return mix(vec3(0.9, 0.88, 0.84), vec3(0.6, 0.4, 0.28), l); }       // Europa
    float n = sfbm(p * 3.0); return vec3(0.9, 0.92, 0.95) * (0.85 + 0.2 * n);       // Eris: fresh frost
  }`;

export function buildSolarLayer({ Q, U, tex = {} }) {
  const rnd = mulberry32(1977), gauss = gaussFn(rnd);
  const scene = new THREE.Scene();
  const bodies = {};   // key → { group, r, pos() }

  // ------------------------------------------------------------------ the Sun
  const sunGroup = new THREE.Group(); scene.add(sunGroup);
  const uFlare = { value: 0 }, uFlareDir = { value: new THREE.Vector3(0.4, 0.3, 0.86).normalize() };
  const photosphere = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 96, 64), new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFlare, uFlareDir, uSunHot: U.uSunHot, uMap: { value: tex.sun || null }, uF2: { value: 0 }, uF2Dir: { value: new THREE.Vector3(0, 1, 0) } },
    defines: tex.sun ? { HAS_MAP: 1 } : {},
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vP = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFlare, uSunHot, uF2; uniform vec3 uFlareDir, uF2Dir; uniform sampler2D uMap; varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        vec3 V = normalize(cameraPosition - vW); float mu = clamp(dot(normalize(vN), V), 0.0, 1.0);
        float gran = snoise(vP * 90.0 + uTime * 0.15);
        float mott = snoise(vP * 16.0 + uTime * 0.02) * 0.6 + snoise(vP * 34.0 - uTime * 0.04) * 0.4;
        float spots = smoothstep(0.5, 0.62, sfbm(vP * 3.5 + vec3(0.0, uTime * 0.004, 0.0))) * smoothstep(0.7, 0.2, abs(vP.y));
        float pen = smoothstep(0.38, 0.5, sfbm(vP * 3.5 + vec3(0.0, uTime * 0.004, 0.0))) * smoothstep(0.7, 0.2, abs(vP.y));
        float fac = smoothstep(0.2, 0.6, sfbm(vP * 9.0 + 2.0)) * pow(1.0 - mu, 1.5) * 0.7;
        vec3 hot = mix(vec3(1.0, 0.6, 0.2), vec3(1.0, 0.82, 0.55), uSunHot * 0.5);
        vec3 col = mix(vec3(0.85, 0.22, 0.02), hot, pow(mu, 0.55)) * (0.4 + 0.6 * pow(mu, 0.55));
        col *= (0.88 + 0.16 * mott) * (0.95 + 0.08 * gran);
        #ifdef HAS_MAP
          vec3 tx = texture2D(uMap, vUv + vec2(uTime * 0.0004, 0.0)).rgb;
          col *= 0.2 + 1.6 * dot(tx, vec3(0.3, 0.55, 0.15));                 // real photosphere texture: granulation and plage
        #endif
        col *= 1.0 - 0.55 * pen - 0.4 * spots;
        col += vec3(1.0, 0.9, 0.7) * fac;
        float fa = acos(clamp(dot(vP, uFlareDir), -1.0, 1.0)) / 0.08; float fl = exp(-fa * fa) * uFlare;
        float fb = acos(clamp(dot(vP, uF2Dir), -1.0, 1.0)) / 0.05; fl += exp(-fb * fb) * uF2;   // recurring smaller flares
        col += vec3(1.0, 0.95, 0.85) * fl * 6.0;
        gl_FragColor = vec4(col * 26.0, 1.0);
      }`,
  }));
  sunGroup.add(photosphere);
  // corona: a camera-facing sheet of streamers
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFlare, uI: { value: 1 }, uBoost: { value: 1 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFlare, uI, uBoost; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float r = length(p) / 0.05;    // r in solar radii (sheet spans ±20 R☉)
        if (r < 0.98) discard;
        float a = atan(p.y, p.x);
        float str = 0.35 + 1.4 * pow(vnoise(vec3(cos(a) * 4.0, sin(a) * 4.0, uTime * 0.03)), 2.0) + 0.6 * pow(vnoise(vec3(cos(a) * 18.0, sin(a) * 18.0, r * 0.4 - uTime * 0.25)), 3.0);
        float h = r - 1.0;
        float c = str * (0.9 * exp(-h * 3.2) + 0.04 * exp(-h * 0.8)) + 1.6 * exp(-h * 22.0);
        vec3 col = mix(vec3(1.0, 0.55, 0.28), vec3(1.0, 0.92, 0.82), exp(-h * 2.0)) * c;
        col *= 1.0 - smoothstep(14.0, 20.0, r);
        gl_FragColor = vec4(col * (1.2 + uFlare * 1.5) * uI * uBoost, 1.0);
      }`,
  }));
  corona.scale.setScalar(SUN_R * 40); corona.renderOrder = 2; sunGroup.add(corona);
  // prominence loops (H-alpha red), rising and draining
  const promMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime }, transparent: true, depthWrite: false, side: THREE.DoubleSide,      // alpha-blended: overlapping strands can never stack into hot spots
    vertexShader: `attribute float aSeed; varying vec2 vUv; varying float vS; varying float vF; void main(){ vUv = uv; vS = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv; varying float vS; varying float vF;
      ${GLSL_NOISE}
      void main(){ float s = vUv.x, dir = vS > 0.5 ? 1.0 : -1.0;
        float n = vnoise(vec3(s * 16.0 - uTime * 0.5 * dir, vUv.y * 5.0, vS * 20.0));
        float n2 = vnoise(vec3(s * 55.0 - uTime * 1.3 * dir, vUv.y * 11.0, vS * 9.0));
        float fil = 0.35 + 0.65 * smoothstep(0.2, 0.8, n * 0.7 + n2 * 0.45);          // twisted, threadlike plasma, never broken into dots
        float a = fil * smoothstep(0.0, 0.1, s) * smoothstep(1.0, 0.9, s) * (0.75 + 0.25 * sin(uTime * 0.3 + vS * 30.0));
        gl_FragColor = vec4(mix(vec3(13.0, 1.6, 0.35), vec3(19.0, 5.5, 1.6), n2 * 0.7), clamp(a * (0.12 + 0.5 * vF), 0.0, 0.7)); }`,
  });
  // each loop is a bundle of thin magnetic strands that splay apart at the apex and pinch together at the
  // footpoints; all strands of all loops are merged into one draw
  {
    const strands = [];
    for (let i = 0; i < 12; i++) {
      const a = new THREE.Vector3(gauss(), gauss() * 0.4, gauss()).normalize();
      const tng = new THREE.Vector3().crossVectors(a, new THREE.Vector3(0.3, 1, 0.2)).normalize();
      const sep = 0.1 + rnd() * 0.28, b = a.clone().applyAxisAngle(tng, sep);
      const h = sep * (0.8 + rnd() * 1.3), side = new THREE.Vector3().crossVectors(a, b).normalize();
      for (let j = 0; j < 6; j++) {
        const o1 = gauss() * 0.02, o2 = gauss() * 0.035, tw = rnd() * 6.28;
        const pts = [];
        for (let k = 0; k <= 36; k++) {
          const s2 = k / 36, arc = Math.pow(Math.sin(Math.PI * s2), 0.85);
          const p = a.clone().lerp(b, s2).normalize(), up = p.clone();
          p.multiplyScalar(SUN_R * (1 + h * arc * (1 + o1)));
          p.addScaledVector(side, SUN_R * arc * (o2 + 0.012 * Math.sin(s2 * 14 + tw))).addScaledVector(up, SUN_R * arc * 0.01 * Math.cos(s2 * 11 + tw));
          pts.push(p);
        }
        const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, SUN_R * (0.006 + rnd() * 0.01), 6, false);
        g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(rnd()), 1));
        strands.push(g);
      }
    }
    const m = new THREE.Mesh(mergeGeometries(strands, false), promMat); m.renderOrder = 3; sunGroup.add(m);
  }
  // coronal mass ejection: a shell of plasma blown off the flare site
  const cme = (() => {
    const n = Q.cme, p = new Float32Array(n * 3), s = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { p.set([gauss() * 0.35, gauss() * 0.35, 1], i * 3); s.set([0.6 + rnd() * 0.8, rnd()], i * 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 2));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uAge: { value: -1 }, uDir: uFlareDir, uPxR: U.uPxR, uPx: U.uPx }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute vec2 aS; uniform float uAge, uPxR, uPx; uniform vec3 uDir; varying vec3 vC; varying float vK;
        void main(){ vec3 t1 = normalize(cross(uDir, vec3(0.2, 1.0, 0.1))), t2 = cross(uDir, t1);
          float age = max(uAge, 0.0), r = ${SUN_R.toFixed(3)} * (1.0 + age * aS.x * 1.6);
          vec3 d = normalize(uDir + (t1 * position.x + t2 * position.y) * (0.6 + 0.4 * age));
          vec4 mv = modelViewMatrix * vec4(d * r, 1.0); gl_Position = projectionMatrix * mv;
          float sz = ${SUN_R.toFixed(3)} * 0.11 * (1.0 + age * 0.7) / (-mv.z * uPx);
          gl_PointSize = clamp(sz, 1.0, 28.0) * uPxR; vK = 2.2;
          float a = step(0.0, uAge) * exp(-age * 0.7) * smoothstep(0.0, 0.15, age) * smoothstep(1.0, 0.3, length(position.xy));
          vC = mix(vec3(1.6, 0.9, 0.5), vec3(1.0, 0.35, 0.15), aS.y) * a * 1.6; }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    m.frustumCulled = false; m.renderOrder = 3; sunGroup.add(m); return m;
  })();
  bodies.sun = { group: sunGroup, r: SUN_R, pos: () => new THREE.Vector3() };
  // the Sun as the eye sees it from afar: a white-hot core with a minimum size, a warm radiant halo and
  // soft streamers, drawn in screen space so it is round and smooth at every distance (never a few
  // blown-out pixels that the bloom turns into a square)
  const glare = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uView: U.uView, uRpx: { value: 4 }, uSize: { value: 300 }, uI: { value: 1 }, uTime: U.uTime },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`uniform vec2 uView; uniform float uSize; varying vec2 vP;
      void main(){ vP = position.xy * uSize; vec4 c = projectionMatrix * viewMatrix * vec4(modelMatrix[3].xyz, 1.0);
        if (c.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        c.xy += position.xy * uSize * 2.0 / uView * c.w; c.z = 0.0; gl_Position = c; }`,
    fragmentShader: /* glsl */`uniform float uRpx, uSize, uI, uTime; varying vec2 vP;
      ${GLSL_NOISE}
      void main(){
        float r = length(vP), R = uRpx, a = atan(vP.y, vP.x);
        float q = r / max(R, 1.0), disc = exp(-q * q * q * q * 1.4);              // a hot core with a soft, super-Gaussian edge: never a clipped white circle
        float h = r / max(R, 1.0);
        float halo = exp(-max(r - R, 0.0) / (R * 0.9 + 3.0)) * 0.9 + exp(-max(r - R, 0.0) / (R * 3.0 + 18.0)) * 0.08 + 0.05 / (1.0 + pow(max(r - R, 0.0) / (R + 8.0), 2.0));

        vec3 col = vec3(1.0, 0.96, 0.9) * disc * 8.0 + mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.86, 0.68), exp(-max(r - R, 0.0) / (R * 2.0 + 6.0))) * halo;
        col *= 1.0 - smoothstep(0.6, 1.0, r / uSize);
        gl_FragColor = vec4(col * uI, 1.0);
      }`,
  }));
  glare.frustumCulled = false; glare.renderOrder = 8; sunGroup.add(glare);

  // ------------------------------------------------------------------ planets
  const planetMat = (type, extra = {}) => new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uSunI: U.uSunIL1, uCenter: { value: new THREE.Vector3() }, uR: { value: 1 }, uRingN: { value: new THREE.Vector3(0, 1, 0) }, uRing: { value: new THREE.Vector2(0, 0) }, uAtm: { value: new THREE.Color(...(extra.atm || [0, 0, 0])) }, uMap: { value: extra.map || null }, uTint: { value: new THREE.Color(...(extra.tint || [1, 1, 1])) }, uRingMap: { value: tex.saturnRing || null }, ...extra.u },
    defines: { TYPE: type, ...(extra.map ? { HAS_MAP: 1 } : {}), ...(extra.gas ? { GAS: 1 } : {}), ...(extra.fill ? { FILL: 1 } : {}), ...(extra.aurora ? { AURORA: 1 } : {}) },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vP = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSunI, uR; uniform vec3 uCenter, uRingN, uAtm, uTint; uniform vec2 uRing; uniform sampler2D uMap, uRingMap; varying vec3 vP; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      ${GLSL_NOISE}
      ${PLANET_GLSL}
      float ringDensity(float r){
        float d = smoothstep(1.24, 1.3, r) * 0.25 + smoothstep(1.52, 1.56, r) * 0.7 - smoothstep(1.94, 1.96, r) * 0.85 + smoothstep(2.02, 2.04, r) * 0.65 - smoothstep(2.27, 2.32, r) * 0.75;
        #ifdef HAS_MAP
          if (TYPE == 4) return texture2D(uRingMap, vec2(clamp((r - 1.24) / 1.08, 0.0, 1.0), 0.5)).a;
        #endif
        return clamp(d, 0.0, 1.0) * (0.8 + 0.2 * sin(r * 300.0));
      }
      void main(){
        float rough; vec3 alb;
        #ifdef HAS_MAP
          vec2 uv = vUv;
          #ifdef GAS
            uv.x += uTime * 0.0007 * sin(vP.y * 14.0) + uTime * 0.0005;      // zonal jets shear the cloud bands
            rough = 0.0;
          #else
            rough = 1.0;
          #endif
          alb = texture2D(uMap, uv).rgb * uTint;
          #ifdef FILL
            if (dot(alb, vec3(0.333)) < 0.035) { float rr; alb = surface(7, vP, uTime, rr) * 0.8; }   // the unimaged hemisphere
          #endif
        #else
          alb = surface(TYPE, vP, uTime, rough);
        #endif
        vec3 N = normalize(vN), L = normalize(-vW), V = normalize(cameraPosition - vW);
        float ndl = dot(N, L);
        float wrap = rough > 0.5 ? max(ndl, 0.0) : max((ndl + 0.08) / 1.08, 0.0);
        // Minnaert-ish limb darkening for gas giants
        float mu = max(dot(N, V), 0.0);
        float lit = wrap * (rough > 0.5 ? 1.0 : pow(max(mu, 0.05), 0.12));
        // ring shadow
        float sh = 1.0;
        if (uRing.y > 0.0) { float dn = dot(L, uRingN); if (abs(dn) > 1e-4) { float tt = dot(uCenter - vW, uRingN) / dn; if (tt > 0.0) { float rr = length(vW + L * tt - uCenter) / uR; sh = 1.0 - 0.8 * ringDensity(rr) * step(uRing.x, rr) * step(rr, uRing.y); } } }
        vec3 sunC = vec3(1.0, 0.96, 0.9) * 2.4 * uSunI * clamp(pow(2.2 / max(length(uCenter), 0.01), 0.7), 0.12, 2.5);
        vec3 col = alb * sunC * lit * sh;
        // thin atmosphere: blue-white rim on the lit limb, a soft terminator glow
        float rim = pow(1.0 - mu, 3.0);
        col += uAtm * rim * smoothstep(-0.25, 0.4, ndl) * sunC * 0.6;
        col += alb * 0.0025;     // faint starlight so night sides aren't pure black
        #ifdef AURORA
        {   // auroral ovals round both poles, and lightning flickering in the night-side storm belts
          float lat = vP.y, lon = atan(vP.z, vP.x), night = smoothstep(0.15, -0.25, ndl);
          float oq = (abs(lat) - 0.955) / 0.011; float ov = exp(-oq * oq) * (0.45 + 0.55 * vnoise(vec3(lon * 7.0, uTime * 0.6, lat * 9.0)));
          col += vec3(0.42, 0.45, 1.7) * ov * (0.15 + 0.85 * night) * 0.4;
          vec2 g = vec2(lon * 20.0, lat * 26.0), id = floor(g), f = fract(g) - 0.5;
          float h = hash13(vec3(id, floor(uTime * 2.3 + hash13(vec3(id, 3.0)) * 7.0)));
          float fl = step(0.985, h) * exp(-dot(f, f) * 14.0) * (0.5 + 0.5 * sin(uTime * 40.0 + h * 90.0));
          col += vec3(0.75, 0.85, 1.6) * fl * night * smoothstep(0.75, 0.2, abs(lat)) * 2.5;
        }
        #endif
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const ringMat = (inner, outer, faint) => new THREE.ShaderMaterial({
    uniforms: { uSunI: U.uSunIL1, uCenter: { value: new THREE.Vector3() }, uR: { value: 1 }, uFaint: { value: faint ? 1 : 0 }, uRMap: { value: faint ? null : tex.saturnRing || null } },
    defines: !faint && tex.saturnRing ? { RMAP: 1 } : {},
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW; varying vec3 vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uSunI, uR, uFaint; uniform vec3 uCenter; uniform sampler2D uRMap; varying vec3 vW; varying vec3 vL;
      ${GLSL_NOISE}
      void main(){
        float r = length(vL.xy);
        float d;
        if (uFaint > 0.5) d = (smoothstep(0.0, 0.01, abs(fract(r * 6.0) - 0.5) - 0.46)) * 0.25;
        else {
          d = smoothstep(1.24, 1.3, r) * 0.18 + smoothstep(1.52, 1.56, r) * 0.72 - smoothstep(1.94, 1.96, r) * 0.82 + smoothstep(2.02, 2.04, r) * 0.6 - smoothstep(2.27, 2.32, r) * 0.68;
          d = clamp(d, 0.0, 1.0) * (0.72 + 0.28 * vnoise(vec3(r * 260.0, 0.0, 0.0))) * (0.85 + 0.15 * sin(r * 900.0));
          d *= 1.0 - smoothstep(0.0, 0.004, 0.003 - abs(r - 2.21));    // Encke gap
        }
        vec3 rc = vec3(-1.0);
        #ifdef RMAP
          vec4 rt = texture2D(uRMap, vec2(clamp((r - 1.24) / 1.08, 0.0, 1.0), 0.5));
          d = rt.a * (0.9 + 0.1 * vnoise(vec3(r * 900.0, 0.0, 0.0))); rc = rt.rgb;
        #endif
        if (d < 0.003) discard;
        vec3 L = normalize(-vW), V = normalize(cameraPosition - vW);
        // planet shadow on the rings
        vec3 oc = uCenter - vW; float b = dot(oc, L); float sh = 1.0;
        if (b > 0.0) { float dd = sqrt(max(dot(oc, oc) - b * b, 0.0)); sh = smoothstep(uR * 0.97, uR * 1.02, dd); }
        float phase = 0.55 + 0.9 * pow(max(dot(-V, L), 0.0), 6.0);       // forward scattering when backlit
        vec3 c = rc.x >= 0.0 ? rc * 1.15 : mix(vec3(0.72, 0.64, 0.52), vec3(0.95, 0.9, 0.8), smoothstep(1.5, 2.0, r));
        float sI = uSunI * clamp(pow(2.2 / max(length(uCenter), 0.01), 0.7), 0.12, 2.5);
        gl_FragColor = vec4(c * 2.2 * sI * sh * phase, d * (uFaint > 0.5 ? 0.5 : 0.92));
      }`,
  });
  const atmos = { venus: [0.9, 0.8, 0.5], mars: [0.8, 0.5, 0.35], jupiter: [0.55, 0.6, 0.75], saturn: [0.75, 0.7, 0.55], uranus: [0.5, 0.85, 0.95], neptune: [0.35, 0.55, 1.0] };
  const mkBody = (b, parent = scene) => {
    const g = new THREE.Group(); parent.add(g);
    const tiltG = new THREE.Group(); tiltG.rotation.z = b.tilt || 0; tiltG.rotation.y = rnd() * 6; g.add(tiltG);
    const spinG = new THREE.Group(); tiltG.add(spinG);
    const T = tex[b.key];
    const mat = planetMat(b.type, { atm: atmos[b.key], map: T, gas: ['jupiter', 'saturn', 'uranus', 'neptune', 'venus'].includes(b.key), fill: b.key === 'pluto', aurora: b.key === 'jupiter' || b.key === 'saturn' });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, b.r > 0.02 ? 160 : 64, b.r > 0.02 ? 96 : 40), mat);
    spinG.add(mesh); g.scale.setScalar(b.r);
    if (atmos[b.key]) {      // scattering halo just outside the limb: lit side bright, fading round to the night side
      const halo = new THREE.Mesh(new THREE.SphereGeometry(b.key === 'venus' || b.key === 'mars' ? 1.035 : 1.05, 96, 48), new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color(...atmos[b.key]) }, uSunI: U.uSunIL1, uC: mat.uniforms.uCenter },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
        vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform vec3 uCol, uC; uniform float uSunI; varying vec3 vN; varying vec3 vW;
          void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(-uC);
            float mu = max(-dot(N, V), 0.0);                                         // 0 at the rim, 1 facing (back side)
            float g = smoothstep(0.0, 0.45, mu) * (1.0 - smoothstep(0.45, 0.85, mu));
            float lit = smoothstep(-0.35, 0.45, dot(-N, L)) + 0.6 * pow(max(dot(-V, L), 0.0), 8.0);        // + forward scattering when backlit
            float sI = uSunI * clamp(pow(2.2 / max(length(uC), 0.01), 0.7), 0.12, 2.5);
            gl_FragColor = vec4(uCol * g * g * lit * sI * 1.6, 1.0); }`,
      }));
      halo.renderOrder = 1; spinG.add(halo);
    }
    let ring = null;
    if (b.ring) {
      ring = new THREE.Mesh(new THREE.RingGeometry(b.ring[0], b.ring[1], 256, 4), ringMat(b.ring[0], b.ring[1], b.key === 'uranus'));
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 2; tiltG.add(ring);
      mat.uniforms.uRing.value.set(b.ring[0], b.key === 'uranus' ? 0 : b.ring[1]);
    }
    const body = { ...b, group: g, tiltG, spinG, mesh, mat, ring, pos: (t, out) => orbitPos(b.au, b.lon, b.yr || 250, t, b.inc || 0, out) };
    bodies[b.key] = body; return body;
  };
  PLANETS.forEach(b => mkBody(b));
  { const sat = bodies.saturn, p = orbitPos(sat.au, sat.lon, sat.yr, 62.4).normalize();
    const n = new THREE.Vector3(0, 0.8, 0).addScaledVector(p, 0.62).normalize();
    sat.tiltG.rotation.set(0, 0, 0); sat.tiltG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); }
  DWARFS.forEach(b => mkBody(b));
  // moons (positions relative to their planet, in units of the planet's group)
  const moons = [
    { host: 'jupiter', key: 'io', name: 'IO', r: 0.0036, d: 2.4, p: 4.0, type: 10 },
    { host: 'jupiter', key: 'europa', name: 'EUROPA', r: 0.0031, d: 3.4, p: 7.0, type: 11 },
    { host: 'jupiter', key: 'ganymede', name: 'GANYMEDE', r: 0.0052, d: 4.8, p: 12.0, type: 8 },
    { host: 'jupiter', key: 'callisto', name: 'CALLISTO', r: 0.0048, d: 7.0, p: 20.0, type: 8 },
    { host: 'saturn', key: 'titan', name: 'TITAN', r: 0.005, d: 6.2, p: 16.0, type: 1 },
    { host: 'neptune', key: 'triton', name: 'TRITON', r: 0.0026, d: 4.2, p: -11.0, type: 9 },
    { host: 'pluto', key: 'charon', name: 'CHARON', r: 0.0021, d: 5.5, p: 9.0, type: 8 },
  ].map(m => {
    const mm = { ganymede: [tex.moon, [0.85, 0.8, 0.72]], callisto: [tex.moon, [0.55, 0.5, 0.46]], charon: [tex.ceres, [0.8, 0.78, 0.76]], triton: [tex.eris, [1.0, 0.9, 0.86]] }[m.key];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), planetMat(m.type, { atm: m.key === 'titan' ? [0.9, 0.6, 0.3] : [0, 0, 0], map: mm && mm[0], tint: mm && mm[1] }));
    mesh.scale.setScalar(m.r); scene.add(mesh); m.mesh = m.mat = null; m.obj = mesh; m.ph = rnd() * 6.28;
    return m;
  });

  // ------------------------------------------------------------------ orbits, belts, dust, comets, heliopause
  const orbitMat = (col, head) => new THREE.ShaderMaterial({
    uniforms: { uA: U.uOrbits, uTrail: U.uTrail, uHead: head, uCol: { value: new THREE.Color(...col) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aAng; uniform float uHead; varying float vD; varying float vT; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv;
      float d = mod(uHead - aAng, 6.2831853); vT = exp(-d * 2.6); }`,
    fragmentShader: `uniform float uA, uTrail; uniform vec3 uCol; varying float vD; varying float vT;
      void main(){ gl_FragColor = vec4(uCol * (uA * 0.16 + uTrail * vT * 1.1) * smoothstep(0.3, 3.0, vD), 1.0); }`,
  });
  const orbits = new THREE.Group(); scene.add(orbits);
  const orbitHeads = [];
  for (const b of [...PLANETS, { au: 1, key: 'earth' }, ...DWARFS]) {
    const pts = [], ang = []; const r = au2art(b.au), inc = b.inc || 0;
    for (let i = 0; i <= 720; i++) { const a = i / 720 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * Math.sin(inc), -Math.sin(a) * r * Math.cos(inc))); ang.push(a); }
    const g = new THREE.BufferGeometry().setFromPoints(pts); g.setAttribute('aAng', new THREE.Float32BufferAttribute(ang, 1));
    const head = { value: -10 };
    const l = new THREE.Line(g, orbitMat(b.key === 'earth' ? [0.25, 0.9, 0.7] : (b.tint || [0.35, 0.65, 1.0]).map(v => v * 0.5 + 0.2), head));
    orbits.add(l); if (b.key !== 'earth') orbitHeads.push([b, head]);
  }
  const beltPts = (n, rMin, rMax, thick, col, gaps, seed) => {
    const r2 = mulberry32(seed), p = new Float32Array(n * 3), c = new Float32Array(n * 4);
    let i = 0;
    while (i < n) {
      const au = rMin + (rMax - rMin) * Math.pow(r2(), 0.8);
      if (gaps.some(([g, w]) => Math.abs(au - g) < w) && r2() < 0.85) continue;
      const r = au2art(au), a = r2() * Math.PI * 2, y = gauss() * thick * r;
      p.set([Math.cos(a) * r, y, -Math.sin(a) * r], i * 3);
      const k = 0.5 + r2() * 0.7; c.set([col[0] * k, col[1] * k, col[2] * k, 0.8 + Math.pow(r2(), 6) * 3], i * 4); i++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aC', new THREE.BufferAttribute(c, 4));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uPxR: U.uPxR, uSunI: U.uSunIL1, uA: U.uBelts },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute vec4 aC; uniform float uTime, uPxR, uSunI, uA; varying vec3 vC; varying float vK;
        void main(){ float r = length(position.xz), w = uTime * 0.02 / pow(r, 1.5);
          float c = cos(w), s = sin(w); vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float d = -mv.z; gl_PointSize = clamp(aC.w * 0.9, 1.0, 2.0) * uPxR; vK = 2.0;
          vC = aC.rgb * uA * (0.25 + 0.75 * clamp(2.2 / r, 0.0, 1.0)) * 0.035 * smoothstep(5.0, 30.0, d); }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    m.frustumCulled = false; scene.add(m); return m;
  };
  beltPts(Q.asteroids, 2.1, 3.3, 0.05, [0.62, 0.55, 0.48], [[2.5, 0.03], [2.82, 0.025], [2.95, 0.02]], 5);
  beltPts(Q.kuiper, 30, 55, 0.09, [0.45, 0.55, 0.7], [], 9);
  // zodiacal dust: the faint lens of dust in the ecliptic, lit by the Sun
  const zodi = new THREE.Mesh(new THREE.CircleGeometry(30, 128), new THREE.ShaderMaterial({
    uniforms: { uA: U.uOrbits }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uA; varying vec2 vP; void main(){ float r = length(vP); gl_FragColor = vec4(vec3(1.0, 0.85, 0.65) * (0.05 / (0.2 + r * r * 0.08) * 0.06 + exp(-((r - 4.6) / 0.6) * ((r - 4.6) / 0.6)) * 0.006) * (0.4 + 0.6 * uA), 1.0); }`,
  }));
  zodi.rotation.x = -Math.PI / 2; scene.add(zodi);
  // comets
  const comets = [];
  const cometMat = (ion) => new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uA: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime, uA; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){ float y = vUv.y, x = (vUv.x - 0.5) * 2.0;
        float w = 0.08 + y * ${ion ? '0.25' : '0.9'};
        float n = ${ion ? 'pow(vnoise(vec3(x / w * 4.0, y * 30.0 - uTime * 1.5, 0.0)), 2.0) * 1.4 + 0.3' : '0.7 + 0.3 * vnoise(vec3(x * 3.0, y * 4.0, uTime * 0.1))'};
        float a = exp(-(x / w) * (x / w) * 3.0) * pow(max(1.0 - y, 0.0), ${ion ? '1.6' : '2.4'}) * n;
        gl_FragColor = vec4(${ion ? 'vec3(0.35, 0.6, 1.4)' : 'vec3(1.1, 0.95, 0.75)'} * a * uA * 0.9, 1.0); }`,
  });
  for (const c of [{ a: 3.2, e: 0.8, w: 3.6, inc: 0.4, ph: 0.06, len: 0.9 }, { a: 12, e: 0.93, w: 0.9, inc: -0.6, ph: 0.012, len: 1.1 }, { a: 7, e: 0.85, w: 4.1, inc: 0.9, ph: 0.04, len: 0.8 }]) {
    const g = new THREE.Group(); scene.add(g);
    const head = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uA: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uA; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.8, 1.0, 0.9) * (exp(-r * 30.0) * 6.0 + exp(-r * 6.0) * 0.4) * uA, 1.0); }`,
    }));
    const tailG = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const dustT = new THREE.Mesh(tailG, cometMat(false)), ionT = new THREE.Mesh(tailG, cometMat(true));
    g.add(head, dustT, ionT); comets.push({ ...c, g, head, dustT, ionT });
  }
  // the heliopause: where the solar wind stalls against the interstellar medium
  const helio = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uA: U.uHelio }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform float uTime, uA; varying vec3 vP; varying vec3 vN; varying vec3 vW;
      ${GLSL_NOISE}
      void main(){ if (uA < 0.002) discard; vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(normalize(vN), V)), 2.5);
        float n = fbm(vP * 5.0 + vec3(0.0, uTime * 0.02, 0.0)); float fil = pow(n, 3.0) * 3.0;
        vec3 c = mix(vec3(0.25, 0.5, 1.0), vec3(0.9, 0.4, 0.8), smoothstep(0.3, 0.7, n));
        gl_FragColor = vec4(c * (f * 0.6 + 0.08) * fil * uA, 1.0); }`,
  }));
  helio.scale.set(au2art(120), au2art(110), au2art(120)); helio.renderOrder = 6; scene.add(helio);

  // ------------------------------------------------------------------ the Wandering Earth's track + marker
  const trackMat = new THREE.ShaderMaterial({
    uniforms: { uProg: { value: 0 }, uA: U.uTrack, uTime: U.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aS; varying float vS; varying float vD; void main(){ vS = aS; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uProg, uA, uTime; varying float vS; varying float vD;
      void main(){ float past = step(vS, uProg); float dash = step(0.5, fract(vS * 400.0 - uTime * 0.6));
        vec3 c = past > 0.5 ? vec3(0.4, 0.8, 1.6) : vec3(0.3, 0.55, 1.0) * 0.45 * dash;
        gl_FragColor = vec4(c * uA * smoothstep(0.05, 1.5, vD) * 0.5, 1.0); }`,
  });
  let track = null;
  function setTrack(points) {
    if (track) { scene.remove(track); track.geometry.dispose(); }
    const g = new THREE.BufferGeometry().setFromPoints(points);
    g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(points.map((_, i) => i / (points.length - 1))), 1));
    track = new THREE.Line(g, trackMat); track.frustumCulled = false; scene.add(track);
  }
  // Earth (and fleet) as seen from far away: a blue-white spark with a short plasma tail
  const markerGeo = new THREE.BufferGeometry(); markerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const marker = new THREE.Points(markerGeo, new THREE.ShaderMaterial({
    uniforms: { uA: U.uMarker, uPxR: U.uPxR }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uPxR, uA; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = 22.0 * uPxR; }`,
    fragmentShader: `uniform float uA; void main(){ vec2 q = (gl_PointCoord - 0.5) * 2.0; float r = length(q); if (r > 1.0) discard;
      float c = exp(-r * r * 40.0) * 3.0 + exp(-r * 6.0) * 0.35 + (exp(-abs(q.y) * 60.0) + exp(-abs(q.x) * 60.0)) * exp(-r * 3.0) * 0.4;
      gl_FragColor = vec4(vec3(0.55, 0.8, 1.5) * c * uA, 1.0); }`,
  }));
  marker.frustumCulled = false; marker.renderOrder = 8; scene.add(marker);
  // Earth at system scale: a real-textured globe with its blue engine wake, used once the L0 planet is only a few pixels
  const earthProxy = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex.earth || null }, uA: { value: 0 } }, transparent: true, depthWrite: true,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 N = normalize(vN), L = normalize(-vW), V = normalize(cameraPosition - vW);
        vec3 a = ${tex.earth ? 'texture2D(uMap, vUv).rgb' : 'vec3(0.2, 0.35, 0.6)'};
        float l = max(dot(N, L), 0.0), rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 c = a * l * 2.2 * clamp(pow(2.2 / max(length(vW), 0.01), 0.7), 0.12, 2.5) + vec3(0.3, 0.55, 1.3) * rim * 0.6 + vec3(0.2, 0.4, 1.0) * (1.0 - l) * 0.06;
        gl_FragColor = vec4(c, uA); }`,
  }));
  earthProxy.frustumCulled = false; scene.add(earthProxy);
  // planets as points of light when their discs are sub-pixel
  const glintGeo = new THREE.BufferGeometry(), allB = [...PLANETS, ...DWARFS];
  glintGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allB.length * 3), 3));
  glintGeo.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(allB.flatMap(b => [...b.tint, b.r])), 4));
  const glints = new THREE.Points(glintGeo, new THREE.ShaderMaterial({
    uniforms: { uPxR: U.uPxR, uPx: U.uPx, uSunI: U.uSunIL1 }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec4 aC; uniform float uPxR, uPx; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      float px = aC.w / (-mv.z * uPx); gl_PointSize = 7.0 * uPxR; float r = length(position);
      vC = aC.rgb * (1.0 - smoothstep(0.6, 2.0, px)) * clamp(3.0 / sqrt(r), 0.4, 1.6) * 0.9; }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * 6.0), 1.0); }`,
  }));
  glints.frustumCulled = false; scene.add(glints);

  // ------------------------------------------------------------------ per-frame
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), ringN = new THREE.Vector3(), QW = new THREE.Quaternion();
  function update(t, S, cam) {
    // planets drift along their orbits and turn
    let gi = 0;
    for (const b of allB) {
      const B = bodies[b.key];
      B.pos(t, B.group.position);
      B.spinG.rotation.y = t * (b.key === 'jupiter' || b.key === 'saturn' ? 0.06 : 0.03);
      // legibility: from far away every body keeps a minimum on-screen size (a textured globe, never a dot)
      const minPx = b.r > 0.05 ? 22 : b.r > 0.02 ? 16 : b.type === 7 || b.type === 9 ? 6 : 10;
      const dist = B.group.position.distanceTo(cam.position), sys = THREE.MathUtils.smoothstep(S.earth.distanceTo(cam.position), 0.6, 3.0);   // only in system-scale views
      const k = 1 + (Math.max(1, minPx * (U.uPx.value || 1e-3) * dist / b.r) - 1) * sys;
      B.disp = b.r * Math.min(k, 600); B.group.scale.setScalar(B.disp);
      glintGeo.attributes.position.setXYZ(gi++, B.group.position.x, B.group.position.y, B.group.position.z);
    }
    glintGeo.attributes.position.needsUpdate = true;
    for (const [b, h] of orbitHeads) { const a = orbitAngle(b.lon, b.yr || 250, t); h.value = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); }
    scene.updateMatrixWorld();
    for (const b of allB) {
      const B = bodies[b.key], u = B.mat.uniforms;
      u.uCenter.value.copy(B.group.position); u.uR.value = B.disp;
      ringN.set(0, 1, 0).transformDirection(B.tiltG.matrixWorld); u.uRingN.value.copy(ringN);
      if (B.ring) { B.ring.material.uniforms.uCenter.value.copy(B.group.position); B.ring.material.uniforms.uR.value = B.disp; }
    }
    for (const m of moons) {
      const host = bodies[m.host], a = m.ph + t * 2 * Math.PI / (m.p * 60);
      v.set(Math.cos(a) * m.d, 0, Math.sin(a) * m.d).multiplyScalar(host.disp || host.r).applyQuaternion(host.tiltG.getWorldQuaternion(QW));
      m.obj.position.copy(host.group.position).add(v);
      const sysE = THREE.MathUtils.smoothstep(S.earth.distanceTo(cam.position), 0.6, 3.0);
      const ms = Math.max(m.r, 3.5 * (U.uPx.value || 1e-3) * m.obj.position.distanceTo(cam.position) * sysE, m.r * (host.disp || host.r) / host.r * 0.5);
      m.obj.scale.setScalar(ms); m.obj.updateMatrixWorld();
      m.obj.material.uniforms.uCenter.value.copy(m.obj.position); m.obj.material.uniforms.uR.value = ms;
    }
    // the Sun keeps a minimum size (a few pixels) and its glare takes over from the corona as it shrinks
    {
      const d = cam.position.length(), px = U.uPx.value || 1e-3, trueR = SUN_R / Math.max(d, 1e-6) / px;
      api.sunPx = trueR;
      const k = Math.max(1, 3.2 / Math.max(trueR, 1e-6)); photosphere.scale.setScalar(Math.min(k, 400));
      const gu = glare.material.uniforms, R = Math.max(trueR, 3.2);
      gu.uRpx.value = R; gu.uSize.value = Math.min(80 + R * 9, 520);
      gu.uI.value = (S.sunGlare ?? 1) * (1 - THREE.MathUtils.smoothstep(trueR, 30, 140)) * (0.55 + 0.45 * THREE.MathUtils.smoothstep(d, 4, 30)) * 3.0;
      glare.visible = gu.uI.value > 0.01;
    }
    // corona faces the camera
    corona.quaternion.copy(cam.quaternion);
    corona.material.uniforms.uI.value = S.corona ?? 1;
    corona.material.uniforms.uBoost.value = 1 + 0.8 * (1 - THREE.MathUtils.smoothstep(cam.position.length(), 0.6, 1.6));
    photosphere.rotation.y = t * 0.01;
    uFlare.value = S.flare || 0;
    {   // a smaller flare somewhere on the disc every few seconds
      const T = U.uTime.value / 5.5, k = Math.floor(T), f = T - k, pm = photosphere.material.uniforms;
      pm.uF2.value = Math.exp(-Math.pow((f - 0.3) / 0.06, 2)) * 1.6 + Math.exp(-Math.pow((f - 0.3) / 0.3, 2)) * 0.25;
      const h = Math.sin(k * 12.9898) * 43758.5453, a = (h - Math.floor(h)) * 6.283, b = Math.sin(k * 3.1) * 0.6;
      pm.uF2Dir.value.set(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b));
    }
    cme.material.uniforms.uAge.value = S.cmeAge ?? -1;
    if (S.flareDir) uFlareDir.value.copy(S.flareDir);
    // comets on Kepler ellipses, tails pointing away from the Sun
    for (const c of comets) {
      const M = c.ph * 2 * Math.PI + t * 0.004 / Math.pow(c.a, 1.5);
      let E = M; for (let k = 0; k < 8; k++) E = M + c.e * Math.sin(E);
      const x = c.a * (Math.cos(E) - c.e), y = c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
      v.set(x, 0, -y).applyAxisAngle(new THREE.Vector3(1, 0, 0), c.inc).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.w);
      const p = v.clone().multiplyScalar(1.3); c.g.position.copy(p);
      const rS = p.length(), act = clamp(Math.pow(2.6 / rS, 2), 0, 1.5), anti = p.clone().normalize();
      const L = c.len * act;
      c.head.quaternion.copy(cam.quaternion); c.head.scale.setScalar(0.05 + 0.08 * act);
      for (const [tail, k, bend] of [[c.ionT, 1.0, 0], [c.dustT, 0.75, 0.35]]) {
        const axis = anti.clone().add(v2.set(-anti.z, 0, anti.x).multiplyScalar(bend)).normalize();
        const toCam = cam.position.clone().sub(p).normalize();
        const side = new THREE.Vector3().crossVectors(axis, toCam).normalize(), nrm = new THREE.Vector3().crossVectors(side, axis);
        tail.matrix.makeBasis(side, axis, nrm).scale(v2.set(L * 0.25, L * k, 1)); tail.matrix.setPosition(0, 0, 0); tail.matrixAutoUpdate = false;
        tail.material.uniforms.uA.value = act;
      }
    }
    // Earth marker + track progress
    markerGeo.attributes.position.setXYZ(0, S.earth.x, S.earth.y, S.earth.z); markerGeo.attributes.position.needsUpdate = true;
    {
      const ed = S.earth.distanceTo(cam.position), px = 0.0095 / (ed * (U.uPx.value || 1e-3));
      const a = 1 - THREE.MathUtils.smoothstep(px, 4, 9);
      earthProxy.visible = a > 0.01 && S.earth.length() < 3000;
      earthProxy.position.copy(S.earth); earthProxy.scale.setScalar(Math.max(0.0095, 8 * (U.uPx.value || 1e-3) * ed)); earthProxy.material.uniforms.uA.value = a;
      earthProxy.rotation.y = t * 0.05;
    }
    trackMat.uniforms.uProg.value = S.trackProg ?? 0;
    helio.visible = U.uHelio.value > 0.002;
  }
  const api = { scene, update, bodies, moons, setTrack, comets, sunPx: 0 };
  return api;
}
