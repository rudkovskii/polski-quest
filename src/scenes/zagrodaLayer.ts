import Phaser from 'phaser';
import { bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { PlotView } from '../types/polska';
import { LocationModel } from '../world/location';

// Zagroda (v2): вид объектов участков по прогрессу и автобег во время игр о Польше.
// Объекты (яблони, ульи, грядки месяцев, места клумбы) стоят на карте `zagroda.json` с заглушками из старых спрайтов; слой
// меняет кадр/масштаб по `polska:plots`. Когда агент арта соберёт спрайты, слой возьмёт их по именам из ART (кадр = ступень).

const T = 16;
const ATLAS = 'custom';

interface SpriteMeta {
  size: [number, number];
  frames: string[];
}

/** Ожидаемые спрайты арта v2 (кадры по ступеням); нет в атласе — заглушка. */
export const ART = { sad: 'apple_tree', pasieka: 'hive', miesiace: 'sunflower', klumba: 'holiday_flower' } as const;

/** Ступень яблони/улья по доле урожая: 0 саженец, 1 ≥ 25 %, 2 ≥ 50 % (цветёт), 3 — всё собрано. */
export const levelOf = (v: PlotView): number => (v.pct >= 1 ? 3 : v.pct >= 0.5 ? 2 : v.pct >= 0.25 ? 1 : 0);

const STAGE_FRAME: Record<string, string> = { seed: 'crop_seed', sprout: 'crop_sprout', bush: 'crop_bush', overripe: 'crop_overripe' };

/** Последнее задание и режим игры о Польше: переживают смену сцены (переход в Zagroda при старте игры). */
let focus: BusEvents['polska:focus'] = { id: null, obj: null, label: '' };
let auto = false;
let views: PlotView[] = [];
bus.on('polska:focus', (f) => {
  focus = f;
});
bus.on('polska:auto', ({ on, layout }) => {
  auto = on && layout === 'panel';
});
bus.on('polska:plots', ({ views: v }) => {
  views = v;
});

export interface ZagrodaHost {
  scene: Phaser.Scene;
  model: LocationModel;
  sprites: Record<string, SpriteMeta>;
  /** Спрайты объектов карты по ключу `prop:<id>`. */
  props: ReadonlyMap<string, Phaser.GameObjects.Sprite>;
  toScreen(x: number, y: number): { x: number; y: number };
}

export class ZagrodaLayer {
  private offs: (() => void)[] = [];
  private walked = '';

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
  }

  private frame(name: string, i = 0): string | null {
    const f = this.h.sprites[name]?.frames;
    return f?.length ? (f[Math.min(i, f.length - 1)] ?? null) : null;
  }

  /** Вид объекта по прогрессу: свой спрайт арта, иначе заглушка (масштаб, прозрачность, кадр стадии ростка). */
  apply(list: readonly PlotView[]): void {
    for (const v of list) {
      const s = this.h.props.get(`prop:${v.obj}`);
      if (!s) continue;
      const lvl = levelOf(v);
      const art = this.frame(ART[v.plot], v.plot === 'miesiace' || v.plot === 'klumba' ? stageIndex(v) : lvl);
      s.setVisible(true).setAlpha(1).setScale(1);
      if (art) {
        s.setFrame(art);
        continue;
      }
      if (v.plot === 'sad') s.setScale([0.55, 0.72, 0.88, 1][lvl]!).setAlpha(v.planted ? 1 : 0.55);
      else if (v.plot === 'pasieka') s.setScale([0.45, 0.5, 0.55, 0.6][lvl]!).setAlpha(v.planted ? 1 : 0.5);
      else {
        // Грядка месяца и место на клумбе: пусто — не видно; растёт — кадр стадии; всё собрано — цветок.
        const name = v.pct >= 1 ? (v.plot === 'klumba' ? 'flower_pink' : 'crop_ripe') : v.best ? STAGE_FRAME[v.best]! : null;
        const f = name ? this.frame(name) : null;
        if (!f) s.setVisible(false);
        else s.setFrame(f);
      }
    }
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

function stageIndex(v: PlotView): number {
  if (v.pct >= 1) return 4;
  return v.best === 'bush' ? 3 : v.best === 'sprout' ? 2 : v.best ? 1 : 0;
}
