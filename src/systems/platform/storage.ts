// Хранилище прогресса (ТЗ §3.10, §3.12, §6.3): IndexedDB через idb-keyval, запасной localStorage, затем память.
// Все обращения к хранилищам в try/catch. Запись с дебаунсом 400 мс; при уходе со страницы — немедленная
// запись плюс синхронная аварийная копия в localStorage, чтобы закрытие вкладки не теряло последние ответы.
import { createStore, del, get, keys, setMany, type UseStore } from 'idb-keyval';
import type { EventDraft } from '../log';
import { BACKUP_PREFIX, backupKey, backupsToPrune, canWrite, migrate, sortBackups, type MigrationRegistry } from '../migrations';
import {
  append as appendEvent,
  maxSeqFor,
  newLocal,
  newProgress,
  PROGRESS_V,
  type AppendOpts,
  type AppendResult,
  type LocalState,
  type Progress,
} from '../progress';
import { dayOf, type Ts } from '../time';

export const KEYS = {
  progress: 'pq_progress',
  local: 'pq_local',
  /** Аварийная копия прогресса в localStorage (pagehide), удаляется после успешной записи в IndexedDB. */
  tail: 'pq_progress_tail',
} as const;

export type BackendKind = 'idb' | 'local' | 'memory';

export interface KV {
  readonly kind: BackendKind;
  get(key: string): Promise<unknown>;
  setMany(entries: [string, unknown][]): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Подмножество Web Storage, которое нужно адаптеру (в тестах — мок). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

// ── Бэкенды.

const IDB_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`IndexedDB: ${what} timeout`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function idbKV(store: UseStore): KV {
  return {
    kind: 'idb',
    get: (k) => withTimeout(get(k, store), IDB_TIMEOUT_MS, 'get'),
    setMany: (entries) => withTimeout(setMany(entries, store), IDB_TIMEOUT_MS, 'set'),
    del: (k) => withTimeout(del(k, store), IDB_TIMEOUT_MS, 'del'),
    keys: () => withTimeout(keys<IDBValidKey>(store), IDB_TIMEOUT_MS, 'keys').then((ks) => ks.map(String)),
  };
}

/**
 * localStorage: значения как JSON. Операции синхронные внутри (важно для pagehide), ошибки — rejected promise.
 * `ns` — пространство имён другой версии игры в том же origin (Wola, W-01: `wola:`): ключ `k` лежит как `ns + k`,
 * `keys()` видит только своё и отдаёт ключи без `ns`. Основная игра — пустое `ns`, ключи как раньше.
 */
export function lsKV(ls: StorageLike, prefix = 'pq_', ns = ''): KV {
  const sync = <T>(fn: () => T): Promise<T> => {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };
  return {
    kind: 'local',
    get: (k) =>
      sync(() => {
        const s = ls.getItem(ns + k);
        return s === null ? undefined : (JSON.parse(s) as unknown);
      }),
    setMany: (entries) =>
      sync(() => {
        for (const [k, v] of entries) ls.setItem(ns + k, JSON.stringify(v));
      }),
    del: (k) => sync(() => ls.removeItem(ns + k)),
    keys: () =>
      sync(() => {
        const out: string[] = [];
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k === null || !k.startsWith(ns + prefix)) continue;
          const own = k.slice(ns.length);
          if (own !== KEYS.tail) out.push(own);
        }
        return out;
      }),
  };
}

export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    kind: 'memory',
    get: (k) => Promise.resolve(m.has(k) ? structuredClone(m.get(k)) : undefined),
    setMany: (entries) => {
      for (const [k, v] of entries) m.set(k, structuredClone(v));
      return Promise.resolve();
    },
    del: (k) => {
      m.delete(k);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...m.keys()]),
  };
}

