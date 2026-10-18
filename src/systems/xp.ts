// Путь к A1 (V11c): очки, 20 подуровней и итоговый A1. Чистая часть, без браузера и хранилища: уровень не хранится, а выводится
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
  /** Номер 0…20 (0 — старт, до первого порога). */
  n: number;
  pl: string;
  ru: string;
  icon: string;
  /** Короткая подпись под названием. */
  note: string;
  /** Что открыто: подпись для праздничной карточки (без механики). */
  gift: string;
}

const S = (n: number, pl: string, ru: string, icon: string, note: string, gift: string): Sublevel => ({ n, pl, ru, icon, note, gift });

/** Звания: 0 — старт, 1…20 — подуровни, дальше A1 (`A1_LEVEL`). */
export const SUBLEVELS: readonly Sublevel[] = [
  S(0, 'Ziemia', 'Земля', '🟫', 'Земля ждёт первое зерно', 'Пустая грядка и лейка'),
  S(1, 'Ziarenko', 'Зёрнышко', '🌰', 'Первое зерно в земле', 'Табличка «Ziarenko» на воротах'),
  S(2, 'Kiełek', 'Проросток', '🌱', 'Первые ростки пробились', 'Табличка «Kiełek» на воротах'),
  S(3, 'Listek', 'Листик', '🍃', 'Появились первые листья', 'Свежий листик в петлицу'),
  S(4, 'Pączek', 'Бутон', '🌷', 'Бутоны готовы раскрыться', 'Бутон на подоконник'),
  S(5, 'Kwiat', 'Цветок', '🌼', 'Грядка зацвела', 'Букет на столе'),
  S(6, 'Grządka', 'Грядка', '🥕', 'Свои ровные грядки', 'Ровные ряды грядок'),
  S(7, 'Ogródek', 'Огородик', '🥬', 'Огородик за домом', 'Калитка в огородик'),
  S(8, 'Płot', 'Забор', '🪵', 'Хозяйство обнесено забором', 'Новый забор вокруг участка'),
  S(9, 'Studnia', 'Колодец', '🪣', 'Вода всегда под рукой', 'Колодец и ведро'),
  S(10, 'Szklarnia', 'Теплица', '🏡', 'Растёт и зимой', 'Тёплый уголок с рассадой'),
  S(11, 'Sad', 'Сад', '🍎', 'Яблони дали первый урожай', 'Яблоня у дома'),
  S(12, 'Pasieka', 'Пасека', '🐝', 'Пчёлы нашли твой сад', 'Улей на краю сада'),
  S(13, 'Pole', 'Поле', '🌾', 'Поле колосится', 'Поле до горизонта'),
  S(14, 'Stodoła', 'Амбар', '🏚️', 'Амбар наполняется', 'Новый амбар'),
  S(15, 'Młyn', 'Мельница', '⚙️', 'Мелешь собственную муку', 'Мельница на реке'),
  S(16, 'Piekarnia', 'Пекарня', '🍞', 'Из своей муки пахнет хлебом', 'Печь и тёплый хлеб'),
  S(17, 'Targ', 'Рынок', '🧺', 'Есть что продать на рынке', 'Прилавок на рынке'),
  S(18, 'Traktor', 'Трактор', '🚜', 'Работа пошла быстрее', 'Трактор во дворе'),
  S(19, 'Wieś', 'Деревня', '🏘️', 'Вся деревня знает твою ферму', 'Дорога в деревню'),
  S(20, 'Gospodarstwo', 'Хозяйство', '🏡', 'Большое хозяйство, остался последний рывок', 'Флаг над хозяйством'),
];

export const A1_LEVEL: Sublevel = S(21, 'Rolnik A1', 'Фермер A1', '🏆', 'Вся база выращена', 'Звание Rolnik и золотая лейка');

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
 * Пороги подуровней 1…20 в очках: первые частые (5, 15, 30, 50, 80, 120), дальше шаг растёт, 20-й — 95 % пути.
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
  /** 0…20 — подуровень, 21 — A1. */
  sub: number;
  pl: string;
  ru: string;
  icon: string;
  /** 0…1 внутри подуровня (до следующего порога). */
  ratio: number;
  /** Непрерывная позиция: sub + ratio (для «+0,4 подуровня»). */
  pos: number;
  /** Очки с частичным зачётом, и только выращенное. */
  points: number;
  grown: number;
  total: number;
  /** Доля пути до A1, 0…1 (1 — только на A1). */
  pct: number;
  /** Очков до следующего подуровня (или до A1); null — A1. */
  toNext: number | null;
  /** Название следующего звания; null — A1. */
  nextPl: string | null;
  /** Порог следующего подуровня в очках. */
  nextAt: number | null;
  a1: boolean;
}

export function pathOf(p: { grown: number; partial: number }, total: number = BASE.total, th: readonly number[] = THRESHOLDS): PathInfo {
  const grown = round2(p.grown);
  const points = Math.min(total, round2(p.grown + p.partial));
  if (grown >= total) return { sub: SUB_COUNT + 1, pl: A1_LEVEL.pl, ru: A1_LEVEL.ru, icon: A1_LEVEL.icon, ratio: 1, pos: SUB_COUNT + 1, points: total, grown: total, total, pct: 1, toNext: null, nextPl: null, nextAt: null, a1: true };
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
    icon: lvl.icon,
    ratio,
    pos: sub + ratio,
    points,
    grown,
    total,
    pct: Math.min(0.99, points / total),
    toNext: Math.max(0, Math.ceil(hi - points - 1e-9)),
    nextPl: next,
    nextAt: hi,
    a1: false,
  };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** «+0,4 подуровня»: рост позиции, одна цифра после запятой; меньше 0,05 — пусто. */
export function growthText(delta: number): string {
  const d = Math.round(delta * 10) / 10;
  if (d < 0.1) return '';
  const s = String(d).replace('.', ',');
  const whole = Number.isInteger(d);
  const tail = whole && d === 1 ? 'подуровень' : 'подуровня';
  return `+${s} ${tail}`;
}
