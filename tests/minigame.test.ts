// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Question } from '../src/systems/quiz';
import { mountMinigame } from '../src/ui/minigame';
import { testBus } from './helpers';

const Q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот' };

describe('мини-игра', () => {
  it('открытие выключает мир, цифра выбирает ответ, тап по карте не закрывает, Esc закрывает', () => {
    const bus = testBus();
    const input: boolean[] = [];
    bus.on('world:input', ({ enabled }) => input.push(enabled));
    const given: string[] = [];
    const root = document.createElement('div');
    const g = mountMinigame(root, {
      bus,
      next: () => Q,
      answer: (_q, a) => (given.push(String(a)), { ok: a === 'кот', correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот' }),
      say: () => {},
    });
    g.start(1);
    expect(input).toEqual([false]);
    expect(root.querySelector('[data-prompt]')?.textContent).toBe('kot');
    bus.emit('input:intent', { type: 'hotkey', n: 1, to: 'ui', source: 'keyboard' });
    expect(given).toEqual(['собака']);
    expect(root.querySelector('[data-feedback]')?.getAttribute('data-feedback')).toBe('bad');
    expect(root.textContent).toContain('Правильно:');
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'pointer' });
    expect(g.isOpen).toBe(true);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(g.isOpen).toBe(false);
    expect(input).toEqual([false, true]);
  });
});
