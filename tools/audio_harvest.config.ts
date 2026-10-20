// Конфиг сборщика строк озвучки (tools/audio_harvest.spec.ts): не входит в `npm run test`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'virtual:pwa-register': fileURLToPath(new URL('../tests/stubs/pwaRegister.ts', import.meta.url)) } },
  test: { include: ['tools/audio_harvest.spec.ts'], environment: 'node', testTimeout: 600000 },
});
