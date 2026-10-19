import Phaser from 'phaser';
import { bus } from '../systems/bus';
import type { TileHit } from '../input/pointer';
import type { BusEvents } from '../types/bus';
import type { Dir, RoutedIntent } from '../types/input';
import type { LocationMap, PropObject } from '../types/map';
import { frameFor, tileLayers, type TilesetMeta, type Xy } from '../world/ascii';
import { BeaverLayer } from './beaverLayer';
import type { BeaverApi } from '../systems/beaver';
import { FarmLayer } from './farmLayer';
import { ZagrodaLayer, applyEntries } from './zagrodaLayer';
import { pickZoom } from '../world/camera';
import { LocationModel, type Actor, type WorldEvent } from '../world/location';
import { PositionGate } from '../world/positionGate';
import { getMap, resolveSpawn, routeTo, START, withDecor } from '../world/maps';

// Сцена мира: карта, герой, кот, объекты. Логика в world/location.ts; сцена рисует и переводит события модели в шину.
// Ввод приходит intents через bus (`input:intent`, to = world); тап по карте разбирает PointerSource через tileAt().

const T = 16;
const ATLAS = 'custom';
const TILESET = 'farm';
/** Высота d-pad снизу в CSS-пикселях (крест 120 px + отступ 16 px + запас): пока он виден, карта не прячет низ под ним. */
export const DPAD_INSET = 148;
/** Сверху кнопки HUD. */
export const HUD_TOP_INSET = 52;
/** Цвет за краем карты: тёмная листва. */
export const BG_COLOR = '#2e5b3b';

interface SpriteMeta {
  size: [number, number];
  anchor: [number, number];
  frames: string[];
  anims: Record<string, string[]>;
}
type SpritesMeta = Record<string, SpriteMeta>;

export interface WorldStart {
  map?: string;
  spawn?: string | readonly number[];
  facing?: Dir;
}

const url = (p: string): string => `${import.meta.env.BASE_URL}${p}`;

let dpadVisible = false;
const watchers = new Set<() => void>();
bus.on('input:dpad', ({ visible }) => {
  dpadVisible = visible;
  for (const fn of watchers) fn();
});

/** Стрелка указателя на экране (CSS px, `guide:arrow` из ui/hintsGuide.ts). */
let guideArrow: { x: number; y: number } | null = null;
bus.on('guide:arrow', (p) => {
  guideArrow = p;
});
/** «Idź» с доски (v2): к какому объекту (`use`) герой идёт сам; переживает смену карты (через двери). */
let pendingGoto: string | null = null;
/** v2: игра о Польше в нижней панели открылась не в Zagroda — сцена уходит туда (к участку `plot`). */
let polskaGo: string | null = null;
bus.on('world:goto', ({ use }) => {
  pendingGoto = use;
});
/** «Na pole!» после игры во весь экран: герой сам идёт в Zagroda (через двери), там обход (`ZagrodaLayer`). */
const TOUR_GOTO = '@zagroda';
bus.on('polska:tour', ({ go }) => {
  if (go) pendingGoto = TOUR_GOTO;
});
bus.on('polska:auto', ({ on, layout, plot }) => {
  polskaGo = on && layout === 'panel' ? (plot ?? 'from_farm') : null;
});

/** Мини-игра закрыта: куда вернуть героя (`world:return`). Лежит до применения: сцена могла быть посреди перехода через дверь. */
let pendingReturn: BusEvents['world:return'] | null = null;

/** Радиус попадания по стрелке указателя, CSS px (палец шире треугольника 30×15). */
const ARROW_HIT = 30;

/** Цель указателя первых шагов (`guide:goal` из ui/hintsGuide.ts): переживает перезапуск сцены при смене карты. */
let guideGoal: string | null = null;
bus.on('guide:goal', ({ use }) => {
  guideGoal = use;
});

/** `env(safe-area-inset-*)` в CSS-пикселях (iPhone: «чёлка» сверху, полоска «домой» снизу). */
function safeArea(): { top: number; bottom: number } {
  if (typeof document === 'undefined' || !document.body) return { top: 0, bottom: 0 };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return out;
}

