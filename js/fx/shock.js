// Ignition shockwave: a Wilson condensation dome — the white veil that flashes into existence around a
// huge blast as the pressure wave cools the air — plus a dust ring rolling outward along the ground.
// One instance; `set(center, up, p, size)` places it (parent-local space) at progress p ∈ [0, 1].
import * as THREE from 'three';

export function createShockwave(u) {
  const geo = new THREE.SphereGeometry(1, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: u.uSun, uLight: u.uLight, uTime: u.uTime, uP: { value: 0 }, uGlow: { value: new THREE.Color(0.4, 0.65, 1.0) } },
    transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW; varying vec3 vO;
      void main(){ vO = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uGlow; uniform float uLight, uTime, uP;
      varying vec3 vN; varying vec3 vW; varying vec3 vO;
      float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        vec3 V = normalize(cameraPosition - vW), N = normalize(vN);
        float fres = pow(1.0 - abs(dot(N, V)), 2.2);
        float n = vn(vO * 7.0 + uP * 3.0) * 0.6 + vn(vO * 19.0 - uP * 5.0) * 0.4;
        // the condensation veil: thin, brightest at the silhouette, torn by turbulence, gone in a breath
        float veil = fres * (1.0 - smoothstep(0.55, 0.95, fres)) * smoothstep(0.25, 0.75, n + 0.15) * smoothstep(0.0, 0.04, uP) * pow(1.0 - smoothstep(0.05, 0.55, uP), 1.5);   // soft haze: no hard bubble outline at the silhouette
        // the dust ring hugging the ground, lasting longer
        float ring = (1.0 - smoothstep(0.0, 0.07 + 0.08 * n, vO.y)) * smoothstep(0.0, 0.03, uP) * pow(1.0 - uP, 1.2) * (0.5 + 0.8 * n);
        float a = clamp(veil * 0.4 + ring * 0.42 * smoothstep(0.0, 0.6, n), 0.0, 1.0);
        if (a < 0.003) discard;
        vec3 L = normalize(uSun);
        float day = smoothstep(-0.1, 0.15, dot(normalize(vW), L));
        vec3 col = vec3(0.9, 0.92, 0.95) * (uLight * 1.5 * (0.45 + 0.55 * max(dot(N, L), 0.0)) * day + 0.05);
        col += uGlow * (1.4 * (1.0 - uP) + 0.6 * ring);   // lit from below by the engines
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false;
  const Yv = new THREE.Vector3(0, 1, 0);
  mesh.set = (center, up, p, size) => {
    mesh.visible = p > 0 && p < 1;
    if (!mesh.visible) return;
    const r = size * (1 - Math.exp(-4 * p)) / (1 - Math.exp(-4));
    mesh.position.copy(center); mesh.quaternion.setFromUnitVectors(Yv, up);
    mesh.scale.set(r, r * 0.55, r);
    mat.uniforms.uP.value = p;
  };
  return mesh;
}
