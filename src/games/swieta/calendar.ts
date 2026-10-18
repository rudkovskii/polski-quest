// Игра «Święta»: чистый календарь без DOM. Подвижные праздники считаются от даты Пасхи (алгоритм Meeus/Butcher), время приходит
// параметром (ctx.date()); «ближайший праздник» и подписи дат цифрами (годы без слов, решение Шэфа 5).
import type { PolskaUnit } from '../../types/polska';

const DAY_MS = 86_400_000;

/** Номер дня от 1970-01-01 (UTC): с ним удобно считать «через сколько дней». */
export const dayNo = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
export const ymdOf = (n: number): { y: number; m: number; d: number } => {
  const t = new Date(n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** День недели, 0 — воскресенье. */
export const weekdayOf = (n: number): number => (((n + 4) % 7) + 7) % 7;
export const WEEKDAY_PL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'] as const;

/** Пасха (григорианская) года `y`: номер дня. 2027 → 28.03, 2028 → 16.04. */
export function easterDay(y: number): number {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNo(y, month, day);
}

/** Отрезок дней праздника (включительно). */
export interface Span {
  start: number;
  end: number;
  /** Праздник привязан к Пасхе: у даты есть год и день недели. */
  movable: boolean;
}

export interface When {
  day?: number;
  month?: number;
  until?: { day: number; month: number };
  rule?: string;
  offset?: number;
}

const whenOf = (u: PolskaUnit): When => (u.raw.when && typeof u.raw.when === 'object' ? (u.raw.when as When) : {});

/** Даты по описанию `when` в году `y` (для зимних диапазонов «31.12–1.01» конец уходит в следующий год). null — даты нет (imieniny). */
export function spanOfWhen(w: When, y: number): Span | null {
  if (w.rule === 'easter' && typeof w.offset === 'number') {
    const n = easterDay(y) + w.offset;
    return { start: n, end: n, movable: true };
  }
  if (typeof w.day === 'number' && typeof w.month === 'number') {
    const start = dayNo(y, w.month, w.day);
    let end = start;
    if (w.until) {
      end = dayNo(y, w.until.month, w.until.day);
      if (end < start) end = dayNo(y + 1, w.until.month, w.until.day);
    }
    return { start, end, movable: false };
  }
  return null;
}

/** Даты праздника в году `y`. */
export const spanIn = (u: PolskaUnit, y: number): Span | null => spanOfWhen(whenOf(u), y);

/** Ближайшее вхождение по `when`: идёт сегодня или будет позже (`end >= today`), самое раннее. */
export function nextSpanOfWhen(w: When, today: number): Span | null {
  const y = ymdOf(today).y;
  let best: Span | null = null;
  for (const yy of [y - 1, y, y + 1]) {
    const s = spanOfWhen(w, yy);
    if (s && s.end >= today && (!best || s.start < best.start)) best = s;
  }
  return best;
}

/** Ближайшее вхождение праздника. */
export const nextSpan = (u: PolskaUnit, today: number): Span | null => nextSpanOfWhen(whenOf(u), today);

/** День года (1…366) для номера дня. */
export const dayOfYear = (n: number): number => {
  const { y } = ymdOf(n);
  return n - dayNo(y, 1, 1) + 1;
};
export const daysInYear = (y: number): number => dayNo(y + 1, 1, 1) - dayNo(y, 1, 1);

export interface Upcoming {
  unit: PolskaUnit;
  span: Span;
  /** Дней до начала; 0 — идёт сегодня. */
  days: number;
}

/** Все праздники с датой по близости: ближайший первым (при равенстве — порядок данных). Imieniny без даты не входят. */
export function upcoming(units: readonly PolskaUnit[], today: number): Upcoming[] {
  const list: (Upcoming & { i: number })[] = [];
  units.forEach((unit, i) => {
    const span = nextSpan(unit, today);
    if (span) list.push({ unit, span, days: Math.max(0, span.start - today), i });
  });
  return list.sort((a, b) => a.days - b.days || a.span.start - b.span.start || a.i - b.i).map(({ i: _i, ...x }) => x);
}

/** Ближайший праздник по реальной дате (`ctx.date()`). */
export function nearestHoliday(units: readonly PolskaUnit[], date: { y: number; m: number; d: number }): Upcoming | null {
  return upcoming(units, dayNo(date.y, date.m, date.d))[0] ?? null;
}

/** «jutro», «dziś», «za 14 dni» (по-польски «dni» для всех, кроме 1). */
export const inDays = (days: number): string => (days <= 0 ? 'dziś' : days === 1 ? 'jutro' : `za ${days} dni`);

/** Порядок посадки: ближайший по дате первым, дальше по ходу года, imieniny (без даты) в конце. */
export function seasonalOrder(units: readonly PolskaUnit[], date: { y: number; m: number; d: number }): string[] {
  const dated = upcoming(units, dayNo(date.y, date.m, date.d)).map((x) => x.unit.id);
  return [...dated, ...units.filter((u) => !dated.includes(u.id)).map((u) => u.id)];
}

/** Название для вопросов и вариантов: без пояснений после запятой и в скобках («Pierwszy dzień wiosny», «Noc Kupały»). */
export const shortName = (u: PolskaUnit): string => u.pl.split(',')[0]!.replace(/\s*\(.*\)\s*$/, '').trim();

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Дата цифрами: «24.12», «1–3.05», «31.12–1.01»; у подвижного — с годом «28.03.2027». */
export function fmtSpan(s: Span): string {
  const a = ymdOf(s.start);
  const b = ymdOf(s.end);
  const year = s.movable ? `.${a.y}` : '';
  if (s.start === s.end) return `${a.d}.${p2(a.m)}${year}`;
  if (a.m === b.m) return `${a.d}–${b.d}.${p2(a.m)}${year}`;
  return `${a.d}.${p2(a.m)}–${b.d}.${p2(b.m)}${year}`;
}

/** Сдвинутая на `dn` дней дата того же вида (для неверных вариантов подвижного праздника: день недели сохраняется). */
export const shiftSpan = (s: Span, dn: number): Span => ({ start: s.start + dn, end: s.end + dn, movable: s.movable });

export const overlaps = (a: Span, b: Span): boolean => a.start <= b.end && b.start <= a.end;

/** Сезон по месяцам (метеорологический) → кадр `w2_season_board`: 0 весна, 1 лето, 2 осень, 3 зима. */
export function seasonFrame(month: number): 0 | 1 | 2 | 3 {
  if (month >= 3 && month <= 5) return 0;
  if (month >= 6 && month <= 8) return 1;
  if (month >= 9 && month <= 11) return 2;
  return 3;
}
