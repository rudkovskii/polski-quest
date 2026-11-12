// @vitest-environment happy-dom
// Версия с частью мини-игр (`edition.modes`, 12.11, Шэф: «оставить только слово → перевод и перевод → слово»):
// без игры 5 урожаю слова не нужен ответ «сам», «Повторить» не открывает выключенные игры, доска их не показывает.
import { describe, expect, it } from 'vitest';
import editionJson from '../edition.json';
import { createFarm } from '../src/systems/farm';
import { normalizeEdition } from '../src/systems/edition';
import { DAY_MS, newGarden, type GardenSave } from '../src/systems/garden';
import type { GameMode } from '../src/types/farm';
import { mountBoard } from '../src/ui/board';
import { seeded, testBus } from './helpers';

const T0 = Date.UTC(2026, 10, 2, 9);

function setup(modes?: readonly GameMode[]) {
  let saved: GardenSave = newGarden();
  let now = T0;
  const farm = createFarm({ bus: testBus(), load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(5), ...(modes ? { modes } : {}) });
  return { farm, saved: () => saved, setNow: (t: number) => (now = t) };
}

/** Росток → куст → три дня, только игры 1 и 2. */
function grow(s: ReturnType<typeof setup>, id: string): ReturnType<ReturnType<typeof setup>['farm']['answer']>[] {
  const out = [];
  for (const m of [1, 1, 2] as const) {
    const q = s.farm.next(m, id)!;
    out.push(s.farm.answer(q, q.answer));
  }
  for (const d of [1, 2]) {
    s.setNow(T0 + d * DAY_MS);
    const q = s.farm.next(2, id)!;
    out.push(s.farm.answer(q, q.answer));
  }
  return out;
}

describe('edition.modes', () => {
  it('нет поля — все пять игр; лишнее отбрасывается; у Шэфа (main) — 1 и 2 и 5 новых слов в день', () => {
    expect(normalizeEdition({}).modes).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeEdition({ modes: [2, 1, 9 as GameMode] }).modes).toEqual([1, 2]);
    expect(normalizeEdition({ modes: [] }).modes).toEqual([1, 2, 3, 4, 5]);
    const main = normalizeEdition(editionJson as never);
    expect(main.modes).toEqual([1, 2]);
    expect(main.dailyRandom).toBe(5);
  });

  it('без игры 5 слово созревает от игр 1 и 2 за три дня; «Повторить» — игры 1 и 2', () => {
    const s = setup([1, 2]);
    s.farm.plant(['w.kot']);
    const rs = grow(s, 'w.kot');
    expect(rs.at(-1)!.act.kind).toBe('harvest');
    expect(s.farm.counts().spell).toBe(0);
    s.farm.plant(['w.pies']);
    const q = s.farm.next(1, 'w.pies')!;
    s.farm.answer(q, q.answer);
    expect([1, 2]).toContain(s.farm.reviewMode('w.pies'));
  });

  it('со всеми играми то же слово ждёт «Собери слово» (прежнее правило)', () => {
    const s = setup();
    s.farm.plant(['w.kot']);
    const rs = grow(s, 'w.kot');
    expect(rs.at(-1)!.act.kind).not.toBe('harvest');
    expect(s.farm.reviewMode('w.kot')).toBe(5);
  });

  it('старый журнал пересчитывается по правилам версии: кусты, ждавшие сборки, — в урожае', () => {
    const all = setup();
    all.farm.plant(['w.kot']);
    grow(all, 'w.kot');
    let g = all.saved();
    const two = createFarm({ bus: testBus(), load: () => g, save: (x) => (g = x), now: () => T0 + 3 * DAY_MS, tz: () => 0, say: () => {}, modes: [1, 2] });
    expect(two.info('w.kot').stage).not.toBe('bush');
  });

  it('доска показывает только игры версии', () => {
    const root = document.createElement('div');
    const b = mountBoard(root, { counts: () => ({ words: 4, phrases: 0, assemble: 0, spell: 0 }), onPick: () => {}, modes: [1, 2] });
    b.open();
    expect([...root.querySelectorAll<HTMLElement>('[data-mode]')].map((x) => x.dataset.mode)).toEqual(['1', '2']);
  });
});
