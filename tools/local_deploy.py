#!/usr/bin/env python3
"""Выложить новую версию личной игры на мак (11.11, ТЗ-локальная-версия). `npm run local` — только по слову Шэфа (D-137).

1. `npm run check:quiet` (typecheck, тесты, сборка в dist/; в фоне, чтобы мак не тормозил). Красный — выкладки нет.
2. dist/ копируется во временную папку Игра/local-site/builds/.<метка>.tmp, потом переименовывается в builds/<метка>.
3. Ссылка current переключается атомарно (новая ссылка рядом → переименование): полусобранной игры сервер не отдаёт.
4. Хранятся две последние сборки. Откат — `npm run local -- --rollback` (current на предыдущую).
5. Ленты (local-site/feed/) не трогаются; если их ещё нет — один прогон tools/feed_watch.py --force.

python3 tools/local_deploy.py [--no-check] [--rollback]
--no-check — без проверки, только если check только что прошёл на этом же коде.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from local_site import APP, BUILDS, CURRENT, FEED, HOST, PORT, SITE  # noqa: E402

KEEP = 2


def switch(target: Path) -> None:
    link = SITE / '.current.tmp'
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(Path('builds') / target.name)
    os.replace(link, CURRENT)


def builds() -> list[Path]:
    return sorted(p for p in BUILDS.iterdir() if p.is_dir() and not p.name.startswith('.')) if BUILDS.exists() else []


def rollback() -> None:
    cur = CURRENT.resolve() if CURRENT.exists() else None
    older = [b for b in builds() if b.resolve() != cur]
    if not older:
        sys.exit('откатываться некуда: другой сборки нет')
    switch(older[-1])
    print(f'откат: current → {older[-1].name}')


def main() -> None:
    if '--rollback' in sys.argv:
        rollback()
        return
    if '--no-check' not in sys.argv:
        r = subprocess.run(['npm', 'run', 'check:quiet'], cwd=APP)
        if r.returncode:
            sys.exit('npm run check красный — выкладки нет')
    dist = APP / 'dist'
    if not (dist / 'index.html').exists():
        sys.exit('нет dist/index.html — сборки нет')
    base = json.loads((APP / 'edition.json').read_text(encoding='utf-8'))['base']
    if base != '/':
        sys.exit(f'edition.json base={base}, для локальной версии нужен /')
    stamp = time.strftime('%Y%m%d-%H%M%S')
    try:
        build = json.loads((dist / 'version.json').read_text(encoding='utf-8'))['build']
        stamp += '-' + build.split('+')[-1]
    except (OSError, ValueError, KeyError):
        pass
    BUILDS.mkdir(parents=True, exist_ok=True)
    tmp = BUILDS / f'.{stamp}.tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(dist, tmp)
    final = BUILDS / stamp
    os.replace(tmp, final)
    switch(final)
    cur = final.resolve()
    for old in builds()[:-KEEP]:
        if old.resolve() != cur:
            shutil.rmtree(old, ignore_errors=True)
    print(f'выложено на мак: {final.name} → http://{HOST}:{PORT}/')
    if not (FEED / 'moje_slowa.json').exists() or not (FEED / 'sobes.json').exists():
        subprocess.run([sys.executable, str(APP / 'tools' / 'feed_watch.py'), '--force'], cwd=APP)


if __name__ == '__main__':
    main()
