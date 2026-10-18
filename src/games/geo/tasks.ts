// Задания Geografia: сборка из данных `content/v2/geografia.json` (tasks, phrases, forms) по просьбе движка (`Want`) и проверка ответа.
// Чистая логика без DOM. Сторона A («узнать»): что это на карте, выбор названия. Сторона B («вспомнить»): найти на карте, река,
// воеводство, столица, сторона света, с кем граничит (+ форма), падежная форма. `self`: сборка фразы из плиток.
import type { GameCheck, GameCtx, GameTask, PolskaUnit, Want } from '../../types/polska';
import type { UnitInfo } from '../../types/polska';
import { distractUnits, sameTiles, shuffle, wordsOf } from '../kit';
import { hits, inMap, type Pt } from './world';

export type GeoKind = 'show' | 'name' | 'river' | 'region' | 'side' | 'capital' | 'dir' | 'form' | 'build';

export interface GeoTask extends GameTask {
  t: GeoKind;
  /** Вопрос по-польски (крупно) и по-русски (мелко). */
  q: string;
  ru: string;
  /** Единица, подсвеченная на карте во время вопроса (name, river, region…): «вот это место». */
  mark: string | null;
  /** Единицы, которые карта показывает после ответа (подпись, золотая линия, заливка). */
  reveal: string[];
  options?: string[];
  answer?: string;
  /** Вторая ступень `dir`: выбор формы («z Niemcami»). */
  form?: { q: string; options: string[]; answer: string };
  tiles?: string[];
  need?: string[];
  /** Правильный ответ для показа и что озвучить. */
  correct: string;
  say: string;
}

/** Ответ на `dir`: выбранный сосед и (если он верен) выбранная форма. */
export interface DirAnswer {
  nb: string;
  form?: string;
}

export type DotStatus = 'gray' | 'green' | 'gold';
/** Серая — не посажено, зелёная — растёт, золотая — урожай собран. */
export function statusOf(i: Pick<UnitInfo, 'planted' | 'stage' | 'harvests'>): DotStatus {
  if (i.harvests > 0) return 'gold';
  return i.planted || i.stage !== null ? 'green' : 'gray';
}

