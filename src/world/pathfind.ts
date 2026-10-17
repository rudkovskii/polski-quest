// Поиск пути для тапа: BFS по 4 соседям, без диагоналей.
// Недостижимая цель → путь до ближайшей достижимой клетки.
import type { Xy } from './ascii';

export interface Grid {
  w: number;
  h: number;
  passable(x: number, y: number): boolean;
}

/** Порядок соседей фиксирован: путь детерминирован (сначала вертикаль, потом горизонталь). */
const DIRS: readonly Xy[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

interface Flood {
  dist: Int32Array;
  prev: Int32Array;
}

function flood(grid: Grid, from: Xy): Flood {
  const n = grid.w * grid.h;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const [fx, fy] = from;
  if (fx < 0 || fy < 0 || fx >= grid.w || fy >= grid.h) return { dist, prev };
  const start = fy * grid.w + fx;
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    const cx = cur % grid.w;
    const cy = (cur - cx) / grid.w;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
      const ni = ny * grid.w + nx;
      if (dist[ni] !== -1 || !grid.passable(nx, ny)) continue;
      dist[ni] = dist[cur]! + 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  return { dist, prev };
}

function unroll(grid: Grid, f: Flood, goal: number): Xy[] {
  const out: Xy[] = [];
  for (let i = goal; f.dist[i]! > 0; i = f.prev[i]!) out.push([i % grid.w, Math.floor(i / grid.w)]);
  return out.reverse();
}

export interface PathResult {
  /** Клетки по порядку, без стартовой. Пусто = уже на месте (или идти некуда). */
  path: Xy[];
  /** Куда путь ведёт на самом деле. */
  end: Xy;
  /** true, если `end` и есть цель. */
  exact: boolean;
}

const manhattan = (a: Xy, b: Xy): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/**
 * Путь из `from` в одну из клеток `goals`. Если ни одна не достижима — к достижимой клетке,
 * ближайшей к цели по Манхэттену (при равенстве — более короткий путь). Стартовая клетка
 * считается проходимой, даже если на ней стоит препятствие.
 */
export function findPathToAny(grid: Grid, from: Xy, goals: readonly Xy[], target: Xy = goals[0] ?? from, cost?: (c: Xy) => number): PathResult {
  const f = flood(grid, from);
  let best = -1;
  let bestCost = Infinity;
  for (const [gx, gy] of goals) {
    if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) continue;
    const gi = gy * grid.w + gx;
    if (f.dist[gi] === -1) continue;
    // Цена клетки: к человеку — сбоку, а не снизу (высокий спрайт Димы закрывает собеседника).
    const c = f.dist[gi]! + (cost ? cost([gx, gy]) : 0);
    if (c < bestCost) {
      bestCost = c;
      best = gi;
    }
  }
  if (best !== -1) {
    const end: Xy = [best % grid.w, Math.floor(best / grid.w)];
    return { path: unroll(grid, f, best), end, exact: true };
  }
  let bestScore = Infinity;
  for (let i = 0; i < f.dist.length; i++) {
    if (f.dist[i] === -1) continue;
    const score = manhattan([i % grid.w, Math.floor(i / grid.w)], target) * 10000 + f.dist[i]!;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best === -1) return { path: [], end: from, exact: false };
  return { path: unroll(grid, f, best), end: [best % grid.w, Math.floor(best / grid.w)], exact: false };
}

/** Путь в клетку `to` (тап по пустой клетке). */
export function findPath(grid: Grid, from: Xy, to: Xy): PathResult {
  return findPathToAny(grid, from, [to], to);
}

/** Клетки вокруг прямоугольника объекта (4-соседство), без самих клеток объекта. */
export function around(at: Xy, size: Xy = [1, 1]): Xy[] {
  const [x0, y0] = at;
  const [sw, sh] = size;
  const out: Xy[] = [];
  for (let x = x0; x < x0 + sw; x++) out.push([x, y0 - 1], [x, y0 + sh]);
  for (let y = y0; y < y0 + sh; y++) out.push([x0 - 1, y], [x0 + sw, y]);
  return out;
}

/** Путь к клетке рядом с объектом (тап по NPC или слову вдали: подойти, потом действие). */
export function pathToAdjacent(grid: Grid, from: Xy, at: Xy, size: Xy = [1, 1], cost?: (c: Xy) => number): PathResult {
  const goals = around(at, size).filter(([x, y]) => grid.passable(x, y) || (x === from[0] && y === from[1]));
  return findPathToAny(grid, from, goals, at, cost);
}

/**
 * Лишние шаги за клетку подхода к человеку: герой 16×32, стоя прямо под NPC он закрывает его спрайт. Сбоку — 0,
 * сверху — 1, снизу — 3: подходит сбоку, если обход не дальше трёх клеток.
 */
export function npcApproachCost(at: Xy): (c: Xy) => number {
  return (c) => (c[1] > at[1] ? 3 : c[1] < at[1] ? 1 : 0);
}
