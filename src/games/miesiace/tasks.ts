// Игра «Miesiące»: задания без DOM. Единица — месяц (`month.<n>`, данные — запись `daty.json:months` в `raw`: nom, gen, loc, *_tr, *_ru,
// season, cue_pl/cue_ru/icon/why_ru — «откуда имя»). Путь с нуля (решение Шэфа 27.10, D-41): месяцы по три, задания по стадии куста.
// - Росток (seed): A «что за месяц» и «от какого слова имя», B «как по-польски».
// - Росток (sprout): добавляются «какой по счёту», «po marcu jest…» и колесо года (поставить месяцы своей тройки).
// - Кустик и дальше: месяц в дате («3 maja»), порядок трёх-четырёх подряд, колесо.
// - «Сам»: собрать название из букв (без него кустик не созреет).
// Отвлекающие и подсказки — сначала из уже знакомых месяцев (`known`): новичок не видит в вопросе месяц, которого ещё не встречал.
import type { GameCheck, GameCtx, GameTask, PolskaUnit, Want } from '../../types/polska';
import { sameTiles, shuffle } from '../kit';

export type MonthKind = 'ru' | 'root' | 'num' | 'pl' | 'next' | 'gen' | 'order' | 'spell' | 'wheel';
export type Season = 'zima' | 'wiosna' | 'lato' | 'jesien';

export interface MonthTask extends GameTask {
  kind: MonthKind;
  mode: 'choice' | 'tiles' | 'wheel';
  prompt: string;
  lang: 'pl' | 'ru';
  hint: string;
  /** Варианты (choice) или плитки (tiles); у колеса пусто. */
  options: string[];
  /** Строка (choice), плитки по порядку (tiles) или `{ mistakes: 0 }` (колесо). */
  answer: string | string[] | WheelAnswer;
  /** Варианты русские (без 🔊). */
  optLang: 'pl' | 'ru';
  /** Что показать правильным ответом и что озвучить. */
  correct: string;
  say: string;
  /** Что произнести у вопроса вместо текста (цифры и пропуск). */
  promptSay?: string;
  /** Колесо года: что ставить (номера месяцев по очереди), что уже стоит, сколько промахов прощается. */
  wheel?: { place: number[]; fixed: number[]; allow: number; all: boolean };
}

/** Ответ колеса: сколько раз месяц поставили не в ту клетку. */
export interface WheelAnswer {
  mistakes: number;
}

export interface Row {
  n: number;
  nom: string;
  gen: string;
  /** Местный падеж: «po marcu», «w maju». */
  loc: string;
  nom_ru: string;
  gen_ru: string;
  nom_tr: string;
  season: Season;
  cue_pl: string;
  cue_ru: string;
  icon: string;
  why_ru: string;
}

export const SEASONS: Record<Season, { pl: string; ru: string }> = {
  zima: { pl: 'zima', ru: 'зима' },
  wiosna: { pl: 'wiosna', ru: 'весна' },
  lato: { pl: 'lato', ru: 'лето' },
  jesien: { pl: 'jesień', ru: 'осень' },
};

const seasonOf = (n: number): Season => (n === 12 || n <= 2 ? 'zima' : n <= 5 ? 'wiosna' : n <= 8 ? 'lato' : 'jesien');

export const row = (u: PolskaUnit): Row => {
  const s = (k: string, d = ''): string => (typeof u.raw[k] === 'string' ? (u.raw[k] as string) : d);
  const n = Number(u.raw.month ?? u.raw.n ?? 1);
  const season = s('season') as Season;
  return {
    n,
    nom: s('nom', u.pl),
    gen: s('gen', u.pl),
    loc: s('loc', u.pl),
    nom_ru: s('nom_ru', u.ru),
    gen_ru: s('gen_ru', u.ru),
    nom_tr: s('nom_tr', u.tr),
    season: season in SEASONS ? season : seasonOf(n),
    cue_pl: s('cue_pl'),
    cue_ru: s('cue_ru'),
    icon: s('icon'),
    why_ru: s('why_ru'),
  };
};

/** Месяц через `k` от `n` по кругу (1…12). */
export const shift = (n: number, k: number): number => ((((n - 1 + k) % 12) + 12) % 12) + 1;

