// @vitest-environment happy-dom
// Игра «Miesiące» (26.10, путь с нуля 27.10 — D-67): 12 месяцев как единицы, задания на все виды просьб, проверка, польская грамматика вопросов;
// новичок видит только знакомые месяцы, ступени по три, карточка знакомства, колесо года; выбор игры у календаря.
import { describe, expect, it } from 'vitest';
import { game } from '../src/games/miesiace';
import { INTRO_FLAG, renderHub, stepViews } from '../src/games/miesiace/levels';
import { letterTiles, makeTask, requestWheel, resetWheel, shift, type MonthKind, type MonthTask } from '../src/games/miesiace/tasks';
import { GAMES_BY_ENTRY } from '../src/games/registry';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import { plotOf } from '../src/systems/zagroda';
import type { GameCtx, GamePanel, Want } from '../src/types/polska';
import { mountEntryPick } from '../src/ui/entryPick';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 26, 10, 0);

function mk() {
  let save: PolskaSave = newPolskaSave();
  const p = createPolska({ bus: testBus(), load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
  return p;
}
const ctxOf = (p: ReturnType<typeof mk>, seed = 3, seen: (id: string) => boolean = () => true, marked: string[] = []): GameCtx => ({
  units: p.units('miesiace'),
  unit: (id) => p.unit(id),
  info: (id) => p.info(id),
  seen,
  markSeen: (id) => marked.push(id),
  doc: p.content.docs.miesiace,
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 26, weekday: 1 }),
  rand: seeded(seed),
});
const panel = (): GamePanel => ({ body: document.createElement('div'), foot: document.createElement('div'), layout: 'panel', submit: () => {}, say: () => {}, rand: seeded(2) });
const WANTS: Want[] = [
  { id: '', side: 'A', self: false, stage: 'seed' },
  { id: '', side: 'A', self: false, stage: 'sprout' },
  { id: '', side: 'B', self: false, stage: 'seed' },
  { id: '', side: 'B', self: false, stage: 'sprout' },
  { id: '', side: 'B', self: false, stage: 'bush' },
  { id: '', side: 'B', self: true, stage: 'bush' },
];

