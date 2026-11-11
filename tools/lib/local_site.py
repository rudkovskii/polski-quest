"""Личная версия игры на маке (11.11, ТЗ-локальная-версия): где что лежит.

Игра/local-site/            вне git
  current -> builds/<метка>  что раздаёт сервер; переключается атомарно (`npm run local`)
  builds/<метка>/            собранные версии, хранятся две последние (откат — перевести current)
  feed/                      ленты: moje_slowa.json, sobes.json (пишет tools/feed_local.py)

Сервер — tools/local_server.py, LaunchAgent com.rudkovskiid.polski-local, http://127.0.0.1:5321/.
"""
import os
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
GAME = APP.parent
SITE = Path(os.environ.get('PQ_LOCAL_SITE', GAME / 'local-site'))
CURRENT = SITE / 'current'
BUILDS = SITE / 'builds'
FEED = SITE / 'feed'
HOST = '127.0.0.1'
PORT = int(os.environ.get('PQ_LOCAL_PORT', '5321'))


def atomic_write(path: Path, text: str) -> None:
    """Временный файл рядом, потом переименование: читатель видит либо старый файл, либо новый целиком."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)
