// Real hardware: NASA 3D Resources glTF models (public domain), loaded with Draco support and
// turned into instanced meshes (one per material) so dozens of copies stay cheap.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const draco = new DRACOLoader().setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
const gltf = new GLTFLoader().setDRACOLoader(draco);

export function loadModel(url) {
  return gltf.loadAsync(url).then(g => g.scene).catch(err => { console.warn('Model unavailable:', url, err); return null; });
}

// Tame scanned/authored materials for hard vacuum lighting: no bare mirrors, a little roughness.
function tame(m) {
  const out = m.isMeshStandardMaterial ? m : new THREE.MeshStandardMaterial({ color: m.color, map: m.map });
  out.metalness = Math.min(out.metalness ?? 0, 0.45); out.roughness = Math.max(out.roughness ?? 0.6, 0.35);
  out.envMapIntensity = 0.9; out.side = THREE.DoubleSide;
  return out;
}

/**
 * Normalise a model: bake its node transforms, centre it on X/Z, put its base at y = 0 and scale it so
 * its height (or largest side) equals `size`. Returns { parts: [{ geometry, material }], size: Vector3 }.
 */
export function bakeModel(root, size = 1, { byHeight = true, upAxis = null } = {}) {
  root.updateMatrixWorld(true);
  const parts = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const geo = g.index ? g.toNonIndexed() : g;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const key = mats[0];
    if (!parts.has(key)) parts.set(key, []); parts.get(key).push(geo);
  });
  const list = [...parts].map(([m, gs]) => ({ material: tame(m), geometry: mergeGeometries(gs, false) }));
  if (upAxis) for (const p of list) p.geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(upAxis, new THREE.Vector3(0, 1, 0)));
  const box = new THREE.Box3(); for (const p of list) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const dim = box.getSize(new THREE.Vector3()), k = size / (byHeight ? dim.y : Math.max(dim.x, dim.y, dim.z));
  const off = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  for (const p of list) { p.geometry.translate(off.x, off.y, off.z); p.geometry.scale(k, k, k); p.geometry.computeBoundingSphere(); }
  return { parts: list, size: dim.multiplyScalar(k) };
}

/** One InstancedMesh per material, all sharing the given matrices. */
export function instanceModel(baked, matrices) {
  const g = new THREE.Group();
  for (const p of baked.parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    g.add(im);
  }
  return g;
}

/** A single placed copy. */
export function placeModel(baked) {
  const g = new THREE.Group();
  for (const p of baked.parts) { const m = new THREE.Mesh(p.geometry, p.material); m.castShadow = m.receiveShadow = true; g.add(m); }
  return g;
}

/**
 * One mesh per model: every part merged into a single geometry, its material colour baked into vertex
 * colours. Spacecraft seen from hundreds of kilometres away need their silhouette and tone, not 20+ draw
 * calls each (the ISS alone has ~20 materials).
 */
export function flattenModel(baked, material) {
  const gs = baked.parts.map(p => {
    const g = p.geometry.clone(), n = g.attributes.position.count, c = new Float32Array(n * 3);
    const col = (p.material.color || new THREE.Color(0.7, 0.7, 0.7)).clone(); if (p.material.map) col.multiplyScalar(0.75);
    { const l = col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722; col.lerp(new THREE.Color(l * 0.95, l, l * 1.08), 0.65); }   // a flat colour stands in for a lost texture: keep it muted, never saturated red/orange
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    return g.index ? g.toNonIndexed() : g;
  });
  const m = new THREE.Mesh(mergeGeometries(gs, false), material);
  const grp = new THREE.Group(); grp.add(m); return grp;
}
