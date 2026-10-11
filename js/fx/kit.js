// Kitbashing: build detailed hard-surface models (ships, climbers, stations) out of many primitives, then
// merge everything that shares a material into one geometry. A model with hundreds of parts costs a
// handful of draw calls, and clones / instances share the merged buffers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const D2 = new THREE.Matrix4(), Q2 = new THREE.Quaternion(), E2 = new THREE.Euler(), P2 = new THREE.Vector3(), S2 = new THREE.Vector3();

function prep(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) { const n = g.attributes.position.count, idx = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  g.morphAttributes = {}; g.clearGroups();
  return g;
}

// A material drawn by both instanced and ordinary meshes makes three.js flip its program (instancing on/off) and
// recompute the program key at every switch, every frame. Instanced meshes get their own twin instead: same
// textures, same shared uniforms, same shader patches — one program each, chosen once.
const twins = new WeakMap();
export function instancedVariant(m) {
  if (!m || m.isInstancedTwin) return m;
  let c = twins.get(m);
  if (!c) {
    c = m.clone(); c.isInstancedTwin = true;
    if (m.uniforms) c.uniforms = m.uniforms;                       // keep shared uniform objects (time, sun, …)
    c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
    twins.set(m, c);
  }
  return c;
}

export class Kit {
  constructor() { this.parts = new Map(); }
  /** add(geometry, material, [x,y,z], [rx,ry,rz], [sx,sy,sz] | s) — the geometry is cloned and baked */
  add(geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
    E2.set(r[0], r[1], r[2]); Q2.setFromEuler(E2); P2.set(p[0], p[1], p[2]);
    if (typeof s === 'number') S2.setScalar(s); else S2.set(s[0], s[1], s[2]);
    D2.compose(P2, Q2, S2);
    return this.addM(geo, mat, D2);
  }
  addM(geo, mat, m) {
    const g = prep(geo.clone()); g.applyMatrix4(m);
    if (m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }   // mirrored: keep the winding
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g); return this;
  }
  /** mirror every part added by fn across the YZ plane (x → -x) as well */
  mirrorX(fn) { const sub = new Kit(); fn(sub); for (const [mat, gs] of sub.parts) for (const g of gs) { this.addM(g, mat, new THREE.Matrix4()); this.addM(g, mat, new THREE.Matrix4().makeScale(-1, 1, 1)); } return this; }
  /** one geometry per material */
  geometries() {
    return [...this.parts].map(([material, gs]) => {
      const geometry = mergeGeometries(gs, false);
      geometry.computeBoundingSphere(); geometry.computeBoundingBox();
      return { geometry, material };
    });
  }
  build() { const g = new THREE.Group(); for (const p of this.geometries()) { const m = new THREE.Mesh(p.geometry, p.material); g.add(m); } return g; }
  /** instanced version: one InstancedMesh per material, count instances */
  instanced(count) { return this.geometries().map(p => { const m = new THREE.InstancedMesh(p.geometry, instancedVariant(p.material), count); m.frustumCulled = false; return m; }); }
}

/** scatter small boxes ("greebles") over a cylinder band around the Z axis */
export function greebleCylinder(kit, mats, rnd, { r, z0, z1, n, size = 1, a0 = 0, a1 = Math.PI * 2 }) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const a = a0 + rnd() * (a1 - a0), z = z0 + rnd() * (z1 - z0);
    const w = (0.15 + rnd() * 0.5) * size, h = (0.06 + rnd() * 0.22) * size, l = (0.25 + rnd() * 1.4) * size;
    kit.add(box, mats[(rnd() * mats.length) | 0], [Math.cos(a) * (r + h * 0.4), Math.sin(a) * (r + h * 0.4), z], [0, 0, a + Math.PI / 2], [w, h, l]);
  }
}
