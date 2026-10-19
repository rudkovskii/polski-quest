// @vitest-environment happy-dom
// Игра Daty: справочники и родительный падеж, сетка месяца, барабаны, режимы заданий, проверка, спокойная подача, раунд в движке.
import { describe, expect, it, vi } from 'vitest';
import { datyPool, game, modeFor, MAX_ZOOM, zoomFor } from '../src/games/daty';
import {
  type DatyTask,
  choiceOptions,
  coOptions,
  daysInMonth,
  dateOfUnit,
  drumStart,
  firstOffset,
  isCalm,
  labelDate,
  monthGrid,
  monthsOf,
  ordinalsOf,
  sameDate,
  sameSay,
  sayDate,
  sayPool,
  sayTiles,
  shiftMonth,
  spin,
  startMonth,
} from '../src/games/daty/model';
import { boldKeys, historyOf } from '../src/games/daty/history';
import { createPolska, newPolskaSave, normalizePolska, type PolskaSave } from '../src/systems/polska';
import type { GameCtx, GamePanel, Want } from '../src/types/polska';
import { mountPolskaGame, NEXT_DELAY_MS } from '../src/ui/polskaGame';
import { ROUND_SIZE } from '../src/ui/roundSummary';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 18, 9, 0);

/** `fresh` — игрок ничего не знает (карточки знакомства покажут); по умолчанию все даты уже «знакомы», как будто карточки приняты. */
function mkPolska(fresh = false) {
  let save: PolskaSave = newPolskaSave();
  const bus = testBus();
  const p = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
  if (!fresh) for (const u of p.units('daty')) p.markSeen(u.id);
  return { p, bus, get save() { return save; } };
}
const ctxOf = (s: ReturnType<typeof mkPolska>, seed = 3): GameCtx => ({
  units: s.p.units('daty'),
  unit: (id) => s.p.unit(id),
  info: (id) => s.p.info(id),
  seen: (id) => s.p.seen(id),
  markSeen: (id) => s.p.markSeen(id),
  doc: s.p.content.docs.daty,
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 18, weekday: 0 }),
  rand: seeded(seed),
});
const sw = (kind: string): Want[] => [
  { id: '', side: 'A', self: false, stage: 'seed' },
  { id: '', side: 'B', self: false, stage: 'sprout' },
  { id: '', side: 'B', self: false, stage: 'bush' },
  { id: '', side: 'B', self: true, stage: 'bush' },
].map((w) => ({ ...w, id: kind }) as Want);

function panelOf(submit: (a: unknown) => void): GamePanel {
  return { body: document.createElement('div'), foot: document.createElement('div'), layout: 'full', submit, say: () => {}, rand: seeded(2) };
}
const q = <T extends Element = HTMLElement>(root: Element, sel: string): T => {
  const n = root.querySelector<T>(sel);
  if (!n) throw new Error(`нет ${sel}`);
  return n;
};
const click = (root: Element, sel: string): void => q(root, sel).click();

/** Верный ответ на задание (как его даст игрок). */
function rightAnswer(t: DatyTask): unknown {
  return t.answer;
}
/** Заведомо неверный ответ того же вида. */
function wrongAnswer(t: DatyTask): unknown {
  switch (t.mode) {
    case 'co':
    case 'choice':
      return t.options.find((o) => o !== t.answer);
    case 'say':
      return [...(t.answer as string[])].reverse().concat('maj');
    default:
      return { day: (t.day % 28) + 1, month: (t.month % 12) + 1 };
  }
}

describe('Daty: справочники и родительный падеж', () => {
  const s = mkPolska();
  const ctx = ctxOf(s);

  it('22 даты; sayDate и sayTiles дают ровно то, что в данных (say и плитки)', () => {
    expect(ctx.units.length).toBe(22);
    for (const u of ctx.units) {
      const a = dateOfUnit(u);
      expect(sayDate(ctx.doc, a.day, a.month), u.id).toBe(u.raw.say);
      expect(sayTiles(ctx.doc, a.day, a.month), u.id).toEqual((u.raw.tiles as { pl: string[] }).pl);
    }
  });

  it('порядковые 1–31 и 12 месяцев в родительном: 3 → trzeciego, 21 → dwudziestego pierwszego, maj → maja', () => {
    expect(ordinalsOf(ctx.doc).length).toBe(31);
    expect(monthsOf(ctx.doc).length).toBe(12);
    expect(sayDate(ctx.doc, 3, 5)).toBe('trzeciego maja');
    expect(sayDate(ctx.doc, 21, 3)).toBe('dwudziestego pierwszego marca');
    expect(sayDate(ctx.doc, 11, 11)).toBe('jedenastego listopada');
    expect(sayDate(ctx.doc, 31, 8)).toBe('trzydziestego pierwszego sierpnia');
    expect(sayTiles(ctx.doc, 31, 8)).toEqual(['trzydziestego', 'pierwszego', 'sierpnia']);
    for (const o of ordinalsOf(ctx.doc)) expect(o.gen, `ord ${o.n}`).toBe(o.gen_tiles.join(' '));
    for (const m of monthsOf(ctx.doc)) expect(m.gen).not.toBe(m.nom);
    expect(sayDate(ctx.doc, 0, 5)).toBe('');
    expect(sayDate(ctx.doc, 3, 13)).toBe('');
    expect(labelDate(ctx.doc, 11, 7)).toBe('11 lipca');
  });

  it('плитки «сам»: верные слова плюс неверные формы (именительный, женский, месяц), без повторов', () => {
    for (const u of ctx.units) {
      const p = sayPool(u, seeded(4));
      expect(p.answer.length, u.id).toBeGreaterThanOrEqual(2);
      expect(p.pool.length, u.id).toBeGreaterThan(p.answer.length);
      expect(new Set(p.pool).size, u.id).toBe(p.pool.length);
      for (const w of p.answer) expect(p.pool, u.id).toContain(w);
    }
    const k = sayPool(ctx.unit('date.konstytucja')!, seeded(1));
    expect(k.answer).toEqual(['trzeciego', 'maja']);
    expect(k.pool).toEqual(expect.arrayContaining(['trzeci', 'trzecia', 'maj', 'maju']));
  });

  it('sameSay: слова по порядку, регистр не важен; пустое и не то — нет', () => {
    expect(sameSay(['trzeciego', 'maja'], ['trzeciego', 'maja'])).toBe(true);
    expect(sameSay('Trzeciego Maja', ['trzeciego', 'maja'])).toBe(true);
    expect(sameSay(['maja', 'trzeciego'], ['trzeciego', 'maja'])).toBe(false);
    expect(sameSay([], ['trzeciego', 'maja'])).toBe(false);
    expect(sameSay(null, ['trzeciego', 'maja'])).toBe(false);
  });
});

