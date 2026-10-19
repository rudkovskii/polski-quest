// «Узнаваемые слова» (просьба Шэфа 19.10: «любое польское слово можно добавить в словарь отовсюду»): чистая логика.
// Разметка польского текста на слова, форма → лемма → русские переводы, статус слова (база A1 / Moje słowa / нет).
// Источники по порядку: свои слова, база A1 и тема «Święta» (`forms`), офлайн-словарь plru (Викисловарь, по требованию,
// `systems/platform/rupl.ts` → `createPlruLoader`), названия из игр v2 (`geo.*` с падежами), эвристика окончаний («возможно»).
// Без браузера: файл грузит платформа, экран — `ui/wordPick.ts`.
import type { Pos, Word } from '../types/content';
import { GENDERS, POS_OF, type Gender } from './customWords';
import { translit } from './translit';

// ───────────── разметка текста ─────────────

/** Кусок текста: слово (латиница с польскими буквами, внутри дефис или апостроф) или всё остальное (пробелы, знаки, цифры, кириллица). */
export interface Tok {
  text: string;
  word: boolean;
}

const L = '\\p{Script=Latin}';
const WORD_RE = new RegExp(`${L}+(?:[-'’]${L}+)*`, 'gu');

/** «Jeszcze Polska nie zginęła,» → [Jeszcze][ ][Polska][ ][nie][ ][zginęła][,]. Кириллица и цифры — не слова. Склейка кусков = исходный текст. */
export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let at = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const i = m.index ?? 0;
    // Буквы сразу после цифры или кириллицы («3go», «3-go», «11.XI») — не польское слово.
    const prev = text.slice(Math.max(0, i - 2), i);
    if (/[\p{N}\p{Script=Cyrillic}]$|[\p{N}][-.]$/u.test(prev)) continue;
    if (i > at) out.push({ text: text.slice(at, i), word: false });
    out.push({ text: m[0], word: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), word: false });
  // Соседние не-слова (после пропуска) склеиваем.
  const merged: Tok[] = [];
  for (const t of out) {
    const last = merged[merged.length - 1];
    if (last && !last.word && !t.word) last.text += t.text;
    else merged.push({ ...t });
  }
  return merged;
}

/** Только слова строки. */
export const wordsIn = (text: string): string[] => tokenize(text).filter((t) => t.word).map((t) => t.text);

/** Ключ поиска: NFC, нижний регистр, без кавычек и знаков по краям, апостроф один. */
export function normPl(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[­​]/g, '')
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
}

// ───────────── словарь plru ─────────────

/** Статья словаря: лемма как в Викисловаре (регистр важен: «Polska»), часть речи, род/вид, переводы, формы (сжатые, как в файле). */
export interface PlruEntry {
  lemma: string;
  pos: string;
  g: string;
  ru: string[];
  /** Формы через пробел относительно леммы (`decodeForm`). */
  forms: string;
  /** Порядок в файле: меньше — важнее (слова из текстов игры, потом по «базовости»). */
  rank: number;
}

/**
 * Словарь в памяти. Полной таблицы «форма → лемма» нет (340 тыс. форм ≈ 60 МБ на телефоне): статьи разложены по «основе» —
 * общему началу леммы и всех её форм (≥ 2 букв); форма ищется среди статей, чья основа — начало формы. Формы с иным началом
 * (jest ← być, mnie ← ja, lepszy ← dobry) лежат отдельной маленькой таблицей `odd`.
 */
export interface PlruDb {
  /** лемма в нижнем регистре → статьи (по важности). */
  lemmas: Map<string, PlruEntry[]>;
  /** основа в нижнем регистре → статьи. */
  stems: Map<string, PlruEntry[]>;
  /** форма с другим началом → статьи. */
  odd: Map<string, PlruEntry[]>;
  size: number;
}

/** «grób» + «2obu» → «grobu»: число в начале — сколько букв отрезать с конца леммы, дальше — что дописать. */
export function decodeForm(lemma: string, code: string): string {
  const m = /^(\d*)(.*)$/su.exec(code)!;
  const drop = Number(m[1] || 0);
  return (drop ? lemma.slice(0, Math.max(0, lemma.length - drop)) : lemma) + m[2];
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
  const a = m.get(k);
  if (!a) m.set(k, [v]);
  else if (!a.includes(v)) a.push(v);
};

