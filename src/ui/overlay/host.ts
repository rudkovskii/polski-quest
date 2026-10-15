// Хост DOM-оверлея (ТЗ §5, I-08): стопка модальных слоёв поверх мира. Пока открыт хоть один слой,
// мир получает `world:input { enabled: false }` (ходьба выключена, роутер шлёт intents в ui, d-pad
// скрыт); последний закрытый слой возвращает `enabled: true`. Intents `to: 'ui'` получает верхний слой.
import type { Dir } from '../../input';
import { bus as globalBus, type Bus } from '../../systems/bus';
import type { BusEvents } from '../../types/bus';
import { el } from '../dom';
import { activate, moveFocus } from './nav';
import { ensureOverlayStyle } from './style';

/** Обработчики intents слоя. Вернуть true = обработано, иначе поведение по умолчанию. */
export interface IntentHandler {
  move?(dir: Dir): boolean | void;
  interact?(): boolean | void;
  cancel?(): boolean | void;
}

export interface Layer {
  readonly el: HTMLElement;
  /** Сменить обработчики intents (шаг урока меняет их на каждом шаге). */
  handle(h: IntentHandler | null): void;
  readonly closed: boolean;
  close(): void;
}

export interface Overlay {
  open(cls?: string): Layer;
  /** Открытых слоёв. */
  readonly depth: number;
  dispose(): void;
}

export interface OverlayOptions {
  bus?: Bus<BusEvents>;
}

export function createOverlay(root: HTMLElement, opts: OverlayOptions = {}): Overlay {
  const bus = opts.bus ?? globalBus;
  ensureOverlayStyle(root.ownerDocument);
  const stack: (Layer & { h: IntentHandler | null })[] = [];

  const offIntent = bus.on('input:intent', (i) => {
    if (i.to !== 'ui') return;
    const top = stack[stack.length - 1];
    if (!top) return;
    const h = top.h;
    switch (i.type) {
      case 'move':
        if (!i.held) return;
        if (h?.move?.(i.dir) !== true) moveFocus(top.el, i.dir);
        return;
      case 'interact':
        if (h?.interact?.() !== true) activate(top.el);
        return;
      case 'cancel':
        // B/Esc закрывает любое окно (P-02, исследование §6в п. 8): слой без своего обработчика закрывается
        // кнопкой «✕» (`data-act="close"`). Тап мимо окна (source pointer) так не закрывает: промах пальцем
        // не должен обрывать урок.
        if (h?.cancel?.() !== true && i.source !== 'pointer') top.el.querySelector<HTMLElement>('[data-act="close"]')?.click();
        return;
      case 'hotkey': {
        // Цифра — вариант ответа с этим номером (W-04: на Mac 1–3 выбирают ответ, как тап).
        const opts = [...top.el.querySelectorAll<HTMLButtonElement>('[data-opt]')].filter((b) => !b.hidden && !b.closest('[hidden]'));
        const b = opts[i.n - 1];
        if (b && !b.disabled) b.click();
        return;
      }
      default:
        return;
    }
  });

  const overlay: Overlay = {
    open(cls) {
      const node = el('div', { class: `pq-layer${cls ? ` ${cls}` : ''}`, role: 'dialog', 'aria-modal': 'true' });
      root.append(node);
      if (stack.length === 0) bus.emit('world:input', { enabled: false });
      // Нижние слои не ловят фокус Tab и тапы, пока сверху другой.
      stack[stack.length - 1]?.el.setAttribute('inert', '');
      let closed = false;
      const layer = {
        el: node,
        h: null as IntentHandler | null,
        handle(h: IntentHandler | null) {
          layer.h = h;
        },
        get closed() {
          return closed;
        },
        close() {
          if (closed) return;
          closed = true;
          node.remove();
          const i = stack.indexOf(layer);
          if (i >= 0) stack.splice(i, 1);
          stack[stack.length - 1]?.el.removeAttribute('inert');
          if (stack.length === 0) bus.emit('world:input', { enabled: true });
        },
      };
      stack.push(layer);
      return layer;
    },
    get depth() {
      return stack.length;
    },
    dispose() {
      offIntent();
      for (const l of [...stack].reverse()) l.close();
    },
  };
  return overlay;
}