describe('Miesiące', () => {
  it('новичку открыта первая тройка (сажается она), месяцы растут на своей грядке', () => {
    const p = mk();
    const ctx = ctxOf(p, 3, () => false);
    expect(game.pool(ctx)).toEqual(['month.1', 'month.2', 'month.3']);
    expect(stepViews(ctx).map((v) => v.open)).toEqual([true, false, false, false, false]);
    for (const u of p.units('miesiace')) expect(plotOf(u).obj).toBe(`bed_${u.raw.month}`);
    expect(shift(12, 1)).toBe(1);
    expect(shift(1, -1)).toBe(12);
  });

  it('каждый месяц на каждую просьбу: задание есть, рисуется, верный ответ засчитан, неверный нет; все виды встречаются', () => {
    const p = mk();
    const seen = new Set<MonthKind>();
    for (const u of p.units('miesiace')) {
      for (const w of WANTS) {
        for (let seed = 1; seed <= 12; seed++) {
          resetWheel();
          const ctx = ctxOf(p, seed * 7 + Number(u.raw.month));
          const t = makeTask(ctx, { ...w, id: u.id }) as MonthTask;
          expect(t, `${u.id} ${w.side}`).toBeTruthy();
          seen.add(t.kind);
          expect(t.side).toBe(w.self ? 'B' : w.side);
          if (w.self) expect(t.self).toBe(true);
          const pn = panel();
          game.render(t, pn, ctx);
          expect(pn.body.querySelector('[data-prompt]'), t.kind).toBeTruthy();
          expect(game.check(t, t.answer, ctx).ok, `${u.id} ${t.kind}`).toBe(true);
          expect(game.check(t, t.mode === 'choice' ? '___' : t.mode === 'wheel' ? { mistakes: 9 } : ['x'], ctx).ok).toBe(false);
          if (t.mode === 'choice') {
            expect(t.options).toContain(t.answer);
            expect(new Set(t.options).size).toBe(t.options.length);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['gen', 'next', 'num', 'order', 'pl', 'root', 'ru', 'spell', 'wheel']);
  });

  it('польский в вопросах: «Po marcu jest…» (местный падеж), дата вслух порядковым — «trzeciego maja»', () => {
    const p = mk();
    let next: MonthTask | null = null;
    let gen: MonthTask | null = null;
    for (let seed = 1; seed < 200 && (!next || !gen); seed++) {
      const t = makeTask(ctxOf(p, seed), { id: 'month.4', side: 'B', self: false, stage: 'bush' }) as MonthTask;
      if (t.kind === 'next') next = t;
      if (t.kind === 'gen') gen = t;
    }
    expect(next!.prompt).toBe('Po marcu jest…');
    expect(next!.answer).toBe('kwiecień');
    expect(gen!.answer).toBe('kwietnia');
    expect(gen!.say).toMatch(/ego kwietnia$/);
  });

  it('буквы: диграфы одной плиткой, две лишние похожие буквы', () => {
    const { tiles, answer } = letterTiles('marzec', seeded(1));
    expect(answer).toEqual(['m', 'a', 'rz', 'e', 'c']);
    expect(tiles).toHaveLength(7);
    for (const a of answer) expect(tiles).toContain(a);
  });
});

describe('Miesiące с нуля', () => {
  it('новичок: в вопросах и вариантах только знакомые месяцы, «po…» без знакомого соседа не спрашивается', () => {
    const p = mk();
    const met = new Set(['month.1', 'month.2', 'month.3']);
    const names = new Set(['styczeń', 'luty', 'marzec', 'styczniu', 'lutym', 'marcu', 'январь', 'февраль', 'март']);
    for (let seed = 1; seed < 80; seed++) {
      resetWheel();
      for (const w of WANTS.filter((x) => !x.self)) {
        const t = makeTask(ctxOf(p, seed, (id) => met.has(id)), { ...w, id: 'month.1' }) as MonthTask;
        if (t.kind === 'next') throw new Error('po grudniu без знакомого grudnia');
        // Знакомы три месяца — три варианта, все из них (кроме «po…»/порядка, где они не нужны).
        if (t.mode === 'choice' && t.kind !== 'num' && t.kind !== 'gen') expect(t.options.every((o) => names.has(o)), `${t.kind} ${t.options}`).toBe(true);
        if (t.mode === 'choice') expect(t.options).toHaveLength(3);
      }
    }
  });

  it('карточка знакомства: незнакомый месяц сначала карточкой, «Понятно» ставит флаг и показывает задание', () => {
    const p = mk();
    const marked: string[] = [];
    const ctx = ctxOf(p, 5, () => false, marked);
    const t = makeTask(ctx, { id: 'month.4', side: 'A', self: false, stage: 'seed' }) as MonthTask;
    const pn = panel();
    game.render(t, pn, ctx);
    const card = pn.body.querySelector('[data-intro="month.4"]')!;
    expect(card.textContent).toContain('kwiecień');
    expect(card.querySelector('[data-intro-why]')!.textContent).toContain('kwiat');
    expect(pn.body.querySelector('[data-prompt]')).toBeNull();
    pn.foot.querySelector<HTMLButtonElement>('[data-understood]')!.click();
    expect(marked).toEqual(['month.4']);
    expect(pn.body.querySelector('[data-intro]')).toBeNull();
    expect(pn.body.querySelector('[data-prompt]')).toBeTruthy();
  });

  it('колесо года: не та клетка — промах, все на местах — ответ с числом промахов; «Cały rok» — все 12 с нуля', () => {
    const p = mk();
    const met = new Set(['month.1', 'month.2', 'month.3', 'month.4']);
    let t: MonthTask | null = null;
    for (let seed = 1; seed < 100 && t?.kind !== 'wheel'; seed++) {
      resetWheel();
      t = makeTask(ctxOf(p, seed, (id) => met.has(id)), { id: 'month.2', side: 'B', self: false, stage: 'sprout' }) as MonthTask;
    }
    expect(t!.wheel!.place.sort()).toEqual([1, 2, 3]);
    expect(t!.wheel!.fixed).toEqual([4]);
    const got: unknown[] = [];
    const pn = { ...panel(), submit: (a: unknown) => got.push(a) };
    game.render(t!, pn, ctxOf(p));
    expect(pn.body.querySelectorAll('button[data-cell]')).toHaveLength(11);
    const now = (): number => Number(pn.body.querySelector<HTMLElement>('[data-wheel-month]')!.dataset.wheelMonth);
    const cell = (n: number): HTMLButtonElement => pn.body.querySelector<HTMLButtonElement>(`button[data-cell="${n}"]`)!;
    cell(now() === 12 ? 11 : 12).click();
    for (let i = 0; i < 3; i++) cell(now()).click();
    expect(got).toEqual([{ mistakes: 1 }]);
    expect(game.check(t!, got[0], ctxOf(p)).ok).toBe(true);

    resetWheel();
    requestWheel();
    const all = makeTask(ctxOf(p, 2, () => false), { id: 'month.1', side: 'A', self: false, stage: 'seed' }) as MonthTask;
    expect(all.kind).toBe('wheel');
    expect(all.wheel!.place.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(all.wheel!.fixed).toEqual([]);
    expect(makeTask(ctxOf(p, 2, () => false), { id: 'month.1', side: 'A', self: false, stage: 'seed' })!.kind).not.toBe('wheel');
  });

  it('экран выбора: вступление один раз, потом колесо и ступени; «Graj» начинает раунд тройки', () => {
    const p = mk();
    const flags = new Set<string>();
    const ctx: GameCtx = { ...ctxOf(p, 1, () => false), flag: (k) => flags.has(k), setFlag: (k) => void flags.add(k) };
    const pn = panel();
    const begun: [readonly string[], number][] = [];
    renderHub(pn, ctx, (ids, n) => begun.push([ids, n]));
    pn.body.querySelector<HTMLButtonElement>('[data-ms-start]')!.click();
    expect(flags.has(INTRO_FLAG)).toBe(true);
    expect(pn.body.querySelectorAll('[data-year] [data-cell]')).toHaveLength(12);
    expect(pn.body.querySelectorAll('[data-step]')).toHaveLength(5);
    pn.body.querySelector<HTMLButtonElement>('[data-step-play="1"]')!.click();
    expect(begun).toEqual([[['month.1', 'month.2', 'month.3'], 9]]);
    pn.body.querySelector<HTMLButtonElement>('[data-step-open="3"]')!.click();
    expect(stepViews(ctx)[2]!.open).toBe(true);
  });
});

describe('выбор игры у точки входа', () => {
  it('календарь: Daty и Miesiące, нажатие запускает выбранную', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const played: string[] = [];
    const pick = mountEntryPick(root, { play: (id) => played.push(id), bus: testBus() });
    pick.open(GAMES_BY_ENTRY.get('calendar')!);
    const btns = [...root.querySelectorAll<HTMLButtonElement>('[data-pick-game]')];
    expect(btns.map((b) => b.dataset.pickGame)).toEqual(['daty', 'miesiace']);
    btns[1]!.click();
    expect(played).toEqual(['miesiace']);
    expect(pick.isOpen).toBe(false);
  });
});
