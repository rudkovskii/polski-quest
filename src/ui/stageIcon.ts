// Иконки стадий для DOM (словарь): кадры 16×16 `icon_*` из атласа `public/atlas/custom.png`.
// Координаты берутся из `custom.json` (тест сверяет, что они не разъехались после `npm run sprites`).
import type { ItemInfo } from '../types/farm';
import { el } from './dom';

export const ATLAS_SIZE = { w: 256, h: 3200 } as const;
export type IconKey = 'icon_seed' | 'icon_sprout' | 'icon_bush' | 'icon_ripe' | 'icon_overripe';
export const ICON_FRAMES: Record<IconKey, readonly [number, number]> = {
  icon_seed: [199, 1851],
  icon_sprout: [217, 1851],
  icon_bush: [145, 1851],
  icon_ripe: [181, 1851],
  icon_overripe: [163, 1851],
};

export const STAGE_ICON_CSS = `
.pq-sico { display: inline-block; width: 32px; height: 32px; background-repeat: no-repeat; image-rendering: pixelated; vertical-align: middle; }
.pq-sico.dim { opacity: .55; }
`;

/** (кадры `icon_*` рисует арт, P1c) Какой кадр показывает элемент: семя, росток, куст; в банке (выращено) — урожай; перезрело — увядшее. null — ничего. */
export function iconKeyOf(i: Pick<ItemInfo, 'status' | 'stage'>): IconKey | null {
  if (i.status === 'new') return null;
  if (i.status === 'grown') return 'icon_ripe';
  switch (i.stage) {
    case 'seed':
      return 'icon_seed';
    case 'sprout':
      return 'icon_sprout';
    case 'bush':
      return 'icon_bush';
    case 'ripe':
      return 'icon_ripe';
    case 'overripe':
      return 'icon_overripe';
    default:
      return 'icon_seed'; // в мешке: посажено, ждёт грядку
  }
}

/** Иконка: кадр 16×16, показан ×2 (целый масштаб, пиксели не мылятся). `base` — `import.meta.env.BASE_URL`. */
export function stageIcon(key: IconKey, base = '/', dim = false): HTMLSpanElement {
  const [x, y] = ICON_FRAMES[key];
  return el('span', {
    class: dim ? 'pq-sico dim' : 'pq-sico',
    'data-icon': key,
    'aria-hidden': 'true',
    style: `background-image:url(${base}atlas/custom.png);background-position:-${x * 2}px -${y * 2}px;background-size:${ATLAS_SIZE.w * 2}px ${ATLAS_SIZE.h * 2}px`,
  });
}
