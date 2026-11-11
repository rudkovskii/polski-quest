// Настройки service worker'а (vite.config.ts → vite-plugin-pwa, generateSW). Вынесены сюда, чтобы тест проверял ту же
// конфигурацию, что уходит в сборку, без запуска Vite.

import edition from '../../edition.json';

/** Путь сборки: `/` у игры Шэфа (с 11.11 только на маке, http://127.0.0.1:5321/), `/polski-quest/p/<ключ>/` у персональной версии на Pages (`edition.json`). */
export const BASE: string = edition.base;
/** Персональные версии лежали внутри scope игры Шэфа на Pages: его service worker не отдаёт им свою страницу (на ветках `ed/*`). */
const EDITIONS_PATH = /^\/polski-quest\/p\//;

/** Опции `workbox` для VitePWA (generateSW). */
export function workboxOptions() {
  return {
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    globPatterns: ['**/*.{js,css,html,png,json,webmanifest}'],
    // version.json — всегда из сети: по нему видно, что страница из старого кэша.
    globIgnores: ['**/version.json'],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/supabase/, /^\/feed\//, ...(EDITIONS_PATH.test(BASE) ? [] : [EDITIONS_PATH])],
    // Параметры адреса (?dev, ?mute…) — только для клиента: страница из precache и с ними.
    ignoreURLParametersMatching: [/.*/],
    runtimeCaching: [
      {
        urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/audio/') && url.pathname.endsWith('.m4a'),
        handler: 'CacheFirst' as const,
        options: {
          cacheName: 'pq-audio',
          expiration: { maxEntries: 10000 },
        },
      },
      {
        // Картины праздников (`public/swieta/*.jpg`, ~1,5 МБ, игра «Święta»): в precache не входят, кэшируются при первом показе.
        urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/swieta/') && url.pathname.endsWith('.jpg'),
        handler: 'CacheFirst' as const,
        options: {
          cacheName: 'pq-swieta',
          expiration: { maxEntries: 40 },
        },
      },
    ],
  };
}
