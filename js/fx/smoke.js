// Exhaust smoke: lit, alpha-blended billboard puffs — the part of a launch that makes the fire feel
// physical. Two emitter kinds:
//   kind 0  ground clouds that billow out of the flame trenches and roll across the ground;
//   kind 1  a steam sheath that boils up around the lower part of a plume.
// Each puff is lit by the Sun (a sphere-shaped fake normal, so clouds have a lit side, a terminator
// and a dark core) and from inside by the plasma plume it sits next to.
// Puffs only appear once the ignition wave (uIgnite around uHero) has reached their engine.
import * as THREE from 'three';

const NOISE = /* glsl */`
  float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }`;

/**
 * @param {Array<{pos:THREE.Vector3, up:THREE.Vector3, axis:THREE.Vector3, s:number, kind:number, len?:number, rad?:number}>} emitters
 *        positions/directions in the parent's (earth-local) space
 * @param {object} u  uniforms: uTime, uIgnite, uHero, uSun (world), uLight; optional uPower, uOpacity
 * @param {object} opt  { perEmitter: [ground, column], glow: THREE.Color, speed }
 */
export function createSmoke(emitters, u, opt = {}) {
  const per = opt.perEmitter || [36, 24];
  let n = 0; for (const e of emitters) n += per[e.kind];
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = new THREE.PlaneGeometry(1, 1).index;
  geo.setAttribute('position', new THREE.PlaneGeometry(1, 1).getAttribute('position'));
  geo.setAttribute('uv', new THREE.PlaneGeometry(1, 1).getAttribute('uv'));
  const aPos = new Float32Array(n * 3), aUp = new Float32Array(n * 3), aAxis = new Float32Array(n * 3), aSeed = new Float32Array(n * 4), aP = new Float32Array(n * 4);
  let k = 0;
  const r = mulberry(opt.seed || 9);
  for (const e of emitters) {
    for (let i = 0; i < per[e.kind]; i++, k++) {
      aPos.set([e.pos.x, e.pos.y, e.pos.z], k * 3); aUp.set([e.up.x, e.up.y, e.up.z], k * 3); aAxis.set([e.axis.x, e.axis.y, e.axis.z], k * 3);
      aSeed.set([(i + r()) / per[e.kind], r(), r(), r()], k * 4);
      aP.set([e.s, e.kind, e.len || 10 * e.s, e.rad || e.s], k * 4);
    }
  }
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aUp', new THREE.InstancedBufferAttribute(aUp, 3));
  geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(aAxis, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
  geo.instanceCount = n;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.uTime, uIgnite: u.uIgnite, uHero: u.uHero, uSun: u.uSun, uLight: u.uLight,
      uPower: u.uPower || { value: 1 }, uOpacity: u.uOpacity || { value: 1 },
      uGlow: { value: (opt.glow || new THREE.Color(0.38, 0.6, 1.0)) }, uSpeed: { value: opt.speed || 0.05 }, uAge: u.uAge || { value: 1e4 },
    },
    transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute vec3 aPos, aUp, aAxis; attribute vec4 aSeed, aP;
      uniform float uTime, uIgnite, uSpeed, uAge; uniform vec3 uHero;
      varying vec2 vQ; varying vec4 vS; varying float vA; varying float vLife; varying float vGlow; varying vec3 vC; varying float vKind;
      void main(){
        float s = aP.x, kind = aP.y, len = aP.z, rad = aP.w;
        float spd = uSpeed * (0.75 + 0.5 * aSeed.y), life = fract(uTime * spd + aSeed.w);
        float born = step(life / spd, uAge);                                  // only puffs emitted since ignition
        vec3 up = normalize(aUp), ax = normalize(aAxis);
        vec3 t1 = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(ax, t1);
        float a = aSeed.x * 6.2831853 + aSeed.z * 0.6;
        vec3 c; float size, glow;
        if (kind < 0.5) {
          // ground cloud: rolls outward from the trenches, puffs up and thickens as it goes
          vec3 g1 = normalize(cross(up, t1 + vec3(1e-4))), g2 = cross(up, g1);
          vec3 radial = g1 * cos(a) + g2 * sin(a);
          float d = s * (0.5 + 3.4 * pow(life, 0.5) * (0.6 + 0.4 * aSeed.z));
          size = s * (0.55 + 1.9 * pow(life, 0.6)) * (0.7 + 0.6 * aSeed.y);
          c = aPos + radial * d + up * (size * 0.22 + s * 0.35 * life * life * aSeed.y);
          glow = exp(-life * 5.0) * 0.9;
        } else {
          // steam sheath: rides up the outside of the jet, expanding and slowing
          vec3 radial = t1 * cos(a) + t2 * sin(a);
          float y = len * (0.01 + 0.16 * pow(life, 0.8));               // only the base of the jet: higher up it is clean fire
          float jr = rad * (0.6 + 0.9 * pow(y / len, 0.75));
          size = rad * (0.7 + 1.5 * life) * (0.7 + 0.6 * aSeed.y);
          c = aPos + ax * y + radial * jr * (0.9 + 0.4 * aSeed.z);
          glow = exp(-life * 3.0) * 1.2;
        }
        vec3 base = (aPos);
        float ang = acos(clamp(dot(normalize(base), uHero), -1.0, 1.0));
        float ig = 1.0 - smoothstep(uIgnite - 0.04, uIgnite, ang);
        vec4 wc = modelMatrix * vec4(c, 1.0);
        vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float rot = aSeed.z * 6.2831853 + life * (aSeed.y - 0.5) * 1.5;
        vec2 q = position.xy; q = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
        vec3 wp = wc.xyz + (camR * q.x + camU * q.y) * size;
        float camD = length(cameraPosition - wc.xyz);
        vA = ig * born * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.45, 1.0, life)) * smoothstep(size * 0.6, size * 1.8, camD) * (1.0 - smoothstep(45.0, 90.0, camD));   // a close-range effect: from orbit, billboards read as cotton
        vQ = position.xy * 2.0; vS = aSeed; vLife = life; vGlow = glow; vC = wc.xyz; vKind = kind;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        if (vA < 0.002) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);   // clipped: never rasterised
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uGlow; uniform float uLight, uPower, uOpacity, uTime;
      varying vec2 vQ; varying vec4 vS; varying float vA; varying float vLife; varying float vGlow; varying vec3 vC; varying float vKind;
      ${NOISE}
      void main(){
        float r = length(vQ);
        if (r > 1.0) discard;
        vec3 p = vec3(vQ * 1.7 + vS.xy * 37.0, vLife * 1.3 + vS.z * 11.0);
        float n = vn(p) * 0.5 + vn(p * 2.1 + 3.1) * 0.3 + vn(p * 4.7 + 7.3) * 0.2;
        // eroded by the noise: cauliflower billows with ragged, see-through edges, never a soft ball
        float dens = clamp((n * 1.25 - r * r * 0.95 - 0.12) * 2.4, 0.0, 1.0);
        float a = clamp(dens * vA * uOpacity * mix(0.75, 0.45, vKind), 0.0, 1.0);
        if (a < 0.003) discard;
        // fake spherical normal in view space → world
        vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 camF = normalize(cameraPosition - vC);
        float z = sqrt(max(1.0 - r * r, 0.0));
        vec3 N = normalize(camR * vQ.x + camU * vQ.y + camF * (z + 0.3) + (n - 0.5) * 0.6 * (camR + camU));
        vec3 L = normalize(uSun);
        float day = smoothstep(-0.08, 0.12, dot(normalize(vC), L));        // the planet's own terminator
        float wrap = clamp(dot(N, L) * 0.6 + 0.4, 0.0, 1.0);
        float fwd = pow(clamp(dot(-camF, L), 0.0, 1.0), 6.0) * (1.0 - dens) * 2.5;   // silver lining when back-lit
        vec3 sunCol = mix(vec3(1.0, 0.5, 0.25), vec3(1.0, 0.95, 0.88), smoothstep(0.0, 0.3, dot(normalize(vC), L)));
        vec3 albedo = mix(vec3(0.42, 0.4, 0.38), vec3(0.62, 0.64, 0.68), vKind);   // dust-grey ground cloud, paler steam
        float self = mix(0.45, 1.0, smoothstep(0.0, 0.7, 1.0 - dens * (1.0 - r)));   // thick cores self-shadow
        vec3 col = albedo * (sunCol * uLight * 1.2 * (wrap + fwd) * day * self + vec3(0.025, 0.035, 0.06));
        // lit from inside by the plasma: strongest at the hot, young core of the puff
        col += uGlow * vGlow * uPower * (0.2 + (1.0 - r) * 0.9) * (0.5 + 0.7 * (1.0 - n));
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 2;
  return mesh;
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
