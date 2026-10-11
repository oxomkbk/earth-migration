// Film pipeline. The three scale layers are composited into one multisampled HDR frame (resolved once), then
// three full-screen passes, none of them multisampled:
//   1. stabilise — NaN/Inf guard + heat-haze offset + temporal stabiliser; its output is also next frame's history
//   2. bloom    — dual-filter mip chain (and crepuscular rays) at half resolution and below
//   3. final    — bloom composite + lens (zoom blur, optional flares) + ACES + sRGB + grade, straight to the screen
// (It used to be ~8 full-resolution passes, each writing and resolving a 4× MSAA half-float buffer.)
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const noop = () => {};

// The layers draw one after another into the same multisampled buffer, with a depth clear between them.
// three.js resolves (blits) and *invalidates* a multisampled target after every render() call: on tiled GPUs
// (Apple silicon, mobile) the invalidate really discards the samples, so the layers already drawn could be lost,
// and every extra layer costs a full-screen resolve. Both are suppressed for all but the last layer.
class LayerPass {
  constructor(layers, samples) {
    this.tag = 'layers'; this.layers = layers;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.empty = new THREE.Scene(); this.emptyCam = new THREE.Camera();
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer) {
    const gl = renderer.getContext(), ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
    const act = this.layers.filter(L => L.active);
    if (!act.length) renderer.render(this.empty, this.emptyCam);           // still resolve the cleared frame
    for (let i = 0; i < act.length; i++) {
      const L = act[i], keep = i < act.length - 1 && this.rt.samples > 0;
      if (keep) { gl.blitFramebuffer = noop; gl.invalidateFramebuffer = noop; }
      try { renderer.clearDepth(); renderer.render(L.scene, L.cam); }
      finally { if (keep) { delete gl.blitFramebuffer; delete gl.invalidateFramebuffer; } }
    }
    renderer.autoClear = ac;
  }
}

// Stabilise: guards against NaN/Inf (one bad pixel would be smeared into a black square by the bloom), applies
// the heat-haze offset field, and blends with the neighbourhood-clamped history (TAA without jitter: sub-pixel
// stars, sparks and thin lines stop shimmering; nothing ghosts). Writes into the history buffer it returns.
class TemporalPass {
  constructor() {
    this.tag = 'stabilise'; this.feedback = 0.5; this.valid = false; this.i = 0; this.haze = null; this.hazeS = 0.006;
    this.hist = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tCur: { value: null }, tPrev: { value: null }, tD: { value: null }, uTexel: { value: new THREE.Vector2() }, uFb: { value: 0 }, uHaze: { value: 0 } },
      vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`uniform sampler2D tCur, tPrev, tD; uniform vec2 uTexel; uniform float uFb, uHaze; varying vec2 vUv;
        vec3 C(vec2 uv){ vec3 c = texture2D(tCur, uv).rgb;
          bool bad = any(isnan(c)) || any(isinf(c)) || !(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0) || !(c.r < 1e30);
          return bad ? vec3(0.0) : min(c, vec3(160.0)); }
        void main(){
          vec2 uv = vUv; if (uHaze > 0.0) uv += texture2D(tD, vUv).rg * uHaze;
          vec3 c = C(uv), mn = c, mx = c;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { if (x == 0 && y == 0) continue; vec3 s = C(uv + vec2(float(x), float(y)) * uTexel); mn = min(mn, s); mx = max(mx, s); }
          vec3 p = clamp(texture2D(tPrev, vUv).rgb, mn, mx);
          gl_FragColor = vec4(mix(c, p, uFb), 1.0); }`,
    });
    this.quad = new FullScreenQuad(this.mat); this.out = this.hist[0];
  }
  setSize(w, h) { for (const t of this.hist) t.setSize(w, h); this.mat.uniforms.uTexel.value.set(1 / w, 1 / h); this.valid = false; }
  reset() { this.valid = false; }
  render(renderer, src) {
    const a = this.hist[this.i], b = this.hist[1 - this.i], u = this.mat.uniforms;
    u.tCur.value = src; u.tPrev.value = b.texture; u.uFb.value = this.valid ? this.feedback : 0;
    u.tD.value = this.haze ? this.haze.texture : null; u.uHaze.value = this.haze ? this.hazeS : 0;
    renderer.setRenderTarget(a); this.quad.render(renderer);
    this.out = a; this.i = 1 - this.i; this.valid = true;
  }
}

