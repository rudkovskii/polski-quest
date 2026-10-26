// Игра «Miesiące» (просьба Шэфа 26.10: «отдельная активность на запоминание всех месяцев, мини-игра в календаре»). Вход — календарь на стене дома
// (общий с Daty: там выбор игры), растут месяцы на грядках месяцев в Zagroda (`bed_<n>`). Единицы и задания — `tasks.ts`, вид — общий набор `kit`.
import type { GamePanel, PolskaGame } from '../../types/polska';
import { choice, prompt, tiles } from '../kit';
import { checkTask, makeTask, type MonthTask } from './tasks';

function render(task: MonthTask, panel: GamePanel): void {
  prompt(panel, task.prompt, task.hint, task.lang, task.promptSay);
  if (task.mode === 'choice') choice(panel, task.options, task.answer as string, task.optLang);
  // Буквы (сборка названия) не озвучиваются по одной: звучит всё слово после ответа.
  else tiles(panel, task.options, task.kind === 'spell' ? 'ru' : 'pl');
}

export const game: PolskaGame<MonthTask> = {
  id: 'miesiace',
  title: { pl: 'Miesiące', ru: 'Месяцы' },
  desc: 'Все 12 месяцев: название, порядок, «po marcu jest…», форма в дате «3 maja», собери из букв',
  entry: 'calendar',
  plot: 'miesiace',
  kinds: ['month'],
  layout: 'panel',
  // По порядку года: движок держит ≤ 8 растущих, остальные досаживает по мере урожая.
  pool: (ctx) => ctx.units.filter((u) => u.kind === 'month').sort((a, b) => Number(a.raw.month) - Number(b.raw.month)).map((u) => u.id),
  nextTask: makeTask,
  render: (task, panel) => render(task, panel),
  check: (task, answer) => checkTask(task, answer),
  summaryLine: (ctx) => {
    const m = ctx.units.find((u) => u.raw.month === ctx.date().m);
    return m ? `Teraz jest ${m.pl} · сейчас ${m.ru}` : null;
  },
};
