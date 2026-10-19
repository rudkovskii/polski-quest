// Игра 5 «Собери слово · Ułóż słowo»: чистая логика букв-плиток (без DOM и часов, случай приходит параметром).
//   RU→PL: русское слово → польское из плиток-букв (rz/sz/cz — одна плитка-диграф) + 2–4 буквы-ловушки из польских пар
//          (ą/a, ę/e, ł/l, ó/o/u, ś/s, ż/ź/z, ć/c, ń/n, rz/ż, sz/ś, cz/ć, i/y);
//   PL→RU: польское слово → русское (первое значение перевода) + ловушки ё/е, и/й, ш/щ, е/э, ь/ъ, а/о, и/ы.
// Пробел, дефис и знаки — не плитки: стоят в ряду ответа сами (`layout`), слоты показывают длину слов.
import { checkAnswer, norm, type Verdict } from './answer';

export type SpellLang = 'pl' | 'ru';

/** Ряд ответа: null — слот под плитку, строка — неподвижный знак (пробел, дефис, «?»). */
export type SpellCell = string | null;

export interface SpellTarget {
  /** Как показать правильный ответ (регистр и знаки как в базе). */
  text: string;
  /** Плитки ответа по порядку (нижний регистр; у польского rz/sz/cz — одной плиткой). */
  units: string[];
  layout: SpellCell[];
}

const PL_LETTER = /[a-ząćęłńóśźż]/;
const RU_LETTER = /[а-яё]/;
const DIGRAPHS = ['rz', 'sz', 'cz'];

/** Разбить слово на плитки и неподвижные знаки. */
export function spellTarget(text: string, lang: SpellLang): SpellTarget {
  const low = text.toLocaleLowerCase(lang);
  const letter = lang === 'pl' ? PL_LETTER : RU_LETTER;
  const units: string[] = [];
  const layout: SpellCell[] = [];
  for (let i = 0; i < low.length; i++) {
    const ch = low[i]!;
    if (!letter.test(ch)) {
      // Пробелы схлопываем, знаки по краям слова оставляем как есть.
      if (ch === ' ' && layout.at(-1) === ' ') continue;
      layout.push(ch);
      continue;
    }
    const two = low.slice(i, i + 2);
    if (lang === 'pl' && DIGRAPHS.includes(two)) {
      units.push(two);
      i++;
    } else units.push(ch);
    layout.push(null);
  }
  return { text: text.trim(), units, layout };
}

/** Польские пары-ловушки: буква ответа → похожие по звуку или виду. */
const PL_PAIRS: Record<string, string[]> = {
  a: ['ą'], ą: ['a', 'o'], e: ['ę'], ę: ['e'], l: ['ł'], ł: ['l', 'u'], o: ['ó'], ó: ['o', 'u'], u: ['ó'],
  s: ['ś'], ś: ['s', 'sz'], z: ['ż', 'ź'], ż: ['z', 'rz', 'ź'], ź: ['z', 'ż'], c: ['ć'], ć: ['c', 'cz'], n: ['ń'], ń: ['n'],
  rz: ['ż'], sz: ['ś'], cz: ['ć'], i: ['y'], y: ['i'], h: ['ch'],
};
const RU_PAIRS: Record<string, string[]> = {
  е: ['ё', 'э'], ё: ['е'], и: ['й', 'ы'], й: ['и'], ш: ['щ'], щ: ['ш'], э: ['е'], ь: ['ъ'], ъ: ['ь'], а: ['о'], о: ['а'], ы: ['и'],
  с: ['з'], з: ['с'], б: ['п'], п: ['б'], д: ['т'], т: ['д'], в: ['ф'], ф: ['в'], г: ['к'], к: ['г'], ж: ['ш'], ю: ['у'], я: ['а'],
};
const FILL: Record<SpellLang, string[]> = { pl: [...'aeiouyklmnprstwz'], ru: [...'аеиоуклмнпрст'] };

/** Сколько ловушек: короткое слово — 2, до 8 плиток — 3, длиннее — 4. */
export const distractCount = (units: number): number => (units <= 4 ? 2 : units <= 8 ? 3 : 4);

