// Пиксельная иконка из атласа `public/atlas/custom.png` для DOM (вместо эмодзи): любой кадр по имени `<лист>/<n>`
// и мини-предметы огорода по имени (`bread`, `fish`… из `content/plants/icons.json`). Координаты — из `custom.json` (импортируется,
// поэтому после `npm run sprites` подхватываются сами), размер атласа — `ATLAS_SIZE` (его сверяет тест `farmui`).
import atlasJson from '../../public/atlas/custom.json';
import iconsJson from '../../content/plants/icons.json';
import { el } from './dom';
import { ATLAS_SIZE } from './stageIcon';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FRAMES = (atlasJson as unknown as { frames: Record<string, { frame: Rect }> }).frames;
const ICONS = (iconsJson as unknown as { icons: Record<string, { sheet: string; frame: number }> }).icons;

const base = (): string => {
  try {
    return import.meta.env.BASE_URL ?? '/';
  } catch {
    return '/';
  }
};

/** Прямоугольник кадра атласа или null. */
export const atlasFrame = (frame: string): Rect | null => FRAMES[frame]?.frame ?? null;

/** Кадр мини-предмета огорода по имени иконки (`bread` → `plant_icons_food_1/0`). */
export const plantIconFrame = (name: string): string | null => {
  const m = ICONS[name];
  return m ? `${m.sheet}/${m.frame}` : null;
};

/** `<span>` с кадром атласа, целый масштаб (пиксели не мылятся). Нет кадра — null. */
export function atlasIcon(frame: string, scale = 2, cls = 'pq-aico'): HTMLSpanElement | null {
  const f = atlasFrame(frame);
  if (!f) return null;
  return el('span', {
    class: cls,
    'data-frame': frame,
    'aria-hidden': 'true',
    style: `display:inline-block;flex:0 0 auto;width:${f.w * scale}px;height:${f.h * scale}px;background-image:url(${base()}atlas/custom.png);background-repeat:no-repeat;image-rendering:pixelated;background-position:-${f.x * scale}px -${f.y * scale}px;background-size:${ATLAS_SIZE.w * scale}px ${ATLAS_SIZE.h * scale}px`,
  });
}
