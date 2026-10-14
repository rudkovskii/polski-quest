// Слияние двух прогрессов одного мира (ТЗ §6.4). Чистая функция: коммутативна, идемпотентна,
// ассоциативна (при сравнимых checkpoint, инвариант §3.12). Обе стороны заранее доведены до PROGRESS_V.
//
// Приём: каждое поле сливается выбором максимума по полному порядку или объединением множеств.
// Такие операции не зависят от порядка аргументов, повторов и группировки, поэтому офлайн-сессия
// на iPhone и сессия на Mac сходятся к одному журналу независимо от того, кто синкнулся первым.
import { compactEvent, compareEvents, parseEventId, type LogEvent } from './log';
import type { Checkpoint, Progress, Stage, WorldState } from './progress';
import type { Ts } from './time';

/** Прогрессы разных миров: решает игрок («облако или это устройство», §6.4). */
export class DifferentWorlds extends Error {
  readonly a: string;
  readonly b: string;
  constructor(a: string, b: string) {
    super(`разные миры: ${a} и ${b}`);
    this.name = 'DifferentWorlds';
    this.a = a;
    this.b = b;
  }
}

export interface MergeReport {
  progress: Progress;
  /** Событий в результате, которых не было в `a` (для `progress:merged.remoteEvents`). */
  addedToA: number;
  /** Несравнимые checkpoint и другие аномалии: в консоль и в «Дневник». */
  warnings: string[];
}

export function merge(a: Progress, b: Progress): Progress {
  return mergeReport(a, b).progress;
}

export function mergeReport(a: Progress, b: Progress): MergeReport {
  if (a.worldId !== b.worldId) throw new DifferentWorlds(a.worldId, b.worldId);
  const warnings: string[] = [];

  const checkpoint = pickCheckpoint(a.log.checkpoint, b.log.checkpoint, warnings);
  const events = mergeEvents(a.log.events, b.log.events, checkpoint);

  const known = new Set(a.log.events.map((e) => e.id));
  let addedToA = 0;
  for (const e of events) if (!known.has(e.id)) addedToA++;

  const progress: Progress = {
    v: Math.max(a.v, b.v),
    worldId: a.worldId,
    createdAt: Math.min(a.createdAt, b.createdAt),
    log: { checkpoint, events },
    world: mergeWorld(a.world, b.world),
    settings: mergeSettings(a.settings, b.settings),
  };
  return { progress, addedToA, warnings };
}

/**
 * Пустой мир: ни событий, ни флагов, ни настроек. Такой мир на новом устройстве молча
 * уступает облачному при подключении по ссылке (вопрос «облако или устройство» не нужен).
 */
export function isPristine(p: Progress): boolean {
  const w = p.world;
  return (
    p.log.events.length === 0 &&
    p.log.checkpoint === null &&
    Object.keys(p.settings).length === 0 &&
    Object.keys(w.flags).length === 0 &&
    Object.keys(w.items).length === 0 &&
    Object.keys(w.unlocked).length === 0 &&
    Object.keys(w.challenges).length === 0
  );
}

/**
 * Влить локальный прогресс в облачный мир: локальные события и флаги сохраняются, worldId и
 * createdAt берутся у облака. Для пустого мира или подключения по ссылке офлайн (§5.2).
 */
export function rebaseOnto(local: Progress, remote: Progress): Progress {
  return merge({ ...local, worldId: remote.worldId, createdAt: remote.createdAt }, remote);
}

