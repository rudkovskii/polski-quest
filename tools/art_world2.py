"""Арт мира v2 (Zagroda): точки входа у дома, сад, пасека, огород месяцев, клумба, украшения праздников, тайлы Zagroda.

Спрайты `w2_*` (мир), `t2_*` (тайлы). Всё кратно 16, цвета только из материалов (art/materials.json), свет сверху-слева.
Ключи кадров и размеры — в конце файла (таблица `KEYS`) и в отчёте. Фигуры из Cv (art_core) или ASCII-рисунком (`asc`).
"""
from __future__ import annotations

import json
import math
import random

import art_core
from art_core import Cv, P, Sheet, emit, single
from art_ramp import ROOT
from art_props import speckle
import art_crops
from art_tiles import patch, edge_dist, corner_cut, N, E, S, W, grid as tgrid

T = 16


def asc(rows: list[str], legend: dict[str, str], cw: int, ch: int, ox: int | None = None, oy: int | None = None):
    """ASCII-рисунок в ячейку cw×ch (кратно 16): ox, oy — смещение рисунка (по умолчанию по центру-низу)."""
    h, w = len(rows), max(len(r) for r in rows)
    ox = (cw - w) // 2 if ox is None else ox
    oy = ch - h if oy is None else oy
    g = [[None] * cw for _ in range(ch)]
    for j, row in enumerate(rows):
        for i, c in enumerate(row):
            if c in legend and legend[c]:
                g[oy + j][ox + i] = legend[c]
    return g


