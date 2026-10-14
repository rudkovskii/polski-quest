// `say` (ТЗ §3.5): реплика NPC в окне диалога, слушает. SRS не трогает.
// Первое нажатие «Дальше» / Enter, пока строка печатается, показывает её целиком.
import type { StepSay } from '../../types/content';
import { el } from '../dom';
import { lineBox } from '../dialog/line';
import { runPlain } from './frame';
import type { ExerciseModule } from './types';

export const say: ExerciseModule<StepSay> = {
  graded: false,
  mount(step, ctx) {
    const speaker = ctx.content?.speaker(step.who) ?? { id: step.who, name: step.who };
    const view = lineBox({
      speaker,
      pl: step.pl,
      ...(step.ru ? { ru: step.ru } : {}),
      audio: ctx.audio,
      portraits: ctx.portraits ?? null,
      translations: ctx.translations,
      ...(ctx.typeMs !== undefined ? { typeMs: ctx.typeMs } : {}),
      autoplay: step.audio !== false,
    });
    const { result } = runPlain(ctx, [], el('div', {}, view.node), { onNext: () => !view.skip() });
    void result.finally(() => view.dispose());
    return result;
  },
};