/** Одинаковы ли прогрессы по содержанию (порядок ключей не важен). */
export function sameProgress(a: Progress, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** JSON с ключами объектов по алфавиту: детерминированное сравнение и разрешение ничьих. */
export function canonicalJson(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const o = x as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

// ── Журнал.

/** Объединение по id. Одинаковый id с разным содержимым (не должно случаться) → больший canonicalJson. */
function mergeEvents(a: readonly LogEvent[], b: readonly LogEvent[], cp: Checkpoint | null): LogEvent[] {
  const byId = new Map<string, { e: LogEvent; key: string | null }>();
  const add = (raw: LogEvent): void => {
    if (cp && coveredBy(raw.id, cp)) return;
    const e = compactEvent(raw);
    const cur = byId.get(e.id);
    if (!cur) {
      byId.set(e.id, { e, key: null });
      return;
    }
    if (cur.e === e) return;
    const curKey = (cur.key ??= canonicalJson(cur.e));
    const key = canonicalJson(e);
    if (key > curKey) byId.set(e.id, { e, key });
  };
  for (const e of a) add(e);
  for (const e of b) add(e);
  return [...byId.values()].map((x) => x.e).sort(compareEvents);
}

function coveredBy(id: string, cp: Checkpoint): boolean {
  const parsed = parseEventId(id);
  if (!parsed) return false; // импортные `imp.*` свёрткой не покрываются
  const max = cp.covers[parsed.deviceId];
  return max !== undefined && parsed.seq <= max;
}

// ── Checkpoint (§3.12): сравнимые → больший; несравнимые → больший по Σ covers, предупреждение.

function sumCovers(cp: Checkpoint): number {
  let s = 0;
  for (const v of Object.values(cp.covers)) s += v;
  return s;
}

/** a покрывает b: covers[a] ≥ covers[b] по каждому устройству b. */
export function covers(a: Checkpoint, b: Checkpoint): boolean {
  for (const [dev, seq] of Object.entries(b.covers)) if ((a.covers[dev] ?? 0) < seq) return false;
  return true;
}

/**
 * Полный порядок: (Σ covers, canonicalJson). Он согласован с «покрывает»: если a покрывает b и
 * они различны, то Σa > Σb или (Σ равны, covers равны) и решает canonicalJson. Поэтому выбор
 * максимума и коммутативен, и ассоциативен.
 */
function pickCheckpoint(a: Checkpoint | null, b: Checkpoint | null, warnings: string[]): Checkpoint | null {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (!covers(a, b) && !covers(b, a)) {
    warnings.push('checkpoint: несравнимые свёртки, взята большая по Σ covers; события вне неё сохранены');
  }
  const sa = sumCovers(a);
  const sb = sumCovers(b);
  if (sa !== sb) return sa > sb ? a : b;
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

// ── Мир: монотонные множества.

function minTsUnion(a: Record<string, Ts>, b: Record<string, Ts>): Record<string, Ts> {
  const out: Record<string, Ts> = {};
  for (const k of unionKeys(a, b)) {
    const x = a[k];
    const y = b[k];
    out[k] = x === undefined ? y! : y === undefined ? x : Math.min(x, y);
  }
  return out;
}

function mergeWorld(a: WorldState, b: WorldState): WorldState {
  const unlocked: Record<string, { stage: Stage; at: Ts }> = {};
  for (const k of unionKeys(a.unlocked, b.unlocked)) {
    const x = a.unlocked[k];
    const y = b.unlocked[k];
    // max(stage); при равенстве min(at).
    if (!x) unlocked[k] = { ...y! };
    else if (!y) unlocked[k] = { ...x };
    else if (x.stage !== y.stage) unlocked[k] = { ...(x.stage > y.stage ? x : y) };
    else unlocked[k] = { stage: x.stage, at: Math.min(x.at, y.at) };
  }
  return {
    flags: minTsUnion(a.flags, b.flags),
    items: minTsUnion(a.items, b.items),
    unlocked,
    challenges: minTsUnion(a.challenges, b.challenges),
  };
}

// ── Настройки: LWW по `at`, при равенстве больший canonicalJson(value).

type Settings = Progress['settings'];

function mergeSettings(a: Settings, b: Settings): Settings {
  const out: Settings = {};
  for (const k of unionKeys(a, b)) {
    const x = a[k];
    const y = b[k];
    if (!x) out[k] = y!;
    else if (!y) out[k] = x;
    else if (x.at !== y.at) out[k] = x.at > y.at ? x : y;
    else out[k] = canonicalJson(x.value) >= canonicalJson(y.value) ? x : y;
  }
  return out;
}

/** Ключи обеих сторон по алфавиту: результат не зависит от порядка ключей во входе. */
function unionKeys(a: object, b: object): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}
