#!/usr/bin/env python3
"""Ядро рисования sprite-as-data (Cv: фигуры из материалов со светом sdvRamp, Sheet: вывод JSON). Ссылаются art_*.py."""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art_ramp import ROOT, load_materials  # noqa: E402

MATS = load_materials()
OUT = ROOT / 'art' / 'sprites'
Name = str | None


class Cv:
    """Холст w×h: слой материалов `m` (имя части → материал), слой накладок `ov` (готовые имена палитры)."""

    def __init__(self, w: int, h: int, parts: dict[str, dict]):
        self.w, self.h, self.parts = w, h, parts
        self.m: list[str | None] = [None] * (w * h)
        self.ov: list[Name] = [None] * (w * h)

    def fill(self, test, part: str, only=None) -> 'Cv':
        for y in range(self.h):
            for x in range(self.w):
                if not test(x + 0.5, y + 0.5):
                    continue
                i = y * self.w + x
                if only is not None and self.m[i] not in only:
                    continue
                self.m[i] = part
        return self

    def ell(self, cx, cy, rx, ry, part, only=None):
        return self.fill(lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, part, only)

    def rect(self, x0, y0, w, h, part, only=None):
        return self.fill(lambda x, y: x0 <= x < x0 + w and y0 <= y < y0 + h, part, only)

    def poly(self, pts, part, only=None):
        def inside(x, y):
            res = False
            j = len(pts) - 1
            for i in range(len(pts)):
                xi, yi = pts[i]
                xj, yj = pts[j]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    res = not res
                j = i
            return res
        return self.fill(inside, part, only)

    def cap(self, x1, y1, x2, y2, r, part, only=None):
        def test(x, y):
            dx, dy = x2 - x1, y2 - y1
            l2 = dx * dx + dy * dy
            t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) if l2 else 0
            px, py = x1 + t * dx - x, y1 + t * dy - y
            return px * px + py * py <= r * r
        return self.fill(test, part, only)

    def clear(self, test):
        return self.fill(test, None)

    def dot(self, x, y, name: str):
        xi, yi = int(x), int(y)
        if 0 <= xi < self.w and 0 <= yi < self.h:
            self.ov[yi * self.w + xi] = name
        return self

    def dots(self, pts, name: str):
        for i in range(0, len(pts), 2):
            self.dot(pts[i], pts[i + 1], name)
        return self

    def orect(self, x0, y0, w, h, name: str):
        for y in range(int(y0), int(y0 + h)):
            for x in range(int(x0), int(x0 + w)):
                self.dot(x, y, name)
        return self

    def hline(self, x0, x1, y, name: str):
        for x in range(int(x0), int(x1)):
            self.dot(x, y, name)
        return self

    def vline(self, x, y0, y1, name: str):
        for y in range(int(y0), int(y1)):
            self.dot(x, y, name)
        return self

    # ── свет и контур ──
    def render(self, ring: bool = True) -> list[list[Name]]:
        w, h, m, parts = self.w, self.h, self.m, self.parts
        n = w * h
        mat = lambda i: parts[m[i]]['m']  # noqa: E731
        grp = [(parts[m[i]].get('g') or m[i]) if m[i] else None for i in range(n)]
        out: list[Name] = [None] * n

        def at(x, y):
            return -1 if x < 0 or y < 0 or x >= w or y >= h else y * w + x

        def same(i, j):
            return j >= 0 and grp[j] == grp[i]

        def run(i, x, y, dx, dy, mx):
            q = 0
            while q < mx and same(i, at(x + dx * (q + 1), y + dy * (q + 1))):
                q += 1
            return q

        for y in range(h):
            for x in range(w):
                i = y * w + x
                if not m[i]:
                    continue
                pt = parts[m[i]]
                base = pt['m']
                tone = lambda k: f'{base}.{k}'  # noqa: E731
                if 'flat' in pt:
                    out[i] = tone(pt['flat'])
                    continue
                jd, jr, ju, jl = at(x, y + 1), at(x + 1, y), at(x, y - 1), at(x - 1, y)

                def seam(j):
                    return j >= 0 and grp[j] is not None and grp[j] != grp[i]

                if seam(jd) or seam(jr):
                    c = tone(0)
                elif not same(i, jd) or not same(i, jr):
                    c = tone(1)
                elif not same(i, ju) or not same(i, jl):
                    c = tone(4) if (not same(i, ju) and run(i, x, y, -1, 0, 8) <= 2) or (not same(i, jl) and run(i, x, y, 0, -1, 8) <= 1) else tone(3)
                else:
                    r0 = max(2, pt.get('r', 3) * 0.9)
                    tl = min(run(i, x, y, 0, -1, r0), run(i, x, y, -1, 0, r0))
                    br = min(run(i, x, y, 0, 1, r0), run(i, x, y, 1, 0, r0))
                    if br <= 1:
                        c = tone(1)
                    elif tl <= 1 and br >= r0 * 0.6:
                        c = tone(3)
                    elif br < r0 * 0.45:
                        c = tone(1)
                    else:
                        c = tone(2)
                out[i] = c
        for i in range(n):
            if self.ov[i]:
                out[i] = self.ov[i]
        if ring:
            add = []
            for y in range(h):
                for x in range(w):
                    i = y * w + x
                    if out[i]:
                        continue
                    for j in (at(x, y - 1), at(x - 1, y), at(x + 1, y), at(x, y + 1)):
                        if j >= 0 and out[j]:
                            add.append((i, f'{mat(j)}.o' if m[j] and not parts[m[j]].get('noline') else 'outline'))
                            break
            for i, c in add:
                out[i] = c
        return [out[y * w:(y + 1) * w] for y in range(h)]


