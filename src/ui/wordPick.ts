// «Узнаваемые слова» (просьба Шэфа 19.10: «любое польское слово можно добавить в словарь отовсюду»): экран.
// Польский текст в игре размечен на слова (`<span class="pq-w">`): тап по слову в тексте (вопрос, справка, отзыв, описание) —
// поповер; на кнопках и плитках, где тап = ответ, — долгое нажатие ~450 мс или правый клик (долгое нажатие вешает main.ts через
// `input/press.ts`: pointerdown только в src/input). Подчёркивание пунктиром — только при наведении мышью.
// Разметка: `plText(text)` (явно) и `markWords(root)` — всё внутри `[lang="pl"]` и `[data-plw]` (смешанные строки «pl — ru»:
// размечаются только латинские слова). `mountWordPick` следит за оверлеем (MutationObserver) и размечает новый текст сам.
// Поповер: слово → лемма, часть речи и род, транскрипция, 1–3 перевода, 🔊; статус — база A1 («Посадить» / «растёт · стадия»),
// Moje słowa, нет → «＋ В словарь» (карточка своего слова, как во вкладке «＋ Своё», `customForm`).
import { GENDER_RU, POS_RU } from '../systems/customWords';
import { lookupPl, statusOf, tokenize, type LookupCtx, type PickStatus, type PlruDb, type WordIndex, type WordInfo } from '../systems/wordPick';
import type { CustomApi, FarmApi } from '../types/farm';
import { CUSTOM_CSS, customForm } from './customWord';
import { el } from './dom';
import { STAGE_INFO } from './glossary';
import { SAY_CSS, sayButton, type SayFn } from './sayButton';

/** Где размечать: польский текст и смешанные строки. Ближайший `lang` решает («ru» внутри польского блока — нет). */
export const PL_SCOPE = '[lang="pl"], [data-plw]';
/** Где не размечать: поля ввода, 🔊, буквы-плитки игры 5, экранная клавиатура, ноты караоке гимна (A, C, D), SVG, сам поповер. */
export const NO_PICK = 'input, textarea, select, option, script, style, svg, .pq-say, [data-letter], [data-nopick], .pq-kb, [class^="pq-kb"], .hy-n, .pq-wpop, [contenteditable="true"]';
/** Элементы, где тап — действие (ответ, выбор, навигация): там слово открывается только долгим нажатием или правым кликом. */
export const INTERACTIVE = 'button, a[href], label, summary, [role="button"], [data-opt], [data-nav], [data-tile]';
/** Части задания, где перевод подсказал бы ответ: пока лист `[data-quiz="open"]`, перевод скрыт за кнопкой. */
export const QUIZ_PARTS = '[data-prompt], .pq-q, [data-opt], [data-opts], [data-tile], .pq-pool, .pq-built';
/** Долгое нажатие на слово (мс). */
export const LONG_PRESS_MS = 450;

export const WORD_CSS = `
.pq-w { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; border-radius: 2px; }
@media (hover: hover) and (pointer: fine) {
  .pq-w:hover { text-decoration: underline dotted; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  :not(button, [data-opt], [data-nav], [data-tile]) > .pq-w:hover { cursor: help; }
}
.pq-w.on { background: rgba(242, 213, 82, .55); }
/* Подписи над миром и на карте Geografia «прозрачны» для тапа, а слова в них — нет (на карте тап по слову всё равно ставит флажок: он в кнопке карты). */
.pq-label .pq-w, .geo-label .pq-w { pointer-events: auto; }
.pq-wpop { position: fixed; inset: 0; z-index: 95; }
.pq-wpop[hidden] { display: none; }
.wp-card { position: fixed; box-sizing: border-box; width: min(340px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); overflow-y: auto; overscroll-behavior: contain;
  background: var(--pq-cream, #fff6e0); color: var(--pq-ink, #2a1418); border: 2px solid var(--pq-ink, #2a1418); border-radius: 8px; box-shadow: 0 4px 0 rgba(42, 20, 24, .35);
  padding: 10px 12px 12px; font: 15px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; gap: 6px; }
.wp-card.form { width: min(380px, calc(100vw - 16px)); }
.wp-x { position: absolute; top: 6px; right: 6px; width: 32px; height: 32px; padding: 0; font: 700 16px/1 inherit; color: var(--pq-ink, #2a1418); background: transparent; border: 0; cursor: pointer; }
.wp-from { font-size: 13px; opacity: .7; padding-right: 30px; overflow-wrap: anywhere; }
.wp-head { display: flex; align-items: center; gap: 8px; padding-right: 30px; min-width: 0; }
.wp-lemma { font-size: 22px; font-weight: 800; overflow-wrap: anywhere; min-width: 0; }
.wp-meta { font-size: 13px; opacity: .8; }
.wp-maybe { display: inline-block; font-size: 12px; font-weight: 700; padding: 0 5px; border-radius: 4px; background: #ffe9c2; border: 1px dashed var(--pq-accent, #c86a1c); }
.wp-ru { font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
.wp-ru.none { font-weight: 400; font-size: 14px; opacity: .75; }
.wp-st { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 14px; border-top: 1px dashed rgba(42, 20, 24, .3); padding-top: 7px; margin-top: 2px; }
.wp-st .ok { font-weight: 700; }
.wp-st .pq-btn { min-height: 38px; }
.wp-load { font-size: 14px; opacity: .7; }
.wp-credit { font-size: 11px; opacity: .55; }
.wp-credit a { color: inherit; }
.wp-card .cw-form { padding: 0; gap: 6px; border: 0; background: transparent; }
.wp-card .cw-form > .cw-lead { padding-right: 30px; }
.wp-card .cw-form input { height: 38px; }
@media (max-height: 560px) { .wp-card .cw-form .opt { display: none; } }
`;

