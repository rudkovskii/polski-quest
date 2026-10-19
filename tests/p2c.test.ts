// @vitest-environment happy-dom
// P2c: заголовок панели по-русски (с меткой «↔ наоборот»), понятные тексты прогресса, ряд вариантов фиксированной высоты.
import { describe, expect, it } from 'vitest';
import { DAY_MS, derive, newGarden, plant, progressText } from '../src/systems/garden';
import type { Question } from '../src/systems/quiz';
import type { GameMode } from '../src/types/farm';
import { MODE_NAME } from '../src/ui/glossary';
import { mountMinigame } from '../src/ui/minigame';
import { testBus } from './helpers';

const T0 = Date.UTC(2026, 9, 17, 9, 0);
const mk = (q: () => Question) => {
  const root = document.createElement('div');
  const g = mountMinigame(root, { bus: testBus(), next: q, answer: () => ({ ok: true, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот' }), say: () => {} });
  return { root, g };
};

describe('P2c: панель мини-игры', () => {
  it('заголовок: русское название, польское мелко; метка «↔ наоборот» рядом', () => {
    let q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот'], answer: 'кот' };
    const { root, g } = mk(() => q);
    for (const m of [1, 2, 3, 4] as const) {
      g.start(m);
      const t = root.querySelector('[data-title]') as HTMLElement;
      expect(t.firstChild?.textContent).toBe(MODE_NAME[m].ru);
      expect(t.querySelector('small')?.textContent).toBe(MODE_NAME[m].pl);
      expect((root.querySelector('[data-reverse]') as HTMLElement).hidden).toBe(true);
      g.stop();
    }
    q = { ...q, mode: 1, reverse: true };
    g.start(2);
    expect((root.querySelector('[data-reverse]') as HTMLElement).hidden).toBe(false);
    expect(root.querySelector('[data-title]')?.textContent).toContain(MODE_NAME[2].ru);
    g.stop();
  });

  it('варианты: длинный ответ переносится внутри кнопки фиксированной высоты', () => {
    const { root, g } = mk(() => ({ mode: 1 as GameMode, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['кот', 'очень длинный перевод в несколько строк подряд', 'дом', 'мама'], answer: 'кот' }));
    g.start(1);
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.pq-opts \{[^}]*grid-auto-rows: \d+px/);
    expect(css).toMatch(/\.pq-game \.pq-opt \.t \{[^}]*-webkit-line-clamp: 3/);
    expect(root.querySelectorAll('.pq-opt .t')).toHaveLength(4);
    expect(root.querySelector('[data-opt="кот"]')).not.toBeNull();
    g.stop();
  });
});

describe('P2c: тексты прогресса без жаргона', () => {
  it('«кустик», «слово снова в банке», банка поясняется', () => {
    let g = newGarden();
    g = plant(g, derive(g), ['w.kot'], T0).save;
    const add = (t: number, mode: GameMode): void => {
      g = { ...g, log: [...g.log, { t, day: Math.floor(t / DAY_MS), id: 'w.kot', side: mode === 1 ? 'pr' : 'rp', ok: true, mode, ...(mode === 5 ? { prod: true } : {}) }] };
    };
    add(T0 + 1, 1);
    add(T0 + 2, 5);
    expect(progressText(derive(g).items.get('w.kot'), T0 + 4)).toBe('ещё 1 полив до кустика');
    add(T0 + 5, 1);
    add(T0 + DAY_MS, 1);
    add(T0 + 2 * DAY_MS, 1);
    const it = derive(g).items.get('w.kot')!;
    expect(it.stage).toBeNull();
    expect(progressText(it, T0 + 2 * DAY_MS)).toBe('слово выучено и лежит в банке, вернётся повторить через 7 дней');
    expect(progressText(it, T0 + 10 * DAY_MS)).toBe('один верный ответ, и слово снова в банке');
  });
});
