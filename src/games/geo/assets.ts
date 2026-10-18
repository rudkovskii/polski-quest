// Картинки Geografia: карта `maps-art/poland.png` и атлас `atlas/custom.png` (кадры `geo_*`). Кадры берутся из `custom.json`
// (он импортируется, поэтому сдвиг атласа после `npm run sprites` подхватывается сам), картинки грузятся один раз.
import atlasJson from '../../../public/atlas/custom.json';

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FRAMES = (atlasJson as unknown as { frames: Record<string, { frame: Frame }> }).frames;

/** Кадр атласа `geo_dot/3` → прямоугольник на `custom.png`. */
export function frameOf(name: string, i: number): Frame | null {
  return FRAMES[`${name}/${i}`]?.frame ?? null;
}

/** Анимации из `art/sprites/geo_*.sprite.json` (в атлас не попадают, поэтому здесь): номера кадров. */
export const ANIMS = {
  hero: { walk_down: [1, 0, 2, 0], walk_up: [4, 3, 5, 3], walk_right: [7, 6, 8, 6], walk_left: [10, 9, 11, 9], kick_right: [12, 13, 12], kick_left: [14, 15, 14] },
  cat: { walk: [0, 1], sit: [2] },
  dot: { gray: 0, green: 1, gold: 2, pinGray: 3, pinGreen: 4, pinGold: 5, ping: [6, 7] },
  flag: { wobble_red: [0, 1, 0, 2], wobble_green: [3, 4, 3, 5], plant: [7, 8, 9], fall: 6, red: 0, green: 3 },
} as const;

export interface Assets {
  map: HTMLImageElement;
  atlas: HTMLImageElement;
}

let loading: Promise<Assets | null> | null = null;
let loaded: Assets | null = null;

const url = (p: string): string => `${import.meta.env.BASE_URL}${p}`;

function img(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(`не загрузилось ${src}`));
    i.src = src;
  });
}

/** Уже загруженные картинки (синхронно), null — ещё грузятся. */
export const assetsNow = (): Assets | null => loaded;

/** Загрузить картинки (один раз). Нет `Image` (тесты без DOM) или ошибка загрузки — null. */
export function loadAssets(): Promise<Assets | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  loading ??= Promise.all([img(url('maps-art/poland.png')), img(url('atlas/custom.png'))])
    .then(([map, atlas]) => (loaded = { map, atlas }))
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}
