// Дополнение к service worker'у Workbox (W-04, tools/lib/pwa.ts): подключается `importScripts` до маршрутов Workbox,
// поэтому его обработчик `fetch` срабатывает первым.
//   1. Навигация под `<scope>wola` (`/wola`, `/wola/`, `/wola/?mute=1`, `/wola/index.html`) — страница Wola из precache
//      (`wola/index.html`, параметры адреса не важны); нет в кэше — из сети. Основная игра её не подменяет никогда.
//   2. Новый SW активировался — открытые вкладки по адресу `/wola…`, которые не ответили «wola» на `pq-which-page`
//      (старая основная игра, отданная прошлым SW без запрета на /wola/), перезагружаются: теперь их возьмёт п. 1.
// Чистый JS без сборки: файл лежит в public/ и попадает в dist/ как есть.
(() => {
  const scope = new URL(self.registration.scope);
  const base = scope.pathname.endsWith('/') ? scope.pathname : `${scope.pathname}/`;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wolaPath = new RegExp(`^${esc(base)}wola(?:/(?:index\\.html)?)?$`);
  const page = new URL(`${base}wola/index.html`, scope.origin).href;
  const ASK = 'pq-which-page';

  const isWolaNav = (req) => {
    if (req.mode !== 'navigate') return false;
    const url = new URL(req.url);
    return url.origin === scope.origin && wolaPath.test(url.pathname);
  };

  /** Страница Wola из precache Workbox (ключ с `?__WB_REVISION__=…`, поэтому ignoreSearch). */
  async function cachedWola() {
    for (const name of await caches.keys()) {
      if (!name.startsWith('workbox-precache')) continue;
      const hit = await (await caches.open(name)).match(page, { ignoreSearch: true });
      if (hit) return hit;
    }
    return null;
  }

  self.addEventListener('fetch', (event) => {
    if (!isWolaNav(event.request)) return;
    event.respondWith(
      (async () => {
        const hit = await cachedWola();
        if (hit) return hit;
        try {
          return await fetch(event.request);
        } catch {
          return Response.error();
        }
      })(),
    );
  });

  /** «Кто ты?» вкладке: ответ `{ page }` по MessageChannel или null за 1,5 с (старый код не отвечает). */
  function ask(client) {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 1500);
      ch.port1.onmessage = (e) => {
        clearTimeout(t);
        resolve((e.data && e.data.page) || null);
      };
      try {
        client.postMessage({ type: ASK }, [ch.port2]);
      } catch {
        clearTimeout(t);
        resolve(null);
      }
    });
  }

  async function fixWolaTabs() {
    await self.clients.claim();
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(
      list
        .filter((c) => {
          const u = new URL(c.url);
          return u.origin === scope.origin && wolaPath.test(u.pathname);
        })
        .map(async (c) => {
          if ((await ask(c)) === 'wola' || typeof c.navigate !== 'function') return;
          try {
            await c.navigate(c.url);
          } catch {
            // вкладка не под этим SW (другой scope) — оставляем
          }
        }),
    );
  }

  self.addEventListener('activate', (event) => event.waitUntil(fixWolaTabs()));
})();
