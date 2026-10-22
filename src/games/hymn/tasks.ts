// Задания «Hymn i symbole»: чистая логика (без DOM), по просьбе движка (`Want`) строит задание, `check` проверяет ответ.
// Гимн (решение Шэфа 18.10: знать текст, перевод только справкой): gap (uzupełnij), next (co dalej), order (kolejność строк/куплетов),
// tiles («Jaki jest następny wers?» — собрать следующую строку из плиток-слов по предыдущей; 22.10 заменило караоке: никакой музыки и нот в игре нет).
// Видов mean/gloss/line у строк больше нет. Символы: q (вопрос-шаблон), whose (czyj symbol), tiles, order (Lech), flag и godlo (сборка тап-тап).
import type { GameCheck, GameCtx, GameTask, PolskaUnit, Want } from '../../types/polska';
import { distractUnits, sameTiles, shuffle, wordsOf } from '../kit';

export type HymnMode = 'choice' | 'tiles' | 'order' | 'flag' | 'godlo';
/** Тип задания внутри режима (для тестов и подсказок). */
export type HymnKind = 'gap' | 'next' | 'mean' | 'q' | 'whose' | 'tiles' | 'order-lines' | 'order-stanzas' | 'order-lech' | 'flag' | 'godlo';

export interface HymnTask extends GameTask {
  mode: HymnMode;
  kind: HymnKind;
  prompt: string;
  lang: 'pl' | 'ru';
  hint?: string;
  /** Короткий заголовок задания по-польски над строкой-опорой («Jaki jest następny wers?»). */
  title?: string;
  /** choice: варианты; tiles/order: плитки; flag/godlo: не используется. */
  options: string[];
  /** choice: строка; tiles/order: слова или строки по порядку; flag/godlo: правильные части. */
  answer: string | string[] | Record<string, string>;
  /** Картинка-эмодзи «Czyj to symbol?». */
  pic?: string;
  /** flag/godlo: варианты частей. */
  parts?: Record<string, string[]>;
  /** Полный польский текст, который показать как «правильно». */
  full: string;
  /** Справка после ответа: старые слова строки с переводом («pono — говорят»). Не спрашивается. */
  fact?: string;
}

const VERSES = ['s1', 's2', 's3', 's4'] as const;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const pickOf = <T>(xs: readonly T[], rand: () => number): T => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))]!;

/** Куплет строки: `hymn.s2.3` → `s2`. */
export const stanzaOf = (id: string): string => id.split('.')[1] ?? 's1';
/** Номер строки в куплете: `hymn.s2.3` → 3. */
export const posOf = (id: string): number => Number(id.split('.')[2] ?? 1);

/** Следующая строка по порядку исполнения; у последней строки припева (дальше любой куплет) нет. */
export function nextLineId(id: string): string | null {
  const s = stanzaOf(id);
  const n = posOf(id);
  if (n < 4) return `hymn.${s}.${n + 1}`;
  return s === 'ref' ? null : 'hymn.ref.1';
}

/** Старые формы в глоссе: «= przejdziemy, перейдём» → «перейдём». */
export function cleanGloss(ru: string): string {
  const t = ru.trim();
  if (!t.startsWith('=')) return t;
  const i = t.indexOf(',');
  return (i >= 0 ? t.slice(i + 1) : t.slice(1)).trim();
}

const lineData = (u: PolskaUnit): { tiles: string[]; distract: string[]; gloss: { pl: string; ru: string }[]; gap: { word: string; options: string[] } | null } => {
  const r = u.raw;
  const g = obj(r.gap);
  const tiles = strs(r.tiles_pl);
  return {
    tiles: tiles.length ? tiles : wordsOf(u.pl),
    distract: strs(r.distract_pl),
    gloss: Array.isArray(r.gloss) ? r.gloss.map((x) => ({ pl: String(obj(x).pl ?? ''), ru: String(obj(x).ru ?? '') })).filter((x) => x.pl && x.ru) : [],
    gap: typeof g.word === 'string' ? { word: g.word, options: strs(g.options) } : null,
  };
};

