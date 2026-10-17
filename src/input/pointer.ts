// PointerSource: тап по карте → `goto` клетки или `interact` с объектом.
// Единственное место, где слушают pointerdown на canvas. Что под пальцем, решает сцена
// через колбэк `tileAt` (экранные координаты элемента → клетка и id объекта).
import type { Router } from './router';

export interface TileHit {
  tile: [number, number];
  /** id объекта в клетке (NPC, слово, табличка): тап = interact, мир сам подходит к нему. */
  target?: string;
}

export interface PointerSourceOptions {
  /** x, y — CSS-пиксели относительно левого верхнего угла элемента. null = мимо карты. */
  tileAt(x: number, y: number): TileHit | null;
  /** Сдвиг пальца, после которого это уже не тап (CSS px). */
  slop?: number;
  /** Дольше этого — не тап (мс). */
  maxMs?: number;
}

export interface PointerSource {
  dispose(): void;
}

export function createPointerSource(router: Router, target: HTMLElement, opts: PointerSourceOptions): PointerSource {
  const slop = opts.slop ?? 12;
  const maxMs = opts.maxMs ?? 600;
  let start: { id: number; x: number; y: number; t: number } | null = null;

  const onDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (e.pointerType === 'touch') router.noteTouch();
    if (!e.isPrimary || e.button > 0) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
  };

  const onUp = (ev: Event): void => {
    const e = ev as PointerEvent;
    const s = start;
    if (!s || e.pointerId !== s.id) return;
    start = null;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > slop) return;
    if (e.timeStamp - s.t > maxMs) return;
    const r = target.getBoundingClientRect();
    const hit = opts.tileAt(e.clientX - r.left, e.clientY - r.top);
    if (!hit) router.push('pointer', { type: 'cancel' });
    else if (hit.target) router.push('pointer', { type: 'interact', target: hit.target });
    else router.push('pointer', { type: 'goto', tile: hit.tile });
  };

  const onCancel = (): void => {
    start = null;
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onCancel);
  return {
    dispose() {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    },
  };
}
