// Карточка объекта участка Zagroda (v2): яблоня-воеводство, улей-куплет, грядка-месяц, место на клумбе.
// Тап по объекту (`world:interact`, `use: 'zplot'`) — название и единицы со стадиями, «Повторить сейчас» по каждой и «Играть».
import type { Polska } from '../systems/polska';
import { PLOT_NAME } from '../systems/zagroda';
import type { PolskaGameId } from '../types/polska';
import { el } from './dom';
import { STAGE_INFO } from './glossary';
import { createPanel, nav } from './panel';

export interface PolskaPlotDeps {
  polska: Polska;
  /** Открыть игру (по всем единицам или одно задание по `only`). */
  play(game: PolskaGameId, only?: string): void;
  gameOf(obj: string): PolskaGameId | null;
}

export function mountPolskaPlot(parent: HTMLElement, deps: PolskaPlotDeps): { open(obj: string): void; readonly isOpen: boolean } {
  const panel = createPanel({ title: 'Zagroda' });
  parent.append(panel.root);
  const render = (obj: string): void => {
    const view = deps.polska.plots().find((v) => v.obj === obj);
    const game = deps.gameOf(obj);
    const units = deps.polska.content.units.filter((u) => deps.polska.ref(u.id)?.obj === obj);
    const name = view ? PLOT_NAME[view.plot] : { pl: 'Zagroda', ru: 'Загорода' };
    panel.setTitle(`${name.pl} · ${name.ru}`);
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    list.append(el('div', { class: 'pq-muted', 'data-plot-sum': '' }, view ? `Выращено ${view.grown} из ${view.units}` : 'Здесь пока ничего не растёт'));
    for (const u of units) {
      const inf = deps.polska.info(u.id);
      const stage = inf.stage ? `🌱 ${STAGE_INFO[inf.stage].ru} · ${inf.next}` : inf.harvests > 0 ? '🫙 в коллекции' : '· не посажено';
      const row = el(
        'div',
        { 'data-unit': u.id, style: 'display:flex;align-items:center;gap:8px' },
        el('div', { style: 'flex:1;min-width:0' }, el('span', { class: 'pq-pl' }, u.pl), ' ', el('span', { class: 'pq-muted' }, u.ru), el('div', { class: 'pq-muted', style: 'font-size:13px' }, stage)),
      );
      if (game && inf.planted) row.append(el('button', { type: 'button', class: 'pq-btn small', ...nav('units', 'v', `rev:${u.id}`), onclick: () => (panel.close(), deps.play(game, u.id)) }, 'Повторить'));
      list.append(row);
    }
    if (game) list.append(el('button', { type: 'button', class: 'pq-btn', 'data-play': game, ...nav('units', 'v', 'play'), onclick: () => (panel.close(), deps.play(game)) }, 'Играть'));
    panel.body.replaceChildren(list);
  };
  return {
    open(obj) {
      render(obj);
      panel.open();
      panel.focus();
    },
    get isOpen() {
      return panel.isOpen;
    },
  };
}
