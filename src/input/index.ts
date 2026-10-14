// Сборка системы ввода: роутер + три источника. Вызывается из склейки (main.ts, dev-страница).
// Порядок: сначала смонтировать d-pad (src/ui/dpad.ts), он слушает `input:dpad`, потом startInput.
import { createDpadSource, type DpadElements } from './dpad';
import { createKeyboardSource } from './keyboard';
import { createPointerSource, type PointerSourceOptions } from './pointer';
import { createRouter, type Router, type RouterOptions } from './router';

export interface StartInputOptions extends RouterOptions {
  dpad?: DpadElements;
  /** Элемент карты (canvas) и колбэк клетки; без него PointerSource не создаётся. */
  pointer?: { target: HTMLElement } & PointerSourceOptions;
  keyboardTarget?: Window | Document | HTMLElement;
}

export interface InputSystem {
  router: Router;
  dispose(): void;
}

export function startInput(opts: StartInputOptions = {}): InputSystem {
  const router = createRouter(opts);
  const sources = [createKeyboardSource(router, opts.keyboardTarget)];
  if (opts.dpad) sources.push(createDpadSource(router, opts.dpad));
  if (opts.pointer) sources.push(createPointerSource(router, opts.pointer.target, opts.pointer));
  return {
    router,
    dispose() {
      for (const s of sources) s.dispose();
      router.dispose();
    },
  };
}

export type { DpadElements } from './dpad';
export type { TileHit } from './pointer';
export type { Router } from './router';
export type * from './types';
