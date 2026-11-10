// Загрузка ленты своих слов (`systems/wordFeed.ts`). Нет сети или файла — null, игра идёт как обычно: применённое уже в сохранении.
export const WORD_FEED_URL = 'https://raw.githubusercontent.com/rudkovskii/polski-quest/slowa/moje_slowa.json';
/** Лента собеса (10.11): `sobes.json` на той же ветке, пишет `npm run sobes:feed`. */
export const SOBES_FEED_URL = 'https://raw.githubusercontent.com/rudkovskii/polski-quest/slowa/sobes.json';

export async function fetchWordFeed(url: string, now: number): Promise<unknown> {
  try {
    // Метка раз в минуту: иначе кэш raw.githubusercontent.com держит старый файл до 5 минут.
    const r = await fetch(`${url}?t=${Math.floor(now / 60_000)}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
