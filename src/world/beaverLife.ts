// Поведение бобра на карте фермы (просьба Шэфа 19.10). Чистый TS без Phaser, по образцу `catLife.ts`: решает, что бобёр делает дальше, сам
// двигается по клеткам; случай берёт из `host.rand` (сцена подставляет генератор от зерна визита, тесты — свой).
//
// Два вида жизни:
//   — `visit`: гость с края участка. Приходит, бродит `stayMs` (1–3 минуты): сидит, умывается, грызёт веточку у дерева, забора или куста,
//     смотрит на героя; потом уходит к ближайшему краю и исчезает (`gone`).
//   — `resident`: хозяин (с уровня 10, хатка и пруд на карте). Днём занят: грызёт, плавает и ныряет в пруду, выглядывает, сидит у хатки,
//     иногда прячется в неё; ночью (21:00–06:00) спит в хатке (`hidden`).
// Не мешает: никогда не встаёт на клетку героя и его следующего шага (герой шагнул на его клетку — бобёр отбегает), не стоит на дорожке,
// грядке и участке под грядки, у двери и точке входа, у объектов, с которыми взаимодействуют, и не пересекается с котом.
import type { Dir } from '../types/input';
import { isNight } from '../systems/beaver';
import type { Xy } from './ascii';
import { around, type LocationModel } from './location';
import { findPath, type Grid } from './pathfind';

/** Шаг бобра: неспешный, чуть медленнее героя (222 мс); бег — когда уходит или отбегает. */
export const BEAVER_STEP_MS = 330;
export const BEAVER_RUN_MS = 150;
/** Пауза между делами, мс. */
export const BEAVER_PAUSE_MIN_MS = 2500;
export const BEAVER_PAUSE_MAX_MS = 6000;
/** Радиус жизни хозяина вокруг двери хатки (по клеткам, Чебышёв). */
export const BEAVER_HOME_RADIUS = 8;
/** Гость уходит, но дойти не может: исчезает через столько, мс. */
const LEAVE_GIVEUP_MS = 15_000;

export type BeaverMode = 'walk' | 'run' | 'sit' | 'wash' | 'gnaw' | 'swim' | 'peek' | 'dive';
export type BeaverKind = 'visit' | 'resident';
type PlanKind = 'wander' | 'sit' | 'wash' | 'gnaw' | 'look' | 'swim' | 'hide' | 'sleep' | 'leave' | 'shore' | 'greet';

export interface BeaverStep {
  from: Xy;
  to: Xy;
  t: number;
  ms: number;
}

/** Что о бобре знает модель локации (кот не встаёт на его клетку, тап и A открывают «Bóbr»). */
export interface BeaverRef {
  tile: Xy;
  step: BeaverStep | null;
  /** Нарисован и доступен (не в хатке, не ушёл). */
  visible: boolean;
}

/** Где грызть: встать в `stand`, смотреть на `look` (дерево, забор, куст). */
export interface GnawSpot {
  stand: Xy;
  look: Xy;
}

/** Хатка и пруд: `door` — клетка у лаза, `water` — клетки пруда (плавает), `shore` — берег рядом с водой. */
export interface BeaverHome {
  door: Xy;
  water: Xy[];
  shore: Xy[];
}

export interface BeaverHost {
  rand: () => number;
  /** Размер карты в клетках. */
  size: Xy;
  hero: Xy;
  /** Клетка, куда герой ступает (или его клетка, если стоит). */
  heroNext: Xy;
  heroBusy: boolean;
  /** Клетки кота: где стоит и куда идёт. */
  cat: readonly Xy[];
  /** Местный час 0…24. */
  hour: number;
  /** Суша, по которой можно пройти (не стена, не дверь, не грядка, не вода). */
  walk(c: Xy): boolean;
  /** Можно остановиться: суша, не дорожка, не вход, не подход к двери и объектам, не перед героем. */
  rest(c: Xy): boolean;
  water(c: Xy): boolean;
  spots(): GnawSpot[];
  /** Клетки у края участка, откуда гость приходит и куда уходит. */
  edge(): Xy[];
  home: BeaverHome | null;
}

