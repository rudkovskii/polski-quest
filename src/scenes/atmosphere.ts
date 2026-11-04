import Phaser from 'phaser';
import { daylight, indoorLight, lightChanged, type Daylight, type Rgb } from '../systems/daylight';
import type { LocationMap } from '../types/map';
import { cellHash } from '../world/ascii';
import { bakeLightmap, bakeVignette, bayer, falloff } from '../world/lightmap';
import { lightsOf, propRefs, SPRITE_GLASS, type PropRef } from '../world/lights';

// Атмосфера мира: свет и тени суток, виньетка, ветер, частицы. Вся картинка — несколько запечённых canvas в пикселях мира:
// сетка пикселей не плывёт, а телефон платит за одну-две большие текстуры, без шейдерных проходов. Выключатель — настройка `fx`:
// сцена тогда просто не создаёт этот слой и выглядит как раньше. `motion: false` (prefers-reduced-motion, просадка кадров) оставляет свет
// и убирает всё, что движется. Попадание по объектам считает модель, этот слой на него не влияет.

const T = 16;
const ATLAS = 'custom';
/** Запас вокруг карты: кроны и крыша выходят за её край. */
const PAD = 32;

const DEPTH_GROUND = 2.9;
const DEPTH_TUFT = 4;
const DEPTH_AIR = 8800;
const DEPTH_CLOUD = 8900;
const DEPTH_LIGHT = 9000;
const DEPTH_GLOW = 9001;
const DEPTH_VIGNETTE = 9002;

const SWAY_FRAMES = 5;
const SWAY_PAD = 2;
/** Что качается: амплитуда в px и где кончается гибкая часть (строка кадра снизу не качается). */
const SWAY: Readonly<Record<string, { amp: number; root: number }>> = {
  tree: { amp: 2, root: 33 },
  tree2: { amp: 2, root: 33 },
  bush: { amp: 1, root: 15 },
  bush_flowers: { amp: 1, root: 15 },
  flower_pink: { amp: 1, root: 15 },
  flower_yellow: { amp: 1, root: 15 },
  flower_white: { amp: 1, root: 15 },
  v3_tuft: { amp: 1, root: 15 },
  v3_tuft2: { amp: 1, root: 15 },
  v3_tuft3: { amp: 1, root: 15 },
};

interface SpriteMeta {
  size: [number, number];
  anchor: [number, number];
  frames: string[];
}

export interface AtmosphereHost {
  scene: Phaser.Scene;
  map: LocationMap;
  /** Час игрока, дробный. */
  hour(): number;
  props: ReadonlyMap<string, Phaser.GameObjects.Sprite>;
  sprites: Readonly<Record<string, SpriteMeta>>;
  /** Клетка занята (деревце травы здесь не ставим). */
  taken(x: number, y: number): boolean;
  /** Движение разрешено системой. */
  motion: boolean;
}

interface Swayer {
  s: Phaser.GameObjects.Sprite;
  id: string;
  x: number;
  y: number;
  n: number;
}

interface Fly {
  s: Phaser.GameObjects.Image;
  ax: number;
  ay: number;
  p: number;
  sp: number;
}

export class Atmosphere {
  private readonly scene: Phaser.Scene;
  private readonly indoor: boolean;
  private readonly refs: PropRef[];
  private readonly w: number;
  private readonly h: number;
  private light!: Daylight;
  private mul!: Phaser.GameObjects.Image;
  private outer: Phaser.GameObjects.Rectangle[] = [];
  private ground!: Phaser.GameObjects.Image;
  private glass: Phaser.GameObjects.Image | null = null;
  private vignette: Phaser.GameObjects.Image | null = null;
  private vigKey = '';
  private lantern: Phaser.GameObjects.Image | null = null;
  private clouds: Phaser.GameObjects.Image[] = [];
  private flames: { s: Phaser.GameObjects.Image; base: number; seed: number }[] = [];
  private flies: Fly[] = [];
  private swayers: Swayer[] = [];
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private readonly zone = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private motion: boolean;
  private nextLight = 0;
  private nextSway = 0;
  private nextZone = 0;

