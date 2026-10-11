// Mission-control dashboards for Video (film) and Free (explore) mode: a HUD frame of two large side consoles and a
// mission strip, wrapping a clear centre that belongs to the scene. Plain DOM + one 2D overlay canvas — nothing here
// touches the three.js scene graph.
//
//   PROPULSION (left, film)  thrust, engines online, the engine-array matrix, resonance trace, plasma core, trim, surface
//   NAVIGATION (right, both) velocity, the log-scale trajectory map, distances / light delay / ETA / heading / region,
//   optics (camera range, field, scale ladder), and an event log driven by the voyage timeline
//   MISSION STRIP (top)      ship clock, stage + chapter progress, MOSS link latency
//
// Performance: no own timers or rAF. main.js calls tick(now) from its single render loop; when the dashboards are
// inactive (other modes, hidden by the user, tab hidden) tick returns at once — zero DOM work, zero canvas work.
// Bars and the canvas update at ≤ 20 Hz, text at ≤ 10 Hz; every write is skipped when the value hasn't changed.
// Layout is read only at mount, on resize and after the entrance (never inside the update path).
//
// Data provenance: values marked REAL come from the scene / timeline state; DERIVED are computed from it with simple
// physics; DECOR are modulated decoration (they move with the real state but have no physical meaning).

const LOG_EVENTS = [            // the voyage's event log (film time → message); 1 = alert (amber)
  [0.4, 1, 'IGNITION · HERO ARRAY 26 / 26 LIT'], [2.2, 0, 'IGNITION FRONT PROPAGATING · TRAILING HEMISPHERE'],
  [6.5, 0, 'ALL ENGINES ONLINE · 10,000 / 10,000'], [10.5, 0, 'CLIMBER 01 · DEPARTED EQUATORIAL ANCHOR'],
  [23, 0, 'CLIMBER 01 · DOCKED · TIANSHU STATION'], [28, 0, 'NAVIGATOR FLEET · ESCORT FORMATION LOCKED'],
  [32, 0, 'STAGE 02 · SOLAR SYSTEM TRANSIT'], [41, 0, 'TIME COMPRESSION ENGAGED · 1 YR / 4 S'],
  [47.5, 1, 'SOLAR FLARE DETECTED · X-CLASS'], [50.2, 1, 'CORONAL MASS EJECTION · SHIELDING'],
  [54, 0, 'JUPITER APPROACH · GRAVITY ASSIST WINDOW'], [57, 1, 'PERIJOVE · DELTA-V +12.6 KM/S'],
  [59, 0, 'SATURN · RING-PLANE CROSSING'], [66, 0, 'STAGE 03 · BEYOND THE OUTER PLANETS'],
  [74.5, 1, 'KUIPER BELT · DEBRIS DENSITY ELEVATED'], [81, 1, 'HELIOPAUSE CROSSED · SOLAR WIND NULL'],
  [88, 0, 'STAGE 04 · INTERSTELLAR CRUISE'], [90, 0, 'BOW SHOCK STABLE · ISM 0.2 ATOM / CM³'],
  [98, 0, 'GENERATION 41 · UNDERGROUND CITIES NOMINAL'], [105, 0, 'ALPHA CEN A · B ACQUIRED · MAG −0.3'],
  [112, 0, 'STAGE 05 · LONG-RANGE SURVEY'], [128, 0, 'GALACTIC FRAME · ORION SPUR'],
  [147, 0, 'STAGE 06 · A NEW SUN'], [150, 1, 'DECELERATION BURN · FULL REVERSE THRUST'],
  [159, 0, 'ORBITAL CAPTURE · ALPHA CEN A'], [166, 1, 'SURFACE TEMPERATURE RISING · THAW DETECTED'],
];
const ACEN_LY = 4.37, C_KMS = 299792.458, KM_LY = 9.4607e12, KM_AU = 1.496e8;

