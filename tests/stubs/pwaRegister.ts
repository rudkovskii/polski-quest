// Заглушка `virtual:pwa-register` для vitest: модуль даёт vite-plugin-pwa только в сборке.
export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => undefined;
}
