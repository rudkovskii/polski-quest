#!/usr/bin/env python3
"""Большая пиксельная карта Польши для экрана «Geografia»: public/maps-art/poland.png + poland.json (+ poland_cities.png).

Источник: Natural Earth 1:10m (общественное достояние, https://www.naturalearthdata.com/), GeoJSON-копия
https://github.com/nvkelso/natural-earth-vector (слои admin_0_countries, admin_1_states_provinces, rivers_lake_centerlines,
rivers_europe, lakes, populated_places). Данные качаются отдельно в пустую папку и сюда подаются путём; скрипт их только читает.

    python3 -I tools/art_map.py --data <папка с ne_10m_*.geojson>            # карта + 26 городов по умолчанию
    python3 -I tools/art_map.py --data <папка> --cities data/v2/geografia.json   # города по lat/lon из данных игры

Проекция простая равнопромежуточная с поправкой на широту: x = (lon − lon0)·cos(52°)·k, y = (lat_top − lat)·k.
Цвета только из палитры игры (art/palette.json + рампы материалов); в PNG нет альфы, кроме слоя городов (0/255).
Текста на карте нет: подписи (соседи, море, реки, горы, города) рисует DOM по координатам из poland.json.
Контур Польши сохраняется в art/geo/poland_outline.json: по нему art_world2.py рисует настенную карту без скачанных данных.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art_ramp import ROOT  # noqa: E402
from sprites_build import load_palette  # noqa: E402

W, H = 320, 304            # кратно 16
K = 41.0                   # px на градус широты
LAT0 = math.radians(52.0)
COS = math.cos(LAT0)
LON0 = 12.65               # долгота левого края
LAT_TOP = 55.55            # широта верхнего края
SS = 4                     # суперсэмплинг для береговой линии

OUT = ROOT / 'public' / 'maps-art'
GEO = ROOT / 'art' / 'geo'


def project(lon: float, lat: float) -> tuple[float, float]:
    return (lon - LON0) * COS * K, (LAT_TOP - lat) * K


def unproject(x: float, y: float) -> tuple[float, float]:
    return x / (COS * K) + LON0, LAT_TOP - y / K


# ───────────────────────────── геометрия ─────────────────────────────

def rings(geom: dict):
    """Полигоны геометрии как списки колец [[(lon, lat)...]...] (первое кольцо внешнее)."""
    t = geom['type']
    if t == 'Polygon':
        yield geom['coordinates']
    elif t == 'MultiPolygon':
        yield from geom['coordinates']


def lines(geom: dict):
    t = geom['type']
    if t == 'LineString':
        yield geom['coordinates']
    elif t == 'MultiLineString':
        yield from geom['coordinates']


def near(pts, pad=1.0) -> bool:
    """Есть ли у кольца вершина рядом с кадром (грубый отбор перед рисованием)."""
    lo_lon, hi_lon = LON0 - pad, LON0 + W / (COS * K) + pad
    lo_lat, hi_lat = LAT_TOP - H / K - pad, LAT_TOP + pad
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return not (max(xs) < lo_lon or min(xs) > hi_lon or max(ys) < lo_lat or min(ys) > hi_lat)


def draw_geom(d: ImageDraw.ImageDraw, geom: dict, fill: int, s: int) -> None:
    for poly in rings(geom):
        if not near(poly[0]):
            continue
        d.polygon([(project(*p[:2])[0] * s, project(*p[:2])[1] * s) for p in poly[0]], fill=fill)
        for hole in poly[1:]:
            d.polygon([(project(*p[:2])[0] * s, project(*p[:2])[1] * s) for p in hole], fill=0)


def mask_of(geoms, s: int = SS) -> Image.Image:
    """Маска суши 0/255 с пороговым уменьшением (береговая линия без лесенки суперсэмплинга)."""
    big = Image.new('L', (W * s, H * s), 0)
    d = ImageDraw.Draw(big)
    for g in geoms:
        draw_geom(d, g, 255, s)
    small = big.resize((W, H), Image.BOX)
    return small.point(lambda v: 255 if v >= 128 else 0)


def id_map(items: list[tuple[int, dict]], s: int = SS) -> Image.Image:
    big = Image.new('L', (W * s, H * s), 0)
    d = ImageDraw.Draw(big)
    for i, g in items:
        draw_geom(d, g, i, s)
    return big.resize((W, H), Image.NEAREST)


def simplify(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Дуглас-Пёкер."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1e-9
    best, bi = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / n
        if d > best:
            best, bi = d, i
    if best <= eps:
        return [pts[0], pts[-1]]
    return simplify(pts[:bi + 1], eps)[:-1] + simplify(pts[bi:], eps)


def poly_centroid(pts) -> tuple[float, float]:
    a = cx = cy = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    a *= 0.5
    return (cx / (6 * a), cy / (6 * a)) if a else pts[0]


# ───────────────────────────── данные ─────────────────────────────

def load(data: Path, name: str) -> list[dict]:
    return json.loads((data / f'ne_10m_{name}.geojson').read_text('utf8'))['features']


NEIGHBORS = {  # ISO_A2 → (польское название, anchor lat/lon подписи — внутри страны, у границы с Польшей)
    'DE': ('Niemcy', 52.6, 13.35),
    'CZ': ('Czechy', 49.6, 15.1),
    'SK': ('Słowacja', 48.8, 19.7),
    'UA': ('Ukraina', 50.2, 24.6),
    'BY': ('Białoruś', 52.9, 25.05),
    'LT': ('Litwa', 54.45, 23.9),
    'RU': ('Rosja (obwód królewiecki)', 54.7, 21.4),
}

RIVERS = {  # английское/местное имя в Natural Earth → (польское, главная?)
    'Vistula': ('Wisła', True), 'Oder': ('Odra', True), 'Warta': ('Warta', False), 'Zakhidnyy Buh': ('Bug', False),
    'Bug': ('Bug', False), 'San': ('San', False), 'Narew': ('Narew', False), 'Noteć': ('Noteć', False),
    'Pilica': ('Pilica', False), 'Wieprz': ('Wieprz', False), 'Bóbr': ('Bóbr', False), 'Nysa Kłodzka': ('Nysa Kłodzka', False),
    'Luzicka Nisa': ('Nysa Łużycka', False), 'Prosna': ('Prosna', False), 'Dunajec': ('Dunajec', False),
    'Drwęca': ('Drwęca', False), 'Łyna': ('Łyna', False), 'Bzura': ('Bzura', False), 'Wkra': ('Wkra', False),
    'Gwda': ('Gwda', False),
}

VOIVODESHIPS = {  # name_pl Natural Earth → id (kod TERYT, 2 цифры) и название по-польски без «województwo»
    'województwo dolnośląskie': ('02', 'dolnośląskie'), 'województwo kujawsko-pomorskie': ('04', 'kujawsko-pomorskie'),
    'województwo lubelskie': ('06', 'lubelskie'), 'województwo lubuskie': ('08', 'lubuskie'),
    'województwo łódzkie': ('10', 'łódzkie'), 'województwo małopolskie': ('12', 'małopolskie'),
    'województwo mazowieckie': ('14', 'mazowieckie'), 'województwo opolskie': ('16', 'opolskie'),
    'województwo podkarpackie': ('18', 'podkarpackie'), 'województwo podlaskie': ('20', 'podlaskie'),
    'województwo pomorskie': ('22', 'pomorskie'), 'województwo śląskie': ('24', 'śląskie'),
    'województwo świętokrzyskie': ('26', 'świętokrzyskie'), 'województwo warmińsko-mazurskie': ('28', 'warmińsko-mazurskie'),
    'województwo wielkopolskie': ('30', 'wielkopolskie'), 'województwo zachodniopomorskie': ('32', 'zachodniopomorskie'),
}

# 26 городов по умолчанию (до data/v2/geografia.json): (id, польское название, NE-имя | None, lat, lon, столица?)
# Координаты NE, где город есть в populated_places; для остальных (Toruń, Radom, Częstochowa, Sopot, Zakopane, Płock)
# берутся общеизвестные координаты центра города.
DEFAULT_CITIES = [
    ('warszawa', 'Warszawa', 'Warsaw', 52.2297, 21.0122, True),
    ('krakow', 'Kraków', 'Kraków', 50.0647, 19.9450, False),
    ('lodz', 'Łódź', 'Łódź', 51.7592, 19.4560, False),
    ('wroclaw', 'Wrocław', 'Wrocław', 51.1079, 17.0385, False),
    ('poznan', 'Poznań', 'Poznań', 52.4064, 16.9252, False),
    ('gdansk', 'Gdańsk', 'Gdańsk', 54.3520, 18.6466, False),
    ('szczecin', 'Szczecin', 'Szczecin', 53.4285, 14.5528, False),
    ('bydgoszcz', 'Bydgoszcz', 'Bydgoszcz', 53.1235, 18.0084, False),
    ('lublin', 'Lublin', 'Lublin', 51.2465, 22.5684, False),
    ('bialystok', 'Białystok', 'Białystok', 53.1325, 23.1688, False),
    ('katowice', 'Katowice', 'Katowice', 50.2649, 19.0238, False),
    ('gdynia', 'Gdynia', 'Gdynia', 54.5189, 18.5305, False),
    ('czestochowa', 'Częstochowa', None, 50.8118, 19.1203, False),
    ('radom', 'Radom', None, 51.4027, 21.1471, False),
    ('torun', 'Toruń', None, 53.0138, 18.5984, False),
    ('rzeszow', 'Rzeszów', 'Rzeszów', 50.0412, 21.9991, False),
    ('kielce', 'Kielce', 'Kielce', 50.8661, 20.6286, False),
    ('olsztyn', 'Olsztyn', 'Olsztyn', 53.7784, 20.4801, False),
    ('opole', 'Opole', 'Opole', 50.6751, 17.9213, False),
    ('zielona-gora', 'Zielona Góra', 'Zielona Góra', 51.9356, 15.5062, False),
    ('gliwice', 'Gliwice', 'Gliwice', 50.2945, 18.6714, False),
    ('elblag', 'Elbląg', 'Elbląg', 54.1522, 19.4088, False),
    ('koszalin', 'Koszalin', 'Koszalin', 54.1943, 16.1722, False),
    ('sopot', 'Sopot', None, 54.4418, 18.5601, False),
    ('zakopane', 'Zakopane', None, 49.2992, 19.9496, False),
    ('plock', 'Płock', None, 52.5463, 19.7065, False),
]


def city_list(cities_path: Path | None) -> list[dict]:
    if cities_path and cities_path.exists():
        raw = json.loads(cities_path.read_text('utf8'))
        found: list[dict] = []

        def walk(o):
            if isinstance(o, dict):
                lat = o.get('lat', o.get('latitude'))
                lon = o.get('lon', o.get('lng', o.get('longitude')))
                if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                    found.append({'id': str(o.get('id', o.get('name', len(found)))), 'name': str(o.get('name', o.get('pl', o.get('id', '')))),
                                  'lat': float(lat), 'lon': float(lon), 'capital': bool(o.get('capital', False)), 'src': 'geografia.json'})
                    return
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(raw)
        if found:
            return found
    return [{'id': i, 'name': n, 'lat': la, 'lon': lo, 'capital': cap, 'src': 'default'} for i, n, _ne, la, lo, cap in DEFAULT_CITIES]


# ───────────────────────────── рисование ─────────────────────────────

def bres(d: ImageDraw.ImageDraw, pts, color) -> None:
    d.line([(round(x), round(y)) for x, y in pts], fill=color, width=1)


def value_noise(seed: int, cell: int):
    """Гладкий шум значений 0..1 на сетке W×H (билинейно между узлами решётки cell px)."""
    r = random.Random(seed)
    gw, gh = W // cell + 3, H // cell + 3
    g = [[r.random() for _ in range(gw)] for _ in range(gh)]

    def f(x, y):
        fx, fy = x / cell, y / cell
        ix, iy = int(fx), int(fy)
        tx, ty = fx - ix, fy - iy
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        a = g[iy][ix] * (1 - tx) + g[iy][ix + 1] * tx
        b = g[iy + 1][ix] * (1 - tx) + g[iy + 1][ix + 1] * tx
        return a * (1 - ty) + b * ty
    return f


def build(data: Path, cities_path: Path | None) -> None:
    pal = load_palette()
    C = {n: pal.names[n] for n in pal.names}

    def col(name: str):
        return C[name]

    countries = load(data, 'admin_0_countries')
    by_iso = {}
    for f in countries:
        iso = f['properties'].get('ISO_A2_EH') or f['properties'].get('ISO_A2')
        by_iso.setdefault(iso, []).append(f['geometry'])
    admin1 = [f for f in load(data, 'admin_1_states_provinces') if f['properties'].get('admin') == 'Poland']
    pl_geom = by_iso['PL'][0]

    # маски
    all_land = mask_of([f['geometry'] for f in countries])
    pl_mask = mask_of([pl_geom])
    pl_px = pl_mask.load()
    land_px = all_land.load()

    # воеводства
    ids = id_map([(i + 1, f['geometry']) for i, f in enumerate(admin1)])
    ids_px = ids.load()
    for _ in range(4):  # закрыть щели между воеводствами и береговой линией
        nxt = ids.copy()
        npx = nxt.load()
        for y in range(H):
            for x in range(W):
                if pl_px[x, y] and not ids_px[x, y]:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        xx, yy = x + dx, y + dy
                        if 0 <= xx < W and 0 <= yy < H and ids_px[xx, yy]:
                            npx[x, y] = ids_px[xx, yy]
                            break
        ids, ids_px = nxt, nxt.load()

    # страны-соседи (для границ)
    cid = id_map([(i + 2, g) for i, iso in enumerate(sorted(by_iso)) if iso != 'PL' for g in by_iso[iso]])
    cid_px = cid.load()

    # дистанция до суши в море (до 3 px)
    near1 = all_land.filter(ImageFilter.MaxFilter(3)).load()
    near2 = all_land.filter(ImageFilter.MaxFilter(5)).load()
    near3 = all_land.filter(ImageFilter.MaxFilter(7)).load()

    # озёра (крупные)
    lakes = [f['geometry'] for f in load(data, 'lakes')
             if f['geometry'] and any(near(p[0], 0.0) for p in rings(f['geometry']))]
    lake_mask = mask_of(lakes, SS)
    lake_px = lake_mask.load()

    img = Image.new('RGB', (W, H), col('water.2'))
    px = img.load()
    rng = random.Random(1969)

    # море: мелководье светлее у берега, редкие блики волн
    for y in range(H):
        for x in range(W):
            if land_px[x, y]:
                continue
            if near1[x, y]:
                px[x, y] = col('water.4') if (x + y) % 2 == 0 else col('water.3')
            elif near2[x, y]:
                px[x, y] = col('water.3')
            elif near3[x, y] and (x + y) % 2 == 0:
                px[x, y] = col('water.3')
            elif (x * 7 + y * 13) % 41 == 0 and not near3[x, y]:
                px[x, y] = col('water.3')
            elif (x * 5 + y * 11) % 53 == 0 and not near3[x, y]:
                px[x, y] = col('water.1')

    # суша: пятна плотности через шум, шахматная растушёвка
    nz = value_noise(7, 14)
    nz2 = value_noise(11, 5)
    for y in range(H):
        for x in range(W):
            if not land_px[x, y]:
                continue
            n, m = nz(x, y), nz2(x, y)
            chk = (x + y) % 2 == 0
            if pl_px[x, y]:
                if n > 0.70 and chk:
                    c = 'grass.3'
                elif n < 0.24 and chk:
                    c = 'grass.1'
                elif m > 0.84 and (x * 3 + y) % 5 == 0:
                    c = 'grass.3'
                else:
                    c = 'grass.2'
            else:
                if n > 0.66 and chk:
                    c = 'leaf.4'
                elif m > 0.85 and (x * 3 + y) % 5 == 0:
                    c = 'stone.3'
                else:
                    c = 'stone.2'
            px[x, y] = col(c)

    # горы: зоны подъёма (lat, lon) как капсулы
    def cap(a, b, r):
        return (project(a[1], a[0]), project(b[1], b[0]), r * K)
    zones = {
        'tatry': [cap((49.20, 19.70), (49.23, 20.20), 0.12)],
        'karpaty': [cap((49.62, 18.85), (49.42, 20.45), 0.32), cap((49.42, 20.45), (49.20, 22.00), 0.30), cap((49.20, 22.00), (49.12, 22.80), 0.30)],
        'sudety': [cap((50.88, 15.35), (50.62, 16.20), 0.28), cap((50.62, 16.20), (50.30, 16.95), 0.26)],
        'swietokrzyskie': [cap((50.90, 20.35), (50.82, 21.00), 0.20)],
    }

    def in_cap(x, y, c):
        (x1, y1), (x2, y2), r = c
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) if l2 else 0
        return (x1 + t * dx - x) ** 2 + (y1 + t * dy - y) ** 2 <= r * r

    zone_of = {}
    for name, caps in zones.items():
        for y in range(H):
            for x in range(W):
                if pl_px[x, y] and any(in_cap(x + .5, y + .5, c) for c in caps):
                    zone_of.setdefault((x, y), name)
    for (x, y), name in zone_of.items():  # предгорная дымка
        if (x + y) % 3 == 0:
            px[x, y] = col('dirt.3') if name != 'swietokrzyskie' else col('leaf2.3')

    # границы воеводств (тонко, пунктир) и государственная граница
    for y in range(H):
        for x in range(W):
            if not pl_px[x, y] or (x + y) % 4 == 0:
                continue
            me = ids_px[x, y]
            for dx, dy in ((1, 0), (0, 1)):
                xx, yy = x + dx, y + dy
                if xx < W and yy < H and pl_px[xx, yy] and ids_px[xx, yy] != me:
                    px[x, y] = col('leaf.1')
    for y in range(H):
        for x in range(W):
            if not land_px[x, y]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < W and 0 <= yy < H):
                    continue
                if pl_px[x, y] and land_px[xx, yy] and not pl_px[xx, yy]:
                    px[x, y] = col('wood_dark.1')   # государственная граница: на польской стороне
                elif not pl_px[x, y] and land_px[xx, yy] and cid_px[xx, yy] != cid_px[x, y] and not pl_px[xx, yy] and (x + y) % 3:
                    px[x, y] = col('stone.1')       # граница соседей между собой (пунктир)

    # реки (поверх суши, до берега)
    river_defs = []
    for fn in ('rivers_europe', 'rivers_lake_centerlines'):
        for f in load(data, fn):
            nm = f['properties'].get('name')
            if nm in RIVERS and f['geometry']:
                river_defs.append((nm, f['geometry']))
    rd = ImageDraw.Draw(img)
    pl_near = pl_mask.filter(ImageFilter.MaxFilter(9)).load()
    river_px: dict[str, list[list[tuple[float, float]]]] = {}
    for nm, geom in river_defs:
        pl_name, main = RIVERS[nm]
        for ln in lines(geom):
            if not near(ln, 0.0):
                continue
            pts = [project(*p[:2]) for p in ln]
            river_px.setdefault(pl_name, []).append(pts)
            seg = [(round(x), round(y)) for x, y in pts]
            for a, b in zip(seg, seg[1:]):
                if not (0 <= a[0] < W and 0 <= a[1] < H and pl_near[a[0], a[1]]):
                    continue
                rd.line([a, b], fill=col('water.1') if not main else col('water.0'), width=1)
                if main:
                    # главные реки: вторая полоса светлее, чтобы читались толще
                    rd.line([(a[0] + 1, a[1]), (b[0] + 1, b[1])], fill=col('water.2'), width=1)
    # реки не в море: вернуть море на место
    for y in range(H):
        for x in range(W):
            if not land_px[x, y] and px[x, y] in (col('water.0'), col('water.1')) and near1[x, y] == 0:
                px[x, y] = col('water.2')
    # озёра
    for y in range(H):
        for x in range(W):
            if lake_px[x, y] and pl_px[x, y]:
                px[x, y] = col('water.2')
    for y in range(H):
        for x in range(W):
            if lake_px[x, y] and pl_px[x, y]:
                for dx, dy in ((1, 0), (0, 1)):
                    xx, yy = x + dx, y + dy
                    if xx < W and yy < H and not lake_px[xx, yy]:
                        px[x, y] = col('water.1')

    # береговая линия: тёмная кромка на суше
    for y in range(H):
        for x in range(W):
            if not land_px[x, y]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < W and 0 <= yy < H and not land_px[xx, yy] and not lake_px[xx, yy]:
                    px[x, y] = col('leaf.0') if pl_px[x, y] else col('stone.0')
                    break

    # горы: пики
    def peak(cx, cy, big=False, snow=False):
        if big:
            shape = ['....o....', '...oLo...', '..oLLDo..', '.oLLLDDo.', 'oLLLLDDDo']
            body = {'L': 'stone.3', 'D': 'stone.1', 'o': 'stone.0', 's': 'white'}
            if snow:
                shape = ['....o....', '...osDo..', '..osDDo..', '.oLLLDDo.', 'oLLLLDDDo']
        else:
            shape = ['...o...', '..oLo..', '.oLLDo.', 'oLLLDDo']
            body = {'L': 'stone.3', 'D': 'stone.1', 'o': 'stone.0', 's': 'white'}
        h = len(shape)
        w = len(shape[0])
        for j, row in enumerate(shape):
            for i, ch in enumerate(row):
                if ch == '.':
                    continue
                X, Y = cx - w // 2 + i, cy - h + 1 + j
                if 0 <= X < W and 0 <= Y < H and pl_px[X, Y]:
                    px[X, Y] = col(body[ch])

    def hill(cx, cy):
        for dx, dy, n in ((-1, 0, 'leaf.1'), (0, 0, 'leaf2.3'), (1, 0, 'leaf.1'), (0, -1, 'leaf.1')):
            X, Y = cx + dx, cy + dy
            if 0 <= X < W and 0 <= Y < H and pl_px[X, Y]:
                px[X, Y] = col(n)

    placed: list[tuple[int, int]] = []
    for name, spacing in (('tatry', 5), ('karpaty', 6), ('sudety', 6), ('swietokrzyskie', 5)):
        pts = sorted([p for p, z in zone_of.items() if z == name], key=lambda p: (p[1], p[0]))
        r2 = random.Random(zlib.crc32(name.encode()))
        r2.shuffle(pts)
        for x, y in pts:
            if any(abs(x - a) < spacing and abs(y - b) < spacing * 0.8 for a, b in placed):
                continue
            placed.append((x, y))
        for x, y in [p for p in placed if zone_of.get(p) == name]:
            if name == 'tatry':
                peak(x, y + 3, True, True)
            elif name == 'swietokrzyskie':
                hill(x, y)
            else:
                peak(x, y + 2)
    # отрисовать порядком снизу вверх для перекрытий уже выполнено случайным порядком; ок

    # ── метки ──
    def lab(lat, lon):
        x, y = project(lon, lat)
        return [round(x), round(y)]

    nb = {iso: {'id': iso, 'name': nm, 'at': lab(la, lo)} for iso, (nm, la, lo) in NEIGHBORS.items()}
    sea = {'id': 'baltic', 'name': 'Bałtyk', 'at': lab(55.1, 18.0)}
    seas_extra = [{'id': 'gdansk-bay', 'name': 'Zatoka Gdańska', 'at': lab(54.62, 18.95)}]
    rivers_out = []
    for pl_name in ('Wisła', 'Odra', 'Warta', 'Bug', 'San', 'Narew', 'Noteć', 'Pilica'):
        segs = river_px.get(pl_name)
        if not segs:
            continue
        pts = [p for s in segs for p in s if 0 <= p[0] < W and 0 <= p[1] < H and pl_px[int(p[0]), int(p[1])]]
        if not pts:
            continue
        pts.sort(key=lambda p: p[1])
        mid = pts[len(pts) // 2]
        rivers_out.append({'id': pl_name, 'name': pl_name, 'at': [round(mid[0]), round(mid[1])],
                           'path': [[round(x), round(y)] for x, y in simplify(sorted([p for s in segs for p in s], key=lambda p: p[1]), 1.2)[:60]]})
    mountains = [
        {'id': 'tatry', 'name': 'Tatry', 'at': lab(49.22, 19.95)},
        {'id': 'sudety', 'name': 'Sudety', 'at': lab(50.65, 16.0)},
        {'id': 'beskidy', 'name': 'Beskidy', 'at': lab(49.55, 19.4)},
        {'id': 'bieszczady', 'name': 'Bieszczady', 'at': lab(49.15, 22.4)},
        {'id': 'swietokrzyskie', 'name': 'Góry Świętokrzyskie', 'at': lab(50.88, 20.7)},
    ]
    lake_labels = [
        {'id': 'mamry', 'name': 'Mamry', 'at': lab(54.12, 21.65)},
        {'id': 'sniardwy', 'name': 'Śniardwy', 'at': lab(53.75, 21.7)},
    ]

    vois = []
    for i, f in enumerate(admin1):
        nm = f['properties'].get('name_pl')
        vid, short = VOIVODESHIPS[nm]
        polys = []
        for poly in rings(f['geometry']):
            ring = [project(*p[:2]) for p in poly[0]]
            polys.append([[round(x, 1), round(y, 1)] for x, y in simplify(ring, 0.6)])
        biggest = max(polys, key=lambda r: len(r))
        cx, cy = poly_centroid([(x, y) for x, y in biggest])
        vois.append({'id': vid, 'name': short, 'at': [round(cx), round(cy)], 'polygon': polys})
    vois.sort(key=lambda v: v['id'])

    # города
    cities = []
    for c in city_list(cities_path):
        x, y = project(c['lon'], c['lat'])
        cities.append({**c, 'x': round(x, 1), 'y': round(y, 1)})

    # Контур Польши для настенной карты (простой, 0.015°)
    outline = [(p[0], p[1]) for p in pl_geom['coordinates'][0]]
    k = max(range(len(outline)), key=lambda i: outline[i][0])  # кольцо замкнуто: режем по самой восточной точке
    outline = outline[:-1] if outline[0] == outline[-1] else outline
    outline = outline[k:] + outline[:k]
    half = len(outline) // 2
    outline = simplify(outline[:half + 1], 0.02)[:-1] + simplify(outline[half:] + outline[:1], 0.02)[:-1]
    GEO.mkdir(parents=True, exist_ok=True)
    (GEO / 'poland_outline.json').write_text(json.dumps({
        '_': 'Контур Польши (lon, lat), упрощённый из Natural Earth 1:10m admin_0 (public domain) tools/art_map.py; рисует art_world2.py',
        'ring': [[round(a, 3), round(b, 3)] for a, b in outline]}, ensure_ascii=False) + '\n', 'utf8')

    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / 'poland.png', optimize=True)

    # слой городов: точки 5×5 серые, столица звёздой; прозрачный фон (альфа 0/255)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    lp = layer.load()
    dot = ['.ooo.', 'oggGo', 'oGGGo', 'oGGgo', '.ooo.']
    star = ['..o..', 'ooGoo', '.oGo.', 'oGGGo', 'oo.oo']
    for c in cities:
        shape = star if c['capital'] else dot
        for j, row in enumerate(shape):
            for i, ch in enumerate(row):
                if ch == '.':
                    continue
                X, Y = int(round(c['x'])) - 2 + i, int(round(c['y'])) - 2 + j
                if 0 <= X < W and 0 <= Y < H:
                    n = {'o': 'outline', 'g': 'stone.4', 'G': 'stone.3'}[ch]
                    lp[X, Y] = (*col(n), 255)
    layer.save(OUT / 'poland_cities.png', optimize=True)

    meta = {
        '_': 'Карта Польши для Geografia. Данные: Natural Earth 1:10m (public domain), tools/art_map.py. Подписи рисует DOM: координаты в px картинки poland.png.',
        'image': 'poland.png', 'citiesImage': 'poland_cities.png', 'size': [W, H],
        'projection': {
            'type': 'equirectangular-cos', 'lat0': 52.0, 'cosLat0': round(COS, 6), 'lon0': LON0, 'latTop': LAT_TOP, 'k': K,
            'x': 'x = (lon - lon0) * cosLat0 * k', 'y': 'y = (latTop - lat) * k',
            'inverse': 'lon = x / (cosLat0 * k) + lon0; lat = latTop - y / k',
        },
        'bbox': {'lonMin': round(unproject(0, 0)[0], 4), 'lonMax': round(unproject(W, 0)[0], 4),
                 'latMax': LAT_TOP, 'latMin': round(unproject(0, H)[1], 4)},
        'poland': {'lonMin': 14.12, 'lonMax': 24.15, 'latMin': 49.0, 'latMax': 54.84},
        'cities': cities,
        'voivodeships': vois,
        'neighbors': list(nb.values()),
        'seas': [sea] + seas_extra,
        'rivers': rivers_out,
        'mountains': mountains,
        'lakes': lake_labels,
        'compass': {'at': [W - 28, 30], 'size': 32},
        'source': 'Natural Earth 1:10m (public domain): admin_0_countries, admin_1_states_provinces, rivers_lake_centerlines, rivers_europe, lakes',
    }
    (OUT / 'poland.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + '\n', 'utf8')
    print(f'art_map: poland.png {W}×{H}, {len(cities)} городов, {len(vois)} воеводств, {len(rivers_out)} рек (подписи)')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', required=True, help='папка с ne_10m_*.geojson (Natural Earth)')
    ap.add_argument('--cities', help='data/v2/geografia.json: города с lat/lon (иначе 26 по умолчанию)')
    a = ap.parse_args()
    build(Path(a.data), Path(a.cities) if a.cities else None)
    return 0


if __name__ == '__main__':
    sys.exit(main())
