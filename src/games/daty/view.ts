// Игра 3: Daty — DOM: страница отрывного календаря (сетка месяца), барабаны день/месяц, лист с датой, стили.
// Весь ввод — click на кнопках (клавиши, стрелки и 1–4 ведёт движок через [data-nav] и [data-opt]); своих keydown/pointerdown нет.
import { el } from '../../ui/dom';
import { sayButton, type SayFn } from '../../ui/sayButton';
import { ICON_FRAME, WEEKDAYS, iconOf, monthGrid, monthRow, sayDate, shiftMonth, spin, type DayMonth } from './model';
/** Значок даты в углу клетки: кадр атласа 16×16 (знич, флажок, мини-предмет), без кадра — глиф. */
function markIcon(icon: string): HTMLElement | string {
  const name = ICON_FRAME[icon];
  const frame = name ? (name.includes('/') ? name : plantIconFrame(name)) : null;
  return (frame ? atlasIcon(frame, 1, 'dt-ico') : null) ?? iconOf(icon);
}

import { atlasIcon, plantIconFrame } from '../../ui/atlasIcon';

export const CSS = `
.dt { max-width: 480px; margin: 0 auto; }
.dt-page { background: #fffaf0; border: 3px solid var(--pq-ink); border-radius: 4px; box-shadow: 0 4px 0 var(--pq-ink); overflow: hidden; margin: 6px 0 4px; }
.dt-band { display: flex; align-items: center; gap: 6px; background: #b3322b; color: #fff4e0; padding: 4px 6px; min-height: 40px; font-weight: 800; border-bottom: 3px solid var(--pq-ink); }
.dt-band .ttl { flex: 1 1 auto; text-align: center; font-size: 20px; text-transform: capitalize; letter-spacing: .5px; }
.dt-band .pq-btn { flex: 0 0 auto; width: 44px; padding: 6px 0; font-size: 18px; background: #8a2620; }
.dt-wd { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 12px; font-weight: 700; padding: 4px 4px 0; color: #7a4b35; }
.dt-wd span:nth-child(7), .dt-wd span:nth-child(6) { color: #b3322b; }
.dt-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; padding: 4px; }
.dt-day, .dt-blank { position: relative; min-height: 40px; box-sizing: border-box; }
.dt-day { font: 700 17px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink); background: #fff; border: 2px solid #d8c7a3; border-radius: 4px; cursor: pointer; padding: 0; touch-action: manipulation; font-variant-numeric: tabular-nums; }
.dt-day:active { transform: translateY(1px); }
.dt-day.sun { color: #b3322b; }
.dt-day.today { border-color: var(--pq-wood); box-shadow: inset 0 -4px 0 var(--pq-leaf); }
.dt-day[disabled] { opacity: 1; cursor: default; }
.dt-day .dt-mark { position: absolute; right: 1px; top: 1px; font-size: 11px; line-height: 1; z-index: 1; }
.dt-day .dt-mark .dt-ico { display: block; }
.dt-grid:not(.reveal) .dt-mark { display: none; }
.dt-day .dt-ring { position: absolute; inset: -3px; width: calc(100% + 6px); height: calc(100% + 6px); pointer-events: none; }
.dt-ring ellipse { fill: none; stroke: #c2281f; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100; animation: dt-draw .45s steps(9) forwards; }
.dt-calm .dt-ring ellipse, .dt-ring.calm ellipse { animation: none; stroke-dashoffset: 0; stroke: #7a3a34; }
.dt-day.miss { background: #f3d5cb; border-color: #b3322b; }
.dt-day.miss::after { content: '✕'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; color: #b3322b; opacity: .6; }
@keyframes dt-draw { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) { .dt-ring ellipse { animation: none; stroke-dashoffset: 0; } }
.dt-leaf { display: inline-block; vertical-align: top; width: 112px; text-align: center; background: #fffaf0; border: 3px solid var(--pq-ink); border-radius: 4px; box-shadow: 0 4px 0 var(--pq-ink); overflow: hidden; margin: 4px 0 8px; }
.dt-leaf .top { background: #b3322b; color: #fff4e0; font-weight: 800; padding: 3px 0; text-transform: capitalize; border-bottom: 3px solid var(--pq-ink); }
.dt-leaf .day { font-size: 54px; font-weight: 900; line-height: 1.05; padding: 4px 0 0; font-variant-numeric: tabular-nums; }
.dt-leaf .yr { font-size: 15px; font-weight: 700; color: #7a4b35; padding-bottom: 5px; font-variant-numeric: tabular-nums; min-height: 20px; }
.dt-year { display: inline-block; margin: 0 0 6px 8px; padding: 1px 9px; border: 2px solid var(--pq-wood); border-radius: 12px; background: #f2dcae; font-weight: 800; font-size: 16px; font-variant-numeric: tabular-nums; }
.dt-topline { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 4px 12px; }
.dt-topline .txt { flex: 1 1 200px; min-width: 0; }
.dt-drums { display: flex; justify-content: center; gap: 12px; margin: 6px 0 4px; }
.dt-drum { flex: 1 1 0; max-width: 190px; display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.dt-drum .pq-btn { padding: 6px 0; font-size: 18px; }
.dt-win { background: #fffaf0; border: 3px solid var(--pq-ink); border-radius: 6px; box-shadow: inset 0 0 0 2px var(--pq-wood-dark); padding: 2px 0; position: relative; }
.dt-win::before { content: ''; position: absolute; left: 0; right: 0; top: calc(50% - 21px); height: 42px; border-top: 3px solid #b3322b; border-bottom: 3px solid #b3322b; pointer-events: none; }
.dt-row { display: block; width: 100%; box-sizing: border-box; height: 34px; line-height: 34px; margin: 0; padding: 0; border: 0; background: none; font: 700 18px/34px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink); text-align: center; cursor: pointer; overflow: hidden; touch-action: manipulation; }
.dt-row.near { opacity: .55; } .dt-row.far { opacity: .25; font-size: 15px; }
.dt-row.cur { height: 42px; line-height: 42px; font-size: 24px; font-weight: 900; cursor: default; }
.dt-read { margin: 8px 0 2px; padding: 8px 10px; text-align: center; font-size: 20px; font-weight: 800; background: #f2dcae; border: 2px dashed var(--pq-wood); border-radius: 6px; min-height: 28px; overflow-wrap: anywhere; }
.dt-readrow { align-items: center; } .dt-readrow > .dt-read { flex: 1 1 auto; min-width: 0; } .dt-readrow > .pq-say { margin-top: 0; }
.dt-event { font-size: 15px; font-weight: 700; opacity: .85; margin: 0 0 4px; }
.pq-pg .dt .pq-opts { grid-auto-rows: minmax(54px, auto); }
.pq-pg .dt .pq-opt { height: auto; min-height: 54px; }
.dt[data-calm] .pq-opt.right { background: #cdd8bd; }
.pq-pg .paper:has(.dt[data-calm]).ok { background: #e7e0cf; }
.pq-pg .paper:has(.dt[data-calm]).bad { background: #ebdcd2; }
.dt[data-calm] .dt-ring ellipse { animation: none; stroke-dashoffset: 0; stroke: #7a3a34; }
@media (max-width: 520px) { .dt { padding: 0 8px; box-sizing: border-box; } .pq-pg .dt[data-dt=co] .pq-opts { grid-template-columns: 1fr; } .dt-day, .dt-blank { min-height: 36px; } .dt-day { font-size: 16px; } .dt-leaf { width: 96px; } .dt-leaf .day { font-size: 46px; } .dt-row.far { display: none; } }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Красный кружок «ручкой» (3 кадра рисования — stroke-dashoffset со ступенями). */
export function ring(calm = false): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', calm ? 'dt-ring calm' : 'dt-ring');
  svg.setAttribute('data-ring', '');
  svg.setAttribute('aria-hidden', 'true');
  const e = document.createElementNS(SVG_NS, 'ellipse');
  for (const [k, v] of Object.entries({ cx: '20', cy: '20', rx: '17', ry: '15', pathLength: '100', transform: 'rotate(-6 20 20)' })) e.setAttribute(k, v);
  svg.append(e);
  return svg;
}

/** Лист календаря с датой: красная планка с месяцем, крупное число, год цифрой (если есть). */
export function leaf(doc: Readonly<Record<string, unknown>>, d: DayMonth, year: number | null): HTMLElement {
  return el(
    'div',
    { class: 'dt-leaf', 'data-leaf': '' },
    el('div', { class: 'top', lang: 'pl' }, monthRow(doc, d.month)?.nom ?? ''),
    el('div', { class: 'day' }, `${d.day}`),
    el('div', { class: 'yr', 'data-year': year ?? undefined }, year === null ? '' : `${year}`),
  );
}

/** Год рядом с вопросом: только цифрами. */
export const yearChip = (year: number | null): HTMLElement | null => (year === null ? null : el('span', { class: 'dt-year', 'data-year': year }, `${year}`));

export interface CalendarOpts {
  doc: Readonly<Record<string, unknown>>;
  year: number;
  month: number;
  today: { y: number; m: number; d: number };
  /** Значки памятных дат: «месяц-день» → глиф. Видны после ответа (`reveal`). */
  marks: ReadonlyMap<string, { icon: string; calm: boolean }>;
  /** Тап по дню открытого месяца. */
  onPick(day: number, month: number): void;
}
export interface Calendar {
  readonly root: HTMLElement;
  readonly month: number;
  show(month: number): void;
  /** Обвести день (красный кружок) в открытом месяце. */
  circle(day: number, calm?: boolean): void;
  miss(day: number): void;
  reveal(): void;
}

/** Страница-календарь: красная планка с названием месяца и стрелками, сетка 7 колонок, пн–вс. */
export function calendar(o: CalendarOpts): Calendar {
  let month = o.month;
  const title = el('div', { class: 'ttl', lang: 'pl', 'data-month-title': '' }, '');
  const prev = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-month-prev': '', 'aria-label': 'Poprzedni miesiąc', onclick: () => show(shiftMonth(month, -1)) }, '‹');
  const next = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-month-next': '', 'aria-label': 'Następny miesiąc', onclick: () => show(shiftMonth(month, 1)) }, '›');
  const grid = el('div', { class: 'dt-grid', 'data-grid': '' });
  const wd = el('div', { class: 'dt-wd', lang: 'pl' }, ...WEEKDAYS.map((w) => el('span', {}, w)));
  const root = el('div', { class: 'dt-page', 'data-calendar': '' }, el('div', { class: 'dt-band' }, prev, title, next), wd, grid);
  let revealed = false;
  const cell = (d: number): HTMLElement | null => grid.querySelector<HTMLElement>(`[data-day="${d}"]`);

  function show(m: number): void {
    month = m;
    title.textContent = monthRow(o.doc, m)?.nom ?? '';
    grid.dataset.month = String(m);
    grid.replaceChildren(
      ...monthGrid(o.year, m).flat().map((d, i) => {
        if (d === null) return el('div', { class: 'dt-blank' });
        const mark = o.marks.get(`${m}-${d}`);
        const isToday = o.today.m === m && o.today.d === d;
        return el(
          'button',
          { type: 'button', class: `dt-day${i % 7 === 6 ? ' sun' : ''}${isToday ? ' today' : ''}`, 'data-nav': '', 'data-day': d, 'data-date': `${m}-${d}`, onclick: () => o.onPick(d, month) },
          `${d}`,
          mark ? el('span', { class: 'dt-mark', 'data-mark': mark.icon }, markIcon(mark.icon)) : null,
        );
      }),
    );
    grid.classList.toggle('reveal', revealed);
  }
  show(month);
  return {
    root,
    get month() {
      return month;
    },
    show,
    circle(d, calm = false) {
      cell(d)?.append(ring(calm));
    },
    miss(d) {
      cell(d)?.classList.add('miss');
    },
    reveal() {
      revealed = true;
      grid.classList.add('reveal');
    },
  };
}

export interface Drums {
  readonly root: HTMLElement;
  /** Кнопка «Sprawdź» — её ставят в подвал. */
  readonly check: HTMLButtonElement;
  value(): DayMonth;
  /** Сдвинуть барабан (для тестов и клавиш: стрелки вызывают то же самое). */
  step(which: 'day' | 'month', delta: number): void;
}

/** Два барабана «день 1–31» и «месяц»: стрелки ▲▼, тап по соседней строке, колесо мыши. Внизу дата читается словами. */
export function drums(doc: Readonly<Record<string, unknown>>, start: DayMonth, onCheck: (v: DayMonth) => void, say?: SayFn): Drums {
  let v: DayMonth = { ...start };
  const read = el('div', { class: 'dt-read', lang: 'pl', 'data-read': '' }, '');
  const label = (which: 'day' | 'month', x: number): string => (which === 'day' ? `${x}` : (monthRow(doc, x)?.nom ?? `${x}`));
  const range = { day: [1, 31], month: [1, 12] } as const;

  const mk = (which: 'day' | 'month'): { box: HTMLElement; paint: () => void } => {
    const win = el('div', { class: 'dt-win', 'data-win': which });
    const up = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', [`data-${which}-up`]: '', 'aria-label': 'Wyżej', onclick: () => step(which, -1) }, '▲');
    const down = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', [`data-${which}-down`]: '', 'aria-label': 'Niżej', onclick: () => step(which, 1) }, '▼');
    win.addEventListener('wheel', (e) => {
      e.preventDefault();
      step(which, e.deltaY > 0 ? 1 : -1);
    });
    const paint = (): void => {
      const [lo, hi] = range[which];
      win.replaceChildren(
        ...[-2, -1, 0, 1, 2].map((k) => {
          const x = spin(v[which], k, lo, hi);
          return k === 0
            ? el('div', { class: 'dt-row cur', 'data-cur': which, lang: 'pl' }, label(which, x))
            : el('button', { type: 'button', class: `dt-row ${Math.abs(k) === 1 ? 'near' : 'far'}`, 'data-step': k, tabindex: '-1', lang: 'pl', onclick: () => step(which, k) }, label(which, x));
        }),
      );
    };
    return { box: el('div', { class: 'dt-drum', 'data-drum': which }, up, win, down), paint };
  };
  // Дата словами под барабанами («jedenastego listopada») читается кнопкой 🔊 справа.
  const readSay = say ? sayButton(sayDate(doc, v.day, v.month), say) : null;
  const dayD = mk('day');
  const monD = mk('month');
  const paint = (): void => {
    dayD.paint();
    monD.paint();
    read.textContent = sayDate(doc, v.day, v.month);
    if (readSay) readSay.dataset.saytext = read.textContent;
    read.dataset.read = `${v.day}-${v.month}`;
  };
  function step(which: 'day' | 'month', delta: number): void {
    const [lo, hi] = range[which];
    v = { ...v, [which]: spin(v[which], delta, lo, hi) };
    paint();
  }
  paint();
  const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', onclick: () => onCheck({ ...v }) }, 'Sprawdź · Проверить');
  const root = el('div', { class: 'dt-drums-wrap', 'data-drums': '' }, el('div', { class: 'dt-drums' }, dayD.box, monD.box), readSay ? el('div', { class: 'pq-qrow dt-readrow' }, read, readSay) : read);
  return { root, check, value: () => ({ ...v }), step };
}
