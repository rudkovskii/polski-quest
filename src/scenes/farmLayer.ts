import Phaser from 'phaser';
import { bus } from '../systems/bus';
import { framesOf } from '../systems/plantLook';
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
  /** Смена стадии (`grow`) уже показана. */
  evolved?: boolean;
}

/** Столько действий героя ждут в очереди; лишние поливы схлопываются. */
const MAX_QUEUE = 6;

/** Растение на грядке: основной спрайт, предмет урожая поверх него (мини-версия слова) и мокрая земля. */
interface Plant {
  view: PlantView;
  spr: Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics;
  /** Мини-предмет на кусте (только урожай слова-существительного): тот же поворот и масштаб, что у `spr`. */
  ic: Phaser.GameObjects.Sprite | null;
  wet: Phaser.GameObjects.GameObject | null;
}

const STAGE_FRAME: Record<string, string> = { seed: 'crop_seed', sprout: 'crop_sprout', bush: 'crop_bush', ripe: 'crop_ripe', overripe: 'crop_overripe' };

export class FarmLayer {
  /** Анимация героя поверх ходьбы (`water`, `fert`, `throw`) и ноша над головой. */
  heroAction: string | null = null;
  carrying = false;
  auto = false;
  private plants = new Map<string, Plant>();
  private pendingHarvest = new Set<string>();
  /** Растения, у которых смена стадии ждёт, пока герой дойдёт и польёт (спрайт меняется на глазах, с искрами). */
  private deferred = new Set<string>();
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
    // Старт сцены (в том числе после перезагрузки): растение под боком у героя не подписываем.
    this.labelGate.arm();
    this.offs.push(
      bus.on('world:input', ({ enabled }) => {
        if (!enabled) return;
        // Экран закрылся: убрать подпись и не показывать её для растения, у которого герой стоит.
        this.labelGate.arm();
        this.lastLabel = '';
        bus.emit('fx:label', null);
      }),
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
          this.labelGate.arm();
          this.lastLabel = '';
          bus.emit('fx:label', null);
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

  /** Кадр атласа по имени `<лист>/<n>` (кусты, плоды и иконки «пёстрого огорода»); нет в атласе — null. */
  private named(name: string | null | undefined): string | null {
    if (!name) return null;
    const [sheet, n] = name.split('/');
    return this.h.sprites[sheet ?? '']?.frames[Number(n)] ?? null;
  }

  /**
   * Спрайт стадии; нет кадра в атласе (арт ещё не собран) — простая фигура. Семечко и перезревшее общие; росток, кустик и урожай
   * по виду слова (`look`): куст-вариант, плод цвета, у существительного на кусте-основе сидит мини-предмет (`ic`). Фразы и единицы — прежние.
   */
  private makePlant(v: PlantView): { spr: Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics; ic: Phaser.GameObjects.Sprite | null } {
    const x = v.tile[0] * T + T / 2;
    const bottom = v.tile[1] * T + T;
    const depth = 10 + bottom - 1;
    const fr = v.look && !v.phrase ? framesOf(v.look) : null;
    const own = fr ? (v.stage === 'sprout' ? fr.sprout : v.stage === 'bush' ? fr.bush : v.stage === 'ripe' ? fr.ripe : null) : null;
    const ownFrame = this.named(own);
    if (ownFrame) {
      const spr = this.h.scene.add.sprite(x, bottom, ATLAS, ownFrame).setOrigin(0.5, 1).setDepth(depth);
      const mini = v.stage === 'ripe' && fr?.icon ? this.named(fr.icon.frame) : null;
      // Мини-предмет: тот же якорь, что у куста (низ клетки), поэтому подпрыгивание и дрожь общие.
      const ic = mini && fr?.icon ? this.h.scene.add.sprite(x, bottom, ATLAS, mini).setOrigin((8 - fr.icon.dx) / T, (2 * T - fr.icon.dy) / T).setDepth(depth + 0.1) : null;
      return { spr, ic };
    }
    const name = v.stage === 'ripe' && v.phrase ? 'crop_ripe_phrase' : STAGE_FRAME[v.stage]!;
    const f = this.frame(name);
    if (f) return { spr: this.h.scene.add.sprite(x, bottom, ATLAS, f).setOrigin(0.5, 1).setDepth(depth), ic: null };
    const g = this.h.scene.add.graphics().setDepth(depth);
    const colors: Record<string, number> = { seed: 0x7a4b2c, sprout: 0x7ab44f, bush: 0x4f8a35, ripe: 0xd0492f, overripe: 0xc8a548 };
    const r = v.stage === 'seed' ? 2 : v.stage === 'sprout' ? 3 : 5;
    g.fillStyle(colors[v.stage] ?? 0x4f8a35, 1).fillCircle(x, bottom - 4 - r, r);
    return { spr: g, ic: null };
  }

  private destroyPlant(p: Plant): void {
    p.spr.destroy();
    p.ic?.destroy();
    p.wet?.destroy();
  }

  /** Спрайт и предмет — одним списком (общие твины). */
  private parts(p: Plant): Phaser.GameObjects.Sprite[] {
    return [p.spr, p.ic].filter((o): o is Phaser.GameObjects.Sprite => o instanceof Phaser.GameObjects.Sprite);
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
      // Новая стадия от «grow»-ответа: пока герой не польёт, на грядке старый спрайт (см. `evolve`).
      if (cur && cur.view.stage !== view.stage && cur.view.tile[0] === v.tile[0] && cur.view.tile[1] === v.tile[1] && this.growPending(v.id)) {
        this.deferred.add(v.id);
        continue;
      }
      this.deferred.delete(v.id);
      if (cur) this.destroyPlant(cur);
      const wf = this.frame('soil_wet');
      const wet = v.drops > 0 && wf ? this.h.scene.add.image(v.tile[0] * T + T / 2, v.tile[1] * T + T, ATLAS, wf).setOrigin(0.5, 1).setDepth(1.2) : null;
      this.plants.set(v.id, { view, ...this.makePlant(view), wet });
    }
    for (const [id, p] of this.plants) {
      if (seen.has(id) || this.pendingHarvest.has(id)) continue;
      this.deferred.delete(id);
      this.destroyPlant(p);
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
    m.leash = this.auto || this.job !== null; // кот бежит рядом, своими делами не занят
    if (!this.job && this.queue.length) this.start(this.queue.shift()!, time);
    if (this.job) this.advance(time);
    else if (this.auto && this.focus && !m.busy) {
      const key = `${this.focus.id}@${this.focus.tile.join(',')}`;
      if (this.focusWalked !== key) {
        this.focusWalked = key;
        m.walkNear(this.focus.tile);
      } else if (!m.busy) m.faceTile(this.focus.tile);
    }
    // Очередь доиграна, а смена стадии не показана (герой не дошёл, лишний полив схлопнулся): меняем спрайт без показа.
    if (this.deferred.size && !this.job && !this.queue.length) for (const id of [...this.deferred]) this.rebuild(id, false);
    this.syncItem();
    this.drawLabel(time);
  }

  private growPending(id: string): boolean {
    const j = this.job;
    return this.queue.some((a) => a.id === id && a.kind === 'grow' && a.tile) || (!!j && j.act.id === id && j.act.kind === 'grow' && !!j.act.tile && (j.phase === 'walk' || (j.phase === 'work' && !j.evolved)));
  }

  /** Пересобрать растение по текущему виду; `show` — подрос на глазах: вырос на кадр и искры. */
  private rebuild(id: string, show: boolean, k = 1): void {
    this.deferred.delete(id);
    const p = this.plants.get(id);
    const v = this.views.find((x) => x.id === id);
    if (!p || !v) return;
    const view = { ...v, stage: this.pendingHarvest.has(id) ? ('ripe' as const) : v.stage };
    this.destroyPlant(p);
    const wf = this.frame('soil_wet');
    p.wet = v.drops > 0 && wf ? this.h.scene.add.image(v.tile[0] * T + T / 2, v.tile[1] * T + T, ATLAS, wf).setOrigin(0.5, 1).setDepth(1.2) : null;
    p.view = view;
    Object.assign(p, this.makePlant(view));
    if (!show) return;
    bus.emit('fx:sfx', { name: 'grow' });
    const parts = this.parts(p);
    if (parts.length) {
      for (const o of parts) o.setScale(0.55);
      this.h.scene.tweens.add({ targets: parts, scaleX: 1, scaleY: 1, duration: 340 / k, ease: 'Back.easeOut' });
    }
    this.burst(view.tile[0] * T + T / 2, view.tile[1] * T + 4, 6, 11, k);
  }

  /** Искры (кадр `fx_spark`) вокруг точки мира. */
  private burst(cx: number, cy: number, n: number, r: number, k: number, delay = 0): void {
    const s = this.h.scene;
    const f = this.frame('fx_spark');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const o = f ? s.add.sprite(cx, cy, ATLAS, f).setOrigin(0.5, 0.5) : s.add.rectangle(cx, cy, 2, 2, 0xf2d552);
      o.setDepth(20_000);
      s.tweens.add({ targets: o, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.8 - 4, alpha: 0, delay: delay / k, duration: 440 / k, ease: 'Quad.easeOut', onComplete: () => o.destroy() });
    }
  }

