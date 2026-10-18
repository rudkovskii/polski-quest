// @vitest-environment happy-dom
// Возврат из мини-игр к точке входа: `systems/entryPoint.ts` (снимок места, `world:return`, «Na pole!», сохранение позиции) и кнопка «↩ Wróć · Назад»
// в итоге раунда v1 и v2.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAMES } from '../src/games/registry';
import { createEntryPoint, sameSpot, type HeroSpot } from '../src/systems/entryPoint';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import type { BusEvents } from '../src/types/bus';
import type { Question } from '../src/systems/quiz';
import { mountMinigame, NEXT_DELAY_MS, type AnswerResult } from '../src/ui/minigame';
import { mountPolskaGame, SUMMARY_GUARD_MS } from '../src/ui/polskaGame';
import { modelAt, run, send, seeded, testBus } from './helpers';

afterEach(() => vi.useRealTimers());

const NOW = Date.UTC(2026, 9, 18, 9, 0);
const interact = (bus: ReturnType<typeof testBus>, location: string, use: string, hero: [number, number], facing: HeroSpot['facing']): void =>
  bus.emit('world:interact', { location, use, id: use, key: `prop:${use}`, label: use, tile: [hero[0], hero[1] - 1], via: 'tap', facing, hero });
const stand = (bus: ReturnType<typeof testBus>, location: string, x: number, y: number, facing: HeroSpot['facing'] = 'down'): void => bus.emit('world:position', { location, x, y, facing });
const returns = (bus: ReturnType<typeof testBus>): BusEvents['world:return'][] => {
  const out: BusEvents['world:return'][] = [];
  bus.on('world:return', (s) => out.push(s));
  return out;
};

describe('модель: событие interact несёт клетку героя', () => {
  it('hero — клетка подхода, а не клетка объекта', () => {
    const m = modelAt('home', 'default');
    send(m, { type: 'interact', target: 'prop:desk' });
    const ev = run(m, 4000).find((e) => e.type === 'interact');
    expect(ev && ev.type === 'interact').toBe(true);
    if (ev?.type !== 'interact') return;
    expect(ev.hero).toEqual([m.player.tile[0], m.player.tile[1]]);
    expect(ev.hero).not.toEqual(ev.tile);
  });
});

