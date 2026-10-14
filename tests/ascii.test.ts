// ASCII-карта → слои тайлов и коллизии (ТЗ §3.7, I-07).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AsciiError, E, N, S, W, cellHash, frameFor, neighborMask, parseAscii, tileLayers, type TilesetMeta } from '../src/world/ascii';
import type { LocationMap } from '../src/types/content';

const base = (over: Partial<LocationMap> = {}): LocationMap => ({
  id: 't.map',
  title: { pl: 'x', ru: 'x' },
  tileset: 'ninja16',
  controls: 'walk',
  size: [5, 4],
  defaultGround: '.',
  legend: {
    '.': { tile: 'grass' },
    '#': { tile: 'fence', solid: true, auto: true },
    T: { tile: 'tree', solid: true, layer: 'deco' },
    f: { tile: 'flower', layer: 'deco' },
    '=': { tile: 'path' },
  },
  layers: { ground: ['#####', '#.T.#', '#..=#', '#####'] },
  spawns: { default: [1, 1] },
  objects: [],
  ...over,
});

const ts: TilesetMeta = {
  id: 'ninja16',
  image: 'ninja16.png',
  tileSize: 16,
  margin: 1,
  spacing: 2,
  columns: 16,
  count: 40,
  tiles: {
    grass: { kind: 'variants', frames: [0, 1, 2] },
    fence: { kind: 'auto16', frames: Array.from({ length: 16 }, (_, i) => 10 + i) },
    tree: { kind: 'single', frames: [30] },
    flower: { kind: 'single', frames: [31] },
    path: { kind: 'auto16', frames: Array.from({ length: 16 }, (_, i) => 40 + i) },
  },
};

describe('parseAscii', () => {
  it('символ слоя deco уходит в deco, под ним defaultGround', () => {
    const p = parseAscii(base());
    expect(p.ground[1]![2]).toBe('.');
    expect(p.deco[1]![2]).toBe('T');
    expect(p.deco[1]![1]).toBeNull();
  });
  it('коллизия из solid в ground и deco', () => {
    const p = parseAscii(base());
    expect(p.solid[0]![0]).toBe(true); // забор
    expect(p.solid[1]![2]).toBe(true); // дерево в deco
    expect(p.solid[1]![1]).toBe(false);
    expect(p.solid[2]![3]).toBe(false); // тропинка
  });
  it('отдельный слой deco: пробел = пусто, символ ложится поверх ground', () => {
    const p = parseAscii(base({ layers: { ground: ['#####', '#...#', '#...#', '#####'], deco: ['     ', ' f   ', '   T ', '     '] } }));
    expect(p.deco[1]![1]).toBe('f');
    expect(p.solid[1]![1]).toBe(false);
    expect(p.solid[2]![3]).toBe(true);
    expect(p.deco[0]![0]).toBeNull();
  });
  it('неверная форма и неизвестный символ — понятная ошибка', () => {
    expect(() => parseAscii(base({ layers: { ground: ['#####', '#####'] } }))).toThrow(AsciiError);
    expect(() => parseAscii(base({ layers: { ground: ['####', '#..#', '#..#', '####'] } }))).toThrow(/size\[0\]/);
    expect(() => parseAscii(base({ layers: { ground: ['#####', '#.?.#', '#...#', '#####'] } }))).toThrow(/"\?"/);
  });
  it('реальные карты ch01 разбираются', () => {
    for (const name of ['metro', 'dzialka']) {
      const m = JSON.parse(readFileSync(`content/modules/ch01/maps/${name}.json`, 'utf8')) as LocationMap;
      const p = parseAscii(m);
      expect(p.w).toBe(m.size[0]);
      expect(p.solid.flat().some(Boolean)).toBe(true);
    }
  });
});

describe('автотайл по 4 соседям', () => {
  const grid = ['###', '#.#', '###'].map((r) => [...r]);
  it('маска N=1 E=2 S=4 W=8, за краем = такой же', () => {
    expect(neighborMask(grid, 0, 0)).toBe(N | E | S | W);
    expect(neighborMask(grid, 1, 0)).toBe(N | E | W); // под ним пол
    expect(neighborMask(grid, 1, 1)).toBe(0); // одиночный пол
  });
  it('frameFor: auto16 по маске, variants детерминированы, single', () => {
    const m = base();
    const p = parseAscii(m);
    expect(frameFor(ts, m, p.ground, 2, 0)).toBe(10 + (N | E | W)); // верхний забор, снизу трава
    expect(frameFor(ts, m, p.ground, 1, 1)).toBe(frameFor(ts, m, p.ground, 1, 1));
    expect([0, 1, 2]).toContain(frameFor(ts, m, p.ground, 1, 1));
    expect(frameFor(ts, m, p.deco, 2, 1)).toBe(30);
    expect(frameFor(ts, m, p.deco, 1, 1)).toBe(-1);
    // `auto` не задан в легенде → центр (все соседи такие же)
    expect(frameFor(ts, m, p.ground, 3, 2)).toBe(40 + 15);
  });
  it('tileLayers: оба слоя в индексах, неизвестный тайл — ошибка', () => {
    const { ground, deco } = tileLayers(ts, base());
    expect(ground).toHaveLength(4);
    expect(deco[1]![2]).toBe(30);
    const bad = base({ legend: { ...base().legend, '=': { tile: 'lava' } } });
    expect(() => tileLayers(ts, bad)).toThrow(/lava/);
  });
  it('cellHash раскидывает варианты', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) seen.add(cellHash(x, y) % 3);
    expect(seen.size).toBe(3);
  });
});

describe('собранный тайлсет покрывает легенды карт', () => {
  it('каждый tile из maps/*.json есть в public/atlas/ninja16.json', () => {
    const meta = JSON.parse(readFileSync('public/atlas/ninja16.json', 'utf8')) as TilesetMeta;
    for (const name of ['metro', 'dzialka']) {
      const m = JSON.parse(readFileSync(`content/modules/ch01/maps/${name}.json`, 'utf8')) as LocationMap;
      expect(() => tileLayers(meta, m)).not.toThrow();
    }
  });
});
