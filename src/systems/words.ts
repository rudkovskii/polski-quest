// Слова в репликах (P-07, ПОЛИРОВКА §2.7, research/05 §6б п. 4): разбор строки на слова, поиск слов
// в vocab (pl, forms, фразы из нескольких слов), «знакомо ли слово» по SRS и правило гаснущей подписи.
// Чистое: без DOM. Читают окно реплики (src/ui/dialog/line.ts) и валидатор (разметка `words`).
import type { LineWord, VocabEntry } from '../types/content';
import type { CardState } from './progress';

/** Слово знакомо, когда карточка узнавания (`rec`) держится с интервалом от стольких дней. */
export const FAMILIAR_DAYS = 3;

/** Режим подписи-перевода (настройка `translations`): `tap` — старое значение до P-07, читается как `auto`. */
export type CaptionMode = 'auto' | 'always' | 'never';

export function captionMode(setting: string | undefined): CaptionMode {
  return setting === 'always' || setting === 'never' ? setting : 'auto';
}

export interface Token {
  text: string;
  start: number;
  end: number;
  /** Слово (буквы), а не пробел или знак. */
  word: boolean;
}

// Буквы с диакритикой, внутри слова допустимы дефис и апостроф («Bielsko-Biała»).
const WORD_RE = /[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), start: last, end: i, word: false });
    out.push({ text: m[0], start: i, end: i + m[0].length, word: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), start: last, end: text.length, word: false });
  return out;
}

export const normWord = (s: string): string => s.normalize('NFC').toLocaleLowerCase('pl');

/** Ключ формы: слова через пробел в нижнем регистре («Dzień dobry!» → «dzień dobry»). */
export function formKey(s: string): string {
  return tokenize(s)
    .filter((t) => t.word)
    .map((t) => normWord(t.text))
    .join(' ');
}

/** Латиница (польское слово) в русской реплике Казика. */
export function isLatin(word: string): boolean {
  return /[a-ząćęłńóśźż]/i.test(word) && !/[а-яё]/i.test(word);
}

export interface WordIndex {
  /** Ключ формы → id слова (первое по порядку файлов). */
  byForm: ReadonlyMap<string, string>;
  /** id слова → ключи его форм. */
  forms: ReadonlyMap<string, readonly string[]>;
  /** Самая длинная фраза в словах. */
  maxLen: number;
}

export function buildWordIndex(vocab: Iterable<Pick<VocabEntry, 'id' | 'pl' | 'forms'>>): WordIndex {
  const byForm = new Map<string, string>();
  const forms = new Map<string, string[]>();
  let maxLen = 1;
  for (const v of vocab) {
    const keys: string[] = [];
    for (const f of [v.pl, ...Object.values(v.forms ?? {})]) {
      const k = formKey(f);
      if (!k || keys.includes(k)) continue;
      keys.push(k);
      if (!byForm.has(k)) byForm.set(k, v.id);
      maxLen = Math.max(maxLen, k.split(' ').length);
    }
    forms.set(v.id, keys);
  }
  return { byForm, forms, maxLen };
}

export interface WordSpan {
  start: number;
  end: number;
  text: string;
  /** Слово из vocab; нет — слова в словаре нет (тап покажет перевод строки). */
  lx?: string;
  /** Слово из разметки `words` строки. */
  marked?: boolean;
}

/** Разметка `words` строки → ключ формы → id (своя форма из `{pl, lx}` или формы слова из словаря). */
function localForms(refs: readonly LineWord[], index: WordIndex): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of refs) {
    if (typeof r === 'string') for (const k of index.forms.get(r) ?? []) m.set(k, r);
    else m.set(formKey(r.pl), r.lx);
  }
  return m;
}

export interface MatchOpts {
  /** Разметка `words` строки (P-07). */
  refs?: readonly LineWord[];
  /** Какие слова считать польскими (у Казика — только латиница). По умолчанию все. */
  only?: (word: string) => boolean;
}

/**
 * Польские слова строки с id из словаря: сначала разметка `words`, потом словарь; фраза из нескольких
 * слов (до `maxLen`) берётся целиком, если между словами только пробелы.
 */
export function matchWords(text: string, index: WordIndex, opts: MatchOpts = {}): WordSpan[] {
  const local = localForms(opts.refs ?? [], index);
  const toks = tokenize(text);
  const words = toks.filter((t) => t.word);
  const only = opts.only ?? (() => true);
  const out: WordSpan[] = [];
  const maxLen = Math.max(index.maxLen, ...[...local.keys()].map((k) => k.split(' ').length));
  for (let i = 0; i < words.length; ) {
    const w = words[i]!;
    if (!only(w.text)) {
      i++;
      continue;
    }
    let hit: { n: number; lx: string; marked: boolean } | null = null;
    for (let n = Math.min(maxLen, words.length - i); n >= 1 && !hit; n--) {
      const seq = words.slice(i, i + n);
      if (!seq.every((t) => only(t.text))) continue;
      // Фраза только через пробелы: «Dzień dobry», но не «dzień. Dobry».
      if (seq.some((t, j) => j > 0 && text.slice(seq[j - 1]!.end, t.start).trim() !== '')) continue;
      const key = seq.map((t) => normWord(t.text)).join(' ');
      const l = local.get(key);
      if (l) hit = { n, lx: l, marked: true };
      else {
        const g = index.byForm.get(key);
        if (g) hit = { n, lx: g, marked: false };
      }
    }
    if (hit) {
      const last = words[i + hit.n - 1]!;
      out.push({ start: w.start, end: last.end, text: text.slice(w.start, last.end), lx: hit.lx, ...(hit.marked ? { marked: true } : {}) });
      i += hit.n;
    } else {
      out.push({ start: w.start, end: w.end, text: w.text });
      i++;
    }
  }
  return out;
}

/** id слов разметки `words`. */
export function refIds(refs: readonly LineWord[] | undefined): string[] {
  return (refs ?? []).map((r) => (typeof r === 'string' ? r : r.lx));
}

/**
 * Слово знакомо: карточка `rec` с интервалом ≥ FAMILIAR_DAYS. Имена (`pos: name`: Warszawa, Kraków)
 * перевода не требуют и считаются знакомыми; остальные слова без карточек (`srs: false`) — нет.
 */
export function isFamiliar(cards: Readonly<Record<string, CardState>>, lx: string, entry?: Pick<VocabEntry, 'pos'>, days = FAMILIAR_DAYS): boolean {
  if (entry?.pos === 'name') return true;
  const c = cards[`${lx}#rec`];
  return !!c && c.interval >= days;
}

/**
 * Скрыть подпись-перевод строки (P-07): `always` — никогда, `never` — всегда (остаётся «?»), `auto` —
 * когда все значимые слова знакомы. Значимые = разметка `words`, если она есть; иначе все слова строки,
 * кроме `ignore` (имена), и тогда каждое должно найтись в словаре: незнакомое словарю слово держит подпись.
 */
export function captionHidden(
  mode: CaptionMode,
  spans: readonly WordSpan[],
  known: (lx: string) => boolean,
  opts: { refs?: readonly LineWord[]; ignore?: (word: string) => boolean } = {},
): boolean {
  if (mode === 'always') return false;
  if (mode === 'never') return true;
  const ids = refIds(opts.refs);
  if (ids.length) return ids.every(known);
  const sig = spans.filter((s) => s.lx || !opts.ignore?.(s.text));
  return sig.length > 0 && sig.every((s) => !!s.lx && known(s.lx));
}
