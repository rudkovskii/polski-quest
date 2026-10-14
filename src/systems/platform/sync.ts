// Синк по приватной ссылке (ТЗ §6.3): local-first, облако — две RPC Supabase через fetch, без SDK.
//
//   pull  (старт, вкладка снова видна, online, повтор после офлайна):
//         game_load → нет сейва: save(local, 0); есть: merge(local, migrate(remote)) → save, если облако отстаёт
//   push  (через 3 с после изменения, немедленно при уходе вкладки, keepalive при ≤ 60 КБ):
//         game_save(base_rev) → conflict: merge с облаком и повтор (до 3 раз подряд)
//
// Статусы уходят в шину `sync:status`, слияние — `progress:merged`. Секрет в логи не пишется.
import type { Bus } from '../bus';
import { DifferentWorlds, isPristine, mergeReport, rebaseOnto, sameProgress } from '../merge';
import { canWrite, migrate, versionOf } from '../migrations';
import { maxSeqFor, PROGRESS_V, type LocalState, type Progress } from '../progress';
import type { BusEvents, SyncState } from '../../types/bus';
import { storedSecret } from './secret';

// ── RPC.

export interface RemoteSave {
  data: unknown;
  rev: number;
  schema_v: number;
  updated_at?: string;
}

export type SaveReply =
  | { ok: true; rev: number }
  | { ok: false; conflict: true; data: unknown; rev: number }
  | { ok: false; old_client: true; schema_v: number };

export type RpcFail =
  /** Сеть, таймаут, 5xx, Supabase на паузе: повторить позже. */
  | { kind: 'offline'; detail: string }
  /** PGRST202: функции нет, Шэф ещё не применил `supabase/001_game_saves.sql`. */
  | { kind: 'missing'; detail: string }
  /** 4xx: неверный ключ API, `bad key`, `too large`. Повтор не поможет. */
  | { kind: 'rejected'; status: number; detail: string };

export type RpcResult<T> = { kind: 'ok'; value: T } | RpcFail;

export interface RpcApi {
  load(secret: string): Promise<RpcResult<RemoteSave | null>>;
  save(secret: string, data: Progress, baseRev: number, device: string, opts?: { keepalive?: boolean }): Promise<RpcResult<SaveReply>>;
}

/** Предел тела для `fetch({ keepalive })`: браузеры дают 64 КиБ на все keepalive-запросы. */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

export interface RpcOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class SupabaseRpc implements RpcApi {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly url: string,
    private readonly key: string,
    opts: RpcOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  async load(secret: string): Promise<RpcResult<RemoteSave | null>> {
    const r = await this.call('game_load', { p_key: secret }, false);
    if (r.kind !== 'ok') return r;
    const v = r.value;
    if (v === null) return { kind: 'ok', value: null };
    if (!isObj(v) || !Number.isInteger(v.rev) || !('data' in v)) return badReply('game_load');
    return {
      kind: 'ok',
      value: {
        data: v.data,
        rev: v.rev as number,
        schema_v: Number.isInteger(v.schema_v) ? (v.schema_v as number) : 1,
        ...(typeof v.updated_at === 'string' ? { updated_at: v.updated_at } : {}),
      },
    };
  }

  async save(secret: string, data: Progress, baseRev: number, device: string, opts: { keepalive?: boolean } = {}): Promise<RpcResult<SaveReply>> {
    const r = await this.call('game_save', { p_key: secret, p_data: data, p_base_rev: baseRev, p_device: device }, !!opts.keepalive);
    if (r.kind !== 'ok') return r;
    const v = r.value;
    if (!isObj(v) || typeof v.ok !== 'boolean') return badReply('game_save');
    if (v.ok && Number.isInteger(v.rev)) return { kind: 'ok', value: { ok: true, rev: v.rev as number } };
    if (v.conflict === true && Number.isInteger(v.rev)) return { kind: 'ok', value: { ok: false, conflict: true, data: v.data, rev: v.rev as number } };
    if (v.old_client === true) return { kind: 'ok', value: { ok: false, old_client: true, schema_v: Number(v.schema_v) || 0 } };
    return badReply('game_save');
  }

