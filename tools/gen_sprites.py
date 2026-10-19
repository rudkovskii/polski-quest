#!/usr/bin/env python3
"""Рисует sprite-as-data игры «Ферма» в art/sprites/*.sprite.json (npm run art), затем `npm run sprites` собирает атлас.

Подход как у жаб на дашборде (Планы/assets/dashboard-frogs-sprites-sdv.js): фигура из материалов; у материала один
средний тон (art/materials.json), рампу строит tools/art_ramp.py. Свет сверху-слева: блик у верхнего-левого края части,
тень у нижнего-правого, тёмная линия на стыке частей, снаружи тёплый тёмный контур. Мягкую тень под объектами рисует
игра (полупрозрачная, в атласе альфы нет).

    python3 tools/gen_sprites.py                    # переписать art/sprites/*.sprite.json
    python3 tools/gen_sprites.py --preview out.png  # лист просмотра ×6 (для глаз, не для игры)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_core  # noqa: E402
from art_core import OUT, SHEETS  # noqa: E402
import art_cat  # noqa: E402
import art_crops  # noqa: E402
import art_hero  # noqa: E402
import art_props  # noqa: E402
import art_tiles  # noqa: E402
import art_world2  # noqa: E402
import art_plants  # noqa: E402
import art_beaver  # noqa: E402

MODULES = [art_hero, art_cat, art_props, art_tiles, art_crops, art_world2, art_plants, art_beaver]


def preview(path: Path, scale: int = 6) -> None:
    from PIL import Image
    from art_ramp import ROOT  # noqa: F401
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from sprites_build import load_palette
    pal = load_palette()
    cells = []
    for sh in SHEETS.values():
        if sh.sid in ('hero', 'cat', 'hero_portrait') and '--props' in sys.argv:
            continue
        for g in sh.grids():
            cells.append(g)
    W = 1100
    x = y = row = 0
    placed = []
    for g in cells:
        w, h = len(g[0]), len(g)
        if x + w * scale + 6 > W:
            x, y, row = 0, y + row + 6, 0
        placed.append((g, x, y))
        x += w * scale + 6
        row = max(row, h * scale)
    img = Image.new('RGBA', (W, y + row + 6), (186, 214, 140, 255))
    px = img.load()
    for g, ox, oy in placed:
        for yy, r in enumerate(g):
            for xx, c in enumerate(r):
                if not c:
                    continue
                rgb = pal.names[c]
                for dy in range(scale):
                    for dx in range(scale):
                        px[ox + xx * scale + dx, oy + yy * scale + dy] = (*rgb, 255)
    img.save(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--preview', metavar='PNG')
    ap.add_argument('--no-write', action='store_true')
    ap.add_argument('--props', action='store_true', help='в просмотре без героя и кота')
    a = ap.parse_args()
    for m in MODULES:
        m.build()
    if a.preview:
        preview(Path(a.preview))
    if not a.no_write:
        OUT.mkdir(parents=True, exist_ok=True)
        for p in OUT.glob('*.sprite.json'):
            p.unlink()
        for sid, sh in SHEETS.items():
            (OUT / f'{sid}.sprite.json').write_text(json.dumps(sh.to_json(), ensure_ascii=False) + '\n', 'utf8')
        print(f'gen_sprites: {len(SHEETS)} спрайтов в art/sprites')
    return 0


if __name__ == '__main__':
    sys.exit(main())
