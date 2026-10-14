// Бюджет сессии и петля дня (ТЗ §4.5, §4.8, §5.9): чистые функции, время приходит параметром.
//   • активное время: вкладка видима и было касание за последние ACTIVE_IDLE_MS (таймер-редьюсер);
//   • отрезки дня (`seg`) и «день засчитан» — из Derived.days (событие `seg` пишут обход, экспресс, сон);
//   • лимит утра: раунд обхода до obchodBatch (15), «ещё раунд», если после раунда долг остался;
//   • экспресс: до expressMaxCards (12) или expressMaxMin (3) минут, только due, без новых слов;
//   • мягкий потолок sessionSoftCapMin (15): по окончании шага игра предлагает сон;
//   • итог дня (DaySummary): полито, выросло, созрело, посажено, покрытие, минуты вспоминания, завтра.
// Порядок отрезков ведёт режиссёр (I-13): здесь только факты для него.
import type { Tuning } from '../types/content';
import { derive, isPlayedDay, type DeriveContent, type Derived } from './derive';
import { gardenItems, plantStage, stageRank, type GardenTuning, type PlantStage } from './garden';
import type { EventOf, LogEvent, Seg } from './log';
import type { Progress } from './progress';
import { dueQueue, isSpring, type QueueTuning } from './queue';
import { cardId, parseCardId } from './srs';
import { dayOf, dayStartAfter, isoWeekday, type Day, type TimeOpts, type Ts } from './time';

// ── Активное время (§4.8): чистый редьюсер, часы монотонные (performance.now) от склейки.

/** Без касаний дольше этого время не считается активным. */
export const ACTIVE_IDLE_MS = 60_000;

export interface Activity {
  /** Накоплено активных мс до момента `mark`. */
  activeMs: number;
  mark: number;
  /** Последнее касание (ввод, клик); null — ещё не было. */
  lastTouch: number | null;
  visible: boolean;
}

export function activityStart(mono: number, visible = true): Activity {
  return { activeMs: 0, mark: mono, lastTouch: null, visible };
}

/** Довести счётчик до момента `mono`: активен отрезок (mark, mono] ∩ (−∞, lastTouch + IDLE], пока вкладка видима. */
function advance(a: Activity, mono: number): Activity {
  if (mono <= a.mark) return a;
  let add = 0;
  if (a.visible && a.lastTouch !== null) {
    const until = Math.min(mono, a.lastTouch + ACTIVE_IDLE_MS);
    if (until > a.mark) add = until - a.mark;
  }
  return { ...a, activeMs: a.activeMs + add, mark: mono };
}

/** Касание: тап, клик, клавиша, intent. Невидимая вкладка касаний не принимает. */
export function activityTouch(a: Activity, mono: number): Activity {
  const b = advance(a, mono);
  return b.visible ? { ...b, lastTouch: mono } : b;
}

/** Вкладка спряталась или вернулась (`visibilitychange`). Возврат сам по себе не касание. */
export function activityVisible(a: Activity, visible: boolean, mono: number): Activity {
  const b = advance(a, mono);
  return { ...b, visible, lastTouch: visible ? b.lastTouch : null };
}

/** Активных мс к моменту `mono`. */
export function activeMsAt(a: Activity, mono: number): number {
  return advance(a, mono).activeMs;
}

/** Сбросить счётчик (после записи события `session`), не теряя последнего касания. */
export function activityReset(a: Activity, mono: number): Activity {
  return { ...advance(a, mono), activeMs: 0 };
}

export type SessionTuning = Pick<Tuning, 'sessionTargetMin' | 'sessionSoftCapMin' | 'expressMaxMin' | 'expressMaxCards' | 'obchodBatch' | 'debtLockThreshold' | 'director'>;

export interface Budget {
  activeMin: number;
  targetMin: number;
  softCapMin: number;
  /** Пора предложить сон (§4.8): активных минут ≥ sessionSoftCapMin. */
  softCap: boolean;
}

export function budget(activeMs: number, t: SessionTuning): Budget {
  const activeMin = activeMs / 60_000;
  return { activeMin, targetMin: t.sessionTargetMin, softCapMin: t.sessionSoftCapMin, softCap: activeMin >= t.sessionSoftCapMin };
}

// ── Отрезки дня и «день засчитан».

