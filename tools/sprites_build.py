#!/usr/bin/env python3
"""Арт-конвейер (ТЗ §8): sprite-as-data и листы паков → атласы в public/atlas.

    python3 tools/sprites_build.py            # собрать public/atlas/*
    python3 tools/sprites_build.py --check    # CI: палитра, альфа 0/255, кратность 16, атлас не устарел
    python3 tools/sprites_build.py --quantize <png> [--out <png>]   # привести чужой лист к палитре

Входы:
  art/palette.json              базовые цвета: имя → #rrggbb
  art/materials.json            материалы: имя → средний тон; рампа (линия, тень, основной, свет, блик, контур) считается
                                tools/art_ramp.py (sdvRamp с дашборда жаб) и входит в палитру как `<материал>.0…4`, `.o`
  art/sprites/*.sprite.json     sprite-as-data: keys (символ → имя цвета | null), frames, anims.
                                Рисует tools/gen_sprites.py (npm run art), JSON можно править руками
                                (кадр может быть ссылкой: число i или {"flip": i})
  art/tilesets/<id>.json        тайлсет локаций: имя тайла → кадр спрайта / auto16

Выходы (руками не править, AGENTS.md):
  public/atlas/custom.png + custom.json      Phaser atlas JSON hash, кадры `<id>/<n>`, padding 1, extrude 1
  public/atlas/sprites.json                  id → размер, якорь, кадры, анимации
  public/atlas/<tileset>.png + <tileset>.json   сетка 16×16, margin 1, spacing 2 (extrude 1)
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art_ramp import load_materials, ramp_colors  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art'
OUT = ROOT / 'public' / 'atlas'
T = 16  # тайл и кратность кадров
PAD = 1  # extrude вокруг кадра
LATE_PREFIXES = ('w2_', 'geo_', 't2_')  # спрайты v2: порядок упаковки после всех прочих
LAST_PREFIXES = ('plant_',)  # «пёстрый огород» (кусты, плоды, мини-иконки): после v2, координаты прежних кадров не двигаются
FINAL_PREFIXES = ('beaver',)  # бобёр, хатка и пруд: после всего, координаты прежних кадров не двигаются

RGBA = tuple[int, int, int, int]


class BuildError(Exception):
    pass


# ───────────────────────────── палитра ─────────────────────────────

def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip('#')
    if len(h) != 6:
        raise BuildError(f'цвет "{h}": нужен #rrggbb')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_to_hex(c: tuple[int, ...]) -> str:
    return '#%02x%02x%02x' % (c[0], c[1], c[2])


def _lin(v: float) -> float:
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def rgb_to_lab(c: tuple[int, ...]) -> tuple[float, float, float]:
    r, g, b = _lin(c[0]), _lin(c[1]), _lin(c[2])
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e(a: tuple[int, ...], b: tuple[int, ...]) -> float:
    la, lb = rgb_to_lab(a), rgb_to_lab(b)
    return math.dist(la, lb)


@dataclass
class Palette:
    names: dict[str, tuple[int, int, int]]
    labs: list[tuple[tuple[int, int, int], tuple[float, float, float]]] = field(default_factory=list)

    def __post_init__(self) -> None:
        seen = set()
        for rgb in self.names.values():
            if rgb not in seen:
                seen.add(rgb)
                self.labs.append((rgb, rgb_to_lab(rgb)))
        self.rgbs = seen

    def nearest(self, c: tuple[int, ...]) -> tuple[int, int, int]:
        lab = rgb_to_lab(c)
        return min(self.labs, key=lambda e: math.dist(e[1], lab))[0]


def load_palette(path: Path | None = None) -> Palette:
    path = path or ART / 'palette.json'
    data = json.loads(path.read_text('utf8'))
    colors = dict(data['colors'])
    for name, c in ramp_colors(load_materials()).items():
        if name in colors:
            raise BuildError(f'цвет "{name}" есть и в palette.json, и среди рамп материалов')
        colors[name] = c
    return Palette({k: hex_to_rgb(v) for k, v in colors.items()})


def quantize(img: Image.Image, pal: Palette) -> tuple[Image.Image, int]:
    """Альфа → 0/255 (порог 128), цвет → ближайший из палитры (ΔE в Lab). Возвращает число заменённых пикселей."""
    img = img.convert('RGBA')
    px = img.load()
    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    changed = 0
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a < 128:
                if (r, g, b, a) != (0, 0, 0, 0):
                    px[x, y] = (0, 0, 0, 0)
                    if a:
                        changed += 1
                continue
            rgb = (r, g, b)
            if rgb not in pal.rgbs:
                if rgb not in cache:
                    cache[rgb] = pal.nearest(rgb)
                rgb = cache[rgb]
                changed += 1
            elif a != 255:
                changed += 1
            px[x, y] = (*rgb, 255)
    return img, changed


# ───────────────────────────── sprite-as-data ─────────────────────────────

@dataclass
class SpriteDef:
    id: str
    size: tuple[int, int]
    anchor: tuple[int, int]
    frames: list[Image.Image]
    anims: dict[str, list[int]]
    source: str


def load_sprite(path: Path, pal: Palette) -> SpriteDef:
    rel = path.relative_to(ROOT).as_posix()
    d = json.loads(path.read_text('utf8'))
    for k in ('id', 'size', 'keys', 'frames'):
        if k not in d:
            raise BuildError(f'{rel}: нет поля "{k}"')
    w, h = d['size']
    if w % T or h % T:
        raise BuildError(f'{rel}: размер {w}×{h} не кратен {T}')
    keys: dict[str, str | None] = d['keys']
    colors: dict[str, RGBA] = {}
    for ch, name in keys.items():
        if len(ch) != 1:
            raise BuildError(f'{rel}: ключ "{ch}" должен быть одним символом')
        if name is None:
            colors[ch] = (0, 0, 0, 0)
            continue
        if name.startswith('#'):
            raise BuildError(f'{rel}: hex "{name}" в спрайте запрещён, бери имя из art/palette.json')
        if name not in pal.names:
            raise BuildError(f'{rel}: цвета "{name}" нет в art/palette.json')
        colors[ch] = (*pal.names[name], 255)
    frames: list[Image.Image] = []
    for fi, rows in enumerate(d['frames']):
        # Ссылка на кадр (P-03): число = копия кадра i, {"flip": i} = зеркало кадра i по горизонтали (i < fi).
        if isinstance(rows, int) or isinstance(rows, dict):
            ref = rows if isinstance(rows, int) else rows.get('flip')
            if not isinstance(ref, int) or not 0 <= ref < fi or (isinstance(rows, dict) and set(rows) != {'flip'}):
                raise BuildError(f'{rel}: кадр {fi}: ссылка {json.dumps(rows)} должна указывать на кадр раньше {fi} (число или {{"flip": i}})')
            src = frames[ref]
            frames.append(src.copy() if isinstance(rows, int) else src.transpose(Image.Transpose.FLIP_LEFT_RIGHT))
            continue
        if len(rows) != h:
            raise BuildError(f'{rel}: кадр {fi}: строк {len(rows)}, а size[1] = {h}')
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        px = img.load()
        for y, row in enumerate(rows):
            if len(row) != w:
                raise BuildError(f'{rel}: кадр {fi}, строка {y}: длина {len(row)}, а size[0] = {w}')
            for x, ch in enumerate(row):
                if ch not in colors:
                    raise BuildError(f'{rel}: кадр {fi}, строка {y}: символа "{ch}" нет в keys')
                px[x, y] = colors[ch]
        frames.append(img)
    anims = d.get('anims', {})
    for name, seq in anims.items():
        for i in seq:
            if not 0 <= i < len(frames):
                raise BuildError(f'{rel}: анимация {name}: нет кадра {i}')
    anchor = tuple(d.get('anchor', [w // 2, h - 1]))
    return SpriteDef(d['id'], (w, h), anchor, frames, anims, rel)


def load_sprites(pal: Palette) -> tuple[dict[str, SpriteDef], list[str]]:
    sprites: dict[str, SpriteDef] = {}
    for p in sorted((ART / 'sprites').glob('*.sprite.json')):
        s = load_sprite(p, pal)
        if s.id in sprites:
            raise BuildError(f'{s.source}: дубль id "{s.id}" (уже в {sprites[s.id].source})')
        sprites[s.id] = s
    return sprites, []


# ───────────────────────────── упаковка ─────────────────────────────

def extrude_paste(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    """Кадр в (x, y) и края, продлённые на PAD пикселей (против швов при масштабе)."""
    w, h = src.size
    dst.paste(src, (x, y))
    dst.paste(src.crop((0, 0, w, 1)), (x, y - 1))
    dst.paste(src.crop((0, h - 1, w, h)), (x, y + h))
    dst.paste(src.crop((0, 0, 1, h)), (x - 1, y))
    dst.paste(src.crop((w - 1, 0, w, h)), (x + w, y))
    for cx, cy, dx, dy in ((0, 0, -1, -1), (w - 1, 0, w, -1), (0, h - 1, -1, h), (w - 1, h - 1, w, h)):
        dst.putpixel((x + dx, y + dy), src.getpixel((cx, cy)))


def pack_custom(sprites: dict[str, SpriteDef]) -> tuple[Image.Image, dict, dict]:
    """Полочная упаковка всех кадров (по убыванию высоты). Возвращает PNG, atlas JSON hash и sprites.json."""
    items = [(s.id, i, f) for s in sprites.values() for i, f in enumerate(s.frames)]
    # Новые спрайты v2 пакуются после старых: координаты старых кадров не двигаются (ui/stageIcon.ts хранит их числами).
    late = lambda sid: 3 if sid.startswith(FINAL_PREFIXES) else 2 if sid.startswith(LAST_PREFIXES) else int(sid.startswith(LATE_PREFIXES))  # noqa: E731
    items.sort(key=lambda t: (late(t[0]), -t[2].height, t[0], t[1]))
    width = 256
    x = y = 0
    shelf = 0
    place: list[tuple[str, int, Image.Image, int, int]] = []
    for sid, i, f in items:
        cw, ch = f.width + 2 * PAD, f.height + 2 * PAD
        if x + cw > width:
            x, y, shelf = 0, y + shelf, 0
        place.append((sid, i, f, x + PAD, y + PAD))
        x += cw
        shelf = max(shelf, ch)
    height = y + shelf
    height = ((height + 15) // 16) * 16 or 16
    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    frames: dict[str, dict] = {}
    for sid, i, f, fx, fy in place:
        extrude_paste(img, f, fx, fy)
        frames[f'{sid}/{i}'] = {
            'frame': {'x': fx, 'y': fy, 'w': f.width, 'h': f.height},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': f.width, 'h': f.height},
            'sourceSize': {'w': f.width, 'h': f.height},
        }
    atlas = {
        'frames': dict(sorted(frames.items())),
        'meta': {'app': 'tools/sprites_build.py', 'image': 'custom.png', 'format': 'RGBA8888',
                 'size': {'w': width, 'h': height}, 'scale': '1'},
    }
    index = {
        s.id: {
            'size': list(s.size),
            'anchor': list(s.anchor),
            'frames': [f'{s.id}/{i}' for i in range(len(s.frames))],
            'anims': {k: [f'{s.id}/{i}' for i in v] for k, v in s.anims.items()},
        }
        for s in sorted(sprites.values(), key=lambda s: s.id)
    }
    return img, atlas, index


# ───────────────────────────── тайлсет ─────────────────────────────

# Блок NA: 3×3 (углы, края, центр) + вертикальная полоска справа + горизонтальная снизу + одиночный.
# Маска соседей того же символа: N=1, E=2, S=4, W=8 → смещение клетки внутри блока.
AUTO16_OFFSETS: list[tuple[int, int]] = [
    (3, 3),  # 0  один
    (3, 2),  # 1  N        низ вертикальной полоски
    (0, 3),  # 2  E        левый край горизонтальной полоски
    (0, 2),  # 3  N E      левый нижний угол
    (3, 0),  # 4  S        верх вертикальной полоски
    (3, 1),  # 5  N S      середина вертикальной
    (0, 0),  # 6  E S      левый верхний угол
    (0, 1),  # 7  N E S    левый край
    (2, 3),  # 8  W        правый край горизонтальной
    (2, 2),  # 9  N W      правый нижний угол
    (1, 3),  # 10 E W      середина горизонтальной
    (1, 2),  # 11 N E W    нижний край
    (2, 0),  # 12 S W      правый верхний угол
    (2, 1),  # 13 N S W    правый край
    (1, 0),  # 14 E S W    верхний край
    (1, 1),  # 15 все      центр
]
# Блок 2×2 (кадры 0..3 = NW, NE, SW, SE): маска → кадр; прочие маски → центр крыши (0).
CORNERS = {6: 0, 12: 1, 3: 2, 9: 3}


def build_tileset(tsid: str, sprites: dict[str, SpriteDef], pal: Palette) -> tuple[Image.Image, dict, list[str]]:
    path = ART / 'tilesets' / f'{tsid}.json'
    rel = path.relative_to(ROOT).as_posix()
    d = json.loads(path.read_text('utf8'))
    sheets: dict[str, Image.Image] = {}
    notes: list[str] = []
    for key, src in d.get('sources', {}).items():
        p = ART / src
        if not p.exists():
            raise BuildError(f'{rel}: источник "{key}": нет файла art/{src}')
        img, changed = quantize(Image.open(p), pal)
        if changed:
            notes.append(f'{tsid}: {key}: {changed} px листа приведено к палитре')
        sheets[key] = img

    cells: list[Image.Image] = []
    seen: dict[bytes, int] = {}

    under_img: Image.Image | None = None

    def add(img: Image.Image) -> int:
        if under_img is not None:
            base = under_img.copy()
            base.alpha_composite(img)
            img = base
        k = img.tobytes()
        if k not in seen:
            seen[k] = len(cells)
            cells.append(img)
        return seen[k]

    def cell(ref, where: str) -> Image.Image:
        if isinstance(ref, dict):
            sp = sprites.get(ref['sprite'])
            if not sp:
                raise BuildError(f'{rel}: {where}: нет спрайта "{ref["sprite"]}"')
            fr = ref.get('frame', 0)
            if not 0 <= fr < len(sp.frames) or sp.size != (T, T):
                raise BuildError(f'{rel}: {where}: кадр {fr} спрайта "{sp.id}" не 16×16 или не существует')
            return sp.frames[fr]
        key, cx, cy = ref
        sheet = sheets.get(key)
        if sheet is None:
            raise BuildError(f'{rel}: {where}: нет источника "{key}"')
        if (cx + 1) * T > sheet.width or (cy + 1) * T > sheet.height:
            raise BuildError(f'{rel}: {where}: клетка [{cx}, {cy}] за пределами листа "{key}"')
        return sheet.crop((cx * T, cy * T, cx * T + T, cy * T + T))

    def stack(refs, where: str) -> Image.Image:
        out = Image.new('RGBA', (T, T), (0, 0, 0, 0))
        for r in refs:
            out.alpha_composite(cell(r, where))
        return out

    tiles: dict[str, dict] = {}
    for name, t in d['tiles'].items():
        where = f'tiles.{name}'
        under_img = stack([t['under']], where) if 'under' in t else None
        if 'tile' in t:
            tiles[name] = {'kind': 'single', 'frames': [add(cell(t['tile'], where))]}
        elif 'stack' in t:
            tiles[name] = {'kind': 'single', 'frames': [add(stack(t['stack'], where))]}
        elif 'variants' in t:
            tiles[name] = {'kind': 'variants', 'frames': [add(cell(r, where)) for r in t['variants']]}
        elif 'auto16' in t:
            key, bx, by = t['auto16']
            tiles[name] = {'kind': 'auto16', 'frames': [add(cell([key, bx + ox, by + oy], where)) for ox, oy in AUTO16_OFFSETS]}
        elif 'sprite' in t:
            sp = sprites.get(t['sprite'])
            if not sp:
                raise BuildError(f'{rel}: {where}: нет спрайта "{t["sprite"]}"')
            mask = t.get('mask')
            if mask == 'auto16':
                if len(sp.frames) != 16:
                    raise BuildError(f'{rel}: {where}: для auto16 у "{sp.id}" нужно 16 кадров')
                tiles[name] = {'kind': 'auto16', 'frames': [add(cell({'sprite': sp.id, 'frame': i}, where)) for i in range(16)]}
            elif mask == 'corners':
                if len(sp.frames) != 4:
                    raise BuildError(f'{rel}: {where}: для corners у "{sp.id}" нужно 4 кадра (NW, NE, SW, SE)')
                fr = [add(cell({'sprite': sp.id, 'frame': i}, where)) for i in range(4)]
                tiles[name] = {'kind': 'auto16', 'frames': [fr[CORNERS.get(m, 0)] for m in range(16)]}
            else:
                tiles[name] = {'kind': 'single', 'frames': [add(cell({'sprite': sp.id, 'frame': t.get('frame', 0)}, where))]}
        else:
            raise BuildError(f'{rel}: {where}: нужен tile, stack, variants, auto16 или sprite')

    cols = 16
    rows = (len(cells) + cols - 1) // cols
    stride = T + 2 * PAD
    img = Image.new('RGBA', (cols * stride, rows * stride), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        extrude_paste(img, c, (i % cols) * stride + PAD, (i // cols) * stride + PAD)
    meta = {
        'id': tsid,
        'image': f'{tsid}.png',
        'tileSize': T,
        'margin': PAD,
        'spacing': 2 * PAD,
        'columns': cols,
        'count': len(cells),
        'tiles': dict(sorted(tiles.items())),
    }
    return img, meta, notes


# ───────────────────────────── сборка и проверка ─────────────────────────────

def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=False, compress_level=9)
    return buf.getvalue()


def json_text(d: dict) -> str:
    return json.dumps(d, ensure_ascii=False, indent=1) + '\n'


def build_all() -> tuple[dict[str, bytes | str], list[str]]:
    pal = load_palette()
    sprites, notes = load_sprites(pal)
    out: dict[str, bytes | str] = {}
    img, atlas, index = pack_custom(sprites)
    out['custom.png'] = png_bytes(img)
    out['custom.json'] = json_text(atlas)
    out['sprites.json'] = json_text(index)
    for p in sorted((ART / 'tilesets').glob('*.json')):
        ts_img, meta, ts_notes = build_tileset(p.stem, sprites, pal)
        out[f'{p.stem}.png'] = png_bytes(ts_img)
        out[f'{p.stem}.json'] = json_text(meta)
        notes += ts_notes
    return out, notes


def check_png(path: Path, pal: Palette, rel: str) -> list[str]:
    errs: list[str] = []
    img = Image.open(path)
    if img.width % T or img.height % T:
        if not rel.startswith('public/atlas/'):  # листы атласа с полями extrude, кратны только кадры
            errs.append(f'{rel}: размер {img.width}×{img.height} не кратен {T}')
    img = img.convert('RGBA')
    px = img.load()
    bad: dict[tuple[int, ...], tuple[int, int]] = {}
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if a != 255:
                bad.setdefault(('alpha', a), (x, y))
            elif (r, g, b) not in pal.rgbs:
                bad.setdefault((r, g, b), (x, y))
    for c, (x, y) in list(bad.items())[:20]:
        what = f'альфа {c[1]}' if c[0] == 'alpha' else f'цвет {rgb_to_hex(c)} не из палитры'
        errs.append(f'{rel}, {x}, {y}: {what}')
    if len(bad) > 20:
        errs.append(f'{rel}: ещё {len(bad) - 20} нарушений')
    return errs


def check() -> int:
    errs: list[str] = []
    try:
        pal = load_palette()
        built, _ = build_all()
    except BuildError as e:
        print(f'sprites --check: {e}', file=sys.stderr)
        return 1
    if len(pal.rgbs) > 320:
        errs.append(f'art/palette.json: {len(pal.rgbs)} цветов, максимум 320')
    pngs = sorted(OUT.glob('*.png'))
    for p in pngs:
        errs += check_png(p, pal, p.relative_to(ROOT).as_posix())
    # Большие картинки карт (tools/art_map.py): только цвета палитры, альфа 0/255, размер кратен 16
    maps = sorted((ROOT / 'public' / 'maps-art').glob('*.png')) if (ROOT / 'public' / 'maps-art').exists() else []
    for p in maps:
        errs += check_png(p, pal, p.relative_to(ROOT).as_posix())
    # Кадры атласов: имена и кратность 16
    for jp in sorted(OUT.glob('*.json')):
        d = json.loads(jp.read_text('utf8'))
        for name, fr in d.get('frames', {}).items():
            f = fr['frame']
            if not name:
                errs.append(f'{jp.relative_to(ROOT).as_posix()}: кадр без имени')
            if f['w'] % T or f['h'] % T:
                errs.append(f'{jp.relative_to(ROOT).as_posix()}: кадр {name} {f["w"]}×{f["h"]} не кратен {T}')
    # Атлас не устарел: сборка в памяти совпадает с public/atlas
    for name, data in built.items():
        p = OUT / name
        if not p.exists():
            errs.append(f'public/atlas/{name}: нет файла (npm run sprites)')
            continue
        if name.endswith('.png'):
            a = Image.open(p).convert('RGBA')
            b = Image.open(io.BytesIO(data)).convert('RGBA')
            same = a.size == b.size and a.tobytes() == b.tobytes()
        else:
            same = p.read_text('utf8') == data
        if not same:
            errs.append(f'public/atlas/{name}: устарел относительно art/ (npm run sprites)')
    extra = {p.name for p in OUT.glob('*')} - set(built) if OUT.exists() else set()
    for name in sorted(extra):
        errs.append(f'public/atlas/{name}: лишний файл, его не собирает sprites_build.py')
    if errs:
        print('sprites --check: ошибки', file=sys.stderr)
        for e in errs:
            print(f'  {e}', file=sys.stderr)
        return 1
    print(f'sprites --check: ок ({len(pal.rgbs)} цветов палитры, {len(pngs)} PNG атласа, {len(maps)} PNG карт)')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true', help='проверка для CI, ничего не пишет')
    ap.add_argument('--quantize', metavar='PNG', help='привести лист к палитре')
    ap.add_argument('--out', metavar='PNG', help='куда писать результат --quantize (по умолчанию рядом, *.q.png)')
    a = ap.parse_args()
    if a.check:
        return check()
    try:
        if a.quantize:
            src = Path(a.quantize)
            img, changed = quantize(Image.open(src), load_palette())
            dst = Path(a.out) if a.out else src.with_suffix('.q.png')
            img.save(dst)
            print(f'{dst}: {changed} px приведено к палитре')
            return 0
        built, notes = build_all()
    except BuildError as e:
        print(f'sprites: {e}', file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    for p in OUT.glob('*'):
        if p.name not in built:
            p.unlink()
    for name, data in built.items():
        p = OUT / name
        if isinstance(data, bytes):
            p.write_bytes(data)
        else:
            p.write_text(data, 'utf8')
    for n in notes:
        print(f'  {n}')
    digest = hashlib.sha1(b''.join(d if isinstance(d, bytes) else d.encode() for d in built.values())).hexdigest()[:8]
    print(f'sprites: {len(built)} файлов в public/atlas ({digest})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
