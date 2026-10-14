// `shadow` (ТЗ §3.5): слушает и повторяет вслух `repeat` раз, жмёт «Повторил». Без проверки и SRS.
// Каждое нажатие (кроме последнего) проигрывает фразу снова; `slow` — первый раз медленно.
import type { StepShadow } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { runPlain } from './frame';
import type { ExerciseModule } from './types';

export const shadow: ExerciseModule<StepShadow> = {
  graded: false,
  mount(step, ctx) {
    const times = Math.max(1, Math.min(3, step.repeat));
    const canPlay = ctx.audio.has(step.pl);
    let done = 0;
    const ru = step.ru ? el('div', { class: 'pq-line-ru', lang: 'ru' }, step.ru) : null;
    const body = el(
      'div',
      { class: 'pq-ex-body' },
      el('div', { class: 'pq-big', lang: 'pl' }, step.pl),
      ru,
      el('div', { class: 'pq-line-tools' }, ...(canPlay ? audioButtons(ctx.audio, step.pl) : [el('span', { class: 'pq-noaudio' }, '🔇 звука нет — прочитай вслух')])),
    );
    const label = (): string => (times > 1 ? `Повторил (${done}/${times})` : 'Повторил');
    const { result, next } = runPlain(ctx, [el('span', { class: 'q' }, 'Послушай и повтори вслух')], body, {
      label: label(),
      onNext: () => {
        done++;
        if (done >= times) return true;
        next.textContent = label();
        if (canPlay) ctx.audio.play(step.pl);
        return false;
      },
    });
    if (canPlay) ctx.audio.play(step.pl, { slow: step.slow === true });
    return result;
  },
};
