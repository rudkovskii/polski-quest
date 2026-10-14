// `choice` (ТЗ §3.5): вопрос и 2–4 варианта. Выбор сразу проверяется; неверный вариант гаснет,
// верный подсвечивается, и игрок выбирает его (обучающая попытка). `errorTagByOption` даёт тег ошибки.
import type { StepChoice } from '../../types/content';
import { el } from '../dom';
import { runGraded } from './frame';
import { optionList } from './options';
import type { ExerciseModule } from './types';

export const choice: ExerciseModule<StepChoice> = {
  graded: true,
  mount(step, ctx) {
    const wrongTags = (i: number): string[] => {
      const t = step.errorTagByOption?.[String(i)];
      return t ? [t, ...(step.tags ?? []).filter((x) => x !== t)] : [...(step.tags ?? [])];
    };
    const opts = optionList(step.options, () => run.submit(), { lang: step.dir === 'ru-pl' ? 'pl' : undefined });
    const run = runGraded<number>(ctx, {
      kind: 'choice',
      head: [el('span', { class: 'q' }, step.q)],
      body: opts.box,
      instant: true,
      read: () => opts.picked,
      check: (i) => (i === step.answer ? { verdict: 'exact', score: 1, tags: [] } : { verdict: 'wrong', score: 0, tags: wrongTags(i) }),
      correct: () => step.options[step.answer] ?? '',
      mark: (i) => {
        if (i === step.answer) opts.markRight(i);
        else {
          opts.markWrong(i);
          opts.markRight(step.answer, true);
        }
        opts.picked = null;
      },
      hint: () => {
        // Убрать один неверный вариант (если их больше одного), иначе подсказка из контента или ничего.
        const wrong = step.options.map((_, i) => i).filter((i) => i !== step.answer && !opts.buttons[i]?.disabled);
        if (wrong.length > 1) {
          opts.disable(wrong[wrong.length - 1]!);
          return 'Один вариант лишний — убрал.';
        }
        return 'Подумай о похожем русском слове: оно может обмануть.';
      },
      focus: () => opts.focusFirst(),
      ...(step.hint ? { stepHint: step.hint } : {}),
    });
    return run.result;
  },
};
