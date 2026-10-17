// Обновление сборки: новый service worker уже управляет страницей (autoUpdate: skipWaiting + clientsClaim),
// а на экране старый код. Что делать — решает чистая политика, склейка (src/systems/platform/pwa.ts, main.ts)
// только перезагружает или показывает тост.
//   • Не открыт ни один экран (меню, мини-игра, словарь, настройки) — тихая перезагрузка: прогресс дописывается в базу.
//   • Что-то открыто — заметный тост «Есть новая версия · Обновить»; как только экраны закрылись, политика спрашивается снова.
//   • Только что перезагружались (защита от петли) — тост, а не ещё одна перезагрузка.

/** Не перезагружаться сами чаще раза в минуту: новая сборка могла прийти дважды подряд. */
export const RELOAD_GUARD_MS = 60_000;

export type UpdateAction = 'reload' | 'toast';

export function updateAction(o: { busy: boolean; lastReloadAt: number | null; now: number }): UpdateAction {
  if (o.busy) return 'toast';
  if (o.lastReloadAt !== null && o.now - o.lastReloadAt >= 0 && o.now - o.lastReloadAt < RELOAD_GUARD_MS) return 'toast';
  return 'reload';
}

/**
 * Сборка на экране не та, что на сервере: `local` — `__BUILD_ID__` кода, `index` — `<meta name="pq-build">`
 * из index.html (null — нет), `remote` — `version.json` без кэша (null — не прочитали: офлайн, dev). Расхождение —
 * повод перезагрузиться на титуле или показать тост (`updateAction`).
 */
export function staleBuild(o: { local: string; index: string | null; remote: string | null }): boolean {
  if (o.index && o.index !== o.local) return true;
  return !!o.remote && o.remote !== o.local;
}