describe('entryPoint: снимок места и возврат', () => {
  it('панельная игра: герой ушёл в Zagroda, на выходе возвращается к мачте с тем же лицом, позиция не пишется', () => {
    const bus = testBus();
    const e = createEntryPoint(bus);
    const got = returns(bus);
    const started: HeroSpot[] = [];
    e.onStart((s) => started.push(s));
    stand(bus, 'farm', 3, 3);
    interact(bus, 'farm', 'mast', [20, 8], 'up'); // этот же кадр: игра открывается раньше, чем придёт world:position
    expect(e.holding).toBe(false);
    bus.emit('polska:auto', { on: true, game: 'hymn', layout: 'panel', plot: 'pasieka' });
    bus.emit('farm:auto', { on: true, bottom: 300 });
    expect(e.holding).toBe(true);
    expect(started).toEqual([{ map: 'farm', x: 20, y: 8, facing: 'up' }]); // в сохранение пишется точка входа
    stand(bus, 'zagroda', 5, 12, 'left'); // автобег: промежуточная клетка не становится точкой возврата
    bus.emit('farm:auto', { on: true, bottom: 310 }); // повтор высоты панели точку не переснимает
    stand(bus, 'zagroda', 9, 14, 'right');
    expect(e.origin).toEqual({ map: 'farm', x: 20, y: 8, facing: 'up' });
    bus.emit('polska:auto', { on: false, game: 'hymn', layout: 'panel' });
    expect(got).toEqual([]); // ещё открыта: farm:auto не погас
    bus.emit('farm:auto', { on: false, bottom: 0 });
    expect(got).toEqual([{ map: 'farm', x: 20, y: 8, facing: 'up' }]);
    expect(e.holding).toBe(false);
    expect(e.origin).toBeNull();
  });

  it('v1: игра от доски, герой бегает по грядкам, выход возвращает к доске; следующая игра снимает новую точку', () => {
    const bus = testBus();
    const e = createEntryPoint(bus);
    const got = returns(bus);
    interact(bus, 'farm', 'board', [9, 7], 'up');
    bus.emit('farm:auto', { on: true, bottom: 280 });
    stand(bus, 'farm', 14, 12);
    bus.emit('farm:auto', { on: false, bottom: 0 });
    expect(got).toEqual([{ map: 'farm', x: 9, y: 7, facing: 'up' }]);
    stand(bus, 'farm', 9, 7, 'up'); // сцена записала возврат
    stand(bus, 'farm', 12, 5, 'left'); // вышел погулять
    bus.emit('farm:auto', { on: true, bottom: 280 });
    bus.emit('farm:auto', { on: false, bottom: 0 });
    expect(got[1]).toEqual({ map: 'farm', x: 12, y: 5, facing: 'left' });
  });

  it('«Graj tu» с доски: событий interact нет, точка — последняя стоянка героя', () => {
    const bus = testBus();
    createEntryPoint(bus);
    const got = returns(bus);
    stand(bus, 'farm', 9, 7, 'up'); // герой у доски (открыл её и нажал «Graj tu»)
    bus.emit('polska:auto', { on: true, game: 'daty', layout: 'full', plot: 'miesiace' });
    bus.emit('farm:auto', { on: true, bottom: 0 });
    bus.emit('polska:auto', { on: false, game: 'daty', layout: 'full' });
    bus.emit('farm:auto', { on: false, bottom: 0 });
    expect(got).toEqual([{ map: 'farm', x: 9, y: 7, facing: 'up' }]);
  });

  it('«Na pole!»: возврата нет, но точка ждёт; back() возвращает один раз; новая игра сбрасывает ожидание', () => {
    const bus = testBus();
    const e = createEntryPoint(bus);
    const got = returns(bus);
    const pend: (HeroSpot | null)[] = [];
    e.onPending((s) => pend.push(s));
    interact(bus, 'home', 'map', [6, 3], 'up');
    bus.emit('polska:auto', { on: true, game: 'geo', layout: 'full', plot: 'sad' });
    bus.emit('farm:auto', { on: true, bottom: 0 });
    bus.emit('polska:tour', { plot: 'sad', objs: ['sad_mazowieckie'], go: true });
    bus.emit('polska:auto', { on: false, game: 'geo', layout: 'full' });
    bus.emit('farm:auto', { on: false, bottom: 0 });
    expect(got).toEqual([]);
    expect(pend).toEqual([{ map: 'home', x: 6, y: 3, facing: 'up' }]);
    stand(bus, 'zagroda', 2, 15); // герой в саду; позиция снова сохраняется
    expect(e.holding).toBe(false);
    expect(e.back()).toBe(true);
    expect(got).toEqual([{ map: 'home', x: 6, y: 3, facing: 'up' }]);
    expect(e.back()).toBe(false);
    // второй заход: «Na pole!» без возврата, потом новая игра гасит ожидание
    interact(bus, 'home', 'calendar', [4, 3], 'up');
    bus.emit('farm:auto', { on: true, bottom: 0 });
    bus.emit('polska:tour', { plot: 'miesiace', objs: ['bed_5'], go: true });
    bus.emit('farm:auto', { on: false, bottom: 0 });
    expect(pend.at(-1)).toEqual({ map: 'home', x: 4, y: 3, facing: 'up' });
    stand(bus, 'zagroda', 3, 15);
    bus.emit('farm:auto', { on: true, bottom: 200 });
    expect(pend.at(-1)).toBeNull();
    expect(e.back()).toBe(false);
  });

  it('место неизвестно (чистый старт) — возврата нет, ничего не падает; sameSpot сравнивает карту и клетку, не лицо', () => {
    const bus = testBus();
    createEntryPoint(bus);
    const got = returns(bus);
    bus.emit('farm:auto', { on: true, bottom: 0 });
    bus.emit('farm:auto', { on: false, bottom: 0 });
    expect(got).toEqual([]);
    expect(sameSpot({ map: 'farm', x: 1, y: 2, facing: 'up' }, { map: 'farm', x: 1, y: 2, facing: 'down' })).toBe(true);
    expect(sameSpot({ map: 'farm', x: 1, y: 2, facing: 'up' }, { map: 'home', x: 1, y: 2, facing: 'up' })).toBe(false);
  });
});

// ── Кнопка «↩ Wróć · Назад» в итоге раунда и «Выйти» посреди раунда.

