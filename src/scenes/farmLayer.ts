import Phaser from 'phaser';
import { bus } from '../systems/bus';
import type { FarmAct, PlantView } from '../types/farm';
import type { Dir } from '../types/input';
import type { Xy } from '../world/ascii';
import { LocationModel } from '../world/location';
import { LabelGate } from '../world/labelGate';

// Огород на ферме: растения на грядках (спрайты стадий), вскопанные клетки, подпись над растением у героя и автобег во
// время мини-игры: очередь действий (полив, удобрение, урожай → коробка). Ответы не ждут анимацию: действия копятся и
// проигрываются ускоренно (скорость = 1 + длина очереди, до ×4).

const T = 16;
const ATLAS = 'custom';

interface SpriteMeta {
  size: [number, number];
  frames: string[];
  anims: Record<string, string[]>;
}

export interface FarmHost {
  scene: Phaser.Scene;
  model: LocationModel;
  sprites: Record<string, SpriteMeta>;
  hero: Phaser.GameObjects.Sprite;
  /** Поставить вскопанную землю на клетки (перерисовать автотайлы). */
  soil(cells: readonly Xy[]): void;
  /** Мир → экранные CSS px. */
  toScreen(x: number, y: number): { x: number; y: number };
  /** Мир принимает ввод (не открыт экран). */
  inputOn(): boolean;
}

interface Job {
  act: FarmAct;
  phase: 'walk' | 'work' | 'carry' | 'throw';
  until: number;
}

/** Столько действий героя ждут в очереди; лишние поливы схлопываются. */
const MAX_QUEUE = 6;

const STAGE_FRAME: Record<string, string> = { seed: 'crop_seed', sprout: 'crop_sprout', bush: 'crop_bush', ripe: 'crop_ripe', overripe: 'crop_overripe' };

export class FarmLayer {
  /** Анимация героя поверх ходьбы (`water`, `fert`, `throw`) и ноша над головой. */
  heroAction: string | null = null;
  carrying = false;
  auto = false;
  private plants = new Map<string, { view: PlantView; spr: Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics; wet: Phaser.GameObjects.GameObject | null }>();
  private pendingHarvest = new Set<string>();
  private queue: FarmAct[] = [];
  private job: Job | null = null;
  private focus: { id: string; tile: Xy; label: string } | null = null;
  private focusWalked = '';
  private item: Phaser.GameObjects.Sprite | null = null;
  private lastLabel = '';
  private labelGate = new LabelGate();
  private offs: (() => void)[] = [];
  private views: PlantView[] = [];

  constructor(private h: FarmHost) {
    this.offs.push(
      bus.on('farm:plants', ({ plants, cells }) => this.setPlants(plants, cells)),
      bus.on('farm:act', (a) => {
        // Урожай: растение сразу спелое и остаётся на грядке, пока герой его не сорвёт (раскладка его уже убрала).
        if (a.kind === 'harvest') this.markRipe(a.id);
        this.queue.push(a);
        // Игрок отвечает сильно быстрее анимации: старые поливы не играем, только «+N» над грядкой.
        while (this.queue.length > MAX_QUEUE) {
          const i = this.queue.findIndex((x) => x.kind !== 'harvest');
          if (i < 0) break;
          const [old] = this.queue.splice(i, 1);
          if (old?.tile && old.xp > 0) this.float(old.tile, `+${old.xp}`, 'xp');
        }
      }),
      bus.on('farm:focus', ({ id, tile, label }) => {
        this.focus = id && tile ? { id, tile, label } : null;
      }),
      bus.on('farm:auto', ({ on }) => {
        this.auto = on;
        if (!on) {
          this.focus = null;
          this.focusWalked = '';
        }
      }),
    );
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    bus.emit('fx:label', null);
  }

  private frame(name: string): string | null {
    return this.h.sprites[name]?.frames[0] ?? null;
  }

  /** Спрайт стадии; нет кадра в атласе (арт ещё не собран) — простая фигура. */
  private makePlant(v: PlantView): Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics {
    const name = v.stage === 'ripe' && v.phrase ? 'crop_ripe_phrase' : STAGE_FRAME[v.stage]!;
    const f = this.frame(name);
    const x = v.tile[0] * T + T / 2;
    const bottom = v.tile[1] * T + T;
    if (f) return this.h.scene.add.sprite(x, bottom, ATLAS, f).setOrigin(0.5, 1).setDepth(10 + bottom - 1);
    const g = this.h.scene.add.graphics().setDepth(10 + bottom - 1);
    const colors: Record<string, number> = { seed: 0x7a4b2c, sprout: 0x7ab44f, bush: 0x4f8a35, ripe: 0xd0492f, overripe: 0xc8a548 };
    const r = v.stage === 'seed' ? 2 : v.stage === 'sprout' ? 3 : 5;
    g.fillStyle(colors[v.stage] ?? 0x4f8a35, 1).fillCircle(x, bottom - 4 - r, r);
    return g;
  }

