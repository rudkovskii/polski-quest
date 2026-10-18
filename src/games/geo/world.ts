// Геометрия карты Geografia: проекция lat/lon → px картинки `public/maps-art/poland.png` (320×304), попадания по точке, реке,
// воеводству и соседу, кластеры близких городов. Чистая логика без DOM: её гоняют тесты.
import type { PolskaUnit } from '../../types/polska';
import { NEIGHBOR_RINGS, REGION_RINGS, type Rings } from './geodata';

export const MAP_W = 320;
export const MAP_H = 304;
/** Проекция из `poland.json` (равнопромежуточная с поправкой cos 52°): x = (lon − lon0)·cosLat0·k, y = (latTop − lat)·k. */
const LON0 = 12.65;
const COS_LAT0 = 0.615661;
const K = 41;
const LAT_TOP = 55.55;
/** px карты на километр (1° широты ≈ 111,2 км). */
export const PX_PER_KM = K / 111.2;

export interface Pt {
  x: number;
  y: number;
}

export const project = (lat: number, lon: number): Pt => ({ x: (lon - LON0) * COS_LAT0 * K, y: (LAT_TOP - lat) * K });

export const inMap = (p: Pt): boolean => p.x >= 0 && p.y >= 0 && p.x <= MAP_W && p.y <= MAP_H;

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

/** Точка единицы (`pos` = [lat, lon]); null — если данных нет. */
export function posOf(u: PolskaUnit): Pt | null {
  const p = nums(u.raw.pos);
  return p.length >= 2 ? project(p[0]!, p[1]!) : null;
}

/** Линия реки в px (из `path` = [[lat, lon], …]). */
export function pathOf(u: PolskaUnit): Pt[] {
  const raw = u.raw.path;
  if (!Array.isArray(raw)) return [];
  const out: Pt[] = [];
  for (const q of raw) {
    const p = nums(q);
    if (p.length >= 2) out.push(project(p[0]!, p[1]!));
  }
  return out;
}

export function ringsOf(u: PolskaUnit): Rings | null {
  return REGION_RINGS[u.id] ?? NEIGHBOR_RINGS[u.id] ?? null;
}

