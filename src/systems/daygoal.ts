// Цель дня и «утро»: чистые подсчёты по журналу ответов (HUD «Сегодня: полито N», карточка «Вчера: …»).
// Только чтение: журнал и `grownByDay` приходят из огорода, время (номер дня) — параметром.
import type { AnswerEntry } from './garden';

/** Цель дня для HUD. */
export interface DayGoal {
  /** Верных ответов сегодня (каждый = один полив). */
  watered: number;
  /** Растений, которые созреют завтра (`ripeSoon().tomorrow`). */
  tomorrow: number;
  /** Растущих, которым после сегодняшнего зачёта остаётся один день до урожая (`ripeSoon().soon`, F5b). */
  soon?: number;
}

/** Итог прошлой игры для утренней карточки. */
export interface Recap {
  /** «Вчера» (день подряд) или «В прошлый раз» (был перерыв). */
  label: 'Вчера' | 'В прошлый раз';
  day: number;
  grown: number;
  watered: number;
}

/** Верных ответов за календарный день. */
export function wateredOn(log: readonly Pick<AnswerEntry, 'day' | 'ok'>[], day: number): number {
  let n = 0;
  for (const e of log) if (e.ok && e.day === day) n++;
  return n;
}

/** Последний день до `today`, в который были ответы, и его итоги; null — раньше не играли. */
export function recapBefore(log: readonly Pick<AnswerEntry, 'day' | 'ok'>[], grownByDay: ReadonlyMap<number, number>, today: number): Recap | null {
  let last = -Infinity;
  for (const e of log) if (e.day < today && e.day > last) last = e.day;
  if (!Number.isFinite(last)) return null;
  return { label: last === today - 1 ? 'Вчера' : 'В прошлый раз', day: last, grown: grownByDay.get(last) ?? 0, watered: wateredOn(log, last) };
}

/**
 * Текст плашки HUD: «Сегодня: полито 8 · созреет завтра 5». Завтра ничего не созреет, но к урожаю идут растения
 * (им остаётся день): «Сегодня: полито 8 · к урожаю идут 10» (F5b: утром второго дня «ноль» не демотивирует).
 */
export function goalText(g: DayGoal): string {
  const tail = g.tomorrow > 0 ? ` · созреет завтра ${g.tomorrow}` : g.soon && g.soon > 0 ? ` · к урожаю идут ${g.soon}` : '';
  return `Сегодня: полито ${g.watered}${tail}`;
}

/**
 * Строки утренней карточки про урожай. Сегодня есть что собирать — «Сегодня созреет: K». Иначе, если растения идут к урожаю
 * (`soon`), честное «ноль» дополняется надеждой: «Сегодня созреет: 0 · к завтрашнему урожаю идут N: поливай сегодня».
 */
export function morningRipeLines(today: number, soon: number): { label: string; value: string; extra?: string } {
  if (today > 0 || soon <= 0) return { label: 'Сегодня созреет:', value: ` ${today}` };
  return { label: 'Сегодня созреет:', value: ` 0`, extra: `К урожаю идут ${soon}: поливай сегодня, и завтра они созреют` };
}

/** Нужна ли утренняя карточка: первый заход в новый день (флаг `seen` — последний показанный день) и есть что вспомнить. */
export function morningAction(today: number, seen: number | null, recap: Recap | null): 'show' | 'mark' | 'none' {
  if (seen === today) return 'none';
  return recap ? 'show' : 'mark';
}
