// @vitest-environment happy-dom
// Система ввода: клавиатура, d-pad, тап → один поток intents.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDpadSource, dirFromOffset } from '../src/input/dpad';
import { createKeyboardSource } from '../src/input/keyboard';
import { createPointerSource } from '../src/input/pointer';
import { createRouter, type Router, type RouterOptions } from '../src/input/router';
import type { RoutedIntent } from '../src/input/types';
import { createBus, type Bus } from '../src/systems/bus';
import type { BusEvents } from '../src/types/bus';
import { scan } from '../tools/check_banned';
import { checkFile } from '../tools/check_layers';

let bus: Bus<BusEvents>;
let got: RoutedIntent[];
let cleanups: (() => void)[];

beforeEach(() => {
  document.body.innerHTML = '';
  bus = createBus<BusEvents>();
  got = [];
  cleanups = [];
  bus.on('input:intent', (i) => got.push(i));
});
afterEach(() => {
  for (const c of cleanups) c();
});

function router(opts: RouterOptions = {}): Router {
  const r = createRouter({ bus, coarse: false, ...opts });
  cleanups.push(() => r.dispose());
  return r;
}

/** Intents без служебных полей для сравнения. */
const plain = (list = got): unknown[] => list.map(({ to, source, ...rest }) => ({ ...rest, to, source }));

function key(type: 'keydown' | 'keyup', code: string, target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

function ptr(target: Element, type: string, init: PointerEventInit = {}): PointerEvent {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'touch', pointerId: 1, ...init });
  target.dispatchEvent(e);
  return e;
}

function keyboard(r: Router): void {
  const s = createKeyboardSource(r, document);
  cleanups.push(() => s.dispose());
}

function dpad(r: Router): { cross: HTMLElement; a: HTMLElement; b: HTMLElement } {
  const els = { cross: document.createElement('div'), a: document.createElement('div'), b: document.createElement('div') };
  document.body.append(els.cross, els.a, els.b);
  const s = createDpadSource(r, els);
  cleanups.push(() => s.dispose());
  return els;
}

