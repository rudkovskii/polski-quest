// @vitest-environment happy-dom
// 09.11: очередь смещена к новым словам (каждое 2-е задание — неполитое слово, половина рабочего набора — младшие начатые)
// и длина раунда «по 10 / без конца» на доске.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, LEARNING_CAP, NEW_EVERY, newGarden, type GardenSave } from '../src/systems/garden';
import type { GameMode } from '../src/types/farm';
import { mountBoard } from '../src/ui/board';
import { mountMinigame, NEXT_DELAY_MS } from '../src/ui/minigame';
import type { Question } from '../src/systems/quiz';
import { Round, ROUND_SIZE, roundNoText, type RoundLen } from '../src/ui/roundSummary';
import { seeded, testBus } from './helpers';

const T0 = Date.UTC(2026, 10, 9, 9, 0);

function setup(seed = 7) {
  let saved: GardenSave = newGarden();
  let now = T0;
  const farm = createFarm({ bus: testBus(), load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(seed) });
  return { farm, setNow: (t: number) => (now = t) };
}

describe('Очередь: новые слова не стоят неполитыми', () => {
  /** 10 слов за 3 дня доведены до куста, потом посажено 30 новых — как у Шэфа: много неполитых при живых повторениях. */
  function grownPlusNew() {
    const s = setup();
    const old = s.farm.words.slice(0, 10).map((w) => w.id);
    s.farm.plant(old);
    let t = T0;
    for (let d = 0; d < 2; d++)
      for (const id of old)
        for (const m of [1, 2] as GameMode[]) {
          s.setNow((t += 60_000) + d * DAY_MS);
          const q = s.farm.next(m, id)!;
          s.farm.answer(q, q.answer);
        }
    const fresh = s.farm.words.slice(10, 40).map((w) => w.id);
    s.farm.plant(fresh);
    return { s, old, fresh, t: T0 + 2 * DAY_MS + 3600_000 };
  }

  it('20 заданий: каждое 2-е — неполитое слово, начато не меньше 8 новых, повторения тоже идут', () => {
    const { s, old, fresh, t } = grownPlusNew();
    const freshSet = new Set(fresh);
    const seen: string[] = [];
    const watered = new Set<string>();
    for (let i = 0; i < 20; i++) {
      s.setNow(t + i * 60_000);
      const q = s.farm.next(([1, 2] as GameMode[])[i % 2]!)!;
      seen.push(q.id);
      const r = s.farm.answer(q, q.answer);
      if (r.ok && freshSet.has(q.id)) watered.add(q.id);
    }
    // Слоты 1, 3, 5… — новое, ещё не политое слово (пока начатых семечек меньше LEARNING_CAP).
    for (let i = 0; i < 2 * LEARNING_CAP; i += NEW_EVERY) expect(freshSet.has(seen[i]!)).toBe(true);
    expect(watered.size).toBeGreaterThanOrEqual(8);
    expect(seen.filter((id) => old.includes(id)).length).toBeGreaterThanOrEqual(3);
  });

  it('новое берётся по порядку посадки: первым — давно посаженное', () => {
    const { s, fresh, t } = grownPlusNew();
    s.setNow(t);
    expect(s.farm.next(1)!.id).toBe(fresh[0]);
  });

  it('начатое новое слово доходит до ростка в том же заходе (младшие в рабочем наборе)', () => {
    const { s, fresh, t } = grownPlusNew();
    for (let i = 0; i < 40; i++) {
      s.setNow(t + i * 60_000);
      const q = s.farm.next(([1, 2] as GameMode[])[i % 2]!)!;
      s.farm.answer(q, q.answer);
    }
    const sprouts = fresh.filter((id) => s.farm.plants().find((p) => p.id === id)?.stage === 'sprout').length;
    expect(sprouts).toBeGreaterThanOrEqual(3);
  });
});

