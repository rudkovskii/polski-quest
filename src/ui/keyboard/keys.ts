// Общая модель кнопок экранной клавиатуры: полоска и QWERTY рисуют кнопки с data-key,
// нажатия ловит attach.ts одним слушателем на контейнере.
import { el } from '../dom';
import { POLISH_OF, upper } from './chars';

/** `ch:x` — буква, остальное — служебные кнопки. */
export type KeyId = `ch:${string}` | 'shift' | 'polish' | 'backspace' | 'space' | 'enter';

export interface KbState {
  /** Shift на одно нажатие. */
  shift: boolean;
  /** «ąę»: off, на одно нажатие, зафиксирован (двойное нажатие). */
  polish: 'off' | 'once' | 'lock';
}

export function keyButton(id: KeyId, label: string, extraClass = '', aria?: string): HTMLButtonElement {
  return el(
    'button',
    { type: 'button', class: `pq-kb-key ${extraClass}`.trim(), 'data-key': id, tabindex: -1, 'aria-label': aria },
    label,
  );
}

/** Что печатает буквенная кнопка при текущем состоянии. */
export function charFor(base: string, state: KbState, physicalShift = false): string {
  let ch = base;
  if (state.polish !== 'off' && POLISH_OF[base]) ch = POLISH_OF[base];
  if (state.shift || physicalShift) ch = upper(ch);
  return ch;
}

/** Обновить подписи и подсветку под состояние. */
export function paint(root: HTMLElement, state: KbState): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-key]')) {
    const id = node.dataset.key ?? '';
    if (id.startsWith('ch:')) {
      const base = id.slice(3);
      // Буквы полоски уже польские: на них действует только Shift.
      const ch = node.dataset.fixed !== undefined ? (state.shift ? upper(base) : base) : charFor(base, state);
      node.textContent = ch;
      node.toggleAttribute('data-polish', node.dataset.fixed === undefined && ch.toLowerCase() !== base);
    } else if (id === 'shift') {
      node.toggleAttribute('data-on', state.shift);
    } else if (id === 'polish') {
      node.toggleAttribute('data-on', state.polish !== 'off');
      node.toggleAttribute('data-lock', state.polish === 'lock');
    }
  }
}
