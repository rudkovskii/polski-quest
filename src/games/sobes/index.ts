// Игра «Sobes» (личная версия Шэфа, просьба 30.10: «игра помогает запоминать текст, который я потом проговариваю на собесе»).
// Вопросы — то, что сейчас учится в дриле: `content/v2/sobes.json` пишет `npm run sobes` из `ПМЖ/Собес` (статусы «учу» в
// `drill/progress.md`, тексты и разметка кусков — `Miso-baza-voprosov.md`). Ответ учится кусками, не словами: знакомство карточкой,
// сборка по порядку (A), «что дальше» (B), «скажи вслух — сверь» с самооценкой («сам», без него урожая нет). Вход — мачта, как Hymn и Symbole.
import { el } from '../../ui/dom';
import type { GamePanel, GameCtx, PolskaGame } from '../../types/polska';
import { checkTask, makeTask, type SobesTask } from './tasks';
import { answerCard, renderHub, renderTask } from './view';

/** Порядок посадки — порядок файла: свежее на занятиях первым. */
const sobesPool = (ctx: GameCtx): string[] => ctx.units.filter((u) => u.kind === 'answer').map((u) => u.id);

function render(task: SobesTask, panel: GamePanel, ctx: GameCtx): void {
  const u = ctx.unit(task.id);
  if (!u || ctx.seen(task.id)) return renderTask(task, panel);
  const card = answerCard(u, panel.say);
  panel.body.append(card);
  panel.foot.replaceChildren(
    el(
      'button',
      {
        type: 'button',
        class: 'pq-btn',
        'data-nav': '',
        'data-understood': '',
        onclick: () => {
          ctx.markSeen(task.id);
          card.remove();
          panel.foot.replaceChildren();
          renderTask(task, panel);
        },
      },
      'Rozumiem · Понятно →',
    ),
  );
}

export const game: PolskaGame<SobesTask> = {
  id: 'sobes',
  title: { pl: 'Rozmowa', ru: 'Собеседование' },
  desc: 'Ответы на вопросы собеседования кусками: собери по порядку, что дальше, скажи вслух и сверь',
  entry: 'mast',
  plot: 'pasieka',
  kinds: ['answer'],
  layout: 'panel',
  pool: sobesPool,
  nextTask: makeTask,
  render,
  check: (task, answer) => checkTask(task, answer),
  hub: (panel, ctx, begin) => renderHub(panel, ctx, sobesPool(ctx), begin),
  hubBack: 'К вопросам',
};
