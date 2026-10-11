// Shared helpers for "Beyond the Wandering Earth": maths, noise, sky frames and the scale ladder.
import * as THREE from 'three';

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smoother = t => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export function gaussFn(rand) { return () => { let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; }

/* ---------------------------------------------------------------------------------------------
   The scale ladder. Three nested "layers" share one camera orientation but each has its own units,
   so a single continuous camera move can go from 100 km above the engines to 120,000 light-years out
   without ever running out of floating-point precision:
     L0  Earth layer   — 1 unit ≈ 63.7 km (Earth radius = 100)
     L1  Solar layer   — "art AU": orbit radii compressed as 2.2·r^0.75 so the inner planets breathe
     L2  Galaxy layer  — light-years, Sun at the origin
   The master camera lives in L1 units (float64 in JS); every layer camera is derived from it.
   --------------------------------------------------------------------------------------------- */
export const EARTH_R = 0.0095;                 // Earth radius in art-AU (planets are enlarged for legibility)
export const L0_PER_R = 100;                   // L0 units per Earth radius
export const K0 = EARTH_R / L0_PER_R;          // art-AU per L0 unit
export const ART_PER_LY = 63241;               // art-AU per light-year (≈ AU per ly)
export const au2art = au => 2.2 * Math.pow(au, 0.75);
export const art2au = a => Math.pow(a / 2.2, 1 / 0.75);

/* ---------------------------------------------------------------------------------------------
   Sky frames. World frame = ecliptic: +Y ecliptic north, +X the vernal equinox. The NASA star maps are
   equirectangular in equatorial coordinates; `eqMap` is their sampling direction and EQ2W rotates it
   into the world frame (a proper rotation — the sky is not mirrored).
   --------------------------------------------------------------------------------------------- */
export function eqMap(ra, dec) {
  const lon = (((0.5 - ra / 360) % 1) + 1) % 1 * Math.PI * 2, lat = THREE.MathUtils.degToRad(dec);
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}
export const EQ2W = (() => {
  const e = eqMap(0, 0), p0 = eqMap(270, 66.5607), p = p0.addScaledVector(e, -p0.dot(e)).normalize();
  const from = new THREE.Matrix4().makeBasis(e, p, new THREE.Vector3().crossVectors(e, p));
  const to = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  return to.multiply(from.transpose());
})();
export const W2EQ3 = new THREE.Matrix3().setFromMatrix4(EQ2W).transpose();   // world → map frame (for texture lookups)
export const skyDir = (ra, dec) => eqMap(ra, dec).applyMatrix4(EQ2W).normalize();
export const eclDir = lonDeg => { const l = THREE.MathUtils.degToRad(lonDeg); return new THREE.Vector3(Math.cos(l), 0, -Math.sin(l)); };

// Real places on the sky (J2000)
export const SKY = {
  gc: skyDir(266.405, -28.936),            // Sagittarius A*
  ngp: skyDir(192.859, 27.128),            // north galactic pole
  acen: skyDir(219.902, -60.834),          // α Centauri A/B — 4.37 ly
  proxima: skyDir(217.429, -62.680),       // Proxima Centauri — 4.24 ly
  hadar: skyDir(210.956, -60.373),         // β Centauri — 390 ly
  sirius: skyDir(101.287, -16.716),
  orionNeb: skyDir(83.82, -5.39),          // M42 — 1,344 ly
  pleiades: skyDir(56.75, 24.12),          // M45 — 444 ly
  carina: skyDir(161.26, -59.87),          // NGC 3372 — 7,500 ly
  lmc: skyDir(80.89, -69.76), smc: skyDir(13.19, -72.83),
};
export const GC_DIST = 26700;                              // ly, Sun → galactic centre
// galactic frame: x → galactic centre, y → north galactic pole, z completes (towards l = 90°, the direction of rotation… mirrored sign fixed below)
export const GAL = (() => {
  const x = SKY.gc.clone(), y = SKY.ngp.clone().addScaledVector(x, -SKY.ngp.dot(x)).normalize(), z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
})();

/* --------------------------------------------------------------------------------------------- */
export const GLSL_NOISE = /* glsl */`
  float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  float sfbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * snoise(p); p = p * 2.02 + 7.3; a *= 0.5; } return s; }`;

// Additive point sprite: one draw for thousands of glows.
export const POINT_GLOW_FRAG = /* glsl */`
  varying vec3 vC; varying float vK;
  void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
    gl_FragColor = vec4(vC * (exp(-d * d * vK) + 0.04 * exp(-d * d * 3.0)) * (1.0 - smoothstep(0.7, 1.0, d)), 1.0); }`;

export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Cubic Hermite with Catmull-Rom tangents on non-uniform knots: weights for p[i-1], p[i], p[i+1], p[i+2]. */
export function crWeights(t0m, t0, t1, t1p, t) {
  const h = t1 - t0, s = clamp((t - t0) / h);
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  // tangent at t0: (p1 - pm) / (t1 - tm) * h ; at t1: (p2 - p0) / (t2 - t0) * h
  const a = h / Math.max(t1 - t0m, 1e-6), b = h / Math.max(t1p - t0, 1e-6);
  return [-h10 * a, h00 - h11 * b, h01 + h10 * a, h11 * b, s];
}
