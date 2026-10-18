"""Мебель, дом, колодец, коробка, доска, деревья, цветы: sprite-as-data, размеры кратны 16."""
from __future__ import annotations

import random

from art_core import Cv, P, single


def speckle(c: Cv, rng: random.Random, test, light: str, dark: str, n: int) -> None:
    """Точки света (сверху-слева) и тени (снизу-справа) по заливке: фактура листвы и дерева."""
    pts = [(x, y) for y in range(c.h) for x in range(c.w) if test(x, y) and c.m[y * c.w + x]]
    for _ in range(n):
        if not pts:
            return
        x, y = rng.choice(pts)
        c.dot(x, y, light if (x + y) % 3 else dark)
        if rng.random() < 0.5:
            c.dot(x + 1, y, light if (x + y) % 3 else dark)


def tree(sid: str, seed: int, mats=('leaf', 'leaf2')) -> None:
    rng = random.Random(seed)
    parts = {'trunk': P('trunk', r=2, g='trunk'), 'crown': P(mats[0], r=4, g='crown'), 'crown2': P(mats[1], r=3, g='crown')}
    c = Cv(32, 48, parts)
    c.rect(13, 30, 6, 16.5, 'trunk')
    c.ell(16, 46, 6.5, 1.8, 'trunk'); c.ell(10.5, 44.5, 2.2, 1.2, 'trunk'); c.ell(21.5, 44.5, 2.2, 1.2, 'trunk')
    c.ell(16, 18, 13.5, 13, 'crown')
    c.ell(8.5, 24, 7.5, 6.5, 'crown'); c.ell(23.5, 24, 7.5, 6.5, 'crown')
    c.ell(14, 10, 8.5, 7, 'crown2'); c.ell(21, 14, 6, 5, 'crown2')
    m = mats[0]
    speckle(c, rng, lambda x, y: y < 30 and x + y < 34, f'{m}.3', f'{m}.2', 22)
    speckle(c, rng, lambda x, y: y < 31 and x + y > 36, f'{m}.1', f'{m}.2', 24)
    single(sid, c.render(), anchor=[16, 47])


def bush(sid: str, seed: int, flowers: str | None = None) -> None:
    rng = random.Random(seed)
    c = Cv(16, 16, {'b': P('leaf', r=2, g='b'), 'b2': P('leaf2', r=2, g='b')})
    c.ell(8, 10, 6.4, 4.8, 'b'); c.ell(6, 8, 3.6, 3, 'b2'); c.ell(11, 9, 3.2, 3, 'b')
    speckle(c, rng, lambda x, y: True, 'leaf.3', 'leaf.1', 7)
    if flowers:
        for x, y in ((4, 8), (8, 6), (11, 9), (6, 11), (10, 12)):
            c.dot(x, y, f'{flowers}.3')
    single(sid, c.render(), anchor=[8, 15])


def flower(sid: str, mat: str, n: int) -> None:
    rng = random.Random(n)
    c = Cv(16, 16, {'stem': P('leaf', flat=2, noline=True)})
    pts = [(4, 11), (9, 8), (12, 12)][:n]
    for x, y in pts:
        c.dots([x, y + 1, x, y + 2, x, y + 3], 'leaf.1')
        c.dots([x - 1, y, x + 1, y, x, y - 1, x, y + 1], f'{mat}.2')
        c.dot(x, y, f'{mat}.4')
    single(sid, c.render(ring=False), anchor=[8, 15])


def rock(sid: str) -> None:
    c = Cv(16, 16, {'s': P('stone', r=2, g='s')})
    c.ell(8, 11, 6, 4.2, 's'); c.ell(6.5, 9.5, 3.4, 2.6, 's')
    single(sid, c.render(), anchor=[8, 15])


