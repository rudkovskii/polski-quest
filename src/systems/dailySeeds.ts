// Случайные слова дня (`edition.dailyRandom`, просьба Оли 23.10: «чтобы слова рандомно попадались, не только те, что я выбрала»).
// В первый вход нового календарного дня N ещё не посаженных слов базы садятся сами, как из словаря (грядка или мешок).
// Только дописывает посадки: журнал ответов и выращенное не трогает. День, за который слова уже были, лежит одним флагом
// `daily:<день>` в `Save.hints` (старый заменяется), как `morning:<день>`. Чистая логика, без браузера.

export const DAILY_HINT = 'daily:';

/** День, за который слова дня уже посажены; null — ни разу. */
export function dailySeenDay(hints: readonly string[]): number | null {
  const h = hints.find((x) => x.startsWith(DAILY_HINT));
  const n = h ? Number(h.slice(DAILY_HINT.length)) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Подсказки с отметкой дня `day` (старая отметка убрана). */
export function markDaily(hints: readonly string[], day: number): string[] {
  return [...hints.filter((x) => !x.startsWith(DAILY_HINT)), `${DAILY_HINT}${day}`];
}

/**
 * Сажать ли сегодня. `n` ≤ 0 — функция выключена (игра Шэфа); `started` — игрок уже что-то сажал
 * (новичок сначала проходит первые шаги со словарём, случайные слова ему не подсыпаем).
 */
export function dailyDue(o: { n: number; day: number; seen: number | null; started: boolean }): boolean {
  return o.n > 0 && o.started && o.seen !== o.day;
}

/** Генератор по зерну (mulberry32): один и тот же день — один и тот же набор. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** До `n` случайных id из `candidates` (без повторов), порядок случайный; зерно — номер дня. */
export function pickDaily(candidates: readonly string[], n: number, day: number): string[] {
  const pool = [...new Set(candidates)];
  const rnd = seeded(day * 2654435761);
  const k = Math.min(Math.max(0, n), pool.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, k);
}

/** Строка для утра или тоста: «🎲 Новые слова дня: dom, kot, … · в мешке ждут грядки: 3». */
export function dailyLine(words: readonly string[], bag: number): string {
  return `🎲 Новые слова дня: ${words.join(', ')}${bag > 0 ? ` · ждут грядки в мешке: ${bag}` : ''}`;
}