/** Отрезки дня в терминах петли (КОНЦЕПТ §5) → значения `seg` журнала (§3.11). */
export const SEG_OF = { obchod: 'water', wyprawa: 'scene', wieczor: 'evening', sen: 'sleep', express: 'express', more3: 'more3', remedy: 'remedy' } as const satisfies Record<string, Seg>;

export interface DayState {
  day: Day;
  /** Завершённые сегодня отрезки (отсортированы). */
  segs: Seg[];
  /** День засчитан (§4.8): хотя бы один отрезок, кроме сна, или итог урока. */
  counted: boolean;
  /** Сон уже был: следующий запуск в этот день показывает «done» (§5.9, режиссёр I-13). */
  slept: boolean;
  /** Воскресенье — niedziela niehandlowa: новые сцены не первыми (§4.8). */
  sunday: boolean;
  /** Долг (due без фонетики). */
  debt: number;
  /** Долг выше debtLockThreshold: сцены с новыми словами закрыты, режиссёр держит `water`. */
  locked: boolean;
  /** Весна (§4.2): первая сессия после паузы ≥ springAfterDays. */
  spring: boolean;
}

export function dayState(d: Derived, t: Pick<Tuning, 'debtLockThreshold' | 'springAfterDays'>): DayState {
  const s = d.days[d.today];
  const segs = [...(s?.segs ?? [])].sort() as Seg[];
  return {
    day: d.today,
    segs,
    counted: isPlayedDay(s),
    slept: segs.includes('sleep'),
    sunday: isoWeekday(d.today) === 7,
    debt: d.debt,
    locked: d.debt > t.debtLockThreshold,
    spring: isSpring(d, t),
  };
}

// ── Лимит утра (обход) и экспресс.

export interface RoundPlan {
  mode: 'day' | 'express' | 'phonetic';
  /** Карточки раунда по порядку (первая — с грядки, по которой тапнули, если она due). */
  cards: string[];
  /** Сколько due до раунда (долг). */
  debt: number;
  /** Ограничение по времени (экспресс), мс; Infinity — без ограничения. */
  maxMs: number;
}

/**
 * Раунд обхода (§4.8, §5.5): до obchodBatch карточек из dueQueue('obchod'); `fromItem` — растение,
 * по которому тапнули: его карточка встаёт первой. Экспресс (§4.5): dueQueue('express'), до
 * expressMaxCards и expressMaxMin минут; `minutes` переопределяет время («ещё 3 минуты», director.more3Min).
 * Вечер (I-13, §4.3, §4.8): `phonetic` — минимальные пары красных и жёлтых кластеров, до phoneticPerDay
 * (или `limit`: первый вечер — 3 пары), `cluster` — его пары первыми.
 */
export function planRound(
  d: Derived,
  now: Ts,
  t: QueueTuning & SessionTuning & GardenTuning,
  o: { mode: 'day' | 'express' | 'phonetic'; fromItem?: string; minutes?: number; limit?: number; cluster?: string },
): RoundPlan {
  if (o.mode === 'phonetic') {
    const cards = dueQueue(d, now, t, { mode: 'phonetic', ...(o.limit !== undefined ? { limit: o.limit } : {}), ...(o.cluster ? { preferCluster: o.cluster } : {}) });
    return { mode: 'phonetic', cards, debt: d.debt, maxMs: (o.minutes ?? Infinity) * 60_000 };
  }
  const mode = o.mode === 'express' ? 'express' : 'obchod';
  const limit = Math.min(o.limit ?? Infinity, mode === 'express' ? t.expressMaxCards : t.obchodBatch);
  let cards = dueQueue(d, now, t, { mode, limit });
  if (o.fromItem) {
    const g = gardenItems(d, now, t).find((x) => x.item === o.fromItem);
    const first = cards.find((c) => parseCardId(c)?.item === o.fromItem) ?? g?.dueCard ?? null;
    if (first) cards = [first, ...cards.filter((c) => c !== first && parseCardId(c)?.item !== o.fromItem)].slice(0, limit);
  }
  const minutes = o.minutes ?? (o.mode === 'express' ? t.expressMaxMin : Infinity);
  return { mode: o.mode, cards, debt: d.debt, maxMs: minutes * 60_000 };
}

// ── Итог дня (§5.9).

