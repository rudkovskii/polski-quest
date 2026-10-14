// Карточки дня 1 (P-05, ПОЛИРОВКА §2 р. 3, СЮЖЕТ_v2 §4 d01): всё вступление — сцены на картах с ходьбой
// (src/flow.ts ведёт по битам `d01.*`), карточками остались только:
//   • подпись рассказчика на тёмном экране с табло WARSZAWA WSCHODNIA (`runCaption`);
//   • плитки «Dzień dobry» / «Do widzenia» у лотка пани Хели (`runTiles`): коробка внизу, мир виден; неверно →
//     реакция Хели, правило и перевод, «Jeszcze raz.»; журнал: `intro` слова и `lesson` вступления (день засчитан);
//   • крупный план паспорта (`runPassport`): фото игрока из Fotobudka в рамке, запись «Dla następnego gościa. - K.»,
//     подпись рассказчика, потом печать №1 «BAZAR RÓŻYCKIEGO» с репликой Хели;
//   • ночь (`runNight`): «miau» в темноте, Казик, «Dobranoc», звёзды над Вислой, «Do jutra».
// Без инструкций: реплики только из story/lines.json, заглушки `todo` в игре не показываются (P-01).
import type { Content } from '../systems/content';
import type { Appearance } from '../systems/avatar';
import type { LogEvent } from '../systems/log';
import { D01 } from '../systems/director';
import { speechOfLine } from './dialog';
import { todoVisible } from './todo';
import { el } from './dom';
import { avatarPhotoEl } from './avatar';
import type { LessonStore } from './lesson';
import type { Overlay } from './overlay/host';
import { audioButtons, btn, portrait, type AudioPort, type PortraitSource } from './overlay/kit';

export interface IntroDeps {
  overlay: Overlay;
  content: Pick<Content, 'lines' | 'characters' | 'lessons' | 'vocab'>;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  clock?: { now(): number; mono(): number };
}

export interface TilesDeps extends IntroDeps {
  store: LessonStore;
  random?: () => number;
  onEvent?(e: LogEvent): void;
}

export interface PassportDeps extends IntroDeps {
  /** Внешность из Fotobudka: фото в рамке паспорта (нет — пустая рамка). */
  appearance: Appearance | null;
  /** Печать №1 поставлена (склейка ставит флаг паспорта). */
  onStamp?(): void;
}

export interface NightDeps extends IntroDeps {
  atlas?: Promise<IntroAtlas | null> | IntroAtlas | null;
  /** Сколько держать звёзды, мс (СЮЖЕТ_v2 d01.s8: 2 с; тесты: 0). */
  starsMs?: number;
}

export interface IntroResult {
  /** «Dzień dobry» с первой попытки. */
  firstTry: boolean;
  attempts: number;
}

export const INTRO_LESSON = 'ch01.intro';

// ── Атлас: кадры спрайтов для ночной карточки (Казик и Дима спят).

export interface IntroAtlas {
  img: CanvasImageSource;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
  idle: Record<string, string>;
}

/** Сколько ждать картинку атласа: в скрытой вкладке `decode()` не завершается никогда (P-03), ждём `onload` с потолком. */
export const ATLAS_IMAGE_MS = 3000;

/** Картинка загрузилась (или вышло время): `onload`/`onerror` вместо `img.decode()`, который в фоне висит. */
export function imageReady(img: HTMLImageElement, ms = ATLAS_IMAGE_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve(true);
      return;
    }
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    img.onload = () => done(true);
    img.onerror = () => done(false);
  });
}