  private async call(fn: string, args: Record<string, unknown>, keepalive: boolean): Promise<RpcResult<unknown>> {
    const body = JSON.stringify(args);
    const init: RequestInit = {
      method: 'POST',
      // Publishable key (`sb_publishable_…`) идёт только в apikey: Authorization с ним не слать (§6.2).
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body,
    };
    if (keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES) init.keepalive = true;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctl) init.signal = ctl.signal;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}/rest/v1/rpc/${fn}`, init);
    } catch (e) {
      return { kind: 'offline', detail: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      return { kind: 'offline', detail: 'network' };
    }
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* не JSON: шлюз, пауза проекта */
    }
    if (res.ok) return json === undefined ? { kind: 'offline', detail: `http_${res.status}_not_json` } : { kind: 'ok', value: json };
    const code = isObj(json) && typeof json.code === 'string' ? json.code : '';
    const msg = isObj(json) && typeof json.message === 'string' ? json.message : '';
    // PostgREST: PGRST202 — функции нет в schema cache; 42883 — undefined_function у Postgres.
    if (code === 'PGRST202' || code === '42883') return { kind: 'missing', detail: code };
    if (res.status >= 500 || res.status === 0 || res.status === 408 || res.status === 429) {
      return { kind: 'offline', detail: `http_${res.status}` };
    }
    return { kind: 'rejected', status: res.status, detail: `http_${res.status}${msg ? `: ${msg}` : ''}` };
  }
}

function badReply(fn: string): RpcFail {
  return { kind: 'rejected', status: 200, detail: `${fn}: неожиданный ответ` };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

// ── Клиент синка.

/** То, что нужно от хранилища (GameStorage подходит как есть). */
export interface SyncStore {
  readonly progress: Progress;
  readonly local: LocalState;
  readonly readOnly: boolean;
  setProgress(p: Progress): boolean;
  setLocal(l: LocalState): void;
}

export interface SyncStatus {
  state: SyncState;
  at?: number;
  detail?: string;
}

export interface SyncOptions {
  store: SyncStore;
  rpc: RpcApi;
  bus?: Pick<Bus<BusEvents>, 'emit'>;
  /** Метка устройства для `updated_by` (dev: `test-<deviceId>`). По умолчанию deviceId. */
  device?: () => string;
  now?: () => number;
  /** Задержка отправки после изменения (§6.3: 3 с). */
  pushDelayMs?: number;
  /** Повторы после офлайна; последний повторяется дальше. */
  retryDelaysMs?: readonly number[];
  /** Повторных записей после конфликта подряд (§6.3: до 3). */
  maxConflictRetries?: number;
  progressV?: number;
}

type Job = { kind: 'pull' } | { kind: 'push'; keepalive: boolean };

export class SyncClient {
  private readonly store: SyncStore;
  private readonly rpc: RpcApi;
  private readonly bus: Pick<Bus<BusEvents>, 'emit'> | undefined;
  private readonly device: () => string;
  private readonly now: () => number;
  private readonly pushDelayMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly maxConflictRetries: number;
  private readonly progressV: number;

  private st: SyncStatus = { state: 'idle' };
  private stopped = false;
  /** Счётчик локальных изменений: запись не снимает dirty, если за время запроса что-то поменялось. */
  private tick = 0;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryIdx = 0;
  private queue: Promise<void> = Promise.resolve();
  private queued: { job: Job; promise: Promise<void> } | null = null;
  private foreign: { progress: Progress; rev: number } | null = null;
  /** Игрок выбрал «это устройство» при DifferentWorlds: следующая запись перекрывает чужой мир. */
  private overrideWorld: string | null = null;

  constructor(opts: SyncOptions) {
    this.store = opts.store;
    this.rpc = opts.rpc;
    this.bus = opts.bus;
    this.device = opts.device ?? (() => this.store.local.deviceId);
    this.now = opts.now ?? (() => Date.now());
    this.pushDelayMs = opts.pushDelayMs ?? 3000;
    this.retryDelaysMs = opts.retryDelaysMs ?? [5000, 15000, 60000, 300000];
    this.maxConflictRetries = opts.maxConflictRetries ?? 3;
    this.progressV = opts.progressV ?? PROGRESS_V;
  }

  get status(): SyncStatus {
    return this.st;
  }

  /** Облачный мир, отличный от локального (ждёт выбора игрока). */
  get foreignWorld(): Progress | null {
    return this.foreign?.progress ?? null;
  }

  /** Полный цикл: загрузить, слить, дописать облако. Старт, возврат на вкладку, online. */
  start(): Promise<void> {
    return this.request({ kind: 'pull' });
  }

  /** Локальный прогресс изменился: отправить через `pushDelayMs` (дебаунс). */
  markDirty(): void {
    this.tick++;
    this.setSync({ dirty: true });
    if (!this.stopped && this.st.state !== 'syncing' && storedSecret(this.store)) this.emit({ state: 'pending' });
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.request({ kind: 'push', keepalive: false });
    }, this.pushDelayMs);
  }

  /** Отправить сейчас (уход вкладки, «Синхронизировать сейчас»). */
  flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (!this.store.local.sync.dirty) return this.queue;
    return this.request({ kind: 'push', keepalive: !!opts.keepalive });
  }

  /** Подписка на online и видимость вкладки. Возвращает отписку. */
  attach(env: { win?: EventTarget; doc?: EventTarget & { visibilityState: string } } = {}): () => void {
    const win = env.win ?? (typeof window !== 'undefined' ? window : undefined);
    const doc = env.doc ?? (typeof document !== 'undefined' ? document : undefined);
    const onOnline = (): void => void this.start();
    const onVis = (): void => {
      if (doc?.visibilityState === 'visible') void this.start();
      else if (doc?.visibilityState === 'hidden') void this.flush({ keepalive: true });
    };
    win?.addEventListener('online', onOnline);
    doc?.addEventListener('visibilitychange', onVis);
    return () => {
      win?.removeEventListener('online', onOnline);
      doc?.removeEventListener('visibilitychange', onVis);
    };
  }

  /**
   * DifferentWorlds (§6.4): «облако» — локальный мир заменяется облачным (UI до этого сохраняет
   * его в файл); «устройство» — облако перезаписывается локальным миром.
   */
  resolveWorlds(choice: 'cloud' | 'device'): Promise<void> {
    const f = this.foreign;
    if (!f) return Promise.resolve();
    this.foreign = null;
    if (choice === 'cloud') {
      this.apply(f.progress, f.progress.log.events.length);
      this.setSync({ rev: f.rev, dirty: false });
      this.clearJoin();
      return this.start();
    }
    this.overrideWorld = f.progress.worldId;
    this.setSync({ rev: f.rev, dirty: true });
    return this.request({ kind: 'push', keepalive: false });
  }

  dispose(): void {
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.pushTimer = this.retryTimer = null;
  }

  // ── Очередь: один запрос в полёте, повторные запросы склеиваются (pull поглощает push).

  private request(job: Job): Promise<void> {
    if (this.queued) {
      if (job.kind === 'pull') this.queued.job = job;
      else if (this.queued.job.kind === 'push' && job.keepalive) this.queued.job = job;
      return this.queued.promise;
    }
    const slot: { job: Job; promise: Promise<void> } = { job, promise: Promise.resolve() };
    slot.promise = this.queue
      .then(() => {
        if (this.queued === slot) this.queued = null;
        return slot.job.kind === 'pull' ? this.doPull() : this.doPush(slot.job.keepalive);
      })
      .catch((e: unknown) => {
        console.warn('sync: сбой', e);
        this.emit({ state: 'error', detail: e instanceof Error ? e.message : String(e) });
      });
    this.queued = slot;
    this.queue = slot.promise;
    return slot.promise;
  }

  private async doPull(): Promise<void> {
    const secret = storedSecret(this.store);
    if (!secret) return this.emit({ state: 'no_secret' });
    if (this.stopped || this.store.readOnly) return this.oldClient();
    if (this.foreign) return this.emit({ state: 'conflict', detail: 'different_worlds' });
    this.emit({ state: 'syncing' });
    const r = await this.rpc.load(secret);
    if (r.kind !== 'ok') return this.fail(r);
    const remote = r.value;
    if (remote === null) {
      // Подключение по ссылке, а мира нет: новый мир по чужой ошибке не создаём (§5.2).
      if (this.store.local.join) return this.error('not_found');
      return this.pushLoop(secret, 0, false);
    }
    if (remote.schema_v > this.progressV) return this.oldClient();
    const verdict = this.absorb(remote.data, remote.rev);
    if (verdict === 'push') return this.pushLoop(secret, remote.rev, false);
    if (verdict === 'done') this.synced(remote.rev, this.tick);
  }

  private async doPush(keepalive: boolean): Promise<void> {
    const secret = storedSecret(this.store);
    if (!secret) return this.emit({ state: 'no_secret' });
    if (this.stopped || this.store.readOnly) return this.oldClient();
    if (this.foreign) return this.emit({ state: 'conflict', detail: 'different_worlds' });
    if (this.store.local.join) return this.doPull(); // мир облака ещё не принят: сначала load
    return this.pushLoop(secret, this.store.local.sync.rev, keepalive);
  }

  private async pushLoop(secret: string, baseRev: number, keepalive: boolean): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const p = this.store.progress;
      if (!canWrite(p, this.progressV)) return this.oldClient();
      const tick = this.tick;
      this.emit({ state: 'syncing' });
      const r = await this.rpc.save(secret, p, baseRev, this.device(), { keepalive });
      if (r.kind !== 'ok') return this.fail(r);
      const reply = r.value;
      if (reply.ok) {
        this.overrideWorld = null;
        return this.synced(reply.rev, tick);
      }
      if ('old_client' in reply) return this.oldClient();
      // conflict: облако ушло вперёд (другое устройство или параллельная первая запись).
      if (attempt >= this.maxConflictRetries) {
        this.emit({ state: 'conflict', detail: 'retry' });
        this.scheduleRetry();
        return;
      }
      if (this.overrideWorld !== null && isObj(reply.data) && reply.data.worldId === this.overrideWorld) {
        baseRev = reply.rev; // игрок выбрал «это устройство»: чужой мир не сливаем, перезаписываем
        continue;
      }
      const verdict = this.absorb(reply.data, reply.rev);
      if (verdict === 'stop') return;
      if (verdict === 'done') return this.synced(reply.rev, tick);
      baseRev = reply.rev;
    }
  }

  /**
   * Слить облачные данные в локальные. 'push' — облако отстаёт, надо дописать; 'done' — облако
   * уже равно результату; 'stop' — статус выставлен (old_client, different_worlds, remote_invalid).
   */
  private absorb(data: unknown, rev: number): 'push' | 'done' | 'stop' {
    const v = versionOf(data);
    if (v !== null && v > this.progressV) {
      this.oldClient();
      return 'stop';
    }
    const mig = migrate(data);
    if (!mig.ok) {
      if (mig.reason === 'newer') {
        this.oldClient();
        return 'stop';
      }
      // Битый сейв в облаке не перезаписываем молча: он остаётся для разбора (и в game_save_backups).
      console.warn('sync: облачный сейв не читается', mig.reason === 'invalid' ? mig.errors : mig);
      this.error('remote_invalid');
      return 'stop';
    }
    const remote = mig.progress;
    const local = this.store.progress;
    let merged: Progress;
    try {
      const rep = mergeReport(local, remote);
      for (const w of rep.warnings) console.warn(`sync: ${w}`);
      merged = rep.progress;
    } catch (e) {
      if (!(e instanceof DifferentWorlds)) throw e;
      if (!isPristine(local) && !this.store.local.join) {
        this.foreign = { progress: remote, rev };
        this.emit({ state: 'conflict', detail: 'different_worlds' });
        return 'stop';
      }
      merged = rebaseOnto(local, remote);
    }
    this.clearJoin();
    if (!sameProgress(merged, local)) {
      const known = new Set(local.log.events.map((x) => x.id));
      this.apply(merged, merged.log.events.filter((x) => !known.has(x.id)).length);
    }
    this.setSync({ rev });
    return sameProgress(merged, data) ? 'done' : 'push';
  }

  private apply(p: Progress, remoteEvents: number): void {
    if (!this.store.setProgress(p)) return;
    const l = this.store.local;
    const seq = Math.max(l.seq, maxSeqFor(p, l.deviceId));
    if (seq !== l.seq) this.store.setLocal({ ...l, seq });
    this.bus?.emit('progress:merged', { remoteEvents });
  }

  // ── Статусы.

  private synced(rev: number, tick: number): void {
    const at = this.now();
    const clean = tick === this.tick;
    this.setSync({ rev, lastSyncAt: at, lastError: null, dirty: !clean });
    this.retryIdx = 0;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.emit({ state: 'ok', at });
    if (!clean && this.pushTimer === null) this.markDirtyAgain();
  }

  /** Изменения пришли во время запроса: отправить их следующим заходом. */
  private markDirtyAgain(): void {
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.request({ kind: 'push', keepalive: false });
    }, this.pushDelayMs);
  }

  private fail(r: RpcFail): void {
    this.setSync({ lastError: r.detail });
    if (r.kind === 'offline') {
      this.emit({ state: 'offline', detail: r.detail });
      this.scheduleRetry();
    } else if (r.kind === 'missing') {
      this.emit({ state: 'error', detail: 'apply_sql' });
    } else {
      this.emit({ state: 'error', detail: r.detail });
    }
  }

  private error(detail: string): void {
    this.setSync({ lastError: detail });
    this.emit({ state: 'error', detail });
  }

  private oldClient(): void {
    this.stopped = true;
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.emit({ state: 'old_client' });
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    const delays = this.retryDelaysMs;
    const delay = delays[Math.min(this.retryIdx, delays.length - 1)] ?? 60000;
    this.retryIdx++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, delay);
  }

  private emit(s: SyncStatus): void {
    this.st = s;
    this.bus?.emit('sync:status', s);
  }

  private setSync(patch: Partial<LocalState['sync']>): void {
    const l = this.store.local;
    const sync = { ...l.sync, ...patch };
    if (sync.rev === l.sync.rev && sync.lastSyncAt === l.sync.lastSyncAt && sync.lastError === l.sync.lastError && sync.dirty === l.sync.dirty) return;
    this.store.setLocal({ ...l, sync });
  }

  private clearJoin(): void {
    const l = this.store.local;
    if (!l.join) return;
    const next = { ...l };
    delete next.join;
    this.store.setLocal(next);
  }
}
