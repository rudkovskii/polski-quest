// Пиксельная карта Польши на canvas 2D (в DOM, без Phaser): картинка `poland.png` целым масштабом, города точками `geo_dot`
// (серая / зелёная / золотая по стадии), реки линиями, подсветка воеводств и соседей, компас, мини-герой с котом и флажок.
// Герой бежит к месту (`plant`), втыкает флажок (`geo_flag`: красный, потом зелёный или красный по вердикту), кот бежит рядом.
// Ввод: тап по карте (click) и курсор со стрелок/d-pad (через шину `input:intent`, свои keydown/pointerdown здесь запрещены).
// Текст на canvas не рисуется: подписи — DOM-слой поверх карты.
import { bus as globalBus } from '../../systems/bus';
import type { PolskaUnit } from '../../types/polska';
import { el } from '../../ui/dom';
import { ANIMS, assetsNow, frameOf, loadAssets } from './assets';
import { canvasSize, canvasToMap, MIN_SCALE, pickScale } from './fit';
import type { DotStatus } from './tasks';
import { anchorOf, groupOf, MAP_H, MAP_W, pathOf, posOf, ringsOf, type Pt } from './world';

export interface MapOptions {
  units: readonly PolskaUnit[];
  status(id: string): DotStatus;
  /** Место под карту, css px. */
  maxW: number;
  maxH: number;
  /** Единицы, подсвеченные во время вопроса (мигают). */
  mark?: readonly string[];
  /** Единица, которую нельзя выдавать (цель «покажи»): без золотой булавки и линии. */
  hide?: string | null;
  /** Ввод: тап и курсор. Без него карта только рисуется. */
  interactive?: boolean;
  /** Шина событий (по умолчанию общая). */
  bus?: typeof globalBus;
}

export interface MapView {
  /** Обёртка: `button[data-nav]` в режиме ввода, иначе `div`. */
  el: HTMLElement;
  /** Масштаб карты (css px на px картинки) и целый масштаб спрайтов. */
  readonly scale: number;
  readonly sprite: number;
  /** Куда отдавать выбранную точку (px картинки). После выбора ввод закрыт до `unlock()`. */
  onPick: ((p: Pt) => void) | null;
  readonly zoomed: boolean;
  zoomTo(c: Pt): void;
  zoomOut(): void;
  unlock(): void;
  /** Герой бежит к `p`, втыкает флажок (зелёный, если `ok`), потом `done`. */
  /** Герой бежит и втыкает флажок; возвращает, через сколько мс флажок воткнут и окрашен по вердикту. */
  plant(p: Pt, ok: boolean, done?: () => void): number;
  /** После ответа: подсветить единицы золотом, подписать, показать булавки. */
  reveal(ids: readonly string[]): void;
  moveCursor(dx: number, dy: number): void;
  readonly cursor: Pt | null;
  /** Перерисовать с новым местом (смена ширины окна). */
  layout(maxW: number, maxH: number): void;
  destroy(): void;
}

export { MIN_SCALE, pickScale };
const ZOOM_SPRITE_MULT = 8;
const HERO_SPEED = 170; // px карты в секунду
const REST = { x: 22, y: 282 };
let lastHero: Pt = { ...REST };

type Dir = 'down' | 'up' | 'left' | 'right';
const STAND: Record<Dir, number> = { down: 0, up: 3, right: 6, left: 9 };
const ANCHOR = { dot: [8, 8], flag: [5, 15], hero: [8, 15], cat: [8, 15], compass: [16, 16] } as const;
const COMPASS_AT = { x: 292, y: 30 };

interface FlagState {
  p: Pt;
  ok: boolean;
  t0: number;
}
type Job =
  | { phase: 'run'; t0: number; dur: number; from: Pt; to: Pt; p: Pt; ok: boolean; done: (() => void) | undefined }
  | { phase: 'plant'; t0: number; p: Pt; ok: boolean; done: (() => void) | undefined };

const PLANT_FPS = 8;
const PLANT_T = ANIMS.flag.plant.length / PLANT_FPS;
const WOBBLE_T = 0.5;

