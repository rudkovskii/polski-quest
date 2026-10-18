// Хранилище сохранения: IndexedDB через idb-keyval, запасной localStorage, затем память.
// Все обращения к хранилищам в try/catch. Запись с дебаунсом 400 мс (не позже 1 с при непрерывных ответах); при ошибке записи — повтор с паузой,
// подписчики (`onWrite`) узнают об успехе и о сбое (HUD: галочка «сохранено», тост «Не сохранилось, повторяю»); при уходе со страницы — немедленная
// запись плюс синхронная аварийная копия в localStorage, чтобы закрытие вкладки не теряло последние ответы.
import { createStore, del, get, keys, setMany, type UseStore } from 'idb-keyval';
import { newSave, normalizeSave, type Save } from '../save';

export const KEYS = {
  save: 'pq_save',
  /** Аварийная копия сохранения в localStorage (pagehide), удаляется после успешной записи в IndexedDB. */
  tail: 'pq_save_tail',
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

/** localStorage: значения как JSON. Операции синхронные внутри (важно для pagehide), ошибки — rejected promise. */
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

// ── Хранилище игры.

/** Профиль для тестов: `?dev=<id>` → база `polski-farm-<id>` (id: латиница, цифры, `-`, `_`, до 32 знаков; иначе null). */
export function parseProfile(raw: string | null): string | null {
  if (!raw || raw === '0') return null;
  const id = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(id) ? id : null;
}

export function profileDbName(profile: string): string {
  return `polski-farm-${profile}`;
}

export interface StorageOptions {
  /** Готовый бэкенд (тесты). Иначе цепочка IndexedDB → localStorage → память. */
  kv?: KV;
  /** Своя IndexedDB-база (тесты); null — не использовать IndexedDB. */
  idb?: UseStore | null;
  dbName?: string;
  /** Профиль (`?dev=<id>`): своя база `polski-farm-<id>` и свои ключи localStorage, основное сохранение не трогаем. */
  profile?: string;
  /** localStorage для запасного бэкенда и аварийной копии; null — не использовать. */
  ls?: StorageLike | null;
  debounceMs?: number;
  /** Не откладывать запись дольше этого при непрерывных изменениях (V11a: ≤ 1 с). */
  maxWaitMs?: number;
  /** Пауза перед повтором после ошибки записи (дальше удваивается до `RETRY_MAX_MS`). */
  retryMs?: number;
}

/** Исход записи для HUD: `saved` — данные дошли до хранилища (`at` — настенное время), `error` — запись не удалась, будет повтор. */
export type WriteEvent = { type: 'saved'; at: number } | { type: 'error'; error: unknown; retryInMs: number };

export const DEFAULT_MAX_WAIT_MS = 1000;
const RETRY_MAX_MS = 10_000;

export interface LoadResult {
  save: Save;
  /** Сохранение создано с нуля (хранилище пустое или данные нечитаемы). */
  created: boolean;
  /** Взята аварийная копия из localStorage (прошлая вкладка закрылась до записи в IndexedDB). */
  recovered: boolean;
  backend: BackendKind;
}

export class GameStorage {
  readonly kv: KV;
  private readonly ls: StorageLike | null;
  /** Префикс ключей localStorage профиля ('' — основной). */
  private readonly ns: string;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly retryBase: number;
  private retryMs: number;
  private readonly listeners = new Set<(e: WriteEvent) => void>();
  private savedAt0: number | null = null;
  private s: Save | null = null;
  private dirty0 = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt = 0;
  private writing: Promise<void> = Promise.resolve();
  private inFlight = 0;
  /** Хранилище стёрто (`wipe`): больше ничего не пишем, дальше только перезагрузка страницы. */
  private wiped = false;

  constructor(opts: StorageOptions = {}) {
    this.ls = opts.ls === undefined ? globalLocalStorage() : opts.ls;
    this.ns = opts.profile ? `${profileDbName(opts.profile)}:` : '';
    this.debounceMs = opts.debounceMs ?? 400;
    this.maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.retryBase = opts.retryMs ?? 1500;
    this.retryMs = this.retryBase;
    if (opts.kv) this.kv = opts.kv;
    else {
      const chain: KV[] = [];
      const idb = opts.idb === undefined ? defaultIdb(opts.dbName ?? (opts.profile ? profileDbName(opts.profile) : 'polski-quest-farm')) : opts.idb;
      if (idb) chain.push(idbKV(idb));
      if (this.ls) chain.push(lsKV(this.ls, 'pq_', this.ns));
      chain.push(memoryKV());
      this.kv = new FallbackKV(chain);
    }
  }

  get save(): Save {
    if (!this.s) throw new Error('storage: сначала load()');
    return this.s;
  }
  get backend(): BackendKind {
    return this.kv.kind;
  }
  /** Есть несохранённые изменения. */
  get dirty(): boolean {
    return this.dirty0;
  }
  /** Когда запись последний раз дошла до хранилища (настенное время); null — с запуска ничего не писали. */
  get lastSavedAt(): number | null {
    return this.savedAt0;
  }

  /** Подписка на исходы записи. Возвращает отписку. */
  onWrite(fn: (e: WriteEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: WriteEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.warn('storage: подписчик упал', err);
      }
    }
  }

  async load(now: number): Promise<LoadResult> {
    let raw: unknown;
    try {
      raw = await this.kv.get(KEYS.save);
    } catch (e) {
      console.warn('storage: чтение не удалось', e);
    }
    let save = normalizeSave(raw);
    // Записи шли в localStorage (IndexedDB падал), а теперь IndexedDB жив, но с прошлой версией: берём более свежую.
    const lsSave = this.readLsSave();
    if (lsSave && (!save || lsSave.updated > save.updated) && this.kv.kind !== 'local') {
      save = lsSave;
      this.dirty0 = true;
    }
    let recovered = false;
    const tail = this.readTail();
    // Аварийная копия новее записи в IndexedDB: прошлая вкладка закрылась до записи.
    if (tail && (!save || tail.updated > save.updated)) {
      save = tail;
      recovered = true;
      this.dirty0 = true;
    }
    const created = !save;
    this.s = save ?? newSave(now);
    if (created) this.dirty0 = true;
    if (this.dirty0) await this.flush();
    return { save: this.s, created, recovered, backend: this.kv.kind };
  }

  /** Изменить сохранение; запись отложится на debounce. */
  update(patch: (s: Save) => Save, now: number): void {
    this.s = { ...patch(this.save), updated: now };
    this.dirty0 = true;
    this.schedule();
  }

  /** Заменить сохранение целиком (импорт) и записать сразу. */
  async replace(next: Save, now: number): Promise<void> {
    this.s = { ...next, updated: now };
    this.dirty0 = true;
    await this.flush();
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

  /** Немедленная запись. Ошибки не бросает: данные остаются «грязными» до следующей попытки. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.wiped || !this.dirty0 || !this.s) return this.writing;
    this.dirty0 = false;
    const snap = this.s;
    this.inFlight++;
    const job = this.kv.setMany([[KEYS.save, snap]]).then(
      () => {
        this.inFlight--;
        this.retryMs = this.retryBase;
        this.savedAt0 = Date.now();
        if (this.s === snap && !this.dirty0 && this.inFlight === 0) this.clearTail();
        this.emit({ type: 'saved', at: this.savedAt0 });
      },
      (err: unknown) => {
        this.inFlight--;
        console.warn('storage: запись не удалась', err);
        if (this.s === snap) this.dirty0 = true;
        // Повтор: данные остаются «грязными», пока запись не пройдёт. Новое изменение перебьёт этот таймер обычным дебаунсом.
        const wait = this.retryMs;
        this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
        if (!this.wiped && this.timer === null) {
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
          }, wait);
        }
        this.emit({ type: 'error', error: err, retryInMs: wait });
      },
    );
    this.writing = this.writing.then(() => job);
    return this.writing;
  }

  /** Синхронная аварийная копия (pagehide): IndexedDB может не успеть до закрытия вкладки. */
  flushSync(): void {
    if (this.wiped || !(this.dirty0 || this.inFlight > 0) || !this.s || !this.ls || this.kv.kind !== 'idb') return;
    try {
      this.ls.setItem(this.ns + KEYS.tail, JSON.stringify(this.s));
    } catch (e) {
      console.warn('storage: аварийная копия не записана', e);
    }
  }

  /** «Сбросить»: стереть всё. Автоэкспорт делает UI до вызова. Дальше хранилище ничего не пишет, склейка перезагружает страницу. */
  async wipe(): Promise<void> {
    this.wiped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty0 = false;
    await this.writing.catch(() => undefined);
    let ks: string[] = [];
    try {
      ks = await this.kv.keys();
    } catch {
      ks = [];
    }
    for (const k of new Set([...ks, KEYS.save])) {
      try {
        await this.kv.del(k);
      } catch {
        // ключа нет в этом бэкенде
      }
    }
    this.clearTail();
    try {
      this.ls?.removeItem(this.ns + KEYS.save);
    } catch {
      // приватный режим
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
    doc?.addEventListener('freeze', save);
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

  /** Основная запись в localStorage (туда пишет цепочка, когда IndexedDB недоступна). */
  private readLsSave(): Save | null {
    try {
      const raw = this.ls?.getItem(this.ns + KEYS.save);
      return raw ? normalizeSave(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private readTail(): Save | null {
    try {
      const raw = this.ls?.getItem(this.ns + KEYS.tail);
      return raw ? normalizeSave(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private clearTail(): void {
    try {
      this.ls?.removeItem(this.ns + KEYS.tail);
    } catch {
      // приватный режим
    }
  }
}