def P(mat: str, **kw) -> dict:
    return {'m': mat, **kw}


# ───────────────────────────── вывод ─────────────────────────────

KEYCHARS = '.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=-:;,/?@^~'


def grid_flip(g):
    return [row[::-1] for row in g]


class Sheet:
    """Набор кадров одного спрайта → JSON (frames — строки или ссылки на кадр `i` / `{"flip": i}`)."""

    def __init__(self, sid: str, w: int, h: int, anchor=None, anims=None):
        self.sid, self.w, self.h = sid, w, h
        self.anchor = anchor or [w // 2, h - 1]
        self.anims = anims or {}
        self.frames: list = []  # grid | int | dict

    def add(self, grid):
        self.frames.append(grid)
        return len(self.frames) - 1

    def flip_of(self, i: int):
        self.frames.append({'flip': i})
        return len(self.frames) - 1

    def grids(self):
        gs = []
        for f in self.frames:
            if isinstance(f, list):
                gs.append(f)
            elif isinstance(f, int):
                gs.append(gs[f])
            else:
                gs.append(grid_flip(gs[f['flip']]))
        return gs

    def to_json(self) -> dict:
        names: list[str] = []
        for g in self.grids():
            for row in g:
                for c in row:
                    if c and c not in names:
                        names.append(c)
        names.sort()
        if len(names) + 1 > len(KEYCHARS):
            raise SystemExit(f'{self.sid}: слишком много цветов ({len(names)})')
        key = {n: KEYCHARS[i + 1] for i, n in enumerate(names)}
        keys = {'.': None, **{ch: n for n, ch in key.items()}}
        frames = []
        for f in self.frames:
            if isinstance(f, list):
                frames.append([''.join(key[c] if c else '.' for c in row) for row in f])
            else:
                frames.append(f)
        d = {'id': self.sid, 'size': [self.w, self.h], 'anchor': self.anchor, 'keys': keys, 'frames': frames}
        if self.anims:
            d['anims'] = self.anims
        return d


SHEETS: dict[str, Sheet] = {}


def emit(sh: Sheet) -> None:
    SHEETS[sh.sid] = sh


def single(sid: str, grid, anchor=None) -> None:
    w, h = len(grid[0]), len(grid)
    sh = Sheet(sid, w, h, anchor)
    sh.add(grid)
    emit(sh)
