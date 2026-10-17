// Полоска диакритики `ą ć ę ł ń ó ś ź ż` над полем: на всех устройствах.
// Shift (экранный или физический, зажатый при тапе) даёт заглавные.
import { el } from '../dom';
import { STRIP_CHARS } from './chars';
import { keyButton } from './keys';

export function createStrip(): HTMLElement {
  const letters = STRIP_CHARS.map((ch) => {
    const b = keyButton(`ch:${ch}`, ch, 'pq-kb-letter');
    b.dataset.fixed = '';
    b.lang = 'pl';
    return b;
  });
  return el('div', { class: 'pq-kb-strip', role: 'toolbar', 'aria-label': 'Польские буквы' }, keyButton('shift', '⇧', 'pq-kb-mod', 'Shift'), ...letters);
}
