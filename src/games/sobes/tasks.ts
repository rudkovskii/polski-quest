// Задания «Sobes»: чистая логика (без DOM). Единица — ответ на вопрос собеса, порезанный на куски «глагол + хвост» (`raw.chunks`,
// разметка `**Kawałki:**` в базе ответов). Три вида по методике дриля (`ПМЖ/Собес/METODIKA.md`, разбор методолога 30.10):
// - order (сторона A, «узнать»): куски ответа перемешаны — поставить по порядку; длинный ответ — окно из 4 кусков, начало видно опорой;
// - next (сторона B, «вспомнить»): дано начало ответа — выбрать следующий кусок; лишние — настоящие куски других ответов, не выдуманные формы;
// - say («сам»): вопрос и суть по-русски, ответ вслух, потом сверка с эталоном и самооценка. Урожай даёт только «сказал».
// С 01.11 (D-88) задания идут связками (`plan.ts`): плитки и варианты — со строчной (кроме имён) и без конечного знака, чтобы верный
// не узнавался по заглавной букве и точке; лишние в «что дальше» — сначала следующий-через-один кусок этого же ответа и куски связки.
import type { GameCheck, GameCtx, GameTask, PolskaUnit, Want } from '../../types/polska';
import { sameTiles, shuffle } from '../kit';

export type SobesKind = 'order' | 'next' | 'say';
/** Самооценка после «скажи вслух»: сказал сам, с подсказкой, не собралось. */
export type SelfGrade = 'said' | 'hint' | 'no';

export interface SobesTask extends GameTask {
  kind: SobesKind;
  /** Вопрос по-польски. */
  prompt: string;
  /** Суть вопроса по-русски. */
  ru: string;
  sedno: string[];
  /** Все куски ответа по порядку. */
  chunks: string[];
  /** order/next: что уже сказано до задания (опора). */
  given: string[];
  /** order: плитки; next: варианты. */
  options: string[];
  /** order: куски по порядку; next: следующий кусок; say: весь ответ. */
  answer: string[] | string;
  /** Ответ целиком. */
  full: string;
  variant?: string;
  /** Длинный ответ: какое окно / какой стык (0 — первая половина, 1 — вторая). */
  part?: 0 | 1;
  /** «Скажи вслух» без сути по-русски (повтор без опоры). */
  bare?: boolean;
  /** Повтор после ошибки. */
  retry?: boolean;
  /** Задание связки (лесенка `plan.ts`), а не выбор движка. */
  inBundle?: boolean;
}

/** Окно сборки: длиннее — не собрать на телефоне и не удержать в голове. */
export const ORDER_MAX = 4;

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

export const chunksOf = (u: PolskaUnit): string[] => strs(u.raw.chunks);
export const sednoOf = (u: PolskaUnit): string[] => strs(u.raw.sedno);
export const fullOf = (u: PolskaUnit): string => (typeof u.raw.answer === 'string' ? u.raw.answer : chunksOf(u).join(' '));