// Eye adaptation meter: a 48×27 float copy of the HDR frame, read back fully asynchronously — a ring of three
// pixel-pack buffers, each fenced, polled with getSyncParameter and read only once the GPU has signalled it (Chrome
// then serves the read from its shadow copy). Nothing ever waits on the GPU: a blocking read would serialise CPU
// and GPU and cost a whole frame of overlap. After a jump the first read issued afterwards is flagged, and the
// exposure snaps when it lands (a frame or two later).
class MeterPass {
  constructor() {
    this.tag = 'meter'; this.lum = null; this.seq = 0; this.synced = 0; this.ring = []; this.issued = 0; this.lastId = 0; this.syncReq = 0;
    this.rt = new THREE.WebGLRenderTarget(48, 27, { type: THREE.FloatType, depthBuffer: false });
    this.buf = new Float32Array(48 * 27 * 4); this.L = new Float32Array(48 * 27);
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { t: { value: null } },
      vertexShader: VS,
      fragmentShader: `uniform sampler2D t; varying vec2 vUv;
        void main(){ vec3 c = vec3(0.0); for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) c += textureLod(t, vUv + (vec2(float(x), float(y)) - 1.5) / vec2(192.0, 108.0), 0.0).rgb;
          gl_FragColor = vec4(c / 16.0, 1.0); }`,
    }));
  }
  compute() {
    let n = 0; for (let i = 0; i < 48 * 27; i++) { const l = 0.2126 * this.buf[i * 4] + 0.7152 * this.buf[i * 4 + 1] + 0.0722 * this.buf[i * 4 + 2]; if (l === l) this.L[n++] = l; }
    if (!n) { this.seq++; return; }
    const L = this.L.subarray(0, n).sort();
    this.lum = { p50: L[Math.floor(n * 0.5)], p85: L[Math.floor(n * 0.85)], p97: L[Math.floor(n * 0.97)] }; this.seq++;
  }
  // Collect finished reads, oldest first. Called at the very start of a frame, before any of the frame's GL
  // commands are queued: even a signalled read is a round trip to the GPU process, which would otherwise wait
  // behind everything this frame has already submitted.
  collect(renderer) {
    const gl = renderer.getContext(), PP = gl.PIXEL_PACK_BUFFER;
    for (const s of [...this.ring].sort((a, b) => a.id - b.id)) {
      if (!s.sync || gl.getSyncParameter(s.sync, gl.SYNC_STATUS) !== gl.SIGNALED) continue;
      gl.deleteSync(s.sync); s.sync = null;
      gl.bindBuffer(PP, s.b); gl.getBufferSubData(PP, 0, this.buf); gl.bindBuffer(PP, null);
      if (s.id > this.lastId) { this.lastId = s.id; this.compute(); if (this.syncReq && s.id >= this.syncReq) { this.synced = this.seq; this.syncReq = 0; } }
    }
  }
  render(renderer, src) {
    if (this.skip && !this.forceSync) return;          // nothing to measure this frame (see main.js: anchored exposure, ~5 Hz)
    const gl = renderer.getContext(), PP = gl.PIXEL_PACK_BUFFER;
    if (!this.ring.length) for (let i = 0; i < 3; i++) { const b = gl.createBuffer(); gl.bindBuffer(PP, b); gl.bufferData(PP, this.buf.byteLength, gl.STREAM_READ); gl.bindBuffer(PP, null); this.ring.push({ b, sync: null, id: 0 }); }
    if (this.forceSync) { this.forceSync = false; this.syncReq = this.issued + 1; }
    // issue one new read into a free buffer (if all three are still in flight, skip a frame)
    const f = this.ring.find(s => !s.sync); if (!f) return;
    this.quad.material.uniforms.t.value = src.texture;
    renderer.setRenderTarget(this.rt); this.quad.render(renderer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.properties.get(this.rt).__webglFramebuffer);   // the same binding three.js just made
    gl.bindBuffer(PP, f.b); gl.readPixels(0, 0, 48, 27, gl.RGBA, gl.FLOAT, 0); gl.bindBuffer(PP, null);
    f.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); f.id = ++this.issued; gl.flush();
  }
}

