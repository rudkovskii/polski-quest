// @vitest-environment happy-dom
// P3a: фокус очереди (рабочий набор), созревшее на сегодня уходит в конец, «наоборот» позже, подсказки доски про игры 3 и 4.
import { describe, expect, it } from 'vitest';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, FOCUS_SIZE, dayOf, derive, newGarden, pickTask, plant, settledToday, syncSlots, type AnswerEntry, type GardenSave } from '../src/systems/garden';
import type { Question } from '../src/systems/quiz';
import type { GameMode } from '../src/types/farm';
import { mountBoard } from '../src/ui/board';
import { seeded, testBus } from './helpers';

const T0 = Date.UTC(2026, 9, 17, 9, 0);

function setup(seed = 7) {
  let saved: GardenSave = newGarden();
  let now = T0;
  const farm = createFarm({ bus: testBus(), load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(seed) });
  return { farm, setNow: (t: number) => (now = t), now: () => now };
}

/** Тема из 19 слов, 3 дня по `per` ответов, верно с вероятностью `acc`; игры 1, 2 и 5 по очереди (5 — слово собрать самому, 19.10). */
function play(seed: number, per = 15, acc = 0.75): number {
  const s = setup(seed);
  s.farm.plant(s.farm.words.slice(0, 19).map((w) => w.id));
  const r = seeded(seed + 100);
  for (let d = 0; d < 3; d++)
    for (let i = 0; i < per; i++) {
      s.setNow(T0 + d * DAY_MS + (i + 1) * 60_000);
      const q = s.farm.next(([1, 2, 5] as GameMode[])[i % 3]!)!;
      s.farm.answer(q, r() < acc ? q.answer : 'zzz');
    }
  return s.farm.stats().grownTotal;
}

describe('P3a: фокус-грядка', () => {
  // С 19.10 слову для урожая нужна ещё сборка в игре 5: в среднем ≈ 4,9 (порядок 1-5-2 — 4,75, 5-1-2 — 5,2; до игры 5 было ≈ 5,3).
  it('19 слов, 3 дня по 15 ответов, 75% верно (игры 1, 2, 5): в среднем по 20 прогонам не меньше 4,7 урожая, лучшие прогоны ≥ 6', () => {
    const res = Array.from({ length: 20 }, (_, i) => play(i + 1));
    expect(res.reduce((a, b) => a + b, 0) / res.length).toBeGreaterThanOrEqual(4.7);
    expect(Math.max(...res)).toBeGreaterThanOrEqual(6);
    expect(Math.min(...res)).toBeGreaterThanOrEqual(3);
  });

  it('очередь не размазана по всем 19: первые 20 заданий — рабочий набор и редкие «чужие» (1 из 5)', () => {
    const s = setup();
    s.farm.plant(s.farm.words.slice(0, 19).map((w) => w.id));
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      s.setNow(T0 + (i + 1) * 60_000);
      const q = s.farm.next(1)!;
      seen.push(q.id);
      s.farm.answer(q, q.answer);
    }
    const counts = new Map<string, number>();
    for (const id of seen) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.values()].filter((n) => n >= 2).length).toBeGreaterThanOrEqual(FOCUS_SIZE - 2);
    expect(counts.size).toBeLessThanOrEqual(FOCUS_SIZE + 5);
  });
});

describe('P3a: созревшее на сегодня — в конец', () => {
  /** kot: день 1 — два ответа (росток в обе стороны), день 2 — куст: «До урожая: ещё 1 день». */
  function readyForTomorrow() {
    const s = setup();
    const ids = s.farm.words.slice(0, 8).map((w) => w.id);
    s.farm.plant(ids);
    const id = ids[0]!;
    const feed = (t: number, mode: GameMode): void => {
      s.setNow(t);
      const q = s.farm.next(mode, id)!;
      s.farm.answer(q, q.answer);
    };
    feed(T0 + 1000, 1);
    feed(T0 + 2000, 5);
    feed(T0 + DAY_MS + 1000, 1);
    return { s, id };
  }

  it('после «До урожая: ещё 1 день» слово не появляется в ближайших 5 заданиях', () => {
    const { s, id } = readyForTomorrow();
    expect(s.farm.info(id).next).toBe('До урожая: ещё 1 день');
    expect(settledToday(s.farm.state.items.get(id)!, dayOf(s.now()), s.now())).toBe(true);
    const got: string[] = [];
    for (let i = 0; i < 5; i++) {
      s.setNow(T0 + DAY_MS + 5000 + i * 1000);
      const q = s.farm.next((i % 2 ? 2 : 1) as GameMode)!;
      got.push(q.id);
      s.farm.answer(q, q.answer);
    }
    expect(got).not.toContain(id);
    // а на следующий день оно снова в очереди и даёт урожай
    s.setNow(T0 + 2 * DAY_MS + 1000);
    expect(settledToday(s.farm.state.items.get(id)!, dayOf(s.now()), s.now())).toBe(false);
    expect(s.farm.next(2)!.id).toBe(id);
  });

  it('pickTask: единственное созревшее на сегодня всё же выдаётся, если больше нечего', () => {
    let g = newGarden();
    g = plant(g, derive(g), ['w.kot'], T0).save;
    g = syncSlots(g, derive(g), T0);
    const e = (t: number, mode: GameMode): AnswerEntry => ({ t, day: dayOf(t), id: 'w.kot', side: mode === 1 ? 'pr' : 'rp', ok: true, mode });
    g = { ...g, log: [e(T0 + 1, 1), e(T0 + 2, 2), e(T0 + 3, 1)] };
    expect(pickTask(g, derive(g), 1, T0 + 4, dayOf(T0))).toBe('w.kot');
  });
});

