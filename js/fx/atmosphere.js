// Physically based atmosphere: single-scattering Rayleigh + Mie, ray-marched per pixel
// (after Nishita / O'Neil / Hillaire). The shell is drawn additively: it adds the light scattered
// towards the camera along the view ray — the blue limb, the red-orange terminator band, the haze over
// the planet's disk and the glow around the Sun — and, seen from the ground, the whole sky dome.
//
// Units: scene units (Earth radius R = 100 ≈ 6,371 km). Scale heights are exaggerated so the
// atmosphere reads at this scale, while the coefficients are chosen to keep the real vertical optical
// depths (Rayleigh ≈ 0.05 / 0.11 / 0.27 in R/G/B, Mie ≈ 0.03), so colours stay physically right.
import * as THREE from 'three';

export function createAtmosphere({ R = 100, thickness = 6, uSun, uLight, uPower, uEng, uIgnite, uHeroW, steps = 14, lightSteps = 5 }) {
  const HR = 0.55, HM = 0.16;
  const betaR = new THREE.Vector3(0.0464, 0.108, 0.265).divideScalar(HR);
  const betaM = 0.03 / HM;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun, uLight, uPower: uPower || { value: 0 }, uEng: uEng || { value: new THREE.Vector3(0, 0, -1) }, uIgnite: uIgnite || { value: 10 }, uHeroW: uHeroW || { value: new THREE.Vector3(0, 1, 0) },
      uR: { value: R }, uRA: { value: R + thickness }, uHR: { value: HR }, uHM: { value: HM },
      uBetaR: { value: betaR }, uBetaM: { value: betaM }, uSunI: { value: 16 }, uG: { value: 0.76 },
    },
    defines: { STEPS: steps, LSTEPS: lightSteps },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    vertexShader: `varying vec3 vPw; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vPw = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uBetaR, uEng, uHeroW; uniform float uLight, uPower, uR, uRA, uHR, uHM, uBetaM, uSunI, uG, uIgnite;
      varying vec3 vPw;
      vec2 sphere(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c; if (d < 0.0) return vec2(1e9, -1e9); d = sqrt(d); return vec2(-b - d, -b + d); }
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vPw - ro), L = normalize(uSun);
        vec2 ta = sphere(ro, rd, uRA); if (ta.y < 0.0) discard;
        vec2 tg = sphere(ro, rd, uR);
        float t0 = max(ta.x, 0.0), t1 = ta.y;
        if (tg.x > 0.0 && tg.x < t1) t1 = tg.x;                        // the ray stops at the ground
        float dt = (t1 - t0) / float(STEPS);
        vec3 sumR = vec3(0.0), sumM = vec3(0.0); float odR = 0.0, odM = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
          float h = length(p) - uR;
          float dR = exp(-h / uHR) * dt, dM = exp(-h / uHM) * dt;
          odR += dR; odM += dM;
          // optical depth towards the Sun (zero light if the planet is in the way)
          vec2 tl = sphere(p, L, uRA); float ldt = tl.y / float(LSTEPS); float lR = 0.0, lM = 0.0; bool shadow = false;
          vec2 tgl = sphere(p, L, uR * 0.998); if (tgl.y > tgl.x && tgl.x > 0.0) shadow = true;   // a miss returns (1e9, -1e9)
          if (!shadow) {
            for (int j = 0; j < LSTEPS; j++) { float hl = length(p + L * (float(j) + 0.5) * ldt) - uR; lR += exp(-hl / uHR) * ldt; lM += exp(-hl / uHM) * ldt; }
            vec3 tau = uBetaR * (odR + lR) + uBetaM * 1.1 * (odM + lM);
            vec3 att = exp(-tau);
            sumR += att * dR; sumM += att * dM;
          }
        }
        float mu = dot(rd, L), g = uG;
        float phR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
        float phM = 3.0 / (8.0 * 3.14159) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
        vec3 col = uSunI * uLight * (sumR * uBetaR * phR + sumM * uBetaM * phM);
        // the night limb glows faintly blue with the light of the planetary engines
        // the air over the burning hemisphere glows blue with the light of ten thousand engines (strongest on the
        // night side, a faint tint in daylight) — the planet's signature in every stage, sunlit or not
        vec3 pe = normalize(ro + rd * t1);
        float eng = smoothstep(-0.15, 0.55, dot(pe, normalize(uEng))) * (1.0 - 0.75 * smoothstep(-0.2, 0.15, dot(pe, L) * step(0.05, uLight)));
        float ia = acos(clamp(dot(pe, uHeroW), -1.0, 1.0));
        eng *= 1.0 - smoothstep(uIgnite - 0.25, uIgnite + 0.02, ia);   // the air lights up only behind the ignition front
        float wq = (ia - uIgnite) / 0.07; eng += exp(-wq * wq) * 1.1 * step(uIgnite, 3.3) * step(0.01, uIgnite);   // and the front itself is a bright wave racing through the air
        col += vec3(0.08, 0.22, 0.7) * uPower * 0.02 * min(odR, 6.0) * eng;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R + thickness, 160, 96), mat);
  mesh.renderOrder = 5; mesh.frustumCulled = false;
  // From outside, the front faces are in front of everything inside the atmosphere; from inside, only
  // the back faces exist in front of the camera.
  mesh.onBeforeRender = (r, s, cam) => {
    const inside = cam.position.length() < R + thickness;
    const side = inside ? THREE.BackSide : THREE.FrontSide;
    if (mat.side !== side) { mat.side = side; mat.needsUpdate = true; }
  };
  return mesh;
}
