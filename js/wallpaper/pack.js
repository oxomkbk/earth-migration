// Asset pack hook for the wallpaper build. Wallpaper Engine opens the page from the local disk (file://), where
// fetch() of local files is refused and images can taint WebGL. The build therefore ships every asset inside
// small classic scripts (pack/*.js → window.__PACK, as data: URIs), and this hook routes all loads there:
// images through three.js's default loading manager (as data: URIs), binaries (models, star catalogue, the
// Draco decoder) through a fetch() shim that answers with the bytes directly (no URL-length limits).
import * as THREE from 'three';

const PACK = window.__PACK || {};
const key = u => {
  const s = String(u || '').replace(/^\.\//, ''); if (PACK[s]) return s;
  for (const p of ['assets/', 'vendor/']) { const i = s.indexOf(p); if (i >= 0 && PACK[s.slice(i)]) return s.slice(i); }
  return null;
};
const isImage = k => PACK[k].startsWith('data:image/');
const bytes = k => { const s = PACK[k], b = atob(s.slice(s.indexOf(',') + 1)), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };

THREE.DefaultLoadingManager.setURLModifier(u => { const k = key(u); return k && isImage(k) ? PACK[k] : u; });
const fetch0 = window.fetch.bind(window);
window.fetch = (input, init) => {
  const k = key(typeof input === 'string' ? input : input && input.url);
  if (k && !isImage(k)) return Promise.resolve(new Response(bytes(k), { status: 200, headers: { 'Content-Type': PACK[k].slice(5, PACK[k].indexOf(';')) } }));
  return fetch0(k ? PACK[k] : input, init);
};
