// Очередь дня (ТЗ §4.2, §4.3, §4.4, §4.5): какие due-карточки показать и можно ли сегодня новое.
// Чистые функции от Derived (выведенного на тот же `now`) и tuning. Расписание SRS не правят.
import type { Tuning } from '../types/content';
import { isPlayedDay, type Derived } from './derive';
import type { LogEvent } from './log';
import type { CardId, CardState, CardType } from './progress';
import { parseCardId } from './srs';
import { addDays, daysBetween, dayOf, type Day, type TimeOpts, type Ts } from './time';

export type QueueMode = 'obchod' | 'express' | 'mine' | 'phonetic';

export interface QueueOpts {
  mode: QueueMode;
  /** Верхняя граница от вызывающего; по умолчанию лимит режима из tuning. */
  limit?: number;
}

export type QueueTuning = Pick<
  Tuning,
  'obchodBatch' | 'expressMaxCards' | 'phoneticPerDay' | 'springAfterDays' | 'debtLockThreshold' | 'newItemsPerDay' | 'director' | 'jars'
>;

/** Карточка, проваленная сегодня (grade 0), возвращается в сессию не раньше чем через столько карточек (§4.1). */
export const LAPSE_GAP = 5;
/**
 * Автоподстройка лимита новых под долг (research/01 п. 4, КОНЦЕПТ §8 п. 3): до долга `obchodBatch`
 * лимит полный, дальше линейно падает до этой доли к `debtLockThreshold`, выше порога сцены закрыты.
 * Кандидат в tuning.json (нужна правка ТЗ §4.11 и схемы).
 */
export const NEW_ITEMS_DEBT_FLOOR = 0.5;

interface Cand {
  id: CardId;
  item: string;
  type: CardType;
  card: CardState;
}

/** Карточка уже отвечена (не просто создана) в сегодняшний игровой день. */
function reviewedToday(c: CardState, s: Pick<Derived, 'todayStart'>): boolean {
  return c.lastReviewAt > c.createdAt && c.lastReviewAt >= s.todayStart;
}

/** Долг на момент `now`: due-карточки без фонетики. */
export function debtAt(s: Pick<Derived, 'cards'>, now: Ts): number {
  let n = 0;
  for (const [id, c] of Object.entries(s.cards)) if (c.due <= now && parseCardId(id)?.type !== 'pair') n++;
  return n;
}

/** Последний засчитанный день до сегодняшнего. */
function prevPlayedDay(s: Pick<Derived, 'days' | 'today'>): Day | null {
  let best: Day | null = null;
  for (const [d, st] of Object.entries(s.days)) if (d < s.today && isPlayedDay(st) && (!best || d > best)) best = d;
  return best;
}

/**
 * Весна (§4.2): с прошлого игрового дня прошло ≥ springAfterDays, а сегодня ещё ничего не засчитано.
 * Первая сессия после паузы начинается с лёгких побед; расписание SRS не меняется.
 */
export function isSpring(s: Pick<Derived, 'days' | 'today'>, t: Pick<Tuning, 'springAfterDays'>): boolean {
  if (isPlayedDay(s.days[s.today])) return false;
  const prev = prevPlayedDay(s);
  return prev !== null && daysBetween(prev, s.today) >= t.springAfterDays;
}

function byPriority(a: Cand, b: Cand): number {
  // Сначала хрупкие (меньший interval), потом дольше просроченные, потом id для детерминизма.
  if (a.card.interval !== b.card.interval) return a.card.interval - b.card.interval;
  if (a.card.due !== b.card.due) return a.card.due - b.card.due;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byLongest(a: Cand, b: Cand): number {
  if (a.card.interval !== b.card.interval) return b.card.interval - a.card.interval;
  return byPriority(a, b);
}

/** Переставить так, чтобы подряд не шли два одинаковых типа, где это возможно (жадно, порядок приоритета). */
export function interleaveTypes<T extends { type: string }>(list: readonly T[]): T[] {
  const rest = list.slice();
  const out: T[] = [];
  while (rest.length) {
    const prev = out[out.length - 1]?.type;
    let i = rest.findIndex((c) => c.type !== prev);
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]!);
  }
  return out;
}

/** Проваленные сегодня карточки не раньше позиции LAPSE_GAP (если есть чем заполнить). */
function spaceLapses(list: Cand[], s: Pick<Derived, 'todayStart'>): Cand[] {
  const lapsed = list.filter((c) => c.card.lastGrade === 0 && reviewedToday(c.card, s));
  if (!lapsed.length) return list;
  const others = list.filter((c) => !lapsed.includes(c));
  const head = others.slice(0, LAPSE_GAP);
  return [...head, ...lapsed, ...others.slice(LAPSE_GAP)];
}

