import Phaser from 'phaser';
import { bus } from '../systems/bus';
import { getContent } from '../systems/content';
import type { TileHit } from '../input/pointer';
import type { Dir, RoutedIntent } from '../types/input';
import type { LocationMap } from '../types/content';
import type { BusEvents, GuideTarget, PlotCellView, PlotView } from '../types/bus';
import { cellAt } from '../world/dzialka';
import { bobrSpot, besideCell, edgeArrow, faceTowards, guidePath, nextHop, pointerCell, resolveGuide, type ResolvedGuide } from '../world/guide';
import { tileLayers, type TilesetMeta, type Xy } from '../world/ascii';
import { playerTextureKey } from '../world/avatar';
import { hudDodge, pickZoom, type ScreenRect } from '../world/camera';
import { BOBR_KEY, DELTA, LocationModel, type Actor, type WorldEvent } from '../world/location';

// Location (ТЗ §5.4–5.5): ASCII-карта, Дима, NPC, слова, выходы, бобр-компаньон. Логика в
// world/location.ts, сцена только рисует и переводит события модели в шину. Ввод приходит
// intents через bus (`input:intent`, to = world); тап по карте разбирает PointerSource через tileAt().

const T = 16;
/** Шаг Казика в сторону, мс (как шаг Димы). */
const STEP_MS_SCENE = 220;
const ATLAS = 'custom';
const TILESET = 'ninja16';

interface SpriteMeta {
  size: [number, number];
  anchor: [number, number];
  frames: string[];
  anims: Record<string, string[]>;
}
type SpritesMeta = Record<string, SpriteMeta>;

export interface LocationData {
  location?: string;
  spawn?: string | Xy;
  facing?: Dir;
}

const url = (p: string): string => `${import.meta.env.BASE_URL}${p}`;

/**
 * Высота d-pad снизу в CSS-пикселях (src/ui/dpad.ts: крест 120 px + отступ 16 px + запас): пока он виден, камера
 * разрешает карте уехать вверх на эту высоту — нижний ряд не прячется под крестом (P-05).
 */
export const DPAD_INSET = 148;
/**
 * Сверху экран занимает строка «Сейчас» и кнопки HUD (CSS-пиксели): стрелка к цели за краем не прячется под ними,
 * так же как снизу — под d-pad (P-10a).
 */
export const HUD_TOP_INSET = 64;
let dpadVisible = false;

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
bus.on('input:dpad', ({ visible }) => {
  dpadVisible = visible;
  for (const fn of dpadWatchers) fn();
});
const dpadWatchers = new Set<() => void>();
/** Колонка кнопок HUD справа (P-12, `ui:hud:rect`): цель не прячется под ней, камера сдвигает картинку. */
let hudRect: ScreenRect | null = null;
bus.on('ui:hud:rect', (r) => {
  hudRect = r;
});

export class Location extends Phaser.Scene {
  private model!: LocationModel;
  private mapDef!: LocationMap;
  private sprites!: SpritesMeta;
  private player!: Phaser.GameObjects.Sprite;
  /** Спрайт игрока: `avatar` из Fotobudka (P-03) или `dima` из атласа. */
  private playerSid = 'dima';
  private companion: Phaser.GameObjects.Sprite | null = null;
  private npcs = new Map<string, Phaser.GameObjects.Sprite>();
  private marker!: Phaser.GameObjects.Graphics;
  private markerKey = '';
  private bump: { dir: Dir; until: number } | null = null;
  private data0: LocationData = {};
  private leaving = false;
  /** Грядки и «!» (I-12, `world:marks`): спрайты растений по клеткам, метки над словами. */
  private plots: PlotView[] = [];
  private plants = new Map<string, { plant: Phaser.GameObjects.Sprite; mark: Phaser.GameObjects.Sprite | null; cell: PlotCellView }>();
  private wordMarks = new Map<string, Phaser.GameObjects.Sprite>();
  private wordSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private wasMoving = false;
  /** Цель режиссёра (I-13): контур, путь пунктиром, стрелка у края, бобр-указатель. */
  private guideTarget: GuideTarget | null = null;
  private guide: ResolvedGuide | null = null;
  private guideG!: Phaser.GameObjects.Graphics;
  private guideKey = '';
  /** Дом бобра на карте, где он NPC (działka): сюда он возвращается, когда цели нет. */
  private bobrHome: Xy | null = null;
  /** «A»-пузырёк над тем, с чем сработает кнопка действия (P-02). */
  private aBubble!: Phaser.GameObjects.Graphics;
  private aKey = '';
  /** «!» растения-цели спрятан, пока над ним «A». */
  private aHiddenMark: Phaser.GameObjects.Sprite | null = null;
  /** Мир принимает ввод (оверлей закрыт). */
  private inputOn = true;
  /** Последняя отправленная экранная точка Казика (`world:anchor`). */
  private anchorKey = '';
  /** Последняя подпись растения (`world:label`). */
  private labelKey = '';
  /** Последние отправленные входы в места (`world:spots`, Wola). */
  private spotsKey = '';
  /** Цель шага — бобр-компаньон: контур и стрелка идут за ним каждый кадр (P-10a). */
  private guideLive = false;
  /** Запас сверху и снизу под HUD и d-pad, CSS-пиксели (layout). */
  private insets = { top: 0, bottom: 0 };
  /**
   * Камера (P-10a, P-12): по оси, где карта не влезает, следует за Димой (центр видимой зоны между HUD и d-pad) и
   * сдвигается к цели рядом; где влезает — карта по центру зоны над d-pad. `dodge` — сдвиг, чтобы цель не стояла
   * под колонкой кнопок справа. Центр ставится вручную каждый кадр (`placeCamera`), без startFollow и границ Phaser.
   */
  private cam0: { zoom: number; mw: number; mh: number; fitsW: boolean; fitsH: boolean; centered: boolean; bottom: number; base: number; inset: number } | null = null;
  private follow: { off: [number, number]; dodge: [number, number] } = { off: [0, 0], dodge: [0, 0] };

