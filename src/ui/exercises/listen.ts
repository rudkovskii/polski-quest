// `listen` (ТЗ §3.5): слышит фразу, выбирает вариант (текстом или табличкой `show: sign`).
// Можно переслушать без штрафа. Нет звука → текстовый аналог: фраза показана, `lis` не пишется (§5.7).
import type { StepListen } from '../../types/content';
import { el } from '../dom';
import { audioButtons, cantHearButton } from '../overlay/kit';
import { explainOf, runGraded } from './frame';
import { spellingTraps } from '../../systems/spelling';
import { autoOptions, optionList, seedOf, shuffled } from './options';
import type { ExerciseModule } from './types';

export const listen: ExerciseModule<StepListen> = {
  graded: true,
  mount(step, ctx) {
    const auto = autoOptions(step, ctx.stepId, ctx.content, 3, seedOf(ctx));
    const noAudio = ctx.silent === true || !ctx.audio.has(step.say);
    const item = step.item ? ctx.content?.vocab(step.item) : undefined;
    // Без звука (P-06, СЮЖЕТ_v2 §7): «Прочитай и выбери» — звук транскрипцией кириллицей, выбор написания.
    // `show: "text"` (Wola, W-02): варианты — переводы реплики; без звука реплика читается написанием, не транскрипцией.
    const meaning = step.show === 'text';
    const tr = meaning ? undefined : (step.tr ?? item?.tr);
    // Wola (W-04): без звука неверные варианты — то же слово с типичной ошибкой написания; транскрипция их не различает.
    const traps = ctx.spellTraps && ctx.silent && tr ? spellTrapOptions(auto.options[auto.answer] ?? step.say) : null;
    const { options, answer } = traps ?? auto;
    const opts = optionList(options, () => run.submit(), { cls: step.show === 'sign' ? 'pq-sign' : '', lang: 'pl' });
    const head: (Node | string)[] = ctx.silent && tr
      ? [el('span', { class: 'q' }, 'Как это пишется? ', el('b', { class: 'tr', 'data-tr': '' }, `[${tr}]`), traps && item?.ru ? el('span', { class: 'gloss', 'data-gloss': '' }, ` — «${item.ru}»`) : null)]
      : noAudio
        ? [el('span', { class: 'q' }, meaning ? 'Что это значит? ' : 'Что здесь написано? ', el('b', { lang: 'pl' }, step.say)), el('span', { class: 'pq-noaudio' }, '🔇 звука нет')]
        : [el('span', { class: 'q' }, meaning ? 'Что ты слышишь? Что это значит?' : 'Что ты слышишь?'), ...audioButtons(ctx.audio, step.say), cantHearButton(ctx, () => run.skipNoAudio())];
    // Без звука с транскрипцией (P-10b) — это чтение звука: ответ засчитывается в карточку `lis`, она не пропадает.
    const reading = ctx.silent === true && !!tr;
    const run = runGraded<number>(ctx, {
      kind: 'listen',
      head,
      body: opts.box,
      instant: true,
      noAudio: noAudio && !reading,
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
        return noAudio ? 'Одним вариантом меньше.' : 'Медленно, и одним вариантом меньше.';
      },
      focus: () => opts.focusFirst(),
      word: step.say,
      ...explainOf(step),
    });
    if (!noAudio) ctx.audio.play(step.say);
    return run.result;

    /** Верное написание и до двух ловушек; ловушек меньше двух — добор из обычных вариантов шага. */
    function spellTrapOptions(correct: string): { options: string[]; answer: number } {
      const words = new Set((ctx.content?.allVocab() ?? []).map((v) => v.pl.toLocaleLowerCase('pl')));
      const wrong = spellingTraps(correct, 2, ctx.stepId, (s) => words.has(s.toLocaleLowerCase('pl')));
      for (const o of auto.options) if (wrong.length < 2 && o !== correct && !wrong.includes(o)) wrong.push(o);
      const list = shuffled([correct, ...wrong], `${seedOf(ctx)}:spell`);
      return { options: list, answer: list.indexOf(correct) };
    }
  },
};
