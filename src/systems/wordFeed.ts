// Лента своих слов Шэфа: файл `moje_slowa.json` на ветке `slowa` репозитория (правится без выкладки игры, `npm run words`).
// Прогресс живёт в браузере устройства, поэтому записи ленты применяются при запуске: каждая один раз на сохранение, по флагу в `Save.hints`.
// Слова в `edit` и `remove` ищутся по польскому написанию среди своих слов. Загрузка файла — `systems/platform/wordFeed.ts`.
import type { Pos } from '../types/content';

export interface FeedWord {
  pl: string;
  ru: string;
  tr?: string;
  pos?: Pos;
  ex?: { pl: string; ru: string };
}
export interface FeedEdit {
  /** Какое слово править: текущее польское написание. */
  pl: string;
  set: Partial<FeedWord>;
}
export interface FeedEntry {
  id: string;
  add?: readonly FeedWord[];
  edit?: readonly FeedEdit[];
  remove?: readonly string[];
}
export interface FeedDeps {
  /** Игрок уже что-то сажал: пустому сохранению лента не мешает пройти первые шаги. */
  started: boolean;
  seen(hint: string): boolean;
  mark(hint: string): void;
  find(pl: string): string | null;
  add(w: FeedWord): string | null;
  plant(ids: readonly string[]): number;
  update(id: string, patch: Partial<FeedWord>): boolean;
  remove(id: string): boolean;
}
export interface FeedResult {
  planted: number;
  edited: number;
  removed: number;
}

export const feedHint = (id: string): string => `feed:${id}`;

const isWord = (x: unknown): x is FeedWord => {
  const w = x as FeedWord | null;
  return !!w && typeof w.pl === 'string' && typeof w.ru === 'string';
};

/** Файл ленты после разбора: битые записи отбрасываются, чтобы правка файла не уронила игру. Записи с повторным id — тоже. */
export function parseFeed(raw: unknown): FeedEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedEntry[] = [];
  const ids = new Set<string>();
  for (const x of raw) {
    const r = x as Partial<Record<keyof FeedEntry, unknown>> | null;
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id)) continue;
    ids.add(r.id);
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    out.push({
      id: r.id,
      add: list(r.add).filter(isWord),
      edit: list(r.edit).filter((e): e is FeedEdit => typeof (e as FeedEdit | null)?.pl === 'string' && typeof (e as FeedEdit).set === 'object' && (e as FeedEdit).set !== null),
      remove: list(r.remove).filter((p): p is string => typeof p === 'string'),
    });
  }
  return out;
}

/** Применить новые записи по порядку. Флаг ставится сразу: слово, убранное в игре руками, не вернётся. */
export function applyFeed(entries: readonly FeedEntry[], d: FeedDeps): FeedResult {
  const res: FeedResult = { planted: 0, edited: 0, removed: 0 };
  if (!d.started) return res;
  for (const e of entries) {
    if (d.seen(feedHint(e.id))) continue;
    d.mark(feedHint(e.id));
    const ids = (e.add ?? []).map((w) => d.add(w)).filter((id): id is string => id !== null);
    res.planted += d.plant(ids);
    for (const x of e.edit ?? []) {
      const id = d.find(x.pl);
      if (id && d.update(id, x.set)) res.edited++;
    }
    for (const pl of e.remove ?? []) {
      const id = d.find(pl);
      if (id && d.remove(id)) res.removed++;
    }
  }
  return res;
}

/** Строка для игрока; нечего сказать — null. */
export function feedLine(r: FeedResult): string | null {
  const bits = [r.planted && `посажено ${r.planted}`, r.edited && `исправлено ${r.edited}`, r.removed && `убрано ${r.removed}`].filter(Boolean);
  return bits.length ? `Мои слова: ${bits.join(', ')}. Они в словаре, в «Moje słowa».` : null;
}