/** Перемешать так, чтобы порядок отличался от правильного. */
function scramble(items: readonly string[], rand: () => number): string[] {
  let a = shuffle(items, rand);
  for (let i = 0; i < 6 && a.join('|') === items.join('|'); i++) a = shuffle(items, rand);
  if (a.join('|') === items.join('|') && a.length > 1) a = [...a.slice(1), a[0]!];
  return a;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Слова, которые в ответах стоят с заглавной не в начале предложения, — имена и названия (их не опускаем в строчные). */
const properCache = new WeakMap<readonly PolskaUnit[], Set<string>>();
function properOf(all: readonly PolskaUnit[]): Set<string> {
  let set = properCache.get(all);
  if (set) return set;
  set = new Set<string>();
  for (const u of all) {
    const words = chunksOf(u).join(' ').split(/\s+/);
    words.forEach((w, i) => {
      if (i > 0 && !/[.!?]$/.test(words[i - 1]!) && /^\p{Lu}/u.test(w)) set!.add(w.replace(/[^\p{L}]/gu, ''));
    });
  }
  properCache.set(all, set);
  return set;
}

/** Кусок для плитки и варианта: без конечного знака, со строчной (кроме имён и названий). */
export function normChunk(c: string, all: readonly PolskaUnit[]): string {
  let s = c.trim().replace(/[.,;:!?—–-]+$/u, '').trim();
  const w = (s.split(/\s+/)[0] ?? '').replace(/[^\p{L}]/gu, '');
  if (w && !properOf(all).has(w)) s = s.charAt(0).toLowerCase() + s.slice(1);
  return s;
}

/** До `n` настоящих кусков других ответов (не равных правильному и кускам этого ответа). */
export function otherChunks(u: PolskaUnit, all: readonly PolskaUnit[], n: number, rand: () => number): string[] {
  const own = chunksOf(u);
  const out: string[] = [];
  for (const x of shuffle(all.filter((v) => v.id !== u.id && v.kind === 'answer'), rand)) {
    for (const c of shuffle(chunksOf(x), rand)) {
      if (out.length >= n) return out;
      if ([...own, ...out].some((y) => same(c, y))) continue;
      out.push(c);
      break;
    }
  }
  return out;
}

export function makeTask(ctx: GameCtx, want: Want): SobesTask | null {
  const u = ctx.unit(want.id);
  if (!u) return null;
  const chunks = chunksOf(u);
  if (chunks.length < 2) return null;
  const rand = ctx.rand;
  const variant = typeof u.raw.variant === 'string' ? u.raw.variant : undefined;
  const common = { prompt: u.pl, ru: u.ru, sedno: sednoOf(u), chunks, full: fullOf(u), ...(variant ? { variant } : {}) };
  if (want.self) return { id: u.id, side: 'B', self: true, kind: 'say', given: [], options: [], answer: common.full, ...common };
  if (want.side === 'A') {
    const start = chunks.length > ORDER_MAX ? Math.floor(rand() * (chunks.length - ORDER_MAX + 1)) : 0;
    const part = chunks.slice(start, start + ORDER_MAX);
    const nPart = part.map((c) => normChunk(c, ctx.units));
    return { id: u.id, side: 'A', kind: 'order', given: chunks.slice(0, start), options: scramble(nPart, rand), answer: nPart, ...common };
  }
  const k = 1 + Math.floor(rand() * (chunks.length - 1));
  return nextTaskAt(ctx, u, k, [], common);
}

type Common = Pick<SobesTask, 'prompt' | 'ru' | 'sedno' | 'chunks' | 'full' | 'variant'>;
const commonOf = (u: PolskaUnit): Common => {
  const variant = typeof u.raw.variant === 'string' ? u.raw.variant : undefined;
  return { prompt: u.pl, ru: u.ru, sedno: sednoOf(u), chunks: chunksOf(u), full: fullOf(u), ...(variant ? { variant } : {}) };
};

/** «Что дальше» после куска `k`: 4 варианта. Лишние — следующий-через-один кусок этого ответа, куски связки, потом остальных ответов. */
function nextTaskAt(ctx: GameCtx, u: PolskaUnit, k: number, bundle: readonly string[], common: Common): SobesTask {
  const chunks = chunksOf(u);
  const norm = (c: string): string => normChunk(c, ctx.units);
  const right = norm(chunks[k]!);
  const opts = [right];
  const before = chunks.slice(0, k).map(norm);
  const add = (c: string | undefined): void => {
    if (!c || opts.length >= 4) return;
    const n = norm(c);
    if (opts.some((o) => same(o, n)) || before.some((o) => same(o, n))) return;
    opts.push(n);
  };
  add(chunks[k + 1]);
  for (const id of shuffle(bundle.filter((x) => x !== u.id), ctx.rand)) {
    const o = ctx.unit(id);
    if (o) add(shuffle(chunksOf(o), ctx.rand)[0]);
  }
  for (const c of otherChunks(u, ctx.units, 6, ctx.rand)) add(c);
  return { id: u.id, side: 'B', kind: 'next', given: chunks.slice(0, k), options: shuffle(opts, ctx.rand), answer: right, ...common };
}

/** Задание ступени связки (`plan.ts`). Длинный ответ: окно сборки и стык — в своей половине (`part`). */
export function makeStep(ctx: GameCtx, id: string, kind: SobesKind, o: { part?: 0 | 1; bare?: boolean; retry?: boolean; bundle: readonly string[] }): SobesTask | null {
  const u = ctx.unit(id);
  if (!u) return null;
  const chunks = chunksOf(u);
  if (chunks.length < 2) return null;
  const common = commonOf(u);
  const extra = { inBundle: true, ...(o.part !== undefined ? { part: o.part } : {}), ...(o.retry ? { retry: true } : {}) };
  if (kind === 'say') return { id, side: 'B', self: true, kind: 'say', given: [], options: [], answer: common.full, ...common, ...extra, ...(o.bare ? { bare: true } : {}) };
  if (kind === 'order') {
    let start = chunks.length > ORDER_MAX ? Math.floor(ctx.rand() * (chunks.length - ORDER_MAX + 1)) : 0;
    if (o.part !== undefined) start = o.part ? Math.max(0, chunks.length - ORDER_MAX) : 0;
    const part = chunks.slice(start, start + ORDER_MAX).map((c) => normChunk(c, ctx.units));
    return { id, side: 'A', kind: 'order', given: chunks.slice(0, start), options: scramble(part, ctx.rand), answer: part, ...common, ...extra };
  }
  const half = Math.ceil(chunks.length / 2);
  const k =
    o.part === undefined
      ? 1 + Math.floor(ctx.rand() * (chunks.length - 1))
      : o.part === 0
        ? 1 + Math.floor(ctx.rand() * Math.max(1, half - 1))
        : half + Math.floor(ctx.rand() * (chunks.length - half));
  return { ...nextTaskAt(ctx, u, k, o.bundle, common), ...extra };
}

export function checkTask(task: SobesTask, answer: unknown): GameCheck {
  if (task.kind === 'say') {
    const g = String(answer) as SelfGrade;
    return {
      ok: g === 'said',
      correct: task.full,
      say: task.full,
      // «Сказал»: ответ только что сверен — сразу следующее задание, без экрана результата.
      ...(g === 'said' ? { skipFeedback: true } : {}),
      ...(g === 'hint' ? { note: 'С подсказкой — урожай не даёт, завтра снова вслух' } : g === 'no' ? { note: 'Прочитай вслух вместе с 🔊. Вопрос будет ещё раз чуть позже' } : {}),
    };
  }
  // Верно — только нужный кусок (не весь ответ: он ещё в памяти); ошибка — весь ответ целиком, ошибочную сборку не показываем.
  const piece = task.kind === 'order' ? task.chunks.slice(task.given.length, task.given.length + (task.answer as string[]).length).join(' ') : task.chunks[task.given.length]!;
  const ok = task.kind === 'order' ? sameTiles(Array.isArray(answer) ? answer.map(String) : [], task.answer as string[]) : same(String(answer), task.answer as string);
  return ok ? { ok, correct: piece, say: piece } : { ok, correct: task.full, say: task.full, ...(task.retry ? {} : { note: 'Вопрос будет ещё раз чуть позже' }) };
}
