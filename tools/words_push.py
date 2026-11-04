#!/usr/bin/env python3
"""Лента своих слов: проверить ../data/moje_slowa.json и выложить на ветку `slowa`. Сайт не пересобирается, игра подхватит файл сама.

npm run words          проверка и пуш
npm run words -- --check  только проверка

Коммит собирается без переключения веток: рабочее дерево и main не меняются.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
SRC = APP.parent / 'data' / 'moje_slowa.json'
BRANCH = 'slowa'
NAME = 'moje_slowa.json'
POS = {'noun', 'verb', 'adj', 'adv', 'num', 'pron', 'prep', 'conj', 'part', 'intj', 'phrase'}


def check(feed):
    errs, ids, known = [], set(), set()
    if not isinstance(feed, list):
        return ['файл должен быть списком записей']
    for i, e in enumerate(feed):
        where = f'запись {i} ({e.get("id") if isinstance(e, dict) else "?"})'
        if not isinstance(e, dict) or not e.get('id'):
            errs.append(f'{where}: нет id')
            continue
        if e['id'] in ids:
            errs.append(f'{where}: id уже был. Игра применяет запись один раз, правку клади новой записью')
        ids.add(e['id'])
        extra = set(e) - {'id', 'add', 'edit', 'remove'}
        if extra:
            errs.append(f'{where}: лишние поля {sorted(extra)}')
        for w in e.get('add', []):
            if not w.get('pl') or not w.get('ru'):
                errs.append(f'{where}: в add нужны pl и ru: {w}')
            if 'pos' in w and w['pos'] not in POS:
                errs.append(f'{where}: неизвестная часть речи {w["pos"]}')
            known.add(w.get('pl'))
        for x in e.get('edit', []):
            if x.get('pl') not in known:
                errs.append(f'{where}: edit по слову, которого нет в ленте: {x.get("pl")}. Если оно добавлено в игре руками, пропусти: --force')
            if not isinstance(x.get('set'), dict):
                errs.append(f'{where}: в edit нужно поле set')
            elif 'pl' in x['set']:
                known.discard(x.get('pl'))
                known.add(x['set']['pl'])
        for pl in e.get('remove', []):
            if pl not in known:
                errs.append(f'{where}: remove по слову, которого нет в ленте: {pl}. Если оно добавлено в игре руками, пропусти: --force')
            known.discard(pl)
    return errs


def git(*args, stdin=None, env=None):
    r = subprocess.run(['git', *args], cwd=APP, input=stdin, capture_output=True, text=True, env=env)
    if r.returncode:
        sys.exit(f'git {args[0]}: {r.stderr.strip()}')
    return r.stdout.strip()


def main():
    force = '--force' in sys.argv
    text = SRC.read_text(encoding='utf-8')
    try:
        feed = json.loads(text)
    except json.JSONDecodeError as e:
        sys.exit(f'{SRC}: битый JSON: {e}')
    errs = check(feed)
    if force:
        errs = [e for e in errs if '--force' not in e]
    if errs:
        sys.exit('\n'.join(errs))
    print(f'ok: записей {len(feed)}')
    if '--check' in sys.argv:
        return
    remote = git('ls-remote', '--heads', 'origin', BRANCH)
    parent = remote.split()[0] if remote else None
    if parent:
        git('fetch', '-q', 'origin', BRANCH)
        if git('rev-parse', f'{parent}:{NAME}') == git('hash-object', '--stdin', stdin=text):
            print('без изменений')
            return
    blob = git('hash-object', '-w', '--stdin', stdin=text)
    tree = git('mktree', stdin=f'100644 blob {blob}\t{NAME}\n')
    args = ['commit-tree', tree, '-m', 'Лента своих слов']
    if parent:
        args += ['-p', parent]
    commit = git(*args)
    git('push', '-q', 'origin', f'{commit}:refs/heads/{BRANCH}')
    print(f'выложено на {BRANCH}: {commit[:7]}. Игра подхватит при запуске или возврате на вкладку')


if __name__ == '__main__':
    main()
