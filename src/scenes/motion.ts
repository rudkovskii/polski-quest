// «Уменьшить движение» в системе (prefers-reduced-motion, t39): растения не подпрыгивают и не дрожат, искр, капель и листиков
// нет, рост и плод появляются сразу. Смена кадров (стадия, урожай) и ходьба остаются: без них не видно, что произошло.

/** Спрашивается при каждом эффекте: настройку меняют, не перезагружая игру. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
