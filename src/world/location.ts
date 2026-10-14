// Модель локации (ТЗ §2.7, §5.4–5.5): движение по клеткам по intents, путь по тапу, кнопка действия,
// подсветка цели, выходы, триггеры, бобр-компаньон. Чистый TS без Phaser: сцена Location рисует
// состояние и переводит события модели в шину, тесты гоняют модель напрямую.
import type { LocationMap, MapObject } from '../types/content';
import type { Dir, Intent, MapControls } from '../types/input';
import { parseAscii, type ParsedMap, type Xy } from './ascii';
import { findPath, pathToAdjacent, type Grid } from './pathfind';

/** Скорость ходьбы: 4,5 клетки в секунду (P-02, исследование §6в п. 2: «~4–5 клеток в секунду»). */
export const CELLS_PER_SEC = 4.5;
export const STEP_MS = 1000 / CELLS_PER_SEC;
/**
 * Поворот на месте (P-02): нажатие в сторону, куда Дима не смотрит, сначала только разворачивает его.
 * Держишь дольше TURN_MS — пошёл; отпустил раньше — просто повернулся. Как в Pokémon/Stardew на крестовине.
 */
export const TURN_MS = 90;

export const DELTA: Record<Dir, Xy> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const DIR_ORDER: readonly Dir[] = ['up', 'right', 'down', 'left'];

export type ObjKind = MapObject['type'];

export interface WorldObject {
  /** Ключ для тапа и подсветки: `npc:bobr`, `word:tablica_wyjscie`, `exit:5,9`, `plot:grzadki`… */
  key: string;
  kind: ObjKind;
  id: string;
  at: Xy;
  size: Xy;
  /** Клетки объекта непроходимы (NPC, слово, табличка, доска). */
  solid: boolean;
  src: MapObject;
}

export type InteractVia = 'action' | 'tap' | 'enter';

export interface InteractEvent {
  type: 'interact';
  kind: Exclude<ObjKind, 'exit'>;
  id: string;
  key: string;
  /** Клетка объекта, с которой взаимодействовали (для грядки — конкретная клетка). */
  tile: Xy;
  via: InteractVia;
  /** Куда смотрит Дима (NPC может развернуться к нему). */
  facing: Dir;
  item?: string;
  ex?: string;
}
export interface ExitEvent {
  type: 'exit';
  to: string;
  spawn?: string;
  tile: Xy;
}
export interface BumpEvent {
  type: 'bump';
  dir: Dir;
}
export interface StepEvent {
  type: 'step';
  from: Xy;
  to: Xy;
}
export type WorldEvent = InteractEvent | ExitEvent | BumpEvent | StepEvent;

export interface Actor {
  tile: Xy;
  facing: Dir;
  /** Текущий шаг: из from в to, прошло t мс из STEP_MS. */
  step: { from: Xy; to: Xy; t: number } | null;
}

export interface LocationOptions {
  /** Бобр идёт следом (walk-локации без своего NPC bobr). По умолчанию по правилу выше. */
  companion?: boolean;
  facing?: Dir;
}

const eq = (a: Xy, b: Xy): boolean => a[0] === b[0] && a[1] === b[1];
const adjacent = (a: Xy, b: Xy): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

/** Ключ Казика: NPC `bobr` на карте или бобр-компаньон, который идёт следом (P-10a: цель шага «поговори: Kazik»). */
export const BOBR_KEY = 'npc:bobr';

/** Цель режиссёра для кнопки A (P-10a): что подсвечено контуром. Для компаньона клетка берётся живая. */
export interface ActionGoal {
  key: string;
  at: Xy;
  size: Xy;
  viaExit: boolean;
}
const dirBetween = (from: Xy, to: Xy): Dir => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
};

function keyOf(o: MapObject): { key: string; id: string } {
  switch (o.type) {
    case 'npc':
    case 'word':
    case 'trigger':
    case 'plot':
    case 'secret':
      return { key: `${o.type}:${o.id}`, id: o.id };
    case 'board':
      return { key: `board:${o.board}`, id: o.board };
    case 'exit':
    case 'sign': {
      const id = `${o.at[0]},${o.at[1]}`;
      return { key: `${o.type}:${id}`, id };
    }
  }
}