export interface DaySummary {
  day: Day;
  /** Ответов по due-карточкам сегодня. */
  answered: number;
  /** Из них верно (grade ≥ 1): «полито». */
  watered: number;
  /** Разных карточек повторено / было due сегодня (повторено + ещё due) — покрытие. */
  reviewed: number;
  wasDue: number;
  /** Минуты вспоминания: Σ rev.ms. */
  retrievalMs: number;
  /** Слова, сменившие стадию сегодня (росток → куст и т.п.). */
  grew: { item: string; from: PlantStage; to: PlantStage }[];
  /** Слова, сегодня получившие банку. */
  matured: string[];
  /** Посажено сегодня (`intro`). */
  planted: string[];
  /** К поливу завтра (due до конца завтрашнего игрового дня, включая оставшийся долг). */
  tomorrow: number;
  /** złoty за день — экономика I-18, пока null. */
  zloty: number | null;
  segs: Seg[];
  counted: boolean;
  /** За день ничего не сделано: «Сегодня ещё ничего, полей хоть пару грядок?». */
  empty: boolean;
}

export function summarizeDay(p: Progress, dc: DeriveContent, now: Ts, tz?: string): DaySummary {
  const after = derive(p, dc, now, tz);
  const t = dc.tuning;
  const opts: TimeOpts = { dayStartHour: dc.dayStartHour ?? dc.tuning?.dayStartHour, tz };
  const start = after.todayStart;
  const before = derive({ ...p, log: { ...p.log, events: p.log.events.filter((e) => e.ts < start) } }, dc, start - 1, tz);
  const today = p.log.events.filter((e) => e.ts >= start && e.ts <= now);
  const revs = today.filter((e): e is EventOf<'rev'> => e.k === 'rev');
  const intros = today.filter((e): e is EventOf<'intro'> => e.k === 'intro');
  const ren = dc.renames ?? {};

  const reviewedCards = new Set(revs.map((e) => e.card));
  let stillDue = 0;
  for (const [id, c] of Object.entries(after.cards)) if (c.due <= now && parseCardId(id)?.type !== 'pair' && !reviewedCards.has(id)) stillDue++;

  const planted = [...new Set(intros.map((e) => ren[e.item] ?? e.item))];
  const plantedSet = new Set(planted);
  const grew: DaySummary['grew'] = [];
  const matured: string[] = [];
  const items = new Set<string>();
  for (const id of Object.keys(after.cards)) {
    const c = parseCardId(id);
    if (c && c.type !== 'pair') items.add(c.item);
  }
  const gt = t as GardenTuning | undefined;
  for (const item of [...items].sort()) {
    if (plantedSet.has(item)) continue;
    const a = after.cards[cardId(item, 'rec')];
    const b = before.cards[cardId(item, 'rec')];
    if (!a || !b) continue;
    const from = plantStage(b, gt);
    const to = plantStage(a, gt);
    if (stageRank(to) > stageRank(from)) {
      grew.push({ item, from, to });
      if (to === 'jar') matured.push(item);
    }
  }

  let tomorrow = 0;
  const tomorrowEnd = dayStartAfter(now, 2, opts);
  for (const [id, c] of Object.entries(after.cards)) if (c.due < tomorrowEnd && parseCardId(id)?.type !== 'pair') tomorrow++;

  const s = after.days[after.today];
  const segs = [...(s?.segs ?? [])].sort() as Seg[];
  const counted = isPlayedDay(s);
  return {
    day: after.today,
    answered: revs.length,
    watered: revs.filter((e) => e.g >= 1).length,
    reviewed: reviewedCards.size,
    wasDue: reviewedCards.size + stillDue,
    retrievalMs: revs.reduce((x, e) => x + e.ms, 0),
    grew,
    matured,
    planted,
    tomorrow,
    zloty: null,
    segs,
    counted,
    empty: revs.length === 0 && intros.length === 0 && !counted,
  };
}

/** Σ rev.ms с момента `since` (для события `session.retrievalMs`). */
export function retrievalSince(events: readonly LogEvent[], since: Ts): number {
  let ms = 0;
  for (const e of events) if (e.k === 'rev' && e.ts >= since) ms += e.ms;
  return ms;
}

/** Игровой день момента (удобство для UI, который не тянет time.ts). */
export function gameDay(now: Ts, t: Pick<Tuning, 'dayStartHour'>, tz?: string): Day {
  return dayOf(now, { dayStartHour: t.dayStartHour, tz });
}