  private setPlants(plants: PlantView[], cells: [number, number][]): void {
    this.views = plants;
    this.h.soil(cells);
    const seen = new Set<string>();
    for (const v of plants) {
      seen.add(v.id);
      const cur = this.plants.get(v.id);
      const stage = this.pendingHarvest.has(v.id) ? 'ripe' : v.stage;
      const view = { ...v, stage };
      if (cur && cur.view.stage === view.stage && cur.view.tile[0] === v.tile[0] && cur.view.tile[1] === v.tile[1] && (cur.view.drops > 0) === (v.drops > 0)) {
        cur.view = view;
        continue;
      }
      cur?.spr.destroy();
      cur?.wet?.destroy();
      const wf = this.frame('soil_wet');
      const wet = v.drops > 0 && wf ? this.h.scene.add.image(v.tile[0] * T + T / 2, v.tile[1] * T + T, ATLAS, wf).setOrigin(0.5, 1).setDepth(1.2) : null;
      this.plants.set(v.id, { view, spr: this.makePlant(view), wet });
    }
    for (const [id, p] of this.plants) {
      if (seen.has(id) || this.pendingHarvest.has(id)) continue;
      p.spr.destroy();
      p.wet?.destroy();
      this.plants.delete(id);
    }
    this.h.model.setPlants(plants.map((p) => ({ id: p.id, tile: p.tile, label: p.label })));
  }

  // ───────────── автобег ─────────────

  private speed(): number {
    // Мини-игру закрыли, а действия ещё не доиграны: доигрываем быстро, ввод игрока ждёт (см. `blocking`).
    if (!this.auto) return 3;
    return 1 + Math.min(3, this.queue.length);
  }

  /** Герой доигрывает очередь после закрытия мини-игры: ходьба игрока подождёт. */
  get blocking(): boolean {
    return !this.auto && (this.job !== null || this.queue.length > 0);
  }

  update(time: number): void {
    const m = this.h.model;
    m.speed = this.auto || this.job ? this.speed() : 1;
    if (!this.job && this.queue.length) this.start(this.queue.shift()!, time);
    if (this.job) this.advance(time);
    else if (this.auto && this.focus && !m.busy) {
      const key = `${this.focus.id}@${this.focus.tile.join(',')}`;
      if (this.focusWalked !== key) {
        this.focusWalked = key;
        m.walkNear(this.focus.tile);
      } else if (!m.busy) m.faceTile(this.focus.tile);
    }
    this.syncItem();
    this.drawLabel(time);
  }

  private markRipe(id: string): void {
    this.pendingHarvest.add(id);
    const p = this.plants.get(id);
    if (!p) return;
    p.spr.destroy();
    const v = { ...p.view, stage: 'ripe' as const };
    p.view = v;
    p.spr = this.makePlant(v);
  }

  private start(act: FarmAct, time: number): void {
    this.job = { act, phase: 'walk', until: 0 };
    if (act.tile) this.h.model.walkNear(act.tile);
    this.focusWalked = '';
    void time;
  }

  private advance(time: number): void {
    const j = this.job!;
    const m = this.h.model;
    const k = this.speed();
    switch (j.phase) {
      case 'walk': {
        if (m.busy) return;
        if (j.act.tile) m.faceTile(j.act.tile);
        j.phase = 'work';
        const base = j.act.kind === 'grow' ? 900 : j.act.kind === 'harvest' ? 500 : j.act.kind === 'miss' ? 450 : 700;
        j.until = time + base / k;
        this.heroAction = j.act.kind === 'water' ? 'water' : j.act.kind === 'grow' ? 'fert' : j.act.kind === 'harvest' ? 'fert' : null;
        this.fx(j.act, k);
        return;
      }
      case 'work': {
        if (time < j.until) return;
        this.heroAction = null;
        if (j.act.kind !== 'harvest') {
          if (j.act.xp > 0 && j.act.tile) this.float(j.act.tile, `+${j.act.xp}`, 'xp');
          if (j.act.kind === 'miss' && j.act.tile) this.float(j.act.tile, '−💧', 'miss');
          this.job = null;
          return;
        }
        // Сорвал: растение исчезает с грядки, герой несёт урожай в коробку.
        this.pendingHarvest.delete(j.act.id);
        const p = this.plants.get(j.act.id);
        if (p && !this.views.some((v) => v.id === j.act.id)) {
          p.spr.destroy();
          p.wet?.destroy();
          this.plants.delete(j.act.id);
        } else if (p) {
          // Перезревшее с той же грядки ушло в банку, но запись ещё есть: перерисуем по текущему виду.
          p.spr.destroy();
          const v = this.views.find((x) => x.id === j.act.id)!;
          p.view = v;
          p.spr = this.makePlant(v);
        }
        this.carrying = true;
        const phrase = j.act.id.startsWith('p.');
        const f = this.frame(phrase ? 'item_crop_phrase' : 'item_crop') ?? this.frame(phrase ? 'crop_ripe_phrase' : 'crop_ripe');
        if (f) this.item = this.h.scene.add.sprite(0, 0, ATLAS, f).setOrigin(0.5, 1);
        const bin = m.object('prop:bin');
        if (bin) m.walkNear(bin.at, bin.rects);
        j.phase = 'carry';
        return;
      }
      case 'carry': {
        if (m.busy) return;
        const bin = m.object('prop:bin');
        if (bin) m.faceTile([bin.at[0] + (m.player.tile[0] > bin.at[0] ? 1 : 0), bin.at[1]]);
        this.heroAction = 'throw';
        j.phase = 'throw';
        j.until = time + 450 / k;
        if (this.item && bin) {
          const it = this.item;
          this.item = null;
          this.h.scene.tweens.add({
            targets: it,
            x: (bin.at[0] + bin.size[0] / 2) * T,
            y: (bin.at[1] + 1) * T - 8,
            duration: 380 / k,
            ease: 'Quad.easeIn',
            onComplete: () => it.destroy(),
          });
        }
        this.carrying = false;
        return;
      }
      case 'throw': {
        if (time < j.until) return;
        this.heroAction = null;
        const bin = m.object('prop:bin');
        if (bin) this.float([bin.at[0] + 0.5, bin.at[1] - 1], `+${j.act.xp}`, 'xp');
        this.job = null;
        return;
      }
    }
  }

