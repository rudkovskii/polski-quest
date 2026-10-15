// Профиль хранилища Wola (W-04, плейтест: отдельного профиля для второй персоны сделать не удалось). Как `?dev=p10a`
// в основной игре: `?dev=<id>` — своя база IndexedDB `polski-quest-wola-<id>` и пространство localStorage `wola-<id>:`,
// основное сохранение Wola не трогается. Без `dev` (или с негодным id) — основное сохранение.

export const WOLA_DB = 'polski-quest-wola';
export const WOLA_LS = 'wola:';

export interface WolaProfile {
  db: string;
  ls: string;
  /** id профиля проверки; null — основное сохранение. */
  id: string | null;
}

export function wolaProfile(dev: string | null): WolaProfile {
  const id = dev && /^[A-Za-z0-9_-]{1,32}$/.test(dev) ? dev : null;
  return id ? { db: `${WOLA_DB}-${id}`, ls: `wola-${id}:`, id } : { db: WOLA_DB, ls: WOLA_LS, id: null };
}
