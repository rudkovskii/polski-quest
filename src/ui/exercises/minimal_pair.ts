// `minimal_pair` (ТЗ §3.5, §4.3): слышит одно слово пары и выбирает его (`mode: which`), или слышит
// два слова и решает, одинаковые ли они (`same_diff`). `play: "random"` — случайно из пары.
// Переслушать можно без штрафа. Нет звука → слово показано текстом, карточка `pair` не пишется.
import type { StepMinimalPair } from '../../types/content';
import { el } from '../dom';
import { btn } from '../overlay/kit';
import { explainOf, runGraded } from './frame';
import { optionList, seedOf, shuffled } from './options';
import type { ExerciseModule } from './types';

export const minimal_pair: ExerciseModule<StepMinimalPair> = {
  graded: true,
  mount(step, ctx) {
    const [a, b] = step.pair;
    const pick = (): 0 | 1 => (step.play === 'random' ? (ctx.random() < 0.5 ? 0 : 1) : step.play);
    const noAudio = !ctx.audio.has(a) || !ctx.audio.has(b);
    const sameDiff = step.mode === 'same_diff';

    // which: target — какое слово звучит; same_diff: звучат pair[0] и pair[target] (0 = одинаковые).
    const target = pick();
    const words = sameDiff ? [a, target === 0 ? a : b] : [step.pair[target]];
    const play = (slow = false): void => {
      for (const w of words) ctx.audio.play(w, { slow });
    };
    // which: слова пары в перемешанном порядке (P-01), «Одинаковые / Разные» — всегда так.
    const order: (0 | 1)[] = sameDiff ? [0, 1] : shuffled([0, 1] as (0 | 1)[], seedOf(ctx));
    const labels = sameDiff ? ['Одинаковые', 'Разные'] : order.map((k) => step.pair[k]);
    const answer = sameDiff ? (target === 0 ? 0 : 1) : order.indexOf(target);
    const opts = optionList(labels, () => run.submit(), { row: true, lang: sameDiff ? undefined : 'pl' });

    const head: (Node | string)[] = noAudio
      ? [el('span', { class: 'q' }, sameDiff ? 'Одинаково пишутся? ' : 'Какое слово? ', el('b', { lang: 'pl' }, words.join(' … '))), el('span', { class: 'pq-noaudio' }, '🔇 звука нет')]
      : [
          el('span', { class: 'q' }, sameDiff ? 'Это одно и то же слово?' : 'Какое слово звучит?'),
          btn('▶', () => play(), 'icon', { 'aria-label': 'Послушать ещё раз', 'data-nav': true, 'data-audio': 'play' }),
          btn('медленно', () => play(true), 'icon ghost', { 'data-nav': true, 'data-audio': 'slow' }),
        ];
    const run = runGraded<number>(ctx, {
      kind: 'minimal_pair',
      head,
      body: opts.box,
      instant: true,
      noAudio,
      read: () => opts.picked,
      check: (i) => (i === answer ? { verdict: 'exact', score: 1, tags: [] } : { verdict: 'wrong', score: 0, tags: [...(step.tags ?? [step.cluster])] }),
      correct: () => (sameDiff ? `${labels[answer]}: ${words.join(' … ')}` : (step.pair[target] ?? '')),
      sayCorrect: words.join(' '),
      mark: (i) => {
        if (i === answer) opts.markRight(i);
        else {
          opts.markWrong(i);
          opts.markRight(answer, true);
          if (!noAudio) play();
        }
        opts.picked = null;
      },
      hint: () => {
        if (!noAudio) play(true);
        return 'Медленно. Слушай первую согласную.';
      },
      focus: () => opts.focusFirst(),
      word: step.pair[target],
      ...explainOf(step),
    });
    if (!noAudio) play();
    return run.result;
  },
};
