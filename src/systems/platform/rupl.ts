// Загрузка офлайн-словаря «русский → польский» (`public/dict/rupl.json.gz`, Викисловарь, CC BY-SA 4.0): по требованию, не в precache.
// Файл gzip; если сервер сам его распаковал (Content-Encoding), приходит чистый JSON, поэтому смотрим на первые байты.
import { parseRupl, type RuplDb } from '../customWords';

export type RuplLoader = () => Promise<RuplDb | null>;

export interface RuplDeps {
  /** Адрес файла (с учётом `BASE_URL`). */
  url: string;
  fetch?: typeof fetch;
}

async function readDb(res: Response): Promise<RuplDb | null> {
  const buf = new Uint8Array(await res.arrayBuffer());
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  let text: string;
  if (gz) {
    if (typeof DecompressionStream === 'undefined') return null;
    text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = new TextDecoder().decode(buf);
  return parseRupl(JSON.parse(text));
}

/** Загрузчик с памятью: словарь тянется один раз (6 МБ в памяти), неудача не запоминается — можно повторить. */
export function createRuplLoader(deps: RuplDeps): RuplLoader {
  let loaded: RuplDb | null = null;
  let pending: Promise<RuplDb | null> | null = null;
  return () => {
    if (loaded) return Promise.resolve(loaded);
    pending ??= (async () => {
      try {
        const res = await (deps.fetch ?? fetch)(deps.url);
        if (!res.ok) return null;
        return (loaded = await readDb(res));
      } catch {
        return null;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}
