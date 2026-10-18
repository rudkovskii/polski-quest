// Игра 4: Święta («Tablica sezonowa», ФЕРМА_v2.md §5). ЗАГЛУШКА ядра v2: выбор/плитки из `games/stub.ts`.
// Игровой агент заменяет этот файл: «Co to za święto?», корзинка, пожелания, «Sklepy otwarte?», сезонный порядок.
import { makeStubGame } from '../stub';

export const game = makeStubGame({
  id: 'swieta',
  title: { pl: 'Święta', ru: 'Праздники' },
  desc: 'Праздники года: когда, что делают, что едят и что желают',
  entry: 'seasonBoard',
  plot: 'klumba',
  kinds: ['holiday'],
  layout: 'panel',
});