/** Лимит режима по умолчанию. */
export function modeLimit(mode: QueueMode, t: QueueTuning): number {
  switch (mode) {
    case 'obchod':
    case 'mine':
      return t.obchodBatch;
    case 'express':
      return t.expressMaxCards;
    case 'phonetic':
      return t.phoneticPerDay;
  }
}

/**
 * Очередь due-карточек (§4.2):
 * - кандидаты `due ≤ now`; порядок: меньший interval, потом больший `now − due`; типы вперемешку;
 * - братья: одна карточка слова за сессию; если сегодня уже отвечали по другой карточке слова, остальные ждут завтра;
 * - `pair` только в режиме `phonetic`: кластеры red/yellow, до phoneticPerDay в день;
 * - `obchod` в весну: первые `director.easyWins` (5) — самые длинные интервалы;
 * - `mine`: зрелые карточки (interval ≥ первого порога банок), самые глубокие первыми;
 * - `express`: до expressMaxCards, без новых слов (новые в очередь и так не попадают).
 */
export function dueQueue(state: Derived, now: Ts, t: QueueTuning, opts: QueueOpts): CardId[] {
  const { mode } = opts;
  let limit = Math.min(opts.limit ?? Infinity, modeLimit(mode, t));
  const touched = new Map<string, Set<CardType>>(); // слово → типы, отвеченные сегодня
  const cands: Cand[] = [];
  let pairsToday = 0;
  for (const [id, card] of Object.entries(state.cards)) {
    const parsed = parseCardId(id);
    if (!parsed) continue;
    if (reviewedToday(card, state)) {
      if (parsed.type === 'pair') pairsToday++;
      let set = touched.get(parsed.item);
      if (!set) touched.set(parsed.item, (set = new Set()));
      set.add(parsed.type);
    }
    if (card.due > now) continue;
    const isPair = parsed.type === 'pair';
    if ((mode === 'phonetic') !== isPair) continue;
    if (isPair) {
      const st = state.clusterStatus[state.pairCluster[id] ?? ''];
      if (st !== 'red' && st !== 'yellow') continue; // кластер закрыт или не диагностирован
    }
    if (mode === 'mine' && card.interval < (t.jars.thresholds[0] ?? 35)) continue;
    cands.push({ id, item: parsed.item, type: parsed.type, card });
  }
  if (mode === 'phonetic') limit = Math.min(limit, Math.max(0, t.phoneticPerDay - pairsToday));
  if (limit <= 0) return [];

  // Братья: слово, по которому сегодня отвечали другой карточкой, ждёт завтра.
  const free = cands.filter((c) => {
    const set = touched.get(c.item);
    return !set || [...set].every((type) => type === c.type);
  });

  const spring = mode === 'obchod' && isSpring(state, { springAfterDays: t.springAfterDays });
  const ordered = mode === 'mine' ? free.sort(byLongest) : free.sort(byPriority);
  const pick: Cand[] = [];
  const seen = new Set<string>();
  const take = (c: Cand): void => {
    if (pick.length >= limit || seen.has(c.item)) return;
    seen.add(c.item);
    pick.push(c);
  };
  let head: Cand[] = [];
  if (spring) {
    for (const c of [...ordered].sort(byLongest)) if (pick.length < Math.min(limit, t.director.easyWins)) take(c);
    head = pick.slice();
  }
  for (const c of ordered) take(c);
  const tail = spaceLapses(interleaveTypes(pick.slice(head.length)), state);
  return [...head, ...tail].map((c) => c.id);
}

// ── Новые слова (§4.2): потолок в день, автоподстройка под долг, блок при долге > порога.

export interface NewItemsOpts {
  /** Настройка игрока `newItemsPerDay` (4–12) или `module.srs.newPerDay`; по умолчанию tuning. */
  perDay?: number;
  /** Бонус к потолку сегодня (кухня §4.13: +kitchen.bonusItems). */
  bonus?: number;
}

/** Потолок новых слов на сегодня с учётом долга. */
export function newItemsCap(state: Pick<Derived, 'cards'>, now: Ts, t: QueueTuning, o: NewItemsOpts = {}): number {
  const base = (o.perDay ?? t.newItemsPerDay) + (o.bonus ?? 0);
  const debt = debtAt(state, now);
  if (debt > t.debtLockThreshold) return 0;
  const from = t.obchodBatch;
  const to = t.debtLockThreshold;
  if (debt <= from || to <= from) return base;
  const k = 1 - (1 - NEW_ITEMS_DEBT_FLOOR) * ((debt - from) / (to - from));
  return Math.round(base * k);
}

