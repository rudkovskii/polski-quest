// Формат ASCII-карты (content/maps/*.json). Слои ground и deco — строки символов легенды; объекты — список.
import type { Dir } from './input';

export type Xy = readonly [number, number];

export interface LegendEntry {
  /** Имя тайла в тайлсете (public/atlas/farm.json). */
  tile: string;
  /** Клетка непроходима. */
  solid?: boolean;
  /** Символ из слоя ground уходит в deco (под ним defaultGround). */
  layer?: 'deco';
  /** Автотайл: кадр по соседям того же символа. */
  auto?: boolean;
}

export interface ExitObject {
  type: 'exit';
  at: [number, number];
  /** id карты, куда ведёт шаг в эту клетку. */
  to: string;
  /** Имя спавна на той карте. */
  spawn: string;
}

/**
 * Спрайт на карте. Низ-центр спрайта стоит на нижней кромке прямоугольника `size`, начиная с `at`.
 * Коллизия: `collide` (прямоугольники [dx, dy, w, h] от `at`) или весь `size`; `solid: false` — проходим.
 * `use` делает объект интерактивным: кнопка A или тап шлют `world:interact` (контракт в AGENTS.md).
 */
export interface PropObject {
  type: 'prop';
  id: string;
  sprite: string;
  at: [number, number];
  size?: [number, number];
  collide?: [number, number, number, number][];
  solid?: boolean;
  use?: string;
  label?: string;
  /**
   * Сторона «лица» интерактивного объекта: тап ведёт героя на клетку с этой стороны (по умолчанию `down`, вид 3/4).
   * Занято или недостижимо — ближайшая клетка с другой стороны.
   */
  face?: Dir;
  /** Свои клетки подхода (абсолютные, по порядку), если правило `face` не подходит. */
  approach?: [number, number][];
  /** Ширина мягкой тени под объектом, px; нет — без тени. */
  shadow?: number;
  /** `floor`: рисуется под всеми (ковёр); `wall`: на стене (окно); по умолчанию сортируется по низу. */
  depth?: 'floor' | 'wall';
  /** Украшение к дате (`id` из `swieta.json:decor`): объект стоит на карте, только пока украшение активно (`systems/decor.ts`). */
  decor?: string;
  /** Пристройка, которая появляется по событию (хатка и пруд бобра: `beaver.home`): стоит, только пока ключ в наборе `active` у `withDecor`. */
  unlock?: string;
  /** Сдвиг глубины вверх, px (гирлянда на фасаде рисуется поверх дома). */
  z?: number;
  /** Подъём спрайта над низом клетки, px (писанки на столе). */
  dy?: number;
}

/** Участок под грядки (F-03): `size` — рабочая часть, `reserve` — запас на расширение. */
export interface PlotObject {
  type: 'plot';
  id: string;
  at: [number, number];
  size: [number, number];
  reserve?: { at: [number, number]; size: [number, number] };
}

/** Именованная точка (место сна кота). */
export interface SpotObject {
  type: 'spot';
  id: string;
  at: [number, number];
}

export type MapObject = ExitObject | PropObject | PlotObject | SpotObject;

export interface LocationMap {
  id: string;
  name: string;
  size: [number, number];
  defaultGround: string;
  legend: Record<string, LegendEntry>;
  layers: { ground: string[]; deco?: string[] };
  /** Имя → [x, y, куда смотрит герой]. */
  spawns: Record<string, [number, number] | [number, number, Dir]>;
  objects: MapObject[];
}