type Face = Dir | 'hero' | Xy;
type Beat = { k: 'go'; cell: Xy; water?: boolean; run?: boolean } | { k: 'pose'; mode: BeaverMode; ms: number; face?: Face; hide?: boolean; nightly?: boolean };
interface Plan {
  kind: PlanKind;
  beats: Beat[];
}

const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];
const DELTA: Record<Dir, Xy> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const eq = (a: Xy, b: Xy): boolean => a[0] === b[0] && a[1] === b[1];
const cheb = (a: Xy, b: Xy): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const dirBetween = (from: Xy, to: Xy): Dir => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
};
const WEIGHT: Record<'wander' | 'sit' | 'wash' | 'gnaw' | 'look' | 'swim' | 'hide', number> = { wander: 2, sit: 1.5, wash: 1.5, gnaw: 3, look: 2, swim: 3, hide: 0.6 };

export class BeaverLife implements BeaverRef {
  tile: Xy = [0, 0];
  facing: Dir = 'down';
  step: BeaverStep | null = null;
  mode: BeaverMode = 'sit';
  /** Сколько в текущем режиме, мс. */
  since = 0;
  /** Нарисован. */
  visible = false;
  /** Гость ушёл, хозяина нет (нет хатки): живой бобёр не нужен. */
  gone = false;
  /** Сидит в хатке (хозяин): не виден. */
  hidden = false;
  /** Последний взгляд вбок: плывёт и грызёт боком даже когда идёт вверх-вниз. */
  side: 'left' | 'right' = 'right';
  readonly kind: BeaverKind;
  private plan: Plan | null = null;
  private beat = 0;
  private t = 0;
  private posed = false;
  private last: PlanKind | null = null;
  private stayLeft: number;
  private leaving = false;
  private leaveT = 0;

  constructor(kind: BeaverKind, host: BeaverHost, opts: { stayMs?: number; hour?: number } = {}) {
    this.kind = kind;
    this.stayLeft = opts.stayMs ?? 120_000;
    if (kind === 'visit') {
      const cells = host.edge().filter((c) => host.rest(c) && this.free(c, host));
      if (!cells.length) {
        this.gone = true;
        return;
      }
      this.tile = cells[Math.floor(host.rand() * cells.length)]!;
      this.facing = this.inward(this.tile, host);
      this.visible = true;
    } else {
      if (!host.home) {
        this.gone = true;
        return;
      }
      this.tile = [host.home.door[0], host.home.door[1]];
      this.facing = 'down';
      this.visible = true;
      if (isNight(host.hour)) this.tuckIn();
    }
    if (this.facing === 'left' || this.facing === 'right') this.side = this.facing;
  }

  /** Тот, кто сейчас занимает клетку `c` (для кота): клетка и цель шага. */
  occupies(c: Xy): boolean {
    return this.visible && (eq(this.tile, c) || (this.step !== null && eq(this.step.to, c)));
  }

  /** Герой заговорил с бобром: повернуться к нему и немного посидеть (в воде — выглянуть). */
  greet(host: BeaverHost): void {
    if (this.gone || this.hidden || !this.visible) return;
    const inWater = host.water(this.tile) || (this.step !== null && host.water(this.step.to));
    this.plan = { kind: 'greet', beats: [{ k: 'pose', mode: inWater ? 'peek' : 'sit', ms: 3500, face: 'hero' }] };
    this.beat = 0;
    this.t = 0;
    this.posed = false;
  }

  update(dt: number, host: BeaverHost): void {
    this.since += dt;
    if (this.gone) return;
    if (this.kind === 'visit') {
      if (!this.leaving) {
        this.stayLeft -= dt;
        if (this.stayLeft <= 0) this.beginLeave(host);
      } else {
        this.leaveT += dt;
        if (this.leaveT >= LEAVE_GIVEUP_MS) return this.vanish();
      }
    }
    if (this.step) {
      const st = this.step;
      // Герой шагает на клетку, куда идёт бобёр: передумал, вернулся на прежнюю.
      if (eq(st.to, host.heroNext) && !eq(st.from, host.heroNext) && !eq(st.from, host.hero)) {
        this.step = { from: st.to, to: st.from, t: Math.max(0, st.ms - st.t), ms: st.ms };
        this.facing = dirBetween(st.to, st.from);
        this.remember();
      }
      this.step.t += dt;
      if (this.step.t < this.step.ms) return;
      this.tile = this.step.to;
      this.step = null;
      this.since = 0;
      this.mode = host.water(this.tile) ? 'swim' : 'sit';
    }
    if (!this.hidden && (eq(this.tile, host.hero) || eq(this.tile, host.heroNext))) {
      if (this.flee(host)) return;
    }
    this.run(dt, host);
  }

