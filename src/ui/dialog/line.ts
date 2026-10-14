// Окно реплики (ТЗ §5.6, P-07): портрет с именем над деревянной коробкой, польская строка крупно,
// русская подпись мелко под ней. Коробка — до 2 строк по 40 знаков (boxes.ts): длинная реплика идёт
// несколькими коробками, листает игрок (тап по коробке, A, Enter, пробел). Текст печатается быстро,
// тап дописывает сразу. Подпись гаснет, когда все значимые слова строки знакомы (systems/words.ts) или
// настройка «никогда»; тогда остаётся «?». Тап по польскому слову — всплывашка с переводом и
// транскрипцией из vocab (слова нет — перевод всей строки). Казик говорит по-русски с польскими
// вкраплениями (они подсвечены и тапаются так же), рассказчик — без портрета, курсивом, мелко.
// Реплика-заглушка (`todo`) показывается как `[todo: id]`.
import { captionHidden, captionMode, isLatin, matchWords, type CaptionMode, type WordIndex, type WordSpan } from '../../systems/words';
import type { LineWord, VocabEntry } from '../../types/content';
import { el } from '../dom';
import { audioButtons, btn, portrait, type AudioPort, type PortraitSource, type Speaker } from '../overlay/kit';
import { captionsFor, splitBoxes, type BoxOpts } from './boxes';

/** Слова для подписи и тапа: словарь, «знакомо ли», имена (не значимые слова). */
export interface WordPort {
  index: WordIndex;
  vocab(id: string): Pick<VocabEntry, 'pl' | 'ru' | 'tr'> | undefined;
  known(id: string): boolean;
  ignore?(word: string): boolean;
}

export type LineStyle = 'npc' | 'kazik' | 'narrator';

export interface LineOpts {
  speaker: Speaker;
  pl?: string;
  /** Перевод pl (подпись под польской строкой). */
  ru?: string;
  /** Реплика ещё не написана: показываем id заглушки. */
  todo?: string;
  /** Русская речь (Казик, рассказчик): видна сразу, не озвучивается, польские вкрапления тапаются. */
  rus?: string;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  /** Настройка `translations` (`tap` — старое значение, = `auto`). */
  translations: CaptionMode | 'tap';
  /** Мс на букву при печати; 0 — сразу целиком (тесты, reduced motion). */
  typeMs?: number;
  /** Озвучить сразу при показе. */
  autoplay?: boolean;
  style?: LineStyle;
  words?: WordPort | null;
  /** Разметка `words` строки (P-07). */
  refs?: readonly LineWord[];
  box?: BoxOpts;
}

export interface LineView {
  node: HTMLElement;
  portrait: HTMLElement;
  /** Текущая коробка ещё печатается. */
  readonly typing: boolean;
  /** Показана последняя коробка. */
  readonly atEnd: boolean;
  /** Коробок в реплике. */
  readonly pages: number;
  /** Допечатать текущую коробку. true — печаталась (нажатие ушло на это). */
  skip(): boolean;
  /** «Дальше» внутри реплики: закрыть всплывашку, допечатать, следующая коробка. false — реплика кончилась. */
  advance(): boolean;
  /** Сразу последняя коробка целиком (выбор варианта). */
  finish(): void;
  /** Вызывается, когда показана последняя коробка (сразу, если коробка одна). */
  onEnd(cb: () => void): void;
  /** Подпись скрыта правилом (видна только по «?»). */
  readonly captionHidden: boolean;
  /** Показать подпись. */
  revealRu(): void;
  dispose(): void;
}

export function todoText(id: string): string {
  return `[todo: ${id}]`;
}

/** Печать по буквам по умолчанию, мс (P-07: быстро). */
export const TYPE_MS = 16;

type Page = { kind: 'pl' | 'todo'; text: string; caption?: string } | { kind: 'rus'; text: string };

function pagesOf(o: LineOpts): Page[] {
  if (o.todo) return [{ kind: 'todo', text: todoText(o.todo) }];
  const out: Page[] = [];
  if (o.pl) {
    const boxes = splitBoxes(o.pl, o.box);
    const caps = captionsFor(boxes, o.pl, o.ru);
    boxes.forEach((b, i) => out.push({ kind: 'pl', text: b.text, ...(caps[i] ? { caption: caps[i] } : {}) }));
  }
  if (o.rus) for (const b of splitBoxes(o.rus, o.box)) out.push({ kind: 'rus', text: b.text });
  if (!out.length) out.push({ kind: 'pl', text: '' });
  return out;
}

