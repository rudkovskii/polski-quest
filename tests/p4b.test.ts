// @vitest-environment happy-dom
// P4b: звуки действий (не трогают AudioContext при mute), HUD цели дня, утренняя карточка раз в день.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { goalText, morningAction, recapBefore, wateredOn } from '../src/systems/daygoal';
import { createFarm } from '../src/systems/farm';
import { dayOf, newGarden, type GardenSave } from '../src/systems/garden';
import { connectSfx, playSfx, SFX_GAIN, SFX_RECIPES } from '../src/systems/platform/sfx';
import { mountHud } from '../src/ui/hud';
import { mountMorning } from '../src/ui/morning';
import { seeded, testBus } from './helpers';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function fakeCtx(state: AudioContextState = 'running') {
  const log = { osc: 0, noise: 0 };
  let time = 0;
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const chain = (n: unknown) => n;
  const ctx = {
    state,
    sampleRate: 8000,
    get currentTime() {
      return time;
    },
    destination: {},
    createGain: () => ({ gain: param(), connect: chain }),
    createOscillator: () => (log.osc++, { type: '', frequency: param(), connect: chain, start: vi.fn(), stop: vi.fn() }),
    createBiquadFilter: () => ({ type: '', frequency: param(), connect: chain }),
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    createBufferSource: () => (log.noise++, { buffer: null, connect: chain, start: vi.fn(), stop: vi.fn() }),
  };
  return { ctx: ctx as unknown as AudioContext, log, tick: (dt: number) => (time += dt) };
}

describe('звуки действий', () => {
  it('?mute=1: ничего не подключается, AudioContext не создаётся и не запрашивается', () => {
    const Ctor = vi.fn();
    vi.stubGlobal('AudioContext', Ctor);
    const bus = testBus();
    const ctxOf = vi.fn(() => null);
    const off = connectSfx(bus, () => true, ctxOf, { mute: true });
    bus.emit('fx:sfx', { name: 'plim' });
    bus.emit('farm:act', { kind: 'water', id: 'w.kot', label: 'kot', tile: null, xp: 1 });
    bus.emit('world:input', { enabled: false });
    bus.emit('hud:xp', { level: 'A0.1', ratio: 0, up: true });
    expect(ctxOf).not.toHaveBeenCalled();
    expect(Ctor).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
  });

  it('не создаёт свой контекст и без mute: нет разбуженного — молчит; звук выкл — молчит', () => {
    const Ctor = vi.fn();
    vi.stubGlobal('AudioContext', Ctor);
    const bus = testBus();
    const a = fakeCtx();
    let on = false;
    connectSfx(bus, () => on, () => a.ctx);
    bus.emit('fx:sfx', { name: 'water' });
    expect(a.log).toEqual({ osc: 0, noise: 0 });
    const b = fakeCtx('suspended');
    connectSfx(bus, () => true, () => b.ctx);
    bus.emit('fx:sfx', { name: 'water' });
    expect(b.log).toEqual({ osc: 0, noise: 0 });
    connectSfx(bus, () => true, () => null);
    expect(() => bus.emit('fx:sfx', { name: 'plim' })).not.toThrow();
    expect(Ctor).not.toHaveBeenCalled();
    on = true;
    bus.emit('fx:sfx', { name: 'plim' });
    expect(a.log.osc).toBeGreaterThan(0);
  });

  it('шина: ответ → «тик»/«бум», окно → открыть/закрыть, шаги не чаще порога', () => {
    const bus = testBus();
    const { ctx, log, tick } = fakeCtx();
    connectSfx(bus, () => true, () => ctx);
    bus.emit('farm:act', { kind: 'water', id: 'a', label: 'a', tile: null, xp: 1 });
    expect(log.osc).toBe(2); // верно: две ноты
    bus.emit('farm:act', { kind: 'water', id: 'a', label: 'a', tile: null, xp: 1 });
    expect(log.osc).toBe(2); // тот же момент: повтор слишком часто
    tick(1);
    log.osc = 0;
    bus.emit('farm:act', { kind: 'miss', id: 'a', label: 'a', tile: null, xp: 0 });
    expect(log.osc).toBe(1);
    log.osc = 0;
    bus.emit('world:input', { enabled: false });
    bus.emit('world:input', { enabled: false });
    expect(log.osc).toBe(1); // повтор сразу — слишком часто
    bus.emit('world:input', { enabled: true });
    expect(log.osc).toBe(2); // «закрыть» — другой звук
    tick(1);
    log.noise = 0;
    bus.emit('fx:sfx', { name: 'step_grass' });
    bus.emit('fx:sfx', { name: 'step_grass' });
    expect(log.noise).toBe(1);
    tick(0.2);
    bus.emit('fx:sfx', { name: 'step_grass' });
    expect(log.noise).toBe(2);
  });

  it('каждый рецепт играет и тихий; громкость 0 даёт тишину', () => {
    const { ctx, log } = fakeCtx();
    for (const name of Object.keys(SFX_RECIPES) as (keyof typeof SFX_RECIPES)[]) expect(playSfx(ctx, name)).toBe(true);
    expect(log.osc + log.noise).toBeGreaterThan(10);
    expect(SFX_GAIN).toBeLessThanOrEqual(0.08);
    for (const r of Object.values(SFX_RECIPES)) expect(r.len).toBeLessThan(0.5);
  });
});

