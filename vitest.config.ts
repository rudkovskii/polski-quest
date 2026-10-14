import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // P-10a: виртуальный модуль vite-plugin-pwa есть только в сборке (src/systems/platform/pwa.ts).
    alias: { 'virtual:pwa-register': fileURLToPath(new URL('./tests/stubs/pwaRegister.ts', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
