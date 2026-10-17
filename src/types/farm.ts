// Ферма F-03: что видят экраны (словарь, банки, коробка, кровать, карточка растения) и мир (грядки, автобег).
// Чистая модель — src/systems/garden.ts; склейка с хранилищем и шиной — src/main.ts (FarmApi).
import type { Phrase, Topic, Word } from './content';

/** Стадия растения. ripe — созрело (миг перед тем, как герой сорвёт); overripe — вернулось из банки повторить. */
export type Stage = 'seed' | 'sprout' | 'bush' | 'ripe' | 'overripe';
/** new — не посажено; bag — посажено, ждёт грядку в мешке; growing — на грядке (в т. ч. перезревшее); grown — в банке. */
export type ItemStatus = 'new' | 'bag' | 'growing' | 'grown';
/** pr — с польского (узнать), rp — на польский (написать/собрать по-польски). */
export type Side = 'pr' | 'rp';
/** Мини-игры: 1 PL→RU слово, 2 RU→PL слово, 3 собрать польскую фразу, 4 собрать русскую фразу. */
export type GameMode = 1 | 2 | 3 | 4;

export interface ItemInfo {
  id: string;
  kind: 'word' | 'phrase';
  status: ItemStatus;
  /** null — не посажено или в банке (и не перезрело). */
  stage: Stage | null;
  /** Капли в текущей стадии (верно +1, ошибка −1, не ниже 0). */
  drops: number;
  /** Были верные ответы в эту сторону (за текущий цикл роста). */
  sides: Record<Side, boolean>;
  /** Сколько разных календарных дней с верными ответами (за цикл). */
  days: number;
  /** Что нужно до следующей стадии, по-русски («ещё 1 верный», «верно по-польски», «ещё 2 дня»). */
  next: string;
  /** Сколько раз уже собрано в банку. */
  harvests: number;
  /** Когда вернётся перезревшим (epoch ms), если в банке. */
  dueAt: number | null;
  /** Номер грядки, если на грядке. */
  slot: number | null;
}

export interface FarmStats {
  xp: number;
  level: string;
  /** 0..1 внутри текущего подуровня (выращенное + частичный зачёт за растущее). */
  ratio: number;
  /** До следующего подуровня: имя и сколько слов (на последнем шаге слов и фраз) выращивать. null — A1. */
  next: { level: string; words: number } | null;
  grownToday: number;
  grownTotal: number;
  grownWords: number;
  grownPhrases: number;
  growing: number;
  bag: number;
  answersToday: number;
}

/** Фасад для экранов. Экраны не знают про хранилище: всё через него. */
export interface FarmApi {
  readonly words: readonly Word[];
  readonly phrases: readonly Phrase[];
  readonly topics: readonly Topic[];
  word(id: string): Word | undefined;
  phrase(id: string): Phrase | undefined;
  info(id: string): ItemInfo;
  /** Слова фразы, которые ещё не «куст» (пусто = фразу можно сажать). */
  missingWords(phraseId: string): string[];
  /** Посадить (новое — семенем на свободную грядку или в мешок). Уже посаженное пропускается. */
  plant(ids: readonly string[]): { planted: number; bag: number; skipped: number };
  stats(): FarmStats;
  /** Банки: собранное по темам (тема → id). */
  pantry(): { topic: string; ids: string[] }[];
  /** Озвучить слово/фразу (id из базы). */
  say(id: string, slow?: boolean): void;
  /** Подписка на любые изменения фермы. */
  onChange(fn: () => void): () => void;
}

/** Растение на грядке для мира. */
export interface PlantView {
  slot: number;
  tile: [number, number];
  id: string;
  /** Подпись (польский). */
  label: string;
  stage: Stage;
  drops: number;
  phrase: boolean;
}

/** Действие героя во время мини-игры (очередь автобега). */
export interface FarmAct {
  kind: 'water' | 'grow' | 'harvest' | 'miss';
  id: string;
  label: string;
  /** Грядка растения (null — растение без грядки, герой стоит). */
  tile: [number, number] | null;
  /** Сколько опыта за ответ (для «+N»). */
  xp: number;
}
