import Phaser from 'phaser';
import { bus } from '../systems/bus';
import { getContent } from '../systems/content';
import type { TileHit } from '../input/pointer';
import type { Dir, RoutedIntent } from '../types/input';
import type { LocationMap } from '../types/content';
import type { BusEvents, PlotCellView, PlotView } from '../types/bus';
import { cellAt } from '../world/dzialka';
import { tileLayers, type TilesetMeta, type Xy } from '../world/ascii';
import { pickZoom } from '../world/camera';
import { DELTA, LocationModel, type Actor, type WorldEvent } from '../world/location';

// Location (ТЗ §5.4–5.5): ASCII-карта, Дима, NPC, слова, выходы, бобр-компаньон. Логика в
// world/location.ts, сцена только рисует и переводит события модели в шину. Ввод приходит
// intents через bus (`input:intent`, to = world); тап по карте разбирает PointerSource через tileAt().

const T = 16;
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

export class Location extends Phaser.Scene {
  private model!: LocationModel;
  private mapDef!: LocationMap;
  private sprites!: SpritesMeta;
  private player!: Phaser.GameObjects.Sprite;
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
  private wasMoving = false;

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
    this.wasMoving = false;
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
    this.model = new LocationModel(this.mapDef, [spawn[0]!, spawn[1]!], { facing: this.data0.facing ?? 'down' });
    this.sprites = this.cache.json.get('sprites') as SpritesMeta;

    this.createAnims();
    this.buildTiles();
    this.buildObjects();
    this.buildActors();
    this.marker = this.add.graphics().setDepth(10_000);
    this.markerKey = '';

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    const offIntent = bus.on('input:intent', (i) => this.onIntent(i));
    const offInput = bus.on('world:input', ({ enabled }) => {
      if (!enabled) this.model.halt();
    });
    const offTeleport = bus.on('world:teleport', ({ location, spawn }) => this.go(location, spawn));
    const offMarks = bus.on('world:marks', (m) => {
      if (m.location === this.mapDef.id && !this.leaving) this.applyMarks(m);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offIntent();
      offInput();
      offTeleport();
      offMarks();
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
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
    return target ? { tile: [tx, ty], target } : { tile: [tx, ty] };
  }

  /** Состояние для dev-проверок и тестов в браузере. */
  get state(): { location: string; controls: string; tile: Xy; facing: Dir; moving: boolean; highlight: string | null; companion: Xy | null } {
    const m = this.model;
    return {
      location: this.mapDef.id,
      controls: m.controls,
      tile: m.player.tile,
      facing: m.player.facing,
      moving: m.moving,
      highlight: m.highlight()?.key ?? null,
      companion: m.companion?.tile ?? null,
    };
  }

  override update(time: number, delta: number): void {
    if (this.leaving) return;
    for (const ev of this.model.update(Math.min(delta, 100))) this.onWorldEvent(ev, time);
    const moving = this.model.moving;
    if (this.wasMoving && !moving && !this.leaving) {
      const [x, y] = this.model.player.tile;
      bus.emit('world:position', { location: this.mapDef.id, x, y });
    }
    this.wasMoving = moving;
    this.syncActor(this.player, 'dima', this.model.player, time);
    if (this.companion && this.model.companion) this.syncActor(this.companion, 'bobr', this.model.companion, time);
    this.drawHighlight(time);
  }

  /** Подсветка цели действия (ТЗ §5.4): уголки вокруг объекта, пульс 3 раза в секунду. */
  private drawHighlight(time: number): void {
    const hl = this.model.highlight();
    const o = hl ? this.model.object(hl.key) : undefined;
    const inset = Math.floor(time / 333) % 2;
    const key = o ? `${o.key}:${inset}` : '';
    if (key === this.markerKey) return;
    this.markerKey = key;
    const g = this.marker.clear();
    if (!o) return;
    const x0 = o.at[0] * T + inset - 1;
    const y0 = o.at[1] * T + inset - 1;
    const x1 = (o.at[0] + o.size[0]) * T - inset + 1;
    const y1 = (o.at[1] + o.size[1]) * T - inset + 1;
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
      }
    }
  }

  private buildActors(): void {
    const p = this.model.player;
    this.player = this.add.sprite(0, 0, ATLAS, 'dima/1');
    this.place(this.player, 'dima', p.tile[0], p.tile[1]);
    const c = this.model.companion;
    if (c) {
      this.companion = this.add.sprite(0, 0, ATLAS, 'bobr/0');
      this.place(this.companion, 'bobr', c.tile[0], c.tile[1]);
    }
  }

  // ───────────── грядки и «!» (I-12) ─────────────

  private applyMarks(m: BusEvents['world:marks']): void {
    this.plots = m.plots;
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
    const fitsW = mw * zoom <= width;
    const fitsH = mh * zoom <= height;
    // tap-локация (działka) всегда по центру: ходьбы нет, следовать не за кем.
    if ((fitsW && fitsH) || this.model.controls === 'tap') {
      cam.removeBounds();
      cam.centerOn(mw / 2, mh / 2);
    } else {
      // Карта больше экрана: камера следует за Димой в границах карты (по оси, где не влезает).
      cam.setBounds(fitsW ? (mw - width / zoom) / 2 : 0, fitsH ? (mh - height / zoom) / 2 : 0, fitsW ? width / zoom : mw, fitsH ? height / zoom : mh);
      cam.startFollow(this.player, true);
    }
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
        if (ev.to !== 'worldmap') this.go(ev.to, ev.spawn ?? 'default');
        break;
      case 'bump':
        this.bump = { dir: ev.dir, until: time + 120 };
        break;
      case 'step':
        break;
    }
  }

  private go(location: string, spawn: string): void {
    if (this.leaving) return;
    this.leaving = true;
    this.model.halt();
    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ location, spawn }));
    cam.fadeOut(150, 26, 28, 44);
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
    s.setDepth(10 + Math.round(fy * T + T));
    const key = `${sid}:${a.step ? 'walk' : 'idle'}_${a.facing}`;
    if (s.anims.currentAnim?.key !== key) s.play(key);
  }
}
