// Модель локации: ходьба по клеткам по intents (удержание = идти, короткое нажатие = шаг, тап = дойти, A = действие),
// двери-переходы, интерактивные объекты и рыжий кот. Чистый TS без Phaser: сцена World рисует состояние и переводит
// события модели в шину, тесты гоняют модель напрямую.
import type { LocationMap } from '../types/map';
import type { Dir, Intent } from '../types/input';
import { parseAscii, type ParsedMap, type Xy } from './ascii';
import { findPath, findPathToAny, type Grid } from './pathfind';
import type { BeaverRef } from './beaverLife';
import { CAT_FREE_AFTER_MS, CAT_HOP_MS, CAT_REACT_MAX_MS, CAT_REACT_MIN_MS, CatLife, type LifeHost, type LifeMode, type LifeOrder, type LifePlace } from './catLife';

/** Скорость ходьбы: 4,5 клетки в секунду. */
export const CELLS_PER_SEC = 4.5;
export const STEP_MS = 1000 / CELLS_PER_SEC;
/** Сколько коротких нажатий помнит очередь, пока идёт шаг (первое нажатие шагает сразу: три нажатия = три шага). */
export const QUEUE_MAX = 3;
/** Кот чуть проворнее героя: не отстаёт. */
export const CAT_STEP_MS = 190;
/** Герой стоит так долго, и кот подходит и садится рядом, мс. */
export const CAT_SIT_AFTER_MS = 1200;
/** Герой стоит так долго в доме, и кот идёт спать у кровати, мс. */
export const CAT_SLEEP_AFTER_MS = 8000;
/** Кот отстаёт от героя на столько шагов по следу. */
const CAT_LAG = 2;

export const DELTA: Record<Dir, Xy> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIR_ORDER: readonly Dir[] = ['up', 'right', 'down', 'left'];
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

type Rect = readonly [number, number, number, number];

export interface WorldObject {
  /** `prop:desk`, `exit:5,5`, `plot:garden`, `spot:cat_sleep`. */
  key: string;
  kind: 'prop' | 'exit' | 'plot' | 'spot' | 'plant' | 'beaver';
  id: string;
  at: Xy;
  size: Xy;
  /** Прямоугольники коллизии в клетках карты. */
  rects: Rect[];
  src: LocationMap['objects'][number];
  use?: string;
  label?: string;
  /** Клетки, по которым с объектом взаимодействуют, если он проходим (растение на грядке). Иначе — `rects`. */
  cells?: Rect[];
}

/** Растение на грядке для модели: проходимо, но с ним можно взаимодействовать (A, тап). */
export interface PlantSpot {
  /** id растения (слово или фраза). */
  id: string;
  tile: Xy;
  label: string;
}

const hitRects = (o: WorldObject): Rect[] => o.cells ?? o.rects;

export interface InteractEvent {
  type: 'interact';
  id: string;
  use: string;
  label: string;
  key: string;
  tile: Xy;
  via: 'action' | 'tap';
  facing: Dir;
  /** Клетка героя в момент действия. */
  hero: Xy;
}
export interface ExitEvent {
  type: 'exit';
  to: string;
  spawn: string;
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

export interface Step {
  from: Xy;
  to: Xy;
  t: number;
  ms: number;
  /** Шаг кота в такт шагу героя (уступил дорогу, поменялись местами). */
  sync?: boolean;
}

export interface Actor {
  tile: Xy;
  facing: Dir;
  step: Step | null;
}

export type CatMode = LifeMode;
/** Позы, в которых кот бывает только занятый своими делами (герой стоит). */
const CAT_FREE_MODES: readonly CatMode[] = ['lie', 'sniff', 'crouch', 'pounce'];
export interface Cat extends Actor {
  mode: CatMode;
  /** Сколько в текущем режиме, мс. */
  since: number;
  /** Сидит на заборе (клетка непроходима для героя). */
  perch?: boolean;
}

export interface LocationOptions {
  facing?: Dir;
  /** Кот идёт за героем (по умолчанию да). */
  cat?: boolean;
  /** Случай для поведения кота (тесты подставляют свой). */
  rand?: () => number;
  /** Размер спрайта в пикселях (16 = клетка): тап по видимой части объекта, а не только по его клеткам коллизии. */
  spriteSize?: (sprite: string) => Xy | undefined;
}

/** Пикселей в клетке: для перевода размера спрайта в клетки. */
const TILE_PX = 16;
/** Сколько раз можно перепланировать подход к объекту, если герой остановился не рядом с ним. */
const APPROACH_RETRIES = 2;

const eq = (a: Xy, b: Xy): boolean => a[0] === b[0] && a[1] === b[1];
const manhattan = (a: Xy, b: Xy): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const inRect = (r: Rect, [x, y]: Xy): boolean => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
const dirBetween = (from: Xy, to: Xy): Dir => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
};

