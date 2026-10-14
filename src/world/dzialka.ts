// Działka (ТЗ §5.5): грядки `plot` ↔ карточки слов. Чистый TS без Phaser: какие слова на каких клетках,
// стадия, «!» и подвявшие. Сцена Location только рисует результат (`world:marks`).
//
// Какие слова на грядке (до w×h на объект plot, §5.5): сначала слова с поливом (due), затем недавно
// выросшие/политые, затем свежие семена. Внутри выбранного набора клетки идут по порядку посадки —
// пока слов не больше клеток, растение не прыгает по грядке, когда его полили.
// Банка (слово созрело): на грядке банка, пока у слова есть полив или оно созрело за последние
// JAR_SHOW_DAYS; дальше слово живёт в подвале (список), клетка достаётся другому слову (§4.10).
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

/** Грядки карты: клетки построчно слева направо, сверху вниз; несколько plot заполняются по очереди. */
export function layoutPlots(plots: readonly PlotRect[], items: readonly GardenItem[], now: number): PlotView[] {
  const capacity = plots.reduce((s, p) => s + p.size[0] * p.size[1], 0);
  const chosen = pickPlants(items, capacity, now);
  let k = 0;
  return plots.map((p) => {
    const cells: PlotCellView[] = [];
    for (let y = 0; y < p.size[1]; y++)
      for (let x = 0; x < p.size[0]; x++) cells.push(cellOf(chosen[k++], [p.at[0] + x, p.at[1] + y]));
    return { plot: p.id, cells };
  });
}

/** Всё для `world:marks` одной карты: грядки и «!» над словами-объектами. */
export function worldMarks(
  map: Pick<LocationMap, 'id' | 'objects'>,
  state: Pick<Derived, 'cards' | 'todayStart'>,
  now: number,
  t?: GardenTuning,
): { location: string; plots: PlotView[]; dueItems: string[] } {
  const items = gardenItems(state, now, t);
  const plots = plotsOf(map);
  return {
    location: map.id,
    plots: plots.length ? layoutPlots(plots, items, now) : [],
    dueItems: items.filter((g) => g.dueCard).map((g) => g.item),
  };
}

/** Клетка грядки под тапом. */
export function cellAt(plots: readonly PlotView[], tile: readonly [number, number]): PlotCellView | undefined {
  for (const p of plots) for (const c of p.cells) if (c.at[0] === tile[0] && c.at[1] === tile[1]) return c;
  return undefined;
}