describe('Daty: сетка месяца и листание', () => {
  it('октябрь 2026: 1-е в четверг (смещение 3), 31 день, недели по 7, неделя с понедельника', () => {
    expect(firstOffset(2026, 10)).toBe(3);
    expect(daysInMonth(2026, 10)).toBe(31);
    const g = monthGrid(2026, 10);
    for (const w of g) expect(w.length).toBe(7);
    expect(g[0]).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(g.flat().filter((x) => x !== null)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(g.at(-1)!.at(-1)).toBeNull();
  });

  it('февраль: 28 дней, в високосный 29; май 2026 начинается в пятницу, 3 мая — воскресенье', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(firstOffset(2026, 5)).toBe(4);
    const g = monthGrid(2026, 5);
    expect(g.findIndex((w) => w.includes(3))).toBe(0);
    expect(g[0]![6]).toBe(3);
  });

  it('месяц, который начинается с воскресенья и 31 день, даёт шесть недель', () => {
    // март 2026 начинается в воскресенье
    expect(firstOffset(2026, 3)).toBe(6);
    expect(monthGrid(2026, 3).length).toBe(6);
  });

  it('shiftMonth листает по кругу; startMonth не открывает нужный месяц сразу', () => {
    expect(shiftMonth(12, 1)).toBe(1);
    expect(shiftMonth(1, -1)).toBe(12);
    expect(shiftMonth(5, 7)).toBe(12);
    expect(shiftMonth(5, -17)).toBe(12);
    expect(startMonth(5, 10)).toBe(10);
    expect(startMonth(10, 10)).toBe(11);
    expect(startMonth(12, 12)).toBe(1);
  });
});

describe('Daty: барабаны', () => {
  it('spin крутится по кругу: день 31 → 1, 1 → 31, месяц 12 → 1', () => {
    expect(spin(31, 1, 1, 31)).toBe(1);
    expect(spin(1, -1, 1, 31)).toBe(31);
    expect(spin(12, 1, 1, 12)).toBe(1);
    expect(spin(5, 14, 1, 12)).toBe(7);
    expect(spin(3, -40, 1, 31)).toBe(spin(3, -9, 1, 31));
  });

  it('старт барабанов не на верном ответе', () => {
    expect(drumStart({ day: 15, month: 6 })).not.toEqual({ day: 15, month: 6 });
    const s = mkPolska();
    for (const u of s.p.units('daty')) expect(sameDate(drumStart(dateOfUnit(u)), dateOfUnit(u)), u.id).toBe(false);
  });

  it('DOM: стрелки и тап по соседней строке крутят, под барабанами дата читается словами, «Sprawdź» отдаёт {day, month}', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    const t = game.nextTask(ctx, { id: 'date.konstytucja', side: 'B', self: false, stage: 'bush' })!;
    const task: DatyTask = { ...t, mode: 'drums', answer: { day: 3, month: 5 }, drum: { day: 1, month: 12 } };
    let given: unknown = null;
    const panel = panelOf((a) => (given = a));
    game.render(task, panel, ctx);
    const read = q(panel.body, '[data-read]');
    expect(read.textContent).toBe('pierwszego grudnia');
    // день: 1 → 2 → 3 (▼ и тап по строке «+1»)
    click(panel.body, '[data-drum="day"] [data-day-down]');
    expect(read.textContent).toBe('drugiego grudnia');
    click(panel.body, '[data-win="day"] [data-step="1"]');
    expect(read.textContent).toBe('trzeciego grudnia');
    // месяц: 12 → 1 по кругу, потом ▲ назад и до мая
    click(panel.body, '[data-month-down]');
    expect(read.textContent).toBe('trzeciego stycznia');
    for (let i = 0; i < 4; i++) click(panel.body, '[data-month-down]');
    expect(read.textContent).toBe('trzeciego maja');
    click(panel.body, '[data-month-up]');
    expect(read.textContent).toBe('trzeciego kwietnia');
    click(panel.body, '[data-month-down]');
    // 3 maja, подтверждаем кнопкой из подвала
    expect(q(panel.body, '[data-cur="day"]').textContent).toBe('3');
    expect(q(panel.body, '[data-cur="month"]').textContent).toBe('maj');
    click(panel.foot, '[data-check]');
    expect(given).toEqual({ day: 3, month: 5 });
    expect(game.check(task, given, ctx).ok).toBe(true);
    expect(game.check(task, given, ctx).correct).toBe('trzeciego maja');
  });

  it('барабан день 1–31: 31 → 1 по кругу видно на экране', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    const t = game.nextTask(ctx, { id: 'date.sierpien80', side: 'B', self: false, stage: 'bush' })!;
    const task: DatyTask = { ...t, mode: 'drums', drum: { day: 31, month: 8 } };
    const panel = panelOf(() => {});
    game.render(task, panel, ctx);
    expect(q(panel.body, '[data-read]').textContent).toBe('trzydziestego pierwszego sierpnia');
    click(panel.body, '[data-day-down]');
    expect(q(panel.body, '[data-cur="day"]').textContent).toBe('1');
    expect(q(panel.body, '[data-read]').textContent).toBe('pierwszego sierpnia');
  });
});

