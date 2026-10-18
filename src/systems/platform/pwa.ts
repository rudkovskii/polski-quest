/// <reference types="vite-plugin-pwa/vanillajs" />
// Service worker: регистрация из кода (`virtual:pwa-register`), а не вставленным скриптом, чтобы новая
// сборка подхватывалась при запуске без ручной перезагрузки. Политика — src/systems/update.ts.
//   • autoUpdate (vite.config.ts): новый SW сразу берёт страницу (skipWaiting + clientsClaim) → `onNeedReload`;
//   • проверка обновления при возврате в приложение и раз в 30 минут (PWA на iPhone живёт днями);
//   • отметка последней авто-перезагрузки — в sessionStorage (защита от петли).

const GUARD_KEY = 'pq-sw-reload-at';
const GUARD_FROM_KEY = 'pq-sw-reload-from';
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

/** Из какой сборки была последняя авто-перезагрузка (null — не знаем). */
export function lastReloadFrom(): string | null {
  try {
    return sessionStorage.getItem(GUARD_FROM_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Перезагрузить страницу ради новой сборки: сначала дописать прогресс в базу (`flush`), потом reload.
 * Прогресс не теряется: журнал уже в IndexedDB, в памяти только отложенная запись (debounce).
 */
export async function reloadForUpdate(flush?: () => Promise<void> | void, o: { now?: number; from?: string; reload?: () => void } = {}): Promise<void> {
  try {
    sessionStorage.setItem(GUARD_KEY, String(o.now ?? Date.now()));
    if (o.from) sessionStorage.setItem(GUARD_FROM_KEY, o.from);
  } catch {
    // приватный режим: без защиты от петли (политика и так перезагружает только на титуле)
  }
  try {
    await flush?.();
  } finally {
    (o.reload ?? (() => location.reload()))();
  }
}

/** `version.json` рядом с index.html без кэша браузера и service worker'а: `build` или null (офлайн, нет файла). */
export async function fetchRemoteBuild(base: string, o: { fetch?: typeof fetch; now?: number } = {}): Promise<string | null> {
  const f = o.fetch ?? (typeof fetch === 'undefined' ? null : fetch.bind(globalThis));
  if (!f) return null;
  try {
    const r = await f(`${base}version.json?t=${o.now ?? Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === 'string' && j.build ? j.build : null;
  } catch {
    return null;
  }
}

/** `<meta name="pq-build">` из index.html: какой сборкой отдана страница. */
export function indexBuild(doc: Document | null = typeof document === 'undefined' ? null : document): string | null {
  return doc?.querySelector<HTMLMetaElement>('meta[name="pq-build"]')?.content || null;
}

/**
 * Проверка версии: сейчас и при каждом возврате во вкладку. Сборка устарела — сначала просим service worker
 * обновиться (новый SW возьмёт страницу и сам вызовет onNeedReload), потом `onStale` (политика — systems/update.ts).
 */
export function watchVersion(o: { base: string; local: string; isStale: (x: { local: string; index: string | null; remote: string | null }) => boolean; onStale(): void }): void {
  if (!import.meta.env.PROD || typeof document === 'undefined') return;
  let fired = false;
  const check = async (): Promise<void> => {
    if (fired || document.visibilityState !== 'visible') return;
    const remote = await fetchRemoteBuild(o.base);
    if (fired || !o.isStale({ local: o.local, index: indexBuild(), remote })) return;
    fired = true;
    try {
      const r = await navigator.serviceWorker?.getRegistration();
      await r?.update();
    } catch {
      // без SW (встроенные браузеры, приватный режим): просто перезагрузка или тост
    }
    o.onStale();
  };
  void check();
  document.addEventListener('visibilitychange', () => void check());
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
