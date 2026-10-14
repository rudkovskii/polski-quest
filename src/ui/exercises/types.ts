// Общий интерфейс шагов урока (ТЗ §3.5, §5.7, I-08): `mount(step, ctx) → Promise<StepResult>`.
// Каждый тип шага — отдельный модуль в src/ui/exercises/, реестр в registry.ts.
import type { CaptionMode } from '../../systems/words';
import type { DiacriticsMode, Verdict } from '../../systems/answer';
import type { Step, VocabEntry } from '../../types/content';
import type { KeyboardMode } from '../keyboard';
import type { Layer } from '../overlay/host';
import type { AudioPort, PortraitSource, React, Speaker } from '../overlay/kit';

export type StepT = Step['t'];

/** Проверка первой попытки: она одна идёт в SRS (ТЗ §4.7). */
export interface FirstTry {
  verdict: Verdict;
  score: number;
  tags: string[];
  /** Время до первого «Проверить», мс. */
  ms: number;
  /** Ответ после подсказки → grade ≤ 1. */
  hinted: boolean;
}

export interface StepResult {
  status: 'done' | 'cancel';
  /** Шаг проверяет ответ (всё, кроме say/explain/shadow). */
  graded: boolean;
  first?: FirstTry;
  /** Сколько раз нажали «Проверить» (с повторами после ошибки). */
  attempts: number;
  /** match: результат по каждой паре с первой попытки (item из `items[i]`). */
  parts?: { item?: string; ok: boolean }[];
  /** Аудио-шаг прошёл текстом (звука нет): карточку `lis`/`pair` не пишем (ТЗ §5.7). */
  noAudio?: boolean;
  /** Время на шаге целиком, мс. */
  ms: number;
}

/** Срез контента, нужный упражнениям: слова для «auto:<tag>», транскрипция, имена говорящих. */
export interface ExerciseContent {
  vocab(id: string): VocabEntry | undefined;
  /** Все слова (для дистракторов `auto:<tag>`), в порядке файлов. */
  allVocab(): readonly VocabEntry[];
  speaker(id: string): Speaker;
  /** Тег ошибки (errorTags.json): правило одной строкой после неверного ответа (P-01). */
  errorTag?(id: string): { ru: string; hint?: string } | undefined;
  /** Минимальная пара (phonetics.pairs): без звука — «какое слово значит …» по переводу `ru` (P-06). */
  pair?(id: string): { a: string; b: string; ru?: string[] } | undefined;
}

export interface ExerciseCtx {
  /** Слой оверлея: шаг ставит на него свои обработчики intents. */
  layer: Layer;
  /** Куда рисовать шаг. */
  root: HTMLElement;
  /** id шага (`<lessonId>#<index>` по умолчанию): дистракторы `auto:<tag>`, seed по умолчанию. */
  stepId: string;
  /** Seed порядка вариантов и плиток (P-01): id шага + игровой день (+ `:r` у повтора ошибки). */
  seed?: string;
  content?: ExerciseContent;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  /** Настройка `diacritics` (по умолчанию warn), если у шага нет своей `lenient.diacritics`. */
  diacritics: DiacriticsMode;
  /** Подпись-перевод реплик `say` (P-07): always / auto / never. */
  translations: CaptionMode;
  keyboardMode: KeyboardMode;
  /** Для attachKeyboard в тестах; по умолчанию matchMedia. */
  coarse?: boolean;
  /** Монотонные часы для времени ответа, мс. */
  now(): number;
  /** [0, 1): для `minimal_pair` с `play: "random"`. */
  random(): number;
  /** Реакция NPC урока на ответ (портрет в шапке). */
  react?(kind: React): void;
  /** Повтор проваленного шага в конце урока: без подсказок, без SRS. */
  repeat?: boolean;
  /** Мс на букву в репликах `say`; 0 — сразу (тесты, reduced motion). */
  typeMs?: number;
  /**
   * Режим без звука (P-06, `sound.mode: off`): задания на слух читаются — транскрипция вместо звука,
   * карточки `lis`/`pair` не пишутся (шаг отдаёт `noAudio`), кнопок ▶ нет.
   */
  silent?: boolean;
  /** Одна попытка (диагностика P-06): после ошибки — правило и «Дальше», без повтора и без «Пропустить». */
  oneShot?: boolean;
  /** Реакция мира на ошибку (P-06, `lesson.errLine`): реплика NPC перед правилом. */
  errLine?: { who: string; pl: string; plRu?: string };
  /** Свои отклики вместо «Dobrze!» / «Jeszcze raz.» (турникет: «Pip!» / «Hyk!»). */
  verdicts?: { ok: string; bad: string };
}

export interface ExerciseModule<S extends Step = Step> {
  /** Шаг проверяет ответ и может писать SRS. */
  graded: boolean;
  mount(step: S, ctx: ExerciseCtx): Promise<StepResult>;
}