  // ───────────── дела ─────────────

  private free(c: Xy, host: BeaverHost): boolean {
    return !eq(c, host.hero) && !eq(c, host.heroNext) && !host.cat.some((k) => eq(k, c));
  }

  private inward(c: Xy, host: BeaverHost): Dir {
    return dirBetween(c, [Math.round(host.size[0] / 2), Math.round(host.size[1] / 2)]);
  }

  private remember(): void {
    if (this.facing === 'left' || this.facing === 'right') this.side = this.facing;
  }

  private tuckIn(): void {
    this.hidden = true;
    this.visible = false;
    this.plan = { kind: 'sleep', beats: [{ k: 'pose', mode: 'sit', ms: 20_000, hide: true, nightly: true }] };
    this.beat = 0;
    this.t = 0;
    this.posed = true;
  }

  private vanish(): void {
    this.gone = true;
    this.visible = false;
    this.step = null;
  }

  private beginLeave(host: BeaverHost): void {
    this.leaving = true;
    this.leaveT = 0;
    const edge = host.edge().filter((c) => host.rest(c) || host.walk(c));
    let best: Xy | null = null;
    for (const c of edge) if (!best || cheb(c, this.tile) < cheb(best, this.tile)) best = c;
    this.plan = { kind: 'leave', beats: best ? [{ k: 'go', cell: best }] : [] };
    this.beat = 0;
    this.t = 0;
    this.posed = false;
  }

  /** Герой наступает на клетку бобра: отбежать на соседнюю. */
  private flee(host: BeaverHost): boolean {
    let best: Xy | null = null;
    let bestD = -1;
    for (const d of DIRS) {
      const c: Xy = [this.tile[0] + DELTA[d][0], this.tile[1] + DELTA[d][1]];
      if (!(host.walk(c) || (host.water(this.tile) && host.water(c))) || !this.free(c, host)) continue;
      const dist = Math.abs(c[0] - host.hero[0]) + Math.abs(c[1] - host.hero[1]);
      if (dist > bestD) {
        bestD = dist;
        best = c;
      }
    }
    if (!best) return false;
    this.plan = null;
    this.beat = 0;
    this.go(best, BEAVER_RUN_MS, host);
    return true;
  }

  private go(to: Xy, ms: number, host: BeaverHost): void {
    this.facing = dirBetween(this.tile, to);
    this.remember();
    this.step = { from: this.tile, to, t: 0, ms };
    this.mode = host.water(to) || host.water(this.tile) ? 'swim' : ms <= BEAVER_RUN_MS ? 'run' : 'walk';
    this.since = 0;
  }

  private grid(host: BeaverHost, water: boolean): Grid {
    return { w: host.size[0], h: host.size[1], passable: (x, y) => this.free([x, y], host) && (host.walk([x, y]) || (water && host.water([x, y]))) };
  }

  private abort(host: BeaverHost): void {
    this.plan = { kind: 'sit', beats: [{ k: 'pose', mode: 'sit', ms: this.pause(host) }] };
    this.beat = 0;
    this.t = 0;
    this.posed = false;
  }

  private pause(host: BeaverHost): number {
    return BEAVER_PAUSE_MIN_MS + host.rand() * (BEAVER_PAUSE_MAX_MS - BEAVER_PAUSE_MIN_MS);
  }

