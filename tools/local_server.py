#!/usr/bin/env python3
"""Личная версия игры на маке (11.11, ТЗ-локальная-версия): статический сервер только для этого ноута.

Слушает 127.0.0.1:5321 (наружу не смотрит). Раздаёт Игра/local-site/current/ (сборка, `npm run local`),
а /feed/* — из Игра/local-site/feed/ (ленты, tools/feed_local.py). Держит LaunchAgent com.rudkovskiid.polski-local
(`npm run local:install`). Только стандартная библиотека Python.

python3 tools/local_server.py   запустить руками (в обычной жизни не нужно)
"""
import mimetypes
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from local_site import CURRENT, FEED, HOST, PORT  # noqa: E402

mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('audio/mp4', '.m4a')
mimetypes.add_type('text/javascript', '.js')
# Всегда из сети: по ним игра узнаёт про новую сборку и новые ленты.
NO_STORE = {'index.html', 'sw.js', 'version.json', 'manifest.webmanifest'}


class Handler(SimpleHTTPRequestHandler):
    server_version = 'polski-local'
    sys_version = ''

    def translate(self) -> Path | None:
        rel = unquote(urlsplit(self.path).path).lstrip('/')
        if rel.startswith('feed/'):
            root, rel = FEED, rel[len('feed/'):]
        else:
            root = CURRENT
        root = root.resolve()
        target = (root / (rel or 'index.html')).resolve()
        if target != root and root not in target.parents:
            return None
        if target.is_dir():
            target = target / 'index.html'
        return target

    def send_head(self):
        target = self.translate()
        if target is None:
            self.send_error(HTTPStatus.FORBIDDEN)
            return None
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        try:
            f = target.open('rb')
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        size = target.stat().st_size
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(size))
        feed = urlsplit(self.path).path.startswith('/feed/')
        self.send_header('Cache-Control', 'no-store' if feed or target.name in NO_STORE else 'public, max-age=3600')
        if target.name == 'sw.js':
            self.send_header('Service-Worker-Allowed', '/')
        self.end_headers()
        return f

    def list_directory(self, path):  # каталоги не показываем
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def log_message(self, fmt, *args):  # без шума в логе на каждый файл
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))


def main() -> None:
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'polski-local: http://{HOST}:{PORT}/ ← {CURRENT}', flush=True)
    httpd.serve_forever()


if __name__ == '__main__':
    main()
