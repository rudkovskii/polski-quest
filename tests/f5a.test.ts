// @vitest-environment happy-dom
// F5a: словарь на iPhone (список не едет после «Posadź», фокус не прыгает, липкая шапка с чипами и «Посадить 7»)
// и панель мини-игры (результат на месте вопроса, без прокрутки; рамка выбора только от клавиатуры).
import { describe, expect, it, vi } from 'vitest';
import type { Topic, Word } from '../src/types/content';
import type { FarmApi, ItemInfo, ItemStatus } from '../src/types/farm';
import type { Question } from '../src/systems/quiz';
import { mountDictionary } from '../src/ui/dictionary';
import { mountMinigame } from '../src/ui/minigame';
import { testBus } from './helpers';

const w = (id: string, pl: string, ru: string, topic: string): Word => ({
  id: `w.${id}`, pl, ru, tr: `[${id}]`, pos: 'noun', forms: {}, topic, freq: 1, band: 1, order: 1, ff: null, ex: null,
});

function fakeApi(): { api: FarmApi; status: Map<string, ItemStatus> } {
  const words = ['a', 'b', 'c', 'd'].map((x) => w(x, `pl${x}`, `ru${x}`, 'kolory'));
  const topics: Topic[] = [{ id: 'kolory', pl: 'Kolory', ru: 'Цвета' }];
  const status = new Map<string, ItemStatus>();
  const listeners = new Set<() => void>();
  const info = (id: string): ItemInfo => {
    const st = status.get(id) ?? 'new';
    return { id, kind: 'word', status: st, stage: st === 'growing' ? 'seed' : null, drops: 0, sides: { pr: false, rp: false }, days: 0, next: '', harvests: 0, dueAt: null, slot: null };
  };
  const api = {
    words, phrases: [], topics,
    word: (id: string) => words.find((x) => x.id === id),
    phrase: () => undefined,
    info,
    missingWords: () => [],
    plant: (ids: readonly string[]) => {
      for (const id of ids) status.set(id, 'growing');
      for (const f of listeners) f();
      return { planted: ids.length, bag: 0, skipped: 0 };
    },
    say: vi.fn(),
    onChange: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
  } as unknown as FarmApi;
  return { api, status };
}

const mountDict = (mobile: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: mobile, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  const root = document.createElement('div');
  document.body.append(root);
  const bus = testBus();
  mountDictionary(root, fakeApi().api, bus).open();
  return { root, bus };
};

describe('F5a: словарь, посадка не двигает список', () => {
  it('после «Posadź» строки те же узлы, меняется только значок; тап по соседней строке открывает её слово', () => {
    const { root } = mountDict(true);
    const rowsBefore = [...root.querySelectorAll<HTMLElement>('.dict-row')];
    rowsBefore[1]!.click();
    const heightSlot = () => root.querySelector('[data-plant-slot]')!;
    expect(heightSlot().querySelector('[data-plant]')).not.toBeNull();
    root.querySelector<HTMLElement>('[data-plant]')!.click();
    const rowsAfter = [...root.querySelectorAll<HTMLElement>('.dict-row')];
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(rowsAfter.every((r, i) => r === rowsBefore[i])).toBe(true);
    expect(rowsAfter[1]!.querySelector('.st')!.children.length).toBe(1);
    expect(rowsAfter[2]!.querySelector('.st')!.children.length).toBe(0);
    // Место под кнопку осталось, на нём «Посажено»; кнопки нет.
    expect(heightSlot().querySelector('[data-plant]')).toBeNull();
    expect(heightSlot().textContent).toContain('Посажено');
    rowsAfter[2]!.click();
    expect(root.querySelector('[data-card] [data-pl]')?.textContent).toBe('pl' + 'c');
  });

  it('фокус после посадки на строке слова, а не на «▶ медленно»', () => {
    const { root } = mountDict(true);
    root.querySelector<HTMLElement>('[data-id="w.b"]')!.click();
    root.querySelector<HTMLElement>('[data-plant]')!.click();
    expect(root.querySelector('.is-focus')?.getAttribute('data-nav')).toBe('row:w.b');
    expect(root.querySelector('[data-say-slow]')!.classList.contains('is-focus')).toBe(false);
  });

  it('после касания рамка выбора скрыта (панель .touch), от клавиши возвращается', () => {
    const { root, bus } = mountDict(true);
    const panel = root.querySelector<HTMLElement>('.pq-panel')!;
    bus.emit('input:source', { source: 'pointer' });
    expect(panel.classList.contains('touch')).toBe(true);
    bus.emit('input:source', { source: 'keyboard' });
    expect(panel.classList.contains('touch')).toBe(false);
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.pq-panel\.touch \.is-focus \{ outline: none/);
  });
});

