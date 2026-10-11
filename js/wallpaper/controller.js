// Wallpaper Engine controller. All rendering stays in js/beyond; this file only steers it through window.__beyond.
//
//   Modes   A LANDING    Earth + engines; three views chosen by the cursor (or pinned), idle drift   (default)
//           B INSPECT    free orbit round a chosen hero asset; drag / wheel; slow auto-rotate when left alone
//           C CINEMATIC  the film on its own scripted camera; plays ONLY from the panel's Play control
//           D FLIGHT     a guided flight along the film's chapter-1 path; the cursor sets speed and direction
//   Every mode shares one scene, one lighting set-up and one look; switching never rebuilds anything. Switches are
//   eased camera flights (or, across a big jump in the voyage's time, a short dip through black).
//
//   Playback starts only from an explicit control (the panel's Play button). There is no click listener on the
//   window, the document or the canvas: clicks on empty space, right-clicks and mouse movement never start it.
//   The panel is plain HTML/CSS (no WebGL draw calls), updated only when its state changes.
import { createInteractive, createBlend, T_WORLD, VIEWS } from './interactive.js';
const W = window.__WALLPAPER;

const MODES = [['landing', 'LANDING'], ['inspect', 'INSPECT'], ['cinematic', 'CINEMATIC'], ['flight', 'FLIGHT']];
const ASSETS = [['engines', 'ENGINES'], ['elevator', 'ELEVATOR'], ['ring', 'STATION'], ['flagship', 'FLAGSHIP'], ['steer', 'STEERING'], ['earth', 'EARTH'], ['moon', 'MOON'], ['saturn', 'SATURN'], ['sun', 'SUN']];
const RAIL = [6.5, 31];          // flight: the film's chapter-1 camera path (engines → elevator → ring → fleet → Earth)
const CH_SHORT = ['IGNITION', 'SOLAR SYSTEM', 'OUTER PLANETS', 'INTERSTELLAR', 'MILKY WAY', 'NEW SUN'];
const TIERS = [['low', 'LOW'], ['medium', 'MED'], ['high', 'HIGH'], ['ultra', 'ULTRA']];

const cfg = {
  mode: 'landing', autoplay: false, loop: false, sens: 1, idleSec: 8, modeReturn: 90, panel: true, autoCollapse: 5, startExpanded: false, panelPos: 'tr', panelTop: 0, filmAfter: 0,
  orbit: 0.03, audioOn: true, audioK: 0.5, music: false, volume: 0.6, captions: true, cards: true, letterbox: false,
  clock: true, clock24: true, clockPos: 'bl', telemetry: true, bright: 1, scale: 1, fps: 0, fpsCap: 0, idleSave: true, accent: null, quality: null,
};
// what the viewer chose in the panel (remembered for the session)
const ui = { mode: null, view: null, asset: 'engines', loop: false, quality: null, filmT: T_WORLD, expanded: false, speed: 1 };

let B = null, ia = null, blend = null, ready = false, paused = false, lastT = 0, lastDraw = 0, level = 0, lastMove = -1e9, modeSince = 0;
const par = { x: 0, y: 0, tx: 0, ty: 0 };
const fade = { v: 0, to: 0, rate: 1, then: null };
const flight = { r: RAIL[0], v: 0.3, dir: 1 };
const mouse = { x: 0.5, y: 0.5 };

const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const on = (cls, v) => document.body.classList.toggle(cls, !!v);
const save = () => { try { sessionStorage.setItem('wp-ui', JSON.stringify(ui)); } catch (e) { /* no storage: session memory only */ } };