def house() -> None:
    rng = random.Random(7)
    parts = {
        'roof': P('roof', r=4, g='roof'), 'eave': P('roof_dark', r=1, g='eave'), 'wall': P('wood', r=4, g='wall'),
        'door': P('wood_dark', r=3, g='door'), 'frame': P('cream', r=1, g='frame'), 'glass': P('glass', r=1, g='glass'),
        'brick': P('stone', r=2, g='brick'), 'step': P('stone', r=1, g='step'), 'knob': P('gold', flat=3, noline=True),
        'pane': P('wood', r=1, g='pane'),
    }
    c = Cv(80, 64, parts)
    c.rect(56, 0, 8, 14, 'brick')
    c.poly([[1, 29], [13, 5], [67, 5], [79, 29]], 'roof')
    c.rect(0, 27, 80, 4, 'eave')
    c.rect(4, 31, 72, 33, 'wall')
    for y in range(8, 27, 4):
        for x in range(4 + (y // 4 % 2) * 3, 76, 6):
            if 3 + (27 - y) * 0.45 < x < 77 - (27 - y) * 0.45:
                c.dot(x, y, 'roof.1')
    for x in range(10, 76, 6):
        c.vline(x, 33, 63, 'wood.1')
    c.rect(33, 41, 14, 23, 'frame'); c.rect(35, 43, 10, 21, 'door')
    c.dot(43, 54, 'gold.3'); c.dot(43, 55, 'gold.2')
    c.hline(35, 45, 48, 'wood_dark.1'); c.hline(35, 45, 58, 'wood_dark.1')
    for wx in (11, 57):
        c.rect(wx, 39, 13, 13, 'frame'); c.rect(wx + 2, 41, 9, 9, 'glass')
        c.rect(wx + 6, 41, 1, 9, 'pane'); c.rect(wx + 2, 45, 9, 1, 'pane')
        c.rect(wx - 1, 52, 15, 2, 'pane')
    c.rect(30, 62, 20, 2, 'step')
    single('house', c.render(), anchor=[40, 63])


def well() -> None:
    parts = {'stone': P('stone', r=3, g='stone'), 'water': P('water', r=2, g='water'), 'post': P('wood', r=1, g='post'),
             'roof': P('roof', r=3, g='roof'), 'rope': P('sign', flat=2, noline=True), 'bucket': P('wood_dark', r=1, g='bucket')}
    c = Cv(32, 32, parts)
    c.rect(6, 4, 3, 17, 'post'); c.rect(23, 4, 3, 17, 'post')
    c.rect(7, 18, 18, 11, 'stone'); c.ell(16, 18.5, 10, 5.2, 'stone')
    c.ell(16, 18.5, 7, 3.2, 'water')
    c.poly([[2, 8], [16, 0.6], [30, 8]], 'roof')
    c.vline(16, 7, 17, 'sign.1'); c.rect(14, 14, 4, 3, 'bucket')
    for x in range(8, 24, 4):
        c.hline(x, x + 2, 24, 'stone.1')
    for x in range(10, 24, 5):
        c.hline(x, x + 2, 27, 'stone.1')
    single('well', c.render(), anchor=[16, 31])


def bin_() -> None:
    """Коробка урожая: резной ящик с открытым верхом, внутри виден урожай; золотой кант и бирка для силуэта издали."""
    parts = {'lid': P('wood', r=2, g='lid'), 'top': P('shade', r=2, g='top'), 'front': P('wood', r=3, g='front'),
             'dark': P('wood_dark', r=1, g='dark'), 'gold': P('gold', r=1, g='gold'), 'tag': P('cream', r=1, g='tag')}
    c = Cv(32, 32, parts)
    c.rect(2, 5, 28, 5, 'lid')
    c.rect(2, 10, 28, 19, 'dark')
    c.rect(4, 11, 24, 6, 'top')
    for x, y, m in ((6, 12, 'tomato'), (11, 11, 'sunflower'), (16, 12, 'tomato'), (21, 11, 'tomato'), (24, 12, 'sunflower')):
        c.dots([x, y, x + 1, y, x, y + 1, x + 1, y + 1], f'{m}.2'); c.dot(x, y, f'{m}.4')
    c.rect(2, 17, 28, 12, 'front')
    for x in (9, 16, 23):
        c.vline(x, 19, 28, 'wood.1')
    c.rect(2, 17, 28, 2, 'dark')
    c.rect(2, 5, 28, 1, 'gold')
    c.rect(12, 21, 8, 5, 'tag'); c.hline(13, 19, 23, 'jam_red.2'); c.vline(16, 22, 25, 'jam_red.2')
    single('bin', c.render(), anchor=[16, 31])


def board() -> None:
    """Доска заданий: тёмная рама и красная крыша (виден издали), яркие листки с цветными кнопками."""
    parts = {'post': P('trunk', r=2, g='post'), 'board': P('trunk', r=4, g='board'), 'roof': P('roof', r=2, g='roof'),
             'paper': P('paper', r=2, g='paper'), 'paper2': P('cream', r=2, g='paper2'), 'paper3': P('petal_yellow', r=2, g='paper3')}
    c = Cv(32, 32, parts)
    c.rect(4, 17, 3, 14, 'post'); c.rect(25, 17, 3, 14, 'post')
    c.rect(2, 5, 28, 17, 'board')
    c.poly([[0, 6], [16, 0], [32, 6]], 'roof'); c.rect(0, 5, 32, 3, 'roof')
    c.rect(5, 9, 7, 9, 'paper'); c.rect(14, 8, 7, 11, 'paper2'); c.rect(23, 10, 5, 8, 'paper3')
    for (x, y, w) in ((6, 12, 5), (6, 14, 4), (6, 16, 5), (15, 11, 5), (15, 13, 4), (15, 15, 5), (15, 17, 3)):
        c.hline(x, x + w, y, 'paper.1')
    c.dots([8, 9, 17, 8, 25, 10], 'jam_red.2'); c.dots([11, 9, 20, 8], 'blanket.2')
    single('board', c.render(), anchor=[16, 31])


def shelf() -> None:
    parts = {'back': P('wood_dark', r=3, g='back'), 'plank': P('wood', r=1, g='plank'), 'frame': P('wood', r=2, g='frame')}
    jars = [('jam_red', 5), ('jam_gold', 10), ('jam_green', 15), ('jar_glass', 20), ('jam_red', 24)]
    for k, (m, _) in enumerate(jars * 2):
        parts[f'j{k}'] = P(m, r=2, g=f'j{k}')
        parts[f'l{k}'] = P('wood', flat=2, g=f'l{k}')
    c = Cv(32, 32, parts)
    c.rect(1, 1, 30, 30, 'frame'); c.rect(3, 3, 26, 25, 'back')
    c.rect(2, 14, 28, 3, 'plank'); c.rect(2, 27, 28, 3, 'plank')
    k = 0
    for top in (7, 20):
        for (m, x) in jars:
            c.rect(x - 1, top, 4, 7, f'j{k}')
            c.rect(x - 1, top - 1, 4, 1, f'l{k}')
            k += 1
    single('shelf', c.render(), anchor=[16, 31])


def bed() -> None:
    parts = {'frame': P('wood', r=2, g='frame'), 'head': P('wood_dark', r=2, g='head'), 'pillow': P('pillow', r=2, g='pillow'),
             'sheet': P('cream', r=2, g='sheet'), 'blanket': P('blanket', r=4, g='blanket')}
    c = Cv(32, 32, parts)
    c.rect(1, 1, 30, 30, 'frame')
    c.rect(1, 1, 30, 5, 'head')
    c.rect(3, 6, 26, 23, 'sheet')
    c.rect(5, 7, 10, 6, 'pillow'); c.rect(17, 7, 10, 6, 'pillow')
    c.rect(3, 14, 26, 15, 'blanket')
    for x in range(5, 28, 4):
        c.vline(x, 17, 28, 'blanket.3')
    c.hline(3, 29, 14, 'blanket.4')
    single('bed', c.render(), anchor=[16, 31])


def desk() -> None:
    """Стол со словарём: красная скатерть, раскрытая книга, чернильница и свеча (вертикальный акцент для силуэта)."""
    parts = {'top': P('wood', r=4, g='top'), 'cloth': P('rug', r=2, g='cloth'), 'leg': P('wood_dark', r=1, g='leg'),
             'page': P('paper', r=3, g='book'), 'cover': P('book', r=1, g='book'), 'ink': P('jam_green', r=1, g='ink'),
             'wax': P('cream', r=1, g='wax'), 'flame': P('gold', flat=3)}
    c = Cv(32, 32, parts)
    c.rect(3, 23, 3, 8, 'leg'); c.rect(26, 23, 3, 8, 'leg')
    c.rect(1, 10, 30, 12, 'top')
    c.rect(1, 22, 30, 5, 'cloth')
    for x in range(3, 30, 4):
        c.rect(x, 22, 2, 5, 'rug2' if False else 'cloth')
    c.rect(6, 11, 20, 9, 'cover')
    c.rect(7, 11, 8, 8, 'page'); c.rect(17, 11, 8, 8, 'page')
    c.vline(16, 11, 19, 'book.1')
    for y in (13, 15, 17):
        c.hline(8, 14, y, 'paper.1'); c.hline(18, 24, y, 'paper.1')
    c.rect(27, 12, 3, 4, 'ink')
    c.rect(2, 4, 3, 6, 'wax'); c.rect(2, 2, 3, 2, 'flame')
    for x in range(3, 30, 4):
        c.vline(x, 23, 27, 'rug2.2')
    single('desk', c.render(), anchor=[16, 31])


def rug() -> None:
    parts = {'edge': P('rug', r=2, g='edge'), 'mid': P('rug2', r=2, g='mid'), 'core': P('rug', r=2, g='core')}
    c = Cv(32, 32, parts)
    c.rect(2, 3, 28, 26, 'edge'); c.rect(5, 6, 22, 20, 'mid'); c.rect(8, 9, 16, 14, 'core')
    for k in range(7):
        c.dot(11 + k * 1, 16 - k if k < 4 else 16 - (6 - k), 'rug2.3')
    c.dots([16, 12, 16, 20, 12, 16, 20, 16], 'rug2.4')
    single('rug', c.render(ring=False), anchor=[16, 31])


def window() -> None:
    parts = {'frame': P('cream', r=1, g='frame'), 'glass': P('glass', r=2, g='glass'), 'bar': P('cream', r=1, g='bar')}
    c = Cv(16, 16, parts)
    c.rect(1, 1, 14, 14, 'frame'); c.rect(3, 3, 10, 10, 'glass'); c.rect(7, 3, 2, 10, 'bar'); c.rect(3, 7, 10, 2, 'bar')
    c.dots([4, 4, 5, 4, 4, 5], 'white')
    single('window', c.render(ring=False), anchor=[8, 15])


def radio() -> None:
    """Ламповое радио на тумбе (16×32): арка корпуса, решётка динамика, стеклянная шкала с золотой стрелкой, ручки; тумба с дверцей."""
    parts = {'cab': P('wood', r=2, g='cab'), 'door': P('plank', r=2, g='door'), 'body': P('wood_dark', r=3, g='body'),
             'grille': P('rug2', r=2, g='grille'), 'dial': P('glass', r=2, g='dial'), 'knob': P('cream', r=1, g='knob'),
             'gold': P('gold', flat=3), 'leg': P('wood_dark', r=1, g='leg')}
    c = Cv(16, 32, parts)
    c.rect(2, 29, 2, 3, 'leg'); c.rect(12, 29, 2, 3, 'leg')
    c.rect(1, 19, 14, 11, 'cab')
    c.rect(3, 21, 10, 7, 'door')
    c.dot(11, 24, 'gold.3')
    c.rect(1, 8, 14, 11, 'body')
    c.ell(8, 9, 7, 3.2, 'body')
    c.rect(3, 10, 5, 7, 'grille')
    for y in (11, 13, 15):
        c.hline(3, 8, y, 'rug2.1')
    c.ell(11.5, 11.5, 2.4, 2.4, 'dial')
    c.dot(11, 11, 'white'); c.dot(12, 12, 'gold.3')
    c.dot(10, 15, 'cream.3'); c.dot(13, 15, 'cream.3')
    c.dots([5, 6, 8, 5, 11, 5], 'gold.3')
    single('radio', c.render(), anchor=[8, 31])


def build() -> None:
    tree('tree', 3)
    tree('tree2', 11, ('leaf2', 'leaf'))
    bush('bush', 5)
    bush('bush_flowers', 9, 'petal_pink')
    flower('flower_pink', 'petal_pink', 3)
    flower('flower_yellow', 'petal_yellow', 2)
    flower('flower_white', 'petal_white', 3)
    rock('rock')
    house(); well(); bin_(); board(); shelf(); bed(); desk(); radio(); rug(); window()