describe('F5a: липкая шапка словаря', () => {
  it('телефон: чипы тем и «Посадить 7 / Всю тему» внутри липкой шапки ≤ 120 px; шире — чипы слева от списка', () => {
    const m = mountDict(true);
    const head = m.root.querySelector('.dict-head')!;
    expect(head.querySelector('.dict-topics')).not.toBeNull();
    expect(head.querySelector('[data-bulk]')).not.toBeNull();
    expect(head.querySelector('[data-bulk-all]')).not.toBeNull();
    expect(head.querySelector('[data-legend]')).toBeNull();
    const css = [...m.root.querySelectorAll('style')].map((x) => x.textContent).join('');
    expect(css).toMatch(/\.dict-head\s*\{[^}]*position: sticky[^}]*max-height: 120px/);
    expect(css).toMatch(/\.dict-legend \{ display: none/);
    const wide = mountDict(false);
    expect(wide.root.querySelector('.dict-head .dict-topics')).toBeNull();
    expect(wide.root.querySelector('.dict-cols .dict-topics')).not.toBeNull();
  });

  it('карточка на телефоне фиксированной высоты и прилипает к низу', () => {
    const css = [...mountDict(true).root.querySelectorAll('style')].map((x) => x.textContent).join('');
    expect(css).toMatch(/\.dict-cardwrap \{ position: sticky; bottom/);
    expect(css).toMatch(/\.dict-cardwrap \.dict-card \{ height: 230px/);
    expect(css).toMatch(/\.dict-row \{ height: 40px/);
  });
});

describe('F5a: панель мини-игры', () => {
  const Q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'Nie ma za co', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот', reverse: true } as Question;
  const mk = (ok: boolean) => {
    const root = document.createElement('div');
    const bus = testBus();
    const g = mountMinigame(root, {
      bus,
      next: () => Q,
      answer: () => ({ ok, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот', progress: 'ещё 2 дня', tomorrow: 3 }),
      say: () => {},
    });
    g.start(1);
    return { root, bus, g };
  };

  it('результат занимает место вопроса в блоке той же высоты; лист не прокручивается; «наоборот» и короткое название на месте', () => {
    for (const ok of [true, false]) {
      const { root } = mk(ok);
      expect((root.querySelector('[data-reverse]') as HTMLElement).hidden).toBe(false);
      expect(root.querySelector('.pq-game-title .short')?.textContent).toBe('Слово → перевод');
      const qb = root.querySelector('.pq-qblock')!;
      expect(qb.querySelector('[data-prompt]')).not.toBeNull();
      root.querySelector<HTMLElement>('[data-opt="собака"]')!.click();
      const same = root.querySelector('.pq-qblock')!;
      expect(same).toBe(qb);
      expect(same.querySelector('[data-feedback]')).not.toBeNull();
      expect(same.querySelector('[data-prompt]')).toBeNull();
      expect(root.querySelector('[data-game]')!.classList.contains('fit')).toBe(true);
      expect(root.querySelector('[data-game]')!.querySelectorAll('[data-feedback]')).toHaveLength(1);
      expect(same.querySelector('[data-tomorrow]')?.textContent).toContain('3');
      expect(root.querySelectorAll('.pq-opt')).toHaveLength(4);
    }
    const css = root0css();
    expect(css).toMatch(/\.pq-game-paper\.fit \{ overflow: hidden/);
    expect(css).toMatch(/\.pq-soon \{ display: none/);
  });

  function root0css(): string {
    return mk(true).root.querySelector('style')!.textContent!;
  }

  it('первый вариант не обведён заранее и после неверного ответа; рамка появляется только от стрелок', () => {
    const { root, bus } = mk(false);
    expect(root.querySelectorAll('.is-focus')).toHaveLength(0);
    // Enter без рамки только показывает её и не отвечает за игрока.
    bus.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    expect(root.querySelector('[data-feedback]')).toBeNull();
    expect(root.classList.contains('kb') || root.querySelector('.pq-game')?.classList.contains('kb')).toBe(true);
    bus.emit('input:intent', { type: 'move', dir: 'right', held: true, to: 'ui', source: 'keyboard' });
    expect(root.querySelectorAll('.is-focus')).toHaveLength(1);
    root.querySelector<HTMLElement>('[data-opt="собака"]')!.click();
    // Рамка не остаётся на отключённых вариантах, кроме «Dalej».
    expect([...root.querySelectorAll('.is-focus')].every((n) => n.hasAttribute('data-next'))).toBe(true);
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.pq-game\.kb \.is-focus, \.pq-game :focus-visible \{ outline/);
  });

  it('стрелки ходят по сетке вариантов 2×2: вниз — в нижний ряд той же колонки, а не к следующему по порядку', () => {
    const { root, bus } = mk(false);
    const mv = (dir: 'up' | 'down' | 'left' | 'right'): void =>
      bus.emit('input:intent', { type: 'move', dir, held: true, to: 'ui', source: 'keyboard' });
    const opts = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.pq-opts [data-nav]')];
    const at = (): number => opts().findIndex((n) => n.classList.contains('is-focus'));
    mv('down'); // первое нажатие ставит рамку на первый вариант
    expect(at()).toBe(0);
    mv('down');
    expect(at()).toBe(2);
    mv('right');
    expect(at()).toBe(3);
    mv('up');
    expect(at()).toBe(1);
    mv('left');
    expect(at()).toBe(0);
    mv('left'); // у края остаётся на месте
    expect(at()).toBe(0);
  });

  it('тап по варианту без клавиатуры: рамки нет ни у вариантов, ни у «Dalej»', () => {
    const { root } = mk(false);
    root.querySelector<HTMLElement>('[data-opt="собака"]')!.click();
    expect(root.querySelectorAll('.is-focus')).toHaveLength(0);
  });
});
