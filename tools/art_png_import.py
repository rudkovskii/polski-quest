#!/usr/bin/env python3
"""Копирует готовые картинки визуала (ТЗ-визуал 28.10, D-76) из пакета художника в `art/png/` версии.

    python3 -I tools/art_png_import.py --src <Бобер/исследование-визуала/пакеты> --hero beaver --cat cat [--portrait]

`art/png/` — исходники, которые читает `tools/art_png.py` при `npm run art`; сюда кладутся только выбранные кадры
(PixelLab: ходьба, стойка, полив, ящик; кот — сидит и идёт), предметы дома и 16 × 4 растений. Герой и кот у каждой
версии свои (ferma — бобёр и рыжий кот с портретом, main — Шэф и рыжий кот, ed/olya — Оля и её кошка).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'art' / 'png'
HEROES = {'beaver': 'p1/персонажи/beaver', 'dima': 'p3/персонажи/dima', 'olya': 'p3/персонажи/olya'}
CATS = {'cat': 'p1/персонажи/cat', 'olyacat': 'p3/персонажи/olyacat'}
HERO_ANIMS = ('walking', 'breathing_idle', 'water_pm', 'carry_pm')
CAT_ANIMS = ('idle', 'walk_pm', 'walk_pm2')
PROPS = {'00': 'bed', '01': 'desk', '02': 'shelf', '03': 'radio', '04': 'w2_wallmap', '05': 'w2_calendar', '62': 'rug'}


def copy_char(src: Path, dst: Path, anims: tuple[str, ...]) -> int:
    fr = json.loads((src / 'metadata.json').read_text('utf8'))['states'][0]['frames']
    if dst.exists():
        shutil.rmtree(dst)
    n = 0
    for d, p in fr['rotations'].items():
        (dst / 'rotations').mkdir(parents=True, exist_ok=True)
        shutil.copy(src / p, dst / 'rotations' / f'{d}.png')
        n += 1
    for a in anims:
        for d, ps in fr['animations'].get(a, {}).items():
            (dst / a / d).mkdir(parents=True, exist_ok=True)
            for i, p in enumerate(ps):
                shutil.copy(src / p, dst / a / d / f'{i}.png')
                n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', required=True, type=Path)
    ap.add_argument('--hero', choices=sorted(HEROES), required=True)
    ap.add_argument('--cat', choices=sorted(CATS), required=True)
    ap.add_argument('--portrait', action='store_true', help='портрет кота для реплик (ferma)')
    a = ap.parse_args()
    s: Path = a.src
    n = copy_char(s / HEROES[a.hero], OUT / 'hero', HERO_ANIMS)
    n += copy_char(s / CATS[a.cat], OUT / 'cat', CAT_ANIMS)
    (OUT / 'props').mkdir(parents=True, exist_ok=True)
    for k, name in PROPS.items():
        shutil.copy(s / 'p1/кандидаты/props1' / f'{k}.png', OUT / 'props' / f'{name}.png')
        n += 1
    port = OUT / 'cat_portrait.png'
    if a.portrait:
        shutil.copy(s / 'p1/персонажи/cat_portrait_выбран.png', port)
        n += 1
    elif port.exists():
        port.unlink()
    plants = OUT / 'plants'
    plants.mkdir(parents=True, exist_ok=True)
    for p in sorted((s / 'p2/готово/растения').glob('v??_*.png')):
        shutil.copy(p, plants / p.name)
        n += 1
    (OUT / 'SOURCE.json').write_text(json.dumps({'hero': a.hero, 'cat': a.cat, 'portrait': a.portrait}, indent=1) + '\n', 'utf8')
    print(f'art_png_import: {n} картинок в art/png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
