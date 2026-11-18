#!/usr/bin/env python3
"""Serves OpenDMR CPS on this computer: http://localhost:8000 (Web Serial needs localhost or https).

  py serve.py [port]

Besides the pages, /tle/amsat gives AMSAT's current TLE file (amsat.org does not let pages of other sites read it): the
one address this server fetches, kept an hour.
"""
import http.server
import ssl
import sys
import time
import urllib.request
from pathlib import Path

AMSAT_URL = 'https://www.amsat.org/tle/current/nasabare.txt'
GRID_RADIO_URL = 'https://api.grid.radio/opengd77/dmr-database'
CACHE_S = 3600
cache = {'time': 0.0, 'data': b''}

# SSL context with fallback for systems (like default Python on macOS) without root certificates installed
def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    try:
        return ssl.create_default_context()
    except Exception:
        pass
    return ssl._create_unverified_context()

SSL_CTX = _ssl_context()


def _urlopen(req, timeout=60):
    try:
        return urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout)
    except urllib.error.URLError as e:
        if 'CERTIFICATE_VERIFY_FAILED' in str(e):
            return urllib.request.urlopen(req, context=ssl._create_unverified_context(), timeout=timeout)
        raise


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/dmr/database'):
            query = self.path[len('/dmr/database'):]  # pass ?country=... or ?region=... through
            url = GRID_RADIO_URL + query
            try:
                req = urllib.request.Request(url, headers={
                    'Referer': 'http://localhost:8000/',
                    'User-Agent': 'OpenDMR-CPS',
                })
                with _urlopen(req, timeout=60) as r:
                    body = r.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
            except Exception as e:
                import json
                body = json.dumps({'error': str(e)}).encode()
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split('?')[0] != '/tle/amsat':
            return super().do_GET()
        try:
            if time.time() - cache['time'] > CACHE_S or not cache['data']:
                request = urllib.request.Request(AMSAT_URL, headers={'User-Agent': 'OpenDMR-CPS'})
                with _urlopen(request, timeout=20) as r:
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
