// Игра «Miesiące»: колесо года — рамка 4×4, по краю 12 клеток месяцев по часовой стрелке от левого верхнего угла (styczeń), в каждом
// углу своё время года: зима слева сверху, весна справа сверху, лето справа снизу, осень слева снизу. В середине — подпись (экран выбора)
// или месяц, который сейчас ставим (задание `wheel`). Тап по клетке — onclick кнопки (`data-nav`: стрелки и A/Enter даёт движок).
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import type { GamePanel } from '../../types/polska';
import { type MonthTask, type Row, SEASONS } from './tasks';

/** Клетка месяца в сетке 4×4: [строка, столбец] (1-based для CSS grid). */
export const CELL: Readonly<Record<number, readonly [number, number]>> = {
  1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [1, 4], 5: [2, 4], 6: [3, 4],
  7: [4, 4], 8: [4, 3], 9: [4, 2], 10: [4, 1], 11: [3, 1], 12: [2, 1],
};

export const WHEEL_CSS = `
.pq-pg .ms-wheel { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(50px, auto)); gap: 5px; width: 100%;
  max-width: 440px; margin: 6px auto; box-sizing: border-box; }
.pq-pg .ms-cell { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; padding: 14px 2px 4px; margin: 0;
  border: 2px solid var(--pq-ink); border-radius: 8px; font-weight: 800; font-size: clamp(11px, 3.3vw, 15px); line-height: 1.1; color: var(--pq-ink); text-align: center;
  overflow-wrap: anywhere; box-sizing: border-box; }
.pq-pg .ms-cell .n { position: absolute; top: 2px; left: 5px; font-size: 11px; font-weight: 700; opacity: .6; }
.pq-pg .ms-cell.zima { background: #dce9f6; } .pq-pg .ms-cell.wiosna { background: #e2f1c6; }
.pq-pg .ms-cell.lato { background: #fbe6a0; } .pq-pg .ms-cell.jesien { background: #f5cfa8; }
.pq-pg .ms-cell.empty .q { font-size: 20px; opacity: .35; }
.pq-pg button.ms-cell { cursor: pointer; }
.pq-pg button.ms-cell:hover, .pq-pg button.ms-cell.is-focus { box-shadow: 0 0 0 3px var(--pq-accent); }
.pq-pg .ms-cell.now { box-shadow: 0 0 0 3px #b84c40; }
.pq-pg .ms-cell.put { animation: ms-put .45s ease-out; }
.pq-pg .ms-cell.bad { animation: ms-bad .4s ease-in-out; background: #f6c4b8; }
.pq-pg .ms-cell.hint { animation: ms-hint 1s ease-in-out infinite; }
@keyframes ms-put { from { transform: scale(1.18); background: #b8e08c; } to { transform: scale(1); } }
@keyframes ms-bad { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
@keyframes ms-hint { 50% { box-shadow: 0 0 0 4px #4f9a3c; } }
.pq-pg .ms-mid { grid-row: 2 / span 2; grid-column: 2 / span 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  min-width: 0; padding: 4px; border: 2px dashed var(--pq-wood-dark); border-radius: 10px; background: #fffaf0; text-align: center; }
.pq-pg .ms-mid .big { display: flex; align-items: center; gap: 6px; font-size: clamp(18px, 5.6vw, 26px); font-weight: 800; }
.pq-pg .ms-mid small { font-size: 12px; opacity: .75; line-height: 1.2; }
.pq-pg .ms-mid .ms-seasons { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .pq-pg .ms-cell.put, .pq-pg .ms-cell.bad, .pq-pg .ms-cell.hint { animation: none; } }
`;

const gridPos = (n: number): string => `grid-row:${CELL[n]![0]};grid-column:${CELL[n]![1]}`;

/** Клетка-табличка: номер в углу, название или «?». */
function plate(r: Row, text: string | null, extra = ''): HTMLElement {
  return el(
    'div',
    { class: `ms-cell ${r.season} ${text ? '' : 'empty'} ${extra}`.trim(), style: gridPos(r.n), 'data-cell': String(r.n), lang: 'pl' },
    el('span', { class: 'n' }, String(r.n)),
    text ? el('span', {}, text) : el('span', { class: 'q' }, '?'),
  );
}