def outline_of(g, name: str = 'outline'):
    """Тёмный контур снаружи фигуры (4-соседство) для нарисованного ASCII без своего контура."""
    h, w = len(g), len(g[0])
    add = []
    for y in range(h):
        for x in range(w):
            if g[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and g[yy][xx] and g[yy][xx] != name:
                    add.append((x, y))
                    break
    for x, y in add:
        g[y][x] = name
    return g


def blank(w: int, h: int):
    return [[None] * w for _ in range(h)]


def paste(dst, src, ox: int, oy: int) -> None:
    for y, row in enumerate(src):
        for x, c in enumerate(row):
            if c and 0 <= oy + y < len(dst) and 0 <= ox + x < len(dst[0]):
                dst[oy + y][ox + x] = c


def sheet(sid: str, w: int, h: int, frames, anchor=None, anims=None) -> Sheet:
    sh = Sheet(sid, w, h, anchor=anchor, anims=anims)
    for f in frames:
        sh.add(f)
    emit(sh)
    return sh


# ───────────────────────────── яблоня ─────────────────────────────

TREE_PARTS = {
    'trunk': P('trunk', r=2, g='trunk'), 'crown': P('leaf', r=4, g='crown'), 'crown2': P('leaf2', r=3, g='crown'),
    'stake': P('wood', r=1, g='stake'), 'mound': P('soil', r=2, g='mound'),
}


def apple_dots(c: Cv, x: int, y: int, big: bool = False) -> None:
    """Яблоко 3×3 (блик сверху-слева, тень снизу-справа); большое — 4×4 с чёрешком."""
    if big:
        c.dots([x, y, x + 1, y], 'tomato.3')
        c.dots([x, y + 1, x + 1, y + 1, x + 2, y + 1, x + 3, y + 1], 'tomato.2')
        c.dots([x, y + 2, x + 1, y + 2, x + 2, y + 2], 'tomato.2'); c.dot(x + 3, y + 2, 'tomato.1')
        c.dots([x + 1, y + 3, x + 2, y + 3], 'tomato.1')
        c.dot(x, y, 'tomato.4'); c.dot(x + 2, y - 1, 'trunk.2')
    else:
        c.dot(x, y, 'tomato.4'); c.dots([x + 1, y, x, y + 1, x + 1, y + 1], 'tomato.2')
        c.dots([x + 2, y + 1, x + 1, y + 2, x + 2, y + 2], 'tomato.1')


def crown_full(c: Cv, rng: random.Random, scale: float = 1.0) -> None:
    c.rect(13, 30, 6, 16.5, 'trunk')
    c.ell(16, 46, 6.5, 1.8, 'trunk'); c.ell(10.5, 44.5, 2.2, 1.2, 'trunk'); c.ell(21.5, 44.5, 2.2, 1.2, 'trunk')
    c.ell(16, 18, 13.5 * scale, 13 * scale, 'crown')
    c.ell(8.5, 24, 7.5 * scale, 6.5 * scale, 'crown'); c.ell(23.5, 24, 7.5 * scale, 6.5 * scale, 'crown')
    c.ell(14, 10, 8.5 * scale, 7 * scale, 'crown2'); c.ell(21, 14, 6 * scale, 5 * scale, 'crown2')
    speckle(c, rng, lambda x, y: y < 30 and x + y < 34, 'leaf.3', 'leaf.2', 18)
    speckle(c, rng, lambda x, y: y < 31 and x + y > 36, 'leaf.1', 'leaf.2', 20)


def crown_cells(c: Cv) -> list[tuple[int, int]]:
    return [(x, y) for y in range(4, 33) for x in range(2, 30)
            if c.m[y * c.w + x] in ('crown', 'crown2') and all(c.m[(y + dy) * c.w + x + dx] in ('crown', 'crown2') for dx, dy in ((1, 1), (-1, -1), (2, 0), (0, 2)) if 0 <= x + dx < c.w and 0 <= y + dy < c.h)]


def apple_tree_frames() -> list:
    rng = random.Random(41)
    fr = []
    # 0 саженец: тонкий ствол на колышке, пара листьев
    c = Cv(32, 48, TREE_PARTS)
    c.ell(16, 46.6, 5, 1.6, 'mound')
    c.rect(15, 33, 2, 14, 'trunk')
    c.rect(21, 36, 1.6, 11, 'stake')
    c.ell(16, 30, 3.6, 2.8, 'crown'); c.ell(11.6, 33.4, 2.8, 1.9, 'crown2'); c.ell(20.4, 32.6, 2.6, 1.8, 'crown2')
    c.dots([14, 29, 11, 33], 'leaf.4')
    fr.append(c.render())
    # 1 деревце: тоньше крона, без цвета
    c = Cv(32, 48, TREE_PARTS)
    c.rect(14.5, 28, 3.4, 18.5, 'trunk')
    c.ell(16, 46, 5.2, 1.6, 'trunk'); c.ell(12, 44.8, 1.8, 1.0, 'trunk'); c.ell(20, 44.8, 1.8, 1.0, 'trunk')
    c.rect(22, 36, 1.6, 11, 'stake')
    c.ell(16, 21, 9.4, 8.6, 'crown'); c.ell(10.4, 26, 5, 4.2, 'crown'); c.ell(21.6, 26, 5, 4.2, 'crown')
    c.ell(14, 15, 5.6, 4.6, 'crown2'); c.ell(19.4, 18, 4, 3.4, 'crown2')
    speckle(c, rng, lambda x, y: y < 28 and x + y < 32, 'leaf.3', 'leaf.2', 10)
    speckle(c, rng, lambda x, y: y < 29 and x + y > 36, 'leaf.1', 'leaf.2', 10)
    fr.append(c.render())
    # 2 цветёт
    c = Cv(32, 48, TREE_PARTS)
    crown_full(c, rng, 1.0)
    cells = crown_cells(c)
    r2 = random.Random(7)
    r2.shuffle(cells)
    for k, (x, y) in enumerate(cells[:46]):
        c.dot(x, y, ('petal_pink.3', 'petal_white.3', 'petal_pink.2', 'petal_white.4')[k % 4])
        if k % 3 == 0:
            c.dot(x + 1, y, 'petal_pink.4')
    for x, y in ((9, 46), (22, 45), (14, 47), (19, 46)):
        c.dot(x, y, 'petal_pink.3')
    fr.append(c.render())
    # 3 яблоки
    c = Cv(32, 48, TREE_PARTS)
    crown_full(c, random.Random(41), 1.0)
    cells = crown_cells(c)
    random.Random(11).shuffle(cells)
    picked: list[tuple[int, int]] = []
    for x, y in cells:
        if all(abs(x - a) + abs(y - b) > 6 for a, b in picked) and y > 8:
            picked.append((x, y))
        if len(picked) == 8:
            break
    for x, y in picked:
        apple_dots(c, x, y)
    fr.append(c.render())
    # 4 урожай: много крупных яблок, золотые блики, упавшие у ствола
    c = Cv(32, 48, TREE_PARTS)
    crown_full(c, random.Random(41), 1.0)
    cells = crown_cells(c)
    random.Random(23).shuffle(cells)
    picked = []
    for x, y in cells:
        if all(abs(x - a) + abs(y - b) > 5 for a, b in picked) and y > 7:
            picked.append((x, y))
        if len(picked) == 13:
            break
    for x, y in picked:
        apple_dots(c, x, y, big=True)
    for x, y in ((8, 45), (23, 45), (11, 46)):
        apple_dots(c, x, y)
    c.dots([5, 6, 27, 9, 25, 3, 7, 12], 'gold.3'); c.dots([5, 5, 27, 8], 'gold.4')
    fr.append(c.render())
    return fr


# ───────────────────────────── улей, мёд, пчёлы ─────────────────────────────

HIVE_PARTS = {
    'leg': P('wood_dark', r=1, g='leg'), 'base': P('plank', r=1, g='base'),
    'b1': P('sunflower', r=2, g='b1'), 'b2': P('sunflower', r=2, g='b2'), 'b3': P('sunflower', r=2, g='b3'),
    'w1': P('wood', r=2, g='b1'), 'w2': P('wood', r=2, g='b2'),
    'roof': P('cream', r=2, g='roof'), 'eave': P('wood_dark', r=1, g='eave'),
    'drip': P('jam_gold', flat=2, g='drip'),
}


def bee(c: Cv, x: int, y: int) -> None:
    c.dot(x, y - 1, 'white'); c.dot(x, y, 'sunflower.3'); c.dot(x + 1, y, 'shade.2')


def hive(stage: str, bees: int = 0):
    """stage: empty | young | full. bees: 0/1 — положение пчёл (2 кадра гула)."""
    c = Cv(16, 32, HIVE_PARTS)
    painted = stage != 'empty'
    tall = stage == 'full'
    c.rect(2, 28, 12, 2, 'base')
    c.rect(3, 29, 2, 3, 'leg'); c.rect(11, 29, 2, 3, 'leg')
    top = 4 if tall else 11
    y3 = 21
    c.rect(2, y3, 12, 7, 'b3' if painted else 'w1')
    c.rect(2, y3 - 7, 12, 7, 'b2' if painted else 'w2')
    if tall:
        c.rect(2, y3 - 14, 12, 7, 'b1')
    roof_y = top - 3 if tall else 8
    c.poly([[1, roof_y + 3], [3, roof_y], [13, roof_y], [15, roof_y + 3]], 'roof')
    c.rect(1, roof_y + 3, 14, 1.2, 'eave')
    # вход и планки
    c.hline(5, 11, 26, 'shade.1'); c.hline(4, 12, 27, 'plank.2')
    body = 'sunflower' if painted else 'wood'
    for yy in (y3 - 5, y3 + 2):
        c.dots([4, yy, 5, yy, 10, yy, 11, yy], f'{body}.1')
    if tall:
        c.dots([4, y3 - 12, 5, y3 - 12, 10, y3 - 12, 11, y3 - 12], 'sunflower.1')
        # стекающий мёд
        for x, ln in ((4, 3), (9, 4), (12, 2)):
            for k in range(ln):
                c.dot(x, y3 - 7 + k + (0 if x != 9 else 0), 'jam_gold.2')
            c.dot(x, y3 - 7 + ln, 'jam_gold.4')
    if stage == 'young':
        pts = ((3, 24), (11, 20)) if bees == 0 else ((4, 21), (12, 23))
    elif stage == 'full':
        pts = ((1, 17), (13, 12), (6, 7), (10, 24)) if bees == 0 else ((2, 14), (12, 16), (7, 4), (4, 24))
    else:
        pts = ()
    for x, y in pts:
        bee(c, x, y)
    return c.render()


def hive_sheet() -> None:
    fr = [hive('empty'), hive('young', 0), hive('young', 1), hive('full', 0), hive('full', 1)]
    sheet('w2_hive', 16, 32, fr, anchor=[8, 31], anims={'young': [1, 2], 'full': [3, 4]})


def honey_jar():
    c = Cv(16, 16, {
        'lid': P('wood_dark', r=1, g='lid'), 'neck': P('jar_glass', r=1, g='neck'), 'honey': P('jam_gold', r=3, g='honey'),
        'label': P('paper', flat=2, g='label'),
    })
    c.rect(5, 2, 6, 2, 'lid'); c.rect(5, 4, 6, 2, 'neck')
    c.rect(3, 6, 10, 9, 'honey')
    c.clear(lambda x, y: (x < 4 or x > 12) and (y < 7 or y > 13))
    c.clear(lambda x, y: x < 3.5 and y > 13)
    c.rect(5, 9, 6, 4, 'label')
    c.dots([4, 7, 4, 8], 'jar_glass.4');c.dots([5, 11, 8, 11, 10, 11], 'stone.2'); c.hline(6, 10, 12, 'stone.1')
    c.dot(11, 8, 'jam_gold.4')
    return c.render()


def bee_sheet() -> None:
    fa, fb = blank(16, 16), blank(16, 16)
    for g, up in ((fa, 1), (fb, 0)):
        g[8][7] = 'sunflower.3'; g[8][8] = 'shade.2'; g[8][9] = 'sunflower.3'; g[8][10] = 'shade.2'
        for x in (7, 9):
            g[7 - up][x] = 'white'
        g[8 + 1][8] = 'outline'
    sheet('w2_bee', 16, 16, [fa, fb], anchor=[8, 8], anims={'fly': [0, 1]})


# ───────────────────────────── подсолнух ─────────────────────────────

SF_PARTS = {
    'stem': P('leaf', r=1, g='stem'), 'leaf': P('leaf', r=2, g='lA'), 'leaf2': P('leaf2', r=2, g='lB'),
    'petal': P('sunflower', flat=2, g='petal'), 'core': P('trunk', r=2, g='core'), 'sep': P('leaf', r=1, g='sep'),
    'pile': P('loose', r=2, g='pile'), 'dry': P('leaf_dry', flat=1, g='dry'), 'dstem': P('trunk', r=1, g='dstem'),
    'dleaf': P('leaf_dry', r=2, g='dl'),
}


def sunflower_frames() -> list:
    fr = []
    # 0 семечко: холмик и кончик
    c = Cv(16, 32, SF_PARTS)
    c.ell(8, 30, 4.6, 1.9, 'pile'); c.rect(7.4, 26.6, 1.2, 3, 'stem'); c.rect(5.4, 26, 2.2, 1.6, 'leaf'); c.rect(8.4, 25.4, 2.4, 1.6, 'leaf2')
    c.dots([6, 30, 10, 31], 'loose.3')
    fr.append(c.render())
    # 1 росток
    c = Cv(16, 32, SF_PARTS)
    c.ell(8, 30.4, 4.0, 1.5, 'pile')
    c.rect(7.2, 20, 1.6, 11, 'stem')
    c.poly([[7.2, 25], [3.2, 24], [1.4, 20.6], [5.2, 19.6], [7.2, 22]], 'leaf')
    c.poly([[8.8, 23.4], [12.8, 22.4], [14.6, 19.2], [10.6, 18.6], [8.8, 20.6]], 'leaf2')
    c.dots([4, 21, 11, 20], 'leaf.4')
    fr.append(c.render())
    # 2 бутон
    c = Cv(16, 32, SF_PARTS)
    c.rect(7.2, 11, 1.6, 20, 'stem')
    c.poly([[7.2, 27], [2.6, 26.4], [0.8, 22.4], [5.0, 21.8], [7.2, 24]], 'leaf')
    c.poly([[8.8, 24.4], [13.4, 23.6], [15.2, 19.6], [10.8, 19.4], [8.8, 21.8]], 'leaf2')
    c.ell(8, 8.4, 3.6, 3.6, 'sep'); c.ell(8, 6.6, 2.0, 2.0, 'petal')
    c.dots([6, 9, 10, 9, 8, 11], 'leaf.1'); c.dots([6, 7, 7, 6], 'leaf.4')
    fr.append(c.render())
    # 3 цветок
    c = Cv(16, 32, SF_PARTS)
    c.rect(7.2, 12, 1.6, 19, 'stem')
    c.poly([[7.2, 27], [2.2, 26.6], [0.6, 22.2], [5.0, 21.4], [7.2, 24]], 'leaf')
    c.poly([[8.8, 25.4], [13.8, 24.6], [15.4, 20.2], [11.0, 19.8], [8.8, 22.6]], 'leaf2')
    art_crops.sunflower_head(c, 8.0, 7.6, 6.4, 3.3)
    c.dots([4, 4, 5, 3, 3, 6, 6, 2], 'sunflower.4')
    c.dots([8, 7, 9, 8, 7, 9, 10, 6], 'trunk.1')
    fr.append(c.render())
    # 4 семена (урожай): тяжёлая тёмная шляпа с семенами, головка клонится
    c = Cv(16, 32, SF_PARTS)
    c.rect(7.2, 12, 1.6, 19, 'dstem')
    c.poly([[7.2, 27], [2.2, 26.6], [0.6, 22.2], [5.0, 21.4], [7.2, 24]], 'dleaf')
    c.poly([[8.8, 25.4], [13.8, 24.6], [15.4, 20.2], [11.0, 19.8], [8.8, 22.6]], 'dleaf')
    c.ell(8, 8.2, 6.6, 6.2, 'dry')
    c.ell(8, 8.4, 5.2, 5.0, 'core')
    for k in range(10):  # семена спиралью
        a = k * 2.4
        rr = 1 + 0.42 * k
        c.dot(8 + math.cos(a) * rr * 0.9, 8.4 + math.sin(a) * rr * 0.9, 'sunflower.3' if k % 2 else 'cat_cream.2')
    c.dots([8, 8, 9, 9, 7, 9], 'trunk.1')
    c.dots([4, 4, 12, 4, 3, 8, 13, 8], 'sunflower.2')
    fr.append(c.render())
    return fr


# ───────────────────────────── цветы клумбы ─────────────────────────────

def flower_frames(kind: str) -> list:
    mat = {'snow': 'petal_white', 'daff': 'petal_yellow', 'poppy': 'tomato', 'chrys': 'cat', 'viol': 'petal_violet'}[kind]
    parts = {
        'stem': P('leaf', r=1, g='stem'), 'lf': P('leaf', r=2, g='lf'), 'lf2': P('leaf2', r=2, g='lf2'),
        'pile': P('loose', r=2, g='pile'),
        'p': P(mat, r=2, g='p'), 'p2': P(mat, r=2, g='p2'), 'p3': P(mat, r=2, g='p3'), 'p4': P(mat, r=2, g='p4'), 'p5': P(mat, r=2, g='p5'),
        'bud': P(mat, r=2, g='bud'), 'sep': P('leaf', r=1, g='sep'),
        'mid': P('petal_yellow' if kind != 'daff' else 'cat', flat=3, g='mid'), 'dark': P('shade', flat=1, g='dark'),
    }
    out = []
    # стадия 0: росток
    c = Cv(16, 16, parts)
    c.ell(8, 14.4, 3.8, 1.4, 'pile')
    c.rect(7.4, 9, 1.2, 6, 'stem')
    c.poly([[7.4, 11.4], [4.0, 10.6], [2.6, 8.2], [5.6, 7.8], [7.4, 9.4]], 'lf')
    c.poly([[8.6, 10.4], [11.8, 9.6], [13.2, 7.2], [10.4, 6.8], [8.6, 8.4]], 'lf2')
    out.append(c.render())
    # стадия 1: бутон
    c = Cv(16, 16, parts)
    c.rect(7.4, 6, 1.2, 10, 'stem')
    c.poly([[7.4, 13.4], [3.4, 12.6], [1.8, 10.0], [5.4, 9.8], [7.4, 11.6]], 'lf')
    c.poly([[8.6, 12.4], [12.6, 11.6], [14.2, 9.0], [10.6, 8.8], [8.6, 10.6]], 'lf2')
    c.ell(8, 4.8, 2.0, 2.8, 'bud'); c.ell(8, 7.0, 2.2, 1.2, 'sep')
    c.dot(7, 3, f'{mat}.4')
    out.append(c.render())
    # стадия 2: цветёт
    c = Cv(16, 16, parts)
    c.rect(7.4, 8, 1.2, 8, 'stem')
    c.poly([[7.4, 13.4], [3.0, 12.4], [1.4, 9.8], [5.4, 9.6], [7.4, 11.6]], 'lf')
    c.poly([[8.6, 12.6], [13.0, 11.6], [14.6, 9.0], [10.6, 8.8], [8.6, 10.6]], 'lf2')
    if kind == 'poppy':
        for k, (x, y) in enumerate(((5.4, 5.2), (10.6, 5.2), (5.8, 8.4), (10.2, 8.4))):
            c.ell(x, y, 3.0, 2.8, f'p{k + 1 if k else ""}' if k else 'p')
        c.ell(8, 6.6, 1.2, 1.2, 'dark'); c.dots([7, 5, 9, 5], 'tomato.4')
    elif kind == 'daff':
        for k in range(6):
            a = k * math.pi / 3
            c.ell(8 + math.cos(a) * 3.4, 5.6 + math.sin(a) * 3.4, 1.9, 1.9, ('p', 'p2', 'p3', 'p4', 'p5', 'p')[k])
        c.ell(8, 5.6, 2.0, 2.0, 'mid')
        c.dot(7, 5, 'cat.4'); c.dot(8, 6, 'cat.1')
    elif kind == 'chrys':
        c.ell(8, 6.0, 5.4, 4.8, 'p')
        c.ell(8, 6.0, 3.6, 3.2, 'p2')
        c.ell(8, 6.0, 1.8, 1.6, 'mid')
        for k in range(10):
            a = k * math.pi / 5
            c.dot(8 + math.cos(a) * 4.6, 6.0 + math.sin(a) * 4.0, 'cat.1')
        c.dots([5, 3, 6, 2, 4, 5], 'cat.4')
    elif kind == 'viol':
        c.ell(5.8, 4.6, 2.8, 3.0, 'p'); c.ell(10.2, 4.6, 2.8, 3.0, 'p2')
        c.ell(5.2, 7.8, 2.6, 2.4, 'p3'); c.ell(10.8, 7.8, 2.6, 2.4, 'p4'); c.ell(8, 9.0, 2.6, 2.2, 'p5')
        c.ell(8, 6.8, 1.3, 1.3, 'mid'); c.dots([8, 8, 7, 9, 9, 9], 'shade.1')
    else:  # snow: три поникших колокольчика
        c.ell(8, 5.2, 1.0, 2.0, 'bud')
        c.cap(7.6, 7.4, 5.2, 9.0, 0.5, 'stem'); c.cap(8.4, 7.4, 10.8, 9.0, 0.5, 'stem')
        for x, y in ((8, 4.6), (5.0, 10.0), (11.0, 10.0)):
            c.ell(x, y, 2.0, 2.6, 'p'); c.dot(x, y + 2, 'leaf.2')
        c.dots([7, 3, 4, 9, 10, 9], f'{mat}.4')
    out.append(c.render())
    return out


FLOWER_KINDS = ('snow', 'daff', 'poppy', 'chrys', 'viol')


# ───────────────────────────── украшения праздников ─────────────────────────────

def znicz_frames() -> list:
    out = []
    for glass, light in (('tomato', 0), ('cream', 1)):
        for fl in (0, 1):
            g = blank(16, 16)
            # стакан: трапеция 6×7
            rows = {9: (5, 10), 10: (5, 10), 11: (5, 10), 12: (5, 10), 13: (5, 10), 14: (6, 9)}
            for y, (a, b) in rows.items():
                for x in range(a, b + 1):
                    shade = '4' if x == a else ('1' if x == b else '2')
                    g[y][x] = f'{glass}.{shade}'
            for x in range(5, 11):
                g[8][x] = 'wood_dark.2' if x not in (5, 10) else 'wood_dark.1'
            g[9][6] = f'{glass}.4' if glass == 'tomato' else 'white'
            g[11][7] = f'{glass}.3' if glass == 'tomato' else 'cream.4'
            # огонёк
            fy = 5 if fl == 0 else 4
            g[fy + 1][7] = 'gold.3'; g[fy + 1][8] = 'gold.3'; g[fy + 2][7] = 'cat.3'; g[fy + 2][8] = 'cat.3'
            g[fy][7 + fl] = 'petal_yellow.4'
            g[7][7] = 'shade.1'; g[7][8] = 'shade.1'
            outline_of(g)
            out.append(g)
    return out


def choinka_frames() -> list:
    out = []
    for blink in (0, 1):
        c = Cv(16, 32, {
            'tr': P('wood_dark', r=1, g='tr'),
            't1': P('leaf', r=3, g='t1'), 't2': P('leaf2', r=3, g='t2'), 't3': P('leaf', r=3, g='t3'),
            'star': P('gold', flat=3, g='star'), 'pot': P('sack', r=1, g='pot'),
        })
        c.rect(6, 26, 4, 3, 'tr')
        c.poly([[8, 17], [14.5, 27], [1.5, 27]], 't3')
        c.poly([[8, 9], [13.5, 20], [2.5, 20]], 't2')
        c.poly([[8, 3.4], [12, 12], [4, 12]], 't1')
        c.rect(5, 28, 6, 3, 'pot')
        c.poly([[8, 0], [9, 2.4], [11, 2.6], [9.4, 4], [10, 6], [8, 4.8], [6, 6], [6.6, 4], [5, 2.6], [7, 2.4]], 'star')
        cols = ['tomato.3', 'gold.3', 'blanket.3', 'petal_white.3']
        pts = [(8, 8), (6, 12), (10, 13), (5, 19), (9, 18), (12, 22), (7, 24), (3, 25), (10, 25), (8, 14)]
        for k, (x, y) in enumerate(pts):
            c.dot(x, y, cols[(k + blink) % 4])
        out.append(c.render())
    return out


def bunting_frames() -> list:
    out = []
    for sway in (0, 1):
        g = blank(32, 16)
        # провисающая верёвка: y = 1 + 3·sin(pi·x/32)^…, концы на y=1 (стыкуется по плиткам)
        ys = []
        for x in range(32):
            ys.append(1 + round(3.2 * math.sin(math.pi * x / 32)))
        for x in range(32):
            g[ys[x]][x] = 'trunk.2'
        # флажки: треугольники 4 шириной, 4–5 высотой, цвета чередуются белый/красный
        for k, x0 in enumerate(range(1, 32, 8)):
            xs = x0 + 2
            col = 'petal_white' if k % 2 == 0 else 'tomato'
            for j in range(5):
                w = 4 - j if j < 4 else 1
                for i in range(w):
                    xx = xs - (w // 2) + i + (1 if (sway and j > 2) else 0)
                    yy = ys[min(31, max(0, xx))] + 1 + j
                    if 0 <= xx < 32 and 0 <= yy < 16:
                        tone = 2 if j < 3 else 1
                        g[yy][xx] = f'{col}.{3 if (i == 0 and j < 3) else tone}'
        outline_of(g)
        out.append(g)
    return out


def pisanki():
    g = blank(16, 16)
    # салфетка
    for x in range(1, 15):
        for y in (12, 13):
            g[y][x] = 'cream.2'
        g[14][x] = 'cream.1'
    for x in range(1, 15, 2):
        g[14][x] = 'cream.2'
    eggs = [(4, 'tomato', 'petal_white'), (8, 'petal_yellow', 'blanket'), (12, 'blanket', 'petal_pink')]
    for cx, base, pat in eggs:
        for y in range(5, 13):
            w = {5: 1, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3, 11: 2, 12: 2}[y]
            for x in range(cx - w + 1, cx + w):
                tone = '3' if (x == cx - w + 1 and y < 9) else ('1' if (x == cx + w - 1 and y > 7) else '2')
                g[y][x] = f'{base}.{tone}'
            if y in (8, 9) and w >= 2:
                for x in range(cx - w + 1, cx + w):
                    g[y][x] = f'{pat}.2' if (x + y) % 2 == 0 else f'{pat}.3'
        g[7][cx] = f'{base}.4'
    # веточка
    for x, y in ((14, 6), (14, 7), (13, 5), (15, 5), (14, 4)):
        g[y][x] = 'leaf2.2'
    g[3][14] = 'petal_yellow.3'
    outline_of(g)
    return g


def palma():
    c = Cv(16, 32, {
        'st': P('wood', r=1, g='st'), 'bundle': P('leaf2', r=2, g='bundle'),
        'dry': P('petal_yellow', r=2, g='dry'), 'pink': P('petal_pink', r=2, g='pink'),
        'rib': P('tomato', flat=2, g='rib'), 'wh': P('petal_white', r=2, g='wh'),
    })
    c.rect(7, 12, 2, 19, 'st')
    c.ell(8, 9, 4.2, 5.4, 'bundle')
    c.ell(5, 5, 2.4, 2.4, 'dry'); c.ell(11, 5.4, 2.4, 2.4, 'pink'); c.ell(8, 3, 2.2, 2.2, 'wh')
    c.ell(5.2, 10.6, 2.2, 2.4, 'pink'); c.ell(10.8, 10.4, 2.2, 2.4, 'dry')
    c.rect(5, 13, 6, 1.6, 'rib'); c.rect(4, 15, 3, 1, 'rib'); c.rect(9, 15, 3, 1, 'rib')
    c.dots([6, 7, 9, 8, 7, 5], 'leaf2.4'); c.dots([6, 17, 9, 17], 'wood.4')
    return c.render()


# ───────────────────────────── карта на стене ─────────────────────────────

def outline_ring() -> list[tuple[float, float]]:
    p = ROOT / 'art' / 'geo' / 'poland_outline.json'
    if p.exists():
        return [tuple(pt) for pt in json.loads(p.read_text('utf8'))['ring']]
    # запасной контур (грубый, lon/lat)
    return [(14.12, 53.9), (16.5, 54.5), (18.3, 54.8), (19.5, 54.4), (23.5, 54.3), (23.9, 52.6), (23.5, 50.9),
            (24.1, 50.8), (22.7, 49.1), (19.0, 49.4), (16.9, 50.3), (15.0, 50.9), (14.6, 52.7)]


def silhouette(w: int, h: int, ox: int = 0, oy: int = 0, cw: int = 32, ch: int = 16):
    """Маска Польши (w×h px) и функция lon/lat → px в ячейке cw×ch."""
    from PIL import Image, ImageDraw
    ring = outline_ring()
    lo_lon, hi_lon = 14.12, 24.15
    lo_lat, hi_lat = 49.0, 54.84
    cosl = math.cos(math.radians(52))
    sx = w / ((hi_lon - lo_lon) * cosl)
    sy = h / (hi_lat - lo_lat)
    s = min(sx, sy)
    pw, ph = (hi_lon - lo_lon) * cosl * s, (hi_lat - lo_lat) * s
    x0, y0 = ox + (w - pw) / 2, oy + (h - ph) / 2

    def pr(lon, lat):
        return x0 + (lon - lo_lon) * cosl * s, y0 + (hi_lat - lat) * s
    S4 = 6
    big = Image.new('L', (cw * S4, ch * S4), 0)
    ImageDraw.Draw(big).polygon([(pr(*p)[0] * S4, pr(*p)[1] * S4) for p in ring], fill=255)
    sm = big.resize((cw, ch), Image.BOX).point(lambda v: 255 if v >= 110 else 0)
    px = sm.load()
    return [[px[x, y] > 0 for x in range(cw)] for y in range(ch)], pr


WALL_CITIES = [  # lat, lon: куда садятся красные точки-флажки (порядок = очередь появления)
    (52.23, 21.01), (50.06, 19.94), (54.35, 18.65), (51.11, 17.04), (52.41, 16.93),
    (53.43, 14.55), (51.25, 22.57), (53.13, 23.17), (51.76, 19.46), (50.04, 22.0),
]


def wall_map_frames() -> list:
    out = []
    cw, ch = 32, 16
    for state in ('roll', 'empty', 3, 6, 10, 'gold'):
        g = blank(cw, ch)
        if state == 'roll':
            # рулон у стены: туба с красной ленточкой, рядом гвоздик
            rows = [
                '..oooooo..',
                '.oPPPPQpo.',
                'oPQQQQQQpo',
                'oPQQQQQQpo',
                'oPrrrrrrpo',
                'oPrRRRRrpo',
                'oPrrrrrrpo',
                'oPQQQQQQpo',
                'oPQQQQQQpo',
                'oPQQQQQQpo',
                'oPQQQQQQpo',
                'oPQQQQQQpo',
                '.oPQQQQpo.',
                '..oooooo..',
            ]
            leg = {'o': 'outline', 'P': 'paper.3', 'p': 'paper.1', 'Q': 'paper.2', 'r': 'tomato.2', 'R': 'tomato.1'}
            g = asc(rows, leg, cw, ch, 11, 1)
            for y in range(2, 13):
                g[y][12] = 'paper.4' if y % 3 else 'paper.3'
            g[4][12] = 'tomato.3'
            out.append(g)
            continue
        gold = state == 'gold'
        frame_m = 'gold' if gold else 'wood'
        # рама 32×16: контур, фаска (свет сверху-слева), пергамент 28×12
        for y in range(ch):
            for x in range(cw):
                edge = min(x, y, cw - 1 - x, ch - 1 - y)
                if edge == 0:
                    g[y][x] = 'outline'
                elif edge == 1:
                    g[y][x] = f'{frame_m}.3' if (x <= y and x < cw - 1 - x) or (y < ch - 1 - y and y <= x and y < 2) else f'{frame_m}.1'
                else:
                    g[y][x] = 'paper.2'
        for x in range(2, cw - 2):
            g[2][x] = 'paper.3'
        for y in range(2, ch - 2):
            g[y][2] = 'paper.3'
        for x in range(2, cw - 2):
            g[ch - 3][x] = 'paper.1'
        # суша Польши по центру-слева, справа «легенда»: линии и компас
        mask, pr = silhouette(18, 11, 3, 2, cw, ch)
        for y in range(ch):
            for x in range(cw):
                if mask[y][x]:
                    g[y][x] = 'leaf2.3'
        for y in range(ch):
            for x in range(cw):
                if mask[y][x]:
                    for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
                        xx, yy = x + dx, y + dy
                        if 0 <= xx < cw and 0 <= yy < ch and not mask[yy][xx]:
                            g[y][x] = 'leaf.1'
                            break
        for k, (x0, w) in enumerate(((22, 5), (22, 4), (22, 5))):
            for x in range(x0, x0 + w):
                g[5 + k * 2][x] = 'stone.3'
        g[11][24] = 'wood.1'; g[10][24] = 'wood.1'; g[11][23] = 'wood.1'; g[11][25] = 'wood.1'
        # Висла
        vis = [(50.06, 19.94), (50.68, 21.75), (51.4, 21.9), (52.25, 21.0), (52.55, 19.7), (53.01, 18.6), (54.0, 18.9), (54.35, 18.95)]
        pts = [pr(lo, la) for la, lo in vis]
        for a, b in zip(pts, pts[1:]):
            n = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) * 2))
            for k in range(n + 1):
                x = a[0] + (b[0] - a[0]) * k / n
                y = a[1] + (b[1] - a[1]) * k / n
                xi, yi = int(x), int(y)
                if 0 <= xi < cw and 0 <= yi < ch and mask[yi][xi]:
                    g[yi][xi] = 'water.2'
        # красные точки-флажки
        if isinstance(state, int) or gold:
            n = 10 if gold else state
            for la, lo in WALL_CITIES[:n]:
                x, y = pr(lo, la)
                xi, yi = int(x), int(y)
                if 0 <= xi < cw and 0 <= yi < ch:
                    g[yi][xi] = 'tomato.2'
                    if yi > 0 and not gold:
                        pass
            # блик на точках
            for la, lo in WALL_CITIES[:n]:
                x, y = pr(lo, la)
                xi, yi = int(x), int(y)
                if 0 < yi and mask[yi][xi]:
                    g[yi - 1][xi] = g[yi - 1][xi] if g[yi - 1][xi] in ('water.2',) else 'tomato.4' if (xi + yi) % 2 else g[yi - 1][xi]
        # гвоздики
        out.append(g)
    return out


