#!/usr/bin/env python3
"""Палитра игры из выбранных листов Ninja Adventure (ТЗ §8.1) → art/palette.json.

    python3 tools/palette_extract.py          # пересобрать art/palette.json (имена существующих цветов сохраняются)

База: Palette.png пака (53 цвета, имена по рядам листа). Затем частые цвета клеток, которые реально
берут art/tilesets/*.json и art/imports.json, если они дальше ΔE 3 от уже взятых, пока цветов меньше 64.
Польские акценты (ТЗ §8.1) добавляются явно; если такой цвет уже есть (ΔE < 3), акцент становится
вторым именем существующего цвета. Остальные пиксели листов квантует sprites_build.py.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sprites_build import ART, T, AUTO16_OFFSETS, delta_e, hex_to_rgb, rgb_to_hex  # noqa: E402

NA = ART / 'vendor' / 'ninja-adventure'
ROW_NAMES = ['sand', 'brown', 'orange', 'red', 'blue', 'green', 'plum', 'moss', 'grey']
SPECIAL = {'#ffffff': 'white', '#141b1b': 'ink'}
ACCENTS = {
    'accent_brick': '#b5432f',  # кирпично-красный
    'accent_amber': '#e89b2f',  # янтарный
    'accent_turquoise': '#2a9d9b',  # бирюзово-синий
    'accent_snow': '#f4f8fb',  # снежно-белый
    'accent_window': '#ffd966',  # тёплый жёлтый окон
}
MAX = 64
MIN_PX = 12  # реже — не повод тратить слот палитры


def base_colors() -> list[tuple[str, tuple[int, int, int]]]:
    img = Image.open(NA / 'Palette.png').convert('RGBA')
    out = []
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = img.getpixel((x, y))
            if not a:
                continue
            h = rgb_to_hex((r, g, b))
            out.append((SPECIAL.get(h, f'{ROW_NAMES[y]}_{x}'), (r, g, b)))
    return out


def used_pixels() -> Counter:
    """Цвета клеток, которые берут тайлсеты и импорты (не весь лист)."""
    cnt: Counter = Counter()

    def take(img: Image.Image, box: tuple[int, int, int, int]) -> None:
        for r, g, b, a in img.crop(box).convert('RGBA').get_flattened_data():
            if a >= 128:
                cnt[(r, g, b)] += 1

    for p in sorted((ART / 'tilesets').glob('*.json')):
        d = json.loads(p.read_text('utf8'))
        sheets = {k: Image.open(ART / v) for k, v in d['sources'].items()}
        refs = []
        for t in d['tiles'].values():
            for k in ('tile',):
                if k in t and isinstance(t[k], list):
                    refs.append(t[k])
            for k in ('variants', 'stack'):
                refs += [r for r in t.get(k, []) if isinstance(r, list)]
            if 'auto16' in t:
                key, bx, by = t['auto16']
                refs += [[key, bx + ox, by + oy] for ox, oy in AUTO16_OFFSETS]
        for key, cx, cy in refs:
            take(sheets[key], (cx * T, cy * T, cx * T + T, cy * T + T))
    ip = ART / 'imports.json'
    if ip.exists():
        for s in json.loads(ip.read_text('utf8'))['sprites']:
            img = Image.open(ART / s['src'])
            x0, y0, rw, rh = s.get('rect', [0, 0, img.width, img.height])
            take(img, (x0, y0, x0 + rw, y0 + rh))
    return cnt


def family(rgb: tuple[int, int, int]) -> str:
    r, g, b = (c / 255 for c in rgb)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 0.08:
        return 'grey'
    if mx == r:
        h = ((g - b) / (mx - mn)) % 6
    elif mx == g:
        h = (b - r) / (mx - mn) + 2
    else:
        h = (r - g) / (mx - mn) + 4
    h *= 60
    for lim, name in ((15, 'red'), (40, 'orange'), (65, 'sand'), (160, 'green'), (200, 'teal'), (260, 'blue'), (330, 'plum')):
        if h < lim:
            return name
    return 'red'


def main() -> int:
    path = ART / 'palette.json'
    old = json.loads(path.read_text('utf8'))['colors'] if path.exists() else {}
    old_by_hex = {}
    for name, h in old.items():
        old_by_hex.setdefault(h.lower(), name)

    colors: dict[str, str] = {}
    taken: list[tuple[int, int, int]] = []

    def put(name: str, rgb: tuple[int, int, int]) -> None:
        h = rgb_to_hex(rgb)
        colors[old_by_hex.get(h, name)] = h
        taken.append(rgb)

    for name, rgb in base_colors():
        put(name, rgb)
    for name, h in ACCENTS.items():
        rgb = hex_to_rgb(h)
        near = min(taken, key=lambda c: delta_e(c, rgb))
        if delta_e(near, rgb) < 3:
            colors[name] = rgb_to_hex(near)  # второе имя существующего цвета
        else:
            put(name, rgb)
    n = 0
    for rgb, count in used_pixels().most_common():
        if len(set(taken)) >= MAX or count < MIN_PX:
            break
        if min(delta_e(c, rgb) for c in taken) < 3:
            continue
        n += 1
        put(f'x_{family(rgb)}_{n}', rgb)
    # Цвета, на которые уже ссылаются спрайты, не теряем, даже если их больше нет в листах.
    for name, h in old.items():
        if name not in colors and h.lower() in {v for v in colors.values()}:
            colors[name] = h.lower()
    data = {
        'note': 'Палитра игры (ТЗ §8.1). Собирает tools/palette_extract.py из Ninja Adventure (CC0) + польские акценты. '
                'Спрайты ссылаются на имена. Не больше 64 цветов.',
        'colors': colors,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', 'utf8')
    print(f'art/palette.json: {len(set(colors.values()))} цветов, {len(colors)} имён (+{n} из листов)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
