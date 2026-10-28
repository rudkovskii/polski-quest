// @vitest-environment happy-dom
// Узнаваемые слова (просьба Шэфа 19.10): разметка польского текста, форма → лемма (словарь plru, база A1, эвристика),
// статус (A1 / Moje słowa / нет), «＋ В словарь» из поповера, долгое нажатие на варианте не отвечает, тап — отвечает; покрытие текстов игры.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachLongPress } from '../src/input/press';
import { BASE_WORDS, isA1 } from '../src/systems/content';
import { isCustomId, type CustomWord } from '../src/systems/customWords';
import { createFarm } from '../src/systems/farm';
import { newGarden, type GardenSave } from '../src/systems/garden';
import { createPlruLoader } from '../src/systems/platform/rupl';
import type { Question } from '../src/systems/quiz';
import { decodeForm, guessLemmas, lookupPl, normPl, parsePlru, statusOf, tokenize, wordIndex, wordsIn, type PlruDb } from '../src/systems/wordPick';
import { mountMinigame } from '../src/ui/minigame';
import { LONG_PRESS_MS, markWords, mountWordPick, plText, WORD_CSS } from '../src/ui/wordPick';
import { coverage, gameTexts, loadPlru } from '../tools/plru_coverage';
import { seeded, testBus } from './helpers';

const REAL: PlruDb = loadPlru()!;
const INDEX = wordIndex(BASE_WORDS, [{ pl: 'Malbork', ru: 'Мальборк', forms: ['w Malborku', 'z Malborka'] }]);
const ctx = (customs: CustomWord[] = []) => ({ db: REAL, index: INDEX, customs: customs.map((c) => ({ id: c.id, pl: c.pl, ru: c.ru, tr: '', pos: c.pos, forms: {}, topic: 'moje', freq: 3, band: 3 as const, order: 0, ff: null, ex: null })) });

/** Мини-словарь в формате plru.json: «grób» без форм (для эвристики), «chryzantema» с формами. */
const SMALL = parsePlru({ v: 1, d: { grób: ['n', 'm', 'могила', ''], chryzantema: ['n', 'f', 'хризантема', '1y 1ie 1ę mi ch'], zginąć: ['v', 'pf', 'погибнуть', ''] } })!;

describe('разметка польского текста на слова', () => {
  it('пунктуация, кавычки, тире, многоточие — не слова; склейка = исходный текст', () => {
    const s = '„Jeszcze Polska nie zginęła,” — kiedy my żyjemy… (hymn)!';
    const t = tokenize(s);
    expect(t.map((x) => x.text).join('')).toBe(s);
    expect(wordsIn(s)).toEqual(['Jeszcze', 'Polska', 'nie', 'zginęła', 'kiedy', 'my', 'żyjemy', 'hymn']);
  });
  it('диакритика и заглавные: ą ć ę ł ń ó ś ź ż Ż Ł', () => {
    expect(wordsIn('Żółć, gęś i Łódź — źdźbło.')).toEqual(['Żółć', 'gęś', 'i', 'Łódź', 'źdźbło']);
  });
  it('дефис внутри слова — одно слово; тире и дефис между цифрами — нет', () => {
    expect(wordsIn('biało-czerwona flaga, 1-go maja, 3-go Maja i 11.11 — Dzień')).toEqual(['biało-czerwona', 'flaga', 'maja', 'Maja', 'i', 'Dzień']);
    expect(wordsIn('śmigus-dyngus')).toEqual(['śmigus-dyngus']);
  });
  it('кириллица и цифры словами не считаются; смешанная строка «pl — ru»', () => {
    expect(wordsIn('pono — говорят · 2026 r.')).toEqual(['pono', 'r']);
  });
  it('нормализация ключа: регистр, кавычки и знаки по краям', () => {
    expect(normPl('„Zginęła,”')).toBe('zginęła');
    expect(normPl('ŻYJEMY!')).toBe('żyjemy');
  });
  it('plText и markWords: каждое слово — span.pq-w, textContent не меняется; русское, 🔊, поля, буквы игры 5 — без разметки', () => {
    const f = document.createElement('div');
    f.append(plText('Na grobach stoją chryzantemy.'));
    expect([...f.querySelectorAll('.pq-w')].map((x) => x.textContent)).toEqual(['Na', 'grobach', 'stoją', 'chryzantemy']);
    expect(f.textContent).toBe('Na grobach stoją chryzantemy.');
    const root = document.createElement('div');
    root.innerHTML =
      '<div data-plw><p>Dzień dobry — здравствуйте</p><p lang="ru">Okno по-русски</p><button class="pq-say">Bóbr</button><input value="kot"><span data-letter>k</span></div><p>Poza blokiem</p>';
    markWords(root);
    expect([...root.querySelectorAll('.pq-w')].map((x) => x.textContent)).toEqual(['Dzień', 'dobry']);
    // повторная разметка ничего не удваивает
    markWords(root);
    expect(root.querySelectorAll('.pq-w .pq-w')).toHaveLength(0);
    expect(root.querySelectorAll('.pq-w')).toHaveLength(2);
  });
});

