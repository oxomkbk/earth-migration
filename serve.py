#!/usr/bin/env python3
"""Serve The Earth Migration Project locally:  python3 serve.py  →  http://localhost:8080/beyond.html"""
import http.server, os, socketserver, sys, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream'}

    def end_headers(self):
        # never let the browser keep a stale copy of the code while the project is being iterated on
        if not self.path.split('?')[0].endswith(('.jpg', '.png', '.glb', '.bin', '.wasm')):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

with socketserver.ThreadingTCPServer(('', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}/beyond.html'
    print(f'Serving on http://localhost:{PORT}/')
    print(f'  Main experience  : http://localhost:{PORT}/beyond.html   (Beyond the Wandering Earth)')
    print(f'  Part I (classic) : http://localhost:{PORT}/index.html')
    print('  (Ctrl+C to stop)')
    try: webbrowser.open(url)
    except Exception: pass
    httpd.serve_forever()