  /** Капли полива, искры удобрения. */
  private fx(act: FarmAct, k: number): void {
    if (!act.tile) return;
    const s = this.h.scene;
    const cx = act.tile[0] * T + T / 2;
    const top = act.tile[1] * T + 2;
    if (act.kind === 'water' || act.kind === 'grow') {
      const f = this.frame('fx_drop');
      for (let i = 0; i < 3; i++) {
        const x = cx - 4 + i * 4;
        const o = f ? s.add.sprite(x, top - 6, ATLAS, f).setOrigin(0.5, 1) : s.add.rectangle(x, top - 6, 1, 3, 0x5ba3d2);
        o.setDepth(20_000);
        s.tweens.add({ targets: o, y: top + 8, alpha: 0.2, delay: (i * 90) / k, duration: 320 / k, onComplete: () => o.destroy() });
      }
    }
    if (act.kind === 'grow' || act.kind === 'harvest') {
      const f = this.frame('fx_spark');
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const o = f ? s.add.sprite(cx, top + 6, ATLAS, f).setOrigin(0.5, 0.5) : s.add.rectangle(cx, top + 6, 2, 2, 0xf2d552);
        o.setDepth(20_000);
        s.tweens.add({ targets: o, x: cx + Math.cos(a) * 9, y: top + 6 + Math.sin(a) * 7 - 4, alpha: 0, delay: (250 + i * 40) / k, duration: 420 / k, onComplete: () => o.destroy() });
      }
    }
  }

  private float(tile: Xy, text: string, kind: 'xp' | 'miss' | 'info'): void {
    const p = this.h.toScreen(tile[0] * T + T / 2, tile[1] * T);
    bus.emit('fx:float', { x: p.x, y: p.y, text, kind });
  }

  private syncItem(): void {
    if (!this.item) return;
    const hero = this.h.hero;
    this.item.setPosition(hero.x, hero.y - 29).setDepth(hero.depth + 1);
  }

  /** Подпись над растением: в мини-игре — текущее задание, вне её — растение, к которому повернулся герой. */
  private drawLabel(time: number): void {
    let target: { label: string; tile: Xy } | null = null;
    let sticky = false;
    if (this.auto && this.focus) {
      target = this.focus;
      sticky = true;
    } else if (!this.auto && this.h.inputOn()) {
      const hint = this.h.model.actionHint();
      if (hint && hint.key.startsWith('plant:')) {
        const id = hint.key.slice(6);
        const v = this.views.find((p) => p.id === id);
        if (v) target = { label: v.label, tile: v.tile };
      }
    }
    // Вне мини-игры подпись гаснет через пару секунд: не висит над героем, пока он стоит у грядки.
    if (!this.labelGate.show(target ? `${sticky ? 'q' : 'p'}:${target.label}@${target.tile.join(',')}` : null, time, sticky)) target = null;
    if (!target) {
      if (this.lastLabel) bus.emit('fx:label', null);
      this.lastLabel = '';
      return;
    }
    const p = this.h.toScreen(target.tile[0] * T + T / 2, target.tile[1] * T - 2);
    const key = `${target.label}@${Math.round(p.x)},${Math.round(p.y)}`;
    if (key === this.lastLabel) return;
    this.lastLabel = key;
    bus.emit('fx:label', { text: target.label, x: p.x, y: p.y });
  }

  /** Ключ анимации героя с учётом действия и ноши (нет таких кадров в атласе — null). */
  heroAnim(facing: Dir, walking: boolean, exists: (key: string) => boolean): string | null {
    if (this.heroAction) {
      const k = `hero:${this.heroAction}_${facing}`;
      if (exists(k)) return k;
    }
    if (this.carrying) {
      const k = `hero:carry_${walking ? 'walk' : 'idle'}_${facing}`;
      if (exists(k)) return k;
    }
    return null;
  }
}
