// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Question } from '../src/systems/quiz';
import { mountMinigame, NEXT_DELAY_MS } from '../src/ui/minigame';
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

describe('панель мини-игры', () => {
  it('кнопки действий закреплены в полосе внизу, а не в прокручиваемой бумаге; «Dalej» на том же месте', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const g = mountMinigame(root, {
      bus: testBus(),
      next: () => Q,
      answer: (_q, a) => ({ ok: a === 'кот', correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот' }),
      say: () => {},
    });
    g.start(1);
    const foot = root.querySelector('[data-foot]')!;
    const paper = root.querySelector('[data-game]')!;
    expect(foot.parentElement).toBe(paper.parentElement);
    root.querySelector<HTMLElement>('[data-opt="собака"]')!.click();
    expect(foot.querySelector('[data-next]')).not.toBeNull();
    expect(paper.querySelector('[data-next]')).toBeNull();
    expect(root.querySelector('.pq-game-box')?.parentElement).toBe(root.querySelector('.pq-game'));
    // высота панели задана стилем и не зависит от содержимого
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.pq-game-box[^}]*\bheight: clamp\(/);
    expect(css).toMatch(/\.pq-game-foot[^}]*flex: 0 0 auto/);
    vi.advanceTimersByTime(NEXT_DELAY_MS);
    root.querySelector<HTMLElement>('[data-next]')!.click();
    expect(foot.querySelector('[data-next]')).toBeNull();
    vi.useRealTimers();
  });
});

describe('P3b: панель мини-игры', () => {
  const mk = (q: Question, answered: unknown[] = []) => {
    const root = document.createElement('div');
    const bus = testBus();
    let n = 0;
    const g = mountMinigame(root, {
      bus,
      next: () => ((n += 1), q),
      answer: (_q, a) => (answered.push(a), { ok: false, correct: 'x', pl: 'x', ru: 'x', tr: 'x' }),
      say: () => {},
    });
    return { root, bus, g, count: () => n };
  };

  it('«Dalej» не нажимается первые 300 мс: двойной тап не пропускает задание', () => {
    vi.useFakeTimers();
    const { root, bus, g, count } = mk(Q);
    g.start(1);
    root.querySelector<HTMLElement>('[data-opt="собака"]')!.click();
    const dalej = root.querySelector<HTMLElement>('[data-next]')!;
    dalej.click();
    bus.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    expect(count()).toBe(1);
    expect(root.querySelector('[data-feedback]')).not.toBeNull();
    vi.advanceTimersByTime(NEXT_DELAY_MS);
    dalej.click();
    expect(count()).toBe(2);
    expect(root.querySelector('[data-feedback]')).toBeNull();
    vi.useRealTimers();
  });

  it('пустой ответ не отправляется: «Sprawdź» неактивна, пока в поле пусто или пробелы (игра 5, «⌨ Напечатать»)', () => {
    const given: unknown[] = [];
    const spell = { mode: 5, id: 'w.kot', kind: 'spell', dir: 'rp', prompt: 'кот', promptLang: 'ru', answer: 'kot', accept: ['kot'], units: ['k', 'o', 't'], tiles: ['t', 'ó', 'k', 'o', 'l'], layout: [null, null, null] };
    const { root, g } = mk(spell as Question, given);
    g.start(5);
    root.querySelector<HTMLButtonElement>('[data-typemode]')!.click();
    const check = root.querySelector<HTMLButtonElement>('[data-check]')!;
    const input = root.querySelector<HTMLInputElement>('[data-type]')!;
    expect(check.disabled).toBe(true);
    check.click();
    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    expect(check.disabled).toBe(true);
    input.value = 'kot';
    input.dispatchEvent(new Event('input'));
    expect(check.disabled).toBe(false);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(check.disabled).toBe(true);
    expect(given).toEqual([]);
  });

  it('пустая сборка не отправляется', () => {
    const given: unknown[] = [];
    const { root, g, bus } = mk({ mode: 3, id: 'p.a', kind: 'tiles', prompt: 'a b c', promptLang: 'ru', tiles: ['a', 'b', 'c'], answer: ['a', 'b', 'c'] } as unknown as Question, given);
    g.start(3);
    const check = root.querySelector<HTMLButtonElement>('[data-check]')!;
    expect(check.disabled).toBe(true);
    check.click();
    bus.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    expect(given).toEqual([]);
    root.querySelector<HTMLElement>('[data-tile="a"]')!.click();
    expect(root.querySelector<HTMLButtonElement>('[data-check]')!.disabled).toBe(false);
  });

  it('блок вопроса фиксированной высоты; слова в вариантах не рвутся по слогам', () => {
    const { root, g } = mk({ ...Q, options: ['присаживайтесь', 'кот', 'дом', 'сверхъестественнопротивоположный'] } as Question);
    g.start(1);
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.pq-qblock\s*\{[^}]*\bheight: \d+px/);
    expect(css).toMatch(/\.pq-opt \.t\s*\{[^}]*hyphens: none[^}]*word-break: normal/);
    expect(root.querySelector('[data-qblock] [data-prompt]')).not.toBeNull();
    const opts = [...root.querySelectorAll('.pq-opt')];
    // P4a (B4): «присаживайтесь» (14 букв) — мельче, чем просто длинное, и без посимвольного переноса.
    expect(opts[0]!.classList.contains('xlong')).toBe(true);
    expect(opts[1]!.classList.contains('long')).toBe(false);
    expect(opts[3]!.classList.contains('xxlong')).toBe(true);
    expect(css).toMatch(/\.pq-game \* \{[^}]*hyphens: none/);
    expect(css).not.toMatch(/\.pq-opt\.xlong \.t \{[^}]*anywhere/);
  });
});
