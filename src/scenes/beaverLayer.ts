import Phaser from 'phaser';
import { bus } from '../systems/bus';
import { seededRand, type BeaverApi, type VisitPlan } from '../systems/beaver';
import { BeaverLife, beaverHost, type BeaverHost, type BeaverMode } from '../world/beaverLife';
import { LocationModel } from '../world/location';

// Бобёр на ферме (просьба Шэфа 19.10): гость на уровнях 0–9 и хозяин хатки с 10-го. Тут только сцена: спрайт, тень, плавное появление и уход,
// анимации. Кто и когда приходит — `systems/beaver.ts`; что делает на карте — `world/beaverLife.ts`.

const T = 16;
const ATLAS = 'custom';
/** Как часто спрашиваем, не пора ли гостю, мс (смена игрового часа ловится по часам, не по кадрам). */
const CHECK_MS = 5000;
/** Скорость появления и ухода: полная прозрачность за 1/ALPHA_RATE с. */
const ALPHA_RATE = 4;

interface SpriteMeta {
  size: [number, number];
  anchor: [number, number];
  frames: string[];
  anims: Record<string, string[]>;
}

export interface BeaverLayerDeps {
  scene: Phaser.Scene;
  model: LocationModel;
  sprites: Record<string, SpriteMeta>;
  api: BeaverApi;
  toScreen(x: number, y: number): { x: number; y: number };
  placeShadow(cx: number, bottom: number, width: number, depth: number): Phaser.GameObjects.Image;
  /** Мини-игра с автобегом открыта: новые гости не приходят. */
  auto(): boolean;
}

const RATE: Record<string, number> = { walk: 8, run: 12, wash: 3, gnaw: 4, swim: 3, peek: 1.5 };

export class BeaverLayer {
  private life: BeaverLife | null = null;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private shadow: Phaser.GameObjects.Image | null = null;
  private alpha = 0;
  private checkT = 0;
  private rng: () => number = Math.random;
  private readonly host: BeaverHost;
  private readonly off: () => void;

  constructor(private readonly h: BeaverLayerDeps) {
    this.host = beaverHost(h.model, { rand: () => this.rng(), hour: () => h.api.hour() });
    this.createAnims();
    this.off = bus.on('world:interact', (e) => {
      if (e.use !== 'beaver' || !this.life) return;
      this.life.greet(this.host);
      const [x, y] = LocationModel.pos(this.life);
      bus.emit('beaver:talk', h.toScreen((x + 0.5) * T, y * T + 2));
    });
    this.begin();
  }

  /** Состояние для проверок в браузере и тестах. */
  get state(): { kind: string; tile: [number, number]; mode: BeaverMode; visible: boolean; hidden: boolean } | null {
    const l = this.life;
    return l ? { kind: l.kind, tile: [l.tile[0], l.tile[1]], mode: l.mode, visible: l.visible, hidden: l.hidden } : null;
  }

  /** Dev (`__pq`): позвать гостя или хозяина сейчас, мимо броска. */
  force(kind: 'visit' | 'resident', stayMs = 90_000): void {
    this.clear();
    this.rng = seededRand(Math.floor(this.h.api.now() / 1000));
    this.life = new BeaverLife(kind, this.host, { stayMs });
    this.attach();
  }

  /** Старт сцены: хозяин — живёт; гость — по броску на входе на ферму (или идущий визит). */
  private begin(): void {
    const api = this.h.api;
    if (api.phase() === 'resident') {
      if (this.host.home) this.force('resident');
      return;
    }
    if (this.h.auto()) return;
    const plan = api.enterFarm();
    if (plan) this.startVisit(plan);
  }

  private startVisit(plan: VisitPlan): void {
    const left = Math.max(20_000, plan.stayMs - (this.h.api.now() - plan.startedAt));
    this.rng = seededRand(plan.seed);
    this.life = new BeaverLife('visit', this.host, { stayMs: left });
    this.attach();
  }

