#!/usr/bin/env python3
"""Ветка ленты `slowa`: положить один файл, остальные файлы ветки оставить как есть (moje_slowa.json и sobes.json живут рядом).

python3 tools/feed_push.py <имя файла на ветке> <путь | -> [сообщение коммита]

Коммит собирается без переключения веток (`commit-tree`): рабочее дерево и main не меняются. Файл тот же — коммита нет.
Пишет одну строку: «без изменений» или «выложено на slowa: <хеш>».
"""
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
BRANCH = 'slowa'


def git(*args, stdin=None):
    r = subprocess.run(['git', *args], cwd=APP, input=stdin, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'git {args[0]}: {r.stderr.strip()}')
    return r.stdout.strip()


def push_file(name: str, text: str, message: str) -> str | None:
    """Выложить `text` как `name` на ветку ленты. Возвращает хеш коммита или None, если файл на ветке уже такой."""
    remote = git('ls-remote', '--heads', 'origin', BRANCH)
    parent = remote.split()[0] if remote else None
    entries: dict[str, str] = {}
    if parent:
        git('fetch', '-q', 'origin', BRANCH)
        for line in git('ls-tree', parent).splitlines():
            meta, path = line.split('\t', 1)
            entries[path] = meta
    blob = git('hash-object', '-w', '--stdin', stdin=text)
    if entries.get(name, '').endswith(f' {blob}'):
        return None
    entries[name] = f'100644 blob {blob}'
    tree = git('mktree', stdin=''.join(f'{meta}\t{path}\n' for path, meta in sorted(entries.items())))
    args = ['commit-tree', tree, '-m', message]
    if parent:
        args += ['-p', parent]
    commit = git(*args)
    git('push', '-q', 'origin', f'{commit}:refs/heads/{BRANCH}')
    return commit


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    name, src = sys.argv[1], sys.argv[2]
    text = sys.stdin.read() if src == '-' else Path(src).read_text(encoding='utf-8')
    commit = push_file(name, text, sys.argv[3] if len(sys.argv) > 3 else f'Лента: {name}')
    print('без изменений' if commit is None else f'выложено на {BRANCH}: {commit[:7]}')


if __name__ == '__main__':
    main()