export class World extends Phaser.Scene {
  private model!: LocationModel;
  private mapDef!: LocationMap;
  private sprites!: SpritesMeta;
  private hero!: Phaser.GameObjects.Sprite;
  private heroShadow!: Phaser.GameObjects.Image;
  private catSprite: Phaser.GameObjects.Sprite | null = null;
  private catShadow: Phaser.GameObjects.Image | null = null;
  private marker!: Phaser.GameObjects.Graphics;
  private markerKey = '';
  private nearKey = '';
  private guideKey = '';
  private bump: { dir: Dir; until: number } | null = null;
  private start0: WorldStart = {};
  private leaving = false;
  private readonly posGate = new PositionGate();
  private inputOn = true;
  private insets = { top: HUD_TOP_INSET, bottom: 0 };
  private cam0: { zoom: number; mw: number; mh: number; fitsW: boolean; fitsH: boolean } | null = null;
  private farm: FarmLayer | null = null;
  private zagroda: ZagrodaLayer | null = null;
  /** Бобёр (только ферма): гость на уровнях 0–9, хозяин хатки с 10-го; `api` кладёт в реестр main.ts. */
  private beaver: BeaverLayer | null = null;
  /** Спрайты объектов карты по ключу `prop:<id>` (слой Zagroda меняет их вид по прогрессу). */
  private propSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private groundLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private tileset: TilesetMeta | null = null;
  private soilKey = '';
  /** Высота панели мини-игры снизу (CSS px): камера держит героя над ней. */
  private panelBottom = 0;

  constructor() {
    super('World');
  }

  init(data: WorldStart): void {
    this.start0 = data ?? {};
    this.leaving = false;
    this.catSprite = null;
    this.catShadow = null;
    this.bump = null;
    this.posGate.reset();
    this.markerKey = '';
    this.nearKey = '';
    this.guideKey = '';
  }

  preload(): void {
    if (!this.textures.exists(TILESET)) this.load.image(TILESET, url(`atlas/${TILESET}.png`));
    if (!this.cache.json.exists(TILESET)) this.load.json(TILESET, url(`atlas/${TILESET}.json`));
    if (!this.textures.exists(ATLAS)) this.load.atlas(ATLAS, url('atlas/custom.png'), url('atlas/custom.json'));
    if (!this.cache.json.exists('sprites')) this.load.json('sprites', url('atlas/sprites.json'));
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BG_COLOR);
    const id = this.start0.map ?? START.map;
    // Украшения к сегодняшней дате (знич 1–2.11, ёлка 24.12–6.01…): список кладёт main.ts в реестр игры.
    this.mapDef = withDecor(getMap(id), new Set((this.registry.get('decor') as string[] | undefined) ?? []));
    const spawn = resolveSpawn(this.mapDef, this.start0.spawn ?? START.spawn, this.start0.facing);
    this.sprites = this.cache.json.get('sprites') as SpritesMeta;
    this.model = new LocationModel(this.mapDef, spawn.tile, { facing: spawn.facing, spriteSize: (id) => this.sprites[id]?.size });