/** Цепочка бэкендов: при ошибке операции переключаемся на следующий и повторяем её там. */
export class FallbackKV implements KV {
  private i = 0;
  constructor(
    private readonly chain: KV[],
    private readonly onSwitch?: (from: BackendKind, to: BackendKind, err: unknown) => void,
  ) {
    if (chain.length === 0) throw new Error('FallbackKV: пустая цепочка');
  }
  get kind(): BackendKind {
    return this.chain[this.i]!.kind;
  }
  private async run<T>(op: (kv: KV) => Promise<T>): Promise<T> {
    for (;;) {
      const kv = this.chain[this.i]!;
      try {
        return await op(kv);
      } catch (err) {
        const next = this.chain[this.i + 1];
        if (!next) throw err;
        console.warn(`storage: ${kv.kind} не работает, переключаюсь на ${next.kind}`, err);
        this.onSwitch?.(kv.kind, next.kind, err);
        this.i++;
      }
    }
  }
  get(k: string): Promise<unknown> {
    return this.run((kv) => kv.get(k));
  }
  setMany(entries: [string, unknown][]): Promise<void> {
    return this.run((kv) => kv.setMany(entries));
  }
  del(k: string): Promise<void> {
    return this.run((kv) => kv.del(k));
  }
  keys(): Promise<string[]> {
    return this.run((kv) => kv.keys());
  }
}

function globalLocalStorage(): StorageLike | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__pq_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null; // Safari private mode, заблокированные cookie и т.п.
  }
}

function defaultIdb(dbName: string): UseStore | null {
  try {
    if (typeof indexedDB === 'undefined') return null;
    return createStore(dbName, 'kv');
  } catch {
    return null;
  }
}

// ── Случайные id (base32 lowercase).

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function randomBase32(len: number): string {
  const bytes = new Uint8Array(len);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (const b of bytes) out += B32[b & 31];
  return out;
}

// ── Хранилище игры.

export interface StorageOptions {
  /** Готовый бэкенд (тесты). Иначе цепочка IndexedDB → localStorage → память. */
  kv?: KV;
  /** Своя IndexedDB-база (тесты); null — не использовать IndexedDB. */
  idb?: UseStore | null;
  dbName?: string;
  /** localStorage для запасного бэкенда и аварийной копии; null — не использовать. */
  ls?: StorageLike | null;
  debounceMs?: number;
  /** Не откладывать запись дольше этого при непрерывных изменениях. */
  maxWaitMs?: number;
  registry?: MigrationRegistry;
  targetV?: number;
  keepBackups?: number;
  randomId?: (len: number) => string;
  /** Пояс для имени снапшота (`pq_backup_v<n>_<YYYY-MM-DD>`). */
  tz?: string;
  /**
   * Пространство имён в localStorage (запасной бэкенд и аварийная копия) для другой версии игры в том же origin:
   * Wola (W-01) — `wola:`. IndexedDB разводится `dbName`. Основная игра — пусто.
   */
  lsNamespace?: string;
}

export interface LoadResult {
  progress: Progress;
  local: LocalState;
  /** Мир создан с нуля (хранилище было пустым или данные нечитаемы). */
  created: boolean;
  /** Прогресс новее клиента: только чтение, синк выключен, баннер «Обнови игру» (§3.12). */
  readOnly: boolean;
  /** Исходная версия, если была миграция (снапшот уже записан). */
  migratedFrom?: number;
  /** Взята аварийная копия из localStorage (прошлая вкладка закрылась до записи в IndexedDB). */
  recovered: boolean;
  backend: BackendKind;
  problems: string[];
}

const DEVICE_RE = /^[a-z2-7]{6}$/;

function asLocal(raw: unknown): LocalState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LocalState>;
  if (typeof r.deviceId !== 'string' || !DEVICE_RE.test(r.deviceId)) return null;
  const base = newLocal(r.deviceId);
  return {
    ...base,
    ...r,
    seq: Number.isInteger(r.seq) && (r.seq as number) >= 0 ? (r.seq as number) : 0,
    sync: { ...base.sync, ...(r.sync ?? {}) },
    backups: Array.isArray(r.backups) ? r.backups.filter((k): k is string => typeof k === 'string') : [],
  };
}

