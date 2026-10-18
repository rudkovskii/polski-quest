// Игра 3: Daty («Kalendarz», ФЕРМА_v2.md §4). ЗАГЛУШКА ядра v2: выбор/плитки из `games/stub.ts`.
// Игровой агент заменяет этот файл: календарь во весь экран, барабаны, «Którego jest dzisiaj?».
import { makeStubGame } from '../stub';

export const game = makeStubGame({
  id: 'daty',
  title: { pl: 'Kalendarz', ru: 'Памятные даты' },
  desc: 'Памятные даты Польши: когда и что отмечаем',
  entry: 'calendar',
  plot: 'miesiace',
  kinds: ['date'],
  layout: 'full',
});