export function buildObjects(map: LocationMap): WorldObject[] {
  return map.objects.map((o): WorldObject => {
    switch (o.type) {
      case 'exit':
        return { key: `exit:${o.at[0]},${o.at[1]}`, kind: 'exit', id: `${o.at[0]},${o.at[1]}`, at: [o.at[0], o.at[1]], size: [1, 1], rects: [], src: o };
      case 'plot':
        return { key: `plot:${o.id}`, kind: 'plot', id: o.id, at: [o.at[0], o.at[1]], size: [o.size[0], o.size[1]], rects: [], src: o };
      case 'spot':
        return { key: `spot:${o.id}`, kind: 'spot', id: o.id, at: [o.at[0], o.at[1]], size: [1, 1], rects: [], src: o };
      case 'prop': {
        const size: Xy = o.size ?? [1, 1];
        const solid = o.solid !== false;
        const rel: Rect[] = o.collide ?? [[0, 0, size[0], size[1]]];
        const rects = solid ? rel.map((r): Rect => [o.at[0] + r[0], o.at[1] + r[1], r[2], r[3]]) : [];
        const w: WorldObject = { key: `prop:${o.id}`, kind: 'prop', id: o.id, at: [o.at[0], o.at[1]], size: [size[0], size[1]], rects, src: o };
        if (o.use) {
          w.use = o.use;
          w.label = o.label ?? o.use;
        }
        return w;
      }
    }
  });
}

/** Клетки вокруг прямоугольников (4-соседство), без самих клеток. */
export function around(rects: readonly Rect[]): Xy[] {
  const out: Xy[] = [];
  for (const [x0, y0, w, h] of rects) {
    for (let x = x0; x < x0 + w; x++) out.push([x, y0 - 1], [x, y0 + h]);
    for (let y = y0; y < y0 + h; y++) out.push([x0 - 1, y], [x0 + w, y]);
  }
  return out.filter((c) => !rects.some((r) => inRect(r, c)));
}

/**
 * Клетки подхода к интерактивному объекту по порядку предпочтения: `approach` из карты или сторона `face` (по умолчанию низ,
 * вид 3/4), от середины к краям. Остальные клетки вокруг — запасные, когда сторона лица занята или недостижима.
 */
export function approachCells(o: WorldObject): { face: Xy[]; rest: Xy[] } {
  const all = around(hitRects(o));
  const src = o.src.type === 'prop' ? o.src : null;
  if (!src || !o.use) return { face: all, rest: [] };
  let face: Xy[];
  if (src.approach?.length) face = src.approach.map((c): Xy => [c[0], c[1]]);
  else {
    const [x0, y0] = o.at;
    const [w, h] = o.size;
    const side = src.face ?? 'down';
    const line: Xy[] =
      side === 'down' || side === 'up'
        ? Array.from({ length: w }, (_, i): Xy => [x0 + i, side === 'down' ? y0 + h : y0 - 1])
        : Array.from({ length: h }, (_, i): Xy => [side === 'right' ? x0 + w : x0 - 1, y0 + h - 1 - i]);
    const mid = side === 'down' || side === 'up' ? x0 + (w - 1) / 2 : y0 + (h - 1) / 2;
    face = line.sort((a, b) => (side === 'down' || side === 'up' ? Math.abs(a[0] - mid) - Math.abs(b[0] - mid) : Math.abs(a[1] - mid) - Math.abs(b[1] - mid)));
  }
  return { face, rest: all.filter((c) => !face.some((f) => eq(f, c))) };
}

export class LocationModel {
  readonly map: LocationMap;
  readonly parsed: ParsedMap;
  readonly objects: WorldObject[];
  readonly player: Actor;
  readonly cat: Cat | null;
  readonly grid: Grid;
  /**
   * Бобёр (`world/beaverLife.ts`, ставит сцена): пока он виден, это интерактивный объект `beaver:0` (тап и A шлют `interact` с `use: 'beaver'`),
   * а кот не встаёт на его клетку и иногда на него смотрит. Бобёр сам уступает героя (см. `BeaverLife.update`), стеной не служит.
   */
  beaver: BeaverRef | null = null;

  /** Множитель скорости шага (автобег ускоряется, когда действия копятся в очереди). */
  speed = 1;
  /** Мини-игра (автобег): кот остаётся рядом, как раньше, и своими делами не занят. */
  leash = false;
  private plants: WorldObject[] = [];
  private heldDir: Dir | null = null;
  /** Короткие нажатия, пришедшие во время шага: до QUEUE_MAX, по порядку. */
  private queuedDirs: Dir[] = [];
  private bumped = false;
  private path: Xy[] = [];
  private pending: string | null = null;
  /** Сколько раз тап по объекту перепланировал подход, не дойдя до объекта. */
  private retries = 0;
  private actionQueued = false;
  private exited = false;
  private out: WorldEvent[] = [];
  private solidObj: boolean[][];
  private readonly rand: () => number;
  private readonly spriteSize: ((sprite: string) => Xy | undefined) | null;
  /** След героя: клетки, где он стоял (последняя — текущая). Кот идёт по нему. */
  private trail: Xy[] = [];
  private idleMs = 0;
  private catRestMs = 3000;
  private readonly life = new CatLife();
  private readonly lifeHost: LifeHost;
  /** Герой пошёл: сколько кот уже доигрывает дело и сколько ему отведено, мс. */
  private reactT = 0;
  private reactAt = -1;

  constructor(map: LocationMap, spawn: Xy, opts: LocationOptions = {}) {
    this.map = map;
    this.parsed = parseAscii(map);
    this.objects = buildObjects(map);
    this.rand = opts.rand ?? Math.random;
    this.spriteSize = opts.spriteSize ?? null;
    const { w, h } = this.parsed;
    this.solidObj = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
    for (const o of this.objects)
      for (const r of o.rects) for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (y >= 0 && y < h && x >= 0 && x < w) this.solidObj[y]![x] = true;
    this.grid = { w, h, passable: (x, y) => this.passable(x, y) };
    this.player = { tile: [spawn[0], spawn[1]], facing: opts.facing ?? 'down', step: null };
    this.trail = [[spawn[0], spawn[1]]];
    const self = this;
    this.lifeHost = {
      rand: () => this.rand(),
      get hero() {
        return self.player.tile;
      },
      size: [w, h],
      rest: (c) => this.catGrid().passable(c[0], c[1]) && !this.noRest(c),
      places: () => this.catPlaces(),
    };
    this.cat = opts.cat === false ? null : { tile: this.catSpawn(), facing: this.player.facing, step: null, mode: 'follow', since: 0 };
  }