/** Колесо на экране выбора: знакомые месяцы подписаны, незнакомые — «?», текущий месяц обведён. */
export function yearView(rows: ReadonlyMap<number, Row>, met: ReadonlySet<number>, now: number): HTMLElement {
  const g = el('div', { class: 'ms-wheel', 'data-year': '' });
  for (const r of rows.values()) g.append(plate(r, met.has(r.n) ? r.nom : null, r.n === now ? 'now' : ''));
  const cur = rows.get(now);
  g.append(
    el(
      'div',
      { class: 'ms-mid' },
      el('div', { class: 'ms-seasons', lang: 'pl' }, ...(['zima', 'wiosna', 'jesien', 'lato'] as const).map((s) => el('span', {}, `${SEASONS[s].pl} · ${SEASONS[s].ru}`))),
      cur ? el('small', {}, el('span', { lang: 'pl' }, `Teraz jest ${cur.nom}`), ` · сейчас ${cur.nom_ru}`) : null,
      el('small', {}, `Знакомо: ${met.size} из 12`),
    ),
  );
  return g;
}

/**
 * Задание «колесо»: месяцы из `task.wheel.place` по одному в середине, тап по клетке ставит. Не та клетка — встряска и промах; после двух
 * промахов на месяце верная клетка подсвечивается. Все на местах — `panel.submit({ mistakes })`.
 */
export function wheelGame(task: MonthTask, rows: ReadonlyMap<number, Row>, panel: GamePanel): HTMLElement {
  const w = task.wheel!;
  const placed = new Set(w.fixed);
  const queue = [...w.place];
  let mistakes = 0;
  let tries = 0;
  const g = el('div', { class: 'ms-wheel', 'data-wheel': '' });
  const mid = el('div', { class: 'ms-mid', 'data-wheel-now': '' });
  const cells = new Map<number, HTMLElement>();

  const paintMid = (): void => {
    const cur = rows.get(queue[0]!);
    if (!cur) return mid.replaceChildren(el('small', {}, 'Готово'));
    const left = queue.length;
    mid.replaceChildren(
      el('small', { lang: 'pl' }, 'Gdzie jest…'),
      el('div', { class: 'big' }, el('span', { lang: 'pl', 'data-wheel-month': String(cur.n) }, cur.nom), sayButton(cur.nom, panel.say)),
      el('small', {}, `осталось ${left}`),
    );
  };

  const tap = (n: number): void => {
    const cur = queue[0];
    if (cur === undefined || placed.has(n)) return;
    const c = cells.get(n)!;
    if (n !== cur) {
      mistakes++;
      tries++;
      c.classList.remove('bad');
      void c.offsetWidth;
      c.classList.add('bad');
      setTimeout(() => c.classList.remove('bad'), 450);
      if (tries >= 2) cells.get(cur)?.classList.add('hint');
      return;
    }
    placed.add(n);
    queue.shift();
    tries = 0;
    const r = rows.get(n)!;
    const done = plate(r, r.nom, 'put');
    c.replaceWith(done);
    cells.set(n, done);
    panel.say(r.nom);
    paintMid();
    if (!queue.length) panel.submit({ mistakes });
  };

  for (const r of rows.values()) {
    if (placed.has(r.n)) {
      const p = plate(r, r.nom);
      cells.set(r.n, p);
      g.append(p);
      continue;
    }
    const b = el(
      'button',
      { type: 'button', class: `ms-cell empty ${r.season}`, style: gridPos(r.n), 'data-nav': '', 'data-cell': String(r.n), 'aria-label': `${r.n}`, onclick: () => tap(r.n) },
      el('span', { class: 'n' }, String(r.n)),
      el('span', { class: 'q' }, '?'),
    );
    cells.set(r.n, b);
    g.append(b);
  }
  g.append(mid);
  paintMid();
  return g;
}
