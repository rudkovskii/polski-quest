// Слова над растениями (t99, t115, D-147): подпись есть у каждого растения на экране и не зависит от того, где стоит герой.
// Соседи по ряду стоят вплотную, поэтому подписи в два яруса по чётности колонки: у каждой своя ширина в две клетки.
// Не влезает — мельче шрифт; длинная фраза на телефоне сокращается многоточием. Подпись не прячется никогда.
export interface WordLabel {
  id: string;
  text: string;
  /** Низ середины подписи, экранные CSS px. */
  x: number;
  y: number;
  /** Кегль, CSS px. */
  size: number;
}
export interface WordCandidate {
  id: string;
  text: string;
  /** Низ середины места над растением, экранные CSS px. */
  x: number;
  y: number;
  /** Колонка грядки: ярус подписи по её чётности. */
  col: number;
}

export const FONT_MAX = 11;
export const FONT_MIN = 6;
/** Ширина знака в долях кегля (жирный шрифт, с запасом; замер в браузере 09.11): узкие, широкие, заглавные, остальные. */
const NARROW = new Set([...'iljłIíì.,:;!\'’ ']);
const SEMI = new Set([...'ftrj()-']);
const WIDE = new Set([...'mwMWŚ']);
const charEm = (c: string): number => (NARROW.has(c) ? 0.34 : SEMI.has(c) ? 0.45 : WIDE.has(c) ? 0.9 : c !== c.toLowerCase() ? 0.72 : 0.6);
const ems = (t: string): number => [...t].reduce((a, c) => a + charEm(c), 0) * 1.06;
const PAD_W = 7;
const GAP = 4;
/** Высота строки в долях кегля. */
export const LINE_EM = 1.25;
/** Запас за краем экрана: растение уезжает из кадра — подпись уходит вместе с ним. */
const OFF = 40;

export const textWidth = (text: string, size: number): number => ems(text) * size + PAD_W;

/** Кегль и текст под ширину `room`: крупнее, сколько влезает; на самом мелком не влезло — многоточие (полный текст — в карточке растения). */
export function fitText(text: string, room: number): { text: string; size: number } {
  const size = Math.min(FONT_MAX, Math.floor(((room - PAD_W) / ems(text)) * 2) / 2);
  if (size >= FONT_MIN) return { text, size };
  let n = text.length - 1;
  while (n > 1 && textWidth(`${text.slice(0, n).trimEnd()}…`, FONT_MIN) > room) n--;
  return { text: `${text.slice(0, n).trimEnd()}…`, size: FONT_MIN };
}

/** `cell` — клетка на экране, CSS px (TILE × zoom). */
export function layoutWordLabels(items: readonly WordCandidate[], cell: number, vw: number, vh: number): WordLabel[] {
  const room = cell * 2 - GAP;
  const lift = Math.max(Math.round(cell * 0.45), Math.ceil(FONT_MAX * LINE_EM));
  const out: WordLabel[] = [];
  for (const it of items) {
    if (it.x < -OFF || it.x > vw + OFF || it.y < -OFF || it.y > vh + OFF + cell) continue;
    // Своя полоса подписи — две клетки вокруг растения; у края экрана полоса обрезается краем, подпись сжимается в неё.
    // Растение за кадром — подпись уходит вместе с ним, не прижимается.
    const inside = it.x >= 0 && it.x <= vw;
    const min = Math.min(room, PAD_W + FONT_MIN * 2);
    const l = Math.min(Math.max(it.x - room / 2, 0), vw - min);
    const r = Math.max(Math.min(it.x + room / 2, vw), min);
    const { text, size } = fitText(it.text, inside ? r - l : room);
    const x = inside ? (l + r) / 2 : it.x;
    out.push({ id: it.id, text, size, x, y: it.y - (Math.abs(it.col) % 2 ? lift : 0) });
  }
  return out;
}
