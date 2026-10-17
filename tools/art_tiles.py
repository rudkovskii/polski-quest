"""Тайлы 16×16: трава, дорожка, грядка, забор, пол, стены. Без контура (кроме забора), цвета из рамп материалов."""
from __future__ import annotations

import random

from art_core import Cv, P, Sheet, emit, single

T = 16
N, E, S, W = 1, 2, 4, 8


def grid(fill: str) -> list[list[str | None]]:
    return [[fill] * T for _ in range(T)]


def grass(seed: int):
    rng = random.Random(seed)
    g = grid('grass.2')
    for _ in range(9):
        x, y = rng.randrange(T), rng.randrange(T)
        g[y][x] = 'grass.3'
    for _ in range(6):
        x, y = rng.randrange(T), rng.randrange(T)
        g[y][x] = 'grass.1'
    for _ in range(2):
        # травинка: тёмный стебель с светлой вершиной
        x, y = rng.randrange(1, T - 1), rng.randrange(3, T)
        g[y][x] = 'grass.1'; g[y - 1][x] = 'grass.1'; g[y - 2][x] = 'grass.3'
    return g


def edge_dist(mask: int, x: int, y: int) -> int:
    ds = []
    if not mask & N: ds.append(y)
    if not mask & S: ds.append(T - 1 - y)
    if not mask & W: ds.append(x)
    if not mask & E: ds.append(T - 1 - x)
    return min(ds) if ds else 99


def corner_cut(mask: int, x: int, y: int) -> bool:
    """Скруглённые углы: где две соседние стороны открыты, срезаем угловой пиксель."""
    for a, b, cx, cy in ((N, W, 0, 0), (N, E, T - 1, 0), (S, W, 0, T - 1), (S, E, T - 1, T - 1)):
        if not mask & a and not mask & b and abs(x - cx) + abs(y - cy) <= 1:
            return True
    return False


def patch(mat: str, seed: int, mask: int, furrow: bool):
    """Дорожка или грядка: фактура материала, у открытых сторон тёмная кромка и трава."""
    rng = random.Random(seed)
    g = [[f'{mat}.2'] * T for _ in range(T)]
    for y in range(T):
        for x in range(T):
            if furrow:
                g[y][x] = f'{mat}.1' if y % 4 == 2 else (f'{mat}.3' if y % 4 == 1 else f'{mat}.2')
            elif rng.random() < 0.14:
                g[y][x] = f'{mat}.3' if rng.random() < 0.6 else f'{mat}.1'
    for y in range(T):
        for x in range(T):
            d = edge_dist(mask, x, y)
            if d == 0 or corner_cut(mask, x, y):
                g[y][x] = 'grass.1' if (x + y) % 2 else 'grass.2'
            elif d == 1:
                g[y][x] = f'{mat}.0' if furrow else f'{mat}.1'
    return g


def soil_patch(seed: int, mask: int):
    """Вскопанная земля (Stardew): тёмная влажная почва, прерывистые борозды с гребнем, комки; у открытых сторон мягкий край к траве.
    Фактура на внутренних клетках периодична по 16 px (стыкуется), края рваные, свет сверху-слева."""
    rng = random.Random(1031)  # зерно одно на все маски: клетки стыкуются
    g = [['soil.2'] * T for _ in range(T)]
    # крупное пятнистое зерно: чуть светлее/темнее участки
    for _ in range(20):
        x, y = rng.randrange(T), rng.randrange(T)
        g[y][x] = 'soil.3' if rng.random() < 0.5 else 'soil.1'
    # борозды: две на клетку, с разрывами (чтобы не читалось полосами), гребень сверху светлее
    for gy, gaps in ((4, (3, 4, 10)), (12, (1, 8, 9))):
        for x in range(T):
            if x in gaps:
                continue
            g[gy][x] = 'soil.0' if (x + gy) % 5 else 'soil.1'
            g[gy + 1][x] = 'soil.1'
            g[gy - 1][x] = 'soil.3' if (x * 3 + gy) % 4 else 'soil.4'
    # комки: светлая точка + тень справа-снизу
    for x, y in ((2, 8), (7, 1), (12, 9), (14, 2), (5, 14), (10, 6)):
        g[y][x] = 'soil.4'
        g[y + 1][x + 1 if x + 1 < T else 0] = 'soil.1'
    rng = random.Random(seed)
    # открытые стороны: рваный край, светлая кромка сверху/слева, тень снизу/справа
    for y in range(T):
        for x in range(T):
            d = edge_dist(mask, x, y)
            if d > 2 and not corner_cut(mask, x, y):
                continue
            lit = (not mask & N and y <= 2) or (not mask & W and x <= 2)
            r = rng.random()
            if corner_cut(mask, x, y):
                g[y][x] = 'grass.1' if (x + y) % 2 else 'grass.2'
            elif d == 0:
                g[y][x] = 'grass.2' if r < 0.55 else ('grass.1' if r < 0.8 else 'soil.1')
            elif d == 1:
                g[y][x] = 'soil.1' if (r < 0.55 or not lit) else ('grass.1' if r < 0.62 else 'soil.3')
            elif d == 2:
                g[y][x] = 'soil.3' if (lit and r < 0.55) else ('soil.1' if r < 0.12 else g[y][x])
    return g


