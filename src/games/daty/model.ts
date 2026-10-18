// Игра 3: Daty — чистая модель (без DOM): справочники порядковых и месяцев, формы родительного падежа, сетка месяца, барабаны,
// варианты ответов и проверка. Рисует всё это `view.ts`, склеивает `index.ts`.
import type { GameCtx, GameTask, PolskaUnit } from '../../types/polska';
import { shuffle, sameTiles } from '../kit';

export interface MonthRow {
  n: number;
  nom: string;
  gen: string;
  nom_ru: string;
  gen_ru: string;
}
export interface OrdinalRow {
  n: number;
  nom: string;
  gen: string;
  gen_tiles: readonly string[];
}
export interface DayMonth {
  day: number;
  month: number;
}

/** Режимы задания: co — «Co się stało 3 maja?» (A); choice — «Kiedy?» кнопками; drums — «Kiedy?» барабанами; pokaz — тап по сетке; say — собрать слова. */
export type DatyMode = 'co' | 'choice' | 'drums' | 'pokaz' | 'say';

/** Задание Daty. `answer`: строка (choice, co), слова (say) или дата (drums, pokaz). */
export interface DatyTask extends GameTask {
  mode: DatyMode;
  day: number;
  month: number;
  /** Год события цифрой (null — не привязан): показывается рядом, словами не спрашивается. */
  year: number | null;
  /** Спокойная подача: без зелёной вспышки и анимации обводки. */
  calm: boolean;
  /** Строка вопроса по-польски и русская подсказка. */
  q: string;
  hint: string;
  /** Событие единицы (для подписи), как в данных. */
  event: string;
  /** Кнопки (choice, co) или плитки (say). */
  options: string[];
  answer: string | string[] | DayMonth;
  /** Календарь: год сетки, месяц первого открытия, сегодня. */
  cal: { year: number; start: number; today: { y: number; m: number; d: number } };
  /** Где стоят барабаны сначала. */
  drum: DayMonth;
}

export const WEEKDAYS = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'] as const;

/** Значки памятных дат (поле `icon` в данных) — кадры атласа: знич декора, флажок, мини-предметы огорода (та же палитра). */
export const ICON_FRAME: Record<string, string> = { candle: 'w2_znicz/0', sword: 'castle', flag: 'flag_pl', cross: 'church', eu_star: 'star', dove: 'bird' };
/** Запасной глиф, если кадра нет. */
export const ICON_GLYPH: Record<string, string> = { candle: '🕯', sword: '⚔', flag: '⚑', cross: '✝', eu_star: '★', dove: '🕊' };
export const iconOf = (icon: unknown): string => ICON_GLYPH[String(icon)] ?? '•';

const arr = <T>(v: unknown): readonly T[] => (Array.isArray(v) ? (v as T[]) : []);

export const monthsOf = (doc: Readonly<Record<string, unknown>>): readonly MonthRow[] => arr<MonthRow>(doc.months);
export const ordinalsOf = (doc: Readonly<Record<string, unknown>>): readonly OrdinalRow[] => arr<OrdinalRow>(doc.ordinals);

export const monthRow = (doc: Readonly<Record<string, unknown>>, n: number): MonthRow | undefined => monthsOf(doc).find((m) => m.n === n);
export const ordinalRow = (doc: Readonly<Record<string, unknown>>, n: number): OrdinalRow | undefined => ordinalsOf(doc).find((o) => o.n === n);

/** `3, 5` → `trzeciego maja` (родительный: и порядковое, и месяц). '' — если дня или месяца нет в справочниках. */
export function sayDate(doc: Readonly<Record<string, unknown>>, day: number, month: number): string {
  const o = ordinalRow(doc, day);
  const m = monthRow(doc, month);
  return o && m ? `${o.gen} ${m.gen}` : '';
}
/** То же плитками: `['trzeciego', 'maja']`, `31.08` → `['trzydziestego', 'pierwszego', 'sierpnia']`. */
export function sayTiles(doc: Readonly<Record<string, unknown>>, day: number, month: number): string[] {
  const o = ordinalRow(doc, day);
  const m = monthRow(doc, month);
  return o && m ? [...o.gen_tiles, m.gen] : [];
}
/** Подпись «3 maja» для кнопок (число цифрой, месяц в родительном). */
export const labelDate = (doc: Readonly<Record<string, unknown>>, day: number, month: number): string => `${day} ${monthRow(doc, month)?.gen ?? month}`;

/** Дата единицы: day/month из данных. */
export const dateOfUnit = (u: PolskaUnit): DayMonth => ({ day: Number(u.raw.day), month: Number(u.raw.month) });
export const yearOfUnit = (u: PolskaUnit): number | null => (typeof u.raw.year === 'number' ? u.raw.year : null);
/** Спокойная подача: даты памяти (`tone: solemn|quiet`). */
export const isCalm = (u: PolskaUnit): boolean => u.raw.tone === 'solemn' || u.raw.tone === 'quiet';