export function createMap(o: MapOptions): MapView {
  const bus = o.bus ?? globalBus;
  const canvas = el('canvas', { class: 'geo-canvas', 'aria-hidden': 'true' });
  const labels = el('div', { class: 'geo-labels' });
  const wrap = o.interactive
    ? el('button', { type: 'button', class: 'geo-map', 'data-nav': '', 'data-geo-map': '', 'aria-label': 'Карта Польши' }, canvas, labels)
    : el('div', { class: 'geo-map', 'data-geo-map': '' }, canvas, labels);
  const ctx2d = (() => {
    try {
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  })();

  let scale = 0;
  /** Целый масштаб спрайтов: у карты в целом `base`, при увеличении втрое крупнее, чтобы соседние точки читались. */
  let base = 1;
  let sprite = 1;
  let cw = 0;
  let ch = 0;
  let view = { x: 0, y: 0, u: 1 };
  let zoomed = false;
  let locked = false;
  let destroyed = false;
  let marks = new Set(o.mark ?? []);
  const reveals = new Set<string>();
  const flags: FlagState[] = [];
  let job: Job | null = null;
  const hero = { ...lastHero, dir: 'down' as Dir, moving: false };
  const cat = { x: hero.x - 10, y: hero.y + 2, flip: false, moving: false };
  let cursor: Pt | null = null;
  let lastMoveAt = 0;
  let lastMoveDir: string | null = null;
  let streak = 0;
  let last = 0;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const byId = new Map(o.units.map((u) => [u.id, u]));
  const toX = (x: number): number => (x - view.x) * view.u;
  const toY = (y: number): number => (y - view.y) * view.u;
  const fromScreen = (sx: number, sy: number): Pt => canvasToMap(view, sx, sy);

  const setView = (zoom: Pt | null): void => {
    if (!zoom) {
      view = { x: 0, y: 0, u: scale || 1 };
      zoomed = false;
    } else {
      const u = ZOOM_SPRITE_MULT * base;
      const vw = cw / u;
      const vh = ch / u;
      view = { x: Math.max(0, Math.min(MAP_W - vw, zoom.x - vw / 2)), y: Math.max(0, Math.min(MAP_H - vh, zoom.y - vh / 2)), u };
      zoomed = true;
    }
    sprite = zoom ? 3 * base : base;
    cursor = null;
    placeLabels();
  };

  const layout = (maxW: number, maxH: number): void => {
    // Масштаб: целый от 2, шаг 1/8 между 1 и 2 (`fit.ts`); геометрия стоит на реальном u = cw / MAP_W, поэтому тап и рисование совпадают.
    const sz = canvasSize(pickScale(maxW, maxH));
    scale = sz.cw ? sz.u : 0;
    base = Math.max(1, Math.floor(scale));
    sprite = base;
    cw = sz.cw;
    ch = sz.ch;
    wrap.hidden = scale === 0;
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    setView(null);
    start();
  };

  const placeLabels = (): void => {
    labels.replaceChildren();
    for (const id of reveals) {
      const u = byId.get(id);
      if (!u) continue;
      const a = anchorOf(u);
      const x = Math.max(4, Math.min(cw - 4, toX(a.x)));
      const y = Math.max(10, Math.min(ch - 4, toY(a.y) - (groupOf(u) === 'city' ? 10 * sprite : 0)));
      labels.append(el('span', { class: 'geo-label', 'data-label': id, style: `left:${Math.round(x)}px;top:${Math.round(y)}px` }, u.type === 'region' && typeof u.raw.short === 'string' ? u.raw.short : u.pl));
    }
  };

  // ——— рисование ———
  const spr = (c: CanvasRenderingContext2D, name: string, i: number, anchor: readonly [number, number], x: number, y: number): void => {
    const a = assetsNow();
    const f = frameOf(name, i);
    if (!a || !f) return;
    c.drawImage(a.atlas, f.x, f.y, f.w, f.h, Math.round(toX(x) - anchor[0] * sprite), Math.round(toY(y) - anchor[1] * sprite), f.w * sprite, f.h * sprite);
  };

  const path = (c: CanvasRenderingContext2D, pts: readonly Pt[]): void => {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(toX(p.x), toY(p.y)) : c.moveTo(toX(p.x), toY(p.y))));
  };

  const fillRings = (c: CanvasRenderingContext2D, u: PolskaUnit, style: string, stroke: string): void => {
    const rings = ringsOf(u);
    if (!rings) return;
    c.beginPath();
    for (const r of rings) for (let i = 0; i < r.length; i += 2) (i ? c.lineTo(toX(r[i]!), toY(r[i + 1]!)) : c.moveTo(toX(r[i]!), toY(r[i + 1]!)));
    c.fillStyle = style;
    c.fill();
    c.lineWidth = Math.max(2, sprite);
    c.strokeStyle = stroke;
    c.stroke();
  };

  const heroFrame = (t: number): number => {
    if (hero.moving) {
      const a = ANIMS.hero[`walk_${hero.dir}` as keyof typeof ANIMS.hero];
      return a[Math.floor(t * 8) % a.length]!;
    }
    return STAND[hero.dir];
  };

  const draw = (nowMs: number): void => {
    const c = ctx2d;
    const a = assetsNow();
    if (!c || !cw) return;
    const t = nowMs / 1000;
    const dt = last ? Math.min(0.1, (nowMs - last) / 1000) : 0;
    last = nowMs;
    c.imageSmoothingEnabled = scale < 1;
    c.clearRect(0, 0, cw, ch);
    if (!a) {
      c.fillStyle = '#9d9a94';
      c.fillRect(0, 0, cw, ch);
      return;
    }
    // база
    c.drawImage(a.map, view.x, view.y, cw / view.u, ch / view.u, 0, 0, cw, ch);
    c.imageSmoothingEnabled = false;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);

    // заливка воеводств и соседей
    for (const id of reveals) {
      const u = byId.get(id);
      if (u && (u.type === 'region' || u.type === 'neighbor')) fillRings(c, u, 'rgba(255,214,64,0.34)', '#ffd640');
    }
    for (const id of marks) {
      const u = byId.get(id);
      if (u && (u.type === 'region' || u.type === 'neighbor')) fillRings(c, u, `rgba(255,214,64,${0.18 + 0.22 * pulse})`, `rgba(255,236,150,${0.6 + 0.4 * pulse})`);
    }
    // реки: золотая нить у собранных, яркая у подсвеченных
    for (const u of o.units) {
      if (u.type !== 'river') continue;
      const hot = marks.has(u.id) || reveals.has(u.id);
      const gold = o.status(u.id) === 'gold' && u.id !== o.hide;
      if (!hot && !gold) continue;
      const pts = pathOf(u);
      if (pts.length < 2) continue;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      path(c, pts);
      c.lineWidth = hot ? Math.max(4, 2 * sprite + 2) : Math.max(2, sprite + 1);
      c.strokeStyle = hot ? `rgba(255,214,64,${0.55 + 0.35 * pulse})` : 'rgba(255,214,64,0.55)';
      c.stroke();
      path(c, pts);
      c.lineWidth = hot ? Math.max(2, sprite + 1) : Math.max(1, sprite);
      c.strokeStyle = hot ? '#fff7c2' : '#2f66d0';
      c.stroke();
    }
    // компас
    if (!zoomed) spr(c, 'geo_compass', 0, ANCHOR.compass, COMPASS_AT.x, COMPASS_AT.y);
    // точки: города всегда, булавки гор и озёр — только собранные
    for (const u of o.units) {
      const p = posOf(u);
      if (!p || u.type === 'river' || u.type === 'region' || u.type === 'neighbor' || u.type === 'sea') continue;
      if (toX(p.x) < -16 || toY(p.y) < -16 || toX(p.x) > cw + 16 || toY(p.y) > ch + 16) continue;
      const st = o.status(u.id);
      if (u.type === 'city') spr(c, 'geo_dot', st === 'gold' ? ANIMS.dot.gold : st === 'green' ? ANIMS.dot.green : ANIMS.dot.gray, ANCHOR.dot, p.x, p.y);
      else if (st === 'gold' && u.id !== o.hide) spr(c, 'geo_dot', ANIMS.dot.pinGold, ANCHOR.dot, p.x, p.y);
    }
    // мигающее кольцо вокруг вопроса и верного места
    for (const id of [...marks, ...reveals]) {
      const u = byId.get(id);
      const g = u ? groupOf(u) : null;
      if (!u || g === 'region' || g === 'neighbor' || g === 'river') continue;
      const p = posOf(u);
      if (p) spr(c, 'geo_dot', ANIMS.dot.ping[Math.floor(t * 4) % 2]!, ANCHOR.dot, p.x, p.y);
    }

    // герой, кот, флажки (по y)
    advance(t, dt);
    const items: { y: number; draw: () => void }[] = [];
    for (const f of flags) {
      items.push({
        y: f.p.y,
        draw: () => {
          const age = t - f.t0;
          let frame: number;
          if (age < PLANT_T) frame = ANIMS.flag.plant[Math.min(ANIMS.flag.plant.length - 1, Math.floor(age * PLANT_FPS))]!;
          else {
            const w = ANIMS.flag[f.ok ? 'wobble_green' : 'wobble_red'];
            frame = age < PLANT_T + WOBBLE_T ? w[Math.floor((age - PLANT_T) * 10) % w.length]! : f.ok ? ANIMS.flag.green : ANIMS.flag.red;
          }
          spr(c, 'geo_flag', frame, ANCHOR.flag, f.p.x, f.p.y);
        },
      });
    }
    items.push({ y: cat.y, draw: () => drawCat(c, t) });
    items.push({
      y: hero.y,
      draw: () => {
        const j = job;
        const frame = j?.phase === 'plant' ? ANIMS.hero.kick_right[Math.min(2, Math.floor((t - j.t0) * PLANT_FPS))]! : heroFrame(t);
        spr(c, 'geo_hero', frame, ANCHOR.hero, hero.x, hero.y);
      },
    });
    items.sort((p, q) => p.y - q.y).forEach((i) => i.draw());

    // курсор
    if (cursor) {
      const x = Math.round(toX(cursor.x));
      const y = Math.round(toY(cursor.y));
      const r = 5 * sprite;
      for (const [col, w] of [['#2a1418', 3 * sprite], ['#fff7c2', sprite]] as const) {
        c.lineWidth = w;
        c.strokeStyle = col;
        c.beginPath();
        c.moveTo(x - r, y);
        c.lineTo(x - 2, y);
        c.moveTo(x + 2, y);
        c.lineTo(x + r, y);
        c.moveTo(x, y - r);
        c.lineTo(x, y - 2);
        c.moveTo(x, y + 2);
        c.lineTo(x, y + r);
        c.stroke();
      }
    }
  };

  const drawCat = (c: CanvasRenderingContext2D, t: number): void => {
    const a = assetsNow();
    const f = frameOf('geo_cat', cat.moving ? ANIMS.cat.walk[Math.floor(t * 8) % 2]! : ANIMS.cat.sit[0]!);
    if (!a || !f) return;
    const x = Math.round(toX(cat.x) - ANCHOR.cat[0] * sprite);
    const y = Math.round(toY(cat.y) - ANCHOR.cat[1] * sprite);
    if (cat.flip) {
      c.save();
      c.translate(x + f.w * sprite, y);
      c.scale(-1, 1);
      c.drawImage(a.atlas, f.x, f.y, f.w, f.h, 0, 0, f.w * sprite, f.h * sprite);
      c.restore();
    } else c.drawImage(a.atlas, f.x, f.y, f.w, f.h, x, y, f.w * sprite, f.h * sprite);
  };

  /** Шаг сцены: бег героя, посадка флажка, кот за героем. */
  const advance = (t: number, dt: number): void => {
    hero.moving = false;
    const j = job;
    if (j?.phase === 'run') {
      const k = Math.min(1, (t - j.t0) / j.dur);
      hero.x = j.from.x + (j.to.x - j.from.x) * k;
      hero.y = j.from.y + (j.to.y - j.from.y) * k;
      const dx = j.to.x - j.from.x;
      const dy = j.to.y - j.from.y;
      hero.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      hero.moving = k < 1;
      if (k >= 1) {
        hero.dir = 'right';
        flags.push({ p: j.p, ok: j.ok, t0: t });
        job = { phase: 'plant', t0: t, p: j.p, ok: j.ok, done: j.done };
      }
    } else if (j?.phase === 'plant' && t - j.t0 >= PLANT_T + WOBBLE_T) {
      job = null;
      hero.dir = 'down';
      lastHero = { x: hero.x, y: hero.y };
      j.done?.();
    }
    // кот: держится рядом с героем, сзади-слева
    const tx = hero.x - (hero.dir === 'right' ? 12 : hero.dir === 'left' ? -12 : 9);
    const ty = hero.y + (hero.dir === 'up' ? 7 : 2);
    const kx = 1 - Math.exp(-6 * dt);
    const px = cat.x;
    const py = cat.y;
    cat.x += (tx - cat.x) * kx;
    cat.y += (ty - cat.y) * kx;
    cat.moving = Math.hypot(cat.x - px, cat.y - py) > 0.15;
    if (Math.abs(cat.x - px) > 0.05) cat.flip = cat.x < px;
  };

  // ——— цикл кадров ———
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const loop = (now: number): void => {
    raf = 0;
    if (destroyed) return;
    if (!canvas.isConnected) return api.destroy();
    // Скрытая карта (игра закрыта, вкладка в фоне) не жжёт процессор.
    if (canvas.getClientRects().length === 0) {
      timer = setTimeout(() => ((timer = null), start()), 400);
      return;
    }
    draw(now);
    raf = requestAnimationFrame(loop);
  };
  const start = (): void => {
    if (destroyed || raf || timer || typeof requestAnimationFrame !== 'function') return;
    raf = requestAnimationFrame(loop);
  };
  void loadAssets().then(() => {
    if (!destroyed) start();
  });

  // ——— ввод ———
  const pickAt = (p: Pt): void => {
    if (locked || !api.onPick) return;
    locked = true;
    cursor = null;
    api.onPick(p);
  };
  const moveCursor = (dx: number, dy: number): void => {
    if (locked) return;
    const c = cursor ?? { x: view.x + cw / view.u / 2, y: view.y + ch / view.u / 2 };
    cursor = { x: Math.max(view.x, Math.min(view.x + cw / view.u, c.x + dx / view.u)), y: Math.max(view.y, Math.min(view.y + ch / view.u, c.y + dy / view.u)) };
  };

  let offBus: (() => void) | null = null;
  if (o.interactive) {
    wrap.addEventListener('click', (e) => {
      const ev = e as MouseEvent;
      if (locked || !api.onPick) return;
      if (ev.detail === 0) {
        // с клавиатуры (A на выделенной карте): первый раз показать курсор, дальше поставить флажок
        if (!cursor) return void (cursor = { x: view.x + cw / view.u / 2, y: view.y + ch / view.u / 2 });
        return pickAt(cursor);
      }
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      pickAt(fromScreen(((ev.clientX - r.left) * cw) / r.width, ((ev.clientY - r.top) * ch) / r.height));
    });
    offBus = bus.on('input:intent', (i) => {
      if (i.to !== 'ui' || !canvas.isConnected || locked || canvas.getClientRects().length === 0) return;
      if (i.type !== 'move' || !i.held) return;
      // Цепочка быстрых нажатий одного направления ускоряет курсор: 8 → 48 px экрана за нажатие.
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      streak = i.dir === lastMoveDir && now - lastMoveAt < 350 ? streak + 1 : 0;
      lastMoveDir = i.dir;
      lastMoveAt = now;
      const step = Math.min(48, 8 + 6 * streak) / (zoomed ? 2 : 1);
      moveCursor(i.dir === 'left' ? -step : i.dir === 'right' ? step : 0, i.dir === 'up' ? -step : i.dir === 'down' ? step : 0);
    });
  }

  const api: MapView = {
    el: wrap,
    get scale() {
      return scale;
    },
    get sprite() {
      return sprite;
    },
    onPick: null,
    get zoomed() {
      return zoomed;
    },
    zoomTo: (c) => setView(c),
    zoomOut: () => setView(null),
    unlock: () => {
      locked = false;
    },
    plant(p, ok, done) {
      locked = true;
      cursor = null;
      const stand = { x: p.x - 8 * (sprite / view.u), y: p.y };
      let from: Pt = { x: hero.x, y: hero.y };
      // Герой за кадром (увеличение): бежит с края.
      if (zoomed && (from.x < view.x || from.x > view.x + cw / view.u || from.y < view.y || from.y > view.y + ch / view.u)) from = { x: view.x, y: stand.y };
      hero.x = from.x;
      hero.y = from.y;
      const L = Math.hypot(stand.x - from.x, stand.y - from.y);
      const dur = reduced ? 0.05 : Math.max(0.3, Math.min(1.1, L / HERO_SPEED));
      const t = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
      job = { phase: 'run', t0: t, dur, from, to: stand, p, ok, done };
      if (!ctx2d || typeof requestAnimationFrame !== 'function') {
        job = null;
        flags.push({ p, ok, t0: 0 });
        queueMicrotask(() => done?.());
        return 0;
      }
      start();
      return Math.round((dur + PLANT_T) * 1000);
    },
    reveal(ids) {
      for (const id of ids) reveals.add(id);
      marks = new Set([...marks].filter((m) => !reveals.has(m)));
      placeLabels();
    },
    moveCursor,
    get cursor() {
      return cursor;
    },
    layout,
    destroy() {
      destroyed = true;
      offBus?.();
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    },
  };
  layout(o.maxW, o.maxH);
  return api;
}

/** Куда герой побежит после ответа на задание не про тап: к якорю единицы. */
export const targetPoint = (u: PolskaUnit): Pt => anchorOf(u);
