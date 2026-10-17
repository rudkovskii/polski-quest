"""Урожай и эффекты фермы: стадии роста (семя → росток → куст → спелое → перезревшее), плоды в руку, капля, искра, мокрая земля.

Всё 16×16, anchor [8,15] (низ клетки), рисуется поверх тайла грядки (землю вокруг рисует игра, кроме кочки у семени).
Свет сверху-слева, цвета только из материалов (art/materials.json).
"""
from __future__ import annotations

import random

from art_core import Cv, P, Sheet, emit, single
from art_tiles import patch, T

PARTS = {
    'soil': P('soil', r=2, g='mound'),
    'stem': P('leaf', r=1, g='stem'),
    'leaf': P('leaf', r=2, g='leafA'), 'leaf2': P('leaf2', r=2, g='leafB'),
    'leafc': P('leaf', r=3, g='bush'), 'leaf2c': P('leaf2', r=2, g='bush2'),
    'dry': P('leaf_dry', r=1, g='dry'),
    'tom': P('tomato', r=1, g='tom'), 'tom2': P('tomato', r=1, g='tom2'), 'tom3': P('tomato', r=1, g='tom3'),
    'old': P('fruit_old', r=1, g='old'), 'old2': P('fruit_old', r=1, g='old2'),
    'petal': P('sunflower', flat=2, g='petal'), 'core': P('trunk', r=2, g='core'),
}
for _k in range(6):
    PARTS[f'A{_k}'] = P('leaf', r=2, g=f'LA{_k}')
    PARTS[f'B{_k}'] = P('leaf2', r=2, g=f'LB{_k}')
    PARTS[f'd{_k}'] = P('leaf_dry', r=2, g=f'LD{_k}')
    PARTS[f'f{_k}'] = P('tomato', flat=2, g=f'F{_k}')
    PARTS[f'o{_k}'] = P('fruit_old', flat=2, g=f'O{_k}')


def speckle(c: Cv, rng: random.Random, pts, light: str, dark: str, n: int) -> None:
    pts = [(x, y) for x, y in pts if c.m[y * c.w + x]]
    for _ in range(n):
        if not pts:
            return
        x, y = rng.choice(pts)
        c.dot(x, y, light if (x + y) % 3 else dark)


def mound(c: Cv, cy: float, rx: float, ry: float) -> None:
    c.ell(8, cy, rx, ry, 'soil')


def crop_seed() -> None:
    c = Cv(16, 16, PARTS)
    mound(c, 13.3, 5.6, 2.5)
    c.hline(5, 11, 13, 'soil.1')
    c.dots([6, 12, 9, 12, 8, 13], 'dirt.3')
    c.dots([7, 12, 10, 12, 9, 13], 'dirt.1')
    single('crop_seed', c.render(), anchor=[8, 15])


def crop_sprout() -> None:
    c = Cv(16, 16, PARTS)
    mound(c, 14.0, 4.2, 1.6)
    c.rect(7.5, 9.2, 1.0, 5.0, 'stem')
    c.poly([[7.5, 9.6], [3.6, 8.4], [2.6, 6.2], [5.6, 6.0], [7.5, 7.6]], 'leaf')
    c.poly([[8.5, 8.6], [12.4, 7.6], [13.4, 5.2], [10.4, 5.2], [8.5, 6.8]], 'leaf2')
    c.dots([4, 7, 11, 6], 'leaf.4')
    single('crop_sprout', c.render(), anchor=[8, 15])


def _leaves(c: Cv, spec, base: int = 0) -> None:
    for k, (x, y, rx, ry, mat) in enumerate(spec):
        c.ell(x, y, rx, ry, f'{mat}{(base + k) % 6}')


def plant(c: Cv, spec=None, dry=(), stem_top: float = 8.0) -> None:
    """Куст: стебель и россыпь листьев (каждый лист своей группой, между ними тёмные швы)."""
    c.rect(7.2, stem_top, 1.6, 15.0 - stem_top, 'stem')
    spec = spec or [
        (4.4, 12.0, 3.2, 2.0, 'A'), (11.8, 12.0, 3.2, 2.0, 'B'),
        (4.2, 8.4, 3.0, 2.2, 'B'), (12.0, 8.2, 3.0, 2.2, 'A'),
        (8.0, 5.6, 2.6, 2.8, 'B'), (8.0, 10.6, 2.3, 2.6, 'A'),
    ]
    for k, (x, y, rx, ry, m) in enumerate(spec):
        c.ell(x, y, rx, ry, f'd{k}' if k in dry else f'{m}{k}')


