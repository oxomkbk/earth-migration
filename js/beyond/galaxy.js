// L2 — the Galaxy layer (light-years, Sun at the origin, ecliptic world frame).
// Near the Sun the sky is the real one (NASA SVS Deep Star Maps: Milky Way panorama + 42,000 catalogue stars,
// which are given plausible distances so they stream past with parallax). Pull back and it hands over to a
// 3D Milky Way registered to the panorama: a barred four-arm spiral with the Sun in the Orion Spur between
// the Sagittarius and Perseus arms, dust lanes, HII regions, globular clusters and the Magellanic Clouds.
import * as THREE from 'three';
import { GLSL_NOISE, mulberry32, gaussFn, SKY, GAL, GC_DIST, W2EQ3, EQ2W, clamp, skyDir } from './util.js';

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TANP = Math.tan(THREE.MathUtils.degToRad(15)), R0 = 22500;
const ARM_GLSL = /* glsl */`
  const float TANP = ${TANP.toFixed(5)}, R0 = ${R0.toFixed(1)};
  // arm phase for a point (x, z) in the galactic plane: 0 on an arm, ±0.5 half-way between arms
  vec2 armPhase(vec2 p){
    float r = max(length(p), 1.0), th = atan(p.y, p.x);
    float psi = (th + log(r / R0) / TANP - 3.14159265) / 1.5707963;
    float k = floor(psi + 0.5);
    return vec2(psi - k, mod(k, 4.0));
  }`;

