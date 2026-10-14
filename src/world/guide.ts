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

const DELTA4 = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
type Dir4 = keyof typeof DELTA4;

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
  return playerRoute(grid, from, g).slice(0, n);
}

const manhattan = (a: Xy, b: Xy): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Клетки подхода к цели: соседние с прямоугольником цели (4-соседство). С них Дима берёт цель кнопкой A. */
export function approachCells(g: Pick<ResolvedGuide, 'at' | 'size'>): Xy[] {
  return around(g.at, g.size);
}

/** Путь Димы к цели (P-11): к клетке подхода; к выходу — на сам выход. `walk` — проходимость для Димы (без чужих выходов). */
export function playerRoute(walk: Grid, player: Xy, g: ResolvedGuide): Xy[] {
  return (g.viaExit ? findPath(walk, player, g.at) : pathToAdjacent(walk, player, g.at, g.size)).path;
}

export interface PointerOptions {
  /** Проходимость для Димы (P-11: выходы закрыты для путей к другой цели). Нет — та же сетка. */
  walk?: Grid;
  /** Куда смотрит Дима: клетка перед лицом не занимается. */
  facing?: Dir4;
}

/**
 * Клетка бобра-указателя у цели (P-11, блокер дня 2: Казик стоял на единственном подходе к ящику).
 * Бобр никогда не встаёт:
 *   • на клетку подхода к цели (ни на одну: подход всегда свободен);
 *   • на путь Димы к цели, на клетку Димы и на клетку перед его лицом;
 *   • на непроходимые для бобра клетки `grid` (склейка убирает оттуда выходы и занятые Димой клетки).
 * Из остальных — ближе к цели (по диагонали, потом через клетку), потом ближе к самому бобру. Нет такой — null.
 */
export function pointerCell(grid: Grid, g: ResolvedGuide, player: Xy, companion: Xy, o: PointerOptions = {}): Xy | null {
  const key = (c: Xy): string => `${c[0]},${c[1]}`;
  const banned = new Set(approachCells(g).map(key));
  for (const c of playerRoute(o.walk ?? grid, player, g)) banned.add(key(c));
  banned.add(key(player));
  if (o.facing) banned.add(key([player[0] + DELTA4[o.facing][0], player[1] + DELTA4[o.facing][1]]));
  const [x0, y0] = g.at;
  const [w, h] = g.size;
  const inRect = (x: number, y: number): boolean => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
  // Расстояние до прямоугольника цели по Чебышёву: диагональ = 1, «через клетку» = 2.
  const cheb = (x: number, y: number): number => Math.max(Math.max(x0 - x, 0, x - (x0 + w - 1)), Math.max(y0 - y, 0, y - (y0 + h - 1)));
  let best: Xy | null = null;
  let bestScore = Infinity;
  for (let r = 1; r <= 4 && !best; r++)
    for (let y = y0 - r; y < y0 + h + r; y++)
      for (let x = x0 - r; x < x0 + w + r; x++) {
        if (x < 0 || y < 0 || x >= grid.w || y >= grid.h || inRect(x, y) || cheb(x, y) !== r || !grid.passable(x, y) || banned.has(key([x, y]))) continue;
        const score = manhattan([x, y], companion) * 1000 + y * 50 + x;
        if (score < bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
  return best;
}

const BACK: Record<Dir4, Dir4> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const SIDES: Record<Dir4, [Dir4, Dir4]> = { up: ['left', 'right'], down: ['right', 'left'], left: ['up', 'down'], right: ['down', 'up'] };

/**
 * Куда встать Казику, когда цель шага — он сам (P-10a: «поговори: Kazik»): рядом с Димой, сбоку, потом сзади,
 * не перед лицом (не загораживает дорогу) и не на занятых клетках (`reserved`: Дима, куда он шагает, конец пути).
 * Клетка прямо над Димой — последней: высокий спрайт Димы закрывает того, кто стоит за ним.
 * Уже стоит сбоку (`current`) — остаётся. null — рядом всё занято.
 */
export function besideCell(grid: Grid, player: Xy, facing: Dir4, reserved: readonly Xy[] = [], current: Xy | null = null): Xy | null {
  const free = (c: Xy): boolean => grid.passable(c[0], c[1]) && !reserved.some((r) => r[0] === c[0] && r[1] === c[1]);
  const at = (d: Dir4): Xy => [player[0] + DELTA4[d][0], player[1] + DELTA4[d][1]];
  const same = (a: Xy, b: Xy | null): boolean => !!b && a[0] === b[0] && a[1] === b[1];
  const behind = [...SIDES[facing], BACK[facing]];
  // Сбоку и сзади, «над головой» — после них, «перед лицом» — последним.
  const ranked: Dir4[] = [...behind.filter((d) => d !== 'up'), ...behind.filter((d) => d === 'up'), facing];
  if (current && SIDES[facing].some((d) => d !== 'up' && same(at(d), current))) return current;
  for (const d of ranked) {
    const c = at(d);
    if (free(c) || same(c, current)) return c;
  }
  return null;
}

export interface BobrSpotInput {
  player: Xy;
  facing: Dir4;
  /** Где Казик-NPC стоит сейчас. */
  bobr: Xy;
  /** Его место на карте, когда цели нет. */
  home: Xy;
  walk?: Grid;
}

/**
 * Куда сесть NPC-Казику при цели шага (P-11). Клетка у цели по `pointerCell`; к выходу — остаётся дома, если дом не
 * мешает. Нет места — дом или текущая клетка, но только если они не на подходе к цели и не на пути Димы; иначе
 * ближайшая свободная клетка дальше. Подход к цели Казик не занимает никогда.
 */
export function bobrSpot(grid: Grid, g: ResolvedGuide, i: BobrSpotInput): { cell: Xy; face: Dir4 } {
  const key = (c: Xy): string => `${c[0]},${c[1]}`;
  const banned = new Set(approachCells(g).map(key));
  for (const c of playerRoute(i.walk ?? grid, i.player, g)) banned.add(key(c));
  banned.add(key(i.player));
  banned.add(key([i.player[0] + DELTA4[i.facing][0], i.player[1] + DELTA4[i.facing][1]]));
  const okCell = (c: Xy): boolean => grid.passable(c[0], c[1]) && !banned.has(key(c));
  const toward = (c: Xy): Dir4 => faceTowards(c, g.at, g.size);
  if (g.viaExit && okCell(i.home)) return { cell: i.home, face: 'left' };
  const near = pointerCell(grid, g, i.player, i.bobr, { ...(i.walk ? { walk: i.walk } : {}), facing: i.facing });
  if (near) return { cell: near, face: toward(near) };
  if (okCell(i.home)) return { cell: i.home, face: 'left' };
  if (okCell(i.bobr)) return { cell: i.bobr, face: toward(i.bobr) };
  // Отойти от Димы подальше: ближайшая свободная клетка вне подхода и пути.
  let best: Xy | null = null;
  let bestD = Infinity;
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) {
      if (!okCell([x, y])) continue;
      const d = manhattan([x, y], i.bobr);
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  return best ? { cell: best, face: toward(best) } : { cell: i.home, face: 'left' };
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