  private attach(): void {
    const l = this.life;
    if (!l) return;
    if (l.gone) {
      this.clear(true);
      return;
    }
    this.h.model.beaver = l;
    const meta = this.h.sprites.beaver;
    if (!meta || this.sprite) return;
    this.shadow = this.h.placeShadow(0, 0, 10, 9);
    this.sprite = this.h.scene.add.sprite(0, 0, ATLAS, meta.frames[0]).setOrigin(0.5, 1);
    // Хозяин, который ночью спит, и гость появляются плавно (и сразу не мигают на старой клетке).
    this.alpha = 0;
    this.sprite.setAlpha(0).setVisible(false);
    this.shadow.setAlpha(0).setVisible(false);
  }

  /** `ended`: визит закончился сам (а не сцена закрылась): `api` забывает его и не возобновляет. */
  private clear(ended = false): void {
    if (ended && this.life?.kind === 'visit') this.h.api.end();
    this.life = null;
    this.h.model.beaver = null;
    this.sprite?.destroy();
    this.shadow?.destroy();
    this.sprite = null;
    this.shadow = null;
  }

  update(_time: number, dt: number): void {
    const api = this.h.api;
    if (!this.life) {
      this.checkT += dt;
      if (this.checkT >= CHECK_MS) {
        this.checkT = 0;
        if (api.phase() === 'visitor' && !this.h.auto()) {
          const plan = api.tick();
          if (plan) this.startVisit(plan);
        }
      }
      return;
    }
    const l = this.life;
    l.update(dt, this.host);
    const k = Math.min(1, (dt / 1000) * ALPHA_RATE);
    this.alpha += ((l.visible ? 1 : 0) - this.alpha) * k;
    if (l.gone && this.alpha < 0.05) return this.clear(true);
    this.draw();
  }

  /** Ключ анимации по режиму и повороту (кадры `beaver/*`, `tools/art_beaver.py`). */
  private animKey(l: BeaverLife): string {
    const dir = l.facing;
    const moving = l.step !== null;
    switch (l.mode) {
      case 'walk':
        return `beaver:${moving ? 'walk' : 'idle'}_${dir}`;
      case 'run':
        return moving ? `beaver:run_${l.side}` : `beaver:idle_${l.side}`;
      case 'sit':
        return dir === 'down' ? 'beaver:sit' : dir === 'up' ? 'beaver:idle_up' : `beaver:sit_${dir}`;
      case 'wash':
        return 'beaver:wash';
      case 'gnaw':
        return `beaver:gnaw_${l.side}`;
      case 'swim':
        return `beaver:swim_${l.side}`;
      case 'peek':
        return 'beaver:peek';
      case 'dive':
        return 'beaver:dive';
    }
  }

  private draw(): void {
    const l = this.life;
    const s = this.sprite;
    if (!l || !s || !this.shadow) return;
    const on = this.alpha > 0.03;
    s.setVisible(on);
    const water = l.mode === 'swim' || l.mode === 'peek' || l.mode === 'dive';
    this.shadow.setVisible(on && !water);
    if (!on) return;
    const [fx, fy] = LocationModel.pos(l);
    const x = Math.round(fx * T + T / 2);
    const bottom = Math.round(fy * T + T) + (water ? 1 : 0);
    s.setPosition(x, bottom).setDepth(10 + bottom).setAlpha(this.alpha);
    this.shadow.setPosition(x, bottom - 1).setAlpha(this.alpha);
    const key = this.animKey(l);
    if (s.anims.currentAnim?.key !== key && this.h.scene.anims.exists(key)) s.play(key);
  }

  private createAnims(): void {
    const meta = this.h.sprites.beaver;
    if (!meta) return;
    const anims = this.h.scene.anims;
    for (const [name, frames] of Object.entries(meta.anims)) {
      const key = `beaver:${name}`;
      if (anims.exists(key)) continue;
      const base = name.split('_')[0]!;
      anims.create({ key, frames: frames.map((frame) => ({ key: ATLAS, frame })), frameRate: RATE[base] ?? 1, repeat: -1 });
    }
  }

  dispose(): void {
    this.off();
    this.clear();
  }
}
