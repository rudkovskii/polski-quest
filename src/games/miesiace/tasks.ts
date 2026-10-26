// Игра «Miesiące»: задания без DOM. Единица — месяц (`month.<n>`, данные — запись `daty.json:months` в `raw`: nom, gen, loc, *_tr, *_ru).
// Сторона A «узнать»: польское название → русское; какой он по счёту. B «вспомнить»: русское → польское; «что после…»; родительный в дате
// («3 maja»); четыре месяца подряд по порядку. «Сам» — собрать название из букв (без него кустик не созреет).
import type { GameCheck, GameCtx, GameTask, PolskaUnit, Want } from '../../types/polska';
import { sameTiles, shuffle } from '../kit';

export type MonthKind = 'ru' | 'num' | 'pl' | 'next' | 'gen' | 'order' | 'spell';

export interface MonthTask extends GameTask {
  kind: MonthKind;
  mode: 'choice' | 'tiles';
  prompt: string;
  lang: 'pl' | 'ru';
  hint: string;
  /** Варианты (choice) или плитки (tiles). */
  options: string[];
  /** Строка (choice) или плитки по порядку (tiles). */
  answer: string | string[];
  /** Варианты русские (без 🔊). */
  optLang: 'pl' | 'ru';
  /** Что показать правильным ответом и что озвучить. */
  correct: string;
  say: string;
  /** Что произнести у вопроса вместо текста (цифры и пропуск). */
  promptSay?: string;
}

interface Row {
  n: number;
  nom: string;
  gen: string;
  /** Местный падеж: «po marcu», «w maju». */
  loc: string;
  nom_ru: string;
  gen_ru: string;
}

const row = (u: PolskaUnit): Row => ({
  n: Number(u.raw.month ?? u.raw.n ?? 1),
  nom: String(u.raw.nom ?? u.pl),
  gen: String(u.raw.gen ?? u.pl),
  loc: String(u.raw.loc ?? u.pl),
  nom_ru: String(u.raw.nom_ru ?? u.ru),
  gen_ru: String(u.raw.gen_ru ?? u.ru),
});

/** Месяц через `k` от `n` по кругу (1…12). */
export const shift = (n: number, k: number): number => ((((n - 1 + k) % 12) + 12) % 12) + 1;

const NUM_RU = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый', 'одиннадцатый', 'двенадцатый'];

function rowsOf(ctx: GameCtx): Map<number, Row> {
  const m = new Map<number, Row>();
  for (const u of ctx.units) if (u.kind === 'month') m.set(row(u).n, row(u));
  return m;
}

/** Три отвлекающих, сначала соседние месяцы (их путают чаще), потом любые. */
function near(n: number, rand: () => number, k = 3): number[] {
  const close = shuffle([shift(n, 1), shift(n, -1), shift(n, 2), shift(n, -2)], rand).slice(0, 2);
  const rest = shuffle(Array.from({ length: 12 }, (_, i) => i + 1).filter((x) => x !== n && !close.includes(x)), rand);
  return [...close, ...rest].slice(0, k);
}

/** Буквы названия плитками (польские диграфы — одной плиткой) и две лишние. */
export function letterTiles(word: string, rand: () => number): { tiles: string[]; answer: string[] } {
  const answer: string[] = [];
  const w = word.toLowerCase();
  for (let i = 0; i < w.length; ) {
    const two = w.slice(i, i + 2);
    if (['rz', 'cz', 'sz', 'ch', 'dz'].includes(two)) {
      answer.push(two);
      i += 2;
    } else answer.push(w[i++]!);
  }
  const pairs: Record<string, string> = { ń: 'n', n: 'ń', ź: 'ż', ż: 'rz', rz: 'ż', e: 'ę', a: 'ą', o: 'ó', l: 'ł', c: 'ć', s: 'ś', i: 'y', y: 'i', k: 'g', t: 'd', p: 'b' };
  const extra: string[] = [];
  for (const t of shuffle(answer, rand)) {
    const p = pairs[t];
    if (p && !answer.includes(p) && !extra.includes(p)) extra.push(p);
    if (extra.length >= 2) break;
  }
  return { tiles: shuffle([...answer, ...extra], rand), answer };
}

const base = (u: PolskaUnit, side: 'A' | 'B', self: boolean): GameTask => ({ id: u.id, side, ...(self ? { self: true } : {}) });

