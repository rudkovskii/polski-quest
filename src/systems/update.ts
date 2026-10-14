// Обновление сборки (P-10a): новый service worker уже управляет страницей (autoUpdate: skipWaiting + clientsClaim),
// а на экране старый код. Что делать — решает чистая политика, склейка (src/systems/platform/pwa.ts, main.ts)
// только перезагружает или показывает тост.
//   • Игрок ещё на титуле (не нажал «Начать») — перезагрузить сразу: ничего не начато, прогресс в базе.
//   • Уже играет — не рвать урок: тост «Есть обновление» с кнопкой, перезагрузка по кнопке.
//   • Только что перезагружались (защита от петли) — тоже тост.

/** Не перезагружаться сами чаще раза в минуту: новая сборка могла прийти дважды подряд. */
export const RELOAD_GUARD_MS = 60_000;

export type UpdateAction = 'reload' | 'toast';

export function updateAction(o: { started: boolean; lastReloadAt: number | null; now: number }): UpdateAction {
  if (o.started) return 'toast';
  if (o.lastReloadAt !== null && o.now - o.lastReloadAt >= 0 && o.now - o.lastReloadAt < RELOAD_GUARD_MS) return 'toast';
  return 'reload';
}
