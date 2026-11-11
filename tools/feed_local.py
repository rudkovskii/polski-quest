#!/usr/bin/env python3
"""Ленты личной версии (11.11, ТЗ-локальная-версия): положить файл в Игра/local-site/feed/ на маке. В интернет ничего не уходит.

python3 tools/feed_local.py <имя файла> <путь | -> 

Запись атомарная (временный файл → переименование). Тот же текст — файл не трогается.
Пишет одну строку: «без изменений» или «записано в ленту: <имя>».
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from local_site import FEED, atomic_write  # noqa: E402

NAMES = {'moje_slowa.json', 'sobes.json'}


def put_file(name: str, text: str) -> bool:
    """Записать `text` в ленту как `name`. False — файл уже такой."""
    if name not in NAMES:
        sys.exit(f'неизвестный файл ленты: {name} (можно: {", ".join(sorted(NAMES))})')
    path = FEED / name
    if path.exists() and path.read_text(encoding='utf-8') == text:
        return False
    atomic_write(path, text)
    return True


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    name, src = sys.argv[1], sys.argv[2]
    text = sys.stdin.read() if src == '-' else Path(src).read_text(encoding='utf-8')
    print(f'записано в ленту: {name}' if put_file(name, text) else 'без изменений')


if __name__ == '__main__':
    main()