describe('Daty: задания и режимы', () => {
  const s = mkPolska();

  it('modeFor: «сам» — слова; A — событие; B на ростке — кнопки/сетка; на кустике — барабаны/сетка', () => {
    expect(modeFor({ side: 'B', self: true, stage: 'bush' }, () => 0)).toBe('say');
    expect(modeFor({ side: 'A', self: false, stage: 'seed' }, () => 0)).toBe('co');
    expect(modeFor({ side: 'A', self: false, stage: 'overripe' }, () => 0.9)).toBe('co');
    expect(modeFor({ side: 'B', self: false, stage: 'sprout' }, () => 0.1)).toBe('choice');
    expect(modeFor({ side: 'B', self: false, stage: 'sprout' }, () => 0.9)).toBe('pokaz');
    expect(modeFor({ side: 'B', self: false, stage: 'bush' }, () => 0.1)).toBe('drums');
    expect(modeFor({ side: 'B', self: false, stage: 'bush' }, () => 0.9)).toBe('pokaz');
  });

  it('на любую просьбу движка у любой из 22 дат есть задание: сторона и «сам» по контракту, верный ответ в вариантах', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const ctx = ctxOf(s, seed);
      for (const u of ctx.units) {
        for (const want of sw(u.id)) {
          const t = game.nextTask(ctx, want)!;
          expect(t, `${u.id} ${want.side}${want.self ? '+self' : ''}`).toBeTruthy();
          expect(t.id).toBe(u.id);
          if (want.self) {
            expect(t.self).toBe(true);
            expect(t.mode).toBe('say');
            expect(t.side).toBe('B');
          } else {
            expect(t.self).toBeFalsy();
            expect(t.side).toBe(want.side);
            expect(t.mode === 'co').toBe(want.side === 'A');
          }
          if (t.mode === 'co' || t.mode === 'choice') {
            expect(t.options.length).toBe(4);
            expect(new Set(t.options).size).toBe(4);
            expect(t.options).toContain(t.answer);
          }
          if (t.mode === 'say') for (const w of t.answer as string[]) expect(t.options).toContain(w);
          expect(game.check(t, rightAnswer(t), ctx).ok, `${u.id} ${t.mode} верно`).toBe(true);
          expect(game.check(t, wrongAnswer(t), ctx).ok, `${u.id} ${t.mode} неверно`).toBe(false);
          expect(game.check(t, '___', ctx).ok).toBe(false);
          expect(game.check(t, null, ctx).ok).toBe(false);
          expect(game.check(t, [], ctx).ok).toBe(false);
        }
      }
    }
  });

  it('варианты: даты не повторяют верную, события из wrong_ids, события не совпадают с правильным', () => {
    const ctx = ctxOf(s);
    for (const u of ctx.units) {
      const c = choiceOptions(ctx, u);
      expect(c.options.filter((o) => o === c.answer).length, u.id).toBe(1);
      expect(c.answer).toBe(labelDate(ctx.doc, dateOfUnit(u).day, dateOfUnit(u).month));
      const e = coOptions(ctx, u);
      expect(e.answer).toBe(u.pl);
      expect(e.options.filter((o) => o === u.pl).length, u.id).toBe(1);
      expect(e.options.length).toBe(4);
    }
    const nato = coOptions(ctx, ctx.unit('date.nato')!).options;
    expect(nato).toEqual(expect.arrayContaining(['Polska wstąpiła do NATO', 'Narodowy Dzień Pamięci Żołnierzy Wyklętych']));
  });

  it('co: выбор события, лист календаря с датой и годом цифрами; кнопки 1–4 (data-opt)', () => {
    const ctx = ctxOf(s);
    const t = game.nextTask(ctx, { id: 'date.konstytucja', side: 'A', self: false, stage: 'seed' })!;
    expect(t.mode).toBe('co');
    let given: unknown = null;
    const panel = panelOf((a) => (given = a));
    game.render(t, panel, ctx);
    expect(q(panel.body, '[data-prompt]').textContent).toContain('trzeciego maja');
    expect(q(panel.body, '[data-leaf] .day').textContent).toBe('3');
    expect(q(panel.body, '[data-leaf] .top').textContent).toBe('maj');
    expect(q(panel.body, '[data-leaf] .yr').textContent).toBe('1791');
    expect(panel.body.querySelectorAll('[data-opt]').length).toBe(4);
    q(panel.body, `[data-opt="${t.answer as string}"]`).click();
    expect(given).toBe('Święto Konstytucji 3 Maja');
    expect(game.check(t, given, ctx)).toMatchObject({ ok: true, correct: 'Święto Konstytucji 3 Maja' });
  });

  it('choice: кнопки «11 listopada», год цифрой рядом, верный ответ отдаётся строкой', () => {
    const ctx = ctxOf(s);
    const t = game.nextTask(ctx, { id: 'date.niepodleglosc', side: 'B', self: false, stage: 'sprout' })!;
    const task: DatyTask = { ...t, ...{ mode: 'choice' as const }, ...choiceFor(ctx, 'date.niepodleglosc') };
    let given: unknown = null;
    const panel = panelOf((a) => (given = a));
    game.render(task, panel, ctx);
    expect(q(panel.body, '[data-year]').textContent).toBe('1918');
    const labels = [...panel.body.querySelectorAll('[data-opt]')].map((b) => (b as HTMLElement).dataset.opt);
    expect(labels).toContain('11 listopada');
    q(panel.body, '[data-opt="11 listopada"]').click();
    expect(given).toBe('11 listopada');
    const r = game.check(task, given, ctx);
    expect(r).toMatchObject({ ok: true, correct: 'jedenastego listopada', say: 'jedenastego listopada' });
    expect(r.note).toContain('11 listopada 1918');
    expect(game.check(task, '11 lipca', ctx).ok).toBe(false);
  });

  it('say: плитки trzeciego + maja среди неверных форм; порядок и лишние плитки считаются ошибкой', () => {
    const ctx = ctxOf(s);
    const t = game.nextTask(ctx, { id: 'date.konstytucja', side: 'B', self: true, stage: 'bush' })!;
    expect(t.mode).toBe('say');
    expect(t.q).toBe('Powiedz słowami: 3.05');
    let given: unknown = null;
    const panel = panelOf((a) => (given = a));
    game.render(t, panel, ctx);
    expect(panel.body.textContent).not.toContain('trzeciego maja');
    expect(q(panel.body, '[data-leaf] .yr').textContent).toBe('1791');
    const pool = [...panel.body.querySelectorAll('[data-tile]')].map((b) => (b as HTMLElement).dataset.tile);
    expect(pool).toEqual(expect.arrayContaining(['trzeciego', 'maja', 'trzeci', 'trzecia', 'maj', 'maju']));
    click(panel.body, '[data-tile="trzeciego"]');
    click(panel.body, '[data-tile="maja"]');
    click(panel.foot, '[data-check]');
    expect(given).toEqual(['trzeciego', 'maja']);
    expect(game.check(t, given, ctx).ok).toBe(true);
    expect(game.check(t, ['maja', 'trzeciego'], ctx).ok).toBe(false);
    expect(game.check(t, ['trzeci', 'maj'], ctx).ok).toBe(false);
    expect(game.check(t, ['trzeciego'], ctx).ok).toBe(false);
  });

  it('год только цифрой и только если он есть (flaga, wykleci — без года); слов-годов нет нигде', () => {
    const ctx = ctxOf(s);
    for (const u of ctx.units) {
      for (const want of sw(u.id)) {
        const t = game.nextTask(ctx, want)!;
        const panel = panelOf(() => {});
        game.render(t, panel, ctx);
        const chips = [...panel.body.querySelectorAll('[data-year]')];
        const yr = u.raw.year as number | null;
        if (yr === null) expect(chips.length, u.id).toBe(0);
        else {
          expect(chips.length, `${u.id} ${t.mode}`).toBeGreaterThan(0);
          for (const c of chips) expect(c.textContent, u.id).toBe(String(yr));
        }
        expect(panel.body.textContent, u.id).not.toMatch(/tysi[ąa]c|dziewi[ęe]ćset|osiemset|siedemset/i);
      }
    }
  });
});