// ------------------------------------------------------------------ properties (applied live, never a reload)
function readUser(p) {
  const v = k => p[k] && p[k].value, has = k => p[k] != null;
  if (has('defaultmode')) cfg.mode = v('defaultmode');
  if (has('autoplay')) cfg.autoplay = !!v('autoplay');
  if (has('loopfilm')) cfg.loop = !!v('loopfilm');
  if (has('sensitivity')) cfg.sens = +v('sensitivity') / 100;
  if (has('idletimeout')) cfg.idleSec = +v('idletimeout');
  if (has('modereturn')) cfg.modeReturn = +v('modereturn');
  if (has('panel')) cfg.panel = !!v('panel');
  if (has('autocollapse')) cfg.autoCollapse = +v('autocollapse');
  if (has('startexpanded')) cfg.startExpanded = !!v('startexpanded');
  if (has('panelposition')) cfg.panelPos = v('panelposition');
  if (has('paneltop')) cfg.panelTop = +v('paneltop');
  if (has('filmafter')) cfg.filmAfter = +v('filmafter') * 60;
  if (has('orbitspeed')) cfg.orbit = +v('orbitspeed') / 1000;
  if (has('audioreactive')) cfg.audioOn = !!v('audioreactive');
  if (has('audiostrength')) cfg.audioK = +v('audiostrength') / 100;
  if (has('music')) cfg.music = !!v('music');
  if (has('volume')) cfg.volume = +v('volume') / 100;
  if (has('captions')) cfg.captions = !!v('captions');
  if (has('chaptercards')) cfg.cards = !!v('chaptercards');
  if (has('letterbox')) cfg.letterbox = !!v('letterbox');
  if (has('clock')) cfg.clock = !!v('clock');
  if (has('clock24')) cfg.clock24 = !!v('clock24');
  if (has('clockposition')) cfg.clockPos = v('clockposition');
  if (has('telemetry')) cfg.telemetry = !!v('telemetry');
  if (has('brightness')) cfg.bright = +v('brightness') / 100;
  if (has('renderscale')) cfg.scale = +v('renderscale') / 100;
  if (has('fpscap')) cfg.fpsCap = +v('fpscap');
  if (has('idlepowersave')) cfg.idleSave = !!v('idlepowersave');
  if (has('schemecolor')) cfg.accent = v('schemecolor');
  if (has('quality')) cfg.quality = v('quality');
}
function applyLook() {
  const app = B.app;
  on('wp-nocap', !cfg.captions); on('wp-nocards', !cfg.cards); on('wp-letterbox', cfg.letterbox);
  on('wp-noclock', !cfg.clock); on('wp-notele', !cfg.telemetry); on('wp-nopanel', !cfg.panel);
  for (const p of ['tl', 'tr', 'bl', 'br']) on('wp-clock-' + p, cfg.clockPos === p);
  if (cfg.accent) {
    const [r, g, b] = String(cfg.accent).split(' ').map(x => Math.round(clamp(+x, 0, 1) * 255));
    document.documentElement.style.setProperty('--ice', `rgb(${r},${g},${b})`);
    document.documentElement.style.setProperty('--ice-dim', `rgba(${r},${g},${b},.6)`);
  }
  app.evMul = cfg.bright; app.orbitSpeed = cfg.orbit;
  if (Math.abs(app.renderScale - cfg.scale) > 0.001) { app.renderScale = cfg.scale; B.resize(); }
  B.Sound.setVolume(cfg.volume); B.Sound.setMuted(!cfg.music); if (cfg.music) B.Sound.start();
  ia.setIdle(cfg.idleSec); ia.setSensitivity(cfg.sens);
}
function setQuality(q) {
  if (!B.TIERS[q]) return;
  ui.quality = q; B.setTier(q);
  try { localStorage.setItem('wp-quality', q); } catch (e) { /* next start uses the property */ }   // instance budgets follow at the next start
  save(); refresh();
}