export function buildGalaxyLayer({ Q, U, sky }) {
  const rnd = mulberry32(1958), gauss = gaussFn(rnd);
  const scene = new THREE.Scene();
  const anchors = {};

  // ------------------------------------------------------------------ the real sky (at infinity) + the deep field outside the Galaxy
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: sky.milky }, uInv: { value: W2EQ3 }, uGain: { value: 0.09 }, uA: U.uPano, uOut: U.uOutside, uTime: U.uTime },
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform mat3 uInv; uniform float uGain, uA, uOut, uTime; varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 col = vec3(0.0);
        vec3 w = normalize(vDir);
        if (uA > 0.001) {
          vec3 d = uInv * w;
          vec2 uv = vec2(fract(atan(d.z, d.x) / 6.2831853), asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
          vec3 c = ${sky.milky ? 'textureLod(uMap, uv, 0.0).rgb' : 'vec3(0.0)'};
          c = max(c - vec3(0.012, 0.012, 0.014), 0.0);
          col += c * uGain * uA;
        }
        if (uOut > 0.001) {        // intergalactic deep field: faint, distant galaxies
          vec3 q = w * 90.0; vec3 id = floor(q), f = fract(q) - 0.5;
          float h = hash13(id), g = 0.0;
          if (h > 0.86) { vec3 o = vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3)) - 0.5; vec3 dd = f - o * 0.6;
            float e = 3.0 + 8.0 * hash13(id + 9.0); g = exp(-dot(dd, dd) * 900.0 / e) * (h - 0.86) * 4.0; }
          col += mix(vec3(1.0, 0.85, 0.7), vec3(0.7, 0.8, 1.0), hash13(id + 2.0)) * g * 0.05 * uOut;
          col += vec3(0.002, 0.0025, 0.004) * uOut;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const skyBox = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), skyMat);
  skyBox.frustumCulled = false; skyBox.renderOrder = -10; scene.add(skyBox);

  // ------------------------------------------------------------------ catalogue stars in 3D
  const named = { acen: SKY.acen, sirius: SKY.sirius, hadar: SKY.hadar };
  const starsGroup = new THREE.Group(); scene.add(starsGroup);
  let acenIdx = -1;
  {
    const S = sky.stars, n = S ? S.length / 6 : Q.stars;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
    let fmax = 0; if (S) for (let i = 0; i < n; i++) fmax = Math.max(fmax, S[i * 6 + 3] + S[i * 6 + 4] + S[i * 6 + 5]);
    const C = -1.46 + 2.5 * Math.log10(fmax || 1), v = new THREE.Vector3();
    let best = -1, bestF = 0;
    for (let i = 0; i < n; i++) {
      let r, g, b;
      if (S) { v.set(S[i * 6], S[i * 6 + 1], -S[i * 6 + 2]); r = S[i * 6 + 3]; g = S[i * 6 + 4]; b = S[i * 6 + 5]; }
      else { v.set(gauss(), gauss(), gauss()); const k = rnd(); r = g = b = 0.002 + Math.pow(k, 8) * 0.5; }
      v.applyMatrix4(EQ2W).normalize();
      const f = r + g + b, m = -2.5 * Math.log10(Math.max(f, 1e-9)) + C;
      const M = clamp(0.6 + gauss() * 1.9, -6.5, 7);
      let d = 3.26 * Math.pow(10, (m - M + 5) / 5);
      d = clamp(d, 6, 6000);
      if (v.dot(SKY.acen) > 0.99996 && f > bestF) { best = i; bestF = f; }
      if (v.dot(SKY.sirius) > 0.99996) d = 8.6;
      pos.set([v.x * d, v.y * d, v.z * d], i * 3);
      const lum = f * d * d;                                      // intrinsic brightness, so the Sun's sky is reproduced exactly
      col.set([r / f, g / f, b / f, lum], i * 4);
    }
    if (best >= 0) { col[best * 4 + 3] = 0; acenIdx = best; }   // drawn separately with its flare
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aC', new THREE.BufferAttribute(col, 4));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uPxR: U.uPxR, uK: { value: 0.11 }, uA: U.uLocalStars, uFar: U.uStarFar },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute vec4 aC; uniform float uPxR, uK, uA, uFar; varying vec3 vC; varying float vK;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz); float flux = aC.w / (d * d);
          float I = uK * pow(flux, mix(0.85, 0.4, uFar)) * mix(1.0, 0.6, uFar);   // the Sun's sky exactly; softer once we leave
          float mag = min(1.0, log(1.0 + flux) / log(10.0) / 1.8);
          float s = 1.7 + mag * 4.5 + min(log(1.0 + I) * 3.0, 14.0);
          gl_PointSize = s * uPxR; vK = max(0.3 * s * s, 2.5);
          vC = aC.rgb * min(I, 40.0) * uA * smoothstep(0.02, 0.2, d); }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * (exp(-d * d * vK) + 0.02 * exp(-d * d * 4.0)) * (1.0 - smoothstep(0.6, 1.0, d)), 1.0); }`,
    }));
    pts.frustumCulled = false; pts.renderOrder = -5; starsGroup.add(pts);
  }

  // ------------------------------------------------------------------ named stars with flares: α Centauri A+B, Proxima, Sol
  const flareMat = (col, spikes) => new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uTime: U.uTime, uCol: { value: new THREE.Color(...col) }, uSpk: { value: spikes } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uI, uTime, uSpk; uniform vec3 uCol; varying vec2 vUv;
      void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
        float core = exp(-r * r * 9000.0) * 40.0 + exp(-r * 70.0) * 1.4 + exp(-r * 14.0) * 0.06 + exp(-r * 4.0) * 0.005;
        float a = atan(p.y, p.x);
        float spk = (pow(abs(cos(a * 2.0)), 400.0) * 1.0 + pow(abs(cos(a * 2.0 + 0.785)), 600.0) * 0.35) * exp(-r * 5.0) * uSpk;
        float tw = 0.94 + 0.06 * sin(uTime * 3.1 + a * 3.0);
        vec3 c = uCol * (core + spk * 1.2 * tw);
        gl_FragColor = vec4(c * uI * (1.0 - smoothstep(0.8, 1.0, r)), 1.0); }`,
  });
  const mkFlare = (col, spikes) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flareMat(col, spikes)); m.frustumCulled = false; m.renderOrder = 5; scene.add(m); return m; };
  const acenPos = SKY.acen.clone().multiplyScalar(4.37), proxPos = SKY.proxima.clone().multiplyScalar(4.24);
  const stars = [
    { key: 'acen', pos: acenPos, L: 1.9, obj: mkFlare([1.0, 0.93, 0.8], 1), size: 0.16 },
    { key: 'proxima', pos: proxPos, L: 0.02, obj: mkFlare([1.0, 0.45, 0.3], 0.3), size: 0.09 },
    { key: 'sol', pos: new THREE.Vector3(), L: 1.0, obj: mkFlare([1.0, 0.95, 0.85], 1), size: 0.16 },
    { key: 'hadar', pos: SKY.hadar.clone().multiplyScalar(390), L: 3500, obj: mkFlare([0.75, 0.85, 1.0], 0.6), size: 0.07 },
  ];
  anchors.acen = acenPos; anchors.proxima = proxPos; anchors.sol = new THREE.Vector3();

  let oortPts = null, oortLocal = null;
  // ------------------------------------------------------------------ the Oort Cloud: a trillion icy bodies in a shell 2,000–100,000 AU out.
  // Flattened (the Hills cloud) on the inside, spherical further out; specks stream past with parallax as we leave.
  {
    const n = Q.oort || 50000, p = new Float32Array(n * 3), a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 0.03 * Math.pow(50, Math.pow(rnd(), 1.25));
      const v = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
      v.y *= r < 0.25 ? 0.35 + r * 2.6 : 1; v.normalize().multiplyScalar(r);
      p.set([v.x, v.y, v.z], i * 3); a[i] = rnd();
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(a, 1));
    const oort = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uA: U.uOort, uPxR: U.uPxR, uTime: U.uTime },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute float aS; uniform float uA, uPxR, uTime; varying vec3 vC; varying float vK;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz), near = clamp(0.0025 / d, 0.0, 1.0);
          float s = 1.2 + 5.0 * near * near; gl_PointSize = s * uPxR; vK = max(0.35 * s * s, 2.5);
          float tw = 0.75 + 0.25 * sin(uTime * (1.0 + aS * 3.0) + aS * 40.0);
          vC = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.9, 0.75), step(0.8, aS)) * uA * tw * (0.14 + 1.6 * near * near) * smoothstep(0.0004, 0.002, d); }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    oort.frustumCulled = false; oort.renderOrder = -4; scene.add(oort);
    oortPts = oort;
    // icy bodies streaming past the lens: a camera-centred box of specks scaled to the current view, so the
    // pull-back reads as motion through the cloud at every scale
    const m = 7000, q = new Float32Array(m * 3); for (let i = 0; i < m * 3; i++) q[i] = rnd();
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(q, 3));
    oortLocal = new THREE.Points(lg, new THREE.ShaderMaterial({
      uniforms: { uA: U.uOort, uPxR: U.uPxR, uOff: { value: new THREE.Vector3() }, uB: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`uniform float uA, uPxR, uB; uniform vec3 uOff; varying vec3 vC; varying float vK;
        void main(){ vec3 o = fract(position - uOff) - 0.5;                 // camera-relative: exact at any distance from the Sun
          vec4 mv = vec4(mat3(viewMatrix) * (o * uB), 1.0); gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz) / uB, near = clamp(0.06 / d, 0.0, 1.0);
          float s = 1.2 + 8.0 * near; gl_PointSize = s * uPxR; vK = max(0.3 * s * s, 2.5);
          float edge = 1.0 - smoothstep(0.32, 0.5, max(abs(o.x), max(abs(o.y), abs(o.z))));
          vC = mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.92, 0.8), fract(position.x * 91.0)) * uA * edge * (0.3 + 3.0 * near * near) * smoothstep(0.004, 0.02, d); }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    oortLocal.frustumCulled = false; oortLocal.renderOrder = -4; scene.add(oortLocal);
  }

  // ------------------------------------------------------------------ nebulae (ray-marched): the G-Cloud on the way to α Cen, and a far emission nebula
  const nebulae = [];
  const mkNebula = (center, R, seed, colA, colB, dark, steps) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: center }, uR: { value: R }, uSeed: { value: seed }, uA: U.uNebula, uTime: U.uTime, uLight: { value: acenPos }, uColA: { value: new THREE.Color(...colA) }, uColB: { value: new THREE.Color(...colB) }, uDark: { value: dark } },
      defines: { STEPS: steps }, side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uC, uLight, uColA, uColB; uniform float uR, uSeed, uA, uTime, uDark; varying vec3 vW;
        ${GLSL_NOISE}
        float fbm3(vec3 p){ return vnoise(p) * 0.57 + vnoise(p * 2.03 + 17.1) * 0.29 + vnoise(p * 4.1 + 31.7) * 0.14; }
        float dens(vec3 q, out float m){
          vec3 w = vec3(vnoise(q * 1.6 + uSeed), vnoise(q * 1.6 + uSeed + 7.3), vnoise(q * 1.6 + uSeed + 13.1));   // cheap domain warp
          float n = fbm(q * 2.4 + w * 1.8 + uSeed);
          m = fbm3(q * 4.0 + w * 2.0 + 3.0);
          float shell = 1.0 - smoothstep(0.35, 1.0, length(q));
          return max(n - 0.42 + shell * 0.25 - (1.0 - shell) * 0.5, 0.0) * 3.2;
        }
        void main(){
          if (uA < 0.002) discard;
          vec3 ro = cameraPosition, rd = normalize(vW - ro);
          vec3 oc = ro - uC; float b = dot(oc, rd), c = dot(oc, oc) - uR * uR, h = b * b - c;
          if (h < 0.0) discard;
          h = sqrt(h); float t0 = max(-b - h, 0.0), t1 = -b + h; if (t1 <= 0.0) discard;
          float dt = (t1 - t0) / float(STEPS);
          float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          vec3 acc = vec3(0.0); float T = 1.0;
          for (int i = 0; i < STEPS; i++) {
            vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
            vec3 q = (p - uC) / uR;
            float m, d = dens(q, m);
            if (d > 0.002) {
              vec3 Ld = uLight - p; float ld = length(Ld);
              float ph = 0.3 + 0.5 * pow(max(dot(rd, Ld / ld), 0.0), 8.0);              // forward scattering towards the star
              vec3 em = mix(uColA, uColB, smoothstep(0.35, 0.7, m)) * (0.6 + 1.6 * pow(m, 3.0));
              em += vec3(0.6, 0.75, 1.0) * ph * 0.22 / (1.0 + ld * ld * 0.3);
              float a = d * dt / uR * 2.2;
              acc += T * em * a;
              T *= exp(-a * uDark * smoothstep(0.55, 0.75, m));
              if (T < 0.02) break;
            }
          }
          float fade = uA;
          gl_FragColor = vec4(acc * fade, (1.0 - T) * fade);
        }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), mat);
    m.position.copy(center); m.scale.setScalar(R); m.frustumCulled = false; m.renderOrder = 2; scene.add(m);
    nebulae.push(m); return m;
  };
  // G-Cloud: the real local interstellar cloud α Cen sits in — drawn far denser than life
  const gCenter = SKY.acen.clone().multiplyScalar(2.2).add(new THREE.Vector3().crossVectors(SKY.acen, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(1.3));
  mkNebula(gCenter, 1.5, 3.7, [0.025, 0.06, 0.13], [0.06, 0.06, 0.065], 2.5, Q.nebSteps);   // cold dusty blue with grey dust: present, never neon
  const farNeb = SKY.acen.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.38).add(new THREE.Vector3(0, 0.18, 0)).normalize().multiplyScalar(60);
  mkNebula(farNeb, 22, 11.2, [0.05, 0.075, 0.13], [0.11, 0.07, 0.045], 5.0, Math.max(16, Q.nebSteps - 12));   // cold gas, warm dust: the cosmos stays blue
  anchors.gcloud = gCenter; anchors.nebula = farNeb;
  // interstellar glow particles (cosmic dust lit by nearby stars) around the route
  {
    const n = Q.ism, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = rnd() * 5.5, v = SKY.acen.clone().multiplyScalar(s).add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(0.6 + s * 0.25));
      p.set([v.x, v.y, v.z], i * 3); const k = rnd(); c.set(k < 0.5 ? [0.4, 0.6, 1.0] : k < 0.8 ? [0.62, 0.7, 0.95] : [1.0, 0.85, 0.6], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aC', new THREE.BufferAttribute(c, 3));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uPxR: U.uPxR, uA: U.uNebula, uTime: U.uTime }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 aC; uniform float uPxR, uA, uTime; varying vec3 vC; varying float vK;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = -mv.z;
          gl_PointSize = clamp(0.25 / max(d, 0.01) * 60.0, 1.0, 5.0) * uPxR; vK = 3.0;
          vC = aC * uA * 0.35 * smoothstep(0.03, 0.3, d) * (0.7 + 0.3 * sin(uTime * 1.3 + position.x * 40.0)); }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    m.frustumCulled = false; m.renderOrder = 3; scene.add(m);
  }

  // ------------------------------------------------------------------ the Milky Way
  const gal = new THREE.Group(); gal.position.copy(SKY.gc).multiplyScalar(GC_DIST); gal.quaternion.setFromRotationMatrix(GAL); scene.add(gal);
  const spinG = new THREE.Group(); gal.add(spinG);
  const sunLocal = new THREE.Vector3(-GC_DIST, 0, 0);
  const armTheta = (k, r) => Math.PI + k * Math.PI / 2 - Math.log(r / R0) / TANP;
  const armW = [0.55, 1.0, 0.55, 1.0];   // Sagittarius-Carina, Perseus, Norma/Outer, Scutum-Centaurus
  const BAR = THREE.MathUtils.degToRad(27), barAxis = new THREE.Vector3(-Math.cos(BAR), 0, -Math.sin(BAR));
  const P = [], C = [], S = [];   // positions, colours (rgb + size in ly)
  const push = (x, y, z, r, g, b, s) => { P.push(x, y, z); C.push(r, g, b); S.push(s); };
  const sampleR = (L, a, b) => { for (;;) { const r = -L * Math.log(1 - rnd()); if (r > a && r < b) return r; } };
  const NG = Q.galaxy; let cl = null;
  const HALF = 62000;                                   // light-years from the centre to the edge of the plan image
  const GI = sky.galImg;
  if (GI) {
    // stars importance-sampled from NASA's plan view, so the 3D cloud and the painted disc share every arm and lane
    const { data, w: W, h: H } = GI, cdf = new Float64Array(W * H); let tot = 0;
    for (let i = 0; i < W * H; i++) { const l = (0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2]) / 255; tot += Math.pow(l, 2.2); cdf[i] = tot; }
    for (let i = 0; i < NG; i++) {
      const q = rnd() * tot; let lo = 0, hi = W * H - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < q) lo = m + 1; else hi = m; }
      const px = lo % W, py = (lo / W) | 0, u = (px + rnd()) / W, v = 1 - (py + rnd()) / H;
      const x = (v - 0.5) * 2 * HALF, z = (u - 0.5) * 2 * HALF, r = Math.hypot(x, z);
      const y = gauss() * (150 + 1700 * Math.exp(-r / 3200));
      const R = data[lo * 4] / 255, G = data[lo * 4 + 1] / 255, B = data[lo * 4 + 2] / 255, l = Math.max(0.3 * R + 0.59 * G + 0.11 * B, 0.04);
      const k = (0.25 + rnd() * 0.35) * Math.pow(l, -0.55);           // keep the hue, let brightness follow the image
      push(x, y, z, Math.min(R * k, 2), Math.min(G * k, 2), Math.min(B * k, 2), 45 + rnd() * 90);
    }
  } else {
  for (let i = 0; i < NG; i++) {
    const u = rnd();
    if (u < 0.5) {                       // young stars in clumpy star clouds along the arms
      const k = rnd() < 0.36 ? 1 : rnd() < 0.56 ? 3 : rnd() < 0.5 ? 0 : 2;
      if (!cl || cl.n-- <= 0) {
        const r = sampleR(13000, 8500, 60000), th = armTheta(k, r) + gauss() * (0.04 + 700 / r) * (armW[k] > 0.8 ? 1 : 1.3);
        cl = { r, th, k, n: 8 + (rnd() * 60 | 0), s: 250 + rnd() * 900, hot: rnd() };
      }
      const cx = cl.r * Math.cos(cl.th), cz = cl.r * Math.sin(cl.th);
      const x = cx + gauss() * cl.s, z = cz + gauss() * cl.s, y = gauss() * 160;
      const hot = rnd() * 0.6 + cl.hot * 0.4;
      const c = hot < 0.55 ? [0.55, 0.7, 1.0] : hot < 0.9 ? [0.85, 0.9, 1.0] : [1.0, 0.82, 0.62];
      const I = (0.5 + rnd() * 0.6) * armW[cl.k] * (1.15 - cl.r / 70000);
      push(x, y, z, c[0] * I, c[1] * I, c[2] * I, 120 + rnd() * 200);
    } else if (u < 0.86) {                // old disc
      const r = sampleR(10500, 1500, 62000), th = rnd() * Math.PI * 2, y = gauss() * (300 + r * 0.012);
      const I = 0.3 + rnd() * 0.3;
      push(r * Math.cos(th), y, r * Math.sin(th), 1.0 * I, 0.8 * I, 0.58 * I, 200 + rnd() * 300);
    } else if (u < 0.975) {               // bulge and bar
      const v = new THREE.Vector3(gauss() * 2400, gauss() * 1700, gauss() * 2400);
      if (rnd() < 0.6) v.set(gauss() * 8000, gauss() * 900, gauss() * 2000).applyAxisAngle(new THREE.Vector3(0, 1, 0), -BAR + Math.PI);
      const I = 0.45 + rnd() * 0.35;
      push(v.x, v.y, v.z, 1.0 * I, 0.74 * I, 0.44 * I, 240 + rnd() * 300);
    } else {                              // Orion Spur, the Sun's own short arm
      const th = Math.PI + (rnd() - 0.4) * 0.9, r = GC_DIST * Math.exp(-(th - Math.PI) * Math.tan(0.44)) + gauss() * 500;
      const I = 0.6 + rnd() * 0.4;
      push(r * Math.cos(th), gauss() * 160, r * Math.sin(th), 0.7 * I, 0.8 * I, 1.0 * I, 140 + rnd() * 200);
    }
  }
  // HII regions: pink knots strung along the arms
  for (let i = 0; i < Q.hii; i++) {
    const k = rnd() < 0.5 ? 1 : 3, r = sampleR(14000, 10000, 52000), th = armTheta(k, r) + gauss() * 0.03 + 0.02;
    const cx = r * Math.cos(th), cz = r * Math.sin(th);
    const n = 3 + (rnd() * 6 | 0);
    for (let j = 0; j < n; j++) push(cx + gauss() * 180, gauss() * 60, cz + gauss() * 180, 1.6, 0.42, 0.7, 120 + rnd() * 160);
  }
  }
  // globular clusters in the halo
  for (let i = 0; i < 160; i++) { const v = new THREE.Vector3(gauss(), gauss() * 0.8, gauss()).multiplyScalar(14000 + rnd() * 14000); push(v.x, v.y, v.z, 2.2, 1.9, 1.5, 90); }
  const mkPoints = (P, C, S, dark) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(C), 3)); g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(S), 1));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uPx: U.uPx, uPxR: U.uPxR, uA: U.uGalaxy, uNear: { value: dark ? 900 : 380 } },
      transparent: true, depthWrite: false, depthTest: false,
      blending: dark ? THREE.CustomBlending : THREE.AdditiveBlending,
      ...(dark ? { blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor } : {}),
      vertexShader: /* glsl */`attribute vec3 aC; attribute float aS; uniform float uPx, uPxR, uA, uNear; varying vec3 vC; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz), px = aS / (d * uPx);                       // true size in pixels
          float s = clamp(px, 1.5, 14.0);
          gl_PointSize = s * uPxR;
          float k = min(1.0, (px * px) / (s * s));                                // energy kept when clamped to 1.5 px
          float nearF = smoothstep(uNear * 0.5, uNear * 2.0, d) * (1.0 - smoothstep(${dark ? '10.0, 24.0' : '5.0, 13.0'}, px));   // resolved clouds give way to the disc glow
          vC = aC * uA * nearF * ${dark ? '1.0' : 'k * 0.42'}; vA = ${dark ? '0.3 * uA * nearF * min(1.0, px / 1.5)' : '1.0'}; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; float g = exp(-d * d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d));
        ${dark ? 'gl_FragColor = vec4(0.0, 0.0, 0.0, g * vA);' : 'gl_FragColor = vec4(vC * g, 1.0);'} }`,
    }));
    m.frustumCulled = false; return m;
  };
  // diffuse disc light (unresolved stars): NASA's plan view of the Galaxy, or a procedural arm model offline
  const disc = sky.galTex ? new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uA: U.uGalaxy, uCamH: { value: 0 }, uMap: { value: sky.galTex } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vP; varying vec3 vW; varying vec3 vNw; void main(){ vP = position; vNw = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0)); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uA, uCamH; uniform sampler2D uMap; varying vec3 vP; varying vec3 vW; varying vec3 vNw;
      void main(){
        vec2 uv = vec2(0.5 + vP.z / ${(2 * 62000).toFixed(1)}, 0.5 + vP.x / ${(2 * 62000).toFixed(1)});
        vec3 c = texture2D(uMap, uv).rgb;
        c = c * c * 2.4 + c * c * c * 1.8;                                       // contrast: dark lanes, bright arms
        vec3 V = normalize(cameraPosition - vW);
        float incl = 1.0 / max(abs(dot(V, normalize(vNw))), 0.25);
        float fade = smoothstep(1500.0, 7000.0, abs(uCamH));
        gl_FragColor = vec4(c * 0.85 * incl * uA * fade, 1.0);
      }`,
  })) : new THREE.Mesh(new THREE.PlaneGeometry(130000, 130000, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uA: U.uGalaxy, uCamH: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vP; varying vec3 vW; varying vec3 vNw; void main(){ vP = position; vNw = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0)); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform float uA, uCamH; varying vec3 vP; varying vec3 vW; varying vec3 vNw;
      ${GLSL_NOISE}
      ${ARM_GLSL}
      void main(){
        vec2 p = vP.xz; float r = length(p);
        vec2 ap = armPhase(p); float k = ap.y;
        float w = (k == 1.0 || k == 3.0) ? 1.0 : 0.55;
        float n = fbm(vec3(p * 0.00022, 1.0)), n2 = fbm(vec3(p * 0.0009, 4.0));
        float ax = ap.x + (n - 0.5) * 0.15, lx = ap.x + 0.09 + (n2 - 0.5) * 0.12;
        float arm = exp(-ax * ax / 0.022) * w * (0.45 + 1.1 * n) * smoothstep(8000.0, 13000.0, r);
        float lane = exp(-lx * lx / 0.002) * smoothstep(9000.0, 14000.0, r) * (0.5 + 0.7 * n2);
        float disc = exp(-r / 11000.0) * (1.0 - smoothstep(42000.0, 62000.0, r));
        float bx = dot(p, vec2(${(-Math.cos(BAR)).toFixed(4)}, ${(-Math.sin(BAR)).toFixed(4)})), by = dot(p, vec2(${(-Math.sin(BAR)).toFixed(4)}, ${Math.cos(BAR).toFixed(4)}));
        float bar = exp(-(bx * bx / 8.1e7 + by * by / 9.0e6));
        float bulge = exp(-r * r / (3800.0 * 3800.0));
        vec3 old = vec3(1.0, 0.82, 0.6), young = vec3(0.6, 0.72, 1.0);
        vec3 col = old * disc * 0.55 + young * arm * disc * 1.6 * (0.6 + 0.4 * n2) + old * (bar * 0.9 + bulge * 1.6) * vec3(1.0, 0.9, 0.75);
        col *= 1.0 - 0.75 * clamp(lane, 0.0, 1.0);
        col += vec3(1.0, 0.35, 0.55) * pow(n2, 6.0) * arm * disc * 3.0;     // emission patches
        vec3 V = normalize(cameraPosition - vW);
        vec3 Nw = normalize(vNw);
        float incl = 1.0 / max(abs(dot(V, Nw)), 0.2);                       // optically thin: brighter seen edge-on
        float fade = smoothstep(1500.0, 7000.0, abs(uCamH));
        gl_FragColor = vec4(col * 0.7 * incl * uA * fade, 1.0);
      }`,
  }));
  disc.frustumCulled = false; disc.renderOrder = 0; spinG.add(disc);
  const starPts = mkPoints(P, C, S, false); starPts.renderOrder = 1; spinG.add(starPts);
  // dust lanes on the concave side of each arm (procedural fallback only: the image has its own)
  if (!GI) {
    const P2 = [], C2 = [], S2 = [];
    for (let i = 0; i < Q.dustLanes; i++) {
      const k = (rnd() * 4) | 0, r = sampleR(14000, 7000, 50000), th = armTheta(k, r * 1.035) + gauss() * 0.02;
      const rr = r * (1 + gauss() * 0.015);
      P2.push(rr * Math.cos(th), gauss() * 90, rr * Math.sin(th)); C2.push(0, 0, 0); S2.push(500 + rnd() * 900);
    }
    for (let i = 0; i < Q.dustLanes / 4; i++) { const v = new THREE.Vector3(gauss() * 7000, gauss() * 120, gauss() * 1700).applyAxisAngle(new THREE.Vector3(0, 1, 0), -BAR + Math.PI); P2.push(v.x, v.y, v.z); C2.push(0, 0, 0); S2.push(600 + rnd() * 800); }
    const dust = mkPoints(P2, C2, S2, true); dust.renderOrder = 2; spinG.add(dust);
  }
  // the core: Sagittarius A* and the bulge glow
  const core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { uA: U.uGalaxy }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uA; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(vec3(1.0, 0.78, 0.52) * (exp(-r * 9.0) * 0.3 + exp(-r * r * 400.0) * 1.2) * uA, 1.0); }`,
  }));
  core.scale.setScalar(GI ? 14000 : 22000); core.renderOrder = 3; spinG.add(core); if (GI) core.material.uniforms.uA = { value: 0 };
  anchors.gc = gal.position.clone();
  // deep-sky objects at their real positions: what the pull-back flies past
  const dso = [];
  const dsoMat = (c1, c2, kind) => new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uC1: { value: new THREE.Color(...c1) }, uC2: { value: new THREE.Color(...c2) }, uSeed: { value: rnd() * 10 }, uKind: { value: kind } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uA, uSeed, uKind; uniform vec3 uC1, uC2; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); if (r > 1.0) discard;
        vec3 q = vec3(p * 2.2, uSeed);
        float n = fbm(q + fbm(q * 1.5 + 3.0) * 1.2), m = fbm(q * 2.6 + 7.0);
        float shape = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.7);
        vec3 c;
        if (uKind < 0.5) {         // emission nebula: domain-warped gas with bright ionisation ridges, dark dust lanes, young stars
          vec3 qq = q + vec3(fbm(q * 1.2 + 4.0), fbm(q * 1.3 + 9.0), 0.0) * 1.8;
          float g = fbm(qq), rd = 1.0 - abs(fbm(qq * 2.2 + 5.0) * 2.0 - 1.0); rd = rd * rd * rd * rd;
          float dust = smoothstep(0.42, 0.68, fbm(qq * 1.7 + 11.0));
          float sh = smoothstep(1.0, 0.1, r + (g - 0.5) * 0.8);
          float st = pow(hash12(floor(vUv * 90.0)), 60.0) * 14.0 * sh;
          c = (mix(uC1, uC2, smoothstep(0.3, 0.8, m)) * (g * g * 1.3 + rd * 1.5) * (1.0 - 0.85 * dust) + vec3(0.9, 0.95, 1.0) * st) * sh;
        }
        else { float st = pow(hash12(floor(vUv * 40.0)), 30.0) * 30.0 * smoothstep(0.9, 0.2, r); c = uC1 * (pow(n, 3.0) * shape * 1.2 + st) + uC2 * exp(-r * r * 6.0) * 0.3; }
        gl_FragColor = vec4(c * uA, 1.0); }`,
  });
  for (const [key, ra, dec, dist, size, c1, c2, kind] of [
    ['orion', 83.82, -5.39, 1344, 34, [1.0, 0.3, 0.42], [0.35, 0.55, 1.0], 0],
    ['pleiades', 56.75, 24.12, 444, 18, [0.55, 0.7, 1.0], [0.6, 0.75, 1.0], 1],
    ['carina', 161.26, -59.87, 7500, 260, [1.0, 0.36, 0.3], [0.9, 0.6, 0.35], 0],
    ['lagoon', 270.92, -24.38, 4100, 110, [1.0, 0.32, 0.5], [0.5, 0.6, 1.0], 0],
    ['eagle', 274.7, -13.8, 5700, 120, [0.9, 0.45, 0.3], [0.4, 0.7, 0.8], 0],
    ['rosette', 98.0, 4.9, 5200, 130, [1.0, 0.28, 0.35], [1.0, 0.5, 0.4], 0],
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dsoMat(c1, c2, kind));
    const pos = skyDir(ra, dec).multiplyScalar(dist); m.position.copy(pos); m.scale.setScalar(size * 2.2);
    m.frustumCulled = false; m.renderOrder = 3; scene.add(m); dso.push({ key, m, pos, size }); anchors[key] = pos;
  }
  // the solar neighbourhood: a 3D star field of the Orion Spur that recedes as the camera pulls back
  {
    const n = Q.localArm, p = new Float32Array(n * 3), c = new Float32Array(n * 4);
    const spur = new THREE.Vector3(Math.cos(Math.PI + 0.45), 0, Math.sin(Math.PI + 0.45)).normalize();   // pitched spur direction (galactic frame)
    const across = new THREE.Vector3(-spur.z, 0, spur.x);
    for (let i = 0; i < n; i++) {
      const v = rnd() < 0.7
        ? spur.clone().multiplyScalar(gauss() * 2600).addScaledVector(across, gauss() * 800).add(new THREE.Vector3(0, gauss() * 260, 0))
        : new THREE.Vector3(gauss() * 4500, gauss() * 420, gauss() * 4500);
      if (v.length() < 60) v.setLength(60 + rnd() * 100);           // the Local Bubble
      v.add(sunLocal);
      p.set([v.x, v.y, v.z], i * 3);
      const k = rnd(), col = k < 0.12 ? [0.6, 0.72, 1.0] : k < 0.5 ? [1.0, 0.97, 0.92] : k < 0.85 ? [1.0, 0.85, 0.65] : [1.0, 0.65, 0.45];
      c.set([...col, 0.4 + Math.pow(rnd(), 6) * 6], i * 4);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aC', new THREE.BufferAttribute(c, 4));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uPxR: U.uPxR, uA: U.uLocalArm }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 aC; uniform float uPxR, uA; varying vec3 vC; varying float vK;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = length(mv.xyz);
          float I = aC.w * clamp(pow(900.0 / d, 1.1), 0.05, 2.5);
          gl_PointSize = (1.4 + min(I, 2.0)) * uPxR; vK = 2.6; vC = aC.rgb * min(I, 2.5) * 0.55 * uA; }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    m.frustumCulled = false; m.renderOrder = 1; spinG.add(m);
  }
  // the Magellanic Clouds
  const clouds = [], mcGlow = [];
  for (const [dir, dist, size, n] of [[SKY.lmc, 163000, 7000, Q.mc], [SKY.smc, 200000, 3500, Q.mc / 2]]) {
    const P3 = [], C3 = [], S3 = []; const c = dir.clone().multiplyScalar(dist);
    const bar = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
    for (let i = 0; i < n; i++) {
      const v = rnd() < 0.4 ? bar.clone().multiplyScalar(gauss() * size * 0.6).add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(size * 0.15)) : new THREE.Vector3(gauss(), gauss() * 0.6, gauss()).multiplyScalar(size * 0.45);
      P3.push(c.x + v.x, c.y + v.y, c.z + v.z); const I = 0.5 + rnd() * 0.5, blue = rnd() < 0.5;
      C3.push((blue ? 0.7 : 1.0) * I, (blue ? 0.8 : 0.85) * I, (blue ? 1.0 : 0.7) * I); S3.push(300 + rnd() * 300);
    }
    const m = mkPoints(P3, C3, S3, false); m.renderOrder = 1; scene.add(m); clouds.push(c);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dsoMat([0.55, 0.6, 0.8], [0.9, 0.75, 0.9], 0));
    glow.position.copy(c); glow.scale.setScalar(size * 2.6); glow.frustumCulled = false; glow.renderOrder = 0; scene.add(glow);
    mcGlow.push(glow);
  }
  anchors.lmc = clouds[0]; anchors.smc = clouds[1];
  // route line: Sol → α Centauri
  // a ribbon of constant on-screen width, so the voyage reads at every scale: travelled part bright, the rest
  // dashed and dim, a pulse running ahead of the planet
  const route = (() => {
    const N = 96, P = [], O = [], SD = [], SS = [], idx = [];
    for (let i = 0; i < N; i++) {
      const a = acenPos.clone().multiplyScalar(i / N), b = acenPos.clone().multiplyScalar((i + 1) / N);
      for (const [p, o, sg, sv] of [[a, b, 1, i / N], [a, b, 1, i / N], [b, a, -1, (i + 1) / N], [b, a, -1, (i + 1) / N]]) { P.push(p.x, p.y, p.z); O.push(o.x, o.y, o.z); SS.push(sv); }
      SD.push(1, 1, -1, 1, 1, -1, -1, -1);
      const k = i * 4; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aO', new THREE.Float32BufferAttribute(O, 3));
    g.setAttribute('aSD', new THREE.Float32BufferAttribute(SD, 2)); g.setAttribute('aS', new THREE.Float32BufferAttribute(SS, 1)); g.setIndex(idx);
    const l = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uA: U.uRoute, uProg: { value: 0 }, uView: U.uView, uTime: U.uTime },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`attribute vec3 aO; attribute vec2 aSD; attribute float aS; uniform vec2 uView; varying float vS; varying float vSide;
        void main(){ vS = aS; vSide = aSD.x;
          vec4 c0 = projectionMatrix * modelViewMatrix * vec4(position, 1.0), c1 = projectionMatrix * modelViewMatrix * vec4(aO, 1.0);
          vec2 s0 = c0.xy / max(c0.w, 1e-6), s1 = c1.xy / max(c1.w, 1e-6);
          vec2 d = normalize((s1 - s0) * uView * aSD.y + vec2(1e-6, 0.0)), n = vec2(-d.y, d.x);
          c0.xy += n * aSD.x * 4.0 / uView * 2.0 * c0.w; gl_Position = c0; }`,
      fragmentShader: /* glsl */`uniform float uA, uProg, uTime; varying float vS; varying float vSide;
        void main(){ float past = step(vS, uProg), w = abs(vSide);
          float core = exp(-w * w * 40.0), glow = exp(-w * w * 5.0) * 0.35;
          float dash = mix(step(0.5, fract(vS * 60.0)) * 0.6 + 0.2, 1.0, past);
          float pq = (vS - uProg - fract(uTime * 0.12) * (1.0 - uProg)) * 60.0, pulse = exp(-pq * pq) * (1.0 - past);
          vec3 c = mix(vec3(0.35, 0.55, 1.0) * 0.4 * dash, vec3(0.45, 0.75, 1.4) * 0.7, past) * (core + glow) + vec3(0.8, 0.95, 1.6) * pulse * (core * 2.0 + glow);
          gl_FragColor = vec4(c * uA, 1.0); }`,
    }));
    l.frustumCulled = false; l.renderOrder = 6; scene.add(l); return l;
  })();

  // ------------------------------------------------------------------ per-frame
  const tmp = new THREE.Vector3();
  function update(t, S, cam) {
    skyBox.position.copy(cam.position); skyBox.scale.setScalar(cam.far * 0.5);
    spinG.rotation.y = S.galRot || 0;
    if (GI) core.material.uniforms.uA.value = 0.12 * U.uGalaxy.value;
    gal.updateMatrixWorld();
    anchors.solGal = spinG.localToWorld(sunLocal.clone());
    tmp.copy(cam.position); gal.worldToLocal(tmp); disc.material.uniforms.uCamH.value = tmp.y;
    core.quaternion.copy(gal.quaternion).invert().multiply(cam.quaternion);   // face the camera inside the rotated frame
    core.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -spinG.rotation.y));
    for (const s of stars) {
      const d = s.pos.distanceTo(cam.position);
      const flux = s.L * 10.05 / Math.max(d * d, 1e-12);    // normalised: α Cen seen from the Sun = 1
      let I = Math.min(Math.pow(flux, 0.6), 7) * (S.starFlare ?? 1);      // a very near star is dazzling, but never a white-out
      if (s.key === 'sol') I *= S.solVis ?? 1;
      s.obj.visible = I > 0.002;
      s.obj.position.copy(s.pos); s.obj.quaternion.copy(cam.quaternion);
      s.obj.scale.setScalar(d * s.size * (0.6 + 0.4 * Math.min(I, 3)));
      s.obj.material.uniforms.uI.value = I;
      s.I = I;
    }
    route.material.uniforms.uProg.value = S.routeProg ?? 0;
    oortPts.visible = oortLocal.visible = U.uOort.value > 0.002;
    if (oortLocal.visible) { const B = Math.max(S.viewScale || 1, 1e-7), fr = x => x / B - Math.floor(x / B); oortLocal.material.uniforms.uOff.value.set(fr(cam.position.x), fr(cam.position.y), fr(cam.position.z)); oortLocal.material.uniforms.uB.value = B; }
    for (const g of mcGlow) { g.quaternion.copy(cam.quaternion); g.material.uniforms.uA.value = 0.5 * U.uGalaxy.value; }
    for (const o of dso) {
      const d = o.pos.distanceTo(cam.position);
      o.m.quaternion.copy(cam.quaternion);
      o.m.material.uniforms.uA.value = smoothstep(o.size * 0.6, o.size * 3, d) * (1 - smoothstep(9000, 30000, d)) * (S.dsoVis ?? 1) * Math.min(1, 900 / Math.max(d, 1)) * 0.28;
      o.m.visible = o.m.material.uniforms.uA.value > 0.002;
    }
  }
  return { scene, update, anchors, stars, nebulae, gal, spinG, sunLocal, dso };
}
