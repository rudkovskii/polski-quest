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
    // Тяжёлые симуляции (бобёр, все игры v2) под нагрузкой полного прогона шли до 5 с и падали по таймауту.
    testTimeout: 20_000,
    // Не больше 4 потоков (30.10, Шэф: «комп начинает тормозить»): по умолчанию vitest занимает почти все 12 ядер.
    // Тихий режим (`npm run test:quiet`, `check:quiet`): 2 потока в фоне на экономичных ядрах (`taskpolicy -b`), браузер и Zoom не тормозят.
    maxWorkers: Number(process.env.PQ_WORKERS) || 4,
  },
});
