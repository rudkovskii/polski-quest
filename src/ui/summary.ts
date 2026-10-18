// Skrzynka · Коробка урожая (ферма) и Łóżko · Итог (кровать дома): сводка по выращенному. Без лимитов и «до завтра».
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { FarmApi } from '../types/farm';
import { el } from './dom';
import { TIP_CSS, type Tips } from './glossary';
import { createPanel, nav } from './panel';
import { growthText, levelLabel } from '../systems/xp';

const css = `
${TIP_CSS}
.sum { display: flex; flex-direction: column; gap: 10px; }
.sum-hero { display: flex; gap: 10px; }
.sum-big { flex: 1 1 0; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; padding: 10px; text-align: center; }
.sum-big b { display: block; font-size: 34px; line-height: 1.1; }
.sum-big span { font-size: 14px; opacity: .75; }
.sum-rows { display: flex; flex-direction: column; gap: 4px; }
.sum-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 4px; border-bottom: 1px dashed var(--pq-wood-dark); font-size: 16px; }
.sum-row b { font-size: 17px; }
.sum-level { background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; padding: 10px; }
.sum-level .top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.sum-level .lvl { font-size: 26px; font-weight: 700; }
.sum-bar { height: 16px; background: #e4d4a8; border: 2px solid var(--pq-ink); border-radius: 8px; overflow: hidden; }
.sum-bar i { display: block; height: 100%; background: var(--pq-leaf); }
.sum-hint { font-size: 14px; opacity: .8; }
`;

export interface SummaryScreen {
  openBin(): void;
  openBed(): void;
  close(): void;
  readonly isOpen: boolean;
}


export function mountSummary(parent: HTMLElement, api: FarmApi, bus?: Bus<BusEvents>, tips?: Tips, onPath?: () => void): SummaryScreen {
  const panel = createPanel({ title: '', bus });
  const content = el('div', { class: 'sum' });
  const closeBtn = el('button', { type: 'button', class: 'pq-btn', 'data-done': '', ...nav('done', 'v', 'done'), onclick: () => panel.close() }, 'Закрыть');
  panel.body.append(el('style', {}, css), content, el('div', { style: 'margin-top:12px' }, closeBtn));
  parent.append(panel.root);

  let kind: 'bin' | 'bed' = 'bin';
  const hero = (today: number, total: number): HTMLElement =>
    el(
      'div',
      { class: 'sum-hero' },
      el('div', { class: 'sum-big' }, el('b', { 'data-today': '' }, String(today)), el('span', {}, 'выращено сегодня')),
      el('div', { class: 'sum-big' }, el('b', { 'data-total': '' }, String(total)), el('span', {}, 'выращено всего')),
    );
  const row = (label: string, value: string | number): HTMLElement => el('div', { class: 'sum-row' }, el('span', {}, label), el('b', {}, String(value)));

  function render(): void {
    const s = api.stats();
    if (kind === 'bin') {
      panel.setTitle('Skrzynka · Коробка урожая');
      content.replaceChildren(hero(s.grownToday, s.grownTotal), el('div', { class: 'sum-hint' }, 'Урожай сюда носит фермер сам во время мини-игр.'));
      return;
    }
    panel.setTitle('Łóżko · Итог');
    const p = s.path;
    const pct = Math.max(0, Math.min(100, Math.round(s.ratio * 100)));
    const grow = growthText(s.sessionGain);
    content.replaceChildren(
      hero(s.grownToday, s.grownTotal),
      el(
        'div',
        { class: 'sum-level' },
        el('div', { class: 'top' }, el('span', { class: 'lvl', 'data-level': '' }, levelLabel(p.sub)), el('span', { 'data-session-gain': '' }, grow ? `${grow} за сессию` : `${s.xp} опыта`)),
        el('div', { class: 'sum-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: `width:${pct}%` })),
        el('div', { class: 'sum-hint', style: 'margin-top:4px', 'data-level-hint': '' }, p.a1 ? 'Уровень A1: вся база выращена' : `До A1: ${Math.floor(p.pct * 100)}% · до ${p.nextTo} ещё ${p.toNext} оч.`),
        onPath ? el('button', { type: 'button', class: 'pq-btn small', style: 'margin-top:8px', 'data-open-path': '', ...nav('path', 'v', 'path'), onclick: () => (panel.close(), onPath()) }, 'Путь к A1') : null,
      ),
      el(
        'div',
        { class: 'sum-rows' },
        row('Слов в банках', s.grownWords),
        row('Фраз в банках', s.grownPhrases),
        row('Растёт на грядках', s.growing),
        row('В мешке', s.bag),
        row('Ответов сегодня', s.answersToday),
      ),
      ...[tips?.note('jar'), tips?.note('bag')].filter((n): n is HTMLElement => !!n),
    );
  }

  let off: (() => void) | null = null;
  panel.onClose(() => {
    off?.();
    off = null;
    tips?.commit();
  });
  const show = (k: 'bin' | 'bed'): void => {
    kind = k;
    if (!panel.isOpen) {
      panel.open();
      off = api.onChange(() => panel.isOpen && render());
    }
    render();
    panel.focus();
  };
  return {
    openBin: () => show('bin'),
    openBed: () => show('bed'),
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
  };
}
