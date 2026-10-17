// Задания мини-игр (ФЕРМА.md, решение 9): чистые функции. Случай приходит параметром (`rand`).
//   1 Polski → Rosyjski: польское слово, выбор из 4 русских (отвлекающие из той же темы, лучше той же части речи);
//   2 Rosyjski → Polski: русское слово, выбор из 4 польских; когда слово уже «куст» — ввод с клавиатуры (мягкая проверка);
//   3 Złóż zdanie po polsku: русская фраза, плитки tiles_pl + distract_pl;
//   4 Złóż zdanie po rosyjsku: польская фраза, плитки tiles_ru + distract_ru.
import type { Phrase, Word } from '../types/content';
import type { GameMode } from '../types/farm';
import { checkAnswer, type Verdict } from './answer';

export type Question =
  | { mode: GameMode; id: string; kind: 'choice'; prompt: string; promptLang: 'pl' | 'ru'; options: string[]; answer: string }
  | { mode: GameMode; id: string; kind: 'type'; prompt: string; promptLang: 'ru'; answer: string; accept: string[] }
  | { mode: GameMode; id: string; kind: 'tiles'; prompt: string; promptLang: 'pl' | 'ru'; tiles: string[]; answer: string[] };

export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 3 правдоподобных отвлекающих для слова: та же тема и часть речи → та же тема → та же часть речи. */
export function distractors(w: Word, words: readonly Word[], field: 'pl' | 'ru', rand: () => number, n = 3): string[] {
  const own = w[field].trim().toLowerCase();
  const out: string[] = [];
  const seen = new Set([own]);
  const tiers = [
    words.filter((x) => x.topic === w.topic && x.pos === w.pos),
    words.filter((x) => x.topic === w.topic),
    words.filter((x) => x.pos === w.pos),
    words,
  ];
  for (const tier of tiers) {
    for (const x of shuffle(tier, rand)) {
      if (out.length >= n) return out;
      const v = x[field].trim();
      const k = v.toLowerCase();
      if (x.id === w.id || seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/** Собрать задание. `typed` — слово уже «куст» (режим 2 переходит на ввод). */
export function makeQuestion(
  mode: GameMode,
  id: string,
  db: { word(id: string): Word | undefined; phrase(id: string): Phrase | undefined; words: readonly Word[] },
  rand: () => number,
  typed = false,
): Question | null {
  if (mode === 1 || mode === 2) {
    const w = db.word(id);
    if (!w) return null;
    if (mode === 2 && typed) return { mode, id, kind: 'type', prompt: w.ru, promptLang: 'ru', answer: w.pl, accept: [w.pl] };
    const field = mode === 1 ? 'ru' : 'pl';
    const options = shuffle([w[field], ...distractors(w, db.words, field, rand)], rand);
    return { mode, id, kind: 'choice', prompt: mode === 1 ? w.pl : w.ru, promptLang: mode === 1 ? 'pl' : 'ru', options, answer: w[field] };
  }
  const p = db.phrase(id);
  if (!p) return null;
  if (mode === 3) return { mode, id, kind: 'tiles', prompt: p.ru, promptLang: 'ru', tiles: shuffle([...p.tiles_pl, ...p.distract_pl], rand), answer: [...p.tiles_pl] };
  return { mode, id, kind: 'tiles', prompt: p.pl, promptLang: 'pl', tiles: shuffle([...p.tiles_ru, ...p.distract_ru], rand), answer: [...p.tiles_ru] };
}

export interface Graded {
  ok: boolean;
  verdict: Verdict;
  /** Правильный ответ для показа. */
  correct: string;
}

const normTiles = (xs: readonly string[]): string => xs.map((x) => x.trim().toLowerCase()).join(' ');

/** Проверить ответ: выбор — строка варианта; ввод — текст (мягко: без диакритики «почти», орфография R10); плитки — порядок. */
export function grade(q: Question, given: string | readonly string[]): Graded {
  if (q.kind === 'choice') {
    const ok = typeof given === 'string' && given.trim() === q.answer.trim();
    return { ok, verdict: ok ? 'exact' : 'wrong', correct: q.answer };
  }
  if (q.kind === 'type') {
    const c = checkAnswer(typeof given === 'string' ? given : given.join(' '), q.accept, { diacritics: 'warn', ortho: true, typo: true });
    return { ok: c.verdict !== 'wrong', verdict: c.verdict, correct: q.answer };
  }
  const arr = typeof given === 'string' ? given.split(/\s+/).filter(Boolean) : given;
  const ok = normTiles(arr) === normTiles(q.answer);
  return { ok, verdict: ok ? 'exact' : 'wrong', correct: q.answer.join(' ') };
}
