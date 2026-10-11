// L0 — the Earth layer (1 unit ≈ 63.7 km, Earth radius 100). The Wandering Earth itself: a slowly turning,
// freezing planet whose trailing hemisphere burns with thousands of fusion engines; three space elevators
// rising to a geostationary ring; fleets, satellites, a deep-space observatory; and the interstellar-voyage
// effects (bow shock, aurora, dust streaks, Kuiper ice shards).
import * as THREE from 'three';
import { createAtmosphere } from '../fx/atmosphere.js';
import { createVolumetricPlumes } from '../fx/volplume.js';
import { flattenModel } from '../fx/models.js';
import { applyTriplanar } from '../fx/triplanar.js';
import { createSmoke } from '../fx/smoke.js';
import { createShockwave } from '../fx/shock.js';
import { Kit, instancedVariant } from '../fx/kit.js';
import { climberKit, trussBayKit, waystationKit, hubKit, flagshipKit, engineTowerKit, navLightMaterial, beamMaterial } from './craft.js';
import { GLSL_NOISE, mulberry32, gaussFn, canvasTex, clamp } from './util.js';

const R = 100;
const Yv = new THREE.Vector3(0, 1, 0);
export const SPIN_RATE = Math.PI * 2 / 1400;     // rad per story-second — a slow, visible turn
export const SPIN0 = 2.1;
export const TILT = THREE.MathUtils.degToRad(23.44);
/** Object-space (spinning-Earth) direction that faces a given world direction at story time t. */
export function toSpinFrame(worldDir, t) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, TILT)).multiply(new THREE.Quaternion().setFromAxisAngle(Yv, SPIN0 + t * SPIN_RATE));
  return worldDir.clone().applyQuaternion(q.invert());
}