/** Сколько новых слов ещё можно ввести сегодня. */
export function newItemsLeftToday(state: Pick<Derived, 'cards' | 'today' | 'newItemsByDay'>, now: Ts, t: QueueTuning, o: NewItemsOpts = {}): number {
  return Math.max(0, newItemsCap(state, now, t, o) - (state.newItemsByDay[state.today] ?? 0));
}

export type NewLock = 'debt' | 'limit' | null;

/**
 * Почему сцена с `introduces` новыми словами закрыта: 'debt' — долг > debtLockThreshold
 * («Najpierw powtórka!»), 'limit' — дневной потолок не вмещает сцену; null — открыта.
 * Боссы, ремонт и лекарства без новых слов (introduces = 0) не закрываются.
 */
export function newContentLock(
  state: Pick<Derived, 'cards' | 'today' | 'newItemsByDay'>,
  now: Ts,
  t: QueueTuning,
  introduces = 1,
  o: NewItemsOpts = {},
): NewLock {
  if (introduces <= 0) return null;
  if (debtAt(state, now) > t.debtLockThreshold) return 'debt';
  return newItemsLeftToday(state, now, t, o) < introduces ? 'limit' : null;
}

export function isNewContentLocked(
  state: Pick<Derived, 'cards' | 'today' | 'newItemsByDay'>,
  now: Ts,
  t: QueueTuning,
  introduces = 1,
  o: NewItemsOpts = {},
): boolean {
  return newContentLock(state, now, t, introduces, o) !== null;
}

// ── Лекарство по тегам ошибок (§4.4).

export interface RemedyPick {
  tag: string;
  lesson: string;
  errors: number;
}

/**
 * Лекарство на сегодня: тег с ≥ remedy.errors ошибками за remedy.windowDays игровых дней (после прошлого
 * показа его лекарства), у тега есть `remedy`, с прошлого показа прошло ≥ cooldownDays; одно в день.
 * Источники ошибок: `rev.tags` (каждый тег = 1) и `lesson.tags` (тег → число). Показ = событие `lesson`
 * с уроком-лекарством.
 */
export function pickRemedy(
  events: readonly LogEvent[],
  now: Ts,
  t: Pick<Tuning, 'remedy'>,
  errorTags: ReadonlyMap<string, { remedy?: string }>,
  time: TimeOpts = {},
): RemedyPick | null {
  const today = dayOf(now, time);
  const from = addDays(today, -(t.remedy.windowDays - 1));
  const remedyOf = new Map<string, string>();
  for (const [tag, et] of errorTags) if (et.remedy) remedyOf.set(tag, et.remedy);
  const remedyLessons = new Set(remedyOf.values());
  const lastShown = new Map<string, Ts>(); // урок-лекарство → последний показ
  for (const e of events) {
    if (e.k !== 'lesson' || !remedyLessons.has(e.lesson) || e.ts > now) continue;
    if (dayOf(e.ts, time) === today) return null; // лекарство сегодня уже было
    lastShown.set(e.lesson, Math.max(lastShown.get(e.lesson) ?? -Infinity, e.ts));
  }
  const errors = new Map<string, number>();
  const add = (tag: string, n: number, ts: Ts): void => {
    const lesson = remedyOf.get(tag);
    if (!lesson || ts <= (lastShown.get(lesson) ?? -Infinity)) return;
    errors.set(tag, (errors.get(tag) ?? 0) + n);
  };
  for (const e of events) {
    if (e.ts > now) continue;
    const d = dayOf(e.ts, time);
    if (d < from || d > today) continue;
    if (e.k === 'rev') for (const tag of e.tags ?? []) add(tag, 1, e.ts);
    else if (e.k === 'lesson') for (const [tag, n] of Object.entries(e.tags ?? {})) add(tag, n, e.ts);
  }
  let best: RemedyPick | null = null;
  for (const [tag, n] of [...errors].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (n < t.remedy.errors) continue;
    const lesson = remedyOf.get(tag)!;
    const shown = lastShown.get(lesson);
    if (shown !== undefined && daysBetween(dayOf(shown, time), today) < t.remedy.cooldownDays) continue;
    if (!best || n > best.errors) best = { tag, lesson, errors: n };
  }
  return best;
}
