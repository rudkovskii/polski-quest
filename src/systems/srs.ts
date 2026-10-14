// SRS (ТЗ §4.1): порт srs.js тренажёра (упрощённый SM-2, оценки 0–3) с лестницей 1 → 3 → 7 → 16 → 35,
// дальше × ef. Чистые функции: время приходит параметром, вход не мутируется. Позже FSRS встанет
// за этот же интерфейс (`fresh`, `review`).
import type { Tuning } from '../types/content';
import { unit } from './hash';
import type { CardId, CardState, CardType } from './progress';
import { dayStartAfter, type TimeOpts, type Ts } from './time';

export type Grade = 0 | 1 | 2 | 3;

/** Поля tuning, которые читает SRS. */
export type SrsTuning = Pick<Tuning, 'ladder' | 'efMin' | 'efMax' | 'fuzz' | 'dayStartHour'>;

export const EF_START = 2.5;
/** Разброс включается с этого интервала (дни), §4.1. */
export const FUZZ_FROM_DAYS = 7;
/** Предохранитель: ×ef×1.3 растёт экспоненциально, без потолка серия «Легко» уводит due за 9999 год. */
export const MAX_INTERVAL_DAYS = 36500;

/** Новая карточка: reps 0, interval 0, ef 2.5, due = now. */
export function fresh(now: Ts): CardState {
  return { reps: 0, interval: 0, ef: EF_START, due: now, lapses: 0, lastReviewAt: now, lastGrade: 0, maxInterval: 0, createdAt: now };
}

/** SM-2: q = [2,3,4,5][grade]; ef в [efMin, efMax]. */
export function nextEf(ef: number, grade: Grade, t: Pick<SrsTuning, 'efMin' | 'efMax'>): number {
  const q = [2, 3, 4, 5][grade]!;
  const next = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  // Округление гасит хвосты плавающей точки, чтобы два устройства получили побитово одинаковый ef.
  return Math.round(Math.min(t.efMax, Math.max(t.efMin, next)) * 1e6) / 1e6;
}

/** Номинальный интервал (дни) после ответа. r = reps до ответа, L = ladder. */
export function nextInterval(card: Pick<CardState, 'reps' | 'interval' | 'ef'>, grade: Grade, ladder: readonly number[]): number {
  const r = card.reps;
  const n = ladder.length;
  const top = ladder[n - 1]!;
  switch (grade) {
    case 0:
      return 0;
    case 1:
      return r === 0 ? ladder[0]! : Math.max(card.interval, ladder[0]!);
    case 2:
      return r < n ? ladder[r]! : Math.round(card.interval * card.ef);
    case 3:
      if (r + 1 < n) return ladder[r + 1]!;
      if (r + 1 === n) return Math.round(top * card.ef);
      return Math.round(card.interval * card.ef * 1.3);
  }
}

/**
 * Сдвиг due в днях для интервала ≥ 7: ±fuzz (5 %), детерминированно от hash(cardId + reps).
 * Номинальный `interval` не меняется (лестница остаётся 1, 3, 7, 16, 35), сдвигается только due.
 */
export function fuzzDays(interval: number, cardId: CardId, reps: number, fuzz: number): number {
  if (interval < FUZZ_FROM_DAYS || fuzz <= 0) return 0;
  const u = unit(`${cardId}${reps}`) * 2 - 1; // [-1, 1)
  return Math.round(interval * fuzz * u);
}

/** Ответ по карточке. Не мутирует `card`. `time.tz` — пояс игрока (по умолчанию пояс устройства). */
export function review(card: CardState, grade: Grade, now: Ts, t: SrsTuning, cardId: CardId, time: TimeOpts = {}): CardState {
  const opts: TimeOpts = { dayStartHour: time.dayStartHour ?? t.dayStartHour, tz: time.tz };
  const ef = nextEf(card.ef, grade, t);
  const interval = Math.min(MAX_INTERVAL_DAYS, nextInterval(card, grade, t.ladder));
  const base = { ...card, ef, interval, lastReviewAt: now, lastGrade: grade, maxInterval: Math.max(card.maxInterval, interval) };
  if (grade === 0) return { ...base, reps: 0, lapses: card.lapses + 1, due: now };
  const reps = grade === 1 ? card.reps : card.reps + 1;
  const due = dayStartAfter(now, interval + fuzzDays(interval, cardId, reps, t.fuzz), opts);
  return { ...base, reps, due };
}

// ── Карточки слова (§3.4, §4.1).

export const CARD_TYPES: readonly CardType[] = ['rec', 'lis', 'pro', 'pair'];

export function cardId(item: string, type: CardType): CardId {
  return `${item}#${type}`;
}

/** 'lx.kawa#rec' → { item: 'lx.kawa', type: 'rec' }; без известного типа → null. */
export function parseCardId(id: CardId): { item: string; type: CardType } | null {
  const i = id.lastIndexOf('#');
  if (i <= 0) return null;
  const type = id.slice(i + 1) as CardType;
  return CARD_TYPES.includes(type) ? { item: id.slice(0, i), type } : null;
}

/**
 * Исключение заказов (§4.13): ответ в заказе за ≤ earlyDays до due пишется как `rev`, только если
 * слово зрелое: earlyDays меньше 10 % интервала. Иначе 0 (ранний ответ SRS не двигает).
 */
export function orderEarlyDays(card: Pick<CardState, 'interval'> | undefined, earlyDays: number): number {
  if (!card || earlyDays <= 0) return 0;
  return earlyDays < card.interval * 0.1 ? earlyDays : 0;
}
