// `match` (ТЗ §3.5): соединяет пары pl ↔ ru (3–6). Выбрал слово слева и перевод справа (в любом
// порядке): верная пара гаснет зелёным, неверная качается, и эта пара уже не «с первого раза».
// Ошибки исправляются по ходу, поэтому повтора нет: когда все пары собраны — итог и «Дальше».
// Карточка `rec` для каждого `items[i]` получает свою оценку (parts).
import type { StepMatch } from '../../types/content';
import { el } from '../dom';
import { explainOf, runGraded } from './frame';
import { seedOf, shuffled } from './options';
import type { ExerciseModule } from './types';

export const match: ExerciseModule<StepMatch> = {
  graded: true,
  mount(step, ctx) {
    const n = step.pairs.length;
    const seed = seedOf(ctx);
    const leftOrder = shuffled([...Array(n).keys()], `${seed}:l`);
    // Правый столбец не повторяет левый построчно: иначе пары читаются «по горизонтали».
    let rightOrder = shuffled([...Array(n).keys()], `${seed}:r`);
    for (let k = 1; k < 8 && n > 1 && rightOrder.every((x, i) => x === leftOrder[i]); k++) rightOrder = shuffled([...Array(n).keys()], `${seed}:r${k}`);
    const done = new Set<number>();
    const missed = new Set<number>();
    let sel: { side: 'l' | 'r'; i: number } | null = null;

    const mk = (side: 'l' | 'r', i: number): HTMLButtonElement =>
      el(
        'button',
        { type: 'button', class: 'pq-btn', 'data-nav': true, 'data-side': side, 'data-pair': i, lang: side === 'l' ? 'pl' : 'ru', onclick: () => pick(side, i) },
        step.pairs[i]![side === 'l' ? 0 : 1],
      );
    const left = leftOrder.map((i) => mk('l', i));
    const right = rightOrder.map((i) => mk('r', i));
    const btnOf = (side: 'l' | 'r', i: number): HTMLButtonElement => (side === 'l' ? left : right).find((b) => Number(b.dataset.pair) === i)!;
    const box = el('div', { class: 'pq-match' }, el('div', { class: 'col' }, ...left), el('div', { class: 'col' }, ...right));

    function pick(side: 'l' | 'r', i: number): void {
      if (run.phase !== 'answer' || done.has(i)) return;
      if (!sel || sel.side === side) {
        if (sel) btnOf(sel.side, sel.i).classList.remove('sel');
        sel = { side, i };
        btnOf(side, i).classList.add('sel');
        // Выбрал слева — фокус на первую свободную справа (и наоборот): Enter, Enter.
        (side === 'l' ? right : left).find((b) => !b.disabled)?.focus({ preventScroll: true });
        return;
      }
      const l = side === 'l' ? i : sel.i;
      const r = side === 'r' ? i : sel.i;
      btnOf(sel.side, sel.i).classList.remove('sel');
      sel = null;
      if (l === r) {
        done.add(l);
        for (const b of [btnOf('l', l), btnOf('r', r)]) {
          b.classList.add('done');
          b.disabled = true;
        }
        if (done.size === n) run.submit();
        else left.find((b) => !b.disabled)?.focus({ preventScroll: true });
      } else {
        missed.add(l);
        ctx.react?.('confused');
        for (const b of [btnOf('l', l), btnOf('r', r)]) {
          b.classList.remove('bad');
          void b.offsetWidth;
          b.classList.add('bad');
          setTimeout(() => b.classList.remove('bad'), 400);
        }
        btnOf('l', l).focus({ preventScroll: true });
      }
    }

    const run = runGraded<number>(ctx, {
      kind: 'match',
      head: [el('span', { class: 'q' }, 'Соедини пары')],
      body: box,
      instant: true,
      noRetry: true,
      read: () => (done.size === n ? done.size : null),
      check: () => {
        const ok = n - missed.size;
        return missed.size === 0 ? { verdict: 'exact', score: 1, tags: [] } : { verdict: 'wrong', score: ok / n >= 0.5 ? 0.5 : 0, tags: [...(step.tags ?? [])] };
      },
      correct: () => step.pairs.filter((_, i) => missed.has(i)).map(([pl, ru]) => `${pl} — ${ru}`).join(', '),
      hint: () => {
        const i = [...Array(n).keys()].find((k) => !done.has(k));
        if (i === undefined) return null;
        for (const b of [btnOf('l', i), btnOf('r', i)]) b.classList.add('show');
        setTimeout(() => {
          btnOf('l', i).classList.remove('show');
          btnOf('r', i).classList.remove('show');
        }, 1500);
        return 'Одна пара подсвечена.';
      },
      parts: () => step.pairs.map((_, i) => ({ ...(step.items?.[i] ? { item: step.items[i] } : {}), ok: !missed.has(i) })),
      focus: () => left.find((b) => !b.disabled)?.focus({ preventScroll: true }),
      ...explainOf(step),
    });
    return run.result;
  },
};