// Physically based bloom (dual filter, as in Unreal / CoD:AW): a 13-tap downsample chain with a Karis
// average on the first level (no fireflies), then a 3×3 tent upsample that accumulates every level back up.
// Bright points get a smooth round glow at every size, never the blocky square of the separable-gaussian
// UnrealBloomPass on a few super-bright pixels.
class PhysBloomPass {
  constructor(levels = 7) {
    this.tag = 'bloom'; this.strength = 0.5; this.threshold = 1; this.knee = 0.6; this.radius = 0.75; this.levels = levels;
    this.mips = Array.from({ length: 7 }, () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    this.down = new THREE.ShaderMaterial({
      uniforms: { t: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThr: { value: 1 }, uKnee: { value: 0.5 } },
      vertexShader: vs,
      fragmentShader: /* glsl */`uniform sampler2D t; uniform vec2 uTexel; uniform float uFirst, uThr, uKnee; varying vec2 vUv;
        vec3 S(vec2 o){ return texture2D(t, vUv + o * uTexel).rgb; }
        float lw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
        void main(){
          vec3 a = S(vec2(-2.0, 2.0)), b = S(vec2(0.0, 2.0)), c = S(vec2(2.0, 2.0));
          vec3 d = S(vec2(-2.0, 0.0)), e = S(vec2(0.0)), f = S(vec2(2.0, 0.0));
          vec3 g = S(vec2(-2.0, -2.0)), h = S(vec2(0.0, -2.0)), i = S(vec2(2.0, -2.0));
          vec3 j = S(vec2(-1.0, 1.0)), k = S(vec2(1.0, 1.0)), l = S(vec2(-1.0, -1.0)), m = S(vec2(1.0, -1.0));
          vec3 col;
          if (uFirst > 0.5) {                     // Karis average: each 2×2 group weighted by 1/(1+luma)
            vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
            float w0 = lw(g0) * 0.5, w1 = lw(g1) * 0.125, w2 = lw(g2) * 0.125, w3 = lw(g3) * 0.125, w4 = lw(g4) * 0.125;
            col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
            float br = max(col.r, max(col.g, col.b));                   // soft-knee threshold
            float rq = clamp(br - uThr + uKnee, 0.0, 2.0 * uKnee); rq = rq * rq / (4.0 * uKnee + 1e-4);
            col *= max(rq, br - uThr) / max(br, 1e-4);
          } else {
            col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
          }
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }`,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { t: { value: null }, uTexel: { value: new THREE.Vector2() }, uW: { value: 1 } },
      vertexShader: vs, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`uniform sampler2D t; uniform vec2 uTexel; uniform float uW; varying vec2 vUv;
        vec3 S(vec2 o){ return texture2D(t, vUv + o * uTexel).rgb; }
        void main(){
          vec3 c = S(vec2(0.0)) * 4.0 + (S(vec2(-1.0, 0.0)) + S(vec2(1.0, 0.0)) + S(vec2(0.0, -1.0)) + S(vec2(0.0, 1.0))) * 2.0
                 + S(vec2(-1.0)) + S(vec2(1.0)) + S(vec2(-1.0, 1.0)) + S(vec2(1.0, -1.0));
          gl_FragColor = vec4(c / 16.0 * uW, 1.0);
        }`,
    });
    this.uBTexel = new THREE.Vector2(); this.uRay = new THREE.Vector3(); this.uBS = 0; this.rayOn = false;
    // crepuscular rays: a radial blur of the very brightest pixels (the Sun's disc) towards the light, so an
    // occluding limb, ring or ship casts shafts across the frame
    this.rays = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rayPos = new THREE.Vector2(0.5, 0.5); this.rayI = 0; this.rayThr = 8; this.rayCol = new THREE.Color(1, 0.8, 0.55);
    this.rayMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: null }, uPos: { value: this.rayPos }, uThr: { value: 8 }, uAsp: { value: 1 } },
      vertexShader: vs,
      fragmentShader: /* glsl */`uniform sampler2D t; uniform vec2 uPos; uniform float uThr, uAsp; varying vec2 vUv;
        float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main(){
          vec2 d = (uPos - vUv); float len = length(d * vec2(uAsp, 1.0));
          vec2 st = d / 40.0;
          vec2 uv = vUv + st * h12(gl_FragCoord.xy);
          vec3 acc = vec3(0.0); float w = 1.0;
          for (int i = 0; i < 40; i++) { vec3 c = texture2D(t, uv).rgb; acc += max(c - uThr, 0.0) / (1.0 + max(c - uThr, 0.0) * 0.02) * w; w *= 0.97; uv += st; }
          gl_FragColor = vec4(acc / 40.0 * exp(-len * 2.2), 1.0);
        }`,
    });
    this.quad = new FullScreenQuad(this.down);
  }
  setSize(w, h) { let x = w, y = h; for (const m of this.mips) { x = Math.max(1, x >> 1); y = Math.max(1, y >> 1); m.setSize(x, y); } this.rays.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); this.rayMat.uniforms.uAsp.value = w / Math.max(h, 1); }
  render(renderer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    const d = this.down.uniforms; d.uThr.value = this.threshold; d.uKnee.value = Math.max(this.threshold * this.knee, 1e-3);
    this.quad.material = this.down;
    let src = readBuffer;
    for (let i = 0; i < this.levels; i++) {
      d.t.value = src.texture; d.uTexel.value.set(1 / src.width, 1 / src.height); d.uFirst.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(this.mips[i]); renderer.clear(); this.quad.render(renderer); src = this.mips[i];
    }
    if (this.rayI > 0.002) {
      this.rayMat.uniforms.t.value = this.mips[1].texture; this.rayMat.uniforms.uThr.value = this.rayThr;
      this.quad.material = this.rayMat; renderer.setRenderTarget(this.rays); this.quad.render(renderer);
    }
    this.quad.material = this.up;
    for (let i = this.levels - 1; i > 0; i--) {             // each level adds the (tent-filtered) wider one above it
      const s = this.mips[i]; this.up.uniforms.t.value = s.texture; this.up.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.up.uniforms.uW.value = this.radius;
      renderer.setRenderTarget(this.mips[i - 1]); this.quad.render(renderer);
    }
    const m0 = this.mips[0];
    this.uBTexel.set(1 / m0.width, 1 / m0.height); this.rayOn = this.rayI > 0.002;
    this.uRay.set(this.rayCol.r, this.rayCol.g, this.rayCol.b).multiplyScalar(this.rayOn ? this.rayI : 0);
    this.uBS = this.strength * (1 - this.radius) / (1 - Math.pow(this.radius, this.levels));      // normalised: the sum of levels has unit weight
    renderer.autoClear = ac;
  }
}