  /** Верный ответ: растение подпрыгивает (вытянулось и сели обратно), вверх летят листики. */
  private bounce(id: string, k: number, delay = 0): void {
    const p = this.plants.get(id);
    if (!p || !(p.spr instanceof Phaser.GameObjects.Sprite)) return;
    const parts = this.parts(p);
    const s = this.h.scene;
    s.tweens.killTweensOf(parts);
    for (const o of parts) o.setScale(1).setAngle(0);
    s.tweens.add({ targets: parts, scaleY: 1.24, scaleX: 0.9, yoyo: true, duration: 120 / k, delay: delay / k, ease: 'Sine.easeOut', onComplete: () => parts.forEach((o) => o.setScale(1)) });
    const cx = p.view.tile[0] * T + T / 2;
    const top = p.view.tile[1] * T + 6;
    for (let i = 0; i < 3; i++) {
      const o = s.add.rectangle(cx - 3 + i * 3, top, 2, 2, 0x8cc455).setDepth(20_000);
      s.tweens.add({ targets: o, y: top - 9 - i * 2, x: o.x + (i - 1) * 3, alpha: 0, delay: (delay + 60 + i * 50) / k, duration: 420 / k, onComplete: () => o.destroy() });
    }
  }

  /** Неверный ответ: растение дрожит на месте. */
  private shake(id: string, k: number): void {
    const p = this.plants.get(id);
    if (!p || !(p.spr instanceof Phaser.GameObjects.Sprite)) return;
    const parts = this.parts(p);
    const x0 = p.view.tile[0] * T + T / 2;
    this.h.scene.tweens.killTweensOf(parts);
    for (const o of parts) o.setX(x0);
    this.h.scene.tweens.add({ targets: parts, x: x0 + 1.5, yoyo: true, repeat: 2, duration: 45 / k, onComplete: () => parts.forEach((o) => o.setX(x0)) });
  }

