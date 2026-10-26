// @vitest-environment happy-dom
// Игра «Miesiące» (26.10): 12 месяцев как единицы, задания на все виды просьб, проверка, польская грамматика вопросов; выбор игры у календаря и мачты.
import { describe, expect, it } from 'vitest';
import { game } from '../src/games/miesiace';
import { letterTiles, makeTask, shift, type MonthKind, type MonthTask } from '../src/games/miesiace/tasks';
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
const ctxOf = (p: ReturnType<typeof mk>, seed = 3): GameCtx => ({
  units: p.units('miesiace'),
  unit: (id) => p.unit(id),
  info: (id) => p.info(id),
  seen: () => true,
  markSeen: () => {},
  doc: p.content.docs.miesiace,
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 26, weekday: 1 }),
  rand: seeded(seed),
});
const panel = (): GamePanel => ({ body: document.createElement('div'), foot: document.createElement('div'), layout: 'panel', submit: () => {}, say: () => {}, rand: seeded(2) });
const WANTS: Want[] = [
  { id: '', side: 'A', self: false, stage: 'seed' },
  { id: '', side: 'B', self: false, stage: 'sprout' },
  { id: '', side: 'B', self: true, stage: 'bush' },
];

describe('Miesiące', () => {
  it('12 месяцев по порядку, растут на своей грядке месяцев', () => {
    const p = mk();
    const ctx = ctxOf(p);
    expect(game.pool(ctx)).toEqual(Array.from({ length: 12 }, (_, i) => `month.${i + 1}`));
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
          expect(game.check(t, t.mode === 'choice' ? '___' : ['x'], ctx).ok).toBe(false);
          if (t.mode === 'choice') {
            expect(t.options).toContain(t.answer);
            expect(new Set(t.options).size).toBe(t.options.length);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['gen', 'next', 'num', 'order', 'pl', 'ru', 'spell']);
  });

  it('польский в вопросах: «Po marcu jest…» (местный падеж), дата вслух порядковым — «trzeciego maja»', () => {
    const p = mk();
    let next: MonthTask | null = null;
    let gen: MonthTask | null = null;
    for (let seed = 1; seed < 200 && (!next || !gen); seed++) {
      const t = makeTask(ctxOf(p, seed), { id: 'month.4', side: 'B', self: false, stage: 'sprout' }) as MonthTask;
      if (t.kind === 'next') next = t;
      if (t.kind === 'gen') gen = t;
    }
    expect(next!.prompt).toBe('Po marcu jest…');
    expect(next!.answer).toBe('kwiecień');
    expect(gen!.answer).toBe('kwietnia');
    expect(gen!.say).toMatch(/^\S+ego kwietnia$/);
  });

  it('буквы: диграфы одной плиткой, две лишние похожие буквы', () => {
    const { tiles, answer } = letterTiles('marzec', seeded(1));
    expect(answer).toEqual(['m', 'a', 'rz', 'e', 'c']);
    expect(tiles).toHaveLength(7);
    for (const a of answer) expect(tiles).toContain(a);
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