  constructor(private readonly host: AtmosphereHost) {
    this.scene = host.scene;
    this.indoor = host.map.id === 'home';
    this.refs = propRefs(host.map);
    this.w = host.map.size[0] * T + PAD * 2;
    this.h = host.map.size[1] * T + PAD * 2;
    this.motion = host.motion;
    this.ensureDots();
    this.mul = this.scene.add.image(-PAD, -PAD, this.canvas('mul', this.w, this.h).key).setOrigin(0).setDepth(DEPTH_LIGHT).setBlendMode(Phaser.BlendModes.MULTIPLY);
    const far = 3000;
    this.outer = (
      [
        [-far - PAD, -far - PAD, far * 2 + this.w, far],
        [-far - PAD, this.h - PAD, far * 2 + this.w, far],
        [-far - PAD, -PAD, far, this.h],
        [this.w - PAD, -PAD, far, this.h],
      ] as const
    ).map(([x, y, w, h]) => this.scene.add.rectangle(x, y, w, h, 0xffffff).setOrigin(0).setDepth(DEPTH_LIGHT).setBlendMode(Phaser.BlendModes.MULTIPLY));
    this.ground = this.scene.add.image(-PAD, -PAD, this.canvas('ground', this.w, this.h).key).setOrigin(0).setDepth(DEPTH_GROUND);
    if (SPRITE_GLASS && !this.indoor) this.glass = this.scene.add.image(-PAD, -PAD, this.canvas('glass', this.w, this.h).key).setOrigin(0).setDepth(DEPTH_GLOW);
    this.lantern = this.scene.add.image(0, 0, 'atm:halo').setDepth(DEPTH_GLOW).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.bake();
    this.bakeGlass();
    this.buildFlames();
    if (this.motion) {
      this.ensureSway();
      this.adoptSway();
      if (!this.indoor) {
        this.buildClouds();
        this.buildFlies();
      }
      this.buildParticles();
    }
  }

  // ───────────── свет ─────────────

  private read(): Daylight {
    const d = daylight(this.host.hour());
    return this.indoor ? indoorLight(d) : d;
  }

  private canvas(name: string, w: number, h: number): Phaser.Textures.CanvasTexture {
    const key = `atm:${name}:${this.host.map.id}`;
    const tm = this.scene.textures;
    if (tm.exists(key)) return tm.get(key) as Phaser.Textures.CanvasTexture;
    const t = tm.createCanvas(key, w, h);
    if (!t) throw new Error(`atmosphere: не создан canvas ${key}`);
    return t;
  }

  private put(tex: Phaser.Textures.CanvasTexture, px: Uint8ClampedArray, w: number, h: number): void {
    tex.context.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    tex.refresh();
  }

