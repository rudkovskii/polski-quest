// Вёрстка d-pad: крест 120 px слева внизу, «A» справа внизу, «B» мелкая рядом с «A».
// Отступ = safe-area + 16 px; сторона креста — `controls.dpadSide`. Видимость решает роутер
// (событие `input:dpad`). Нажатия обрабатывает src/input/dpad.ts: здесь слушателей ввода нет.
// Под «A» и над «B» мелкие подписи «A · действие», «B · назад» (флаг `labels`).
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';

const css = `
.pq-dpad { position: fixed; inset: 0; pointer-events: none; z-index: 20; }
.pq-dpad[hidden] { display: none; }
.pq-dpad > * { pointer-events: auto; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.pq-dpad-cross { position: absolute; width: 120px; height: 120px; bottom: calc(env(safe-area-inset-bottom) + 16px); left: calc(env(safe-area-inset-left) + 16px); }
.pq-dpad-cross .arm { position: absolute; width: 40px; height: 40px; background: #333c57; border: 3px solid #566c86; box-sizing: border-box; }
.pq-dpad-cross .arm.up { left: 40px; top: 0; border-radius: 6px 6px 0 0; border-bottom: 0; }
.pq-dpad-cross .arm.down { left: 40px; bottom: 0; border-radius: 0 0 6px 6px; border-top: 0; }
.pq-dpad-cross .arm.left { left: 0; top: 40px; border-radius: 6px 0 0 6px; border-right: 0; }
.pq-dpad-cross .arm.right { right: 0; top: 40px; border-radius: 0 6px 6px 0; border-left: 0; }
.pq-dpad-cross .hub { position: absolute; left: 40px; top: 40px; width: 40px; height: 40px; background: #333c57; }
.pq-dpad-cross .arm::after { content: ''; position: absolute; left: 50%; top: 50%; width: 0; height: 0; border: 7px solid transparent; transform: translate(-50%, -50%); }
.pq-dpad-cross .arm.up::after { border-bottom-color: #94b0c2; margin-top: -4px; }
.pq-dpad-cross .arm.down::after { border-top-color: #94b0c2; margin-top: 4px; }
.pq-dpad-cross .arm.left::after { border-right-color: #94b0c2; margin-left: -4px; }
.pq-dpad-cross .arm.right::after { border-left-color: #94b0c2; margin-left: 4px; }
.pq-dpad-cross[data-dir=up] .arm.up, .pq-dpad-cross[data-dir=down] .arm.down,
.pq-dpad-cross[data-dir=left] .arm.left, .pq-dpad-cross[data-dir=right] .arm.right { background: #3b5dc9; }
.pq-dpad-btn { position: absolute; display: flex; align-items: center; justify-content: center; border-radius: 50%; font: 700 22px/1 -apple-system, BlinkMacSystemFont, sans-serif; color: #f4f4f4; box-sizing: border-box; }
.pq-dpad-a { width: 72px; height: 72px; right: calc(env(safe-area-inset-right) + 16px); bottom: calc(env(safe-area-inset-bottom) + 40px); background: #b13e53; border: 3px solid #ef7d57; box-shadow: 0 4px 0 #5d275d; }
.pq-dpad-b { width: 46px; height: 46px; font-size: 16px; right: calc(env(safe-area-inset-right) + 100px); bottom: calc(env(safe-area-inset-bottom) + 16px); background: #29366f; border: 3px solid #566c86; box-shadow: 0 3px 0 #1a1c2c; }
.pq-dpad-btn[data-pressed] { transform: translateY(3px); box-shadow: none; filter: brightness(1.2); }
.pq-dpad-cap { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; pointer-events: none; font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; color: #f4f4f4; text-shadow: 0 1px 0 #1a1c2c, 0 0 3px #1a1c2c; }
.pq-dpad-a .pq-dpad-cap { top: calc(100% + 6px); }
.pq-dpad-b .pq-dpad-cap { bottom: calc(100% + 6px); }
.pq-dpad:not([data-labels]) .pq-dpad-cap { display: none; }
.pq-dpad[data-side=right] .pq-dpad-cross { left: auto; right: calc(env(safe-area-inset-right) + 16px); }
.pq-dpad[data-side=right] .pq-dpad-a { right: auto; left: calc(env(safe-area-inset-left) + 16px); }
.pq-dpad[data-side=right] .pq-dpad-b { right: auto; left: calc(env(safe-area-inset-left) + 100px); }
`;

export interface DpadView {
  root: HTMLElement;
  cross: HTMLElement;
  a: HTMLElement;
  b: HTMLElement;
  dispose(): void;
}

export interface DpadOptions {
  /** Показывать подписи под кнопками (проверяется при каждом показе d-pad). По умолчанию да. */
  labels?: () => boolean;
}

export function mountDpad(parent: HTMLElement, bus: Bus<BusEvents> = globalBus, opts: DpadOptions = {}): DpadView {
  const arms = (['up', 'down', 'left', 'right'] as const).map((d) => el('div', { class: `arm ${d}` }));
  const cross = el('div', { class: 'pq-dpad-cross', role: 'group', 'aria-label': 'Крестик управления' }, el('div', { class: 'hub' }), ...arms);
  const a = el('div', { class: 'pq-dpad-btn pq-dpad-a', role: 'button', 'aria-label': 'A: действие' }, 'A', el('span', { class: 'pq-dpad-cap', 'aria-hidden': 'true' }, 'A · действие'));
  const b = el('div', { class: 'pq-dpad-btn pq-dpad-b', role: 'button', 'aria-label': 'B: назад' }, 'B', el('span', { class: 'pq-dpad-cap', 'aria-hidden': 'true' }, 'B · назад'));
  const root = el('div', { class: 'pq-dpad', hidden: true, 'data-side': 'left', 'data-labels': '' }, el('style', {}, css), cross, a, b);
  parent.append(root);
  // Флаг спрашиваем при показе, не при монтировании: прогресс к этому моменту ещё грузится.
  const labels = (): void => {
    if (opts.labels?.() ?? true) root.dataset.labels = '';
    else delete root.dataset.labels;
  };
  const off = bus.on('input:dpad', ({ visible, side }) => {
    root.hidden = !visible;
    root.dataset.side = side;
    if (visible) labels();
  });
  return {
    root,
    cross,
    a,
    b,
    dispose() {
      off();
      root.remove();
    },
  };
}