export function makeTask(ctx: GameCtx, want: Want): MonthTask | null {
  const u = ctx.unit(want.id);
  if (!u || u.kind !== 'month') return null;
  const rows = rowsOf(ctx);
  const r = row(u);
  const rand = ctx.rand;
  const others = near(r.n, rand).map((n) => rows.get(n)).filter((x): x is Row => !!x);
  if (others.length < 3) return null;

  if (want.self) {
    const { tiles, answer } = letterTiles(r.nom, rand);
    return { ...base(u, 'B', true), kind: 'spell', mode: 'tiles', prompt: r.nom_ru, lang: 'ru', hint: 'Ułóż nazwę miesiąca · Собери название месяца по-польски из букв', options: tiles, answer, optLang: 'pl', correct: r.nom, say: r.nom };
  }

  if (want.side === 'A') {
    if (rand() < 0.3) {
      const opts = shuffle([r.n, ...others.map((x) => x.n)], rand).map((n) => `${n}-й`);
      return { ...base(u, 'A', false), kind: 'num', mode: 'choice', prompt: `Który z kolei jest ${r.nom}?`, lang: 'pl', hint: 'Какой он по счёту в году?', options: opts, answer: `${r.n}-й`, optLang: 'ru', correct: `${r.nom} — ${NUM_RU[r.n]} (${r.n})`, say: r.nom, promptSay: `Który z kolei jest ${r.nom}?` };
    }
    return { ...base(u, 'A', false), kind: 'ru', mode: 'choice', prompt: r.nom, lang: 'pl', hint: 'Jaki to miesiąc? · Что это за месяц?', options: shuffle([r.nom_ru, ...others.map((x) => x.nom_ru)], rand), answer: r.nom_ru, optLang: 'ru', correct: r.nom_ru, say: r.nom };
  }

  const pick = rand();
  if (pick < 0.3) {
    return { ...base(u, 'B', false), kind: 'pl', mode: 'choice', prompt: r.nom_ru, lang: 'ru', hint: 'Jak to po polsku? · Выбери по-польски', options: shuffle([r.nom, ...others.map((x) => x.nom)], rand), answer: r.nom, optLang: 'pl', correct: r.nom, say: r.nom };
  }
  if (pick < 0.55) {
    const prev = rows.get(shift(r.n, -1))!;
    const wrong = [shift(r.n, 1), shift(r.n, -2), prev.n].map((n) => rows.get(n)!.nom);
    return { ...base(u, 'B', false), kind: 'next', mode: 'choice', prompt: `Po ${prev.loc} jest…`, lang: 'pl', hint: `Какой месяц после «${prev.nom_ru}»?`, options: shuffle([r.nom, ...wrong], rand), answer: r.nom, optLang: 'pl', correct: r.nom, say: `Po ${prev.loc} jest ${r.nom}` };
  }
  if (pick < 0.8) {
    const day = 1 + Math.floor(rand() * 28);
    // Дата вслух — порядковым в родительном («trzeciego maja»), как в Daty; справочник `daty.json:ordinals`.
    const ords = Array.isArray(ctx.doc.ordinals) ? (ctx.doc.ordinals as { n?: unknown; gen?: unknown }[]) : [];
    const ord = String(ords.find((o) => o.n === day)?.gen ?? day);
    return { ...base(u, 'B', false), kind: 'gen', mode: 'choice', prompt: `${day} ___`, lang: 'pl', hint: `${day} ${r.gen_ru} — как в дате?`, options: shuffle([r.gen, ...others.map((x) => x.gen)], rand), answer: r.gen, optLang: 'pl', correct: `${day} ${r.gen}`, say: `${ord} ${r.gen}`, promptSay: ord };
  }
  // Четыре месяца подряд, этот — последний: по порядку из перемешанных.
  const seq = [-3, -2, -1, 0].map((k) => rows.get(shift(r.n, k))!.nom);
  return { ...base(u, 'B', false), kind: 'order', mode: 'tiles', prompt: `… ${r.nom_ru}`, lang: 'ru', hint: `Kolejność · Расставь по порядку четыре месяца до «${r.nom_ru}» включительно`, options: shuffle(seq, rand), answer: seq, optLang: 'pl', correct: seq.join(' → '), say: seq.join(', ') };
}

export function checkTask(task: MonthTask, answer: unknown): GameCheck {
  const ok = task.mode === 'choice' ? answer === task.answer : Array.isArray(answer) && (task.kind === 'spell' ? answer.join('') === (task.answer as string[]).join('') : sameTiles(answer.map(String), task.answer as string[]));
  return { ok, correct: task.correct, say: task.say };
}
