// Склейка внешности (P-03): из прогресса (`settings.avatar`, LWW) в шину `avatar:changed` — мир
// пересобирает текстуру `avatar`, портреты диалогов берут голову аватара. Вызывается из main.ts.
import { bus as globalBus, type Bus } from './systems/bus';
import { appearanceOf, avatarKey, type Appearance } from './systems/avatar';
import type { Progress } from './systems/progress';
import type { BusEvents } from './types/bus';

export interface AvatarGlue {
  /** Внешность из прогресса (пресет «Дима», пока Fotobudka не пройдена); null — хранилище ещё грузится. */
  current(): Appearance | null;
}

export function startAvatar(store: Promise<{ progress: Progress }>, bus: Bus<BusEvents> = globalBus): AvatarGlue {
  let cur: Appearance | null = null;
  let sig = '';
  const check = async (): Promise<void> => {
    const s = await store;
    const a = appearanceOf(s.progress);
    const key = avatarKey(a);
    if (`${key}|${a.name}` === sig) return;
    sig = `${key}|${a.name}`;
    cur = a;
    bus.emit('avatar:changed', { appearance: a, key });
  };
  void check();
  bus.on('progress:changed', () => void check());
  bus.on('progress:merged', () => void check());
  return { current: () => cur };
}
