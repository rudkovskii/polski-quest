// @vitest-environment happy-dom
// P1a: d-pad с первого кадра на сенсорном устройстве и после перезагрузки; указатель первых шагов; подсказка стола не
// всплывает после закрытия словаря; подпись растения гаснет; профили `?dev=<id>`; версия и «Выкл» при mute в настройках.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from '../src/input/router';
import { GameStorage, parseProfile, profileDbName } from '../src/systems/platform/storage';
import { mountHints } from '../src/ui/hints';
import { GUIDE_TEXT, mountGuide, type GuideStage } from '../src/ui/hintsGuide';
import { mountSettings } from '../src/ui/settings';
import { LabelGate, PLANT_LABEL_MS } from '../src/world/labelGate';
import { testBus } from './helpers';

afterEach(() => vi.useRealTimers());

function fakeLs() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe('d-pad для новичка', () => {
  it('сенсорное устройство: виден с первого кадра, без касания', () => {
    const bus = testBus();
    const seen: boolean[] = [];
    bus.on('input:dpad', ({ visible }) => seen.push(visible));
    createRouter({ bus, coarse: true });
    expect(seen).toEqual([true]);
  });

  it('касание было в прошлый раз (флаг в сохранении): виден сразу после перезагрузки; первое касание пишет флаг', () => {
    const bus = testBus();
    expect(createRouter({ bus, coarse: false, touchSeen: true }).state.dpadVisible).toBe(true);
    const onTouch = vi.fn();
    const r = createRouter({ bus, coarse: false, onTouch });
    expect(r.state.dpadVisible).toBe(false);
    r.noteTouch();
    r.noteTouch();
    expect(onTouch).toHaveBeenCalledTimes(1);
    expect(r.state.dpadVisible).toBe(true);
  });
});

function guide(initial: GuideStage | null, log = 0) {
  const bus = testBus();
  const root = document.createElement('div');
  document.body.append(root);
  const flags: string[] = [];
  const goals: (string | null)[] = [];
  bus.on('guide:goal', ({ use }) => goals.push(use));
  const stage = (): GuideStage | null => {
    if (initial === 'desk' && !flags.includes('desk')) return 'desk';
    if (initial !== null && !flags.includes('board') && log === 0) return 'board';
    return null;
  };
  const g = mountGuide(root, { stage, done: (s) => flags.push(s) }, bus);
  const bubble = () => root.querySelector<HTMLElement>('[data-guide]')!;
  const arrow = () => root.querySelector<HTMLElement>('[data-guide-arrow]')!;
  return { bus, g, flags, goals, bubble, arrow };
}

describe('указатель первых шагов', () => {
  const at = { hero: { x: 100, y: 300 }, target: { x: 200, y: 120 }, via: 'door' as const };

  it('стол → доска → тишина: пузырь над героем, стрелка к цели, флаги в сохранение', () => {
    const { bus, g, flags, goals, bubble, arrow } = guide('desk');
    expect(goals).toEqual(['desk']);
    bus.emit('fx:guide', at);
    expect(bubble().hidden).toBe(false);
    expect(bubble().textContent).toBe(GUIDE_TEXT.desk);
    expect(arrow().hidden).toBe(false);
    // У самого стола свой пузырь не нужен (там подсказка стола и «A»).
    bus.emit('fx:near', { use: 'desk', id: 'desk', x: 1, y: 1 });
    expect(bubble().hidden).toBe(true);
    bus.emit('world:interact', { location: 'home', use: 'desk', id: 'desk', key: 'prop:desk', label: '', tile: [8, 3], via: 'tap', facing: 'up' });
    expect(flags).toEqual(['desk']);
    expect(g.stage).toBe('board');
    expect(goals).toEqual(['desk', 'board']);
    bus.emit('fx:near', null);
    bus.emit('fx:guide', at);
    expect(bubble().textContent).toBe(GUIDE_TEXT.board);
    bus.emit('farm:auto', { on: true, bottom: 200 });
    expect(flags).toEqual(['desk', 'board']);
    expect(g.stage).toBeNull();
    expect(goals.at(-1)).toBeNull();
    bus.emit('fx:guide', at);
    expect(bubble().hidden).toBe(true);
    expect(arrow().hidden).toBe(true);
  });

  it('экран открыт (fx:guide null) — прячется; прошедший первые шаги не видит ничего', () => {
    const a = guide('desk');
    a.bus.emit('fx:guide', at);
    a.bus.emit('fx:guide', null);
    expect(a.bubble().hidden).toBe(true);
    const b = guide(null);
    b.bus.emit('fx:guide', at);
    expect(b.bubble().hidden).toBe(true);
    expect(b.goals).toEqual([null]);
  });
});