  private run(dt: number, host: BeaverHost): void {
    if (this.kind === 'resident' && !this.hidden && isNight(host.hour) && host.home && this.plan?.kind !== 'sleep') this.plan = null;
    if (!this.plan) {
      this.plan = this.pick(host);
      this.beat = 0;
      this.t = 0;
      this.posed = false;
    }
    for (let guard = 0; guard < 8; guard++) {
      const p = this.plan!;
      const b = p.beats[this.beat];
      if (!b) {
        // Дело кончено.
        if (p.kind === 'leave') return this.vanish();
        this.last = p.kind;
        this.plan = null;
        if (this.mode !== 'sit' && !this.step) this.mode = host.water(this.tile) ? 'swim' : 'sit';
        return;
      }
      if (b.k === 'go') {
        if (eq(this.tile, b.cell)) {
          this.beat++;
          this.t = 0;
          this.posed = false;
          continue;
        }
        const res = findPath(this.grid(host, !!b.water), this.tile, b.cell);
        const nxt = res.path[0];
        if (!nxt || !res.exact) {
          if (p.kind === 'leave') return this.vanish();
          return this.abort(host);
        }
        this.go(nxt, b.run || this.leaving ? BEAVER_STEP_MS * 0.7 : BEAVER_STEP_MS, host);
        return;
      }
      if (!this.posed) {
        this.posed = true;
        this.mode = b.mode;
        this.since = 0;
        if (b.hide) {
          this.hidden = true;
          this.visible = false;
        }
        if (b.face) {
          this.facing = b.face === 'hero' ? dirBetween(this.tile, host.hero) : typeof b.face === 'string' ? b.face : dirBetween(this.tile, b.face);
          this.remember();
        }
      }
      this.t += dt;
      if (this.t < b.ms) return;
      if (b.nightly && isNight(host.hour)) {
        this.t = 0;
        return;
      }
      if (b.hide && !this.free(this.tile, host)) {
        // Герой стоит у лаза: бобёр ждёт внутри.
        this.t = Math.max(0, b.ms - 300);
        return;
      }
      if (b.hide) {
        // Вышел из хатки: сидит у лаза.
        this.hidden = false;
        this.visible = true;
        this.mode = 'sit';
        this.facing = 'down';
      }
      this.beat++;
      this.t = 0;
      this.posed = false;
      dt = 0;
    }
  }

