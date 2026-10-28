// Выбор игры у точки входа, где игр несколько (26.10: у мачты — «Hymn» и «Symbole», у календаря — «Daty» и «Miesiące»).
// Кнопка на игру: название по-польски крупно, по-русски и строка «как играть» мельче; клавиши 1–2 и стрелки — как в любой панели.
import type { PolskaGame, PolskaGameId } from '../types/polska';
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { createPanel, nav } from './panel';

const css = `
.pq-epick { display: flex; flex-direction: column; gap: 10px; }
.pq-epick .pq-btn { text-align: left; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
.pq-epick b { font-size: 20px; }
.pq-epick small { font-size: 13px; opacity: .75; font-weight: 600; }
`;

export interface EntryPick {
  open(games: readonly PolskaGame[]): void;
  readonly isOpen: boolean;
}

export function mountEntryPick(parent: HTMLElement, deps: { play(id: PolskaGameId): void; bus?: Bus<BusEvents> }): EntryPick {
  const panel = createPanel({ title: 'Во что играем?', bus: deps.bus ?? globalBus });
  parent.append(panel.root);
  return {
    open(games) {
      const list = el('div', { class: 'pq-epick', 'data-entry-pick': '' }, el('style', {}, css));
      games.forEach((g, i) =>
        list.append(
          el(
            'button',
            { type: 'button', class: 'pq-btn', ...nav('games', 'v', g.id), 'data-pick-game': g.id, onclick: () => (panel.close(), deps.play(g.id)) },
            el('b', { lang: 'pl' }, `${i + 1}. ${g.title.pl}`),
            el('span', {}, g.title.ru),
            el('small', {}, g.desc),
          ),
        ),
      );
      panel.body.replaceChildren(list);
      panel.open();
      panel.focus();
    },
    get isOpen() {
      return panel.isOpen;
    },
  };
}
