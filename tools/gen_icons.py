#!/usr/bin/env python3
"""Иконки PWA из портрета героя (`art/sprites/hero_portrait.sprite.json`) на траве: пиксельная голова, ×N без сглаживания.

    python3 tools/gen_icons.py   # переписать public/icons/*.png (180, 192, 512, 512 maskable, apple-touch-icon)

Цвета только из палитры игры (art/palette.json + рампы материалов). Фон: трава, тёмная полоса снизу, светлые травинки.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art_ramp import ROOT  # noqa: E402
from sprites_build import load_palette  # noqa: E402

ICONS = ROOT / 'public' / 'icons'


def portrait() -> Image.Image:
    spr = json.loads((ROOT / 'art' / 'sprites' / 'hero_portrait.sprite.json').read_text('utf8'))
    pal = load_palette().names
    w, h = spr['size']
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y, row in enumerate(spr['frames'][0]):
        for x, ch in enumerate(row):
            name = spr['keys'].get(ch)
            if name:
                img.putpixel((x, y), (*pal[name], 255))
    return img


def background(size: int) -> Image.Image:
    """Трава в сетке 32×32 «пикселей» иконки: два тона и редкие светлые травинки."""
    pal = load_palette().names
    base, dark, light = pal['grass.2'], pal['grass.1'], pal['grass.3']
    img = Image.new('RGBA', (32, 32), (*base, 255))
    for y in range(32):
        for x in range(32):
            if y >= 28:
                img.putpixel((x, y), (*dark, 255))
            elif (x * 7 + y * 13) % 17 == 0:
                img.putpixel((x, y), (*light, 255))
    return img.resize((size, size), Image.NEAREST)


def icon(size: int, fill: float) -> Image.Image:
    """`fill` — доля стороны под портрет (maskable: безопасная зона ≈ 0.62)."""
    p = portrait()
    k = max(1, int(size * fill) // p.width)
    big = p.resize((p.width * k, p.height * k), Image.NEAREST)
    out = background(size)
    out.alpha_composite(big, ((size - big.width) // 2, (size - big.height) // 2 + size // 40))
    return out


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    for old in ICONS.glob('*.png'):
        old.unlink()
    for name, size, fill in [('icon-180', 180, 0.82), ('apple-touch-icon', 180, 0.82), ('icon-192', 192, 0.82),
                             ('icon-512', 512, 0.82), ('icon-512-maskable', 512, 0.6)]:
        icon(size, fill).convert('RGB').save(ICONS / f'{name}.png', optimize=True)
        print('ok', name)


if __name__ == '__main__':
    main()