  private pick(host: BeaverHost): Plan {
    const r = host.rand;
    const resident = this.kind === 'resident' && host.home;
    const home = host.home;
    if (resident && home && isNight(host.hour)) return { kind: 'sleep', beats: [{ k: 'go', cell: home.door }, { k: 'pose', mode: 'sit', ms: 20_000, hide: true, nightly: true }] };
    if (host.water(this.tile) && home) {
      const shore = home.shore.filter((c) => this.free(c, host));
      const s = shore.length ? shore[Math.floor(r() * shore.length)]! : home.door;
      return { kind: 'shore', beats: [{ k: 'go', cell: s }, { k: 'pose', mode: 'sit', ms: 1500 }] };
    }
    const anchor: Xy = resident && home ? home.door : this.tile;
    const radius = resident ? BEAVER_HOME_RADIUS : 9;
    const cells: Xy[] = [];
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const c: Xy = [anchor[0] + dx, anchor[1] + dy];
        if (c[0] < 0 || c[1] < 0 || c[0] >= host.size[0] || c[1] >= host.size[1]) continue;
        if (host.rest(c) && this.free(c, host) && cheb(c, host.hero) >= 2) cells.push(c);
      }
    const spots = host.spots().filter((s) => cheb(s.stand, anchor) <= radius + 4 && host.rest(s.stand) && this.free(s.stand, host) && cheb(s.stand, host.hero) >= 2);
    const heroNear = cheb(this.tile, host.hero) <= 9 && !host.heroBusy;
    const cand: { kind: keyof typeof WEIGHT; w: number }[] = [];
    const add = (kind: keyof typeof WEIGHT, ok: boolean): void => {
      if (ok) cand.push({ kind, w: WEIGHT[kind] * (kind === this.last ? 0.15 : 1) });
    };
    add('wander', cells.length > 1);
    add('sit', true);
    add('wash', true);
    add('gnaw', spots.length > 0);
    add('look', heroNear);
    add('swim', !!resident && !!home && home.water.length >= 2 && home.shore.length > 0);
    add('hide', !!resident && !!home);
    let x = r() * cand.reduce((s, c) => s + c.w, 0);
    let kind: keyof typeof WEIGHT = 'sit';
    for (const c of cand) {
      x -= c.w;
      if (x <= 0) {
        kind = c.kind;
        break;
      }
    }
    const cell = (): Xy => (cells.length ? cells[Math.floor(r() * cells.length)]! : this.tile);
    const rest = (): Beat => ({ k: 'pose', mode: 'sit', ms: this.pause(host) });
    switch (kind) {
      case 'wander':
        return { kind, beats: [{ k: 'go', cell: cell() }, rest()] };
      case 'wash':
        return { kind, beats: [{ k: 'pose', mode: 'sit', ms: 500 }, { k: 'pose', mode: 'wash', ms: 3000 + r() * 2500, face: 'down' }, rest()] };
      case 'gnaw': {
        const s = spots[Math.floor(r() * spots.length)]!;
        const face: Dir = s.look[0] < s.stand[0] ? 'left' : s.look[0] > s.stand[0] ? 'right' : r() < 0.5 ? 'left' : 'right';
        return { kind, beats: [{ k: 'go', cell: s.stand }, { k: 'pose', mode: 'gnaw', ms: 6000 + r() * 5000, face }, rest()] };
      }
      case 'look': {
        const near = cells.filter((c) => cheb(c, host.hero) <= 4);
        const g = near.length ? near[Math.floor(r() * near.length)]! : this.tile;
        return { kind, beats: [{ k: 'go', cell: g }, { k: 'pose', mode: 'sit', ms: 4000 + r() * 4000, face: 'hero' }, rest()] };
      }
      case 'swim': {
        const h = home!;
        const water = [...h.water];
        const pickW = (): Xy => water.splice(Math.floor(r() * water.length), 1)[0]!;
        const a = pickW();
        const b = pickW();
        const c = water.length ? pickW() : a;
        const shore = h.shore.filter((s) => this.free(s, host));
        const s1 = shore.length ? shore[Math.floor(r() * shore.length)]! : h.door;
        const s2 = shore.length ? shore[Math.floor(r() * shore.length)]! : h.door;
        return {
          kind,
          beats: [
            { k: 'go', cell: s1 },
            { k: 'go', cell: a, water: true },
            { k: 'pose', mode: 'dive', ms: 700 },
            { k: 'go', cell: b, water: true },
            { k: 'pose', mode: 'peek', ms: 2200 + r() * 1500, face: 'down' },
            { k: 'go', cell: c, water: true },
            { k: 'pose', mode: 'swim', ms: 1500 + r() * 2000 },
            { k: 'go', cell: s2 },
            rest(),
          ],
        };
      }
      case 'hide':
        return { kind, beats: [{ k: 'go', cell: home!.door }, { k: 'pose', mode: 'sit', ms: 8000 + r() * 12_000, hide: true }, rest()] };
      default:
        return { kind: 'sit', beats: [{ k: 'pose', mode: 'sit', ms: this.pause(host), face: heroNear && r() < 0.5 ? 'hero' : undefined }] };
    }
  }
}

// ───────────── склейка с моделью локации ─────────────

const inRectXY = (r: readonly [number, number, number, number], [x, y]: Xy): boolean => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];

/**
 * Хост бобра на модели локации: что проходимо, где можно остановиться, где грызть, откуда приходить. Считает один раз (карта не
 * меняется), положение героя и кота читает каждый раз заново.
 */
