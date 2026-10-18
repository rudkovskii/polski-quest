// Свои дела кота: когда герой стоит, Rudy перестаёт держаться вплотную и живёт в радиусе 3–5 клеток: бродит, умывается,
// нюхает грядку и цветы, выслеживает «бабочку» и прыгает, дремлет, сидит на заборе, у коробки, у радио, на ковре.
// Чистый TS без Phaser: решает, что делать дальше (приказ модели), сам по карте не ходит. Случай подставляют снаружи (seed).
import type { Dir } from '../types/input';
import type { Xy } from './ascii';

/** Герой стоит столько, и кот переходит к своим делам, мс. */
export const CAT_FREE_AFTER_MS = 3000;
/** Радиус жизни кота вокруг героя (по клеткам, Чебышёв). */
export const CAT_LIFE_MIN = 3;
export const CAT_LIFE_MAX = 5;
/** Пауза между делами, мс. */
export const CAT_PAUSE_MIN_MS = 3000;
export const CAT_PAUSE_MAX_MS = 8000;
/** После того как герой пошёл, кот доигрывает дело ещё столько, мс. */
export const CAT_REACT_MIN_MS = 500;
export const CAT_REACT_MAX_MS = 1000;
/** Прыжок кота на забор и обратно, мс. */
export const CAT_HOP_MS = 260;

export type LifeMode = 'follow' | 'sit' | 'wash' | 'sleep' | 'lie' | 'sniff' | 'crouch' | 'pounce';
export type LifeKind = 'wander' | 'sit' | 'wash' | 'lie' | 'sniff' | 'hunt' | 'perch' | 'box' | 'radio' | 'rug';

/** Место, куда кот ходит по делам: встать в `stand`, смотреть на `look`, запрыгнуть на `hop` (забор). */
export interface LifePlace {
  kind: 'sniff' | 'perch' | 'box' | 'radio' | 'rug';
  stand: Xy;
  look?: Xy;
  hop?: Xy;
}

export interface LifeHost {
  rand: () => number;
  hero: Xy;
  /** Размер карты в клетках. */
  size: Xy;
  /** Коту можно остановиться здесь: проходимо, не дверь, не подход, не клетка героя. */
  rest(c: Xy): boolean;
  /** Постоянные и временные места (забор, коробка, радио, ковёр, грядка, цветы), без проверки радиуса. */
  places(): LifePlace[];
}

interface Beat {
  mode: LifeMode;
  ms: number;
  face?: Dir | Xy;
  /** Прыжок на эту клетку (бит заканчивается, когда кот на ней). */
  hop?: Xy;
}

interface Plan {
  kind: LifeKind;
  goal: Xy;
  beats: Beat[];
}

/** Что модель должна сделать с котом сейчас. */
export type LifeOrder = { k: 'goto'; cell: Xy } | { k: 'hop'; cell: Xy } | { k: 'pose'; mode: LifeMode; face?: Dir | Xy };

const cheb = (a: Xy, b: Xy): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const eq = (a: Xy, b: Xy): boolean => a[0] === b[0] && a[1] === b[1];
const WEIGHT: Record<LifeKind, number> = { wander: 2, sit: 1, wash: 2, lie: 2, sniff: 2.5, hunt: 1.6, perch: 1.2, box: 1, radio: 1.5, rug: 1.5 };

export class CatLife {
  private plan: Plan | null = null;
  private beat = -1;
  private t = 0;
  private last: LifeKind | null = null;

  get active(): boolean {
    return this.plan !== null;
  }

  /** Текущее дело (для тестов и отладки). */
  get kind(): LifeKind | null {
    return this.plan?.kind ?? null;
  }

  reset(): void {
    this.plan = null;
    this.beat = -1;
    this.t = 0;
  }

  /** Дойти не вышло: короткая пауза на месте, потом новый выбор. */
  abort(rand: () => number): void {
    this.plan = { kind: 'sit', goal: [-1, -1], beats: [{ mode: 'sit', ms: pause(rand) }] };
    this.beat = 0;
    this.t = 0;
  }

  /** Раз в кадр, когда кот стоит на клетке. `at` — где кот. Возвращает приказ или null (нечего менять). */
  tick(dt: number, at: Xy, host: LifeHost): LifeOrder | null {
    if (!this.plan) {
      this.plan = this.pick(at, host);
      this.beat = -1;
      this.t = 0;
    }
    const p = this.plan;
    if (this.beat < 0) {
      if (!eq(at, p.goal)) return { k: 'goto', cell: p.goal };
      this.beat = 0;
      this.t = 0;
    }
    for (let guard = 0; guard < 8; guard++) {
      const b = p.beats[this.beat];
      if (!b) {
        // дело кончено: пауза уже была последним битом
        this.last = p.kind;
        this.reset();
        return null;
      }
      if (b.hop) {
        if (!eq(at, b.hop)) return { k: 'hop', cell: b.hop };
        this.beat++;
        this.t = 0;
        continue;
      }
      this.t += dt;
      if (this.t < b.ms) return { k: 'pose', mode: b.mode, face: b.face };
      this.beat++;
      this.t = 0;
      dt = 0;
    }
    return null;
  }