export function buildObjects(map: LocationMap): WorldObject[] {
  return map.objects.map((o) => {
    const { key, id } = keyOf(o);
    const size: Xy = 'size' in o && o.size ? [o.size[0], o.size[1]] : [1, 1];
    const solid = o.type === 'npc' || o.type === 'word' || o.type === 'sign' || o.type === 'board';
    return { key, kind: o.type, id, at: [o.at[0], o.at[1]], size, solid, src: o };
  });
}

const covers = (o: WorldObject, [x, y]: Xy): boolean =>
  x >= o.at[0] && y >= o.at[1] && x < o.at[0] + o.size[0] && y < o.at[1] + o.size[1];

export class LocationModel {
  readonly map: LocationMap;
  readonly parsed: ParsedMap;
  readonly controls: MapControls;
  readonly objects: WorldObject[];
  readonly player: Actor;
  readonly companion: Actor | null;
  /** Выделенный объект в tap-локации (Tab/стрелки, ТЗ §2.7). */
  selected: string | null = null;
  /**
   * Грядки (P-02): клетка `x,y` → с ней можно что-то сделать (растёт слово → полив; пусто и есть семя → посадка).
   * null — сведений о грядках ещё нет (`world:marks` не пришёл): любая клетка грядки — цель, как раньше.
   */
  private garden: Map<string, boolean> | null = null;
  /** Сколько ещё ждать до первого шага после поворота на месте, мс (0 — не ждём). */
  private turnWait = 0;

  private heldDir: Dir | null = null;
  /** Короткое нажатие во время шага: ещё один шаг после него (иначе быстрые тапы стрелки теряются). */
  private queuedDir: Dir | null = null;
  private bumped = false;
  private path: Xy[] = [];
  private pending: { key: string; tile: Xy | null } | null = null;
  private actionQueued = false;
  private fired = new Set<string>();
  private exited = false;
  private out: WorldEvent[] = [];
  private solidObj: boolean[][];
  readonly grid: Grid;
  /** Объекты с ложным `if` (§3.7, I-13): не видны, не цель, не препятствие. */
  private hidden = new Set<string>();
  /** Бобр-указатель (§4.12, I-13): клетка у цели режиссёра; null — идёт следом за Димой. */
  private pointGoal: Xy | null = null;
  private pointFace: Dir | null = null;
  private companionPath: Xy[] = [];
  /** Цель режиссёра (P-10a): A сначала берёт её, если она перед лицом или рядом. */
  private goal: ActionGoal | null = null;

  constructor(map: LocationMap, spawn: Xy, opts: LocationOptions = {}) {
    this.map = map;
    this.parsed = parseAscii(map);
    this.controls = map.controls;
    this.objects = buildObjects(map);
    const { w, h } = this.parsed;
    this.solidObj = [];
    this.rebuildSolid();
    this.grid = { w, h, passable: (x, y) => this.passable(x, y) };
    this.player = { tile: [spawn[0], spawn[1]], facing: opts.facing ?? 'down', step: null };
    const wantCompanion = opts.companion ?? (map.controls === 'walk' && !this.objects.some((o) => o.key === 'npc:bobr'));
    this.companion = wantCompanion ? { tile: this.companionSpawn(), facing: this.player.facing, step: null } : null;
  }

  private rebuildSolid(): void {
    const { w, h } = this.parsed;
    this.solidObj = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
    for (const o of this.objects)
      if (o.solid && !this.hidden.has(o.key))
        for (let y = o.at[1]; y < o.at[1] + o.size[1]; y++)
          for (let x = o.at[0]; x < o.at[0] + o.size[0]; x++) if (y < h && x < w) this.solidObj[y]![x] = true;
  }

  // ───────────── режиссёр (I-13) ─────────────

  /** Скрыть объекты с ложным `if` (ключи). Возвращает true, если набор изменился. */
  setHidden(keys: Iterable<string>): boolean {
    const next = new Set(keys);
    if (next.size === this.hidden.size && [...next].every((k) => this.hidden.has(k))) return false;
    this.hidden = next;
    if (this.selected && next.has(this.selected)) this.selected = null;
    this.rebuildSolid();
    return true;
  }

  isHidden(key: string): boolean {
    return this.hidden.has(key);
  }