describe('форма → лемма → перевод', () => {
  it('словарь plru: формы раскладываются из сжатой записи', () => {
    expect(decodeForm('grób', '2obach')).toBe('grobach');
    expect(decodeForm('chryzantema', '1y')).toBe('chryzantemy');
    expect(decodeForm('kot', 'a')).toBe('kota');
  });
  it('«zginęła» → zginąć, «grobach» → grób, «chryzantemy» → chryzantema (настоящий словарь)', () => {
    const z = lookupPl('zginęła', ctx());
    expect(z).toMatchObject({ lemma: 'zginąć', pos: 'verb', guess: false, via: 'dict' });
    expect(z.ru[0]).toBe('погибнуть');
    expect(lookupPl('grobach', ctx())).toMatchObject({ lemma: 'grób', pos: 'noun', gender: 'm', guess: false });
    expect(lookupPl('grobach', ctx()).ru).toContain('могила');
    expect(lookupPl('Chryzantemy', ctx())).toMatchObject({ lemma: 'chryzantema', gender: 'f', ru: ['хризантема'] });
    expect(lookupPl('zginęła', ctx()).tr).toBe('зги́ноньчь');
  });
  it('другая основа (jest ← być, mnie ← ja), заглавная (Polska / polska), «ze» → z, «po polsku»', () => {
    expect(lookupPl('jest', ctx()).lemma).toBe('być');
    expect(lookupPl('mnie', ctx()).lemma).toBe('ja');
    expect(lookupPl('Polska', ctx()).ru).toContain('Польша');
    expect(lookupPl('polska', ctx()).lemma).toBe('polski');
    expect(lookupPl('ze', ctx()).lemma).toBe('z');
    expect(lookupPl('polsku', ctx())).toMatchObject({ lemma: 'po polsku', ru: ['по-польски'] });
  });
  it('нет формы в словаре — эвристика по окончанию, пометка «возможно»', () => {
    expect(guessLemmas('grobach')).toContain('grób');
    const g = lookupPl('grobach', { db: SMALL, index: wordIndex([]), customs: [] });
    expect(g).toMatchObject({ lemma: 'grób', guess: true, ru: ['могила'] });
    expect(lookupPl('zginęła', { db: SMALL, index: wordIndex([]), customs: [] })).toMatchObject({ lemma: 'zginąć', guess: true });
    expect(lookupPl('chryzantemy', { db: SMALL, index: wordIndex([]), customs: [] })).toMatchObject({ lemma: 'chryzantema', guess: false });
    // ничего не нашлось: лемма = слово, перевода нет
    expect(lookupPl('Qwrtx', { db: SMALL, index: wordIndex([]), customs: [] })).toMatchObject({ lemma: 'qwrtx', ru: [], via: 'none' });
  });
  it('без словаря (не загрузился) работают база и названия игр', () => {
    expect(lookupPl('kawę', { db: null, index: INDEX, customs: [] })).toMatchObject({ lemma: 'kawa', via: 'base', ru: ['кофе'] });
    expect(lookupPl('Malborku', { db: null, index: INDEX, customs: [] })).toMatchObject({ lemma: 'Malbork', via: 'name', ru: ['Мальборк'] });
  });
});