// ------------------------------------------------------------------ modes
const drivers = {
  landing: (cam, dt) => { ia.update(cam, dt, performance.now()); blend.apply(cam); },
  cinematic: cam => { B.evalCamera(B.keys, B.app.t, B.anchorArt, cam); blend.apply(cam); },
  flight: cam => { B.evalCamera(B.keys, flight.r, B.anchorArt, cam); blend.apply(cam); },
};
function worldTimeOf(mode) { return mode === 'cinematic' ? ui.filmT : mode === 'flight' ? flight.r : T_WORLD; }
function leaveIntro() { const app = B.app; if (app.mode === 'intro') { $('start').classList.add('gone'); $('hud').classList.add('on'); app.prelude = false; } }
// switch mode: an eased flight between the two cameras, or — across a big jump in the voyage's time, where the world
// itself would visibly change — a short dip through black
function switchMode(next, opt = {}) {
  const app = B.app; if (!drivers[next] && next !== 'inspect') return;
  if (ui.mode === 'cinematic' && app.mode === 'story') ui.filmT = app.t;
  const far = app.mode === 'intro' || Math.abs(worldTimeOf(next) - app.t) > 25 || opt.cut;
  ui.mode = next; save(); refresh(); modeSince = performance.now();
  const go = snap => { enter(next, opt, snap); if (snap) { blend.stop(); app.snapCam = true; B.snap(); } };
  if (far) fadeTo(1, app.mode === 'intro' ? 0.01 : 0.45, () => { go(true); fadeTo(0, 1.1); });
  else go(false);
}
function enter(mode, opt, snap) {
  const app = B.app; leaveIntro();
  app.hooks.onEnd = null; app.freeIgn = null;
  if (mode === 'inspect') {
    app.hooks.camera = null; B.setMode('free'); app.playing = false; app.t = T_WORLD;
    inspect(ui.asset, snap);
    return;
  }
  if (!snap) blend.start(mode === 'cinematic' ? 3200 : 2600);
  if (mode === 'landing') { B.setMode('free'); app.free = null; app.playing = false; app.t = T_WORLD; ia.pin(ui.view); ia.reset(); }
  else if (mode === 'flight') { B.setMode('free'); app.free = null; app.playing = false; app.t = flight.r; }
  else if (mode === 'cinematic') {
    B.setMode('story'); app.free = null; app.prelude = false; app.ended = false; app.t = opt.t ?? ui.filmT;
    app.lastChapter = -1; app.lastCap = -1; app.playing = !!opt.play;
    app.hooks.onEnd = onFilmEnd;
  }
  app.hooks.camera = drivers[mode];
}
function inspect(key, snap) {
  ui.asset = key; save(); refresh();
  B.focus(key);
  const f = B.app.free; if (f && f.fly && snap) f.fly.dur = 1;            // (behind a fade: jump)
  if (cfg.cards) titleCard(key);
}
// ---- playback: only ever from the Play control
function playPause() {
  const app = B.app;
  if (ui.mode !== 'cinematic') { switchMode('cinematic', { play: true }); return; }
  if (app.ended || app.t >= B.DURATION - 0.05) { restart(); return; }
  app.playing = !app.playing; refresh();
}
function restart() {           // from the very beginning: the countdown and ignition, behind a dip through black
  const app = B.app; app.playing = false;
  ui.mode = 'cinematic'; refresh();
  fadeTo(1, 0.5, () => {
    leaveIntro(); app.mode = 'intro'; app.t = -9; B.startStory(0);             // flows on through the prelude (3 · 2 · 1 · ignition)
    app.hooks.camera = drivers.cinematic; app.hooks.onEnd = onFilmEnd; blend.stop(); app.snapCam = true; B.snap();
    fadeTo(0, 1.2); refresh();
  });
}
function onFilmEnd() {        // one-shot: back to the landing view · loop: from the top, behind a dip through black
  const app = B.app; app.playing = false; app.hooks.onEnd = null; ui.filmT = T_WORLD;
  if (ui.loop) restart(); else switchMode('landing');
  refresh();
}
function seekChapter(i) {
  const app = B.app, ch = B.CHAPTERS[i]; if (!ch || ui.mode !== 'cinematic') return;
  const t = ch.t + 0.01;
  if (Math.abs(t - app.t) < 2) return;
  fadeTo(1, 0.4, () => { app.t = t; app.prelude = false; app.ended = false; ui.filmT = t; blend.stop(); app.snapCam = true; B.snap(); fadeTo(0, 1.0); });
}
function titleCard(key) {
  const h = B.HOT.find(h => h.key === key) || {};
  const title = h.name || '', kick = h.kicker || '';
  $('cd-n').textContent = kick; $('cd-k').textContent = '';
  const gl = [...title], mid = (gl.length - 1) / 2;
  $('cd-t').innerHTML = gl.map((c, i) => `<span style="--i:${i};--x:${((i - mid) / Math.max(mid, 1)).toFixed(3)}">${c === ' ' ? ' ' : c}</span>`).join('');
  const card = $('card'); card.classList.remove('on'); void card.offsetWidth; card.classList.add('on');
  clearTimeout(titleCard.t); titleCard.t = setTimeout(() => card.classList.remove('on'), 4800);
}
function fadeTo(v, sec, then) { fade.to = v; fade.rate = 1 / Math.max(sec, 0.01); fade.then = then || null; if (fade.v === v && then) { fade.then = null; then(); } }