  /**
   * Что растёт на грядках (P-02, из `world:marks`): клетка со словом — цель полива; пустая клетка — цель
   * посадки, только если есть семена (`seeds > 0`). Пустая клетка без семян — просто земля под ногами.
   */
  setGarden(cells: readonly { at: readonly [number, number]; item?: string }[], seeds: number): void {
    const g = new Map<string, boolean>();
    for (const c of cells) g.set(`${c.at[0]},${c.at[1]}`, !!c.item || seeds > 0);
    this.garden = g;
  }

  /** Переставить объект (бобр на działce садится у нужной грядки). */
  moveObject(key: string, at: Xy): boolean {
    const o = this.objects.find((x) => x.key === key);
    if (!o || (o.at[0] === at[0] && o.at[1] === at[1])) return false;
    // На клетку Димы (и куда он шагает) NPC не встаёт (P-10a: Казик на клетке игрока).
    if (o.solid && this.isReserved(at)) return false;
    o.at = [at[0], at[1]];
    this.rebuildSolid();
    return true;
  }

  /** Бобр идёт к клетке `goal` и смотрит в сторону `face`; null — снова следом за Димой. */
  pointTo(goal: Xy | null, face: Dir | null = null): void {
    const c = this.companion;
    if (!c) return;
    const same = goal && this.pointGoal && goal[0] === this.pointGoal[0] && goal[1] === this.pointGoal[1];
    this.pointFace = face;
    if (same) return;
    this.pointGoal = goal ? [goal[0], goal[1]] : null;
    this.companionPath = goal ? findPath({ w: this.parsed.w, h: this.parsed.h, passable: (x, y) => this.passable(x, y) }, c.step ? c.step.to : c.tile, goal).path : [];
  }

  get pointing(): Xy | null {
    return this.pointGoal;
  }

  /** Цель режиссёра для A (P-10a): контур, который видит игрок. null — цели на карте нет. */
  setGoal(g: ActionGoal | null): void {
    this.goal = g ? { key: g.key, at: [g.at[0], g.at[1]], size: [g.size[0], g.size[1]], viaExit: g.viaExit } : null;
  }

  /** Цель — сам бобр-компаньон (на карте нет NPC `bobr`). */
  get companionIsGoal(): boolean {
    return this.goal?.key === BOBR_KEY && !!this.companion && !this.objects.some((o) => o.key === BOBR_KEY);
  }

  /** Клетки, которые заняты Димой сейчас и вот-вот: клетка, куда он шагает, и конец пути. NPC и бобр туда не встают. */
  reserved(): Xy[] {
    const out: Xy[] = [this.player.tile];
    if (this.player.step) out.push(this.player.step.to);
    const end = this.path[this.path.length - 1];
    if (end) out.push(end);
    return out;
  }

  private isReserved(c: Xy): boolean {
    return this.reserved().some((r) => eq(r, c));
  }

  /** Бобр-компаньон как объект (для A и тапа): только если на карте нет NPC `bobr`. */
  private companionObject(): WorldObject | undefined {
    const c = this.companion;
    if (!c || this.objects.some((o) => o.key === BOBR_KEY)) return undefined;
    const at: Xy = c.step ? c.step.to : c.tile;
    return { key: BOBR_KEY, kind: 'npc', id: 'bobr', at, size: [1, 1], solid: false, src: { type: 'npc', id: 'bobr', at: [at[0], at[1]] } };
  }

  private updateCompanion(dt: number): void {
    const c = this.companion;
    if (!c || !this.pointGoal) return;
    let budget = dt;
    for (let guard = 0; guard < 8; guard++) {
      if (c.step) {
        const need = STEP_MS - c.step.t;
        if (budget < need) {
          c.step.t += budget;
          return;
        }
        budget -= need;
        c.tile = c.step.to;
        c.step = null;
        continue;
      }
      let nxt = this.companionPath.shift();
      if (!nxt && !eq(c.tile, this.pointGoal) && guard === 0) {
        // Путь кончился не у цели (упёрся в Диму или в NPC): пересчитать один раз за кадр.
        this.companionPath = findPath(this.grid, c.tile, this.pointGoal).path;
        nxt = this.companionPath.shift();
      }
      if (!nxt) {
        if (this.pointFace) c.facing = this.pointFace;
        return;
      }
      if (!this.passable(nxt[0], nxt[1])) {
        this.companionPath = [];
        return;
      }
      if (this.isReserved(nxt)) {
        // Клетка Димы (P-10a): Казик не встаёт на неё — обходит; обойти нельзя или это сама цель — ждёт рядом.
        const around = eq(nxt, this.pointGoal) ? null : findPath({ w: this.parsed.w, h: this.parsed.h, passable: (x, y) => this.passable(x, y) && !this.isReserved([x, y]) }, c.tile, this.pointGoal);
        if (around?.exact && around.path.length) {
          this.companionPath = around.path;
          continue;
        }
        this.companionPath = [];
        if (this.pointFace) c.facing = this.pointFace;
        return;
      }
      c.facing = dirBetween(c.tile, nxt);
      c.step = { from: c.tile, to: nxt, t: 0 };
    }
  }