describe('статус слова', () => {
  const st = (w: string, customs: CustomWord[] = []) => statusOf(lookupPl(w, ctx(customs)), isA1, isCustomId);
  it('слово базы A1 по форме (kawy → kawa): уже в словаре A1', () => {
    const s = st('kawy');
    expect(s.kind).toBe('base');
    expect(s.kind === 'base' && s.a1 && s.word.id).toBe('w.kawa');
  });
  it('тема «Święta» (opłatkiem → opłatek): в словаре игры, но не A1', () => {
    const s = st('opłatkiem');
    expect(s).toMatchObject({ kind: 'base', a1: false });
    expect(s.kind === 'base' && s.word.id).toBe('sw.oplatek');
  });
  it('своё слово (Moje słowa) и нет в словаре', () => {
    const mine: CustomWord = { id: 'w.custom.x1', pl: 'zginąć', ru: 'погибнуть', pos: 'verb', added: 0 };
    expect(st('zginęła', [mine])).toMatchObject({ kind: 'custom' });
    expect(st('zginęła')).toEqual({ kind: 'none' });
  });
});

describe('поповер слова', () => {
  const T0 = Date.UTC(2026, 9, 19, 9, 0);
  function setup() {
    const bus = testBus();
    const store: { garden: GardenSave; custom: CustomWord[] } = { garden: newGarden(), custom: [] };
    const farm = createFarm({ bus, load: () => store.garden, save: (g) => (store.garden = g), now: () => T0, tz: () => 0, say: () => {}, rand: seeded(5), customs: { load: () => store.custom, save: (c) => (store.custom = c) } });
    const overlay = document.createElement('div');
    document.body.append(overlay);
    const said: string[] = [];
    const pick = mountWordPick(overlay, { api: farm, load: async () => REAL, index: () => INDEX, isA1, isCustom: isCustomId, say: (t) => said.push(t) });
    return { bus, farm, store, overlay, pick, said };
  }
  const span = (overlay: HTMLElement, text: string, attrs = 'lang="pl"'): HTMLElement => {
    const p = document.createElement('div');
    p.innerHTML = `<p ${attrs}>${text}</p>`;
    overlay.append(p);
    markWords(p);
    return p;
  };
  const wordEl = (root: HTMLElement, w: string): HTMLElement => [...root.querySelectorAll<HTMLElement>('.pq-w')].find((x) => x.textContent === w)!;
  afterEach(() => (document.body.innerHTML = ''));

  it('тап по слову в тексте: лемма, транскрипция, перевод, 🔊, «нет» → «＋ В словарь» → карточка → «Только в словарь» — слово в Moje słowa', async () => {
    const { overlay, pick, store, farm, said } = setup();
    const p = span(overlay, 'Jeszcze Polska nie zginęła.');
    wordEl(p, 'zginęła').click();
    await vi.waitFor(() => expect(pick.info?.lemma).toBe('zginąć'));
    const card = overlay.querySelector<HTMLElement>('[data-wordpop]')!;
    expect(card.querySelector('[data-wp-lemma]')!.textContent).toBe('zginąć');
    expect(card.querySelector('[data-wp-surface]')!.textContent).toContain('zginęła');
    expect(card.querySelector('[data-wp-ru]')!.textContent).toContain('погибнуть');
    expect(card.querySelector('[data-wp-meta]')!.textContent).toContain('зги́ноньчь');
    card.querySelector<HTMLElement>('.pq-say')!.click();
    expect(said).toEqual(['zginąć']);
    expect(card.querySelector('[data-wp-status]')!.getAttribute('data-wp-status')).toBe('none');
    card.querySelector<HTMLElement>('[data-wp-add]')!.click();
    expect(card.querySelector<HTMLInputElement>('[data-cw-pl]')!.value).toBe('zginąć');
    expect(card.querySelector<HTMLInputElement>('[data-cw-ru]')!.value).toBe('погибнуть, сгинуть');
    // лемму можно поправить руками
    card.querySelector<HTMLInputElement>('[data-cw-ru]')!.value = 'погибнуть';
    card.querySelector<HTMLElement>('[data-cw-store]')!.click();
    expect(store.custom.map((c) => [c.pl, c.ru, c.pos])).toEqual([['zginąć', 'погибнуть', 'verb']]);
    expect(card.querySelector('[data-wp-done]')).not.toBeNull();
    expect(farm.info(store.custom[0]!.id).status).toBe('new');
    // снова то же слово — уже «в Moje słowa», можно посадить
    pick.close();
    wordEl(p, 'zginęła').click();
    await vi.waitFor(() => expect(overlay.querySelector('[data-wp-status]')?.getAttribute('data-wp-status')).toBe('custom'));
    overlay.querySelector<HTMLElement>('[data-wp-plant]')!.click();
    expect(farm.info(store.custom[0]!.id).status).not.toBe('new');
  });

  it('«Posadź · Посадить» из карточки: слово сохранено и посажено; свои слова не входят в путь к A1', async () => {
    const { overlay, pick, store, farm } = setup();
    const before = farm.stats().path.total;
    const p = span(overlay, 'Co nam obca przemoc wzięła.');
    wordEl(p, 'przemoc').click();
    await vi.waitFor(() => expect(pick.info?.lemma).toBe('przemoc'));
    overlay.querySelector<HTMLElement>('[data-wp-add]')!.click();
    overlay.querySelector<HTMLFormElement>('[data-wordpop] form')!.requestSubmit();
    expect(store.custom.map((c) => c.pl)).toEqual(['przemoc']);
    expect(farm.info(store.custom[0]!.id).status).not.toBe('new');
    expect(farm.stats().path.total).toBe(before);
  });

  it('слово базы A1: «уже в словаре A1» и «Посадить»; после посадки — «растёт · семечко»', async () => {
    const { overlay, pick, farm } = setup();
    const p = span(overlay, 'Piję kawę.');
    wordEl(p, 'kawę').click();
    await vi.waitFor(() => expect(pick.info?.lemma).toBe('kawa'));
    expect(overlay.querySelector('[data-wp-status]')!.textContent).toContain('уже в словаре A1');
    overlay.querySelector<HTMLElement>('[data-wp-plant="w.kawa"]')!.click();
    expect(farm.info('w.kawa').status).toBe('growing');
    expect(overlay.querySelector('[data-wp-stage]')!.textContent).toContain('семечко');
  });

  it('фон закрывает поповер; ✕ — тоже', async () => {
    const { overlay, pick } = setup();
    const p = span(overlay, 'Dom');
    wordEl(p, 'Dom').click();
    await vi.waitFor(() => expect(pick.info).not.toBeNull());
    pick.root.click();
    expect(pick.isOpen).toBe(false);
    wordEl(p, 'Dom').click();
    await vi.waitFor(() => expect(pick.isOpen).toBe(true));
    overlay.querySelector<HTMLElement>('[data-wp-close]')!.click();
    expect(pick.isOpen).toBe(false);
  });

  it('поповер не вылезает за экран (по горизонтали в пределах 8 px, при нехватке места снизу — над словом)', async () => {
    const { overlay, pick } = setup();
    const p = span(overlay, 'Wisła');
    const w = wordEl(p, 'Wisła');
    w.getBoundingClientRect = () => ({ left: 360, right: 372, top: 780, bottom: 800, width: 12, height: 20, x: 360, y: 780, toJSON: () => ({}) }) as DOMRect;
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('innerHeight', 812);
    w.click();
    await vi.waitFor(() => expect(pick.info).not.toBeNull());
    const card = overlay.querySelector<HTMLElement>('[data-wordpop]')!;
    expect(parseFloat(card.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(card.style.left) + Math.min(340, 375 - 16)).toBeLessThanOrEqual(375 - 8 + 0.5);
    expect(parseFloat(card.style.top)).toBeLessThan(780);
    vi.unstubAllGlobals();
    // вёрстка: карточка не шире экрана и не выше его, внутри своя прокрутка (лист игры не прокручивается)
    expect(WORD_CSS).toMatch(/\.wp-card \{ position: fixed;[^}]*width: min\(340px, calc\(100vw - 16px\)\); max-height: calc\(100dvh - 16px\)/);
    expect(WORD_CSS).toMatch(/\.pq-wpop \{ position: fixed; inset: 0/);
  });
});

describe('вариант ответа: долгое нажатие — слово, тап — ответ', () => {
  const Q = { mode: 2, id: 'w.kot', kind: 'choice', prompt: 'кот', promptLang: 'ru', options: ['pies', 'kot', 'dom', 'kawa'], answer: 'kot' } as unknown as Question;
  function setup() {
    const bus = testBus();
    const overlay = document.createElement('div');
    document.body.append(overlay);
    const answers: string[] = [];
    const g = mountMinigame(overlay, { bus, next: () => Q, answer: (_q, given) => (answers.push(given as string), { ok: given === 'kot', correct: 'kot', pl: 'kot', ru: 'кот', tr: 'кот' }), say: () => {} });
    const fakeFarm = { custom: undefined, info: () => ({ status: 'new' }), topics: [], plant: () => ({ planted: 1, bag: 0, skipped: 0 }) } as unknown as Parameters<typeof mountWordPick>[1]['api'];
    const pick = mountWordPick(overlay, { api: fakeFarm, load: async () => REAL, index: () => INDEX, isA1, isCustom: isCustomId, say: () => {} });
    const off = attachLongPress(overlay, { selector: '.pq-w', ms: LONG_PRESS_MS, onLongPress: (w) => void pick.open(w) });
    g.start(2);
    markWords(overlay);
    return { overlay, pick, answers, off, bus, g };
  }
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });
  const optWord = (o: HTMLElement, w: string): HTMLElement => o.querySelector<HTMLElement>(`[data-opt="${w}"] .pq-w`)!;
  const ptr = (t: Element, type: string): void => void t.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: 10, clientY: 10, button: 0 }));

  it('польские варианты размечены; русский вопрос — нет', () => {
    const { overlay } = setup();
    expect([...overlay.querySelectorAll('[data-opt] .pq-w')].map((x) => x.textContent)).toEqual(['pies', 'kot', 'dom', 'kawa']);
    expect(overlay.querySelector('[data-prompt] .pq-w')).toBeNull();
  });

  it('долгое нажатие на варианте открывает слово и не отвечает; перевод скрыт до ответа', async () => {
    vi.useFakeTimers();
    const { overlay, pick, answers } = setup();
    const w = optWord(overlay, 'pies');
    ptr(w, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 20);
    ptr(w, 'pointerup');
    w.click();
    vi.useRealTimers();
    await vi.waitFor(() => expect(pick.info?.lemma).toBe('pies'));
    expect(answers).toEqual([]);
    expect(overlay.querySelector('[data-feedback]')).toBeNull();
    expect(overlay.querySelector('[data-wp-ru]')!.getAttribute('data-wp-ru')).toBe('hidden');
    overlay.querySelector<HTMLElement>('[data-wp-reveal]')!.click();
    expect(overlay.querySelector('[data-wp-ru]')!.textContent).toContain('собака');
  });

  it('правый клик по варианту — тоже слово, не ответ', async () => {
    const { overlay, pick, answers } = setup();
    optWord(overlay, 'dom').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    await vi.waitFor(() => expect(pick.info?.lemma).toBe('dom'));
    expect(answers).toEqual([]);
  });

  it('Esc при открытом поповере закрывает только поповер, игра остаётся; второй Esc закрывает игру', async () => {
    const { overlay, pick, bus, g } = setup();
    optWord(overlay, 'dom').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    await vi.waitFor(() => expect(pick.isOpen).toBe(true));
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(pick.isOpen).toBe(false);
    expect(g.isOpen).toBe(true);
    bus.emit('input:intent', { type: 'hotkey', n: 1, to: 'ui', source: 'keyboard' } as never);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(g.isOpen).toBe(false);
  });

  it('клик мышью точно по слову в варианте — слово в поповере, не ответ; клик по кнопке мимо слова — ответ', async () => {
    const { overlay, pick, answers } = setup();
    const w = optWord(overlay, 'dom');
    w.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    await vi.waitFor(() => expect(pick.info?.lemma).toBe('dom'));
    expect(answers).toEqual([]);
    pick.close();
    w.closest<HTMLElement>('[data-opt]')!.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    expect(answers).toEqual(['dom']);
  });

  it('плитка сборки: клик мышью по слову ставит плитку, словарь не открывается', async () => {
    const { overlay, pick } = setup();
    let placed = 0;
    const tile = Object.assign(document.createElement('button'), { onclick: () => placed++ });
    tile.dataset.opt = 'zginęła';
    tile.dataset.tile = 'zginęła';
    tile.lang = 'pl';
    tile.textContent = 'zginęła';
    overlay.append(tile);
    await vi.waitFor(() => expect(tile.querySelector('.pq-w')).not.toBeNull());
    tile.querySelector('.pq-w')!.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    expect(placed).toBe(1);
    expect(pick.isOpen).toBe(false);
  });

  it('касание пальцем по слову в варианте — ответ', () => {
    const { overlay, pick, answers } = setup();
    optWord(overlay, 'kot').dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    expect(answers).toEqual(['kot']);
    expect(pick.isOpen).toBe(false);
  });

  it('короткий тап по варианту (по слову внутри) — ответ, поповер не открывается', () => {
    vi.useFakeTimers();
    const { overlay, pick, answers } = setup();
    const w = optWord(overlay, 'kot');
    ptr(w, 'pointerdown');
    vi.advanceTimersByTime(120);
    ptr(w, 'pointerup');
    w.click();
    expect(answers).toEqual(['kot']);
    expect(pick.isOpen).toBe(false);
  });
});

