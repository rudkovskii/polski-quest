// Загрузка ленты своих слов (`systems/wordFeed.ts`). Нет сети или файла — null, игра идёт как обычно: применённое уже в сохранении.
// С 11.11 (ТЗ-локальная-версия) ленты лежат рядом с игрой на маке (`Игра/local-site/feed/`, раздаёт tools/local_server.py),
// запросов в интернет нет.
const BASE_URL: string = import.meta.env.BASE_URL ?? '/';
export const WORD_FEED_URL = `${BASE_URL}feed/moje_slowa.json`;
/** Лента собеса (10.11): `sobes.json` там же, пишет `npm run sobes:feed`. */
export const SOBES_FEED_URL = `${BASE_URL}feed/sobes.json`;

export async function fetchWordFeed(url: string, _now: number): Promise<unknown> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
