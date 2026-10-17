// Настройки service worker'а (vite.config.ts → vite-plugin-pwa, generateSW). Вынесены сюда, чтобы тест проверял ту же
// конфигурацию, что уходит в сборку, без запуска Vite.

export const BASE = '/polski-quest/';

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
    navigateFallbackDenylist: [/supabase/],
    // Параметры адреса (?dev, ?mute…) — только для клиента: страница из precache и с ними.
    ignoreURLParametersMatching: [/.*/],
    runtimeCaching: [
      {
        urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/audio/') && url.pathname.endsWith('.m4a'),
        handler: 'CacheFirst' as const,
        options: {
          cacheName: 'pq-audio',
          expiration: { maxEntries: 4000 },
        },
      },
    ],
  };
}
