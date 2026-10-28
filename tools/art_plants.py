"""Арт «пёстрого огорода»: кусты-варианты (`plant_v00…v15`), плоды (`plant_fruits_*`), мини-иконки предметов (`plant_icons_*`).

Кусты и плоды рисует `tools/art_garden.py` (светлый стиль Stardew, перерисовка 19.10); мини-иконки лежат готовыми
в art/plants/plant_icons_*.sprite.json (перекрашены на материалы проекта `tools/plants_import.py`, правятся руками) и здесь
просто вносятся в общий набор. Порядок упаковки — после всех прочих (`sprites_build.py`).

Мини-иконки получают мягкий контур (`soft_ring`): внешнее кольцо `.o`/`outline` сверху-слева от фигуры становится тенью `.1`
материала соседнего пикселя, снизу-справа остаётся контуром; почти чёрная обводка больше не давит на светлый куст.

Место мини-предмета на кусте-основе (`slot` в content/plants/plants.json) считается здесь же: низ иконки заходит на верх
основы на `ICON_OVERLAP` px, по горизонтали по центру. Поменял основу — `npm run art` перепишет `slot`.
"""
from __future__ import annotations

import json

from art_core import KEYCHARS, Sheet, emit
from art_garden import FRUITS, V, fruit_frame, frame
from art_png import plant_frames
from art_ramp import ROOT, load_materials, ramp_colors

PALETTE = set(ramp_colors(load_materials()))
MAX_COLORS = len(KEYCHARS) - 1

PLANTS = ROOT / 'content' / 'plants' / 'plants.json'
STAGES = ('sprout', 'bush', 'ripe', 'base')
ICON_BOTTOM = 13  # нижняя строка содержимого мини-иконки 16×16 (у большинства иконок)
ICON_OVERLAP = 2  # на сколько строк иконка заходит на листья основы


def soft_ring(g, names: set[str] | None = None):
    """Внешний контур иконки → выборочный и цветной (см. докстринг модуля). Внутренние линии не трогаются.

    `names` — цвета листа: новый тон добавляется, только пока лист влезает в ключи (`KEYCHARS`, 77 цветов)."""
    h, w = len(g), len(g[0])
    out = [r[:] for r in g]

    def at(x, y):
        return g[y][x] if 0 <= x < w and 0 <= y < h else None

    def ring(c):
        return c is not None and (c.endswith('.o') or c == 'outline')

    for y in range(h):
        for x in range(w):
            if not ring(g[y][x]) or all(at(x + dx, y + dy) is not None for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                continue
            for dx, dy in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                n = at(x + dx, y + dy)
                if n and not ring(n) and '.' in n:
                    mat = n.rsplit('.', 1)[0]
                    cand = f'{mat}.1' if (dx, dy) in ((0, 1), (1, 0)) else None
                    if cand in PALETTE and (names is None or cand in names or len(names) < MAX_COLORS):
                        out[y][x] = cand
                        if names is not None:
                            names.add(cand)
                    break
    return out


def top_row(g) -> int:
    return next(y for y, r in enumerate(g) if any(r))


def build() -> None:
    meta = json.loads(PLANTS.read_text('utf8'))
    for v in meta['variants']:
        n = v['n']
        # Новый визуал (28.10): готовые кусты из art/png/plants (уменьшены до клетки, `art_png.PLANT_SCALE`); нет картинок — рисует art_garden.
        sh = Sheet(v['sheet'], 16, 32, anchor=[8, 31])
        grids = plant_frames(n, STAGES) or [frame(n, st) for st in STAGES]
        for g in grids:
            sh.add(g)
        emit(sh)
        dy = top_row(grids[3]) + ICON_OVERLAP - ICON_BOTTOM
        v['slot'] = [0, dy]
    sheets: dict[str, list] = {}
    for f in meta['fruits']:
        sheets.setdefault(f['sheet'], []).append(f)
    for sid, fs in sheets.items():
        sh = Sheet(sid, 16, 32, anchor=[8, 31])
        for f in sorted(fs, key=lambda x: x['frame']):
            if f['id'] not in FRUITS:
                raise SystemExit(f'art_garden: нет плода {f["id"]}')
            sh.add(fruit_frame(f['id']))
        emit(sh)
    text = json.dumps(meta, ensure_ascii=False, indent=1) + '\n'
    if PLANTS.read_text('utf8') != text:
        PLANTS.write_text(text, 'utf8')
    for p in sorted((ROOT / 'art' / 'plants').glob('plant_icons_*.sprite.json')):
        d = json.loads(p.read_text('utf8'))
        keys = d['keys']
        sh = Sheet(d['id'], d['size'][0], d['size'][1], anchor=d.get('anchor'))
        names = {n for n in keys.values() if n}
        for fr in d['frames']:
            sh.add(fr if isinstance(fr, (int, dict)) else soft_ring([[keys[c] for c in row] for row in fr], names))
        emit(sh)