/** Опции «кнопками» для режима choice на задании, которое выдал nextTask в другом режиме. */
function choiceFor(ctx: GameCtx, id: string): Pick<DatyTask, 'options' | 'answer'> {
  const o = choiceOptions(ctx, ctx.unit(id)!);
  return { options: o.options, answer: o.answer };
}

describe('Daty: «Pokaż w kalendarzu»', () => {
  const s = mkPolska();
  const ctx = ctxOf(s);
  const pokaz = (id: string): DatyTask => {
    const t = game.nextTask(ctx, { id, side: 'B', self: false, stage: 'sprout' })!;
    return { ...t, mode: 'pokaz', answer: dateOfUnit(ctx.unit(id)!) };
  };

  it('открывается на текущем месяце (не на нужном), стрелки листают, тап по дню отдаёт {day, month}, верный день обведён', () => {
    const task = pokaz('date.konstytucja');
    expect(task.cal.start).toBe(10);
    let given: unknown = null;
    const panel = panelOf((a) => (given = a));
    game.render(task, panel, ctx);
    expect(q(panel.body, '[data-month-title]').textContent).toBe('październik');
    expect(panel.body.querySelectorAll('[data-day]').length).toBe(31);
    expect(panel.body.querySelectorAll('.dt-wd span').length).toBe(7);
    expect(q(panel.body, '.dt-wd').textContent).toBe('pon.wt.śr.czw.pt.sob.niedz.');
    expect(q(panel.body, '[data-day="18"]').classList.contains('today')).toBe(true);
    // октябрь → май: пять шагов назад (9, 8, 7, 6, 5)
    for (let i = 0; i < 5; i++) click(panel.body, '[data-month-prev]');
    expect(q(panel.body, '[data-month-title]').textContent).toBe('maj');
    expect(panel.body.querySelector('[data-ring]')).toBeNull();
    click(panel.body, '[data-day="3"]');
    expect(given).toEqual({ day: 3, month: 5 });
    expect(panel.body.querySelector('[data-day="3"] [data-ring]')).toBeTruthy();
    expect(game.check(task, given, ctx).ok).toBe(true);
  });

  it('листание: у октября 31 день, у ноября 30, через декабрь январь идёт по кругу', () => {
    const task = pokaz('date.niepodleglosc');
    const panel = panelOf(() => {});
    game.render(task, panel, ctx);
    click(panel.body, '[data-month-next]');
    expect(q(panel.body, '[data-month-title]').textContent).toBe('listopad');
    expect(panel.body.querySelectorAll('[data-day]').length).toBe(30);
    click(panel.body, '[data-month-next]');
    click(panel.body, '[data-month-next]');
    expect(q(panel.body, '[data-month-title]').textContent).toBe('styczeń');
  });

  it('неверный день в нужном месяце: промах отмечен, верный обведён; неверный месяц: календарь листает к нужному и обводит', () => {
    const task = pokaz('date.konstytucja');
    let given: unknown = null;
    let panel = panelOf((a) => (given = a));
    game.render(task, panel, ctx);
    for (let i = 0; i < 5; i++) click(panel.body, '[data-month-prev]');
    click(panel.body, '[data-day="4"]');
    expect(given).toEqual({ day: 4, month: 5 });
    expect(q(panel.body, '[data-day="4"]').classList.contains('miss')).toBe(true);
    expect(panel.body.querySelector('[data-day="3"] [data-ring]')).toBeTruthy();
    expect(game.check(task, given, ctx).ok).toBe(false);

    panel = panelOf((a) => (given = a));
    game.render(task, panel, ctx);
    click(panel.body, '[data-day="3"]'); // 3 октября: день верный, месяц нет
    expect(given).toEqual({ day: 3, month: 10 });
    expect(game.check(task, given, ctx).ok).toBe(false);
    expect(q(panel.body, '[data-month-title]').textContent).toBe('maj');
    expect(panel.body.querySelector('[data-day="3"] [data-ring]')).toBeTruthy();
  });

  it('значки памятных дат спрятаны до ответа и открываются после (иначе задание подсказывает само себя)', () => {
    const task = pokaz('date.konstytucja');
    const panel = panelOf(() => {});
    game.render(task, panel, ctx);
    for (let i = 0; i < 5; i++) click(panel.body, '[data-month-prev]');
    const grid = q(panel.body, '[data-grid]');
    expect(grid.classList.contains('reveal')).toBe(false);
    expect(grid.querySelectorAll('[data-mark]').length).toBe(4); // 1, 2, 3 и 8 мая
    click(panel.body, '[data-day="8"]');
    expect(grid.classList.contains('reveal')).toBe(true);
  });
});

