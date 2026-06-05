#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

mimetypes.add_type('application/wasm', '.wasm')

class COIHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        request_path = self.path.split('?', 1)[0]
        if request_path.startswith('/engine/') or request_path.startswith('/vendor/'):
            self.send_header('Cache-Control', 'no-store')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=()')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description='Serve the Singular WASM workbench with COOP/COEP headers.')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--directory', default=str(Path(__file__).resolve().parents[1] / 'public'))
    args = parser.parse_args()
    handler = functools.partial(COIHandler, directory=args.directory)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    print(f'Serving {args.directory} at http://127.0.0.1:{args.port}/ with COOP/COEP headers')
    server.serve_forever()

if __name__ == '__main__':
    main()
