import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BASE, workboxOptions } from './tools/lib/pwa';

function buildId(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  return `${pkg.version}+${sha}`;
}

const BUILD_ID = buildId();

/**
 * Версия сборки снаружи кэша: `index.html` несёт `<meta name="pq-build">`, рядом лежит `version.json` `{ "build": … }`.
 * Игра читает его с `cache: 'no-store'` (src/systems/platform/pwa.ts `watchVersion`) и при расхождении со своим
 * `__BUILD_ID__` перезагружается или показывает тост. version.json не кладётся в precache service worker'а.
 */
function buildVersion(): Plugin {
  return {
    name: 'pq-build-version',
    transformIndexHtml(html) {
      return html.replace('</head>', `    <meta name="pq-build" content="${BUILD_ID}" />\n  </head>`);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD_ID })}\n` });
    },
  };
}

export default defineConfig({
  base: BASE,
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    buildVersion(),
    VitePWA({
      // Новая сборка берёт страницу сразу (skipWaiting + clientsClaim), регистрация из кода (src/systems/platform/pwa.ts).
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'Ferma',
        short_name: 'Ferma',
        description: 'Пиксельная ферма, где растут польские слова',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        background_color: '#2e5b3b',
        theme_color: '#2e5b3b',
        icons: [
          { src: 'icons/icon-180.png', sizes: '180x180', type: 'image/png' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: workboxOptions(),
    }),
  ],
});
