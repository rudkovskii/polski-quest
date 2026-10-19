// Задания мини-игр (ФЕРМА.md, решение 9): чистые функции. Случай приходит параметром (`rand`).
//   1 Polski → Rosyjski: польское слово, выбор из 4 русских (отвлекающие из той же темы, лучше той же части речи);
//   2 Rosyjski → Polski: русское слово, выбор из 4 польских (ввода «напиши сам» тут больше нет: он ушёл в игру 5, 19.10);
//   Короткие фразы (меньше 3 плиток, `canAssemble`) растут через игры 1 и 2 как слова: сборка из 1–2 плиток бессмысленна.
//   3 Złóż zdanie po polsku: русская фраза, плитки tiles_pl + distract_pl;
//   4 Złóż zdanie po rosyjsku: польская фраза, плитки tiles_ru + distract_ru;
//   5 Ułóż słowo: слово из плиток-букв (`systems/spell.ts`) в сторону `dir` (rp — по-польски, pr — по-русски) или ввод с клавиатуры.
import type { Phrase, Word } from '../types/content';
import type { GameMode, Side } from '../types/farm';
import type { Verdict } from './answer';
import { gradeSpell, primaryRu, ruSpellable, ruVariants, spellTarget, spellTiles, type SpellCell } from './spell';

/**
 * Задание игры 5: `dir` — сторона (rp: русское → собрать польское, pr: польское → собрать русское), `answer` — как показать
 * правильный ответ, `accept` — что принять при вводе, `units` — плитки ответа по порядку, `tiles` — они же с ловушками
 * вперемешку, `layout` — ряд ответа (слоты и неподвижные знаки). Экран ставит `hinted` (взята «первая буква») и `typed`
 * (ответ напечатан, а не собран) перед отправкой.
 */
export interface SpellQuestion {
  mode: GameMode;
  id: string;
  kind: 'spell';
  dir: Side;
  prompt: string;
  promptLang: 'pl' | 'ru';
  answer: string;
  accept: string[];
  units: string[];
  tiles: string[];
  layout: SpellCell[];
  hinted?: boolean;
  typed?: boolean;
}

/**
 * `progress` — что осталось растению до урожая («ещё 1 полив до ростка»), его дописывает ферма (P2a).
 * `reverse` — задание «наоборот»: в игре 2 пришло с польского (mode 1), в игре 1 — на польский (mode 2), всегда выбором;
 * в игре 5 — сборка в другую сторону (`dir`).
 */
export type Question = (
  | { mode: GameMode; id: string; kind: 'choice'; prompt: string; promptLang: 'pl' | 'ru'; options: string[]; answer: string }
  | { mode: GameMode; id: string; kind: 'tiles'; prompt: string; promptLang: 'pl' | 'ru'; tiles: string[]; answer: string[] }
  | SpellQuestion
) & { progress?: string; reverse?: boolean };

/** Минимум плиток, чтобы фразу имело смысл собирать (игры 3 и 4). */
export const MIN_TILES = 3;

/** Фраза годится для сборки из плиток в обе стороны. Короткие («Dzień dobry.») идут в игры 1 и 2. */
export const canAssemble = (p: Pick<Phrase, 'tiles_pl' | 'tiles_ru'>): boolean => p.tiles_pl.length >= MIN_TILES && p.tiles_ru.length >= MIN_TILES;

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

/** 3 отвлекающих для фразы: та же тема (короткие рядом с короткими), потом любые. */
export function phraseDistractors(p: Phrase, phrases: readonly Phrase[], field: 'pl' | 'ru', rand: () => number, n = 3): string[] {
  const own = p[field].trim().toLowerCase();
  const out: string[] = [];
  const seen = new Set([own]);
  const short = (x: Phrase): boolean => !canAssemble(x);
  for (const tier of [phrases.filter((x) => x.topic === p.topic && short(x)), phrases.filter((x) => x.topic === p.topic), phrases.filter(short), phrases]) {
    for (const x of shuffle(tier, rand)) {
      if (out.length >= n) return out;
      const k = x[field].trim().toLowerCase();
      if (x.id === p.id || seen.has(k)) continue;
      seen.add(k);
      out.push(x[field].trim());
    }
  }
  return out;
}

/** Слово годится для игры 5 в эту сторону: по-польски — любое, по-русски — если первое значение собирается из букв. */
export const canSpell = (w: Pick<Word, 'ru'>, dir: Side): boolean => dir === 'rp' || ruSpellable(w.ru);

/** Собрать задание. `dir` — сторона игры 5 (по умолчанию по-польски). */
export function makeQuestion(
  mode: GameMode,
  id: string,
  db: { word(id: string): Word | undefined; phrase(id: string): Phrase | undefined; words: readonly Word[]; phrases?: readonly Phrase[] },
  rand: () => number,
  opts: { dir?: Side } = {},
): Question | null {
  if (mode === 5) {
    const w = db.word(id);
    const dir = opts.dir ?? 'rp';
    if (!w || !canSpell(w, dir)) return null;
    const lang = dir === 'rp' ? 'pl' : 'ru';
    const t = spellTarget(dir === 'rp' ? w.pl : primaryRu(w.ru), lang);
    return {
      mode,
      id,
      kind: 'spell',
      dir,
      prompt: dir === 'rp' ? w.ru : w.pl,
      promptLang: dir === 'rp' ? 'ru' : 'pl',
      answer: t.text,
      accept: dir === 'rp' ? [w.pl] : ruVariants(w.ru),
      units: t.units,
      tiles: spellTiles(t.units, lang, rand),
      layout: t.layout,
    };
  }
  if (mode === 1 || mode === 2) {
    const w = db.word(id);
    if (!w) {
      // Короткая фраза в играх 1 и 2: как слово, отвлекающие — другие фразы.
      const p = db.phrase(id);
      if (!p) return null;
      const f = mode === 1 ? 'ru' : 'pl';
      const options = shuffle([p[f], ...phraseDistractors(p, db.phrases ?? [], f, rand)], rand);
      return { mode, id, kind: 'choice', prompt: mode === 1 ? p.pl : p.ru, promptLang: mode === 1 ? 'pl' : 'ru', options, answer: p[f] };
    }
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

/**
 * Проверить ответ: выбор — строка варианта; плитки — порядок; игра 5 — собранное слово (буквы точно) или напечатанное
 * (мягко: без диакритики «почти», орфография R10, `systems/spell.ts`).
 */
export function grade(q: Question, given: string | readonly string[]): Graded {
  if (q.kind === 'choice') {
    const ok = typeof given === 'string' && given.trim() === q.answer.trim();
    return { ok, verdict: ok ? 'exact' : 'wrong', correct: q.answer };
  }
  if (q.kind === 'spell') {
    const r = gradeSpell(typeof given === 'string' ? given : given.join(''), q.answer, q.accept, q.dir === 'rp' ? 'pl' : 'ru', !!q.typed);
    return { ...r, correct: q.answer };
  }
  const arr = typeof given === 'string' ? given.split(/\s+/).filter(Boolean) : given;
  const ok = normTiles(arr) === normTiles(q.answer);
  return { ok, verdict: ok ? 'exact' : 'wrong', correct: q.answer.join(' ') };
}
