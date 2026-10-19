// Доска на ферме: выбор мини-игры из четырёх. Недоступные видны, и написано почему.
// v2: вкладка «Polska» — четыре игры о Польше с прогрессом, «Idź» (герой сам идёт к точке входа) и «Graj tu» (открыть сразу).
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { GameMode, PhraseHint } from '../types/farm';
import { el } from './dom';
import { MODE_ICON, MODE_NAME } from './glossary';
import { createPanel, nav } from './panel';

export interface BoardDeps {
  bus?: Bus<BusEvents>;
  /** Сколько на грядках слов и фраз; `spell` — кустов слов, которым для урожая не хватает слова, собранного самому (игра 5). */
  counts(): { words: number; phrases: number; assemble: number; spell?: number };
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
  games(): { id: string; title: { pl: string; ru: string }; desc: string; progress: string; where: string; pct?: number; medal?: number }[];
  /** Шкала «Wiedza o Polsce» одной строкой («Gość · 2/10 · выращено 12 из 150»). */
  scale(): string;
  go(id: string): void;
  play(id: string): void;
}

export type BoardTab = 'words' | 'polska';

const DESC: Record<GameMode, string> = {
  1: 'Видишь польское слово, выбери перевод',
  2: 'Видишь перевод, выбери польское слово',
  3: 'Видишь русскую фразу, собери её по-польски из плиток',
  4: 'Видишь польскую фразу, собери её по-русски из плиток',
  5: 'Видишь перевод, собери польское слово из букв или напечатай; «↔ наоборот» — по-русски. Без неё слова не созреют',
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
        g.pct === undefined
          ? null
          : el(
              'div',
              { style: 'display:flex;align-items:center;gap:6px' },
              el('div', { 'data-bar': g.id, style: 'flex:1;height:8px;border:2px solid var(--pq-ink);border-radius:5px;background:#fffaf0;overflow:hidden' }, el('div', { style: `height:100%;width:${Math.round(Math.min(1, Math.max(0, g.pct)) * 100)}%;background:var(--pq-leaf)` })),
              el('span', { style: 'font-size:12px;font-weight:700;min-width:36px;text-align:right' }, g.medal === 100 ? '★ 100%' : g.medal === 50 ? '★ 50%+' : `${Math.round(g.pct * 100)}%`),
            ),
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
    for (const m of [1, 2, 3, 4, 5] as GameMode[]) {
      // Фразы короче 3 плиток растут в играх 1 и 2 как слова; сборка — только из длинных; игра 5 — только слова.
      const why =
        m <= 2
          ? c.words + (c.phrases - c.assemble) > 0
            ? ''
            : 'Нет посаженных слов: посади их в словаре дома'
          : m === 5
            ? c.words > 0
              ? ''
              : 'Нет посаженных слов: посади их в словаре дома'
            : c.assemble > 0
              ? ''
              : 'Сборка фраз откроется, когда слова фразы подрастут до ростка';
      const b = el(
        'button',
        { type: 'button', class: 'pq-btn', 'data-mode': m, disabled: !!why, style: 'text-align:left;line-height:1.3', ...nav('modes', 'v', `mode:${m}`), onclick: () => (panel.close(), deps.onPick(m)) },
        el('div', { style: 'font-size:18px;font-weight:800' }, `${MODE_ICON[m]} ${m}. ${MODE_NAME[m].ru} `, el('small', { class: 'board-pl', style: 'font-size:12px;font-weight:600;opacity:.65;white-space:nowrap' }, MODE_NAME[m].pl)),
        el('div', { style: 'font-weight:500;font-size:14px;opacity:.85' }, why || DESC[m]),
        // Кусты, которым до урожая не хватает только собранного слова: подсказка прямо на кнопке игры 5.
        m === 5 && !why && (c.spell ?? 0) > 0 ? el('div', { 'data-spell-wait': '', style: 'font-weight:700;font-size:14px;color:#f2d552' }, `🌾 Ждут сборки для урожая: ${c.spell}`) : null,
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