  private markRipe(id: string): void {
    this.pendingHarvest.add(id);
    const p = this.plants.get(id);
    if (!p) return;
    p.spr.destroy();
    p.ic?.destroy();
    const v = { ...p.view, stage: 'ripe' as const };
    p.view = v;
    Object.assign(p, this.makePlant(v));
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
        bus.emit('fx:sfx', { name: 'pick' });
        if (j.act.tile) this.burst(j.act.tile[0] * T + T / 2, j.act.tile[1] * T + 4, 6, 10, k);
        this.pendingHarvest.delete(j.act.id);
        const p = this.plants.get(j.act.id);
        if (p && !this.views.some((v) => v.id === j.act.id)) {
          this.destroyPlant(p);
          this.plants.delete(j.act.id);
        } else if (p) {
          // Перезревшее с той же грядки ушло в банку, но запись ещё есть: перерисуем по текущему виду.
          p.spr.destroy();
          p.ic?.destroy();
          const v = this.views.find((x) => x.id === j.act.id)!;
          p.view = v;
          Object.assign(p, this.makePlant(v));
        }
        this.carrying = true;
        const phrase = j.act.id.startsWith('p.');
        // Плод над головой — тот же мини-предмет (или плод цвета), что рос на кусте; куст-растение и фраза несут общий.
        const own = p?.view.look && !phrase ? this.named(framesOf(p.view.look).held) : null;
        const f = own ?? this.frame(phrase ? 'item_crop_phrase' : 'item_crop') ?? this.frame(phrase ? 'crop_ripe_phrase' : 'crop_ripe');
        if (f) {
          // Плод поднимается над головой: появляется «с хлопком».
          const it = this.h.scene.add.sprite(0, 0, ATLAS, f).setOrigin(0.5, 1).setScale(0.4);
          this.item = it;
          this.h.scene.tweens.add({ targets: it, scaleX: 1, scaleY: 1, duration: 260 / k, ease: 'Back.easeOut' });
        }
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
        const xp = j.act.xp;
        // Плод влетает в коробку: «плим», свечение, искры и «+N».
        const landed = (): void => {
          if (!bin) return;
          bus.emit('fx:sfx', { name: 'plim' });
          this.float([bin.at[0] + 0.5, bin.at[1] - 1], `+${xp}`, 'xp');
          this.glow((bin.at[0] + bin.size[0] / 2) * T, (bin.at[1] + 1) * T - 8, k);
        };
        if (this.item && bin) {
          const it = this.item;
          this.item = null;
          const s = this.h.scene;
          // Короткий подброс, потом полёт вниз в коробку.
          s.tweens.add({
            targets: it,
            y: it.y - 9,
            duration: 130 / k,
            ease: 'Sine.easeOut',
            onComplete: () =>
              s.tweens.add({
                targets: it,
                x: (bin.at[0] + bin.size[0] / 2) * T,
                y: (bin.at[1] + 1) * T - 8,
                scaleX: 0.7,
                scaleY: 0.7,
                duration: 260 / k,
                ease: 'Quad.easeIn',
                onComplete: () => {
                  it.destroy();
                  landed();
                },
              }),
          });
        } else landed();
        this.carrying = false;
        return;
      }
      case 'throw': {
        if (time < j.until) return;
        this.heroAction = null;
        this.job = null;
        return;
      }
    }
  }

  /** Свечение коробки при попадании плода: жёлтый овал, расходится и гаснет, и искры. */
  private glow(x: number, y: number, k: number): void {
    const s = this.h.scene;
    const e = s.add.ellipse(x, y, 22, 10, 0xf2d552, 0.6).setDepth(19_999);
    s.tweens.add({ targets: e, alpha: 0, scaleX: 1.7, scaleY: 1.7, duration: 460 / k, ease: 'Quad.easeOut', onComplete: () => e.destroy() });
    this.burst(x, y - 2, 6, 12, k);
  }

  /** Капли полива, искры удобрения; растение отзывается: подрастает, дрожит при промахе, подпрыгивает при урожае. */
  private fx(act: FarmAct, k: number): void {
    if (!act.tile) return;
    const s = this.h.scene;
    const cx = act.tile[0] * T + T / 2;
    const top = act.tile[1] * T + 2;
    if (act.kind === 'miss') this.shake(act.id, k);
    if (act.kind === 'water' || act.kind === 'grow') {
      bus.emit('fx:sfx', { name: 'water' });
      const f = this.frame('fx_drop');
      for (let i = 0; i < 3; i++) {
        const x = cx - 4 + i * 4;
        const o = f ? s.add.sprite(x, top - 6, ATLAS, f).setOrigin(0.5, 1) : s.add.rectangle(x, top - 6, 1, 3, 0x5ba3d2);
        o.setDepth(20_000);
        s.tweens.add({ targets: o, y: top + 8, alpha: 0.2, delay: (i * 90) / k, duration: 320 / k, onComplete: () => o.destroy() });
      }
      // Капли долетели: растение подросло (смена спрайта и искры при новой стадии, иначе подпрыгнуло).
      if (act.kind === 'grow') {
        const j = this.job;
        s.time.delayedCall(300 / k, () => {
          if (j) j.evolved = true;
          this.rebuild(act.id, true, k);
        });
      } else this.bounce(act.id, k, 280);
    }
    if (act.kind === 'harvest') this.bounce(act.id, k);
    if (act.kind === 'grow' || act.kind === 'harvest') this.burst(cx, top + 6, 4, 9, k, 250);
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