def crop_bush() -> None:
    c = Cv(16, 16, PARTS)
    plant(c)
    c.dots([3, 7, 10, 4, 7, 4, 10, 7], 'leaf.4')
    c.dots([7, 8, 6, 12, 14, 12], 'leaf.3')
    single('crop_bush', c.render(), anchor=[8, 15])


def fruit(c: Cv, x: float, y: float, part: str, r: float = 1.7, mat: str = 'tomato') -> None:
    """Плоский плод: блик сверху-слева, тень снизу-справа."""
    c.ell(x, y, r, r, part)
    c.dot(x - r * 0.45, y - r * 0.45, f'{mat}.4' if mat == 'tomato' else f'{mat}.3')
    c.dot(x + r * 0.45, y + r * 0.45, f'{mat}.1')


def crop_ripe() -> None:
    c = Cv(16, 16, PARTS)
    plant(c, spec=[
        (4.6, 12.0, 3.0, 1.8, 'A'), (11.6, 12.2, 3.0, 1.8, 'B'),
        (4.4, 8.0, 2.8, 2.0, 'B'), (11.8, 7.6, 2.8, 2.0, 'A'),
        (8.0, 5.4, 2.6, 2.8, 'B'), (8.0, 10.0, 2.0, 2.6, 'A'),
    ])
    for k, (x, y) in enumerate(((3.4, 10.4), (12.6, 10.0), (8.0, 12.6), (4.4, 6.0))):
        fruit(c, x, y, f'f{k}', 2.0)
    single('crop_ripe', c.render(), anchor=[8, 15])


def sunflower_head(c: Cv, cx: float, cy: float, rp: float, rc: float) -> None:
    import math
    c.ell(cx, cy, rp, rp, 'petal')
    for k in range(8):  # зубчики лепестков
        a = k * math.pi / 4
        c.ell(cx + math.cos(a) * (rp + 0.3), cy + math.sin(a) * (rp + 0.3), 0.9, 0.9, 'petal')
    c.ell(cx, cy, rc, rc, 'core')
    for k in range(12):  # швы между лепестками
        a = k * math.pi / 6 + 0.26
        c.dot(cx + math.cos(a) * (rp - 0.4), cy + math.sin(a) * (rp - 0.4), 'sunflower.1')


def crop_ripe_phrase() -> None:
    c = Cv(16, 16, PARTS)
    c.rect(7.4, 8.0, 1.3, 7.0, 'stem')
    c.poly([[7.4, 13.8], [3.0, 12.8], [1.8, 10.6], [5.4, 10.8], [7.4, 12.2]], 'leaf')
    c.poly([[8.7, 12.6], [13.0, 11.4], [14.2, 9.2], [10.6, 9.6], [8.7, 11.0]], 'leaf2')
    sunflower_head(c, 8.0, 5.0, 3.6, 1.9)
    c.dots([5, 3, 6, 2, 4, 5], 'sunflower.4')
    c.dots([8, 5, 9, 6], 'trunk.1')
    single('crop_ripe_phrase', c.render(), anchor=[8, 15])


def crop_overripe() -> None:
    c = Cv(16, 16, PARTS)
    plant(c, spec=[
        (4.0, 12.8, 3.4, 1.7, 'A'), (12.4, 12.8, 3.2, 1.7, 'B'),
        (4.6, 10.2, 2.8, 1.9, 'B'), (11.6, 10.4, 2.8, 2.0, 'A'),
        (9.8, 8.0, 2.4, 2.0, 'B'), (8.0, 11.6, 2.2, 2.2, 'A'),
    ], dry=(1, 3, 4), stem_top=9.0)
    for k, (x, y) in enumerate(((4.6, 12.6), (11.4, 13.0))):
        fruit(c, x, y, f'o{k}', 1.8, 'fruit_old')
    single('crop_overripe', c.render(), anchor=[8, 15])