  // ───────────── запросы ─────────────

  passable(x: number, y: number): boolean {
    const { w, h } = this.parsed;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return !this.parsed.solid[y]![x] && !this.solidObj[y]![x];
  }

  /** Клетка — выход (дверь). */
  isExit(c: Xy): boolean {
    return this.objects.some((o) => o.kind === 'exit' && eq(o.at, c));
  }

  /** Путь героя к цели не идёт через чужие двери: дверь открывает только шаг в неё. */
  walkGrid(allow: Xy | null = null): Grid {
    const here = this.from();
    return {
      w: this.parsed.w,
      h: this.parsed.h,
      passable: (x, y) => this.passable(x, y) && (!this.isExit([x, y]) || (!!allow && allow[0] === x && allow[1] === y) || (here[0] === x && here[1] === y)),
    };
  }

  object(key: string): WorldObject | undefined {
    return this.objects.find((o) => o.key === key) ?? this.dyn().find((o) => o.key === key);
  }

  /** Живые объекты: растения на грядках и бобёр (по его текущей клетке, шаг дальше середины — уже на новой). */
  private dyn(): WorldObject[] {
    const b = this.beaver;
    if (!b || !b.visible) return this.plants;
    const t = b.step && b.step.t / b.step.ms > 0.5 ? b.step.to : b.tile;
    const o: WorldObject = { key: 'beaver:0', kind: 'beaver', id: 'beaver', at: [t[0], t[1]], size: [1, 1], rects: [], cells: [[t[0], t[1], 1, 1]], src: { type: 'spot', id: 'beaver', at: [t[0], t[1]] }, use: 'beaver', label: 'Bóbr · бобёр' };
    return [...this.plants, o];
  }

  /** Клетка занята бобром (стоит или идёт на неё). */
  private beaverOn(c: Xy): boolean {
    const b = this.beaver;
    return !!b && b.visible && (eq(b.tile, c) || (!!b.step && eq(b.step.to, c)));
  }

  /** Растения на грядках (ключ `plant:<id>`): проходимы, A и тап по ним шлют `interact` с `use: 'plant'`. */
  setPlants(list: readonly PlantSpot[]): void {
    this.plants = list.map((p): WorldObject => ({
      key: `plant:${p.id}`,
      kind: 'plant',
      id: p.id,
      at: [p.tile[0], p.tile[1]],
      size: [1, 1],
      rects: [],
      cells: [[p.tile[0], p.tile[1], 1, 1]],
      src: { type: 'spot', id: p.id, at: [p.tile[0], p.tile[1]] },
      use: 'plant',
      label: p.label,
    }));
  }

  /**
   * Автобег: дойти до клетки рядом с `target` (лучше сбоку: высокий спрайт героя не закрывает растение) и встать. Ввод игрока при этом
   * выключен (мини-игра). Возвращает false, если уже стоит рядом (или дойти некуда).
   */
  walkNear(target: Xy, extra: readonly Rect[] = []): boolean {
    this.heldDir = null;
    this.queuedDirs = [];
    this.pending = null;
    this.actionQueued = false;
    const rects: Rect[] = extra.length ? [...extra] : [[target[0], target[1], 1, 1]];
    const here = this.from();
    const prefer: Xy[] = [];
    if (!extra.length) for (const d of ['left', 'right', 'down', 'up'] as Dir[]) prefer.push([target[0] + DELTA[d][0], target[1] + DELTA[d][1]]);
    const goals = (prefer.length ? prefer : around(rects)).filter(([x, y]) => this.walkGrid().passable(x, y));
    if (goals.some((g) => eq(g, here))) {
      this.path = [];
      return false;
    }
    // Растение: ближайшая клетка сбоку, если туда можно дойти; иначе любая соседняя. Объект (коробка): ближайшая рядом.
    const side = extra.length ? [] : goals.filter((g) => g[1] === target[1]);
    if (side.length) {
      const r = findPathToAny(this.walkGrid(), here, side, target);
      if (r.exact && r.path.length) {
        this.path = r.path;
        return true;
      }
    }
    const res = findPathToAny(this.walkGrid(), here, goals, target);
    this.path = res.path;
    return res.path.length > 0;
  }

  /** Повернуть героя к клетке. */
  faceTile(c: Xy): void {
    const [x, y] = this.player.tile;
    if (x === c[0] && y === c[1]) return;
    this.player.facing = dirBetween(this.player.tile, c);
  }

  spot(id: string): Xy | null {
    return this.object(`spot:${id}`)?.at ?? null;
  }

  /** Интерактивный объект, чьи клетки покрывают `tile` (иначе undefined). */
  usableAt(tile: Xy): WorldObject | undefined {
    return this.objects.find((o) => o.use && o.kind === 'prop' && o.rects.some((r) => inRect(r, tile))) ?? this.dyn().find((o) => hitRects(o).some((r) => inRect(r, tile)));
  }

  /** Что под пальцем: ключ интерактивного объекта или двери (`exit:x,y`), иначе null. */
  targetAt(tile: Xy): string | null {
    return this.usableAt(tile)?.key ?? this.doorAt(tile)?.key ?? null;
  }

