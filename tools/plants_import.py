#!/usr/bin/env python3
"""Перенос арта «пёстрого огорода» из ../data/plants в проект (одноразово, повторять при новой выгрузке арт-агента).

    python3 tools/plants_import.py [--src ../data/plants]

Что делает:
  1. читает data/plants/sprites/*.sprite.json (цвета — материалы арт-агента: materials.base.json + materials.add.json);
  2. перекрашивает на СУЩЕСТВУЮЩИЕ материалы проекта (палитра 319/320, новых материалов не добавляем): для каждого нового материала
     берётся ближайший проектный по рампе (ΔE в Lab по тонам .0…4 и .o, основной тон вдвое весомее), тон сохраняется
     (`apple.3` → `jam_red.3`), правки руками — `OVERRIDE`;
  3. пишет art/plants/*.sprite.json (формат проекта, ключи пересобраны), их рисует в art/sprites `tools/art_plants.py` (`npm run art`);
  4. копирует метаданные в content/plants/ (mapping, rules, plants, icons).
"""
from __future__ import annotations

import argparse
import json
import math
import shutil

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art_core import KEYCHARS  # noqa: E402
from art_ramp import ROOT, load_materials, ramp_colors  # noqa: E402

TONES = ['0', '1', '2', '3', '4', 'o']
# Ручные правки: новый материал → проектный (где ближайшая по ΔE читается хуже: сливы синие, листья мёртвые).
OVERRIDE: dict[str, str] = {
    'plum': 'petal_violet',
    'eggplant': 'petal_violet',
    'grape': 'petal_violet',
    'leaf_teal': 'leaf',
    'cloth_teal': 'water',
    'cloth_green': 'leaf',
    'paint_green': 'leaf',
    'pear': 'grass',
}


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def lab(h: str) -> tuple[float, float, float]:
    def lin(v: float) -> float:
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(v) for v in hex_rgb(h))
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def de(a: str, b: str) -> float:
    return math.dist(lab(a), lab(b))


def material_map(new_ramps: dict[str, str], new_mats: list[str]) -> dict[str, str]:
    proj = load_materials()
    pr = ramp_colors(proj)
    out: dict[str, str] = {}
    for m in new_mats:
        if m in OVERRIDE:
            out[m] = OVERRIDE[m]
            continue
        best: tuple[float, str] | None = None
        for c in proj:
            s = 0.0
            for t in TONES:
                a, b = new_ramps.get(f'{m}.{t}'), pr.get(f'{c}.{t}')
                if a and b:
                    s += de(a, b) * (2 if t == '2' else 1)
            if best is None or s < best[0]:
                best = (s, c)
        out[m] = best[1]  # type: ignore[index]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default='../data/plants', help='папка выгрузки арт-агента (в рабочей копии Игра/data/plants)')
    a = ap.parse_args()
    src = Path(a.src)
    base = json.loads((src / 'tools' / 'materials.base.json').read_text('utf8'))['mats']
    add = json.loads((src / 'materials.add.json').read_text('utf8'))['mats']
    new_ramps = ramp_colors({**base, **add})
    mm = material_map(new_ramps, list(add))
    pal = set(ramp_colors(load_materials())) | {'outline', 'ink', 'white', 'eye_white', 'mouth', 'cheek'}

    def remap(name: str) -> str:
        if name in pal:
            return name
        m, t = name.rsplit('.', 1)
        if m not in mm:
            raise SystemExit(f'нет правила для цвета {name}')
        return f'{mm[m]}.{t}'

    out = ROOT / 'art' / 'plants'
    out.mkdir(parents=True, exist_ok=True)
    for p in out.glob('*.sprite.json'):
        p.unlink()
    letters = KEYCHARS[1:]
    used: set[str] = set()
    n = 0
    for f in sorted((src / 'sprites').glob('*.sprite.json')):
        d = json.loads(f.read_text('utf8'))
        names = sorted({remap(v) for v in d['keys'].values() if v})
        key = {nm: letters[i] for i, nm in enumerate(names)}
        used.update(names)
        ch2 = {ch: (key[remap(nm)] if nm else '.') for ch, nm in d['keys'].items()}
        frames = [fr if isinstance(fr, (int, dict)) else [''.join(ch2[c] for c in row) for row in fr] for fr in d['frames']]
        nd = {'id': d['id'], 'size': d['size'], 'anchor': d.get('anchor'), 'keys': {'.': None, **{ch: nm for nm, ch in key.items()}}, 'frames': frames}
        (out / f.name).write_text(json.dumps(nd, ensure_ascii=False) + '\n', 'utf8')
        n += 1
    meta = ROOT / 'content' / 'plants'
    meta.mkdir(parents=True, exist_ok=True)
    for name in ('mapping.json', 'rules.json', 'plants.json', 'icons.json'):
        shutil.copyfile(src / name, meta / name)
    print(f'plants_import: {n} листов, {len(used)} цветов палитры; материалы: ' + ', '.join(f'{k}→{v}' for k, v in sorted(mm.items()) if k in OVERRIDE))
    return 0


if __name__ == '__main__':
    sys.exit(main())
