// Контент v2 «Игры о Польше»: `content/v2/*.json` — копия `Игра/data/v2/` без правок (правится там, сюда копируется).
// Загрузка терпимая к форме: единицы — элементы любого массива верхнего уровня, у которых есть `id` и `kind` из PolskaKind
// (geo.units, hymn.lines + hymn.symbols, daty.units, swieta.units). Проверка (`errors`) ловит тест `tests/v2core.test.ts`.
import datyJson from '../../content/v2/daty.json';
import geoJson from '../../content/v2/geografia.json';
import hymnJson from '../../content/v2/hymn.json';
import swietaJson from '../../content/v2/swieta.json';
import wordsSwietaJson from '../../content/v2/words_swieta.json';
import type { Topic, Word } from '../types/content';
import type { PolskaGameId, PolskaKind, PolskaUnit } from '../types/polska';
import { kindOf } from './garden';

export const POLSKA_KIND_LIST: readonly PolskaKind[] = ['geo', 'hymn', 'symbol', 'date', 'holiday'];

/** Игра → виды её единиц и файл данных. */
export const GAME_KINDS: Readonly<Record<PolskaGameId, readonly PolskaKind[]>> = {
  geo: ['geo'],
  hymn: ['hymn', 'symbol'],
  daty: ['date'],
  swieta: ['holiday'],
};
export const GAME_IDS: readonly PolskaGameId[] = ['geo', 'daty', 'swieta', 'hymn'];
export const gameOfKind = (k: PolskaKind): PolskaGameId => (k === 'geo' ? 'geo' : k === 'date' ? 'daty' : k === 'holiday' ? 'swieta' : 'hymn');

export type V2Docs = { geo: unknown; hymn: unknown; daty: unknown; swieta: unknown; words: unknown };

/** Тема словаря «Święta i zwyczaje» (вне A1: в путь к A1 не идёт). */
export const SWIETA_TOPIC: Topic = { id: 'swieta', pl: 'Święta i zwyczaje', ru: 'Праздники и обычаи' };

export interface V2Content {
  units: PolskaUnit[];
  byId: Map<string, PolskaUnit>;
  /** Исходные документы по играм (справочники: months, ordinals, rivers, melody, order…). */
  docs: Record<PolskaGameId, Readonly<Record<string, unknown>>>;
  /** Строки гимна, выученные в дриле собеса: сажаются сразу кустиком (решение Шэфа 4). */
  drillSeed: string[];
  /** Слова темы «Święta i zwyczaje» в форме слов A1 (растут как слова, в словаре своей темой). */
  words: Word[];
  topic: Topic;
  /** Ошибки формы данных (пусто — всё хорошо). */
  errors: string[];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function unitsOf(doc: unknown, file: string, errors: string[]): PolskaUnit[] {
  const out: PolskaUnit[] = [];
  for (const [key, arr] of Object.entries(obj(doc))) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      const x = obj(r);
      if (typeof x.id !== 'string' || !POLSKA_KIND_LIST.includes(x.kind as PolskaKind)) continue;
      const id = x.id;
      const kind = x.kind as PolskaKind;
      if (kindOf(id) !== kind) errors.push(`${file}.${key}: ${id} — префикс id не совпадает с kind "${kind}"`);
      if (!str(x.pl).trim()) errors.push(`${file}.${key}: ${id} — нет pl`);
      if (!str(x.ru).trim()) errors.push(`${file}.${key}: ${id} — нет ru`);
      const facts = Array.isArray(x.facts) ? x.facts.map(obj).filter((f) => typeof f.pl === 'string').map((f) => ({ pl: str(f.pl), ru: str(f.ru) })) : [];
      out.push({ id, kind, type: str(x.type) || key, pl: str(x.pl), ru: str(x.ru), tr: str(x.tr), band: typeof x.band === 'number' ? x.band : 1, facts, raw: x });
    }
  }
  return out;
}