describe('Daty: спокойная подача для дат памяти', () => {
  const s = mkPolska();
  const ctx = ctxOf(s);

  it('tone solemn/quiet → data-calm на экране и признак calm в задании; нейтральные даты — как обычно', () => {
    const calm = ctx.units.filter((u) => isCalm(u)).map((u) => u.id);
    expect(calm).toEqual(expect.arrayContaining(['date.katyn', 'date.godzina_w', 'date.wojna', 'date.smolensk']));
    expect(calm).not.toContain('date.konstytucja');
    for (const u of ctx.units) {
      const t = game.nextTask(ctx, { id: u.id, side: 'A', self: false, stage: 'seed' })!;
      expect(t.calm, u.id).toBe(isCalm(u));
      const panel = panelOf(() => {});
      game.render(t, panel, ctx);
      expect(panel.body.querySelector('[data-dt]')!.hasAttribute('data-calm'), u.id).toBe(isCalm(u));
    }
  });

  it('обводка в «Pokaż» у дат памяти — спокойная (без анимации)', () => {
    const t = game.nextTask(ctx, { id: 'date.katyn', side: 'B', self: false, stage: 'sprout' })!;
    const task: DatyTask = { ...t, mode: 'pokaz', answer: { day: 13, month: 4 } };
    const panel = panelOf(() => {});
    game.render(task, panel, ctx);
    for (let i = 0; i < 6; i++) click(panel.body, '[data-month-prev]');
    expect(q(panel.body, '[data-month-title]').textContent).toBe('kwiecień');
    click(panel.body, '[data-day="13"]');
    expect(q(panel.body, '[data-day="13"] [data-ring]').getAttribute('class')).toContain('calm');
  });
});

