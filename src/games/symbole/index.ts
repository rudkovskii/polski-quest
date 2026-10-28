// Игра «Symbole» («Maszt», ФЕРМА_v2.md §3): герб, флаг, гимн как символ, Лех и орёл — вопросы-шаблоны с дистракторами, «Czyj to symbol?»,
// сборка флага и герба тап-тап, порядок легенды о Лехе. До 26.10 была частью «Hymn i symbole»; разделены по просьбе Шэфа. Данные — `hymn.json:symbols`,
// задания и вид — общие с гимном (`games/hymn/tasks.ts`, `view.ts`): прогресс по символам в старых сохранениях не теряется (id те же).
import type { PolskaGame } from '../../types/polska';
import { bandOrder } from '../stub';
import { checkTask, makeTask, type HymnTask } from '../hymn/tasks';
import { renderTask } from '../hymn/view';

export const game: PolskaGame<HymnTask> = {
  id: 'symbole',
  title: { pl: 'Symbole narodowe', ru: 'Символы Польши' },
  desc: 'Герб, флаг, цвета и легенда о Лехе: вопросы, «чей символ», собери флаг и герб',
  entry: 'mast',
  plot: 'pasieka',
  kinds: ['symbol'],
  layout: 'panel',
  pool: (ctx) => bandOrder(ctx.units.filter((u) => u.kind === 'symbol')),
  nextTask: makeTask,
  render: (task, panel) => renderTask(task, panel),
  check: (task, answer) => checkTask(task, answer),
};
