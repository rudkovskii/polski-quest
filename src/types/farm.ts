// Ферма F-03: что видят экраны (словарь, банки, коробка, кровать, карточка растения) и мир (грядки, автобег).
// Чистая модель — src/systems/garden.ts; склейка с хранилищем и шиной — src/main.ts (FarmApi).
import type { Base, PathInfo } from '../systems/xp';
import type { Gender } from '../systems/customWords';
import type { Phrase, Pos, Topic, Word } from './content';

/** Стадия растения. ripe — созрело (миг перед тем, как герой сорвёт); overripe — вернулось из банки повторить. */
export type Stage = 'seed' | 'sprout' | 'bush' | 'ripe' | 'overripe';
/** new — не посажено; bag — посажено, ждёт грядку в мешке; growing — на грядке (в т. ч. перезревшее); grown — в банке. */
export type ItemStatus = 'new' | 'bag' | 'growing' | 'grown';
/** pr — с польского (узнать), rp — на польский (написать/собрать по-польски). */
export type Side = 'pr' | 'rp';
/** Мини-игры: 1 PL→RU слово, 2 RU→PL слово, 3 собрать польскую фразу, 4 собрать русскую фразу, 5 собрать слово из букв (обе стороны). */
export type GameMode = 1 | 2 | 3 | 4 | 5;

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
  /** Слово собрано по-польски само (игра 5 без подсказки, или прежнее «напиши сам»); null — растению не нужно (фразы). */
  prod?: boolean | null;
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
  /** 0..1 внутри текущего уровня (выращенное + частичный зачёт за растущее). Название — «Уровень N», «Старт» или «A1». */
  ratio: number;
  /** Путь к A1: уровень 0…20 (21 — A1), очки, пороги (V11c). */
  path: PathInfo;
  /** Состав базы A1 (слов, фраз, фраз сборки) и очки пути. */
  base: Base;
  /** Пороги уровней 1…20 в очках. */
  thresholds: readonly number[];
  /** Сколько уровней набрано с запуска фермы (непрерывно, 0,4 = 40 % уровня). */
  sessionGain: number;
  grownToday: number;
  grownTotal: number;
  grownWords: number;
  grownPhrases: number;
  growing: number;
  bag: number;
  answersToday: number;
}

/** Ближайшая фраза для сборки (игры 3 и 4), которую ещё не посадили: что ей нужно (доска, P3a). */
export interface PhraseHint {
  id: string;
  pl: string;
  ru: string;
  /** Слова фразы, которых нет на грядках (польские подписи), порядок как во фразе. */
  need: string[];
  /** Слова фразы, которые уже растут (семена), но ещё не ростки: их остаётся только подрастить. В `need` их нет. */
  growing: string[];
  /** Что сажает кнопка: недостающие слова, которых нет на грядках; если слова готовы — сама фраза. Пусто — сажать нечего. */
  toPlant: string[];
  /** Слова фразы уже подросли: можно сажать саму фразу. */
  ready: boolean;
}

/** Что можно сохранить как своё слово (карточка «＋ Своё слово»). Пример — необязательный. */
export interface CustomInput {
  pl: string;
  ru: string;
  pos?: Pos;
  gender?: Gender;
  ex?: { pl: string; ru?: string } | null;
}
export type CustomAdd = { ok: true; id: string; existed: boolean } | { ok: false; reason: 'empty' | 'limit' };

/** Свои слова («Moje słowa»): хранятся в `Save.custom`, растут как обычные, в путь к A1 не входят. */
export interface CustomApi {
  /** Свои слова, новые первыми. */
  list(): readonly Word[];
  /** Сохранить слово (то же польское+русское второй раз не дублируется: existed). Сажает отдельно `FarmApi.plant`. */
  add(input: CustomInput): CustomAdd;
  /** Поправить польское, перевод, пример; id не меняется. false — нет такого своего слова. */
  update(id: string, patch: Partial<Pick<CustomInput, 'pl' | 'ru' | 'ex'>>): boolean;
  /** Удалить слово и его растение (посадка, ответы, грядка). false — нет такого. */
  remove(id: string): boolean;
  /** Слова базы (A1 и тема праздников) с таким русским переводом: «это слово уже есть в базе». */
  base(...ru: string[]): Word[];
}

/** Фасад для экранов. Экраны не знают про хранилище: всё через него. */
export interface FarmApi {
  readonly words: readonly Word[];
  readonly phrases: readonly Phrase[];
  readonly topics: readonly Topic[];
  word(id: string): Word | undefined;
  phrase(id: string): Phrase | undefined;
  info(id: string): ItemInfo;
  /** Слова фразы, которые ещё не «росток» (семя или не посажены; пусто = фразу можно сажать). */
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
  /** Свои слова. Нет — экран «＋ Своё слово» не показывается. */
  custom?: CustomApi;
}

/** Вид растения (`systems/plantLook.ts`): мини-предмет на кусте, плод цвета, куст-вариант; фразы и единицы v2 — прежние спрайты. */
export type PlantLook =
  | { type: 'object'; icon: string; variant: number }
  | { type: 'color'; fruit: string; variant: number }
  | { type: 'plant'; variant: number }
  | { type: 'phrase' }
  | { type: 'unit' };

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
  /** Вид по слову (нет — прежние общие спрайты). */
  look?: PlantLook;
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
