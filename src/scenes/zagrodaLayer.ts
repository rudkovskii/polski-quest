import Phaser from 'phaser';
import { bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { PlotView } from '../types/polska';
import { LocationModel } from '../world/location';

// Zagroda (v2): вид объектов участков по прогрессу (арт v2, ключи кадров — `KEYS` в tools/art_world2.py) и автобег во время игр
// о Польше. Точки входа в доме и на ферме (стенная карта, календарь, мачта, сезонная доска) меняют кадр тут же (`applyEntries`).

const T = 16;
const ATLAS = 'custom';

interface SpriteMeta {
  size: [number, number];
  frames: string[];
}
type Sprites = Record<string, SpriteMeta>;

/** Яблоня `w2_apple_tree`: 0 саженец · 1 деревце (≥ 25 %) · 2 цветёт (≥ 50 %) · 3 яблоки (≥ 75 %) · 4 урожай (всё собрано). */
export const treeFrame = (v: PlotView): number => (v.pct >= 1 ? 4 : v.pct >= 0.75 ? 3 : v.pct >= 0.5 ? 2 : v.pct >= 0.25 ? 1 : 0);
/** Улей `w2_hive`: 0 пустой · 1 заселён (что-то растёт) · 3 полный (куплет собран). */
export const hiveFrame = (v: PlotView): number => (v.units && v.pct >= 1 ? 3 : v.planted ? 1 : 0);
/** Подсолнух `w2_sunflower`: 0 семечко · 1 росток · 2 бутон (кустик) · 3 цветок (часть собрана) · 4 семена (месяц собран); null — пусто. */
export function sunflowerFrame(v: PlotView): number | null {
  if (v.units && v.pct >= 1) return 4;
  if (v.best === 'bush') return 2;
  if (v.best === 'sprout') return 1;
  if (v.best === 'seed' || v.best === 'overripe') return 0;
  return v.grown > 0 ? 3 : null;
}
/** Цветок клумбы `w2_fl_<сезон>`: 0 росток · 1 бутон · 2 цветёт (собрано); null — не посажено. */
export function flowerFrame(v: PlotView): number | null {
  if (v.units && v.pct >= 1) return 2;
  if (v.best === 'bush') return 1;
  return v.planted ? 0 : null;
}
const SEASON_FLOWER: Record<string, string> = { zima: 'w2_fl_snow', wiosna: 'w2_fl_daff', lato: 'w2_fl_poppy', 'jesień': 'w2_fl_chrys', jesien: 'w2_fl_chrys' };
export const flowerSprite = (group: string): string => SEASON_FLOWER[group.replace(/^season:/, '')] ?? 'w2_fl_viol';

/** Последнее задание, режим игры и вид участков: переживают смену сцены (переход в Zagroda при старте игры). */
let focus: BusEvents['polska:focus'] = { id: null, obj: null, label: '' };
let auto = false;
let views: PlotView[] = [];
let entries: Record<string, number> = {};
bus.on('polska:focus', (f) => {
  focus = f;
});
bus.on('polska:auto', ({ on, layout }) => {
  auto = on && layout === 'panel';
});
bus.on('polska:plots', (p) => {
  views = p.views;
  if (p.entries) entries = p.entries;
});

const frameOf = (sprites: Sprites, name: string, i: number): string | null => {
  const f = sprites[name]?.frames;
  return f?.length ? (f[Math.max(0, Math.min(i, f.length - 1))] ?? null) : null;
};

/** Кадры точек входа (`prop:map`, `prop:calendar`, `prop:mast`, `prop:seasonBoard`) на любой карте. */
export function applyEntries(props: ReadonlyMap<string, Phaser.GameObjects.Sprite>, sprites: Sprites, list: Record<string, number> = entries): void {
  for (const [id, i] of Object.entries(list)) {
    const s = props.get(`prop:${id}`);
    const name = s ? (s.getData('sprite') as string | undefined) : undefined;
    const f = name ? frameOf(sprites, name, i) : null;
    if (s && f) s.setFrame(f);
  }
}

export interface ZagrodaHost {
  scene: Phaser.Scene;
  model: LocationModel;
  sprites: Sprites;
  /** Спрайты объектов карты по ключу `prop:<id>`. */
  props: ReadonlyMap<string, Phaser.GameObjects.Sprite>;
  toScreen(x: number, y: number): { x: number; y: number };
}

export class ZagrodaLayer {
  private offs: (() => void)[] = [];
  private walked = '';
  /** Подсолнухи на грядках месяцев (до 3 на грядку, по числу посаженных дат). */
  private flowers = new Map<string, Phaser.GameObjects.Image[]>();

  constructor(private h: ZagrodaHost) {
    this.apply(views);
    this.offs.push(
      bus.on('polska:plots', ({ views: v }) => this.apply(v)),
      bus.on('polska:act', (a) => this.act(a)),
    );
  }

  get auto(): boolean {
    return auto;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    for (const list of this.flowers.values()) for (const f of list) f.destroy();
    this.flowers.clear();
  }

  private frame(name: string, i = 0): string | null {
    return frameOf(this.h.sprites, name, i);
  }

  /** Вид объектов по прогрессу. */
  apply(list: readonly PlotView[]): void {
    for (const v of list) {
      const s = this.h.props.get(`prop:${v.obj}`);
      if (!s) continue;
      s.setVisible(true);
      if (v.plot === 'sad') this.set(s, 'w2_apple_tree', treeFrame(v));
      else if (v.plot === 'pasieka') this.set(s, 'w2_hive', hiveFrame(v));
      else if (v.plot === 'miesiace') {
        this.set(s, 'w2_bed', v.planted ? 1 : 0);
        this.sunflowers(v, s);
      } else {
        const i = flowerFrame(v);
        if (i === null) s.setVisible(false);
        else this.set(s, flowerSprite(v.group), i);
      }
    }
  }

  private set(s: Phaser.GameObjects.Sprite, name: string, i: number): void {
    const f = this.frame(name, i);
    if (f) s.setFrame(f);
  }

  private sunflowers(v: PlotView, bed: Phaser.GameObjects.Sprite): void {
    for (const f of this.flowers.get(v.obj) ?? []) f.destroy();
    this.flowers.delete(v.obj);
    const i = sunflowerFrame(v);
    const f = i === null ? null : this.frame('w2_sunflower', i);
    if (!f) return;
    const n = Math.max(1, Math.min(3, v.planted));
    const list: Phaser.GameObjects.Image[] = [];
    for (let k = 0; k < n; k++) {
      const x = bed.x + (n === 1 ? 0 : -8 + (16 * k) / (n - 1));
      list.push(this.h.scene.add.image(Math.round(x), bed.y - 3, ATLAS, f).setOrigin(0.5, 1).setDepth(bed.depth + 0.5));
    }
    this.flowers.set(v.obj, list);
  }

  private act(a: BusEvents['polska:act']): void {
    if (!a.obj) return;
    const o = this.h.model.object(`prop:${a.obj}`);
    const s = this.h.props.get(`prop:${a.obj}`);
    if (!o || !s) return;
    const p = this.h.toScreen((o.at[0] + o.size[0] / 2) * T, (o.at[1] + 1) * T - 20);
    if (a.kind === 'miss') {
      this.h.scene.tweens.add({ targets: s, x: s.x + 1, duration: 50, yoyo: true, repeat: 3 });
      return;
    }
    if (a.xp > 0) bus.emit('fx:float', { x: p.x, y: p.y, text: `+${a.xp}`, kind: 'xp' });
    if (a.kind !== 'water') bus.emit('fx:sfx', { name: a.kind === 'harvest' ? 'plim' : 'grow' });
    else bus.emit('fx:sfx', { name: 'water' });
    const y0 = s.y;
    this.h.scene.tweens.add({ targets: s, y: y0 - 2, duration: 90, yoyo: true, onComplete: () => s.setY(y0) });
  }

  /** Автобег: во время игры (нижняя панель) герой идёт к объекту текущего задания и смотрит на него. */
  update(): void {
    const m = this.h.model;
    m.speed = auto ? 1.5 : 1;
    if (!auto || !focus.obj || m.busy) return;
    const o = m.object(`prop:${focus.obj}`);
    if (!o) return;
    const key = `${focus.id}@${focus.obj}`;
    if (this.walked !== key) {
      this.walked = key;
      m.walkNear(o.at, o.rects.length ? o.rects : [[o.at[0], o.at[1], o.size[0], o.size[1]]]);
    } else m.faceTile(o.at);
  }
}