  // ───────────── запросы ─────────────

  passable(x: number, y: number): boolean {
    const { w, h } = this.parsed;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return !this.parsed.solid[y]![x] && !this.solidObj[y]![x];
  }

  object(key: string): WorldObject | undefined {
    return this.objects.find((o) => o.key === key) ?? (key === BOBR_KEY ? this.companionObject() : undefined);
  }

  /** Объекты, с которыми можно что-то сделать кнопкой или тапом. Выход — только в tap-режиме. */
  actionable(o: WorldObject): boolean {
    if (this.hidden.has(o.key)) return false;
    switch (o.kind) {
      case 'npc':
      case 'word':
      case 'sign':
      case 'board':
      case 'plot':
        return true;
      case 'trigger':
        return (o.src as { on: string }).on === 'tap';
      case 'exit':
        return this.controls === 'tap';
      case 'secret':
        return false; // кот Симба приходит в I-27 (secrets.json), пока точка пустая
    }
  }

  /** С этой клеткой объекта можно что-то сделать: для грядки — по клетке (полив или посадка), остальное — целиком. */
  cellActionable(o: WorldObject, cell: Xy): boolean {
    if (!this.actionable(o)) return false;
    if (o.kind !== 'plot' || !this.garden) return true;
    return this.garden.get(`${cell[0]},${cell[1]}`) ?? false;
  }

  /** Что под пальцем: ключ объекта (`key` или `key@x,y` для многоклеточных) или null. */
  targetAt(tile: Xy): string | null {
    const o = this.objects.find((ob) => covers(ob, tile) && this.cellActionable(ob, tile)) ?? this.companionAt(tile);
    if (!o) return null;
    return o.size[0] * o.size[1] > 1 ? `${o.key}@${tile[0]},${tile[1]}` : o.key;
  }

  /** Куда сейчас уйдёт кнопка действия: объект и клетка. Для подсветки цели (ТЗ §5.4). */
  highlight(): { key: string; tile: Xy } | null {
    if (this.controls === 'tap') {
      const o = this.selected ? this.object(this.selected) : undefined;
      return o ? { key: o.key, tile: o.at } : null;
    }
    if (this.player.step || this.path.length) return null;
    return this.actionTarget();
  }

  /**
   * «A»-пузырёк (P-02): с чем сработает кнопка действия с текущей клетки. Только в walk-локации, когда Дима
   * стоит (во время шага и пути пузырька нет). То же, что highlight(), но с явным именем для сцены и тестов.
   */
  actionHint(): { key: string; tile: Xy } | null {
    if (this.controls !== 'walk') return null;
    return this.highlight();
  }

  /** Бобр-компаньон под пальцем (P-10a: тап по Казику — дойти и поговорить). */
  private companionAt(tile: Xy): WorldObject | undefined {
    const o = this.companionObject();
    const c = this.companion;
    return o && c && (eq(c.tile, tile) || eq(o.at, tile)) ? o : undefined;
  }

  /** Положение актёра в клетках с долей шага (для отрисовки). */
  static pos(a: Actor): [number, number] {
    if (!a.step) return [a.tile[0], a.tile[1]];
    const k = Math.min(1, a.step.t / STEP_MS);
    return [a.step.from[0] + (a.step.to[0] - a.step.from[0]) * k, a.step.from[1] + (a.step.to[1] - a.step.from[1]) * k];
  }

