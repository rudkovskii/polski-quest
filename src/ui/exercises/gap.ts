// `gap` (ТЗ §3.5): фраза с одним `___`. С `options` — выбор кнопками, без них — ввод с экранной
// клавиатурой. Пропуск в фразе заполняется по мере ответа.
import { checkAnswer } from '../../systems/answer';
import type { StepGap } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { answerField, focusField, letterHint } from './field';
import { explainOf, runGraded } from './frame';
import { optionList, seedOf, shuffled } from './options';
import type { ExerciseModule } from './types';

export const gap: ExerciseModule<StepGap> = {
  graded: true,
  mount(step, ctx) {
    const [before = '', after = ''] = step.text.split('___');
    const slot = el('span', { class: 'slot' }, ' ');
    const sentence = el('div', { class: 'pq-gap', lang: 'pl' }, before, slot, after);
    const accept = step.accept ?? [step.answer];
    const head: (Node | string)[] = [el('span', { class: 'q' }, 'Заполни пропуск')];
    // Без звука (P-06): вместо ▶ — транскрипция слова шага, если есть.
    if (step.say && !ctx.silent && ctx.audio.has(step.say)) head.push(...audioButtons(ctx.audio, step.say));
    else if (step.say && ctx.silent) {
      const tr = (step.item ? ctx.content?.vocab(step.item)?.tr : undefined);
      if (tr) head.push(el('b', { class: 'tr', 'data-tr': '' }, `[${tr}]`));
    }
    const full = `${before}${step.answer}${after}`;
    const item = step.item ? ctx.content?.vocab(step.item) : undefined;
    const common = {
      kind: 'gap' as const,
      head,
      correct: () => step.answer,
      ...(item?.tr ? { tr: item.tr } : {}),
      sayCorrect: full,
      ...explainOf(step),
    };

    if (step.options) {
      const options = shuffled(step.options, seedOf(ctx));
      const opts = optionList(options, (i) => {
        slot.textContent = options[i] ?? '';
        run.submit();
      }, { row: true, lang: 'pl' });
      const run = runGraded<number>(ctx, {
        ...common,
        body: el('div', { class: 'pq-ex-body' }, sentence, opts.box),
        instant: true,
        read: () => opts.picked,
        check: (i) => {
          const v = options[i] ?? '';
          return checkAnswer(v, accept, { diacritics: 'fail', ortho: false }, step.tags ?? []).verdict === 'exact'
            ? { verdict: 'exact', score: 1, tags: [] }
            : { verdict: 'wrong', score: 0, tags: [...(step.tags ?? [])] };
        },
        mark: (i, c) => {
          if (c.verdict === 'exact') opts.markRight(i);
          else {
            opts.markWrong(i);
            const right = options.findIndex((o) => accept.includes(o));
            if (right >= 0) opts.markRight(right, true);
            slot.textContent = ' ';
          }
          opts.picked = null;
        },
        hint: () => {
          const wrong = options.map((o, i) => (accept.includes(o) ? -1 : i)).filter((i) => i >= 0 && !opts.buttons[i]?.disabled);
          if (wrong.length > 1) opts.disable(wrong[wrong.length - 1]!);
          return `Начинается на «${step.answer.charAt(0)}».`;
        },
        focus: () => opts.focusFirst(),
      });
      return run.result;
    }

    const field = answerField('Слово в пропуск');
    field.addEventListener('input', () => {
      slot.textContent = field.value || ' ';
    });
    const run = runGraded<string>(ctx, {
      ...common,
      body: el('div', { class: 'pq-ex-body' }, sentence, field),
      input: field,
      read: () => (field.value.trim() ? field.value : null),
      check: (v) => checkAnswer(v, accept, { diacritics: ctx.diacritics }, step.tags ?? []),
      reset: () => {
        field.value = '';
        slot.textContent = ' ';
      },
      hint: () => letterHint(step.answer),
      focus: () => focusField(field),
    });
    return run.result;
  },
};
