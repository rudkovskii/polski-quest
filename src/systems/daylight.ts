// Время суток по реальным часам игрока: сколько света в мире, куда падают тени, горят ли лампы. Чисто: час приходит параметром.
// Полдень — нейтральный (ровно цвета арта). Ночь не глушит картинку ниже `MIN_AMBIENT`: растение и табличка читаются в любой час.

export type Rgb = readonly [number, number, number];

export interface Daylight {
  /** Умножение цвета мира, 0–1 по каналам. */
  ambient: Rgb;
  /** Сила тени от солнца, 0–1. */
  shadow: number;
  /** Куда падает тень по X: +1 вправо (утро), −1 влево (вечер). */
  shadowX: number;
  /** Длина тени относительно высоты предмета. */
  shadowLen: number;
  /** Лампы и окна горят, 0–1. */
  lamps: number;
  /** Глубина ночи, 0–1: светлячки вместо бабочек. */
  night: number;
}

interface Key extends Daylight {
  h: number;
}

const k = (h: number, ambient: Rgb, shadow: number, shadowX: number, shadowLen: number, lamps: number, night: number): Key => ({ h, ambient, shadow, shadowX, shadowLen, lamps, night });

/** Ключевые часы (Польша, средний день года); между ними плавно. Сезон не учитываем: игрок после работы не должен видеть только ночь. */
const KEYS: readonly Key[] = [
  k(0, [0.47, 0.53, 0.76], 0.1, 0, 0.3, 1, 1),
  k(5, [0.5, 0.54, 0.76], 0.1, 0.4, 0.3, 1, 1),
  k(6.5, [0.86, 0.72, 0.74], 0.3, 1, 0.8, 0.5, 0.2),
  k(8, [1, 0.94, 0.84], 0.42, 0.85, 0.62, 0, 0),
  k(12, [1, 1, 1], 0.42, 0.25, 0.42, 0, 0),
  k(16, [1, 0.97, 0.9], 0.42, -0.5, 0.56, 0, 0),
  k(18.5, [0.97, 0.79, 0.64], 0.42, -1, 0.8, 0.45, 0.1),
  k(20, [0.74, 0.6, 0.72], 0.26, -1, 0.7, 0.9, 0.6),
  k(21.5, [0.5, 0.54, 0.77], 0.12, -0.4, 0.4, 1, 1),
  k(24, [0.47, 0.53, 0.76], 0.1, 0, 0.3, 1, 1),
];

export const MIN_AMBIENT = 0.47;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Свет снаружи в час `hour` (дробный, 0–24; лишнее заворачивается). */
export function daylight(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= h) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = (h - a.h) / (b.h - a.h);
  return {
    ambient: [mix(a.ambient[0], b.ambient[0], t), mix(a.ambient[1], b.ambient[1], t), mix(a.ambient[2], b.ambient[2], t)],
    shadow: mix(a.shadow, b.shadow, t),
    shadowX: mix(a.shadowX, b.shadowX, t),
    shadowLen: mix(a.shadowLen, b.shadowLen, t),
    lamps: mix(a.lamps, b.lamps, t),
    night: mix(a.night, b.night, t),
  };
}

/** Свет в доме: день из окон приглушён, ночью своя тёплая темнота (лампа добавляется в `world/lights.ts`). */
export function indoorLight(d: Daylight): Daylight {
  const [r, g, b] = d.ambient;
  return { ...d, ambient: [mix(0.62, 0.34 + r * 0.6, 0.9), mix(0.54, 0.34 + g * 0.58, 0.9), mix(0.58, 0.34 + b * 0.54, 0.9)], shadow: 0.34, shadowX: 0.35, shadowLen: 0.3 };
}

/** Заметно ли сменился свет (иначе не пересобираем карту света). */
export function lightChanged(a: Daylight, b: Daylight): boolean {
  const d = Math.abs(a.ambient[0] - b.ambient[0]) + Math.abs(a.ambient[1] - b.ambient[1]) + Math.abs(a.ambient[2] - b.ambient[2]);
  return d > 0.012 || Math.abs(a.lamps - b.lamps) > 0.03 || Math.abs(a.shadowX - b.shadowX) > 0.06;
}
