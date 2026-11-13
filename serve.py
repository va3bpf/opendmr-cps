#!/usr/bin/env python3
"""Serves OpenDMR CPS on this computer: http://localhost:8000 (Web Serial needs localhost or https).

  py serve.py [port]

Besides the pages, /tle/amsat gives AMSAT's current TLE file (amsat.org does not let pages of other sites read it): the
one address this server fetches, kept an hour.
"""
import http.server
import sys
import time
import urllib.request
from pathlib import Path

AMSAT_URL = 'https://www.amsat.org/tle/current/nasabare.txt'
CACHE_S = 3600
cache = {'time': 0.0, 'data': b''}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] != '/tle/amsat':
            return super().do_GET()
        try:
            if time.time() - cache['time'] > CACHE_S or not cache['data']:
                request = urllib.request.Request(AMSAT_URL, headers={'User-Agent': 'OpenDMR-CPS'})
                with urllib.request.urlopen(request, timeout=20) as r:
                    cache['data'] = r.read()
                cache['time'] = time.time()
            body = cache['data']
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
        except Exception as e:  # the page shows the reason
            body = ('AMSAT: %s' % e).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = lambda *args, **kwargs: Handler(*args, directory=str(Path(__file__).parent), **kwargs)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    print('OpenDMR CPS: http://localhost:%d  (Ctrl+C to stop)' % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
