// Оценка из ответа (ТЗ §4.7): результат первой попытки по due-карточке → grade SRS.
// Повторная попытка после ошибки обучающая и в SRS не пишется (→ null).
import type { Tuning } from '../types/content';
import type { Check, Verdict } from './answer';
import type { Grade } from './srs';

export type StepKind =
  | 'say' | 'explain' | 'shadow' | 'stress'
  | 'choice' | 'listen' | 'match' | 'minimal_pair'
  | 'type' | 'dictation' | 'order' | 'gap';

/** Шаги, которые SRS не трогают (stress идёт в кластер R1, не в карточку). */
export const NO_SRS: ReadonlySet<StepKind> = new Set(['say', 'explain', 'shadow', 'stress']);
/** Порог «быстро» для grade 3: выбор → grade3FastMs.choice, ввод → grade3FastMs.input. */
export const CHOICE_KINDS: ReadonlySet<StepKind> = new Set(['choice', 'listen', 'match', 'minimal_pair']);
export const INPUT_KINDS: ReadonlySet<StepKind> = new Set(['type', 'dictation', 'order', 'gap']);
/** grade 3 только для зрелых карточек: interval ≥ 7. */
export const GRADE3_MIN_INTERVAL = 7;

export interface GradeInput {
  kind: StepKind;
  /** Результат checkAnswer; для выбора/сборки — { verdict: 'exact' | 'wrong', score: 1 | 0 }. */
  check: Pick<Check, 'verdict' | 'score'>;
  /** Время ответа, мс. */
  ms: number;
  /** Текущий interval карточки (до ответа). */
  interval: number;
  /** Номер попытки на шаге, с 1. В SRS идёт только первая. */
  attempt?: number;
  /** Ответ после подсказки (или купленной подсказки §4.10): grade ≤ 1. */
  hinted?: boolean;
}

/** Порог «быстро» для шага или null, если шаг не про скорость. */
export function fastMs(kind: StepKind, t: Pick<Tuning, 'grade3FastMs'>): number | null {
  if (CHOICE_KINDS.has(kind)) return t.grade3FastMs.choice;
  if (INPUT_KINDS.has(kind)) return t.grade3FastMs.input;
  return null;
}

/**
 * Таблица §4.7. null = в SRS не пишется (шаг без SRS или не первая попытка).
 * Зачёт определяется по score: 0 → grade 0 (в том числе диакритика в режиме fail).
 */
export function gradeFromAnswer(a: GradeInput, t: Pick<Tuning, 'grade3FastMs'>): Grade | null {
  if (NO_SRS.has(a.kind)) return null;
  if ((a.attempt ?? 1) > 1) return null;
  const { verdict, score } = a.check;
  if (score <= 0 || verdict === 'wrong') return 0;
  if (a.hinted) return 1;
  if (isPartial(verdict, score)) return 1;
  const fast = fastMs(a.kind, t);
  if (verdict === 'exact' && fast !== null && a.ms < fast && a.interval >= GRADE3_MIN_INTERVAL) return 3;
  return 2;
}

/** ortho, typo, diacritics(warn) — частичный зачёт → grade 1; diacritics(ok) засчитан как exact. */
function isPartial(v: Verdict, score: number): boolean {
  return v === 'ortho' || v === 'typo' || (v === 'diacritics' && score < 1);
}
