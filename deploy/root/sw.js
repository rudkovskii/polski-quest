// Снятие старого service worker'а игры Шэфа с корня Pages (11.11, ТЗ-локальная-версия: игра переехала на мак).
// Чистит только precache своего scope; кэши и service worker'ы персональных версий (/p/<ключ>/) не трогает.
// Сохранение игры (IndexedDB, localStorage) не трогается.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('workbox-precache') && k.endsWith(scope)).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.navigate(c.url);
  })());
});