  get moving(): boolean {
    return this.player.step !== null;
  }

  get done(): boolean {
    return this.exited;
  }

  // ───────────── intents ─────────────

  intent(i: Intent): void {
    if (this.exited) return;
    switch (i.type) {
      case 'move':
        if (this.controls === 'tap') return; // роутер шлёт сюда focus, не move
        if (i.held) {
          const walking = this.player.step !== null || this.path.length > 0;
          this.heldDir = i.dir;
          this.bumped = false;
          this.path = [];
          this.pending = null;
          if (this.player.step) this.queuedDir = i.dir;
          else if (!walking && this.turnWait === 0 && this.player.facing !== i.dir) {
            // Стоим и смотрим в другую сторону: сначала поворот на месте, шаг — если кнопку держат.
            this.player.facing = i.dir;
            this.turnWait = TURN_MS;
          } else if (this.turnWait > 0) this.player.facing = i.dir; // передумал во время поворота
          else this.tryStep(i.dir);
        } else if (this.heldDir === i.dir) {
          this.heldDir = null;
          this.turnWait = 0;
        }
        return;
      case 'goto':
        if (this.controls === 'tap') return; // пустая клетка в tap-локации: ходьбы нет
        this.heldDir = null;
        this.queuedDir = null;
        this.turnWait = 0;
        this.pending = null;
        this.path = findPath(this.grid, this.from(), i.tile).path;
        return;
      case 'interact':
        if (i.target) this.interactTarget(i.target);
        else if (this.controls === 'tap') {
          if (this.selected) this.fire(this.selected, null, 'action');
        } else if (this.player.step) this.actionQueued = true;
        else this.doAction();
        return;
      case 'focus':
        if (this.controls === 'tap') this.moveFocus(i.dir);
        return;
      case 'cancel':
        this.queuedDir = null;
        this.path = [];
        this.pending = null;
        return;
    }
  }

  /** Оверлей открылся или локация уходит: стоп без событий. */
  halt(): void {
    this.heldDir = null;
    this.queuedDir = null;
    this.turnWait = 0;
    this.path = [];
    this.pending = null;
    this.actionQueued = false;
  }

  // ───────────── время ─────────────

  update(dt: number): WorldEvent[] {
    this.updateCompanion(dt);
    let budget = dt;
    if (this.turnWait > 0) {
      // Поворот на месте: шаг начнётся, только если кнопку ещё держат, когда пауза кончится.
      const use = Math.min(this.turnWait, budget);
      this.turnWait -= use;
      budget -= use;
      if (this.turnWait > 0) return this.out.splice(0);
    }
    for (let guard = 0; guard < 16 && !this.exited; guard++) {
      const st = this.player.step;
      if (st) {
        const need = STEP_MS - st.t;
        if (budget < need) {
          st.t += budget;
          if (this.companion?.step && !this.pointGoal) this.companion.step.t = st.t;
          break;
        }
        budget -= need;
        this.arrive();
        continue;
      }
      if (!this.next()) break;
    }
    return this.out.splice(0);
  }

  // ───────────── внутреннее ─────────────

  /** Клетка, от которой считать путь: куда идём, если шаг уже начат. */
  private from(): Xy {
    return this.player.step ? this.player.step.to : this.player.tile;
  }

  private companionSpawn(): Xy {
    const [px, py] = this.player.tile;
    const back = DELTA[OPPOSITE[this.player.facing]];
    const options: Xy[] = [[px + back[0], py + back[1]], ...DIR_ORDER.map((d): Xy => [px + DELTA[d][0], py + DELTA[d][1]])];
    return options.find(([x, y]) => this.passable(x, y)) ?? [px, py];
  }

  /**
   * Дима шагает на клетку Казика (бобр-указатель стоит): Казик уступает дорогу — в сторону, поперёк шага;
   * некуда — меняется с Димой местами (P-10a: Казик никогда не стоит на клетке игрока).
   */
  private yieldCompanion(to: Xy, from: Xy): void {
    const c = this.companion!;
    const d = dirBetween(from, to);
    const side: Dir[] = d === 'up' || d === 'down' ? ['left', 'right'] : ['up', 'down'];
    const options: Xy[] = [...side.map((s): Xy => [to[0] + DELTA[s][0], to[1] + DELTA[s][1]]), from];
    const cell = options.find((x) => this.passable(x[0], x[1]) && !eq(x, to)) ?? from;
    c.facing = dirBetween(c.tile, cell);
    c.step = { from: c.tile, to: cell, t: 0 };
    this.companionPath = [];
  }

