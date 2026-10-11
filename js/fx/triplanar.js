// Triplanar PBR for MeshStandardMaterial.
// Projects a scanned texture set (albedo, OpenGL normal, AO/roughness/metalness "ARM") along the three
// object-space axes and blends by the surface normal, so procedurally built and instanced geometry gets
// real material detail without UVs. Works with InstancedMesh (projection happens in instance-local space).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();

export function loadPBR(base, name, res = '1k') {
  const get = (map, srgb) => new Promise(res2 => loader.load(`${base}/${name}_${map}_${res}.jpg`, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res2(t);
  }, undefined, () => res2(null)));
  return Promise.all([get('diff', true), get('nor_gl', false), get('arm', false)]).then(([diff, nor, arm]) => {
    if (!(diff && nor && arm)) return null;
    // mean linear luminance of the albedo scan, so the scan only adds *variation* around the material's own
    // albedo instead of brightening or darkening it (the old ×2.2 gain pushed albedo past 1 → blown whites)
    let mean = 0.35;
    try {
      const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); x.drawImage(diff.image, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data, lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      mean = Math.max(0.05, s / 256);
    } catch (e) { /* keep the default */ }
    return { diff, nor, arm, mean };
  });
}

/**
 * @param {THREE.MeshStandardMaterial} mat
 * @param {{diff, nor, arm}} set   texture set from loadPBR
 * @param {object} o  scale: repeats per object unit · tint: multiplies albedo · normalScale · roughMul / metalMul
 *                    blend: 0..1 mix of the scanned albedo over the material's own colour/map
 */
