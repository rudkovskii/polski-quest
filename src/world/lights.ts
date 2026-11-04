// Где что светит: точки света и стёкла у спрайтов (координаты от низа-центра спрайта, в пикселях мира). Чисто.
import type { Daylight, Rgb } from '../systems/daylight';
import type { LocationMap, PropObject } from '../types/map';
import type { PointLight } from './lightmap';

const T = 16;
const LAMP: Rgb = [1, 0.74, 0.42];
const CANDLE: Rgb = [1, 0.62, 0.3];
const FIRE: Rgb = [1, 0.5, 0.22];

interface LightDef {
  dx: number;
  dy: number;
  r: number;
  color: Rgb;
  power: number;
  /** Светит и днём (огонь), а не только когда зажгли лампы. */
  always?: boolean;
}

/** Светящиеся спрайты. Новый предмет, который светит, — строка здесь. */
const SPRITE_LIGHTS: Readonly<Record<string, readonly LightDef[]>> = {
  house: [
    { dx: -23, dy: -6, r: 48, color: LAMP, power: 0.62 },
    { dx: 23, dy: -6, r: 48, color: LAMP, power: 0.62 },
    { dx: 0, dy: 8, r: 34, color: LAMP, power: 0.34 },
  ],
  v3_lantern: [{ dx: 0, dy: -18, r: 64, color: LAMP, power: 0.74 }],
  ks_lampa: [{ dx: 0, dy: -22, r: 68, color: LAMP, power: 0.72 }],
  ks_swieca: [{ dx: 0, dy: -8, r: 38, color: CANDLE, power: 0.55 }],
  ks_kominek: [{ dx: 0, dy: -6, r: 72, color: FIRE, power: 0.7, always: true }],
  w2_znicz: [{ dx: 0, dy: -5, r: 30, color: CANDLE, power: 0.62 }],
  w2_choinka: [{ dx: 0, dy: -10, r: 36, color: LAMP, power: 0.34 }],
};

/** Прямоугольники стекла в спрайте: вечером синие пиксели внутри загораются (x, y от левого верха кадра). */
export const SPRITE_GLASS: Readonly<Record<string, readonly [number, number, number, number][]>> = {
  house: [
    [12, 40, 11, 11],
    [58, 40, 11, 11],
  ],
};

export interface PropRef {
  /** Ключ спрайта в сцене: `prop:<id>`. */
  key: string;
  sprite: string;
  /** Низ-центр спрайта, пиксели мира. */
  x: number;
  y: number;
  /** Отбрасывает тень на землю: стоит на полу и не плоский. */
  cast: boolean;
}

/** Объекты карты с их точкой опоры (видимые: украшения по дате отсеивает `withDecor`). */
export function propRefs(map: LocationMap): PropRef[] {
  const out: PropRef[] = [];
  for (const o of map.objects) {
    if (o.type !== 'prop') continue;
    const p = o as PropObject;
    const [sw, sh] = p.size ?? [1, 1];
    out.push({ key: `prop:${p.id}`, sprite: p.sprite, x: (p.at[0] + sw / 2) * T, y: (p.at[1] + sh) * T - (p.dy ?? 0), cast: !p.depth && p.solid !== false });
  }
  return out;
}

/** Точки света на карте при этом свете. Днём горит только открытый огонь. `indoor`: своя лампа комнаты вечером. */
export function lightsOf(refs: readonly PropRef[], d: Daylight, indoor: { x: number; y: number } | null): PointLight[] {
  const out: PointLight[] = [];
  for (const r of refs) {
    for (const l of SPRITE_LIGHTS[r.sprite] ?? []) {
      const power = l.always ? l.power : l.power * d.lamps;
      if (power > 0.01) out.push({ x: r.x + l.dx, y: r.y + l.dy, r: l.r, color: l.color, power });
    }
  }
  if (indoor && d.lamps > 0.01) out.push({ x: indoor.x, y: indoor.y, r: 120, color: [1, 0.8, 0.56], power: 0.46 * d.lamps });
  return out;
}