  private tryStep(dir: Dir): boolean {
    this.player.facing = dir;
    const [x, y] = this.player.tile;
    const to: Xy = [x + DELTA[dir][0], y + DELTA[dir][1]];
    if (!this.passable(to[0], to[1])) {
      if (!this.bumped) this.out.push({ type: 'bump', dir });
      this.bumped = true;
      return false;
    }
    this.startStep(to);
    return true;
  }

  private startStep(to: Xy): void {
    const from = this.player.tile;
    this.player.facing = dirBetween(from, to);
    this.player.step = { from, to, t: 0 };
    this.out.push({ type: 'step', from, to });
    const c = this.companion;
    if (c && this.pointGoal && !c.step && eq(c.tile, to)) this.yieldCompanion(to, from);
    else if (c && !this.pointGoal && !eq(c.tile, from)) {
      const adjacent = Math.abs(c.tile[0] - from[0]) + Math.abs(c.tile[1] - from[1]) === 1;
      if (adjacent) {
        c.facing = dirBetween(c.tile, from);
        c.step = { from: c.tile, to: from, t: 0 };
      } else c.tile = from; // отстал (телепорт, путь сквозь узкое место): догоняет сразу
    }
  }

  private arrive(): void {
    const st = this.player.step!;
    this.player.tile = st.to;
    this.player.step = null;
    const c = this.companion;
    if (c?.step && !this.pointGoal) {
      c.tile = c.step.to;
      c.step = null;
    }
    const here = this.player.tile;
    for (const o of this.objects) {
      if (!covers(o, here) || this.hidden.has(o.key)) continue;
      if (o.kind === 'exit') {
        const ex = o.src as Extract<MapObject, { type: 'exit' }>;
        this.out.push({ type: 'exit', to: ex.to, ...(ex.spawn ? { spawn: ex.spawn } : {}), tile: here });
        this.exited = true;
        this.halt();
        return;
      }
      if (o.kind === 'trigger' && (o.src as { on: string }).on === 'enter') {
        const once = (o.src as { once?: boolean }).once === true;
        if (once && this.fired.has(o.key)) continue;
        this.fired.add(o.key);
        this.emitInteract(o, here, 'enter');
      }
    }
  }

