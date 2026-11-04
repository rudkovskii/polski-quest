"""Мелкий декор фермы: фонарь, кустики травы, пень, дрова, сено, бочка, ящик, тыквы, пруд, россыпи. Новых цветов нет, только рампы материалов.
Спрайты `v3_*` пакуются в конец атласа (`FINAL_PREFIXES` в sprites_build.py), координаты прежних кадров не двигаются.

    python3 tools/art_decor.py   # переписать только листы этого файла и тайлы (t_grass, t_path, t_floor), без остальных спрайтов
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art_core import OUT, SHEETS, Cv, P, Sheet, emit, single  # noqa: E402


def blank(w: int, h: int):
    return [[None] * w for _ in range(h)]


def put(g, pts, name: str) -> None:
    for x, y in pts:
        if 0 <= y < len(g) and 0 <= x < len(g[0]):
            g[y][x] = name


def tuft(sid: str, blades) -> None:
    g = blank(16, 16)
    for x, h, lean in blades:
        for i in range(h):
            xx = x + (lean if i >= h - 2 else 0)
            g[15 - i][xx] = 'grass.3' if i == h - 1 else 'grass.1' if i == 0 else 'grass.2' if i % 2 else 'grass.1'
    single(sid, g, anchor=[8, 15])


def lantern() -> None:
    c = Cv(16, 32, {'post': P('wood_dark', r=1, g='post'), 'cap': P('wood_dark', r=1, g='cap'), 'glass': P('gold', r=2, g='glass'), 'foot': P('stone', r=1, g='foot')})
    c.rect(7, 13, 2, 17, 'post')
    c.ell(8, 30, 3.5, 1.8, 'foot')
    c.rect(5, 5, 6, 8, 'glass')
    c.poly([(3.5, 5), (8, 1), (12.5, 5)], 'cap')
    c.rect(4, 12.5, 8, 1.5, 'cap')
    g = c.render()
    for y in (6, 7, 8, 9, 10, 11):
        g[y][7] = 'gold.4'
        g[y][8] = 'gold.4'
    put(g, [(5, 6), (10, 6)], 'cream.3')
    single('v3_lantern', g, anchor=[8, 31])


def stump() -> None:
    c = Cv(16, 16, {'bark': P('trunk', r=2, g='bark'), 'top': P('wood', r=1, g='top')})
    c.rect(3, 8, 10, 6, 'bark')
    c.ell(8, 14, 6, 2, 'bark')
    c.ell(8, 8, 5, 2.4, 'top')
    g = c.render()
    put(g, [(6, 8), (7, 8), (8, 8), (9, 8), (7, 7), (8, 9)], 'wood.1')
    single('v3_stump', g, anchor=[8, 15])


def logs() -> None:
    """Поленница торцами: кольца вместо сплошной горки."""
    g = blank(32, 16)
    for cx, cy in ((11, 5), (20, 5), (6, 11), (15, 11), (24, 11)):
        for dy in range(-5, 5):
            for dx in range(-5, 5):
                d = math.hypot(dx + 0.5, dy + 0.5)
                if d > 4.9 or not (0 <= cy + dy < 16 and 0 <= cx + dx < 32):
                    continue
                t = 'trunk.o' if d > 4.2 else 'trunk.2' if d > 3.4 else 'wood.3' if d > 2.4 else 'wood.2' if d > 1.3 else 'wood.1'
                g[cy + dy][cx + dx] = t
    single('v3_logs', g, anchor=[16, 15])


def barrel() -> None:
    c = Cv(16, 16, {'w': P('wood', r=3, g='w'), 'hoop': P('tin', r=1, g='hoop'), 'top': P('wood_dark', r=1, g='top')})
    c.ell(8, 8.5, 5.5, 7, 'w')
    c.rect(2, 4, 12, 1.5, 'hoop', only={'w'})
    c.rect(2, 11, 12, 1.5, 'hoop', only={'w'})
    c.ell(8, 3.2, 4.2, 1.6, 'top')
    single('v3_barrel', c.render(), anchor=[8, 15])


def crate() -> None:
    c = Cv(16, 16, {'w': P('wood', r=1, g='w')})
    c.rect(2, 3, 12, 12, 'w')
    g = c.render()
    for y in range(4, 14):
        g[y][4 + (y - 4)] = 'wood.1'
    for x in range(3, 13):
        g[3][x] = 'wood.3'
    single('v3_crate', g, anchor=[8, 15])


def hay() -> None:
    rng = random.Random(4)
    c = Cv(32, 16, {'h': P('leaf_dry', r=3, g='h')})
    c.ell(16, 9, 13, 6.5, 'h')
    g = c.render()
    for _ in range(46):
        x, y = rng.randrange(5, 27), rng.randrange(4, 14)
        if g[y][x] and not g[y][x].endswith('.o'):
            g[y][x] = rng.choice(('leaf_dry.3', 'leaf_dry.1', 'leaf_dry.2'))
    for y in range(4, 15):
        if g[y][9] and not g[y][9].endswith('.o'):
            g[y][9] = 'wood_dark.2'
        if g[y][22] and not g[y][22].endswith('.o'):
            g[y][22] = 'wood_dark.2'
    single('v3_hay', g, anchor=[16, 15])


def pumpkins() -> None:
    c = Cv(16, 16, {'a': P('tomato', r=2, g='a'), 'b': P('sunflower', r=2, g='b')})
    c.ell(6, 11, 4.5, 3.6, 'a')
    c.ell(11.5, 12.5, 3, 2.6, 'b')
    g = c.render()
    put(g, [(5, 8), (6, 7), (11, 10)], 'leaf.1')
    put(g, [(4, 10), (4, 11), (7, 10), (7, 11), (7, 12)], 'tomato.1')
    single('v3_pumpkins', g, anchor=[8, 15])


def bits() -> None:
    g = blank(16, 16)
    put(g, [(4, 13), (5, 13), (5, 12), (10, 14), (11, 14), (7, 10), (8, 10)], 'stone.3')
    put(g, [(4, 14), (5, 14), (6, 13), (10, 15), (11, 15), (7, 11), (8, 11)], 'stone.1')
    single('v3_pebbles', g, anchor=[8, 15])
    g = blank(16, 16)
    put(g, [(4, 11), (5, 11), (6, 10), (7, 10), (8, 10), (9, 9), (10, 9), (7, 13), (8, 13), (9, 14), (10, 14)], 'trunk.2')
    put(g, [(6, 9), (9, 8), (8, 12)], 'trunk.1')
    single('v3_twigs', g, anchor=[8, 15])
    g = blank(16, 16)
    put(g, [(3, 12), (4, 12), (4, 13), (9, 10), (10, 10), (10, 11), (12, 14), (13, 14)], 'leaf_dry.2')
    put(g, [(6, 14), (7, 14), (7, 15), (5, 9), (6, 9)], 'tomato.2')
    put(g, [(13, 12), (12, 11)], 'leaf_dry.1')
    single('v3_leaves', g, anchor=[8, 15])
    c = Cv(16, 16, {'cap': P('tomato', r=1, g='cap'), 'stem': P('cream', r=1, g='stem')})
    c.rect(7, 11, 2, 4, 'stem')
    c.ell(8, 10, 3.6, 2.6, 'cap')
    c.rect(3, 13, 1.6, 2, 'stem')
    c.ell(3.8, 12.5, 2, 1.5, 'cap')
    g = c.render()
    put(g, [(7, 9), (9, 10)], 'cream.3')
    single('v3_mushrooms', g, anchor=[8, 15])


def pond() -> None:
    w, h = 80, 48
    cx, cy, rx, ry = 40, 23, 37, 21
    rng = random.Random(8)
    wob = [rng.uniform(-0.05, 0.05) for _ in range(9)]
    def dist(x: float, y: float) -> float:
        a = math.atan2((y - cy) / ry, (x - cx) / rx)
        k = 1 + sum(wob[i] * math.sin((i + 2) * a + i) for i in range(9))
        return math.hypot((x - cx) / rx, (y - cy) / ry) / k
    stones = [(6, 20), (12, 10), (24, 3), (55, 3), (70, 12), (75, 26), (66, 39), (48, 44), (22, 42), (10, 33)]
    pads = [(26, 17), (31, 23), (52, 29), (58, 21)]
    sh = Sheet('v3_pond', w, h, anchor=[40, 47], anims={'idle': []})
    glints = [(18, 15, 5), (34, 11, 7), (50, 14, 5), (30, 30, 6), (46, 33, 7), (60, 26, 4), (22, 24, 4), (42, 22, 6)]
    for f in range(4):
        g = blank(w, h)
        for y in range(h):
            for x in range(w):
                d = dist(x + 0.5, y + 0.5)
                if d > 1:
                    continue
                if d > 0.9:
                    g[y][x] = 'dirt.2' if (x * 7 + y * 13) % 5 else 'dirt.3'
                elif d > 0.84:
                    g[y][x] = 'dirt.1' if y < cy else 'soil.2'
                else:
                    # Сверху берег даёт тень, к середине глубже.
                    t = 'water.1' if d < 0.42 else 'water.2'
                    if y < cy - ry * 0.58 and d > 0.7:
                        t = 'water.1'
                    if y > cy and d > 0.72:
                        t = 'water.3'
                    g[y][x] = t
        for i, (gx, gy, ln) in enumerate(glints):
            shift = (f + i) % 4
            xx = gx + (1 if shift in (1, 2) else -1 if shift == 3 else 0)
            for k in range(ln if shift != 3 else ln // 2):
                if dist(xx + k, gy) < 0.8:
                    g[gy][xx + k] = 'water.4'
            if (f + i) % 4 == 0 and dist(gx + 3, gy + 1) < 0.8:
                g[gy + 1][gx + 3] = 'water.4'
        for sx, sy in stones:
            for dy in range(-2, 3):
                for dx in range(-3, 4):
                    if (dx / 3.2) ** 2 + (dy / 2.2) ** 2 <= 1 and 0 <= sx + dx < w and 0 <= sy + dy < h:
                        g[sy + dy][sx + dx] = 'stone.3' if dy < 0 and dx < 1 else 'stone.1' if dy > 0 or dx > 1 else 'stone.2'
        for px, py in pads:
            for dy in range(-2, 3):
                for dx in range(-3, 4):
                    if (dx / 3.3) ** 2 + (dy / 2.3) ** 2 <= 1:
                        g[py + dy][px + dx] = 'leaf.3' if dy < 0 else 'leaf.2'
            g[py][px + 2] = 'water.2'
            g[py + 1][px + 3] = 'water.2'
        put(g, [(52, 28), (53, 28), (52, 27), (53, 29), (51, 28)], 'petal_pink.3')
        put(g, [(52, 28)], 'petal_yellow.3')
        # Камыш у правого берега.
        for x, ht in ((63, 11), (65, 14), (67, 9), (69, 12)):
            for k in range(ht):
                g[36 - k][x] = 'leaf.2' if k % 3 else 'leaf.1'
            g[36 - ht][x] = 'soil.2'
            g[35 - ht][x] = 'soil.2'
        sh.add(g)
    sh.anims = {}
    emit(sh)


def build() -> None:
    tuft('v3_tuft', ((6, 4, -1), (8, 6, 1), (10, 4, 1), (7, 3, 0)))
    tuft('v3_tuft2', ((5, 3, -1), (7, 5, -1), (9, 4, 1)))
    tuft('v3_tuft3', ((7, 5, 1), (9, 3, 1), (11, 4, 0), (5, 2, 0)))
    lantern(); stump(); logs(); barrel(); crate(); hay(); pumpkins(); bits(); pond()


def main() -> int:
    import art_tiles
    build()
    art_tiles.build()
    keep = {'t_grass', 't_path', 't_floor'}
    for sid, sh in SHEETS.items():
        if sid.startswith('v3_') or sid in keep:
            (OUT / f'{sid}.sprite.json').write_text(json.dumps(sh.to_json(), ensure_ascii=False) + '\n', 'utf8')
    print(f'art_decor: {sum(1 for s in SHEETS if s.startswith("v3_"))} спрайтов v3_, тайлы {sorted(keep)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
