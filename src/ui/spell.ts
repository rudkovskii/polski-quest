// Игра 5 «Собери слово · Ułóż słowo» внутри панели мини-игры (`ui/minigame.ts`): ряд слотов ответа, плитки-буквы, «💡 Первая буква»,
// «⌨ Напечатать» (польское — поле + экранная польская клавиатура `ui/keyboard`; русское — поле с системной клавиатурой, форма/submit).
// Тап по плитке ставит её в первый пустой слот, тап по слоту возвращает плитку; «Сбросить» — всё обратно (кроме подсказки).
// Плитки-буквы не озвучиваются (это не слова). Польское слово звучит после ответа (это делает `minigame.ts`), в задании PL→RU — сразу.
import type { SpellQuestion } from '../systems/quiz';
import { assemble, spellDiff } from '../systems/spell';
import { el } from './dom';
import { attachKeyboard, type AttachedKeyboard } from './keyboard';

export interface SpellCtx {
  paper: HTMLElement;
  foot: HTMLElement;
  /** Отправить ответ (экран уже поставил `hinted`/`typed` в задание). */
  submit(q: SpellQuestion, given: string): void;
  /** Высота панели поменялась (режим ввода, перенос плиток). */
  relayout(): void;
  /** Сенсорный экран: на нём системную клавиатуру прячем (`inputmode=none`), печатают экранной. */
  coarse?: boolean;
  /** Режим ввода с прошлого задания (переключатель запоминается до выхода). */
  typing: boolean;
  onTyping(on: boolean): void;
}

export interface SpellView {
  /** Клавиша 1–9: n-я свободная плитка. */
  hotkey(n: number): void;
  /** Что игрок собрал (для разбора ошибки). */
  readonly given: string;
  detach(): void;
}

export const SPELL_CSS = `
.pq-game-box.spell { height: clamp(250px, calc(100dvh - 110px), 470px); }
.pq-game-box.spell.typing { height: min(calc(100dvh - 16px), 500px); }
.pq-spell { display: flex; flex-direction: column; gap: 6px; }
.pq-spell-q { display: flex; flex-direction: column; gap: 1px; }
.pq-spell-q .pq-q { font-size: 22px; margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.pq-spell-q .pq-q-hint, .pq-spell-q .pq-progress { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pq-spell-q .pq-hintline { font-size: 13px; font-weight: 700; color: #7a4a00; }
.pq-sw { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; max-width: 100%; }
.pq-slots { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; row-gap: 3px; min-height: 40px; padding: 4px; border: 2px dashed var(--pq-wood); border-radius: 6px; background: #fffaf0; }
.pq-game .pq-slot { box-sizing: border-box; min-width: 30px; height: 36px; padding: 0 5px; font-size: 19px; font-weight: 700; color: var(--pq-ink); background: #fffaf0; border: 2px solid #c9b48a; border-radius: 6px; box-shadow: none; }
.pq-game .pq-slot.full { background: #f2dcae; border-color: var(--pq-ink); }
.pq-game .pq-slot.lock { background: #ffe9a8; }
.pq-slot-fix { font-size: 19px; font-weight: 700; padding: 0 1px; }
.pq-letters { display: flex; flex-wrap: wrap; gap: 5px; }
.pq-game .pq-letter { min-width: 38px; height: 40px; padding: 0 6px; font-size: 20px; font-weight: 700; color: var(--pq-ink); background: #f2dcae; }
.pq-game .pq-letter[disabled] { opacity: .2; }
.pq-spell form { margin: 0; }
.pq-spell .pq-type { font-size: 20px; padding: 6px 10px; }
.pq-spell .pq-kb-strip { margin: 0 0 4px; }
.pq-spell .pq-kb-strip .pq-kb-key { height: 34px; font-size: 18px; }
.pq-spell .pq-kb-qwerty { margin: 6px 0 0; padding: 4px; gap: 4px; max-height: none; }
.pq-spell .pq-kb-row { gap: 4px; }
.pq-spell .pq-kb-key { height: clamp(26px, calc((100dvh - 330px) / 4), 40px); font-size: 16px; }
.pq-game-foot .pq-btn.pq-tool { flex: 0 0 auto; padding-left: 10px; padding-right: 10px; }
.pq-spell-diff { font-size: 20px; font-weight: 800; letter-spacing: .5px; overflow-wrap: anywhere; line-height: 1.2; }
.pq-spell-diff .lbl { font-size: 13px; font-weight: 600; opacity: .75; margin-right: 4px; letter-spacing: 0; }
.pq-spell-diff .bad { color: #b3261e; text-decoration: line-through; }
.pq-spell-diff .fix { color: #1d6b2a; background: #c6efb0; border-radius: 3px; text-decoration: underline; }
.pq-spell-diff.mine { font-size: 15px; font-weight: 700; opacity: .9; }
@media (max-width: 520px) {
  .pq-game .pq-letter { min-width: 34px; height: 36px; font-size: 19px; padding: 0 4px; }
  .pq-letters { gap: 4px; }
  .pq-game .pq-slot { min-width: 25px; height: 32px; font-size: 17px; padding: 0 3px; }
  .pq-slots { min-height: 34px; padding: 3px; }
  .pq-tool .lbl { display: none; }
  .pq-spell-q .pq-q { font-size: 20px; }
}
@media (max-height: 520px) {
  .pq-spell-q .pq-q { font-size: 19px; -webkit-line-clamp: 1; line-clamp: 1; }
  .pq-spell-q .pq-progress { display: none; }
  .pq-game .pq-letter { height: 32px; }
  .pq-game .pq-slot { height: 30px; }
  .pq-slots { min-height: 34px; padding: 2px 4px; }
  .pq-spell { gap: 4px; }
  .pq-letters { gap: 4px; }
}
`;