interface RawTask {
  t?: string;
  q_pl?: string;
  q_ru?: string;
  slot?: string;
  answer?: string | string[];
  answer_ids?: string[];
  distract?: string[];
  wrong?: string[];
  options?: string[];
  dir?: string;
  form?: { q_pl?: string; answer?: string; wrong?: string[] };
}
interface RawPhrase {
  id?: string;
  role?: string;
  pl?: string;
  ru?: string;
  tiles_pl?: string[];
  distract_pl?: string[];
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rawTasks = (u: PolskaUnit): RawTask[] => arr<RawTask>(u.raw.tasks);
const rawPhrases = (u: PolskaUnit): RawPhrase[] => arr<RawPhrase>(u.raw.phrases).filter((p) => p.pl && Array.isArray(p.tiles_pl) && p.tiles_pl.length > 0);
const strs = (v: unknown): string[] => arr<unknown>(v).filter((x): x is string => typeof x === 'string');

/** Подпись единицы в вариантах: воеводство — коротко («mazowieckie»), остальное — `pl`. */
export const labelOf = (u: PolskaUnit): string => (u.type === 'region' && typeof u.raw.short === 'string' ? u.raw.short : u.pl);

/** Фраза для озвучки по роли (`loc`, `to`, `water`, `border`…). */
const phraseBy = (u: PolskaUnit, ...roles: string[]): string | undefined => rawPhrases(u).find((p) => roles.includes(p.role ?? ''))?.pl;

const lastPhrase = new Map<string, string>();

/** Варианты: верный + отвлекающие из данных (id единиц), недостающее добирается из соседей по типу. Всегда 4 или меньше, без повторов. */
function optionsOf(ctx: GameCtx, correctId: string, ids: readonly string[], exclude: readonly string[] = []): string[] {
  const right = ctx.unit(correctId);
  const bad = new Set(exclude);
  const out: string[] = right ? [labelOf(right)] : [];
  const seen = new Set(out.map((x) => x.toLowerCase()));
  for (const id of ids) {
    const v = ctx.unit(id);
    if (!v || bad.has(id) || id === correctId) continue;
    const l = labelOf(v);
    if (seen.has(l.toLowerCase())) continue;
    seen.add(l.toLowerCase());
    out.push(l);
    if (out.length >= 4) break;
  }
  if (out.length < 4 && right) {
    for (const l of distractUnits(right, ctx.units.filter((x) => !bad.has(x.id)), 'pl', ctx.rand, 4)) {
      if (out.length >= 4) break;
      if (!seen.has(l.toLowerCase())) (seen.add(l.toLowerCase()), out.push(l));
    }
  }
  return shuffle(out, ctx.rand);
}

const base = (u: PolskaUnit, side: 'A' | 'B', t: GeoKind, q: string, ru: string): Pick<GeoTask, 'id' | 'side' | 't' | 'q' | 'ru' | 'mark' | 'reveal' | 'correct' | 'say'> => ({
  id: u.id,
  side,
  t,
  q,
  ru,
  mark: null,
  reveal: [u.id],
  correct: labelOf(u),
  say: u.pl,
});

function showTask(u: PolskaUnit): GeoTask {
  const t = rawTasks(u).find((x) => x.t === 'show');
  return { ...base(u, 'B', 'show', t?.q_pl ?? `Pokaż na mapie: ${u.pl}`, t?.q_ru ?? `Покажи на карте: ${u.ru}`), say: u.pl };
}

function nameTask(ctx: GameCtx, u: PolskaUnit): GeoTask | null {
  const t = rawTasks(u).find((x) => x.t === 'name');
  const options = optionsOf(ctx, u.id, strs(t?.distract));
  if (options.length < 2) return null;
  return {
    ...base(u, 'A', 'name', t?.q_pl ?? 'Co to jest?', t?.q_ru ?? 'Что это?'),
    mark: u.id,
    options,
    answer: labelOf(u),
  };
}

/** Задание «выбор из вариантов» по записи данных (river / region / capital): верным показываем один из `answer`. */
function pickTask(ctx: GameCtx, u: PolskaUnit, t: RawTask, kind: 'river' | 'region' | 'capital'): GeoTask | null {
  const answers = (typeof t.answer === 'string' ? [t.answer] : strs(t.answer)).filter((id) => ctx.unit(id));
  if (!answers.length) return null;
  const right = ctx.unit(shuffle(answers, ctx.rand)[0]!)!;
  const options = optionsOf(ctx, right.id, strs(t.distract), answers);
  if (options.length < 2) return null;
  const phrase = kind === 'river' ? phraseBy(u, 'water', 'through') : kind === 'region' ? phraseBy(u, 'region') : phraseBy(u, 'capital');
  return {
    ...base(u, 'B', kind, t.q_pl ?? '', t.q_ru ?? ''),
    mark: u.id,
    reveal: [u.id, right.id],
    options,
    answer: labelOf(right),
    correct: labelOf(right),
    say: phrase ?? u.pl,
  };
}

function sideTask(ctx: GameCtx, u: PolskaUnit): GeoTask | null {
  const t = rawTasks(u).find((x) => x.t === 'side');
  const answer = typeof t?.answer === 'string' ? t.answer : '';
  const options = strs(t?.options);
  if (!t || !answer || options.length < 2) return null;
  return {
    ...base(u, 'B', 'side', t.q_pl ?? '', t.q_ru ?? ''),
    mark: u.id,
    options: shuffle(options, ctx.rand),
    answer,
    correct: answer,
    say: phraseBy(u, 'side') ?? u.pl,
  };
}

function formTask(ctx: GameCtx, u: PolskaUnit): GeoTask | null {
  const list = rawTasks(u).filter((x) => x.t === 'form' && typeof x.answer === 'string' && strs(x.wrong).length >= 1);
  if (!list.length) return null;
  const t = shuffle(list, ctx.rand)[0]!;
  const answer = t.answer as string;
  const role = t.slot === 'water' ? ['water'] : t.slot === 'loc' ? ['loc', 'where'] : t.slot === 'to' ? ['to'] : t.slot === 'ins' ? ['border'] : [];
  return {
    ...base(u, 'B', 'form', t.q_pl ?? '', 'Выбери правильную форму'),
    mark: u.type === 'neighbor' ? null : u.id,
    options: shuffle([answer, ...strs(t.wrong).slice(0, 3)], ctx.rand),
    answer,
    correct: answer,
    say: phraseBy(u, ...role) ?? u.pl,
  };
}

/** «Z kim graniczy Polska na zachodzie?»: сначала сосед, потом форма. В вариантах нет второго соседа с той же стороны света. */
function dirTask(ctx: GameCtx, u: PolskaUnit): GeoTask | null {
  const t = rawTasks(u).find((x) => x.t === 'dir');
  const f = t?.form;
  if (!t || !f?.answer || !strs(f.wrong).length) return null;
  const same = new Set([u.id, ...strs(t.answer_ids)]);
  const others = shuffle(ctx.units.filter((x) => x.type === 'neighbor' && !same.has(x.id)), ctx.rand).slice(0, 3);
  if (others.length < 2) return null;
  const options = shuffle([u.pl, ...others.map((x) => x.pl)], ctx.rand);
  const border = phraseBy(u, 'border');
  return {
    ...base(u, 'B', 'dir', t.q_pl ?? 'Z kim graniczy Polska?', t.q_ru ?? 'С кем граничит Польша?'),
    options,
    answer: u.pl,
    form: { q: f.q_pl ?? `Polska graniczy … (${u.pl})`, options: shuffle([f.answer, ...strs(f.wrong).slice(0, 3)], ctx.rand), answer: f.answer },
    correct: `${u.pl}: ${f.answer}`,
    say: border ?? u.pl,
  };
}

/** «Сам»: сборка фразы из плиток; фразы единицы ходят по кругу. */
function buildTask(ctx: GameCtx, u: PolskaUnit): GeoTask | null {
  const list = rawPhrases(u);
  if (!list.length) return null;
  const last = lastPhrase.get(u.id);
  const pool = list.length > 1 ? list.filter((p) => p.id !== last) : list;
  const p = shuffle(pool, ctx.rand)[0]!;
  lastPhrase.set(u.id, p.id ?? '');
  const need = p.tiles_pl as string[];
  const tiles = shuffle([...need, ...strs(p.distract_pl)], ctx.rand);
  return {
    ...base(u, 'B', 'build', p.ru ?? u.ru, 'Собери по-польски'),
    self: true,
    mark: u.id,
    tiles,
    need,
    correct: p.pl as string,
    say: p.pl as string,
  };
}

/** Какие виды заданий стороны B доступны единице и с каким весом (показать на карте — чаще всего). */
function weightsB(u: PolskaUnit): [GeoKind, number][] {
  const has = (t: string): boolean => rawTasks(u).some((x) => x.t === t);
  const out: [GeoKind, number][] = [['show', 4]];
  if (has('river')) out.push(['river', 2]);
  if (has('region')) out.push(['region', 2]);
  if (has('side')) out.push(['side', 2]);
  if (has('capital')) out.push(['capital', 2]);
  if (has('dir')) out.push(['dir', 3]);
  if (has('form')) out.push(['form', u.type === 'city' ? 3 : 1]);
  return out;
}

function pickKind(list: [GeoKind, number][], rand: () => number): GeoKind {
  const total = list.reduce((s, x) => s + x[1], 0);
  let r = rand() * total;
  for (const [k, w] of list) if ((r -= w) < 0) return k;
  return list[0]![0];
}

export function makeTask(ctx: GameCtx, want: Want): GeoTask | null {
  const u = ctx.unit(want.id);
  if (!u) return null;
  if (want.self) {
    const t = buildTask(ctx, u);
    if (t) return t;
  }
  if (want.side === 'A' && !want.self) {
    const t = nameTask(ctx, u);
    if (t) return t;
  }
  const list = weightsB(u);
  for (let i = 0; i < 4; i++) {
    const kind = pickKind(list, ctx.rand);
    const t = makeKind(ctx, u, kind);
    if (t) return want.self ? { ...t, self: true } : t;
    const at = list.findIndex((x) => x[0] === kind);
    if (at >= 0) list.splice(at, 1);
    if (!list.length) break;
  }
  return want.self ? { ...showTask(u), self: true } : showTask(u);
}

export function makeKind(ctx: GameCtx, u: PolskaUnit, kind: GeoKind): GeoTask | null {
  const raw = (t: string): RawTask[] => rawTasks(u).filter((x) => x.t === t);
  switch (kind) {
    case 'show':
      return showTask(u);
    case 'name':
      return nameTask(ctx, u);
    case 'river':
    case 'region':
    case 'capital': {
      const list = raw(kind);
      return list.length ? pickTask(ctx, u, shuffle(list, ctx.rand)[0]!, kind) : null;
    }
    case 'side':
      return sideTask(ctx, u);
    case 'form':
      return formTask(ctx, u);
    case 'dir':
      return dirTask(ctx, u);
    case 'build':
      return buildTask(ctx, u);
  }
}

const isPt = (a: unknown): a is Pt => !!a && typeof a === 'object' && typeof (a as Pt).x === 'number' && typeof (a as Pt).y === 'number' && Number.isFinite((a as Pt).x) && Number.isFinite((a as Pt).y);

/** Ответ верен? Для `show` — по точке карты; чужие формы ответа (строка вместо точки и т.п.) — просто неверно. */
export function verdict(task: GeoTask, answer: unknown, ctx: GameCtx): boolean {
  switch (task.t) {
    case 'show': {
      const u = ctx.unit(task.id);
      return !!u && isPt(answer) && inMap(answer) && hits(ctx.units, u, answer);
    }
    case 'dir': {
      const a = answer as Partial<DirAnswer> | null;
      return !!a && typeof a === 'object' && a.nb === task.answer && a.form === task.form?.answer;
    }
    case 'build': {
      const given = Array.isArray(answer) ? answer.map(String) : typeof answer === 'string' ? wordsOf(answer) : [];
      return sameTiles(given, task.need ?? []);
    }
    default:
      return typeof answer === 'string' && answer === task.answer;
  }
}

export function checkTask(task: GeoTask, answer: unknown, ctx: GameCtx): GameCheck {
  return { ok: verdict(task, answer, ctx), correct: task.correct, say: task.say };
}