export function lineBox(o: LineOpts): LineView {
  const style: LineStyle = o.style ?? 'npc';
  const pic = portrait(o.speaker, o.portraits);
  const mode = captionMode(o.translations);
  const words = o.words ?? null;
  const pages = pagesOf(o);
  const hasRu = !!o.ru && !o.todo;
  // Правило гаснущей подписи — по всей польской строке, а не по коробке.
  const plSpans = o.pl && words ? matchWords(o.pl, words.index, o.refs ? { refs: o.refs } : {}) : [];
  const hidden = hasRu && (words ? captionHidden(mode, plSpans, (lx) => words.known(lx), { ...(o.refs ? { refs: o.refs } : {}), ...(words.ignore ? { ignore: words.ignore } : {}) }) : mode === 'never');
  let revealed = !hidden;

  const textEl = el('div', { class: 'pq-line-pl', 'data-role': 'pl' });
  const ruEl = el('div', { class: 'pq-line-ru', lang: 'ru', 'data-role': 'ru' });
  const rusEl = el('div', { class: 'pq-line-rus', lang: 'ru', 'data-role': 'rus' });
  const pageEl = el('span', { class: 'pq-line-page', 'aria-hidden': 'true' });
  const ruBtn = hasRu ? btn('?', () => showRu(), 'icon ghost pq-line-q', { 'data-nav': true, 'data-act': 'ru', 'aria-label': 'Перевод', hidden: true }) : null;
  const canPlay = !!o.pl && !o.todo && o.audio.has(o.pl);
  const plAudio = canPlay ? audioButtons(o.audio, o.pl!, o.speaker.id) : [];
  const tools = el(
    'div',
    { class: 'pq-line-tools' },
    ...plAudio,
    ruBtn,
    !canPlay && o.pl && !o.todo ? el('span', { class: 'pq-noaudio' }, '🔇') : null,
    pageEl,
  );
  const pop = el('div', { class: 'pq-wpop pq-wood', role: 'status', hidden: true });
  const node = el(
    'div',
    { class: `pq-wood pq-line ${style}`, 'data-style': style },
    style === 'narrator' ? null : el('div', { class: 'pq-line-who' }, pic, el('div', { class: 'pq-line-name' }, o.speaker.name)),
    el('div', { class: 'pq-line-text' }, textEl, ruEl, rusEl, tools),
    pop,
  );

  let page = 0;
  let shown = 0;
  let chars: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const typeMs = o.typeMs ?? TYPE_MS;
  const endCbs: (() => void)[] = [];
  let endFired = false;

  const cur = (): Page => pages[page]!;
  const target = (): HTMLElement => (cur().kind === 'rus' ? rusEl : textEl);

  function showRu(): void {
    revealed = true;
    paintCaption();
  }

  function paintCaption(): void {
    const p = cur();
    const cap = p.kind === 'pl' && shown >= chars.length ? p.caption : undefined;
    ruEl.textContent = cap && revealed ? cap : '';
    ruEl.hidden = !(p.kind === 'pl' || p.kind === 'todo');
    if (ruBtn) ruBtn.hidden = !(p.kind === 'pl' && !!p.caption && !revealed);
  }

  /** Слова текущей коробки для тапа: у польской строки все, у русской речи — латиница (вкрапления). */
  function spansOf(text: string, kind: Page['kind']): WordSpan[] {
    if (!words || kind === 'todo') return [];
    const only = kind === 'rus' ? { only: isLatin } : {};
    return matchWords(text, words.index, { ...(o.refs ? { refs: o.refs } : {}), ...only });
  }

  function renderWords(): void {
    const p = cur();
    const t = target();
    if (p.kind === 'todo' || !words) {
      t.textContent = p.text;
      return;
    }
    const spans = spansOf(p.text, p.kind);
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const s of spans) {
      // Имена (Jan, Brzechwa) не тапаются: перевода у них нет.
      if (!s.lx && words.ignore?.(s.text)) continue;
      if (s.start > last) frag.append(p.text.slice(last, s.start));
      const known = !!s.lx && words.known(s.lx);
      frag.append(
        el('span', { class: `pq-w${known ? ' known' : ''}${s.lx ? '' : ' nolx'}`, role: 'button', lang: 'pl', 'data-word': s.text, 'data-lx': s.lx }, s.text),
      );
      last = s.end;
    }
    if (last < p.text.length) frag.append(p.text.slice(last));
    t.replaceChildren(frag);
  }

  function render(): void {
    if (shown >= chars.length) renderWords();
    else target().textContent = chars.slice(0, shown).join('');
    paintCaption();
  }

  function stopTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function tick(): void {
    shown = Math.min(chars.length, shown + 1);
    render();
    timer = shown < chars.length ? setTimeout(tick, typeMs) : null;
  }

  function showPage(i: number, instant = false): void {
    stopTimer();
    closePop();
    page = i;
    const p = cur();
    chars = [...p.text];
    textEl.className = `pq-line-pl${p.kind === 'todo' ? ' todo' : ''}`;
    if (p.kind === 'todo') textEl.removeAttribute('lang');
    else textEl.setAttribute('lang', 'pl');
    textEl.hidden = p.kind === 'rus';
    rusEl.hidden = p.kind !== 'rus';
    textEl.textContent = '';
    rusEl.textContent = '';
    pageEl.textContent = pages.length > 1 ? `${i + 1}/${pages.length}` : '';
    // ▶ озвучивает польскую строку: на коробках русской речи его нет.
    for (const b of plAudio) b.hidden = p.kind === 'rus';
    if (instant || typeMs <= 0) {
      shown = chars.length;
      render();
    } else {
      shown = 0;
      tick();
    }
    if (page === pages.length - 1 && !endFired) {
      endFired = true;
      for (const cb of endCbs) cb();
    }
  }

  // ── Всплывашка слова.
  function closePop(): boolean {
    if (pop.hidden) return false;
    pop.hidden = true;
    pop.replaceChildren();
    node.querySelector('.pq-w.on')?.classList.remove('on');
    return true;
  }

  function openPop(w: HTMLElement): void {
    closePop();
    const lx = w.dataset.lx;
    const v = lx ? words?.vocab(lx) : undefined;
    const p = cur();
    const whole = p.kind === 'pl' ? (o.ru ?? null) : null;
    const rows: (Node | string | null)[] = v
      ? [el('b', { lang: 'pl' }, v.pl), v.tr ? el('span', { class: 'tr' }, `[${v.tr}]`) : null, el('span', { class: 'ru', lang: 'ru' }, v.ru)]
      : [el('b', { lang: 'pl' }, w.dataset.word ?? w.textContent ?? ''), el('span', { class: 'ru', lang: 'ru' }, whole ? `Вся фраза: ${whole}` : 'Этого слова ещё нет в словаре')];
    pop.replaceChildren(...rows.filter((x): x is Node | string => x !== null));
    if (v && o.audio.has(v.pl)) pop.append(btn('▶', () => o.audio.play(v.pl, { who: o.speaker.id }), 'icon', { 'aria-label': 'Послушать слово', 'data-audio': 'word' }));
    pop.hidden = false;
    w.classList.add('on');
    // Над словом, в пределах коробки (в тестах раскладки нет — остаётся по CSS).
    const nr = node.getBoundingClientRect();
    const wr = w.getBoundingClientRect();
    if (nr.width > 0) {
      const left = Math.max(6, Math.min(wr.left - nr.left, nr.width - 220));
      pop.style.left = `${left}px`;
      pop.style.bottom = `${nr.bottom - wr.top + 6}px`;
    }
  }

  // Тап по слову — всплывашка; тап куда угодно при открытой всплывашке — закрыть её. Остальные тапы
  // (листание) ловит диалог: обработчик ниже стоит первым и гасит своё событие.
  node.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('.pq-wpop button')) return;
    const w = t.closest('.pq-w') as HTMLElement | null;
    if (w && shown >= chars.length) {
      e.stopImmediatePropagation();
      if (w.classList.contains('on')) closePop();
      else openPop(w);
      return;
    }
    if (closePop()) e.stopImmediatePropagation();
  });

  showPage(0);
  if (canPlay && o.autoplay) o.audio.play(o.pl!, { who: o.speaker.id });

  const view: LineView = {
    node,
    portrait: pic,
    get typing() {
      return shown < chars.length;
    },
    get atEnd() {
      return page === pages.length - 1;
    },
    get pages() {
      return pages.length;
    },
    get captionHidden() {
      return hidden;
    },
    skip() {
      if (shown >= chars.length) return false;
      stopTimer();
      shown = chars.length;
      render();
      return true;
    },
    advance() {
      if (closePop()) return true;
      if (view.skip()) return true;
      if (page < pages.length - 1) {
        showPage(page + 1);
        return true;
      }
      return false;
    },
    finish() {
      if (page < pages.length - 1) showPage(pages.length - 1, true);
      else view.skip();
    },
    onEnd(cb) {
      if (endFired) cb();
      else endCbs.push(cb);
    },
    revealRu: showRu,
    dispose() {
      stopTimer();
    },
  };
  return view;
}
