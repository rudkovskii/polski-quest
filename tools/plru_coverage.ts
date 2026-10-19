// Покрытие «узнаваемых слов»: доля слов во всех польских текстах игры (база A1: слова, примеры, фразы; v2: гимн, справки Daty,
// описания и пожелания Święta, география), для которых поповер находит лемму и русский перевод — так же, как в игре
// (`systems/wordPick.ts`: свои слова → база → словарь plru → названия v2 → эвристика окончаний).
//   npx tsx tools/plru_coverage.ts [-v]
// Отбор строк — то же правило, что в `Игра/data/rupl/src/build_plru.py` (`game_texts`): без кириллицы, id и перечисления пропускаются.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Word } from '../src/types/content';
import { V2 } from '../src/systems/v2content';
import { lookupPl, parsePlru, wordIndex, wordsIn, type PlruDb, type WordInfo } from '../src/systems/wordPick';
import { isMain, ROOT } from './lib/files';

const SKIP_KEYS = new Set(['id', 'kind', 'type', 'img', 'src', 'pic', 'credit', 'tr', 'icon', 'orchard', 'hit', 'class', 'class2', 'role', 'tone', 'harvest',
  'topic', 'pos', 'gender', 'unit', 'when', 'slot', 't', 'seat', 'shops', 'notes', 'season', 'item', 'decor', 'ff', 'asp']);
const ID_LIKE = /^[\w.:/-]*[._\d][\w.:/-]*$/;
const CYR = /[А-Яа-яЁё]/;

/** Все польские строки контента игры. */
export function gameTexts(root = ROOT): string[] {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) for (const v of x) walk(v);
    else if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) if (!SKIP_KEYS.has(k) && !k.endsWith('_ids') && !k.endsWith('_id')) walk(v);
    } else if (typeof x === 'string' && !CYR.test(x) && /[A-Za-ząćęłńóśźż]{2}/.test(x) && !ID_LIKE.test(x)) out.push(x);
  };
  for (const sub of ['a1', 'v2']) {
    const dir = join(root, 'content', sub);
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.json')) walk(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  return out;
}

export const loadPlru = (root = ROOT): PlruDb | null => parsePlru(JSON.parse(gunzipSync(readFileSync(join(root, 'public/dict/plru.json.gz'))).toString('utf8')));

export interface Coverage {
  tokens: number;
  unique: number;
  /** Доля словоупотреблений с найденной леммой (без «ничего»). */
  lemma: number;
  /** Доля словоупотреблений с леммой и переводом. */
  translated: number;
  /** То же по разным словам. */
  uniqueTranslated: number;
  /** Угадано эвристикой. */
  guessed: number;
  missing: [string, number][];
}

export function coverage(base: readonly Word[], db: PlruDb | null, texts = gameTexts()): Coverage {
  const names = V2.units.map((u) => ({ pl: u.pl, ru: u.ru, forms: Object.values((u.raw.forms ?? {}) as Record<string, unknown>).filter((x): x is string => typeof x === 'string') }));
  const ctx = { db, index: wordIndex(base, names), customs: [] as Word[] };
  const counts = new Map<string, number>();
  for (const s of texts) for (const w of wordsIn(s)) counts.set(w, (counts.get(w) ?? 0) + 1);
  let tokens = 0, lemma = 0, tr = 0, uTr = 0, guessed = 0;
  const miss = new Map<string, number>();
  const memo = new Map<string, WordInfo>();
  for (const [w, c] of counts) {
    const key = w.toLowerCase();
    const i = memo.get(key) ?? lookupPl(w, ctx);
    memo.set(key, i);
    tokens += c;
    if (i.via !== 'none') lemma += c;
    if (i.via !== 'none' && i.ru.length) {
      tr += c;
      uTr++;
    } else miss.set(key, (miss.get(key) ?? 0) + c);
    if (i.guess) guessed += c;
  }
  return {
    tokens,
    unique: counts.size,
    lemma: lemma / tokens,
    translated: tr / tokens,
    uniqueTranslated: uTr / counts.size,
    guessed: guessed / tokens,
    missing: [...miss].sort((a, b) => b[1] - a[1]),
  };
}

if (isMain(import.meta.url)) {
  const { BASE_WORDS } = await import('../src/systems/content');
  const c = coverage(BASE_WORDS, loadPlru());
  const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;
  console.log(`Тексты игры: ${c.tokens} словоупотреблений, ${c.unique} разных слов.`);
  console.log(`Лемма найдена: ${pct(c.lemma)}; лемма и перевод: ${pct(c.translated)} (по разным словам ${pct(c.uniqueTranslated)}); из них угадано по окончанию: ${pct(c.guessed)}.`);
  if (process.argv.includes('-v')) console.log('Без перевода:', c.missing.slice(0, 80).map(([w, n]) => `${w} ${n}`).join(', '));
}
