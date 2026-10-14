// Объект прогресса (ТЗ §3.10). Журнал — источник истины; world монотонен; settings — LWW по ключу.
// Функции чистые: ничего не мутируют, время приходит параметром `now`.
import {
  compactEvent,
  compareEvents,
  eventId,
  isLogEvent,
  isSorted,
  parseEventId,
  revVerdict,
  type EventDraft,
  type LogEvent,
  type RevVerdict,
} from './log';
import type { Day, TimeOpts, Ts } from './time';

export type { Day, Ts } from './time';

export const PROGRESS_V = 1;

export type CardType = 'rec' | 'lis' | 'pro' | 'pair';
/** `${itemId}#${CardType}`, напр. 'lx.kawa#rec', 'mp.lata_lata#pair'. */
export type CardId = string;

export interface Progress {
  v: number;
  worldId: string;
  createdAt: Ts;
  log: Log;
  world: WorldState;
  settings: Record<string, { value: unknown; at: Ts }>;
}

export interface Log {
  checkpoint: Checkpoint | null;
  events: LogEvent[];
}

export interface DayStats {
  /** Завершённые отрезки дня (событие `seg`). */
  segs: string[];
  /** Ответов `rev` за день. */
  revs: number;
  /** Сцен и боссов, дошедших до итога. */
  lessons: number;
}

export interface Checkpoint {
  asOf: Ts;
  covers: Record<string, number>;
  cards: Record<CardId, CardState>;
  lessons: Record<string, { passedAt?: Ts; best: number }>;
  bosses: Record<string, { passedAt?: Ts; best: number }>;
  days: Record<Day, DayStats>;
  zlotyEarned: number;
  zlotySpent: number;
}

export interface CardState {
  reps: number;
  interval: number;
  ef: number;
  due: Ts;
  lapses: number;
  lastReviewAt: Ts;
  lastGrade: 0 | 1 | 2 | 3;
  maxInterval: number;
  createdAt: Ts;
}

export type Stage = 0 | 1 | 2 | 3;

export interface WorldState {
  flags: Record<string, Ts>;
  items: Record<string, Ts>;
  unlocked: Record<string, { stage: Stage; at: Ts }>;
  challenges: Record<string, Ts>;
}

// ── Настройки (ключи §3.10). Значения по умолчанию не пишутся в прогресс: LWW только для правок игрока.

export interface SettingsMap {
  diacritics: 'warn' | 'ok' | 'fail';
  translations: 'tap' | 'always';
  audioSlowDefault: boolean;
  newItemsPerDay: number;
  sfxVolume: number;
  musicVolume: number;
  reducedMotion: boolean;
  showDebtNumber: boolean;
  'controls.dpad': 'auto' | 'always' | 'never';
  'controls.dpadSide': 'left' | 'right';
  'keyboard.mode': 'auto' | 'full' | 'strip';
}

export const SETTINGS_DEFAULTS: SettingsMap = {
  diacritics: 'warn',
  translations: 'tap',
  audioSlowDefault: false,
  newItemsPerDay: 8,
  sfxVolume: 0.8,
  musicVolume: 0.5,
  reducedMotion: false,
  showDebtNumber: true,
  'controls.dpad': 'auto',
  'controls.dpadSide': 'left',
  'keyboard.mode': 'auto',
};

export function getSetting<K extends keyof SettingsMap>(p: Progress, key: K): SettingsMap[K] {
  const s = p.settings[key];
  return s ? (s.value as SettingsMap[K]) : SETTINGS_DEFAULTS[key];
}

export function setSetting<K extends keyof SettingsMap>(p: Progress, key: K, value: SettingsMap[K], now: Ts): Progress {
  return { ...p, settings: { ...p.settings, [key]: { value, at: now } } };
}

// ── Локальное состояние устройства (IndexedDB `pq_local`, в облако не уходит).

