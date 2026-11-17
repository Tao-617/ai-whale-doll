"""Serve web/ on 127.0.0.1:8812 without browser caching: python3 scripts/serve.py
(python -m http.server lets the browser keep old copies of the modules, so a reload could run stale code)."""
import functools, http.server, pathlib

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

web = pathlib.Path(__file__).resolve().parent.parent / 'web'
http.server.ThreadingHTTPServer(('127.0.0.1', 8812), functools.partial(Handler, directory=str(web))).serve_forever()