export class GameStorage {
  readonly kv: KV;
  private readonly ls: StorageLike | null;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly registry: MigrationRegistry | undefined;
  private readonly targetV: number;
  private readonly keepBackups: number;
  private readonly randomId: (len: number) => string;
  private readonly tz: string | undefined;
  private readonly tailKey: string;

  private p: Progress | null = null;
  private l: LocalState | null = null;
  private ro = false;
  private dirtyP = false;
  private dirtyL = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt = 0;
  private writing: Promise<void> = Promise.resolve();
  /** Записей прогресса в полёте: pagehide может оборвать их, поэтому аварийная копия нужна и для них. */
  private inFlightP = 0;

  constructor(opts: StorageOptions = {}) {
    this.ls = opts.ls === undefined ? globalLocalStorage() : opts.ls;
    this.debounceMs = opts.debounceMs ?? 400;
    this.maxWaitMs = opts.maxWaitMs ?? 2000;
    this.registry = opts.registry;
    this.targetV = opts.targetV ?? PROGRESS_V;
    this.keepBackups = opts.keepBackups ?? 3;
    this.randomId = opts.randomId ?? randomBase32;
    this.tz = opts.tz;
    this.tailKey = `${opts.lsNamespace ?? ''}${KEYS.tail}`;
    if (opts.kv) this.kv = opts.kv;
    else {
      const chain: KV[] = [];
      const idb = opts.idb === undefined ? defaultIdb(opts.dbName ?? 'polski-quest') : opts.idb;
      if (idb) chain.push(idbKV(idb));
      if (this.ls) chain.push(lsKV(this.ls, 'pq_', opts.lsNamespace ?? ''));
      chain.push(memoryKV());
      this.kv = new FallbackKV(chain);
    }
  }

  get progress(): Progress {
    if (!this.p) throw new Error('storage: сначала load()');
    return this.p;
  }
  get local(): LocalState {
    if (!this.l) throw new Error('storage: сначала load()');
    return this.l;
  }
  get readOnly(): boolean {
    return this.ro;
  }
  get backend(): BackendKind {
    return this.kv.kind;
  }
  /** Есть несохранённые изменения. */
  get dirty(): boolean {
    return this.dirtyP || this.dirtyL;
  }

  async load(now: Ts): Promise<LoadResult> {
    const problems: string[] = [];
    let created = false;
    let recovered = false;
    let migratedFrom: number | undefined;

    let local = asLocal(await this.safeGet(KEYS.local, problems));
    if (!local) {
      local = newLocal(this.randomId(6));
      this.dirtyL = true;
    }

    const tail = this.readTail(problems);
    const stored = await this.safeGet(KEYS.progress, problems);
    const candidates: { raw: unknown; fromTail: boolean }[] = [];
    if (tail !== undefined) candidates.push({ raw: tail, fromTail: true });
    if (stored !== undefined) candidates.push({ raw: stored, fromTail: false });

    let progress: Progress | null = null;
    for (const c of candidates) {
      const r = migrate(c.raw, this.registry, this.targetV);
      if (r.ok) {
        progress = r.progress;
        recovered = c.fromTail;
        if (r.migrated) {
          migratedFrom = r.from;
          await this.snapshot(c.raw, r.from, now, local, problems);
        }
        if (r.migrated || c.fromTail) this.dirtyP = true;
        break;
      }
      if (r.reason === 'newer') {
        progress = c.raw as Progress;
        this.ro = true;
        recovered = c.fromTail;
        problems.push(`прогресс v${r.from} новее клиента v${this.targetV}: только чтение`);
        break;
      }
      problems.push(`${c.fromTail ? 'аварийная копия' : KEYS.progress}: ${r.reason === 'gap' ? `нет миграции ${r.missing}` : r.errors.join('; ')}`);
    }

    if (!progress) {
      if (stored !== undefined) {
        // Нечитаемые данные не затираем молча: кладём рядом и начинаем новый мир.
        const key = `${BACKUP_PREFIX}corrupt_${dayOf(now, { dayStartHour: 0, tz: this.tz })}`;
        try {
          await this.kv.setMany([[key, stored]]);
        } catch (e) {
          problems.push(`не удалось сохранить битые данные: ${String(e)}`);
        }
      }
      progress = newProgress(now, this.randomId(16));
      created = true;
      this.dirtyP = true;
    }

    const seq = Math.max(local.seq, maxSeqFor(progress, local.deviceId));
    if (seq !== local.seq) {
      local = { ...local, seq };
      this.dirtyL = true;
    }

    this.p = progress;
    this.l = local;
    if (this.dirty) await this.flush();
    void this.requestPersist();

    const res: LoadResult = { progress, local: this.l, created, readOnly: this.ro, recovered, backend: this.kv.kind, problems };
    if (migratedFrom !== undefined) res.migratedFrom = migratedFrom;
    return res;
  }

