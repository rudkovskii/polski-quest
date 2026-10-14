// `listen` (ТЗ §3.5): слышит фразу, выбирает вариант (текстом или табличкой `show: sign`).
// Можно переслушать без штрафа. Нет звука → текстовый аналог: фраза показана, `lis` не пишется (§5.7).
import type { StepListen } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { explainOf, runGraded } from './frame';
import { autoOptions, optionList, seedOf } from './options';
import type { ExerciseModule } from './types';

export const listen: ExerciseModule<StepListen> = {
  graded: true,
  mount(step, ctx) {
    const { options, answer } = autoOptions(step, ctx.stepId, ctx.content, 3, seedOf(ctx));
    const noAudio = !ctx.audio.has(step.say);
    const opts = optionList(options, () => run.submit(), { cls: step.show === 'sign' ? 'pq-sign' : '', lang: 'pl' });
    const head: (Node | string)[] = noAudio
      ? [el('span', { class: 'q' }, 'Что здесь написано? ', el('b', { lang: 'pl' }, step.say)), el('span', { class: 'pq-noaudio' }, '🔇 звука нет')]
      : [el('span', { class: 'q' }, 'Что ты слышишь?'), ...audioButtons(ctx.audio, step.say)];
    const item = step.item ? ctx.content?.vocab(step.item) : undefined;
    const run = runGraded<number>(ctx, {
      kind: 'listen',
      head,
      body: opts.box,
      instant: true,
      noAudio,
      read: () => opts.picked,
      check: (i) => (i === answer ? { verdict: 'exact', score: 1, tags: [] } : { verdict: 'wrong', score: 0, tags: [...(step.tags ?? [])] }),
      correct: () => options[answer] ?? '',
      ...(item?.tr ? { tr: item.tr } : {}),
      sayCorrect: step.say,
      mark: (i) => {
        if (i === answer) opts.markRight(i);
        else {
          opts.markWrong(i);
          opts.markRight(answer, true);
          if (!noAudio) ctx.audio.play(step.say);
        }
        opts.picked = null;
      },
      hint: () => {
        if (!noAudio) ctx.audio.play(step.say, { slow: true });
        const wrong = options.map((_, i) => i).filter((i) => i !== answer && !opts.buttons[i]?.disabled);
        if (wrong.length > 1) opts.disable(wrong[wrong.length - 1]!);
        return 'Медленно, и одним вариантом меньше.';
      },
      focus: () => opts.focusFirst(),
      word: step.say,
      ...explainOf(step),
    });
    if (!noAudio) ctx.audio.play(step.say);
    return run.result;
  },
};