# ───────────────────────────── отрывной календарь ─────────────────────────────

def calendar_frames() -> list:
    out = []
    for kind in ('bare', 'sheets', 1, 2, 3):
        g = blank(16, 24)
        # картонная подложка
        for y in range(3, 24):
            for x in range(16):
                edge = min(x, y - 3, 15 - x, 23 - y)
                g[y][x] = 'outline' if edge == 0 else ('plank.3' if edge == 1 else 'plank.2')
        # красная планка и дырки пружины
        for y in range(0, 6):
            for x in range(16):
                edge = min(x, y, 15 - x)
                g[y][x] = 'outline' if edge == 0 or y == 0 else ('roof.3' if y == 1 else ('roof.1' if y == 5 else 'roof.2'))
        g[5][5] = 'outline'; g[5][10] = 'outline'
        g[2][5] = 'white'; g[2][10] = 'white'
        g[2][7] = 'gold.3'; g[2][8] = 'gold.3'
        if kind == 'bare':
            for y in range(7, 21):
                for x in range(2, 14):
                    g[y][x] = 'plank.3' if x in (4, 9) else 'plank.2'
            for x in range(2, 14):
                g[20][x] = 'plank.1'
            # клочки оторванных листов у планки
            for x in range(2, 14):
                g[6][x] = 'paper.2' if x % 3 else 'paper.1'
            for x in (3, 7, 11):
                g[7][x] = 'paper.1'
            out.append(g)
            continue
        # стопка листов (края снизу-справа)
        for y in range(6, 22):
            for x in range(1, 15):
                g[y][x] = 'paper.2'
        for x in range(1, 15):
            g[21][x] = 'paper.1'; g[22][x] = 'outline'
        for y in range(6, 22):
            g[y][14] = 'paper.1'; g[y][15] = 'outline'
        for y in range(6, 21):
            g[y][1] = 'paper.3'
        for x in range(1, 14):
            g[6][x] = 'paper.3'
        g[20][13] = 'paper.4'
        # крупное число на листе: DOM, здесь только место (светлая рамка)
        for x in range(4, 12):
            g[7][x] = 'stone.3'; g[8][x] = 'stone.3'
        # сетка дней 3×3 (один пиксель-день в клетке), обведённые — красное кольцо
        cells = [(3 + 4 * i, 11 + 4 * j) for j in range(3) for i in range(3)]
        for (x, y) in cells:
            g[y][x] = 'stone.2'
        if isinstance(kind, int):
            n = (3, 6, 9)[kind - 1]
            for (x, y) in cells[:n]:
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        if (dx, dy) != (0, 0):
                            g[y + dy][x + dx] = 'tomato.2' if (dx, dy) != (-1, -1) else 'tomato.3'
            if kind == 3:
                g[7][7] = 'gold.3'; g[7][8] = 'gold.3'; g[8][7] = 'gold.2'; g[8][8] = 'gold.2'
        out.append(g)
    return out


