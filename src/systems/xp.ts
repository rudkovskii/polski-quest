// Путь к A1 (V11c): очки, 20 уровней (просто номера, без званий) и итоговый A1. Чистая часть, без браузера и хранилища: уровень не хранится, а выводится
// из состояния огорода (журнал ответов), поэтому старые сохранения пересчитываются сами.
//
// Очки: выращенное слово 1, выращенная фраза сборки (≥ 3 плиток) 2, короткая фраза (растёт в играх 1 и 2 как слово) 1.
// Растущее считается частично (только после первого ответа по нему), чтобы полоска двигалась с первых ответов: семечко 0,1 / росток 0,3 / кустик 0,6 веса.
// Перезревшее, как и собранное, остаётся выращенным. A1 = вся база: все очки (слова + короткие фразы + 2 × фразы сборки).
import type { Phrase, Word } from '../types/content';
import { WORDS, PHRASES } from './content';
import type { ItemState } from './garden';
import { canAssemble } from './quiz';

export const SUB_COUNT = 20;

export interface Sublevel {
  /** Номер 0…20 (0 — старт, до первого порога; 21 — A1). */
  n: number;
  /** «Poziom 7», старт — «Start», финал — «A1». */
  pl: string;
  /** «Уровень 7», старт — «Старт», финал — «A1». */
  ru: string;
}

const S = (n: number, pl: string, ru: string): Sublevel => ({ n, pl, ru });

/** Уровни: 0 — старт, 1…20 — «Poziom N · Уровень N», дальше A1 (`A1_LEVEL`). Без тематических званий: просто номера. */
export const SUBLEVELS: readonly Sublevel[] = [S(0, 'Start', 'Старт'), ...Array.from({ length: SUB_COUNT }, (_, i) => S(i + 1, `Poziom ${i + 1}`, `Уровень ${i + 1}`))];

export const A1_LEVEL: Sublevel = S(SUB_COUNT + 1, 'A1', 'A1');

/** Короткая подпись уровня для HUD, кровати и итога раунда: «Старт», «Уровень 7/20», «A1». */
export function levelLabel(n: number): string {
  return n <= 0 ? SUBLEVELS[0]!.ru : n > SUB_COUNT ? A1_LEVEL.ru : `Уровень ${n}/${SUB_COUNT}`;
}

/** Куда ведёт следующий порог: «уровня 8» (для «До уровня 8») или «A1» после 20-го. */
export const nextTarget = (n: number): string => (n >= SUB_COUNT ? A1_LEVEL.ru : `уровня ${n + 1}`);

/** Доля веса за растущее (стадия → доля). */
export const PARTIAL_BY_STAGE = { seed: 0.1, sprout: 0.3, bush: 0.6 } as const;

/** Из чего состоит база: слова, фразы сборки, короткие фразы, и весь путь в очках. */
export interface Base {
  words: number;
  phrases: number;
  assemble: number;
  short: number;
  /** Очки A1: слова + короткие фразы + 2 × фразы сборки. */
  total: number;
}

export function baseOf(words: readonly Word[], phrases: readonly Phrase[]): Base {
  const assemble = phrases.filter(canAssemble).length;
  const short = phrases.length - assemble;
  return { words: words.length, phrases: phrases.length, assemble, short, total: words.length + short + 2 * assemble };
}

export const BASE: Base = baseOf(WORDS, PHRASES);

/** Вес элемента в очках: слово и короткая фраза 1, фраза сборки 2. */
const ASSEMBLE_IDS: ReadonlySet<string> = new Set(PHRASES.filter(canAssemble).map((p) => p.id));
export const weightOf = (id: string): number => (ASSEMBLE_IDS.has(id) ? 2 : 1);

/**
 * Пороги уровней 1…20 в очках: первые частые (5, 15, 30, 50, 80, 120), дальше шаг растёт, 20-й — 95 % пути.
 * Строго возрастают, кратны 5 (при малой базе — целые).
 */
