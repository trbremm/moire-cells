"""Local static server for the page, like `python -m http.server`, but telling the browser not to cache.

Plain http.server lets browsers keep old copies of the JS modules and shaders, so after an update the page
can quietly run a mix of old and new code. This server sends Cache-Control: no-store on every file.

Usage (from anywhere):
    python tools/serve.py              # http://localhost:8000, this machine only
    python tools/serve.py 8000 --lan   # also reachable from other devices on the network
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.wgsl': 'text/plain; charset=utf-8'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else 8000
    host = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer((host, port), handler) as httpd:
        print(f'serving {root} at http://{"localhost" if host == "127.0.0.1" else host}:{port} (no caching)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