const Q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот' };
const ok: AnswerResult = { ok: true, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот', act: { kind: 'water', xp: 1 } };

describe('v1: «Wróć» и выход возвращают к доске', () => {
  const mk = () => {
    const bus = testBus();
    const e = createEntryPoint(bus);
    const got = returns(bus);
    const root = document.createElement('div');
    document.body.append(root);
    const g = mountMinigame(root, { bus, next: () => Q, answer: () => ok, say: () => {} });
    return { bus, e, got, root, g };
  };

  it('итог раунда: «Wróć» в фокусе первым, «Ещё раунд» рядом; нажатие выходит и возвращает', () => {
    vi.useFakeTimers();
    const { bus, got, root, g } = mk();
    interact(bus, 'farm', 'board', [9, 7], 'up');
    g.start(1);
    vi.advanceTimersByTime(50);
    for (let i = 0; i < 10; i++) {
      root.querySelector<HTMLElement>('[data-opt="кот"]')!.click();
      vi.advanceTimersByTime(NEXT_DELAY_MS + 1);
      root.querySelector<HTMLElement>('[data-next]')?.click();
      vi.advanceTimersByTime(1000);
      stand(bus, 'farm', 14, 12); // герой бежит по грядкам
    }
    const foot = root.querySelector('[data-foot]')!;
    const btns = [...foot.querySelectorAll<HTMLElement>('button')];
    expect(btns.map((b) => b.textContent)).toEqual(['↩ Wróć · Назад', 'Ещё раунд']);
    expect(btns[0]!.hasAttribute('data-back-entry')).toBe(true);
    expect(document.activeElement === btns[0] || btns[0]!.matches(':focus')).toBe(true);
    expect(got).toEqual([]);
    btns[0]!.click();
    expect(g.isOpen).toBe(false);
    expect(got).toEqual([{ map: 'farm', x: 9, y: 7, facing: 'up' }]);
  });

  it('«Выйти ✕» посреди раунда возвращает так же', () => {
    vi.useFakeTimers();
    const { bus, got, root, g } = mk();
    interact(bus, 'farm', 'board', [9, 7], 'up');
    g.start(1);
    vi.advanceTimersByTime(50);
    stand(bus, 'farm', 15, 12);
    root.querySelector<HTMLElement>('[data-exit]')!.click();
    expect(got).toEqual([{ map: 'farm', x: 9, y: 7, facing: 'up' }]);
  });
});

describe('v2: «Wróć», выход и «Na pole!»', () => {
  const mk = () => {
    let save: PolskaSave = newPolskaSave();
    const bus = testBus();
    const polska = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
    const root = document.createElement('div');
    document.body.append(root);
    const e = createEntryPoint(bus);
    const got = returns(bus);
    const ui = mountPolskaGame(root, { bus, games: GAMES, polska, now: () => NOW, rand: seeded(5), say: () => {} });
    return { bus, e, got, root, ui };
  };

  it('мачта (панель Hymn): выход «Выйти ✕» возвращает к мачте, пока герой в Zagroda', () => {
    const { bus, got, root, ui } = mk();
    interact(bus, 'farm', 'mast', [20, 8], 'up');
    ui.start('hymn');
    bus.emit('farm:auto', { on: true, bottom: 300 });
    stand(bus, 'zagroda', 8, 14, 'right');
    root.querySelector<HTMLElement>('[data-exit]')!.click();
    expect(got).toEqual([{ map: 'farm', x: 20, y: 8, facing: 'up' }]);
  });

  it('итог раунда Hymn: «Wróć» вместо «Закончить», в фокусе; клавиша действия первые 400 мс его не жмёт', () => {
    vi.useFakeTimers();
    const { bus, got, root, ui } = mk();
    interact(bus, 'farm', 'mast', [20, 8], 'up');
    ui.start('hymn');
    for (let i = 0; i < 10; i++) {
      ui.submit('zzz-неверно');
      vi.advanceTimersByTime(NEXT_DELAY_MS + 5);
      root.querySelector<HTMLElement>('[data-next]')?.click();
    }
    const back = root.querySelector<HTMLElement>('[data-foot] [data-back-entry]')!;
    expect(back.textContent).toBe('↩ Wróć · Назад');
    expect(root.querySelector('[data-foot] [data-more]')!.textContent).toBe('Ещё раунд');
    // A сразу после итога (мог быть «Dalej») ничего не делает
    const A = (): void => bus.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    A();
    A();
    expect(ui.isOpen).toBe(true);
    // по умолчанию в фокусе «Wróć»: первый A показал рамку на нём, но не нажал
    expect(back.classList.contains('is-focus')).toBe(true);
    vi.advanceTimersByTime(SUMMARY_GUARD_MS + 10);
    A();
    expect(ui.isOpen).toBe(false);
    expect(got).toEqual([{ map: 'farm', x: 20, y: 8, facing: 'up' }]);
  });

  it('карта во весь экран: герой на месте — возврат всё равно объявлен (сцена сама решит, что двигать нечего)', () => {
    const { bus, got, ui } = mk();
    interact(bus, 'home', 'map', [6, 3], 'up');
    ui.start('geo');
    ui.stop();
    expect(got).toEqual([{ map: 'home', x: 6, y: 3, facing: 'up' }]);
  });

  it('«Na pole!» после карты: возврата нет, точка ждёт, потом back() возвращает', () => {
    const { bus, e, got, ui } = mk();
    interact(bus, 'home', 'map', [6, 3], 'up');
    ui.start('geo');
    // движок шлёт polska:tour {go} из stop(true), когда за раунд что-то подросло; здесь событие то же
    bus.emit('polska:tour', { plot: 'sad', objs: ['sad_pomorskie'], go: true });
    ui.stop(true);
    expect(got).toEqual([]);
    expect(e.origin).toEqual({ map: 'home', x: 6, y: 3, facing: 'up' });
    expect(e.back()).toBe(true);
    expect(got).toEqual([{ map: 'home', x: 6, y: 3, facing: 'up' }]);
  });
});
