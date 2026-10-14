// Działka (ТЗ §5.5): грядки `plot` ↔ карточки слов. Чистый TS без Phaser: какие слова на каких клетках,
// стадия, «!» и подвявшие. Сцена Location только рисует результат (`world:marks`).
//
// Какие слова на грядке (до w×h на объект plot, §5.5): сначала слова с поливом (due), затем недавно
// выросшие/политые, затем свежие семена. Внутри выбранного набора клетки идут по порядку посадки —
// пока слов не больше клеток, растение не прыгает по грядке, когда его полили.
// Банка (слово созрело): на грядке банка, пока у слова есть полив или оно созрело за последние
// JAR_SHOW_DAYS; дальше слово живёт в подвале (список), клетка достаётся другому слову (§4.10).
//
// Посадка руками (P-02, исследование §6а день 1): слово с флагом `seed.<item>` — семя в кармане, на грядке его
// нет, пока Дима не посадит: A (или тап) по пустой клетке ставит флаг `plant.<x>_<y>.<item>`, и слово растёт
// именно на этой клетке. Слова без флага `seed.*` (всё, что посажено до P-02, и сцены, которые сажают сами)
// раскладываются по свободным клеткам, как раньше. Флаги сливаются объединением (merge.ts) — синк не ломается.
import { gardenItems, type GardenItem, type GardenTuning } from '../systems/garden';
import type { Derived } from '../systems/derive';
import type { LocationMap } from '../types/content';
import type { PlotCellView, PlotView } from '../types/bus';

export { BUSH_FROM, gardenItems, jarStage, plantStage, SPROUT_BIG_FROM, WILT_DAYS } from '../systems/garden';
export type { GardenItem, PlantStage } from '../systems/garden';

const DAY_MS = 86_400_000;
/** Сколько дней созревшее слово ещё стоит на грядке банкой. */
export const JAR_SHOW_DAYS = 3;

export interface PlotRect {
  id: string;
  at: [number, number];
  size: [number, number];
}

/** Объекты `plot` карты в порядке описания. */
export function plotsOf(map: Pick<LocationMap, 'objects'>): PlotRect[] {
  const out: PlotRect[] = [];
  for (const o of map.objects) {
    if (o.type !== 'plot') continue;
    const size = (o as { size?: number[] }).size ?? [1, 1];
    out.push({ id: o.id, at: [o.at[0], o.at[1]], size: [size[0] ?? 1, size[1] ?? 1] });
  }
  return out;
}