export function thresholds(total: number): number[] {
  const end = Math.max(SUB_COUNT, Math.round(total * 0.95));
  const early = [5, 15, 30, 50, 80, 120];
  const out: number[] = [];
  if (end >= 400) {
    out.push(...early);
    // d_j = a + b·j, d_1 = 50: сумма шагов от 120 до end за 14 шагов.
    const n = SUB_COUNT - early.length;
    const span = end - 120;
    const b = (span - 50 * n) / ((n * (n + 1)) / 2 - n);
    const a = 50 - b;
    let v = 120;
    for (let j = 1; j <= n; j++) {
      v += a + b * j;
      out.push(j === n ? end : Math.round(v / 5) * 5);
    }
  } else {
    for (let k = 1; k <= SUB_COUNT; k++) out.push(Math.max(1, Math.round((end * (k / SUB_COUNT) ** 1.6))));
  }
  for (let i = 1; i < out.length; i++) if (out[i]! <= out[i - 1]!) out[i] = out[i - 1]! + 1;
  return out;
}

export const THRESHOLDS: readonly number[] = thresholds(BASE.total);

/** Очки огорода: выращенное и частичный зачёт за растущее (без перезревших, они уже выращены). */
export function pointsOf(items: Iterable<ItemState>, weight: (id: string) => number = weightOf): { grown: number; partial: number; growing: number } {
  let grown = 0;
  let partial = 0;
  let growing = 0;
  for (const it of items) {
    const w = weight(it.id);
    if (it.harvests > 0) {
      grown += w;
      continue;
    }
    if (it.stage === null) continue;
    growing++;
    // Посаженное, но ни разу не отвеченное не считается: путь двигают ответы, а не посадки.
    if (it.answers === 0) continue;
    partial += w * PARTIAL_BY_STAGE[it.stage];
  }
  return { grown, partial, growing };
}

export interface PathInfo {
  /** 0…20 — уровень, 21 — A1. */
  sub: number;
  pl: string;
  ru: string;
  /** 0…1 внутри уровня (до следующего порога). */
  ratio: number;
  /** Непрерывная позиция: sub + ratio (для «+0,4 уровня»). */
  pos: number;
  /** Очки с частичным зачётом, и только выращенное. */
  points: number;
  grown: number;
  total: number;
  /** Доля пути до A1, 0…1 (1 — только на A1). */
  pct: number;
  /** Очков до следующего уровня (или до A1); null — A1. */
  toNext: number | null;
  /** Название следующего уровня («Poziom 8» / «A1»); null — A1. */
  nextPl: string | null;
  /** «уровня 8» / «A1» — для «До уровня 8: …»; null — A1. */
  nextTo: string | null;
  /** Порог следующего уровня в очках. */
  nextAt: number | null;
  a1: boolean;
}

export function pathOf(p: { grown: number; partial: number }, total: number = BASE.total, th: readonly number[] = THRESHOLDS): PathInfo {
  const grown = round2(p.grown);
  const points = Math.min(total, round2(p.grown + p.partial));
  if (grown >= total) return { sub: SUB_COUNT + 1, pl: A1_LEVEL.pl, ru: A1_LEVEL.ru, ratio: 1, pos: SUB_COUNT + 1, points: total, grown: total, total, pct: 1, toNext: null, nextPl: null, nextTo: null, nextAt: null, a1: true };
  let sub = 0;
  while (sub < th.length && points >= th[sub]!) sub++;
  const lo = sub === 0 ? 0 : th[sub - 1]!;
  const hi = sub < th.length ? th[sub]! : total;
  const ratio = Math.min(0.99, Math.max(0, (points - lo) / Math.max(1, hi - lo)));
  const lvl = SUBLEVELS[sub]!;
  const next = sub < th.length ? SUBLEVELS[sub + 1]!.pl : A1_LEVEL.pl;
  return {
    sub,
    pl: lvl.pl,
    ru: lvl.ru,
    ratio,
    pos: sub + ratio,
    points,
    grown,
    total,
    pct: Math.min(0.99, points / total),
    toNext: Math.max(0, Math.ceil(hi - points - 1e-9)),
    nextPl: next,
    nextTo: nextTarget(sub),
    nextAt: hi,
    a1: false,
  };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** «+0,4 уровня»: рост позиции, одна цифра после запятой; меньше 0,05 — пусто. */
export function growthText(delta: number): string {
  const d = Math.round(delta * 10) / 10;
  if (d < 0.1) return '';
  const s = String(d).replace('.', ',');
  const whole = Number.isInteger(d);
  const tail = whole && d === 1 ? 'уровень' : 'уровня';
  return `+${s} ${tail}`;
}
