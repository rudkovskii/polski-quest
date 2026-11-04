// Слова над растениями (t99): на телефоне все не влезают, поэтому ближние к герою первыми, наложений нет, идёшь — подписи идут за тобой.
export interface WordLabel {
  id: string;
  text: string;
  /** Низ середины подписи, экранные CSS px. */
  x: number;
  y: number;
}
export interface WordCandidate extends WordLabel {
  /** Клеток до героя. */
  dist: number;
}

const MAX_CHARS = 16;
const CHAR_W = 6.4;
const PAD_W = 10;
const LINE_H = 15;
/** Больше подписей только мельтешат. */
const MAX_LABELS = 40;

const short = (t: string): string => (t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS - 1)}…` : t);

export function pickWordLabels(items: readonly WordCandidate[], vw: number, vh: number): WordLabel[] {
  const out: (WordLabel & { w: number })[] = [];
  for (const it of [...items].sort((a, b) => a.dist - b.dist || a.y - b.y || a.x - b.x)) {
    const text = short(it.text);
    const w = text.length * CHAR_W + PAD_W;
    if (it.x - w / 2 < 0 || it.x + w / 2 > vw || it.y - LINE_H < 0 || it.y > vh) continue;
    if (out.some((o) => Math.abs(o.x - it.x) < (o.w + w) / 2 && Math.abs(o.y - it.y) < LINE_H)) continue;
    out.push({ id: it.id, text, x: it.x, y: it.y, w });
    if (out.length >= MAX_LABELS) break;
  }
  return out.map(({ id, text, x, y }) => ({ id, text, x, y }));
}
