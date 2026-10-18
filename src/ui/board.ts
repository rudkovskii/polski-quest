// Доска на ферме: выбор мини-игры из четырёх. Недоступные видны, и написано почему.
// v2: вкладка «Polska» — четыре игры о Польше с прогрессом, «Idź» (герой сам идёт к точке входа) и «Graj tu» (открыть сразу).
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { GameMode, PhraseHint } from '../types/farm';
import { el } from './dom';
import { MODE_NAME } from './glossary';
import { createPanel, nav } from './panel';

export interface BoardDeps {
  bus?: Bus<BusEvents>;
  /** Сколько на грядках слов и фраз. */
  counts(): { words: number; phrases: number; assemble: number };
  onPick(mode: GameMode): void;
  /** Ближайшая фраза для сборки и что ей нужно (P3a); без неё — только общая подсказка. */
  phraseHint?(): PhraseHint | null;
  /** Посадить по кнопке подсказки. */
  plant?(ids: readonly string[]): void;
  /** v2: игры о Польше для вкладки «Polska»; нет — вкладки нет. */
  polska?: BoardPolska;
}

/** Вкладка «Polska»: строка игры, «Idź» и «Graj tu». */
export interface BoardPolska {
  games(): { id: string; title: { pl: string; ru: string }; desc: string; progress: string; where: string }[];
  /** Шкала «Wiedza o Polsce» одной строкой («Gość · 2/10 · выращено 12 из 150»). */
  scale(): string;
  go(id: string): void;
  play(id: string): void;
}

export type BoardTab = 'words' | 'polska';

const DESC: Record<GameMode, string> = {
  1: 'Видишь польское слово, выбери перевод',
  2: 'Видишь перевод, выбери польское слово (ближе к кустику — напиши сам)',
  3: 'Видишь русскую фразу, собери её по-польски из плиток',
  4: 'Видишь польскую фразу, собери её по-русски из плиток',
};