  constructor() {
    super('Location');
  }

  init(data: LocationData): void {
    this.data0 = data ?? {};
    this.leaving = false;
    this.npcs = new Map();
    this.companion = null;
    this.bump = null;
    this.plots = [];
    this.plants = new Map();
    this.wordMarks = new Map();
    this.wordSprites = new Map();
    this.wasMoving = false;
    this.guide = null;
    this.guideKey = '';
    this.bobrHome = null;
    this.aKey = '';
    this.aHiddenMark = null;
    this.anchorKey = '';
    this.labelKey = '';
    this.spotsKey = '';
    this.guideLive = false;
  }

  preload(): void {
    if (!this.textures.exists(TILESET)) this.load.image(TILESET, url(`atlas/${TILESET}.png`));
    if (!this.cache.json.exists(TILESET)) this.load.json(TILESET, url(`atlas/${TILESET}.json`));
    if (!this.textures.exists(ATLAS)) this.load.atlas(ATLAS, url('atlas/custom.png'), url('atlas/custom.json'));
    if (!this.cache.json.exists('sprites')) this.load.json('sprites', url('atlas/sprites.json'));
  }

  create(): void {
    const content = getContent();
    const id = this.data0.location ?? content.world.start.location;
    const owned = content.maps.get(id);
    if (!owned) throw new Error(`Location: нет карты "${id}"`);
    this.mapDef = owned.value;
    const spawnRef = this.data0.spawn ?? (id === content.world.start.location ? content.world.start.spawn : 'default');
    const spawn: readonly number[] =
      typeof spawnRef === 'string' ? (this.mapDef.spawns[spawnRef] ?? this.mapDef.spawns.default)! : spawnRef;
    // Wola (W-01): без бобра — склейка ставит `world:companion = false` в registry, переживает перезапуск сцены.
    const companion = this.registry.get('world:companion') === false ? { companion: false } : {};
    // Wola (W-04): короткий тап крестовины — поворот и шаг; A у двери — войти (`world:wola` в registry).
    const wola = this.registry.get('world:wola') === true ? { tapStep: true, doorA: true } : {};
    this.model = new LocationModel(this.mapDef, [spawn[0]!, spawn[1]!], { facing: this.data0.facing ?? 'down', ...companion, ...wola });
    this.sprites = this.cache.json.get('sprites') as SpritesMeta;

    this.createAnims();
    this.buildTiles();
    this.buildObjects();
    this.buildActors();
    this.marker = this.add.graphics().setDepth(10_000);
    this.markerKey = '';
    this.guideG = this.add.graphics().setDepth(9_500);
    this.aBubble = this.add.graphics().setDepth(10_500);
    this.bobrHome = this.model.object('npc:bobr')?.at ?? null;

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    const offIntent = bus.on('input:intent', (i) => this.onIntent(i));
    const offInput = bus.on('world:input', ({ enabled }) => {
      this.inputOn = enabled;
      if (!enabled) this.model.halt();
    });
    // Вкладка свернулась (P-02, исследование §6в п. 10): Phaser сам ставит цикл на паузу, здесь — стоп ходьбы,
    // чтобы после возврата Дима стоял на той же клетке, а не «доходил» зажатую кнопку.
    const onHidden = (): void => this.model.halt();
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.on(Phaser.Scenes.Events.RENDER, this.emitAnchor, this);
    const offTeleport = bus.on('world:teleport', ({ location, spawn, facing }) => this.go(location, spawn, facing));
    const onDpad = (): void => this.layout();
    dpadWatchers.add(onDpad);
    const offMarks = bus.on('world:marks', (m) => {
      if (m.location === this.mapDef.id && !this.leaving) this.applyMarks(m);
    });
    const offGuide = bus.on('guide:target', ({ target }) => {
      this.guideTarget = target;
      this.applyGuide();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offIntent();
      offInput();
      offTeleport();
      dpadWatchers.delete(onDpad);
      offMarks();
      offGuide();
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.events.off(Phaser.Scenes.Events.RENDER, this.emitAnchor, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      bus.emit('world:anchor', { id: 'bobr', at: null });
      bus.emit('world:label', null);
      if (this.spotsKey) bus.emit('world:spots', { location: this.mapDef.id, spots: [] });
    });
    this.cameras.main.fadeIn(150, 26, 28, 44);
    bus.emit('world:location', { id: this.mapDef.id, controls: this.mapDef.controls });
  }

  /** Экранные CSS-пиксели канваса → клетка и объект под пальцем (для PointerSource). */
  tileAt(x: number, y: number): TileHit | null {
    if (!this.model || this.leaving) return null;
    const p = this.cameras.main.getWorldPoint(x, y);
    const tx = Math.floor(p.x / T);
    const ty = Math.floor(p.y / T);
    if (tx < 0 || ty < 0 || tx >= this.model.parsed.w || ty >= this.model.parsed.h) return null;
    const target = this.model.targetAt([tx, ty]);
    if (target) return { tile: [tx, ty], target };
    // Палец на крыше или стене дома, дверь которого подсвечена (P-12): идём в дверь.
    const door = this.model.doorFor([tx, ty]);
    return { tile: door ? [door[0], door[1]] : [tx, ty] };
  }

  /** Состояние для dev-проверок и тестов в браузере. */
  get state(): { location: string; controls: string; tile: Xy; facing: Dir; moving: boolean; highlight: string | null; aBubble: string | null; companion: Xy | null; zoom: number } {
    const m = this.model;
    const a = this.inputOn ? m.actionHint() : null;
    return {
      location: this.mapDef.id,
      controls: m.controls,
      tile: m.player.tile,
      facing: m.player.facing,
      moving: m.moving,
      highlight: m.highlight()?.key ?? null,
      aBubble: a ? `${a.key}@${a.tile[0]},${a.tile[1]}` : null,
      companion: m.companion?.tile ?? null,
      zoom: this.cameras.main.zoom,
    };
  }

  override update(time: number, delta: number): void {
    if (this.leaving) return;
    for (const ev of this.model.update(Math.min(delta, 100))) this.onWorldEvent(ev, time);
    const moving = this.model.moving;
    if (this.wasMoving && !moving && !this.leaving) {
      const [x, y] = this.model.player.tile;
      bus.emit('world:position', { location: this.mapDef.id, x, y });
      // Цель шага — Казик (P-10a): Дима остановился — Казик снова подходит к нему.
      if (this.targetsBobr()) this.applyGuide();
    }
    this.wasMoving = moving;
    this.syncActor(this.player, this.playerSid, this.model.player, time);
    if (this.companion && this.model.companion) this.syncActor(this.companion, 'bobr', this.model.companion, time);
    this.updateFollow();
    this.drawHighlight(time);
    this.drawActionBubble(time);
    this.drawGuide(time);
  }

  /**
   * Цель в кадре (P-10a): камера держит Диму в видимой зоне (между HUD и d-pad) и, если цель режиссёра рядом,
   * сдвигается к ней, чтобы и цель была видна над кнопками, а не под ними. Плавно, без рывков.
   * P-12: цель (и дверь с домом над ней) не встаёт под колонку кнопок справа — картинка уезжает вниз или влево.
   */
  private updateFollow(snap = false): void {
    const c0 = this.cam0;
    if (!c0) return;
    const cam = this.cameras.main;
    const z = c0.zoom;
    const g = this.guide;
    const f = this.follow;
    const W = this.scale.width / z;
    const H = this.scale.height / z;
    let sx = 0;
    let sy = 0;
    if (g && !c0.centered) {
      const [px, py] = LocationModel.pos(this.model.player);
      const halfW = this.scale.width / z / 2 - T;
      const halfH = (this.scale.height - this.insets.top - this.insets.bottom) / z / 2 - T;
      const dx = (g.at[0] + g.size[0] / 2 - (px + 0.5)) * T;
      const dy = (g.at[1] + g.size[1] / 2 - (py + 0.5)) * T;
      const need = (d: number, half: number): number => (Math.abs(d) <= half ? 0 : Math.sign(d) * Math.min(Math.abs(d) - half, half - T));
      if (!c0.fitsW) sx = need(dx, halfW);
      if (!c0.fitsH) sy = need(dy, halfH);
    }
    const k = snap ? 1 : 0.12;
    const ease = (v: [number, number], tx: number, ty: number): void => {
      v[0] += (tx - v[0]) * k;
      v[1] += (ty - v[1]) * k;
      if (Math.abs(tx - v[0]) < 0.5) v[0] = tx;
      if (Math.abs(ty - v[1]) < 0.5) v[1] = ty;
    };
    ease(f.off, sx, sy);
    // Центр камеры без учёта колонки HUD.
    let cx: number;
    let cy: number;
    if (c0.centered) {
      cx = c0.mw / 2;
      cy = c0.mh / 2 + (c0.fitsH ? this.insets.bottom / z / 2 : 0);
    } else {
      const p = this.player;
      cx = c0.fitsW ? c0.mw / 2 : Math.round(p.x + f.off[0]);
      cy = c0.fitsH ? c0.mh / 2 + this.insets.bottom / z / 2 : Math.round(p.y + c0.base + f.off[1]);
      if (!c0.fitsW) cx = Math.min(Math.max(cx, W / 2), c0.mw - W / 2);
      if (!c0.fitsH) cy = Math.min(Math.max(cy, H / 2), c0.mh + c0.inset - H / 2);
    }
    // Колонка HUD: цель под ней — сдвиг картинки.
    let tx = 0;
    let ty = 0;
    if (g && this.model.controls === 'walk') {
      const r = this.game.canvas.getBoundingClientRect();
      // Дверь вместе с домом над ней: выход — клетка, а тапают по крыше.
      const exit = this.model.object(g.key)?.kind === 'exit';
      const top = exit ? g.at[1] - 1 : g.at[1];
      const toScreen = (wx: number, wy: number): [number, number] => [(wx - (cx - W / 2)) * z + r.left, (wy - (cy - H / 2)) * z + r.top];
      const [l, t] = toScreen(g.at[0] * T, top * T);
      const [rr, b] = toScreen((g.at[0] + g.size[0]) * T, (g.at[1] + g.size[1]) * T);
      const [dx, dy] = hudDodge({ left: l, top: t, right: rr, bottom: b }, hudRect, { width: r.left + this.scale.width, height: r.top + this.scale.height, bottom: this.insets.bottom });
      tx = -dx / z;
      ty = -dy / z;
    }
    ease(f.dodge, tx, ty);
    cam.centerOn(Math.round((cx + f.dodge[0]) * z) / z, Math.round((cy + f.dodge[1]) * z) / z);
  }

  // ───────────── «A»-пузырёк и якорь Казика (P-02) ─────────────

  /** Пиксельная «A» 5×6 (не текст: canvas рисует только цифры HUD). */
  private static readonly GLYPH_A = ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X'];

  /**
   * «A»-пузырёк (исследование §3.2, §6в п. 4): белый пузырёк с «A» над объектом, с которым сработает кнопка
   * действия с этой клетки. Пока Дима идёт или открыт оверлей, пузырька нет.
   */
  private drawActionBubble(time: number): void {
    const t = this.inputOn && !this.leaving ? this.model.actionHint() : null;
    const bob = Math.floor(time / 450) % 2;
    const key = t ? `${t.key}@${t.tile[0]},${t.tile[1]}:${bob}` : '';
    if (key === this.aKey) return;
    this.aKey = key;
    const g = this.aBubble.clear();
    const mark = t ? (this.plants.get(`${t.tile[0]},${t.tile[1]}`)?.mark ?? null) : null;
    if (this.aHiddenMark && this.aHiddenMark !== mark) this.aHiddenMark.setVisible(true);
    this.aHiddenMark = mark;
    mark?.setVisible(false);
    if (!t) return;
    const o = this.model.object(t.key);
    if (!o) return;
    const w = 11;
    const h = 10;
    const ink = 0x141b1b;
    const paper = 0xf4f4f4;
    // Дима стоит прямо над целью (смотрит вниз): над целью его голова. Пузырёк — справа от Димы, на его клетке
    // по высоте (не на соседней грядке), хвостиком вниз-влево к цели.
    const side = this.model.player.facing === 'down' && this.model.player.tile[0] === t.tile[0];
    let x0: number;
    let y0: number;
    if (side) {
      x0 = (t.tile[0] + 1) * T + 1;
      y0 = (t.tile[1] - 1) * T + 2 - bob;
      g.fillStyle(ink, 1).fillTriangle(x0 - 1, y0 + h - 4, x0 + 4, y0 + h, x0 - 4, t.tile[1] * T + 3 - bob);
    } else {
      const cx = t.tile[0] * T + T / 2;
      const top = (o.kind === 'plot' ? t.tile[1] : o.at[1]) * T;
      const tip = top - 1 - bob;
      x0 = Math.round(cx - w / 2);
      y0 = tip - 3 - h;
      g.fillStyle(ink, 1).fillTriangle(cx - 3, y0 + h, cx + 3, y0 + h, cx, tip + 1);
    }
    g.fillStyle(ink, 1).fillRect(x0 - 1, y0, w + 2, h).fillRect(x0, y0 - 1, w, h + 2);
    g.fillStyle(paper, 1).fillRect(x0, y0, w, h);
    g.fillStyle(0xb13e53, 1);
    Location.GLYPH_A.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === 'X') g.fillRect(x0 + 3 + rx, y0 + 2 + ry, 1, 1);
    });
  }

  /**
   * Экранная точка над головой Казика (`world:anchor`): пузырь его реплики живёт в мире над спрайтом (P-02).
   * После отрисовки кадра: камера уже сдвинута, точка совпадает с картинкой.
   */
  private emitAnchor(): void {
    if (!this.model || this.leaving) return;
    const npc = this.npcs.get('npc:bobr');
    const s = npc && !this.model.isHidden('npc:bobr') ? npc : this.companion;
    let at: { x: number; y: number } | null = null;
    const view = this.cameras.main.worldView;
    // За кадром Казика не видно: пузырь над пустым краем экрана путает — оверлей покажет его с портретом.
    const seen = s?.visible && s.x >= view.x + 4 && s.x <= view.right - 4 && s.y - 8 >= view.y && s.y - 8 <= view.bottom;
    if (s && seen) {
      const cam = this.cameras.main;
      const r = this.game.canvas.getBoundingClientRect();
      const top = s.y - s.displayHeight * s.originY;
      at = {
        x: Math.round((s.x - cam.worldView.x) * cam.zoom + cam.x + r.left),
        y: Math.round((top - cam.worldView.y) * cam.zoom + cam.y + r.top),
      };
    }
    const key = at ? `${at.x},${at.y}` : '-';
    this.emitPlantLabel();
    this.emitSpots();
    if (key === this.anchorKey) return;
    this.anchorKey = key;
    bus.emit('world:anchor', { id: 'bobr', at });
  }

  /** Входы в места (Wola, W-01): экранные точки дверей `place:<id>` для подписей DOM. */
  private emitSpots(): void {
    const doors = this.model.objects.filter((o) => o.kind === 'exit' && (o.src as { to: string }).to.startsWith('place:'));
    if (!doors.length && this.spotsKey === '') return;
    const cam = this.cameras.main;
    const r = this.game.canvas.getBoundingClientRect();
    const spots = doors.map((o) => ({
      id: (o.src as { to: string }).to.slice('place:'.length),
      x: Math.round(((o.at[0] + 0.5) * T - cam.worldView.x) * cam.zoom + cam.x + r.left),
      y: Math.round((o.at[1] * T - cam.worldView.y) * cam.zoom + cam.y + r.top),
      cell: Math.round(T * cam.zoom),
    }));
    const key = `${this.mapDef.id}|${spots.map((s) => `${s.id}:${s.x},${s.y}`).join(';')}`;
    if (key === this.spotsKey) return;
    this.spotsKey = key;
    bus.emit('world:spots', { location: this.mapDef.id, spots });
  }

  /** Подпись растения под «A» (P-11): какое слово растёт на клетке, с которой сработает A. Текст рисует DOM. */
  private emitPlantLabel(): void {
    const t = this.inputOn ? this.model.actionHint() : null;
    const cell = t ? this.plants.get(`${t.tile[0]},${t.tile[1]}`)?.cell : undefined;
    const text = cell?.item ? getContent().vocab.get(cell.item)?.value.pl : undefined;
    let v: { text: string; at: { x: number; y: number } } | null = null;
    if (t && text) {
      const cam = this.cameras.main;
      const r = this.game.canvas.getBoundingClientRect();
      v = {
        text,
        at: {
          x: Math.round(((t.tile[0] + 0.5) * T - cam.worldView.x) * cam.zoom + cam.x + r.left),
          y: Math.round((t.tile[1] * T - cam.worldView.y) * cam.zoom + cam.y + r.top),
        },
      };
    }
    const key = v ? `${v.text}@${v.at.x},${v.at.y}` : '-';
    if (key === this.labelKey) return;
    this.labelKey = key;
    bus.emit('world:label', v);
  }

  // ───────────── цель режиссёра (I-13) ─────────────

  /** Состояние подсветки для dev-проверок. */
  get guideState(): { key: string | null; at: Xy | null; viaExit: boolean; pointer: Xy | null } {
    return { key: this.guide?.key ?? null, at: this.guide?.at ?? null, viaExit: this.guide?.viaExit ?? false, pointer: this.model.pointing ?? this.model.object('npc:bobr')?.at ?? null };
  }

  /** Следующая карта по пути к цели в другой локации (P-12). */
  private readonly route = (from: string, to: string): string | null => {
    const maps = new Map([...getContent().maps].map(([id, d]) => [id, d.value as unknown as { objects: readonly { type: string; to?: string }[] }]));
    return nextHop(maps, from, to);
  };

  private hiddenKeys(): Set<string> {
    return new Set(this.model.objects.filter((o) => this.model.isHidden(o.key)).map((o) => o.key));
  }

  /** Цель шага — сам Казик (NPC `bobr` или компаньон). */
  private targetsBobr(): boolean {
    const t = this.guideTarget;
    return !!t && t.location === this.mapDef.id && t.npc === 'bobr' && !t.plot && !t.object;
  }

  private applyGuide(): void {
    if (!this.model || this.leaving) return;
    const m = this.model;
    const targetsBobr = this.targetsBobr();
    const reserved = m.reserved();
    // Казик не встаёт на клетку Димы и на выход (калитка, лестница): проход не перегораживает (P-10a).
    const exits = m.objects.filter((o) => o.kind === 'exit' && !m.isHidden(o.key)).map((o) => o.at);
    const free = (x: number, y: number): boolean =>
      m.passable(x, y) && !reserved.some((r) => r[0] === x && r[1] === y) && !exits.some((e) => e[0] === x && e[1] === y);
    let g = resolveGuide(m, this.guideTarget, this.plots, this.hiddenKeys(), this.route);
    // Бобр-указатель (§4.12): в walk-локации идёт к клетке у цели и смотрит на неё; на карте, где он NPC,
    // садится у цели. Цель — сам Казик (P-10a): подходит к Диме сзади-сбоку, компаньон просто идёт следом.
    if (m.companion) {
      const c = m.companion;
      if (g && !targetsBobr) {
        // P-11: не на подход к цели, не на путь Димы и не перед его лицом; места нет — просто идёт следом.
        const cell = pointerCell({ w: m.parsed.w, h: m.parsed.h, passable: free }, g, m.player.tile, c.tile, { walk: m.walkGrid(g.viaExit ? g.at : null), facing: m.player.facing });
        m.pointTo(cell, cell ? faceTowards(cell, g.at, g.size) : null);
      } else if (targetsBobr && Math.abs(c.tile[0] - m.player.tile[0]) + Math.abs(c.tile[1] - m.player.tile[1]) > 1) {
        // Цель — Казик, а он отстал (стоял у прошлой цели): сам подходит к Диме сбоку.
        const cell = besideCell({ w: m.parsed.w, h: m.parsed.h, passable: free }, m.player.tile, m.player.facing, reserved);
        m.pointTo(cell, cell ? faceTowards(cell, m.player.tile, [1, 1]) : null);
      } else if (!targetsBobr || !m.pointing) m.pointTo(null);
    }
    const bobr = this.npcs.get(BOBR_KEY);
    const bobrObj = m.object(BOBR_KEY);
    if (bobr && this.bobrHome && bobrObj && bobrObj.kind === 'npc' && !m.isHidden(BOBR_KEY)) {
      const now = bobrObj.at;
      let cell: Xy = this.bobrHome;
      let face: Dir = 'left';
      const grid = { w: m.parsed.w, h: m.parsed.h, passable: (x: number, y: number) => free(x, y) || (x === now[0] && y === now[1]) };
      if (targetsBobr) {
        cell = besideCell(grid, m.player.tile, m.player.facing, reserved, now) ?? now;
        face = faceTowards(cell, m.player.tile, [1, 1]);
      } else if (g && g.key !== BOBR_KEY) {
        // P-11: указывает на цель, но никогда не с клетки подхода и не с пути Димы (блокер дня 2 у ящика).
        const spot = bobrSpot(grid, g, { player: m.player.tile, facing: m.player.facing, bobr: now, home: this.bobrHome, walk: m.walkGrid(g.viaExit ? g.at : null) });
        cell = spot.cell;
        face = spot.face;
      }
      if (!m.moveObject(BOBR_KEY, cell)) cell = m.object(BOBR_KEY)!.at;
      const sid = this.spriteFor(getContent().characters.get('bobr')?.sprite, 'bobr');
      const x = cell[0] * T + T / 2;
      const y = cell[1] * T + T;
      if (bobr.x !== x || bobr.y !== y) {
        const dist = Math.abs(bobr.x - x) + Math.abs(bobr.y - y);
        // Старый твин к прежней клетке не доигрывает поверх нового (P-12: Казик «на» Диме, A уходила в росток).
        this.tweens.killTweensOf(bobr);
        this.tweens.add({ targets: bobr, x, y, duration: Math.min(900, 260 + dist * 4), ease: 'Sine.easeInOut', onUpdate: () => bobr.setDepth(10 + bobr.y) });
      }
      bobr.play(`${sid}:idle_${face}`);
      // Казик переехал: контур и стрелка — туда, где он теперь (раньше рамка оставалась на пустой клетке).
      if (targetsBobr) g = resolveGuide(m, this.guideTarget, this.plots, this.hiddenKeys(), this.route);
    }
    this.guideLive = targetsBobr && !g && !!m.companion;
    if (this.guideLive) g = { key: BOBR_KEY, at: m.companion!.tile, size: [1, 1], viaExit: false };
    this.guide = g;
    this.guideKey = '';
    m.setGoal(g);
  }

  private drawGuide(time: number): void {
    if (this.guideLive && this.guide && this.model.companion) {
      const [cx, cy] = LocationModel.pos(this.model.companion);
      this.guide = { ...this.guide, at: [Math.round(cx), Math.round(cy)] };
    }
    const g = this.guide;
    const cam = this.cameras.main;
    const pulse = Math.floor(time / 250) % 4;
    const [px, py] = this.model.player.tile;
    const key = g ? `${g.key}:${g.at}:${pulse}:${px},${py}:${Math.round(cam.worldView.x)},${Math.round(cam.worldView.y)}` : '';
    if (key === this.guideKey) return;
    this.guideKey = key;
    const gr = this.guideG.clear();
    if (!g) return;
    // Пульсирующий контур: две рамки, внешняя «дышит» на 1–2 пикселя.
    const grow = pulse < 2 ? pulse : 4 - pulse;
    const x0 = g.at[0] * T - 1 - grow;
    const y0 = g.at[1] * T - 1 - grow;
    const w = g.size[0] * T + 2 + grow * 2;
    const h = g.size[1] * T + 2 + grow * 2;
    gr.lineStyle(1, 0x141b1b, 1).strokeRect(x0 - 1, y0 - 1, w + 2, h + 2);
    gr.lineStyle(1, pulse % 2 ? 0xffffff : 0x73eff7, 1).strokeRect(x0, y0, w, h);
    // Путь пунктиром на 3 клетки (walk-локации, §4.12).
    if (this.model.controls === 'walk' && !this.model.moving) {
      for (const [cx, cy] of guidePath(this.model.walkGrid(g.viaExit ? g.at : null), this.model.player.tile, g, 3)) {
        gr.fillStyle(0x141b1b, 1).fillRect(cx * T + T / 2 - 2, cy * T + T / 2 - 2, 4, 4);
        gr.fillStyle(0x73eff7, 1).fillRect(cx * T + T / 2 - 1, cy * T + T / 2 - 1, 2, 2);
      }
    }
    // Стрелка у края экрана, если цель за кадром.
    // Видимая часть: без полосы HUD сверху и d-pad снизу (P-10a) — цель под кнопкой тоже «за краем».
    const view = cam.worldView;
    const top = this.insets.top / cam.zoom;
    const bottom = this.insets.bottom / cam.zoom;
    const target = { x: (g.at[0] + g.size[0] / 2) * T, y: (g.at[1] + g.size[1] / 2) * T };
    const arrow = edgeArrow({ x: view.x, y: view.y + top, width: view.width, height: Math.max(T, view.height - top - bottom) }, target, 10 / cam.zoom + 4);
    if (arrow) {
      const r = Math.max(5, 12 / cam.zoom) + (pulse % 2);
      const a = arrow.angle;
      const pt = (ang: number, len: number): [number, number] => [arrow.x + Math.cos(ang) * len, arrow.y + Math.sin(ang) * len];
      const [ax, ay] = pt(a, r);
      const [bx, by] = pt(a + 2.4, r);
      const [cx2, cy2] = pt(a - 2.4, r);
      gr.fillStyle(0x141b1b, 1).fillTriangle(ax + 1, ay + 1, bx + 1, by + 1, cx2 + 1, cy2 + 1);
      gr.fillStyle(0x73eff7, 1).fillTriangle(ax, ay, bx, by, cx2, cy2);
    }
  }

  /** Подсветка цели действия (ТЗ §5.4): уголки вокруг объекта, пульс 3 раза в секунду. */
  private drawHighlight(time: number): void {
    const hl = this.model.highlight();
    const o = hl ? this.model.object(hl.key) : undefined;
    const inset = Math.floor(time / 333) % 2;
    // Грядка: уголки вокруг одной клетки, на которую сработает A, а не вокруг всей грядки.
    const at: Xy | undefined = o?.kind === 'plot' && hl ? hl.tile : o?.at;
    const size: Xy = o?.kind === 'plot' ? [1, 1] : (o?.size ?? [1, 1]);
    const key = o && at ? `${o.key}:${at[0]},${at[1]}:${inset}` : '';
    if (key === this.markerKey) return;
    this.markerKey = key;
    const g = this.marker.clear();
    if (!o || !at) return;
    const x0 = at[0] * T + inset - 1;
    const y0 = at[1] * T + inset - 1;
    const x1 = (at[0] + size[0]) * T - inset + 1;
    const y1 = (at[1] + size[1]) * T - inset + 1;
    const L = 5;
    const corner = (cx: number, cy: number, sx: number, sy: number, color: number, d: number): void => {
      g.fillStyle(color, 1);
      g.fillRect(sx > 0 ? cx + d : cx - L - d + 1, sy > 0 ? cy + d : cy - d, L, 1);
      g.fillRect(sx > 0 ? cx + d : cx - d, sy > 0 ? cy + d : cy - L - d + 1, 1, L);
    };
    for (const [color, d] of [[0x141b1b, 1], [0xffd966, 0]] as const) {
      corner(x0, y0, 1, 1, color, d);
      corner(x1 - 1, y0, -1, 1, color, d);
      corner(x0, y1 - 1, 1, -1, color, d);
      corner(x1 - 1, y1 - 1, -1, -1, color, d);
    }
  }

  // ───────────── построение ─────────────

  private createAnims(): void {
    for (const [id, meta] of Object.entries(this.sprites)) {
      for (const [name, frames] of Object.entries(meta.anims)) {
        const key = `${id}:${name}`;
        if (this.anims.exists(key)) continue;
        const walk = name.startsWith('walk');
        this.anims.create({
          key,
          frames: frames.map((frame) => ({ key: ATLAS, frame })),
          frameRate: walk ? (frames.length > 2 ? 10 : 6) : 1,
          repeat: -1,
        });
      }
    }
  }

  private buildTiles(): void {
    const ts = this.cache.json.get(TILESET) as TilesetMeta;
    const { ground, deco } = tileLayers(ts, this.mapDef, this.model.parsed);
    const { w, h } = this.model.parsed;
    const map = this.make.tilemap({ width: w, height: h, tileWidth: T, tileHeight: T });
    const tileset = map.addTilesetImage(TILESET, TILESET, T, T, ts.margin, ts.spacing);
    if (!tileset) throw new Error('Location: тайлсет не загрузился');
    const put = (name: string, grid: number[][], depth: number): void => {
      if (!grid.some((r) => r.some((i) => i >= 0))) return;
      const layer = map.createBlankLayer(name, tileset, 0, 0, w, h, T, T);
      if (!layer) return;
      layer.setDepth(depth);
      grid.forEach((row, y) => row.forEach((i, x) => i >= 0 && layer.putTileAt(i, x, y)));
    };
    put('ground', ground, 0);
    put('deco', deco, 1);
  }

  private spriteFor(id: string | undefined, fallback: string): string {
    return id && this.sprites[id] ? id : fallback;
  }

  private place(s: Phaser.GameObjects.Sprite, sid: string, tx: number, ty: number): void {
    const meta = this.sprites[sid]!;
    // Низ кадра-якоря стоит на нижней кромке клетки, по центру.
    s.setOrigin(meta.anchor[0] / meta.size[0], (meta.anchor[1] + 1) / meta.size[1]);
    s.setPosition(tx * T + T / 2, ty * T + T);
    s.setDepth(10 + ty * T + T);
  }

  private buildObjects(): void {
    const chars = getContent().characters;
    for (const o of this.model.objects) {
      if (o.kind === 'npc') {
        const ch = chars.get(o.id);
        const sid = this.spriteFor(ch?.sprite, 'extra_m');
        const facing = (o.src as { facing?: Dir }).facing ?? 'down';
        const s = this.add.sprite(0, 0, ATLAS, this.sprites[sid]!.frames[0]);
        this.place(s, sid, o.at[0], o.at[1]);
        s.play(`${sid}:idle_${facing}`);
        this.npcs.set(o.key, s);
      } else if (o.kind === 'word') {
        const sid = this.spriteFor((o.src as { sprite?: string }).sprite, 'sign_exit');
        const s = this.add.sprite(0, 0, ATLAS, this.sprites[sid]!.frames[0]);
        this.place(s, sid, o.at[0], o.at[1]);
        this.wordSprites.set(o.key, s);
      }
    }
  }

  private buildActors(): void {
    const p = this.model.player;
    this.playerSid = playerTextureKey(this, this.sprites);
    this.player = this.add.sprite(0, 0, this.playerSid === 'dima' ? ATLAS : this.playerSid, `${this.playerSid}/1`);
    this.place(this.player, this.playerSid, p.tile[0], p.tile[1]);
    const c = this.model.companion;
    if (c) {
      this.companion = this.add.sprite(0, 0, ATLAS, 'bobr/0');
      this.place(this.companion, 'bobr', c.tile[0], c.tile[1]);
    }
  }

  // ───────────── грядки и «!» (I-12) ─────────────

  private applyMarks(m: BusEvents['world:marks']): void {
    this.plots = m.plots;
    this.model.setGarden(m.plots.flatMap((p) => p.cells), m.seeds?.length ?? 0);
    this.aKey = ''; // цель «A» могла измениться: на пустой клетке выросло семя
    if (m.hidden && this.model.setHidden(m.hidden)) {
      for (const [key, s] of this.npcs) s.setVisible(!this.model.isHidden(key));
      for (const [key, s] of this.wordSprites) s.setVisible(!this.model.isHidden(key));
    }
    const seen = new Set<string>();
    for (const p of m.plots)
      for (const cell of p.cells) {
        const key = `${cell.at[0]},${cell.at[1]}`;
        seen.add(key);
        this.drawPlant(key, cell);
      }
    for (const [key, v] of this.plants) {
      if (seen.has(key)) continue;
      v.plant.destroy();
      v.mark?.destroy();
      this.plants.delete(key);
    }
    // «!» над объектами-словами с due (ТЗ §5.4).
    const due = new Set(m.dueItems);
    for (const o of this.model.objects) {
      if (o.kind !== 'word') continue;
      const item = (o.src as { item?: string }).item;
      const want = !!item && due.has(item);
      const cur = this.wordMarks.get(o.key);
      if (want && !cur) this.wordMarks.set(o.key, this.markAt(o.at[0], o.at[1] - 1));
      else if (!want && cur) {
        cur.destroy();
        this.wordMarks.delete(o.key);
      }
    }
    this.applyGuide(); // растение-цель могло переехать на другую клетку
  }

  private plantFrame(cell: PlotCellView): { sid: string; frame: number } | null {
    switch (cell.stage) {
      case 'seed':
        return { sid: 'plant_seed', frame: 0 };
      case 'sprout':
        return { sid: 'plant_sprout', frame: (cell.interval >= 3 ? 1 : 0) + (cell.wilted ? 2 : 0) };
      case 'bush':
        return { sid: 'plant_bush', frame: cell.wilted ? 1 : 0 };
      case 'jar':
        return { sid: 'plant_jar', frame: 0 };
      default:
        return null;
    }
  }

  private drawPlant(key: string, cell: PlotCellView): void {
    const prev = this.plants.get(key);
    const f = this.plantFrame(cell);
    if (!f || !this.sprites[f.sid]) {
      prev?.plant.destroy();
      prev?.mark?.destroy();
      this.plants.delete(key);
      return;
    }
    const frameName = this.sprites[f.sid]!.frames[f.frame] ?? this.sprites[f.sid]!.frames[0]!;
    let plant = prev?.plant;
    if (!plant) {
      plant = this.add.sprite(0, 0, ATLAS, frameName);
      this.place(plant, f.sid, cell.at[0], cell.at[1]);
    } else plant.setFrame(frameName);
    plant.setDepth(5 + cell.at[1]);
    let mark = prev?.mark ?? null;
    if (cell.due && !mark) mark = this.markAt(cell.at[0], cell.at[1] - 1);
    if (!cell.due && mark) {
      mark.destroy();
      mark = null;
    }
    // Полито: было «!», стало без — растение подпрыгивает (§5.5 «после верного ответа растение анимируется»).
    const watered = prev && prev.cell.item === cell.item && prev.cell.due && !cell.due;
    const grew = prev && prev.cell.item === cell.item && prev.cell.stage !== cell.stage;
    if (watered || grew) {
      const y0 = cell.at[1] * T + T;
      this.tweens.add({ targets: plant, y: y0 - 4, duration: 120, yoyo: true, repeat: 1, ease: 'Sine.easeOut', onComplete: () => plant!.setY(y0) });
    }
    this.plants.set(key, { plant, mark, cell });
  }

  /** «!» над клеткой (спрайт mark_due, покачивается). */
  private markAt(tx: number, ty: number): Phaser.GameObjects.Sprite {
    const s = this.add.sprite(0, 0, ATLAS, this.sprites.mark_due?.frames[0] ?? 'mark_due/0');
    if (this.sprites.mark_due) this.place(s, 'mark_due', tx, ty);
    s.setY(s.y + 5); // ближе к макушке растения: «!» висит над ним, а не на клетке выше
    s.setDepth(9_000);
    this.tweens.add({ targets: s, y: s.y - 2, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return s;
  }

  // ───────────── камера ─────────────

  private layout(): void {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const mw = this.model.parsed.w * T;
    const mh = this.model.parsed.h * T;
    const zoom = pickZoom(width, height, mw, mh);
    cam.setZoom(zoom);
    cam.stopFollow();
    cam.removeBounds();
    const safe = safeArea();
    // Видимая зона карты (P-10a): между строкой «Сейчас» сверху и d-pad снизу (вместе с safe-area iPhone).
    const bottom = dpadVisible ? DPAD_INSET + safe.bottom : 0;
    this.insets = { top: HUD_TOP_INSET + safe.top, bottom };
    const fitsW = mw * zoom <= width;
    const fitsH = mh * zoom <= height - bottom;
    // tap-локация всегда по центру: ходьбы нет, следовать не за кем. Карта целиком влезает — центр видимой зоны
    // над d-pad, а не всего экрана: нет пустой полосы сверху (P-10a).
    const centered = (fitsW && fitsH) || this.model.controls === 'tap';
    // Крест на экране: снизу запас на его высоту, чтобы низ карты (выход, калитка) поднимался над d-pad,
    // а Дима стоял в центре видимой зоны над крестом, а не всего экрана.
    const inset = !fitsH ? bottom / zoom : 0;
    // Центр видимой зоны между HUD и d-pad ниже центра экрана на (низ − верх) / 2.
    const base = fitsH ? 0 : (bottom - this.insets.top) / zoom / 2;
    this.cam0 = { zoom, mw, mh, fitsW, fitsH, centered, bottom, base, inset };
    this.follow = { off: [0, 0], dodge: this.follow.dodge };
    this.updateFollow(true);
  }

  // ───────────── ввод и события ─────────────

  private onIntent(i: RoutedIntent): void {
    if (i.to !== 'world' || this.leaving) return;
    this.model.intent(i);
  }

  private onWorldEvent(ev: WorldEvent, time: number): void {
    switch (ev.type) {
      case 'interact': {
        const { type: _t, facing, ...rest } = ev;
        const npc = this.npcs.get(ev.key);
        const opp: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
        if (npc && ev.via !== 'enter' && this.model.controls === 'walk') {
          const sid = this.spriteFor(getContent().characters.get(ev.id)?.sprite, 'extra_m');
          npc.play(`${sid}:idle_${opp[facing]}`);
        }
        // Грядка: слово под пальцем знает только отрисовка (I-12) — кладём его в `item`.
        const plantItem = ev.kind === 'plot' ? cellAt(this.plots, ev.tile)?.item : undefined;
        bus.emit('world:interact', { location: this.mapDef.id, ...rest, tile: [ev.tile[0], ev.tile[1]], ...(plantItem ? { item: plantItem } : {}) });
        break;
      }
      case 'exit':
        bus.emit('world:exit', { from: this.mapDef.id, to: ev.to, ...(ev.spawn ? { spawn: ev.spawn } : {}) });
        // `place:<id>` (Wola, W-01): вход в место без карты — экран места открывает склейка, сцена остаётся.
        if (ev.to !== 'worldmap' && !ev.to.startsWith('place:')) this.go(ev.to, ev.spawn ?? 'default');
        break;
      case 'bump':
        this.bump = { dir: ev.dir, until: time + 120 };
        break;
      case 'step':
        break;
      case 'yield': {
        // NPC-Казик уступил дорогу (P-11): спрайт отходит на новую клетку.
        const s = this.npcs.get(ev.key);
        if (!s) break;
        const x = ev.to[0] * T + T / 2;
        const y = ev.to[1] * T + T;
        this.tweens.killTweensOf(s);
        this.tweens.add({ targets: s, x, y, duration: STEP_MS_SCENE, ease: 'Sine.easeInOut', onUpdate: () => s.setDepth(10 + s.y) });
        break;
      }
    }
  }

  private go(location: string, spawn: string | Xy, facing?: Dir): void {
    if (this.leaving) return;
    this.leaving = true;
    this.model.halt();
    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ location, spawn, ...(facing ? { facing } : {}) }));
    // force: телепорт сразу после входа (идёт fadeIn) иначе игнорировался, сцена зависала в `leaving` (W-01).
    cam.fade(150, 26, 28, 44, true);
  }

  // ───────────── отрисовка актёров ─────────────

  private syncActor(s: Phaser.GameObjects.Sprite, sid: string, a: Actor, time: number): void {
    const [fx, fy] = LocationModel.pos(a);
    let ox = 0;
    let oy = 0;
    if (s === this.player && this.bump && this.bump.until > time) {
      ox = DELTA[this.bump.dir][0];
      oy = DELTA[this.bump.dir][1];
    }
    s.setPosition(Math.round((fx * T + T / 2) + ox), Math.round(fy * T + T + oy));
    // Одна строка с Казиком (P-12): Дима поверх, Казик не рисуется на нём.
    s.setDepth(10 + Math.round(fy * T + T) + (s === this.player ? 0.5 : 0));
    const key = `${sid}:${a.step ? 'walk' : 'idle'}_${a.facing}`;
    if (s.anims.currentAnim?.key !== key) s.play(key);
  }
}
