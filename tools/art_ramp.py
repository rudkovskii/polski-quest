"""Рампа материала в духе Stardew (порт sdvRamp с дашборда жаб, Планы/assets/dashboard-frogs-sprites-sdv.js).

У материала один средний тон (`art/materials.json`), остальное считается: тени уходят в красно-фиолетовый,
блики в жёлтый. Имена цветов в палитре: `<материал>.0` линия, `.1` тень, `.2` основной (= средний тон),
`.3` свет, `.4` блик, `.o` тёплый тёмный контур снаружи фигуры. Общий контур без материала: `outline`.
Свет везде один: сверху-слева.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTLINE = '#2a1418'


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def to_hex(rgb) -> str:
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in rgb)


def darken(c: str, k: float) -> str:
    return to_hex([v * k for v in hex_to_rgb(c)])


def rgb2hsl(c: str) -> tuple[float, float, float]:
    r, g, b = [v / 255 for v in hex_to_rgb(c)]
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    h = s = 0.0
    d = mx - mn
    if d:
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            h = (g - b) / d + (6 if g < b else 0)
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h *= 60
    return h, s, l


def hsl2hex(h: float, s: float, l: float) -> str:
    h = ((h % 360) + 360) % 360
    s = max(0.0, min(1.0, s))
    l = max(0.0, min(1.0, l))
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    return to_hex([(r + m) * 255, (g + m) * 255, (b + m) * 255])


def toward(h: float, target: float, deg: float) -> float:
    d = ((target - h + 540) % 360) - 180
    sign = (d > 0) - (d < 0)
    return h + sign * min(abs(d), deg)


def sdv_ramp(mid: str, tame: float = 1.0) -> list[str]:
    """[линия, тень, основной, свет, блик] из среднего тона. tame < 1 гасит насыщенность линии и тени (кожа)."""
    h, s, l = rgb2hsl(mid)
    grey = s < 0.12
    return [
        hsl2hex(290 if grey else toward(h, 340, 28), max(s, 0.18 if grey else 0.35) * 0.9 * tame, l * 0.32),
        hsl2hex(toward(h, 280, 30) if grey else toward(h, 340, 14), min(1, s * 1.08 + (0.08 if grey else 0)) * tame, l * 0.68),
        mid,
        hsl2hex(h if grey else toward(h, 52, 10), s * 0.98, min(0.9, l * 1.17 + 0.04)),
        hsl2hex(h if grey else toward(h, 55, 20), s * 0.9, min(0.95, l * 1.32 + 0.1)),
    ]


def load_materials(path: Path | None = None) -> dict[str, str]:
    """Материал: "#rrggbb" или {"c": "#rrggbb", "tame": 0.6}."""
    return json.loads((path or ROOT / 'art' / 'materials.json').read_text('utf8'))['mats']


def ramp_colors(mats: dict[str, str]) -> dict[str, str]:
    """Все цвета рамп для палитры: `<материал>.0…4` и `<материал>.o`."""
    out: dict[str, str] = {}
    for name, spec in mats.items():
        mid, tame = (spec, 1.0) if isinstance(spec, str) else (spec['c'], spec.get('tame', 1.0))
        ramp = sdv_ramp(mid, tame)
        for i, c in enumerate(ramp):
            out[f'{name}.{i}'] = c
        out[f'{name}.o'] = darken(ramp[0], 0.8)
    return out