def crop_item() -> None:
    c = Cv(16, 16, PARTS)
    c.ell(5.8, 11.2, 3.6, 3.4, 'tom'); c.ell(10.8, 12.0, 3.2, 3.0, 'tom2')
    c.poly([[4.6, 8.8], [5.8, 7.6], [7.0, 8.8], [6.2, 9.4], [5.8, 9.0], [5.0, 9.4]], 'stem')
    c.poly([[9.6, 10.0], [10.8, 9.0], [12.0, 10.0], [11.2, 10.6], [10.8, 10.2], [10.0, 10.6]], 'stem')
    c.rect(7.4, 3.0, 1.2, 6.0, 'stem')
    c.poly([[7.4, 6.4], [3.6, 5.6], [2.8, 3.4], [5.8, 3.4], [7.4, 4.8]], 'leaf')
    c.poly([[8.6, 5.6], [12.4, 4.6], [13.2, 2.6], [10.2, 2.6], [8.6, 3.8]], 'leaf2')
    c.dots([4, 9, 9, 10], 'tomato.4')
    c.dots([4, 4], 'leaf.4')
    single('item_crop', c.render(), anchor=[8, 15])


def crop_item_phrase() -> None:
    c = Cv(16, 16, PARTS)
    c.rect(7.4, 11.0, 1.3, 4.0, 'stem')
    c.poly([[7.4, 14.0], [3.4, 13.2], [2.6, 11.2], [5.8, 11.4], [7.4, 12.6]], 'leaf')
    c.poly([[8.7, 13.6], [12.8, 12.6], [13.6, 10.8], [10.4, 11.0], [8.7, 12.2]], 'leaf2')
    sunflower_head(c, 8.0, 6.4, 4.4, 2.4)
    c.dots([5, 3, 4, 5, 6, 2], 'sunflower.4')
    c.dots([8, 6, 9, 7], 'trunk.1')
    single('item_crop_phrase', c.render(), anchor=[8, 15])


def fx() -> None:
    g = [[None] * 16 for _ in range(16)]
    for (x, y), n in {(8, 10): 'water.3', (7, 11): 'water.3', (8, 11): 'water.2', (9, 11): 'water.1',
                      (7, 12): 'water.2', (8, 12): 'water.4', (9, 12): 'water.1', (7, 13): 'water.2', (8, 13): 'water.2',
                      (9, 13): 'water.1', (8, 14): 'water.1'}.items():
        g[y][x] = n
    single('fx_drop', g, anchor=[8, 15])
    a = [[None] * 16 for _ in range(16)]
    b = [[None] * 16 for _ in range(16)]
    for x, y in ((8, 5), (8, 6), (8, 10), (8, 11), (5, 8), (6, 8), (10, 8), (11, 8)):
        a[y][x] = 'petal_yellow.3'
    for x, y in ((8, 7), (7, 8), (9, 8), (8, 9), (8, 8)):
        a[y][x] = 'petal_yellow.4'
    for x, y in ((6, 6), (10, 6), (6, 10), (10, 10)):
        b[y][x] = 'petal_yellow.3'
    for x, y in ((7, 7), (9, 7), (7, 9), (9, 9), (8, 8)):
        b[y][x] = 'petal_yellow.4'
    for x, y in ((8, 7), (7, 8), (9, 8), (8, 9)):
        b[y][x] = 'gold.2'
    sh = Sheet('fx_spark', 16, 16, anchor=[8, 8], anims={'twinkle': [0, 1]})
    sh.add(a); sh.add(b)
    emit(sh)


def soil_wet() -> None:
    rng = random.Random(77)
    g = patch('soil_wet', 31, 15, True)
    for _ in range(5):  # блики влаги
        x, y = rng.randrange(1, T - 1), rng.randrange(1, T - 1)
        if y % 4 == 1:
            g[y][x] = 'soil_wet.4'
    single('soil_wet', g, anchor=[8, 15])


def build() -> None:
    crop_seed(); crop_sprout(); crop_bush(); crop_ripe(); crop_ripe_phrase(); crop_overripe()
    crop_item(); crop_item_phrase(); fx(); soil_wet()
