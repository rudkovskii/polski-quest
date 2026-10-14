// Игровое время (ТЗ §0, §4.1): сутки с границей dayStartHour (04:00) локального времени.
// Чистые функции: момент приходит параметром `ts`/`now`, часовой пояс — параметром `tz`
// (IANA, например 'Europe/Warsaw'); без `tz` берётся пояс устройства через Intl.

export type Ts = number; // epoch ms
export type Day = string; // 'YYYY-MM-DD' игрового дня

export interface TimeOpts {
  /** Час начала игрового дня, по умолчанию 4 (tuning.dayStartHour). */
  dayStartHour?: number;
  /** IANA-пояс. undefined = пояс устройства. */
  tz?: string;
}

export const DEFAULT_DAY_START_HOUR = 4;
const DAY_MS = 86_400_000;

interface Wall {
  y: number;
  m: number; // 1..12
  d: number;
  h: number;
  mi: number;
  s: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string | undefined): Intl.DateTimeFormat {
  const key = tz ?? '';
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** Настенное время момента `ts` в поясе `tz`. */
function wallOf(ts: Ts, tz: string | undefined): Wall {
  const w: Wall = { y: 0, m: 0, d: 0, h: 0, mi: 0, s: 0 };
  for (const p of formatter(tz).formatToParts(ts)) {
    const n = Number(p.value);
    switch (p.type) {
      case 'year': w.y = n; break;
      case 'month': w.m = n; break;
      case 'day': w.d = n; break;
      case 'hour': w.h = n === 24 ? 0 : n; break;
      case 'minute': w.mi = n; break;
      case 'second': w.s = n; break;
      default: break;
    }
  }
  return w;
}

/** Смещение пояса в момент `ts`, мс (местное − UTC). */
function offsetAt(ts: Ts, tz: string | undefined): number {
  const w = wallOf(ts, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Момент, когда в поясе `tz` настенные часы показывают y-m-d h:00. */
function wallToTs(y: number, m: number, d: number, h: number, tz: string | undefined): Ts {
  const guess = Date.UTC(y, m - 1, d, h);
  const t1 = guess - offsetAt(guess, tz);
  const off2 = offsetAt(t1, tz);
  return guess - off2;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function parseDay(day: Day): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`bad day: ${day}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fmtUtcDay(ms: number): Day {
  const t = new Date(ms);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isDay(x: unknown): x is Day {
  return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
}

/** Календарная арифметика по дням: '2026-12-31' + 1 = '2027-01-01'. */
export function addDays(day: Day, n: number): Day {
  const [y, m, d] = parseDay(day);
  return fmtUtcDay(Date.UTC(y, m - 1, d + n));
}

/** Сколько дней от a до b (b − a), может быть отрицательным. */
export function daysBetween(a: Day, b: Day): number {
  const [ya, ma, da] = parseDay(a);
  const [yb, mb, db] = parseDay(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

/** ISO-день недели: 1 = понедельник … 7 = воскресенье. */
export function isoWeekday(day: Day): number {
  const [y, m, d] = parseDay(day);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Игровой день момента `ts`: до dayStartHour местного времени — ещё вчерашний день. */
export function dayOf(ts: Ts, opts: TimeOpts = {}): Day {
  const h0 = opts.dayStartHour ?? DEFAULT_DAY_START_HOUR;
  const w = wallOf(ts, opts.tz);
  const cal = `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
  return w.h < h0 ? addDays(cal, -1) : cal;
}

/** Момент начала игрового дня `day` (04:00 местного времени этого дня). */
export function dayStartOf(day: Day, opts: TimeOpts = {}): Ts {
  const [y, m, d] = parseDay(day);
  return wallToTs(y, m, d, opts.dayStartHour ?? DEFAULT_DAY_START_HOUR, opts.tz);
}

/** Начало игрового дня, в который попадает `ts`. */
export function dayStart(ts: Ts, opts: TimeOpts = {}): Ts {
  return dayStartOf(dayOf(ts, opts), opts);
}

/**
 * Начало игрового дня через `n` дней после дня момента `ts`.
 * Для SRS (§4.1): due = 04:00 нужного дня; на переходе часов сутки бывают 23 или 25 часов.
 */
export function dayStartAfter(ts: Ts, n: number, opts: TimeOpts = {}): Ts {
  return dayStartOf(addDays(dayOf(ts, opts), n), opts);
}