    this.createAnims();
    this.buildTiles();
    this.propSprites.clear();
    this.buildProps();
    this.buildActors();
    this.marker = this.add.graphics().setDepth(10_000);
    this.farm = this.mapDef.id === 'farm' ? new FarmLayer({ scene: this, model: this.model, sprites: this.sprites, hero: this.hero, soil: (c) => this.soil(c), toScreen: (x, y) => this.toScreen(x, y), inputOn: () => this.inputOn }) : null;
    this.zagroda = this.mapDef.id === 'zagroda' ? new ZagrodaLayer({ scene: this, model: this.model, sprites: this.sprites, props: this.propSprites, toScreen: (x, y) => this.toScreen(x, y) }) : null;
    const beaverApi = this.registry.get('beaver') as BeaverApi | undefined;
    this.beaver =
      this.mapDef.id === 'farm' && beaverApi
        ? new BeaverLayer({ scene: this, model: this.model, sprites: this.sprites, api: beaverApi, toScreen: (x, y) => this.toScreen(x, y), placeShadow: (cx, b, w, d) => this.placeShadow(cx, b, w, d), auto: () => !!this.farm?.auto })
        : null;
    // Бобёр поселился (main.ts уже положил хатку и пруд в реестр): сцена пересоздаётся на той же клетке, и они появляются.
    const offSettled = bus.on('beaver:settled', () => {
      if (this.mapDef.id === 'farm' && !this.leaving) this.time.delayedCall(400, () => !this.leaving && this.go('farm', [this.model.player.tile[0], this.model.player.tile[1]], this.model.player.facing));
    });
    const offGoto = bus.on('world:goto', () => setTimeout(() => this.runGoto(), 0));
    const offTour = bus.on('polska:tour', ({ go }) => go && setTimeout(() => this.runGoto(), 0));
    const offPolska = bus.on('polska:auto', () => this.polskaToZagroda());
    // Возврат к точке входа после игры: сцена дослушивает все обработчики шины (флаги автобега гаснут) и только потом ставит героя.
    const offReturn = bus.on('world:return', (s) => {
      pendingReturn = s;
      setTimeout(() => this.applyReturn(), 0);
    });
    // Точки входа v2 (карта, календарь, мачта, сезонная доска) — кадр по прогрессу.
    applyEntries(this.propSprites, this.sprites);
    const offEntries = bus.on('polska:plots', ({ entries }) => entries && applyEntries(this.propSprites, this.sprites, entries));
    const offAuto = bus.on('farm:auto', ({ on, bottom }) => {
      this.panelBottom = on ? bottom : 0;
      this.layout();
    });

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    const offIntent = bus.on('input:intent', (i) => this.onIntent(i));
    const offInput = bus.on('world:input', ({ enabled }) => {
      this.inputOn = enabled;
      if (!enabled) this.model.halt();
    });
    // Вкладка свернулась: стоп ходьбы, чтобы после возврата герой стоял на той же клетке, а не «доходил» зажатую кнопку.
    const onHidden = (): void => this.model.halt();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    const onDpad = (): void => this.layout();
    watchers.add(onDpad);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offIntent();
      offInput();
      offSettled();
      this.beaver?.dispose();
      this.beaver = null;
      offAuto();
      offGoto();
      offTour();
      offPolska();
      offReturn();
      offEntries();
      this.farm?.dispose();
      this.farm = null;
      this.zagroda?.dispose();
      this.zagroda = null;
      watchers.delete(onDpad);
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.cameras.main.fadeIn(150, 46, 91, 59);
    bus.emit('world:location', { id: this.mapDef.id, controls: 'walk' });
    const start = this.posGate.tick(false, this.mapDef.id, this.model.player.tile, this.model.player.facing);
    if (start) bus.emit('world:position', start);
    // Пришли через дверь по «Idź» — идём дальше; игра о Польше открыта не здесь — в Zagroda.
    if (pendingGoto) this.time.delayedCall(220, () => this.runGoto());
    this.polskaToZagroda();
    if (pendingReturn) this.applyReturn();
  }

  /**
   * Вернуть героя и кота на клетку, откуда запущена игра (`world:return`): та же карта и герой уже стоит там — ничего (игра во весь экран
   * его не двигала); иначе короткое затемнение и новая карта со спавном на этой клетке (кот появляется рядом, как после двери).
   */
  private applyReturn(): void {
    const s = pendingReturn;
    if (!s || this.leaving || !this.model) return;
    pendingReturn = null;
    pendingGoto = null;
    const p = this.model.player;
    const idle = !this.model.busy && !this.farm?.blocking && !this.zagroda?.auto;
    if (s.map === this.mapDef.id && p.tile[0] === s.x && p.tile[1] === s.y && idle) return;
    this.go(s.map, [s.x, s.y], s.facing);
  }

  /**
   * «Idź» (v2): объект с этим `use` на этой карте — подойти и открыть (как тап по нему); на другой карте — к двери по маршруту
   * (`routeTo`), дальше продолжит сцена новой карты. Ручной ввод отменяет.
   */
  private runGoto(): void {
    const use = pendingGoto;
    if (!use || this.leaving || !this.inputOn) return;
    // «Na pole!»: только дойти до Zagroda (там обход), объект не открывать.
    if (use === TOUR_GOTO && this.mapDef.id === 'zagroda') {
      pendingGoto = null;
      return;
    }
    const r = routeTo(this.mapDef.id, use === TOUR_GOTO ? 'zplot' : use);
    if (!r) {
      pendingGoto = null;
      return;
    }
    if (r.here) pendingGoto = null;
    this.model.intent({ type: 'interact', target: r.key });
  }

  /** Игра о Польше в нижней панели: герой уходит в Zagroda (переход шагом через калитку не ждём — экран уже открыт). */
  private polskaToZagroda(): void {
    if (!polskaGo || this.leaving || this.mapDef.id === 'zagroda') return;
    this.go('zagroda', getMap('zagroda').spawns[polskaGo] ? polskaGo : 'from_farm');
  }

  /** Экранные CSS-пиксели канваса → клетка и объект под пальцем (для PointerSource). */
  tileAt(x: number, y: number): TileHit | null {
    if (!this.model || this.leaving || !this.inputOn) return null;
    const p = this.cameras.main.getWorldPoint(x, y);
    const tx = Math.floor(p.x / T);
    const ty = Math.floor(p.y / T);
    if (tx < 0 || ty < 0 || tx >= this.model.parsed.w || ty >= this.model.parsed.h) return null;
    // Тап по стрелке указателя = тап по её цели (стол, доска или дверь), где бы стрелка ни висела (B2).
    if (guideGoal && guideArrow) {
      const r = this.game.canvas.getBoundingClientRect();
      if (Math.hypot(r.left + x - guideArrow.x, r.top + y - guideArrow.y) <= ARROW_HIT) {
        const key = this.model.guideTarget(guideGoal);
        const o = key ? this.model.object(key) : undefined;
        if (key && o) return { tile: [o.at[0], o.at[1]], target: key };
      }
    }
    const target = this.model.targetAtPoint(p.x / T, p.y / T, { doorZone: guideGoal !== null });
    return target ? { tile: [tx, ty], target } : { tile: [tx, ty] };
  }

  /** Бобёр для проверок в браузере и тестах (`force`, `state`); не на ферме — null. */
  get beaverLayer(): BeaverLayer | null {
    return this.beaver;
  }

  /** Состояние для проверок в браузере и тестах. */
  get state(): { location: string; tile: Xy; facing: Dir; moving: boolean; aBubble: string | null; cat: { tile: Xy; mode: string } | null; zoom: number } {
    const m = this.model;
    const a = this.inputOn ? m.actionHint() : null;
    return {
      location: this.mapDef.id,
      tile: m.player.tile,
      facing: m.player.facing,
      moving: m.moving,
      aBubble: a ? a.key : null,
      cat: m.cat ? { tile: m.cat.tile, mode: m.cat.mode } : null,
      zoom: this.cameras.main.zoom,
    };
  }

  override update(time: number, delta: number): void {
    if (this.leaving) return;
    this.farm?.update(time);
    this.zagroda?.update(time);
    for (const ev of this.model.update(Math.min(delta, 100))) this.onWorldEvent(ev, time);
    this.beaver?.update(time, Math.min(delta, 100));
    // Герой стоит (после ходьбы, автобега мини-игры, доигрыша очереди): новая клетка или поворот — в сохранение (B3).
    const busy = this.model.busy || !!this.farm?.blocking || !!this.zagroda?.auto;
    const pos = this.posGate.tick(busy, this.mapDef.id, this.model.player.tile, this.model.player.facing);
    if (pos) bus.emit('world:position', pos);
    this.syncHero(time);
    this.syncCat();
    this.updateCamera();
    this.drawActionBubble(time);
    this.emitGuide();
  }

  /**
   * Указатель первых шагов: где на экране герой и цель (объект на этой карте или дверь к карте, где он стоит).
   * Экран открыт, мини-игра или переход — null.
   */
  private emitGuide(): void {
    let out: BusEvents['fx:guide'] = null;
    if (guideGoal && this.inputOn && !this.leaving && !this.farm?.auto) {
      const prop = this.model.objects.find((o) => o.kind === 'prop' && o.use === guideGoal);
      const o = prop ?? this.model.objects.find((x) => x.kind === 'exit');
      if (o) {
        const [hx, hy] = LocationModel.pos(this.model.player);
        const hero = this.toScreen((hx + 0.5) * T, (hy + 1) * T - 34);
        // Дверь в стене дома (снаружи) нарисована на клетку выше выхода.
        const top = prop ? this.propTop(o.at, o.size, o.key) : (o.at[1] - (this.model.passable(o.at[0], o.at[1] - 1) ? 0 : 1)) * T;
        const target = this.toScreen((o.at[0] + o.size[0] / 2) * T, top - 2);
        out = { hero, target, via: prop ? 'object' : 'door' };
      }
    }
    const key = out ? [out.hero.x, out.hero.y, out.target.x, out.target.y].map(Math.round).join(',') + out.via : '';
    if (key === this.guideKey) return;
    this.guideKey = key;
    bus.emit('fx:guide', out);
  }

  // ───────────── камера ─────────────

  private layout(): void {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const mw = this.model.parsed.w * T;
    const mh = this.model.parsed.h * T;
    const safe = safeArea();
    this.insets = { top: HUD_TOP_INSET + safe.top, bottom: Math.max(dpadVisible ? DPAD_INSET + safe.bottom : 0, this.panelBottom) };
    // Масштаб не прыгает от панели мини-игры: для укрупнения комнаты считаем только HUD и d-pad.
    const zoom = pickZoom(width, height, mw, mh, height - HUD_TOP_INSET - safe.top - (dpadVisible ? DPAD_INSET + safe.bottom : 0));
    cam.setZoom(zoom);
    cam.stopFollow();
    cam.removeBounds();
    this.cam0 = { zoom, mw, mh, fitsW: mw * zoom <= width, fitsH: mh * zoom <= height - this.insets.top - this.insets.bottom };
    this.updateCamera();
  }

  /**
   * Центр камеры вручную каждый кадр: по оси, где карта не влезает, следует за героем (центр видимой зоны между HUD и
   * d-pad); где влезает — карта по центру зоны. Центр кратен 1/zoom: пиксели ровные.
   */
  private updateCamera(): void {
    const c0 = this.cam0;
    if (!c0) return;
    const z = c0.zoom;
    const W = this.scale.width / z;
    const H = this.scale.height / z;
    const tz = this.insets.top / z;
    const bz = this.insets.bottom / z;
    const [px, py] = LocationModel.pos(this.model.player);
    const shift = (bz - tz) / 2;
    const cx = c0.fitsW ? c0.mw / 2 : Math.min(Math.max(Math.round((px + 0.5) * T), W / 2), c0.mw - W / 2);
    const cy = c0.fitsH ? c0.mh / 2 + shift : Math.min(Math.max(Math.round(py * T + T / 2) + shift, H / 2 - tz), c0.mh - H / 2 + bz);
    this.cameras.main.centerOn(Math.round(cx * z) / z, Math.round(cy * z) / z);
  }

  // ───────────── «A»-пузырёк ─────────────

  /** Пиксельная «A» 5×6 (текст в canvas запрещён, только DOM). */
  private static readonly GLYPH_A = ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X'];

  /** Белый пузырёк с «A» над объектом, с которым сработает кнопка действия с этой клетки. */
  private drawActionBubble(time: number): void {
    const t = this.inputOn && !this.leaving ? this.model.actionHint() : null;
    const bob = Math.floor(time / 450) % 2;
    this.emitNear(t);
    const key = t ? `${t.key}@${t.tile[0]},${t.tile[1]}:${bob}` : '';
    if (key === this.markerKey) return;
    this.markerKey = key;
    const g = this.marker.clear();
    const o = t ? this.model.object(t.key) : undefined;
    if (!t || !o) return;
    const w = 11;
    const h = 10;
    const cx = (o.at[0] + o.size[0] / 2) * T;
    const tip = this.propTop(o.at, o.size, o.key) - 1 - bob;
    const x0 = Math.round(cx - w / 2);
    const y0 = tip - 3 - h;
    const ink = 0x2a1418;
    g.fillStyle(ink, 1).fillTriangle(cx - 3, y0 + h, cx + 3, y0 + h, cx, tip + 1);
    g.fillStyle(ink, 1).fillRect(x0 - 1, y0, w + 2, h).fillRect(x0, y0 - 1, w, h + 2);
    g.fillStyle(0xfff8e8, 1).fillRect(x0, y0, w, h);
    g.fillStyle(0xb84c40, 1);
    World.GLYPH_A.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === 'X') g.fillRect(x0 + 3 + rx, y0 + 2 + ry, 1, 1);
    });
  }

  /** Подсказка первого подхода: сообщаем DOM, что герой стоит у объекта (и где он на экране); отошёл или экран открыт — null. */
  private emitNear(t: { key: string; tile: Xy } | null): void {
    const o = t ? this.model.object(t.key) : undefined;
    const key = o?.use ? o.key : '';
    if (key === this.nearKey) return;
    this.nearKey = key;
    if (!o?.use) {
      bus.emit('fx:near', null);
      return;
    }
    const p = this.toScreen((o.at[0] + o.size[0] / 2) * T, this.propTop(o.at, o.size, o.key) - 22);
    bus.emit('fx:near', { use: o.use, id: o.id, x: p.x, y: p.y });
  }

  /** Верх спрайта объекта в пикселях мира (пузырёк стоит над ним). */
  private propTop(at: Xy, size: Xy, key: string): number {
    const src = this.mapDef.objects.find((o): o is PropObject => o.type === 'prop' && `prop:${o.id}` === key);
    const meta = src ? this.sprites[src.sprite] : undefined;
    return (at[1] + size[1]) * T - (meta ? meta.size[1] : T);
  }

  // ───────────── построение ─────────────

  private createAnims(): void {
    for (const id of ['hero', 'cat']) {
      const meta = this.sprites[id];
      if (!meta) continue;
      for (const [name, frames] of Object.entries(meta.anims)) {
        const key = `${id}:${name}`;
        if (this.anims.exists(key)) continue;
        const walk = name.startsWith('walk') || name.startsWith('carry_walk');
        const action = name.startsWith('water') || name.startsWith('fert') || name.startsWith('throw');
        const rate = walk ? 9 : action ? 5 : name === 'wash' ? 3 : name === 'sleep' || name.startsWith('lie') ? 1.2 : name.startsWith('sniff') ? 2.5 : name.startsWith('crouch') ? 3 : 1;
        this.anims.create({ key, frames: frames.map((frame) => ({ key: ATLAS, frame })), frameRate: rate, repeat: -1 });
      }
    }
  }

  private buildTiles(): void {
    const ts = this.cache.json.get(TILESET) as TilesetMeta;
    const { ground, deco } = tileLayers(ts, this.mapDef, this.model.parsed);
    const { w, h } = this.model.parsed;
    const map = this.make.tilemap({ width: w, height: h, tileWidth: T, tileHeight: T });
    const tileset = map.addTilesetImage(TILESET, TILESET, T, T, ts.margin, ts.spacing);
    if (!tileset) throw new Error('World: тайлсет не загрузился');
    const put = (name: string, grid: number[][], depth: number): void => {
      if (!grid.some((r) => r.some((i) => i >= 0))) return;
      const layer = map.createBlankLayer(name, tileset, 0, 0, w, h, T, T);
      if (!layer) return;
      layer.setDepth(depth);
      grid.forEach((row, y) => row.forEach((i, x) => i >= 0 && layer.putTileAt(i, x, y)));
    };
    put('ground', ground, 0);
    this.groundLayer = map.getLayer('ground')?.tilemapLayer ?? null;
    this.tileset = ts;
    put('deco', deco, 3);
  }

  /** Вскопать клетки грядок (расширение участка): земля с автотайлами по соседям. */
  private soil(cells: readonly Xy[]): void {
    const key = cells.map((c) => c.join(',')).join(';');
    if (key === this.soilKey || !this.groundLayer || !this.tileset) return;
    this.soilKey = key;
    const grid = this.model.parsed.ground.map((r) => [...r]);
    for (const [x, y] of cells) if (grid[y]?.[x] !== undefined) grid[y]![x] = 's';
    const touched = new Set<string>();
    for (const [x, y] of cells) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) touched.add(`${x + dx},${y + dy}`);
    for (const k of touched) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      if (x < 0 || y < 0 || x >= this.model.parsed.w || y >= this.model.parsed.h) continue;
      this.groundLayer.putTileAt(frameFor(this.tileset, this.mapDef, grid, x, y), x, y);
    }
  }

  /** Точка мира → экранные CSS px (для DOM-надписей над миром). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const r = this.game.canvas.getBoundingClientRect();
    const sx = r.width / this.scale.width || 1;
    return { x: r.left + (x - cam.worldView.x) * cam.zoom * sx, y: r.top + (y - cam.worldView.y) * cam.zoom * sx };
  }

  /** Мягкая тень: полупрозрачный овал в два слоя (в атласе альфы нет). Текстура на каждую ширину один раз. */
  private shadowTexture(width: number): string {
    const key = `shadow:${width}`;
    if (this.textures.exists(key)) return key;
    const h = Math.max(4, Math.round(width / 3.4));
    const tex = this.textures.createCanvas(key, width, h);
    if (!tex) return key;
    const ctx = tex.context;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < width; x++) {
        const dx = (x + 0.5 - width / 2) / (width / 2);
        const dy = (y + 0.5 - h / 2) / (h / 2);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        ctx.fillStyle = d < 0.5 ? 'rgba(34, 20, 30, 0.26)' : 'rgba(34, 20, 30, 0.14)';
        ctx.fillRect(x, y, 1, 1);
      }
    tex.refresh();
    return key;
  }

  private placeShadow(cx: number, bottom: number, width: number, depth: number): Phaser.GameObjects.Image {
    const key = this.shadowTexture(width);
    const img = this.add.image(Math.round(cx), Math.round(bottom), key);
    img.setOrigin(0.5, 0.65).setDepth(depth);
    return img;
  }

  private buildProps(): void {
    for (const o of this.model.objects) {
      if (o.kind !== 'prop') continue;
      const src = o.src as PropObject;
      const meta = this.sprites[src.sprite];
      if (!meta) throw new Error(`World: нет спрайта "${src.sprite}"`);
      const cx = (o.at[0] + o.size[0] / 2) * T;
      const bottom = (o.at[1] + o.size[1]) * T;
      const s = this.add.sprite(cx, bottom - (src.dy ?? 0), ATLAS, meta.frames[0]);
      s.setOrigin(0.5, 1);
      s.setDepth(src.depth === 'floor' ? 1.5 : src.depth === 'wall' ? 2 : 10 + bottom + (src.z ?? 0));
      // Украшение с несколькими кадрами (огонёк знича, флажок, гирлянда) — тихая петля.
      if ((src.decor || src.unlock) && meta.frames.length > 1) {
        const key = `decor:${src.sprite}`;
        if (!this.anims.exists(key)) this.anims.create({ key, frames: meta.frames.map((f) => ({ key: ATLAS, frame: f })), frameRate: src.unlock ? 1.5 : 4, repeat: -1 });
        s.play(key);
      }
      if (src.shadow) this.placeShadow(cx, bottom - 1, src.shadow, 2.5);
      s.setData('sprite', src.sprite);
      this.propSprites.set(o.key, s);
    }
  }

  private buildActors(): void {
    const p = this.model.player;
    this.heroShadow = this.placeShadow(0, 0, 12, 9);
    this.hero = this.add.sprite(0, 0, ATLAS, 'hero/0').setOrigin(0.5, 1);
    this.syncHero(0);
    void p;
    const c = this.model.cat;
    if (c) {
      this.catShadow = this.placeShadow(0, 0, 10, 9);
      this.catSprite = this.add.sprite(0, 0, ATLAS, 'cat/0').setOrigin(0.5, 1);
      this.syncCat();
    }
  }

  // ───────────── ввод и события ─────────────

  private onIntent(i: RoutedIntent): void {
    if (i.to !== 'world' || this.leaving || !this.inputOn || this.farm?.blocking) return;
    // Игрок сам пошёл — «Idź» отменяется.
    if (i.type === 'move' || i.type === 'goto') {
      pendingGoto = null;
      this.zagroda?.cancelTour();
    }
    this.model.intent(i);
  }

  private onWorldEvent(ev: WorldEvent, time: number): void {
    switch (ev.type) {
      case 'interact': {
        const { type: _t, ...rest } = ev;
        bus.emit('world:interact', { location: this.mapDef.id, ...rest, tile: [ev.tile[0], ev.tile[1]], hero: [ev.hero[0], ev.hero[1]] });
        break;
      }
      case 'exit':
        bus.emit('world:exit', { from: this.mapDef.id, to: ev.to, spawn: ev.spawn });
        this.go(ev.to, ev.spawn);
        break;
      case 'bump':
        this.bump = { dir: ev.dir, until: time + 120 };
        break;
      case 'step':
        // Шаг героя: доски в доме, трава на ферме (звук играет sfx.ts; в `?mute=1` он не подключён).
        bus.emit('fx:sfx', { name: this.mapDef.id === 'home' ? 'step_wood' : 'step_grass' });
        break;
    }
  }

  private go(map: string, spawn: string | readonly number[], facing?: Dir): void {
    if (this.leaving) return;
    this.leaving = true;
    this.model.halt();
    this.emitGuide();
    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ map, spawn, ...(facing ? { facing } : {}) }));
    // force: переход сразу после входа (идёт fadeIn) иначе игнорировался бы, сцена зависла бы в `leaving`.
    cam.fade(150, 46, 91, 59, true);
  }

  // ───────────── отрисовка актёров ─────────────

  private put(s: Phaser.GameObjects.Sprite, shadow: Phaser.GameObjects.Image | null, a: Actor, ox = 0, oy = 0): void {
    const [fx, fy] = LocationModel.pos(a);
    const x = Math.round(fx * T + T / 2 + ox);
    const bottom = Math.round(fy * T + T + oy);
    s.setPosition(x, bottom);
    s.setDepth(10 + bottom);
    shadow?.setPosition(x, bottom - 1);
  }

  private syncHero(time: number): void {
    const a = this.model.player;
    let ox = 0;
    let oy = 0;
    if (this.bump && this.bump.until > time) {
      ox = this.bump.dir === 'left' ? -1 : this.bump.dir === 'right' ? 1 : 0;
      oy = this.bump.dir === 'up' ? -1 : this.bump.dir === 'down' ? 1 : 0;
    }
    this.put(this.hero, this.heroShadow, a, ox, oy);
    // Герой выше кота на той же строке: рисуем поверх.
    this.hero.setDepth(this.hero.depth + 0.5);
    const key = this.farm?.heroAnim(a.facing, !!a.step, (k) => this.anims.exists(k)) ?? `hero:${a.step ? 'walk' : 'idle'}_${a.facing}`;
    if (this.hero.anims.currentAnim?.key !== key) this.hero.play(key);
  }

  private syncCat(): void {
    const c = this.model.cat;
    const s = this.catSprite;
    if (!c || !s) return;
    this.put(s, this.catShadow, c, 0, c.perch && !c.step ? -4 : 0);
    const side = c.facing === 'left' ? 'left' : 'right';
    const key = c.mode === 'follow' ? `cat:${c.step ? 'walk' : 'idle'}_${c.facing}` : ['lie', 'sniff', 'crouch', 'pounce'].includes(c.mode) ? `cat:${c.mode}_${side}` : `cat:${c.mode}`;
    if (s.anims.currentAnim?.key !== key) s.play(key);
  }
}
