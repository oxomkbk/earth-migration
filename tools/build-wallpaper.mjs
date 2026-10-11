// Builds the Wallpaper Engine edition of "Beyond the Wandering Earth" into a self-contained folder:
//   index.html + project.json + preview.jpg, one bundled classic script (js/app.js), the CSS with embedded fonts,
//   and every asset as a data: URI in small classic scripts (pack/*.js). Nothing is fetched at run time, so the
//   wallpaper works from the local disk (file://), offline, in Wallpaper Engine's browser.
//
//   node tools/build-wallpaper.mjs [outDir]          (needs esbuild: npm i esbuild, or ESBUILD=/path/to/esbuild/lib/main.js)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'wandering-earth-wallpaper'));
const require = createRequire(import.meta.url);
const esbuild = require(process.env.ESBUILD || 'esbuild');
const rd = p => fs.readFileSync(path.join(ROOT, p));
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.js': 'text/javascript' };

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['js', 'css', 'pack']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// 1. one classic script: three.js + the experience + the wallpaper controller
const three = path.join(ROOT, 'vendor/three');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'js/wallpaper/entry.js')], outfile: path.join(OUT, 'js/app.js'),
  bundle: true, format: 'iife', minify: true, target: ['chrome100'], legalComments: 'eof', logLevel: 'warning',
  plugins: [{ name: 'three', setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(three, 'build/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, a => ({ path: path.join(three, 'examples/jsm', a.path.slice('three/addons/'.length)) }));
  } }],
});

// 2. assets → data: URIs in classic scripts. Only what the code references (whole folders whose names are composed at run time).
const src = ['js/beyond', 'js/fx'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).map(f => rd(path.join(d, f)).toString())).join('\n');
const assets = [];
for (const dir of ['earth', 'planets', 'sky', 'textures', 'models']) for (const f of fs.readdirSync(path.join(ROOT, 'assets', dir)).sort()) {
  const rel = `assets/${dir}/${f}`, composed = dir === 'planets' || dir === 'textures' || dir === 'sky';
  if (composed || src.includes(f)) assets.push(rel);
}
assets.push('vendor/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', 'vendor/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm');   // the models are Draco-compressed
const packTags = []; let total = 0;
assets.forEach((rel, i) => {
  const b = rd(rel), uri = `data:${MIME[path.extname(rel)]};base64,${b.toString('base64')}`; total += b.length;
  const name = `pack/${String(i).padStart(2, '0')}.js`;
  fs.writeFileSync(path.join(OUT, name), `(window.__PACK=window.__PACK||{})[${JSON.stringify(rel)}]=${JSON.stringify(uri)};\n`);
  packTags.push(`<script src="${name}"></script>`);
});

// 3. styles, fonts embedded (font files from file:// would be blocked as cross-origin)
let fonts = rd('wallpaper/fonts.css').toString().replace(/url\((fonts\/[^)]+)\)/g, (m, f) => `url(data:font/woff2;base64,${rd('wallpaper/' + f).toString('base64')})`);
fs.writeFileSync(path.join(OUT, 'css/fonts.css'), fonts);
fs.copyFileSync(path.join(ROOT, 'css/beyond.css'), path.join(OUT, 'css/beyond.css'));
fs.copyFileSync(path.join(ROOT, 'wallpaper/wallpaper.css'), path.join(OUT, 'css/wallpaper.css'));

// 4. the page: the film page's markup, with the wallpaper bridge, clock, and the bundle instead of modules
let html = rd('beyond.html').toString();
const head = `<script>
// Wallpaper Engine bridge: buffer what the host sends until the experience is ready (js/wallpaper/controller.js).
window.__WALLPAPER = { quality: 'medium', props: {}, general: {}, paused: false, listeners: [] };
try { window.__WALLPAPER.quality = localStorage.getItem('wp-quality') || 'medium'; } catch (e) {}
window.wallpaperPropertyListener = {
  applyUserProperties: function (p) { Object.assign(__WALLPAPER.props, p); __WALLPAPER.listeners.forEach(function (f) { f('user', p); }); },
  applyGeneralProperties: function (p) { Object.assign(__WALLPAPER.general, p); __WALLPAPER.listeners.forEach(function (f) { f('general', p); }); },
  setPaused: function (v) { __WALLPAPER.paused = v; __WALLPAPER.listeners.forEach(function (f) { f('paused', v); }); }
};
</script>
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/beyond.css">
<link rel="stylesheet" href="css/wallpaper.css">`;
const rep = (a, b) => { const hit = a instanceof RegExp ? new RegExp(a.source).test(html) : html.includes(a); if (!hit) throw new Error('template changed: ' + a); html = html.replace(a, b); };
rep(/<link rel="preconnect"[^>]*>\n/g, '');
rep(/<link href="https:\/\/fonts\.googleapis[^>]*>\n/, '');
rep('<link rel="stylesheet" href="css/beyond.css">', head);
rep('<body class="cinematic">', `<body class="cinematic wp">`);
rep('<canvas id="gl"', `<div id="wp-clock" aria-hidden="true"><div class="wc-time"><div class="wc-k">UEG STANDARD TIME</div><div class="wc-t"><span id="wc-t">--:--</span><small id="wc-ap"></small></div><div class="wc-d" id="wc-d"></div><div class="wc-rule"></div></div><div id="wp-tele-slot"></div></div>\n<canvas id="gl"`);
rep(/<script src="js\/boot\.js"><\/script>[\s\S]*<script type="module" src="js\/beyond\/main\.js"><\/script>/, packTags.join('\n') + '\n<script src="js/app.js"></script>');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// 5. Wallpaper Engine project, preview, notes
fs.copyFileSync(path.join(ROOT, 'wallpaper/project.json'), path.join(OUT, 'project.json'));
if (fs.existsSync(path.join(ROOT, 'wallpaper/preview.jpg'))) fs.copyFileSync(path.join(ROOT, 'wallpaper/preview.jpg'), path.join(OUT, 'preview.jpg'));
fs.copyFileSync(path.join(ROOT, 'wallpaper/README.txt'), path.join(OUT, 'README.txt'));

const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`built ${OUT}: ${assets.length} assets (${(total / 1e6).toFixed(1)} MB raw), ${(size(OUT) / 1e6).toFixed(1)} MB on disk`);
