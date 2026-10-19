// Единая кнопка «🔊 Озвучить» для любого польского текста на экране (просьба Шэфа 19.10: у каждой польской фразы в игре есть кнопка).
// Тап → `say(text)` (обычная скорость; повторный тап в течение `SLOW_WINDOW_MS` — медленно, следующий — снова обычно), клик не уходит
// родителю (не выбирает вариант, не отправляет ответ). Значок рисует CSS (`::before`), поэтому `textContent` соседей остаётся чистым;
// видимая кнопка 28 px, зона тапа 38 px (`::after`). У кнопки нет `data-nav`: стрелки её пропускают, сетка 2×2 не ломается;
// с клавиатуры — клавиша `G` (intent `say`, `sayFocused`). Русский текст кнопки не получает.
import { el } from './dom';

export type SayFn = (text: string, slow?: boolean) => void;

/** Повторный тап по той же кнопке в течение этого времени говорит медленно. */
export const SLOW_WINDOW_MS = 8000;

export interface SayOpts {
  /** Главная кнопка задания (вопрос): её читает клавиша `G`, когда ни один вариант не выбран стрелками. */
  main?: boolean;
  /** Внутри строки текста (отзыв): без добавочной высоты. */
  inline?: boolean;
  /** Доп. атрибуты (например, `nav()` словаря). */
  attrs?: Record<string, string>;
  /** Подпись для скринридера, по умолчанию «Озвучить: <текст>». */
  label?: string;
}

const CYR = /[а-яё]/i;
export const hasCyrillic = (s: string): boolean => CYR.test(s);

/** Что произносить: пропуски («___», «…») становятся паузой, края без многоточий, пробелы сжаты. */
export function spokenText(text: string): string {
  return text
    .replace(/\s*(?:_{2,}|\.{3}|…)\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,(\s*,)+/g, ',')
    .replace(/^[\s,.;:]+|[\s,;:]+$/g, '')
    .trim();
}

/**
 * Польская часть смешанной строки («11 listopada 1918 · Праздник», «pono — говорят», «Najbliższe święto: Wigilia · za 3 dni»):
 * куски без кириллицы, в которых есть слово; «слово — перевод» режется по тире. Пусто — по-польски там нечего читать.
 */
export function polishPart(text: string): string {
  const keep: string[] = [];
  for (const seg of text.split(/\s·\s|\n/)) {
    for (const part of seg.split(/\s[—–]\s/)) {
      const p = part.trim();
      if (p && !hasCyrillic(p) && /\p{L}{2,}/u.test(p)) keep.push(p);
    }
  }
  return spokenText(keep.join(', '));
}

export const SAY_CSS = `
.pq-say { position: relative; box-sizing: border-box; flex: 0 0 auto; width: 28px; height: 28px; min-width: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  color: var(--pq-ink); background: #f2d552; border: 2px solid var(--pq-ink); border-radius: 6px; box-shadow: 0 2px 0 var(--pq-ink); cursor: pointer; touch-action: manipulation; font: 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.pq-say::before { content: '\\1F50A'; pointer-events: none; }
.pq-say::after { content: ''; position: absolute; inset: -5px; }
.pq-say:active { transform: translateY(1px); box-shadow: 0 1px 0 var(--pq-ink); }
.pq-say.inline { margin: -6px 0; }
.pq-qrow { display: flex; align-items: flex-start; gap: 8px; }
.pq-qrow > .pq-q, .pq-qrow > .txt { flex: 1 1 auto; min-width: 0; }
.pq-qrow > .pq-say { margin-top: 2px; }
.pq-fbrow { display: flex; align-items: center; gap: 8px; }
.pq-fbrow > :first-child { flex: 1 1 auto; min-width: 0; }
.pq-optw { position: relative; display: flex; min-width: 0; }
.pq-optw > .pq-opt { flex: 1 1 auto; min-width: 0; }
.pq-optw > .pq-opt.has-say { padding-right: 36px; }
.pq-optw > .pq-say { position: absolute; top: 3px; right: 3px; }
`;

/** Кнопка озвучки польского текста. `say` — функция озвучки движка (под выключателем звука; `?mute=1` — только консоль). */
export function sayButton(text: string, say: SayFn, o: SayOpts = {}): HTMLButtonElement {
  const initial = spokenText(text) || text;
  let lastAt = -Infinity;
  let slowNext = false;
  const b = el(
    'button',
    {
      type: 'button',
      class: `pq-say${o.inline ? ' inline' : ''}`,
      'data-saytext': initial,
      ...(o.main ? { 'data-say-main': '' } : {}),
      'aria-label': o.label ?? `Озвучить: ${initial}`,
      lang: 'ru',
      ...(o.attrs ?? {}),
    },
  );
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Текст читается в момент тапа: владелец может менять `data-say` (барабаны Daty).
    const spoken = b.dataset.saytext || initial;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    // Повторный тап вскоре после первого — медленно; ещё один — снова обычно.
    slowNext = now - lastAt <= SLOW_WINDOW_MS ? !slowNext : false;
    lastAt = now;
    if (slowNext) say(spoken, true);
    else say(spoken);
  });
  return b;
}

/**
 * Вариант ответа с кнопкой озвучки в углу: `btn` (сама кнопка выбора) и 🔊 соседями в обёртке — вложенных кнопок нет, тап по 🔊 вариант
 * не выбирает. Обёртка — элемент сетки `.pq-opts`; `data-nav`/`data-opt` остаются на `btn`.
 */
export function withSay(btn: HTMLElement, text: string, say: SayFn): HTMLElement {
  btn.classList.add('has-say');
  return el('div', { class: 'pq-optw' }, btn, sayButton(text, say));
}

/**
 * Клавиша озвучки (intent `say`): вариант под рамкой выбора; после ответа — отзыв; иначе вопрос. true — что-то было озвучено.
 * `root` — корень экрана игры, `focused` — элемент под рамкой (`.is-focus`) или null.
 */
export function sayFocused(root: ParentNode, focused: Element | null): boolean {
  const own = focused?.closest('.pq-optw')?.querySelector<HTMLElement>(':scope > .pq-say');
  const fb = root.querySelector<HTMLElement>('[data-feedback]:not([hidden]) .pq-say');
  const main = root.querySelector<HTMLElement>('[data-say-main]');
  const any = root.querySelector<HTMLElement>('.pq-say');
  const target = own ?? fb ?? main ?? any;
  if (!target) return false;
  target.click();
  return true;
}