  /**
   * Тап в точку мира (в клетках, дробные): сначала видимая часть интерактивного спрайта (верх стола, доски, полки —
   * над их клетками коллизии), передний (ниже на экране) побеждает; потом клетки объектов и растений; потом дверь.
   */
  targetAtPoint(x: number, y: number, o: { doorZone?: boolean } = {}): string | null {
    const tile: Xy = [Math.floor(x), Math.floor(y)];
    // Указатель первых шагов висит над дверью, то есть над клеткой подхода (коврик): тап по ней выводит сквозь дверь.
    if (o.doorZone) {
      const door = this.objects.find((e) => e.kind === 'exit' && e.at[0] === tile[0] && Math.abs(e.at[1] - tile[1]) === 1 && this.passable(tile[0], tile[1]));
      if (door) return door.key;
    }
    let best: WorldObject | null = null;
    for (const o of this.objects) {
      if (!o.use || o.kind !== 'prop' || o.src.type !== 'prop') continue;
      const px = this.spriteSize?.(o.src.sprite);
      const sw = px ? px[0] / TILE_PX : o.size[0];
      const sh = px ? px[1] / TILE_PX : o.size[1];
      const cx = o.at[0] + o.size[0] / 2;
      const bottom = o.at[1] + o.size[1];
      if (x < cx - sw / 2 || x >= cx + sw / 2 || y < bottom - sh || y >= bottom) continue;
      if (!best || bottom > best.at[1] + best.size[1]) best = o;
    }
    // Растение в клетке важнее края чужого спрайта: грядки плотные.
    const plant = this.dyn().find((o) => hitRects(o).some((r) => inRect(r, tile)));
    if (plant) return plant.key;
    return best?.key ?? this.targetAt(tile) ?? this.doorInProp(x, y, !!o.doorZone)?.key ?? null;
  }

  /**
   * Тап по зданию с дверью (дом на ферме: стена, крыша) = дверь. При указателе первых шагов (`doorZone`) зона тянется
   * на полторы клетки над крышей: стрелка висит над дверью и при мелком зуме заходит выше спрайта (B2, тест 4).
   */
  private doorInProp(x: number, y: number, zone: boolean): WorldObject | undefined {
    for (const o of this.objects) {
      if (o.use || o.kind !== 'prop' || o.src.type !== 'prop') continue;
      const door = this.objects.find(
        (e) => e.kind === 'exit' && e.at[0] >= o.at[0] && e.at[0] < o.at[0] + o.size[0] && e.at[1] >= o.at[1] && e.at[1] < o.at[1] + o.size[1],
      );
      if (!door) continue;
      const px = this.spriteSize?.(o.src.sprite);
      const sw = px ? px[0] / TILE_PX : o.size[0];
      const sh = px ? px[1] / TILE_PX : o.size[1];
      const cx = o.at[0] + o.size[0] / 2;
      const bottom = o.at[1] + o.size[1];
      const top = bottom - sh - (zone ? 1.5 : 0);
      if (x >= cx - sw / 2 && x < cx + sw / 2 && y >= top && y < bottom) return door;
    }
    return undefined;
  }

  /** Цель указателя первых шагов на этой карте: объект с `use === goal` или дверь (к нему ведёт выход). */
  guideTarget(goal: string): string | null {
    const prop = this.objects.find((o) => o.kind === 'prop' && o.use === goal);
    return (prop ?? this.objects.find((o) => o.kind === 'exit'))?.key ?? null;
  }

  /** Дверь под пальцем: клетка выхода или до двух непроходимых клеток стены прямо над ней или под ней (спрайт двери выше клетки). */
  private doorAt(tile: Xy): WorldObject | undefined {
    for (const o of this.objects) {
      if (o.kind !== 'exit') continue;
      if (eq(o.at, tile)) return o;
      if (tile[0] !== o.at[0]) continue;
      const dy = tile[1] - o.at[1];
      if (Math.abs(dy) > 2 || dy === 0) continue;
      const step = Math.sign(dy);
      let solid = true;
      for (let k = step; Math.abs(k) <= Math.abs(dy); k += step) if (this.passable(o.at[0], o.at[1] + k)) solid = false;
      if (solid) return o;
    }
    return undefined;
  }

  /** Куда сейчас уйдёт кнопка действия: объект и клетка. Для подсказки «A». */
  actionHint(): { key: string; tile: Xy } | null {
    if (this.player.step || this.path.length) return null;
    return this.actionTarget();
  }

  /** Положение актёра в клетках с долей шага (для отрисовки). */
  static pos(a: Actor): [number, number] {
    if (!a.step) return [a.tile[0], a.tile[1]];
    const k = Math.min(1, a.step.t / a.step.ms);
    return [a.step.from[0] + (a.step.to[0] - a.step.from[0]) * k, a.step.from[1] + (a.step.to[1] - a.step.from[1]) * k];
  }

  get moving(): boolean {
    return this.player.step !== null;
  }

  get done(): boolean {
    return this.exited;
  }

  /** Герой занят: идёт, держит стрелку или ждёт поворота. */
  get busy(): boolean {
    return this.player.step !== null || this.path.length > 0 || this.heldDir !== null || this.queuedDirs.length > 0;
  }

  // ───────────── intents ─────────────

