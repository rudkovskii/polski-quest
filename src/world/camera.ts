// Целочисленный масштаб камеры (ТЗ §2.4, §5.4). Канвас в RESIZE-режиме = CSS-пиксели, браузер
// растягивает его на devicePixelRatio (iPhone 3, Mac 2) без сглаживания: целый zoom в CSS-пикселях
// даёт целое число физических пикселей на игровой.

/** Минимум видимых игровых пикселей по короткой стороне (портрет iPhone 393 px → zoom 1, видно 393). */
export const MIN_VISIBLE = 300;
/** Маленькую карту растягиваем на экран, но не крупнее этого (иначе на Mac тайл с ладонь). */
export const MAX_FIT_ZOOM = 4;
/** Карте можно чуть вылезти за экран (обрезается край забора), если это даёт масштаб на ступень крупнее. */
export const FIT_SLACK = 1.05;

export function pickZoom(viewW: number, viewH: number, mapW: number, mapH: number): number {
  const base = Math.max(1, Math.floor(Math.min(viewW, viewH) / MIN_VISIBLE));
  const fit = Math.floor(Math.min(viewW / mapW, viewH / mapH) * FIT_SLACK);
  return Math.max(base, Math.min(fit, MAX_FIT_ZOOM));
}