const NUM_RU = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый', 'одиннадцатый', 'двенадцатый'];

/** Тройка месяцев по порядку года: 1 — styczeń…marzec, 4 — październik…grudzień. */
export const quarterOf = (n: number): number => Math.ceil(n / 3);
export const monthsOfQuarter = (q: number): number[] => [3 * q - 2, 3 * q - 1, 3 * q];

export function rowsOf(ctx: Pick<GameCtx, 'units'>): Map<number, Row> {
  const m = new Map<number, Row>();
  for (const u of ctx.units) if (u.kind === 'month') m.set(row(u).n, row(u));
  return m;
}

/** Знакомые месяцы: карточка принята или по месяцу уже были ответы. */
export function known(ctx: Pick<GameCtx, 'units' | 'seen' | 'info'>): Set<number> {
  const out = new Set<number>();
  for (const u of ctx.units) if (u.kind === 'month' && (ctx.seen(u.id) || (ctx.info(u.id).answers ?? 0) > 0)) out.add(row(u).n);
  return out;
}

/** Три отвлекающих: сначала знакомые соседи (их путают чаще), потом знакомые, потом любые. */
function near(n: number, rand: () => number, met: ReadonlySet<number>, k = 3): number[] {
  const all = Array.from({ length: 12 }, (_, i) => i + 1).filter((x) => x !== n);
  const close = new Set([shift(n, 1), shift(n, -1), shift(n, 2), shift(n, -2)]);
  const tier = (x: number): number => (met.has(x) ? 0 : 2) + (close.has(x) ? 0 : 1);
  return shuffle(all, rand)
    .sort((a, b) => tier(a) - tier(b))
    .slice(0, k);
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

/** Подряд знакомые месяцы, кончая `n` (не больше 4): для «по порядку». */
function runTo(n: number, met: ReadonlySet<number>): number[] {
  const out = [n];
  while (out.length < 4 && met.has(shift(out[0]!, -1)) && shift(out[0]!, -1) !== n) out.unshift(shift(out[0]!, -1));
  return out;
}

/**
 * Колесо года по просьбе экрана выбора (`Cały rok`): следующее задание раунда — расставить все 12. Ставит `requestWheel`, снимает `makeTask`.
 * Состояние модуля, а не сохранения: закрыл игру — просьба пропадает вместе с раундом.
 */
let wheelAll = false;
/** Когда было последнее колесо (мс): чаще раза в 3 минуты не предлагаем. */
let wheelAt = -Infinity;
export const WHEEL_GAP_MS = 3 * 60_000;

export function requestWheel(on = true): void {
  wheelAll = on;
}

/** Колесо: все 12 по просьбе, иначе знакомые месяцы тройки `n` (не меньше двух), остальные знакомые уже стоят. */
function wheelTask(u: PolskaUnit, r: Row, rows: Map<number, Row>, met: ReadonlySet<number>, all: boolean, rand: () => number): MonthTask | null {
  const place = all ? Array.from({ length: 12 }, (_, i) => i + 1) : monthsOfQuarter(quarterOf(r.n)).filter((x) => x === r.n || met.has(x));
  if (place.length < 2) return null;
  const fixed = all ? [] : [...met].filter((x) => !place.includes(x)).sort((a, b) => a - b);
  const inOrder = [...place].sort((a, b) => a - b).map((x) => rows.get(x)!.nom);
  return {
    id: u.id,
    side: 'B',
    kind: 'wheel',
    mode: 'wheel',
    prompt: all ? 'Ułóż cały rok' : 'Ułóż na kole roku',
    lang: 'pl',
    hint: all ? 'Расставь все 12 месяцев по местам: месяц в центре → его клетка' : 'Поставь месяцы в свои клетки: месяц в центре → его клетка',
    options: [],
    answer: { mistakes: 0 },
    optLang: 'pl',
    correct: inOrder.join(' → '),
    say: inOrder.join(', '),
    wheel: { place: shuffle(place, rand), fixed, allow: all ? 2 : 1, all },
  };
}

const base = (u: PolskaUnit, side: 'A' | 'B', self: boolean): GameTask => ({ id: u.id, side, ...(self ? { self: true } : {}) });

/** Что спросить: по стороне и стадии; null у вида — нельзя (нет соседа, мало знакомых), берётся следующий по списку. */
function kindsFor(want: Want, rand: () => number): MonthKind[] {
  const early = want.stage === 'seed';
  const mid = want.stage === 'sprout';
  const pickOrder = (w: [MonthKind, number][]): MonthKind[] => {
    const out: MonthKind[] = [];
    const left = [...w];
    while (left.length) {
      const sum = left.reduce((s, [, x]) => s + x, 0);
      let t = rand() * sum;
      const i = Math.max(0, left.findIndex(([, x]) => (t -= x) < 0));
      out.push(left.splice(i, 1)[0]![0]);
    }
    return out;
  };
  if (want.side === 'A') return early ? pickOrder([['ru', 6], ['root', 4]]) : mid ? pickOrder([['ru', 4], ['root', 3], ['num', 3]]) : pickOrder([['num', 4], ['ru', 3], ['root', 3]]);
  if (early) return ['pl'];
  if (mid) return [...pickOrder([['pl', 35], ['next', 35], ['wheel', 30]]), 'pl'];
  return [...pickOrder([['gen', 30], ['next', 20], ['order', 20], ['wheel', 15], ['pl', 15]]), 'pl'];
}

export function makeTask(ctx: GameCtx, want: Want): MonthTask | null {
  const u = ctx.unit(want.id);
  if (!u || u.kind !== 'month') return null;
  const rows = rowsOf(ctx);
  const r = row(u);
  const rand = ctx.rand;
  const met = known(ctx);
  met.add(r.n);
  // Пока знакомо мало месяцев, вариантов меньше (3 вместо 4): новичок выбирает среди выученных, а не среди незнакомых имён.
  const k = met.size - 1 >= 3 ? 3 : Math.max(2, met.size - 1);
  const others = near(r.n, rand, met, k).map((n) => rows.get(n)).filter((x): x is Row => !!x);
  if (others.length < k) return null;

  if (wheelAll) {
    wheelAll = false;
    wheelAt = ctx.now();
    const t = wheelTask(u, r, rows, met, true, rand);
    if (t) return t;
  }

  if (want.self) {
    const { tiles, answer } = letterTiles(r.nom, rand);
    return { ...base(u, 'B', true), kind: 'spell', mode: 'tiles', prompt: r.nom_ru, lang: 'ru', hint: 'Ułóż nazwę miesiąca · Собери название месяца по-польски из букв', options: tiles, answer, optLang: 'pl', correct: r.nom, say: r.nom };
  }

  for (const kind of kindsFor(want, rand)) {
    const t = build(kind);
    if (t) return t;
  }
  return null;

  function build(kind: MonthKind): MonthTask | null {
    switch (kind) {
      case 'ru':
        return { ...base(u!, 'A', false), kind, mode: 'choice', prompt: r.nom, lang: 'pl', hint: 'Jaki to miesiąc? · Что это за месяц?', options: shuffle([r.nom_ru, ...others.map((x) => x.nom_ru)], rand), answer: r.nom_ru, optLang: 'ru', correct: r.nom_ru, say: r.nom };
      case 'root': {
        if (!r.cue_ru) return null;
        return { ...base(u!, 'A', false), kind, mode: 'choice', prompt: `${r.icon} ${r.cue_ru}`.trim(), lang: 'ru', hint: 'Skąd ta nazwa? · Какой месяц назван по этому слову?', options: shuffle([r.nom, ...others.map((x) => x.nom)], rand), answer: r.nom, optLang: 'pl', correct: `${r.nom} ← ${r.cue_pl} (${r.cue_ru})`, say: r.nom };
      }
      case 'num': {
        const opts = shuffle([r.n, ...others.map((x) => x.n)], rand).map((n) => `${n}-й`);
        return { ...base(u!, 'A', false), kind, mode: 'choice', prompt: `Który z kolei jest ${r.nom}?`, lang: 'pl', hint: 'Какой он по счёту в году?', options: opts, answer: `${r.n}-й`, optLang: 'ru', correct: `${r.nom} — ${NUM_RU[r.n]} (${r.n})`, say: r.nom, promptSay: `Który z kolei jest ${r.nom}?` };
      }
      case 'pl':
        return { ...base(u!, 'B', false), kind, mode: 'choice', prompt: r.nom_ru, lang: 'ru', hint: 'Jak to po polsku? · Выбери по-польски', options: shuffle([r.nom, ...others.map((x) => x.nom)], rand), answer: r.nom, optLang: 'pl', correct: r.nom, say: r.nom };
      case 'next': {
        const prev = rows.get(shift(r.n, -1));
        if (!prev || !met.has(prev.n)) return null;
        // Ловушка — сам «prev» (его только что прочли в вопросе), остальное — те же отвлекающие, что и везде.
        const wrong = [...new Set([prev.nom, ...others.map((x) => x.nom)])].filter((x) => x !== r.nom).slice(0, k);
        return { ...base(u!, 'B', false), kind, mode: 'choice', prompt: `Po ${prev.loc} jest…`, lang: 'pl', hint: `Какой месяц после «${prev.nom_ru}»?`, options: shuffle([r.nom, ...wrong], rand), answer: r.nom, optLang: 'pl', correct: r.nom, say: `Po ${prev.loc} jest ${r.nom}` };
      }
      case 'gen': {
        const day = 1 + Math.floor(rand() * 28);
        // Дата вслух — порядковым в родительном («trzeciego maja»), как в Daty; справочник `daty.json:ordinals`.
        const ords = Array.isArray(ctx.doc.ordinals) ? (ctx.doc.ordinals as { n?: unknown; gen?: unknown }[]) : [];
        const ord = String(ords.find((o) => o.n === day)?.gen ?? day);
        return { ...base(u!, 'B', false), kind, mode: 'choice', prompt: `${day} ___`, lang: 'pl', hint: `${day} ${r.gen_ru} — в дате месяц меняет окончание (maj → 3 maja)`, options: shuffle([r.gen, ...others.map((x) => x.gen)], rand), answer: r.gen, optLang: 'pl', correct: `${day} ${r.gen}`, say: `${ord} ${r.gen}`, promptSay: ord };
      }
      case 'order': {
        // Знакомые месяцы подряд, этот — последний: по порядку из перемешанных.
        const seq = runTo(r.n, met).map((n) => rows.get(n)!.nom);
        if (seq.length < 3) return null;
        return { ...base(u!, 'B', false), kind, mode: 'tiles', prompt: `… ${r.nom_ru}`, lang: 'ru', hint: `Kolejność · Расставь по порядку ${seq.length === 4 ? 'четыре месяца' : 'три месяца'} до «${r.nom_ru}» включительно`, options: shuffle(seq, rand), answer: seq, optLang: 'pl', correct: seq.join(' → '), say: seq.join(', ') };
      }
      case 'wheel': {
        if (ctx.now() - wheelAt < WHEEL_GAP_MS) return null;
        const t = wheelTask(u!, r, rows, met, false, rand);
        if (t) wheelAt = ctx.now();
        return t;
      }
      default:
        return null;
    }
  }
}

export function checkTask(task: MonthTask, answer: unknown): GameCheck {
  let ok: boolean;
  if (task.mode === 'wheel') {
    const m = answer && typeof answer === 'object' ? (answer as Partial<WheelAnswer>).mistakes : undefined;
    ok = typeof m === 'number' && m <= (task.wheel?.allow ?? 0);
    const what = task.wheel?.all ? 'Весь год на месте' : 'Месяцы на месте';
    const note = typeof m === 'number' ? `${what}: ${m === 0 ? 'всё с первого раза' : `промахов ${m}`}` : undefined;
    return { ok, correct: task.correct, say: task.say, ...(note ? { note } : {}) };
  }
  ok = task.mode === 'choice' ? answer === task.answer : Array.isArray(answer) && (task.kind === 'spell' ? answer.join('') === (task.answer as string[]).join('') : sameTiles(answer.map(String), task.answer as string[]));
  return { ok, correct: task.correct, say: task.say };
}

/** Сбросить состояние модуля (тесты). */
export function resetWheel(): void {
  wheelAll = false;
  wheelAt = -Infinity;
}
