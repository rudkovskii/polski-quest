// Точка входа в мини-игру и возврат к ней. Игра запускается там, где герой стоит (мачта, доска, карта или стол в доме, грядка);
// панельные игры уводят его автобегом в Zagroda, v1 — к грядкам. При выходе («Выйти ✕», Esc, «Wróć», итог раунда) герой и кот
// мгновенно возвращаются на то место и с тем же лицом (`world:return`, сцена гасит экран на 150 мс и пересоздаёт карту).
// «Na pole!» (`polska:tour {go}`) возврат пропускает: герой идёт в сад, а вернуться можно позже (`back()`, тост у Шэфа).
// Позиция героя в сохранении, пока игра открыта, не пишется: промежуточная клетка в Zagroda точкой возврата не становится
// (`holding`), а вернувшегося сцена записывает сама на старте. Чистая логика на шине, без Phaser и DOM.
import type { Dir } from '../types/input';
import type { BusEvents } from '../types/bus';
import type { Bus } from './bus';

/** Где стоял герой: карта, клетка, куда смотрел. */
export interface HeroSpot {
  map: string;
  x: number;
  y: number;
  facing: Dir;
}

export interface EntryPoint {
  /** Игра открыта: позицию героя в сохранение не писать. */
  readonly holding: boolean;
  /** Откуда игра запущена (пока открыта) или куда можно вернуться после «Na pole!». */
  readonly origin: HeroSpot | null;
  /** Вернуться к точке входа сейчас (после «Na pole!»). */
  back(): boolean;
  /** Игра открылась: вот точка входа (её и стоит держать в сохранении, пока герой бегает по Zagroda). */
  onStart(fn: (spot: HeroSpot) => void): () => void;
  /** Подписка на «можно вернуться» (после «Na pole!») и «уже нельзя» (null). */
  onPending(fn: (spot: HeroSpot | null) => void): () => void;
  dispose(): void;
}

export const sameSpot = (a: HeroSpot, b: HeroSpot): boolean => a.map === b.map && a.x === b.x && a.y === b.y;

export function createEntryPoint(bus: Bus<BusEvents>): EntryPoint {
  /** Где герой стоит сейчас (последняя стоянка или действие с объектом). */
  let here: HeroSpot | null = null;
  let polskaOn = false;
  let farmOn = false;
  let origin: HeroSpot | null = null;
  /** Игра открыта и точка входа уже снята (повторные `farm:auto on` её не переснимают). */
  let started = false;
  let skip = false;
  let pending: HeroSpot | null = null;
  const listeners = new Set<(s: HeroSpot | null) => void>();
  const starters = new Set<(s: HeroSpot) => void>();
  const setPending = (s: HeroSpot | null): void => {
    pending = s;
    for (const fn of listeners) fn(s);
  };
  const active = (): boolean => polskaOn || farmOn;

  const offs = [
    bus.on('world:position', ({ location, x, y, facing }) => {
      here = { map: location, x, y, facing };
    }),
    // Объект сработал: герой стоит на клетке подхода (у события есть `hero`), лицом к объекту. Игра открывается в этом же кадре,
    // раньше, чем придёт `world:position`, поэтому берём клетку отсюда.
    bus.on('world:interact', ({ location, hero, facing }) => {
      if (hero) here = { map: location, x: hero[0], y: hero[1], facing };
    }),
    bus.on('polska:tour', ({ go }) => {
      if (go) skip = true;
    }),
  ];

  const update = (): void => {
    const now = active();
    if (now && !started) {
      started = true;
      origin = here ? { ...here } : null;
      skip = false;
      if (pending) setPending(null);
      if (origin) for (const fn of starters) fn({ ...origin });
      return;
    }
    if (!now && started) {
      started = false;
      const o = origin;
      origin = null;
      if (skip) {
        skip = false;
        if (o) setPending(o);
        return;
      }
      if (o) bus.emit('world:return', { ...o });
    }
  };
  offs.push(
    bus.on('polska:auto', ({ on }) => {
      polskaOn = on;
      update();
    }),
    bus.on('farm:auto', ({ on }) => {
      farmOn = on;
      update();
    }),
  );

  return {
    get holding() {
      return active();
    },
    get origin() {
      return origin ?? pending;
    },
    back() {
      const o = pending;
      if (!o) return false;
      setPending(null);
      bus.emit('world:return', { ...o });
      return true;
    },
    onStart(fn) {
      starters.add(fn);
      return () => starters.delete(fn);
    },
    onPending(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      for (const off of offs) off();
      listeners.clear();
      starters.clear();
    },
  };
}