  intent(i: Intent): void {
    if (this.exited) return;
    switch (i.type) {
      case 'move':
        if (i.held) {
          this.heldDir = i.dir;
          this.bumped = false;
          this.path = [];
          this.pending = null;
          // Короткое нажатие = шаг: поворот и шаг одним нажатием. Удержание продолжает идти само.
          if (this.player.step) {
            if (this.queuedDirs.length < QUEUE_MAX) this.queuedDirs.push(i.dir);
          }
          else this.tryStep(i.dir);
        } else if (this.heldDir === i.dir) this.heldDir = null;
        return;
      case 'goto':
        this.heldDir = null;
        this.queuedDirs = [];
        this.pending = null;
        this.path = findPath(this.walkGrid(i.tile), this.from(), i.tile).path;
        return;
      case 'interact':
        if (i.target) this.interactTarget(i.target);
        else if (this.player.step) this.actionQueued = true;
        else this.doAction();
        return;
      case 'cancel':
        this.queuedDirs = [];
        this.path = [];
        this.pending = null;
        return;
      case 'focus':
      case 'hotkey':
        return;
    }
  }

  /** Оверлей открылся или локация уходит: стоп без событий. */
  halt(): void {
    this.heldDir = null;
    this.queuedDirs = [];
    this.path = [];
    this.pending = null;
    this.actionQueued = false;
  }

  // ───────────── время ─────────────

  update(dt: number): WorldEvent[] {
    this.idleMs = this.busy ? 0 : this.idleMs + dt;
    let budget = dt;
    for (let guard = 0; guard < 16 && !this.exited; guard++) {
      const st = this.player.step;
      if (st) {
        const need = st.ms - st.t;
        if (budget < need) {
          st.t += budget;
          break;
        }
        budget -= need;
        this.arrive();
        continue;
      }
      if (!this.next()) break;
    }
    this.updateCat(dt);
    return this.out.splice(0);
  }

  // ───────────── герой ─────────────

  private from(): Xy {
    return this.player.step ? this.player.step.to : this.player.tile;
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
    this.player.step = { from, to, t: 0, ms: STEP_MS / Math.max(0.25, this.speed) };
    this.out.push({ type: 'step', from, to });
    this.yieldCat(to, from);
  }

  private arrive(): void {
    const st = this.player.step!;
    this.player.tile = st.to;
    this.player.step = null;
    const last = this.trail[this.trail.length - 1];
    if (!last || !eq(last, st.to)) this.trail.push(st.to);
    if (this.trail.length > 12) this.trail.shift();
    const cat = this.cat;
    if (cat?.step?.sync) {
      cat.tile = cat.step.to;
      cat.step = null;
    }
    for (const o of this.objects) {
      if (o.kind !== 'exit' || !eq(o.at, st.to)) continue;
      const ex = o.src as Extract<LocationMap['objects'][number], { type: 'exit' }>;
      this.out.push({ type: 'exit', to: ex.to, spawn: ex.spawn, tile: st.to });
      this.exited = true;
      this.halt();
      return;
    }
  }

  /** Следующее действие без начатого шага. true = начался шаг. */
  private next(): boolean {
    const queued = this.queuedDirs.shift();
    if (queued) return this.tryStep(queued);
    if (this.heldDir) return this.tryStep(this.heldDir);
    if (this.path.length) {
      const nxt = this.path[0]!;
      if (!this.passable(nxt[0], nxt[1])) {
        this.path = [];
        this.pending = null;
        return false;
      }
      this.path.shift();
      this.startStep(nxt);
      return true;
    }
    if (this.pending) {
      const key = this.pending;
      this.pending = null;
      const o = this.object(key);
      if (o && this.near(o)) {
        this.faceTo(o);
        this.fire(o, 'tap');
        this.retries = 0;
        return false;
      }
      // Пришли, но не к объекту (путь оборвался, клетку подхода занял кто-то на пути): заново к ближайшей клетке подхода, не молча (F5b).
      if (o && o.use && this.retries < APPROACH_RETRIES) {
        this.retries++;
        this.planApproach(o);
        return this.next();
      }
      this.retries = 0;
      return false;
    }
    if (this.actionQueued) {
      this.actionQueued = false;
      this.doAction();
    }
    return false;
  }

  /** Герой рядом с объектом (4-соседство). */
  private near(o: WorldObject): boolean {
    const [x, y] = this.player.tile;
    return DIR_ORDER.some((d) => hitRects(o).some((r) => inRect(r, [x + DELTA[d][0], y + DELTA[d][1]])));
  }

  private faceTo(o: WorldObject): void {
    const [x, y] = this.player.tile;
    for (const d of DIR_ORDER) if (hitRects(o).some((r) => inRect(r, [x + DELTA[d][0], y + DELTA[d][1]]))) {
      this.player.facing = d;
      return;
    }
  }

  /** Цель кнопки A: интерактивный объект перед лицом, иначе рядом; дверь перед лицом — шаг в неё. */
  private actionTarget(): { key: string; tile: Xy } | null {
    const [x, y] = this.player.tile;
    const order = [this.player.facing, ...DIR_ORDER.filter((d) => d !== this.player.facing)];
    for (const d of order) {
      const c: Xy = [x + DELTA[d][0], y + DELTA[d][1]];
      const o = this.usableAt(c);
      if (o) return { key: o.key, tile: c };
    }
    const f: Xy = [x + DELTA[this.player.facing][0], y + DELTA[this.player.facing][1]];
    const door = this.objects.find((o) => o.kind === 'exit' && eq(o.at, f));
    return door ? { key: door.key, tile: f } : null;
  }

