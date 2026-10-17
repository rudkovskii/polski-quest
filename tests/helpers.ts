import { createBus } from '../src/systems/bus';
import type { BusEvents } from '../src/types/bus';
import type { Dir, Intent } from '../src/types/input';
import { LocationModel, type WorldEvent } from '../src/world/location';
import { getMap, resolveSpawn } from '../src/world/maps';

export function testBus() {
  return createBus<BusEvents>();
}

/** Детерминированный случай (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function modelAt(map: string, spawn?: string | [number, number], facing?: Dir, seed = 1): LocationModel {
  const m = getMap(map);
  const s = resolveSpawn(m, spawn ?? 'default', facing);
  return new LocationModel(m, s.tile, { facing: s.facing, rand: seeded(seed) });
}

/** Прокрутить модель на `ms` мс кадрами по 16 мс; все события вернуть. */
export function run(model: LocationModel, ms: number, frame = 16): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let t = 0; t < ms; t += frame) out.push(...model.update(frame));
  return out;
}

export const press = (m: LocationModel, dir: Dir): void => m.intent({ type: 'move', dir, held: true });
export const release = (m: LocationModel, dir: Dir): void => m.intent({ type: 'move', dir, held: false });
export const send = (m: LocationModel, i: Intent): void => m.intent(i);
