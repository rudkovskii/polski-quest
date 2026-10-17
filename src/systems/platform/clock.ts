// Часы игры: `now()` — epoch ms для событий журнала и SRS, `mono()` — монотонные мс для времени
// ответа и активности. Dev-параметр `?now=` сдвигает `now()` на всю сессию (время дальше идёт):
//   ?now=2026-10-14T10:00   абсолютный момент (без пояса — локальное время устройства)
//   ?now=+1d | -2h | +90m   сдвиг от настоящего момента (d — сутки, h — часы, m — минуты)
// Сдвиг передаётся во все deps (урок, обход, итог дня, грядки), так проверяется SRS «день 0 → день 1 → …».

export interface Clock {
  now(): number;
  mono(): number;
  /** Сдвиг от настоящего времени, мс (0 — часы настоящие). */
  readonly offsetMs: number;
}

const UNIT: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000 };

/** Разобрать `?now=`: момент epoch ms или null (пусто, мусор). */
export function parseNowParam(value: string | null | undefined, realNow: number): number | null {
  // `?now=+8d` в адресной строке: URLSearchParams превращает «+» в пробел — « 8d» тоже сдвиг вперёд.
  const v = value?.replace(/^\s+(?=\d)/, '+').trim();
  if (!v) return null;
  const rel = /^([+-])(\d+(?:\.\d+)?)([dhm])$/.exec(v);
  if (rel) return realNow + (rel[1] === '-' ? -1 : 1) * Number(rel[2]) * UNIT[rel[3]!]!;
  const ts = Date.parse(v);
  return Number.isFinite(ts) ? ts : null;
}

export function createClock(nowParam?: string | null, real: () => number = () => Date.now(), mono: () => number = () => performance.now()): Clock {
  const at = parseNowParam(nowParam, real());
  const offsetMs = at === null ? 0 : at - real();
  return { now: () => real() + offsetMs, mono, offsetMs };
}
