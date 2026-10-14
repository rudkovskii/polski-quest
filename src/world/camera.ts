// Целочисленный масштаб камеры (ТЗ §2.4, §5.4). Канвас в RESIZE-режиме = CSS-пиксели, браузер
// растягивает его на devicePixelRatio (iPhone 3, Mac 2) без сглаживания: целый zoom в CSS-пикселях
// даёт целое число физических пикселей на игровой.
//
// P-02 (исследование §3.2 «на телефоне в кадре 9–11 клеток в ширину»): база — сколько клеток видно по
// короткой стороне экрана, а не сколько пикселей. iPhone портрет 375–430 px → zoom 2 (≈12 клеток),
// Mac 800×600 → 3, большой экран → 4. Маленькую карту, которая влезает целиком, можно растянуть сильнее.

/** Размер клетки в игровых пикселях. */
export const TILE = 16;
/** Минимум клеток по короткой стороне экрана: меньше — карта «в замочную скважину». */
export const MIN_TILES_SHORT = 11;
/** Крупнее этого не растягиваем (иначе на Mac тайл с ладонь). */
export const MAX_ZOOM = 4;
/** Карте можно чуть вылезти за экран (обрезается край забора), если это даёт масштаб на ступень крупнее. */
export const FIT_SLACK = 1.05;

export function pickZoom(viewW: number, viewH: number, mapW: number, mapH: number): number {
  const base = Math.min(MAX_ZOOM, Math.max(1, Math.floor(Math.min(viewW, viewH) / (MIN_TILES_SHORT * TILE))));
  const fit = Math.floor(Math.min(viewW / mapW, viewH / mapH) * FIT_SLACK);
  return Math.max(base, Math.min(fit, MAX_ZOOM));
}

/** Прямоугольник на экране, CSS-пиксели канваса. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Цель под колонкой кнопок HUD справа (P-12, хатка Казика под «Obchód / Paszport / ⚙»): на сколько сдвинуть
 * картинку, чтобы цель вышла из-под колонки. Колонка — край видимой зоны, как d-pad снизу (P-10a).
 * Возвращает сдвиг содержимого в CSS-пикселях: `dx < 0` — влево, `dy > 0` — вниз; [0, 0] — цель не под колонкой.
 * Из двух вариантов (вниз под колонку или влево от неё) — тот, что короче и не уводит цель за край или под d-pad.
 */
export function hudDodge(goal: ScreenRect, hud: ScreenRect | null, view: { width: number; height: number; bottom: number }, margin = 6): [number, number] {
  if (!hud) return [0, 0];
  const hit = goal.right > hud.left - margin && goal.left < hud.right + margin && goal.bottom > hud.top - margin && goal.top < hud.bottom + margin;
  if (!hit) return [0, 0];
  const down = hud.bottom + margin - goal.top;
  const left = goal.right - (hud.left - margin);
  const downOk = goal.bottom + down <= view.height - view.bottom;
  const leftOk = goal.left - left >= 0;
  if (downOk && (!leftOk || down <= left)) return [0, down];
  if (leftOk) return [-left, 0];
  return [0, Math.max(0, Math.min(down, view.height - view.bottom - goal.bottom))];
}
