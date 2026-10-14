// `type` (ТЗ §3.5, §4.6): печатает ответ. Проверка checkAnswer с мягкой диакритикой; экранная
// клавиатура (полоска ąćęłńóśźż + QWERTY на десктопе), Enter = «Проверить».
import { checkAnswer } from '../../systems/answer';
import type { StepType } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { answerField, focusField, letterHint } from './field';
import { explainOf, runGraded } from './frame';
import type { ExerciseModule } from './types';

export const type: ExerciseModule<StepType> = {
  graded: true,
  mount(step, ctx) {
    const field = answerField('Ответ по-польски');
    const item = step.item ? ctx.content?.vocab(step.item) : undefined;
    const lenient = { ...step.lenient, diacritics: step.lenient?.diacritics ?? ctx.diacritics };
    const head: (Node | string)[] = [el('span', { class: 'q' }, step.prompt)];
    if (step.say && ctx.audio.has(step.say)) head.push(...audioButtons(ctx.audio, step.say));
    const run = runGraded<string>(ctx, {
      kind: 'type',
      head,
      body: el('div', {}, field),
      input: field,
      read: () => (field.value.trim() ? field.value : null),
      check: (v) => checkAnswer(v, step.accept, lenient, step.tags ?? []),
      correct: () => step.accept[0],
      ...(item?.tr ? { tr: item.tr } : {}),
      sayCorrect: step.accept[0],
      reset: () => {
        field.value = '';
      },
      hint: () => letterHint(step.accept[0]),
      focus: () => focusField(field),
      ...explainOf(step),
    });
    return run.result;
  },
};
