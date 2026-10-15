import { execFile, execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const BASE = '/polski-quest/';

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
 * Версия сборки снаружи кэша (P-12, Андрей увидел старую c732548 без тоста): `index.html` несёт
 * `<meta name="pq-build">`, рядом лежит `version.json` `{ "build": … }`. Игра читает его с `cache: 'no-store'`
 * (src/systems/platform/pwa.ts `checkVersion`) и при расхождении со своим `__BUILD_ID__` перезагружается на титуле
 * или показывает тост. version.json не кладётся в precache service worker'а (globIgnores ниже).
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

const ROOT_DIR = fileURLToPath(new URL('./', import.meta.url));

/**
 * Короткая версия «Wola» (W-01): вторая страница `wola/index.html` рядом с основной игрой. Service worker один на
 * `/polski-quest/` (кэширует обе), манифест у Wola свой: `wola/manifest.webmanifest`, scope и start_url
 * `/polski-quest/wola/` — на телефоне ставится отдельной иконкой. vite-plugin-pwa вставляет ссылку на основной манифест
 * во все страницы: в странице Wola меняем её на свою.
 */
const WOLA = `${BASE}wola/`;
function wolaPwa(): Plugin {
  const manifest = {
    id: WOLA,
    name: 'Wola · Pierogi i Przypadki',
    short_name: 'Wola',
    description: 'Короткая версия: район Воля, слова дома, огород, Salad Story',
    lang: 'ru',
    display: 'standalone',
    orientation: 'portrait',
    start_url: WOLA,
    scope: WOLA,
    background_color: '#1a1c2c',
    theme_color: '#1a1c2c',
    icons: [
      { src: `${BASE}icons/icon-180.png`, sizes: '180x180', type: 'image/png' },
      { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${BASE}icons/icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return {
    name: 'pq-wola-pwa',
    apply: 'build',
    // После vite-plugin-pwa (у него enforce: post): ссылка на основной манифест уже вставлена — заменяем её.
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!/(^|\/)wola\/index\.html$/.test(ctx.path)) return html;
        const link = `<link rel="manifest" href="${WOLA}manifest.webmanifest">`;
        return /<link rel="manifest"[^>]*>/.test(html) ? html.replace(/<link rel="manifest"[^>]*>/, link) : html.replace('</head>', `${link}</head>`);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'wola/manifest.webmanifest', source: `${JSON.stringify(manifest, null, 2)}\n` });
    },
  };
}
const CONTENT_DIR = fileURLToPath(new URL('./content/', import.meta.url));
const TSX = fileURLToPath(new URL('./node_modules/.bin/tsx', import.meta.url));

/**
 * Dev: валидатор контента (ТЗ §3.13, tools/validate_content.ts) при старте и при каждой правке content/**.
 * Ошибки показываются оверлеем Vite поверх игры; после исправления страница перезагружается.
 */
function contentValidator(): Plugin {
  let last = '';
  const send = (server: ViteDevServer): void => {
    if (!last) return;
    server.ws.send({
      type: 'error',
      err: { message: `Контент не прошёл валидацию (npm run validate):\n${last}`, stack: '', plugin: 'pq-content' },
    });
  };
  const run = async (server: ViteDevServer): Promise<void> => {
    const had = last;
    // Отдельный процесс: конфиг Vite не тянет за собой ajv и tools/, ошибки те же, что у `npm run validate`.
    last = await new Promise<string>((done) => {
      execFile(TSX, ['tools/validate_content.ts', '--quiet'], { cwd: ROOT_DIR }, (err, _out, stderr) => {
        done(err ? stderr.trim() || err.message : '');
      });
    });
    if (last) {
      server.config.logger.error(`[content] ошибки валидации:\n${last}`);
      send(server);
    } else if (had) {
      server.config.logger.info('[content] валидация ок');
      server.ws.send({ type: 'full-reload' });
    }
  };
  return {
    name: 'pq-content-validator',
    apply: 'serve',
    configureServer(server) {
      void run(server);
      server.ws.on('connection', () => send(server));
      const onFs = (file: string): void => {
        if (file.startsWith(CONTENT_DIR) && file.endsWith('.json')) void run(server);
      };
      server.watcher.on('change', onFs).on('add', onFs).on('unlink', onFs);
    },
  };
}

/**
 * Сборка для людей (P-01): `PQ_RELEASE=1 npm run build` (или `npm run build:release`) сначала гоняет
 * валидатор с `--release` и падает, если в бит первого дня попала реплика-заглушка `todo`.
 */
function releaseGate(): Plugin {
  return {
    name: 'pq-release-gate',
    apply: 'build',
    buildStart() {
      if (process.env.PQ_RELEASE !== '1') return;
      try {
        execFileSync(TSX, ['tools/validate_content.ts', '--release', '--quiet'], { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        const err = e as { stderr?: Buffer; message: string };
        this.error(`PQ_RELEASE=1: контент не готов к сборке для людей:\n${err.stderr?.toString().trim() || err.message}`);
      }
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
    // Две страницы (W-01): основная игра и короткая версия «Wola» (/polski-quest/wola/).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        wola: fileURLToPath(new URL('./wola/index.html', import.meta.url)),
      },
    },
  },
  plugins: [
    contentValidator(),
    releaseGate(),
    buildVersion(),
    VitePWA({
      // P-10a: новая сборка берёт страницу сразу (skipWaiting + clientsClaim), регистрация из кода
      // (src/systems/platform/pwa.ts): на титуле — перезагрузка, в игре — тост «Есть обновление».
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'Pierogi i Przypadki',
        short_name: 'Polski',
        description: 'Пиксельная игра для изучения польского',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        background_color: '#1a1c2c',
        theme_color: '#1a1c2c',
        icons: [
          { src: 'icons/icon-180.png', sizes: '180x180', type: 'image/png' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,png,json,webmanifest}'],
        // version.json — всегда из сети (P-12): по нему видно, что страница из старого кэша.
        globIgnores: ['**/version.json'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Wola (W-01): её страницы не подменяются основной игрой; `/wola/?mute=1` берётся из кэша как `/wola/index.html`.
        navigateFallbackDenylist: [/supabase/, /\/wola\//],
        // Параметры адреса (?dev, ?mute, ?now…) — только для клиента: страница из precache и с ними.
        ignoreURLParametersMatching: [/.*/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/audio/') && url.pathname.endsWith('.m4a'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pq-audio',
              expiration: { maxEntries: 2000 },
            },
          },
        ],
      },
    }),
    wolaPwa(),
  ],
});