describe('KeyboardSource', () => {
  it('читает e.code, а не e.key: W в русской раскладке = вверх', () => {
    keyboard(router());
    const e = key('keydown', 'KeyW', document.body, { key: 'ц' });
    expect(plain()).toEqual([{ type: 'move', dir: 'up', held: true, to: 'world', source: 'keyboard' }]);
    expect(e.defaultPrevented).toBe(true);
  });

  it('стрелки и WASD, удержание до keyup, автоповтор игнорируется', () => {
    keyboard(router());
    key('keydown', 'ArrowRight');
    key('keydown', 'ArrowRight', document.body, { repeat: true });
    key('keydown', 'ArrowRight', document.body, { repeat: true });
    key('keyup', 'ArrowRight');
    key('keydown', 'KeyA');
    key('keyup', 'KeyA');
    expect(got.map((i) => (i.type === 'move' ? `${i.dir}:${i.held}` : i.type))).toEqual([
      'right:true',
      'right:false',
      'left:true',
      'left:false',
    ]);
  });

  it('↑ и W вместе: одно удержание, стоп только когда отпущены обе', () => {
    keyboard(router());
    key('keydown', 'ArrowUp');
    key('keydown', 'KeyW');
    key('keyup', 'ArrowUp');
    expect(got).toHaveLength(1);
    key('keyup', 'KeyW');
    expect(got.map((i) => i.type === 'move' && i.held)).toEqual([true, false]);
  });

  it('Space, Enter, E → interact; Esc → cancel', () => {
    keyboard(router());
    for (const code of ['Space', 'Enter', 'KeyE']) key('keydown', code);
    key('keydown', 'Escape');
    expect(got.map((i) => i.type)).toEqual(['interact', 'interact', 'interact', 'cancel']);
  });

  it('Cmd/Ctrl/Alt-сочетания не трогаем', () => {
    keyboard(router());
    const e = key('keydown', 'KeyA', document.body, { altKey: true });
    key('keydown', 'KeyR', document.body, { metaKey: true });
    expect(got).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it('фокус в поле ввода глушит WASD и пробел для мира: буквы печатаются', () => {
    keyboard(router());
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const w = key('keydown', 'KeyW', input);
    const sp = key('keydown', 'Space', input);
    key('keydown', 'ArrowLeft', input);
    expect(got).toEqual([]);
    expect(w.defaultPrevented).toBe(false);
    expect(sp.defaultPrevented).toBe(false);
  });

  it('держал W и перешёл в поле: ходьба останавливается', () => {
    keyboard(router());
    key('keydown', 'KeyW');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(got.map((i) => i.type === 'move' && i.held)).toEqual([true, false]);
    key('keyup', 'KeyW', input);
    expect(got).toHaveLength(2);
  });

  it('диагональ (↑ и → вместе): идёт по последней нажатой оси, отпустил её — по первой', () => {
    const r = router();
    keyboard(r);
    key('keydown', 'ArrowUp');
    key('keydown', 'ArrowRight');
    expect(r.state.heldDir).toBe('right');
    key('keyup', 'ArrowRight');
    expect(r.state.heldDir).toBe('up');
    key('keydown', 'KeyA');
    expect(r.state.heldDir).toBe('left');
    key('keyup', 'KeyA');
    key('keyup', 'ArrowUp');
    expect(r.state.heldDir).toBeNull();
    expect(got.map((i) => (i.type === 'move' ? `${i.dir}:${i.held}` : i.type))).toEqual(['up:true', 'right:true', 'up:true', 'left:true', 'up:true', 'up:false']);
  });

  it('вкладку свернули с зажатой стрелкой: удержание снимается', () => {
    const r = router();
    keyboard(r);
    key('keydown', 'ArrowLeft');
    const vis = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState') ?? Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      if (vis) Object.defineProperty(document, 'visibilityState', vis);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    }
    expect(r.state.heldDir).toBeNull();
    expect(got.map((i) => (i.type === 'move' ? `${i.dir}:${i.held}` : i.type))).toEqual(['left:true', 'left:false']);
  });
});

describe('DpadSource', () => {
  it('диагональ отбрасывается по большей оси, центр — мёртвая зона', () => {
    expect(dirFromOffset(30, -10, 60)).toBe('right');
    expect(dirFromOffset(-5, 40, 60)).toBe('down');
    expect(dirFromOffset(-40, -39, 60)).toBe('left');
    expect(dirFromOffset(3, 3, 60)).toBeNull();
  });

  it('удержание креста = движение, скольжение пальцем меняет направление', () => {
    const { cross } = dpad(router({ coarse: true }));
    ptr(cross, 'pointerdown', { clientX: 0, clientY: -40 });
    ptr(cross, 'pointermove', { clientX: 40, clientY: -5 });
    ptr(cross, 'pointerup', { clientX: 40, clientY: -5 });
    expect(got.map((i) => (i.type === 'move' ? `${i.dir}:${i.held}` : i.type))).toEqual(['up:true', 'right:true', 'right:false']);
    expect(got.every((i) => i.source === 'dpad')).toBe(true);
  });

  it('мультитач: крест и «A» одновременно, «B» = cancel', () => {
    const { cross, a, b } = dpad(router({ coarse: true }));
    ptr(cross, 'pointerdown', { pointerId: 1, clientX: -40, clientY: 0 });
    ptr(a, 'pointerdown', { pointerId: 2, isPrimary: false });
    ptr(a, 'pointerup', { pointerId: 2, isPrimary: false });
    ptr(b, 'pointerdown', { pointerId: 3, isPrimary: false });
    ptr(cross, 'pointerup', { pointerId: 1, clientX: -40, clientY: 0 });
    expect(got.map((i) => (i.type === 'move' ? `${i.dir}:${i.held}` : i.type))).toEqual(['left:true', 'interact', 'cancel', 'left:false']);
  });
});

describe('PointerSource', () => {
  const setup = (r: Router): HTMLElement => {
    const canvas = document.createElement('div');
    document.body.append(canvas);
    const s = createPointerSource(r, canvas, {
      tileAt: (x, y) => {
        const tile: [number, number] = [Math.floor(x / 16), Math.floor(y / 16)];
        if (tile[0] > 9) return null;
        return tile[0] === 3 && tile[1] === 3 ? { tile, target: 'npc.zosia' } : { tile };
      },
    });
    cleanups.push(() => s.dispose());
    return canvas;
  };

  it('тап по клетке → goto, тап по объекту → interact с target', () => {
    const c = setup(router());
    ptr(c, 'pointerdown', { clientX: 40, clientY: 20 });
    ptr(c, 'pointerup', { clientX: 42, clientY: 21 });
    ptr(c, 'pointerdown', { clientX: 50, clientY: 50 });
    ptr(c, 'pointerup', { clientX: 50, clientY: 50 });
    expect(plain()).toEqual([
      { type: 'goto', tile: [2, 1], to: 'world', source: 'pointer' },
      { type: 'interact', target: 'npc.zosia', to: 'world', source: 'pointer' },
    ]);
  });

  it('протяжка пальцем — не тап', () => {
    const c = setup(router());
    ptr(c, 'pointerdown', { clientX: 10, clientY: 10 });
    ptr(c, 'pointerup', { clientX: 80, clientY: 10 });
    expect(got).toEqual([]);
  });
});

describe('Router', () => {
  it('последний источник выигрывает: d-pad поверх клавиатуры, отпустил — снова клавиатура', () => {
    const r = router();
    keyboard(r);
    const { cross } = dpad(r);
    key('keydown', 'ArrowRight');
    ptr(cross, 'pointerdown', { clientX: 0, clientY: -40 });
    expect(r.state.heldDir).toBe('up');
    ptr(cross, 'pointerup', { clientX: 0, clientY: -40 });
    expect(r.state.heldDir).toBe('right');
    key('keyup', 'ArrowRight');
    expect(got.map((i) => `${i.source}:${i.type === 'move' ? `${i.dir}:${i.held}` : i.type}`)).toEqual([
      'keyboard:right:true',
      'dpad:up:true',
      'keyboard:right:true',
      'keyboard:right:false',
    ]);
  });

  it('новый goto отменяет удержание; поздний keyup ничего не шлёт', () => {
    const r = router();
    keyboard(r);
    key('keydown', 'KeyD');
    r.push('pointer', { type: 'goto', tile: [5, 5] });
    key('keyup', 'KeyD');
    expect(got.map((i) => (i.type === 'move' ? `${i.dir}:${i.held}` : i.type))).toEqual(['right:true', 'right:false', 'goto']);
    expect(r.state.heldDir).toBeNull();
  });

  it('controls: tap отключает move: d-pad молчит, стрелки и Tab переключают объект', () => {
    const r = router({ mapControls: 'tap', coarse: true });
    keyboard(r);
    const { cross } = dpad(r);
    ptr(cross, 'pointerdown', { clientX: 40, clientY: 0 });
    ptr(cross, 'pointerup', { clientX: 40, clientY: 0 });
    key('keydown', 'ArrowRight');
    key('keyup', 'ArrowRight');
    const tab = key('keydown', 'Tab');
    key('keydown', 'Tab', document.body, { shiftKey: true });
    key('keydown', 'Enter');
    r.push('pointer', { type: 'goto', tile: [1, 1] });
    expect(got.some((i) => i.type === 'move')).toBe(false);
    expect(got.map((i) => (i.type === 'focus' ? `focus:${i.dir}` : i.type))).toEqual([
      'focus:right',
      'focus:next',
      'focus:prev',
      'interact',
      'goto',
    ]);
    expect(tab.defaultPrevented).toBe(true);
  });

  it('в режиме walk Tab остаётся браузеру', () => {
    keyboard(router());
    const tab = key('keydown', 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(got).toEqual([]);
  });

  it('оверлей открыт: удержание в мире снимается, intents идут в ui, тап по карте = cancel', () => {
    const r = router();
    keyboard(r);
    key('keydown', 'ArrowUp');
    bus.emit('world:input', { enabled: false });
    key('keyup', 'ArrowUp');
    key('keydown', 'ArrowDown');
    key('keydown', 'Enter');
    r.push('pointer', { type: 'goto', tile: [1, 1] });
    bus.emit('world:input', { enabled: true });
    key('keydown', 'KeyE');
    expect(got.map((i) => `${i.to}:${i.type}${i.type === 'move' ? `:${i.dir}:${i.held}` : ''}`)).toEqual([
      'world:move:up:true',
      'world:move:up:false',
      'ui:move:down:true',
      'ui:interact',
      'ui:cancel',
      'world:interact',
    ]);
  });

  it('d-pad: на телефоне виден сразу, прячется после клавиатуры, возвращается от касания', () => {
    const seen: boolean[] = [];
    bus.on('input:dpad', ({ visible }) => seen.push(visible));
    const r = router({ coarse: true });
    keyboard(r);
    expect(r.state.dpadVisible).toBe(true);
    key('keydown', 'KeyE');
    expect(r.state.dpadVisible).toBe(false);
    r.push('pointer', { type: 'goto', tile: [0, 0] });
    expect(r.state.dpadVisible).toBe(true);
    expect(seen).toEqual([true, false, true]);
  });

  it('d-pad: на Mac скрыт, пока не было касания; never/always; tap-локация и оверлей прячут', () => {
    const r = router({ coarse: false });
    expect(r.state.dpadVisible).toBe(false);
    r.push('pointer', { type: 'goto', tile: [0, 0] }); // клик мышью
    expect(r.state.dpadVisible).toBe(false);
    r.noteTouch();
    expect(r.state.dpadVisible).toBe(true);
    r.setControls({ dpad: 'never' });
    expect(r.state.dpadVisible).toBe(false);
    r.setControls({ dpad: 'always' });
    r.push('keyboard', { type: 'interact' });
    expect(r.state.dpadVisible).toBe(true);
    r.setMapControls('tap');
    expect(r.state.dpadVisible).toBe(false);
    r.setMapControls('walk');
    r.setFocus('ui');
    expect(r.state.dpadVisible).toBe(false);
  });

  it('сторона d-pad приходит в событии', () => {
    const sides: string[] = [];
    bus.on('input:dpad', ({ side }) => sides.push(side));
    const r = router({ coarse: true });
    r.setControls({ dpadSide: 'right' });
    expect(sides).toEqual(['left', 'right']);
  });

  it('input:source сообщает о смене источника', () => {
    const sources: string[] = [];
    bus.on('input:source', ({ source }) => sources.push(source));
    const r = router();
    r.push('keyboard', { type: 'interact' });
    r.push('keyboard', { type: 'cancel' });
    r.push('dpad', { type: 'interact' });
    expect(sources).toEqual(['keyboard', 'dpad']);
  });
});

describe('слои ввода', () => {
  it('src/input не импортирует сцены, экраны и phaser', () => {
    expect(checkFile('src/input/router.ts', "import { el } from '../ui/dom';")).toHaveLength(1);
    expect(checkFile('src/input/router.ts', "import { Title } from '../scenes/Title';")).toHaveLength(1);
    expect(checkFile('src/input/router.ts', "import Phaser from 'phaser';")).toHaveLength(1);
    expect(checkFile('src/input/router.ts', "import { bus } from '../systems/bus';")).toHaveLength(0);
    expect(checkFile('src/systems/x.ts', "import { createRouter } from '../input';")).toHaveLength(1);
  });

  it('сцены и экраны не слушают keydown/pointerdown напрямую', () => {
    expect(scan('src/scenes/Location.ts', "this.input.keyboard?.on('keydown-W', f)")).toHaveLength(1);
    expect(scan('src/scenes/Location.ts', "sprite.on('pointerdown', f)")).toHaveLength(1);
    expect(scan('src/ui/screens/x.ts', "window.addEventListener('keydown', f)")).toHaveLength(1);
    expect(scan('src/ui/x.ts', 'el("button", { onpointerdown: f })')).toHaveLength(1);
    expect(scan('src/ui/keyboard/attach.ts', "field.addEventListener('keydown', f)")).toHaveLength(0);
    expect(scan('src/input/keyboard.ts', "target.addEventListener('keydown', f)")).toHaveLength(0);
  });
});