/** Минимальная длина общего начала формы с леммой, при которой форма ищется по основе. */
const STEM_MIN = 2;

/** Файл `public/dict/plru.json.gz` после распаковки (формат — `Игра/data/rupl/src/build_plru.py`). Битый — null. */
export function parsePlru(raw: unknown): PlruDb | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = (raw as { d?: unknown }).d;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const lemmas = new Map<string, PlruEntry[]>();
  const stems = new Map<string, PlruEntry[]>();
  const odd = new Map<string, PlruEntry[]>();
  let size = 0;
  for (const [lemma, v] of Object.entries(d as Record<string, unknown>)) {
    if (!Array.isArray(v) || !lemma) continue;
    const [pos, g, ru, fs] = v as unknown[];
    const e: PlruEntry = {
      lemma,
      pos: typeof pos === 'string' ? pos : '',
      g: typeof g === 'string' ? g : '',
      ru: typeof ru === 'string' && ru ? ru.split('|').filter(Boolean) : [],
      forms: typeof fs === 'string' ? fs : '',
      rank: size++,
    };
    const low = lemma.toLowerCase();
    push(lemmas, normPl(lemma), e);
    if (!e.forms) continue;
    let common = low.length;
    for (const code of e.forms.split(' ')) {
      const m = /^\d*/.exec(code)![0];
      const c = low.length - Number(m || 0);
      if (c < STEM_MIN) push(odd, normPl(decodeForm(lemma, code)), e);
      else if (c < common) common = c;
    }
    push(stems, low.slice(0, common), e);
  }
  return size ? { lemmas, stems, odd, size } : null;
}