  private doAction(): void {
    const t = this.actionTarget();
    if (!t) return;
    const o = this.object(t.key);
    if (!o) return;
    if (o.kind === 'exit') {
      this.path = [t.tile];
      return;
    }
    this.faceTo(o);
    this.fire(o, 'action', t.tile);
  }

  /**
   * Тап по объекту: дойти до клетки подхода со стороны лица (занята или недостижима — до ближайшей другой), повернуться и
   * сделать действие. Тап по двери: войти в неё (снаружи — в дом, изнутри — на ферму).
   */
  private interactTarget(key: string): void {
    const o = this.object(key);
    if (!o) return;
    this.heldDir = null;
    this.queuedDirs = [];
    this.pending = null;
    if (o.kind === 'exit') {
      this.path = findPath(this.walkGrid(o.at), this.from(), o.at).path;
      return;
    }
    if (!o.use) return;
    this.retries = 0;
    this.planApproach(o);
  }

  /** Путь к клетке подхода объекта (лицо, потом любая вокруг); `pending` — после прихода слать `interact`. */
  private planApproach(o: WorldObject): void {
    const here = this.from();
    const grid = this.walkGrid();
    const free = (c: Xy): boolean => grid.passable(c[0], c[1]) || eq(c, here);
    const { face, rest } = approachCells(o);
    let res = findPathToAny(grid, here, face.filter(free), o.at);
    if (!res.exact) {
      // Сторона лица недоступна: уже рядом — действие сразу, иначе к любой клетке вокруг.
      if (!this.player.step && this.near(o)) res = { path: [], end: here, exact: true };
      else res = findPathToAny(grid, here, rest.filter(free), o.at);
    }
    this.path = res.path;
    if (!res.exact) return;
    if (!res.path.length && !this.player.step) {
      this.faceTo(o);
      this.fire(o, 'tap');
      return;
    }
    this.pending = o.key;
  }

  private fire(o: WorldObject, via: 'action' | 'tap', tile?: Xy): void {
    if (!o.use) return;
    this.out.push({ type: 'interact', id: o.id, use: o.use, label: o.label ?? o.use, key: o.key, tile: tile ?? o.at, via, facing: this.player.facing, hero: [this.player.tile[0], this.player.tile[1]] });
  }

  // ───────────── кот ─────────────

  /** Клетка, где коту нельзя стоять: двери и подходы к ним, подходы к объектам, клетки героя, перед ним и над ним. */
  private noRest(c: Xy): boolean {
    if (this.isExit(c)) return true;
    for (const o of this.objects) {
      if (o.kind === 'exit' && manhattan(o.at, c) === 1) return true;
    }
    const p = this.player;
    if (eq(c, p.tile) || (p.step && eq(c, p.step.to))) return true;
    const end = this.path[this.path.length - 1];
    if (end && eq(c, end)) return true;
    const f: Xy = [p.tile[0] + DELTA[p.facing][0], p.tile[1] + DELTA[p.facing][1]];
    if (eq(c, f)) return true;
    // Прямо над героем кота не видно: высокий спрайт героя его закрывает.
    if (c[0] === p.tile[0] && c[1] === p.tile[1] - 1) return true;
    // Подходы к интерактивным объектам: кот не мешает дойти до стола, доски, коробки
    const spot = this.spot('cat_sleep');
    if (spot && eq(c, spot)) return false;
    return this.objects.some((o) => o.use && around(o.rects).some((a) => eq(a, c)));
  }

  /** Кот ходит по свободным клеткам, не по дверям и не по клеткам героя. */
  private catGrid(): Grid {
    return {
      w: this.parsed.w,
      h: this.parsed.h,
      passable: (x, y) => this.passable(x, y) && !this.isExit([x, y]) && !eq([x, y], this.player.tile) && !(this.player.step && eq([x, y], this.player.step.to)) && !this.beaverOn([x, y]),
    };
  }

  private catSpawn(): Xy {
    const [px, py] = this.player.tile;
    const back = DELTA[OPPOSITE[this.player.facing]];
    const cand: Xy[] = [[px + back[0], py + back[1]], ...DIR_ORDER.map((d): Xy => [px + DELTA[d][0], py + DELTA[d][1]])];
    for (let r = 2; r <= 3; r++) for (const d of DIR_ORDER) cand.push([px + DELTA[d][0] * r, py + DELTA[d][1] * r]);
    const ok = (c: Xy, strict: boolean): boolean => this.passable(c[0], c[1]) && !this.isExit(c) && !eq(c, this.player.tile) && (!strict || !this.noRest(c));
    return cand.find((c) => ok(c, true)) ?? cand.find((c) => ok(c, false)) ?? [px, py];
  }

