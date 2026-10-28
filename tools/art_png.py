"""Готовые картинки визуала (ТЗ-визуал 28.10, D-76) → sprite-as-data. Исходники — `art/png/` (кладёт `tools/art_png_import.py`).

Шаг 0 (t42): картинки сгенерированы на палитре игры, но кадры анимаций PixelLab сдвигают часть тонов. Каждый пиксель
переводится в имя цвета палитры (`art/palette.json` + рампы материалов): совпал — как есть, нет — ближайший по ΔE, новых
цветов не появляется (`npm run sprites:check` проверяет, что вне палитры ничего нет). `stats()` считает, сколько пикселей
подменено.

Что строится (если исходника нет — остаётся прежний лист из `art_*.py`):
- `hero` 48×48, якорь — ноги по центру снизу: ходьба `walking` (6), стойка `breathing_idle` (4), полив `water_pm` (9),
  ящик `carry_pm` (9). Кадры 32×32 и `*_pm` 40/44/48 совпадают по центру (первый кадр `*_pm` = поворот), поэтому
  все кладутся центром в одну точку, ноги — на строку `FEET` (якорь листа). Имена анимаций прежние (`World.createAnims`, `farmLayer`).
- `cat` 48×48 тем же способом: сидит `idle` (8), идёт на юг и север `walk_pm2` со 2-го кадра, на восток `walk_pm`, на запад —
  зеркало востока. Позы, которых нет в пакете (умывается, спит, лежит, нюхает, крадётся, прыжок), — сидячий кадр в ту же
  сторону (прыжок — шаг). В мире кот меньше героя: `CAT_SCALE` в `scenes/World.ts`.
- `cat_portrait` 64×64 (если есть) — портрет в реплике кота.
- предметы дома 32×32 (`art/png/props/<id>.png`), растения `plant_vNN` 32×32 из `art/png/plants/vNN_<стадия>.png` (24×32 по центру).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

from art_core import Sheet, emit, grid_flip
from art_ramp import ROOT

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sprites_build import load_palette  # noqa: E402

SRC = ROOT / 'art' / 'png'
_PAL = load_palette()
_BY_RGB: dict[tuple[int, int, int], str] = {}
for _n, _c in sorted(_PAL.names.items()):
    _BY_RGB.setdefault(tuple(_c), _n)
_STATS = {'px': 0, 'moved': 0}
_CACHE: dict[tuple[int, int, int], str] = {}

DIRS = {'down': 'south', 'up': 'north', 'left': 'west', 'right': 'east'}
CELL = 48
FEET = 36  # строка ног в клетке: ниже ног остаётся место брызгам лейки (якорь листа, `World` ставит по нему origin)


def name_of(c: tuple[int, int, int]) -> str:
    _STATS['px'] += 1
    if c in _BY_RGB:
        return _BY_RGB[c]
    _STATS['moved'] += 1
    if c not in _CACHE:
        _CACHE[c] = _BY_RGB[tuple(_PAL.nearest(c))]
    return _CACHE[c]


def stats() -> dict[str, int]:
    return dict(_STATS)


def grid_of(path: Path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    return [[name_of(px[x, y][:3]) if px[x, y][3] else None for x in range(w)] for y in range(h)]


def place(g, w: int, h: int, cx: int, cy: int, sx: int, sy: int, where: str):
    """Кладёт кадр так, что его точка (sx, sy) попадает в (cx, cy) клетки w×h. Непрозрачное за краем — ошибка."""
    out = [[None] * w for _ in range(h)]
    for y, row in enumerate(g):
        for x, c in enumerate(row):
            if c is None:
                continue
            X, Y = cx - sx + x, cy - sy + y
            if not (0 <= X < w and 0 <= Y < h):
                raise SystemExit(f'art_png: {where}: пиксель ({x},{y}) вне клетки {w}×{h}')
            out[Y][X] = c
    return out


def bottom_row(g) -> int:
    return max(y for y, r in enumerate(g) if any(r))


def frames(d: Path) -> list[Path]:
    return sorted(d.glob('*.png'), key=lambda p: int(p.stem)) if d.is_dir() else []


class CharSheet:
    """Лист персонажа: все кадры центром (центр поворота 32×32) в одну точку клетки, ноги поворотов — на нижнюю строку."""

    def __init__(self, sid: str, root: Path):
        self.root = root
        rots = [grid_of(root / 'rotations' / f'{d}.png') for d in DIRS.values()]
        self.feet = max(bottom_row(g) for g in rots)  # строка ног в кадре 32×32
        self.sh = Sheet(sid, CELL, CELL, anchor=[CELL // 2, FEET])
        self.seen: dict[str, int] = {}

    def add(self, g, where: str) -> int:
        off = (len(g[0]) - 32) // 2
        cell = place(g, CELL, CELL, CELL // 2, FEET, 16 + off, self.feet + off, where)
        key = json.dumps(cell)
        if key not in self.seen:
            self.seen[key] = self.sh.add(cell)
        return self.seen[key]

    def flip(self, i: int) -> int:
        key = json.dumps(grid_flip(self.sh.grids()[i]))
        if key not in self.seen:
            self.seen[key] = self.sh.flip_of(i)
        return self.seen[key]

    def anim(self, name: str, d: str, skip: int = 0) -> list[int]:
        fs = frames(self.root / name / d)[skip:]
        return [self.add(grid_of(p), f'{self.sh.sid} {name}/{d}/{p.stem}') for p in fs]


def build_hero() -> None:
    root = SRC / 'hero'
    if not root.is_dir():
        return
    c = CharSheet('hero', root)
    an: dict[str, list[int]] = {}
    for k, d in DIRS.items():
        walk = c.anim('walking', d)
        idle = c.anim('breathing_idle', d)
        water = c.anim('water_pm', d)
        carry = c.anim('carry_pm', d)
        an[f'idle_{k}'] = idle
        an[f'walk_{k}'] = walk
        # Полив: от стойки к струе и обратно к стойке — проигрывается петлёй, пока герой поливает.
        an[f'water_{k}'] = water[1:]
        an[f'fert_{k}'] = water[1:5]
        # Ящик: поднял (кадры 0–2) и держит (3–8, лёгкое покачивание).
        an[f'carry_idle_{k}'] = [carry[4]]
        an[f'carry_walk_{k}'] = carry[3:]
        an[f'throw_{k}'] = [carry[2], carry[1]]
    # Битый кадр стойки (ТЗ: у Оли юг, 4-й кадр — волосы вместо лица): цикл 1, 2, 3, 2.
    meta = json.loads((SRC / 'SOURCE.json').read_text('utf8')) if (SRC / 'SOURCE.json').exists() else {}
    if meta.get('hero') == 'olya':
        s = an['idle_down']
        an['idle_down'] = [s[0], s[1], s[2], s[1]]
    c.sh.anims = an
    emit(c.sh)


def build_cat() -> None:
    root = SRC / 'cat'
    if not root.is_dir():
        return
    c = CharSheet('cat', root)
    an: dict[str, list[int]] = {}
    sit = {k: c.anim('idle', d) for k, d in DIRS.items()}
    east = c.anim('walk_pm', 'east')
    walk = {'down': c.anim('walk_pm2', 'south', 2), 'up': c.anim('walk_pm2', 'north', 2), 'right': east, 'left': [c.flip(i) for i in east]}
    for k in DIRS:
        an[f'idle_{k}'] = sit[k]
        an[f'walk_{k}'] = walk[k]
    an['sit'] = sit['down']
    an['wash'] = sit['down']
    an['sleep'] = [sit['down'][0]]
    for side in ('left', 'right'):
        an[f'sniff_{side}'] = sit[side]
        an[f'crouch_{side}'] = sit[side][:2]
        an[f'lie_{side}'] = [sit[side][0]]
        an[f'pounce_{side}'] = [walk[side][len(walk[side]) // 2]]
    c.sh.anims = an
    emit(c.sh)
    p = SRC / 'cat_portrait.png'
    if p.exists():
        g = grid_of(p)
        sh = Sheet('cat_portrait', len(g[0]), len(g), anchor=[len(g[0]) // 2, len(g) - 1])
        sh.add(g)
        emit(sh)


def build_props() -> None:
    for p in sorted((SRC / 'props').glob('*.png')):
        g = grid_of(p)
        w, h = len(g[0]), len(g)
        sh = Sheet(p.stem, w, h, anchor=[w // 2, h - 1])
        sh.add(g)
        emit(sh)


def plant_frames(n: int, stages: tuple[str, ...]):
    """Кадры куста `plant_vNN` 32×32 (24×32 по центру, низ к низу) или None, если картинок нет."""
    ps = [SRC / 'plants' / f'v{n:02d}_{st}.png' for st in stages]
    if not all(p.exists() for p in ps):
        return None
    out = []
    for p in ps:
        g = grid_of(p)
        out.append(place(g, 32, 32, 16, 31, len(g[0]) // 2, len(g) - 1, p.name))
    return out


def build() -> None:
    build_hero()
    build_cat()
    build_props()