function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 2–4 плитки-ловушки: сначала пары к буквам слова (польские диакритики, rz/ż…), не хватило — частые буквы. */
export function spellDistractors(units: readonly string[], lang: SpellLang, rand: () => number): string[] {
  const n = distractCount(units.length);
  const pairs = lang === 'pl' ? PL_PAIRS : RU_PAIRS;
  const have = new Set(units);
  const cand = [...new Set(units.flatMap((u) => pairs[u] ?? []))];
  // Пара, которой в слове нет (ą при a), путает сильнее, чем лишняя копия своей буквы.
  const fresh = shuffled(cand.filter((c) => !have.has(c)), rand);
  const out = fresh.slice(0, n);
  for (const c of shuffled(cand.filter((c) => have.has(c)), rand)) if (out.length < n) out.push(c);
  for (const c of shuffled(FILL[lang], rand)) {
    if (out.length >= 2) break;
    if (!have.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Плитки задания: буквы ответа + ловушки, перемешанные. */
export function spellTiles(units: readonly string[], lang: SpellLang, rand: () => number): string[] {
  return shuffled([...units, ...spellDistractors(units, lang, rand)], rand);
}

/** Значения русского перевода: «здравствуйте; добрый день» → оба, скобки убраны («кот (кошка)» → «кот»). */
export function ruVariants(ru: string): string[] {
  return ru
    .split(/[;,/]/)
    .map((s) => s.replace(/\([^)]*\)/g, '').replace(/[«»"„“”]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Русский ответ для сборки (PL→RU): первое значение. */
export const primaryRu = (ru: string): string => ruVariants(ru)[0] ?? ru.trim();

/** Русское слово годится для сборки из букв: кириллица (+ пробел, дефис), от 2 до 16 букв. */
export function ruSpellable(ru: string): boolean {
  const p = primaryRu(ru).toLowerCase();
  if (!/^[а-яё]+([ -][а-яё]+)*$/.test(p)) return false;
  const n = p.replace(/[ -]/g, '').length;
  return n >= 2 && n <= 16;
}

/** Только буквы, нижний регистр: сравнение сборки (пробелы и знаки ставит игра сама). */
export const lettersOf = (s: string, lang: SpellLang): string =>
  [...s.toLocaleLowerCase(lang)].filter((c) => (lang === 'pl' ? PL_LETTER : RU_LETTER).test(c)).join('');

/** Ряд ответа из выбранных плиток: слоты по порядку, знаки на своих местах; пустые слоты — «_». */
export function assemble(layout: readonly SpellCell[], picked: readonly string[]): string {
  let k = 0;
  return layout.map((c) => (c === null ? (picked[k++] ?? '_') : c)).join('');
}

export interface SpellGrade {
  ok: boolean;
  verdict: Verdict;
}

/**
 * Проверка. Плитки: буквы должны совпасть точно (ловушка ą вместо a — ошибка: в этом смысл игры).
 * Ввод с клавиатуры: как прежнее «напиши сам» — без диакритики, rz/ż, ó/u и опечатка в длинном слове засчитываются
 * (`verdict` не `exact`); у русского ё = е.
 */
export function gradeSpell(given: string, target: string, accept: readonly string[], lang: SpellLang, typed: boolean): SpellGrade {
  if (!typed) {
    const ok = lettersOf(given, lang) === lettersOf(target, lang) && lettersOf(given, lang).length > 0;
    return { ok, verdict: ok ? 'exact' : 'wrong' };
  }
  if (lang === 'ru') {
    const yo = (s: string): string => norm(s).replace(/ё/g, 'е');
    const g = yo(given);
    const ok = !!g && accept.some((a) => yo(a) === g);
    return { ok, verdict: ok ? 'exact' : 'wrong' };
  }
  const c = checkAnswer(given, accept, { diacritics: 'warn', ortho: true, typo: true });
  return { ok: c.verdict !== 'wrong', verdict: c.verdict };
}

export interface DiffChar {
  ch: string;
  bad: boolean;
}

/**
 * Где ошибка: общая подпоследовательность букв (без учёта регистра). `given` — что собрал игрок (лишние/не те буквы `bad`),
 * `correct` — правильный ответ (буквы, которых не хватило или которые перепутаны, `bad`).
 */
export function spellDiff(given: string, correct: string): { given: DiffChar[]; correct: DiffChar[] } {
  const a = [...given];
  const b = [...correct];
  const la = a.map((c) => c.toLowerCase());
  const lb = b.map((c) => c.toLowerCase());
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = la[i] === lb[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const okA = new Array<boolean>(n).fill(false);
  const okB = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) {
      okA[i++] = true;
      okB[j++] = true;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return { given: a.map((ch, k) => ({ ch, bad: !okA[k] && ch.trim() !== '' })), correct: b.map((ch, k) => ({ ch, bad: !okB[k] && ch.trim() !== '' })) };
}