  /** Герой шагает на клетку кота: кот уступает дорогу в сторону (или меняется местами). */
  private yieldCat(to: Xy, from: Xy): void {
    const c = this.cat;
    if (!c) return;
    if (c.step && eq(c.step.to, to)) {
      // Шёл на ту клетку, куда шагает герой. Прежняя клетка кота свободна от героя: передумал и остался на ней. Прежняя
      // клетка кота — клетка героя (кот уходил с неё): сворачивает на другую соседнюю.
      if (!eq(c.tile, from)) c.step = null;
      else {
        const alt = DIR_ORDER.map((d): Xy => [c.tile[0] + DELTA[d][0], c.tile[1] + DELTA[d][1]]).find((x) => this.passable(x[0], x[1]) && !eq(x, to) && !this.isExit(x));
        c.step = alt ? { from: c.tile, to: alt, t: 0, ms: STEP_MS } : null;
        if (alt) c.facing = dirBetween(c.tile, alt);
      }
      return;
    }
    if (c.step || !eq(c.tile, to)) return;
    const d = dirBetween(from, to);
    const side: Dir[] = d === 'up' || d === 'down' ? ['left', 'right'] : ['up', 'down'];
    const options: Xy[] = [...side.map((s): Xy => [to[0] + DELTA[s][0], to[1] + DELTA[s][1]]), [to[0] + DELTA[d][0], to[1] + DELTA[d][1]]];
    const ok = (x: Xy): boolean => this.passable(x[0], x[1]) && !this.isExit(x) && !eq(x, from) && !eq(x, to);
    const cell = options.find((x) => ok(x) && !this.noRest(x)) ?? options.find(ok);
    c.mode = 'follow';
    c.since = 0;
    if (cell) {
      c.facing = dirBetween(c.tile, cell);
      c.step = { from: c.tile, to: cell, t: 0, ms: STEP_MS };
    } else {
      // Некуда: меняемся местами, шаг кота синхронен шагу героя.
      c.facing = dirBetween(c.tile, from);
      c.step = { from: c.tile, to: from, t: 0, ms: STEP_MS, sync: true };
    }
  }

  private updateCat(dt: number): void {
    const c = this.cat;
    if (!c) return;
    c.since += dt;
    if (c.step) {
      if (c.step.sync) {
        if (this.player.step) c.step.t = this.player.step.t;
        return;
      }
      c.step.t += dt;
      if (c.step.t < c.step.ms) return;
      c.tile = c.step.to;
      c.step = null;
      c.perch = !this.passable(c.tile[0], c.tile[1]);
    }
    const bed = this.spot('cat_sleep');
    const sleepNow = !this.busy && !!bed && this.idleMs >= CAT_SLEEP_AFTER_MS;
    if (sleepNow && c.mode !== 'sleep' && !eq(c.tile, bed!)) {
      if (this.leaveFree()) return;
      c.mode = 'follow'; // пора спать
    }
    const free = !this.busy && !this.leash && !sleepNow && this.idleMs >= CAT_FREE_AFTER_MS;
    if (this.busy || this.reactAt >= 0) {
      // Герой пошёл: дело кот бросает не сразу, а через 0,5–1 с (даже если герой уже остановился); клетка стала запретной — сразу.
      if (c.mode !== 'follow' || c.perch) {
        if (!this.noRest(c.tile)) {
          if (this.reactAt < 0) {
            this.reactAt = CAT_REACT_MIN_MS + this.rand() * (CAT_REACT_MAX_MS - CAT_REACT_MIN_MS);
            this.reactT = 0;
          }
          this.reactT += dt;
          if (this.reactT < this.reactAt) return;
        }
        this.reactAt = -1;
        if (this.leaveFree()) return;
        c.mode = 'follow';
        c.since = 0;
      } else {
        this.reactAt = -1;
        this.life.reset();
      }
    }
    if (!this.busy) {
      if (free) {
        this.freeLife(dt);
        return;
      }
      if (this.life.active || c.perch || CAT_FREE_MODES.includes(c.mode)) {
        if (this.leaveFree()) return;
        if (CAT_FREE_MODES.includes(c.mode)) c.mode = 'follow';
      }
      if (c.mode === 'sleep') return;
      if (c.mode === 'sit' || c.mode === 'wash') {
        // Сидит рядом: смотрит на героя, время от времени умывается; мешать начал (клетка стала запретной) — уходит.
        if (this.noRest(c.tile)) {
          c.mode = 'follow';
          c.since = 0;
        } else {
          c.facing = dirBetween(c.tile, this.catGaze(c));
          if (c.since > this.catRestMs) {
            c.mode = c.mode === 'sit' ? 'wash' : 'sit';
            c.since = 0;
            this.catRestMs = c.mode === 'wash' ? 1800 + this.rand() * 1200 : 3000 + this.rand() * 4000;
          }
          return;
        }
      }
    }
    const want = this.catWant();
    if (!want) return;
    if (eq(want, c.tile)) {
      if (!this.busy) this.catSettle();
      return;
    }
    const res = findPath(this.catGrid(), c.tile, want);
    const nxt = res.path[0];
    if (!nxt) {
      if (!this.busy && !this.noRest(c.tile)) this.catSettle();
      return;
    }
    c.facing = dirBetween(c.tile, nxt);
    c.step = { from: c.tile, to: nxt, t: 0, ms: CAT_STEP_MS };
  }

  /** Куда смотрит сидящий кот: на героя, а когда рядом бобёр (в 7 клетках) — каждые пару секунд на него. */
  private catGaze(c: Cat): Xy {
    const b = this.beaver;
    if (b && b.visible && manhattan(c.tile, b.tile) <= 7 && Math.floor(c.since / 2200) % 2 === 1) return b.tile;
    return this.player.tile;
  }

  /** Бросить свои дела: сброс плана; с забора — прыжок вниз (true, если прыжок начат). */
  private leaveFree(): boolean {
    const c = this.cat!;
    this.life.reset();
    if (!c.perch) return false;
    const g = this.catGrid();
    const down = DIR_ORDER.map((d): Xy => [c.tile[0] + DELTA[d][0], c.tile[1] + DELTA[d][1]]).filter((x) => g.passable(x[0], x[1]));
    const to = down.find((x) => !this.noRest(x)) ?? down[0];
    c.mode = 'sit';
    if (!to) return false;
    c.facing = dirBetween(c.tile, to);
    c.step = { from: c.tile, to, t: 0, ms: CAT_HOP_MS };
    c.mode = 'follow';
    c.since = 0;
    return true;
  }

