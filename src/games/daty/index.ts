// Игра 3: Daty («Kalendarz», ФЕРМА_v2.md §4). Вход — отрывной календарь на стене дома, экран `full`: страница месяца, барабаны, лист с датой.
// Задания: A «Co się stało 3 maja?» (выбор события); B «Kiedy…?» (кнопки на ростке, барабаны на кустике), «Pokaż w kalendarzu» (тап по сетке);
// «сам»: «Powiedz słowami» — плитки `trzeciego` + `maja` среди неверных форм. Год — цифрой рядом, словами не спрашивается (решение Шэфа 5).
// Даты памяти (`tone: solemn|quiet`) — спокойная подача: без зелёной вспышки и анимации обводки.
import { el } from '../../ui/dom';
import type { GameCtx, GamePanel, PolskaGame, Want } from '../../types/polska';
import { choice, tiles } from '../kit';
import { CSS, calendar, drums, leaf, yearChip } from './view';
import {
  type DatyMode,
  type DatyTask,
  choiceOptions,
  coOptions,
  dateOfUnit,
  drumStart,
  isCalm,
  labelDate,
  monthRow,
  ordinalRow,
  sameDate,
  sameSay,
  sayDate,
  sayPool,
  startMonth,
  yearOfUnit,
} from './model';

type Q = { pl?: string; ru?: string };
const qOf = (raw: Readonly<Record<string, unknown>>): Record<'kiedy' | 'co' | 'pokaz', Q> => {
  const q = (raw.q ?? {}) as Partial<Record<'kiedy' | 'co' | 'pokaz', Q>>;
  return { kiedy: q.kiedy ?? {}, co: q.co ?? {}, pokaz: q.pokaz ?? {} };
};

/** Порядок посадки: полоса, потом ближайшие к сегодняшнему дню (дальше по году), потом порядок данных. */
export function datyPool(ctx: GameCtx): string[] {
  const t = ctx.date();
  const doy = (m: number, d: number): number => (m - 1) * 31 + d;
  const now = doy(t.m, t.d);
  return ctx.units
    .map((u, i) => {
      const a = dateOfUnit(u);
      return { id: u.id, band: u.band, ahead: (((doy(a.month, a.day) - now) % 372) + 372) % 372, i };
    })
    .sort((x, y) => x.band - y.band || x.ahead - y.ahead || x.i - y.i)
    .map((x) => x.id);
}

/** Какой режим задавать: «сам» — слова; A — событие по дате; B — на ростке кнопки или сетка, на кустике барабаны или сетка. */
export function modeFor(want: Pick<Want, 'side' | 'self' | 'stage'>, rand: () => number): DatyMode {
  if (want.self) return 'say';
  if (want.side === 'A') return 'co';
  if (want.stage === 'bush') return rand() < 0.5 ? 'drums' : 'pokaz';
  return rand() < 0.5 ? 'choice' : 'pokaz';
}

function nextTask(ctx: GameCtx, want: Want): DatyTask | null {
  const u = ctx.unit(want.id);
  if (!u) return null;
  const a = dateOfUnit(u);
  if (!ordinalRow(ctx.doc, a.day) || !monthRow(ctx.doc, a.month)) return null;
  const mode = modeFor(want, ctx.rand);
  const q = qOf(u.raw);
  const t = ctx.date();
  const mm = String(a.month).padStart(2, '0');
  const base = {
    id: u.id,
    side: mode === 'co' ? ('A' as const) : ('B' as const),
    ...(mode === 'say' ? { self: true } : {}),
    mode,
    day: a.day,
    month: a.month,
    year: yearOfUnit(u),
    calm: isCalm(u),
    event: u.pl,
    cal: { year: t.y, start: startMonth(a.month, t.m), today: { y: t.y, m: t.m, d: t.d } },
    drum: drumStart(a),
  };
  switch (mode) {
    case 'co': {
      const o = coOptions(ctx, u);
      return { ...base, q: q.co.pl ?? `Co obchodzimy ${sayDate(ctx.doc, a.day, a.month)}?`, hint: q.co.ru ?? 'Выбери событие', options: o.options, answer: o.answer };
    }
    case 'choice': {
      const o = choiceOptions(ctx, u);
      return { ...base, q: q.kiedy.pl ?? `Kiedy: ${u.pl}?`, hint: q.kiedy.ru ?? 'Выбери дату', options: o.options, answer: o.answer };
    }
    case 'drums':
      return { ...base, q: q.kiedy.pl ?? `Kiedy: ${u.pl}?`, hint: `${q.kiedy.ru ?? 'Когда?'} Выставь день и месяц`, options: [], answer: a };
    case 'pokaz':
      return { ...base, q: q.pokaz.pl ?? `Pokaż w kalendarzu: ${u.pl}`, hint: q.pokaz.ru ?? 'Найди день в календаре', options: [], answer: a };
    case 'say': {
      const p = sayPool(u, ctx.rand);
      return { ...base, q: `Powiedz słowami: ${a.day}.${mm}`, hint: `${u.pl} · назови дату по-польски`, options: p.pool, answer: p.answer };
    }
  }
}

