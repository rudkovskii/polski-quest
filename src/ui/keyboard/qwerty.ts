// Полная экранная QWERTY: по умолчанию на десктопе и iPad с клавиатурой.
// Кнопка «ąę» превращает a c e l n o s z x в ą ć ę ł ń ó ś ż ź до следующей буквы,
// двойное нажатие фиксирует. Enter = «Проверить».
import { el } from '../dom';
import { keyButton } from './keys';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export function createQwerty(): HTMLElement {
  const letters = (row: string): HTMLButtonElement[] => [...row].map((c) => keyButton(`ch:${c}`, c, 'pq-kb-letter'));
  return el(
    'div',
    { class: 'pq-kb-qwerty', role: 'group', 'aria-label': 'Экранная клавиатура' },
    el('div', { class: 'pq-kb-row' }, ...letters(ROWS[0] ?? '')),
    el('div', { class: 'pq-kb-row' }, ...letters(ROWS[1] ?? '')),
    el(
      'div',
      { class: 'pq-kb-row' },
      keyButton('shift', '⇧', 'pq-kb-mod', 'Shift'),
      ...letters(ROWS[2] ?? ''),
      keyButton('backspace', '⌫', 'pq-kb-mod', 'Стереть'),
    ),
    el(
      'div',
      { class: 'pq-kb-row' },
      keyButton('polish', 'ąę', 'pq-kb-mod pq-kb-polish', 'Польские буквы'),
      keyButton('ch:,', ',', 'pq-kb-letter'),
      keyButton('space', '', 'pq-kb-space', 'Пробел'),
      keyButton('ch:.', '.', 'pq-kb-letter'),
      keyButton('ch:?', '?', 'pq-kb-letter'),
      keyButton('enter', '⏎', 'pq-kb-mod pq-kb-enter', 'Проверить'),
    ),
  );
}