def floor(seed: int):
    rng = random.Random(seed)
    g = grid('plank.2')
    for row in range(4):
        y0 = row * 4
        for x in range(T):
            g[y0][x] = 'plank.3'
            g[y0 + 3][x] = 'plank.1'
        jx = (seed * 5 + row * 7) % T
        for y in range(y0, y0 + 4):
            g[y][jx] = 'plank.1'
        for _ in range(3):
            g[y0 + rng.randrange(1, 3)][rng.randrange(T)] = 'plank.1' if rng.random() < 0.5 else 'plank.3'
    return g


def wall_top():
    g = grid('wood_dark.2')
    for x in range(T):
        g[0][x] = 'wood_dark.3'; g[1][x] = 'wood_dark.3'; g[T - 1][x] = 'wood_dark.1'
    for x in (5, 11):
        for y in range(2, T):
            g[y][x] = 'wood_dark.1'
    return g


def wall_face():
    g = grid('wall.2')
    for y in range(11):
        for x in range(T):
            if x % 4 == 0:
                g[y][x] = 'wall.3'
    for x in range(T):
        g[0][x] = 'wood_dark.1'
        g[11][x] = 'wood.3'
        for y in range(12, 15):
            g[y][x] = 'wood.2'
        g[13][x] = 'wood.3' if x % 8 < 7 else 'wood.1'
        g[15][x] = 'wood_dark.1'
    return g


def door_tile():
    g = wall_face()
    for y in range(T):
        for x in range(1, 15):
            g[y][x] = 'wood_dark.0' if x in (1, 14) else 'wood.2'
        g[y][2] = 'wood.3'; g[y][13] = 'wood.1'
    for x in range(1, 15):
        g[0][x] = 'wood_dark.0'
    for y in (4, 5, 6, 9, 10, 11):
        for x in range(4, 12):
            g[y][x] = 'wood.1' if y in (6, 11) else 'wood.3' if y in (4, 9) else 'wood.2'
    g[9][11] = 'gold.3'; g[10][11] = 'gold.2'
    return g


def mat_tile():
    g = grid('rug2.2')
    for y in range(T):
        for x in range(T):
            if min(x, y, T - 1 - x, T - 1 - y) in (0, 1):
                g[y][x] = 'rug.2' if min(x, y, T - 1 - x, T - 1 - y) == 1 else 'rug.0'
            elif (x + y) % 4 == 0:
                g[y][x] = 'rug2.3'
    return g


def fence(mask: int):
    parts = {'post': P('wood', r=2, g='post'), 'rail': P('wood', r=1, g='rail')}
    c = Cv(T, T, parts)
    if mask & E: c.rect(8, 6, 8, 2.4, 'rail'); c.rect(8, 10, 8, 2, 'rail')
    if mask & W: c.rect(0, 6, 8, 2.4, 'rail'); c.rect(0, 10, 8, 2, 'rail')
    if mask & N: c.rect(6.8, 0, 2.6, 8, 'rail')
    if mask & S: c.rect(6.8, 8, 2.6, 7, 'rail')
    c.rect(5.5, 3.5, 4.5, 11.5, 'post')
    c.rect(5.5, 2.5, 4.5, 1.5, 'post')
    return c.render()


def build() -> None:
    sh = Sheet('t_grass', T, T, anchor=[8, 15])
    for i in range(4):
        sh.add(grass(i + 1))
    emit(sh)
    for sid, mat, furrow, seed in (('t_path', 'dirt', False, 21), ('t_soil', 'soil', True, 31)):
        s = Sheet(sid, T, T, anchor=[8, 15])
        for mask in range(16):
            s.add(soil_patch(seed + mask, mask) if furrow else patch(mat, seed + mask, mask, furrow))
        emit(s)
    f = Sheet('t_fence', T, T, anchor=[8, 15])
    for mask in range(16):
        f.add(fence(mask))
    emit(f)
    fl = Sheet('t_floor', T, T, anchor=[8, 15])
    for i in range(3):
        fl.add(floor(i + 1))
    emit(fl)
    single('t_wall_top', wall_top(), anchor=[8, 15])
    single('t_wall_face', wall_face(), anchor=[8, 15])
    single('t_door', door_tile(), anchor=[8, 15])
    single('t_mat', mat_tile(), anchor=[8, 15])
