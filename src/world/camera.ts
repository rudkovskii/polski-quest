// Целочисленный масштаб камеры. Канвас в RESIZE-режиме = CSS-пиксели, браузер
// растягивает его на devicePixelRatio (iPhone 3, Mac 2) без сглаживания: целый zoom в CSS-пикселях
// даёт целое число физических пикселей на игровой.
//
// На телефоне в кадре 9–11 клеток в ширину: база — сколько клеток видно по
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