# ───────────────────────────── мачта и флаг ─────────────────────────────

FLAG_W, FLAG_H = 11, 6


def flag_cells(phase: int):
    """Клетки флага относительно левого верха (attach x=4): [(x, y, имя цвета)]; волна по фазе 0..2."""
    cells = []
    for i in range(FLAG_W):
        amp = i / (FLAG_W - 1)
        off = round(math.sin(phase * 2.0944 + i * 0.75) * 1.4 * amp)
        for j in range(FLAG_H):
            top = j < FLAG_H // 2
            base = 'petal_white' if top else 'tomato'
            slope = round(math.sin(phase * 2.0944 + (i + 1) * 0.75) * 1.4 * (i + 1) / (FLAG_W - 1)) - off
            tone = 1 if slope > 0 else (3 if slope < 0 or i == 0 else 2)
            if i == 0:
                tone = 3 if top else 2
            cells.append((4 + i, j + off, f'{base}.{tone}'))
    return cells


def mast_parts() -> dict:
    return {
        'pole': P('pillow', r=1, g='pole'), 'ball': P('gold', r=2, g='ball'), 'plinth': P('stone', r=2, g='plinth'),
        'plinth2': P('stone', r=1, g='plinth2'), 'rope': P('stone', flat=1, g='rope'),
    }