// ───────────── разметка ─────────────

/** Польский текст → фрагмент, где каждое слово — `<span class="pq-w">`. Склейка `textContent` = исходный текст. */
export function plText(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const t of tokenize(text)) f.append(t.word ? el('span', { class: 'pq-w' }, t.text) : t.text);
  return f;
}

/** Текст внутри польского блока: ближайший `lang` — «pl» (или `data-plw` без своего `lang`), и не в исключениях. */
function pickable(parent: Element): boolean {
  if (parent.closest(NO_PICK) || parent.closest('.pq-w')) return false;
  const scope = parent.closest('[lang], [data-plw]');
  if (!scope) return false;
  const lang = scope.getAttribute('lang');
  return lang === null ? scope.hasAttribute('data-plw') : lang === 'pl';
}

const HAS_WORD = /\p{Script=Latin}/u;

function wrapText(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent || !HAS_WORD.test(node.data) || !(parent instanceof HTMLElement) || !pickable(parent)) return false;
  const toks = tokenize(node.data);
  if (!toks.some((t) => t.word)) return false;
  node.replaceWith(plText(node.data));
  return true;
}

/** Разметить слова во всём польском тексте под `root` (сам `root` тоже). Уже размеченное не трогается. Сколько текстов обёрнуто. */
export function markWords(root: Node): number {
  if (root.nodeType === Node.TEXT_NODE) return wrapText(root as Text) ? 1 : 0;
  if (!(root instanceof Element)) return 0;
  const doc = root.ownerDocument ?? document;
  const texts: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  let k = 0;
  for (const t of texts) if (wrapText(t)) k++;
  return k;
}

// ───────────── поповер ─────────────

export interface WordPickDeps {
  api: FarmApi;
  /** Словарь plru (platform/rupl, по требованию). Нет — только слова игры и эвристика. */
  load?: () => Promise<PlruDb | null>;
  /** Индекс слов игры (база A1, «Święta», названия v2) — строится один раз при первом поиске. */
  index: () => WordIndex;
  /** Слово базы входит в путь к A1 (а не только в тему праздников). */
  isA1(id: string): boolean;
  isCustom(id: string): boolean;
  /** Озвучка польского (под выключателем звука; `?mute=1` — только консоль). */
  say: SayFn;
}

export interface WordPick {
  readonly root: HTMLElement;
  readonly isOpen: boolean;
  /** Открыть поповер для слова (span `.pq-w`). */
  open(span: HTMLElement): Promise<void>;
  close(): void;
  /** Последний разбор (для проверок). */
  readonly info: WordInfo | null;
}

const metaLine = (i: WordInfo): string => {
  const bits = [i.tr];
  if (i.pos) bits.push(POS_RU[i.pos]);
  if (i.gender) bits.push(GENDER_RU[i.gender]);
  if (i.aspect) bits.push(i.aspect === 'pf' ? 'сов.' : 'несов.');
  return bits.filter(Boolean).join(' · ');
};

let active: WordPick | null = null;

/** Поповер слова открыт поверх экрана: экраны (панели, мини-игры, настройки) не реагируют на клавиши, а Esc закрывает только поповер. */
export function wordPopGuard(i: { type: string }): boolean {
  if (!active?.isOpen) return false;
  if (i.type === 'cancel') active.close();
  return true;
}