function drillSeedOf(hymn: unknown, lines: readonly PolskaUnit[]): string[] {
  const d = obj(hymn).drillSeed;
  const ordered = lines.filter((u) => u.kind === 'hymn');
  if (typeof d === 'number') return ordered.slice(0, Math.max(0, Math.trunc(d))).map((u) => u.id);
  const list = Array.isArray(d) ? d : Array.isArray(obj(d).lines) ? (obj(d).lines as unknown[]) : [];
  // Номер строки (1…20) или id.
  return list.map((x) => (typeof x === 'number' ? ordered.find((u) => u.raw.n === x)?.id ?? '' : str(x))).filter((id) => ordered.some((u) => u.id === id));
}

function wordsOf(doc: unknown, errors: string[]): { words: Word[]; topic: Topic } {
  const d = obj(doc);
  const list = Array.isArray(doc) ? doc : Array.isArray(d.words) ? d.words : [];
  const t = obj(d.topic);
  const topic: Topic = { id: SWIETA_TOPIC.id, pl: str(t.pl) || SWIETA_TOPIC.pl, ru: str(t.ru) || SWIETA_TOPIC.ru };
  const words: Word[] = [];
  list.forEach((r, i) => {
    const x = obj(r);
    const id = str(x.id);
    if (!id.startsWith('sw.')) {
      errors.push(`words_swieta: ${id || `#${i}`} — id слова темы должен начинаться с "sw."`);
      return;
    }
    if (!str(x.pl).trim() || !str(x.ru).trim()) errors.push(`words_swieta: ${id} — нет pl или ru`);
    const g = x.gender;
    words.push({
      id,
      pl: str(x.pl),
      ru: str(x.ru),
      tr: str(x.tr),
      pos: (str(x.pos) || 'noun') as Word['pos'],
      ...(g === 'm' || g === 'f' || g === 'n' || g === 'pl' ? { gender: g } : {}),
      forms: Object.fromEntries(Object.entries(obj(x.forms)).filter((e): e is [string, string] => typeof e[1] === 'string')),
      topic: SWIETA_TOPIC.id,
      freq: typeof x.freq === 'number' ? x.freq : 0,
      band: 3,
      order: 100_000 + i,
      ff: null,
      ex: x.ex && typeof obj(x.ex).pl === 'string' ? { pl: str(obj(x.ex).pl), ru: str(obj(x.ex).ru) } : null,
    });
  });
  return { words, topic };
}

/** Разобрать документы v2. Чистая функция: тест гоняет её и на настоящих данных, и на испорченных. */
export function parseV2(docs: V2Docs): V2Content {
  const errors: string[] = [];
  const per: Record<PolskaGameId, PolskaUnit[]> = {
    geo: unitsOf(docs.geo, 'geografia', errors),
    hymn: unitsOf(docs.hymn, 'hymn', errors),
    daty: unitsOf(docs.daty, 'daty', errors),
    swieta: unitsOf(docs.swieta, 'swieta', errors),
  };
  for (const [g, list] of Object.entries(per) as [PolskaGameId, PolskaUnit[]][])
    for (const u of list) if (!GAME_KINDS[g].includes(u.kind)) errors.push(`${g}: ${u.id} — kind "${u.kind}" не из этой игры`);
  const units = [...per.geo, ...per.hymn, ...per.daty, ...per.swieta];
  const byId = new Map<string, PolskaUnit>();
  for (const u of units) {
    if (byId.has(u.id)) errors.push(`повтор id ${u.id}`);
    else byId.set(u.id, u);
  }
  const { words, topic } = wordsOf(docs.words, errors);
  const seen = new Set<string>();
  for (const w of words) {
    if (seen.has(w.id)) errors.push(`words_swieta: повтор id ${w.id}`);
    seen.add(w.id);
  }
  return {
    units: [...byId.values()],
    byId,
    docs: { geo: obj(docs.geo), hymn: obj(docs.hymn), daty: obj(docs.daty), swieta: obj(docs.swieta) },
    drillSeed: drillSeedOf(docs.hymn, per.hymn),
    words,
    topic,
    errors,
  };
}

/** Контент v2 игры (бандлится в код). */
export const V2: V2Content = parseV2({ geo: geoJson, hymn: hymnJson, daty: datyJson, swieta: swietaJson, words: wordsSwietaJson });

/** Единицы игры (по её видам), в порядке данных. */
export function unitsOfGame(c: V2Content, game: PolskaGameId): PolskaUnit[] {
  const kinds = GAME_KINDS[game];
  return c.units.filter((u) => kinds.includes(u.kind));
}
