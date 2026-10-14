// Режим без звука (P-06, P-12). Задания на слух читаются, когда звука нет на деле, а не только по настройке:
//   • настройка `sound.mode: off` (выбор «Bez dźwięku» на перроне или в настройках);
//   • звук недоступен в этом запуске: `?mute=1`, озвучка ответила `audio:state none` (нет файла и голоса pl-PL),
//     игрок нажал «Не слышу» в задании на слух. Склейка (main.ts) ставит флаг `setSoundUnavailable`.
// Флаг живёт до перезагрузки: звук заиграл (`audio:state playing`) — снимается.
import { getSetting, type Progress } from './progress';

let unavailable = false;
const watchers = new Set<(v: boolean) => void>();

/** Звука в этом запуске нет (mute, нет голоса, «Не слышу»). */
export function soundUnavailable(): boolean {
  return unavailable;
}

export function setSoundUnavailable(v: boolean): void {
  if (unavailable === v) return;
  unavailable = v;
  for (const w of watchers) w(v);
}

/** Подписка на смену флага (тесты, отладка). */
export function onSoundUnavailable(fn: (v: boolean) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** Играть без звука: настройка `off` или звук недоступен на деле. Везде вместо `getSetting(…, 'sound.mode') === 'off'`. */
export function isSilent(p: Progress): boolean {
  return unavailable || getSetting(p, 'sound.mode') === 'off';
}