describe('P3a: «наоборот» позже', () => {
  it('не в первые 10 заданий и не раньше 2 ответов слова в прямой стороне', () => {
    const s = setup();
    s.farm.plant(s.farm.words.slice(0, 6).map((w) => w.id));
    const qs: Question[] = [];
    for (let i = 0; i < 30; i++) {
      s.setNow(T0 + (i + 1) * 60_000);
      const q = s.farm.next(2)!;
      qs.push(q);
      s.farm.answer(q, q.answer);
    }
    const log = s.farm.garden.log;
    expect(qs.findIndex((q) => q.reverse)).toBeGreaterThanOrEqual(10);
    qs.forEach((q, i) => {
      if (q.reverse) expect(log.slice(0, i).filter((a) => a.id === q.id && a.side === 'rp').length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('P3a: доска про игры 3 и 4', () => {
  const mount = () => {
    const s = setup();
    const parent = document.createElement('div');
    document.body.append(parent);
    const board = mountBoard(parent, {
      counts: () => s.farm.counts(),
      onPick: () => {},
      phraseHint: () => s.farm.phraseHint(),
      plant: (ids) => s.farm.plant(ids),
    });
    return { s, parent, board };
  };

  it('закрытые игры 3 и 4: «подрастут до ростка» вместо «кустика», ближайшая фраза, её слова и кнопка посадки', () => {
    const { s, parent, board } = mount();
    board.open();
    const text = parent.textContent ?? '';
    expect(text).toContain('Сборка фраз откроется, когда слова фразы подрастут до ростка');
    expect(text).not.toContain('кустик');
    const hint = s.farm.phraseHint()!;
    expect(hint.ready).toBe(false);
    expect(hint.need.length).toBeGreaterThan(0);
    expect(text).toContain(`«${hint.pl}»`);
    expect(text).toContain(`Нужно: ${hint.need.join(', ')}`);
    const btn = parent.querySelector('[data-act="plant-missing"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Посадить недостающие');
    btn.click();
    // слова посажены (семена): нужны всё ещё, но кнопки больше нет, они «уже растут»
    for (const w of hint.toPlant) expect(s.farm.info(w).status).toBe('growing');
    expect(parent.querySelector('[data-act="plant-missing"]')).toBeNull();
    expect(parent.textContent).toContain('Уже растут');
  });

  it('когда слова фразы подросли до ростка, подсказка предлагает посадить саму фразу', () => {
    const { s, parent, board } = mount();
    const hint = s.farm.phraseHint()!;
    s.farm.plant(hint.toPlant);
    const ids = [...s.farm.state.items.keys()];
    let t = T0;
    for (const id of ids) for (let i = 0; i < 2; i++) {
      s.setNow((t += 1000));
      const q = s.farm.next(1, id)!;
      s.farm.answer(q, q.answer);
    }
    const h2 = s.farm.phraseHint()!;
    expect(h2.id).toBe(hint.id);
    expect(h2.ready).toBe(true);
    board.open();
    const btn = parent.querySelector('[data-act="plant-missing"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Посадить фразу');
    btn.click();
    expect(s.farm.info(hint.id).status).not.toBe('new');
    expect(s.farm.counts().assemble).toBe(1);
  });

  it('правило: фраза открывается, когда все слова хотя бы ростки (не кустики)', () => {
    const { s } = mount();
    const hint = s.farm.phraseHint()!;
    s.farm.plant(hint.toPlant);
    expect(s.farm.missingWords(hint.id).length).toBeGreaterThan(0); // семена
    for (const id of [...s.farm.state.items.keys()]) for (let i = 0; i < 2; i++) {
      const q = s.farm.next(1, id)!;
      s.farm.answer(q, q.answer);
    }
    expect([...s.farm.state.items.values()].every((it) => it.stage === 'sprout')).toBe(true);
    expect(s.farm.missingWords(hint.id)).toEqual([]);
  });
});
