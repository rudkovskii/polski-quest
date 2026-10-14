// Вступление 60 секунд (ТЗ §5.0 F1, СЮЖЕТ §2, I-13): карточки-сцены в оверлее с черновыми пиксельными
// фонами (канвас 2D по клеткам + спрайты Димы, Казика, пани Хели из атласа), как в прототипе.
// Без инструкций: подписи и реплики из story/lines.json, первое упражнение — две плитки
// «Dzień dobry» / «Do widzenia» на «Dzień dobry?» Казика. Верно → «No proszę. Gość mówi!», шлёп хвостом,
// печать №1 в паспорт; неверно → «Do widzenia? Dopiero przyszedłeś.» и снова плитки. Потом «повтори вслух»,
// русская реплика Казика и склейка на działkę. Журнал: `intro` слова и `lesson` вступления (день засчитан).
import type { Content } from '../systems/content';
import type { LogEvent } from '../systems/log';
import { speechOfLine } from './dialog';
import { el } from './dom';
import type { LessonStore } from './lesson';
import type { Overlay } from './overlay/host';
import { audioButtons, btn, portrait, type AudioPort, type PortraitSource } from './overlay/kit';

export interface IntroDeps {
  overlay: Overlay;
  content: Pick<Content, 'lines' | 'characters' | 'lessons' | 'vocab'>;
  store: LessonStore;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  clock?: { now(): number; mono(): number };
  /** Атлас для фонов (тесты: null — без спрайтов). */
  atlas?: Promise<IntroAtlas | null> | IntroAtlas | null;
  random?: () => number;
  /** Печать №1 поставлена (склейка ставит флаг паспорта). */
  onStamp?(): void;
  onEvent?(e: LogEvent): void;
}

export interface IntroResult {
  /** «Dzień dobry» с первой попытки. */
  firstTry: boolean;
  attempts: number;
}

export const INTRO_LESSON = 'ch01.intro';

// ── Атлас: кадры спрайтов для фонов.

export interface IntroAtlas {
  img: CanvasImageSource;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
  idle: Record<string, string>;
}

export async function loadIntroAtlas(base = import.meta.env.BASE_URL): Promise<IntroAtlas | null> {
  try {
    const [atlas, sprites] = await Promise.all([
      fetch(`${base}atlas/custom.json`).then((r) => r.json() as Promise<{ frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { image: string } }>),
      fetch(`${base}atlas/sprites.json`).then((r) => r.json() as Promise<Record<string, { frames: string[]; anims: Record<string, string[]> }>>),
    ]);
    const img = new Image();
    img.src = `${base}atlas/${atlas.meta.image}`;
    await img.decode();
    const frames: IntroAtlas['frames'] = {};
    for (const [k, v] of Object.entries(atlas.frames)) frames[k] = v.frame;
    const idle: Record<string, string> = {};
    for (const [id, s] of Object.entries(sprites)) idle[id] = s.anims.idle_down?.[0] ?? s.frames[0] ?? '';
    for (const [id, s] of Object.entries(sprites)) for (const [a, f] of Object.entries(s.anims)) idle[`${id}:${a}`] = f[0] ?? '';
    return { img, frames, idle };
  } catch (e) {
    console.warn('[intro] атлас не загрузился, фоны без спрайтов', e);
    return null;
  }
}

// ── Фоны (160×96, палитра Ninja Adventure / игры).

const W = 160;
const H = 96;
type Art = 'train' | 'platform' | 'bazar' | 'passport' | 'bobr' | 'stamp' | 'dzialka';

