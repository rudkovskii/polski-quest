// @vitest-environment happy-dom
// Словарь: посадка в один клик из строки списка («＋» справа от слова). Просьба Шэфа 20.10.
import { describe, expect, it, vi } from 'vitest';
import type { Phrase, Topic, Word } from '../src/types/content';
import type { FarmApi, ItemInfo, ItemStatus } from '../src/types/farm';
import { mountDictionary } from '../src/ui/dictionary';
import { createRouter } from '../src/input/router';
import { createKeyboardSource } from '../src/input/keyboard';
import { testBus } from './helpers';

const w = (id: string, topic = 'kolory'): Word => ({ id: `w.${id}`, pl: `pl${id}`, ru: `ru${id}`, tr: `[${id}]`, pos: 'noun', forms: {}, topic, freq: 1, band: 1, order: 1, ff: null, ex: null });
const ph = (id: string): Phrase => ({ id: `p.${id}`, pl: `fraza ${id}`, ru: `фраза ${id}`, tr: `[${id}]`, topic: 'kolory', level: 1 }) as unknown as Phrase;

function mount(opts: { bag?: boolean } = {}) {
  const words = ['a', 'b', 'c'].map((x) => w(x));
  const phrases = [ph('open'), ph('shut')];
  const topics: Topic[] = [{ id: 'kolory', pl: 'Kolory', ru: 'Цвета' }];
  const status = new Map<string, ItemStatus>([['w.c', 'growing']]);
  const listeners = new Set<() => void>();
  const info = (id: string): ItemInfo => {
    const st = status.get(id) ?? 'new';
    return { id, kind: 'word', status: st, stage: st === 'growing' ? 'seed' : null, drops: 0, sides: { pr: false, rp: false }, days: 0, next: '', harvests: 0, dueAt: null, slot: null };
  };
  const plant = vi.fn((ids: readonly string[]) => {
    for (const id of ids) status.set(id, opts.bag ? 'bag' : 'growing');
    for (const f of listeners) f();
    return { planted: opts.bag ? 0 : ids.length, bag: opts.bag ? ids.length : 0, skipped: 0 };
  });
  const api = {
    words, phrases, topics,
    word: (id: string) => words.find((x) => x.id === id),
    phrase: (id: string) => phrases.find((x) => x.id === id),
    info,
    missingWords: (id: string) => (id === 'p.shut' ? ['w.a'] : []),
    plant,
    say: vi.fn(),
    onChange: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
  } as unknown as FarmApi;
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  const root = document.createElement('div');
  document.body.append(root);
  const bus = testBus();
  mountDictionary(root, api, bus).open();
  const add = (id: string) => root.querySelector<HTMLElement>(`[data-add="${id}"]`);
  const row = (id: string) => root.querySelector<HTMLElement>(`.dict-row[data-id="${id}"]`)!;
  return { root, bus, plant, add, row, status };
}

describe('Словарь: «＋» в строке', () => {
  it('есть у непосаженного слова, нет у растущего; подпись и подсказка', () => {
    const t = mount();
    expect(t.add('w.a')).not.toBeNull();
    expect(t.add('w.b')).not.toBeNull();
    expect(t.add('w.c')).toBeNull();
    expect(t.add('w.a')!.getAttribute('aria-label')).toBe('Посадить pla');
    expect(t.add('w.a')!.getAttribute('title')).toBe('Посадить');
    // «＋» не внутри кнопки-строки (кнопка в кнопке недопустима) и не в ячейке значка.
    expect(t.add('w.a')!.closest('.dict-row')).toBeNull();
    expect(t.row('w.a').querySelector('.st')!.children.length).toBe(0);
  });

  it('клик сажает слово, карточка не меняется, строки те же узлы, появился значок и «＋» ушла', () => {
    const t = mount();
    t.row('w.b').click();
    const card = () => t.root.querySelector('[data-card] [data-pl]')?.textContent;
    expect(card()).toBe('plb');
    const rowsBefore = [...t.root.querySelectorAll('.dict-row')];
    t.add('w.a')!.click();
    expect(t.plant).toHaveBeenCalledWith(['w.a']);
    expect(card()).toBe('plb');
    expect(t.row('w.b').classList.contains('sel')).toBe(true);
    const rowsAfter = [...t.root.querySelectorAll('.dict-row')];
    expect(rowsAfter.length).toBe(rowsBefore.length);
    expect(rowsAfter.every((r, i) => r === rowsBefore[i])).toBe(true);
    expect(t.add('w.a')).toBeNull();
    expect(t.row('w.a').querySelector('.st')!.children.length).toBe(1);
    expect(t.row('w.a').querySelector('.st')!.classList.contains('pop')).toBe(true);
    expect(t.add('w.b')).not.toBeNull();
    expect(t.root.querySelector('[data-note]')!.textContent).toBe('Посажено на грядку');
  });

  it('грядки заняты: слово в мешке, тот же тост, что у «Posadź»', () => {
    const t = mount({ bag: true });
    t.add('w.a')!.click();
    expect(t.root.querySelector('[data-note]')!.textContent).toBe('В мешке: грядки заняты');
    expect(t.add('w.a')).toBeNull();
  });

  it('тап по самой строке по-прежнему открывает карточку', () => {
    const t = mount();
    t.row('w.a').click();
    expect(t.root.querySelector('[data-card] [data-pl]')?.textContent).toBe('pla');
    expect(t.plant).not.toHaveBeenCalled();
  });

  it('фразы: открытая получает «＋», фраза под замком — нет', () => {
    const t = mount();
    t.root.querySelector<HTMLElement>('[data-tab="phrases"]')!.click();
    expect(t.add('p.open')).not.toBeNull();
    expect(t.add('p.shut')).toBeNull();
    t.add('p.open')!.click();
    expect(t.plant).toHaveBeenCalledWith(['p.open']);
  });

  it('клавиша «+» (intent plant) сажает слово под рамкой; стрелки ходят по строкам как раньше', () => {
    const t = mount();
    t.bus.emit('input:intent', { type: 'move', dir: 'down', held: true, to: 'ui', source: 'keyboard' });
    expect(t.root.querySelector('.is-focus')?.getAttribute('data-nav')).toBe('row:w.b');
    t.bus.emit('input:intent', { type: 'plant', to: 'ui', source: 'keyboard' });
    expect(t.plant).toHaveBeenCalledWith(['w.b']);
    // «＋» в строках не попадает в навигацию стрелок.
    expect(t.root.querySelector('.dict-add[data-nav]')).toBeNull();
  });
});

describe('ввод: клавиша «+»', () => {
  it('в оверлее «+» и «=» дают intent plant, в мире и в поле ввода — ничего', () => {
    const bus = testBus();
    const got: string[] = [];
    bus.on('input:intent', (i) => got.push(`${i.type}:${i.to}`));
    const r = createRouter({ bus, coarse: false });
    const kb = createKeyboardSource(r);
    const press = (code: string, target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey: code === 'Equal', bubbles: true, cancelable: true }));
    press('Equal');
    expect(got).toEqual([]);
    r.setFocus('ui');
    press('Equal');
    press('NumpadAdd');
    expect(got).toEqual(['plant:ui', 'plant:ui']);
    const input = document.createElement('input');
    document.body.append(input);
    press('Equal', input);
    expect(got).toHaveLength(2);
    kb.dispose();
    r.dispose();
    input.remove();
  });
});
