// @vitest-environment happy-dom
// Озвучка плиток: тап по польской плитке шлёт `audio:play` с её текстом, по русской — нет; возврат плитки молчит.
import { describe, expect, it } from 'vitest';
import { choice, tiles } from '../src/games/kit';
import type { Question } from '../src/systems/quiz';
import type { GamePanel } from '../src/types/polska';
import { mountMinigame } from '../src/ui/minigame';
import { seeded, testBus } from './helpers';

const mkPanel = (said: string[]): GamePanel => ({ body: document.createElement('div'), foot: document.createElement('div'), layout: 'panel', submit: () => {}, say: (t) => said.push(t), rand: seeded(1) });
const tap = (root: ParentNode, t: string): void => root.querySelector<HTMLElement>(`[data-tile="${t}"]`)!.click();

describe('kit.tiles: озвучка плиток', () => {
  it('польская плитка звучит целиком при тапе; возврат из ряда и «Сбросить» молчат', () => {
    const said: string[] = [];
    const panel = mkPanel(said);
    const w = tiles(panel, ['Jeszcze', 'Polska', 'nie zginęła']);
    tap(w, 'Polska');
    tap(w, 'nie zginęła');
    expect(said).toEqual(['Polska', 'nie zginęła']);
    w.querySelector<HTMLElement>('.pq-built .pq-tile')!.click();
    panel.foot.querySelector<HTMLElement>('[data-reset]')!.click();
    expect(said).toEqual(['Polska', 'nie zginęła']);
  });

  it('занятая (disabled) плитка не звучит повторно', () => {
    const said: string[] = [];
    const w = tiles(mkPanel(said), ['nie', 'tak']);
    tap(w, 'nie');
    tap(w, 'nie');
    expect(said).toEqual(['nie']);
  });

  it('русские плитки молчат', () => {
    const said: string[] = [];
    const w = tiles(mkPanel(said), ['Еще', 'Польша'], 'ru');
    tap(w, 'Польша');
    expect(said).toEqual([]);
  });

  it('варианты выбора kit.choice сами не озвучиваются (после проверки движок озвучивает ответ)', () => {
    const said: string[] = [];
    const g = choice(mkPanel(said), ['pies', 'kot'], 'kot');
    g.querySelector<HTMLElement>('[data-opt="pies"]')!.click();
    expect(said).toEqual([]);
  });
});

describe('v1-мини-игра: озвучка плиток и польских вариантов', () => {
  const mk = (q: Question) => {
    const root = document.createElement('div');
    const bus = testBus();
    const played: (string | undefined)[] = [];
    bus.on('audio:play', (p) => played.push(p.text));
    const said: string[] = [];
    const g = mountMinigame(root, { bus, next: () => q, answer: (_q, a) => ({ ok: Array.isArray(a) ? a.join(' ') === 'a b' : a === (q as { answer: string }).answer, correct: 'x', pl: 'x', ru: 'x', tr: 'x' }), say: (id) => said.push(id) });
    g.start(q.mode);
    return { root, played, said };
  };

  it('игра 3: тап по польской плитке шлёт audio:play с её текстом', () => {
    const { root, played } = mk({ mode: 3, id: 'p.a', kind: 'tiles', prompt: 'а б', promptLang: 'ru', tiles: ['a', 'b', 'zły'], answer: ['a', 'b'] } as unknown as Question);
    tap(root, 'b');
    tap(root, 'a');
    expect(played).toEqual(['b', 'a']);
    root.querySelector<HTMLElement>('.pq-built .pq-tile')!.click();
    expect(played).toEqual(['b', 'a']);
  });

  it('игра 4: русские плитки молчат', () => {
    const { root, played } = mk({ mode: 4, id: 'p.a', kind: 'tiles', prompt: 'a b', promptLang: 'pl', tiles: ['а', 'б'], answer: ['а', 'б'] } as unknown as Question);
    tap(root, 'а');
    expect(played).toEqual([]);
  });

  it('игра 2: неверный польский вариант звучит при выборе; верный не дублируется (его голосит ответ)', () => {
    const q: Question = { mode: 2, id: 'w.kot', kind: 'choice', prompt: 'кот', promptLang: 'ru', options: ['pies', 'kot', 'dom', 'mama'], answer: 'kot' };
    const a = mk(q);
    a.root.querySelector<HTMLElement>('[data-opt="pies"]')!.click();
    expect(a.played).toEqual(['pies']);
    const b = mk(q);
    b.root.querySelector<HTMLElement>('[data-opt="kot"]')!.click();
    expect(b.played).toEqual([]);
    expect(b.said).toEqual(['w.kot']);
  });

  it('игра 1: русские варианты не звучат', () => {
    const { root, played } = mk({ mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот'], answer: 'кот' });
    root.querySelector<HTMLElement>('[data-opt="собака"]')!.click();
    expect(played).toEqual([]);
  });
});