// ---- сетка месяца ----

export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 31;
/** День недели 1-го числа, неделя с понедельника: 0 = pon. … 6 = niedz. */
export const firstOffset = (y: number, m: number): number => (new Date(y, m - 1, 1).getDay() + 6) % 7;

/** Недели месяца по 7 ячеек: число или null (пустая клетка до 1-го и после последнего). */
export function monthGrid(y: number, m: number): (number | null)[][] {
  const cells: (number | null)[] = [...Array<null>(firstOffset(y, m)).fill(null), ...Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Листание месяцев по кругу: 12 → 1, 1 → 12. */
export const shiftMonth = (m: number, delta: number): number => ((((m - 1 + delta) % 12) + 12) % 12) + 1;

/** С какого месяца открыть календарь в «Pokaż»: с текущего, но не с нужного (иначе задание в один тап). */
export const startMonth = (answerMonth: number, todayMonth: number): number => (todayMonth === answerMonth ? shiftMonth(todayMonth, 1) : todayMonth);

// ---- барабаны ----

/** Шаг барабана по кругу в диапазоне [lo, hi]: 31 → 1, 1 → 31. */
export const spin = (v: number, delta: number, lo: number, hi: number): number => {
  const n = hi - lo + 1;
  return lo + ((((v - lo + delta) % n) + n) % n);
};
/** Стартовая позиция барабанов: не на верном ответе. */
export const drumStart = (a: DayMonth): DayMonth => (a.day === 15 && a.month === 6 ? { day: 16, month: 7 } : { day: 15, month: 6 });

// ---- варианты ----

/** Кнопки «Kiedy?»: верная дата + wrong_dates (3), без повторов, перемешаны. Подписи — «11 listopada». */
export function choiceOptions(ctx: GameCtx, u: PolskaUnit): { options: string[]; answer: string } {
  const a = dateOfUnit(u);
  const answer = labelDate(ctx.doc, a.day, a.month);
  const wrong = arr<DayMonth>(u.raw.wrong_dates).map((w) => labelDate(ctx.doc, w.day, w.month));
  const seen = new Set([answer]);
  const out: string[] = [];
  for (const w of wrong) if (!seen.has(w)) (seen.add(w), out.push(w));
  // Подстраховка, если в данных меньше трёх неверных: тот же день в других месяцах.
  for (const m of shuffle(monthsOf(ctx.doc).map((x) => x.n), ctx.rand)) {
    if (out.length >= 3) break;
    const l = labelDate(ctx.doc, a.day, m);
    if (!seen.has(l)) (seen.add(l), out.push(l));
  }
  return { options: shuffle([answer, ...out.slice(0, 3)], ctx.rand), answer };
}

/** Кнопки «Co się stało…?»: событие (pl единицы) + события из q.co.wrong_ids. */
export function coOptions(ctx: GameCtx, u: PolskaUnit): { options: string[]; answer: string } {
  const answer = u.pl;
  const q = (u.raw.q ?? {}) as { co?: { wrong_ids?: string[] } };
  const seen = new Set([answer]);
  const out: string[] = [];
  const add = (v: string | undefined): void => {
    if (v && !seen.has(v) && out.length < 3) (seen.add(v), out.push(v));
  };
  for (const id of q.co?.wrong_ids ?? []) add(ctx.unit(id)?.pl);
  for (const x of shuffle(ctx.units, ctx.rand)) add(x.pl);
  return { options: shuffle([answer, ...out], ctx.rand), answer };
}

/** Плитки «Powiedz słowami»: верные слова + неверные формы из данных (порядковое в именительном/женском, месяц в именительном/местном). */
export function sayPool(u: PolskaUnit, rand: () => number): { pool: string[]; answer: string[] } {
  const t = (u.raw.tiles ?? {}) as { pl?: string[]; distract?: string[] };
  const answer = [...(t.pl ?? [])];
  const wrong = (t.distract ?? []).filter((w) => !answer.includes(w));
  return { pool: shuffle([...answer, ...wrong], rand), answer };
}

// ---- проверка ----

const asDayMonth = (a: unknown): DayMonth | null => {
  if (!a || typeof a !== 'object') return null;
  const { day, month } = a as Partial<DayMonth>;
  return typeof day === 'number' && typeof month === 'number' ? { day, month } : null;
};

export const sameDate = (a: unknown, b: DayMonth): boolean => {
  const x = asDayMonth(a);
  return !!x && x.day === b.day && x.month === b.month;
};

export const sameSay = (given: unknown, want: readonly string[]): boolean => {
  const g = Array.isArray(given) ? given.map(String) : typeof given === 'string' ? given.split(/\s+/).filter(Boolean) : [];
  return g.length > 0 && sameTiles(g, want);
};