function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function paint(c: HTMLCanvasElement, art: Art, atlas: IntroAtlas | null): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = false;
  const R = (x: number, y: number, w: number, h: number, col: string): void => {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const spr = (id: string, x: number, y: number, k = 1, flip = false): void => {
    const name = atlas?.idle[id] ?? atlas?.idle[id.split(':')[0]!];
    const f = name ? atlas?.frames[name] : undefined;
    if (!atlas || !f) return;
    g.save();
    if (flip) {
      g.translate(x + f.w * k, y);
      g.scale(-1, 1);
      g.drawImage(atlas.img, f.x, f.y, f.w, f.h, 0, 0, f.w * k, f.h * k);
    } else g.drawImage(atlas.img, f.x, f.y, f.w, f.h, x, y, f.w * k, f.h * k);
    g.restore();
  };
  const sky = (cols: string[], h: number): void => cols.forEach((col, i) => R(0, (i * h) / cols.length, W, h / cols.length + 1, col));
  const houses = (y0: number, lit: boolean, seed: number): void => {
    let x = 0;
    for (let i = 0; x < W; i++) {
      const bw = 14 + Math.floor(hash(i, seed) * 10);
      const bh = 18 + Math.floor(hash(seed, i) * 16);
      R(x, y0 - bh, bw, bh, ['#9c4a35', '#b5523b', '#c7834a', '#8c3b2b', '#a8573e'][i % 5]!);
      R(x, y0 - bh - 2, bw, 2, '#5a2a1e');
      for (let wy = y0 - bh + 4; wy < y0 - 4; wy += 6) for (let wx = x + 2; wx < x + bw - 3; wx += 5) R(wx, wy, 2, 3, lit && hash(wx, wy + seed) > 0.45 ? '#ffd27a' : '#3a2a32');
      x += bw;
    }
  };
  R(0, 0, W, H, '#1a1c2c');
  switch (art) {
    case 'train': {
      for (let i = 0; i < 30; i++) R(Math.floor(hash(i, 7) * W), Math.floor(hash(7, i) * 40), 1, 1, hash(i, i) > 0.7 ? '#f4f4f4' : '#566c86');
      R(0, 70, W, 26, '#333c57');
      R(0, 68, W, 2, '#566c86');
      R(6, 40, 148, 26, '#94b0c2');
      R(6, 58, 148, 4, '#b13e53');
      for (let wx = 12; wx < 150; wx += 14) R(wx, 44, 9, 9, hash(wx, 3) > 0.3 ? '#ffcd75' : '#29366f');
      R(2, 44, 4, 20, '#b13e53');
      for (let x = 0; x < W; x += 8) R(x, 66, 5, 2, '#1a1c2c');
      R(56, 8, 48, 12, '#141b1b');
      R(57, 9, 46, 10, '#29366f');
      break;
    }
    case 'platform': {
      sky(['#3b5dc9', '#41a6f6', '#73eff7', '#a7f070'], 40);
      houses(46, false, 5);
      R(0, 46, W, 6, '#566c86');
      R(0, 52, W, 44, '#94b0c2');
      for (let x = 0; x < W; x += 8) R(x, 52, 4, 1, '#f4f4f4');
      R(0, 20, 34, 30, '#f4f4f4');
      R(0, 40, 34, 4, '#b13e53');
      spr('dima:idle_right', 40, 50, 1);
      R(62, 70, 14, 10, '#5d275d'); // чемодан
      R(66, 67, 6, 3, '#333c57');
      spr('bobr:idle_left', 78, 66, 1);
      break;
    }
    case 'bazar': {
      sky(['#41a6f6', '#73eff7'], 36);
      houses(40, false, 9);
      R(0, 40, W, 56, '#c7834a');
      for (let i = 0; i < 3; i++) {
        const x = 8 + i * 52;
        for (let s = 0; s < 6; s++) R(x + s * 7, 34, 7, 8, s % 2 ? '#f4f4f4' : '#b13e53');
        R(x, 42, 42, 4, '#5a2a1e');
        R(x + 2, 46, 38, 20, '#a8573e');
        R(x + 4, 48, 8, 6, '#ffcd75');
        R(x + 16, 49, 10, 5, '#38b764');
      }
      spr('extra_k', 70, 50, 1);
      R(92, 68, 20, 14, '#8c3b2b'); // ящик
      R(88, 74, 5, 3, '#4f3324'); // лапа
      R(80, 82, 8, 6, '#b13e53'); // книжечка
      R(81, 83, 6, 1, '#ffcd75');
      spr('dima', 40, 56, 1);
      break;
    }
    case 'passport': {
      R(0, 0, W, H, '#29366f');
      R(28, 12, 104, 74, '#5a2a1e');
      R(30, 14, 49, 70, '#f0e5d1');
      R(81, 14, 49, 70, '#f0e5d1');
      R(79, 14, 2, 70, '#c8966b');
      g.globalAlpha = 0.25;
      g.strokeStyle = '#3b5dc9';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(105, 58, 14, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      for (let y = 26; y < 76; y += 6) R(36, y, 36, 1, '#d8c8a8');
      break;
    }
    case 'bobr':
    case 'stamp': {
      R(0, 0, W, H, '#c7834a');
      houses(40, false, 13);
      R(0, 40, W, 56, '#94b0c2');
      spr('dima:idle_right', 44, 46, 1);
      spr('bobr:idle_left', 82, 54, 2);
      if (art === 'stamp') {
        R(66, 66, 26, 20, '#f0e5d1');
        g.strokeStyle = '#3b5dc9';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(79, 76, 8, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    }
    case 'dzialka': {
      sky(['#73eff7', '#a7f070'], 34);
      houses(34, false, 11);
      R(0, 34, W, 62, '#38b764');
      for (let i = 0; i < 50; i++) R(Math.floor(hash(i, 3) * W), 36 + Math.floor(hash(3, i) * 58), 2, 1, '#257179');
      for (let x = 0; x < W; x += 6) R(x, 30, 1, 8, '#c8966b');
      R(0, 32, W, 1, '#c8966b');
      R(50, 62, 30, 14, '#5a2a1e');
      spr('plant_sprout', 57, 58, 1);
      spr('tile.altana', 118, 40, 2);
      spr('bobr:idle_left', 90, 64, 1);
      spr('dima:idle_right', 26, 50, 1);
      break;
    }
  }
}

// ── Стиль.

const css = `
.pq-intro-layer { background: #1a1c2c; justify-content: center; }
.pq-intro { width: min(100% - 16px, 520px); max-height: 100%; margin: auto; display: flex; flex-direction: column; gap: 10px; padding: 8px 0; box-sizing: border-box; }
.pq-intro .art { position: relative; width: 100%; aspect-ratio: 160 / 96; border: 4px solid #91522c; border-radius: 8px; overflow: hidden; background: #1a1c2c; box-sizing: border-box; }
.pq-intro canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }
.pq-intro .board { position: absolute; left: 35%; top: 8%; width: 30%; height: 12.5%; display: flex; align-items: center; justify-content: center;
  font: 700 clamp(8px, 2.6vw, 14px)/1 ui-monospace, Menlo, monospace; color: #ffcd75; letter-spacing: .06em; white-space: nowrap; }
.pq-intro .stamp { position: absolute; left: 55%; top: 36%; width: 20%; aspect-ratio: 1; box-sizing: border-box; border: 4px solid #3b5dc9; border-radius: 50%; color: #3b5dc9;
  display: flex; flex-direction: column; align-items: center; justify-content: center; font: 800 clamp(8px, 2.2vw, 14px)/1.15 -apple-system, sans-serif; text-align: center;
  transform: rotate(-12deg); background: rgba(240,229,209,.85); animation: pq-stamp .45s cubic-bezier(.2,1.8,.4,1) both; }
@keyframes pq-stamp { 0% { transform: rotate(-12deg) scale(2.4); opacity: 0; } 100% { transform: rotate(-12deg) scale(1); opacity: 1; } }
.pq-intro .box { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.pq-intro .say { display: flex; gap: 10px; align-items: flex-start; }
.pq-intro .say .txt { display: flex; flex-direction: column; gap: 2px; }
.pq-intro .pl { font-size: 20px; font-weight: 700; }
.pq-intro .plru { font-size: 15px; color: #543c52; }
.pq-intro .rus { font-size: 17px; color: #3a2c38; }
.pq-intro .cap { font-size: 18px; font-style: italic; color: #543c52; text-align: center; }
.pq-intro .cap .txt { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.pq-intro .note { font-size: 17px; text-align: center; color: #543c52; }
.pq-intro .tiles { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.pq-intro .tiles .pq-btn { font-size: 21px; min-width: 150px; }
.pq-intro .row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.pq-intro .big { font-size: 28px; font-weight: 800; text-align: center; }
@media (prefers-reduced-motion: reduce) { .pq-intro .stamp { animation: none; } }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-intro-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-intro-style';
  s.textContent = css;
  doc.head.append(s);
}

// ── Вступление.

export async function runIntro(deps: IntroDeps): Promise<IntroResult> {
  ensureStyle(document);
  const { content, audio } = deps;
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  const atlas = await Promise.resolve(deps.atlas ?? null);
  const layer = deps.overlay.open('pq-intro-layer');
  const lesson = content.lessons.get(INTRO_LESSON)?.value;
  const item = lesson?.introduces?.[0] ?? 'lx.dzien_dobry';
  const phrase = content.vocab.get(item)?.value.pl ?? 'Dzień dobry';
  const step0 = lesson?.steps?.[0];
  const options = step0?.t === 'choice' ? [...step0.options] : [phrase, 'Do widzenia'];
  const answer = step0?.t === 'choice' ? step0.answer : 0;
  const shadow = lesson?.steps?.find((s) => s.t === 'shadow');
  const shadowPl = shadow?.t === 'shadow' ? shadow.pl : `${phrase}!`;
  const shadowRu = shadow?.t === 'shadow' ? shadow.ru : undefined;
  const random = deps.random ?? Math.random;

  const canvas = el('canvas', { width: String(W), height: String(H), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const art = el('div', { class: 'art', 'data-art': '' }, canvas);
  const box = el('div', { class: 'pq-wood box' });
  layer.el.replaceChildren(el('div', { class: 'pq-intro', 'data-intro': '' }, art, box));

  const setArt = (a: Art, extra: HTMLElement[] = []): void => {
    paint(canvas, a, atlas);
    art.dataset.art = a;
    art.replaceChildren(canvas, ...extra);
  };

  const sayNode = (id: string): HTMLElement => {
    const sp = speechOfLine(id, content.lines);
    // Подписи рассказчика и звуки за кадром («miau») — без портрета.
    const offscreen = sp.who === 'narrator' || sp.who === 'simba';
    if (offscreen && !sp.pl) return el('div', { class: 'cap', 'data-line': id }, sp.rus ?? '');
    const txt = el('div', { class: 'txt' });
    if (sp.todo) txt.append(el('span', { class: 'plru' }, `[todo: ${sp.todo}]`));
    if (sp.pl) txt.append(el('span', { class: 'pl', lang: 'pl' }, sp.pl));
    if (sp.ru) txt.append(el('span', { class: 'plru' }, sp.ru));
    if (sp.rus) txt.append(el('span', { class: 'rus' }, sp.rus));
    if (offscreen) return el('div', { class: 'cap', 'data-line': id }, txt);
    const name = content.characters.get(sp.who)?.name ?? sp.who;
    return el('div', { class: 'say', 'data-line': id }, portrait({ id: sp.who, name }, deps.portraits ?? null, 48), txt);
  };

  /** Карточка: строки + «▼». Ждёт тапа, Enter, пробела или «A». */
  const card = (a: Art, lines: string[], o: { extra?: HTMLElement[]; speak?: { text: string; who: string } } = {}): Promise<void> =>
    new Promise((resolve) => {
      setArt(a, o.extra);
      const next = btn('▼', () => {
        layer.handle(null);
        resolve();
      }, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'next', 'aria-label': 'Дальше' });
      box.replaceChildren(...lines.map(sayNode), el('div', { class: 'row' }, next));
      layer.handle({ cancel: () => true }); // вступление не прерывается Esc: закрыть можно вкладку, F1 начнётся заново
      if (o.speak) audio.play(o.speak.text, { who: o.speak.who });
      queueMicrotask(() => next.focus({ preventScroll: true }));
    });

  const t0 = clock.mono();
  try {
    const board = el('div', { class: 'board', lang: 'pl' }, 'WARSZAWA WSCHODNIA');
    await card('train', ['intro.caption.oct'], { extra: [board] });
    await card('platform', ['intro.kazik.kloda', 'intro.caption.bobr']);
    const hela = content.lines.get('intro.hela.za_darmo');
    await card('bazar', ['intro.hela.za_darmo'], hela?.pl ? { speak: { text: hela.pl, who: hela.who } } : {});
    await card('passport', ['intro.passport.k', 'intro.caption.empty']);

    // ── Первое упражнение: «Dzień dobry?» → две плитки.
    let attempts = 0;
    let firstTry = false;
    for (;;) {
      attempts++;
      const ok = await new Promise<boolean>((resolve) => {
        setArt('bobr');
        const order = random() < 0.5 ? [0, 1] : [1, 0];
        const tiles = order.map((k) =>
          btn(el('span', { lang: 'pl' }, options[k] ?? ''), () => {
            layer.handle(null);
            resolve(k === answer);
          }, '', { 'data-nav': true, 'data-tile': String(k), 'data-act': k === answer ? 'right' : 'wrong' }),
        );
        box.replaceChildren(
          sayNode('intro.kazik.dzien_dobry'),
          el('div', { class: 'row' }, ...audioButtons(audio, phrase)),
          el('div', { class: 'tiles', role: 'group' }, ...tiles),
        );
        layer.handle({ cancel: () => true });
        audio.play(phrase);
        queueMicrotask(() => tiles[0]?.focus({ preventScroll: true }));
      });
      if (attempts === 1) firstTry = ok;
      if (ok) break;
      await card('bobr', ['intro.kazik.dopiero']);
    }

    // ── Печать №1 и журнал.
    const ts = clock.now();
    const already = deps.store.progress.log.events.some((e) => e.k === 'lesson' && e.lesson === INTRO_LESSON);
    if (!already) {
      const write = (draft: Parameters<LessonStore['append']>[0]): void => {
        const r = deps.store.append(draft);
        if (r.ok) deps.onEvent?.(r.event);
      };
      if (!deps.store.progress.log.events.some((e) => e.k === 'intro' && e.item === item))
        write({ k: 'intro', ts, item, lesson: INTRO_LESSON, ok: firstTry ? ['rec'] : [] });
      write({ k: 'lesson', ts, lesson: INTRO_LESSON, score: firstTry ? 1 : 0.5, firstTry: firstTry ? 1 : 0, ms: Math.round(clock.mono() - t0), passed: true, answers: 1 });
    }
    deps.onStamp?.();
    const stamp = el('div', { class: 'stamp', 'data-stamp': '1', lang: 'pl' }, 'Warszawa', el('span', {}, 'Praga'));
    await card('passport', ['intro.kazik.gosc_mowi'], { extra: [stamp] });

    // ── Повтори вслух (shadow): без проверки.
    await new Promise<void>((resolve) => {
      setArt('bobr');
      const next = btn('▼', () => {
        layer.handle(null);
        resolve();
      }, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'next', 'aria-label': 'Дальше' });
      box.replaceChildren(
        sayNode('kazik.shadow.first'),
        el('div', { class: 'big', lang: 'pl' }, shadowPl),
        shadowRu ? el('div', { class: 'note' }, shadowRu) : el('span'),
        el('div', { class: 'row' }, ...audioButtons(audio, shadowPl), el('span', { style: 'flex:1' }), next),
      );
      layer.handle({ cancel: () => true });
      audio.play(shadowPl);
      queueMicrotask(() => next.focus({ preventScroll: true }));
    });

    await card('bobr', ['intro.kazik.po_rusku']);
    await card('dzialka', ['intro.simba.miau', 'intro.caption.pokazalo']);
    return { firstTry, attempts };
  } finally {
    layer.close();
  }
}
