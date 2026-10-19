// Карты мира: JSON из content/maps/ бандлится в код. Проверка формы — tests/maps.test.ts.
import farm from '../../content/maps/farm.json';
import home from '../../content/maps/home.json';
import zagroda from '../../content/maps/zagroda.json';
import type { Dir } from '../types/input';
import type { LocationMap } from '../types/map';
import { parseAscii } from './ascii';
import { buildObjects } from './location';

export const MAPS: Readonly<Record<string, LocationMap>> = {
  farm: farm as unknown as LocationMap,
  home: home as unknown as LocationMap,
  // v2: новая локация к востоку от фермы (калитка, переход шагом): сад, пасека, огород месяцев, клумба.
  zagroda: zagroda as unknown as LocationMap,
};

/**
 * Куда идти к объекту с `use` (кнопка «Idź», v2): на этой карте — `prop:<id>` (`here`), иначе первая дверь кратчайшего маршрута
 * по выходам карт. null — такого объекта нет ни на одной карте.
 */
export function routeTo(from: string, use: string, maps: Readonly<Record<string, LocationMap>> = MAPS): { key: string; here: boolean; map: string } | null {
  const propOf = (m: LocationMap): string | null => {
    const o = m.objects.find((x) => x.type === 'prop' && x.use === use);
    return o && o.type === 'prop' ? `prop:${o.id}` : null;
  };
  const start = maps[from];
  if (!start) return null;
  const here = propOf(start);
  if (here) return { key: here, here: true, map: from };
  // Обход в ширину: карта → (первая дверь с исходной карты).
  const seen = new Set([from]);
  let wave: { map: string; door: string }[] = [];
  for (const o of start.objects) if (o.type === 'exit' && !seen.has(o.to)) wave.push({ map: o.to, door: `exit:${o.at[0]},${o.at[1]}` });
  while (wave.length) {
    const next: typeof wave = [];
    for (const w of wave) {
      if (seen.has(w.map)) continue;
      seen.add(w.map);
      const m = maps[w.map];
      if (!m) continue;
      if (propOf(m)) return { key: w.door, here: false, map: w.map };
      for (const o of m.objects) if (o.type === 'exit' && !seen.has(o.to)) next.push({ map: o.to, door: w.door });
    }
    wave = next;
  }
  return null;
}

/**
 * Карта с украшениями на сегодня: объекты с `decor` остаются, только если украшение в `active` (`systems/decor.ts`); объекты с
 * `unlock` (хатка и пруд бобра) — только если в `active` их ключ (`beaver.home`, ставит main.ts, когда бобёр поселился).
 */
export function withDecor(m: LocationMap, active: ReadonlySet<string>): LocationMap {
  if (!m.objects.some((o) => o.type === 'prop' && (o.decor || o.unlock))) return m;
  return { ...m, objects: m.objects.filter((o) => o.type !== 'prop' || ((!o.decor || active.has(o.decor)) && (!o.unlock || active.has(o.unlock)))) };
}

/** Где игра стартует с чистого сохранения. */
export const START = { map: 'farm', spawn: 'start' } as const;

export function getMap(id: string): LocationMap {
  const m = MAPS[id];
  if (!m) throw new Error(`Нет карты "${id}"`);
  return m;
}

export interface Spawn {
  tile: [number, number];
  facing: Dir;
}

/**
 * Где поставить героя: имя спавна или клетка (сохранение). Клетка непроходима, занята объектом или за краем — спавн карты
 * по умолчанию. `facing` перекрывает поворот из карты.
 */
export function resolveSpawn(map: LocationMap, spawn: string | readonly number[] | undefined, facing?: Dir): Spawn {
  const named = (name: string): Spawn => {
    const s = map.spawns[name] ?? map.spawns.default;
    if (!s) throw new Error(`${map.id}: нет спавна "${name}" и default`);
    return { tile: [s[0], s[1]], facing: facing ?? (s[2] as Dir | undefined) ?? 'down' };
  };
  if (typeof spawn === 'string') return named(spawn);
  if (spawn && spawn.length >= 2) {
    const [x, y] = spawn as [number, number];
    const p = parseAscii(map);
    const ok = x >= 0 && y >= 0 && x < p.w && y < p.h && !p.solid[y]![x] && !buildObjects(map).some((o) => o.rects.some((r) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]));
    if (ok) return { tile: [x, y], facing: facing ?? 'down' };
  }
  return named('default');
}
