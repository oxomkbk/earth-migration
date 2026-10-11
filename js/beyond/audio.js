// Generative score: a sub-bass drone, a slowly changing chord pad per chapter, engine rumble, a shimmer
// for deep space, and low "booms" on the big reveals. WebAudio only — no files.
export const Sound = (() => {
  let ctx = null, master, rumble, drone, shimmer, padBus, muted = false, voices = [], vol = 1;
  const to = (p, v, tc) => p.setTargetAtTime(v, ctx.currentTime, tc);
  const CHORDS = [   // Hz — D minor (add 9) → F major 7 → A minor → E♭ lydian → D major (add 9)
    [73.4, 110, 146.8, 174.6, 220, 329.6],
    [87.3, 130.8, 174.6, 220, 261.6, 329.6],
    [55, 110, 164.8, 220, 261.6, 392],
    [77.8, 116.5, 155.6, 196, 233.1, 349.2],
    [73.4, 110, 146.8, 185, 220, 329.6],
    [65.4, 98, 130.8, 164.8, 196, 293.7],
  ];
  function init() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    // a long synthetic reverb
    const conv = ctx.createConvolver(), len = ctx.sampleRate * 5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    conv.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.55;
    master.connect(comp); master.connect(conv).connect(wet).connect(comp); comp.connect(ctx.destination);
    // rumble
    const nb = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = nb.getChannelData(c); let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } }
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    rumble = ctx.createGain(); rumble.gain.value = 0; src.connect(lp).connect(rumble).connect(master); src.start();
    // drone
    drone = ctx.createGain(); drone.gain.value = 0;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 260; dlp.Q.value = 3;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.04; lg.gain.value = 120; lfo.connect(lg).connect(dlp.frequency); lfo.start();
    for (const f of [36.7, 36.9, 55, 73.4]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.045; o.connect(g).connect(dlp); o.start(); }
    dlp.connect(drone).connect(master);
    // pad voices (retuned per chapter)
    padBus = ctx.createGain(); padBus.gain.value = 0;
    const plp = ctx.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 1800;
    padBus.connect(plp).connect(master);
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(); o.type = 'triangle'; o2.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0.03;
      const tr = ctx.createOscillator(), tg = ctx.createGain(); tr.frequency.value = 0.05 + Math.random() * 0.08; tg.gain.value = 0.018; tr.connect(tg).connect(g.gain); tr.start();
      o.connect(g); o2.connect(g); g.connect(padBus); o.start(); o2.start(); o2.detune.value = 7;
      voices.push([o, o2]);
    }
    // shimmer: high, airy partials for interstellar space
    shimmer = ctx.createGain(); shimmer.gain.value = 0;
    for (const f of [880, 1318.5, 1760, 2637]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.008; const tr = ctx.createOscillator(), tg = ctx.createGain(); tr.frequency.value = 0.1 + Math.random() * 0.2; tg.gain.value = 0.008; tr.connect(tg).connect(g.gain); tr.start(); o.connect(g).connect(shimmer); o.start(); }
    shimmer.connect(master);
    chord(0, 0.01);
  }
  function chord(i, tc = 2.5) { if (!ctx) return; const c = CHORDS[i % CHORDS.length]; voices.forEach(([a, b], k) => { to(a.frequency, c[k], tc); to(b.frequency, c[k] * 2, tc); }); }
  return {
    start() { try { if (!ctx) init(); if (!ctx) return; ctx.resume(); to(master.gain, muted ? 0 : 0.85 * vol, 0.8); } catch (e) { console.warn('Audio unavailable', e); } },
    chapter(i) { chord(i); },
    level({ drone: d = 0.5, rumble: r = 0.4, pad = 0.6, shimmer: s = 0 }) { if (!ctx) return; to(drone.gain, d * 0.55, 1.5); to(rumble.gain, r * 0.8, 1.5); to(padBus.gain, pad * 0.7, 2.0); to(shimmer.gain, s * 0.6, 2.5); },
    boom(f0 = 62, len = 5) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + len * 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(master); o.start(t); o.stop(t + len + 0.1);
    },
    stop() { if (ctx) to(master.gain, 0, 0.6); },
    toggle() { muted = !muted; if (ctx) to(master.gain, muted ? 0 : 0.85 * vol, 0.2); return !muted; },
    get muted() { return muted; },
    setMuted(m) { muted = !!m; if (ctx) to(master.gain, muted ? 0 : 0.85 * vol, 0.4); },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); if (ctx && !muted) to(master.gain, 0.85 * vol, 0.4); },
  };
})();
