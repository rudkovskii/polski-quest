import { describe, expect, it } from 'vitest';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, newGarden, type GardenSave } from '../src/systems/garden';
import type { BusEvents } from '../src/types/bus';
import type { FarmAct } from '../src/types/farm';
import { seeded, testBus } from './helpers';

function setup() {
  const bus = testBus();
  let saved: GardenSave = newGarden();
  let now = Date.UTC(2026, 9, 17, 9, 0);
  const acts: FarmAct[] = [];
  const xp: { level: string; gain?: number; up?: boolean }[] = [];
  bus.on('farm:act', (a) => acts.push(a));
  bus.on('hud:xp', (x) => xp.push(x));
  const farm = createFarm({ bus, load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(7) });
  return { bus, farm, acts, xp, saved: () => saved, setNow: (t: number) => (now = t), now: () => now };
}

const solve = (f: ReturnType<typeof setup>['farm'], mode: 1 | 2 | 3 | 4 | 5) => {
  const q = f.next(mode)!;
  const ans = q.kind === 'tiles' ? q.answer : q.answer;
  return f.answer(q, ans);
};

const solveId = (f: ReturnType<typeof setup>['farm'], mode: 1 | 2 | 3 | 4 | 5, id: string) => {
  const q = f.next(mode, id)!;
  return f.answer(q, q.answer);
};

describe('ферма: фасад', () => {
  it('посадка, полив, рост, урожай через 3 дня; фраза открывается, когда слова — кусты', () => {
    const s = setup();
    const f = s.farm;
    expect(f.missingWords('p.dzien_dobry')).toEqual(['w.dzien_dobry']);
    expect(f.plant(['p.dzien_dobry']).planted).toBe(0);
    expect(f.plant(['w.dzien_dobry'])).toEqual({ planted: 1, bag: 0, skipped: 0 });
    expect(s.saved().planted).toHaveLength(1);
    expect(solve(f, 1).act.kind).toBe('water');
    expect(solve(f, 1).act.kind).toBe('grow');
    expect(f.reviewMode('w.dzien_dobry')).toBe(2);
    expect(solve(f, 2).act.kind).toBe('grow');
    expect(f.info('w.dzien_dobry').stage).toBe('bush');
    expect(f.missingWords('p.dzien_dobry')).toEqual([]);
    expect(f.plant(['p.dzien_dobry']).planted).toBe(1);
    // Игра 2 — только выбор; слово «само» для урожая собирают в игре 5, «Повторить» ведёт туда.
    expect(f.next(2, 'w.dzien_dobry')!.kind).toBe('choice');
    expect(f.reviewMode('w.dzien_dobry')).toBe(5);
    expect(f.counts()).toMatchObject({ words: 1, spell: 1 });
    s.setNow(s.now() + DAY_MS);
    expect(solveId(f, 1, 'w.dzien_dobry').act.kind).toBe('water');
    s.setNow(s.now() + DAY_MS);
    expect(f.info('w.dzien_dobry')).toMatchObject({ prod: false, next: 'Осталось: собери слово в игре «Собери слово» — и урожай' });
    const last = solveId(f, 5, 'w.dzien_dobry');
    expect(last.act).toMatchObject({ kind: 'harvest', id: 'w.dzien_dobry', tile: [12, 14], xp: 11 });
    expect(f.info('w.dzien_dobry').status).toBe('grown');
    expect(f.stats()).toMatchObject({ grownToday: 1, grownTotal: 1, grownWords: 1 });
    expect(f.pantry()).toEqual([{ topic: 'powitania', ids: ['w.dzien_dobry'] }]);
    expect(s.xp.at(-1)?.gain).toBe(11);
    // Ошибка: правильный ответ и минус капля.
    // «Dzień dobry.» короче 3 плиток: в сборку не идёт, растёт в играх 1 и 2 как слово.
    expect(f.next(3)).toBeNull();
    expect(f.counts()).toEqual({ words: 0, phrases: 1, assemble: 0, spell: 0 });
    const q = f.next(1, 'p.dzien_dobry')!;
    expect(q.kind).toBe('choice');
    const r = f.answer(q, 'не то');
    expect(r).toMatchObject({ ok: false, correct: 'Здравствуйте.', act: { kind: 'miss' } });
  });

  it('полоска опыта двигается с первых ответов, hud:xp несёт уровень, долю пути и «сколько до следующего»', () => {
    const s = setup();
    const f = s.farm;
    const ids = ['w.dzien_dobry', 'w.dobry_wieczor', 'w.dobranoc', 'w.do_widzenia', 'w.prosze'].filter((id) => f.word(id));
    f.plant(ids);
    const ev: BusEvents['hud:xp'][] = [];
    s.bus.on('hud:xp', (x) => ev.push(x));
    expect(f.stats()).toMatchObject({ level: 'Старт', ratio: 0 });
    expect(f.stats().path).toMatchObject({ sub: 0, nextPl: 'Poziom 1', nextTo: 'уровня 1' });
    solve(f, 1);
    solve(f, 1);
    solve(f, 1);
    const last = ev.at(-1)!;
    expect(last).toMatchObject({ sub: 0, of: 20 });
    expect(last.ratio).toBeGreaterThan(0);
    expect(last.toNext).toBeGreaterThan(0);
  });

  it('очередь (P3a): 19 посаженных, очередь концентрируется на рабочем наборе, слово не чаще раза в 4 задания', () => {
    const s = setup();
    const f = s.farm;
    f.plant(f.words.slice(0, 19).map((w) => w.id));
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const q = f.next(i % 2 ? 2 : 1)!;
      seen.push(q.id);
      f.answer(q, q.kind === 'choice' ? q.answer : '');
    }
    for (let i = 3; i < seen.length; i++) expect(seen.slice(i - 3, i)).not.toContain(seen[i]);
    // Первые 19 заданий не размазаны по всем 19: рабочий набор (до 8) и по одному «редкому» из 5.
    expect(new Set(seen.slice(0, 19)).size).toBeLessThanOrEqual(13);
    expect(new Set(seen.slice(0, 19)).size).toBeGreaterThanOrEqual(8);
    // ответы двигают полоску A0, хотя выращенного ещё нет
    expect(f.stats()).toMatchObject({ grownWords: 0 });
    expect(f.stats().ratio).toBeGreaterThan(0.1);
  });
});