const sameStr = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Строка с пропуском: слово заменено на «____». */
export function gapText(pl: string, word: string): string {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}])${esc}(?=$|[^\\p{L}])`, 'iu');
  return re.test(pl) ? pl.replace(re, (_m, pre: string) => `${pre}____`) : `${pl} (____ = ${word})`;
}

const ruOf = (ctx: GameCtx, id: string): string => ctx.unit(id)?.ru ?? '';

/** До `n` вариантов из `pool`, не равных ни одному из `not`, без повторов. */
function others(pool: readonly string[], not: readonly string[], n: number, rand: () => number): string[] {
  const out: string[] = [];
  for (const x of shuffle(pool, rand)) {
    if (out.length >= n) break;
    if (!x.trim() || [...not, ...out].some((y) => sameStr(x, y))) continue;
    out.push(x);
  }
  return out;
}

/** Перемешать так, чтобы порядок отличался от правильного. */
function scramble(items: readonly string[], rand: () => number): string[] {
  let a = shuffle(items, rand);
  for (let i = 0; i < 6 && a.join('|') === items.join('|'); i++) a = shuffle(items, rand);
  if (a.join('|') === items.join('|') && a.length > 1) a = [...a.slice(1), a[0]!];
  return a;
}

const base = (u: PolskaUnit, side: 'A' | 'B', self: boolean): Pick<HymnTask, 'id' | 'side' | 'self'> => ({ id: u.id, side, ...(self ? { self: true } : {}) });

// ───────────────────────── гимн ─────────────────────────

/** Как далеко строка выросла: none — не посажена, seed — семечко, sprout — росток, up — кустик и дальше (или уже был урожай). */
const lineStage = (ctx: GameCtx, id: string): 'none' | 'seed' | 'sprout' | 'up' => {
  const i = ctx.info(id);
  if (i.harvests > 0 || i.stage === 'bush' || i.stage === 'overripe') return 'up';
  if (i.stage === 'sprout') return 'sprout';
  return i.planted ? 'seed' : 'none';
};

/** Русская подсказка вместо предыдущей строки: «Начало гимна», «Начало припева», «Начало 2-го куплета». */
export function startCue(stanza: string): string {
  if (stanza === 's1') return 'Начало гимна';
  if (stanza === 'ref') return 'Начало припева';
  return `Начало ${stanza.slice(1)}-го куплета`;
}

function hymnLineTask(ctx: GameCtx, u: PolskaUnit, want: Want): HymnTask | null {
  const rand = ctx.rand;
  const lines = ctx.units.filter((x) => x.kind === 'hymn');
  const d = lineData(u);
  const st = stanzaOf(u.id);
  const mate = lines.filter((x) => stanzaOf(x.id) === st);
  const full = u.pl;
  const fact = d.gloss.map((g) => `${g.pl} — ${cleanGloss(g.ru)}`).join(' · ');
  const withFact = (t: HymnTask | null): HymnTask | null => (t && fact ? { ...t, fact } : t);

  const gap = (): HymnTask | null => {
    if (!d.gap || d.gap.options.length < 2) return null;
    const opts = d.gap.options.includes(d.gap.word) ? d.gap.options : [d.gap.word, ...d.gap.options];
    return { ...base(u, 'A', false), mode: 'choice', kind: 'gap', prompt: gapText(u.pl, d.gap.word), lang: 'pl', hint: 'Uzupełnij · Выбери пропущенное слово', options: shuffle(opts, rand), answer: d.gap.word, full };
  };
  /** Пропуск в любом слове строки (≥ 3 букв), варианты из лишних слов строки и слов гимна: запас, если в данных пропуска нет. */
  const autoGap = (): HymnTask | null => {
    const cand = d.tiles.filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 3);
    if (!cand.length) return null;
    const word = pickOf(cand, rand);
    const near = others(d.distract, [word], 2, rand);
    const rest = others(lines.flatMap((x) => lineData(x).tiles), [word, ...near, ...d.tiles], 2 - near.length, rand);
    const opts = [word, ...near, ...rest];
    if (opts.length < 3) return null;
    return { ...base(u, 'A', false), mode: 'choice', kind: 'gap', prompt: gapText(u.pl, word), lang: 'pl', hint: 'Uzupełnij · Выбери пропущенное слово', options: shuffle(opts, rand), answer: word, full };
  };
  const next = (): HymnTask | null => {
    const nid = nextLineId(u.id);
    const nu = nid ? ctx.unit(nid) : undefined;
    if (!nu) return null;
    const near = others(mate.map((x) => x.pl), [u.pl, nu.pl], 2, rand);
    const rest = others(lines.map((x) => x.pl), [u.pl, nu.pl, ...near], 2 - near.length, rand);
    const opts = shuffle([nu.pl, ...near, ...rest], rand);
    return { ...base(u, 'A', false), mode: 'choice', kind: 'next', prompt: u.pl, lang: 'pl', hint: 'Co dalej? · Выбери строку, которая идёт следом', options: opts, answer: nu.pl, full: nu.pl };
  };
  const orderLines = (): HymnTask | null => {
    if (mate.length < 3 || !mate.every((x) => ['sprout', 'up'].includes(lineStage(ctx, x.id)))) return null;
    const ordered = mate.map((x) => x.pl);
    return { ...base(u, 'A', false), mode: 'order', kind: 'order-lines', prompt: 'Kolejność wersów', lang: 'pl', hint: `${stanzaRu(ctx, st)}: расставь строки по порядку, как в гимне`, options: scramble(ordered, rand), answer: ordered, full: ordered.join(' ') };
  };
  const orderStanzas = (): HymnTask | null => {
    const ripe = VERSES.filter((v) => lines.filter((x) => stanzaOf(x.id) === v).length === 4 && lines.filter((x) => stanzaOf(x.id) === v).every((x) => lineStage(ctx, x.id) === 'up'));
    if (ripe.length < 2 || !ripe.includes(st as (typeof VERSES)[number])) return null;
    const firsts = ripe.map((v) => lines.find((x) => x.id === `hymn.${v}.1`)!.pl);
    return { ...base(u, 'A', false), mode: 'order', kind: 'order-stanzas', prompt: 'Kolejność zwrotek', lang: 'pl', hint: 'Расставь куплеты по порядку (между ними — припев). У каждого показана первая строка', options: scramble(firsts, rand), answer: firsts, full: firsts.join(' · ') };
  };

  /** Опора: предыдущая строка по-польски (как в песне); у первой строки куплета, припева и всего гимна — русская подсказка, откуда начало. */
  const prev = posOf(u.id) > 1 ? ctx.unit(`hymn.${st}.${posOf(u.id) - 1}`) : undefined;
  const cue = prev ? `… ${prev.pl}` : startCue(st);
  const tilesTask = (side: 'A' | 'B', self: boolean): HymnTask => {
    // Плитки: слова строки + лишние похожей формы (дистракторы из данных, при нехватке — слова соседних строк). Для «сам» — 3, иначе 1.
    const near = others(d.distract, d.tiles, self ? 3 : 1, rand);
    const rest = others(mate.flatMap((x) => lineData(x).tiles), [...d.tiles, ...near], self ? 3 - near.length : 0, rand);
    const pool = shuffle([...d.tiles, ...near, ...rest], rand);
    return {
      ...base(u, side, self), mode: 'tiles', kind: 'tiles', prompt: cue, lang: prev ? 'pl' : 'ru', options: pool, answer: d.tiles, full,
      title: prev ? 'Jaki jest następny wers?' : 'Jaki jest pierwszy wers?',
      hint: prev ? 'Собери следующую строку из слов' : 'Собери первую строку из слов',
    };
  };

  if (want.side === 'A') {
    // Решение Шэфа 18.10: гимн надо знать текстом, перевод — только справка после ответа. Заданий «что значит» и «строка по переводу» нет.
    const menu: (() => HymnTask | null)[] = want.stage === 'seed' ? [gap, autoGap, next, gap] : [next, gap, orderLines, autoGap, orderStanzas, next];
    for (let i = 0; i < 8; i++) {
      const t = pickOf(menu, rand)();
      if (t) return withFact(t);
    }
    return withFact(gap() ?? next() ?? autoGap() ?? tilesTask('A', false));
  }

  // B: вспомнить и собрать следующую строку из плиток по предыдущей (как в песне); «сам» — с тремя лишними словами вместо одного.
  return withFact(tilesTask('B', !!want.self));
}

function stanzaRu(ctx: GameCtx, id: string): string {
  const arr = obj(ctx.doc).stanzas;
  const s = Array.isArray(arr) ? arr.find((x) => obj(x).id === id) : undefined;
  return String(obj(s).ru ?? id);
}

// ───────────────────────── символы ─────────────────────────

interface Question {
  q: string;
  q_ru: string;
  a: string;
  wrong: string[];
}

const questionsOf = (u: PolskaUnit): Question[] =>
  Array.isArray(u.raw.questions)
    ? u.raw.questions
        .map((x) => ({ q: String(obj(x).q ?? ''), q_ru: String(obj(x).q_ru ?? ''), a: String(obj(x).a ?? ''), wrong: strs(obj(x).wrong) }))
        .filter((x) => x.q && x.a && x.wrong.length)
    : [];

const WHOSE_PIC: Record<string, string> = { orzel: '🦅', syrenka: '🧜‍♀️', zubr: '🦬', smok_wawelski: '🐉' };
const COLORS = ['biały', 'czerwony', 'niebieski', 'zielony'];

function symbolTask(ctx: GameCtx, u: PolskaUnit, want: Want): HymnTask | null {
  const rand = ctx.rand;
  const full = u.pl;
  const qs = questionsOf(u);
  const symbols = ctx.units.filter((x) => x.kind === 'symbol');
  const build = obj(u.raw.build);

  const ask = (side: 'A' | 'B'): HymnTask | null => {
    // «Czyj to symbol?» с картинкой: все четыре ответа из справочника.
    const pool = Array.isArray(ctx.doc.whose_pool) ? (ctx.doc.whose_pool as unknown[]).map((x) => ({ pic: String(obj(x).pic ?? ''), a: String(obj(x).a ?? '') })) : [];
    const mine = pool.find((x) => u.id === `symbol.${x.pic}`);
    if (u.type === 'whose' && mine && side === 'A' && pool.length >= 3) {
      return { ...base(u, 'A', false), mode: 'choice', kind: 'whose', prompt: 'Czyj to symbol?', lang: 'pl', hint: 'Чей это символ? Выбери ответ', options: shuffle(pool.map((x) => x.a), rand), answer: mine.a, pic: WHOSE_PIC[mine.pic] ?? '❓', full };
    }
    if (!qs.length) return null;
    const q = pickOf(qs, rand);
    const options = shuffle([q.a, ...q.wrong.slice(0, 3)], rand);
    return side === 'A'
      ? { ...base(u, 'A', false), mode: 'choice', kind: 'q', prompt: q.q, lang: 'pl', hint: q.q_ru, options, answer: q.a, full }
      : { ...base(u, 'B', false), mode: 'choice', kind: 'q', prompt: q.q_ru, lang: 'ru', hint: 'Odpowiedz po polsku · Выбери ответ по-польски', options, answer: q.a, full };
  };

  if (want.side === 'A') return ask('A');

  if (want.self) {
    if (u.type === 'build' && typeof build.top === 'string') {
      const parts = { top: COLORS, bottom: COLORS };
      return { ...base(u, 'B', true), mode: 'flag', kind: 'flag', prompt: 'Złóż flagę', lang: 'pl', hint: `${u.ru} Выбери цвета`, options: [], answer: { top: String(build.top), bottom: String(build.bottom) }, parts, full };
    }
    if (u.type === 'build' && typeof build.field === 'string') {
      const parts = { field: strs(build.fieldOptions), eagle: strs(build.eagleOptions), crown: strs(build.crownOptions) };
      return { ...base(u, 'B', true), mode: 'godlo', kind: 'godlo', prompt: 'Złóż godło', lang: 'pl', hint: `${u.ru} Выбери части`, options: [], answer: { field: String(build.field), eagle: String(build.eagle), crown: String(build.crown) }, parts, full };
    }
    if (u.type === 'order' && Array.isArray(u.raw.order)) {
      const items = (u.raw.order as unknown[]).map((x) => String(obj(x).pl ?? '')).filter(Boolean);
      if (items.length >= 2) return { ...base(u, 'B', true), mode: 'order', kind: 'order-lech', prompt: u.ru, lang: 'ru', hint: 'Kolejność · Расставь события легенды по порядку', options: scramble(items, rand), answer: items, full: items.join(' ') };
    }
    const words = strs(u.raw.tiles_pl);
    const tiles = words.length ? words : wordsOf(u.pl);
    const extra = others(strs(u.raw.distract_pl), tiles, 2, rand);
    const more = extra.length < 2 ? others(symbols.flatMap((x) => strs(x.raw.tiles_pl)), [...tiles, ...extra], 2 - extra.length, rand) : [];
    return { ...base(u, 'B', true), mode: 'tiles', kind: 'tiles', prompt: u.ru, lang: 'ru', hint: 'Jak to powiedzieć? · Собери эту фразу по-польски из слов', options: shuffle([...tiles, ...extra, ...more], rand), answer: tiles, full };
  }
  return ask('B') ?? null;
}

// ───────────────────────── общий вход ─────────────────────────

export function makeTask(ctx: GameCtx, want: Want): HymnTask | null {
  const u = ctx.unit(want.id);
  if (!u) return null;
  if (u.kind === 'hymn') return hymnLineTask(ctx, u, want);
  if (u.kind === 'symbol') return symbolTask(ctx, u, want) ?? hymnFallback(ctx, u, want);
  return null;
}

/** Запасной вариант без вопросов в данных: выбор перевода (A) или плитки (B). */
function hymnFallback(ctx: GameCtx, u: PolskaUnit, want: Want): HymnTask {
  const rand = ctx.rand;
  const words = wordsOf(u.pl);
  if (want.side === 'B' && words.length <= 12) return { ...base(u, 'B', !!want.self), mode: 'tiles', kind: 'tiles', prompt: u.ru, lang: 'ru', options: shuffle(words, rand), answer: words, full: u.pl };
  const wrong = distractUnits(u, ctx.units.filter((x) => x.kind === u.kind), 'ru', rand, 3);
  return { ...base(u, 'A', false), mode: 'choice', kind: 'mean', prompt: u.pl, lang: 'pl', options: shuffle([u.ru, ...wrong], rand), answer: u.ru, full: u.pl };
}

const asWords = (answer: unknown): string[] | null => (Array.isArray(answer) ? answer.map(String) : null);

export function checkTask(task: HymnTask, answer: unknown): GameCheck {
  const r = checkRaw(task, answer);
  return task.fact ? { ...r, note: task.fact } : r;
}

function checkRaw(task: HymnTask, answer: unknown): GameCheck {
  const full = task.full;
  switch (task.mode) {
    case 'choice':
      return { ok: typeof answer === 'string' && answer === task.answer, correct: String(task.answer), ...(task.kind === 'next' ? { say: task.full } : {}) };
    case 'tiles': {
      const a = asWords(answer);
      return { ok: !!a && sameTiles(a, task.answer as string[]), correct: full };
    }
    case 'order': {
      const a = asWords(answer);
      const right = task.answer as string[];
      return { ok: !!a && a.length === right.length && a.every((x, i) => x === right[i]), correct: right.join(task.kind === 'order-stanzas' ? ' · ' : ' / '), say: task.kind === 'order-stanzas' ? right[0]! : full };
    }
    case 'flag':
    case 'godlo': {
      const a = obj(answer);
      const right = task.answer as Record<string, string>;
      return { ok: Object.keys(right).every((k) => a[k] === right[k]), correct: full };
    }
  }
}
