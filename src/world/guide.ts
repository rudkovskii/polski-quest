// Подсветка цели режиссёра в мире (ТЗ §4.12, I-13): чистый TS без Phaser, сцена Location только рисует.
//   • resolveGuide — цель шага (NPC, объект, растение на грядке) → объект карты и прямоугольник контура;
//     цель в другой локации → выход, который туда ведёт;
//   • guidePath — первые 3 клетки пути пунктиром (walk-локации);
//   • pointerCell — куда встать бобру-указателю: клетка рядом с целью, не на пути Димы;
//   • edgeArrow — стрелка у края экрана, если цель вне камеры.
import type { PlotView } from '../types/bus';
import type { Xy } from './ascii';
import type { LocationModel, WorldObject } from './location';
import { around, findPath, pathToAdjacent, type Grid } from './pathfind';

/** Цель шага режиссёра (src/systems/director.ts Target). */
export interface GuideTarget {
  location: string;
  npc?: string;
  object?: string;
  plot?: string;
  item?: string;
}

export interface ResolvedGuide {
  /** Ключ объекта карты (`npc:brzechwa`, `trigger:ryby`, `plot:grzadki`, `exit:5,9`). */
  key: string;
  /** Контур подсветки: левый верхний угол и размер в клетках. */
  at: Xy;
  size: Xy;
  /** Цель в другой локации: подсвечен выход туда. */
  viaExit: boolean;
}

type ModelLike = Pick<LocationModel, 'objects' | 'map'>;

function rectOf(o: WorldObject): Pick<ResolvedGuide, 'at' | 'size'> {
  return { at: [o.at[0], o.at[1]], size: [o.size[0], o.size[1]] };
}

/**
 * Цель → что подсветить на этой карте. Растение (`plot` + `item`): клетка с этим словом; без `item` —
 * первая клетка с «!», иначе вся грядка. Скрытые объекты (`if` ложно) не цель.
 */
export function resolveGuide(m: ModelLike, t: GuideTarget | null, plots: readonly PlotView[] = [], hidden: ReadonlySet<string> = new Set()): ResolvedGuide | null {
  if (!t) return null;
  const visible = m.objects.filter((o) => !hidden.has(o.key));
  if (t.location !== m.map.id) {
    const ex = visible.find((o) => o.kind === 'exit' && (o.src as { to: string }).to === t.location);
    return ex ? { key: ex.key, ...rectOf(ex), viaExit: true } : null;
  }
  if (t.plot) {
    const o = visible.find((x) => x.kind === 'plot' && x.id === t.plot);
    if (!o) return null;
    const cells = plots.find((p) => p.plot === t.plot)?.cells ?? [];
    const cell = (t.item ? cells.find((c) => c.item === t.item) : undefined) ?? cells.find((c) => c.due);
    return cell ? { key: o.key, at: [cell.at[0], cell.at[1]], size: [1, 1], viaExit: false } : { key: o.key, ...rectOf(o), viaExit: false };
  }
  if (t.object) {
    const o = visible.find((x) => x.id === t.object && x.kind !== 'npc');
    if (o) return { key: o.key, ...rectOf(o), viaExit: false };
  }
  if (t.npc) {
    const o = visible.find((x) => x.kind === 'npc' && x.id === t.npc);
    if (o) return { key: o.key, ...rectOf(o), viaExit: false };
  }
  return null;
}

/** Первые `n` клеток пути от Димы к клетке рядом с целью (на выход — на саму клетку выхода). */
export function guidePath(grid: Grid, from: Xy, g: ResolvedGuide, n = 3): Xy[] {
  const res = g.viaExit ? findPath(grid, from, g.at) : pathToAdjacent(grid, from, g.at, g.size);
  return res.path.slice(0, n);
}

const manhattan = (a: Xy, b: Xy): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/**
 * Клетка бобра-указателя: проходимая соседняя с целью; та, куда встанет Дима (конец его пути), —
 * только если другой нет. Из подходящих — ближайшая к бобру. На выход бобр встаёт рядом с ним.
 */
export function pointerCell(grid: Grid, g: ResolvedGuide, player: Xy, companion: Xy): Xy | null {
  const cells = around(g.at, g.size).filter(([x, y]) => grid.passable(x, y));
  if (!cells.length) return null;
  const approach = g.viaExit ? null : pathToAdjacent(grid, player, g.at, g.size).end;
  const free = cells.filter((c) => !(approach && c[0] === approach[0] && c[1] === approach[1]) && !(c[0] === player[0] && c[1] === player[1]));
  const pool = free.length ? free : cells;
  return [...pool].sort((a, b) => manhattan(a, companion) - manhattan(b, companion) || a[1] - b[1] || a[0] - b[0])[0]!;
}

/** Куда смотреть с клетки `from` на прямоугольник цели. */
export function faceTowards(from: Xy, at: Xy, size: Xy): 'up' | 'down' | 'left' | 'right' {
  const cx = Math.min(Math.max(from[0], at[0]), at[0] + size[0] - 1);
  const cy = Math.min(Math.max(from[1], at[1]), at[1] + size[1] - 1);
  const dx = cx - from[0];
  const dy = cy - from[1];
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Стрелка у края экрана (мировые пиксели): цель `p` вне видимой области `view` → точка на краю
 * (с отступом `margin`) по направлению от центра к цели и угол. Цель видна → null.
 */
export function edgeArrow(view: ViewRect, p: { x: number; y: number }, margin: number): { x: number; y: number; angle: number } | null {
  const inside = p.x >= view.x && p.x <= view.x + view.width && p.y >= view.y && p.y <= view.y + view.height;
  if (inside) return null;
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const hw = Math.max(1, view.width / 2 - margin);
  const hh = Math.max(1, view.height / 2 - margin);
  const k = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
  return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
}