/** Вопрос: крупная строка и подсказка (как у `kit.prompt`, но внутри верхней строки с листом/годом). */
const ask = (task: DatyTask): HTMLElement => el('div', { class: 'pq-pg-q txt', 'data-prompt': '' }, el('div', { class: 'pq-q', lang: 'pl' }, task.q), el('div', { class: 'pq-q-hint' }, task.hint));

function render(task: DatyTask, panel: GamePanel, ctx: GameCtx): void {
  const wrap = el('div', { class: 'dt', 'data-dt': task.mode, 'data-calm': task.calm ? '' : undefined }, el('style', {}, CSS));
  panel.body.append(wrap);
  const sub: GamePanel = { body: wrap, foot: panel.foot, layout: panel.layout, submit: panel.submit, say: panel.say, rand: panel.rand };
  const d = { day: task.day, month: task.month };
  const chip = yearChip(task.year);
  switch (task.mode) {
    case 'co':
    case 'say':
      wrap.append(el('div', { class: 'dt-topline' }, leaf(ctx.doc, d, task.year), ask(task)));
      if (task.mode === 'co') choice(sub, task.options, task.answer as string);
      else tiles(sub, task.options);
      return;
    case 'choice':
      wrap.append(el('div', { class: 'dt-topline' }, ask(task), chip));
      choice(sub, task.options, task.answer as string);
      return;
    case 'drums': {
      wrap.append(el('div', { class: 'dt-topline' }, ask(task), chip));
      const dr = drums(ctx.doc, task.drum, (v) => panel.submit(v));
      wrap.append(dr.root);
      panel.foot.replaceChildren(dr.check);
      return;
    }
    case 'pokaz': {
      wrap.append(el('div', { class: 'dt-topline' }, ask(task), chip));
      const marks = new Map(ctx.units.map((x) => [`${dateOfUnit(x).month}-${dateOfUnit(x).day}`, { icon: String(x.raw.icon ?? ''), calm: isCalm(x) }] as const));
      const cal = calendar({
        doc: ctx.doc,
        year: task.cal.year,
        month: task.cal.start,
        today: task.cal.today,
        marks,
        onPick(day, month) {
          // Неверно: показываем нужный месяц и обводим верный день; в том же месяце отмечаем промах.
          if (month !== task.month) cal.show(task.month);
          else if (day !== task.day) cal.miss(day);
          cal.circle(task.day, task.calm);
          cal.reveal();
          panel.submit({ day, month });
        },
      });
      wrap.append(cal.root);
      return;
    }
  }
}

function check(task: DatyTask, answer: unknown, ctx: GameCtx) {
  const d = { day: task.day, month: task.month };
  const spoken = sayDate(ctx.doc, d.day, d.month);
  const u = ctx.unit(task.id);
  const year = task.year === null ? '' : ` ${task.year}`;
  const note = `${labelDate(ctx.doc, d.day, d.month)}${year}${u && typeof u.raw.note_ru === 'string' ? ` · ${u.raw.note_ru}` : ''}`;
  switch (task.mode) {
    case 'co':
      return { ok: typeof answer === 'string' && answer === task.answer, correct: task.answer as string, note };
    case 'choice':
      return { ok: typeof answer === 'string' && answer === task.answer, correct: spoken, note, say: spoken };
    case 'drums':
    case 'pokaz':
      return { ok: sameDate(answer, d), correct: spoken, note, say: spoken };
    case 'say':
      return { ok: sameSay(answer, task.answer as string[]), correct: spoken, note, say: spoken };
  }
}

export const game: PolskaGame<DatyTask> = {
  id: 'daty',
  title: { pl: 'Kalendarz', ru: 'Памятные даты' },
  desc: 'Памятные даты Польши: когда и что отмечаем. Барабаны, календарь, дата словами',
  entry: 'calendar',
  plot: 'miesiace',
  kinds: ['date'],
  layout: 'full',
  pool: datyPool,
  nextTask,
  render,
  check,
};
