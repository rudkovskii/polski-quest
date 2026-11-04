// @vitest-environment happy-dom
// Режим «Новые слова»: кто считается новым, круг по словам, игра под слово, раунд на доске и в мини-игре.
import { describe, expect, it, vi } from 'vitest';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, FRESH_DAYS, newGarden, type GardenSave } from '../src/systems/garden';
import { mountBoard } from '../src/ui/board';
import type { Question } from '../src/systems/quiz';
import { mountMinigame, NEXT_DELAY_MS } from '../src/ui/minigame';
import { testBus } from './helpers';

const T0 = Date.UTC(2026, 10, 4, 12, 0);

function setup() {
  const clock = { t: T0 };
  const store: { garden: GardenSave } = { garden: newGarden() };
  const farm = createFarm({ bus: testBus(), load: () => store.garden, save: (g) => (store.garden = g), now: () => clock.t, tz: () => 0, say: () => {} });
  return { clock, store, farm };
}
const WORDS = (farm: ReturnType<typeof setup>['farm'], n: number): string[] => farm.words.filter((w) => w.pos === 'noun').slice(0, n).map((w) => w.id);

describe('режим «Новые слова»', () => {
  it('новые — посаженные за последние дни и не собранные; фразы не считаются', () => {
    const { clock, farm } = setup();
    expect(farm.freshCount()).toBe(0);
    expect(farm.freshTask()).toBeNull();
    farm.plant(WORDS(farm, 3));
    farm.plant([farm.phrases[0]!.id]);
    expect(farm.freshCount()).toBe(3);
    clock.t = T0 + FRESH_DAYS * DAY_MS - 1;
    expect(farm.freshCount()).toBe(3);
    clock.t = T0 + FRESH_DAYS * DAY_MS;
    expect(farm.freshCount()).toBe(0);
  });

  it('спрашивает только новые, по кругу: старое слово на грядке в раунд не попадает', () => {
    const { clock, farm } = setup();
    const [old] = WORDS(farm, 1);
    farm.plant([old!]);
    clock.t = T0 + 4 * DAY_MS;
    const ids = WORDS(farm, 7).slice(1);
    farm.plant(ids);
    const asked: string[] = [];
    for (let i = 0; i < 12; i++) {
      const t = farm.freshTask()!;
      const q = farm.next(t.mode, t.id, { dir: 'rp' })!;
      asked.push(t.id);
      farm.answer(q, q.kind === 'choice' ? q.answer : '');
      clock.t += 60_000;
    }
    expect(asked).not.toContain(old);
    expect(new Set(asked.slice(0, 6))).toEqual(new Set(ids));
    expect(new Set(asked.slice(6))).toEqual(new Set(ids));
  });

  it('одно новое слово спрашивается раз за разом, а не пропадает', () => {
    const { clock, farm } = setup();
    farm.plant(WORDS(farm, 1));
    for (let i = 0; i < 3; i++) {
      const t = farm.freshTask()!;
      expect(t).not.toBeNull();
      const q = farm.next(t.mode, t.id, { dir: 'rp' })!;
      farm.answer(q, q.kind === 'choice' ? q.answer : '');
      clock.t += 60_000;
    }
  });

  it('раунд меняет игру под слово, заголовок один, стрелки «наоборот» нет', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const tasks = [{ id: 'a', mode: 1 as const }, { id: 'b', mode: 2 as const }];
    const asked: [number, string?][] = [];
    const Q: Question = { mode: 1, id: 'a', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['кот', 'дом'], answer: 'кот' };
    const g = mountMinigame(root, {
      bus: testBus(),
      fresh: () => tasks.shift() ?? null,
      next: (m, id) => (asked.push([m, id]), Q),
      answer: () => ({ ok: true, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот' }),
      say: () => {},
    });
    g.startFresh();
    expect(root.textContent).toContain('Новые слова');
    expect(g.mode).toBe(1);
    root.querySelector<HTMLElement>('[data-opt="кот"]')!.click();
    vi.advanceTimersByTime(NEXT_DELAY_MS);
    root.querySelector<HTMLElement>('[data-next]')!.click();
    expect(asked).toEqual([[1, 'a'], [2, 'b']]);
    expect(g.mode).toBe(2);
    expect(root.querySelector<HTMLElement>('[data-round-no]')!.hidden).toBe(false);
    g.stop();
    tasks.push({ id: 'c', mode: 1 });
    g.start(1);
    expect(root.textContent).not.toContain('Новые слова');
    vi.useRealTimers();
  });

  it('на доске кнопка с числом, без новых выключена', () => {
    let n = 2;
    let started = 0;
    const root = document.createElement('div');
    const b = mountBoard(root, { counts: () => ({ words: 3, phrases: 0, assemble: 0 }), onPick: () => {}, fresh: { count: () => n, start: () => started++ } });
    b.open();
    const btn = root.querySelector<HTMLButtonElement>('[data-fresh]')!;
    expect(btn.textContent).toContain('Новые слова (2)');
    btn.click();
    expect(started).toBe(1);
    n = 0;
    b.open();
    expect(root.querySelector<HTMLButtonElement>('[data-fresh]')!.disabled).toBe(true);
  });
});