describe('10.11: свежепосаженное раньше давнего запаса', () => {
  /** Неделя игры (много давних неполитых и начатых семечек), потом посажено 10 свежих слов и пауза. */
  function afterWeek(seed: number) {
    const s = setup(seed);
    const r = seeded(seed + 50);
    s.farm.plant(s.farm.words.slice(0, 60).map((w) => w.id));
    let t = T0;
    for (let d = 0; d < 7; d++)
      for (let i = 0; i < 25; i++) {
        t = T0 + d * DAY_MS + (i + 1) * 60_000;
        s.setNow(t);
        const q = s.farm.next(([1, 2, 5] as GameMode[])[i % 3]!);
        if (q) s.farm.answer(q, r() < 0.7 ? q.answer : 'zzz');
      }
    const fresh = s.farm.words.slice(60, 70).map((w) => w.id);
    t = T0 + 8 * DAY_MS;
    s.setNow(t);
    s.farm.plant(fresh);
    return { s, fresh: new Set(fresh), t: t + 600_000 };
  }

  for (const seed of [1, 2, 3])
    it(`зерно ${seed}: первое задание захода и каждое 2-е — свежее слово, хотя давних неполитых много`, () => {
      const { s, fresh, t } = afterWeek(seed);
      const seen: boolean[] = [];
      for (let i = 0; i < 12; i++) {
        s.setNow(t + i * 60_000);
        const q = s.farm.next(2)!;
        seen.push(fresh.has(q.id));
        s.farm.answer(q, q.answer);
      }
      for (let i = 0; i < 12; i += NEW_EVERY) expect(seen[i]).toBe(true);
    });

  it('лимит начатых семечек свежие слова не держит', () => {
    const s = setup();
    const started = s.farm.words.slice(0, LEARNING_CAP + 4).map((w) => w.id);
    s.farm.plant(started);
    for (const id of started) {
      const q = s.farm.next(1, id)!;
      s.farm.answer(q, q.answer);
    }
    s.setNow(T0 + DAY_MS);
    const fresh = s.farm.words.slice(40, 43).map((w) => w.id);
    s.farm.plant(fresh);
    s.setNow(T0 + DAY_MS + 600_000);
    expect(fresh).toContain(s.farm.next(2)!.id);
  });
});

describe('Неделя: урожай не хуже прежней очереди', () => {
  // Прежняя очередь (до 09.11) на этом прогоне: в среднем 15,5 урожая и 10,6 неполитых из 40.
  function week(words: number, per: number, acc: number, seed: number) {
    const s = setup(seed);
    s.farm.plant(s.farm.words.slice(0, words).map((w) => w.id));
    const r = seeded(seed + 100);
    for (let d = 0; d < 7; d++)
      for (let i = 0; i < per; i++) {
        s.setNow(T0 + d * DAY_MS + (i + 1) * 60_000);
        const q = s.farm.next(([1, 2, 5] as GameMode[])[i % 3]!);
        if (q) s.farm.answer(q, r() < acc ? q.answer : 'zzz');
      }
    const ps = s.farm.plants();
    return { grown: s.farm.stats().grownTotal, untouched: ps.filter((p) => p.stage === 'seed' && p.drops === 0).length };
  }
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('19 слов, 7 дней по 15 ответов, 75%: в среднем не меньше 15,5 урожая', () => {
    expect(avg(Array.from({ length: 20 }, (_, i) => week(19, 15, 0.75, i + 1).grown))).toBeGreaterThanOrEqual(15.5);
  });

  it('40 слов, 7 дней по 20 ответов, 80%: неполитых в среднем меньше 10', () => {
    expect(avg(Array.from({ length: 20 }, (_, i) => week(40, 20, 0.8, i + 1).untouched))).toBeLessThan(10);
  });
});

describe('Раунд: по 10 или без конца', () => {
  it('«без конца» не заканчивается сам, «по 10» — после 10', () => {
    const r = new Round();
    for (let i = 0; i < ROUND_SIZE; i++) r.add({ ok: true });
    expect(r.done).toBe(true);
    r.len = 'endless';
    for (let i = 0; i < 40; i++) r.add({ ok: true });
    expect(r.done).toBe(false);
    expect(roundNoText(17, 'endless')).toBe('17 · ∞');
    expect(roundNoText(3, 'ten')).toBe('3 / 10');
  });

  it('доска: переключатель длины раунда запоминает выбор', () => {
    let len: RoundLen = 'ten';
    const b = mountBoard(document.body, { counts: () => ({ words: 3, phrases: 0, assemble: 0 }), onPick: () => {}, round: { get: () => len, set: (v) => (len = v) } });
    b.open();
    const btn = (v: string) => document.querySelector<HTMLButtonElement>(`[data-round-len="${v}"]`)!;
    expect(btn('ten').getAttribute('aria-pressed')).toBe('true');
    btn('endless').click();
    expect(len).toBe('endless');
    expect(btn('endless').getAttribute('aria-pressed')).toBe('true');
    b.close();
  });

  it('мини-игра «без конца»: после 25 ответов итога нет, в шапке «26 · ∞»', () => {
    vi.useFakeTimers();
    const Q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот' };
    const root = document.createElement('div');
    const g = mountMinigame(root, { bus: testBus(), next: () => Q, answer: () => ({ ok: true, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот', act: { kind: 'water', xp: 1 } }), say: () => {}, roundLen: () => 'endless' });
    g.start(1);
    const q = (sel: string) => root.querySelector<HTMLElement>(sel);
    for (let i = 0; i < 25; i++) {
      q('[data-opt="кот"]')!.click();
      vi.advanceTimersByTime(NEXT_DELAY_MS + 1);
      if (q('[data-next]')) q('[data-next]')!.click();
      else vi.advanceTimersByTime(1000);
    }
    expect(q('[data-round-summary]')).toBeNull();
    expect(q('[data-round-no]')!.textContent).toBe('26 · ∞');
    g.stop();
  });
});
afterEach(() => vi.useRealTimers());