describe('словарь plru: файл и покрытие', () => {
  it('файл ≤ 2 МБ, грузится загрузчиком (gzip) по требованию', async () => {
    const buf = readFileSync('public/dict/plru.json.gz');
    expect(buf.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    const fetcher = vi.fn(async () => new Response(buf));
    const load = createPlruLoader({ url: '/dict/plru.json.gz', fetch: fetcher as unknown as typeof fetch });
    const db = await load();
    expect(db!.size).toBeGreaterThan(30_000);
    await load();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(gunzipSync(buf).toString('utf8')).about).toContain('CC BY-SA 4.0');
  });
  it('не в precache service worker', () => {
    expect(readFileSync('tools/lib/pwa.ts', 'utf8')).not.toMatch(/globPatterns:[^\n]*gz/);
  });
  it('покрытие: у ≥ 97 % слов в текстах игры (вопросы, гимн, справки, описания, фразы базы) есть лемма и перевод', () => {
    const texts = gameTexts();
    expect(texts.some((t) => t.includes('Jeszcze Polska nie zginęła'))).toBe(true);
    const c = coverage(BASE_WORDS, REAL, texts);
    expect(c.tokens).toBeGreaterThan(15_000);
    expect(c.lemma).toBeGreaterThan(0.98);
    expect(c.translated).toBeGreaterThan(0.97);
  });
});