describe('мелочи', () => {
  it('подсказка стола не всплывает после закрытия словаря: открытие помечает её показанной', () => {
    const bus = testBus();
    const root = document.createElement('div');
    const seen: string[] = [];
    mountHints(root, { seen: (u) => seen.includes(u), mark: (u) => seen.push(u) }, bus);
    bus.emit('world:interact', { location: 'home', use: 'desk', id: 'desk', key: 'prop:desk', label: '', tile: [8, 3], via: 'tap', facing: 'up' });
    bus.emit('fx:near', { use: 'desk', id: 'desk', x: 1, y: 1 });
    expect(root.querySelector<HTMLElement>('[data-hint]')!.hidden).toBe(true);
    expect(seen).toEqual(['desk']);
  });

  it('подпись растения у героя гаснет через пару секунд; задание мини-игры держится', () => {
    const g = new LabelGate();
    expect(g.show('p:kot', 0)).toBe(true);
    expect(g.show('p:kot', PLANT_LABEL_MS + 1)).toBe(false);
    expect(g.show('p:pies', PLANT_LABEL_MS + 2)).toBe(true);
    expect(g.show(null, 10_000)).toBe(false);
    expect(g.show('p:pies', 10_001)).toBe(true);
    expect(g.show('q:kot', 0, true)).toBe(true);
    expect(g.show('q:kot', 60_000, true)).toBe(true);
  });

  it('профиль ?dev=<id>: своя база и свои ключи localStorage', async () => {
    expect(parseProfile('t1')).toBe('t1');
    expect(parseProfile('Novice')).toBe('novice');
    expect(parseProfile('0')).toBeNull();
    expect(parseProfile('a b')).toBeNull();
    expect(parseProfile(null)).toBeNull();
    expect(profileDbName('t1')).toBe('polski-farm-t1');
    const ls = fakeLs();
    const a = new GameStorage({ idb: null, ls, profile: 't1', debounceMs: 0 });
    await a.load(1);
    a.update((s) => ({ ...s, hints: ['touch'] }), 2);
    await a.flush();
    expect([...ls.m.keys()]).toEqual(['polski-farm-t1:pq_save']);
    const main = new GameStorage({ idb: null, ls });
    expect((await main.load(3)).created).toBe(true);
    const again = new GameStorage({ idb: null, ls, profile: 't1' });
    expect((await again.load(4)).save.hints).toEqual(['touch']);
  });

  it('настройки: версия сборки, «Выкл» при ?mute=1', () => {
    const root = document.createElement('div');
    const setSound = vi.fn();
    const p = mountSettings(root, { bus: testBus(), muted: true, version: '0.2.0+abc1234', profile: 't1', getSound: () => true, setSound, exportSave: () => '', importSave: async () => ({ ok: true, message: '' }), reset: async () => {} });
    p.open();
    const btn = root.querySelector<HTMLButtonElement>('.pq-toggle')!;
    expect(btn.textContent).toBe('Выкл');
    btn.click();
    expect(setSound).not.toHaveBeenCalled();
    expect(root.querySelector('[data-version]')!.textContent).toContain('0.2.0+abc1234');
    expect(root.querySelector('[data-version]')!.textContent).toContain('t1');
  });
});

describe('HUD: уровень и путь к A1 (V11c)', () => {
  it('«Уровень 7/20», «до A1: 12%», A1 достигнут, тап открывает путь', async () => {
    const { mountHud, wordsRu } = await import('../src/ui/hud');
    const bus = testBus();
    const root = document.createElement('div');
    let taps = 0;
    mountHud(root, { bus, onSettings: () => {}, onLevel: () => taps++ });
    const next = () => root.querySelector('[data-xp-next]')!.textContent;
    const name = () => root.querySelector('[data-xp-level]')!.textContent;
    bus.emit('hud:xp', { level: 'Уровень 7', ratio: 0.2, sub: 7, of: 20, pct: 0.129, toNext: 12 });
    expect(name()).toBe('Уровень 7/20');
    expect(root.querySelector('[data-xp]')!.getAttribute('title')).toBe('До уровня 8: 12 оч.');
    expect(next()).toBe('до A1: 12%');
    bus.emit('hud:xp', { level: 'A1', ratio: 1, sub: 21, of: 20, pct: 1, toNext: null });
    expect(name()).toBe('A1');
    expect(next()).toBe('A1 достигнут');
    root.querySelector<HTMLElement>('[data-xp]')!.click();
    expect(taps).toBe(1);
    expect([wordsRu(2), wordsRu(11), wordsRu(22), wordsRu(105)]).toEqual(['слова', 'слов', 'слова', 'слов']);
  });
});
