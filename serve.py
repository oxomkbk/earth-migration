#!/usr/bin/env python3
"""Serve The Earth Migration Project locally:  python3 serve.py  →  http://localhost:8080"""
import http.server, os, socketserver, sys, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream'}

with socketserver.ThreadingTCPServer(('', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}/'
    print(f'Serving on {url}  (Ctrl+C to stop)')
    try: webbrowser.open(url)
    except Exception: pass
    httpd.serve_forever()
