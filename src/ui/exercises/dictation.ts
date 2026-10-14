// `dictation` (ТЗ §3.5): слышит и печатает. Переслушать можно без штрафа; «медленно» до ответа на
// grade не влияет. `slowFirst` — первый раз медленно. Нет звука → фраза показана текстом, `lis` не пишется.
import { checkAnswer } from '../../systems/answer';
import type { StepDictation } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { answerField, focusField, letterHint } from './field';
import { explainOf, runGraded } from './frame';
import type { ExerciseModule } from './types';

export const dictation: ExerciseModule<StepDictation> = {
  graded: true,
  mount(step, ctx) {
    const field = answerField('Что услышал');
    const accept = step.accept ?? [step.say];
    const noAudio = !ctx.audio.has(step.say);
    const lenient = { ...step.lenient, diacritics: step.lenient?.diacritics ?? ctx.diacritics };
    const item = step.item ? ctx.content?.vocab(step.item) : undefined;
    const head: (Node | string)[] = noAudio
      ? [el('span', { class: 'q' }, 'Перепиши: ', el('b', { lang: 'pl' }, step.say)), el('span', { class: 'pq-noaudio' }, '🔇 звука нет')]
      : [el('span', { class: 'q' }, 'Напиши, что слышишь'), ...audioButtons(ctx.audio, step.say)];
    const run = runGraded<string>(ctx, {
      kind: 'dictation',
      head,
      body: el('div', {}, field),
      input: field,
      noAudio,
      read: () => (field.value.trim() ? field.value : null),
      check: (v) => checkAnswer(v, accept, lenient, step.tags ?? []),
      correct: () => accept[0] ?? step.say,
      ...(item?.tr ? { tr: item.tr } : {}),
      sayCorrect: step.say,
      reset: () => {
        field.value = '';
        if (!noAudio) ctx.audio.play(step.say);
      },
      hint: () => {
        if (!noAudio) ctx.audio.play(step.say, { slow: true });
        return letterHint(accept[0] ?? step.say);
      },
      focus: () => focusField(field),
      ...explainOf(step),
    });
    if (!noAudio) ctx.audio.play(step.say, { slow: step.slowFirst === true });
    return run.result;
  },
};
