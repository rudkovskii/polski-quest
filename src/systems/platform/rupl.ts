// Загрузка офлайн-словарей (Викисловарь, CC BY-SA 4.0) по требованию, не в precache:
// `public/dict/rupl.json.gz` — «русский → польский» (вкладка «＋ Своё»), `public/dict/plru.json.gz` — «польская форма → лемма → русский»
// (узнаваемые слова, `ui/wordPick.ts`). Файл gzip; если сервер сам его распаковал (Content-Encoding), приходит чистый JSON,
// поэтому смотрим на первые байты.
import { parseRupl, type RuplDb } from '../customWords';
import { parsePlru, type PlruDb } from '../wordPick';

export type RuplLoader = () => Promise<RuplDb | null>;
export type PlruLoader = () => Promise<PlruDb | null>;

export interface RuplDeps {
  /** Адрес файла (с учётом `BASE_URL`). */
  url: string;
  fetch?: typeof fetch;
}

async function readJson(res: Response): Promise<unknown> {
  const buf = new Uint8Array(await res.arrayBuffer());
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  let text: string;
  if (gz) {
    if (typeof DecompressionStream === 'undefined') return null;
    text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = new TextDecoder().decode(buf);
  return JSON.parse(text);
}

/** Загрузчик с памятью: файл тянется один раз, неудача не запоминается — можно повторить. */
function createLoader<T>(deps: RuplDeps, parse: (raw: unknown) => T | null): () => Promise<T | null> {
  let loaded: T | null = null;
  let pending: Promise<T | null> | null = null;
  return () => {
    if (loaded) return Promise.resolve(loaded);
    pending ??= (async () => {
      try {
        const res = await (deps.fetch ?? fetch)(deps.url);
        if (!res.ok) return null;
        return (loaded = parse(await readJson(res)));
      } catch {
        return null;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}

/** «Русский → польский»: 6 МБ в памяти. */
export const createRuplLoader = (deps: RuplDeps): RuplLoader => createLoader(deps, parseRupl);

/** «Польская форма → лемма → русский»: ~0,7 МБ gzip, ~340 тыс. форм в памяти (индекс строится один раз). */
export const createPlruLoader = (deps: RuplDeps): PlruLoader => createLoader(deps, parsePlru);