// ------------------------------------------------------------------ per frame (called before every rendered frame)
function gate(now) {
  if (paused) { lastT = now; return false; }
  if (W.cap > 0 && W.cap < 1e9) { const iv = 1000 / W.cap; if (now - lastDraw < iv - 1.5) return false; lastDraw = now - ((now - lastDraw) % iv); }
  const dt = Math.min((now - (lastT || now)) / 1000, 0.1); lastT = now;
  const app = B.app;
  // fps: the lowest of Wallpaper Engine's limit, the tier / panel cap and (when the mouse rests) the power saver
  const idle = now - lastMove > cfg.idleSec * 1000;
  const cap = [cfg.fps, cfg.fpsCap || B.Q.fps].filter(f => f > 0).reduce((a, b) => Math.min(a, b), 1e9);
  W.cap = cfg.idleSave && idle ? Math.min(cap, 30) : cap; app.frameBudget = 1000 / W.cap;
  // flight: the cursor sets speed and direction along the rail (centre = a slow cruise), reversing softly at the ends
  if (ui.mode === 'flight' && app.hooks.camera === drivers.flight) {
    const mx = idle ? 0.5 : mouse.x, s = Math.abs(mx - 0.5) < 0.08 ? 0 : (mx - 0.5) * 2;
    if (flight.r >= RAIL[1] - 0.3) flight.dir = -1; else if (flight.r <= RAIL[0] + 0.3) flight.dir = 1;
    const want = (s !== 0 ? s * 1.6 : 0.3 * flight.dir) * ui.speed;
    flight.v += (want - flight.v) * (1 - Math.exp(-dt * 1.5));
    flight.r = clamp(flight.r + flight.v * dt, RAIL[0], RAIL[1]); app.t = flight.r;
  }
  // the lean towards the cursor (cinematic and flight; landing and inspect have their own camera control)
  const k = 1 - Math.exp(-dt * 2.5), pk = ui.mode === 'cinematic' || ui.mode === 'flight' ? 0.5 * cfg.sens : 0;
  par.x += (par.tx * pk - par.x) * k; par.y += (par.ty * pk - par.y) * k;
  app.par = app.par || { x: 0, y: 0 }; app.par.x = par.x; app.par.y = par.y;
  // audio: fast attack, slow release
  const target = cfg.audioOn ? clamp(level * cfg.audioK * 1.6, 0, 0.6) : 0;
  app.audio += (target - app.audio) * (1 - Math.exp(-dt * (target > app.audio ? 16 : 2.5)));
  // fades
  if (fade.v !== fade.to) {
    fade.v += Math.sign(fade.to - fade.v) * Math.min(Math.abs(fade.to - fade.v), dt * fade.rate);
    B.pipe.grade.uniforms.uFade.value = fade.v * fade.v * (3 - 2 * fade.v);
    if (fade.v === fade.to && fade.then) { const f = fade.then; fade.then = null; f(); }
  }
  // back to the landing view after a while without interaction (inspect / flight), opt-in film after a long rest
  if ((ui.mode === 'inspect' || ui.mode === 'flight') && cfg.modeReturn > 0 && now - Math.max(lastMove, modeSince) > cfg.modeReturn * 1000 && !fade.then) switchMode('landing');
  if (ui.mode === 'landing' && cfg.filmAfter > 0 && now - Math.max(lastMove, modeSince) > cfg.filmAfter * 1000 && !fade.then) switchMode('cinematic', { play: true });
  return true;
}

