// Заглушка игры v2 (ядро): рабочая, но простая — A: польское → выбор перевода; B: перевод → выбор польского; «сам»: собрать
// польский текст единицы из плиток (+2 лишних). Каждая из четырёх папок `src/games/<id>/` стартует с неё; игровой агент
// заменяет свой `index.ts` настоящей игрой (карта, барабаны, корзинка, караоке), контракт тот же (`PolskaGame`).
import type { GameCtx, GameTask, PolskaGame, PolskaUnit, Want } from '../types/polska';
import { choice, distractUnits, prompt, sameTiles, shuffle, tiles, wordsOf } from './kit';

export interface StubTask extends GameTask {
  mode: 'choice' | 'tiles';
  prompt: string;
  lang: 'pl' | 'ru';
  options: string[];
  answer: string | string[];
}

/** Порядок посадки по умолчанию: полоса (band), потом порядок в данных. */
export const bandOrder = (units: readonly PolskaUnit[]): string[] =>
  units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => a.u.band - b.u.band || a.i - b.i)
    .map((x) => x.u.id);

/** Слишком длинный текст для плиток (факт-символ на 12 слов) — «сам» тогда выбором польского без подсказки перевода. */
const MAX_TILES = 8;

export function stubTask(ctx: GameCtx, want: Want): StubTask | null {
  const u = ctx.unit(want.id);
  if (!u) return null;
  const words = wordsOf(u.pl);
  if (want.self && words.length >= 1 && words.length <= MAX_TILES) {
    const others = shuffle(ctx.units.filter((x) => x.id !== u.id).flatMap((x) => wordsOf(x.pl)), ctx.rand).filter((w) => !words.includes(w));
    const pool = shuffle([...words, ...others.slice(0, words.length > 1 ? 2 : 3)], ctx.rand);
    return { id: u.id, side: 'B', self: true, mode: 'tiles', prompt: u.ru, lang: 'ru', options: pool, answer: words };
  }
  if (want.side === 'A') {
    const options = shuffle([u.ru, ...distractUnits(u, ctx.units, 'ru', ctx.rand)], ctx.rand);
    return { id: u.id, side: 'A', mode: 'choice', prompt: u.pl, lang: 'pl', options, answer: u.ru };
  }
  const options = shuffle([u.pl, ...distractUnits(u, ctx.units, 'pl', ctx.rand)], ctx.rand);
  return { id: u.id, side: 'B', ...(want.self ? { self: true } : {}), mode: 'choice', prompt: u.ru, lang: 'ru', options, answer: u.pl };
}

export function makeStubGame(cfg: Omit<PolskaGame<StubTask>, 'pool' | 'nextTask' | 'render' | 'check'> & { pool?: (ctx: GameCtx) => readonly string[] }): PolskaGame<StubTask> {
  return {
    ...cfg,
    pool: cfg.pool ?? ((ctx) => bandOrder(ctx.units)),
    nextTask: stubTask,
    render(task, panel) {
      const hint = task.mode === 'tiles' ? 'Собери по-польски сам' : task.side === 'A' ? 'Выбери перевод' : task.self ? 'Выбери по-польски, без подсказок' : 'Выбери по-польски';
      prompt(panel, task.prompt, hint, task.lang);
      if (task.mode === 'tiles') tiles(panel, task.options);
      else choice(panel, task.options, task.answer as string);
    },
    check(task, answer) {
      if (task.mode === 'tiles') {
        const given = Array.isArray(answer) ? answer.map(String) : String(answer ?? '').split(/\s+/);
        const want = task.answer as string[];
        return { ok: sameTiles(given, want), correct: want.join(' ') };
      }
      return { ok: String(answer) === task.answer, correct: String(task.answer) };
    },
  };
}
