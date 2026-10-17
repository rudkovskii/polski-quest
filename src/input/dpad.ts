// DpadSource: экранный крест и кнопки «A»/«B» → сырые intents.
// Вёрстка и стили — src/ui/dpad.ts; здесь только pointer events на готовых элементах.
// Каждый элемент ведёт свой pointerId, поэтому крест и «A» работают одновременно (мультитач).
import type { Router } from './router';
import type { Dir } from './types';

export interface DpadElements {
  cross: HTMLElement;
  a: HTMLElement;
  b: HTMLElement;
}

export interface DpadSource {
  dispose(): void;
}

/** Мёртвая зона в центре креста, доля от половины размера. */
const DEAD_ZONE = 0.18;

/** Направление по точке относительно центра креста: диагональ отбрасывается по большей оси. */
export function dirFromOffset(dx: number, dy: number, half: number): Dir | null {
  if (Math.hypot(dx, dy) < half * DEAD_ZONE) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export function createDpadSource(router: Router, els: DpadElements): DpadSource {
  let crossPointer: number | null = null;
  let crossDir: Dir | null = null;
  const offs: (() => void)[] = [];

  const listen = (node: HTMLElement, type: string, fn: (e: PointerEvent) => void): void => {
    const h = (e: Event): void => fn(e as PointerEvent);
    node.addEventListener(type, h);
    offs.push(() => node.removeEventListener(type, h));
  };

  const setDir = (dir: Dir | null): void => {
    if (dir === crossDir) return;
    const prev = crossDir;
    crossDir = dir;
    // Сначала новое удержание, потом снятие старого: роутер не даст «стоп» между ними.
    if (dir) router.push('dpad', { type: 'move', dir, held: true });
    if (prev) router.push('dpad', { type: 'move', dir: prev, held: false });
    if (dir) els.cross.dataset.dir = dir;
    else delete els.cross.dataset.dir;
  };

  const dirAt = (e: PointerEvent): Dir | null => {
    const r = els.cross.getBoundingClientRect();
    const half = Math.max(r.width, r.height) / 2 || 60;
    return dirFromOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), half);
  };

  const touch = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') router.noteTouch();
  };

  listen(els.cross, 'pointerdown', (e) => {
    e.preventDefault();
    touch(e);
    if (crossPointer !== null) return; // второй палец на кресте не считается
    crossPointer = e.pointerId;
    try {
      els.cross.setPointerCapture(e.pointerId);
    } catch {
      // нет захвата (старый браузер, тест): работаем без него
    }
    setDir(dirAt(e));
  });
  listen(els.cross, 'pointermove', (e) => {
    if (e.pointerId !== crossPointer) return;
    setDir(dirAt(e));
  });
  const endCross = (e: PointerEvent): void => {
    if (e.pointerId !== crossPointer) return;
    crossPointer = null;
    setDir(null);
  };
  listen(els.cross, 'pointerup', endCross);
  listen(els.cross, 'pointercancel', endCross);
  listen(els.cross, 'lostpointercapture', endCross);

  const button = (node: HTMLElement, press: () => void): void => {
    let id: number | null = null;
    listen(node, 'pointerdown', (e) => {
      e.preventDefault();
      touch(e);
      if (id !== null) return;
      id = e.pointerId;
      node.dataset.pressed = '';
      press();
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = null;
      delete node.dataset.pressed;
    };
    listen(node, 'pointerup', up);
    listen(node, 'pointercancel', up);
    listen(node, 'pointerleave', up);
  };
  button(els.a, () => router.push('dpad', { type: 'interact' }));
  button(els.b, () => router.push('dpad', { type: 'cancel' }));

  // Долгий тап на iOS не должен открывать меню и выделение.
  for (const node of [els.cross, els.a, els.b]) {
    const h = (e: Event): void => e.preventDefault();
    node.addEventListener('contextmenu', h);
    offs.push(() => node.removeEventListener('contextmenu', h));
  }

  return {
    dispose() {
      setDir(null);
      for (const off of offs) off();
    },
  };
}