  /** Следующее действие без начатого шага. true = начался шаг. */
  private next(): boolean {
    const queued = this.queuedDir;
    this.queuedDir = null;
    if (this.heldDir) return this.tryStep(this.heldDir);
    if (queued) return this.tryStep(queued);
    if (this.path.length) {
      const nxt = this.path[0]!;
      if (!this.passable(nxt[0], nxt[1])) {
        // Путь перегородили (NPC-бобр пересел к цели): к цели тапа — новый путь, действие не теряется (P-10a).
        const p = this.pending;
        const o = p ? this.object(p.key) : undefined;
        this.path = [];
        this.pending = null;
        if (p && o) {
          const res = o.kind === 'plot' && p.tile ? pathToAdjacent(this.grid, this.player.tile, p.tile) : pathToAdjacent(this.grid, this.player.tile, o.at, o.size);
          if (res.exact && (res.path.length === 0 || this.passable(res.path[0]![0], res.path[0]![1]))) {
            this.path = res.path;
            this.pending = p;
            return this.next();
          }
        }
        return false;
      }
      this.path.shift();
      this.startStep(nxt);
      return true;
    }
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      const o = this.object(p.key);
      const [px, py] = this.player.tile;
      const close = o?.kind === 'plot' && p.tile ? Math.abs(p.tile[0] - px) + Math.abs(p.tile[1] - py) === 1 : !!o && this.near(o);
      if (o && close) {
        this.faceTo(o, p.tile);
        this.fire(o.key, p.tile, 'tap');
      }
      return false;
    }
    if (this.actionQueued) {
      this.actionQueued = false;
      this.doAction();
    }
    return false;
  }

  /** Дима рядом с объектом (4-соседство) или стоит на его проходимой клетке. */
  private near(o: WorldObject): boolean {
    const [x, y] = this.player.tile;
    if (covers(o, [x, y])) return true;
    return DIR_ORDER.some((d) => covers(o, [x + DELTA[d][0], y + DELTA[d][1]]));
  }

  private faceTo(o: WorldObject, tile: Xy | null): void {
    const [x, y] = this.player.tile;
    const target = tile && covers(o, tile) ? tile : null;
    // Стоит на объекте (на грядке): к конкретной клетке всё равно повернуться, к объекту целиком — нет.
    if (target ? eq(target, [x, y]) : covers(o, [x, y])) return;
    for (const d of DIR_ORDER) {
      const c: Xy = [x + DELTA[d][0], y + DELTA[d][1]];
      if (target ? eq(c, target) : covers(o, c)) {
        this.player.facing = d;
        return;
      }
    }
    for (const d of DIR_ORDER) if (covers(o, [x + DELTA[d][0], y + DELTA[d][1]])) this.player.facing = d;
  }

  /**
   * Цель кнопки действия (P-10a, приоритет):
   *   1. цель режиссёра (контур), если она перед лицом или рядом (компаньон-цель — тоже);
   *   2. объект перед лицом (исследование §6в п. 4);
   *   3. соседний NPC/табличка/триггер (не надо выцеливать человека с точностью до клетки);
   *   4. Казик — только если больше ничего нет: он не перехватывает A, когда он не цель шага;
   *   5. то, на чём стоит Дима.
   * Грядка — только перед лицом (у соседних клеток разные слова), кроме подсвеченной режиссёром клетки.
   */
  private actionTarget(): { key: string; tile: Xy } | null {
    const [x, y] = this.player.tile;
    const goal = this.goalTarget();
    if (goal) return goal;
    const isBobr = (o: WorldObject): boolean => o.key === BOBR_KEY;
    const at = (c: Xy, plots: boolean, bobr: boolean): WorldObject | undefined =>
      this.objects.find((ob) => covers(ob, c) && (plots || ob.kind !== 'plot') && isBobr(ob) === bobr && this.cellActionable(ob, c));
    const order = [this.player.facing, ...DIR_ORDER.filter((d) => d !== this.player.facing)];
    for (const bobr of [false, true])
      for (const d of order) {
        const c: Xy = [x + DELTA[d][0], y + DELTA[d][1]];
        const o = at(c, d === this.player.facing && !bobr, bobr);
        if (o) return { key: o.key, tile: c };
      }
    const here = at([x, y], false, false);
    return here ? { key: here.key, tile: [x, y] } : null;
  }

  /** Цель режиссёра под рукой: перед лицом, рядом (4-соседство) или под ногами. */
  private goalTarget(): { key: string; tile: Xy } | null {
    const g = this.goal;
    if (!g || this.controls !== 'walk') return null;
    const [x, y] = this.player.tile;
    const order = [this.player.facing, ...DIR_ORDER.filter((d) => d !== this.player.facing)];
    if (this.companionIsGoal) {
      const c = this.companionObject()!;
      return adjacent(c.at, [x, y]) || eq(c.at, [x, y]) ? { key: BOBR_KEY, tile: c.at } : null;
    }
    const o = this.objects.find((ob) => ob.key === g.key);
    if (!o || this.hidden.has(o.key)) return null;
    // Выход на другую карту — шаг в него; грядка — подсвеченная клетка; остальное — весь объект.
    const inGoal = (c: Xy): boolean => c[0] >= g.at[0] && c[1] >= g.at[1] && c[0] < g.at[0] + g.size[0] && c[1] < g.at[1] + g.size[1];
    const ok = (c: Xy): boolean => covers(o, c) && inGoal(c) && (o.kind === 'exit' || this.cellActionable(o, c));
    for (const d of order) {
      const c: Xy = [x + DELTA[d][0], y + DELTA[d][1]];
      if (ok(c)) return { key: o.key, tile: c };
    }
    if (o.kind !== 'exit' && o.kind !== 'plot' && ok([x, y])) return { key: o.key, tile: [x, y] };
    return null;
  }

  private doAction(): void {
    const t = this.actionTarget();
    if (!t) return;
    const o = this.object(t.key);
    if (!o) return;
    if (o.kind === 'exit' && this.controls === 'walk') {
      // Подсвеченный выход рядом: A — шаг в него (выход срабатывает, когда Дима на клетке).
      if (eq(t.tile, this.player.tile)) return;
      this.path = [t.tile];
      return;
    }
    this.faceTo(o, t.tile);
    this.fire(t.key, t.tile, 'action');
  }

  private interactTarget(target: string): void {
    const [key, cell] = target.split('@') as [string, string | undefined];
    const o = this.object(key);
    if (!o || this.hidden.has(o.key)) return;
    const tile: Xy | null = cell ? (cell.split(',').map(Number) as unknown as Xy) : null;
    if (this.controls === 'tap') {
      this.selected = o.key;
      this.fire(o.key, tile, 'tap');
      return;
    }
    this.heldDir = null;
    this.queuedDir = null;
    this.turnWait = 0;
    // Грядка: тап по конкретной клетке — подойти именно к ней (рядом, не на неё) и сделать с ней.
    // Тап никогда не действует на соседнюю клетку (исследование §6в п. 3).
    const plotCell = o.kind === 'plot' && tile ? tile : null;
    const [px, py] = this.player.tile;
    const close = plotCell ? Math.abs(plotCell[0] - px) + Math.abs(plotCell[1] - py) === 1 : this.near(o);
    if (!this.player.step && close) {
      this.path = [];
      this.faceTo(o, tile);
      this.fire(o.key, tile, 'tap');
      return;
    }
    const res = plotCell ? pathToAdjacent(this.grid, this.from(), plotCell) : pathToAdjacent(this.grid, this.from(), o.at, o.size);
    this.path = res.path;
    this.pending = res.exact ? { key: o.key, tile } : null;
  }

  private fire(key: string, tile: Xy | null, via: InteractVia): void {
    const o = this.object(key);
    if (!o) return;
    const cell: Xy = tile && covers(o, tile) ? tile : o.at;
    if (o.kind === 'exit') {
      const ex = o.src as Extract<MapObject, { type: 'exit' }>;
      this.out.push({ type: 'exit', to: ex.to, ...(ex.spawn ? { spawn: ex.spawn } : {}), tile: cell });
      this.exited = true;
      this.halt();
      return;
    }
    if (o.kind === 'trigger' && (o.src as { once?: boolean }).once === true) {
      if (this.fired.has(o.key)) return;
      this.fired.add(o.key);
    }
    this.emitInteract(o, cell, via);
  }

  private emitInteract(o: WorldObject, tile: Xy, via: InteractVia): void {
    const ev: InteractEvent = { type: 'interact', kind: o.kind as InteractEvent['kind'], id: o.id, key: o.key, tile, via, facing: this.player.facing };
    const src = o.src;
    if (src.type === 'word') {
      ev.item = src.item;
      if (src.ex) ev.ex = src.ex;
    } else if (src.type === 'sign' && src.item) ev.item = src.item;
    this.out.push(ev);
  }

  /** Tab/стрелки в tap-локации: next/prev по порядку чтения, стрелка — ближайший объект в ту сторону. */
  private moveFocus(dir: Dir | 'next' | 'prev'): void {
    const list = this.objects
      .filter((o) => this.actionable(o))
      .sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);
    if (!list.length) return;
    const cur = list.findIndex((o) => o.key === this.selected);
    if (cur < 0) {
      this.selected = (dir === 'prev' ? list[list.length - 1] : list[0])!.key;
      return;
    }
    if (dir === 'next' || dir === 'prev') {
      this.selected = list[(cur + (dir === 'next' ? 1 : list.length - 1)) % list.length]!.key;
      return;
    }
    const c = list[cur]!;
    const cx = c.at[0] + c.size[0] / 2;
    const cy = c.at[1] + c.size[1] / 2;
    const [dx, dy] = DELTA[dir];
    let best: WorldObject | null = null;
    let bestScore = Infinity;
    for (const o of list) {
      if (o === c) continue;
      const ox = o.at[0] + o.size[0] / 2 - cx;
      const oy = o.at[1] + o.size[1] / 2 - cy;
      const along = ox * dx + oy * dy;
      if (along <= 0) continue;
      const across = Math.abs(ox * dy) + Math.abs(oy * dx);
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best) this.selected = best.key;
  }
}