/** Статьи, у которых есть форма `q` (нижний регистр), по важности. */
export function entriesWithForm(db: PlruDb, q: string): PlruEntry[] {
  const out: PlruEntry[] = [...(db.odd.get(q) ?? [])];
  for (let n = STEM_MIN; n <= q.length; n++) {
    for (const e of db.stems.get(q.slice(0, n)) ?? []) {
      if (out.includes(e)) continue;
      if (e.forms.split(' ').some((code) => decodeForm(e.lemma, code).toLowerCase() === q)) out.push(e);
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// ───────────── слова игры ─────────────

/** Название из игр v2 (воеводство, город, река…) с падежами: перевод есть, но в словарь A1 оно не входит. */
export interface GameName {
  pl: string;
  ru: string;
  forms?: readonly string[];
}

export interface WordIndex {
  /** Слова базы (A1 и тема «Święta»): по лемме и по формам из `forms`. */
  byLemma: Map<string, Word[]>;
  byForm: Map<string, Word[]>;
  names: Map<string, GameName>;
}

/** Индекс слов игры (строится один раз; свои слова ищутся отдельно, их мало и они меняются). */
export function wordIndex(base: readonly Word[], names: readonly GameName[] = []): WordIndex {
  const byLemma = new Map<string, Word[]>();
  const byForm = new Map<string, Word[]>();
  for (const w of base) {
    push(byLemma, normPl(w.pl), w);
    for (const f of Object.values(w.forms ?? {})) for (const part of String(f).split(/[/,]/)) if (part.trim()) push(byForm, normPl(part), w);
  }
  const map = new Map<string, GameName>();
  const put = (k: string, n: GameName): void => {
    if (k && !map.has(k)) map.set(k, n);
  };
  for (const n of names) for (const f of [n.pl, ...(n.forms ?? [])]) put(normPl(f), n);
  // Слова многословных названий и падежей («w Gorzowie Wielkopolskim» → Gorzowie, Wielkopolskim) — после целых названий.
  for (const n of names) for (const f of [n.pl, ...(n.forms ?? [])]) for (const t of wordsIn(f)) if (t.length >= 3) put(normPl(t), n);
  return { byLemma, byForm, names: map };
}

// ───────────── эвристика окончаний ─────────────

/**
 * Окончание → чем заменить (по порядку попыток). Таблица грубая: годится только кандидат, который нашёлся в словаре или базе,
 * и тогда слово помечается «возможно». Длинные окончания раньше коротких.
 */
export const ENDINGS: readonly (readonly [string, readonly string[]])[] = [
  // глагол: прошедшее время и настоящее
  ['liśmy', ['ć']], ['łyśmy', ['ć']], ['liście', ['ć']], ['łyście', ['ć']],
  ['ęłam', ['ąć']], ['ęłaś', ['ąć']], ['ęła', ['ąć']], ['ęło', ['ąć']], ['ęli', ['ąć']], ['ęły', ['ąć']], ['ąłem', ['ąć']], ['ął', ['ąć']],
  ['iałem', ['ieć']], ['iałam', ['ieć']], ['iała', ['ieć']], ['iało', ['ieć']], ['ieli', ['ieć']], ['iały', ['ieć']], ['iał', ['ieć']],
  ['łem', ['ć']], ['łam', ['ć']], ['łeś', ['ć']], ['łaś', ['ć']], ['ła', ['ć']], ['ło', ['ć']], ['li', ['ć']], ['ły', ['ć']], ['ł', ['ć']],
  ['ujemy', ['ować']], ['ujecie', ['ować']], ['ujesz', ['ować']], ['uję', ['ować']], ['uje', ['ować']], ['ują', ['ować']],
  ['ajcie', ['ać']], ['acie', ['ać']], ['amy', ['ać']], ['asz', ['ać']], ['ają', ['ać']],
  ['iecie', ['ić', 'ieć']], ['iemy', ['ić', 'ieć']], ['iesz', ['ić', 'ieć']], ['ecie', ['eć', 'ać']], ['emy', ['eć', 'ać']], ['esz', ['eć', 'ać']],
  ['icie', ['ić', 'ieć']], ['imy', ['ić', 'ieć']], ['isz', ['ić', 'ieć']], ['ycie', ['yć', 'eć']], ['ymy', ['yć', 'eć']], ['ysz', ['yć', 'eć']],
  // прилагательное
  ['iego', ['i']], ['iemu', ['i']], ['imi', ['i']], ['ich', ['i', 'a', 'e']], ['iej', ['i']],
  ['ego', ['y', 'i']], ['emu', ['y', 'i']], ['ymi', ['y']], ['ych', ['y']], ['ej', ['y', 'a']], ['ym', ['y']], ['im', ['i']],
  // существительное
  ['ami', ['a', '', 'o', 'e', 'y']], ['ach', ['a', '', 'o', 'e', 'y', 'i']], ['iem', ['', 'k']], ['owi', ['']], ['ów', ['', 'a', 'y']],
  ['om', ['a', '', 'o']], ['em', ['', 'o', 'e']], ['ie', ['a', '', 'o']], ['ce', ['ka']], ['dze', ['ga']],
  ['ę', ['a', 'ać', 'ić', 'eć']], ['ą', ['a', 'y', 'i', 'ać', 'ić']], ['y', ['a', '', 'o', 'y']], ['i', ['a', '', 'o', 'ia', 'ić']],
  ['u', ['', 'o']], ['a', ['', 'o', 'y', 'ać']], ['e', ['o', 'a', 'y', 'eć']], ['o', ['a', 'ać']], ['m', ['ć']],
];

/** Чередования в основе: «grob» → «gród»-подобное «gró b», «zęb» → «ząb», «pszczół» ← «pszczoł»… */
function stemVariants(stem: string): string[] {
  const out = [stem];
  const m = /^(.*)o([^aeiouyąęó]+)$/u.exec(stem);
  if (m) out.push(`${m[1]}ó${m[2]}`);
  const n = /^(.*)ę([^aeiouyąęó]+)$/u.exec(stem);
  if (n) out.push(`${n[1]}ą${n[2]}`);
  return out;
}

/** Кандидаты в лемму по окончанию (без проверки): «grobach» → [groba, grob, grób, …]. */
export function guessLemmas(form: string): string[] {
  const q = normPl(form);
  const out: string[] = [];
  for (const [end, reps] of ENDINGS) {
    if (!q.endsWith(end) || q.length - end.length < 2) continue;
    const stem = q.slice(0, q.length - end.length);
    for (const s of stemVariants(stem)) for (const r of reps) if (!out.includes(s + r) && s + r !== q) out.push(s + r);
  }
  return out;
}

// ───────────── поиск слова ─────────────

export type PickVia = 'custom' | 'base' | 'dict' | 'name' | 'none';

export interface WordInfo {
  /** Как в тексте. */
  surface: string;
  /** Начальная форма (как в словаре; у слова игры — как в базе). */
  lemma: string;
  pos?: Pos;
  /** Род существительного. */
  gender?: Gender;
  /** Вид глагола. */
  aspect?: 'pf' | 'ipf';
  /** 1–3 русских перевода (пусто — перевода нет). */
  ru: string[];
  /** Транскрипция леммы кириллицей. */
  tr: string;
  /** Лемма угадана по окончанию: «возможно». */
  guess: boolean;
  /** Откуда: своё слово, база игры, словарь, название из игр v2, ничего. */
  via: PickVia;
  /** Слово игры с этой леммой (база A1, «Święta» или своё): от него статус «уже в словаре». */
  word?: Word;
}

export interface LookupCtx {
  db: PlruDb | null;
  index: WordIndex;
  /** Свои слова (Moje słowa), новые первыми. */
  customs: readonly Word[];
}

const posOf = (code: string): Pos | undefined => (code ? POS_OF[code] : undefined);

/** «здравствуйте; добрый день (днём)» → [здравствуйте, добрый день]: значения без скобок, до трёх. */
export function splitRu(ru: string): string[] {
  const parts = ru.replace(/\([^)]*\)/g, ' ').split(/[;,]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(parts.length ? parts : [ru.trim()])].slice(0, 3);
}

function fromWord(surface: string, w: Word, via: 'custom' | 'base', guess: boolean): WordInfo {
  const ru = splitRu(w.ru);
  return {
    surface,
    lemma: w.pl,
    pos: w.pos,
    ...(w.gender ? { gender: w.gender } : {}),
    ru,
    tr: w.tr || translit(w.pl),
    guess,
    via,
    word: w,
  };
}

function fromEntry(surface: string, e: PlruEntry, guess: boolean, word?: Word): WordInfo {
  const pos = posOf(e.pos);
  return {
    surface,
    lemma: e.lemma,
    ...(pos ? { pos } : {}),
    ...(pos === 'noun' && GENDERS.has(e.g) ? { gender: e.g as Gender } : {}),
    ...(pos === 'verb' && (e.g === 'pf' || e.g === 'ipf') ? { aspect: e.g } : {}),
    ru: e.ru.slice(0, 3),
    tr: translit(e.lemma),
    guess,
    via: 'dict',
    ...(word ? { word } : {}),
  };
}

/** Своё слово с такой леммой или формой (только однословные). */
const customOf = (customs: readonly Word[], key: string): Word | undefined => customs.find((w) => normPl(w.pl) === key);

/** Слово игры по лемме: своё раньше базы. */
function gameWord(ctx: LookupCtx, lemma: string): { w: Word; via: 'custom' | 'base' } | null {
  const k = normPl(lemma);
  const c = customOf(ctx.customs, k);
  if (c) return { w: c, via: 'custom' };
  const b = ctx.index.byLemma.get(k)?.[0];
  return b ? { w: b, via: 'base' } : null;
}

/** Первая статья с переводом (у «ze» своей статьи без перевода, а форма «z» — с переводом), иначе первая. */
const best = (list: readonly PlruEntry[] | undefined): PlruEntry | undefined => list?.find((e) => e.ru.length) ?? list?.[0];

const isCap = (e: PlruEntry): boolean => /^\p{Lu}/u.test(e.lemma);

/**
 * Статья словаря для формы: «Polska» с заглавной — имя собственное, «polska» строчными — форма «polski»; «ze» — своя статья без перевода,
 * но форма «z» с переводом. Порядок кандидатов (с заглавной: имена раньше) → первый с переводом, иначе первый.
 */
export function dictPick(db: PlruDb, q: string, cap: boolean): PlruEntry | undefined {
  // Своя статья и статьи, где это форма, — вместе по важности: «jest» — форма «być», а не редкое существительное «jest».
  const all = [...(db.lemmas.get(q) ?? []), ...entriesWithForm(db, q)].filter((e, i, a) => a.indexOf(e) === i).sort((a, b) => a.rank - b.rank);
  const ordered = cap ? [...all.filter(isCap), ...all.filter((e) => !isCap(e))] : [...all.filter((e) => !isCap(e)), ...all.filter(isCap)];
  return ordered.find((e) => e.ru.length) ?? ordered[0];
}

/** Лемма в словаре или базе для проверенного кандидата эвристики. */
function knownLemma(ctx: LookupCtx, cand: string): WordInfo | null {
  const g = gameWord(ctx, cand);
  if (g) return fromWord('', g.w, g.via, true);
  const e = best(ctx.db?.lemmas.get(cand));
  return e ? fromEntry('', e, true) : null;
}

/**
 * Слово из текста → лемма, перевод, статус. Порядок: своё слово → база игры (лемма, потом формы) → словарь (лемма, потом формы;
 * если лемма словаря есть в игре — статус от слова игры, перевод из базы) → названия из игр v2 → эвристика окончаний («возможно»)
 * → ничего (лемма = само слово, перевода нет; лемму можно поправить руками в карточке).
 */
export function lookupPl(surface: string, ctx: LookupCtx): WordInfo {
  const q = normPl(surface);
  const none: WordInfo = { surface, lemma: q, ru: [], tr: translit(q), guess: false, via: 'none' };
  if (!q) return none;
  const cap = /^\p{Lu}/u.test(surface.trim());
  const g = gameWord(ctx, q);
  // «polska» строчными — форма «polski», а не «Polska» из базы: имя собственное берём сразу только с заглавной.
  const later = g && /^\p{Lu}/u.test(g.w.pl) && !cap ? g : null;
  if (g && !later) return fromWord(surface, g.w, g.via, false);
  const bf = ctx.index.byForm.get(q)?.[0];
  if (bf) return fromWord(surface, bf, 'base', false);
  const pick = ctx.db ? dictPick(ctx.db, q, /^\p{Lu}/u.test(surface.trim())) : undefined;
  if (pick) {
    const gw = gameWord(ctx, pick.lemma);
    if (gw) return { ...fromWord(surface, gw.w, gw.via, false), ...(gw.w.ru ? {} : { ru: pick.ru.slice(0, 3) }) };
  }
  if (pick?.ru.length) return fromEntry(surface, pick, false);
  // Название из игр v2 (Malbork, Gorzów, małopolskie): перевод есть в данных игры, даже если в словаре статья без перевода.
  const nm = ctx.index.names.get(q);
  if (nm) return { surface, lemma: nm.pl, pos: 'noun', ru: [nm.ru], tr: translit(nm.pl), guess: false, via: 'name' };
  if (later) return fromWord(surface, later.w, later.via, false);
  if (pick) return fromEntry(surface, pick, false);
  for (const cand of guessLemmas(q)) {
    const k = knownLemma(ctx, cand);
    if (k) return { ...k, surface };
  }
  return none;
}

// ───────────── статус ─────────────

export type PickStatus =
  /** Слово базы игры (A1 или тема «Święta»): посадить или «растёт». */
  | { kind: 'base'; word: Word; a1: boolean }
  /** Своё слово (Moje słowa). */
  | { kind: 'custom'; word: Word }
  /** В словаре игры нет: «＋ В словарь». */
  | { kind: 'none' };

/** Статус слова для поповера: `isA1` — входит ли слово базы в путь к A1. */
export function statusOf(info: WordInfo, isA1: (id: string) => boolean, isCustom: (id: string) => boolean): PickStatus {
  const w = info.word;
  if (!w) return { kind: 'none' };
  if (isCustom(w.id)) return { kind: 'custom', word: w };
  return { kind: 'base', word: w, a1: isA1(w.id) };
}