  private pick(at: Xy, host: LifeHost): Plan {
    const r = host.rand;
    const near = (c: Xy, lo: number): boolean => {
      const d = cheb(c, host.hero);
      return d >= lo && d <= CAT_LIFE_MAX && c[0] >= 0 && c[1] >= 0 && c[0] < host.size[0] && c[1] < host.size[1];
    };
    const ring = (lo: number): Xy[] => {
      const out: Xy[] = [];
      for (let dy = -CAT_LIFE_MAX; dy <= CAT_LIFE_MAX; dy++)
        for (let dx = -CAT_LIFE_MAX; dx <= CAT_LIFE_MAX; dx++) {
          const c: Xy = [host.hero[0] + dx, host.hero[1] + dy];
          if (near(c, lo) && host.rest(c)) out.push(c);
        }
      return out;
    };
    let cells = ring(CAT_LIFE_MIN);
    if (!cells.length) cells = ring(2);
    const places = host.places().filter((pl) => near(pl.stand, 2) && host.rest(pl.stand) && (!pl.hop || near(pl.hop, 2)));
    const cand: { kind: LifeKind; w: number }[] = [];
    const add = (kind: LifeKind, ok: boolean): void => {
      if (ok) cand.push({ kind, w: WEIGHT[kind] * (kind === this.last ? 0.15 : 1) });
    };
    const has = (k: LifePlace['kind']): boolean => places.some((pl) => pl.kind === k);
    add('wander', cells.length > 1);
    add('sit', true);
    add('wash', true);
    add('lie', cells.length > 0);
    add('hunt', cells.length > 0);
    for (const k of ['sniff', 'perch', 'box', 'radio', 'rug'] as const) add(k, has(k));
    let x = r() * cand.reduce((s, c) => s + c.w, 0);
    let kind: LifeKind = 'sit';
    for (const c of cand) {
      x -= c.w;
      if (x <= 0) {
        kind = c.kind;
        break;
      }
    }
    const here = host.rest(at) && cheb(at, host.hero) <= CAT_LIFE_MAX && cheb(at, host.hero) >= 2;
    const cell = (): Xy => (cells.length ? cells[Math.floor(r() * cells.length)]! : at);
    const goalHere = (): Xy => (here && r() < 0.6 ? at : cell());
    const place = (k: LifePlace['kind']): LifePlace => {
      const list = places.filter((pl) => pl.kind === k);
      return list[Math.floor(r() * list.length)]!;
    };
    const rest = (): Beat => ({ mode: 'sit', ms: pause(r) });
    switch (kind) {
      case 'wander':
        return { kind, goal: cell(), beats: [rest()] };
      case 'wash': {
        const g = goalHere();
        return { kind, goal: g, beats: [{ mode: 'sit', ms: 500 }, { mode: 'wash', ms: 3000 + r() * 2500 }, rest()] };
      }
      case 'lie': {
        const g = goalHere();
        return { kind, goal: g, beats: [{ mode: 'sit', ms: 600 }, { mode: 'lie', ms: 6000 + r() * 4000, face: r() < 0.5 ? 'left' : 'right' }, rest()] };
      }
      case 'hunt': {
        const g = goalHere();
        const face: Dir = r() < 0.5 ? 'left' : 'right';
        return { kind, goal: g, beats: [{ mode: 'crouch', ms: 1300 + r() * 1200, face }, { mode: 'pounce', ms: 480, face }, { mode: 'sit', ms: 900 }, rest()] };
      }
      case 'sniff': {
        const pl = place('sniff');
        return { kind, goal: pl.stand, beats: [{ mode: 'sniff', ms: 2200 + r() * 2000, face: pl.look }, rest()] };
      }
      case 'perch': {
        const pl = place('perch');
        return { kind, goal: pl.stand, beats: [{ mode: 'sit', ms: 200, face: pl.hop }, { mode: 'sit', ms: 0, hop: pl.hop! }, { mode: 'sit', ms: 4500 + r() * 3500 }, { mode: 'sit', ms: 0, hop: pl.stand }, rest()] };
      }
      case 'box':
      case 'radio': {
        const pl = place(kind);
        return { kind, goal: pl.stand, beats: [{ mode: 'sit', ms: 3500 + r() * 3500, face: pl.look }, rest()] };
      }
      case 'rug': {
        const pl = place('rug');
        const lie = r() < 0.5;
        return { kind, goal: pl.stand, beats: [{ mode: lie ? 'lie' : 'sit', ms: 4500 + r() * 4000, face: lie ? 'right' : pl.look }, rest()] };
      }
      default:
        return { kind: 'sit', goal: at, beats: [rest()] };
    }
  }
}

function pause(rand: () => number): number {
  return CAT_PAUSE_MIN_MS + rand() * (CAT_PAUSE_MAX_MS - CAT_PAUSE_MIN_MS);
}