// Final: bloom composite, lens, ACES filmic tone mapping (exactly three.js's), sRGB encoding and the grade, in
// one pass straight to the canvas.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, tBloom: { value: null }, tRays: { value: null }, uBTexel: { value: new THREE.Vector2() }, uBS: { value: 0 }, uRay: { value: new THREE.Vector3() }, uRayOn: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, toneMappingExposure: { value: 1 },
    uL: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },        // xy uv, z intensity, w on-screen
    uLC: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    uZoom: { value: 0 }, uAberr: { value: 0.0 }, uDirt: { value: 0 }, uFlare: { value: 0 },
    uLift: { value: new THREE.Vector3(0, 0, 0) }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1.0 }, uContrast: { value: 1.02 }, uVig: { value: 0.2 }, uGrain: { value: 0.004 }, uFade: { value: 0 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */`

    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uZoom, uAberr, uDirt, uFlare;
    uniform vec4 uL[3]; uniform vec3 uLC[3];
    varying vec2 vUv;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float disk(vec2 p, float r, float soft){ return 1.0 - smoothstep(r - soft, r, length(p)); }
    vec3 sampleCA(vec2 uv){
      if (uAberr <= 0.0) return texture2D(tDiffuse, uv).rgb;
      vec2 d = uv - 0.5; float k = dot(d, d) * uAberr * 8.0;
      return vec3(texture2D(tDiffuse, uv - d * k).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + d * k).b);
    }
    uniform sampler2D tBloom, tRays; uniform vec2 uBTexel; uniform float uBS, uRayOn, toneMappingExposure; uniform vec3 uRay;
    uniform float uSat, uContrast, uVig, uGrain, uFade; uniform vec3 uLift, uGamma, uGain;
    vec3 acesFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 color){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      return clamp(O * acesFit(I * (color * toneMappingExposure / 0.6)), 0.0, 1.0); }
    vec3 srgb(vec3 v){ return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308)))); }
    void main(){
      vec2 uv = vUv, asp = vec2(uRes.x / uRes.y, 1.0);
      vec3 col = sampleCA(uv);
      // zoom motion blur: during scale transitions the frame streaks towards (or away from) the centre
      if (uZoom > 0.002) {
        vec3 acc = col; float wsum = 1.0;
        vec2 dir = (vec2(0.5) - uv) * uZoom;
        float j = h12(gl_FragCoord.xy + uTime);
        for (int i = 1; i <= 10; i++) { float f = (float(i) + j) / 10.0; float w = 1.0 - f * 0.6; acc += texture2D(tDiffuse, uv + dir * f).rgb * w; wsum += w; }
        col = acc / wsum;
      }
      // bloom (tent-filtered top mip of the dual-filter chain) and crepuscular rays
      { vec2 o = uBTexel;
        vec3 b = texture2D(tBloom, uv).rgb * 4.0 + (texture2D(tBloom, uv + vec2(-o.x, 0.0)).rgb + texture2D(tBloom, uv + vec2(o.x, 0.0)).rgb + texture2D(tBloom, uv + vec2(0.0, -o.y)).rgb + texture2D(tBloom, uv + vec2(0.0, o.y)).rgb) * 2.0
               + texture2D(tBloom, uv - o).rgb + texture2D(tBloom, uv + o).rgb + texture2D(tBloom, uv + vec2(-o.x, o.y)).rgb + texture2D(tBloom, uv + vec2(o.x, -o.y)).rgb;
        col += b / 16.0 * uBS;
        if (uRayOn > 0.5) col += texture2D(tRays, uv).rgb * uRay; }
      // flare ghosts + anamorphic streak for each bright light
      vec3 fl = vec3(0.0);
      float dirtLight = 0.0;
      if (uFlare > 0.001) for (int i = 0; i < 3; i++) {
        float I = uL[i].z; if (I <= 0.0) continue;
        vec2 L = uL[i].xy, c = vec2(0.5);
        vec2 toC = (c - L);
        float on = uL[i].w;
        // ghosts on the line through the optical centre
        for (int g = 0; g < 6; g++) {
          float k = g == 0 ? 0.35 : g == 1 ? 0.62 : g == 2 ? 0.9 : g == 3 ? 1.25 : g == 4 ? 1.6 : 2.05;
          float rad = g == 0 ? 0.03 : g == 1 ? 0.07 : g == 2 ? 0.02 : g == 3 ? 0.11 : g == 4 ? 0.05 : 0.16;
          vec3 tint = g == 0 ? vec3(0.4, 0.7, 1.0) : g == 1 ? vec3(0.6, 1.0, 0.7) : g == 2 ? vec3(1.0, 0.6, 0.3) : g == 3 ? vec3(0.5, 0.6, 1.0) : g == 4 ? vec3(1.0, 0.5, 0.8) : vec3(0.45, 0.8, 1.0);
          vec2 gp = L + toC * k;
          vec2 q = (uv - gp) * asp;
          float ring = disk(q, rad, rad * 0.35) * (0.35 + 0.65 * smoothstep(rad * 0.4, rad, length(q)));
          fl += tint * ring * 0.012 * I * on;
        }
        // halo around the optical centre when the light is near it
        float hd = length((uv - c) * asp), lr = length(toC * asp);
        fl += vec3(0.6, 0.75, 1.0) * exp(-((hd - 0.42) / 0.012) * ((hd - 0.42) / 0.012)) * 0.018 * I * on * smoothstep(0.6, 0.0, lr);
        // anamorphic streak
        vec2 dl = (uv - L) * asp;
        fl += uLC[i] * vec3(0.55, 0.75, 1.3) * exp(-abs(dl.y) * 420.0) * exp(-abs(dl.x) * 3.0) * 0.12 * I * on;
        fl += uLC[i] * exp(-length(dl) * 12.0) * 0.035 * I * on;
        // aperture starburst: six diffraction spikes plus a fan of fine, uneven rays (a real 6-blade iris)
        float r = length(dl), th = atan(dl.y, dl.x) + 0.21;
        float spk = pow(abs(cos(th * 3.0)), 900.0) * 1.0 + pow(abs(cos(th * 3.0 + 1.5708)), 1400.0) * 0.35;
        float fa = (th + 3.1416) * 60.0, fi = floor(fa), ff = smoothstep(0.0, 1.0, fract(fa));
        float fine = mix(h12(vec2(fi, float(i))), h12(vec2(mod(fi + 1.0, 377.0), float(i))), ff); fine = fine * fine * fine * fine;
        float burst = (spk + fine * 0.22) * exp(-r * 7.0) / (1.0 + r * 40.0);
        fl += uLC[i] * burst * 0.55 * I * on;
        dirtLight += I * on * exp(-length(dl) * 1.6);
      }
      // lens dirt: smudges lit only near bright lights
      if (uDirt > 0.001) {
      vec2 dq = uv * asp * 7.0; vec2 id = floor(dq), f = fract(dq) - 0.5;
      float sm = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y)), cid = id + o;
        float h = h12(cid); if (h < 0.55) continue;
        vec2 p = o + vec2(h12(cid + 3.1), h12(cid + 7.7)) - 0.5 - f;
        float r = 0.15 + 0.35 * h12(cid + 1.3);
        sm += (1.0 - smoothstep(r * 0.5, r, length(p))) * (0.3 + 0.7 * h);
      }
      col += vec3(0.8, 0.85, 1.0) * sm * dirtLight * 0.008 * uDirt;
      }
      col += fl * uFlare;
            vec3 c = srgb(aces(col));

      c = pow(max(c * uGain + uLift * (1.0 - c), 0.0), 1.0 / uGamma);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      c *= 1.0 - uVig * smoothstep(0.35, 1.05, length(d));
      float g = h12(floor(vUv * uRes)) - 0.5;            // static: a dither that never moves cannot read as grain
      c += g * uGrain * smoothstep(0.015, 0.12, l) * (1.0 - l);        // anti-banding dither in the mid-tones only: never on black space, the Sun or white highlights
      c = mix(c, vec3(0.0), uFade);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function createPipeline(renderer, layers, Q) {
  const layer = new LayerPass(layers, Q.msaa);
  const temporal = new TemporalPass(), meter = new MeterPass(), bloom = new PhysBloomPass(Q.bloomLevels || 7);
  const hazeRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const finalMat = new THREE.ShaderMaterial({ ...FinalShader, uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms), depthTest: false, depthWrite: false, toneMapped: false });
  const finalQuad = new FullScreenQuad(finalMat);
  const distort = { enabled: false };
  const final = {
    tag: 'final',
    render(renderer) {
      const u = finalMat.uniforms;
      u.tDiffuse.value = temporal.out.texture; u.tBloom.value = bloom.mips[0].texture; u.tRays.value = bloom.rays.texture;
      u.uBTexel.value.copy(bloom.uBTexel); u.uBS.value = bloom.uBS; u.uRay.value.copy(bloom.uRay); u.uRayOn.value = bloom.rayOn ? 1 : 0;
      u.toneMappingExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(null); finalQuad.render(renderer);
    },
  };
  const passes = [layer, temporal, meter, bloom, final];
  function render() {
    temporal.haze = distort.enabled ? hazeRT : null;
    passes[0].render(renderer);
    passes[1].render(renderer, layer.rt.texture);
    passes[2].render(renderer, temporal.out);
    passes[3].render(renderer, temporal.out);
    passes[4].render(renderer);
  }
  function setSize() {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    layer.setSize(s.x, s.y); temporal.setSize(s.x, s.y); bloom.setSize(s.x, s.y);
    hazeRT.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1));
    finalMat.uniforms.uRes.value.copy(s);
  }
  setSize();
  // compile every post program at load, including the rays (otherwise first used minutes into the film)
  function warm() { const r = bloom.rayI; bloom.rayI = 0.01; render(); bloom.rayI = r; temporal.reset(); }
  const U = { uniforms: finalMat.uniforms };
  // live quality change: MSAA samples of the one multisampled target (re-allocated on next use)
  function setSamples(n) { if (layer.rt.samples !== n) { layer.rt.dispose(); layer.rt.samples = n; } }
  return { render, collect: () => meter.collect(renderer), setSize, setSamples, warm, passes, layerTarget: layer.rt, bloom, lens: U, grade: U, temporal, meter, distort, hazeRT };
}
