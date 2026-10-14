/// <reference types="vite-plugin-pwa/vanillajs" />
// Service worker (P-10a): регистрация из кода (`virtual:pwa-register`), а не вставленным скриптом, чтобы новая
// сборка подхватывалась при запуске без ручной перезагрузки. Политика — src/systems/update.ts.
//   • autoUpdate (vite.config.ts): новый SW сразу берёт страницу (skipWaiting + clientsClaim) → `onNeedReload`;
//   • проверка обновления при возврате в приложение и раз в 30 минут (PWA на iPhone живёт днями);
//   • отметка последней авто-перезагрузки — в sessionStorage (защита от петли).

const GUARD_KEY = 'pq-sw-reload-at';
const CHECK_EVERY_MS = 30 * 60_000;

export interface PwaOptions {
  /** Новая сборка уже управляет страницей: перезагрузиться или показать тост решает склейка. */
  onNeedReload(): void;
}

/** Когда страница последний раз перезагружалась ради обновления (мс) или null. */
export function lastReloadAt(): number | null {
  try {
    const v = Number(sessionStorage.getItem(GUARD_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Перезагрузить страницу ради новой сборки: сначала дописать прогресс в базу (`flush`), потом reload.
 * Прогресс не теряется: журнал уже в IndexedDB, в памяти только отложенная запись (debounce).
 */
export async function reloadForUpdate(flush?: () => Promise<void> | void, o: { now?: number; reload?: () => void } = {}): Promise<void> {
  try {
    sessionStorage.setItem(GUARD_KEY, String(o.now ?? Date.now()));
  } catch {
    // приватный режим: без защиты от петли (политика и так перезагружает только на титуле)
  }
  try {
    await flush?.();
  } finally {
    (o.reload ?? (() => location.reload()))();
  }
}

export function registerPwa(o: PwaOptions): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedReload: () => o.onNeedReload(),
      onRegisteredSW(_url, r) {
        if (!r) return;
        const check = (): void => {
          if (document.visibilityState === 'visible' && navigator.onLine !== false) void r.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', check);
        setInterval(check, CHECK_EVERY_MS);
      },
    });
  });
}
