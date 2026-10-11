// Volumetric plasma plumes: each instance is a proxy cylinder; the fragment shader ray-marches the
// emission of a turbulent, expanding jet inside it (white-hot core, Mach diamonds near the throat, a
// blue → violet cooling sheath and churning noise that streams away from the nozzle).
// Additive emission only — a hot, optically thin gas — so instances blend in any order.
import * as THREE from 'three';

const NOISE = /* glsl */`
  float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }`;

/**
 * @param {number} count
 * @param {object} u  shared uniforms: uTime, uPower, uIgnite, uHero (ignition wave), plus own uIntensity
 * @param {number} steps ray-march steps (quality)
 */
export function createVolumetricPlumes(count, u, steps = 28) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, false); geo.translate(0, 0.5, 0);
  const seeds = new Float32Array(count); for (let i = 0; i < count; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSteps: u.uSteps || { value: steps }, uTime: u.uTime, uPower: u.uPower, uIgnite: u.uIgnite, uHero: u.uHero, uIntensity: u.uIntensity || { value: 1 }, uFade: u.uFade || { value: 1 }, uDecay: { value: u.decay || 2.6 } },
    defines: { STEPS: 24 },             // loop bound; the live step count is the uniform uSteps (quality tiers switch without a recompile)
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uIgnite; uniform vec3 uHero;
      varying vec3 vLocal; varying vec3 vCamL; varying float vSeed; varying float vIgn; varying float vWS; varying vec3 vScl; varying float vGrow;
      void main(){
        mat4 m = modelMatrix * instanceMatrix;
        vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float ang = acos(clamp(dot(normalize(base), uHero), -1.0, 1.0));
        float ig = 1.0 - smoothstep(uIgnite - 0.05, uIgnite, ang);
        float fk = (ang - uIgnite + 0.035) / 0.03;
        vIgn = ig * (1.0 + 1.6 * exp(-fk * fk) * step(uIgnite, 3.3));       // ignition overshoot
        vGrow = mix(0.06, 1.0, smoothstep(0.0, 0.3, uIgnite - ang));          // the jet climbs out of the nozzle after ignition
        vLocal = position * max(ig, 0.0001); vLocal.y *= vGrow;
        vCamL = (inverse(m) * vec4(cameraPosition, 1.0)).xyz;
        vWS = length(mat3(m) * vec3(1.0, 0.0, 0.0));
        vScl = vec3(vWS, length(mat3(m) * vec3(0.0, 1.0, 0.0)), length(mat3(m) * vec3(0.0, 0.0, 1.0)));                          // world units per local radius unit
        vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * m * vec4(vLocal, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uPower, uIntensity, uFade, uDecay, uSteps;
      varying vec3 vLocal; varying vec3 vCamL; varying float vSeed; varying float vIgn; varying float vWS; varying vec3 vScl; varying float vGrow;
      ${NOISE}
      // radius of the jet (in units of the proxy radius) at height y ∈ [0,1]
      float jetR(float y){ return 0.32 + 0.48 * pow(y, 0.75); }   // stays inside the proxy, so the edge always dissolves to nothing     // starts at the nozzle exit, widens with height
      void main(){
        if (vIgn < 0.002) discard;
        vec3 ro = vCamL, rd = normalize(vLocal - vCamL);
        // ray / unit cylinder (radius 1, y ∈ [0,1])
        float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - 1.0;
        float disc = b * b - a * c; if (disc < 0.0 || a < 1e-6) discard;
        float sq = sqrt(disc), t0 = (-b - sq) / a, t1 = (-b + sq) / a;
        float ty0 = (0.0 - ro.y) / rd.y, ty1 = (vGrow - ro.y) / rd.y;
        t0 = max(t0, min(ty0, ty1)); t1 = min(t1, max(ty0, ty1));
        t0 = max(t0, 0.0); if (t1 <= t0) discard;
        // constant sample density in space: a ray through the core takes all STEPS samples, a grazing ray through the
        // edge of the proxy only as many as its short chord needs (most of a plume's pixels are near its edges)
        float ns = clamp(ceil(uSteps * (t1 - t0) / 1.8), 3.0, min(uSteps, float(STEPS)));
        // the jet itself never comes within 0.95 of the proxy radius: rays that pass wide of the axis see nothing
        { vec2 dxz = normalize(rd.xz); float miss = abs(ro.x * dxz.y - ro.z * dxz.x); if (miss > 0.95 && a > 0.04) discard; }
        float dt = (t1 - t0) / ns;
        // interleaved-gradient-noise slice offset, fixed in screen space: far less visible than white noise and,
        // unlike a per-frame shift, it never flickers frame to frame
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        vec3 acc = vec3(0.0);
        float T = uTime * 2.2 + vSeed * 31.0;
        for (int i = 0; i < STEPS; i++) {
          if (float(i) >= ns) break;
          float ts = t0 + (float(i) + jit) * dt;
          vec3 p = ro + rd * ts;
          float near = smoothstep(0.8, 4.5, length(rd * ts * vScl));      // gas right at the lens fades out
          float y = clamp(p.y / vGrow, 0.0, 1.0);
          // large eddies make the jet wander and bulge as it climbs
          float nl = vn(vec3(p.x * 1.3, y * 5.0 - T * 1.2, p.z * 1.3));
          float R = jetR(y) * (0.82 + 0.36 * nl * smoothstep(0.0, 0.35, y));
          float d = length(p.xz) / R;                                           // 0 at the axis, 1 at the jet edge
          if (d > 1.15) continue;
          // turbulence advected along the jet, stretched along y
          vec3 q = vec3(p.x / R * 1.8, y * 7.0 - T * 1.6, p.z / R * 1.8);
          float n = nl * 0.4 + vn(q * 2.3 + vec3(0.0, -T * 1.1, 0.0)) * 0.36 + vn(q * 5.1 + vec3(0.0, -T * 2.0, 0.0)) * 0.24;
          float edge = 1.0 - smoothstep(0.15 + 0.5 * n, 1.0, d);              // ragged, flickering boundary
          float body = edge * (0.12 + 1.9 * n * n) * exp(-y * uDecay) * smoothstep(0.0, 0.025, y) * (1.0 - smoothstep(0.5, 1.0, y));   // clumpy, and gone before the proxy ends
          float core = exp(-d * d * 10.0) * exp(-y * 2.1 * uDecay);
          float diamonds = pow(0.5 + 0.5 * cos(y * 70.0 - T * 0.4), 6.0) * exp(-d * d * 16.0) * exp(-y * 11.0);
          float temp = clamp(core * 1.4 + diamonds * 0.8, 0.0, 1.0);
          vec3 col = mix(mix(vec3(0.3, 0.22, 0.9), vec3(0.3, 0.58, 1.0), clamp(body * 1.6, 0.0, 1.0)), vec3(0.96, 0.98, 1.0), temp);   // hot plasma: white core, blue-violet cooling sheath
          acc += col * (body * 0.9 + core * 3.0 + diamonds * 4.0) * near;
        }
        acc *= dt * vWS * 0.55 * uIntensity * uPower * vIgn * uFade;
        acc /= 1.0 + 0.22 * max(acc.r, max(acc.g, acc.b));            // soft per-ray compression: overlapping plumes don't clip to white
        gl_FragColor = vec4(acc, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  return mesh;
}