/** Строка разбора: буквы с пометкой ошибки (`bad` — лишняя/не та, у правильного — `fix`). */
export function diffLine(label: string, chars: { ch: string; bad: boolean }[], cls: 'bad' | 'fix', extra = ''): HTMLElement {
  return el(
    'div',
    { class: `pq-spell-diff${extra}`, 'data-diff': cls },
    el('span', { class: 'lbl' }, label),
    ...chars.map((c) => (c.bad ? el('span', { class: cls }, c.ch) : document.createTextNode(c.ch))),
  );
}

/** Разбор неверного ответа: что собрал игрок (ошибки зачёркнуты) и правильное (исправленные буквы подсвечены). */
export function spellFeedback(given: string, correct: string): HTMLElement[] {
  const d = spellDiff(given, correct);
  return [diffLine('Правильно:', d.correct, 'fix'), diffLine('У тебя:', d.given, 'bad', ' mine')];
}

export function renderSpell(q: SpellQuestion, ctx: SpellCtx): SpellView {
  const { paper, foot } = ctx;
  const lang = q.dir === 'rp' ? 'pl' : 'ru';
  /** Индексы плиток `q.tiles` в слотах по порядку. */
  let picked: number[] = [];
  /** Подсказка взята: первая плитка заперта в первом слоте. */
  let hintAt = -1;
  /** Подсказку брали (в плитках или при вводе): ответ засчитается, но не как «сам». */
  let hinted = false;
  let typing = ctx.typing;
  let kb: AttachedKeyboard | null = null;
  let input: HTMLInputElement | null = null;
  const slotsN = q.units.length;

  const area = el('div', { class: 'pq-spell-area', 'data-fbhost': '', 'data-spell': q.dir });
  const hintLine = el('div', { class: 'pq-hintline', 'data-hintline': '', hidden: true }, '');
  const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', disabled: true, onclick: () => send() }, 'Sprawdź · Проверить');
  // «Сбросить»: плитки обратно (запертая подсказка остаётся), при вводе — поле пустое (или с первой буквой подсказки).
  const reset = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-reset': '', onclick: () => clear() }, 'Сбросить');
  const hintBtn = el(
    'button',
    { type: 'button', class: 'pq-btn pq-tool', 'data-nav': '', 'data-hint': '', title: 'Первая буква (ответ засчитается, но не как «сам»)', 'aria-label': 'Подсказка: первая буква', onclick: () => takeHint() },
    '💡',
    el('span', { class: 'lbl' }, ' Первая буква'),
  );
  const typeBtn = el('button', { type: 'button', class: 'pq-btn pq-tool', 'data-nav': '', 'data-typemode': '', onclick: () => setTyping(!typing) }, '');

  const given = (): string => (typing ? (input?.value ?? '') : assemble(q.layout, picked.map((i) => q.tiles[i]!)));

  const send = (): void => {
    const g = given();
    if (!g.trim() || (!typing && picked.length < slotsN)) return;
    ctx.submit({ ...q, ...(hinted ? { hinted: true } : {}), ...(typing ? { typed: true } : {}) }, g);
  };

  const takeHint = (): void => {
    if (hinted) return;
    hinted = true;
    const first = q.units[0] ?? '';
    hintLine.hidden = false;
    hintLine.textContent = `💡 Начинается на «${first}» · засчитается, но не как «сам»`;
    hintBtn.disabled = true;
    if (!typing) {
      // Первая плитка ответа — в первый слот, запертой (если игрок уже поставил её туда, просто запираем).
      const i = q.tiles.findIndex((t, k) => t === first && (picked[0] === k || !picked.includes(k)));
      if (i >= 0) {
        picked = [i, ...picked.filter((k) => k !== i)].slice(0, slotsN);
        hintAt = i;
      }
      paint();
    } else if (input && !input.value.toLowerCase().startsWith(first)) {
      input.value = first + input.value;
      input.dispatchEvent(new Event('input'));
    }
    ctx.relayout();
  };

  const paint = (): void => {
    if (typing) return;
    let k = 0;
    const slots = el('div', { class: 'pq-slots', 'data-slots': '', 'aria-label': 'Ответ' });
    // Слоты одного слова держатся вместе (перенос строки — между словами).
    let word = el('span', { class: 'pq-sw' });
    slots.append(word);
    for (const c of q.layout) {
      if (c === ' ') {
        word = el('span', { class: 'pq-sw' });
        slots.append(word);
      } else if (c !== null) word.append(el('span', { class: 'pq-slot-fix' }, c));
      else {
        const pos = k++;
        const ti = picked[pos];
        const lock = pos === 0 && hintAt >= 0;
        word.append(
          el(
            'button',
            {
              type: 'button',
              class: `pq-btn pq-slot${ti !== undefined ? ' full' : ''}${lock ? ' lock' : ''}`,
              'data-slot': String(pos),
              ...(ti !== undefined && !lock ? { 'data-nav': '' } : {}),
              disabled: ti === undefined || lock,
              onclick: () => ((picked = picked.filter((_, j) => j !== pos)), paint()),
            },
            ti !== undefined ? q.tiles[ti]! : '',
          ),
        );
      }
    }
    const letters = el(
      'div',
      { class: 'pq-letters', 'data-letters': '' },
      ...q.tiles.map((t, i) => el('button', { type: 'button', class: 'pq-btn pq-letter', 'data-nav': '', 'data-letter': t, lang, disabled: picked.includes(i), onclick: () => add(i) }, t)),
    );
    area.replaceChildren(slots, letters);
    check.disabled = picked.length < slotsN;
    reset.disabled = picked.length <= (hintAt >= 0 ? 1 : 0);
    ctx.relayout();
  };

  const clear = (): void => {
    if (typing && input) {
      input.value = hinted ? (q.units[0] ?? '') : '';
      input.dispatchEvent(new Event('input'));
      input.focus({ preventScroll: true });
      return;
    }
    picked = hintAt >= 0 ? [hintAt] : [];
    paint();
  };

  const add = (i: number): void => {
    if (typing || picked.includes(i) || picked.length >= slotsN) return;
    picked.push(i);
    paint();
  };

  const mountTyping = (): void => {
    input = el('input', {
      type: 'text',
      class: 'pq-type',
      'data-type': '',
      lang,
      placeholder: lang === 'pl' ? 'Напиши по-польски' : 'Напиши по-русски',
      enterkeyhint: 'done',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      ...(lang === 'pl' && ctx.coarse ? { inputmode: 'none' } : {}),
    });
    if (hinted) input.value = q.units[0] ?? '';
    const sync = (): void => {
      check.disabled = !input!.value.trim();
    };
    input.addEventListener('input', sync);
    sync();
    // Русский: системная клавиатура, Enter — submit формы (свой keydown в экранах запрещён). Польский: экранная, Enter — onEnter.
    const form = el('form', { 'data-typeform': '', onsubmit: (e: Event) => (e.preventDefault(), send()) }, input);
    area.replaceChildren(form);
    if (lang === 'pl') kb = attachKeyboard(input, { mode: 'full', onEnter: () => send() });
    setTimeout(() => input?.focus({ preventScroll: true }), 30);
  };

  const setTyping = (on: boolean): void => {
    typing = on;
    ctx.onTyping(on);
    kb?.detach();
    kb = null;
    input = null;
    typeBtn.replaceChildren(on ? '🔤' : '⌨️', el('span', { class: 'lbl' }, on ? ' Плитки' : ' Напечатать'));
    typeBtn.setAttribute('aria-label', on ? 'Собрать из плиток' : 'Напечатать с клавиатуры');
    typeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // Высокий лист — только под экранную польскую клавиатуру; русская печать идёт системной, лист обычный.
    paper.closest('.pq-game-box')?.classList.toggle('typing', on && lang === 'pl');
    if (on) {
      reset.disabled = false;
      mountTyping();
    } else paint();
    ctx.relayout();
  };

  paper.append(el('div', { class: 'pq-spell' }, hintLine, area));
  foot.replaceChildren(hintBtn, typeBtn, reset, check);
  setTyping(typing);

  return {
    hotkey(n) {
      if (typing) return;
      const free = q.tiles.map((_, i) => i).filter((i) => !picked.includes(i));
      const i = free[n - 1];
      if (i !== undefined) add(i);
    },
    get given() {
      return given();
    },
    detach() {
      kb?.detach();
      kb = null;
      paper.closest('.pq-game-box')?.classList.remove('typing');
    },
  };
}