export function applyTriplanar(mat, set, o = {}) {
  if (!set) return mat;
  const u = {
    tpDiff: { value: set.diff }, tpNor: { value: set.nor }, tpArm: { value: set.arm },
    tpScale: { value: o.scale ?? 1 }, tpNS: { value: o.normalScale ?? 0.5 }, tpMean: { value: set.mean ?? 0.35 },
    tpRough: { value: o.roughMul ?? 1 }, tpMetal: { value: o.metalMul ?? 1 }, tpBlend: { value: o.blend ?? 1 },
    tpPanel: { value: o.panels ?? 0 },
  };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTpPos; varying vec3 vTpN; varying vec3 vTpX; varying vec3 vTpY; varying vec3 vTpZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTpPos = position; vTpN = normal;
        mat3 tpM = mat3(modelViewMatrix);
        #ifdef USE_INSTANCING
          tpM = tpM * mat3(instanceMatrix);
        #endif
        vTpX = tpM * vec3(1.0, 0.0, 0.0); vTpY = tpM * vec3(0.0, 1.0, 0.0); vTpZ = tpM * vec3(0.0, 0.0, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tpDiff, tpNor, tpArm; uniform float tpScale, tpNS, tpRough, tpMetal, tpBlend, tpPanel, tpMean;
        varying vec3 vTpPos; varying vec3 vTpN; varying vec3 vTpX; varying vec3 vTpY; varying vec3 vTpZ;
        vec3 tpW(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z + 1e-5); }
        vec4 tpSample(sampler2D t, vec3 p, vec3 w){
          return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
        float tpH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        // hull plating: staggered rectangular panels with their own tone and sheen, dark seams between them
        vec3 tpPanelAt(vec2 q){
          q.x += 0.5 * floor(q.y * 0.5);
          vec2 c = q * vec2(1.0, 0.5), id = floor(c), f = fract(c);
          vec2 e2 = min(f, 1.0 - f) / max(fwidth(c), vec2(1e-4));
          float seam = 1.0 - smoothstep(0.6, 1.6, min(e2.x, e2.y));
          float h = tpH(id), k = tpH(id + 17.3);
          float tone = 0.86 + 0.22 * h - (k > 0.92 ? 0.3 : 0.0);
          return vec3(tone, seam, k);
        }`)
      // albedo
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tpNo = normalize(vTpN), tpWt = tpW(tpNo), tpP = vTpPos * tpScale;
        vec4 tpA = tpSample(tpDiff, tpP, tpWt);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * clamp(tpA.rgb / tpMean, 0.55, 1.35), tpBlend);   // variation around the base albedo, energy-preserving
        vec3 tpArmV = tpSample(tpArm, tpP, tpWt).rgb;
        vec3 tpPn = vec3(1.0, 0.0, 0.5);
        if (tpPanel > 0.0) {
          vec3 pq = vTpPos * tpPanel;
          tpPn = tpPanelAt(pq.zy) * tpWt.x + tpPanelAt(pq.xz) * tpWt.y + tpPanelAt(pq.xy) * tpWt.z;
          diffuseColor.rgb *= tpPn.x * (1.0 - 0.55 * tpPn.y);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(mix(roughnessFactor, tpArmV.g * tpRough, tpBlend) * (0.85 + 0.3 * tpPn.z) + tpPn.y * 0.25, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = clamp(mix(metalnessFactor, min(metalnessFactor, tpArmV.b) * tpMetal, tpBlend), 0.0, 1.0);   // coated/painted finish: never a bare mirror`)
      // per-axis tangent-space normals (whiteout blend), rotated into view space
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nx = texture2D(tpNor, tpP.zy).xyz * 2.0 - 1.0, ny = texture2D(tpNor, tpP.xz).xyz * 2.0 - 1.0, nz = texture2D(tpNor, tpP.xy).xyz * 2.0 - 1.0;
          nx.xy *= tpNS; ny.xy *= tpNS; nz.xy *= tpNS;
          vec3 s = sign(tpNo);
          vec3 ox = vec3(nx.z * s.x, nx.y, nx.x);          // zy plane
          vec3 oy = vec3(ny.x, ny.z * s.y, ny.y);          // xz plane
          vec3 oz = vec3(nz.x, nz.y, nz.z * s.z);          // xy plane
          vec3 objN = normalize(ox * tpWt.x + oy * tpWt.y + oz * tpWt.z + tpNo * 0.6);
          vec3 vn = normalize(objN.x * vTpX + objN.y * vTpY + objN.z * vTpZ);
          normal = normalize(mix(normal, faceDirection * vn, tpBlend));
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(1.0, tpArmV.r, tpBlend);
        reflectedLight.indirectSpecular *= mix(1.0, tpArmV.r, tpBlend);`);
  };
  mat.customProgramCacheKey = () => 'tp';      // same GLSL for every set (textures and scales are uniforms): one shared program
  mat.userData.tp = u;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Scale cue for colossal structures: rows of small lit windows over the body of a tower (object space,
 * radius rMin..rMax, height yMin..yMax), randomly occupied, fading to their average glow when the grid
 * gets smaller than a pixel so it never shimmers. Call after applyTriplanar (uses its varyings).
 */
export function addWindowLights(mat, o = {}) {
  const u = { wlRows: { value: o.rows ?? 46 }, wlCols: { value: o.cols ?? 72 }, wlI: o.intensity || { value: 2.2 } };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float wlRows, wlCols, wlI;
        float wlHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float rr = length(vTpPos.xz), side = 1.0 - smoothstep(0.35, 0.6, abs(normalize(vTpN).y));
          float body = step(${(o.rMin ?? 0.28).toFixed(3)}, rr) * step(rr, ${(o.rMax ?? 0.46).toFixed(3)}) * step(${(o.yMin ?? 0.32).toFixed(3)}, vTpPos.y) * step(vTpPos.y, ${(o.yMax ?? 1.2).toFixed(3)}) * side;
          if (body > 0.0) {
            vec2 g = vec2(atan(vTpPos.z, vTpPos.x) / 6.2831853 * wlCols, vTpPos.y * wlRows);
            vec2 cell = floor(g), f = fract(g);
            float h = wlHash(cell), on = step(0.8, h) * step(0.5, wlHash(floor(cell / vec2(9.0, 5.0)) + 7.0));   // lit in blocks, like occupied floors
            float win = on * step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.7);
            float fw = max(fwidth(g.x), fwidth(g.y));
            win = mix(win, 0.1 * 0.24, smoothstep(0.35, 0.9, fw));          // sub-pixel: average glow, no shimmer
            vec3 wc = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.88, 1.0), step(0.9, h));
            totalEmissiveRadiance += wc * win * wlI * body;
          }
        }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : mat.uuid;
  const opt = [o.rMin, o.rMax, o.yMin, o.yMax].join(',');
  mat.customProgramCacheKey = () => key + '-wl' + opt;      // the GLSL bakes these bounds in
  mat.needsUpdate = true;
  return mat;
}
