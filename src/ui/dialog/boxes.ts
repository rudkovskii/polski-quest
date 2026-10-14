// Коробки реплики (P-07, research/05 §6б п. 1): на телефоне до 2 строк по 40 знаков. Длинная реплика
// режется на коробки по словам, по возможности по концам предложений; подпись-перевод делится так же,
// если предложений столько же, иначе целиком уходит под последнюю коробку. Чистое, без DOM.

export const BOX_COLS = 40;
export const BOX_ROWS = 2;

export interface BoxOpts {
  cols?: number;
  rows?: number;
}

/** Перенос по словам в строки ≤ cols; слово длиннее строки режется. */
export function wrapLines(text: string, cols = BOX_COLS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > cols) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Предложения: конец на . ! ? … (и закрывающие кавычки/скобки за ним), дальше пробел. */
export function sentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?…]["»”)]*)\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Box {
  text: string;
  /** Сколько предложений закончено к концу этой коробки (для деления подписи). */
  sentEnd: number;
}

/** Реплика → коробки ≤ rows строк по cols. Предложения не рвутся, пока помещаются целиком. */
export function splitBoxes(text: string, o: BoxOpts = {}): Box[] {
  const cols = o.cols ?? BOX_COLS;
  const rows = o.rows ?? BOX_ROWS;
  const fits = (s: string): boolean => wrapLines(s, cols).length <= rows;
  const out: Box[] = [];
  let cur = '';
  let done = 0;
  const flush = (): void => {
    if (cur) out.push({ text: cur, sentEnd: done });
    cur = '';
  };
  for (const s of sentences(text)) {
    const cand = cur ? `${cur} ${s}` : s;
    if (fits(cand)) {
      cur = cand;
      done++;
      continue;
    }
    flush();
    if (fits(s)) {
      cur = s;
      done++;
      continue;
    }
    // Предложение длиннее коробки: по строкам, хвост может дописаться следующим предложением.
    const lines = wrapLines(s, cols);
    for (let i = 0; i < lines.length; i += rows) {
      const chunk = lines.slice(i, i + rows).join(' ');
      if (i + rows >= lines.length) {
        cur = chunk;
        done++;
      } else out.push({ text: chunk, sentEnd: done });
    }
  }
  flush();
  return out;
}

/**
 * Подпись к каждой коробке: если предложений в переводе столько же, сколько в польском, — те же
 * предложения, что закончились в коробке; иначе вся подпись под последней коробкой.
 */
export function captionsFor(boxes: readonly Box[], plText: string, ru: string | undefined): (string | undefined)[] {
  if (!ru) return boxes.map(() => undefined);
  if (boxes.length <= 1) return boxes.map(() => ru);
  const plN = sentences(plText).length;
  const ruS = sentences(ru);
  if (ruS.length !== plN) return boxes.map((_, i) => (i === boxes.length - 1 ? ru : undefined));
  let from = 0;
  return boxes.map((b) => {
    const part = ruS.slice(from, b.sentEnd).join(' ');
    from = Math.max(from, b.sentEnd);
    return part || undefined;
  });
}
