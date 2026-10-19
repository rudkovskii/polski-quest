// KeyboardSource: физическая клавиатура → сырые intents в роутер.
// Читаем `e.code`, а не `e.key`: раскладка (русская, польская) не важна.
import type { Router } from './router';
import type { Dir, Intent } from './types';

const MOVE: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const INTERACT = new Set(['Space', 'Enter', 'NumpadEnter', 'KeyE']);

/** Поле, куда печатают: там клавиатура принадлежит полю, а не миру (WASD печатает буквы). */
export function isTextTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).tagName !== 'string') return false;
  const node = t as HTMLElement;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = ((node as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
  }
  return node.isContentEditable === true || node.getAttribute('contenteditable') === 'true';
}

export interface KeyboardSource {
  dispose(): void;
}

/** Слушает keydown/keyup на `target` (по умолчанию window). Прямой keydown разрешён только в src/input и src/ui/keyboard. */
export function createKeyboardSource(router: Router, target: Window | Document | HTMLElement = window): KeyboardSource {
  /** Зажатые коды движения; по направлению — сколько кодов его держат (↑ и W вместе). */
  const heldCodes = new Map<string, Dir>();
  const dirCount = new Map<Dir, number>();

  const pressDir = (dir: Dir): boolean => {
    const n = dirCount.get(dir) ?? 0;
    dirCount.set(dir, n + 1);
    return n === 0 ? router.push('keyboard', { type: 'move', dir, held: true }) : true;
  };

  const releaseCode = (code: string): void => {
    const dir = heldCodes.get(code);
    if (!dir) return;
    heldCodes.delete(code);
    const n = (dirCount.get(dir) ?? 1) - 1;
    if (n > 0) {
      dirCount.set(dir, n);
      return;
    }
    dirCount.delete(dir);
    router.push('keyboard', { type: 'move', dir, held: false });
  };

  const onKeyDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    // Cmd/Ctrl — системные сочетания; Alt/Option — польские буквы (src/ui/keyboard).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const code = e.code;
    if (isTextTarget(e.target)) {
      // В поле ввода мир не получает ничего: WASD, пробел и E печатаются, Enter ловит поле.
      if (code === 'Escape' && !e.repeat) router.push('keyboard', { type: 'cancel' });
      return;
    }
    const dir = MOVE[code];
    let consumed = false;
    if (dir) {
      if (e.repeat || heldCodes.has(code)) {
        consumed = true; // автоповтор браузера: удержание уже идёт
      } else {
        heldCodes.set(code, dir);
        consumed = pressDir(dir);
      }
    } else if (e.repeat) {
      consumed = INTERACT.has(code) || code === 'Escape';
    } else {
      let intent: Intent | null = null;
      if (INTERACT.has(code)) intent = { type: 'interact' };
      else if (code === 'Escape') intent = { type: 'cancel' };
      else if (code === 'KeyG') intent = { type: 'say' };
      else if (code === 'Tab') intent = { type: 'focus', dir: e.shiftKey ? 'prev' : 'next' };
      else if (/^(Digit|Numpad)[1-9]$/.test(code) && !e.shiftKey) intent = { type: 'hotkey', n: Number(code.slice(-1)) };
      if (intent) consumed = router.push('keyboard', intent);
    }
    if (consumed) e.preventDefault();
  };

  const onKeyUp = (ev: Event): void => {
    // keyup снимает удержание всегда, даже если фокус успел уйти в поле.
    releaseCode((ev as KeyboardEvent).code);
  };

  const releaseAll = (): void => {
    for (const code of [...heldCodes.keys()]) releaseCode(code);
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  // Потеря фокуса окна: keyup не придёт, отпускаем сами.
  const win = typeof window !== 'undefined' ? window : null;
  win?.addEventListener('blur', releaseAll);
  // Фокус ушёл в поле ввода, пока держали W: перестаём идти.
  const onFocusIn = (e: Event): void => {
    if (isTextTarget(e.target)) releaseAll();
  };
  target.addEventListener('focusin', onFocusIn);
  // Вкладку свернули с зажатой стрелкой: blur приходит не всегда (iOS, Cmd+Tab в полноэкранном), отпускаем сами.
  const doc = typeof document !== 'undefined' ? document : null;
  const onVisibility = (): void => {
    if (doc?.visibilityState === 'hidden') releaseAll();
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    dispose() {
      releaseAll();
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('focusin', onFocusIn);
      win?.removeEventListener('blur', releaseAll);
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
