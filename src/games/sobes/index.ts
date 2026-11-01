// Игра «Sobes» (личная версия Шэфа, просьба 30.10: «игра помогает запоминать текст, который я потом проговариваю на собесе»).
// Вопросы — то, что сейчас учится в дриле: `content/v2/sobes.json` пишет `npm run sobes` из `ПМЖ/Собес` (статусы «учу» в
// `drill/progress.md`, тексты и разметка кусков — `Miso-baza-voprosov.md`). Ответ учится кусками, не словами: знакомство карточкой,
// сборка по порядку (A), «что дальше» (B), «скажи вслух — сверь» с самооценкой («сам», без него урожая нет). Вход — мачта, как Hymn и Symbole.
// С 01.11 (D-88, ТЗ `бобер/ТЗ-связки.md`) — связками: 2–3 вопроса читаются вместе, потом лесенка вперемешку (`plan.ts`, `queue`).
// Карточка в `render` осталась для одиночного повтора с участка Zagroda (движок выбирает сам).
import { el } from '../../ui/dom';
import type { GamePanel, GameCtx, PolskaGame } from '../../types/polska';
import { Ladder, modeNow } from './plan';
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

/** Лесенка текущей связки — для строки итога. */
let last: Ladder | null = null;

export const game: PolskaGame<SobesTask> = {
  id: 'sobes',
  title: { pl: 'Rozmowa', ru: 'Собеседование' },
  desc: 'Ответы собеседования связками: прочитай 2–3 вопроса, потом отвечай вперемешку — собери, что дальше, скажи вслух',
  entry: 'mast',
  plot: 'pasieka',
  kinds: ['answer'],
  layout: 'panel',
  pool: sobesPool,
  nextTask: makeTask,
  render,
  check: (task, answer) => checkTask(task, answer),
  hub: (panel, ctx, begin) => {
    last = null;
    renderHub(panel, ctx, sobesPool(ctx), begin);
  },
  hubBack: 'К вопросам',
  queue: (ctx, ids) => {
    // Начинаем с того, кого читали первым: короткая память держит последний прочитанный.
    last = new Ladder(ctx, ids, modeNow(), ids[0] ?? null);
    return last;
  },
  summaryLine: () => {
    if (!last) return null;
    const n = { said: 0, hint: 0, no: 0 };
    for (const g of last.grades.values()) n[g]++;
    const tail = last.mode === 'new' ? ' · новое лучше закрепить «Повторить» позже, чем брать ещё' : '';
    return `Сказал: ${n.said} · С подсказкой: ${n.hint} · Не собралось: ${n.no}${tail}`;
  },
};
