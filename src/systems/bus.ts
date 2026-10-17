// Типизированный emitter без зависимостей. Связь scenes/world ⇄ ui только через него.
import type { BusEvents } from '../types/bus';

type Handler<P> = (payload: P) => void;

export interface Bus<E> {
  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void;
  once<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void;
  off<K extends keyof E>(type: K, fn: Handler<E[K]>): void;
  emit<K extends keyof E>(type: K, payload: E[K]): void;
  clear(): void;
}

export function createBus<E>(): Bus<E> {
  const map = new Map<keyof E, Set<Handler<never>>>();
  const bus: Bus<E> = {
    on(type, fn) {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn as Handler<never>);
      return () => bus.off(type, fn);
    },
    once(type, fn) {
      const off = bus.on(type, (p) => {
        off();
        fn(p);
      });
      return off;
    },
    off(type, fn) {
      map.get(type)?.delete(fn as Handler<never>);
    },
    emit(type, payload) {
      const set = map.get(type);
      if (!set) return;
      for (const fn of [...set]) (fn as Handler<E[typeof type]>)(payload);
    },
    clear() {
      map.clear();
    },
  };
  return bus;
}

export const bus = createBus<BusEvents>();
