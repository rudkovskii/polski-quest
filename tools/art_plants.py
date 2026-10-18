"""Арт «пёстрого огорода»: кусты-варианты (`plant_v00…v15`), плоды (`plant_fruits_*`), мини-иконки предметов (`plant_icons_*`).

Листы лежат готовыми в art/plants/*.sprite.json (перекрашены на материалы проекта скриптом `tools/plants_import.py`, правятся руками);
здесь они просто вносятся в общий набор, чтобы `npm run art` не стирал их. Порядок упаковки — после всех прочих (`sprites_build.py`).
"""
from __future__ import annotations

import json

import art_core
from art_core import Sheet, emit
from art_ramp import ROOT


def build() -> None:
    for p in sorted((ROOT / 'art' / 'plants').glob('*.sprite.json')):
        d = json.loads(p.read_text('utf8'))
        keys = d['keys']
        sh = Sheet(d['id'], d['size'][0], d['size'][1], anchor=d.get('anchor'))
        for fr in d['frames']:
            sh.add(fr if isinstance(fr, (int, dict)) else [[keys[c] for c in row] for row in fr])
        emit(sh)