describe('Daty: посадка и движок', () => {
  it('pool: все 22 даты, сначала ближайшие вперёд от сегодняшнего дня (18.10 → 11.11, 13.12, …); Smoleńsk и Wołyń во 2-й полосе (ТЗ)', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    const pool = datyPool(ctx);
    expect(pool.length).toBe(22);
    expect(new Set(pool).size).toBe(22);
    expect(pool.slice(0, 3)).toEqual(['date.niepodleglosc', 'date.stan_wojenny', 'date.wykleci']);
    expect(pool.slice(-2).sort()).toEqual(['date.smolensk', 'date.wolyn']);
    expect(pool.at(-3)).toBe('date.papiez');
  });

  it('игра по контракту: layout full, вход calendar, участок miesiace, виды date', () => {
    expect(game).toMatchObject({ id: 'daty', entry: 'calendar', plot: 'miesiace', layout: 'full', kinds: ['date'] });
  });

  it('раунд в движке: 10 заданий всех видов, верные ответы засчитываются, итог раунда, выход возвращает мир', () => {
    const s = mkPolska();
    const root = document.createElement('div');
    const ui = mountPolskaGame(root, { bus: s.bus, games: [game], polska: s.p, now: () => NOW, rand: seeded(7), say: () => {} });
    ui.start('daty');
    expect(root.querySelector('.pq-pg')!.classList.contains('full')).toBe(true);
    vi.useFakeTimers();
    const modes = new Set<string>();
    let right = 0;
    for (let i = 0; i < ROUND_SIZE; i++) {
      const t = ui.task as DatyTask;
      expect(t, `задание ${i + 1}`).toBeTruthy();
      modes.add(t.mode);
      ui.submit(rightAnswer(t));
      if (root.querySelector('[data-feedback]')!.getAttribute('data-feedback') === 'ok') right++;
      vi.advanceTimersByTime(NEXT_DELAY_MS + 10);
      root.querySelector<HTMLButtonElement>('[data-next]')!.click();
    }
    vi.useRealTimers();
    expect(right).toBe(ROUND_SIZE);
    expect(root.querySelector('[data-round-summary]')).toBeTruthy();
    ui.stop();
    expect(ui.isOpen).toBe(false);
    expect(s.save.garden.log.length).toBe(ROUND_SIZE);
    expect(modes.has('co') || modes.has('choice') || modes.has('pokaz')).toBe(true);
  });

  it('движок: неверный ответ не засчитан, в обратной связи правильный ответ', () => {
    const s = mkPolska();
    const root = document.createElement('div');
    const ui = mountPolskaGame(root, { bus: s.bus, games: [game], polska: s.p, now: () => NOW, rand: seeded(7), say: () => {} });
    s.p.autoPlant('daty', datyPool(ctxOf(s)));
    ui.start('daty', 'date.niepodleglosc');
    const t = ui.task as DatyTask;
    expect(t.id).toBe('date.niepodleglosc');
    ui.submit(wrongAnswer(t));
    const fb = q(root, '[data-feedback]');
    expect(fb.getAttribute('data-feedback')).toBe('bad');
    expect(fb.textContent).toContain(t.mode === 'co' ? 'Święto Niepodległości' : 'jedenastego listopada');
    expect(s.save.garden.log.at(-1)).toMatchObject({ id: 'date.niepodleglosc', ok: false });
    ui.stop();
  });
});

describe('лист во весь экран: страница увеличивается под свободное место', () => {
  it('zoomFor: по ширине и по высоте, потолок, телефон без увеличения', () => {
    expect(zoomFor({ w: 1176, h: 900 }, { w: 480, h: 400 })).toBe(MAX_ZOOM);
    expect(zoomFor({ w: 1176, h: 600 }, { w: 480, h: 400 })).toBe(1.5);
    expect(zoomFor({ w: 700, h: 900 }, { w: 480, h: 400 })).toBe(1.45);
    expect(zoomFor({ w: 375, h: 640 }, { w: 480, h: 400 })).toBe(1);
    expect(zoomFor({ w: 1176, h: 410 }, { w: 480, h: 400 })).toBe(1);
    expect(zoomFor({ w: 0, h: 0 }, { w: 0, h: 0 })).toBe(1);
  });
});

// ---------- историческая справка ----------

/** Дать отработать микрозадачам: справка кладётся в отзыв по наблюдателю сразу после ответа. */
const later = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const HIST = (u: { raw: Readonly<Record<string, unknown>> }) => u.raw.history as { ru: string; pl: string; key: string[] };

describe('Daty: историческая справка в данных', () => {
  const ctx = ctxOf(mkPolska());

  it('у всех 22 дат есть history: ru 2–3 предложения ≤ 320 знаков, pl одно предложение, key 1–3 слова из ru', () => {
    expect(ctx.units.length).toBe(22);
    for (const u of ctx.units) {
      const h = historyOf(u);
      expect(h, u.id).toBeTruthy();
      const raw = HIST(u);
      expect(raw.ru.length, u.id).toBeLessThanOrEqual(320);
      expect(raw.ru, u.id).not.toContain('**');
      expect((raw.ru.match(/[.!?…](?:\s|$)/g) ?? []).length, u.id).toBeGreaterThanOrEqual(2);
      expect((raw.ru.match(/[.!?…](?:\s|$)/g) ?? []).length, u.id).toBeLessThanOrEqual(3);
      expect(raw.pl.trim().endsWith('.'), u.id).toBe(true);
      expect(raw.pl.length, u.id).toBeLessThanOrEqual(80);
      expect(raw.key.length, u.id).toBeGreaterThanOrEqual(1);
      expect(raw.key.length, u.id).toBeLessThanOrEqual(3);
      for (const k of raw.key) expect(raw.ru, `${u.id}: ключ ${k}`).toContain(k);
    }
  });

  it('факт, который проверяли: конец Варшавского восстания 2 октября, не 3-е; Wołyń, Katyń, Smoleńsk на месте', () => {
    expect(HIST(ctx.unit('date.godzina_w')!).ru).toContain('2 октября');
    expect(HIST(ctx.unit('date.godzina_w')!).ru).not.toContain('3 октября');
    for (const id of ['date.wolyn', 'date.katyn', 'date.smolensk']) expect(ctx.unit(id)).toBeTruthy();
  });

  it('boldKeys: ключи жирным дословно, длинные раньше коротких; без ключей — один кусок', () => {
    expect(boldKeys('Это stan wojenny в Польше', ['stan wojenny'])).toEqual([
      { t: 'Это ', b: false },
      { t: 'stan wojenny', b: true },
      { t: ' в Польше', b: false },
    ]);
    expect(boldKeys('Święto Konstytucji 3 Maja и Konstytucji', ['Konstytucji', 'Święto Konstytucji 3 Maja']).filter((r) => r.b).map((r) => r.t)).toEqual(['Święto Konstytucji 3 Maja', 'Konstytucji']);
    expect(boldKeys('просто', [])).toEqual([{ t: 'просто', b: false }]);
  });
});

