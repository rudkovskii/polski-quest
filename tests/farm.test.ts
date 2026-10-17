import { describe, expect, it } from 'vitest';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, newGarden, type GardenSave } from '../src/systems/garden';
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

const solve = (f: ReturnType<typeof setup>['farm'], mode: 1 | 2 | 3 | 4) => {
  const q = f.next(mode)!;
  const ans = q.kind === 'tiles' ? q.answer : q.answer;
  return f.answer(q, ans);
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
    expect(f.next(2)!.kind).toBe('type');
    s.setNow(s.now() + DAY_MS);
    expect(solve(f, 1).act.kind).toBe('water');
    s.setNow(s.now() + DAY_MS);
    const last = solve(f, 1);
    expect(last.act).toMatchObject({ kind: 'harvest', id: 'w.dzien_dobry', tile: [12, 14], xp: 11 });
    expect(f.info('w.dzien_dobry').status).toBe('grown');
    expect(f.stats()).toMatchObject({ grownToday: 1, grownTotal: 1, grownWords: 1 });
    expect(f.pantry()).toEqual([{ topic: 'powitania', ids: ['w.dzien_dobry'] }]);
    expect(s.xp.at(-1)?.gain).toBe(11);
    // Ошибка: правильный ответ и минус капля.
    const q = f.next(3)!;
    const r = f.answer(q, ['nie']);
    expect(r).toMatchObject({ ok: false, correct: 'Dzień dobry', act: { kind: 'miss' } });
  });
});
