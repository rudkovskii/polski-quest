// Карточка растения на грядке: слово, стадия, капли, стороны, дни и что осталось до урожая (P2a: «До урожая: ещё 1 день»). «Повторить сейчас» зовёт мини-игру.
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { FarmApi } from '../types/farm';
import { el } from './dom';
import { createPanel, nav, STAGE_RU } from './panel';

const css = `
.pc { display: flex; flex-direction: column; gap: 8px; }
.pc .big { font-size: 34px; font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
.pc .ru { font-size: 20px; }
.pc .tr { font-style: italic; opacity: .75; }
.pc-rows { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.pc-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 2px; border-bottom: 1px dashed var(--pq-wood-dark); font-size: 16px; }
.pc-row b { text-align: right; }
.pc-next { background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; padding: 8px 10px; font-size: 15px; }
.pc-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.pc-btns .pq-btn { flex: 1 1 auto; }
`;

export interface PlantCardOptions {
  onReview(id: string): void;
}

export interface PlantCardScreen {
  open(id: string): void;
  close(): void;
  readonly isOpen: boolean;
}

export function mountPlantCard(parent: HTMLElement, api: FarmApi, opts: PlantCardOptions, bus?: Bus<BusEvents>): PlantCardScreen {
  const panel = createPanel({ title: 'Грядка', bus });
  const content = el('div', { class: 'pc' });
  panel.body.append(el('style', {}, css), content);
  parent.append(panel.root);

  let id: string | null = null;
  const ok = (v: boolean): string => (v ? '✓' : '✗');
  const row = (label: string, value: string): HTMLElement => el('div', { class: 'pc-row' }, el('span', {}, label), el('b', {}, value));

  function render(): void {
    if (!id) return;
    const cur = id;
    const item = api.word(cur) ?? api.phrase(cur);
    const i = api.info(cur);
    const stage = i.stage ? STAGE_RU[i.stage] : i.status === 'grown' ? 'в банке' : i.status === 'bag' ? 'в мешке' : 'не посажено';
    content.replaceChildren(
      el('div', { class: 'big', 'data-pl': '' }, item?.pl ?? cur),
      el('div', { class: 'ru' }, item?.ru ?? ''),
      el('div', { class: 'tr' }, item?.tr ?? ''),
      el(
        'div',
        { class: 'pc-rows' },
        row('Стадия', stage),
        row('Капли', `💧×${i.drops}`),
        row('PL → RU', ok(i.sides.pr)),
        row('RU → PL', ok(i.sides.rp)),
        // Слово для урожая собирают само (игра 5 «Собери слово»); у фраз строки нет.
        i.prod === null || i.prod === undefined ? null : row('Собрано само', ok(i.prod)),
        row('Дни с верными ответами', `${i.days} из 3`),
      ),
      el('div', { class: 'pc-next', 'data-next': '' }, el('b', {}, '🌱 '), i.next || 'Всё идёт как надо'),
      el(
        'div',
        { class: 'pc-btns' },
        el('button', { type: 'button', class: 'pq-btn', 'data-say': '', 'aria-label': 'Озвучить', ...nav('pc', 'h', 'say'), onclick: () => api.say(cur) }, '▶'),
        el(
          'button',
          {
            type: 'button',
            class: 'pq-btn',
            'data-review': '',
            ...nav('pc', 'h', 'review'),
            onclick: () => {
              panel.close();
              opts.onReview(cur);
            },
          },
          'Повторить сейчас',
        ),
      ),
    );
    panel.syncFocus();
  }

  let off: (() => void) | null = null;
  panel.onClose(() => {
    off?.();
    off = null;
  });
  return {
    open(next) {
      id = next;
      if (!panel.isOpen) {
        panel.open();
        off = api.onChange(() => panel.isOpen && render());
      }
      render();
      panel.focus('review');
    },
    close() {
      panel.close();
    },
    get isOpen() {
      return panel.isOpen;
    },
  };
}
