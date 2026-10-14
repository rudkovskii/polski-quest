// Стили экранной клавиатуры по палитре игры. Вставляются один раз на документ.

const css = `
.pq-kb-field { -webkit-user-select: text; user-select: text; }
.pq-kb-strip, .pq-kb-qwerty { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation; box-sizing: border-box; }
.pq-kb-strip { display: flex; gap: 4px; margin: 0 0 6px; }
.pq-kb-qwerty { display: flex; flex-direction: column; gap: 5px; margin: 8px 0 0; padding: 6px; border-radius: 8px; background: #1a1c2c; max-height: 40vh; max-height: 40dvh; }
.pq-kb-qwerty[hidden] { display: none; }
.pq-kb-row { display: flex; gap: 5px; justify-content: center; }
.pq-kb-key { flex: 1 1 0; min-width: 0; height: clamp(28px, calc((40vh - 40px) / 4), 46px); height: clamp(28px, calc((40dvh - 40px) / 4), 46px);
  padding: 0; border: 2px solid #566c86; border-radius: 6px; background: #333c57; color: #f4f4f4;
  font: 600 18px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; cursor: pointer; touch-action: manipulation; }
.pq-kb-strip .pq-kb-key { height: 40px; font-size: 20px; }
.pq-kb-key:active { background: #3b5dc9; transform: translateY(1px); }
.pq-kb-key[data-on] { background: #3b5dc9; border-color: #41a6f6; }
.pq-kb-key[data-lock] { background: #38b764; border-color: #a7f070; color: #1a1c2c; }
.pq-kb-key[data-polish] { color: #ffcd75; }
.pq-kb-mod { flex-grow: 1.4; font-size: 16px; background: #29366f; }
.pq-kb-space { flex-grow: 4; }
.pq-kb-enter { flex-grow: 1.6; background: #257179; border-color: #38b764; }
`;

export function ensureKeyboardStyle(doc: Document): void {
  if (doc.getElementById('pq-kb-style')) return;
  const style = doc.createElement('style');
  style.id = 'pq-kb-style';
  style.textContent = css;
  doc.head.append(style);
}
