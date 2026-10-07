  // Loader watchdog: surface failures (CDN unreachable, no WebGL, script error) instead of an endless loading screen.
  (function () {
    var shown = false;
    function fail(msg) { if (shown || window.__emReady) return; shown = true; var s = document.getElementById('ld-status'); if (s) { s.style.color = '#ff8a8a'; s.textContent = msg; } }
    addEventListener('error', function (e) { fail('SYSTEM FAULT · ' + (e.message || 'script error')); });
    addEventListener('unhandledrejection', function (e) { fail('SYSTEM FAULT · ' + (e.reason && e.reason.message || e.reason)); });
    if (location.protocol === 'file:') addEventListener('DOMContentLoaded', function () { fail('OPEN VIA A LOCAL SERVER · browsers block ES modules from file:// — run  python3 serve.py  in this folder, then open http://localhost:8080'); });
    setTimeout(function () { var s = document.getElementById('ld-status'); if (!window.__emStarted && !shown && s) s.textContent = 'STILL LOADING · if this persists, serve the folder over HTTP (python3 serve.py) instead of opening the file directly'; }, 20000);
  })();