/** Поповер слова + разметка оверлея + тап по слову в тексте и правый клик. */
export function mountWordPick(overlay: HTMLElement, deps: WordPickDeps): WordPick {
  const card = el('div', { class: 'wp-card', role: 'dialog', 'aria-label': 'Слово', 'data-wordpop': '' });
  const root = el('div', { class: 'pq-wpop', hidden: true }, el('style', {}, WORD_CSS + SAY_CSS + CUSTOM_CSS), card);
  overlay.append(root);
  let isOpen = false;
  let cur: HTMLElement | null = null;
  let info: WordInfo | null = null;
  let token = 0;
  let openedAt = -Infinity;

  root.addEventListener('click', (e) => {
    if (e.target === root) api.close();
  });

  const place = (): void => {
    if (!cur || !isOpen) return;
    const r = cur.getBoundingClientRect();
    const vw = window.innerWidth || 375;
    const vh = window.innerHeight || 667;
    const w = card.offsetWidth || Math.min(340, vw - 16);
    const h = card.offsetHeight || 200;
    const left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
    // Под словом, если помещается; иначе над ним; иначе по центру.
    let top = r.bottom + 8;
    if (top + h > vh - 8) top = r.top - h - 8;
    if (top < 8) top = Math.max(8, (vh - h) / 2);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  };

  const ctx = async (): Promise<LookupCtx> => ({
    db: deps.load ? await deps.load() : null,
    index: deps.index(),
    customs: deps.api.custom?.list() ?? [],
  });

  const closeBtn = (): HTMLElement => el('button', { type: 'button', class: 'wp-x', 'aria-label': 'Закрыть', 'data-wp-close': '', onclick: () => api.close() }, '✕');

  function statusRow(i: WordInfo): HTMLElement {
    const st: PickStatus = statusOf(i, deps.isA1, deps.isCustom);
    const row = el('div', { class: 'wp-st', 'data-wp-status': st.kind });
    if (st.kind === 'none') {
      const cu = deps.api.custom;
      row.append(el('span', {}, 'Нет в твоём словаре.'));
      if (cu) row.append(el('button', { type: 'button', class: 'pq-btn small', 'data-wp-add': '', onclick: () => showForm(i, cu) }, '＋ В словарь'));
      return row;
    }
    const w = st.word;
    const where = st.kind === 'custom' ? 'в Moje słowa' : st.a1 ? 'уже в словаре A1' : `уже в словаре (${deps.api.topics.find((t) => t.id === w.topic)?.pl ?? 'тема игры'})`;
    row.append(el('span', { class: 'ok' }, `✓ ${where}`));
    const it = deps.api.info(w.id);
    if (it.status === 'new') {
      row.append(
        el(
          'button',
          {
            type: 'button',
            class: 'pq-btn small',
            'data-wp-plant': w.id,
            onclick: () => {
              const r = deps.api.plant([w.id]);
              row.replaceWith(statusRow(i));
              if (r.bag > 0) card.querySelector('[data-wp-status]')?.append(el('span', {}, 'грядки заняты: ждёт в мешке'));
              place();
            },
          },
          'Посадить',
        ),
      );
    } else if (it.status === 'grown') row.append(el('span', { 'data-wp-stage': 'grown' }, '· в банке'));
    else if (it.status === 'bag') row.append(el('span', { 'data-wp-stage': 'bag' }, '· в мешке, ждёт грядку'));
    else row.append(el('span', { 'data-wp-stage': it.stage ?? '' }, `· растёт · ${it.stage ? STAGE_INFO[it.stage].ru : ''}`));
    return row;
  }

  /** Слово из вопроса или варианта до ответа: перевод под кнопкой «Показать перевод». */
  let hideRu = false;

  function ruRow(i: WordInfo): HTMLElement {
    if (!i.ru.length) return el('div', { class: 'wp-ru none', 'data-wp-ru': '' }, 'Перевода в словаре нет — можно вписать свой.');
    if (!hideRu) return el('div', { class: 'wp-ru', 'data-wp-ru': '' }, i.ru.join('; '));
    const row = el(
      'div',
      { class: 'wp-ru none', 'data-wp-ru': 'hidden' },
      'Перевод — после ответа, чтобы не подсказывать. ',
      el('button', { type: 'button', class: 'pq-btn small', 'data-wp-reveal': '', onclick: () => ((hideRu = false), row.replaceWith(ruRow(i)), place()) }, 'Показать'),
    );
    return row;
  }

  function showInfo(i: WordInfo): void {
    const same = i.surface.trim().toLowerCase() === i.lemma.toLowerCase();
    card.classList.remove('form');
    card.replaceChildren(
      ...(same ? [closeBtn()] : [closeBtn(), el('div', { class: 'wp-from', 'data-wp-surface': '' }, `«${i.surface}» — форма слова`)]),
      el('div', { class: 'wp-head' }, el('span', { class: 'wp-lemma', lang: 'pl', 'data-nopick': '', 'data-wp-lemma': '' }, i.lemma), sayButton(i.lemma, deps.say)),
      el('div', { class: 'wp-meta', 'data-wp-meta': '' }, i.guess ? el('span', { class: 'wp-maybe', title: 'Начальная форма угадана по окончанию' }, 'возможно') : null, i.guess ? ' ' : null, metaLine(i)),
      ruRow(i),
      statusRow(i),
      // Лицензия словаря (CC BY-SA 4.0) требует указать источник там, где он используется.
      i.via === 'dict' ? el('div', { class: 'wp-credit', 'data-wp-credit': '' }, 'Словарь: Викисловарь, ', el('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/deed.ru', target: '_blank', rel: 'noopener noreferrer' }, 'CC BY-SA 4.0')) : '',
    );
    place();
  }

  function showForm(i: WordInfo, cu: CustomApi): void {
    // `cu` — это `deps.api.custom` (кнопка «＋ В словарь» есть только при нём).
    const api = deps.api as FarmApi & { custom: CustomApi };
    if (api.custom !== cu) return;
    card.classList.add('form');
    const hint = i.guess
      ? `«${i.surface}»: начальная форма угадана — проверь.`
      : i.surface.trim().toLowerCase() !== i.lemma.toLowerCase()
        ? `«${i.surface}» — форма слова «${i.lemma}». Поправь, если нужна другая.`
        : undefined;
    const f = customForm({
      api,
      init: { pl: i.lemma, ru: i.ru.slice(0, 2).join(', '), ...(i.pos ? { pos: i.pos } : {}), ...(i.gender ? { gender: i.gender } : {}) },
      ...(hint ? { hint } : {}),
      onDone: (r) => {
        const line =
          r.planted === null
            ? r.existed
              ? 'Это слово у тебя уже есть.'
              : 'Сохранено в «Moje słowa».'
            : r.planted.planted > 0
              ? 'Посажено на грядку.'
              : r.planted.bag > 0
                ? 'Посажено, грядки заняты: ждёт в мешке.'
                : 'Оно уже растёт.';
        card.classList.remove('form');
        card.replaceChildren(closeBtn(), el('div', { class: 'cw-msg ok', role: 'status', 'data-wp-done': r.id }, el('strong', {}, `✓ ${r.pl}`), ` — ${r.ru}. ${line}`));
        place();
      },
      onCancel: () => showInfo(i),
    });
    card.replaceChildren(closeBtn(), f);
    place();
    // С клавиатурой — сразу в перевод (польское подставлено); на касании — без фокуса, чтобы не выскочила системная клавиатура.
    if (!coarse()) f.querySelector<HTMLInputElement>('[data-cw-ru]')?.focus({ preventScroll: true });
  }

  const coarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  const api: WordPick = {
    root,
    get isOpen() {
      return isOpen;
    },
    get info() {
      return info;
    },
    async open(span) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      // Долгое нажатие и следом contextmenu/click на том же слове — одно открытие.
      if (isOpen && cur === span && now - openedAt < 800) return;
      openedAt = now;
      cur?.classList.remove('on');
      cur = span;
      span.classList.add('on');
      isOpen = true;
      root.hidden = false;
      const seq = ++token;
      const surface = span.textContent ?? '';
      hideRu = !!span.closest('[data-quiz="open"]') && !!span.closest(QUIZ_PARTS);
      card.classList.remove('form');
      card.replaceChildren(closeBtn(), el('div', { class: 'wp-head' }, el('span', { class: 'wp-lemma', lang: 'pl', 'data-nopick': '' }, surface)), el('div', { class: 'wp-load' }, 'Ищу в словаре…'));
      place();
      const c = await ctx();
      if (seq !== token || !isOpen) return;
      info = lookupPl(surface, c);
      showInfo(info);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      token++;
      root.hidden = true;
      cur?.classList.remove('on');
      cur = null;
      card.replaceChildren();
    },
  };

  // Тап по слову в тексте (не в кнопке): поповер; в кнопке тап остаётся ответом. Фаза захвата — раньше обработчиков экранов.
  overlay.addEventListener(
    'click',
    (e) => {
      const w = e.target instanceof Element ? e.target.closest<HTMLElement>('.pq-w') : null;
      if (!w || root.contains(w) || w.closest(INTERACTIVE)) return;
      e.stopPropagation();
      e.preventDefault();
      void api.open(w);
    },
    true,
  );
  // Правый клик мышью (и долгое нажатие на Android, где оно шлёт contextmenu): поповер везде, системное меню не нужно.
  overlay.addEventListener('contextmenu', (e) => {
    const w = e.target instanceof Element ? e.target.closest<HTMLElement>('.pq-w') : null;
    if (!w || root.contains(w)) return;
    e.preventDefault();
    void api.open(w);
  });
  // Новый польский текст в оверлее размечается сам (экраны рисуют как раньше, `lang="pl"`/`data-plw` — достаточно).
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') markWords(m.target);
        else for (const n of m.addedNodes) if (n.isConnected) markWords(n);
      }
      mo.takeRecords();
    });
    mo.observe(overlay, { childList: true, subtree: true, characterData: true });
    markWords(overlay);
  }
  window.addEventListener('resize', place);
  active = api;
  return api;
}