export function mountBoard(parent: HTMLElement, deps: BoardDeps): { open(tab?: BoardTab): void; close(): void; readonly isOpen: boolean; readonly tab: BoardTab } {
  const panel = createPanel({ title: 'Tablica · Мини-игры', ...(deps.bus ? { bus: deps.bus } : {}) });
  parent.append(panel.root);
  let tab: BoardTab = 'words';
  const tabs = (): HTMLElement | null => {
    if (!deps.polska) return null;
    const b = (id: BoardTab, label: string): HTMLElement =>
      el('button', { type: 'button', class: `pq-btn small${tab === id ? ' on' : ''}`, 'data-tab': id, 'aria-pressed': tab === id ? 'true' : 'false', ...nav('tabs', 'h', `tab:${id}`), onclick: () => ((tab = id), render(), panel.syncFocus()) }, label);
    return el('div', { class: 'board-tabs', style: 'display:flex;gap:6px' }, b('words', 'Słowa · Слова'), b('polska', 'Polska · О Польше'));
  };
  const renderPolska = (p: BoardPolska): void => {
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    const t = tabs();
    if (t) list.append(t);
    list.append(el('div', { class: 'pq-muted', 'data-polska-scale': '' }, `Wiedza o Polsce: ${p.scale()}`));
    for (const g of p.games()) {
      const row = el(
        'div',
        { class: 'board-polska', 'data-game': g.id, style: 'display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:8px;background:rgba(0,0,0,.06)' },
        el('div', { style: 'font-size:18px;font-weight:800' }, `${g.title.ru} `, el('small', { class: 'board-pl', style: 'font-size:12px;font-weight:600;opacity:.65;white-space:nowrap' }, g.title.pl)),
        el('div', { style: 'font-weight:500;font-size:14px;opacity:.85' }, g.desc),
        el('div', { class: 'pq-muted', 'data-progress': '', style: 'font-size:13px' }, `${g.progress} · ${g.where}`),
        el(
          'div',
          { style: 'display:flex;gap:6px' },
          el('button', { type: 'button', class: 'pq-btn small', 'data-go': g.id, style: 'flex:1', ...nav('polska', 'h', `go:${g.id}`), onclick: () => (panel.close(), p.go(g.id)) }, 'Idź · Идти'),
          el('button', { type: 'button', class: 'pq-btn small', 'data-play': g.id, style: 'flex:1', ...nav('polska', 'h', `play:${g.id}`), onclick: () => (panel.close(), p.play(g.id)) }, 'Graj tu · Играть здесь'),
        ),
      );
      list.append(row);
    }
    panel.body.replaceChildren(list);
  };
  const render = (): void => {
    if (tab === 'polska' && deps.polska) return renderPolska(deps.polska);
    const c = deps.counts();
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    const t = tabs();
    if (t) list.append(t);
    list.append(el('div', { class: 'pq-muted' }, `На грядках: слов ${c.words}, фраз ${c.phrases}. Пока отвечаешь, фермер сам поливает.`));
    for (const m of [1, 2, 3, 4] as GameMode[]) {
      // Фразы короче 3 плиток растут в играх 1 и 2 как слова; сборка — только из длинных.
      const why =
        m <= 2
          ? c.words + (c.phrases - c.assemble) > 0
            ? ''
            : 'Нет посаженных слов: посади их в словаре дома'
          : c.assemble > 0
            ? ''
            : 'Сборка фраз откроется, когда слова фразы подрастут до ростка';
      const b = el(
        'button',
        { type: 'button', class: 'pq-btn', 'data-mode': m, disabled: !!why, style: 'text-align:left;line-height:1.3', ...nav('modes', 'v', `mode:${m}`), onclick: () => (panel.close(), deps.onPick(m)) },
        el('div', { style: 'font-size:18px;font-weight:800' }, `${m}. ${MODE_NAME[m].ru} `, el('small', { class: 'board-pl', style: 'font-size:12px;font-weight:600;opacity:.65;white-space:nowrap' }, MODE_NAME[m].pl)),
        el('div', { style: 'font-weight:500;font-size:14px;opacity:.85' }, why || DESC[m]),
      );
      list.append(b);
    }
    // Игры 3 и 4 закрыты: ближайшая фраза, её недостающие слова и кнопка «Посадить недостающие».
    const hint = c.assemble === 0 ? deps.phraseHint?.() : null;
    if (hint) {
      const box = el('div', { class: 'board-hint', style: 'display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:8px;background:rgba(0,0,0,.06)' });
      box.append(el('div', { style: 'font-weight:700' }, `Ближайшая фраза: «${hint.pl}»`), el('div', { class: 'pq-muted' }, hint.ru));
      if (hint.ready) box.append(el('div', {}, 'Её слова уже подросли: посади фразу, и сборка откроется.'));
      else {
        // Одно слово — в одной строке: что осталось посадить и что уже растёт (подрастёт до ростка).
        if (hint.need.length) box.append(el('div', { class: 'board-need' }, `Нужно: ${hint.need.join(', ')}`));
        if (hint.growing.length) box.append(el('div', { class: 'pq-muted board-growing' }, `Уже растут: ${hint.growing.join(', ')}`));
      }
      if (hint.toPlant.length && deps.plant) {
        const ids = hint.toPlant;
        box.append(
          el(
            'button',
            { type: 'button', class: 'pq-btn', 'data-act': 'plant-missing', ...nav('modes', 'v', 'plant-missing'), onclick: () => (deps.plant!(ids), render()) },
            hint.ready ? 'Посадить фразу' : 'Посадить недостающие',
          ),
        );
      }
      list.append(box);
    }
    panel.body.replaceChildren(list);
  };
  return {
    open(t?: BoardTab) {
      if (t) tab = t;
      render();
      panel.open();
      panel.focus();
    },
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
    get tab() {
      return tab;
    },
  };
}