  private bake(): void {
    const d = this.read();
    this.light = d;
    const lamp = this.indoor ? { x: (this.host.map.size[0] * T) / 2, y: 60 } : null;
    const lights = lightsOf(this.refs, d, lamp).map((l) => ({ ...l, x: l.x + PAD, y: l.y + PAD }));
    const neutral = d.ambient.every((v) => v > 0.985) && !lights.length;
    this.mul.setVisible(!neutral);
    if (!neutral) this.put(this.canvas('mul', this.w, this.h), bakeLightmap(this.w, this.h, d.ambient, lights), this.w, this.h);
    this.bakeGround(d);
    this.glass?.setAlpha(d.lamps);
    if (this.lantern) {
      this.lantern.setVisible(d.lamps > 0.2).setAlpha(d.lamps * (this.indoor ? 0.1 : 0.18));
    }
    for (const c of this.clouds) c.setVisible(d.shadow > 0.3 && d.lamps < 0.4);
    // За краем карты тот же окружающий свет: четыре полосы вокруг карты света (канвас покрывает только карту и запас).
    const [r, g, b] = d.ambient;
    const tint = Phaser.Display.Color.GetColor(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
    for (const o of this.outer) o.setFillStyle(tint).setVisible(!neutral);
  }

  /** Тени предметов на земле (под всеми спрайтами) и солнечные пятна от окон на полу. */
  private bakeGround(d: Daylight): void {
    const tex = this.canvas('ground', this.w, this.h);
    const ctx = tex.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const mask = document.createElement('canvas');
    mask.width = this.w;
    mask.height = this.h;
    const m = mask.getContext('2d');
    if (!m) return;
    m.imageSmoothingEnabled = false;
    const atlas = this.scene.textures.get(ATLAS);
    const img = atlas.getSourceImage() as CanvasImageSource;
    for (const r of this.refs) {
      if (!r.cast) continue;
      const meta = this.host.sprites[r.sprite];
      const name = meta?.frames[0];
      if (!meta || !name || !atlas.has(name)) continue;
      // Объект мог быть скрыт или в другой стадии (Zagroda, хатка): тень как у того, что видно.
      const sp = this.host.props.get(r.key);
      if (sp && !sp.visible) continue;
      const f = sp && sp.texture.key === ATLAS ? sp.frame : atlas.get(name);
      const sy = Math.min(d.shadowLen, 20 / f.cutHeight);
      m.setTransform(1, 0, -d.shadowX * sy * 1.1, -sy, r.x + PAD, r.y + PAD);
      m.drawImage(img, f.cutX, f.cutY, f.cutWidth, f.cutHeight, -f.cutWidth / 2, -f.cutHeight, f.cutWidth, f.cutHeight);
    }
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-in';
    m.fillStyle = '#1e1432';
    m.fillRect(0, 0, this.w, this.h);
    // Полутень — силуэт на пиксель шире и вдвое слабее.
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = d.shadow * 0.5;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.globalAlpha = d.shadow * 0.2;
      ctx.drawImage(mask, ox, oy);
    }
    ctx.globalAlpha = d.shadow;
    ctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = 1;
    if (this.indoor) this.bakeShafts(ctx, d);
    tex.refresh();
  }

