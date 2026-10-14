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

const ROOT_DIR = fileURLToPath(new URL('./', import.meta.url));
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
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    contentValidator(),
    releaseGate(),
    VitePWA({
      registerType: 'autoUpdate',
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
        globPatterns: ['**/*.{js,css,html,png,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/supabase/],
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
  ],
});
