// Правка текста в поле с сохранением курсора: вставка через setRangeText, событие `input` для слушателей.

export type TextField = HTMLInputElement | HTMLTextAreaElement;

function notify(field: TextField, inputType: string, data: string | null): void {
  const Ctor = typeof InputEvent === 'function' ? InputEvent : Event;
  field.dispatchEvent(new Ctor('input', { bubbles: true, inputType, data } as InputEventInit));
}

function range(field: TextField): [number, number] {
  const len = field.value.length;
  const start = field.selectionStart ?? len;
  const end = field.selectionEnd ?? start;
  return [Math.min(start, end), Math.max(start, end)];
}

/** Вставить текст вместо выделения (или в позицию курсора); курсор встаёт после вставки. */
export function insertText(field: TextField, text: string): void {
  const [start, end] = range(field);
  const max = field.maxLength;
  if (max >= 0 && field.value.length - (end - start) + text.length > max) return;
  field.setRangeText(text, start, end, 'end');
  // Курсор ставим явно: happy-dom 21 считает конец вставки от длины всего значения.
  field.setSelectionRange(start + text.length, start + text.length);
  notify(field, 'insertText', text);
}

/** Backspace: стереть выделение или символ перед курсором. */
export function deleteBackward(field: TextField): void {
  let [start, end] = range(field);
  if (start === end) {
    if (start === 0) return;
    // Суррогатная пара (эмодзи) стирается целиком.
    const prev = field.value.charCodeAt(start - 1);
    start -= prev >= 0xdc00 && prev <= 0xdfff && start >= 2 ? 2 : 1;
  }
  field.setRangeText('', start, end, 'end');
  field.setSelectionRange(start, start);
  notify(field, 'deleteContentBackward', null);
}
