// Игра 3: Daty («Kalendarz», ФЕРМА_v2.md §4). Вход — отрывной календарь на стене дома, экран `full`: страница месяца, барабаны, лист с датой.
// Задания: A «Co się stało 3 maja?» (выбор события); B «Kiedy…?» (кнопки на ростке, барабаны на кустике), «Pokaż w kalendarzu» (тап по сетке);
// «сам»: «Powiedz słowami» — плитки `trzeciego` + `maja` среди неверных форм. Год — цифрой рядом, словами не спрашивается (решение Шэфа 5).
// Даты памяти (`tone: solemn|quiet`) — спокойная подача: без зелёной вспышки и анимации обводки.
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import type { GameCtx, GamePanel, PolskaGame, Want } from '../../types/polska';
import { choice, tiles } from '../kit';
import { CSS, calendar, drums, leaf, yearChip } from './view';
import { HIST_CSS, historyBlock, historyOf, introCard, isFirst } from './history';
import {
  type DatyMode,
  type DatyTask,
  choiceOptions,
  coOptions,
  dateOfUnit,
  drumStart,
  isCalm,
  labelDate,
  monthGrid,
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
const ask = (task: DatyTask, say: GamePanel['say']): HTMLElement =>
  el('div', { class: 'pq-pg-q txt', 'data-prompt': '' }, el('div', { class: 'pq-qrow' }, el('div', { class: 'pq-q', lang: 'pl' }, task.q), sayButton(task.mode === 'say' ? 'Powiedz słowami' : task.q, say, { main: true })), el('div', { class: 'pq-q-hint' }, task.hint));

/** Запас под строку результата движка, которая после ответа встаёт под листом (как `FB_H` у карты). */
const FB_RESERVE = 92;
/** Во сколько раз можно увеличить задание, чтобы оно занимало лист, а не плавало в пустом (потолок: страница 480 px → 860). */
export const MAX_ZOOM = 1.8;

/** Ширина и высота задания при масштабе 1 → наибольший масштаб (шаг 0,05), при котором оно влезает в лист; меньше 1,05 — 1. */
export function zoomFor(room: { w: number; h: number }, natural: { w: number; h: number }): number {
  if (!(natural.w > 0) || !(natural.h > 0)) return 1;
  const k = Math.min(MAX_ZOOM, room.w / natural.w, room.h / natural.h);
  return k < 1.05 ? 1 : Math.floor(k * 20) / 20;
}

/** Лист `full` занимает ровно задание: увеличиваем страницу под свободное место и просим движок сжать лист по высоте.
 *  `reserve()` — место под блок отзыва (строка результата и справка), которое после ответа займёт `.fb`; возвращает функцию «подогнать заново». */
function fitToSheet(panel: GamePanel, wrap: HTMLElement, reserve: () => { fb: number; inner?: number } = () => ({ fb: FB_RESERVE })): () => void {
  const body = panel.body;
  const place = (room: { w: number; h: number }): number => {
    wrap.style.zoom = '';
    const cs = getComputedStyle(body);
    const num = (v: string): number => parseFloat(v) || 0;
    const above = wrap.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientTop - num(cs.paddingTop) + body.scrollTop;
    const natural = { w: Math.min(480, room.w), h: wrap.offsetHeight };
    const { fb: fbRoom, inner = 0 } = reserve();
    // `inner` — запас внутри листа при масштабе 1 (лишняя неделя календаря): растёт вместе с `zoom`.
    const k = zoomFor({ w: room.w, h: room.h - above - fbRoom }, { w: 480, h: natural.h + inner });
    // Узкий лист (телефон): страница и так во всю ширину, увеличивать нечего.
    if (k > 1 && room.w >= 480) wrap.style.zoom = String(k);
    const last = body.lastElementChild;
    const after = last && last !== wrap ? last.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom : 0;
    return above + wrap.getBoundingClientRect().height + inner * (k > 1 && room.w >= 480 ? k : 1) + after + fbRoom;
  };
  const run = (): void => {
    if (!wrap.isConnected) return;
    panel.fit?.((room) => place(room));
  };
  run();
  const watched = panel.root;
  if (watched && typeof ResizeObserver !== 'undefined') {
    let lw = watched.clientWidth;
    let lh = watched.clientHeight;
    const ro = new ResizeObserver(() => {
      if (!wrap.isConnected) return ro.disconnect();
      if (Math.abs(watched.clientWidth - lw) < 2 && Math.abs(watched.clientHeight - lh) < 2) return;
      lw = watched.clientWidth;
      lh = watched.clientHeight;
      run();
    });
    ro.observe(watched);
  }
  return run;
}

/** Высота всего блока отзыва (`.fb`: название, перевод, справка, прогресс, заметка) при ширине `w`: меряем невидимую копию, чтобы лист не прыгал,
 *  когда после ответа появится справка, и подгонялся под неё заранее. 0 — не вышло измерить (нет движка, ширина 0). */
function feedbackHeight(panel: GamePanel, name: string, h: ReturnType<typeof historyOf>): number {
  const host = panel.root;
  const box = host?.querySelector<HTMLElement>('.box');
  const live = host?.querySelector<HTMLElement>('[data-feedback]');
  if (!h || !host || !box || !live) return 0;
  // Ширина блока отзыва в движке: ширина рамки минус её поля и поля самого блока.
  const num = (v: string): number => parseFloat(v) || 0;
  const cb = getComputedStyle(box);
  const cf = getComputedStyle(live);
  const w = box.clientWidth - num(cb.paddingLeft) - num(cb.paddingRight) - num(cf.marginLeft) - num(cf.marginRight);
  if (!(w > 0)) return 0;
  // Как собирает отзыв движок: название с 🔊, перевод, справка, прогресс, заметка (дата) с 🔊.
  const nope = (): void => {};
  const fb = el(
    'div',
    { class: 'fb', style: 'box-sizing:border-box;margin:0' },
    el('div', { class: 'pq-fbrow' }, el('div', { class: 'big' }, el('span', { class: 'lbl' }, 'Правильно:'), name), sayButton(name, nope, { inline: true })),
    el('div', { class: 'sub' }, '·'),
    historyBlock(h, nope),
    el('div', { class: 'pq-progress' }, '🌱 Ещё 1 полив до ростка'),
    el('div', { class: 'pq-fbrow' }, el('div', { class: 'note' }, '11 listopada 1918'), sayButton('11 listopada', nope, { inline: true })),
  );
  const probe = el('div', { style: `position:absolute;visibility:hidden;left:0;top:0;width:${Math.round(w)}px;pointer-events:none` }, fb);
  host.append(probe);
  const px = fb.getBoundingClientRect().height;
  probe.remove();
  return Math.ceil(px) + 8;
}

function render(task: DatyTask, panel: GamePanel, ctx: GameCtx): void {
  const wrap = el('div', { class: 'dt', 'data-dt': task.mode, 'data-calm': task.calm ? '' : undefined }, el('style', {}, CSS + HIST_CSS));
  panel.body.append(wrap);
  const u = ctx.unit(task.id);
  const hist = u ? historyOf(u) : null;
  const say = panel.say;
  /** Карточка знакомства на экране: под ней отзыва нет, места под него не держим. */
  let card = false;
  /** «Pokaż»: после ответа календарь листает к месяцу ответа, а в нём может быть на неделю больше — держим место заранее. */
  const spare = (): number => {
    if (task.mode !== 'pokaz') return 0;
    const more = Math.max(0, monthGrid(task.cal.year, task.month).length - monthGrid(task.cal.year, task.cal.start).length);
    const row = wrap.querySelector<HTMLElement>('.dt-day')?.getBoundingClientRect().height ?? 0;
    return more * (row + 4);
  };
  watchFeedback(panel, wrap, hist);
  const refit = fitToSheet(panel, wrap, () => (card ? { fb: 6 } : { fb: Math.max(FB_RESERVE, feedbackHeight(panel, task.mode === 'co' ? (u?.pl ?? '') : sayDate(ctx.doc, task.day, task.month), hist)), inner: spare() }));
  const showTask = (): void => {
    card = false;
    wrap.dataset.dt = task.mode;
    draw(task, panel, ctx, wrap);
    refit();
  };
  if (u && hist && isFirst(ctx, u.id)) {
    // Знакомство: карточка → «Rozumiem · Понятно» (только тут ставится флаг) → вопрос. Закрыл игру на карточке — покажем снова.
    card = true;
    wrap.dataset.dt = 'intro';
    wrap.append(introCard(ctx.doc, u, hist, say));
    panel.foot.replaceChildren(
      el(
        'button',
        {
          type: 'button',
          class: 'pq-btn',
          'data-nav': '',
          'data-understood': '',
          onclick: () => {
            ctx.markSeen(u.id);
            wrap.replaceChildren(el('style', {}, CSS + HIST_CSS));
            panel.foot.replaceChildren();
            showTask();
          },
        },
        'Rozumiem · Понятно →',
      ),
    );
    refit();
    return;
  }
  showTask();
}

/** Движок показывает блок отзыва (`hidden` снимается) после любого ответа, в том числе `ui.submit`; следим за ним и кладём справку.
 *  Срабатывает сразу после ответа (микрозадача, до отрисовки). */
function watchFeedback(panel: GamePanel, wrap: HTMLElement, hist: ReturnType<typeof historyOf>): void {
  const fb = panel.root?.querySelector<HTMLElement>('[data-feedback]');
  if (!hist || !fb || typeof MutationObserver === 'undefined') return;
  const mo = new MutationObserver(() => {
    if (!panel.body.contains(wrap)) return mo.disconnect();
    if (!fb.hidden) addHistory(panel, wrap, hist);
  });
  mo.observe(fb, { attributes: true, attributeFilter: ['hidden'] });
}

/** После ответа движок строит блок отзыва; кладём в него справку (ru с жирными ключами + польская строка с 🔊) между названием и прогрессом. */
function addHistory(panel: GamePanel, wrap: HTMLElement, hist: ReturnType<typeof historyOf>): void {
  if (!hist) return;
  const host = panel.root?.querySelector<HTMLElement>('[data-feedback]');
  if (!host || host.hidden) return;
  if (host.querySelector('[data-history]')) return;
  wrap.classList.add('dt-done');
  const block = historyBlock(hist, panel.say);
  const before = host.querySelector('[data-progress-after]');
  if (before) before.before(block);
  else host.append(block);
}

function draw(task: DatyTask, panel: GamePanel, ctx: GameCtx, wrap: HTMLElement): void {
  const submit = panel.submit;
  const sub: GamePanel = { body: wrap, foot: panel.foot, layout: panel.layout, submit, say: panel.say, rand: panel.rand };
  const d = { day: task.day, month: task.month };
  const chip = yearChip(task.year);
  switch (task.mode) {
    case 'co':
    case 'say':
      wrap.append(el('div', { class: 'dt-topline' }, leaf(ctx.doc, d, task.year), ask(task, panel.say)));
      if (task.mode === 'co') choice(sub, task.options, task.answer as string);
      else tiles(sub, task.options);
      return;
    case 'choice':
      wrap.append(el('div', { class: 'dt-topline' }, ask(task, panel.say), chip));
      choice(sub, task.options, task.answer as string);
      return;
    case 'drums': {
      wrap.append(el('div', { class: 'dt-topline' }, ask(task, panel.say), chip));
      const dr = drums(ctx.doc, task.drum, (v) => submit(v), panel.say);
      wrap.append(dr.root);
      panel.foot.replaceChildren(dr.check);
      return;
    }
    case 'pokaz': {
      wrap.append(el('div', { class: 'dt-topline' }, ask(task, panel.say), chip));
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
          submit({ day, month });
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
  // Справка (history) в отзыве заменяет прежнюю заметку note_ru; без справки остаётся она.
  const withNote = u && !historyOf(u) && typeof u.raw.note_ru === 'string';
  const note = `${labelDate(ctx.doc, d.day, d.month)}${year}${withNote ? ` · ${u.raw.note_ru}` : ''}`;
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

/** Строка итога раунда: ближайшая памятная дата по реальному календарю («Najbliższa data: 11.11 · Święto Niepodległości · za 24 dni»). */
export function nearestDateLine(ctx: GameCtx): string | null {
  const t = ctx.date();
  const today = Date.UTC(t.y, t.m - 1, t.d);
  let best: { days: number; text: string } | null = null;
  for (const u of ctx.units) {
    const a = dateOfUnit(u);
    let at = Date.UTC(t.y, a.month - 1, a.day);
    if (at < today) at = Date.UTC(t.y + 1, a.month - 1, a.day);
    const days = Math.round((at - today) / 86_400_000);
    if (!best || days < best.days) best = { days, text: `${a.day}.${String(a.month).padStart(2, '0')} · ${u.pl}` };
  }
  if (!best) return null;
  return `Najbliższa data: ${best.text} · ${best.days === 0 ? 'dziś' : best.days === 1 ? 'jutro' : `za ${best.days} dni`}`;
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
  summaryLine: nearestDateLine,
};
