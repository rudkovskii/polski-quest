// Игра 1: Geografia («Mapa Polski», ФЕРМА_v2.md §2). ЗАГЛУШКА ядра v2: выбор/плитки из `games/stub.ts`.
// Игровой агент заменяет этот файл (и добавляет свои в эту папку): карта во весь экран, флажки, мини-герой.
import { makeStubGame } from '../stub';

export const game = makeStubGame({
  id: 'geo',
  title: { pl: 'Mapa Polski', ru: 'Карта Польши' },
  desc: 'Города, реки, горы и соседи: узнай на карте и назови',
  entry: 'map',
  plot: 'sad',
  kinds: ['geo'],
  layout: 'full',
});
