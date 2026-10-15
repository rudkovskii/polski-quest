// Реестр типов шагов (ТЗ §3.5, I-08). Новый тип шага = модуль в этой папке + строка здесь +
// схема в content/schema/steps.schema.json + тест в tests/exercises.test.ts (AGENTS.md).
import type { Step } from '../../types/content';
import { choice } from './choice';
import { dictation } from './dictation';
import { explain } from './explain';
import { gap } from './gap';
import { listen } from './listen';
import { match } from './match';
import { minimal_pair } from './minimal_pair';
import { order } from './order';
import { pick } from './pick';
import { say } from './say';
import { shadow } from './shadow';
import { stress } from './stress';
import { type } from './type';
import type { ExerciseCtx, ExerciseModule, StepResult, StepT } from './types';

type ByT = { [K in StepT]: ExerciseModule<Extract<Step, { t: K }>> };

export const EXERCISES: ByT = { say, explain, shadow, listen, choice, pick, order, type, dictation, match, gap, minimal_pair, stress };

export function exerciseFor<S extends Step>(step: S): ExerciseModule<S> {
  const m = (EXERCISES as Record<string, ExerciseModule<Step>>)[step.t];
  if (!m) throw new Error(`exercises: нет модуля для шага "${(step as { t: string }).t}"`);
  return m as ExerciseModule<S>;
}

export function mountStep(step: Step, ctx: ExerciseCtx): Promise<StepResult> {
  return exerciseFor(step).mount(step, ctx);
}

export type { ExerciseCtx, ExerciseModule, StepResult } from './types';
