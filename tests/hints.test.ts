// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectSfx, LEVEL_UP_NOTES, playLevelUp, SFX_GAIN } from '../src/systems/platform/sfx';
import { HINTS, mountHints } from '../src/ui/hints';
import { testBus } from './helpers';

afterEach(() => vi.useRealTimers());

function setup(seen: string[] = []) {
  const bus = testBus();
  const root = document.createElement('div');
  document.body.append(root);
  const marks: string[] = [];
  const off = mountHints(root, { seen: (u) => seen.includes(u), mark: (u) => (seen.push(u), marks.push(u)), hideAfterMs: 1000 }, bus);
  const node = () => root.querySelector<HTMLElement>('[data-hint]')!;
  return { bus, root, node, marks, off };
}

describe('пузыри-подсказки', () => {
  it('у стола, доски и коробки при первом подходе: польское название и русская подсказка, один раз', () => {
    const { bus, node, marks } = setup();
    expect(Object.keys(HINTS).sort()).toEqual(['board', 'bin', 'desk'].sort());
    bus.emit('fx:near', { use: 'desk', id: 'desk', x: 100, y: 50 });
    expect(node().hidden).toBe(false);
    expect(node().textContent).toBe('SłownikПосади слова');
    expect(node().style.left).toBe('100px');
    bus.emit('fx:near', null);
    expect(node().hidden).toBe(true);
    bus.emit('fx:near', { use: 'desk', id: 'desk', x: 100, y: 50 });
    expect(node().hidden).toBe(true); // второй раз не показывается
    bus.emit('fx:near', { use: 'board', id: 'board', x: 10, y: 10 });
    expect(node().textContent).toBe('TablicaВыбери мини-игру');
    bus.emit('fx:near', { use: 'bin', id: 'bin', x: 10, y: 10 });
    expect(node().textContent).toBe('SkrzynkaСюда урожай');
    expect(marks).toEqual(['desk', 'board', 'bin']);
  });

  it('уже показанные (флаг в сохранении) и прочие объекты молчат; пузырь гаснет по таймеру и при действии', () => {
    vi.useFakeTimers();
    const { bus, node } = setup(['desk']);
    bus.emit('fx:near', { use: 'desk', id: 'desk', x: 1, y: 1 });
    bus.emit('fx:near', { use: 'plant', id: 'w.kot', x: 1, y: 1 });
    bus.emit('fx:near', { use: 'bed', id: 'bed', x: 1, y: 1 });
    expect(node().hidden).toBe(true);
    bus.emit('fx:near', { use: 'bin', id: 'bin', x: 1, y: 1 });
    expect(node().hidden).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(node().hidden).toBe(true);
    bus.emit('fx:near', { use: 'board', id: 'board', x: 1, y: 1 });
    expect(node().hidden).toBe(false);
    bus.emit('world:input', { enabled: false });
    expect(node().hidden).toBe(true);
  });
});

function fakeCtx(state: AudioContextState = 'running') {
  const started: number[] = [];
  const ctx = {
    state,
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (n: unknown) => n }),
    createOscillator: () => {
      const o = { type: '', frequency: { setValueAtTime: (hz: number) => started.push(hz) }, connect: (n: unknown) => n, start: vi.fn(), stop: vi.fn() };
      return o;
    },
  };
  return { ctx: ctx as unknown as AudioContext, started };
}

describe('звук нового уровня', () => {
  it('синтез тонов без голоса и тихо', () => {
    const { ctx, started } = fakeCtx();
    playLevelUp(ctx);
    expect(started).toEqual([...LEVEL_UP_NOTES]);
    expect(SFX_GAIN).toBeLessThanOrEqual(0.08);
  });

  it('играет только на up, при включённом звуке и разбуженном контексте', () => {
    const bus = testBus();
    const a = fakeCtx();
    let on = true;
    connectSfx(bus, () => on, () => a.ctx);
    bus.emit('hud:xp', { level: 'A0', ratio: 0.3, gain: 1 });
    expect(a.started).toEqual([]);
    on = false;
    bus.emit('hud:xp', { level: 'A0.5', ratio: 0, up: true });
    expect(a.started).toEqual([]);
    on = true;
    bus.emit('hud:xp', { level: 'A0.5', ratio: 0, up: true });
    expect(a.started.length).toBe(LEVEL_UP_NOTES.length);
    const b = fakeCtx('suspended');
    const bus2 = testBus();
    connectSfx(bus2, () => true, () => b.ctx);
    bus2.emit('hud:xp', { level: 'A0.5', ratio: 0, up: true });
    expect(b.started).toEqual([]);
    const bus3 = testBus();
    connectSfx(bus3, () => true, () => null);
    expect(() => bus3.emit('hud:xp', { level: 'A0.5', ratio: 0, up: true })).not.toThrow();
  });
});