  private bakeShafts(ctx: CanvasRenderingContext2D, d: Daylight): void {
    const sun = 1 - d.lamps;
    const moon = d.night * 0.5;
    if (sun + moon < 0.05) return;
    ctx.fillStyle = sun > moon ? '#ffeec0' : '#a8c0ff';
    const power = Math.max(sun * 0.3, moon * 0.26);
    for (const r of this.refs) {
      if (r.sprite !== 'window') continue;
      const len = 46;
      for (let row = 0; row < len; row++) {
        const fade = (1 - row / len) * power;
        const x0 = r.x + PAD - 7 + Math.round(row * d.shadowX * 0.6);
        for (let c = 0; c < 14; c++) {
          if (c === 6 || c === 7 || row % 16 === 7 || row % 16 === 8) continue;
          const x = x0 + c;
          const y = r.y + PAD + row;
          if (fade * 2.4 > bayer(x, y)) {
            ctx.globalAlpha = Math.min(0.4, fade + 0.05);
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Стёкла домов: вечером синие пиксели внутри окна желтеют. Один раз: от времени зависит только прозрачность слоя. */
  private bakeGlass(): void {
    if (!this.glass) return;
    const tex = this.canvas('glass', this.w, this.h);
    const atlas = this.scene.textures.get(ATLAS);
    const tmp = document.createElement('canvas');
    const t = tmp.getContext('2d', { willReadFrequently: true });
    if (!t) return;
    tex.context.clearRect(0, 0, this.w, this.h);
    for (const r of this.refs) {
      const rects = SPRITE_GLASS[r.sprite];
      const meta = this.host.sprites[r.sprite];
      const name = meta?.frames[0];
      if (!rects || !meta || !name) continue;
      const f = atlas.get(name);
      tmp.width = f.cutWidth;
      tmp.height = f.cutHeight;
      t.drawImage(atlas.getSourceImage() as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
      const x0 = r.x + PAD - meta.anchor[0];
      const y0 = r.y + PAD - meta.anchor[1] - 1;
      for (const [rx, ry, rw, rh] of rects) {
        const px = t.getImageData(rx, ry, rw, rh).data;
        for (let y = 0; y < rh; y++)
          for (let x = 0; x < rw; x++) {
            const i = (y * rw + x) * 4;
            if (px[i + 3]! < 200 || px[i + 2]! <= px[i]! + 15) continue;
            tex.context.fillStyle = px[i + 1]! > 150 ? '#ffe9a6' : '#f5bc5a';
            tex.context.fillRect(x0 + rx + x, y0 + ry + y, 1, 1);
          }
      }
    }
    tex.refresh();
  }

  /** Живой огонь: тёплое пятно поверх карты света чуть дрожит. */
  private buildFlames(): void {
    for (const r of this.refs) {
      const fire = r.sprite === 'ks_kominek' || r.sprite === 'ks_swieca' || r.sprite === 'w2_znicz' || r.sprite === 'v3_lantern' || r.sprite === 'ks_lampa';
      if (!fire) continue;
      const dy = r.sprite === 'v3_lantern' ? -18 : r.sprite === 'ks_lampa' ? -24 : -7;
      const s = this.scene.add.image(r.x, r.y + dy, 'atm:halo').setDepth(DEPTH_GLOW).setBlendMode(Phaser.BlendModes.ADD).setScale(r.sprite === 'ks_kominek' ? 0.7 : 0.4);
      this.flames.push({ s, base: 0.5, seed: cellHash(r.x, r.y) % 97 });
    }
  }

  /** Тень героя и кота: смещение от солнца, пиксели мира. */
  get shadowShift(): { dx: number; dy: number } {
    return { dx: Math.round(this.light.shadowX * 2), dy: 1 };
  }

  /** Сила круглой тени под героем и котом. */
  get shadowAlpha(): number {
    return 0.5 + this.light.shadow;
  }

  /** Вид изменился: виньетка по размеру экрана (в пикселях мира). */
  layout(width: number, height: number, zoom: number): void {
    const w = Math.ceil(width / zoom) + 2;
    const h = Math.ceil(height / zoom) + 2;
    const strength = this.indoor ? 0.56 : 0.4;
    const key = `atm:vig:${w}x${h}:${strength}`;
    if (!this.scene.textures.exists(key)) {
      const t = this.scene.textures.createCanvas(key, w, h);
      if (!t) return;
      t.context.putImageData(new ImageData(bakeVignette(w, h, strength, [0.13, 0.07, 0.17] as Rgb) as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
      t.refresh();
    }
    if (key !== this.vigKey) {
      this.vigKey = key;
      this.vignette?.destroy();
      this.vignette = this.scene.add.image(0, 0, key).setScrollFactor(0).setDepth(DEPTH_VIGNETTE);
    }
    this.vignette?.setPosition(width / 2, height / 2);
  }

  // ───────────── текстурки ─────────────

  private ensureDots(): void {
    const tm = this.scene.textures;
    if (tm.exists('atm:dots')) return;
    const t = tm.createCanvas('atm:dots', 48, 8);
    if (!t) return;
    const c = t.context;
    const dot = (color: string, x: number, y: number, w = 1, h = 1): void => {
      c.fillStyle = color;
      c.fillRect(x, y, w, h);
    };
    dot('#fff4c8', 0, 0);
    t.add('pollen', 0, 0, 0, 1, 1);
    dot('#b4c95a', 2, 0, 2, 1); dot('#8fb04a', 3, 1);
    t.add('leaf1', 0, 2, 0, 2, 2);
    dot('#dcb53c', 5, 0); dot('#dcb53c', 6, 1); dot('#c08a3a', 5, 1);
    t.add('leaf2', 0, 5, 0, 2, 2);
    dot('#fff2a0', 9, 0); dot('#fff2a0', 8, 1, 3, 1); dot('#fff2a0', 9, 2); dot('#ffffe0', 9, 1);
    t.add('spark', 0, 8, 0, 3, 3);
    dot('#e8e2d8', 13, 0, 1, 3); dot('#e8e2d8', 12, 1, 3, 1);
    t.add('puff', 0, 12, 0, 3, 3);
    // Бабочка: крылья раскрыты и сложены, два окраса.
    const fly = (x: number, a: string, b: string): void => {
      dot(a, x, 0, 2, 2); dot(a, x + 3, 0, 2, 2); dot(b, x + 1, 2); dot(b, x + 3, 2); dot('#3d2f3b', x + 2, 0, 1, 3);
      dot(a, x + 7, 0, 1, 2); dot(a, x + 9, 0, 1, 2); dot('#3d2f3b', x + 8, 0, 1, 3);
    };
    fly(16, '#f2d552', '#e0a63a');
    t.add('flyA0', 0, 16, 0, 5, 3); t.add('flyA1', 0, 21, 0, 5, 3);
    fly(26, '#f5f1e8', '#e57a97');
    t.add('flyB0', 0, 26, 0, 5, 3); t.add('flyB1', 0, 31, 0, 5, 3);
    t.refresh();
    // Ореол: тёплое пятно ступенями с растром.
    const h = tm.createCanvas('atm:halo', 64, 64);
    if (h) {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const v = falloff(Math.hypot(x - 31.5, y - 31.5), 32);
          const a = Math.floor(v * 7 + bayer(x, y)) / 7;
          if (a <= 0) continue;
          h.context.fillStyle = `rgba(255, 190, 110, ${a})`;
          h.context.fillRect(x, y, 1, 1);
        }
      h.refresh();
    }
    // Тень облака: неровное пятно с растровым краем.
    const cw = 240;
    const ch = 130;
    const cl = tm.createCanvas('atm:cloud', cw, ch);
    if (cl) {
      const blobs: [number, number, number][] = [[70, 66, 50], [120, 58, 60], [172, 70, 46], [100, 84, 40], [146, 90, 34]];
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          let v = 0;
          for (const [bx, by, br] of blobs) v = Math.max(v, 1 - Math.hypot(x - bx, (y - by) * 1.2) / br);
          if (v * 4.5 > bayer(x, y)) {
            cl.context.fillStyle = '#d6dbe8';
            cl.context.fillRect(x, y, 1, 1);
          }
        }
      cl.refresh();
    }
  }

  private ensureSway(): void {
    const tm = this.scene.textures;
    if (tm.exists('atm:sway')) return;
    const atlas = tm.get(ATLAS);
    const ids = Object.keys(SWAY).filter((id) => this.host.sprites[id] && atlas.has(this.host.sprites[id]!.frames[0]!));
    let height = 0;
    let width = 0;
    for (const id of ids) {
      const [w, h] = this.host.sprites[id]!.size;
      height += h;
      width = Math.max(width, (w + SWAY_PAD * 2) * SWAY_FRAMES);
    }
    const t = tm.createCanvas('atm:sway', width, height);
    if (!t) return;
    const c = t.context;
    c.imageSmoothingEnabled = false;
    const src = atlas.getSourceImage() as CanvasImageSource;
    let top = 0;
    for (const id of ids) {
      const meta = this.host.sprites[id]!;
      const f = atlas.get(meta.frames[0]!);
      const [w, h] = meta.size;
      const { amp, root } = SWAY[id]!;
      for (let n = 0; n < SWAY_FRAMES; n++) {
        const s = ((n - 2) / 2) * amp;
        const x0 = n * (w + SWAY_PAD * 2) + SWAY_PAD;
        for (let y = 0; y < h; y++) {
          const k = y > root ? 0 : Math.pow((root - y) / root, 1.3);
          c.drawImage(src, f.cutX, f.cutY + y, w, 1, x0 + Math.round(s * k), top + y, w, 1);
        }
        t.add(`${id}/${n}`, 0, x0 - SWAY_PAD, top, w + SWAY_PAD * 2, h);
      }
      top += h;
    }
    t.refresh();
  }

  /** Деревья, кусты и цветы карты берут кадры ветра; на траву ложатся кустики. */
  private adoptSway(): void {
    const tex = this.scene.textures.get('atm:sway');
    if (!tex || !this.scene.textures.exists('atm:sway')) return;
    for (const s of this.host.props.values()) {
      const id = s.getData('sprite') as string;
      if (!SWAY[id] || !tex.has(`${id}/2`)) continue;
      s.setTexture('atm:sway', `${id}/2`);
      this.swayers.push({ s, id, x: s.x, y: s.y, n: 2 });
    }
    if (this.indoor || !tex.has('v3_tuft/2')) return;
    const [mw, mh] = this.host.map.size;
    for (let y = 2; y < mh - 1; y++)
      for (let x = 1; x < mw - 1; x++) {
        if (this.host.taken(x, y)) continue;
        const v = cellHash(x + 7, y + 3);
        if (v % 100 > 34) continue;
        const px = x * T + T / 2 + ((v >>> 8) % 11) - 5;
        const py = y * T + T - ((v >>> 12) % 6);
        const id = ['v3_tuft', 'v3_tuft2', 'v3_tuft3'][(v >>> 16) % 3]!;
        const s = this.scene.add.sprite(px, py, 'atm:sway', `${id}/2`).setOrigin(0.5, 1).setDepth(DEPTH_TUFT);
        this.swayers.push({ s, id, x: px, y: py, n: 2 });
      }
  }

  private stepSway(time: number): void {
    const v = this.scene.cameras.main.worldView;
    const t = time / 1000;
    for (const o of this.swayers) {
      if (o.x < v.x - 40 || o.x > v.right + 40 || o.y < v.y - 16 || o.y > v.bottom + 64) continue;
      const gust = 0.42 + 0.58 * Math.max(0, Math.sin(t * 0.37 - o.x * 0.012));
      const wave = Math.sin(t * 2.1 - o.x * 0.05 + o.y * 0.03) * gust;
      const n = Math.round(wave * 2) + 2;
      if (n === o.n) continue;
      o.n = n;
      o.s.setFrame(`${o.id}/${n}`);
    }
  }

  // ───────────── небо и воздух ─────────────

  private buildClouds(): void {
    if (this.light.lamps >= 0.4) return;
    for (let i = 0; i < 2; i++) {
      const s = this.scene.add.image(i * 260, 40 + i * 170, 'atm:cloud').setDepth(DEPTH_CLOUD).setBlendMode(Phaser.BlendModes.MULTIPLY);
      this.clouds.push(s);
    }
  }

  private buildFlies(): void {
    if (this.light.night > 0.1) return;
    const spots = this.refs.filter((r) => r.sprite.startsWith('flower_') || r.sprite === 'bush_flowers');
    for (let i = 0; i < Math.min(4, spots.length); i++) {
      const a = spots[(i * 3 + 1) % spots.length]!;
      const name = i % 2 ? 'flyB0' : 'flyA0';
      this.flies.push({ s: this.scene.add.image(a.x, a.y, 'atm:dots', name).setDepth(DEPTH_AIR), ax: a.x, ay: a.y - 8, p: i * 1.7, sp: 0.5 + i * 0.09 });
    }
  }

  private buildParticles(): void {
    const scene = this.scene;
    const d = this.light;
    const zone = { type: 'random', source: this.zone } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData;
    const add = (cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, depth: number, blend?: Phaser.BlendModes): void => {
      const e = scene.add.particles(0, 0, 'atm:dots', { ...cfg, emitZone: zone }).setDepth(depth);
      if (blend !== undefined) e.setBlendMode(blend);
      this.emitters.push(e);
    };
    this.updateZone();
    if (this.indoor) {
      if (d.lamps < 0.6) add({ frame: 'pollen', lifespan: 7000, speedX: { min: -2, max: 3 }, speedY: { min: -3, max: 2 }, alpha: { start: 0.75, end: 0 }, frequency: 700, maxAliveParticles: 10 }, DEPTH_AIR);
    } else {
      if (d.night < 0.5) {
        add({ frame: 'pollen', lifespan: 6000, speedX: { min: 3, max: 9 }, speedY: { min: -4, max: 3 }, alpha: { start: 0.9, end: 0 }, frequency: 420, maxAliveParticles: 16 }, DEPTH_AIR);
        add({ frame: ['leaf1', 'leaf1', 'leaf2'], lifespan: 8000, speedX: { min: 7, max: 15 }, speedY: { min: 6, max: 11 }, alpha: { start: 1, end: 0.2 }, frequency: 2600, maxAliveParticles: 6 }, DEPTH_AIR);
      }
      if (d.night > 0.3) {
        add({ frame: 'spark', lifespan: 4200, speedX: { min: -5, max: 5 }, speedY: { min: -4, max: 4 }, alpha: { onUpdate: (_p: unknown, _k: unknown, t: number) => Math.sin(t * Math.PI * 4) ** 2 }, frequency: 420, maxAliveParticles: 12 } as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, DEPTH_GLOW, Phaser.BlendModes.ADD);
      }
      const house = this.refs.find((r) => r.sprite === 'house');
      if (house) {
        const smoke = scene.add.particles(house.x + 16, house.y - 66, 'atm:dots', { frame: 'puff', lifespan: 3600, speedX: { min: 2, max: 6 }, speedY: { min: -11, max: -7 }, alpha: { start: 0.42, end: 0 }, scale: { start: 1, end: 2 }, frequency: 620, maxAliveParticles: 8 });
        smoke.setDepth(DEPTH_AIR);
        this.emitters.push(smoke);
      }
    }
  }

  private updateZone(): void {
    const v = this.scene.cameras.main.worldView;
    this.zone.setTo(v.x - 8, v.y - 8, Math.max(v.width, 200) + 16, Math.max(v.height, 200) + 16);
  }

  // ───────────── кадр ─────────────

  /** Кадры проседают: убрать всё движущееся, свет оставить. */
  cutMotion(): void {
    if (!this.motion) return;
    this.motion = false;
    for (const e of this.emitters) e.destroy();
    this.emitters = [];
    for (const f of this.flies) f.s.destroy();
    this.flies = [];
    for (const c of this.clouds) c.destroy();
    this.clouds = [];
    for (const o of this.swayers) if (o.n !== 2) o.s.setFrame(`${o.id}/2`);
  }

  update(time: number, delta: number, hero: { x: number; y: number }): void {
    if (time >= this.nextLight) {
      // Первый кадр: слои карты уже расставили видимость объектов, тени надо снять заново.
      const first = this.nextLight === 0;
      this.nextLight = time + 15_000;
      const d = this.read();
      if (first || lightChanged(d, this.light)) this.bake();
    }
    if (this.lantern?.visible) this.lantern.setPosition(Math.round(hero.x), Math.round(hero.y) - 10);
    for (const f of this.flames) {
      const n = Math.sin(time * 0.013 + f.seed) + Math.sin(time * 0.031 + f.seed * 2);
      f.s.setVisible(this.light.lamps > 0.1 || this.indoor).setAlpha(0.2 + (this.motion ? 0.05 * n : 0));
    }
    if (!this.motion) return;
    if (time >= this.nextSway) {
      this.nextSway = time + 110;
      this.stepSway(time);
    }
    if (time >= this.nextZone) {
      this.nextZone = time + 800;
      this.updateZone();
    }
    const mw = this.host.map.size[0] * T;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i]!;
      const x = c.getData('fx') === undefined ? c.x : (c.getData('fx') as number);
      const nx = x + (delta / 1000) * (3.2 + i);
      c.setData('fx', nx > mw + 150 ? -150 : nx);
      c.x = Math.round(c.getData('fx') as number);
    }
    for (const f of this.flies) {
      const t = (time / 1000) * f.sp + f.p;
      const x = f.ax + Math.sin(t) * 30 + Math.sin(t * 2.3) * 8;
      const y = f.ay + Math.sin(t * 1.3 + 1) * 16 + Math.sin(t * 5) * 2;
      f.s.setPosition(Math.round(x), Math.round(y));
      f.s.setFrame(`fly${f.p % 3.4 < 1.7 && f.p !== 1.7 * 1 ? 'A' : 'B'}${Math.floor(time / 130) % 2}`);
    }
  }

  dispose(): void {
    this.flies = [];
    this.swayers = [];
    this.emitters = [];
    this.clouds = [];
    this.flames = [];
  }
}
