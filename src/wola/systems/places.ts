// Места короткой версии «Wola» (W-01, ../ВОЛЯ.md решения 3–4): хаб — улица Воли с ходьбой (карта `wola.hub`,
// движок Location), места — экраны без ходьбы. Вход в место — выход карты с `to: "place:<id>"`: сцена шлёт
// `world:exit` и не грузит карту, склейка открывает экран места; «Wola» возвращает на улицу к двери (`spawn`).

export const PLACE_PREFIX = 'place:';
export const HUB_MAP = 'wola.hub';

export type PlaceId = 'dom' | 'salad' | 'ogrod';
export const PLACES: readonly PlaceId[] = ['dom', 'salad', 'ogrod'];

/** Подписи мест: польская крупно, русская ниже (ВОЛЯ.md п. 3). */
export const PLACE_LABEL: Record<PlaceId, { pl: string; ru: string }> = {
  dom: { pl: 'Mój dom', ru: 'Мой дом' },
  salad: { pl: 'Salad Story', ru: 'салатная, обед' },
  ogrod: { pl: 'Mój ogródek', ru: 'Мой огород' },
};

/** Спавн хаба у двери места: возвращаемся туда, откуда вошли. */
export const PLACE_SPAWN: Record<PlaceId, string> = { dom: 'from_dom', salad: 'from_salad', ogrod: 'from_ogrod' };

export function placeOf(to: string): PlaceId | null {
  if (!to.startsWith(PLACE_PREFIX)) return null;
  const id = to.slice(PLACE_PREFIX.length) as PlaceId;
  return PLACES.includes(id) ? id : null;
}
