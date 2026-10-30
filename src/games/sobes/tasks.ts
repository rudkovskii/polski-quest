// Задания «Sobes»: чистая логика (без DOM). Единица — ответ на вопрос собеса, порезанный на куски «глагол + хвост» (`raw.chunks`,
// разметка `**Kawałki:**` в базе ответов). Три вида по методике дриля (`ПМЖ/Собес/METODIKA.md`, разбор методолога 30.10):
// - order (сторона A, «узнать»): куски ответа перемешаны — поставить по порядку; длинный ответ — окно из 4 кусков, начало видно опорой;
// - next (сторона B, «вспомнить»): дано начало ответа — выбрать следующий кусок; лишние — настоящие куски других ответов, не выдуманные формы;
// - say («сам»): вопрос и суть по-русски, ответ вслух, потом сверка с эталоном и самооценка. Урожай даёт только «сказал».
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
    return { id: u.id, side: 'A', kind: 'order', given: chunks.slice(0, start), options: scramble(part, rand), answer: part, ...common };
  }
  const k = 1 + Math.floor(rand() * (chunks.length - 1));
  const right = chunks[k]!;
  const options = shuffle([right, ...otherChunks(u, ctx.units, 3, rand)], rand);
  return { id: u.id, side: 'B', kind: 'next', given: chunks.slice(0, k), options, answer: right, ...common };
}

export function checkTask(task: SobesTask, answer: unknown): GameCheck {
  if (task.kind === 'say') {
    const g = String(answer) as SelfGrade;
    return {
      ok: g === 'said',
      correct: task.full,
      say: task.full,
      ...(g === 'hint' ? { note: 'С подсказкой — завтра снова вслух, без неё' } : g === 'no' ? { note: 'Прочитай вслух вместе с 🔊 и повтори ещё раз' } : {}),
    };
  }
  if (task.kind === 'order') {
    const given = Array.isArray(answer) ? answer.map(String) : [];
    const want = task.answer as string[];
    return { ok: sameTiles(given, want), correct: [...task.given, ...want].join(' '), say: [...task.given, ...want].join(' ') };
  }
  const right = task.answer as string;
  return { ok: same(String(answer), right), correct: [...task.given, right].join(' '), say: [...task.given, right].join(' ') };
}