export function beaverHost(model: LocationModel, o: { rand: () => number; hour: () => number }): BeaverHost {
  const { w, h } = model.parsed;
  const legend = model.map.legend;
  const tileOf = (c: Xy): string => legend[model.parsed.ground[c[1]]![c[0]]!]?.tile ?? '';
  const plots = model.objects.filter((x) => x.kind === 'plot').flatMap((x) => {
    const src = x.src as { at: [number, number]; size: [number, number]; reserve?: { at: [number, number]; size: [number, number] } };
    const rs: [number, number, number, number][] = [[src.at[0], src.at[1], src.size[0], src.size[1]]];
    if (src.reserve) rs.push([src.reserve.at[0], src.reserve.at[1], src.reserve.size[0], src.reserve.size[1]]);
    return rs;
  });
  // Ограда участка тоже не место для бобра: клетки между забором и грядками остаются «участком», внутри ограды ему делать нечего.
  const inPlot = (c: Xy): boolean => plots.some((r) => inRectXY([r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2], c));
  const pond = model.objects.find((x) => x.id === 'beaver_pond');
  const lodge = model.objects.find((x) => x.id === 'beaver_lodge');
  const waterCells: Xy[] = [];
  if (pond) for (let y = pond.at[1]; y < pond.at[1] + pond.size[1]; y++) for (let x = pond.at[0]; x < pond.at[0] + pond.size[0]; x++) waterCells.push([x, y]);
  const isWater = (c: Xy): boolean => waterCells.some((k) => eq(k, c));
  const exits = model.objects.filter((x) => x.kind === 'exit').map((x) => x.at);
  const spawns = Object.values(model.map.spawns).map((s): Xy => [s[0], s[1]]);
  const approaches: Xy[] = model.objects.filter((x) => x.use && x.kind === 'prop').flatMap((x) => around(x.rects));
  const land = (c: Xy): boolean => c[0] >= 0 && c[1] >= 0 && c[0] < w && c[1] < h && model.passable(c[0], c[1]) && !model.isExit(c) && tileOf(c) !== 'soil' && !inPlot(c) && !isWater(c);
  const nearOf = (list: readonly Xy[], c: Xy): boolean => list.some((k) => Math.abs(k[0] - c[0]) + Math.abs(k[1] - c[1]) <= 1);
  const stable = (c: Xy): boolean => land(c) && tileOf(c) !== 'path' && !nearOf(exits, c) && !spawns.some((s) => eq(s, c)) && !approaches.some((a) => eq(a, c));
  const rest = (c: Xy): boolean => {
    if (!stable(c)) return false;
    const p = model.player;
    const f: Xy = [p.tile[0] + DELTA[p.facing][0], p.tile[1] + DELTA[p.facing][1]];
    return !eq(c, p.tile) && !eq(c, f) && !(c[0] === p.tile[0] && c[1] === p.tile[1] - 1);
  };
  const nbrs = (c: Xy): Xy[] => DIRS.map((d): Xy => [c[0] + DELTA[d][0], c[1] + DELTA[d][1]]);
  let spotsCache: GnawSpot[] | null = null;
  const spots = (): GnawSpot[] => {
    if (spotsCache) return spotsCache;
    const out: GnawSpot[] = [];
    const targets: Xy[] = [];
    for (const x of model.objects) if (x.kind === 'prop' && (x.id.startsWith('tree') || x.id.startsWith('bush'))) targets.push(x.at);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (model.parsed.deco[y]![x] && model.parsed.solid[y]![x]) targets.push([x, y]);
    for (const t of targets) for (const s of nbrs(t)) if (stable(s) && !out.some((k) => eq(k.stand, s))) out.push({ stand: s, look: t });
    spotsCache = out;
    return out;
  };
  let edgeCache: Xy[] | null = null;
  const edge = (): Xy[] => {
    if (edgeCache) return edgeCache;
    const out: Xy[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c: Xy = [x, y];
        if (!land(c)) continue;
        // У самой кромки: рядом выход за карту или непроходимая земля (деревья по периметру).
        const border = nbrs(c).some((n) => n[0] < 0 || n[1] < 0 || n[0] >= w || n[1] >= h || model.parsed.solid[n[1]]![n[0]]);
        if (border && cheb(c, [Math.floor(w / 2), Math.floor(h / 2)]) >= Math.min(w, h) / 2 - 2) out.push(c);
      }
    edgeCache = out;
    return out;
  };
  let homeCache: BeaverHome | null | undefined;
  const home = (): BeaverHome | null => {
    if (homeCache !== undefined) return homeCache;
    if (!pond || !lodge) return (homeCache = null);
    const shore: Xy[] = [];
    for (const wc of waterCells) for (const n of nbrs(wc)) if (land(n) && !shore.some((s) => eq(s, n))) shore.push(n);
    const door: Xy = [lodge.at[0] + lodge.size[0] - 1, lodge.at[1] + lodge.size[1]];
    return (homeCache = { door, water: waterCells, shore });
  };
  return {
    rand: o.rand,
    size: [w, h],
    get hero() {
      return model.player.tile;
    },
    get heroNext() {
      return model.player.step ? model.player.step.to : model.player.tile;
    },
    get heroBusy() {
      return model.busy;
    },
    get cat() {
      const c = model.cat;
      return c ? (c.step ? [c.tile, c.step.to] : [c.tile]) : [];
    },
    get hour() {
      return o.hour();
    },
    walk: land,
    rest,
    water: isWater,
    spots,
    edge,
    get home() {
      return home();
    },
  };
}
