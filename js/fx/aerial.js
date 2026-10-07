// Aerial perspective: height-based atmospheric scattering applied to every lit material.
// Replaces three's fog chunks with a planet-aware model — optical depth integrated along the view ray
// through an exponential atmosphere around the origin (the Earth), in-scattered colour from the local
// sun elevation (blue day sky, orange terminator, engine-lit blue night) plus forward scattering.
//
// Scene uniforms ride on FogExp2: fog.color carries the sun direction scaled by the light level, and
// fog.density the extinction coefficient — so every built-in material picks them up automatically.
import * as THREE from 'three';

export const AERIAL_GLSL = /* glsl */`
  // col: surface radiance · p: world position · c: camera · sunL: sun dir * light level · beta: extinction at ground
  vec3 aerialPerspective(vec3 col, vec3 p, vec3 c, vec3 sunL, float beta, float R, float H, float night){
    vec3 seg = p - c; float L = length(seg);
    if (L < 1e-4 || beta <= 0.0) return col;
    float od = 0.0;
    for (int i = 0; i < 4; i++) { float t = (float(i) + 0.5) / 4.0; od += exp(-max(length(c + seg * t) - R, 0.0) / H); }
    od *= beta * L / 4.0;
    float T = exp(-od);
    float light = length(sunL); vec3 sd = sunL / max(light, 1e-4);
    vec3 up = normalize(p);
    float el = dot(up, sd), day = smoothstep(-0.18, 0.22, el);
    vec3 sky = mix(vec3(1.0, 0.42, 0.16), vec3(0.42, 0.6, 0.95), smoothstep(0.02, 0.35, el)) * day * light;
    float mu = max(dot(seg / L, sd), 0.0);
    sky += vec3(1.0, 0.78, 0.55) * pow(mu, 10.0) * 0.8 * day * light;                 // glare towards the sun
    sky += vec3(0.05, 0.13, 0.4) * (1.0 - day) * night;                               // engine light in the night haze
    return col * T + sky * (1.0 - T);
  }`;

export const HAZE = { R: 100, H: 1.6, night: 0.55 };

export function installAerialPerspective(scene) {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG\n  varying vec3 vAerialW;\n#endif`;
  C.fog_vertex = `#ifdef USE_FOG\n  vAerialW = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG\n  uniform vec3 fogColor; uniform float fogDensity; varying vec3 vAerialW;\n${AERIAL_GLSL}\n#endif`;
  C.fog_fragment = `#ifdef USE_FOG
    gl_FragColor.rgb = aerialPerspective(gl_FragColor.rgb, vAerialW, cameraPosition, fogColor, fogDensity, ${HAZE.R.toFixed(1)}, ${HAZE.H.toFixed(2)}, ${HAZE.night.toFixed(2)});
  #endif`;
  scene.fog = new THREE.FogExp2(0x000000, 0.035);
  return scene.fog;
}

/** per frame: sun direction (world), light level 0..1, extinction coefficient */
export function updateAerial(fog, sunDir, light, beta) {
  fog.color.setRGB(sunDir.x * light, sunDir.y * light, sunDir.z * light);
  fog.density = beta;
}