describe('Daty: справка в блоке отзыва после ответа', () => {
  function mount(spoken: string[]) {
    const s = mkPolska();
    const root = document.createElement('div');
    const ui = mountPolskaGame(root, { bus: s.bus, games: [game], polska: s.p, now: () => NOW, rand: seeded(7), say: (t) => spoken.push(t) });
    s.p.autoPlant('daty', datyPool(ctxOf(s)));
    return { s, root, ui };
  }

  it.each([true, false])('после ответа (верного: %s) в отзыве справка: русский текст с жирными польскими ключами и польская строка', async (ok) => {
    const spoken: string[] = [];
    const { root, ui } = mount(spoken);
    ui.start('daty', 'date.stan_wojenny');
    const t = ui.task as DatyTask;
    ui.submit(ok ? rightAnswer(t) : wrongAnswer(t));
    await later();
    const fb = q(root, '[data-feedback]');
    expect(fb.getAttribute('data-feedback')).toBe(ok ? 'ok' : 'bad');
    const block = q(fb, '[data-history]');
    const h = HIST(ctxOf(mkPolska()).unit('date.stan_wojenny')!);
    expect(q(block, '[data-history-ru]').textContent).toBe(h.ru);
    expect([...block.querySelectorAll('[data-history-ru] b')].map((b) => b.textContent)).toEqual(h.key);
    expect(q(block, '[data-history-pl]').textContent).toContain(h.pl);
    // справка внутри отзыва, до строки прогресса; один раз
    expect(fb.querySelectorAll('[data-history]').length).toBe(1);
    expect(block.compareDocumentPosition(q(fb, '[data-progress-after]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // автоматом звучит только ответ; польская фраза справки — по кнопке 🔊
    expect(spoken.length).toBe(1);
    expect(spoken).not.toContain(h.pl);
    click(block, '[data-say-history]');
    expect(spoken.at(-1)).toBe(h.pl);
    // у каждого польского ключа своя 🔊
    const keyBtns = [...block.querySelectorAll<HTMLElement>('[data-say-key]')];
    expect(keyBtns.map((b) => b.dataset.saytext)).toEqual(h.key);
    keyBtns[0]!.click();
    expect(spoken.at(-1)).toBe(h.key[0]);
    ui.stop();
  });

  it('справка есть у каждой из 22 дат', async () => {
    const { s, root, ui } = mount([]);
    s.p.plant(s.p.units('daty').map((x) => x.id));
    for (const u of ctxOf(mkPolska()).units) {
      ui.start('daty', u.id);
      const t = ui.task as DatyTask;
      ui.submit(wrongAnswer(t));
      await later();
      expect(root.querySelector('[data-feedback] [data-history-ru]')!.textContent, u.id).toBe(HIST(u).ru);
      ui.stop();
    }
  });
});

describe('Daty: «Poznaj datę» — знакомство при первой встрече', () => {
  function mount(fresh: boolean, now = NOW) {
    const s = mkPolska(fresh);
    const root = document.createElement('div');
    const ui = mountPolskaGame(root, { bus: s.bus, games: [game], polska: s.p, now: () => now, rand: seeded(7), say: () => {} });
    s.p.autoPlant('daty', datyPool(ctxOf(s)));
    return { s, root, ui };
  }
  const ID = 'date.niepodleglosc';

  it('первый раз: до вопроса карточка (лист, название PL/RU, справка, «Rozumiem»), вопроса и ответа ещё нет; флаг ставится только по «Rozumiem»', () => {
    const { s, root, ui } = mount(true);
    ui.start('daty', ID);
    const card = q(root, '[data-intro]');
    expect(card.getAttribute('data-intro')).toBe(ID);
    expect(card.textContent).toContain('Poznaj datę');
    expect(q(card, '[data-leaf] .day').textContent).toBe('11');
    expect(q(card, '[data-intro-pl]').textContent).toBe('Święto Niepodległości');
    expect(q(card, '[data-intro-ru]').textContent).toBe('День Независимости');
    expect(q(card, '[data-history-ru]').textContent).toBe(HIST(s.p.unit(ID)!).ru);
    expect(root.querySelector('[data-prompt]')).toBeNull();
    expect(root.querySelector('[data-opt]')).toBeNull();
    expect(q(root, '[data-feedback]').hidden).toBe(true);
    expect(q(root, '[data-understood]').textContent).toBe('Rozumiem · Понятно →');
    // открыли, но не нажали «Понятно» — флага нет (закрыл игру: покажем снова)
    expect(s.p.seen(ID)).toBe(false);
    expect(s.save.seen).toEqual({});
    ui.stop();
    ui.start('daty', ID);
    expect(root.querySelector('[data-intro]')).toBeTruthy();
    click(root, '[data-understood]');
    expect(s.p.seen(ID)).toBe(true);
    expect(s.save.seen[ID]).toBe('2026-10-18');
    expect(root.querySelector('[data-intro]')).toBeNull();
    expect(root.querySelector('[data-prompt]')).toBeTruthy();
    expect(root.querySelector('[data-understood]')).toBeNull();
    // карточка не засчитывалась как ответ
    expect(s.save.garden.log.length).toBe(0);
    ui.stop();
  });

  it('после «Понятно» повторно не показывается: ни в этом раунде, ни после перезагрузки сохранения', () => {
    const { s, root, ui } = mount(true);
    ui.start('daty', ID);
    click(root, '[data-understood]');
    ui.submit(rightAnswer(ui.task as DatyTask));
    ui.stop();
    ui.start('daty', ID);
    expect(root.querySelector('[data-intro]')).toBeNull();
    expect(root.querySelector('[data-prompt]')).toBeTruthy();
    ui.stop();
    // «перезагрузка»: тот же сохранённый раздел, новый движок
    const bus = testBus();
    const p2 = createPolska({ bus, load: () => normalizePolska(JSON.parse(JSON.stringify(s.save))), save: () => {}, now: () => NOW, tz: () => 0 });
    expect(p2.seen(ID)).toBe(true);
    expect(p2.seen('date.wykleci')).toBe(false);
    const root2 = document.createElement('div');
    const ui2 = mountPolskaGame(root2, { bus, games: [game], polska: p2, now: () => NOW, rand: seeded(7), say: () => {} });
    p2.autoPlant('daty', datyPool(ctxOf(s)));
    ui2.start('daty', ID);
    expect(root2.querySelector('[data-intro]')).toBeNull();
    ui2.stop();
    ui2.start('daty', 'date.wykleci');
    expect(root2.querySelector('[data-intro]')).toBeTruthy();
    ui2.stop();
  });

  it('ответы уже есть, а флага нет (игрок отвечал до появления карточек) — карточка всё равно показывается', () => {
    const { s, root, ui } = mount(true);
    s.p.answer({ id: ID, side: 'A' }, true);
    s.p.answer({ id: ID, side: 'B' }, false);
    expect(s.p.info(ID).answers).toBe(2);
    expect(s.p.seen(ID)).toBe(false);
    ui.start('daty', ID);
    expect(root.querySelector('[data-intro]')).toBeTruthy();
    expect(root.querySelector('[data-prompt]')).toBeNull();
    ui.stop();
  });

  it('сохранение без поля seen читается (старое сохранение): карточки покажутся для всех, ответы и огород целы', () => {
    const old = { garden: { ...newPolskaSave().garden, planted: [{ t: NOW, id: ID }] } };
    const norm = normalizePolska(old);
    expect(norm.seen).toEqual({});
    expect(norm.garden.planted).toEqual([{ t: NOW, id: ID }]);
    expect(normalizePolska(undefined).seen).toEqual({});
    expect(normalizePolska({ garden: old.garden, seen: { [ID]: '2026-10-01', bad: 5 } }).seen).toEqual({ [ID]: '2026-10-01' });
    const p = createPolska({ load: () => norm, save: () => {}, now: () => NOW, tz: () => 0 });
    for (const u of p.units('daty')) expect(p.seen(u.id)).toBe(false);
  });

  it('markSeen: сохраняет один раз (дата не перезаписывается), чужой id игнорируется', () => {
    let save: PolskaSave = newPolskaSave();
    let writes = 0;
    let t = NOW;
    const p = createPolska({ load: () => save, save: (x) => ((save = x), writes++), now: () => t, tz: () => 0 });
    p.markSeen(ID);
    t += 86_400_000;
    p.markSeen(ID);
    p.markSeen('date.nie_ma');
    expect(save.seen).toEqual({ [ID]: '2026-10-18' });
    expect(writes).toBe(1);
  });

  it('карточка только перед вопросом: в отзыве после ответа карточки нет, у «знакомых» дат вопрос сразу', async () => {
    const { root, ui } = mount(false);
    ui.start('daty', ID);
    expect(root.querySelector('[data-intro]')).toBeNull();
    ui.submit(rightAnswer(ui.task as DatyTask));
    await later();
    expect(root.querySelector('[data-intro]')).toBeNull();
    expect(root.querySelector('[data-feedback] [data-history]')).toBeTruthy();
    ui.stop();
  });

  it('движок: раунд в свежем профиле — на каждой новой дате сначала карточка, потом вопрос; повтор даты без карточки', () => {
    const { s, root, ui } = mount(true);
    ui.start('daty');
    vi.useFakeTimers();
    const shown: string[] = [];
    const repeats: string[] = [];
    for (let i = 0; i < ROUND_SIZE; i++) {
      const t = ui.task as DatyTask;
      const card = root.querySelector('[data-intro]');
      if (card) {
        expect(card.getAttribute('data-intro')).toBe(t.id);
        expect(shown).not.toContain(t.id);
        shown.push(t.id);
        click(root, '[data-understood]');
      } else {
        repeats.push(t.id);
      }
      expect(root.querySelector('[data-prompt]'), `задание ${i + 1}`).toBeTruthy();
      ui.submit(rightAnswer(ui.task as DatyTask));
      vi.advanceTimersByTime(NEXT_DELAY_MS + 10);
      root.querySelector<HTMLButtonElement>('[data-next]')!.click();
    }
    vi.useRealTimers();
    expect(shown.length).toBeGreaterThan(0);
    for (const id of repeats) expect(shown).toContain(id);
    expect(Object.keys(s.save.seen).sort()).toEqual([...shown].sort());
    ui.stop();
  });
});
