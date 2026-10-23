#!/usr/bin/env python3
"""Детальная пиксельная карта Польши для Geografia (v2, 23.10.2026, просьба Шэфа «более детальную и красивую, чтобы города было лучше видно»).

Пишет public/maps-art/poland.png (320×304, телефон и масштаб < 2) и poland@2x.png (640×608, десктоп и увеличение).
Проекция та же, что у tools/art_map.py (lon0 12.65, latTop 55.55, cos 52°, k = 41 на px картинки 1×): геометрия игры
(poland.json, src/games/geo/geodata.ts, координаты единиц) не меняется, меняется только картинка.

Источник — Natural Earth 1:10m (общественное достояние), GeoJSON-копия https://github.com/nvkelso/natural-earth-vector:
admin_0_countries, admin_1_states_provinces, rivers_europe, rivers_lake_centerlines, lakes, lakes_europe, urban_areas,
geography_regions_polys (Tatry, Sudety, Karpaty). Леса — крупные массивы (пущи и боры) эллипсами с шумом по координатам из
открытых карт: украшение, не данные игры. Данные качаются в пустую папку, скрипт их только читает:

    python3 -I tools/art_map2.py --data <папка с ne_10m_*.geojson>

Цвета только из палитры игры (art/palette.json); текста на карте нет (подписи рисует DOM).
"""
from __future__ import annotations

import argparse
import math
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_map as M  # noqa: E402
from sprites_build import load_palette  # noqa: E402

OUT = M.OUT

# Крупные лесные массивы: (название, lat, lon, полуоси км по долготе и широте, наклон °). Приблизительно, для вида карты.
FORESTS = [
    ('Puszcza Białowieska', 52.72, 23.80, 22, 18, 0),
    ('Puszcza Knyszyńska', 53.28, 23.40, 16, 12, 20),
    ('Puszcza Augustowska', 53.92, 23.15, 24, 14, -10),
    ('Puszcza Piska', 53.55, 21.65, 28, 14, 10),
    ('Bory Tucholskie', 53.70, 17.90, 30, 26, 0),
    ('Puszcza Drawska', 53.15, 15.95, 24, 14, -15),
    ('Puszcza Notecka', 52.72, 16.15, 34, 12, 0),
    ('Bory Dolnośląskie', 51.45, 15.35, 36, 18, -20),
    ('Puszcza Kampinoska', 52.33, 20.55, 14, 6, 0),
    ('Puszcza Kozienicka', 51.55, 21.50, 14, 9, 0),
    ('Lasy Spalskie', 51.55, 20.15, 14, 9, 30),
    ('Lasy Lublinieckie', 50.70, 18.75, 18, 12, 0),
    ('Puszcza Solska', 50.45, 22.95, 32, 15, -25),
    ('Lasy Janowskie', 50.70, 22.35, 14, 10, 0),
    ('Puszcza Sandomierska', 50.40, 21.95, 22, 12, 10),
    ('Puszcza Romincka', 54.32, 22.50, 12, 8, 0),
    ('Lasy Gostynińskie', 52.45, 19.55, 12, 8, 0),
    ('Puszcza Bukowa', 53.35, 14.70, 8, 8, 0),
]

# Городские пятна меньше этого (км²) не рисуем: на карте они дают рябь, а не города.
URBAN_MIN_KM2 = 25.0


def area_km2(g) -> float:
    tot = 0.0
    for poly in M.rings(g):
        r = poly[0]
        a = 0.0
        for i in range(len(r)):
            x0, y0 = r[i][0], r[i][1]
            x1, y1 = r[(i + 1) % len(r)][0], r[(i + 1) % len(r)][1]
            a += x0 * y1 - x1 * y0
        lat = r[0][1]
        tot += abs(a) / 2 * 111.2 * 111.2 * math.cos(math.radians(lat))
    return tot


MOUNTAIN_REGIONS = {'Tatra Mts.': 'tatry', 'Sudetes Mts.': 'sudety', 'CARPATHIAN MOUNTAINS': 'karpaty'}


