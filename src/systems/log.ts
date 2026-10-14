// Журнал событий (ТЗ §3.11): append-only, источник истины. Короткие ключи держат объём ~5 КБ в день.
// Здесь только типы и чистые хелперы; дописывание с id/seq — в progress.ts (`append`).
import type { CardId, CardState, CardType } from './progress';
import { addDays, dayOf, type Day, type TimeOpts, type Ts } from './time';

export type Src =
  | 'obchod'
  | 'scene'
  | 'express'
  | 'boss'
  | 'order'
  | 'mine'
  | 'phonetic'
  | 'remedy'
  | 'world'
  | 'kitchen'
  | 'fish';

export type Seg = 'water' | 'remedy' | 'scene' | 'evening' | 'sleep' | 'express' | 'more3';
export type MiniGame = 'fish' | 'mine' | 'delivery';

/** id = `${deviceId}.${seq.toString(36)}`, для импорта тренажёра `imp.<trainerId>`. */
export interface Base {
  id: string;
  ts: Ts;
}

export interface EvRev { k: 'rev'; card: CardId; g: 0 | 1 | 2 | 3; ms: number; src: Src; tags?: string[] }
export interface EvIntro { k: 'intro'; item: string; lesson: string; ok: CardType[] }
export interface EvLesson {
  k: 'lesson'; lesson: string; score: number; firstTry: number; ms: number; passed: boolean;
  tags?: Record<string, number>; answers: number;
}
export interface EvBoss {
  k: 'boss'; lesson: string; score: number; parts: Record<string, number>;
  clusters?: Record<string, number>; passed: boolean; ms: number;
}
export interface EvDiag { k: 'diag'; results: Record<string, { ok: number; n: number }> }
export interface EvOrder { k: 'order'; npc: string; order: string; items: string[]; cards: CardId[]; ok: number }
export interface EvCook { k: 'cook'; recipe: string; items: string[]; ok: boolean }
export interface EvSell { k: 'sell'; items: string[]; zl: number }
export interface EvFound { k: 'found'; secret: string; spot: string }
export interface EvMini { k: 'mini'; game: MiniGame; score: number; ms: number; floor?: number }
export interface EvSpend { k: 'spend'; what: string; zl: number }
export interface EvPierog { k: 'pierog'; lesson: string }
export interface EvChal { k: 'chal'; challenge: string }
export interface EvImp { k: 'imp'; card: CardId; state: Pick<CardState, 'reps' | 'interval' | 'ef' | 'due'>; from: 'trainer' }
export interface EvSession { k: 'session'; mode: 'day' | 'express'; ms: number; retrievalMs: number }
export interface EvSeg { k: 'seg'; seg: Seg }

export type EventBody =
  | EvRev | EvIntro | EvLesson | EvBoss | EvDiag | EvOrder | EvCook | EvSell
  | EvFound | EvMini | EvSpend | EvPierog | EvChal | EvImp | EvSession | EvSeg;

export type LogEvent = Base & EventBody;
export type EventKind = EventBody['k'];
export type EventOf<K extends EventKind> = Extract<LogEvent, { k: K }>;

/** Событие до записи: без id (его ставит `append`), с моментом `ts`. */
export type EventDraft = EventBody & { ts: Ts };

export const EVENT_KINDS: readonly EventKind[] = [
  'rev', 'intro', 'lesson', 'boss', 'diag', 'order', 'cook', 'sell',
  'found', 'mini', 'spend', 'pierog', 'chal', 'imp', 'session', 'seg',
];

/** Минимальная проверка формы при чтении файла/облака: id, ts, известный k. */
export function isLogEvent(x: unknown): x is LogEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === 'string' && e.id.length > 0 &&
    typeof e.ts === 'number' && Number.isFinite(e.ts) &&
    typeof e.k === 'string' && (EVENT_KINDS as readonly string[]).includes(e.k)
  );
}

/** Порядок журнала: (ts, id). */
export function compareEvents(a: Base, b: Base): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isSorted(events: readonly Base[]): boolean {
  for (let i = 1; i < events.length; i++) if (compareEvents(events[i - 1]!, events[i]!) >= 0) return false;
  return true;
}

/**
 * Компактная форма события: без `undefined` и пустых необязательных полей (`tags: []`, `tags: {}`).
 * `append` пишет только компактные события, поэтому JSON → объект → JSON даёт то же самое.
 */
export function compactEvent<E extends object>(e: E): E {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(e)) {
    if (val === undefined) continue;
    if ((key === 'tags' || key === 'clusters') && isEmpty(val)) continue;
    out[key] = val;
  }
  return out as E;
}

function isEmpty(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (v && typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

const DEVICE_ID_RE = /^([a-z2-7]{6})\.([0-9a-z]+)$/;

/** Разбор id устройства: `abc234.1z` → { deviceId, seq }. Импортные id (`imp.*`) → null. */
export function parseEventId(id: string): { deviceId: string; seq: number } | null {
  const m = DEVICE_ID_RE.exec(id);
  if (!m) return null;
  return { deviceId: m[1]!, seq: parseInt(m[2]!, 36) };
}

export function eventId(deviceId: string, seq: number): string {
  return `${deviceId}.${seq.toString(36)}`;
}

export function eventsByKind<K extends EventKind>(events: readonly LogEvent[], k: K): EventOf<K>[] {
  return events.filter((e): e is EventOf<K> => e.k === k);
}

/** События игрового дня `day` (граница 04:00 по `opts`). */
export function eventsOfDay(events: readonly LogEvent[], day: Day, opts: TimeOpts = {}): LogEvent[] {
  return events.filter((e) => dayOf(e.ts, opts) === day);
}

/** События по игровым дням, в порядке журнала внутри дня. */
export function groupByDay(events: readonly LogEvent[], opts: TimeOpts = {}): Map<Day, LogEvent[]> {
  const out = new Map<Day, LogEvent[]>();
  for (const e of events) {
    const d = dayOf(e.ts, opts);
    let arr = out.get(d);
    if (!arr) out.set(d, (arr = []));
    arr.push(e);
  }
  return out;
}

// ── Фильтр ранних ответов (ТЗ §3.11, §4.1) ─────────────────────────────────────
// `rev` пишется только по due-карточке. Ответ раньше срока SRS не двигает и уходит в агрегат урока.
// Исключение для заказов (`src: 'order'`, зрелые слова за ≤ earlyDays до due, §4.13) подключает I-05/I-45
// через `earlyDays`; по умолчанию 0 — исключения нет.

export type RevVerdict = 'ok' | 'early' | 'no_card';

export interface RevGate {
  /** due карточки или undefined, если карточки нет. */
  due: Ts | undefined;
  now: Ts;
  src: Src;
  /** Для src 'order': сколько дней до due ещё считается «вовремя». Решает вызывающий (зрелость слова). */
  earlyDays?: number;
  opts?: TimeOpts;
}

export function revVerdict(g: RevGate): RevVerdict {
  if (g.due === undefined) return 'no_card';
  if (g.due <= g.now) return 'ok';
  const early = g.src === 'order' ? (g.earlyDays ?? 0) : 0;
  if (early > 0) {
    // Сравниваем игровые дни: due наступит не позже чем через earlyDays дней.
    const dueDay = dayOf(g.due, g.opts);
    const today = dayOf(g.now, g.opts);
    if (dueDay <= addDays(today, early)) return 'ok';
  }
  return 'early';
}

