// ASCII-локация → слои тайлов и коллизии. Чистый TS без Phaser: тестируется в vitest,
// сцена Location только раскладывает готовые индексы по TilemapLayer.
import type { LegendEntry, LocationMap, Xy } from '../types/map';

export type { Xy };

export class AsciiError extends Error {
  override name = 'AsciiError';
}

export interface ParsedMap {
  id: string;
  w: number;
  h: number;
  /** Символ легенды в слое ground (символы слоя deco заменены на defaultGround). */
  ground: string[][];
  /** Символ легенды в слое deco или null. */
  deco: (string | null)[][];
  /** Непроходимые клетки по легенде (solid в ground или deco). Объекты карты сюда не входят. */
  solid: boolean[][];
}

const chars = (s: string): string[] => Array.from(s);

/**
 * Разбор слоёв: символ с `layer: "deco"` в строках ground уходит в deco, под ним `defaultGround`;
 * в строках deco пробел = пусто. Ошибки формы бросает (в рантайме карта уже прошла валидатор).
 */
export function parseAscii(map: LocationMap): ParsedMap {
  const [w, h] = map.size;
  const legend = map.legend;
  const entry = (ch: string, where: string): LegendEntry => {
    const e = legend[ch];
    if (!e) throw new AsciiError(`${map.id}: символа "${ch}" нет в легенде (${where})`);
    return e;
  };
  entry(map.defaultGround, 'defaultGround');
  const rowsOf = (name: 'ground' | 'deco'): string[][] | null => {
    const rows = map.layers[name];
    if (!rows) return null;
    if (rows.length !== h) throw new AsciiError(`${map.id}: слой ${name}: строк ${rows.length}, а size[1] = ${h}`);
    return rows.map((r, y) => {
      const cs = chars(r);
      if (cs.length !== w) throw new AsciiError(`${map.id}: слой ${name}, строка ${y}: длина ${cs.length}, а size[0] = ${w}`);
      return cs;
    });
  };
  const g = rowsOf('ground') ?? [];
  const d = rowsOf('deco');
  const ground: string[][] = [];
  const deco: (string | null)[][] = [];
  const solid: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    const gr: string[] = [];
    const dr: (string | null)[] = [];
    const sr: boolean[] = [];
    for (let x = 0; x < w; x++) {
      const gc = g[y]![x]!;
      const ge = entry(gc, `ground ${x},${y}`);
      let groundCh = gc;
      let decoCh: string | null = null;
      if (ge.layer === 'deco') {
        groundCh = map.defaultGround;
        decoCh = gc;
      }
      const dc = d?.[y]?.[x];
      if (dc !== undefined && dc !== ' ') {
        entry(dc, `deco ${x},${y}`);
        decoCh = dc;
      }
      gr.push(groundCh);
      dr.push(decoCh);
      sr.push(legend[groundCh]?.solid === true || (decoCh !== null && legend[decoCh]?.solid === true));
    }
    ground.push(gr);
    deco.push(dr);
    solid.push(sr);
  }
  return { id: map.id, w, h, ground, deco, solid };
}

/** Биты соседей для автотайла (`auto` в легенде): N=1, E=2, S=4, W=8. За краем карты = такой же. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export function neighborMask(grid: readonly (readonly (string | null)[])[], x: number, y: number): number {
  const ch = grid[y]?.[x];
  const h = grid.length;
  const same = (nx: number, ny: number): boolean => {
    if (ny < 0 || ny >= h || nx < 0 || nx >= (grid[ny]?.length ?? 0)) return true;
    return grid[ny]![nx] === ch;
  };
  return (same(x, y - 1) ? N : 0) | (same(x + 1, y) ? E : 0) | (same(x, y + 1) ? S : 0) | (same(x - 1, y) ? W : 0);
}

/** Тайлсет из public/atlas/<id>.json (собирает tools/sprites_build.py). */
export interface TilesetMeta {
  id: string;
  image: string;
  tileSize: number;
  margin: number;
  spacing: number;
  columns: number;
  count: number;
  tiles: Record<string, { kind: 'single' | 'variants' | 'auto16'; frames: number[] }>;
}

/** Детерминированный выбор варианта по клетке: одна и та же карта всегда выглядит одинаково. */
export function cellHash(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Индекс кадра тайлсета для клетки или -1 (пусто). Неизвестный тайл = ошибка контента. */
export function frameFor(
  ts: TilesetMeta,
  map: LocationMap,
  grid: readonly (readonly (string | null)[])[],
  x: number,
  y: number,
): number {
  const ch = grid[y]?.[x];
  if (ch === null || ch === undefined) return -1;
  const e = map.legend[ch];
  if (!e) throw new AsciiError(`${map.id}: символа "${ch}" нет в легенде`);
  const t = ts.tiles[e.tile];
  if (!t) throw new AsciiError(`${map.id}: тайла "${e.tile}" нет в тайлсете ${ts.id}`);
  switch (t.kind) {
    case 'single':
      return t.frames[0]!;
    case 'variants':
      return t.frames[cellHash(x, y) % t.frames.length]!;
    case 'auto16':
      // Без `auto` в легенде берётся «центр» (все соседи такие же).
      return t.frames[e.auto ? neighborMask(grid, x, y) : 15]!;
  }
}

/** Оба слоя карты в индексах тайлсета (-1 = пусто). */
export function tileLayers(ts: TilesetMeta, map: LocationMap, parsed: ParsedMap = parseAscii(map)): { ground: number[][]; deco: number[][] } {
  const layer = (grid: (string | null)[][]): number[][] => grid.map((row, y) => row.map((_, x) => frameFor(ts, map, grid, x, y)));
  return { ground: layer(parsed.ground), deco: layer(parsed.deco) };
}
