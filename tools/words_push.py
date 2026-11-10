#!/usr/bin/env python3
"""Лента своих слов: проверить ../data/moje_slowa.json и выложить на ветку `slowa`. Сайт не пересобирается, игра подхватит файл сама.

npm run words          проверка и пуш
npm run words -- --check  только проверка

Коммит собирается без переключения веток: рабочее дерево и main не меняются.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feed_push import BRANCH, push_file  # noqa: E402

APP = Path(__file__).resolve().parent.parent
SRC = APP.parent / 'data' / 'moje_slowa.json'
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
    commit = push_file(NAME, text, 'Лента своих слов')
    if commit is None:
        print('без изменений')
        return
    print(f'выложено на {BRANCH}: {commit[:7]}. Игра подхватит при запуске или возврате на вкладку')

if __name__ == '__main__':
    main()
