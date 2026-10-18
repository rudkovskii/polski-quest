// Свои слова Шэфа («Moje słowa»): русское слово → польские варианты из офлайн-словаря rupl (Викисловарь), правка руками, хранение.
// Чистые функции без браузера: файл словаря грузит `systems/platform/rupl.ts`, хранит `Save.custom`, растят `systems/farm.ts`.
//
// Свои слова: id `w.custom.<хеш>`, тема `moje`. Растут как обычные слова, но в путь к A1 не входят (он считается по `A1_IDS`).
import type { Pos, Topic, Word } from '../types/content';
import type { GardenSave } from './garden';
import { fnv1a } from './hash';
import { translit } from './translit';

export type Gender = NonNullable<Word['gender']>;

export const CUSTOM_PREFIX = 'w.custom.';
export const CUSTOM_TOPIC: Topic = { id: 'moje', pl: 'Moje słowa', ru: 'Мои слова' };
/** Сколько своих слов можно держать (страховка от раздутого сохранения). */
export const CUSTOM_LIMIT = 500;
export const MAX_PL = 60;
export const MAX_RU = 120;
export const MAX_EX = 160;

export const isCustomId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX);

/** Что хранится в сохранении (`Save.custom`). Транскрипция строится на лету (`translit`). */
export interface CustomWord {
  id: string;
  pl: string;
  ru: string;
  pos: Pos;
  gender?: Gender;
  ex?: { pl: string; ru: string };
  /** Когда добавлено (мс по часам игры). */
  added: number;
}

const POS_SET: ReadonlySet<string> = new Set(['noun', 'verb', 'adj', 'adv', 'num', 'pron', 'prep', 'conj', 'part', 'intj', 'phrase']);
const GENDERS: ReadonlySet<string> = new Set(['m', 'f', 'n', 'pl']);

// ───────────── нормализация ─────────────

/** Ключ поиска: нижний регистр, ё→е, NFC, без знаков ударения, пробелы в один. Так же устроены ключи rupl. */
export function normRu(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[̀́]/g, '')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Строка из поля ввода: NFC, пробелы в один, без управляющих символов, не длиннее `max`. */
export function cleanLine(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const normPl = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Id слова: хеш от пары «польское|русское»; если этот хеш занят другой парой — с числом. Та же пара даёт тот же id. */
export function customId(pl: string, ru: string, existing: readonly Pick<CustomWord, 'id' | 'pl' | 'ru'>[] = []): string {
  const key = (p: string, r: string): string => `${normPl(p)}|${normRu(r)}`;
  const base = fnv1a(key(pl, ru)).toString(36);
  for (let n = 0; ; n++) {
    const id = `${CUSTOM_PREFIX}${base}${n ? `_${n}` : ''}`;
    const used = existing.find((w) => w.id === id);
    if (!used || key(used.pl, used.ru) === key(pl, ru)) return id;
  }
}

/** Слово словаря из записи сохранения. `i` — порядок в теме (новые первыми). */
export function toWord(c: CustomWord, i = 0): Word {
  return {
    id: c.id,
    pl: c.pl,
    ru: c.ru,
    tr: translit(c.pl),
    pos: c.pos,
    ...(c.gender ? { gender: c.gender } : {}),
    forms: {},
    topic: CUSTOM_TOPIC.id,
    freq: 3,
    band: 3,
    order: i,
    ff: null,
    ex: c.ex ?? null,
  };
}

/** Раздел сохранения: мусор отбрасывается, повторы и лишнее тоже. Нет раздела (старое сохранение) = пусто. */
export function normalizeCustom(raw: unknown): CustomWord[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomWord[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const pl = cleanLine(r.pl, MAX_PL);
    const ru = cleanLine(r.ru, MAX_RU);
    if (!isCustomId(id) || id.length > 64 || !pl || !ru || seen.has(id)) continue;
    seen.add(id);
    const ex = r.ex && typeof r.ex === 'object' ? (r.ex as Record<string, unknown>) : null;
    const exPl = ex ? cleanLine(ex.pl, MAX_EX) : '';
    out.push({
      id,
      pl,
      ru,
      pos: typeof r.pos === 'string' && POS_SET.has(r.pos) ? (r.pos as Pos) : 'noun',
      ...(typeof r.gender === 'string' && GENDERS.has(r.gender) ? { gender: r.gender as Gender } : {}),
      ...(exPl ? { ex: { pl: exPl, ru: cleanLine(ex?.ru, MAX_EX) } } : {}),
      added: typeof r.added === 'number' && Number.isFinite(r.added) ? r.added : 0,
    });
    if (out.length >= CUSTOM_LIMIT) break;
  }
  return out;
}

/** Убрать слово из огорода целиком: посадку, журнал ответов, грядку (раскладку потом пересчитает `syncSlots`). */
export function forgetItem(g: GardenSave, id: string): GardenSave {
  const slots = { ...g.slots };
  delete slots[id];
  return { ...g, planted: g.planted.filter((p) => p.id !== id), log: g.log.filter((a) => a.id !== id), slots };
}

// ───────────── словарь rupl ─────────────

/** Вариант в файле словаря: [польское, часть речи, род или вид]. */
export type RuplEntry = [pl: string, pos: string, g?: string];
export interface RuplDb {
  d: Record<string, RuplEntry[]>;
  f: Record<string, string>;
}

/** Файл `public/dict/rupl.json.gz` после распаковки: проверка формы, чтобы битый файл не уронил поиск. */
export function parseRupl(raw: unknown): RuplDb | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { d?: unknown; f?: unknown };
  if (!r.d || typeof r.d !== 'object' || !r.f || typeof r.f !== 'object') return null;
  return { d: r.d as RuplDb['d'], f: r.f as RuplDb['f'] };
}