describe('HUD: цель дня', () => {
  const log = (day: number, ok: boolean) => ({ day, ok });

  it('считает верные ответы за день и пишет «Сегодня: полито N · созреет завтра M»', () => {
    const l = [log(5, true), log(5, false), log(5, true), log(4, true)];
    expect(wateredOn(l, 5)).toBe(2);
    expect(wateredOn(l, 6)).toBe(0);
    expect(goalText({ watered: 8, tomorrow: 5 })).toBe('Сегодня: полито 8 · созреет завтра 5');
    expect(goalText({ watered: 0, tomorrow: 0 })).toBe('Сегодня: полито 0');
  });

  it('плашка обновляется на hud:xp по данным фермы и открывает итог по тапу', () => {
    const bus = testBus();
    let saved: GardenSave = newGarden();
    const now = Date.UTC(2026, 9, 17, 9, 0);
    const farm = createFarm({ bus, load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(3) });
    const root = document.createElement('div');
    document.body.append(root);
    let opened = 0;
    const day = () => dayOf(now, 0);
    mountHud(root, { bus, onSettings: () => {}, goal: () => ({ watered: wateredOn(farm.garden.log, day()), tomorrow: farm.ripeSoon().tomorrow }), onGoal: () => opened++ });
    const chip = () => root.querySelector<HTMLButtonElement>('[data-goal]')!;
    expect(chip().textContent).toBe('Сегодня: полито 0');
    farm.plant(['w.dzien_dobry']);
    const q = farm.next(1)!;
    farm.answer(q, q.answer); // hud:xp внутри ответа
    expect(chip().textContent).toBe('Сегодня: полито 1');
    farm.answer(farm.next(1)!, 'не то');
    expect(chip().textContent).toBe('Сегодня: полито 1');
    chip().click();
    expect(opened).toBe(1);
  });

  it('без поставщика цели плашки нет', () => {
    const root = document.createElement('div');
    mountHud(root, { bus: testBus(), onSettings: () => {} });
    expect(root.querySelector<HTMLElement>('[data-goal]')!.hidden).toBe(true);
  });
});

describe('утро', () => {
  it('итог прошлой игры: вчера или «в прошлый раз», выращено и полито', () => {
    const l = [log(3, true), log(3, true), log(3, false), log(5, true)];
    const grown = new Map([[3, 2]]);
    expect(recapBefore(l, grown, 4)).toEqual({ label: 'Вчера', day: 3, grown: 2, watered: 2 });
    expect(recapBefore(l, grown, 9)).toMatchObject({ label: 'В прошлый раз', day: 5, grown: 0, watered: 1 });
    expect(recapBefore(l, grown, 3)).toBeNull();
    expect(recapBefore([], grown, 3)).toBeNull();
    expect(morningAction(4, 4, recapBefore(l, grown, 4))).toBe('none');
    expect(morningAction(4, 3, recapBefore(l, grown, 4))).toBe('show');
    expect(morningAction(4, null, null)).toBe('mark');
  });
  const log = (day: number, ok: boolean) => ({ day, ok });

  function setup(seen: number | null, today = 10, recap: ReturnType<typeof recapBefore> = { label: 'Вчера', day: 9, grown: 3, watered: 12 }) {
    vi.useFakeTimers();
    const bus = testBus();
    const root = document.createElement('div');
    document.body.append(root);
    const state = { seen, today, marks: [] as number[] };
    const m = mountMorning(root, {
      bus,
      today: () => state.today,
      recap: () => recap,
      ripeToday: () => 4,
      seenDay: () => state.seen,
      mark: (d) => (state.marks.push(d), (state.seen = d)),
      delayMs: 10,
    });
    const card = () => root.querySelector<HTMLElement>('[data-morning]')!;
    const ready = () => (bus.emit('world:location', { id: 'farm', controls: 'walk' }), vi.advanceTimersByTime(20));
    return { bus, root, state, m, card, ready };
  }

  it('первый вход в новый день: карточка с итогами и «Na pole!», раз в день', () => {
    const s = setup(9);
    s.ready();
    expect(s.m.isOpen).toBe(true);
    expect(s.card().textContent).toContain('Вчера: выращено 3, полито 12');
    expect(s.card().textContent).toContain('Сегодня созреет: 4');
    expect(s.state.marks).toEqual([10]);
    s.card().querySelector<HTMLButtonElement>('[data-go]')!.click();
    expect(s.m.isOpen).toBe(false);
    vi.advanceTimersByTime(1000); // world:input true после закрытия: повторно не показывается
    expect(s.m.isOpen).toBe(false);
    s.m.check();
    expect(s.m.isOpen).toBe(false);
    expect(s.state.marks).toEqual([10]);
    // Завтра — снова.
    s.state.today = 11;
    s.m.check();
    expect(s.m.isOpen).toBe(true);
    expect(s.state.marks).toEqual([10, 11]);
  });

  it('тот же день (флаг в сохранении) и самый первый день: карточки нет', () => {
    const a = setup(10);
    a.ready();
    expect(a.m.isOpen).toBe(false);
    expect(a.state.marks).toEqual([]);
    document.body.replaceChildren();
    const b = setup(null, 10, null);
    b.ready();
    expect(b.m.isOpen).toBe(false);
    expect(b.state.marks).toEqual([10]); // новичок: день отмечен молча
  });

  it('ждёт, пока открыт экран, и показывается после его закрытия', () => {
    const s = setup(9);
    s.bus.emit('world:input', { enabled: false });
    s.ready();
    expect(s.m.isOpen).toBe(false);
    expect(s.state.marks).toEqual([]);
    s.bus.emit('world:input', { enabled: true });
    vi.advanceTimersByTime(500);
    expect(s.m.isOpen).toBe(true);
  });
});
