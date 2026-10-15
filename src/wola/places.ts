// Переходы Wola (W-01): выход карты `place:<id>` → экран места; Дима сразу встаёт у двери (`world:teleport` на спавн
// возврата, сцена перезапускается под экраном), «Wola» закрывает экран — улица уже на месте, переход мгновенный.
// Пока экран открыт, второй вход не открывается.
import type { Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { HUB_MAP, PLACE_SPAWN, placeOf, type PlaceId } from './systems/places';

export interface PlaceRoutes {
  /** Экран места; обещание — до возврата на улицу. */
  run(id: PlaceId): Promise<void>;
  onBusy?(busy: boolean): void;
  /** После возврата (счётчики на улице, запись на диск). */
  after?(id: PlaceId): void;
}

export function routePlaces(bus: Bus<BusEvents>, r: PlaceRoutes): { open(id: PlaceId): Promise<void>; queue(id: PlaceId): void; readonly busy: boolean; dispose(): void } {
  let busy = false;
  /** Место, куда перейти сразу после текущего (W-04: «Сначала огород» с ноутбука, быстрые клавиши во время экрана). */
  let pending: PlaceId | null = null;
  const open = async (id: PlaceId): Promise<void> => {
    if (busy) return;
    busy = true;
    r.onBusy?.(true);
    bus.emit('world:teleport', { location: HUB_MAP, spawn: PLACE_SPAWN[id], facing: 'down' });
    try {
      await r.run(id);
    } finally {
      busy = false;
      r.onBusy?.(false);
      r.after?.(id);
    }
    const next = pending;
    pending = null;
    if (next) await open(next);
  };
  const queue = (id: PlaceId): void => {
    if (busy) pending = id;
    else void open(id);
  };
  const off = bus.on('world:exit', ({ to }) => {
    const id = placeOf(to);
    if (id) void open(id);
  });
  return {
    open,
    queue,
    get busy() {
      return busy;
    },
    dispose: off,
  };
}