/** Код части речи rupl → `Pos` игры. */
const POS_OF: Record<string, Pos> = {
  n: 'noun', v: 'verb', adj: 'adj', adv: 'adv', pron: 'pron', prep: 'prep', conj: 'conj', num: 'num', intj: 'intj', part: 'part', phr: 'phrase', name: 'noun',
};

export const POS_RU: Record<Pos, string> = {
  noun: 'сущ.', verb: 'глагол', adj: 'прил.', adv: 'нареч.', num: 'числит.', pron: 'местоим.', prep: 'предлог', conj: 'союз', part: 'частица', intj: 'межд.', phrase: 'фраза',
};
export const GENDER_RU: Record<Gender, string> = { m: 'м. р.', f: 'ж. р.', n: 'ср. р.', pl: 'мн. ч.' };

export interface Variant {
  pl: string;
  pos: Pos;
  gender?: Gender;
  /** Вид глагола. */
  aspect?: 'pf' | 'ipf';
  /** Имя собственное. */
  name: boolean;
  tr: string;
}

export interface Hit {
  /** Что искали (после нормализации). */
  query: string;
  /** Русская лемма в словаре. */
  lemma: string;
  /** Запрос был формой слова (книги → книга). */
  viaForm: boolean;
  variants: Variant[];
}

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const variantOf = (e: RuplEntry): Variant | null => {
  const pl = cleanLine(e[0], MAX_PL);
  if (!pl) return null;
  const pos = POS_OF[e[1]] ?? 'noun';
  const g = e[2] ?? '';
  return {
    pl,
    pos,
    ...(pos === 'noun' && GENDERS.has(g) ? { gender: g as Gender } : {}),
    ...(pos === 'verb' && (g === 'pf' || g === 'ipf') ? { aspect: g } : {}),
    name: e[1] === 'name',
    tr: translit(pl),
  };
};

/** Найти русское слово: `d[q] ?? d[f[q]]` (формы через алиасы), запрос нормализуется как ключи словаря. Нет — null. */
export function lookupRu(db: RuplDb, raw: string): Hit | null {
  const q = normRu(raw).replace(/^[\s"'«»(]+|[\s"'«».,!?;:)]+$/g, '');
  if (!q) return null;
  let lemma = q;
  let viaForm = false;
  if (!own(db.d, q)) {
    const alias = own(db.f, q) ? db.f[q] : undefined;
    if (typeof alias !== 'string' || !own(db.d, alias)) return null;
    lemma = alias;
    viaForm = true;
  }
  const list = db.d[lemma];
  if (!Array.isArray(list)) return null;
  const variants = list.map(variantOf).filter((v): v is Variant => !!v);
  return variants.length ? { query: q, lemma, viaForm, variants } : null;
}

// ───────────── уже есть в базе ─────────────

const baseIndex = new WeakMap<readonly Word[], Map<string, Word[]>>();

/** Русские значения слова базы: части через `;` и `,`, скобки отброшены (как в coverage.py), плюс строка целиком. */
export function ruAlternatives(ru: string): string[] {
  const noParen = ru.replace(/\([^)]*\)/g, ' ');
  return [...new Set([normRu(noParen), ...noParen.split(/[;,]/).map(normRu)])].filter(Boolean);
}

/** Слова базы, у которых русский перевод совпадает с одним из запросов (после нормализации). */
export function baseMatches(words: readonly Word[], ...queries: string[]): Word[] {
  let idx = baseIndex.get(words);
  if (!idx) {
    idx = new Map();
    for (const w of words) for (const a of ruAlternatives(w.ru)) idx.set(a, [...(idx.get(a) ?? []), w]);
    baseIndex.set(words, idx);
  }
  const out: Word[] = [];
  for (const q of queries) for (const w of idx.get(normRu(q)) ?? []) if (!out.includes(w)) out.push(w);
  return out;
}