// ------------------------------------------------------------------ control panel (HTML/CSS only)
const IC = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 4.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.2 4.4v5.6h5.6z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7.5h14M5 12h14M5 16.5h14" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
};
let panel, tab, ctx, prog, ctxFor = null;
function buildPanel() {
  const seg = (group, items) => `<div class="wpp-seg" data-group="${group}">${items.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
  panel = document.createElement('div'); panel.id = 'wp-panel'; panel.setAttribute('role', 'toolbar'); panel.setAttribute('aria-label', 'Wallpaper controls');
  // compact (three short rows) so the panel stays clear of the landing view's subject below and left of it
  panel.innerHTML = `<div class="wpp-row">
      <button type="button" class="wpp-ic wpp-play" data-act="play" title="Play / pause the film">${IC.play}</button>
      <button type="button" class="wpp-ic" data-act="restart" title="Play the film from the beginning">${IC.restart}</button>
      <i class="wpp-sep"></i>${seg('mode', MODES)}
      <button type="button" class="wpp-ic wpp-close" data-act="close" title="Close the panel" aria-label="Close the panel">${IC.close}</button>
    </div>
    <div class="wpp-row wpp-sub"><span class="wpp-lab">FILM</span>${seg('loop', [['once', 'ONE-SHOT'], ['loop', 'LOOP']])}<span class="wpp-lab">QUALITY</span>${seg('quality', TIERS)}</div>
    <div class="wpp-row wpp-ctx" id="wpp-ctx"></div>
    <div class="wpp-prog"><i id="wpp-prog"></i></div>`;
  // the collapsed indicator: one small icon button, reachable with Tab + Enter, the panel's only hit area while collapsed
  tab = document.createElement('button'); tab.id = 'wp-tab'; tab.type = 'button'; tab.title = 'Controls'; tab.setAttribute('aria-label', 'Controls');
  tab.setAttribute('aria-controls', 'wp-panel'); tab.setAttribute('aria-expanded', 'false'); tab.innerHTML = IC.menu;
  document.body.append(panel, tab);
  ctx = $('wpp-ctx'); prog = $('wpp-prog');
  // the panel owns its pointer input: nothing falls through to the scene, and a click never moves keyboard focus.
  // Any input on the panel restarts the auto-collapse timer.
  for (const el of [panel, tab]) {
    el.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); panelTouched(); });
    el.addEventListener('mousemove', e => { e.stopPropagation(); if (el === panel) panelTouched(); }, { passive: true });
    el.addEventListener('wheel', e => { e.stopPropagation(); panelTouched(); }, { passive: true });
    el.addEventListener('keydown', e => { e.stopPropagation(); panelTouched(); if (e.key === 'Escape') setExpanded(false); });
  }
  panel.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    const g = b.parentElement.dataset.group, v = b.dataset.v, act = b.dataset.act;
    if (act === 'play') playPause();
    else if (act === 'restart') restart();
    else if (act === 'close') setExpanded(false);
    else if (g === 'mode') { if (v !== ui.mode) switchMode(v); }
    else if (g === 'loop') { ui.loop = v === 'loop'; save(); refresh(); }
    else if (g === 'quality') setQuality(v);
    else if (g === 'view') { ui.view = v === 'auto' ? null : +v; ia.pin(ui.view); save(); refresh(); }
    else if (g === 'asset') { if (ui.mode === 'inspect') inspect(v, false); }
    else if (g === 'chapter') seekChapter(+v);
    else if (g === 'speed') { ui.speed = +v; save(); refresh(); }
  });
  tab.addEventListener('click', e => { e.stopPropagation(); setExpanded(!ui.expanded); });   // the ONLY way to open it (no hover, no mouse-move)
  addEventListener('resize', place);
}
// the context row follows the mode: views · assets · chapters · flight speed (rebuilt only when the mode changes)
function buildCtx() {
  if (ctxFor === ui.mode) return; ctxFor = ui.mode;
  const seg = (group, items, label) => `<span class="wpp-lab">${label}</span><div class="wpp-seg wpp-small" data-group="${group}">${items.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
  ctx.innerHTML = ui.mode === 'landing' ? seg('view', [['auto', 'FOLLOW CURSOR'], ...VIEWS.map((V, i) => [String(i), V.name])], 'CAMERA')
    : ui.mode === 'inspect' ? seg('asset', ASSETS, 'ASSET') + '<span class="wpp-hint">drag to orbit · wheel to zoom</span>'
    : ui.mode === 'cinematic' ? seg('chapter', CH_SHORT.map((l, i) => [String(i), '0' + (i + 1) + ' ' + l]), 'CHAPTER')
    : seg('speed', [['0.5', 'SLOW'], ['1', 'CRUISE'], ['2', 'FAST']], 'SPEED') + '<span class="wpp-hint">cursor left · back &nbsp;|&nbsp; right · forward</span>';
  if (ui.expanded) place();                               // the panel's width changed: re-clamp it into the viewport
}
function refresh() {           // state → classes (no per-frame DOM work)
  if (!panel) return;
  buildCtx();
  const sel = (g, v) => panel.querySelectorAll(`[data-group="${g}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  sel('mode', ui.mode); sel('loop', ui.loop ? 'loop' : 'once'); sel('quality', ui.quality || B.Q.tier);
  sel('view', ui.view == null ? 'auto' : String(ui.view)); sel('asset', ui.asset); sel('speed', String(ui.speed));
  const playing = ui.mode === 'cinematic' && B.app.playing;
  const pb = panel.querySelector('.wpp-play'); if (pb.dataset.s !== String(playing)) { pb.dataset.s = String(playing); pb.innerHTML = playing ? IC.pause : IC.play; pb.title = playing ? 'Pause' : 'Play the film'; }
  on('wpp-cine', ui.mode === 'cinematic');
}
// ---- expand / collapse. Collapsed: only the indicator exists for the pointer (the panel is visibility:hidden, no
// hit area). Expanded: the panel's own box takes pointer input; everywhere else input reaches the scene as before.
let lastPanel = 0;
function panelTouched() { lastPanel = performance.now(); }
function outside(e) { if (!panel.contains(e.target) && e.target !== tab && !tab.contains(e.target)) setExpanded(false); }   // (no stopPropagation: the scene still gets this click / drag)
function setExpanded(x) {
  x = !!x && cfg.panel;
  if (x === ui.expanded && panel.classList.contains('show') === x) return;
  ui.expanded = x; save(); panelTouched();
  if (x) place();
  panel.classList.toggle('show', x); tab.setAttribute('aria-expanded', String(x)); tab.classList.toggle('open', x);
  // click-outside-to-collapse: a capture-phase pointerdown listener that exists only while the panel is open
  if (x) document.addEventListener('pointerdown', outside, true); else document.removeEventListener('pointerdown', outside, true);
}
// ---- placement: top edge, inside the screen's work area (the taskbar may be at the top or a side); the panel hangs
// below the indicator and is clamped into the viewport by its own measured box. Runs on open and on resize only.
function workInsets() {
  const s = window.screen || {}, full = Math.abs(innerWidth - (s.width || innerWidth)) < 4 && Math.abs(innerHeight - (s.height || innerHeight)) < 4;
  if (!full) return { top: 0, left: 0, right: 0 };        // not a full-screen window: no OS chrome inside the viewport to avoid
  const top = Math.max(0, s.availTop || 0), left = Math.max(0, s.availLeft || 0);
  return { top, left, right: Math.max(0, (s.width || 0) - (s.availWidth || s.width || 0) - left) };
}
function place() {
  if (!panel) return;
  const ins = workInsets(), m = 16, top = ins.top + m + cfg.panelTop, W0 = innerWidth;
  const tw = tab.offsetWidth || 36;
  const tx = cfg.panelPos === 'tl' ? ins.left + m : cfg.panelPos === 'tc' ? (W0 - tw) / 2 : W0 - ins.right - m - tw;
  tab.style.left = `${Math.round(tx)}px`; tab.style.top = `${Math.round(top)}px`;
  const pw = Math.min(panel.offsetWidth || 560, 560, W0 - ins.left - ins.right - 2 * m);
  panel.style.maxWidth = `${Math.round(Math.min(560, W0 - ins.left - ins.right - 2 * m))}px`;
  let px = cfg.panelPos === 'tl' ? tx : cfg.panelPos === 'tc' ? (W0 - pw) / 2 : tx + tw - pw;
  px = clamp(px, ins.left + m, W0 - ins.right - m - pw);
  panel.style.left = `${Math.round(px)}px`; panel.style.top = `${Math.round(top + (tab.offsetHeight || 36) + 8)}px`;
}
function tick() {               // 4 Hz: auto-collapse, film progress, chapter highlight, play state
  if (!ready || !panel) return;
  if (ui.expanded && cfg.autoCollapse > 0 && performance.now() - lastPanel > cfg.autoCollapse * 1000) setExpanded(false);
  if (ui.mode === 'cinematic') {
    const app = B.app, f = clamp(app.t / B.DURATION, 0, 1).toFixed(3);
    if (prog.dataset.f !== f) { prog.dataset.f = f; prog.style.transform = `scaleX(${f})`; }
    const ci = B.CHAPTERS.reduce((c, ch, i) => (app.t >= ch.t ? i : c), 0);
    if (tick.ci !== ci) { tick.ci = ci; panel.querySelectorAll('[data-group="chapter"] button').forEach((b, i) => b.classList.toggle('on', i === ci)); }
    const pl = String(app.playing); if (tick.pl !== pl) { tick.pl = pl; refresh(); }
  } else tick.ci = tick.pl = null;
}

// ------------------------------------------------------------------ input (no click listener outside the panel)
function bindInput() {
  const canvas = B.renderer.domElement;
  addEventListener('mousemove', e => {
    const x = e.clientX / innerWidth, y = e.clientY / innerHeight, n = performance.now();
    lastMove = n;
    mouse.x = x; mouse.y = y; par.tx = -(x - 0.5) * 0.12; par.ty = -(y - 0.5) * 0.07; ia.move(x, y, n);
  }, { passive: true });
  addEventListener('mouseleave', () => { par.tx = par.ty = 0; });
  // inspect: drag to orbit, wheel to zoom (primary button only; right-click does nothing)
  let drag = null;
  canvas.addEventListener('pointerdown', e => { if (ui.mode !== 'inspect' || e.button !== 0 || !B.app.free) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || !B.app.free) return;
    const F = B.app.free, dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    F.ty = (F.ty ?? F.yaw) - dx * 0.005 * cfg.sens; F.tp = clamp((F.tp ?? F.pitch) + dy * 0.004 * cfg.sens, -1.4, 1.4); F.fly = null; B.app.lastInput = performance.now();
  });
  const up = () => { drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    if (ui.mode !== 'inspect' || !B.app.free) return;
    const F = B.app.free, dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    F.td = clamp((F.td ?? F.d) * Math.exp(dy * 0.0016), B.minDist(F.anchor), 1.6e5 * B.ART_PER_LY); F.fly = null; B.app.lastInput = performance.now();
  }, { passive: true });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // keyboard (if the host forwards it): 1–4 modes, ← → views / assets / chapters, H panel. Never starts playback.
  addEventListener('keydown', e => {
    const k = e.key;
    if (k >= '1' && k <= '4') { const m = MODES[+k - 1][0]; if (m !== ui.mode) switchMode(m); }
    else if (k === 'h' || k === 'H') setExpanded(!ui.expanded);
    else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const d = k === 'ArrowRight' ? 1 : -1;
      if (ui.mode === 'landing') { const i = ui.view == null ? 1 : ui.view; ui.view = (i + d + 3) % 3; ia.pin(ui.view); refresh(); }
      else if (ui.mode === 'inspect') { const i = ASSETS.findIndex(a => a[0] === ui.asset); inspect(ASSETS[(i + d + ASSETS.length) % ASSETS.length][0], false); }
      else if (ui.mode === 'cinematic') { const ci = B.CHAPTERS.reduce((c, ch, i) => (B.app.t >= ch.t ? i : c), 0); seekChapter(clamp(ci + d, 0, B.CHAPTERS.length - 1)); }
    }
  });
}

// ------------------------------------------------------------------ clock
function clock() {
  const d = new Date(), h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const hh = cfg.clock24 ? String(h).padStart(2, '0') : String(h % 12 || 12);
  $('wc-t').textContent = `${hh}:${m}`; $('wc-ap').textContent = cfg.clock24 ? '' : (h < 12 ? 'AM' : 'PM');
  $('wc-d').textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/,/g, ' ·');
}

// ------------------------------------------------------------------ host messages
function onMessage(kind, p) {
  if (kind === 'user') {
    const prev = { mode: cfg.mode, loop: cfg.loop, quality: cfg.quality };
    readUser(p); if (!ready) return;
    applyLook();
    // mirror the wallpaper settings into the panel: one consistent UI
    if (p.loopfilm) { ui.loop = cfg.loop; save(); }
    if (p.quality && cfg.quality !== prev.quality) setQuality(cfg.quality);
    if (p.defaultmode && cfg.mode !== prev.mode) switchMode(cfg.mode, { play: cfg.mode === 'cinematic' && cfg.autoplay });
    if (p.startexpanded) setExpanded(cfg.startExpanded);           // live: the settings toggle opens / closes the panel (click-through fallback)
    if (p.panel && !cfg.panel) setExpanded(false);
    place(); refresh();
  } else if (kind === 'general') { if (p.fps != null) cfg.fps = +p.fps; }
  else if (kind === 'paused') { paused = !!p; if (ready) { if (paused) B.Sound.stop(); else if (cfg.music) B.Sound.start(); } }
}
function boot() {
  B = window.__beyond;
  document.body.classList.add('wp');
  { const slot = $('wp-tele-slot'), data = $('data'); if (slot && data) slot.appendChild(data);      // telemetry stacks under the clock
    for (const id of ['d-engine', 'd-coord', 'd-fov']) { const r = $(id) && $(id).closest('.g-row'); if (r) r.classList.add('wp-hide'); } }   // (kept in the DOM: the HUD still writes them)
  ia = createInteractive(B); blend = createBlend(B);
  B.app.hooks.gate = gate; window.__wp = { cfg, ui, ia, switchMode, playPause };   // (inspection from the console)
  readUser(W.props); cfg.fps = +(W.general.fps || 0); paused = !!W.paused;
  // session memory (a reload within the session keeps the viewer's choices), else the wallpaper settings
  let mem = null; try { mem = JSON.parse(sessionStorage.getItem('wp-ui') || 'null'); } catch (e) { /* none */ }
  Object.assign(ui, mem || {}, { mode: null, expanded: false }); if (!mem) ui.loop = cfg.loop;
  ready = true;
  buildPanel(); bindInput(); applyLook();
  { const q = ui.quality || cfg.quality; if (q && q !== B.Q.tier) setQuality(q); }
  W.listeners.push(onMessage);
  document.addEventListener('visibilitychange', () => onMessage('paused', document.hidden));
  if (window.wallpaperRegisterAudioListener) window.wallpaperRegisterAudioListener(a => { let s = 0; for (let i = 0; i < 6; i++) s += (a[i] || 0) + (a[64 + i] || 0); level = s / 12; });
  // first view: the default mode, faded in from black (the film plays now only if the user opted into autoplay)
  fade.v = 1; B.pipe.grade.uniforms.uFade.value = 1;
  switchMode((mem && mem.mode) || cfg.mode, { play: cfg.mode === 'cinematic' && cfg.autoplay });
  clock(); setInterval(clock, 1000); setInterval(tick, 250);
  refresh(); place();
  setExpanded(cfg.startExpanded);                                // always collapsed on load, unless "Start expanded" is set
}
(function wait() { if (window.__emReady && window.__beyond) boot(); else setTimeout(wait, 100); })();
