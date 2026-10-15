// Пиксель-арт мест Wola в DOM (W-01): тайлы ninja16 и кадры атласа custom как CSS-фоны, масштаб целым множителем
// (пиксели ровные). Атлас грузит склейка (`PixAtlas`); нет атласа (тесты, сеть) — сетка без картинок, кнопки те же.
import { el } from '../../ui/dom';

export const T = 16;

export interface PixAtlas {
  tiles: {
    url: string;
    size: [number, number];
    margin: number;
    spacing: number;
    columns: number;
    tiles: Record<string, { kind: 'single' | 'variants' | 'auto16'; frames: number[] }>;
  };
  sprites: {
    url: string;
    size: [number, number];
    /** `plant_seed/0` → прямоугольник кадра в листе. */
    frames: Record<string, { x: number; y: number; w: number; h: number }>;
  };
}

/** Комната: строки ASCII, легенда символ → имя тайла (`.` под объектами — пол). */
export interface Room {
  rows: string[];
  legend: Record<string, string>;
  /** Под каждым тайлом слоя rows этот тайл (пол), если тайл с прозрачностью. */
  under?: string;
}

function bg(url: string, sheet: [number, number], x: number, y: number, k: number): string {
  return `background-image:url("${url}");background-size:${sheet[0] * k}px ${sheet[1] * k}px;background-position:${-x * k}px ${-y * k}px;background-repeat:no-repeat`;
}

/** Кадр тайла по имени (для auto16 — маска соседей N=1 E=2 S=4 W=8 по той же букве). */
function tileFrame(a: PixAtlas, name: string, mask: number, variant: number): number | null {
  const t = a.tiles.tiles[name];
  if (!t) return null;
  if (t.kind === 'auto16') return t.frames[mask] ?? t.frames[15] ?? null;
  if (t.kind === 'variants') return t.frames[variant % t.frames.length] ?? null;
  return t.frames[0] ?? null;
}

export function tileStyle(a: PixAtlas | null, name: string, k: number, mask = 15, variant = 0): string {
  if (!a) return '';
  const f = tileFrame(a, name, mask, variant);
  if (f === null) return '';
  const { margin, spacing, columns } = a.tiles;
  const x = margin + (f % columns) * (T + spacing);
  const y = margin + Math.floor(f / columns) * (T + spacing);
  return bg(a.tiles.url, a.tiles.size, x, y, k);
}

/** Кадр спрайта атласа custom (`plant_bush/0`) как CSS-фон. */
export function spriteStyle(a: PixAtlas | null, frame: string, k: number): string {
  const r = a?.sprites.frames[frame];
  if (!a || !r) return '';
  return `${bg(a.sprites.url, a.sprites.size, r.x, r.y, k)};width:${r.w * k}px;height:${r.h * k}px`;
}

export function spriteEl(a: PixAtlas | null, frame: string, k: number, cls = 'wl-spr'): HTMLElement {
  return el('i', { class: cls, 'data-frame': frame, 'aria-hidden': 'true', style: spriteStyle(a, frame, k) || `width:${T * k}px;height:${T * k}px` });
}

/** Целый множитель, чтобы комната w×h клеток влезла в box (не меньше 1, не больше max). */
export function fitScale(wTiles: number, hTiles: number, boxW: number, boxH: number, max = 6): number {
  const k = Math.floor(Math.min(boxW / (wTiles * T), boxH / (hTiles * T)));
  return Math.max(1, Math.min(max, Number.isFinite(k) ? k : 1));
}

/** Сетка тайлов комнаты: div с абсолютными клетками, размер w×h×16×k. */
export function roomEl(a: PixAtlas | null, room: Room, k: number): HTMLElement {
  const h = room.rows.length;
  const w = Math.max(...room.rows.map((r) => [...r].length));
  const grid = room.rows.map((r) => [...r]);
  const same = (x: number, y: number, ch: string): boolean => (x < 0 || y < 0 || x >= w || y >= h ? true : grid[y]![x] === ch);
  const box = el('div', { class: 'wl-room', style: `width:${w * T * k}px;height:${h * T * k}px` });
  grid.forEach((row, y) =>
    row.forEach((ch, x) => {
      const name = room.legend[ch];
      if (!name) return;
      const mask = (same(x, y - 1, ch) ? 1 : 0) | (same(x + 1, y, ch) ? 2 : 0) | (same(x, y + 1, ch) ? 4 : 0) | (same(x - 1, y, ch) ? 8 : 0);
      const pos = `left:${x * T * k}px;top:${y * T * k}px;width:${T * k}px;height:${T * k}px`;
      if (room.under && name !== room.under) box.append(el('i', { class: 'wl-tile', style: `${pos};${tileStyle(a, room.under, k, 15, x * 7 + y * 3)}` }));
      box.append(el('i', { class: 'wl-tile', 'data-tile': name, style: `${pos};${tileStyle(a, name, k, mask, x * 7 + y * 3)}` }));
    }),
  );
  return box;
}

/** Загрузка атласа (склейка): JSON тайлсета и custom. Ошибка → null (рисуем без картинок). */
export async function loadPixAtlas(base: string, load: (url: string) => Promise<unknown>): Promise<PixAtlas | null> {
  try {
    const [ts, custom] = (await Promise.all([load(`${base}atlas/ninja16.json`), load(`${base}atlas/custom.json`)])) as [
      { image: string; margin: number; spacing: number; columns: number; count: number; tiles: PixAtlas['tiles']['tiles'] },
      { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { size: { w: number; h: number } } },
    ];
    const rows = Math.ceil(ts.count / ts.columns);
    const frames: PixAtlas['sprites']['frames'] = {};
    for (const [k, v] of Object.entries(custom.frames)) frames[k] = v.frame;
    return {
      tiles: {
        url: `${base}atlas/${ts.image}`,
        size: [ts.margin * 2 + ts.columns * T + (ts.columns - 1) * ts.spacing, ts.margin * 2 + rows * T + (rows - 1) * ts.spacing],
        margin: ts.margin,
        spacing: ts.spacing,
        columns: ts.columns,
        tiles: ts.tiles,
      },
      sprites: { url: `${base}atlas/custom.png`, size: [custom.meta.size.w, custom.meta.size.h], frames },
    };
  } catch {
    return null;
  }
}