def pole_cv() -> Cv:
    c = Cv(16, 48, mast_parts())
    c.rect(2, 4, 2, 41, 'pole')
    c.ell(3, 2.4, 2.2, 2.2, 'ball')
    c.rect(0, 43, 8, 5, 'plinth'); c.rect(1, 41, 6, 2.4, 'plinth2')
    return c


def mast_frame(y_top: int | None, phase: int):
    """y_top — верх флага в клетках спрайта 16×48 (None = флаг сложен у основания)."""
    c = pole_cv()
    if y_top is None:
        # сложенный флаг: свёрток у основания, виден белый и красный край
        for x in range(4, 8):
            for y in range(38, 41):
                c.dot(x, y, 'petal_white.2' if y == 38 else ('tomato.2' if y == 39 else 'tomato.1'))
        c.dot(4, 38, 'petal_white.3'); c.dot(7, 40, 'tomato.1'); c.dots([8, 39, 8, 38], 'tomato.1')
    else:
        for x, y, n in flag_cells(phase):
            c.dot(x, y_top + y, n)
    return c.render()


def mast_sheets() -> None:
    tops = [None, 28, 16, 4]
    frames = []
    anims = {}
    for hi, yt in enumerate(tops):
        ids = []
        for ph in range(3):
            frames.append(mast_frame(yt, ph))
            ids.append(len(frames) - 1)
        anims[f'h{hi}'] = ids if yt is not None else [ids[0]]
    sheet('w2_mast', 16, 48, frames, anchor=[3, 47], anims=anims)
    # столб без флага и отдельный флаг для 9 ступеней (верх флага y = 36 − 4·ступень, ступень 0..8)
    sheet('w2_pole', 16, 48, [pole_cv().render()], anchor=[3, 47])
    ff = []
    for ph in range(3):
        c = Cv(16, 16, mast_parts())
        for x, y, n in flag_cells(ph):
            c.dot(x, y + 2, n)
        ff.append(c.render())
    sheet('w2_flag', 16, 16, ff, anchor=[4, 2], anims={'wave': [0, 1, 2, 1]})
    fold = Cv(16, 16, mast_parts())
    for x in range(4, 8):
        for y in range(6, 9):
            fold.dot(x, y, 'petal_white.2' if y == 6 else ('tomato.2' if y == 7 else 'tomato.1'))
    sheet('w2_flag_folded', 16, 16, [fold.render()], anchor=[4, 8])


# ───────────────────────────── сезонная доска ─────────────────────────────

def pic_znicz(g, ox: int, oy: int) -> None:
    # znicz + chryzantema
    for y in range(3, 8):
        for x in range(2, 5):
            g[oy + y][ox + x] = 'tomato.2' if x < 4 else 'tomato.1'
    g[oy + 3][ox + 2] = 'tomato.4'
    for x in range(2, 5):
        g[oy + 2][ox + x] = 'wood_dark.2'
    g[oy][ox + 3] = 'petal_yellow.4'; g[oy + 1][ox + 2] = 'gold.3'; g[oy + 1][ox + 3] = 'cat.3'
    # хризантема
    cx, cy = 10, 5
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        g[oy + cy + dy][ox + cx + dx] = 'cat.2' if (dx + dy) % 2 else 'cat.3'
    g[oy + cy][ox + cx] = 'gold.3'
    g[oy + cy + 3][ox + cx] = 'leaf.2'; g[oy + cy + 4][ox + cx] = 'leaf.1'


def pic_spring(g, ox, oy) -> None:
    for dx, dy in ((2, 4), (3, 4), (1, 5), (2, 5), (3, 5), (4, 5), (1, 6), (2, 6), (3, 6), (4, 6), (2, 7), (3, 7)):
        g[oy + dy][ox + dx] = ('tomato.2', 'petal_yellow.3', 'tomato.2', 'tomato.1', 'petal_white.2', 'tomato.2', 'blanket.2', 'blanket.1', 'petal_yellow.3', 'blanket.2', 'tomato.1', 'tomato.1')[(dx * 3 + dy) % 12]
    g[oy + 3][ox + 3] = 'leaf.3'
    # нарцисс
    for dx, dy in ((9, 3), (10, 3), (8, 4), (9, 4), (10, 4), (11, 4), (9, 5), (10, 5)):
        g[oy + dy][ox + dx] = 'petal_yellow.3' if dy == 3 else 'petal_yellow.2'
    g[oy + 4][ox + 9] = 'cat.3'; g[oy + 4][ox + 10] = 'cat.2'
    for y in range(6, 9):
        g[oy + y][ox + 9] = 'leaf.2'


def pic_summer(g, ox, oy) -> None:
    # венок (wianek) и солнце
    for k in range(14):
        a = k * math.pi * 2 / 14
        x, y = 6 + round(math.cos(a) * 3.4), 5 + round(math.sin(a) * 2.6)
        g[oy + y][ox + x] = ('leaf.2', 'petal_pink.3', 'leaf2.2', 'petal_yellow.3', 'leaf.2', 'tomato.2', 'leaf2.3')[k % 7]
    for dx, dy in ((12, 1), (13, 1), (12, 2), (13, 2)):
        g[oy + dy][ox + dx] = 'gold.3'
    g[oy][ox + 12] = 'gold.2'; g[oy + 3][ox + 13] = 'gold.2'; g[oy + 1][ox + 11] = 'gold.2'; g[oy + 1][ox + 14] = 'gold.2'


