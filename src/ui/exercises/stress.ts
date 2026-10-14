// `stress` (ТЗ §3.5): тапает ударный слог. SRS не трогает (§4.7), ошибка идёт тегом в кластер R1.
import type { StepStress } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { runGraded } from './frame';
import { optionList } from './options';
import type { ExerciseModule } from './types';

export const stress: ExerciseModule<StepStress> = {
  graded: true,
  mount(step, ctx) {
    const canPlay = step.say !== false && ctx.audio.has(step.word);
    const opts = optionList(step.syllables, () => run.submit(), { row: true, lang: 'pl' });
    const run = runGraded<number>(ctx, {
      kind: 'stress',
      head: [el('span', { class: 'q' }, 'Где ударение? ', el('b', { lang: 'pl' }, step.word)), ...(canPlay ? audioButtons(ctx.audio, step.word) : [])],
      body: opts.box,
      instant: true,
      read: () => opts.picked,
      check: (i) => (i === step.answer ? { verdict: 'exact', score: 1, tags: [] } : { verdict: 'wrong', score: 0, tags: [...(step.tags ?? ['R1'])] }),
      correct: () => step.syllables.map((s, i) => (i === step.answer ? s.toUpperCase() : s)).join('·'),
      sayCorrect: step.word,
      mark: (i) => {
        if (i === step.answer) opts.markRight(i);
        else {
          opts.markWrong(i);
          opts.markRight(step.answer, true);
        }
        opts.picked = null;
      },
      hint: () => {
        if (canPlay) ctx.audio.play(step.word, { slow: true });
        return 'В польском ударение почти всегда на предпоследнем слоге.';
      },
      focus: () => opts.focusFirst(),
      ...(step.hint ? { stepHint: step.hint } : {}),
    });
    if (step.say === true && canPlay) ctx.audio.play(step.word);
    return run.result;
  },
};
