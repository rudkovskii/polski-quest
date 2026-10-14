// `choice` (ТЗ §3.5): вопрос и 2–4 варианта. Выбор сразу проверяется; неверный вариант гаснет,
// верный подсвечивается, и игрок выбирает его (обучающая попытка). `errorTagByOption` даёт тег ошибки.
import type { StepChoice } from '../../types/content';
import { el } from '../dom';
import { explainOf, runGraded } from './frame';
import { optionList, seedOf, shuffleOptions } from './options';
import type { ExerciseModule } from './types';

export const choice: ExerciseModule<StepChoice> = {
  graded: true,
  mount(step, ctx) {
    // Варианты перемешаны по id шага и дню (P-01); `errorTagByOption` — по исходному индексу.
    const sh = shuffleOptions(step.options, step.answer, seedOf(ctx));
    const answer = sh.answer;
    const wrongTags = (i: number): string[] => {
      const t = step.errorTagByOption?.[String(sh.orig[i])];
      return t ? [t, ...(step.tags ?? []).filter((x) => x !== t)] : [...(step.tags ?? [])];
    };
    const opts = optionList(sh.options, () => run.submit(), { lang: step.dir === 'ru-pl' ? 'pl' : undefined });
    const run = runGraded<number>(ctx, {
      kind: 'choice',
      head: [el('span', { class: 'q' }, step.q)],
      body: opts.box,
      instant: true,
      read: () => opts.picked,
      check: (i) => (i === answer ? { verdict: 'exact', score: 1, tags: [] } : { verdict: 'wrong', score: 0, tags: wrongTags(i) }),
      correct: () => sh.options[answer] ?? '',
      mark: (i) => {
        if (i === answer) opts.markRight(i);
        else {
          opts.markWrong(i);
          opts.markRight(answer, true);
        }
        opts.picked = null;
      },
      hint: () => {
        // Убрать один неверный вариант (если их больше одного), иначе подсказка из контента или ничего.
        const wrong = sh.options.map((_, i) => i).filter((i) => i !== answer && !opts.buttons[i]?.disabled);
        if (wrong.length > 1) {
          opts.disable(wrong[wrong.length - 1]!);
          return 'Один вариант лишний — убрал.';
        }
        return 'Подумай о похожем русском слове: оно может обмануть.';
      },
      focus: () => opts.focusFirst(),
      ...explainOf(step),
    });
    return run.result;
  },
};
