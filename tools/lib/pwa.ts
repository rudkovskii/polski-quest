// Настройки service worker'а (vite.config.ts → vite-plugin-pwa, generateSW). Вынесены сюда, чтобы тест
// (tests/pwa_wola.test.ts) проверял ту же конфигурацию, что уходит в сборку, без запуска Vite.
//
// W-04 (плейтест Wola, общий топ-7 п. 2): service worker основной игры с scope `/polski-quest/` отдавал на навигацию
// `/polski-quest/wola/` свой `index.html` (navigateFallback) — у того, кто раньше открывал основную игру, первая ссылка
// на Wola показывала титул «Pierogi i Przypadki». Теперь:
//   • `navigateFallbackDenylist` закрывает для fallback основной игры всё под `/wola` (`/wola`, `/wola/`, `/wola?…`);
//   • `sw-wola.js` (public/, подключается `importScripts` первым, до маршрутов Workbox) отвечает на навигацию под
//     `/wola` страницей Wola из precache (`wola/index.html`, параметры адреса не важны), без сети — из сети;
//   • он же при активации нового SW находит открытые вкладки по адресу `/wola…`, спрашивает страницу «кто ты?»
//     (`pq-which-page`) и перезагружает те, что не ответили «wola» (старая основная игра из кэша прошлого SW).

export const BASE = '/polski-quest/';
export const WOLA = `${BASE}wola/`;
/** Скрипт-дополнение к SW Workbox (public/sw-wola.js). */
export const WOLA_SW_ADDON = 'sw-wola.js';
/** Навигация под Wola: `/polski-quest/wola`, `/polski-quest/wola/…`, `/polski-quest/wola?…` (Workbox сверяет pathname + search). */
export const WOLA_NAV = /^\/polski-quest\/wola(?:[/?#]|$)/;

/** Опции `workbox` для VitePWA (generateSW). */
export function workboxOptions() {
  return {
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    globPatterns: ['**/*.{js,css,html,png,json,webmanifest}'],
    // version.json — всегда из сети (P-12): по нему видно, что страница из старого кэша.
    globIgnores: ['**/version.json'],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    // Wola (W-04): навигация под /wola раньше Workbox берётся sw-wola.js (страница Wola из precache).
    importScripts: [WOLA_SW_ADDON],
    navigateFallback: 'index.html',
    // Wola (W-01, W-04): её страницы не подменяются основной игрой — ни `/wola/`, ни `/wola` без слэша, ни `/wola?mute=1`.
    navigateFallbackDenylist: [/supabase/, WOLA_NAV],
    // Параметры адреса (?dev, ?mute, ?now…) — только для клиента: страница из precache и с ними.
    ignoreURLParametersMatching: [/.*/],
    runtimeCaching: [
      {
        urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/audio/') && url.pathname.endsWith('.m4a'),
        handler: 'CacheFirst' as const,
        options: {
          cacheName: 'pq-audio',
          expiration: { maxEntries: 2000 },
        },
      },
    ],
  };
}