def vnoise(W: int, H: int, seed: int, cell: float) -> np.ndarray:
    """Гладкий шум 0..1 (значения на решётке `cell` px, билинейно со сглаживанием)."""
    rng = np.random.default_rng(seed)
    gw, gh = int(W / cell) + 3, int(H / cell) + 3
    g = rng.random((gh, gw))
    ys, xs = np.mgrid[0:H, 0:W].astype(float)
    fx, fy = xs / cell, ys / cell
    ix, iy = fx.astype(int), fy.astype(int)
    tx, ty = fx - ix, fy - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = g[iy, ix] * (1 - tx) + g[iy, ix + 1] * tx
    b = g[iy + 1, ix] * (1 - tx) + g[iy + 1, ix + 1] * tx
    return a * (1 - ty) + b * ty


def grow(mask: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return mask.copy()
    im = Image.fromarray((mask * 255).astype(np.uint8))
    return np.array(im.filter(ImageFilter.MaxFilter(2 * r + 1))) > 0


def shrink(mask: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return mask.copy()
    im = Image.fromarray((mask * 255).astype(np.uint8))
    return np.array(im.filter(ImageFilter.MinFilter(2 * r + 1))) > 0


def edge(mask: np.ndarray, other: np.ndarray | None = None) -> np.ndarray:
    """Пиксели `mask`, у которых сосед (4 стороны) не в `mask` (и, если задано, в `other`)."""
    out = np.zeros_like(mask)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb = np.roll(np.roll(mask, dy, 0), dx, 1)
        cond = ~nb
        if other is not None:
            cond &= np.roll(np.roll(other, dy, 0), dx, 1)
        out |= mask & cond
    out[0, :] = out[-1, :] = False
    out[:, 0] = out[:, -1] = False
    return out & mask


def render(data: Path, s: int) -> Image.Image:
    M.W, M.H, M.K, M.SS = 320 * s, 304 * s, 41.0 * s, 4 if s == 1 else 3
    W, H = M.W, M.H
    pal = load_palette().names
    img = np.zeros((H, W, 3), np.uint8)
    ys, xs = np.mgrid[0:H, 0:W]
    chk = (xs + ys) % 2 == 0

    def put(mask: np.ndarray, name: str) -> None:
        img[mask] = pal[name]

    def mask_of(geoms) -> np.ndarray:
        return np.array(M.mask_of(list(geoms))) > 0

    countries = M.load(data, 'admin_0_countries')
    by_iso: dict[str, list] = {}
    for f in countries:
        iso = f['properties'].get('ISO_A2_EH') or f['properties'].get('ISO_A2')
        by_iso.setdefault(iso, []).append(f['geometry'])
    land = mask_of(f['geometry'] for f in countries)
    pl = mask_of(by_iso['PL'])
    nbl = land & ~pl
    cid = np.array(M.id_map([(i + 2, g) for i, iso in enumerate(sorted(by_iso)) if iso != 'PL' for g in by_iso[iso]]))

    # воеводства (для пунктира границ): щели между полигонами и береговой кромкой закрываем соседним id
    admin1 = [f for f in M.load(data, 'admin_1_states_provinces') if f['properties'].get('admin') == 'Poland']
    vid = np.array(M.id_map([(i + 1, f['geometry']) for i, f in enumerate(admin1)])).astype(np.int32)
    for _ in range(4 * s):
        hole = pl & (vid == 0)
        if not hole.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nb = np.roll(np.roll(vid, dy, 0), dx, 1)
            fill = hole & (nb > 0) & (vid == 0)
            vid[fill] = nb[fill]

    def near_frame(g) -> bool:
        return g is not None and any(M.near(p[0], 0.2) for p in M.rings(g))

    lakes = mask_of(f['geometry'] for n in ('lakes', 'lakes_europe') for f in M.load(data, n) if near_frame(f['geometry'])) & land
    urban = mask_of(f['geometry'] for f in M.load(data, 'urban_areas') if near_frame(f['geometry']) and area_km2(f['geometry']) >= URBAN_MIN_KM2) & land & ~lakes
    regions = {v: mask_of([f['geometry'] for f in M.load(data, 'geography_regions_polys') if (f['properties'].get('NAME') or f['properties'].get('name')) == k]) for k, v in MOUNTAIN_REGIONS.items()}
    mt = (regions['tatry'] | regions['sudety'] | regions['karpaty']) & land

    # Góry Świętokrzyskie — низкое пасмо: холмы капсулой (в Natural Earth их нет)
    def capsule(a, b, r_km):
        (x1, y1), (x2, y2) = M.project(a[1], a[0]), M.project(b[1], b[0])
        r = r_km / 111.2 * M.K
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        t = np.clip(((xs + .5 - x1) * dx + (ys + .5 - y1) * dy) / l2, 0, 1)
        return (x1 + t * dx - xs - .5) ** 2 + (y1 + t * dy - ys - .5) ** 2 <= r * r
    hills = capsule((50.92, 20.30), (50.80, 21.10), 9) & pl
    # Татры: полигон Natural Earth «Tatra Mts.» тянется на все польские Карпаты, настоящие Татры — узкая полоса у Закопане
    regions['karpaty'] = (regions['karpaty'] | regions['tatry']) & land
    regions['tatry'] = capsule((49.21, 19.72), (49.24, 20.22), 8) & land
    mt = (regions['tatry'] | regions['sudety'] | regions['karpaty']) & land

    # леса: эллипсы с рваным краем
    fnoise = vnoise(W, H, 31, 4 * s) * 0.6 + vnoise(W, H, 37, 11 * s) * 0.4
    forest = np.zeros((H, W), bool)
    for name, lat, lon, ax, ay, rot in FORESTS:
        # массив = несколько пятен вокруг центра (неровный край, «рукава»), не ровный овал
        frng = np.random.default_rng(zlib.crc32(name.encode()))
        cx0, cy0 = M.project(lon, lat)
        rx0, ry0 = ax / 111.2 * M.K, ay / 111.2 * M.K
        a = math.radians(rot)
        for k in range(5):
            ox, oy = (frng.random() * 2 - 1) * 0.6, (frng.random() * 2 - 1) * 0.6
            cx = cx0 + ox * rx0 * math.cos(a) - oy * ry0 * math.sin(a)
            cy = cy0 + ox * rx0 * math.sin(a) + oy * ry0 * math.cos(a)
            sc = 0.45 + 0.35 * frng.random() if k else 0.75
            rx, ry = rx0 * sc, ry0 * sc
            u = ((xs - cx) * math.cos(a) + (ys - cy) * math.sin(a)) / rx
            v = (-(xs - cx) * math.sin(a) + (ys - cy) * math.cos(a)) / ry
            forest |= u * u + v * v <= 0.4 + 1.1 * fnoise
    forest &= pl & ~lakes & ~urban & ~mt

    # ───── море ─────
    sea = ~land
    put(sea, 'water.2')
    r1, r2, r3 = grow(land, s), grow(land, 3 * s), grow(land, 6 * s)
    put(sea & r3 & ~r2 & chk, 'water.3')
    put(sea & r2 & ~r1, 'water.3')
    put(sea & r1 & chk, 'water.4')
    put(sea & r1 & ~chk, 'water.3')
    # волны: короткие дуги в открытом море
    rng = np.random.default_rng(77)
    open_sea = sea & ~grow(land, 5 * s)
    for _ in range(int(90 * s * s)):
        x, y = int(rng.integers(2, W - 6)), int(rng.integers(2, H - 3))
        if not open_sea[y, x] or not open_sea[y, min(W - 1, x + 4)]:
            continue
        for dx, dy, c in ((0, 0, 'water.3'), (1, -1, 'water.4'), (2, -1, 'water.4'), (3, 0, 'water.3')) if s > 1 else ((0, 0, 'water.3'), (1, -1, 'water.3'), (2, 0, 'water.3')):
            img[y + dy, x + dx] = pal[c]

    # ───── соседи: пергамент ─────
    n1, n2 = vnoise(W, H, 7, 14 * s), vnoise(W, H, 11, 5 * s)
    put(nbl, 'sack.3')
    put(nbl & (n1 < 0.3) & chk, 'loose.4')
    put(nbl & (n2 > 0.86) & ((xs * 3 + ys) % 5 == 0), 'loose.4')
    nmt = mt & nbl
    put(nmt & ((xs - ys) % (3 * s) == 0), 'dirt.3')
    put(urban & nbl, 'stone.3')
    put(edge(urban & nbl) , 'stone.2')

    # ───── Польша ─────
    put(pl, 'grass.2')
    put(pl & (n1 > 0.70) & chk, 'grass.3')
    put(pl & (n1 < 0.2) & chk, 'leaf2.2')
    put(pl & (n2 > 0.84) & ((xs * 3 + ys) % 5 == 0), 'grass.3')
    # юг (возвышенности) чуть суше
    lat = M.LAT_TOP - ys / M.K
    put(pl & (lat < 51.0) & (n1 > 0.55) & (n2 > 0.6) & chk & ~mt, 'grass.3')

    # леса: тёмная зелень и деревья
    put(forest, 'leaf.2')
    put(edge(forest, pl) , 'leaf.1')
    if s > 1:
        tree = [(0, -2, 'leaf.4'), (-1, -1, 'leaf.3'), (0, -1, 'leaf.4'), (1, -1, 'leaf.3'), (-1, 0, 'leaf.3'), (0, 0, 'leaf.3'), (1, 0, 'leaf.1'), (0, 1, 'leaf.0')]
        jit = vnoise(W, H, 13, 3)
        for y in range(3, H - 3, 4):
            for x in range(3 + (y // 4 % 2) * 2, W - 3, 4):
                xx, yy = x + int(jit[y, x] * 2) - 1, y
                if forest[yy, xx] and forest[yy - 2, xx] and forest[yy + 1, xx]:
                    for dx, dy, c in tree:
                        img[yy + dy, xx + dx] = pal[c]
    else:
        put(forest & ((xs + 2 * ys) % 4 == 0), 'leaf.3')
        put(forest & ((xs + 2 * ys) % 4 == 2), 'leaf.1')

    # горы: предгорья, массив, пики (Татры со снегом)
    # лесистые горы (Бескиды, Бещады, Судеты): тёмная зелень с хребтами; Татры — камень и снег
    pmt = mt & pl
    tat = regions['tatry']
    foot = grow(pmt, 3 * s) & pl & ~pmt
    put(foot & chk & (n2 > 0.35), 'leaf2.2')
    put(pmt, 'leaf.2')
    put(pmt & chk & (n2 > 0.45), 'leaf2.2')
    put(edge(pmt, pl), 'leaf.1')
    put(tat, 'stone.3')
    put(tat & chk & (n2 > 0.5), 'stone.4')

    def peak(cx: int, cy: int, kind: str, name: str = '') -> None:
        shapes = {
            'small': ['...o...', '..oLo..', '.oLLDo.', 'oLLLDDo'],
            'mid': ['....o....', '...oLo...', '..oLLDo..', '.oLLLDDo.', 'oLLLLDDDo'],
            'snow': ['.....o.....', '....oso....', '...ossDo...', '..oLsLDDo..', '.oLLLLDDDo.', 'oLLLLLDDDDo'],
            'hill': ['..ooo..', '.oLLDo.', 'oLLLDDo'],
        }
        body = {'L': 'stone.3', 'D': 'stone.1', 'o': 'stone.0', 's': 'white'}
        if kind == 'hill' or (kind in ('small', 'mid') and name != 'tatry'):
            body = {'L': 'leaf.3', 'D': 'leaf.1', 'o': 'leaf.0'}
        sh = shapes[kind]
        h, w = len(sh), len(sh[0])
        for j, row in enumerate(sh):
            for i, ch in enumerate(row):
                if ch == '.':
                    continue
                X, Y = cx - w // 2 + i, cy - h + 1 + j
                if 0 <= X < W and 0 <= Y < H and land[Y, X]:
                    img[Y, X] = pal[body[ch]]

    placed: list[tuple[int, int]] = []
    for name, m, kind, sp in (('tatry', regions['tatry'], 'snow' if s > 1 else 'mid', 4 * s), ('sudety', regions['sudety'] & pl, 'mid' if s > 1 else 'small', 5 * s),
                              ('karpaty', regions['karpaty'] & pl & ~regions['tatry'], 'mid' if s > 1 else 'small', 5 * s), ('swietokrzyskie', hills, 'hill', 5 * s)):
        pts = list(zip(*np.nonzero(shrink(m, 1) if name != 'tatry' else m)))
        r2 = np.random.default_rng(zlib.crc32(name.encode()))
        r2.shuffle(pts)
        mine = []
        for y, x in pts:
            if any(abs(x - a) < sp and abs(y - b) < sp * 0.8 for a, b in placed):
                continue
            placed.append((x, y))
            mine.append((x, y))
        for x, y in sorted(mine, key=lambda p: p[1]):
            peak(int(x), int(y) + 2 * s, kind, name)

    # города: городские пятна (по Natural Earth urban_areas) — крыши и улицы
    pu = urban & pl
    put(pu, 'wall.2')
    put(pu & chk, 'roof.4')
    if s > 1:
        put(pu & ((xs % 4 == 1) & (ys % 4 == 1)), 'roof.2')
    put(edge(pu), 'roof.3')

    # реки
    riv = Image.new('L', (W, H), 0)
    rd = ImageDraw.Draw(riv)
    seen_named: set[str] = set()
    for fn in ('rivers_europe', 'rivers_lake_centerlines'):
        for f in M.load(data, fn):
            g = f['geometry']
            if not g:
                continue
            nm = f['properties'].get('name')
            named = nm in M.RIVERS
            main = named and M.RIVERS[nm][1]
            if not named and (s == 1 or (f['properties'].get('scalerank') or 10) > 11):
                continue
            for ln in M.lines(g):
                if not M.near(ln, 0.0):
                    continue
                pts = [M.project(*p[:2]) for p in ln]
                lvl = 3 if main else 2 if named else 1
                width = (3 if s > 1 else 2) if main else (2 if s > 1 else 1) if named else 1
                rd.line(pts, fill=lvl, width=width, joint='curve')
            if named:
                seen_named.add(M.RIVERS[nm][0])
    rv = np.array(riv)
    rmask = (rv > 0) & land & ~lakes
    put(rmask & (rv == 1) & pl, 'water.2')
    put(rmask & (rv == 1) & nbl, 'water.2')
    put(rmask & (rv >= 2), 'water.1')
    if s > 1:
        core = shrink(rv == 3, 1) & land
        put(core, 'water.2')

    # озёра
    put(lakes, 'water.2')
    put(lakes & grow(lakes, 0) & edge(lakes, land), 'water.1')
    put(lakes & chk & shrink(lakes, 2 * s), 'water.3')

    # границы воеводств: пунктир
    vb = np.zeros((H, W), bool)
    for dy, dx in ((0, 1), (1, 0)):
        nb = np.roll(np.roll(vid, -dy, 0), -dx, 1)
        inpl = np.roll(np.roll(pl, -dy, 0), -dx, 1)
        vb |= pl & inpl & (nb != vid) & (vid > 0) & (nb > 0)
    put(vb & ((xs + ys) % 4 != 0) & ~lakes, 'leaf.1' if s == 1 else 'grass.1')

    # граница государства и соседей между собой
    pl_border = edge(pl, nbl)
    nb_side = edge(nbl, pl)
    put(nb_side & (((xs + ys) // max(1, s)) % 2 == 0), 'roof.3')
    put(pl_border, 'roof.1')
    inter = np.zeros((H, W), bool)
    for dy, dx in ((0, 1), (1, 0)):
        nb = np.roll(np.roll(cid, -dy, 0), -dx, 1)
        ok = np.roll(np.roll(nbl, -dy, 0), -dx, 1)
        inter |= nbl & ok & (nb != cid)
    put(inter & ((xs + ys) % 3 != 0), 'dirt.1')

    # берег: тёмная кромка и полоска песка у Польши
    coast = edge(land, sea)
    if s > 1:
        sand = edge(land & ~coast, sea | coast) & ~coast
        put(sand & pl, 'sack.3')
        put(sand & nbl, 'dirt.4')
    put(coast & pl, 'grass.0')
    put(coast & nbl, 'dirt.1')
    return Image.fromarray(img, 'RGB')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', required=True, help='папка с ne_10m_*.geojson (Natural Earth)')
    ap.add_argument('--out', help='куда писать (по умолчанию public/maps-art)')
    a = ap.parse_args()
    out = Path(a.out) if a.out else OUT
    out.mkdir(parents=True, exist_ok=True)
    for s, name in ((1, 'poland.png'), (2, 'poland@2x.png')):
        im = render(Path(a.data), s)
        im.save(out / name, optimize=True)
        print(f'art_map2: {name} {im.width}×{im.height}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
