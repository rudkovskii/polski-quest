// Доска на ферме: выбор мини-игры из четырёх. Недоступные видны, и написано почему.
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { GameMode } from '../types/farm';
import { el } from './dom';
import { MODE_TITLE } from './minigame';
import { createPanel, nav } from './panel';

export interface BoardDeps {
  bus?: Bus<BusEvents>;
  /** Сколько на грядках слов и фраз. */
  counts(): { words: number; phrases: number };
  onPick(mode: GameMode): void;
}

const DESC: Record<GameMode, string> = {
  1: 'Польское слово → выбери перевод',
  2: 'Русское слово → польское (кусты — набрать самому)',
  3: 'Русская фраза → собери по-польски из плиток',
  4: 'Польская фраза → собери по-русски из плиток',
};

export function mountBoard(parent: HTMLElement, deps: BoardDeps): { open(): void; close(): void; readonly isOpen: boolean } {
  const panel = createPanel({ title: 'Tablica · Мини-игры', ...(deps.bus ? { bus: deps.bus } : {}) });
  parent.append(panel.root);
  const render = (): void => {
    const c = deps.counts();
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    list.append(el('div', { class: 'pq-muted' }, `На грядках: слов ${c.words}, фраз ${c.phrases}. Пока отвечаешь, фермер сам поливает.`));
    for (const m of [1, 2, 3, 4] as GameMode[]) {
      const why = m <= 2 ? (c.words ? '' : 'Нет посаженных слов: посади их в словаре дома') : c.phrases ? '' : 'Нет посаженных фраз: фраза открывается в словаре, когда все её слова — кусты';
      const b = el(
        'button',
        { type: 'button', class: 'pq-btn', 'data-mode': m, disabled: !!why, style: 'text-align:left;line-height:1.3', ...nav('modes', 'v', `mode:${m}`), onclick: () => (panel.close(), deps.onPick(m)) },
        el('div', { style: 'font-size:18px;font-weight:800' }, `${m}. ${MODE_TITLE[m]}`),
        el('div', { style: 'font-weight:500;font-size:14px;opacity:.85' }, why || DESC[m]),
      );
      list.append(b);
    }
    panel.body.replaceChildren(list);
  };
  return {
    open() {
      render();
      panel.open();
      panel.focus();
    },
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
  };
}