  /** Новый прогресс в память и отложенная запись. false — запись запрещена (только чтение или версия новее). */
  setProgress(p: Progress): boolean {
    if (this.ro || !canWrite(p, this.targetV)) return false;
    this.p = p;
    this.dirtyP = true;
    this.schedule();
    return true;
  }

  setLocal(l: LocalState): void {
    this.l = l;
    this.dirtyL = true;
    this.schedule();
  }

  /** Дописать событие этого устройства (id из deviceId и seq) и запланировать запись. */
  append(draft: EventDraft, opts?: AppendOpts): AppendResult {
    if (this.ro) throw new Error('storage: только чтение');
    const r = appendEvent(this.progress, { deviceId: this.local.deviceId, seq: this.local.seq }, draft, opts);
    if (r.ok) {
      this.p = r.progress;
      this.l = { ...this.local, seq: r.dev.seq };
      this.dirtyP = this.dirtyL = true;
      this.schedule();
    }
    return r;
  }

  /** «Заменить» при импорте (§5.12): сразу на диск. Автоэкспорт текущего делает UI до вызова. */
  async replaceProgress(p: Progress): Promise<boolean> {
    if (!this.setProgress(p)) return false;
    const seq = Math.max(this.local.seq, maxSeqFor(p, this.local.deviceId));
    if (seq !== this.local.seq) this.setLocal({ ...this.local, seq });
    await this.flush();
    return true;
  }