/** Analytic Earth shadow for MeshStandardMaterial (the planet is a sphere: no shadow map needed). */
// One uniform for the key-light rim on every hero material (set per frame from the key light).
export const uRim = { value: 0.3 };
// The hero array's plasma light on nearby hardware: a diffuse-only point term in the same patch (world position,
// colour × intensity, range). It replaces a real PointLight, which added a full BRDF light to every material.
export const uEngP = { value: new THREE.Vector3(0, 1e6, 0) }, uEngC = { value: new THREE.Color(0, 0, 0) };
export function patchEarthShadow(mat, uEarthV) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev(sh, r);
    sh.uniforms.uEarthV = uEarthV; sh.uniforms.uRim = uRim; sh.uniforms.uEngP = uEngP; sh.uniforms.uEngC = uEngC;
    // Key-light rim: where the key comes from behind or beside the subject, the silhouette edges catch it
    // (grazing forward scatter on dust and paint). Only edges (Fresnel), only on the side the light wraps
    // round, and eclipsed by the Earth like the key itself — so a backlit hull reads as a shape, never a hole.
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
      { vec3 Lr = directionalLights[ 0 ].direction;
        float fres = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.0);
        float wrap = smoothstep(-0.35, 0.45, dot(geometryNormal, Lr));
        float back = saturate(dot(-geometryViewDir, Lr));
        reflectedLight.directDiffuse += directionalLights[ 0 ].color * earthShadow(geometryPosition, Lr) * (material.diffuseColor + material.specularColor) * fres * wrap * (0.35 + 0.65 * back) * uRim; }
      #endif
      if (uEngC.r + uEngC.g + uEngC.b > 0.0) {      // engine light: three.js point-light falloff (decay 1.4, range 90), Lambert only
        vec3 lv = (viewMatrix * vec4(uEngP, 1.0)).xyz - geometryPosition; float ld = length(lv);
        float fall = 1.0 / max(pow(ld, 1.4), 0.01) * pow2(saturate(1.0 - pow4(ld / 90.0)));
        reflectedLight.directDiffuse += uEngC * fall * saturate(dot(geometryNormal, lv / ld)) * material.diffuseColor * RECIPROCAL_PI; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_pars_begin>', /* glsl */`
      uniform vec3 uEarthV;
      float earthShadow(vec3 p, vec3 L){
        vec3 oc = p - uEarthV; float b = dot(oc, L);
        float d = sqrt(max(dot(oc, oc) - b * b, 0.0));
        return b > 0.0 ? 1.0 : smoothstep(${(R * 0.985).toFixed(1)}, ${(R * 1.035).toFixed(1)}, d);
      }
      uniform float uRim; uniform vec3 uEngP, uEngC;
      ` + THREE.ShaderChunk.lights_pars_begin.replace('light.color = directionalLight.color;', 'light.color = directionalLight.color * earthShadow(-vViewPosition, directionalLight.direction);'));
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '|eshadow-rim';
  return mat;
}

function windowTex(w, h, rows, cols, fill, seed, base = '#000') {
  const rnd = mulberry32(seed);
  return canvasTex(w, h, (x) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (rnd() > fill) continue;
      const warm = rnd() < 0.7, k = 0.5 + rnd() * 0.5;
      x.fillStyle = warm ? `rgba(255,${190 + rnd() * 40 | 0},${120 + rnd() * 40 | 0},${k})` : `rgba(150,210,255,${k})`;
      x.fillRect(c * cw + cw * 0.2, r * ch + ch * 0.25, cw * 0.6, ch * 0.5);
    }
  });
}
function panelTex(seed) {
  const rnd = mulberry32(seed);
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#9aa1ab'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 340; i++) { const g = 120 + rnd() * 90 | 0; x.fillStyle = `rgb(${g},${g + 3},${g + 8})`; x.fillRect(rnd() * w, rnd() * h, 12 + rnd() * 80, 8 + rnd() * 50); }
    x.strokeStyle = 'rgba(30,34,40,.55)'; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * w / 8, 0); x.lineTo(i * w / 8, h); x.stroke(); x.beginPath(); x.moveTo(0, i * h / 8); x.lineTo(w, i * h / 8); x.stroke(); }
  });
}

export function buildEarthLayer({ T, models, Q, U, pbr = {}, renderer, milky }) {
  const rnd = mulberry32(2096), gauss = gaussFn(rnd);
  const world = {};   // named anchor points (L0 world coordinates), refreshed each frame
  const scene = new THREE.Scene();
  const tilt = new THREE.Group(); tilt.rotation.z = TILT; scene.add(tilt);
  const spin = new THREE.Group(); tilt.add(spin);

  // ------------------------------------------------------------------ lights / environment
  // the one key light. Its shadow map covers only the subject in front of the camera (a tight, texel-snapped
  // orthographic box), so the hero hardware self-shadows crisply without acne or swimming edges.
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2); scene.add(sun, sun.target);
  sun.castShadow = true;            // always (a stable program set); tier 'no shadows' parks the map and never re-renders it
  let shadowTick = 0;
  sun.shadow.mapSize.set(Q.shadowMap || 512, Q.shadowMap || 512);
  sun.shadow.bias = -0.00015; sun.shadow.radius = 2;
  // Motivated fill (hemisphere): the 'sky' side is the Earth as seen from the subject — earthshine, scaled by
  // how big and how lit the planet is from there — and the other side a cold space fill, so an unlit flank
  // keeps ~4–10 % of the key: form stays readable, the key still owns the shading. Diffuse only; it never
  // touches the Earth, the atmosphere or space itself.
  const fill = new THREE.HemisphereLight(0x5a7fb8, 0x10192c, 0); scene.add(fill);
  const engineLight = new THREE.Object3D(), engineCol = new THREE.Color(0x8fbcff); spin.add(engineLight);   // (lit by uEngP/uEngC, see patchEarthShadow)
  const uThrustL = { value: new THREE.Vector3(0, 0, 1) }, uSunL = { value: new THREE.Vector3(1, 0, 0) };
  const uCloud = { value: 0 };
  const uHeroL = { value: (U.heroDirL || new THREE.Vector3(0, 1, 0)).clone().normalize() };

  // shared PBR materials
  const pTex = panelTex(7); pTex.wrapS = pTex.wrapT = THREE.RepeatWrapping;
  let tpN = 0;
  const mk = (o, tp) => { const m = new THREE.MeshStandardMaterial(o); if (tp && pbr[tp[0]]) applyTriplanar(m, pbr[tp[0]], { scale: tp[1], key: 'e' + (tpN++), metalMul: 0.9, blend: tp[2] ?? 1 }); return patchEarthShadow(m, U.uEarthV); };
  // Image-based lighting as a live reflection capture (UE sky-light style): dark space + a dim Milky Way + the
  // Earth itself, seen from the current subject at its true direction, size and phase. No sun in the capture:
  // the DirectionalLight alone owns the sun's diffuse and specular, so there is never a second, misplaced sun
  // in the reflections. Re-captured only when the view of the Earth or the sun changes noticeably.
  const env = (() => {
    if (!renderer) return null;
    const es = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { uMap: { value: milky || null }, uE: { value: new THREE.Vector3(1, 0, 0) }, uAng: { value: 0.1 }, uHalo: { value: new THREE.Color() } },
      vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uE, uHalo; uniform float uAng; varying vec3 vD;
        void main(){ vec3 d = normalize(vD), c = vec3(0.0015, 0.002, 0.0035);
          float ea = acos(clamp(dot(d, uE), -1.0, 1.0)) - uAng;                       // angle outside the planet's disc
          c += uHalo * (exp(-max(ea, 0.0) * 9.0) * 0.6 + exp(-max(ea, 0.0) * 2.2) * 0.12);   // the lit limb and its scattered glow: metals pick up a gradient, not a void
          ${milky ? 'c += texture2D(uMap, vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5)).rgb * 0.08;' : ''}
          gl_FragColor = vec4(c, 1.0); }`,
    })); es.add(sky);
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uI: { value: 1 }, uGlow: { value: 0 } },
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uSun; uniform float uI, uGlow; varying vec3 vN;
        void main(){ float ndl = dot(normalize(vN), uSun);
          vec3 day = vec3(0.21, 0.29, 0.42) * max(ndl, 0.0) * uI;                                   // ≈0.3 Bond albedo, ocean-and-cloud blue
          vec3 dusk = vec3(0.25, 0.11, 0.05) * smoothstep(-0.12, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.2, ndl)) * uI;
          vec3 night = vec3(0.02, 0.04, 0.09) * uGlow * (1.0 - smoothstep(-0.1, 0.1, ndl));   // the engines' blue light on the night side
          gl_FragColor = vec4(day + dusk + night, 1.0); }`,
    }));
    es.add(planet);
    const pm = new THREE.PMREMGenerator(renderer);
    let rt = null, last = { dir: new THREE.Vector3(), ang: -1, sun: new THREE.Vector3(), I: -1, at: -1e9 };
    return {
      update(focus, sunDir, I, glow, now) {
        const d = Math.max(focus.length(), R * 1.01), dir = focus.clone().negate().divideScalar(d), ang = Math.asin(Math.min(R / d, 0.999));
        const changed = rt === null || dir.angleTo(last.dir) > 0.04 || Math.abs(ang - last.ang) > last.ang * 0.08 || sunDir.angleTo(last.sun) > 0.035 || Math.abs(I - last.I) > 0.08;
        if (!changed || now - last.at < 400) return;
        planet.position.copy(dir).multiplyScalar(20); planet.scale.setScalar(20 * Math.sin(ang));
        planet.material.uniforms.uSun.value.copy(sunDir); planet.material.uniforms.uI.value = I; planet.material.uniforms.uGlow.value = glow;
        { const su = sky.material.uniforms, lit = 0.5 * (1 - dir.dot(sunDir)); su.uE.value.copy(dir); su.uAng.value = ang;
          su.uHalo.value.setRGB(0.2, 0.32, 0.6).multiplyScalar((0.25 + 0.75 * lit) * I + 0.1 * glow); }
        // re-capture into the same target: a new texture each time would make every standard material
        // re-resolve its program (and allocate / free a 768×1024 target) a few times a second — visible hitches
        // 128² faces: dark space and one planet on mostly rough metal need no more, at a quarter of the cost of 256²
        if (!rt) { pm._setSize(128); rt = pm._allocateTargets(); rt.depthBuffer = true; scene.environment = rt.texture; }
        const t0 = renderer.getRenderTarget(); pm._setSize(128); pm._sceneToCubeUV(es, 0.1, 100, rt); pm._applyPMREM(rt); pm._cleanup(rt); renderer.setRenderTarget(t0);
        last.dir.copy(dir); last.ang = ang; last.sun.copy(sunDir); last.I = I; last.at = now;
      },
    };
  })();
  const M = {
    hull: mk({ color: 0xa4abb4, map: pTex, metalness: 0.15, roughness: 0.5, envMapIntensity: 1.0 }, ['metal_plate_02', 1.2, 0.8]),
    dark: mk({ color: 0x4e5560, metalness: 0.35, roughness: 0.55, envMapIntensity: 1.0 }, ['painted_metal_shutter', 1.5, 0.85]),
    gold: mk({ color: 0xd9a84e, metalness: 1.0, roughness: 0.32, envMapIntensity: 1.0 }),
    panel: mk({ color: 0xffffff, map: canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#c8ccd2'; x.fillRect(0, 0, w, h); for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1d3a78'); g.addColorStop(1, '#0d1c3e'); x.fillStyle = g; x.fillRect(i * w / 4 + 3, j * h / 6 + 3, w / 4 - 6, h / 6 - 6); x.strokeStyle = 'rgba(120,150,210,.35)'; x.lineWidth = 1; for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(i * w / 4 + 3, j * h / 6 + k * h / 24); x.lineTo((i + 1) * w / 4 - 3, j * h / 6 + k * h / 24); x.stroke(); } } }), metalness: 0.2, roughness: 0.26, emissive: 0x081226, emissiveIntensity: 0.25, envMapIntensity: 1.0 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.68, 1.7) }),
    warm: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.35) }),
  };
  // hero-asset materials: painted plating with panel seams, bare machined metal, glass, lamps, hot radiators
  {
    const winT = windowTex(1024, 32, 2, 256, 0.62, 52); winT.wrapS = winT.wrapT = THREE.RepeatWrapping; winT.repeat.set(2, 1);
    const radT = canvasTex(256, 64, (x, w, h) => { x.fillStyle = '#e8ecf0'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(120,130,145,.55)'; for (let i = 0; i < h; i += 4) x.fillRect(0, i, w, 1); x.fillStyle = 'rgba(90,100,115,.6)'; for (let i = 0; i < w; i += 64) x.fillRect(i, 0, 2, h); });
    M.white = mk({ color: 0xb4bac2, metalness: 0.05, roughness: 0.62, envMapIntensity: 1.0 }, ['painted_metal_shutter', 1.0, 0.5]);
    if (M.white.userData.tp) M.white.userData.tp.tpPanel.value = 1.6;
    M.metal = mk({ color: 0x9aa2ab, metalness: 0.9, roughness: 0.38, envMapIntensity: 1.0, side: THREE.DoubleSide }, ['metal_plate_02', 1.2, 0.75]);
    M.glass = mk({ color: 0x0c1a2c, metalness: 0.0, roughness: 0.05, envMapIntensity: 1.0, emissive: 0x0a2040, emissiveIntensity: 0.3 });
    M.rad = mk({ color: 0xd9dee4, map: radT, metalness: 0.05, roughness: 0.42, envMapIntensity: 1.0 });   // white ceramic radiator panels with fluid-loop ribs (as on the ISS), not glowing red
    M.win = new THREE.MeshBasicMaterial({ map: winT, color: new THREE.Color(1.2, 1.0, 0.8) });
    M.winT = new THREE.MeshBasicMaterial({ map: winT, color: new THREE.Color(1.6, 1.35, 1.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    M.lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.3, 2.1) });
    M.lampDim = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.25, 1.0) });
    M.throat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 1.0, 1.9) });
    M.nav = navLightMaterial(U);
    // docking guide lights: a chase running round each docking collar, like runway approach lights
    M.dock = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p; }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){ float c = fract(vUv.x * 6.0 - uTime * 0.6); float k = smoothstep(0.0, 0.08, c) * (1.0 - smoothstep(0.08, 0.35, c));
          gl_FragColor = vec4(vec3(0.35, 0.75, 1.6) * (0.25 + 1.6 * k), 1.0); }`,
    });
    M.beam = beamMaterial([0.85, 0.92, 1.15], 0.1);
  }
  M.craft = mk({ vertexColors: true, metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.0 });
  const flat = { iss: models.iss && flattenModel(models.iss, M.craft), hubble: models.hubble && flattenModel(models.hubble, M.craft) };
  // the detailed engine tower (hero array and steering array): one InstancedMesh per material, driven together
  const towerKit = engineTowerKit(M, rnd);
  const towerSet = n => { const ms = [...towerKit.body.instanced(n), ...towerKit.lights.instanced(n)]; return { meshes: ms, setMatrixAt: (i, m) => { for (const x of ms) x.setMatrixAt(i, m); } }; };

  // ------------------------------------------------------------------ Earth
  const geo = new THREE.SphereGeometry(R, Q.earthSeg[0], Q.earthSeg[1]);
  // engine sites: sampled on land from the roughness channel of the surface map
  const engines = [], hero = [];
  const landImg = (() => {
    const img = T.surf && T.surf.image; if (!img) return null;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 1024, 512); return x.getImageData(0, 0, 1024, 512).data;
  })();
  const isLand = (u, v) => { if (!landImg) return rnd() < 0.3; const px = Math.min(1023, u * 1024 | 0), py = Math.min(511, (1 - v) * 512 | 0); return landImg[(py * 1024 + px) * 4 + 1] > 40; };
  const uvToDir = (u, v, out = new THREE.Vector3()) => { const phi = u * Math.PI * 2, th = (1 - v) * Math.PI; return out.set(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)); };
  const dirToUv = d => { const v = 1 - Math.acos(clamp(d.y, -1, 1)) / Math.PI; let phi = Math.atan2(d.z, -d.x); if (phi < 0) phi += Math.PI * 2; return [phi / (Math.PI * 2), v]; };
  let guard = 0;
  while (engines.length < Q.engines && guard++ < 400000) {
    const u = rnd(), v = 0.5 + Math.asin(rnd() * 2 - 1) / Math.PI;   // uniform on the sphere
    if (Math.abs(v - 0.5) > 0.42 || !isLand(u, v)) continue;
    engines.push({ dir: uvToDir(u, v), u, v, s: 0.5 + rnd() * 0.32, seed: rnd() });
  }
  // the hero array (filmed up close): a dense cluster around a site chosen by the story
  const heroDir = (U.heroDirL || new THREE.Vector3(0.3, 0.5, 0.8)).clone().normalize();
  {
    const t1 = new THREE.Vector3().crossVectors(heroDir, Yv).normalize(), t2 = new THREE.Vector3().crossVectors(t1, heroDir);
    const n = Q.hero;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rnd() * 0.3, r = 0.022 + 0.11 * Math.sqrt(i / n) + rnd() * 0.01;
      const d = heroDir.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
      const [u, v] = dirToUv(d);
      hero.push({ dir: d, u, v, s: 0.85 + rnd() * 0.4, seed: rnd() });
    }
  }
  // equatorial steering array: tilted engines that hold the planet's spin and trim its heading
  const steer = [];
  {
    const elevL = (U.elevDirsL || []).map(d => d.clone().setY(0).normalize());
    const N = Q.steer, tilt = THREE.MathUtils.degToRad(34);
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) / N * Math.PI * 2, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      if (elevL.some(e => e.dot(d) > Math.cos(THREE.MathUtils.degToRad(9)))) continue;      // keep the elevator corridors clear
      const east = new THREE.Vector3().crossVectors(Yv, d).normalize();
      const n = east.clone().multiplyScalar(Math.sin(tilt)).addScaledVector(d, Math.cos(tilt)).normalize();
      const [u, v] = dirToUv(d);
      steer.push({ dir: d, n, u, v, s: 1.7, seed: rnd() });
    }
  }
  // engine light map: R = main engines (lit only when firing), G = steering array
  const engTex = canvasTex(4096, 2048, (x, w, h) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'lighter';
    const blob = (u, v, r, a, rgb) => {
      for (const du of [-1, 0, 1]) {
        const cx = (u + du) * w, cy = (1 - v) * h; if (cx < -r * 4 || cx > w + r * 4) continue;
        const sx = 1 / Math.max(0.15, Math.sin((1 - v) * Math.PI));
        const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.12, `rgba(${rgb},${a * 0.45})`); g.addColorStop(0.4, `rgba(${rgb},${a * 0.08})`); g.addColorStop(1, `rgba(${rgb},0)`);
        x.save(); x.translate(cx, cy); x.scale(sx, 1); x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill(); x.restore();
      }
    };
    for (const e of engines) { blob(e.u, e.v, 70, 0.05, '255,0,0'); blob(e.u, e.v, 8, 0.55, '255,0,0'); }
    for (const e of hero) blob(e.u, e.v, 14, 1.0, '255,0,0');
    for (const e of steer) { blob(e.u, e.v, 26, 1.0, '0,255,0'); blob(e.u + 0.004, e.v, 30, 0.4, '0,255,0'); }
  }, false);
  engTex.wrapS = THREE.RepeatWrapping;

  const earthUniforms = {
    uDay: { value: T.day }, uNight: { value: T.night }, uSurf: { value: T.surf }, uEng: { value: engTex }, uClouds: { value: T.clouds || T.surf },
    uTexel: { value: new THREE.Vector2(1 / 4096, 1 / 2048) },
    uSun: U.uSunW, uSunI: U.uSunI, uKeyCol: U.uKeyCol, uFreeze: U.uFreeze, uPower: U.uPower, uTime: U.uTime, uThrustL, uCloud, uAmb: U.uAmb, uSteer: U.uSteer, uIgnite: U.uIgnite, uHeroL, uKey2: U.uKey2, uKey2I: U.uKey2I, uNightGain: U.uNightGain, uIgnAge: U.uIgnAge,
  };
  const earthVert = /* glsl */`
    varying vec2 vUv; varying vec3 vNw; varying vec3 vPw; varying vec3 vL;
    void main(){ vUv = uv; vL = normalize(position); vNw = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0); vPw = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
  const earth = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: earthUniforms, vertexShader: earthVert,
    fragmentShader: /* glsl */`
      uniform sampler2D uDay, uNight, uSurf, uEng, uClouds; uniform vec3 uSun, uThrustL, uAmb, uHeroL, uKey2, uKeyCol; uniform float uSunI, uFreeze, uPower, uTime, uCloud, uSteer, uIgnite, uKey2I, uNightGain, uIgnAge;
      uniform vec2 uTexel;
      varying vec2 vUv; varying vec3 vNw; varying vec3 vPw; varying vec3 vL;
      ${GLSL_NOISE}
      void main(){
        vec4 surf = texture2D(uSurf, vUv);
        float land = smoothstep(0.08, 0.3, surf.g), ocean = 1.0 - land;
        vec3 N0 = normalize(vNw), L = normalize(uSun), V = normalize(cameraPosition - vPw);
        // relief from the elevation channel (mountains catch the low sun)
        vec3 Tg = normalize(cross(vec3(0.0, 1.0, 0.0), N0) + vec3(1e-5)); vec3 Bt = cross(N0, Tg);
        float hx = (texture2D(uSurf, vUv + vec2(uTexel.x * 2.0, 0.0)).r - texture2D(uSurf, vUv - vec2(uTexel.x * 2.0, 0.0)).r) * 0.25, hy = (texture2D(uSurf, vUv + vec2(0.0, uTexel.y * 2.0)).r - texture2D(uSurf, vUv - vec2(0.0, uTexel.y * 2.0)).r) * 0.25;
        vec3 N = normalize(N0 - (Tg * hx - Bt * hy) * 3.0 * land);
        float ndl0 = dot(N0, L), ndl = max(dot(N, L), 0.0);
        vec3 albedo = texture2D(uDay, vUv).rgb;
        albedo = mix(albedo, albedo * vec3(0.55, 0.75, 1.0), ocean * 0.35);
        // the long winter creeps from the poles: snow on land keeps the relief, sea ice keeps the coastlines
        float lat = abs(vL.y), n1 = fbm(vL * 9.0);
        // the ice front: latitude and the story's freeze, made ragged only at large scale
        float fz = smoothstep(0.0, 1.0, uFreeze * 1.15 - 0.62 + pow(lat, 1.3) * 0.95 + (n1 - 0.5) * 0.3 + land * 0.12);
        // Ice and snow keep the real imagery's structure — brightened and desaturated, never replaced by procedural
        // colour or patterns: mountain ranges still read under the snow, bathymetry faintly under the sea ice.
        float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
        vec3 snow = mix(vec3(0.8, 0.84, 0.9), vec3(0.95, 0.97, 1.0), smoothstep(0.08, 0.45, lum)) * (0.88 + 0.5 * (lum - 0.25));
        vec3 seaIce = mix(vec3(0.62, 0.72, 0.84), vec3(0.86, 0.9, 0.95), smoothstep(0.0, 0.6, fz)) * (0.9 + 0.9 * (lum - 0.08));   // thin blue ice at the front, white pack behind it
        albedo = mix(albedo, mix(seaIce, snow, land), fz);
        ocean *= 1.0 - fz;
        // clouds, and their shadows a little sunward
        vec2 cuv = vUv + vec2(uCloud, 0.0);
        float cs = texture2D(uClouds, cuv).r * (1.0 - 0.25 * uFreeze);
        vec2 sh = vec2(dot(L, Tg), -dot(L, Bt)) * 0.0012;
        float cshadow = texture2D(uClouds, cuv + sh).r * (1.0 - 0.25 * uFreeze);
        vec3 sunCol = mix(vec3(1.0, 0.6, 0.38), vec3(1.0, 0.97, 0.92), smoothstep(-0.02, 0.22, ndl0)) * uKeyCol * 1.55 * uSunI;
        vec3 col = albedo * sunCol * ndl * smoothstep(-0.05, 0.05, ndl0) * (1.0 - 0.6 * cshadow);
        col += albedo * uAmb * 0.45;               // isotropic starlight/nebula fill — never tied to the camera, so the planet keeps a real terminator
        vec3 H = normalize(L + V + vec3(1e-5)); float nh = max(dot(N0, H), 0.0);
        float Fv = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
        col += sunCol * (pow(nh, 140.0) * 1.3 + pow(nh, 24.0) * 0.12) * Fv * ocean * (1.0 - cs) * smoothstep(0.0, 0.1, ndl0);   // a wind-roughened glint: broad and soft, never a pinpoint that sparkles
        col += sunCol * (pow(nh, 70.0) * 0.3 + pow(nh, 12.0) * 0.04) * (0.3 + 0.7 * Fv) * fz * smoothstep(0.0, 0.1, ndl0);   // ice sheen: a soft glint, stronger at grazing angles
        float night = 1.0 - smoothstep(-0.12, 0.06, ndl0) * clamp(uSunI * 5.0, 0.0, 1.0);    // dark is dark: a faint far Sun does not make a 'day' side
        vec3 city = texture2D(uNight, vUv).rgb;
        vec3 c2 = max(city - vec3(0.03), 0.0);
        col += c2 * c2 * vec3(1.0, 0.7, 0.42) * 1.1 * uNightGain * night * (1.0 - 0.7 * cs) * (1.0 - 0.45 * fz);   // the underground cities still glow through the ice: warm, small, sparse — readable in every chapter
        // plasma light: only the engines on the trailing hemisphere are firing
        float ang = acos(clamp(dot(vL, uHeroL), -1.0, 1.0));
        float fire = smoothstep(-0.05, 0.3, dot(vL, -uThrustL)) * uPower * (1.0 - smoothstep(uIgnite - min(0.14, 0.5 * uIgnite), uIgnite, ang));
        float flick = 0.94 + 0.06 * sin(uTime * 2.3 + vUv.x * 50.0 + vUv.y * 21.0);
        float sk = (ang - uIgnite) / 0.02;
        col += vec3(0.6, 0.85, 1.6) * exp(-sk * sk) * step(uIgnite, 3.3) * step(0.005, uIgnite) * (0.4 + 1.8 * night) * (0.35 + 0.65 * land);   // the ignition front racing across the planet
        // the first blast: a flash of plasma light floods the land and clouds around the hero array, then dies away
        { float fl = exp(-uIgnAge * 1.1) * step(0.001, uIgnAge) * exp(-ang * ang / 0.03);
          col += vec3(0.55, 0.75, 1.3) * fl * (0.25 + 0.75 * (albedo.r + albedo.g + albedo.b + cs)) * (0.4 + 1.2 * night); }
        vec2 engS = texture2D(uEng, vUv).rg;
        float eng = engS.r * fire + engS.g * uSteer;
        col += vec3(0.42, 0.66, 1.45) * eng * flick * (0.1 + 2.0 * night) * (1.0 - 0.5 * cs);
        col += vec3(0.06, 0.15, 0.45) * smoothstep(0.0, 0.5, eng) * 0.05 * (1.0 - night * 0.5);
        float mu = max(dot(N0, V), 0.0), rim = pow(1.0 - mu, 4.0);
        float litA = smoothstep(-0.2, 0.4, ndl0);
        vec3 dusk = vec3(1.0, 0.38, 0.12) * smoothstep(-0.2, 0.04, ndl0) * (1.0 - smoothstep(0.04, 0.3, ndl0));
        col = mix(col, (vec3(0.16, 0.4, 1.0) * 1.1 * litA + dusk * 0.45) * uSunI, rim * 0.18 * smoothstep(-0.3, 0.1, ndl0));
        col += vec3(0.05, 0.18, 0.6) * uPower * rim * night * 0.2 * fire;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  spin.add(earth);

  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.007, Q.earthSeg[0], Q.earthSeg[1]), new THREE.ShaderMaterial({
    uniforms: earthUniforms, vertexShader: earthVert, transparent: true, depthWrite: false,
    fragmentShader: /* glsl */`
      uniform sampler2D uClouds, uEng; uniform vec3 uSun, uThrustL, uHeroL, uKeyCol, uAmb; uniform float uSunI, uFreeze, uPower, uCloud, uSteer, uIgnite;
      varying vec2 vUv; varying vec3 vNw; varying vec3 vPw; varying vec3 vL;
      void main(){
        float d = texture2D(uClouds, vUv + vec2(uCloud, 0.0)).r;
        d = smoothstep(0.05, 0.85, d) * (1.0 - 0.25 * uFreeze);
        vec3 N = normalize(vNw), L = normalize(uSun), V = normalize(cameraPosition - vPw);
        float ndl = dot(N, L), lit = smoothstep(-0.1, 0.25, ndl);
        vec3 sunCol = mix(vec3(1.0, 0.42, 0.2), vec3(1.0, 0.98, 0.95), smoothstep(-0.02, 0.3, ndl));
        float silver = pow(max(dot(-V, L), 0.0), 8.0) * (1.0 - d) * 0.6 * smoothstep(-0.12, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.35, ndl));   // only the sunlit cloud edges at the terminator glow
        // the same isotropic starlight fill as the ground below, at cloud albedo — otherwise night-side clouds are
        // darker than the ice they cover and read as black swirls
        vec3 col = sunCol * uKeyCol * (lit * 1.05 + silver) * uSunI + 0.9 * uAmb * 0.45;
        float fire = smoothstep(-0.05, 0.3, dot(vL, -uThrustL)) * uPower * (1.0 - smoothstep(uIgnite - 0.1, uIgnite, acos(clamp(dot(vL, uHeroL), -1.0, 1.0))));
        vec2 es = texture2D(uEng, vUv).rg;
        col += vec3(0.4, 0.62, 1.4) * (es.r * fire + es.g * uSteer) * 1.2 * (1.0 - lit);
        gl_FragColor = vec4(col, d * mix(0.35, 0.95, smoothstep(0.0, 0.3, max(dot(N, V), 0.0))));
      }`,
  }));
  spin.add(clouds);
  const uEngDirW = { value: new THREE.Vector3(0, 0, -1) };
  const uHeroW = { value: new THREE.Vector3(0, 1, 0) };
  const atmo = createAtmosphere({ R, thickness: 6, uSun: U.uAtmoDir, uLight: U.uAtmoI, uPower: U.uPower, uEng: uEngDirW, uIgnite: U.uIgnite, uHeroW, steps: Q.atmoSteps, lightSteps: Q.atmoLight ?? (Q.atmoSteps > 10 ? 6 : 4) });
  tilt.add(atmo);

  // the heat-haze buffer's own scene, mirroring the planet's tilt and spin
  const hazeScene = new THREE.Scene(), hazeTilt = new THREE.Group(), hazeSpin = new THREE.Group(), uHazeAmp = { value: 0 };
  hazeTilt.rotation.z = TILT; hazeScene.add(hazeTilt); hazeTilt.add(hazeSpin);
  let massTowers = null; const uTowerFade = { value: 1 }, uHeroFade = { value: 1 }, uSteerFade = { value: 1 }, uHeroSmokeA = { value: 0.55 }, uSteerSmokeA = { value: 1 };
  // ------------------------------------------------------------------ engines: a tower under every plume
  const towerGeo = (() => {
    const parts = [];
    const lathe = (pts, seg = 32) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);
    parts.push([new THREE.CylinderGeometry(1.25, 1.45, 0.22, 6), 1]);
    parts.push([lathe([[0.0, 0.2], [1.0, 0.2], [0.86, 0.9], [0.72, 1.7], [0.7, 2.15], [0.78, 2.3], [0.62, 2.32], [0.0, 2.3]], 10), 0]);
    for (let i = 0; i < 6; i++) { const b = new THREE.BoxGeometry(0.16, 1.9, 0.3); b.translate(0.98, 1.05, 0); b.rotateZ(0.12); b.rotateY(i / 6 * Math.PI * 2); parts.push([b, 1]); }
    const ring = new THREE.TorusGeometry(0.66, 0.05, 3, 10); ring.rotateX(Math.PI / 2); ring.translate(0, 2.3, 0); parts.push([ring, 2]);
    const band = new THREE.CylinderGeometry(0.885, 0.885, 0.05, 16, 1, true); band.translate(0, 0.95, 0); parts.push([band, 2]);
    const g = new THREE.BufferGeometry();
    const merged = parts.map(([p, m]) => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); return [q, m]; });
    let count = 0; merged.forEach(([p]) => count += p.attributes.position.count);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3); let o = 0;
    merged.forEach(([p, m]) => { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); g.addGroup(o, p.attributes.position.count, m); o += p.attributes.position.count; });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return g;
  })();
  // plume shells: white-hot throat, Mach diamonds, a blue-white turbulent sheath (plasma at fusion-exhaust temperature)
  const plumeGeo = (() => { const pts = []; for (let j = 0; j <= 10; j++) { const y = Math.pow(j / 10, 1.6); pts.push(new THREE.Vector2(0.85 + 0.8 * Math.pow(y, 0.8), y)); } return new THREE.LatheGeometry(pts, 10); })();   // 200 triangles: these are only ever seen from orbit
  const uFar = { value: 0 };
  const jetMat = (intensity, steering) => new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPower: steering ? U.uSteer : U.uPower, uThrustL, uFar, uSun: U.uSunW, uIntensity: { value: intensity }, uIgnite: steering ? { value: 10 } : U.uIgnite, uHeroL, uPx: U.uPx },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uPower, uFar, uIgnite, uPx; uniform vec3 uThrustL, uSun, uHeroL;
      varying vec2 vUv; varying float vSeed; varying vec3 vN; varying vec3 vV; varying float vDist; varying float vFire; varying float vFace; varying float vDay;
      void main(){
        vUv = uv; vSeed = aSeed;
        vec3 p = position;
        vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float fire = ${steering ? '1.0' : 'smoothstep(-0.02, 0.3, dot(normalize(base), -uThrustL))'} * uPower;
        float ang = acos(clamp(dot(normalize(base), uHeroL), -1.0, 1.0)), fk = (ang - uIgnite + 0.035) / 0.03;
        fire *= (1.0 - smoothstep(uIgnite - 0.05, uIgnite, ang)) * (1.0 + 1.4 * exp(-fk * fk) * step(uIgnite, 3.3));   // ignition wave, with an overshoot as each engine lights
        vFire = fire;
        // a slow, low-frequency breathing pulse (fast flicker on a plume a few pixels wide reads as sparkling noise)
        float flick = 0.93 + 0.05 * sin(uTime * 1.3 + aSeed * 40.0) + 0.02 * sin(uTime * 2.9 + aSeed * 13.0);
        vec3 bn = normalize((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
        flick *= 0.94 + 0.06 * sin(dot(bn, vec3(9.0, 4.0, 7.0)) - uTime * 0.7);      // gentle power surges roll across the engine field
        float y = p.y;
        // each jet climbs out of its nozzle over about a second after the front passes, rather than appearing at full length
        float grow = ${steering ? '1.0' : 'smoothstep(0.0, 0.3, uIgnite - ang)'};
        p.y *= flick * max(fire, 0.001) * mix(1.0, 0.5, uFar) * mix(0.06, 1.0, grow);
        p.xz *= 1.0 + 0.13 * (1.0 - 0.7 * uFar) * (0.6 * sin(uTime * 5.0 + aSeed * 20.0 + y * 9.0) + 0.4 * sin(uTime * 8.3 + aSeed * 7.0 + y * 21.0)) * smoothstep(0.0, 0.25, y);
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(p, 1.0);
        vN = normalize(mat3(m) * normal); vV = normalize(cameraPosition - wp.xyz); vDist = length(cameraPosition - wp.xyz);
        vec3 site = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vFace = smoothstep(0.08, 0.4, dot(normalize(site), normalize(cameraPosition - site)));
        vDay = smoothstep(-0.05, 0.35, dot(normalize(site), normalize(uSun)));
        // sub-pixel plumes would only shimmer: below ~5 px they hand over to the engine light map on the surface
        float lenPx = length(mat3(m) * vec3(0.0, 1.0, 0.0)) / max(length(cameraPosition - site), 1e-3) / max(uPx, 1e-6);
        vFire *= smoothstep(2.0, 6.0, lenPx);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uIntensity, uFar;
      varying vec2 vUv; varying float vSeed; varying vec3 vN; varying vec3 vV; varying float vDist; varying float vFire; varying float vFace; varying float vDay;
      ${GLSL_NOISE}
      void main(){
        if (vFire < 0.003) discard;
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float along = vUv.y, a = vUv.x * 6.2831853;
        float tt = uTime * mix(1.0, 0.3, uFar);                     // seen from orbit the turbulence slows to a calm churn
        vec3 q = vec3(cos(a) * 1.6, sin(a) * 1.6, along * 10.0 - tt * 7.0 + vSeed * 9.0);
        float turb = vnoise(q) * 0.55 + vnoise(q * 2.7 - vec3(0.0, 0.0, tt * 4.0)) * 0.3 + vnoise(q * 6.1 - vec3(0.0, 0.0, tt * 9.0)) * 0.15 * (1.0 - uFar);
        float edge = smoothstep(0.08, 0.62, ndv + (turb - 0.5) * 0.5);
        float core = ndv * ndv * ndv * ndv * ndv, body = ndv * ndv;
        float fade = exp(-along * 2.0) * smoothstep(0.0, 0.07, along) * (1.0 - smoothstep(0.7, 1.0, along));
        float sd = 0.5 + 0.5 * sin(along * 55.0 - tt * 20.0 + vSeed * 10.0); sd *= sd; sd *= sd;
        float diamonds = sd * sd * exp(-along * 9.0) * core;
        float hot = exp(-along * 14.0) * smoothstep(0.0, 0.01, along);
        vec3 col = mix(vec3(0.3, 0.32, 1.0), vec3(0.45, 0.72, 1.0), body);
        col = mix(col, vec3(0.94, 0.97, 1.0), clamp(core * 1.3 * exp(-along * 4.0) + hot * 0.7, 0.0, 1.0));
        float i = (core * 2.3 + body * 0.5) * fade * edge * (0.45 + 0.95 * turb) + diamonds * 2.0 + hot * core * edge * 1.2 * smoothstep(0.0, 0.05, along);
        col = mix(col, vec3(0.4, 0.62, 1.0), uFar);
        i *= smoothstep(0.6, 4.0, vDist) * mix(1.0, vFace, uFar) * mix(1.0, 0.35, vDay) * min(vFire, 1.2);
        gl_FragColor = vec4(col * i * 2.1 * uIntensity * mix(1.0, 0.18, uFar), 1.0);
      }`,
  });
  {
    const fadeMat = m => { const c = m.clone(); c.onBeforeCompile = (sh, r) => { m.onBeforeCompile && m.onBeforeCompile(sh, r); sh.uniforms.uTF = uTowerFade; sh.vertexShader = 'uniform float uTF;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y *= uTF; transformed.xz *= mix(0.4, 1.0, uTF);'); }; const k = m.customProgramCacheKey.bind(m); c.customProgramCacheKey = () => k() + '|tf'; return c; };
    const n = engines.length, towers = new THREE.InstancedMesh(towerGeo, [fadeMat(M.hull), fadeMat(M.dark), fadeMat(M.glow)], n), jets = new THREE.InstancedMesh(plumeGeo, jetMat(1.1, false), n);
    const seeds = new Float32Array(n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), sv = new THREE.Vector3();
    engines.forEach((e, i) => {
      q.setFromUnitVectors(Yv, e.dir); qy.setFromAxisAngle(Yv, e.seed * 6.28); q.multiply(qy);
      m.compose(e.dir.clone().multiplyScalar(R - 0.04), q, sv.setScalar(e.s)); towers.setMatrixAt(i, m);
      m.compose(e.dir.clone().multiplyScalar(R - 0.04 + 2.3 * e.s), q, sv.set(0.42 * e.s, (10 + e.seed * 9) * e.s, 0.42 * e.s)); jets.setMatrixAt(i, m);
      seeds[i] = e.seed;
    });
    plumeGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    towers.frustumCulled = jets.frustumCulled = false; jets.renderOrder = 3;
    spin.add(towers, jets); massTowers = towers;
  }
  // nozzle sparks: read as a field of blue stars from orbit
  {
    const n = engines.length + hero.length, p = new Float32Array(n * 3), a = new Float32Array(n * 2);
    [...engines, ...hero].forEach((e, i) => { p.set([e.dir.x * 100.4, e.dir.y * 100.4, e.dir.z * 100.4], i * 3); a.set([e.seed, e.s ? 2.2 : 1], i * 2); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(a, 2));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uPower: U.uPower, uThrustL, uSunL, uPxR: U.uPxR }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec2 aS; uniform float uTime, uPower, uPxR; uniform vec3 uThrustL, uSunL; varying vec3 vC; varying float vK;
        void main(){
          vec3 n = normalize(position);
          float fire = smoothstep(-0.02, 0.3, dot(n, -uThrustL)) * uPower;
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          vec3 wn = normalize(mat3(modelMatrix) * n), wp = (modelMatrix * vec4(position, 1.0)).xyz;
          float facing = smoothstep(-0.05, 0.25, dot(wn, normalize(cameraPosition - wp)));
          float d = -mv.z;
          float s = clamp(aS.y * 700.0 / d, 1.2, 6.0);
          gl_PointSize = s * uPxR; vK = 3.0;
          float day = smoothstep(-0.08, 0.25, dot(n, normalize(uSunL)));
          vC = vec3(0.6, 0.82, 1.6) * 0.55 * fire * facing * aS.y * (1.0 - 0.8 * day) * (0.9 + 0.1 * sin(uTime * 1.3 + aS.x * 50.0)) * clamp(150.0 / d, 0.0, 1.6) * (1.0 - smoothstep(250.0, 700.0, d));
        }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    pts.frustumCulled = false; pts.renderOrder = 3; spin.add(pts);
  }


  // ------------------------------------------------------------------ hero array: towers + ray-marched plumes
  const heroGroup = new THREE.Group(); spin.add(heroGroup);
  let heroVol = null, steerVol = null, heroSmoke = null, steerSmoke = null, shock = null, steerShells = null;
  const steerGimbal = [];
  {
    const towers = towerSet(hero.length);
    const vol = createVolumetricPlumes(hero.length, { uTime: U.uTime, uPower: U.uPower, uIgnite: U.uIgnite, uHero: uHeroL, uIntensity: { value: 0.55 }, uFade: uHeroFade, decay: 2.2, uSteps: U.uVolSteps }, Q.volSteps);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion();
    hero.forEach((e, i) => {
      q.setFromUnitVectors(Yv, e.dir); qy.setFromAxisAngle(Yv, e.seed * 6.28); q.multiply(qy);
      m.compose(e.dir.clone().multiplyScalar(R - 0.05), q, new THREE.Vector3().setScalar(e.s)); towers.setMatrixAt(i, m);
      m.compose(e.dir.clone().multiplyScalar(R - 0.05 + 2.3 * e.s), q, new THREE.Vector3(3.6 * e.s, 46 * e.s, 3.6 * e.s)); vol.setMatrixAt(i, m);
    });
    heroGroup.add(...towers.meshes, vol); heroVol = vol;
    // heat haze: soft, slowly churning screen-space offsets drawn around each plume base into a separate
    // buffer (see post.js DistortPass). Low-frequency noise only, so it shimmers like hot air, never like grain.
    const dm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.5, 1, 24, 1, true).translate(0, 0.5, 0), new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uAmp: uHazeAmp }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vP; varying float vF; void main(){ vP = position; mat4 m = modelViewMatrix * instanceMatrix; vec4 mv = m * vec4(position, 1.0);
        vF = abs(dot(normalize(mat3(m) * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime, uAmp; varying vec3 vP; varying float vF;
        ${GLSL_NOISE}
        void main(){ vec3 q = vec3(vP.xz * 2.2, vP.y * 3.0 - uTime * 0.9);
          vec2 n = vec2(vnoise(q), vnoise(q + 7.3)) - 0.5;
          float a = vF * vF * smoothstep(0.0, 0.12, vP.y) * (1.0 - smoothstep(0.45, 1.0, vP.y)) * uAmp;
          gl_FragColor = vec4(n * a, 0.0, 1.0); }`,
    }), hero.length);
    hero.forEach((e, i) => {
      q.setFromUnitVectors(Yv, e.dir); m.compose(e.dir.clone().multiplyScalar(R - 0.05 + 2.3 * e.s), q, new THREE.Vector3(5 * e.s, 18 * e.s, 5 * e.s)); dm.setMatrixAt(i, m);
    });
    dm.frustumCulled = false; hazeSpin.add(dm);
    // exhaust clouds rolling out of the flame trenches, steam boiling up the outside of each plume
    const em = [];
    for (const e of hero) {
      em.push({ pos: e.dir.clone().multiplyScalar(R + 0.05), up: e.dir, axis: e.dir, s: e.s * 1.5, kind: 0 });
      em.push({ pos: e.dir.clone().multiplyScalar(R - 0.05 + 2.3 * e.s), up: e.dir, axis: e.dir, s: e.s * 1.2, kind: 1, len: 30 * e.s, rad: 2.6 * e.s });
    }
    heroSmoke = createSmoke(em, { uTime: U.uTime, uIgnite: U.uIgnite, uHero: uHeroL, uAge: U.uIgnAge, uSun: U.uSunW, uLight: U.uSunI, uPower: U.uPower, uOpacity: uHeroSmokeA }, { perEmitter: Q.volSteps > 15 ? [18, 12] : [10, 6], speed: 0.1, seed: 3 });
    heroSmoke.frustumCulled = false; heroGroup.add(heroSmoke);
    engineLight.position.copy(heroDir).multiplyScalar(R + 8);
    shock = createShockwave({ uSun: U.uSunW, uLight: U.uSunI, uTime: U.uTime }); spin.add(shock);
  }
  // ------------------------------------------------------------------ equatorial steering array
  {
    const n = steer.length;
    const base = new THREE.InstancedMesh(new THREE.CylinderGeometry(4.4, 5.2, 1.4, 6), instancedVariant(M.dark), n);
    const towers = towerSet(n);
    const sGeo = plumeGeo.clone(); sGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(n).map(() => rnd()), 1));
    const shells = new THREE.InstancedMesh(sGeo, jetMat(0.6, true), n);
    const vol = createVolumetricPlumes(n, { uTime: U.uTime, uPower: U.uSteer, uIgnite: { value: 10 }, uHero: { value: new THREE.Vector3(1, 0, 0) }, uIntensity: { value: 0.42 }, uFade: uSteerFade, decay: 4.2, uSteps: U.uVolSteps }, Q.volSteps);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), sv = new THREE.Vector3();
    steer.forEach((e, i) => {
      q.setFromUnitVectors(Yv, e.dir); m.compose(e.dir.clone().multiplyScalar(R - 0.45), q, sv.set(1, 1, 1)); base.setMatrixAt(i, m);
      q.setFromUnitVectors(Yv, e.n); qy.setFromAxisAngle(Yv, i * 0.7); q.multiply(qy);
      m.compose(e.dir.clone().multiplyScalar(R - 0.2), q, sv.setScalar(e.s)); towers.setMatrixAt(i, m);
      const nozzle = e.dir.clone().multiplyScalar(R - 0.2).addScaledVector(e.n, 2.3 * e.s);
      m.compose(nozzle, q, sv.set(1.5, 40, 1.5)); shells.setMatrixAt(i, m);
      m.compose(nozzle, q, sv.set(3.4, 50, 3.4)); vol.setMatrixAt(i, m);
      steerGimbal.push({ nozzle, q: q.clone(), axis: new THREE.Vector3().crossVectors(e.n, e.dir).normalize(), i });
    });
    for (const o of [base, shells, vol]) o.frustumCulled = false;
    shells.renderOrder = 3;
    spin.add(base, ...towers.meshes, shells, vol); steerVol = vol; steerShells = shells;
    steerSmoke = createSmoke(steer.map(e => ({ pos: e.dir.clone().multiplyScalar(R + 0.3), up: e.dir, axis: e.dir, s: 1.2, kind: 0 })), { uTime: U.uTime, uIgnite: { value: 10 }, uHero: { value: new THREE.Vector3(1, 0, 0) }, uSun: U.uSunW, uLight: U.uSunI, uPower: U.uSteer, uOpacity: uSteerSmokeA }, { perEmitter: [Q.volSteps > 15 ? 16 : 8, 0], speed: 0.09, seed: 5 });
    steerSmoke.frustumCulled = false; spin.add(steerSmoke);
  }
  { const e0 = (U.elevDirsL || [new THREE.Vector3(1, 0, 0)])[0]; let best = steer[0];
    for (const e of steer) if (e.dir.dot(e0) > best.dir.dot(e0)) best = e;          // the tower nearest the first elevator
    world.steerDir = best ? best.dir.clone() : new THREE.Vector3(1, 0, 0); }

  // ------------------------------------------------------------------ space elevators + geostationary ring
  const GEO = 660, TOP = 790;
  const bandE = windowTex(512, 16, 1, 96, 0.75, 41); bandE.wrapS = THREE.RepeatWrapping; bandE.repeat.set(3, 1);
  const ringBandE = new THREE.MeshBasicMaterial({ map: bandE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.5, 1.3, 1.0) });
  const elevators = [];
  // a sleeve of lit haze where each tether rises through the atmosphere (sunlit side brighter)
  const hazeGeo = new THREE.CylinderGeometry(3.2, 4.2, 6.4, 32, 1, true);
  const hazeMat = new THREE.ShaderMaterial({
    uniforms: { uSun: U.uSunW, uSunI: U.uSunI }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vY; varying float vF; varying vec3 vN; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uSun; uniform float uSunI; varying float vY; varying float vF; varying vec3 vN;
      void main(){ float a = (1.0 - vY) * (1.0 - vY) * vF * vF * (0.35 + 0.65 * max(dot(vN, normalize(uSun)), 0.0));
        gl_FragColor = vec4(vec3(0.45, 0.65, 1.0) * a * 0.06 * (0.2 + uSunI), 1.0); }`,
  });
  const elevDirs = (U.elevDirsL || [0, 2.1, 4.2].map(a => new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))).map(d => d.clone().setY(0).normalize());
  // three braided cables around a mag-lev rail; pulses of light race up the rail
  const tether = new THREE.CylinderGeometry(0.1, 0.1, TOP - R, 8, 160, true); tether.translate(0, (TOP - R) / 2 + R, 0);   // segmented so the cable can hum
  const tetherMat = mk({ color: 0x6f7883, metalness: 0.85, roughness: 0.4, envMapIntensity: 1.0 });
  {   // the cable hums: a small travelling wave, damped towards the anchors (millimetres at film scale, but it lives)
    const prev = tetherMat.onBeforeCompile, key = tetherMat.customProgramCacheKey.bind(tetherMat);
    tetherMat.onBeforeCompile = (sh, r) => { prev(sh, r); sh.uniforms.uTime = U.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { float y = position.y, env = sin(clamp((y - ${R.toFixed(1)}) / ${(TOP - R).toFixed(1)}, 0.0, 1.0) * 3.14159);
        vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        env *= 1.0 - smoothstep(15.0, 45.0, distance(wp0, cameraPosition));   // only where it is resolved: a sub-pixel wobble would read as shimmer
        transformed.x += sin(y * 0.31 - uTime * 2.2) * 0.03 * env; transformed.z += cos(y * 0.23 - uTime * 1.7) * 0.03 * env; }`); };
    tetherMat.customProgramCacheKey = () => key() + '|hum';
  }
  const tetherLineMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying float vD; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vD; void main(){ gl_FragColor = vec4(vec3(0.45, 0.75, 1.4) * 0.45 * smoothstep(60.0, 260.0, vD), 1.0); }`,
  });
  const railGeo = new THREE.CylinderGeometry(0.07, 0.07, TOP - R, 6, 120, true); railGeo.translate(0, (TOP - R) / 2 + R, 0);
  const railMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying float vH; varying float vD; void main(){ vH = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; varying float vH; varying float vD;
      void main(){ float p = fract(vH / 46.0 - uTime * 0.9); float pulse = pow(p, 14.0) * 1.6 + pow(fract(vH / 9.0 - uTime * 2.3), 30.0) * 0.35;
        gl_FragColor = vec4(vec3(0.35, 0.7, 1.6) * (0.08 + pulse) * smoothstep(3.0, 25.0, vD) * (1.0 - 0.8 * smoothstep(300.0, 1500.0, vD)), 1.0); }`,
  });
  const CLIMB = Q.climbers;
  const climbKit = climberKit(M, rnd);
  const climbers = [...climbKit.body.instanced(elevDirs.length * CLIMB), ...climbKit.lights.instanced(elevDirs.length * CLIMB), ...climbKit.beams.instanced(elevDirs.length * CLIMB)];
  climbers.forEach(m => { if (m.material === M.beam) m.renderOrder = 3; });
  // the truss: one bay every 4 units up each tether; bays shrink away beyond ~150 units so distant lattice never shimmers
  const BAY = 4, bayY = []; for (let y = R + 14; y < TOP - 4; y += BAY) bayY.push(y);
  const bayFade = m => { const c = m.clone(); c.onBeforeCompile = (sh, r) => { m.onBeforeCompile && m.onBeforeCompile(sh, r); sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 ipw = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); transformed *= 1.0 - smoothstep(60.0, 150.0, distance(ipw.xyz, cameraPosition)); }`); }; const k = m.customProgramCacheKey.bind(m); c.customProgramCacheKey = () => k() + '|bay'; return c; };
  const bayMats = new Map(); const bayKit = trussBayKit({ dark: M.dark, metal: M.metal }, BAY);
  const truss = bayKit.geometries().map(p => { if (!bayMats.has(p.material)) bayMats.set(p.material, bayFade(p.material)); const m = new THREE.InstancedMesh(p.geometry, bayMats.get(p.material), elevDirs.length * bayY.length); m.frustumCulled = false; return m; });
  const wayKit = waystationKit(M, rnd), wayGeo = [...wayKit.body.geometries(), ...wayKit.lights.geometries()];
  const beaconPos = [], climbState = [];
  elevDirs.forEach((d, k) => {
    const g = new THREE.Group(); g.quaternion.setFromUnitVectors(Yv, d); spin.add(g);
    for (let c = 0; c < 3; c++) { const m = new THREE.Mesh(tether, tetherMat); const a = c / 3 * Math.PI * 2; m.position.set(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25); g.add(m); }
    const rail = new THREE.Mesh(railGeo, railMat); rail.renderOrder = 3; g.add(rail);
    const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, R, 0), new THREE.Vector3(0, TOP, 0)]), tetherLineMat); guide.frustumCulled = false; g.add(guide);   // reads as a lit thread from afar
    // ground anchor: a tapered spire on a stepped platform, ringed with lights
    const spire = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [7.5, 0], [7.2, 0.8], [5.2, 1.0], [4.8, 2.2], [3.0, 2.6], [2.0, 6], [1.4, 11], [1.6, 11.6], [0, 11.8]].map(([x, y]) => new THREE.Vector2(x, y)), 24), M.hull);
    spire.position.y = R - 0.2; g.add(spire);
    for (const [y, r] of [[R + 1.0, 5.25], [R + 2.4, 3.1], [R + 6.0, 2.05], [R + 9.5, 1.55]]) { const l = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 4, 48), y < R + 3 ? M.warm : M.glow); l.rotation.x = Math.PI / 2; l.position.y = y; g.add(l); }
    { const hz = new THREE.Mesh(hazeGeo, hazeMat); hz.position.y = R + 3.2; hz.renderOrder = 4; g.add(hz); }
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), M.dark); b.position.set(Math.cos(a) * 2.6, R + 4.5, Math.sin(a) * 2.6); b.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18); g.add(b); }
    // waystations at a third and two thirds of the way up
    for (const y of [R + (GEO - R) * 0.33, R + (GEO - R) * 0.66]) for (const p of wayGeo) { const w = new THREE.Mesh(p.geometry, p.material); w.position.y = y; w.rotation.y = k * 0.7; g.add(w); }
    g.updateMatrix();
    bayY.forEach((y, j) => { const m4 = new THREE.Matrix4().makeTranslation(0, y, 0).premultiply(g.matrix); for (const t of truss) t.setMatrixAt(k * bayY.length + j, m4); });
    // counterweight: a captured asteroid
    const cw = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 2), mk({ color: 0x5b5753, roughness: 0.95, metalness: 0.05, flatShading: true })); cw.position.y = TOP + 6; g.add(cw);
    for (let i = 0; i < 70; i++) beaconPos.push(d.x, d.y, d.z, R + 6 + i * (TOP - R - 6) / 70);
    for (let i = 0; i < CLIMB; i++) climbState.push(k === 0 && i === 0 ? { k, d, h0: 0.012 - 12 * 0.0085, up: true, speed: 0.0085, hero: true } : { k, d, h0: rnd(), up: i % 2 === 0, speed: 0.010 + rnd() * 0.008 });
    elevators.push({ dir: d, group: g });
  });
  spin.add(...climbers, ...truss);
  const ctrail = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.05, 1, 8, 1, true).translate(0, -0.5, 0), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vY; varying float vD; void main(){ vY = position.y; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vY; varying float vD; void main(){ gl_FragColor = vec4(vec3(0.4, 0.75, 1.6) * (1.0 + vY) * (1.0 + vY) * 0.3 * smoothstep(4.0, 30.0, vD), 1.0); }`,
  }), elevDirs.length * CLIMB);
  ctrail.frustumCulled = false; ctrail.renderOrder = 3; spin.add(ctrail);
  // beacons racing up the cables
  {
    const n = beaconPos.length / 4, p = new Float32Array(n * 3), h = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = beaconPos[i * 4 + 3]; p.set([beaconPos[i * 4] * r, beaconPos[i * 4 + 1] * r, beaconPos[i * 4 + 2] * r], i * 3); h[i] = r; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
    const b = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uPxR: U.uPxR }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute float aH; uniform float uTime, uPxR; varying vec3 vC; varying float vK;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float pulse = pow(fract(aH / 120.0 - uTime * 0.35), 10.0);
          gl_PointSize = clamp(260.0 / -mv.z, 1.5, 7.0) * uPxR * (1.0 + pulse); vK = 3.5;
          vC = mix(vec3(1.4, 0.35, 0.2) * 0.5, vec3(0.6, 0.9, 2.2), pulse) * clamp(220.0 / -mv.z, 0.3, 1.5); }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    b.frustumCulled = false; spin.add(b);
  }
  // the geostationary ring: 4,200 km wide hoop of habitats and docks, turning with the planet
  const ringWin = windowTex(1024, 64, 8, 256, 0.42, 21); ringWin.wrapS = ringWin.wrapT = THREE.RepeatWrapping; ringWin.repeat.set(60, 1);
  const ringMapT = pTex.clone(); ringMapT.repeat.set(220, 1); ringMapT.needsUpdate = true;
  const ringMat = mk({ color: 0xc6ccd4, map: ringMapT, metalness: 0.15, roughness: 0.5, emissive: 0xffffff, emissiveMap: ringWin, emissiveIntensity: 1.4, envMapIntensity: 1.2 }, ['metal_plate_02', 1.6, 0.7]);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(GEO, 1.5, 10, Q.ringSeg), ringMat); ring.rotation.x = Math.PI / 2; spin.add(ring);
  {   // truss lattice and solar wings along the hoop
    const n = Q.ringSeg / 4 | 0, seg = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 7.2, 0.22), instancedVariant(M.dark), n * 2), arr = new THREE.InstancedMesh(new THREE.BoxGeometry(5.5, 0.08, 2.2), instancedVariant(M.panel), n / 3 | 0);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler();
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; for (const k of [0, 1]) { e4.set(0, -a, (k ? 0.5 : -0.5)); q4.setFromEuler(e4); m4.compose(new THREE.Vector3(Math.cos(a) * (GEO + (k ? 1.8 : -1.8)), 0, Math.sin(a) * (GEO + (k ? 1.8 : -1.8))), q4, new THREE.Vector3(1, 1, 1)); seg.setMatrixAt(i * 2 + k, m4); } }
    for (let i = 0; i < (n / 3 | 0); i++) { const a = (i + 0.5) / (n / 3) * Math.PI * 2; e4.set(0, -a, 0); q4.setFromEuler(e4); m4.compose(new THREE.Vector3(Math.cos(a) * (GEO + 5.5), 0.6, Math.sin(a) * (GEO + 5.5)), q4, new THREE.Vector3(1, 1, 1)); arr.setMatrixAt(i, m4); }
    seg.frustumCulled = arr.frustumCulled = false; spin.add(seg, arr);
  }
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(GEO, 0.45, 6, Q.ringSeg), M.dark); ring2.rotation.x = Math.PI / 2; ring2.position.y = 3.2; spin.add(ring2);
  const ring3 = ring2.clone(); ring3.position.y = -3.2; spin.add(ring3);
  // hub stations on the ring (one at every elevator, three in between)
  const hubs = [];
  const hubWheels = [], hubWings = [];
  const hubProto = (() => {
    const g = new THREE.Group(), hk = hubKit(M, rnd);
    for (const p of [...hk.body.geometries(), ...hk.lights.geometries()]) g.add(new THREE.Mesh(p.geometry, p.material));
    const wheel = new THREE.Group(); for (const p of hk.wheel.geometries()) wheel.add(new THREE.Mesh(p.geometry, p.material)); wheel.name = 'wheel'; g.add(wheel);
    const wings = new THREE.Group(); for (const p of hk.wings.geometries()) wings.add(new THREE.Mesh(p.geometry, p.material)); wings.name = 'wings'; g.add(wings);
    return g;
  })();
  for (let i = 0; i < 6; i++) {
    const d = i < 3 ? elevDirs[i] : elevDirs[i - 3].clone().applyAxisAngle(Yv, Math.PI / 3);
    const h = hubProto.clone(); h.position.copy(d).multiplyScalar(GEO); h.lookAt(0, 0, 0); h.rotateY(Math.PI / 2); spin.add(h); hubs.push(h); hubWheels.push(h.getObjectByName('wheel')); hubWings.push(h.getObjectByName('wings'));
  }

  // ------------------------------------------------------------------ orbital traffic: satellites, ships, escort fleet
  {
    const n = Q.sats, p = new Float32Array(n * 3), o = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const r = 103 + Math.pow(rnd(), 2) * 60; p.set([r, 0, 0], i * 3); o.set([rnd() * 6.28, (rnd() - 0.5) * 2.2, rnd() * 6.28, 0.04 + 0.6 / Math.pow(r / 100, 1.5) * 0.08], i * 4); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aO', new THREE.BufferAttribute(o, 4));
    const sats = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uSun: U.uSunW, uPxR: U.uPxR, uSunI: U.uSunI }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute vec4 aO; uniform float uTime, uPxR, uSunI; uniform vec3 uSun; varying vec3 vC; varying float vK;
        vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
        vec3 rotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
        void main(){ vec3 p = rotY(rotX(rotY(position, aO.x + uTime * aO.w * 3.0), aO.y), aO.z);
          vec4 wp = modelMatrix * vec4(p, 1.0); vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
          vec3 oc = wp.xyz; float b = dot(oc, uSun); float d = sqrt(max(dot(oc, oc) - b * b, 0.0));
          float lit = b > 0.0 ? 1.0 : smoothstep(98.0, 102.0, d);
          // slow attitude roll: once per turn the solar panels catch the Sun — a brief flare that sweeps the swarm
          float roll = uTime * (0.12 + 0.25 * fract(aO.x * 7.13)) + aO.z * 5.0, glint = pow(max(sin(roll), 0.0), 80.0) * 3.0 * lit;
          float led = step(0.955, fract(uTime * 0.7 + aO.x * 3.1));                  // a short status strobe, not a slow blink
          gl_PointSize = clamp(180.0 / -mv.z, 1.0, 3.0) * (1.0 + 0.6 * min(glint, 1.0)) * uPxR; vK = 2.5;
          vC = (vec3(1.0, 0.95, 0.85) * lit * uSunI * 0.5 * (1.0 + glint) + vec3(1.0, 0.25, 0.15) * 0.22 * led) * clamp(90.0 / -mv.z, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
    }));
    sats.frustumCulled = false; tilt.add(sats);
  }
  // small craft
  const shipGeo = (() => {
    const hull = new THREE.CylinderGeometry(0.1, 0.32, 1.8, 6); hull.rotateX(Math.PI / 2);
    const wing = new THREE.BoxGeometry(1.4, 0.06, 0.5); wing.translate(0, 0, -0.4);
    const pod = new THREE.BoxGeometry(0.34, 0.34, 0.5); pod.translate(0, 0, -0.95);
    const parts = [hull, wing, pod].map(g => g.toNonIndexed());
    const g = new THREE.BufferGeometry(); let n = 0; parts.forEach(p => n += p.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    parts.forEach(p => { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return g;
  })();
  const NS = Q.ships;
  const ships = new THREE.InstancedMesh(shipGeo, instancedVariant(M.hull), NS); ships.frustumCulled = false; scene.add(ships);
  const shipGlowPos = new Float32Array(NS * 3), shipGlowA = new Float32Array(NS);
  const sgg = new THREE.BufferGeometry(); sgg.setAttribute('position', new THREE.BufferAttribute(shipGlowPos, 3)); sgg.setAttribute('aA', new THREE.BufferAttribute(shipGlowA, 1));
  const shipGlow = new THREE.Points(sgg, new THREE.ShaderMaterial({
    uniforms: { uPxR: U.uPxR }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aA; uniform float uPxR; varying vec3 vC; varying float vK;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(90.0 / -mv.z, 1.6, 6.0) * uPxR; vK = 3.0; vC = vec3(0.5, 0.8, 2.0) * aA * clamp(200.0 / -mv.z, 0.35, 1.4); }`,
    fragmentShader: `varying vec3 vC; varying float vK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vC * exp(-d * d * vK), 1.0); }`,
  }));
  shipGlow.frustumCulled = false; scene.add(shipGlow);
  const trailPos = new Float32Array(NS * 6), trailA = new Float32Array(NS * 2);
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); tg.setAttribute('aA', new THREE.BufferAttribute(trailA, 1));
  const trails = new THREE.LineSegments(tg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.35, 0.65, 1.5) * vA * 0.6, 1.0); }`,
  }));
  trails.frustumCulled = false; scene.add(trails);
  const lanes = [];
  for (let i = 0; i < NS; i++) lanes.push({ kind: i % 3, hub: i % 6, slot: i % 10, ph: rnd(), sp: 0.03 + rnd() * 0.04, off: new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(6) });

  // escort carriers flying in formation ahead of the planet (sister ships of the flagship, below)
  const fleet = [];
  const fleetSlots = [[0, 0, 0], [-40, 12, -30], [40, -10, -34], [-80, -18, -70], [78, 20, -76], [0, 34, -60], [-24, -36, -110], [30, 2, -130]];
  fleetSlots.forEach(s => fleet.push({ obj: null, slot: new THREE.Vector3(...s), ph: rnd() * 6 }));

  // ------------------------------------------------------------------ the flagship: a 2,000 km Navigator-class carrier
  const flagship = new THREE.Group(); scene.add(flagship);
  const flagSpin = [];
  {
    const fk = flagshipKit(M, rnd);
    for (const p of [...fk.body.geometries(), ...fk.lights.geometries(), ...fk.glow.geometries()]) flagship.add(new THREE.Mesh(p.geometry, p.material));
    fk.rings.forEach((rk, i) => { const g = new THREE.Group(); g.position.z = rk.userData.z; g.name = 'hab' + i; for (const p of rk.geometries()) g.add(new THREE.Mesh(p.geometry, p.material)); flagship.add(g); flagSpin.push([g, i ? -1 : 1]); });
    // drive plumes: a white-hot core, shock diamonds and a long violet-blue sheath
    const jm = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying float vF; varying float vEnd; varying float vDist; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz)));
        vEnd = abs(dot(normalize(mat3(modelViewMatrix) * vec3(0.0, 0.0, 1.0)), normalize(-mv.xyz))); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vF; varying float vEnd; varying float vDist;
        void main(){ float y = 1.0 - vUv.y;
          float core = pow(vF, 6.0), body = vF * vF;
          float sd = 0.5 + 0.5 * sin(y * 70.0 - uTime * 30.0); sd = sd * sd * sd * sd * exp(-y * 6.0) * core;
          float a = (core * 2.0 * exp(-y * 5.0) + body * 0.6 * exp(-y * 2.2) + sd * 1.6) * smoothstep(0.0, 0.02, y) * (1.0 - smoothstep(0.75, 1.0, y)) * (0.9 + 0.1 * sin(uTime * 41.0 + y * 13.0));
          vec3 c = mix(vec3(0.3, 0.42, 1.5), vec3(1.6, 1.8, 2.2), clamp(core * exp(-y * 3.0) * 1.4, 0.0, 1.0));
          gl_FragColor = vec4(min(c * a * 0.8 * mix(1.0, 0.1, smoothstep(0.5, 0.95, vEnd)) * clamp(70.0 / vDist, 0.06, 1.0), vec3(3.0)), 1.0); }`,     // seen end-on, a plume is a modest glow, not a sun
    });
    const plumeG = new THREE.CylinderGeometry(1.05, 0.25, 30, 20, 1, true); plumeG.rotateX(Math.PI / 2);
    const pk = new Kit(); for (let e = 0; e < 6; e++) { const a = e / 6 * Math.PI * 2; pk.add(plumeG, jm, [Math.cos(a) * 2.4, Math.sin(a) * 1.8, -25.3 - 15]); }
    const jets = pk.build().children[0]; jets.renderOrder = 3; jets.position.z = 25.3;
    const jp = new THREE.Group(); jp.position.z = -25.3; jp.name = 'jets'; jp.add(jets); flagship.add(jp);   // gimbal pivot at the nozzle plane      // six plumes, one draw
  }

  // the escort carriers are smaller sister ships of the flagship
  fleet.forEach((f, k) => { const c = flagship.clone(); c.scale.setScalar(k === 0 ? 0.55 : 0.32 + (k % 3) * 0.05); scene.add(c); f.obj = c; f.jets = c.getObjectByName('jets'); flagSpin.push([c.getObjectByName('hab0'), 1], [c.getObjectByName('hab1'), -1]); });

  // a squadron that sweeps past the lens (scripted relative to the camera, so it always reads)
  const squad = [];
  // each fighter of the squadron draws a long ion trail, so the fly-past reads as speed
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying float vY; varying float vF; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; varying float vY; varying float vF; void main(){ float a = vY * vY * vY * vF * vF * (0.85 + 0.15 * sin(vY * 60.0 - uTime * 40.0)); gl_FragColor = vec4(vec3(0.35, 0.6, 1.5) * a * 0.9, 1.0); }`,
  });
  const trailG = new THREE.CylinderGeometry(2.6, 0.2, 260, 12, 1, true); trailG.rotateX(Math.PI / 2); trailG.translate(0, 0, -25.3 - 130);
  for (let k = 0; k < 5; k++) { const c = flagship.clone(); c.scale.setScalar(0.15 + (k % 2) * 0.04); c.visible = false; const tr = new THREE.Mesh(trailG, trailMat); tr.renderOrder = 3; c.add(tr); scene.add(c); squad.push({ obj: c, o: new THREE.Vector3((k - 2) * 7 + (k % 2) * 3, (k % 3) * 3 - 3, -k * 14) }); }
  const sqF = new THREE.Vector3(), sqR = new THREE.Vector3(), sqU = new THREE.Vector3();

  // ------------------------------------------------------------------ satellites: real spacecraft models on visible orbits
  const birds = [];
  for (let i = 0; i < 10; i++) {
    const m = (i % 3 === 0 ? flat.iss : flat.hubble); if (!m) continue;
    const o = m.clone(); o.scale.setScalar(i % 3 === 0 ? 5.5 : 2.4); tilt.add(o);
    birds.push({ o, r: 112 + rnd() * 45, inc: (rnd() - 0.5) * 1.6, node: rnd() * 6.28, ph: rnd() * 6.28, w: 0.05 + rnd() * 0.04 });
  }

  // ------------------------------------------------------------------ the new sun (chapter 6): α Centauri A rising over the limb
  const newSun = new THREE.Group(); newSun.visible = false; scene.add(newSun);
  {
    const disc = new THREE.Mesh(new THREE.SphereGeometry(48, 48, 32), new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime },
      vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vP; void main(){ vP = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vW; varying vec3 vP;
        ${GLSL_NOISE}
        void main(){ float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
          float g = 0.85 + 0.15 * snoise(vP * 40.0 + uTime * 0.1);
          vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.92, 0.78), pow(mu, 0.5)) * (0.5 + 0.5 * pow(mu, 0.5)) * g;
          gl_FragColor = vec4(c * 40.0, 1.0); }`,
    }));
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uA: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uA; void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);
        float rays = 0.55 + 0.45 * pow(abs(sin(a * 6.0)), 8.0);
        vec3 c = vec3(1.0, 0.8, 0.55) * (exp(-r * 9.0) * 1.6 + exp(-r * 3.2) * 0.25 * rays) * (1.0 - smoothstep(0.85, 1.0, r));
        gl_FragColor = vec4(c * uA, 1.0); }`,
    }));
    halo.scale.setScalar(1400); halo.renderOrder = 6;
    newSun.add(disc, halo); newSun.userData.halo = halo;
  }

  // ------------------------------------------------------------------ the Moon, escorted out with the planet
  const moon = new THREE.Mesh(new THREE.SphereGeometry(27, 96, 64), new THREE.ShaderMaterial({
    uniforms: { uMap: { value: T.moon || null }, uSun: U.uSunW, uSunI: U.uSunI },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uSun; uniform float uSunI; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 a = ${T.moon ? 'texture2D(uMap, vUv).rgb' : 'vec3(0.5)'}; vec3 N = normalize(vN);
        float l = max(dot(N, normalize(uSun)), 0.0);
        float es = max(dot(N, normalize(-vW)), 0.0) * 0.02;                                  // earthshine on the night side
        gl_FragColor = vec4(a * (vec3(1.0, 0.97, 0.92) * l * 1.5 * uSunI + vec3(0.4, 0.55, 0.9) * es), 1.0); }`,
  }));
  scene.add(moon);

  // ------------------------------------------------------------------ deep-space observatory (chapter 4)
  const observatory = new THREE.Group(); scene.add(observatory);
  {
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(26, 1.6, 12, 128), ringMat); observatory.add(r1);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(19, 0.5, 8, 96), M.gold); observatory.add(r2);
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.6, 50, 0.6), M.dark); s.rotation.z = i * Math.PI / 6; observatory.add(s); }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(14, 48, 16, 0, Math.PI * 2, 0, 0.75), mk({ color: 0xe8ecf0, metalness: 0.8, roughness: 0.18, side: THREE.DoubleSide })); dish.rotation.x = -Math.PI / 2; dish.position.z = 6; observatory.add(dish);
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 14, 8), M.dark); feed.rotation.x = Math.PI / 2; feed.position.z = 4; observatory.add(feed);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 12, 24), M.hull); core.rotation.x = Math.PI / 2; core.position.z = -4; observatory.add(core);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(60, 0.3, 10), M.panel); p.position.set(s * 0, s * 30, -4); p.rotation.z = Math.PI / 2; observatory.add(p); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), M.warm); lamp.position.set(0, 27.6, 0); observatory.add(lamp);
  }

  // ------------------------------------------------------------------ the plasma wake seen from afar
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1).translate(0, 0.5, 0), new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPower: U.uPower, uAxis: { value: new THREE.Vector3() }, uLen: { value: 1500 }, uW: { value: 260 }, uVis: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`uniform vec3 uAxis; uniform float uLen, uW; varying vec2 vQ;
      void main(){ vec3 a = normalize(uAxis), toC = normalize(cameraPosition);
        vec3 s = cross(a, toC); s = length(s) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(s);
        vec3 wp = a * position.y * uLen + s * position.x * uW * (0.45 + 1.2 * position.y);
        vQ = vec2(position.x * 2.0, position.y); gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime, uPower, uVis; varying vec2 vQ;
      ${GLSL_NOISE}
      void main(){ float x = vQ.x, y = vQ.y; float n = vnoise(vec3(x * 3.0, y * 6.0 - uTime * 0.6, 1.0));
        float a = exp(-x * x * (4.0 + 6.0 * y)) * (1.0 - smoothstep(0.1, 1.0, y)) * smoothstep(0.0, 0.08, y) * (0.6 + 0.4 * n);
        gl_FragColor = vec4(mix(vec3(0.45, 0.68, 1.4), vec3(0.3, 0.32, 0.9), y) * a * 0.3 * uPower * uVis, 1.0); }`,
  }));
  wake.frustumCulled = false; wake.renderOrder = 2; scene.add(wake);

  // ------------------------------------------------------------------ interstellar effects: bow shock, aurora, dust, ice shards
  const bow = (() => {
    const pts = []; for (let i = 0; i <= 40; i++) { const r = i / 40 * 520; pts.push(new THREE.Vector2(r, 260 - r * r / 900)); }
    const g = new THREE.LatheGeometry(pts, 96);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uVis: U.uShock }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`uniform float uTime, uVis; varying vec3 vP; varying vec3 vN; varying vec3 vW;
        ${GLSL_NOISE}
        void main(){ if (uVis < 0.002) discard; vec3 V = normalize(cameraPosition - vW); float ndv = abs(dot(normalize(vN), V));
          float f = pow(1.0 - ndv, 3.0);                                         // only the limb of the shock glows: no face-on pattern
          float r = length(vP.xz) / 520.0;
          float n = fbm(vW * 0.012 + vec3(0.0, 0.0, uTime * 0.25));               // turbulence advected through the shell, not radial streaks
          float a = f * (0.45 + 0.9 * n * n) * (1.0 - smoothstep(0.5, 1.0, r)) * smoothstep(0.0, 0.2, r + 0.05);
          vec3 c = mix(vec3(0.3, 0.75, 1.0), vec3(0.4, 0.5, 1.0), smoothstep(0.1, 0.7, r));
          gl_FragColor = vec4(c * a * uVis * 0.6, 1.0); }`,
    }));
    m.frustumCulled = false; m.renderOrder = 4; scene.add(m); return m;
  })();
  const aurora = (() => {
    const g = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uVis: U.uAurora }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uTime, uVis; varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){ float x = vUv.x * 60.0, y = vUv.y;
          float rays = pow(vnoise(vec3(x, 0.0, uTime * 0.4)), 3.0) * 1.6 + 0.2;
          float band = smoothstep(0.0, 0.15, y) * (1.0 - smoothstep(0.35, 1.0, y)) * (0.4 + 0.6 * vnoise(vec3(x * 0.2, y * 3.0, uTime * 0.2)));
          vec3 c = mix(vec3(0.2, 1.0, 0.45), vec3(0.25, 0.55, 1.0), smoothstep(0.2, 0.8, y));   // green curtains fading to cold blue: no magenta
          gl_FragColor = vec4(c * rays * band * uVis * 0.9, 1.0); }`,
    });
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(s > 0 ? 30 : 37, s > 0 ? 37 : 30, 10, 160, 1, true), mat);
      c.position.y = s * 93; g.add(c);
    }
    g.renderOrder = 4; tilt.add(g); return g;
  })();
  const dust = (() => {
    const n = Q.dust, p = new Float32Array(n * 2 * 3), e = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const x = rnd(), y = rnd(), z = rnd(); p.set([x, y, z, x, y, z], i * 6); e.set([0, 1], i * 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aE', new THREE.BufferAttribute(e, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFlow: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, 1) }, uCam: { value: new THREE.Vector3() }, uBox: { value: 900 }, uLen: { value: 30 }, uVis: U.uDust, uKey: U.uSunI },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute float aE; uniform vec3 uFlow, uCam, uDir; uniform float uBox, uLen; varying float vA;
        void main(){ vec3 p = mod(position * uBox - uCam + uFlow, uBox) - uBox * 0.5;     // camera-centred wrap-around box
          float d = length(p); vec3 fd = uDir;
          vec3 w = uCam + p - fd * uLen * aE * (0.4 + 0.6 * fract(position.x * 37.0));
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          vA = (1.0 - aE) * smoothstep(uBox * 0.5, uBox * 0.15, d) * smoothstep(6.0, 40.0, d); }`,
      fragmentShader: `uniform float uVis, uKey; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * vA * uVis * 0.14 * min(uKey, 1.0), 1.0); }`,   // dust lit by the key star: as bright on screen in every chapter
    });
    const l = new THREE.LineSegments(g, mat); l.frustumCulled = false; scene.add(l); return l;
  })();
  const shards = (() => {
    const base = new THREE.IcosahedronGeometry(1, 3), pa = base.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); const k = 1 + 0.35 * (Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7) * Math.sin(v.z * 3.7 + 0.4)) + 0.15 * Math.sin(v.x * 9 + v.z * 7); pa.setXYZ(i, v.x * k, v.y * k * 0.8, v.z * k); }
    base.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(base, mk({ color: 0xaebccc, roughness: 0.75, metalness: 0.05, emissive: 0x0a1428, emissiveIntensity: 0.4, flatShading: false }), Q.shards);
    mesh.frustumCulled = false; scene.add(mesh);
    const st = []; for (let i = 0; i < Q.shards; i++) st.push({ p: new THREE.Vector3(rnd(), rnd(), rnd()), s: 0.6 + Math.pow(rnd(), 3) * 14, q: new THREE.Quaternion().random(), w: new THREE.Vector3(gauss(), gauss(), gauss()).normalize(), ws: 0.05 + rnd() * 0.3 });
    return { mesh, st };
  })();

  // ------------------------------------------------------------------ per-frame
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = new THREE.Vector3();
  const invSpin = new THREE.Quaternion();
  let flow = new THREE.Vector3(), flowAcc = new THREE.Vector3();

  const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), XAX = new THREE.Vector3(1, 0, 0);
  const VA = new THREE.Vector3(), VB = new THREE.Vector3(), VC = new THREE.Vector3(), VP = new THREE.Vector3(), VD = new THREE.Vector3(), ZV = new THREE.Vector3(0, 0, 1);
  const hubW = hubs.map(() => new THREE.Vector3()), UP = new THREE.Vector3(), LEAD = new THREE.Vector3(), tmpQb = new THREE.Quaternion();
  function climberH(c, t) {         // three legs (surface → waystation → waystation → ring), each eased, with a dwell at every stop
    const f = (((c.h0 + t * c.speed) % 1) + 1) % 1, leg = Math.floor(f * 3), u = Math.min(1, (f * 3 - leg) / 0.82), e = u * u * u * (u * (u * 6 - 15) + 10);
    const h = (leg + e) / 3; return c.up ? h : 1 - h;
  }
  let shadowParked = false;
  const qq2 = new THREE.Quaternion(), tmp3 = new THREE.Vector3(), ELEV = ['elev0', 'elev1', 'elev2'], ELEVN = ['elevN0', 'elevN1', 'elevN2'];
  function update(t, dt, S, cam) {
    spin.rotation.y = SPIN0 + t * SPIN_RATE;
    uCloud.value = t * 0.0016 + U.uTime.value * 0.00025;
    scene.updateMatrixWorld();
    spin.getWorldQuaternion(invSpin).invert();
    uThrustL.value.copy(S.thrust).applyQuaternion(invSpin).normalize();
    uEngDirW.value.copy(S.thrust).negate().normalize();
    const KD = S.keyDir || S.sunDir, KI = S.keyI ?? S.sunI;
    uSunL.value.copy(KD).applyQuaternion(invSpin);
    sun.intensity = 3.2 * KI; if (S.keyCol) sun.color.setRGB(1, 0.94, 0.86).multiply(S.keyCol);
    {   // fit the shadow box to the subject; park it far away (and stop re-rendering it) when there is none
      const focus = S.focusL0 && S.focusL0.lengthSq() < 4e8 ? S.focusL0 : cam.position;
      {   // earthshine + space fill, relative to the key: the planet's apparent size and phase from the subject
        const dE = Math.max(focus.length(), R), sin2 = (R / dE) ** 2, lit = 0.5 * (1 + tmp.copy(focus).divideScalar(dE).dot(KD));
        // over the night hemisphere the planet still shines: ten thousand engines light it blue from below
        const engGlow = 0.6 * (1 - lit) * (S.power ?? 1) * Math.min(1, U.uIgnite.value / 1.5);
        const es = (0.3 + 0.7 * Math.sqrt(sin2)) * (0.15 + 0.85 * lit + engGlow), kI = 3.2 * KI;
        fill.position.copy(focus).multiplyScalar(-1 / dE);
        fill.color.setRGB(0.55, 0.7, 1.0).multiplyScalar(0.06 + 0.1 * es);   // cool earthshine
        fill.groundColor.setRGB(0.45, 0.55, 0.8).multiplyScalar(0.055);
        fill.intensity = kI;
      }
      const fd = cam.position.distanceTo(focus), want = fd < 170 && KI > 0.05 && Q.shadowMap > 0;
      const sc = sun.shadow.camera;
      if (want) {
        const r = 6 * Math.pow(1.25, Math.ceil(Math.log(Math.max(fd * 0.6 + 5, 6) / 6) / Math.log(1.25)));   // stepped size: texels don't breathe
        const texel = 2 * r / sun.shadow.mapSize.x;
        qq.setFromRotationMatrix(mtx.lookAt(KD, tmp.set(0, 0, 0), Yv)); const qi = qq2.copy(qq).invert();      // the shadow camera's own axes
        tmp2.copy(focus).applyQuaternion(qi); tmp2.x = Math.round(tmp2.x / texel) * texel; tmp2.y = Math.round(tmp2.y / texel) * texel; tmp2.applyQuaternion(qq);   // texel-snapped centre
        sun.target.position.copy(tmp2); sun.position.copy(tmp2).addScaledVector(KD, 4 * r);
        sc.left = sc.bottom = -r; sc.right = sc.top = r; sc.near = 0.5; sc.far = 8 * r;
        sun.shadow.normalBias = texel * 1.5; sc.updateProjectionMatrix();
        // the shadow map re-renders every Q.shadowEvery frames (and whenever the fitted box steps): hardware moves slowly
        sun.shadow.autoUpdate = false; shadowParked = false;
        if (++shadowTick >= (S.shadowEvery || Q.shadowEvery || 1) || sc.userData.r !== r) { shadowTick = 0; sun.shadow.needsUpdate = true; } sc.userData.r = r;
      } else if (!shadowParked) {
        sun.target.position.set(1e6, 1e6, 1e6); sun.position.copy(sun.target.position).addScaledVector(KD, 10);
        sc.left = sc.bottom = -1; sc.right = sc.top = 1; sc.near = 0.5; sc.far = 20; sc.updateProjectionMatrix();
        sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true; shadowParked = true;
      }
      sun.target.updateMatrixWorld();
      if (env) env.update(focus, KD, KI, S.power * (S.steer ?? 1), performance.now());
    }
    engineLight.updateMatrixWorld(); engineLight.getWorldPosition(uEngP.value);
    uEngC.value.copy(engineCol).multiplyScalar(9000 * S.power * (S.heroLight ?? 1) * Math.min(1, U.uIgnite.value / 0.12));
    if (shock) shock.set(tmp3.copy(heroDir).multiplyScalar(R), heroDir, S.shockP ?? 0, 24);
    // steering array: the nozzles gimbal together in slow, eased swings that roll round the equator as a wave
    // (they are trimming the planet's spin), so the exhaust visibly changes direction
    if (steerShells && steerGimbal.length) {
      for (const g of steerGimbal) {
        const r = Math.sin(t * 0.16 - g.i * 0.11), sw = r * (1.5 - 0.5 * r * r) * 0.16 * (S.steer ?? 1);   // flattened sine: dwells at each end
        qq.setFromAxisAngle(g.axis, sw).multiply(g.q);
        mtx.compose(g.nozzle, qq, sv.set(1.5, 40, 1.5)); steerShells.setMatrixAt(g.i, mtx);
        mtx.compose(g.nozzle, qq, sv.set(3.4, 50, 3.4)); steerVol.setMatrixAt(g.i, mtx);
      }
      steerShells.instanceMatrix.needsUpdate = true; steerVol.instanceMatrix.needsUpdate = true;
    }
    // climbers
    let i = 0;
    for (const c of climbState) {
      const h = c.hero && S.climbH != null ? S.climbH : climberH(c, t), r = R + 4 + h * (GEO - R - 8);
      qq.setFromUnitVectors(Yv, c.d); mtx.compose(tmp.copy(c.d).multiplyScalar(r), qq, sv.set(1, 1, 1)); for (const m of climbers) m.setMatrixAt(i, mtx);
      if (!c.up) qq.multiply(FLIP);
      mtx.compose(tmp.copy(c.d).multiplyScalar(r - (c.up ? 1.9 : -1.9)), qq, sv.set(1, 22 + 30 * c.speed / 0.018, 1)); ctrail.setMatrixAt(i, mtx); i++;
    }
    for (const m of climbers) m.instanceMatrix.needsUpdate = true; ctrail.instanceMatrix.needsUpdate = true;
    // anchors
    // world anchors: persistent vectors, rewritten in place every frame (no per-frame garbage)
    const WV = k => world[k] || (world[k] = new THREE.Vector3());
    WV('hero').copy(heroDir).multiplyScalar(R).applyMatrix4(spin.matrixWorld);
    WV('heroN').copy(heroDir).transformDirection(spin.matrixWorld); uHeroW.value.copy(world.heroN);
    for (let k = 0; k < elevators.length; k++) { const e = elevators[k]; WV(ELEV[k]).copy(e.dir).multiplyScalar(R).applyMatrix4(spin.matrixWorld); WV(ELEVN[k]).copy(e.dir).transformDirection(spin.matrixWorld); }
    const c0 = climbState[0]; WV('climber').copy(c0.d).multiplyScalar(R + 4 + (S.climbH != null ? S.climbH : climberH(c0, t)) * (GEO - R - 8)).applyMatrix4(spin.matrixWorld);
    hubs[0].getWorldPosition(WV('hub0'));
    WV('steer').copy(world.steerDir).multiplyScalar(R).applyMatrix4(spin.matrixWorld);
    WV('steerN').copy(world.steerDir).transformDirection(spin.matrixWorld);
    uFar.value = THREE.MathUtils.smoothstep(cam.position.length(), 260, 900);
    const cd = cam.position.length();
    // level of detail by smooth fades, never by switching objects on and off
    const ss = THREE.MathUtils.smoothstep;
    uTowerFade.value = 1 - ss(cd, 135, 200); if (massTowers) massTowers.visible = uTowerFade.value > 0.002;
    const dh = cam.position.distanceTo(world.hero);
    uHeroFade.value = 1 - ss(dh, 600, 900); if (heroVol) heroVol.visible = uHeroFade.value > 0.002;
    hazeSpin.rotation.y = spin.rotation.y;
    uHazeAmp.value = (1 - ss(dh, 60, 220)) * S.power * Math.min(1, U.uIgnite.value / 0.12) * (S.heroLight ?? 1);   // only where the plumes are big on screen
    uSteerFade.value = 1 - ss(cd, 380, 560); if (steerVol) steerVol.visible = uSteerFade.value > 0.002;
    uHeroSmokeA.value = 0.55 * (1 - ss(dh, 110, 210)); if (heroSmoke) heroSmoke.visible = uHeroSmokeA.value > 0.002;      // exhaust clouds only read up close; from orbit they would print as rings
    uSteerSmokeA.value = 1 - ss(cd, 240, 360); if (steerSmoke) steerSmoke.visible = uSteerSmokeA.value > 0.002;
    // fleet formation, ahead of the planet
    const f = S.thrust, s = tmp2.crossVectors(f, Yv).normalize(), u = UP.crossVectors(s, f);
    LEAD.copy(f).multiplyScalar(420).addScaledVector(u, 60);
    for (const c of fleet) {
      c.obj.position.copy(LEAD).addScaledVector(s, c.slot.x).addScaledVector(u, c.slot.y + Math.sin(t * 0.4 + c.ph) * 1.5).addScaledVector(f, c.slot.z);
      c.obj.lookAt(tmp.copy(c.obj.position).add(f).addScaledVector(s, Math.cos(t * 0.21 + c.ph) * 0.06));
      c.obj.rotateZ(Math.sin(t * 0.21 + c.ph) * 0.12);                       // banks into its slow weave
      if (c.jets) c.jets.rotation.y = Math.cos(t * 0.21 + c.ph) * 0.07;          // and the exhaust gimbals with the turn
    }
    WV('fleet').copy(fleet[0].obj.position);
    flagship.position.copy(f).multiplyScalar(170).addScaledVector(s, 240).addScaledVector(u, 40).addScaledVector(u, Math.sin(t * 0.3) * 2);
    flagship.lookAt(tmp3.copy(flagship.position).add(f)); flagship.rotateZ(0.12 + Math.sin(t * 0.17) * 0.05);
    for (const [g, d] of flagSpin) g.rotation.z = t * 0.25 * d;
    for (let k = 0; k < hubWheels.length; k++) hubWheels[k].rotation.z = t * 0.12 + k;
    for (let k = 0; k < hubWings.length; k++) {      // solar wings track the key light in slow, eased steps, so their sheen sweeps across the cells
      const u = t * 0.05 + k * 0.37, step = Math.floor(u), f = u - step, e = f * f * (3 - 2 * f);
      hubWings[k].rotation.y = (step + e) * 0.6 + k;
    }
    WV('flagship').copy(flagship.position);
    { const a = 2.4 + t * 0.012; moon.position.set(Math.cos(a) * 3800, Math.sin(a) * 600, Math.sin(a) * 3800); moon.rotation.y = -a; WV('moon').copy(moon.position); }
    // small craft lanes: hubs ↔ fleet, surface ↔ ring (scratch vectors only: no garbage per frame)
    for (let k = 0; k < hubs.length; k++) hubs[k].getWorldPosition(hubW[k]);
    i = 0;
    for (const L of lanes) {
      const ph = (L.ph + t * L.sp) % 1;
      if (L.kind === 0) { VA.copy(hubW[L.hub]); VB.copy(fleet[L.slot % fleet.length].obj.position); VC.copy(VA).lerp(VB, 0.5).addScaledVector(u, 120); }
      else if (L.kind === 1) { VB.copy(hubW[L.hub]); VA.copy(fleet[L.slot % fleet.length].obj.position); VC.copy(VA).lerp(VB, 0.5).addScaledVector(u, -90); }
      else { VA.copy(world['elev' + (L.hub % 3)]).multiplyScalar(1.05); VB.copy(hubW[L.hub % 3]); VC.copy(VA).lerp(VB, 0.5).addScaledVector(s, 60); }
      const q1 = 1 - ph;
      VP.copy(VA).multiplyScalar(q1 * q1).addScaledVector(VC, 2 * q1 * ph).addScaledVector(VB, ph * ph).add(L.off);
      VD.copy(VC).sub(VA).multiplyScalar(2 * q1).addScaledVector(tmp.copy(VB).sub(VC), 2 * ph).normalize();
      qq.setFromUnitVectors(ZV, VD).multiply(tmpQb.setFromAxisAngle(ZV, Math.sin(ph * Math.PI) * 0.7 * (L.kind === 1 ? -1 : 1)));   // bank through the turn
      const vis = Math.min(1, ph * 12, (1 - ph) * 12);
      mtx.compose(VP, qq, sv.setScalar(Math.max(vis, 0.001) * 1.4)); ships.setMatrixAt(i, mtx);
      tmp.copy(VP).addScaledVector(VD, -1.4);
      shipGlowPos[i * 3] = tmp.x; shipGlowPos[i * 3 + 1] = tmp.y; shipGlowPos[i * 3 + 2] = tmp.z; shipGlowA[i] = vis;
      trailPos[i * 6] = tmp.x; trailPos[i * 6 + 1] = tmp.y; trailPos[i * 6 + 2] = tmp.z;
      tmp.addScaledVector(VD, -(10 + 14 * L.sp / 0.07));
      trailPos[i * 6 + 3] = tmp.x; trailPos[i * 6 + 4] = tmp.y; trailPos[i * 6 + 5] = tmp.z; trailA[i * 2] = vis; trailA[i * 2 + 1] = 0; i++;
    }
    ships.instanceMatrix.needsUpdate = true; sgg.attributes.position.needsUpdate = true; sgg.attributes.aA.needsUpdate = true;
    tg.attributes.position.needsUpdate = true; tg.attributes.aA.needsUpdate = true;
    // observatory: holds station off the leading limb, dish on the destination
    observatory.position.copy(f).multiplyScalar(250).addScaledVector(s, -150).addScaledVector(u, 70);
    observatory.lookAt(tmp3.copy(observatory.position).add(S.destDir || f));
    observatory.rotateZ(t * 0.05);
    WV('observatory').copy(observatory.position);
    // wake + bow shock orientation
    wake.material.uniforms.uAxis.value.copy(f).negate();
    const camD = cam.position.length();
    wake.material.uniforms.uVis.value = THREE.MathUtils.smoothstep(camD, 500, 2500) * (S.wake ?? 1);
    bow.quaternion.setFromUnitVectors(Yv, f); bow.visible = U.uShock.value > 0.002;
    aurora.visible = U.uAurora.value > 0.002;
    // the new sun sits far out along its direction; it rises over the limb as the camera climbs
    newSun.visible = (S.newSun ?? 0) > 0.01;
    if (newSun.visible) { newSun.position.copy(S.newSunDir).multiplyScalar(5200); newSun.userData.halo.quaternion.copy(cam.quaternion); newSun.userData.halo.material.uniforms.uA.value = S.newSun; }
    for (const b of birds) {   // satellites circling the planet
      const a = b.ph + t * b.w;
      b.o.position.set(Math.cos(a) * b.r, 0, Math.sin(a) * b.r).applyAxisAngle(XAX, b.inc).applyAxisAngle(Yv, b.node);
      b.o.rotation.set(b.inc, -a + b.node, 0.3);
    }
    // squadron fly-past
    {
      const p = S.squad ?? -1, on = p > 0 && p < 1;
      if (on) {
        sqF.set(0, 0, -1).applyQuaternion(cam.quaternion); sqR.set(1, 0, 0).applyQuaternion(cam.quaternion); sqU.set(0, 1, 0).applyQuaternion(cam.quaternion);
        const e = p * p * (3 - 2 * p), z = -20 + 300 * e;                      // from behind the camera to far ahead
        for (const q of squad) {
          q.obj.visible = true;
          q.obj.position.copy(cam.position).addScaledVector(sqF, z + q.o.z).addScaledVector(sqR, 6 + q.o.x * 1.2 - 4 * e).addScaledVector(sqU, -3.5 + q.o.y * 1.1 + 3 * e);
          q.obj.lookAt(tmp.copy(q.obj.position).add(sqF)); q.obj.rotateZ(0.4 - 0.5 * e);
        }
      } else for (const q of squad) q.obj.visible = false;
    }
    // dust streaks flow past at the voyage speed
    dust.visible = U.uDust.value > 0.002;
    if (dust.visible) {
      flowAcc.addScaledVector(f, -dt * (S.dustSpeed ?? 260));
      dust.material.uniforms.uFlow.value.copy(flowAcc); dust.material.uniforms.uDir.value.copy(f).negate(); dust.material.uniforms.uCam.value.copy(cam.position);
      dust.material.uniforms.uLen.value = 5 + (S.dustSpeed ?? 260) * 0.06;
    }
    // Kuiper ice shards drifting through the camera's neighbourhood
    shards.mesh.visible = (S.shards ?? 0) > 0.002;
    if (shards.mesh.visible) {
      const B = 700, k = S.shards;
      flow.addScaledVector(f, -dt * 22);
      shards.st.forEach((r, j) => {
        tmp.copy(r.p).multiplyScalar(B).add(flow).sub(cam.position);
        tmp.set(((tmp.x % B) + B) % B - B / 2, ((tmp.y % B) + B) % B - B / 2, ((tmp.z % B) + B) % B - B / 2);
        const d = tmp.length(); tmp.add(cam.position);
        if (tmp.length() < R * 1.25) tmp.multiplyScalar(R * 1.25 / tmp.length());
        qq.setFromAxisAngle(r.w, t * r.ws).multiply(r.q);
        const sc = r.s * k * THREE.MathUtils.smoothstep(B / 2 - d, 0, 120);
        mtx.compose(tmp, qq, sv.setScalar(Math.max(sc, 1e-3))); shards.mesh.setMatrixAt(j, mtx);
      });
      shards.mesh.instanceMatrix.needsUpdate = true;
    }
    heroGroup.visible = true;
  }

  scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.material && !Array.isArray(o.material) && o.material.isMeshStandardMaterial && o !== massTowers) { o.castShadow = true; o.receiveShadow = true; } });
  if (massTowers) { massTowers.castShadow = false; massTowers.receiveShadow = true; }
  return {
    scene, update, world, tilt, spin, heroDir, elevDirs, R, GEO, fleet, flagship, squad, haze: { scene: hazeScene, amp: uHazeAmp },
    setShadowSize(n) {            // live quality change: a new map size (0 = parked, no shadow renders at all)
      if (n > 0 && n !== sun.shadow.mapSize.x) { if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(n, n); }
      shadowParked = false;
    },
    heroes: () => ({ flagship, fleet: fleet.map(f => f.obj).filter(Boolean), hubs, observatory, climbers }),   // for the lighting audit
  };
}
