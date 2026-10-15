// `pick` (W-02, Salad Story, уровень 1 «Witryna»): голос называет слово, игрок тапает картинку на витрине
// (2–6 картинок, сетка; стрелки + Enter тоже). Картинки даёт склейка (`ctx.picture`, атлас Wola); нет картинки —
// подпись в рамке. Подписи под картинками скрыты до ответа: слово в задании, картинку надо узнать. Карточка — `rec`.
// Без звука: написание и транскрипция вместо ▶.
import type { StepPick } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { explainOf, runGraded } from './frame';
import { seedOf, shuffleOptions } from './options';
import type { ExerciseModule } from './types';

export const pick: ExerciseModule<StepPick> = {
  graded: true,
  mount(step, ctx) {
    const sh = shuffleOptions(step.items, step.answer, seedOf(ctx));
    const answer = sh.answer;
    const item = step.item ? ctx.content?.vocab(step.item) : undefined;
    const tr = step.tr ?? item?.tr;
    const canPlay = !!step.say && !ctx.silent && ctx.audio.has(step.say);
    const head: (Node | string)[] = [el('span', { class: 'q' }, step.prompt)];
    if (canPlay) head.push(...audioButtons(ctx.audio, step.say!));
    else if (ctx.silent && tr) head.push(el('b', { class: 'tr', 'data-tr': '' }, `[${tr}]`));
    let picked: number | null = null;
    const buttons = sh.options.map((it, i) => {
      const pic = ctx.picture?.(it.sprite, 4) ?? null;
      const label = el('span', { class: 'lbl', lang: 'pl', hidden: !!pic }, it.label ?? '');
      return el(
        'button',
        {
          type: 'button',
          class: 'pq-btn pq-pick-item',
          'data-nav': true,
          'data-opt': i,
          'data-sprite': it.sprite,
          'aria-label': it.label ?? `картинка ${i + 1}`,
          onclick: () => {
            picked = i;
            run.submit();
          },
        },
        pic,
        label,
      );
    });
    const reveal = (): void => {
      for (const b of buttons) b.querySelector<HTMLElement>('.lbl')!.hidden = false;
    };
    const box = el('div', { class: 'pq-pick', role: 'group', 'data-pick': sh.options.length }, ...buttons);
    const run = runGraded<number>(ctx, {
      kind: 'choice',
      head,
      body: box,
      instant: true,
      read: () => picked,
      check: (i) => (i === answer ? { verdict: 'exact', score: 1, tags: [] } : { verdict: 'wrong', score: 0, tags: [...(step.tags ?? [])] }),
      correct: () => sh.options[answer]?.label ?? '',
      ...(tr ? { tr } : {}),
      ...(step.say ? { sayCorrect: step.say } : {}),
      mark: (i) => {
        reveal();
        if (i === answer) buttons[i]?.classList.add('ok');
        else {
          buttons[i]?.classList.add('bad');
          if (buttons[i]) buttons[i].disabled = true;
          buttons[answer]?.classList.add('show');
        }
        picked = null;
      },
      hint: () => {
        const wrong = buttons.map((_, i) => i).filter((i) => i !== answer && !buttons[i]?.disabled);
        if (wrong.length > 1) buttons[wrong[wrong.length - 1]!]!.disabled = true;
        if (canPlay) ctx.audio.play(step.say!, { slow: true });
        return 'Одной картинкой меньше.';
      },
      focus: () => buttons.find((b) => !b.disabled)?.focus({ preventScroll: true }),
      ...explainOf(step),
    });
    if (canPlay) ctx.audio.play(step.say!);
    return run.result;
  },
};