def pic_winter(g, ox, oy) -> None:
    for y, w in ((1, 1), (2, 2), (3, 3), (4, 3), (5, 4), (6, 5), (7, 5)):
        for x in range(8 - w // 2 - (w % 2 == 0), 8 + w // 2 + 1):
            g[oy + y][ox + x] = 'leaf.2' if x < 8 else 'leaf.1'
    g[oy + 8][ox + 8] = 'wood_dark.2'
    g[oy][ox + 8] = 'gold.3'
    for dx, dy, n in ((7, 3, 'tomato.3'), (9, 5, 'gold.3'), (6, 6, 'blanket.3'), (10, 6, 'tomato.3'), (8, 4, 'petal_white.3')):
        g[oy + dy][ox + dx] = n
    for dx, dy in ((2, 2), (13, 3), (3, 6), (13, 7), (1, 4)):
        g[oy + dy][ox + dx] = 'white'


def season_board_frames() -> list:
    out = []
    for pic in (pic_spring, pic_summer, pic_znicz, pic_winter):
        c = Cv(32, 32, {
            'post': P('wood_dark', r=1, g='post'), 'roof': P('roof', r=3, g='roof'), 'eave': P('roof_dark', r=1, g='eave'),
            'board': P('plank', r=3, g='board'), 'rim': P('wood', r=1, g='rim'), 'pic': P('paper', flat=2, g='pic'),
            'leg': P('wood_dark', r=1, g='leg'),
        })
        c.rect(3, 12, 2, 20, 'post'); c.rect(27, 12, 2, 20, 'post')
        c.poly([[1, 9], [5, 1], [27, 1], [31, 9]], 'roof')
        c.rect(0, 8, 32, 2.4, 'eave')
        for x in range(6, 27, 4):
            c.dots([x, 3, x + 1, 5, x - 2, 6], 'roof.1')
        c.rect(5, 11, 22, 17, 'board'); c.rect(6, 12, 20, 15, 'rim'); c.rect(7, 13, 18, 13, 'pic')
        c.rect(14, 28, 4, 4, 'leg')
        g = c.render()
        # рисунок
        pic(g, 8, 14)
        # подпись-плашка (DOM поверх)
        for x in range(9, 24):
            g[24][x] = 'paper.1'
        for x in range(10, 23, 2):
            g[25][x] = 'stone.3'
        out.append(g)
    return out


# ───────────────────────────── огород месяцев, корзина, колышек ─────────────────────────────

def garden_bed_frames() -> list:
    out = []
    for wet in (False, True):
        c = Cv(32, 16, {'rim': P('wood', r=1, g='rim'), 'soil': P('soil_wet' if wet else 'soil', flat=2, g='soil')})
        c.rect(0, 1, 32, 15, 'rim'); c.rect(2, 3, 28, 11, 'soil')
        g = c.render()
        for y in (5, 9, 12):
            for x in range(3, 29):
                if (x + y) % 7:
                    g[y][x] = 'soil_wet.1' if wet else 'soil.1'
                g[y - 1][x] = 'soil_wet.3' if wet else 'soil.3' if (x + y) % 3 == 0 else g[y - 1][x]
        if wet:
            for x, y in ((6, 6), (13, 10), (22, 7), (26, 11)):
                g[y][x] = 'water.3'
        out.append(g)
    return out


def stake_frames() -> list:
    out = []
    for gold in (False, True):
        c = Cv(16, 16, {'st': P('wood', r=1, g='st'), 'sign': P('gold' if gold else 'paper', r=1, g='sign')})
        c.rect(7, 8, 2, 8, 'st')
        c.rect(2, 2, 12, 7, 'sign')
        g = c.render()
        for x in range(4, 12):
            g[5][x] = 'trunk.2' if not gold else 'gold.1'
        for x in range(5, 11, 2):
            g[6][x] = 'trunk.1' if not gold else 'gold.1'
        if gold:
            g[4][8] = 'petal_yellow.4'; g[3][8] = 'petal_yellow.4'
        out.append(g)
    return out


def basket_frames() -> list:
    out = []
    for full in (False, True):
        c = Cv(16, 16, {'b': P('sack', r=2, g='b'), 'rim': P('wood', r=1, g='rim'), 'inner': P('wood_dark', r=1, g='inner')})
        c.rect(2, 8, 12, 6, 'b'); c.clear(lambda x, y: (x < 3 or x > 13) and y > 12)
        c.rect(1, 6, 14, 2, 'rim')
        g = c.render()
        for y in (10, 12):
            for x in range(3, 13):
                g[y][x] = 'sack.1' if (x + y) % 2 else g[y][x]
        for y in (9, 11, 13):
            for x in range(3, 13):
                g[y][x] = 'sack.3' if (x + y) % 4 == 0 else g[y][x]
        if full:
            c2 = Cv(16, 16, {'x': P('leaf', r=1, g='x')})
            c2.dots([], 'tomato.2')
            for x, y in ((3, 3), (7, 2), (11, 3), (5, 4), (9, 4)):
                for dx, dy, n in ((0, 0, 'tomato.4'), (1, 0, 'tomato.2'), (0, 1, 'tomato.2'), (1, 1, 'tomato.2'), (2, 1, 'tomato.1'), (1, 2, 'tomato.1'), (2, 2, 'tomato.1')):
                    g[y + dy][x + dx] = n
            for x in range(2, 14):
                for y in range(4, 6):
                    if g[y][x] is None:
                        g[y][x] = 'tomato.2' if (x + y) % 2 else 'tomato.1'
            outline_of(g)
        out.append(g)
    return out


def apple_item():
    g = blank(16, 16)
    rows = [
        '.....c.....',
        '....cc.l...',
        '..ooLoolo..',
        '.oLHRRRRSo.',
        '.oHRRRRRSo.',
        '.oRRRRRRSo.',
        '.oRRRRRSSo.',
        '..oRRRSSo..',
        '...ooooo...',
    ]
    leg = {'o': 'tomato.0', 'H': 'tomato.4', 'L': 'tomato.3', 'R': 'tomato.2', 'S': 'tomato.1', 'c': 'trunk.2', 'l': 'leaf.3'}
    return asc(rows, leg, 16, 16, 2, 4)


# ───────────────────────────── карта Geografia: герой, кот, флажок, точки, компас ─────────────────────────────

HERO_LEG = {'o': 'outline', 'H': 'hair.2', 'h': 'hair.3', 'S': 'skin.2', 's': 'skin.3', 'e': 'ink', 'B': 'blazer.2', 'b': 'blazer.3',
            'w': 'shirt.2', 'T': 'trouser.2', 'U': 'trouser.1', 'F': 'boot.2', 'K': 'blazer.1'}

# герой 8×12 (с контуром); 16×16-ячейка, рисунок в x 4..11, y 4..15
HERO_DOWN = [
    '..oooo..',
    '.oHhhHo.',
    'oHHHHHHo',
    'oHeSSeHo',
    '.oSSSSo.',
    '.oBwwBo.',
    'oSBbBBSo',
    '.oBBBKo.',
    '.oTTTUo.',
    '.oT..To.',
    '.oF..Fo.',
    '..o..o..',
]
HERO_UP = [
    '..oooo..',
    '.oHhhHo.',
    'oHHHHHHo',
    'oHHHHHHo',
    '.oHHHHo.',
    '.oBBBBo.',
    'oSBbBBSo',
    '.oBBBKo.',
    '.oTTTUo.',
    '.oT..To.',
    '.oF..Fo.',
    '..o..o..',
]
HERO_SIDE = [  # смотрит вправо
    '..oooo..',
    '.oHhhHo.',
    'oHHHHHHo',
    'oHHHSeSo',
    '.oHSSSo.',
    '.oBwBBo.',
    '.oBBbSo.',
    '.oBBBKo.',
    '.oTTTUo.',
    '.oTTUTo.',
    '..oFFFo.',
    '...ooo..',
]


def hero_frame(rows: list[str], dy: int = 0, legs: str = 'idle'):
    r = list(rows)
    if legs == 'a':
        if rows is HERO_SIDE:
            r[9] = '.oTUTTo.'; r[10] = '.oFo.Fo.'; r[11] = '..o..o..'
        else:
            r[9] = '.oT...o.'; r[10] = '.oF.oTo.'; r[11] = '..o.oFo.'
    elif legs == 'b':
        if rows is HERO_SIDE:
            r[9] = '..oTTUo.'; r[10] = '.oFoFo..'; r[11] = '..o.o...'
        else:
            r[9] = '.o...To.'; r[10] = '.oTo.Fo.'; r[11] = '.oFo.o..'
    g = asc(r, HERO_LEG, 16, 16, 4, 4)
    if dy:
        g = g[dy:] + [[None] * 16 for _ in range(dy)]
    return g


def hero_kick(extend: bool):
    rows = [
        '..oooo..',
        '.oHhhHo.',
        'oHHHHHHo',
        'oHHHSeSo',
        '.oHSSSo.',
        '.oBwBBo.',
        '.oBBbSo.',
        '.oBBBKo.',
        '.oTTTTo.' if extend else '.oTTTUo.',
        '.oTT.Uo.' if not extend else '.oTUoTUo',
        '.oFo.oFo' if not extend else '.oFo.oFFo',
        '..o...o.' if not extend else '..o...ooo',
    ]
    rows = [r[:8] if len(r) > 8 and not extend else r for r in rows]
    w = max(len(r) for r in rows)
    rows = [r.ljust(w, '.') for r in rows]
    return asc(rows, HERO_LEG, 16, 16, 4, 4)


def hero_sheet() -> None:
    frames = []
    for rows in (HERO_DOWN, HERO_UP, HERO_SIDE):
        frames += [hero_frame(rows), hero_frame(rows, legs='a'), hero_frame(rows, legs='b')]
    # 9-11: боком влево
    frames += [{'flip': 6}, {'flip': 7}, {'flip': 8}]
    k0, k1 = hero_kick(False), hero_kick(True)
    base = len(frames)
    sh = Sheet('geo_hero', 16, 16, anchor=[8, 15], anims={
        'walk_down': [1, 0, 2, 0], 'walk_up': [4, 3, 5, 3], 'walk_right': [7, 6, 8, 6], 'walk_left': [10, 9, 11, 9],
        'kick_right': [12, 13, 12], 'kick_left': [14, 15, 14],
    })
    for f in frames:
        sh.frames.append(f)
    i0 = sh.add(k0)
    i1 = sh.add(k1)
    sh.flip_of(i0)
    sh.flip_of(i1)
    emit(sh)


CAT_LEG = {'o': 'outline', 'C': 'cat.2', 'c': 'cat.3', 'S': 'cat_stripe.2', 'W': 'cat_cream.2', 'e': 'ink'}


def geo_cat_sheet() -> None:
    walk_a = [
        '...o.o',
        'o.oCCo',
        'oCCCeo',
        'oCCCWo',
        '.oCoCo',
        '..o.o.',
    ]
    walk_b = [
        '...o.o',
        'o.oCCo',
        'oCCCeo',
        'oCCCWo',
        '.oCCCo',
        '..oo.o',
    ]
    sit = [
        '.o..o.',
        'oCooCo',
        'oeCCeo',
        'oCWWCo',
        'oCWWCo',
        '.oooo.',
    ]
    sleep = [
        '......',
        '.oooo.',
        'oCCCCo',
        'oSCCeo',
        '.oooo.',
        '......',
    ]
    frames = [asc(f, CAT_LEG, 16, 16, 5, 9) for f in (walk_a, walk_b, sit, sleep)]
    sheet('geo_cat', 16, 16, frames, anchor=[8, 15], anims={'walk': [0, 1], 'sit': [2]})


FLAG_LEG = {'o': 'outline', 'p': 'wood.2', 'P': 'wood.1', 'r': 'tomato.2', 'R': 'tomato.1', 'q': 'tomato.3',
            'g': 'leaf2.2', 'G': 'leaf2.1', 'h': 'leaf2.3', 'k': 'gold.2', 'K': 'gold.1', 'j': 'gold.3'}


def flag_pole(g, x_base: int, y_base: int, lean: int, rows_up: int, pen: str, sway: int = 0):
    """Флажок: древко вверх от (x_base, y_base) с наклоном lean (px на всю высоту), вымпел справа сверху."""
    cols = {'red': ('r', 'R', 'q'), 'green': ('g', 'G', 'h'), 'gold': ('k', 'K', 'j')}[pen]
    for k in range(rows_up):
        x = x_base + round(lean * k / max(1, rows_up - 1))
        g[y_base - k][x] = 'p' if k % 2 == 0 else 'P'
    top_x = x_base + lean
    ty = y_base - rows_up + 1
    for j in range(4):
        w = 5 - j
        for i in range(w):
            xx = top_x + 1 + i + (sway if j > 1 else 0)
            yy = ty + j
            g[yy][xx] = cols[2] if (i == 0 and j == 0) else (cols[0] if j < 3 else cols[1])
    return g


def geo_flag_sheet() -> None:
    def fr(pen, lean, sway, base_y=15, up=11, dx=0):
        g = blank(16, 16)
        flag_pole(g, 5 + dx, base_y, lean, up, pen, sway)
        g2 = []
        for row in g:
            g2.append([FLAG_LEG.get(c) if c else None for c in row])
        # переводим ключи в имена палитры
        return outline_of(g2)

    frames = []
    for pen in ('red', 'green'):
        frames += [fr(pen, 0, 0), fr(pen, 1, 1), fr(pen, -1, -1)]  # 0-2 красный, 3-5 зелёный
    # 6: упавший: лежит под углом
    g = blank(16, 16)
    for k in range(10):
        g[14 - k // 3][2 + k] = 'wood.2' if k % 2 == 0 else 'wood.1'
    for j in range(3):
        for i in range(4 - j):
            g[11 - j - 1][9 + i + 1 - 1] = 'tomato.2' if j < 2 else 'tomato.1'
    g = [[(FLAG_LEG.get(c, c) if c and len(c) == 1 else c) for c in row] for row in g]
    frames.append(outline_of(g))
    # 7-9: втыкание: падает сверху, острие ниже и ниже
    frames.append(fr('red', 2, 1, base_y=11, up=11, dx=-1))
    frames.append(fr('red', 2, 0, base_y=13, up=11, dx=-1))
    frames.append(fr('red', 1, -1, base_y=15, up=11, dx=0))
    sheet('geo_flag', 16, 16, frames, anchor=[5, 15], anims={
        'wobble_red': [0, 1, 0, 2], 'wobble_green': [3, 4, 3, 5], 'plant': [7, 8, 9, 1, 2, 1, 0], 'fall': [0, 6],
    })


DOT_LEG = {'o': 'outline', 'H': '{m}.3', 'G': '{m}.2', 'S': '{m}.1', 'Y': '{m}.4'}


def geo_dot_sheet() -> None:
    dot = ['.oooo.', 'oYHGGo', 'oHGGGo', 'oGGGSo', 'oGGSSo', '.oooo.']
    star = ['..oo..', 'ooYGoo', 'oHGGSo', '.oGGSo', '.oGSSo', '.oo.oo']
    mats = ['stone', 'leaf2', 'gold']
    frames = []
    for shape in (dot, star):
        for m in mats:
            leg = {k: v.format(m=m) for k, v in DOT_LEG.items()}
            frames.append(asc(shape, leg, 16, 16, 5, 5))
    # 6-7 кольцо-вспышка правильного места (малое/большое, золотое)
    for rad in (6, 7):
        g = blank(16, 16)
        for y in range(16):
            for x in range(16):
                d = math.hypot(x - 7.5, y - 7.5)
                if rad - 0.9 <= d <= rad + 0.5:
                    g[y][x] = 'gold.3' if (x + y) % 2 == 0 else 'petal_yellow.4'
        frames.append(g)
    sheet('geo_dot', 16, 16, frames, anchor=[8, 8], anims={'ping': [6, 7]})


def compass_frame():
    c = Cv(32, 32, {
        'ring': P('wood', r=3, g='ring'), 'face': P('paper', r=5, g='face'),
        'n': P('tomato', flat=2, g='n'), 's': P('shade', flat=2, g='s'), 'ew': P('blazer', flat=2, g='ew'),
    })
    c.ell(16, 16, 14.5, 14.5, 'ring')
    c.ell(16, 16, 12, 12, 'face')
    c.poly([[16, 3], [19.6, 16], [12.4, 16]], 'n')
    c.poly([[16, 29], [19.6, 16], [12.4, 16]], 's')
    c.poly([[3.5, 16], [16, 12.6], [16, 19.4]], 'ew')
    c.poly([[28.5, 16], [16, 12.6], [16, 19.4]], 'ew')
    g = c.render()
    g[16][16] = 'gold.3'; g[15][15] = 'gold.2'; g[15][16] = 'gold.2'; g[16][15] = 'gold.2'
    return g


# ───────────────────────────── тайлы Zagroda ─────────────────────────────

def grass2(seed: int):
    rng = random.Random(100 + seed)
    g = tgrid('grass.2')
    for _ in range(14):
        g[rng.randrange(T)][rng.randrange(T)] = 'grass.3'
    for _ in range(8):
        g[rng.randrange(T)][rng.randrange(T)] = 'grass.1'
    for _ in range(3):
        x, y = rng.randrange(1, T - 1), rng.randrange(3, T)
        g[y][x] = 'grass.1'; g[y - 1][x] = 'grass.1'; g[y - 2][x] = 'grass.3'
    # клевер и цветочки сада
    for k in range(2 + seed % 2):
        x, y = rng.randrange(1, T - 1), rng.randrange(1, T - 1)
        n = ('petal_white.3', 'petal_yellow.3', 'petal_pink.3', 'petal_white.4')[(seed + k) % 4]
        g[y][x] = n
        g[y + 1][x] = 'leaf.2' if rng.random() < 0.7 else g[y + 1][x]
    return g


def path2(seed: int, mask: int):
    """Дорожка из каменных плит: плиты 2 ряда, швы, свет сверху-слева; края открытых сторон — трава."""
    g = patch('stone', seed, mask, False)
    rng = random.Random(seed * 7 + 1)
    for y in range(T):
        for x in range(T):
            d = edge_dist(mask, x, y)
            if d <= 1 or corner_cut(mask, x, y):
                continue
            row = y // 8
            if y % 8 == 0:
                g[y][x] = 'stone.1'
            elif y % 8 == 1:
                g[y][x] = 'stone.3'
            elif (x + (4 if row else 0)) % 8 == 0:
                g[y][x] = 'stone.1'
            elif (x + (4 if row else 0)) % 8 == 1:
                g[y][x] = 'stone.3'
            else:
                g[y][x] = 'stone.2'
    # мелкие сколы
    for _ in range(4):
        x, y = rng.randrange(T), rng.randrange(T)
        if edge_dist(mask, x, y) > 1 and g[y][x] == 'stone.2':
            g[y][x] = 'stone.3' if rng.random() < 0.5 else 'stone.1'
    return g


def fence2(mask: int):
    """Беленый штакетник: широкие пикеты с острыми концами (шаг 8 px), две перекладины; в узлах и на концах столб с шапкой."""
    parts = {'pk': P('chalk', r=2, g='pk'), 'post': P('chalk', r=2, g='post'), 'rail': P('wood', r=1, g='rail')}
    c = Cv(T, T, parts)
    ew = mask & (E | W)
    ns = mask & (N | S)
    if ew:
        x0 = 0 if mask & W else 7
        x1 = 16 if mask & E else 9
        c.rect(x0, 6, x1 - x0, 1.6, 'rail'); c.rect(x0, 10, x1 - x0, 1.6, 'rail')
        for px_ in (1, 9):
            if x0 <= px_ + 1 and px_ + 2 <= x1 and not (6 <= px_ + 1 <= 9 and (mask not in (E | W,))):
                c.rect(px_, 4, 3, 10, 'pk')
                c.poly([[px_, 4], [px_ + 1.5, 2.4], [px_ + 3, 4]], 'pk')
    if ns:
        y0 = 0 if mask & N else 3
        y1 = 16 if mask & S else 14
        c.rect(6, y0, 4, y1 - y0, 'post')
        for y in range(y0 + 2, y1, 4):
            c.rect(4, y, 8, 1, 'rail')
    if mask not in (E | W,):  # узел, конец или одиночный: столб с шапкой
        c.rect(6, 3, 4, 11.4, 'post'); c.poly([[5.4, 3.2], [8, 0.8], [10.6, 3.2]], 'post')
    return c.render()


def gate_frames() -> list:
    """0 горизонтальная (проход с севера на юг) закрытая, 1 открытая, 2 вертикальная (проход запад-восток) закрытая, 3 открытая."""
    out = []
    for vertical in (False, True):
        for opened in (False, True):
            parts = {'post': P('chalk', r=2, g='post'), 'leaf': P('plank', r=1, g='leaf'), 'brace': P('wood', r=1, g='brace'),
                     'leaf2': P('plank', r=1, g='leaf2')}
            c = Cv(T, T, parts)
            if not vertical:
                c.rect(0, 3, 4, 12, 'post'); c.rect(12, 3, 4, 12, 'post')
                c.poly([[0, 3], [2, 1], [4, 3]], 'post'); c.poly([[12, 3], [14, 1], [16, 3]], 'post')
                if not opened:
                    c.rect(4, 6, 4, 6.4, 'leaf'); c.rect(8, 6, 4, 6.4, 'leaf2')
                    c.rect(4, 8, 8, 1.2, 'brace'); c.rect(4, 11, 8, 1.2, 'brace')
                else:
                    c.rect(4, 2, 1.6, 8, 'leaf'); c.rect(10.4, 2, 1.6, 8, 'leaf2')
            else:
                c.rect(1, 0, 12, 4, 'post'); c.rect(1, 12, 12, 4, 'post')
                if not opened:
                    c.rect(4, 4, 6.4, 4, 'leaf'); c.rect(4, 8, 6.4, 4, 'leaf2')
                    c.rect(6, 4, 1.2, 8, 'brace'); c.rect(9, 4, 1.2, 8, 'brace')
                else:
                    c.rect(4, 4, 8, 1.6, 'leaf'); c.rect(4, 10.4, 8, 1.6, 'leaf2')
            out.append(c.render())
    return out


# ───────────────────────────── сборка ─────────────────────────────

KEYS = {
    'w2_wallmap 32×16': 'кадры 0 рулон · 1 пустая карта · 2 ≤3 точек · 3 4–6 · 4 7–10 · 5 золотая рама (все 10, полная карта)',
    'w2_calendar 16×24': 'кадры 0 без листов · 1 лист, пустая сетка · 2 три обведённых · 3 шесть · 4 девять + золотая звёздочка',
    'w2_mast 16×48': 'кадры h*3+фаза: h0 флаг сложен (1 кадр: 0) · h1 низко (3–5, верх флага y=28) · h2 середина (6–8, y=16) · h3 вершина (9–11, y=4); anims h0…h3',
    'w2_pole 16×48 + w2_flag 16×16': '9 ступеней: столб без флага + отдельный флаг (3 кадра волны, anims.wave); верх флага y = 36 − 4·ступень (0..8) от верха столба; w2_flag_folded сложенный',
    'w2_season_board 32×32': 'кадры 0 весна (pisanka, нарцисс) · 1 лето (wianek) · 2 осень (znicz + chryzantema) · 3 зима (choinka)',
    'w2_apple_tree 32×48': 'кадры 0 саженец · 1 деревце · 2 цветёт · 3 яблоки · 4 урожай (много яблок, упавшие, блики); w2_apple 16×16 иконка; w2_basket 16×16 (0 пустая, 1 с яблоками)',
    'w2_hive 16×32': 'кадры 0 пустой · 1–2 заселён (anims.young) · 3–4 полный с мёдом (anims.full); w2_honey 16×16 банка; w2_bee 16×16 2 кадра (anims.fly)',
    'w2_sunflower 16×32': 'кадры 0 семечко · 1 росток · 2 бутон · 3 цветок · 4 семена (урожай)',
    'w2_fl_<snow|daff|poppy|chrys|viol> 16×16': 'кадры 0 росток · 1 бутон · 2 цветёт; сезон: зима snow (белый), весна daff (жёлтый), лето poppy (красный), осень chrys (рыжий), viol (фиолетовый, любой)',
    'w2_znicz 16×16': 'кадры 0–1 красный (мерцает) · 2–3 белый; w2_choinka 16×32 кадры 0–1 (мигают огни); w2_bunting 32×16 кадры 0–1 (плитка по горизонтали); w2_pisanki 16×16; w2_palma 16×32',
    'w2_bed 32×16 / w2_stake 16×16': 'грядка 2×1: 0 сухая · 1 политая; колышек с табличкой: 0 обычный · 1 золотой (месяц собран)',
    'geo_hero 16×16 (рисунок 8×12, x4..11, y4..15)': '0–2 вниз · 3–5 вверх · 6–8 вправо · 9–11 влево · 12–13 пинок вправо · 14–15 пинок влево; anims walk_*/kick_*',
    'geo_cat 16×16 (рисунок 6×6)': 'кадры 0–1 шаг (вправо; влево зеркалом) · 2 сидит · 3 спит',
    'geo_flag 16×16': 'кадры 0–2 красный качается · 3–5 зелёный · 6 упавший · 7–9 втыкание; anims wobble_red/wobble_green/plant/fall',
    'geo_dot 16×16 (точка 6×6)': 'кадры 0–2 точка серая/зелёная/золотая · 3–5 звезда столицы серая/зелёная/золотая · 6–7 кольцо-вспышка (anims.ping)',
    'geo_compass 32×32': 'один кадр, без букв (N/S/E/W подписывает DOM)',
    'тайлы farm.json': 'grass2 (4 варианта), path2 (auto16), fence2 (auto16), gate / gate_open (горизонтальный забор), gate_v / gate_v_open (вертикальный)',
}


def build() -> None:
    sheet('w2_wallmap', 32, 16, wall_map_frames(), anchor=[16, 15])
    sheet('w2_calendar', 16, 32, [blank(16, 8) + g for g in calendar_frames()], anchor=[8, 31])
    mast_sheets()
    sheet('w2_season_board', 32, 32, season_board_frames(), anchor=[16, 31])
    sheet('w2_apple_tree', 32, 48, apple_tree_frames(), anchor=[16, 47])
    single('w2_apple', apple_item(), anchor=[8, 15])
    sheet('w2_basket', 16, 16, basket_frames(), anchor=[8, 15])
    hive_sheet()
    single('w2_honey', honey_jar(), anchor=[8, 15])
    bee_sheet()
    sheet('w2_sunflower', 16, 32, sunflower_frames(), anchor=[8, 31])
    for kind in FLOWER_KINDS:
        sheet(f'w2_fl_{kind}', 16, 16, flower_frames(kind), anchor=[8, 15])
    sheet('w2_znicz', 16, 16, znicz_frames(), anchor=[8, 15], anims={'red': [0, 1], 'white': [2, 3]})
    sheet('w2_choinka', 16, 32, choinka_frames(), anchor=[8, 31], anims={'lights': [0, 1]})
    sheet('w2_bunting', 32, 16, bunting_frames(), anchor=[0, 0], anims={'sway': [0, 1]})
    single('w2_pisanki', pisanki(), anchor=[8, 15])
    single('w2_palma', palma(), anchor=[8, 31])
    sheet('w2_bed', 32, 16, garden_bed_frames(), anchor=[16, 15])
    sheet('w2_stake', 16, 16, stake_frames(), anchor=[8, 15])
    hero_sheet()
    geo_cat_sheet()
    geo_flag_sheet()
    geo_dot_sheet()
    single('geo_compass', compass_frame(), anchor=[16, 16])
    # тайлы
    sh = Sheet('t2_grass', T, T, anchor=[8, 15])
    for i in range(4):
        sh.add(grass2(i))
    emit(sh)
    s = Sheet('t2_path', T, T, anchor=[8, 15])
    for mask in range(16):
        s.add(path2(61 + mask, mask))
    emit(s)
    f = Sheet('t2_fence', T, T, anchor=[8, 15])
    for mask in range(16):
        f.add(fence2(mask))
    emit(f)
    sheet('t2_gate', T, T, gate_frames(), anchor=[8, 15])


# ───────────────────────────── лист просмотра ─────────────────────────────

def preview_sheet(path: str, scale: int = 4) -> None:
    from PIL import Image, ImageDraw
    from sprites_build import load_palette
    pal = load_palette()
    groups = [
        ('Входы у дома', ['w2_wallmap', 'w2_calendar', 'w2_season_board', 'w2_mast', 'w2_pole', 'w2_flag', 'w2_flag_folded']),
        ('Сад, пасека, огород, клумба', ['w2_apple_tree', 'w2_apple', 'w2_basket', 'w2_hive', 'w2_honey', 'w2_bee', 'w2_sunflower', 'w2_bed', 'w2_stake']
         + [f'w2_fl_{k}' for k in FLOWER_KINDS]),
        ('Праздники', ['w2_znicz', 'w2_choinka', 'w2_bunting', 'w2_pisanki', 'w2_palma']),
        ('Карта Geografia', ['geo_hero', 'geo_cat', 'geo_flag', 'geo_dot', 'geo_compass']),
        ('Тайлы Zagroda', ['t2_grass', 't2_path', 't2_fence', 't2_gate']),
    ]
    bg = (186, 214, 140)
    W = 1500
    items = []
    y = 8
    layout = []
    for title, ids in groups:
        layout.append(('title', title, 8, y))
        y += 16
        x = 8
        row_h = 0
        for sid in ids:
            sh = art_core.SHEETS[sid]
            for gi, g in enumerate(sh.grids()):
                w, h = len(g[0]), len(g)
                sc = scale if w <= 32 else max(2, scale // 2)
                if x + w * sc + 4 > W:
                    x, y, row_h = 8, y + row_h + 8, 0
                layout.append(('spr', g, x, y, sc))
                x += w * sc + 4
                row_h = max(row_h, h * sc)
            x += 10
        y += row_h + 14
    map_path = ROOT / 'public' / 'maps-art' / 'poland.png'
    mh = 0
    mp = None
    if map_path.exists():
        mp = Image.open(map_path).convert('RGB')
        mh = mp.height * 2
    img = Image.new('RGB', (W, y + mh + 20), bg)
    d = ImageDraw.Draw(img)
    try:  # шрифт с кириллицей для подписей листа просмотра (не для игры)
        from PIL import ImageFont
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 12)
    except Exception:
        font = None
    for it in layout:
        if it[0] == 'title':
            d.text((it[2], it[3]), it[1], fill=(40, 30, 40), font=font)
            continue
        _, g, ox, oy, sc = it
        d.rectangle([ox - 1, oy - 1, ox + len(g[0]) * sc, oy + len(g) * sc], outline=(160, 190, 120))
        for yy, r in enumerate(g):
            for xx, c in enumerate(r):
                if not c:
                    continue
                rgb = pal.names[c]
                d.rectangle([ox + xx * sc, oy + yy * sc, ox + xx * sc + sc - 1, oy + yy * sc + sc - 1], fill=rgb)
    if mp:
        d.text((8, y), 'Карта Польши poland.png (×2), слой городов поверх', fill=(40, 30, 40), font=font)
        big = mp.resize((mp.width * 2, mp.height * 2), Image.NEAREST)
        img.paste(big, (8, y + 14))
        lay = Image.open(ROOT / 'public' / 'maps-art' / 'poland_cities.png').convert('RGBA').resize((mp.width * 2, mp.height * 2), Image.NEAREST)
        img.paste(lay, (8, y + 14), lay)
    img.save(path)


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', metavar='PNG')
    a = ap.parse_args()
    build()
    if a.sheet:
        preview_sheet(a.sheet)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
