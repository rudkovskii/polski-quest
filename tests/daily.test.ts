// @vitest-environment happy-dom
// Случайные слова дня (edition.dailyRandom, версия Оли): выбор, раз в день, только посадки — прогресс не трогается.
import { afterEach, describe, expect, it, vi } from 'vitest';
import editionJson from '../edition.json';
import { WORDS, plOf } from '../src/systems/content';
import { DAILY_HINT, dailyDue, dailyLine, dailySeenDay, markDaily, pickDaily } from '../src/systems/dailySeeds';
import { normalizeEdition } from '../src/systems/edition';
import { createFarm } from '../src/systems/farm';
import { newGarden, type GardenSave } from '../src/systems/garden';
import { mountMorning } from '../src/ui/morning';
import { seeded, testBus } from './helpers';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('выбор слов дня', () => {
  const ids = Array.from({ length: 50 }, (_, i) => `w.x${i}`);

  it('n штук без повторов, из кандидатов; один день — один набор, другой день — другой', () => {
    const a = pickDaily(ids, 10, 20384);
    expect(a).toHaveLength(10);
    expect(new Set(a).size).toBe(10);
    for (const id of a) expect(ids).toContain(id);
    expect(pickDaily(ids, 10, 20384)).toEqual(a);
    expect(pickDaily(ids, 10, 20385)).not.toEqual(a);
  });

  it('кандидатов меньше n — берутся все; пусто — пусто', () => {
    expect(pickDaily(ids.slice(0, 3), 10, 1).sort()).toEqual(ids.slice(0, 3).sort());
    expect(pickDaily([], 10, 1)).toEqual([]);
    expect(pickDaily(ids, 0, 1)).toEqual([]);
  });

  it('раз в день, только при включённом флаге и у игрока, который уже сажал', () => {
    expect(dailyDue({ n: 10, day: 5, seen: null, started: true })).toBe(true);
    expect(dailyDue({ n: 10, day: 5, seen: 4, started: true })).toBe(true);
    expect(dailyDue({ n: 10, day: 5, seen: 5, started: true })).toBe(false);
    expect(dailyDue({ n: 0, day: 5, seen: null, started: true })).toBe(false);
    expect(dailyDue({ n: 10, day: 5, seen: null, started: false })).toBe(false);
  });

  it('отметка дня в подсказках одна и заменяет старую, остальные подсказки на месте', () => {
    const h = markDaily(['tip:jar', `${DAILY_HINT}4`, 'morning:4'], 5);
    expect(h).toEqual(['tip:jar', 'morning:4', `${DAILY_HINT}5`]);
    expect(dailySeenDay(h)).toBe(5);
    expect(dailySeenDay(['tip:jar'])).toBeNull();
  });

  it('строка новости', () => {
    expect(dailyLine(['dom', 'kot'], 0)).toBe('🎲 Новые слова дня: dom, kot');
    expect(dailyLine(['dom'], 1)).toContain('в мешке: 1');
  });
});

describe('флаг в edition.json', () => {
  it('в игре Шэфа (main) выключено, у Оли 10; старый edition.json без поля — 0; мусор — 0', () => {
    const own = normalizeEdition(editionJson as never);
    expect(own.dailyRandom).toBe(own.id === 'main' ? 0 : own.id === 'olya' ? 10 : own.dailyRandom);
    expect(normalizeEdition({ id: 'x' }).dailyRandom).toBe(0);
    expect(normalizeEdition({ id: 'x', dailyRandom: -3 }).dailyRandom).toBe(0);
    expect(normalizeEdition({ id: 'x', dailyRandom: 10 }).dailyRandom).toBe(10);
  });
});

describe('посадка на ферме: прогресс цел', () => {
  it('10 случайных новых слов дописываются к посадкам; журнал, выращенное и прежние посадки не меняются', () => {
    let saved: GardenSave = newGarden();
    const now = Date.UTC(2026, 9, 23, 9, 0);
    const farm = createFarm({ bus: testBus(), load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(3) });
    const mine = WORDS.slice(0, 5).map((w) => w.id);
    farm.plant(mine);
    for (let i = 0; i < 6; i++) {
      const q = farm.next(1)!;
      farm.answer(q, q.answer);
    }
    const before = { log: saved.log, planted: saved.planted.map((p) => ({ ...p })), xp: farm.state.xp };

    const fresh = WORDS.filter((w) => farm.info(w.id).status === 'new').map((w) => w.id);
    const ids = pickDaily(fresh, 10, 20384);
    const r = farm.plant(ids);

    expect(r.planted + r.bag).toBe(10);
    expect(saved.log).toEqual(before.log);
    expect(saved.planted.slice(0, before.planted.length)).toEqual(before.planted);
    expect(saved.planted.slice(before.planted.length).map((p) => p.id).sort()).toEqual([...ids].sort());
    expect(farm.state.xp).toBe(before.xp);
    for (const id of mine) expect(ids).not.toContain(id);
    for (const id of ids) expect(farm.info(id).status).not.toBe('new');
    expect(ids.map(plOf).every((s) => s.length > 0)).toBe(true);
  });
});

describe('утро: новость дня', () => {
  function setup(seen: number | null) {
    vi.useFakeTimers();
    const bus = testBus();
    const root = document.createElement('div');
    document.body.append(root);
    const state = { today: 10, seen, newsCalls: [] as number[], toasts: [] as string[], news: '🎲 Новые слова dnia: dom, kot' as string | null };
    const m = mountMorning(root, {
      bus,
      today: () => state.today,
      recap: () => ({ label: 'Вчера', day: 9, grown: 1, watered: 2 }),
      ripeToday: () => 0,
      seenDay: () => state.seen,
      mark: (d) => (state.seen = d),
      news: (d) => (state.newsCalls.push(d), state.news),
      toast: (t) => state.toasts.push(t),
      delayMs: 10,
    });
    bus.emit('world:location', { id: 'farm', controls: 'walk' });
    vi.advanceTimersByTime(20);
    return { root, state, m };
  }

  it('утро показано — строка в карточке, тоста нет', () => {
    const s = setup(9);
    expect(s.m.isOpen).toBe(true);
    expect(s.root.querySelector('[data-morning-news]')!.textContent).toContain('dom, kot');
    expect(s.state.toasts).toEqual([]);
    expect(s.state.newsCalls).toEqual([10]);
  });

  it('утро уже было — новость тостом', () => {
    const s = setup(10);
    expect(s.m.isOpen).toBe(false);
    expect(s.state.toasts).toEqual(['🎲 Новые слова dnia: dom, kot']);
  });
});