export async function loadIntroAtlas(base = import.meta.env.BASE_URL, ms = ATLAS_IMAGE_MS): Promise<IntroAtlas | null> {
  try {
    const [atlas, sprites] = await Promise.all([
      fetch(`${base}atlas/custom.json`).then((r) => r.json() as Promise<{ frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { image: string } }>),
      fetch(`${base}atlas/sprites.json`).then((r) => r.json() as Promise<Record<string, { frames: string[]; anims: Record<string, string[]> }>>),
    ]);
    const img = new Image();
    const ready = imageReady(img, ms); // обработчики до src: кэш может ответить сразу
    img.src = `${base}atlas/${atlas.meta.image}`;
    if (!(await ready)) console.warn('[intro] картинка атласа не готова, фон без спрайтов');
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
type Art = 'train' | 'passport' | 'stamp' | 'dark' | 'night';

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
  const spr = (id: string, x: number, y: number): void => {
    const name = atlas?.idle[id] ?? atlas?.idle[id.split(':')[0]!];
    const f = name ? atlas?.frames[name] : undefined;
    if (!atlas || !f) return;
    try {
      g.drawImage(atlas.img, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
    } catch {
      // картинка атласа не догрузилась (вкладка в фоне): фон без спрайтов
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
    case 'passport':
    case 'stamp': {
      R(0, 0, W, H, '#29366f');
      R(28, 12, 104, 74, '#5a2a1e');
      R(30, 14, 49, 70, '#f0e5d1');
      R(81, 14, 49, 70, '#f0e5d1');
      R(79, 14, 2, 70, '#c8966b');
      // рамка для фото на левой странице
      R(40, 20, 28, 30, '#c8966b');
      R(41, 21, 26, 28, '#e8dcc4');
      for (let y = 56; y < 80; y += 6) R(36, y, 36, 1, '#d8c8a8');
      // старая бледная печать
      g.globalAlpha = 0.18;
      g.strokeStyle = '#3b5dc9';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(110, 64, 12, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      break;
    }
    case 'dark':
      break;
    case 'night': {
      R(0, 0, W, 60, '#1a1c2c');
      for (let i = 0; i < 60; i++) R(Math.floor(hash(i, 3) * W), Math.floor(hash(3, i) * 56), 1, 1, hash(i, 9) > 0.8 ? '#ffcd75' : hash(i, 5) > 0.5 ? '#f4f4f4' : '#566c86');
      R(124, 10, 8, 8, '#f4f4f4');
      R(126, 10, 8, 8, '#1a1c2c'); // месяц
      // Старый город на том берегу: силуэты и пара окон
      let x = 0;
      for (let i = 0; x < W; i++) {
        const bw = 12 + Math.floor(hash(i, 21) * 10);
        const bh = 8 + Math.floor(hash(21, i) * 12);
        R(x, 60 - bh, bw, bh, '#29366f');
        if (hash(i, 4) > 0.5) R(x + 3, 60 - bh + 4, 2, 2, '#ffcd75');
        x += bw;
      }
      R(0, 60, W, 14, '#333c57');
      for (let i = 0; i < 20; i++) R(Math.floor(hash(i, 8) * W), 62 + Math.floor(hash(8, i) * 10), 4, 1, '#566c86');
      R(0, 74, W, 22, '#1e2a24');
      // хатка под берегом: Казик и Дима спят
      R(54, 74, 52, 22, '#3a2a1e');
      R(56, 76, 48, 18, '#5a3a24');
      spr('bobr:idle_down', 62, 78);
      spr('dima:idle_down', 82, 62);
      break;
    }
  }
}

// ── Стиль.

const css = `
.pq-intro-layer { background: #1a1c2c; justify-content: center; }
.pq-intro-layer.pq-tiles-layer { background: transparent; justify-content: flex-end; }
.pq-intro { width: min(100% - 16px, 520px); max-height: 100%; margin: auto; display: flex; flex-direction: column; gap: 10px; padding: 8px 0; box-sizing: border-box; }
.pq-tiles-layer .pq-intro { margin: auto auto calc(16px + env(safe-area-inset-bottom)); }
.pq-intro .art { position: relative; width: 100%; aspect-ratio: 160 / 96; border: 4px solid #91522c; border-radius: 8px; overflow: hidden; background: #1a1c2c; box-sizing: border-box; }
.pq-intro canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; image-rendering: crisp-edges; }
.pq-intro .board { position: absolute; left: 35%; top: 8%; width: 30%; height: 12.5%; display: flex; align-items: center; justify-content: center;
  font: 700 clamp(8px, 2.6vw, 14px)/1 ui-monospace, Menlo, monospace; color: #ffcd75; letter-spacing: .06em; white-space: nowrap; }
.pq-intro .cover { position: absolute; left: 55%; top: 22%; width: 22%; display: flex; flex-direction: column; align-items: center; gap: 2px;
  font: 800 clamp(7px, 2vw, 12px)/1.1 -apple-system, sans-serif; color: #f0e5d1; text-align: center; letter-spacing: .04em; }
.pq-intro .photo { position: absolute; left: 25.6%; top: 21.9%; width: 16.25%; height: 29.2%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.pq-intro .photo canvas { width: 100%; height: auto; image-rendering: pixelated; }
.pq-intro .note { position: absolute; left: 21%; top: 58%; width: 27%; font: italic 600 clamp(7px, 2.1vw, 13px)/1.2 Georgia, serif; color: #5a2a1e; text-align: center; opacity: .75; }
.pq-intro .stamp { position: absolute; left: 56%; top: 34%; width: 26%; aspect-ratio: 1; box-sizing: border-box; border: 4px solid #3b5dc9; border-radius: 50%; color: #3b5dc9;
  display: flex; flex-direction: column; align-items: center; justify-content: center; font: 800 clamp(7px, 1.9vw, 12px)/1.1 -apple-system, sans-serif; text-align: center;
  transform: rotate(-14deg); background: rgba(240,229,209,.85); animation: pq-stamp .45s cubic-bezier(.2,1.8,.4,1) both; }
@keyframes pq-stamp { 0% { transform: rotate(-14deg) scale(2.4); opacity: 0; } 100% { transform: rotate(-14deg) scale(1); opacity: 1; } }
.pq-intro .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #ffcd75; gap: 4px; }
.pq-intro .title b { font: 800 clamp(20px, 7vw, 40px)/1 -apple-system, sans-serif; }
.pq-intro .title small { font-size: clamp(12px, 3.4vw, 18px); color: #f4f4f4; }
.pq-intro .box { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.pq-intro .say { display: flex; gap: 10px; align-items: flex-start; }
.pq-intro .say .txt { display: flex; flex-direction: column; gap: 2px; }
.pq-intro .pl { font-size: 20px; font-weight: 700; }
.pq-intro .plru { font-size: 15px; color: #543c52; }
.pq-intro .rus { font-size: 17px; color: #3a2c38; }
.pq-intro .cap { font-size: 18px; font-style: italic; color: #543c52; text-align: center; }
.pq-intro .cap .txt { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.pq-intro .rule { font-size: 16px; color: #345a52; }
.pq-intro .again { font-size: 18px; font-weight: 700; color: #8f3e56; }
.pq-intro .tiles { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.pq-intro .tiles .pq-btn { font-size: 21px; min-width: 150px; }
.pq-intro .row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
@media (prefers-reduced-motion: reduce) { .pq-intro .stamp { animation: none; } }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-intro-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-intro-style';
  s.textContent = css;
  doc.head.append(s);
}

// ── Общая сборка карточки.

interface Card {
  art: HTMLElement;
  box: HTMLElement;
  setArt(a: Art, extra?: HTMLElement[]): void;
  say(id: string): HTMLElement | null;
  /** Строки + «▼». Ждёт тапа, Enter, пробела или «A». */
  page(lines: (string | HTMLElement | null)[], o?: { art?: Art; extra?: HTMLElement[]; speak?: { text: string; who: string } }): Promise<void>;
  close(): void;
}

function openCard(deps: IntroDeps, cls: string, atlas: IntroAtlas | null, withArt = true): Card {
  ensureStyle(document);
  const { content, audio } = deps;
  const layer = deps.overlay.open(`pq-intro-layer ${cls}`.trim());
  const canvas = el('canvas', { width: String(W), height: String(H), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const art = el('div', { class: 'art', 'data-art': '' }, canvas);
  const box = el('div', { class: 'pq-wood box' });
  layer.el.replaceChildren(el('div', { class: 'pq-intro', 'data-intro': cls || 'card' }, ...(withArt ? [art] : []), box));
  layer.handle({ cancel: () => true }); // карточки не прерываются Esc: закрыть можно вкладку, бит начнётся заново

  const setArt = (a: Art, extra: HTMLElement[] = []): void => {
    paint(canvas, a, atlas);
    art.dataset.art = a;
    art.replaceChildren(canvas, ...extra);
  };

  /** Строка карточки; заглушка `todo` в игре — null (не показывается, P-01). */
  const say = (id: string): HTMLElement | null => {
    const sp = speechOfLine(id, content.lines);
    if (sp.todo && !todoVisible()) return null;
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

  const page: Card['page'] = (lines, o = {}) =>
    new Promise((resolve) => {
      if (o.art) setArt(o.art, o.extra);
      const next = btn('▼', () => resolve(), 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'next', 'aria-label': 'Дальше' });
      const shown = lines.map((x) => (typeof x === 'string' ? say(x) : x)).filter((x): x is HTMLElement => x !== null);
      if (!shown.length && !o.extra?.length && !o.speak) {
        resolve();
        return;
      }
      box.replaceChildren(...shown, el('div', { class: 'row' }, next));
      if (o.speak) audio.play(o.speak.text, { who: o.speak.who });
      queueMicrotask(() => next.focus({ preventScroll: true }));
    });

  return { art, box, setArt, say, page, close: () => layer.close() };
}

// ── Подпись рассказчика: тёмный экран, стук колёс, табло (d01.s1).

export async function runCaption(deps: IntroDeps, lineId: string = D01.card): Promise<void> {
  const card = openCard(deps, '', null);
  try {
    await card.page([lineId], { art: 'train', extra: [el('div', { class: 'board', lang: 'pl' }, 'WARSZAWA WSCHODNIA')] });
  } finally {
    card.close();
  }
}

// ── Плитки у лотка (d01.s4): «Tak?» уже прозвучало в окне диалога.

export async function runTiles(deps: TilesDeps): Promise<IntroResult> {
  const { content, audio } = deps;
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  const lesson = content.lessons.get(INTRO_LESSON)?.value;
  const item = lesson?.introduces?.[0] ?? 'lx.dzien_dobry';
  const phrase = content.vocab.get(item)?.value.pl ?? 'Dzień dobry';
  const step0 = lesson?.steps?.[0];
  const options = step0?.t === 'choice' ? [...step0.options] : [phrase, 'Do widzenia'];
  const answer = step0?.t === 'choice' ? step0.answer : 0;
  const random = deps.random ?? Math.random;
  const card = openCard(deps, 'pq-tiles-layer', null, false);
  const t0 = clock.mono();
  try {
    let attempts = 0;
    let firstTry = false;
    let after: HTMLElement[] = [];
    for (;;) {
      attempts++;
      const ok = await new Promise<boolean>((resolve) => {
        const order = random() < 0.5 ? [0, 1] : [1, 0];
        const tiles = order.map((k) =>
          btn(el('span', { lang: 'pl' }, options[k] ?? ''), () => resolve(k === answer), '', {
            'data-nav': true,
            'data-tile': String(k),
            'data-act': k === answer ? 'right' : 'wrong',
          }),
        );
        card.box.replaceChildren(...after, el('div', { class: 'row' }, ...audioButtons(audio, phrase)), el('div', { class: 'tiles', role: 'group' }, ...tiles));
        queueMicrotask(() => tiles[0]?.focus({ preventScroll: true }));
      });
      if (attempts === 1) firstTry = ok;
      if (ok) break;
      // Ошибка (СЮЖЕТ_v2 d01.s4): Хеля опускает ставню — её реплика, правило, перевод, «Jeszcze raz.».
      after = [card.say(D01.helaErr), card.say(D01.rule), card.say(D01.ruleTr), el('div', { class: 'again', lang: 'pl', 'data-again': '' }, 'Jeszcze raz.')].filter(
        (x): x is HTMLElement => x !== null,
      );
      after[1]?.classList.add('rule');
    }
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
    return { firstTry, attempts };
  } finally {
    card.close();
  }
}

// ── Крупный план паспорта и печать №1 (d01.s4).

export async function runPassport(deps: PassportDeps): Promise<void> {
  const card = openCard(deps, '', null);
  try {
    const photo = el('div', { class: 'photo', 'data-photo': '' }, ...(deps.appearance ? [avatarPhotoEl(deps.appearance, 2)] : []));
    const cover = el('div', { class: 'cover', lang: 'pl' }, 'PASZPORT', el('span', {}, 'GOŚCIA'));
    const k = deps.content.lines.get(D01.passportNote);
    const note = el('div', { class: 'note', lang: 'pl', 'data-note': '' }, k?.pl ?? '');
    await card.page([D01.passportNote, D01.passportNarr], { art: 'passport', extra: [photo, note, cover] });
    deps.onStamp?.();
    const stamp = el('div', { class: 'stamp', 'data-stamp': '1', lang: 'pl' }, 'BAZAR', el('span', {}, 'RÓŻYCKIEGO'));
    const hela = deps.content.lines.get(D01.stamp);
    await card.page([D01.stamp], { art: 'stamp', extra: [photo, note, stamp], ...(hela?.pl ? { speak: { text: hela.pl, who: hela.who } } : {}) });
  } finally {
    card.close();
  }
}

// ── Ночь (d01.s8): темнота, «miau», Казик, «Dobranoc», звёзды над Вислой, «Do jutra».

export async function runNight(deps: NightDeps): Promise<void> {
  const atlas = await Promise.resolve(deps.atlas ?? null);
  const card = openCard(deps, '', atlas);
  try {
    await card.page([D01.miau, D01.notMe], { art: 'dark' });
    card.setArt('night');
    await card.page([D01.dobranoc], { art: 'night' });
    const ms = deps.starsMs ?? 2000;
    if (ms > 0) {
      card.box.replaceChildren();
      await new Promise((r) => setTimeout(r, ms));
    }
    const title = el('div', { class: 'title', 'data-title': 'do-jutra' }, el('b', { lang: 'pl' }, 'Do jutra'), el('small', {}, 'До завтра'));
    await card.page([], { art: 'night', extra: [title] });
  } finally {
    card.close();
  }
}