  /** Герой стоит давно: кот занят своим, в радиусе 3–5 клеток от героя (см. catLife.ts). */
  private freeLife(dt: number): void {
    const c = this.cat!;
    const o: LifeOrder | null = this.life.tick(dt, c.tile, this.lifeHost);
    if (!o) return;
    if (o.k === 'pose') {
      if (c.mode !== o.mode) {
        c.mode = o.mode;
        c.since = 0;
      }
      if (o.face) c.facing = Array.isArray(o.face) ? dirBetween(c.tile, o.face as Xy) : (o.face as Dir);
      return;
    }
    if (o.k === 'hop') {
      c.mode = 'sit';
      c.facing = dirBetween(c.tile, o.cell);
      c.step = { from: c.tile, to: o.cell, t: 0, ms: CAT_HOP_MS };
      return;
    }
    const res = findPath(this.catGrid(), c.tile, o.cell);
    const nxt = res.path[0];
    if (!nxt || !res.exact) {
      this.life.abort(this.lifeHost.rand);
      return;
    }
    if (c.mode !== 'follow') {
      c.mode = 'follow';
      c.since = 0;
    }
    c.facing = dirBetween(c.tile, nxt);
    c.step = { from: c.tile, to: nxt, t: 0, ms: CAT_STEP_MS };
  }

  /** Места для дел кота: забор, коробка и радио, ковёр, грядки и цветы (нюхать). */
  private catPlaces(): LifePlace[] {
    const out: LifePlace[] = [];
    const g = this.catGrid();
    const { w, h } = this.parsed;
    const nbrs = (c: Xy): Xy[] => DIR_ORDER.map((d): Xy => [c[0] + DELTA[d][0], c[1] + DELTA[d][1]]).filter((x) => g.passable(x[0], x[1]));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (this.parsed.deco[y]![x] && this.parsed.solid[y]![x] && !this.solidObj[y]![x]) {
          const stand = nbrs([x, y]);
          for (const s of stand) out.push({ kind: 'perch', stand: s, hop: [x, y] });
        }
      }
    for (const o of this.objects) {
      if (o.kind === 'prop' && (o.use === 'bin' || o.use === 'radio')) {
        const [x0, y0] = o.at;
        const [sw, sh] = o.size;
        for (let y = y0 - 2; y < y0 + sh + 2; y++)
          for (let x = x0 - 2; x < x0 + sw + 2; x++) if (g.passable(x, y)) out.push({ kind: o.use === 'bin' ? 'box' : 'radio', stand: [x, y], look: [x0, y0] });
      } else if (o.kind === 'prop' && o.id === 'rug') {
        for (let y = o.at[1]; y < o.at[1] + o.size[1]; y++) for (let x = o.at[0]; x < o.at[0] + o.size[0]; x++) out.push({ kind: 'rug', stand: [x, y] });
      } else if (o.kind === 'prop' && o.id.startsWith('flower')) {
        for (const s of nbrs(o.at)) out.push({ kind: 'sniff', stand: s, look: o.at });
      }
    }
    for (const p of this.plants) for (const s of nbrs(p.at)) out.push({ kind: 'sniff', stand: s, look: p.at });
    return out;
  }

  /** Кот пришёл на место: садится (или спит у кровати). */
  private catSettle(): void {
    const c = this.cat!;
    const spot = this.spot('cat_sleep');
    if (spot && eq(c.tile, spot) && this.idleMs >= CAT_SLEEP_AFTER_MS) {
      c.mode = 'sleep';
      c.since = 0;
    } else if (this.idleMs >= CAT_SIT_AFTER_MS && c.mode === 'follow' && !this.noRest(c.tile)) {
      c.mode = 'sit';
      c.since = 0;
      this.catRestMs = 3000 + this.rand() * 4000;
      c.facing = dirBetween(c.tile, this.player.tile);
    }
  }

  /** Куда коту надо: у героя на следу или рядом с ним; в доме при долгом покое — к кровати. */
  private catWant(): Xy | null {
    const c = this.cat!;
    const spot = this.spot('cat_sleep');
    if (!this.busy && spot && this.idleMs >= CAT_SLEEP_AFTER_MS) return spot;
    const near = manhattan(c.tile, this.player.tile) <= 2;
    if (this.busy) {
      if (near && !this.noRest(c.tile)) return c.tile;
      const lag = this.trail[Math.max(0, this.trail.length - 1 - CAT_LAG)]!;
      return this.restNear(lag);
    }
    if (this.idleMs < CAT_SIT_AFTER_MS) return near && !this.noRest(c.tile) ? c.tile : this.restNear(this.player.tile);
    return near && !this.noRest(c.tile) ? c.tile : this.restNear(this.player.tile);
  }

  /** Ближайшая к `target` клетка, где коту можно остановиться (в пределах досягаемости кота). */
  private restNear(target: Xy): Xy | null {
    const c = this.cat!;
    const g = this.catGrid();
    let best: Xy | null = null;
    let bestScore = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const cell: Xy = [target[0] + dx, target[1] + dy];
        if (!g.passable(cell[0], cell[1]) || this.noRest(cell)) continue;
        const score = Math.abs(dx) + Math.abs(dy) + manhattan(cell, c.tile) * 0.01;
        if (score < bestScore) {
          bestScore = score;
          best = cell;
        }
      }
    return best;
  }
}
