// Игра «Miesiące» (просьба Шэфа 26.10, путь с нуля — 27.10, D-41). Вход — календарь на стене дома (общий с Daty: там выбор игры),
// растут месяцы на грядках месяцев в Zagroda (`bed_<n>`). Экран выбора — ступени по три месяца и колесо года (`levels.ts`), задания —
// `tasks.ts`, колесо — `wheel.ts`, остальной вид — общий набор `kit`. Месяц, которого игрок ещё не встречал, сначала показывается карточкой.
import { el } from '../../ui/dom';
import type { GameCtx, GamePanel, PolskaGame } from '../../types/polska';
import { choice, prompt, tiles } from '../kit';
import { HUB_CSS, monthCard, openPool, renderHub } from './levels';
import { checkTask, makeTask, rowsOf, type MonthTask } from './tasks';
import { WHEEL_CSS, wheelGame } from './wheel';

function draw(task: MonthTask, panel: GamePanel, ctx: GameCtx): void {
  prompt(panel, task.prompt, task.hint, task.lang, task.promptSay);
  if (task.mode === 'wheel') panel.body.append(wheelGame(task, rowsOf(ctx), panel));
  else if (task.mode === 'choice') choice(panel, task.options, task.answer as string, task.optLang);
  // Буквы (сборка названия) не озвучиваются по одной: звучит всё слово после ответа.
  else tiles(panel, task.options, task.kind === 'spell' ? 'ru' : 'pl');
}

function render(task: MonthTask, panel: GamePanel, ctx: GameCtx): void {
  panel.body.append(el('style', {}, HUB_CSS + WHEEL_CSS));
  const u = ctx.unit(task.id);
  if (!u || ctx.seen(u.id) || task.mode === 'wheel') return draw(task, panel, ctx);
  // Знакомство: карточка → «Rozumiem · Понятно» (только тут ставится флаг) → задание. Закрыл игру на карточке — покажем снова.
  const card = monthCard(u, panel.say);
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
          ctx.markSeen(u.id);
          card.remove();
          panel.foot.replaceChildren();
          draw(task, panel, ctx);
        },
      },
      'Rozumiem · Понятно →',
    ),
  );
}

export const game: PolskaGame<MonthTask> = {
  id: 'miesiace',
  title: { pl: 'Miesiące', ru: 'Месяцы' },
  desc: 'Все 12 месяцев с нуля: по три по порядку года, откуда имя, «po marcu jest…», «3 maja», колесо года',
  entry: 'calendar',
  plot: 'miesiace',
  kinds: ['month'],
  layout: 'full',
  pool: (ctx) => openPool(ctx),
  nextTask: makeTask,
  render: (task, panel, ctx) => render(task, panel, ctx),
  check: (task, answer) => checkTask(task, answer),
  hub: (panel, ctx, begin) => renderHub(panel, ctx, (ids, size) => begin(ids, size)),
  hubBack: 'К ступеням',
  summaryLine: (ctx) => {
    const m = ctx.units.find((u) => u.raw.month === ctx.date().m);
    return m ? `Teraz jest ${m.pl} · сейчас ${m.ru}` : null;
  },
};