/** Точка в кольце (чёт-нечет). */
export function inRing(p: Pt, r: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!;
    const yi = r[i + 1]!;
    const xj = r[j]!;
    const yj = r[j + 1]!;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const inRings = (p: Pt, rings: Rings): boolean => rings.some((r) => inRing(p, r));

/** Центр воеводства или соседа для подписи: центр масс самого большого кольца. */
export function centerOf(rings: Rings): Pt {
  const areaOf = (r: readonly number[]): number => {
    let a = 0;
    for (let i = 0; i < r.length; i += 2) a += r[i]! * r[(i + 3) % r.length]! - r[(i + 2) % r.length]! * r[i + 1]!;
    return a / 2;
  };
  let best = rings[0]!;
  for (const r of rings) if (Math.abs(areaOf(r)) > Math.abs(areaOf(best))) best = r;
  const a6 = areaOf(best) * 6;
  if (Math.abs(a6) < 1e-6) return { x: best[0]!, y: best[1]! };
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < best.length; i += 2) {
    const x0 = best[i]!;
    const y0 = best[i + 1]!;
    const x1 = best[(i + 2) % best.length]!;
    const y1 = best[(i + 3) % best.length]!;
    const c = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  return { x: cx / a6, y: cy / a6 };
}

/** Расстояние от точки до ломаной. */
export function distToPath(p: Pt, path: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Группа единиц по способу попадания. */
export type Group = 'city' | 'river' | 'region' | 'neighbor' | 'point';
export const groupOf = (u: PolskaUnit): Group => {
  switch (u.type) {
    case 'city':
      return 'city';
    case 'river':
      return 'river';
    case 'region':
      return 'region';
    case 'neighbor':
      return 'neighbor';
    default:
      return 'point';
  }
};

/** Допуск попадания, км: из задания `show` в данных (`hit_km`), иначе по группе. */
export function hitKm(u: PolskaUnit): number {
  const tasks = Array.isArray(u.raw.tasks) ? (u.raw.tasks as Record<string, unknown>[]) : [];
  const show = tasks.find((t) => t.t === 'show');
  if (show && typeof show.hit_km === 'number') return show.hit_km;
  return groupOf(u) === 'river' ? 12 : groupOf(u) === 'city' ? 25 : 40;
}

/** Минимальный допуск в px карты, чтобы по точке можно было попасть пальцем. */
const MIN_TOL: Record<Group, number> = { city: 8, point: 6, river: 7, region: 0, neighbor: 0 };
/** Точки одной группы ближе этого считаются «одним местом» (Tatry/Rysy/Morskie Oko): любая засчитывается. */
const SAME_PLACE = 7;
/** Города ближе этого (Kraków/Wieliczka, Gdańsk/Gdynia/Sopot) выбираются на второй ступени с увеличением. */
export const CLUSTER_PX = 8;

export const tolPx = (u: PolskaUnit): number => Math.max(hitKm(u) * PX_PER_KM, MIN_TOL[groupOf(u)]);

/** Расстояние от точки до единицы в px: до точки, до линии реки; для площадей 0 внутри и Infinity снаружи. */
export function distTo(p: Pt, u: PolskaUnit): number {
  const g = groupOf(u);
  if (g === 'river') return distToPath(p, pathOf(u));
  if (g === 'region' || g === 'neighbor') {
    const r = ringsOf(u);
    return r && inRings(p, r) ? 0 : Infinity;
  }
  const c = posOf(u);
  return c ? dist(p, c) : Infinity;
}

/**
 * Попал ли тап `p` в единицу `target`. Среди своей группы побеждает ближайшая (города: строго, горы и озёра: «одно место»
 * не мешает), расстояние не больше допуска. Воеводства и соседи — по полигонам (тап по чужому полигону — промах).
 */
export function hits(units: readonly PolskaUnit[], target: PolskaUnit, p: Pt): boolean {
  const g = groupOf(target);
  if (g === 'region' || g === 'neighbor') return distTo(p, target) === 0;
  const d = distTo(p, target);
  if (d > tolPx(target)) return false;
  const tc = posOf(target);
  for (const v of units) {
    if (v.id === target.id || groupOf(v) !== g) continue;
    const dv = distTo(p, v);
    if (dv >= d) continue;
    if (g === 'point' && tc) {
      const vc = posOf(v);
      if (vc && dist(tc, vc) < SAME_PLACE) continue;
    }
    return false;
  }
  return true;
}

/** Близкие города единицы (≤ CLUSTER_PX), включая её саму; одна — не кластер. */
export function clusterOf(units: readonly PolskaUnit[], target: PolskaUnit): PolskaUnit[] {
  if (groupOf(target) !== 'city') return [target];
  const tc = posOf(target);
  if (!tc) return [target];
  const out = units.filter((v) => {
    const vc = groupOf(v) === 'city' && v.id !== target.id ? posOf(v) : null;
    return !!vc && dist(vc, tc) <= CLUSTER_PX;
  });
  return out.length ? [target, ...out] : [target];
}

/** Середина набора единиц в px. */
export function centroid(units: readonly PolskaUnit[]): Pt {
  const pts = units.map(posOf).filter((p): p is Pt => !!p);
  if (!pts.length) return { x: MAP_W / 2, y: MAP_H / 2 };
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

/** Точка для подписи и флажка «верного места»: точка, середина реки, центр площади. */
export function anchorOf(u: PolskaUnit): Pt {
  const g = groupOf(u);
  if (g === 'river') {
    const path = pathOf(u);
    if (path.length) return path[Math.floor((path.length - 1) / 2)]!;
  }
  if (g === 'region' || g === 'neighbor') {
    const r = ringsOf(u);
    if (r) return centerOf(r);
  }
  return posOf(u) ?? { x: MAP_W / 2, y: MAP_H / 2 };
}
