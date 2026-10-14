// Поле ответа для type, dictation, gap (ТЗ §4.6, §5.13): lang="pl", без автозамены и автозаглавных;
// экранную клавиатуру подключает рамка шага (frame.ts → attachKeyboard).
import { el } from '../dom';

export function answerField(label: string): HTMLInputElement {
  return el('input', {
    type: 'text',
    class: 'pq-answer',
    lang: 'pl',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': label,
  });
}

/** Подсказка для ввода: первая буква и длина слов («m _ _ _  k _ _ _»). */
export function letterHint(answer: string): string {
  return answer
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => [...w].map((ch, j) => (j === 0 && i === 0 ? ch : /[\p{L}]/u.test(ch) ? '_' : ch)).join(' '))
    .join('   ');
}

export function focusField(f: HTMLInputElement): void {
  f.focus({ preventScroll: true });
  const n = f.value.length;
  try {
    f.setSelectionRange(n, n);
  } catch {
    /* happy-dom без выделения */
  }
}