export interface LocalState {
  /** 6 символов base32, создаётся при первом запуске. */
  deviceId: string;
  /** Последний выданный seq событий этого устройства. */
  seq: number;
  secret?: string;
  /**
   * Секрет подключён через «У меня есть ссылка» (I-06): при первой встрече с облаком локальный мир
   * вливается в облачный (worldId облака), а если сейва нет, новый мир под этим секретом не создаётся.
   */
  join?: boolean;
  sync: { rev: number; lastSyncAt: Ts | null; lastError: string | null; dirty: boolean };
  position?: { location: string; x: number; y: number };
  resume?: { lessonId: string; stepIndex: number; startedAt: Ts; answers: unknown[] };
  /** Ключи снапшотов перед миграциями (`pq_backup_v<n>_<YYYY-MM-DD>`), старые в начале. */
  backups: string[];
}

export function newLocal(deviceId: string): LocalState {
  return { deviceId, seq: 0, sync: { rev: 0, lastSyncAt: null, lastError: null, dirty: false }, backups: [] };
}

// ── Создание и проверка.

export function newProgress(now: Ts, worldId: string): Progress {
  if (!worldId) throw new Error('worldId required');
  return {
    v: PROGRESS_V,
    worldId,
    createdAt: now,
    log: { checkpoint: null, events: [] },
    world: { flags: {}, items: {}, unlocked: {}, challenges: {} },
    settings: {},
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Структурная проверка прогресса текущей версии. Пустой массив = ок. */
export function validateProgress(x: unknown): string[] {
  const err: string[] = [];
  if (!isObj(x)) return ['не объект'];
  if (!Number.isInteger(x.v) || (x.v as number) < 1) err.push('v: целое ≥ 1');
  if (typeof x.worldId !== 'string' || !x.worldId) err.push('worldId: непустая строка');
  if (!isNum(x.createdAt)) err.push('createdAt: число');
  const log = x.log;
  if (!isObj(log)) err.push('log: объект');
  else {
    if (log.checkpoint !== null && !isObj(log.checkpoint)) err.push('log.checkpoint: null или объект');
    if (!Array.isArray(log.events)) err.push('log.events: массив');
    else {
      const ids = new Set<string>();
      log.events.forEach((e, i) => {
        if (!isLogEvent(e)) err.push(`log.events[${i}]: не событие`);
        else if (ids.has(e.id)) err.push(`log.events[${i}]: дубль id ${e.id}`);
        else ids.add(e.id);
      });
      if (err.length === 0 && !isSorted(log.events as LogEvent[])) err.push('log.events: не отсортированы по (ts, id)');
    }
  }
  const w = x.world;
  if (!isObj(w)) err.push('world: объект');
  else {
    for (const key of ['flags', 'items', 'challenges'] as const) {
      const m = w[key];
      if (!isObj(m) || !Object.values(m).every(isNum)) err.push(`world.${key}: Record<string, Ts>`);
    }
    const u = w.unlocked;
    if (!isObj(u) || !Object.values(u).every((s) => isObj(s) && [0, 1, 2, 3].includes(s.stage as number) && isNum(s.at)))
      err.push('world.unlocked: Record<string, { stage 0..3, at }>');
  }
  const s = x.settings;
  if (!isObj(s) || !Object.values(s).every((v) => isObj(v) && 'value' in v && isNum(v.at)))
    err.push('settings: Record<string, { value, at }>');
  return err;
}

// ── Журнал: дописывание.

export interface DeviceSeq {
  deviceId: string;
  seq: number;
}

export interface AppendOpts {
  /**
   * Фильтр ранних ответов (§3.11): due карточки по её id. Если задан, `rev` по карточке,
   * которая не due, не пишется (`rejected: 'early'`), по несуществующей — `'no_card'`.
   * Карточки выводит derive (I-05); исключение заказов задаёт `earlyDaysOf`.
   */
  dueOf?: (card: CardId) => Ts | undefined;
  earlyDaysOf?: (card: CardId) => number;
  time?: TimeOpts;
}

export type AppendResult =
  | { ok: true; progress: Progress; dev: DeviceSeq; event: LogEvent }
  | { ok: false; progress: Progress; dev: DeviceSeq; rejected: Exclude<RevVerdict, 'ok'> };

/** Дописать событие устройства: id = `${deviceId}.${seq36}`, seq + 1, журнал остаётся отсортированным. */
export function append(p: Progress, dev: DeviceSeq, draft: EventDraft, opts: AppendOpts = {}): AppendResult {
  if (draft.k === 'rev' && opts.dueOf) {
    const verdict = revVerdict({
      due: opts.dueOf(draft.card),
      now: draft.ts,
      src: draft.src,
      earlyDays: opts.earlyDaysOf?.(draft.card),
      opts: opts.time,
    });
    if (verdict !== 'ok') return { ok: false, progress: p, dev, rejected: verdict };
  }
  const seq = dev.seq + 1;
  const event = compactEvent({ id: eventId(dev.deviceId, seq), ...draft } as LogEvent);
  return { ok: true, progress: insertSorted(p, [event]), dev: { deviceId: dev.deviceId, seq }, event };
}

/**
 * Вставить готовые события (импорт `imp.*`, слияние журналов). Объединение по id: событие с уже
 * известным id пропускается, поэтому повторный импорт не дублирует. Порядок (ts, id) сохраняется.
 */
export function insertEvents(p: Progress, incoming: readonly LogEvent[]): Progress {
  if (incoming.length === 0) return p;
  const known = new Set(p.log.events.map((e) => e.id));
  const add: LogEvent[] = [];
  for (const raw of incoming) {
    if (known.has(raw.id)) continue;
    known.add(raw.id);
    add.push(compactEvent(raw));
  }
  return add.length ? insertSorted(p, add) : p;
}

/** Вставка без проверки дублей (id новых событий устройства уникальны по seq). */
function insertSorted(p: Progress, add: LogEvent[]): Progress {
  add.sort(compareEvents);
  const events = p.log.events;
  let next: LogEvent[];
  const last = events[events.length - 1];
  if (!last || compareEvents(last, add[0]!) < 0) {
    next = events.concat(add); // частый случай: новое событие позже всех
  } else {
    next = events.slice();
    for (const e of add) next.splice(upperBound(next, e), 0, e);
  }
  return { ...p, log: { ...p.log, events: next } };
}

function upperBound(arr: readonly LogEvent[], e: LogEvent): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareEvents(arr[mid]!, e) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Наибольший seq устройства в журнале и checkpoint (чтобы после сбоя `pq_local` не выдать id повторно). */
export function maxSeqFor(p: Progress, deviceId: string): number {
  let max = p.log.checkpoint?.covers[deviceId] ?? 0;
  for (const e of p.log.events) {
    const parsed = parseEventId(e.id);
    if (parsed && parsed.deviceId === deviceId && parsed.seq > max) max = parsed.seq;
  }
  return max;
}

// ── Монотонный world (§3.10, §4.9): флаги, предметы, челленджи — раз поставлено, не снимается.

function stamp(m: Record<string, Ts>, key: string, now: Ts): Record<string, Ts> | null {
  const cur = m[key];
  if (cur !== undefined && cur <= now) return null;
  return { ...m, [key]: now };
}

export function setFlag(p: Progress, flag: string, now: Ts): Progress {
  const flags = stamp(p.world.flags, flag, now);
  return flags ? { ...p, world: { ...p.world, flags } } : p;
}

export function giveItem(p: Progress, item: string, now: Ts): Progress {
  const items = stamp(p.world.items, item, now);
  return items ? { ...p, world: { ...p.world, items } } : p;
}

export function markChallenge(p: Progress, id: string, now: Ts): Progress {
  const challenges = stamp(p.world.challenges, id, now);
  return challenges ? { ...p, world: { ...p.world, challenges } } : p;
}

/** Стадия биома только растёт (§4.9). */
export function raiseStage(p: Progress, biome: string, stage: Stage, now: Ts): Progress {
  const cur = p.world.unlocked[biome];
  if (cur && cur.stage >= stage) return p;
  return { ...p, world: { ...p.world, unlocked: { ...p.world.unlocked, [biome]: { stage, at: now } } } };
}