  private schedule(): void {
    const now = Date.now();
    if (this.timer === null) this.firstDirtyAt = now;
    else clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, this.maxWaitMs - (now - this.firstDirtyAt)));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  /** Немедленная запись накопленного. Ошибки не бросает: данные остаются «грязными» до следующей попытки. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const entries: [string, unknown][] = [];
    const wroteP = this.dirtyP && !this.ro && this.p !== null;
    if (wroteP) entries.push([KEYS.progress, this.p]);
    if (this.dirtyL && this.l) entries.push([KEYS.local, this.l]);
    if (entries.length === 0) return this.writing;
    this.dirtyP = false;
    this.dirtyL = false;
    const pSnap = this.p;
    const lSnap = this.l;
    if (wroteP) this.inFlightP++;
    // Запись стартует синхронно (для localStorage — целиком), очередь сохраняет порядок.
    const job = this.kv.setMany(entries).then(
      () => {
        if (!wroteP) return;
        this.inFlightP--;
        // Текущее состояние на диске и включает всё, что было в аварийной копии.
        if (this.p === pSnap && !this.dirtyP && this.inFlightP === 0) this.clearTail();
      },
      (err: unknown) => {
        if (wroteP) this.inFlightP--;
        console.warn('storage: запись не удалась', err);
        if (wroteP && this.p === pSnap) this.dirtyP = true;
        if (this.l === lSnap) this.dirtyL = true;
      },
    );
    this.writing = this.writing.then(() => job);
    return this.writing;
  }

  /**
   * Синхронная аварийная копия (pagehide/visibilitychange): IndexedDB может не успеть до закрытия вкладки.
   * Нужна только когда основной бэкенд асинхронный.
   */
  flushSync(): void {
    if (!(this.dirtyP || this.inFlightP > 0) || this.ro || !this.p || !this.ls || this.kv.kind !== 'idb') return;
    try {
      this.ls.setItem(this.tailKey, JSON.stringify(this.p));
    } catch (e) {
      console.warn('storage: аварийная копия не записана', e);
    }
  }

  /** Подписка на уход со страницы. Возвращает отписку. */
  attachLifecycle(env: { win?: EventTarget; doc?: EventTarget & { visibilityState: string } } = {}): () => void {
    const win = env.win ?? (typeof window !== 'undefined' ? window : undefined);
    const doc = env.doc ?? (typeof document !== 'undefined' ? document : undefined);
    const save = (): void => {
      this.flushSync();
      void this.flush();
    };
    const onVis = (): void => {
      if (doc?.visibilityState === 'hidden') save();
    };
    win?.addEventListener('pagehide', save);
    doc?.addEventListener('freeze', save); // Page Lifecycle: вкладку замораживают в фоне
    doc?.addEventListener('visibilitychange', onVis);
    return () => {
      win?.removeEventListener('pagehide', save);
      doc?.removeEventListener('freeze', save);
      doc?.removeEventListener('visibilitychange', onVis);
    };
  }

  /** navigator.storage.persist(): просим браузер не вычищать данные (iOS ITP). */
  async requestPersist(): Promise<boolean> {
    try {
      const sm = typeof navigator !== 'undefined' ? navigator.storage : undefined;
      if (!sm?.persist) return false;
      if (sm.persisted && (await sm.persisted())) return true;
      return await sm.persist();
    } catch {
      return false;
    }
  }

  async listBackups(): Promise<string[]> {
    try {
      return sortBackups(await this.kv.keys());
    } catch {
      return [];
    }
  }

  async readBackup(key: string): Promise<unknown> {
    try {
      return await this.kv.get(key);
    } catch {
      return undefined;
    }
  }

  // ── Внутреннее.

  private async safeGet(key: string, problems: string[]): Promise<unknown> {
    try {
      return await this.kv.get(key);
    } catch (e) {
      problems.push(`чтение ${key}: ${String(e)}`);
      return undefined;
    }
  }

  private readTail(problems: string[]): unknown {
    if (!this.ls) return undefined;
    try {
      const s = this.ls.getItem(this.tailKey);
      return s === null ? undefined : (JSON.parse(s) as unknown);
    } catch (e) {
      problems.push(`аварийная копия: ${String(e)}`);
      return undefined;
    }
  }

  private clearTail(): void {
    try {
      this.ls?.removeItem(this.tailKey);
    } catch {
      /* не критично */
    }
  }

  /** Снапшот исходного JSON перед миграцией, хранить `keepBackups` последних (§3.12). */
  private async snapshot(raw: unknown, fromV: number, now: Ts, local: LocalState, problems: string[]): Promise<void> {
    const key = backupKey(fromV, dayOf(now, { dayStartHour: 0, tz: this.tz }));
    try {
      await this.kv.setMany([[key, raw]]);
      const all = sortBackups(await this.kv.keys());
      const drop = backupsToPrune(all, this.keepBackups);
      for (const k of drop) await this.kv.del(k);
      local.backups = all.filter((k) => !drop.includes(k));
      this.dirtyL = true;
    } catch (e) {
      problems.push(`снапшот перед миграцией: ${String(e)}`);
    }
  }
}
