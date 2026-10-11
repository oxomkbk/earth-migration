// Wallpaper build entry (bundled into one classic script by tools/build-wallpaper.mjs).
// Order matters: the asset hook must be installed before the experience starts loading.
import './pack.js';
import '../beyond/main.js';
import './controller.js';