/** Слово просится на грядку: полив, недавно политое, банка свежая. Порядок важности для отбора. */
function priority(g: GardenItem, now: number): number[] {
  const jarOld = g.stage === 'jar' && !g.dueCard && now - g.lastReviewAt > JAR_SHOW_DAYS * DAY_MS;
  return [g.dueCard ? 0 : jarOld ? 2 : 1, g.dueCard ? g.interval : -g.lastReviewAt, g.plantedAt];
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Отобрать слова на `capacity` клеток и разложить по порядку посадки. */
export function pickPlants(items: readonly GardenItem[], capacity: number, now: number): GardenItem[] {
  const ranked = items
    .filter((g) => !(g.stage === 'jar' && !g.dueCard && now - g.lastReviewAt > JAR_SHOW_DAYS * DAY_MS))
    .map((g) => ({ g, k: priority(g, now) }))
    .sort((a, b) => cmp(a.k, b.k) || (a.g.item < b.g.item ? -1 : 1));
  return ranked
    .slice(0, capacity)
    .map((x) => x.g)
    .sort((a, b) => a.plantedAt - b.plantedAt || (a.item < b.item ? -1 : 1));
}

function cellOf(g: GardenItem | undefined, at: [number, number]): PlotCellView {
  if (!g) return { at, stage: 'empty', interval: 0, due: false, wilted: false };
  return { at, item: g.item, stage: g.stage, interval: g.interval, due: g.dueCard !== null, wilted: g.wilted };
}

/** Флаг «семя в кармане»: слово уже выучено в сцене, но ещё не посажено руками. */
export const seedFlag = (item: string): string => `seed.${item}`;
/** Флаг «посажено на клетку x,y». */
export const plantFlag = (item: string, at: readonly [number, number]): string => `plant.${at[0]}_${at[1]}.${item}`;
const PLANT_RE = /^plant\.(\d+)_(\d+)\.(.+)$/;

export interface PlantedPins {
  /** Слово → клетка, куда его посадили руками (при споре двух устройств — раньше посаженное). */
  pins: Map<string, [number, number]>;
  /** Семена в кармане по порядку получения. */
  seeds: string[];
}

/** Карман и посаженное руками из флагов мира (только слова, которые есть на грядке: `items`). */
export function plantedPins(flags: Readonly<Record<string, number>>, items: readonly string[]): PlantedPins {
  const known = new Set(items);
  const pins = new Map<string, [number, number]>();
  const pinTs = new Map<string, number>();
  const taken = new Map<string, number>();
  const all = Object.entries(flags)
    .map(([name, ts]) => ({ m: PLANT_RE.exec(name), ts }))
    .filter((x): x is { m: RegExpExecArray; ts: number } => !!x.m && known.has(x.m[3]!))
    .sort((a, b) => a.ts - b.ts || (a.m[0] < b.m[0] ? -1 : 1));
  for (const { m, ts } of all) {
    const item = m[3]!;
    const cell = `${m[1]},${m[2]}`;
    if (pins.has(item) || taken.has(cell)) continue; // одно слово — одна клетка, одна клетка — одно слово
    pins.set(item, [Number(m[1]), Number(m[2])]);
    pinTs.set(item, ts);
    taken.set(cell, ts);
  }
  const seeds = Object.entries(flags)
    .filter(([name]) => name.startsWith('seed.') && known.has(name.slice(5)) && !pins.has(name.slice(5)))
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .map(([name]) => name.slice(5));
  return { pins, seeds };
}

/**
 * Посадка руками: какой флаг поставить, если Дима сажает на клетку `at` (A или тап по пустой клетке).
 * Первое семя из кармана; клетка занята посаженным руками словом или семян нет — null.
 */
export function plantOnCell(flags: Readonly<Record<string, number>>, items: readonly string[], at: readonly [number, number]): string | null {
  const { pins, seeds } = plantedPins(flags, items);
  if (!seeds[0]) return null;
  for (const c of pins.values()) if (c[0] === at[0] && c[1] === at[1]) return null;
  return plantFlag(seeds[0], at);
}

/**
 * Грядки карты: клетки построчно слева направо, сверху вниз; несколько plot заполняются по очереди.
 * Слова из `pins` стоят на своих клетках (посажены руками), остальные занимают свободные клетки по порядку.
 */
export function layoutPlots(plots: readonly PlotRect[], items: readonly GardenItem[], now: number, pins: ReadonlyMap<string, readonly [number, number]> = new Map()): PlotView[] {
  const capacity = plots.reduce((s, p) => s + p.size[0] * p.size[1], 0);
  const chosen = pickPlants(items, capacity, now);
  const inPlots = (c: readonly [number, number]): boolean =>
    plots.some((p) => c[0] >= p.at[0] && c[1] >= p.at[1] && c[0] < p.at[0] + p.size[0] && c[1] < p.at[1] + p.size[1]);
  const byCell = new Map<string, GardenItem>();
  const free: GardenItem[] = [];
  for (const g of chosen) {
    const pin = pins.get(g.item);
    const k = pin ? `${pin[0]},${pin[1]}` : '';
    if (pin && inPlots(pin) && !byCell.has(k)) byCell.set(k, g);
    else free.push(g);
  }
  let k = 0;
  return plots.map((p) => {
    const cells: PlotCellView[] = [];
    for (let y = 0; y < p.size[1]; y++)
      for (let x = 0; x < p.size[0]; x++) {
        const at: [number, number] = [p.at[0] + x, p.at[1] + y];
        cells.push(cellOf(byCell.get(`${at[0]},${at[1]}`) ?? free[k++], at));
      }
    return { plot: p.id, cells };
  });
}

/**
 * Всё для `world:marks` одной карты: грядки, «!» над словами-объектами и семена в кармане (P-02).
 * `flags` — флаги мира (`seed.*`, `plant.*`); без них посадки руками нет, всё раскладывается само.
 */
export function worldMarks(
  map: Pick<LocationMap, 'id' | 'objects'>,
  state: Pick<Derived, 'cards' | 'todayStart'>,
  now: number,
  t?: GardenTuning,
  flags: Readonly<Record<string, number>> = {},
): { location: string; plots: PlotView[]; dueItems: string[]; seeds: string[] } {
  const all = gardenItems(state, now, t);
  const { pins, seeds } = plantedPins(flags, all.map((g) => g.item));
  const pocket = new Set(seeds);
  const items = all.filter((g) => !pocket.has(g.item));
  const plots = plotsOf(map);
  return {
    location: map.id,
    plots: plots.length ? layoutPlots(plots, items, now, pins) : [],
    dueItems: items.filter((g) => g.dueCard).map((g) => g.item),
    seeds: plots.length ? seeds : [],
  };
}

/** Клетка грядки под тапом. */
export function cellAt(plots: readonly PlotView[], tile: readonly [number, number]): PlotCellView | undefined {
  for (const p of plots) for (const c of p.cells) if (c.at[0] === tile[0] && c.at[1] === tile[1]) return c;
  return undefined;
}