export function createDash(ctx) {
  const { app, S, cam, U, CHAPTERS, DURATION } = ctx;
  let root, cv, g, dpr = 1, enabled = true, active = false, mounted = false, measured = false;
  let tBar = 0, tText = 0, lastLogT = null, freeLog = [], lastMode = null, mt = 0;
  const el = {}, txt = {}, bar = {}, slot = {}, sm = {};
  try { enabled = sessionStorage.getItem('dash-off') !== '1'; } catch (e) { /* default: open */ }

  // ------------------------------------------------------------------ markup (built once)
  const row = (k, l) => `<div class="dr"><span>${l}</span><b data-k="${k}">—</b></div>`;
  const barH = (k, amber) => `<div class="dbar${amber ? ' amber' : ''}"><i data-b="${k}"></i></div>`;
  function mount() {
    if (mounted) return; mounted = true;
    root = document.createElement('div'); root.id = 'dash'; root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="dh" id="dash-h">
        <div class="dh-c"><span class="dh-l">SHIP TIME · UEG</span><b data-k="clock">—</b></div>
        <div class="dh-c dh-stage"><span class="dh-l" data-k="stageN">STAGE 01</span><b data-k="stage">—</b><div class="dh-ticks">${CHAPTERS.map(() => '<i></i>').join('')}</div></div>
        <div class="dh-c dh-link"><span class="dh-l">MOSS LINK · SOL</span><b data-k="link">—</b><div class="dh-sig"><i></i><i></i><i></i><i></i></div></div>
      </div>
      <section class="dp dp-l" id="dash-l">
        <div class="dp-hd" style="--i:0"><span class="dp-id">SYS·01</span><b>PROPULSION</b><em class="dp-st" data-k="pStat">—</em></div>
        <div class="dm dm-big" style="--i:1"><label>THRUST OUTPUT</label><div class="big"><b data-k="thrust">—</b><small>%</small></div><div class="sub" data-k="thrustN">—</div>${barH('thrust')}</div>
        <div class="dm" style="--i:2"><label>ENGINE ARRAY<span data-k="online">—</span></label><div class="slot" data-slot="matrix"></div></div>
        <div class="dm opt-h" style="--i:3"><label>ENGINE RESONANCE<span data-k="reso">—</span></label><div class="slot" data-slot="wave"></div></div>
        <div class="dm dm-2" style="--i:4"><div><label>PLASMA CORE</label><b class="v" data-k="core">—</b>${barH('core', 1)}</div><div><label>EQUATORIAL TRIM</label><b class="v" data-k="trim">—</b>${barH('trim')}</div></div>
        <div class="dm dm-2" style="--i:5"><div><label>SURFACE MEAN</label><b class="v" data-k="surf">—</b>${barH('surf')}</div><div><label>MAGNETOSPHERE</label><b class="v" data-k="mag">—</b>${barH('mag')}</div></div>
      </section>
      <section class="dp dp-r" id="dash-r">
        <div class="dp-hd" style="--i:0"><span class="dp-id">SYS·02</span><b>NAVIGATION</b><em class="dp-st" data-k="nStat">—</em></div>
        <div class="dm dm-big" style="--i:1"><label>VELOCITY<span data-k="vRef">HELIOCENTRIC</span></label><div class="big"><b data-k="vel">—</b><small data-k="velU">KM/S</small></div></div>
        <div class="dm opt-h" style="--i:2"><label>TRAJECTORY · LOG SCALE<span data-k="mapR">—</span></label><div class="slot slot-map" data-slot="map"></div></div>
        <div class="dm dm-rows" style="--i:3">${row('dist', 'DISTANCE · SOL')}${row('delay', 'LIGHT DELAY')}${row('acen', 'ALPHA CEN')}${row('eta', 'ETA')}${row('head', 'HEADING')}${row('region', 'REGION')}</div>
        <div class="dm opt-h2" style="--i:4"><label>OPTICS<span data-k="span">—</span></label><div class="dladder"><i class="dl-trk"></i><i class="dl-cur" data-b="ladder"></i></div><div class="dl-mk"><span>PLANET</span><span>1 AU</span><span>1 LY</span><span>GALAXY</span></div></div>
        <div class="dm dm-log" style="--i:5"><label>EVENT LOG<span data-k="logN">—</span></label><ol id="dash-log"></ol></div>
      </section>
      <canvas id="dash-cv"></canvas>`;
    document.body.appendChild(root);
    root.querySelectorAll('[data-k]').forEach(n => { el[n.dataset.k] = n; });
    root.querySelectorAll('[data-b]').forEach(n => { bar[n.dataset.b] = { n, v: -1 }; });
    el.ticks = [...root.querySelectorAll('.dh-ticks i')]; el.log = root.querySelector('#dash-log');
    cv = root.querySelector('#dash-cv'); g = cv.getContext('2d');
    addEventListener('resize', () => { if (active) measure(); });
  }

  // ------------------------------------------------------------------ writes (only when changed)
  const set = (k, s) => { if (txt[k] !== s) { txt[k] = s; el[k].textContent = s; } };
  const setBar = (k, v) => { const b = bar[k]; v = Math.max(0, Math.min(1, v)); if (Math.abs(b.v - v) > 0.002) { b.v = v; b.n.style.transform = k === 'ladder' ? `translateX(${(v * 100).toFixed(1)}%)` : `scaleX(${v.toFixed(3)})`; } };
  const status = (k, s, alert) => { if (txt[k] === s) return; set(k, s); const n = el[k]; n.classList.toggle('alert', !!alert); n.classList.remove('pulse'); void n.offsetWidth; n.classList.add('pulse'); };
  const ease = (k, v, a = 0.35) => (sm[k] = sm[k] == null || !isFinite(sm[k]) ? v : sm[k] + (v - sm[k]) * a);   // numbers glide between updates

  // ------------------------------------------------------------------ activity
  function sync() {
    const want = enabled && !ctx.WP && (app.mode === 'story' || app.mode === 'free') && !app.ended;
    if (want === active && (!active || lastMode === app.mode)) return;
    if (want) mount();
    active = want; measured = false; lastMode = app.mode;
    document.body.classList.toggle('dash-on', active);
    if (cv) { cv.classList.remove('on'); g.clearRect(0, 0, cv.width, cv.height); }     // (film ↔ explore: the consoles change; nothing stale stays drawn)
    clearTimeout(mt);
    if (active) { tBar = tText = 0; lastLogT = null; mt = setTimeout(() => { if (active) measure(); }, 1800); }   // after the entrance settles
  }
  function setEnabled(on) {
    enabled = !!on; try { sessionStorage.setItem('dash-off', enabled ? '0' : '1'); } catch (e) { /* session only */ }
    sync(); return enabled;
  }
  // slot rectangles in canvas pixels; layout is read here only (mount / resize / after the entrance)
  function measure() {
    if (!root) return;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    const W = innerWidth, H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    root.querySelectorAll('[data-slot]').forEach(n => {
      const r = n.getBoundingClientRect(), vis = r.width > 4 && r.height > 4 && n.offsetParent !== null;
      slot[n.dataset.slot] = vis ? { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr } : null;
    });
    // the reticle: the centre of the clear zone between the consoles (static: drawn here only)
    const L = root.querySelector('#dash-l').getBoundingClientRect(), R = root.querySelector('#dash-r').getBoundingClientRect();
    const lx = app.mode === 'free' ? (document.getElementById('dest')?.getBoundingClientRect().right || L.right) : L.right;
    slot.ret = { cx: ((lx > 0 ? lx : 0) + (R.left > 0 ? R.left : W)) / 2 * dpr, cy: H / 2 * dpr };
    g.clearRect(0, 0, cv.width, cv.height); drawReticle();
    measured = true; cv.classList.add('on'); tBar = 0;
  }

  // ------------------------------------------------------------------ the update (called every frame; throttled inside)
  function tick(now) {
    if (!active || document.hidden) return;
    const t = app.t;
    if (now - tBar >= 50) { tBar = now; bars(now, t); if (measured) draw(now, t); }
    if (now - tText >= 100) { tText = now; texts(now, t); }
  }
  // ---- state helpers
  const online = () => { const a = U.uIgnite.value; return a >= 3 ? 1 : Math.max(0, Math.min(1, 1 - Math.cos(Math.min(a, Math.PI / 2)))); };   // REAL: the ignition front's reach
  const distKm = () => Math.pow(10, ctx.artToKmLog(Math.max(S.earth.length(), 1e-12)));       // REAL
  const toAcen = () => ctx.tmpV.copy(ctx.SKY.acen).multiplyScalar(ACEN_LY * ctx.ART_PER_LY).sub(S.earth).length();   // REAL: art units
  function bars(now, t) {
    const f = online();
    setBar('thrust', 0.976 * S.power * f);
    setBar('core', (0.82 + 0.1 * S.power) * f);
    setBar('trim', S.steer ?? 1);
    setBar('surf', 1 - Math.max(0, Math.min(1, ((S.freeze || 0) - 0.1) / 0.85)));
    setBar('mag', 0.92 - 0.25 * (S.shock || 0) * 0.4 - 0.05 * (S.flare || 0));
    const y = ctx.artToKmLog(cam.d); setBar('ladder', (y - 2) / 17);        // REAL: camera range on a 10² … 10¹⁹ km ladder
  }
  function texts(now, t) {
    const fx = ctx.fmt, f = online(), ci = ctx.chapterAt(t), ch = CHAPTERS[ci];
    // mission strip
    const d = new Date(); set('clock', `${S.year} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`);
    set('stageN', `STAGE ${String(ch.n).padStart(2, '0')} / 06`); set('stage', ch.title.toUpperCase());
    if (el.tickCi !== ci) { el.tickCi = ci; el.ticks.forEach((n, i) => { n.classList.toggle('done', i < ci); n.classList.toggle('cur', i === ci); }); }
    const km = distKm(), sec = km / C_KMS;
    set('link', sec < 60 ? `${fx(sec, 1)} s` : sec < 3600 ? `${fx(sec / 60, 1)} MIN` : sec < 86400 * 2 ? `${fx(sec / 3600, 1)} H` : sec < 3.15e7 * 2 ? `${fx(sec / 86400, 0)} D` : `${fx(sec / 3.156e7, 2)} YR`);
    // propulsion
    const thrust = ease('thrust', 97.6 * S.power * f);
    set('thrust', fx(thrust, 1));
    const N = 1.5e16 * S.power * f, ex = N > 0 ? Math.floor(Math.log10(N)) : 0;
    set('thrustN', N > 0 ? `${fx(N / Math.pow(10, ex), 2)} × 10${sup(ex)} N` : 'ENGINES COLD');
    set('online', `${fx(Math.round(10000 * f), 0)} / 10,000`);
    set('reso', `${fx(ease('reso', 7.83 + 0.6 * (S.power - 1) * 10 + 0.15 * Math.sin(t * 0.21)), 2)} HZ`);      // DECOR (moves with power)
    set('core', `${fx(ease('core', (8.6 + 0.9 * S.power) * f), 2)} × 10⁸ K`);                                  // DERIVED
    set('trim', `${fx((S.steer ?? 1) * 100, 0)} %`);
    set('surf', `${fx(ease('surf', 14 - 112 * Math.max(0, (S.freeze || 0) - 0.12) + 38 * (S.newSun || 0) * (1 - (S.freeze || 0))), 0)} °C`);   // DERIVED from the freeze
    set('mag', `${fx(ease('mag', 92 - 10 * (S.shock || 0) - 5 * (S.flare || 0)), 1)} %`);                      // DECOR
    status('pStat', t < 0.4 ? 'STANDBY' : f < 0.999 ? 'IGNITION' : t >= 147 && t < 160 ? 'REVERSE BURN' : t >= 84 ? 'CRUISE' : 'NOMINAL', (t >= 0.4 && f < 0.999) || (t >= 147 && t < 160));
    // navigation
    const v = ease('vel', S.speed || 0);
    if (v >= 300) { set('vel', fx(v / C_KMS * 100, 3)); set('velU', '% C'); set('vRef', 'RELATIVISTIC · γ ' + fx(1 / Math.sqrt(1 - Math.min(0.99, v / C_KMS) ** 2), 4)); }
    else { set('vel', fx(v, 1)); set('velU', 'KM/S'); set('vRef', 'HELIOCENTRIC'); }
    set('dist', ctx.fmtDist(S.earth.length()));
    set('delay', sec < 3600 ? `${fx(sec / 60, 1)} MIN` : sec < 86400 * 2 ? `${fx(sec / 3600, 1)} H` : `${fx(sec / 3.156e7, 2)} YR`);
    const arrived = t >= 158, remArt = toAcen(), rem = Math.pow(10, ctx.artToKmLog(Math.max(remArt, 1e-12)));     // DERIVED: remaining distance, ETA at the current speed
    set('acen', arrived ? 'ORBIT · ALPHA CEN A' : ctx.fmtDist(remArt));
    const yrs = rem / Math.max(S.speed || 1, 1e-3) / 3.156e7;
    set('eta', arrived ? 'ARRIVED' : yrs > 1e5 ? '> 100,000 YR' : `${fx(yrs, yrs < 100 ? 1 : 0)} YR`);
    const [l, b] = ctx.galCoords(S.vel); set('head', `l ${fx(l, 1)}°  b ${b >= 0 ? '+' : '−'}${fx(Math.abs(b), 1)}°`);
    set('region', ctx.regionAt(t, app.mode === 'free' || t >= 112 ? cam.pos.length() / ctx.ART_PER_LY : 0));
    set('span', `RANGE ${ctx.fmtDist(cam.d)} · FIELD ${ctx.fmtSpan(2 * cam.d * Math.tan(cam.fov * Math.PI / 360))}`);
    set('mapR', km < KM_AU * 2 ? 'INNER SYSTEM' : km < KM_AU * 130 ? 'OUTER SYSTEM' : 'INTERSTELLAR');
    status('nStat', t < 32 ? 'DEPARTURE' : t >= 52 && t < 60 ? 'GRAVITY ASSIST' : t >= 78 && t < 87 ? 'HELIOPAUSE' : t < 88 ? 'ON COURSE' : t < 112 ? 'CRUISE' : t < 147 ? 'SURVEY' : 'CAPTURE', (t >= 52 && t < 60) || (t >= 78 && t < 87) || t >= 147);
    log(t);
  }
  const sup = n => String(n).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] || c).join('');
  // ---- event log: the timeline's last four events (rebuilt only when that set changes) + free-mode target locks
  function log(t) {
    const fresh = app.mode === 'story';
    let k = 0; while (k < LOG_EVENTS.length && LOG_EVENTS[k][0] <= t) k++;
    const key = (fresh ? k : -k) + ':' + freeLog.length;
    if (key === lastLogT) return; const grew = lastLogT != null && fresh; lastLogT = key;
    const items = LOG_EVENTS.slice(Math.max(0, k - 4), k).map(([et, lv, s]) => [stamp(et), lv, s]);
    const all = (app.mode === 'free' ? [...items, ...freeLog] : items).slice(-4).reverse();
    el.log.innerHTML = all.map(([st, lv, s], i) => `<li class="${lv ? 'al' : ''}${i === 0 && grew ? ' new' : ''}"><time>${st}</time>${s}</li>`).join('');
    set('logN', `${k} / ${LOG_EVENTS.length}`);
  }
  const stamp = et => { const m = Math.floor(Math.max(et, 0) / 60), s = Math.floor(Math.max(et, 0) % 60); return `T+${m}:${String(s).padStart(2, '0')}`; };
  function event(s) { freeLog.push(['LOCK', 0, s]); if (freeLog.length > 4) freeLog.shift(); }

  // ------------------------------------------------------------------ canvas widgets (≤ 20 Hz, only their own rects)
  const C = { ice: '159,216,255', amber: '255,181,71', white: '228,241,255' };
  function drawReticle() {
    const r = slot.ret; if (!r) return;
    const s = Math.min(cv.width, cv.height) * 0.11, k = s * 0.22;
    g.save(); g.strokeStyle = `rgba(${C.ice},.22)`; g.lineWidth = dpr;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.beginPath(); g.moveTo(r.cx + sx * s, r.cy + sy * (s - k)); g.lineTo(r.cx + sx * s, r.cy + sy * s); g.lineTo(r.cx + sx * (s - k), r.cy + sy * s); g.stroke();
    }
    g.strokeStyle = `rgba(${C.ice},.16)`;
    g.beginPath(); g.moveTo(r.cx - 9 * dpr, r.cy); g.lineTo(r.cx - 3 * dpr, r.cy); g.moveTo(r.cx + 3 * dpr, r.cy); g.lineTo(r.cx + 9 * dpr, r.cy);
    g.moveTo(r.cx, r.cy - 9 * dpr); g.lineTo(r.cx, r.cy - 3 * dpr); g.moveTo(r.cx, r.cy + 3 * dpr); g.lineTo(r.cx, r.cy + 9 * dpr); g.stroke();
    g.restore();
  }
  function draw(now, t) {
    const f = online(), ts = now / 1000;
    // engine-array matrix: 24 × 6 sectors lit in order of the ignition front; each breathes with the power (REAL + DECOR)
    const m = slot.matrix;
    if (m && app.mode === 'story') {
      g.clearRect(m.x, m.y, m.w, m.h);
      const cols = 24, rows = 6, gap = 2 * dpr, cw = (m.w - gap * (cols - 1)) / cols, chh = (m.h - gap * (rows - 1)) / rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const id = j * cols + i, order = ((i * 0.618 + j * 0.31) % 1) * 0.6 + Math.hypot(i / cols - 0.1, j / rows - 0.5) * 0.55;
        const lit = order < f * 1.02, h = Math.sin(id * 12.9898) * 43758.5453, rnd = h - Math.floor(h);
        const a = lit ? 0.42 + 0.3 * (S.power - 0.93) * 8 * (0.5 + 0.5 * Math.sin(ts * (0.7 + rnd) + id)) : 0.07;
        g.fillStyle = lit && rnd > 0.985 ? `rgba(${C.amber},${0.75})` : `rgba(${C.ice},${Math.max(0.07, Math.min(0.9, a)).toFixed(3)})`;
        g.fillRect(m.x + i * (cw + gap), m.y + j * (chh + gap), cw, chh);
      }
    }
    // resonance trace (DECOR, amplitude follows engine power and the ignition)
    const w = slot.wave;
    if (w && app.mode === 'story') {
      g.clearRect(w.x, w.y, w.w, w.h);
      g.strokeStyle = `rgba(${C.ice},.14)`; g.lineWidth = dpr; g.beginPath(); g.moveTo(w.x, w.y + w.h / 2); g.lineTo(w.x + w.w, w.y + w.h / 2); g.stroke();
      const amp = (0.18 + 0.75 * f * (0.6 + (S.power - 0.93) * 4)) * w.h * 0.42, n = 96;
      g.strokeStyle = `rgba(${C.ice},.85)`; g.lineWidth = 1.2 * dpr; g.beginPath();
      for (let i = 0; i <= n; i++) {
        const x = i / n, y = Math.sin(x * 18 - ts * 3.1) * 0.6 + Math.sin(x * 47 + ts * 1.7) * 0.25 + Math.sin(x * 7 - ts * 0.9) * 0.15;
        const px = w.x + x * w.w, py = w.y + w.h / 2 - y * amp * Math.sin(Math.PI * x);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
    // trajectory map: Sol at the centre, log-radial distance; rings at 1 AU, 30 AU, the heliopause (120 AU), 1 ly and
    // α Cen; the Earth's real position and heading, the route to α Cen, and MOSS's survey sweep
    const p = slot.map;
    if (p) {
      g.clearRect(p.x, p.y, p.w, p.h);
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2, R = Math.min(p.w, p.h) / 2 - 4 * dpr;
      const rad = km => R * Math.max(0, Math.min(1, (Math.log10(Math.max(km, 1)) - 7.5) / (Math.log10(ACEN_LY * KM_LY) - 7.5)));
      g.lineWidth = dpr;
      for (const [km, lab, dash] of [[KM_AU, '1 AU', 0], [30 * KM_AU, '30 AU', 0], [120 * KM_AU, 'HELIOPAUSE', 1], [KM_LY, '1 LY', 0]]) {
        g.strokeStyle = `rgba(${C.ice},${dash ? 0.22 : 0.13})`; g.setLineDash(dash ? [3 * dpr, 4 * dpr] : []);
        g.beginPath(); g.arc(cx, cy, rad(km), 0, Math.PI * 2); g.stroke();
      }
      g.setLineDash([]);
      const sw = (ts * 0.5) % (Math.PI * 2), grd = g.createConicGradient ? g.createConicGradient(sw, cx, cy) : null;
      if (grd) { grd.addColorStop(0, `rgba(${C.ice},.16)`); grd.addColorStop(0.12, `rgba(${C.ice},0)`); grd.addColorStop(1, `rgba(${C.ice},0)`); g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = `rgba(${C.amber},.95)`; g.beginPath(); g.arc(cx, cy, 2.6 * dpr, 0, Math.PI * 2); g.fill();         // Sol
      const aA = Math.atan2(ctx.SKY.acen.z, ctx.SKY.acen.x), ax = cx + Math.cos(aA) * R, ay = cy + Math.sin(aA) * R;
      g.strokeStyle = `rgba(${C.white},.5)`; g.beginPath(); g.arc(ax, ay, 3.2 * dpr, 0, Math.PI * 2); g.stroke();     // α Cen
      const km = distKm(), eA = Math.atan2(S.earth.z, S.earth.x), er = rad(km), ex = cx + Math.cos(eA) * er, ey = cy + Math.sin(eA) * er;
      g.strokeStyle = `rgba(${C.ice},.35)`; g.setLineDash([2 * dpr, 3 * dpr]); g.beginPath(); g.moveTo(ex, ey); g.lineTo(ax, ay); g.stroke(); g.setLineDash([]);
      const vA = Math.atan2(S.vel.z, S.vel.x);
      g.strokeStyle = `rgba(${C.ice},.9)`; g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + Math.cos(vA) * 12 * dpr, ey + Math.sin(vA) * 12 * dpr); g.stroke();
      g.fillStyle = '#dff2ff'; g.beginPath(); g.arc(ex, ey, 2.8 * dpr, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(${C.ice},.6)`; g.font = `${9 * dpr}px "JetBrains Mono", monospace`; g.fillText('SOL', cx + 5 * dpr, cy - 5 * dpr); g.fillText('A-CEN', ax + 6 * dpr, ay + 3 * dpr);
    }
  }

  return { mount, sync, tick, setEnabled, event, measure, get enabled() { return enabled; }, get active() { return active; } };
}
