// Синк (ТЗ §6.3) с моком fetch: фейковый Supabase повторяет семантику supabase/001_game_saves.sql
// (ревизии, конфликт, old_client, первая запись), плюс сбои сети, 5xx и PGRST202.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBus } from '../src/systems/bus';
import type { EventDraft } from '../src/systems/log';
import { merge, sameProgress } from '../src/systems/merge';
import { generateSecret } from '../src/systems/platform/secret';
import { KEEPALIVE_MAX_BYTES, SupabaseRpc, SyncClient, type SyncStore } from '../src/systems/platform/sync';
import { append, newLocal, newProgress, setFlag, type LocalState, type Progress } from '../src/systems/progress';
import type { BusEvents } from '../src/types/bus';

const URL_ = 'https://example.supabase.co';
const KEY = 'sb_publishable_test';
const T0 = Date.UTC(2026, 9, 15, 6, 0);
const WORLD = 'w0rldw0rldw0rld2';

// ── Фейковый Supabase.

interface Row {
  data: Progress;
  rev: number;
  schema_v: number;
  updated_by: string | null;
}

interface Call {
  fn: string;
  body: Record<string, unknown>;
  init: RequestInit;
}

class FakeSupabase {
  rows = new Map<string, Row>();
  calls: Call[] = [];
  /** Перед обработкой game_save (имитация другого устройства). */
  beforeSave: ((hash: string) => void) | null = null;
  /** Принудительный ответ: 'offline' — fetch бросает; число — HTTP-код с телом; 'missing' — PGRST202. */
  fail: 'offline' | 'missing' | number | null = null;

  static hash(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const fn = url.slice(url.lastIndexOf('/') + 1);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    this.calls.push({ fn, body, init });
    if (this.fail === 'offline') throw new TypeError('Failed to fetch');
    if (this.fail === 'missing') return json(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
    if (typeof this.fail === 'number') return json(this.fail, { message: 'boom' });
    if (!url.startsWith(`${URL_}/rest/v1/rpc/`)) return json(404, { message: 'no route' });
    if (fn === 'game_load') return json(200, this.load(String(body.p_key)));
    if (fn === 'game_save') {
      try {
        return json(200, this.save(String(body.p_key), body.p_data as Progress, Number(body.p_base_rev), body.p_device as string | null));
      } catch (e) {
        return json(400, { code: 'P0001', message: (e as Error).message });
      }
    }
    return json(404, { code: 'PGRST202', message: 'unknown fn' });
  };

  load(key: string): unknown {
    const r = this.rows.get(FakeSupabase.hash(key));
    return r ? { data: structuredClone(r.data), rev: r.rev, schema_v: r.schema_v, updated_at: '2026-10-15T06:00:00Z' } : null;
  }

  save(key: string, data: Progress, baseRev: number, device: string | null): unknown {
    if (!key || key.length < 20 || key.length > 64) throw new Error('bad key');
    const h = FakeSupabase.hash(key);
    this.beforeSave?.(h);
    const v = Number.isInteger(data.v) ? data.v : 1;
    const cur = this.rows.get(h);
    if (!cur) {
      this.rows.set(h, { data: structuredClone(data), rev: 1, schema_v: v, updated_by: device });
      return { ok: true, rev: 1 };
    }
    if (v < cur.schema_v) return { ok: false, old_client: true, schema_v: cur.schema_v };
    if (cur.rev !== baseRev) return { ok: false, conflict: true, data: structuredClone(cur.data), rev: cur.rev };
    this.rows.set(h, { data: structuredClone(data), rev: cur.rev + 1, schema_v: v, updated_by: device });
    return { ok: true, rev: cur.rev + 1 };
  }

  /** Другое устройство дописывает событие прямо в облако. */
  otherDeviceWrites(h: string, seq: number): void {
    const cur = this.rows.get(h)!;
    const r = append(cur.data, { deviceId: 'zzzzzz', seq: seq - 1 }, draft(100 + seq));
    if (r.ok) this.rows.set(h, { ...cur, data: r.progress, rev: cur.rev + 1 });
  }

  saves(): Call[] {
    return this.calls.filter((c) => c.fn === 'game_save');
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ── Хранилище в памяти.

class MemStore implements SyncStore {
  readOnly = false;
  constructor(
    public progress: Progress,
    public local: LocalState,
  ) {}
  setProgress(p: Progress): boolean {
    if (this.readOnly) return false;
    this.progress = p;
    return true;
  }
  setLocal(l: LocalState): void {
    this.local = l;
  }
}

function draft(i: number): EventDraft {
  return { k: 'rev', ts: T0 + i * 1000, card: `lx.w${i % 4}#rec`, g: 2, ms: 1500, src: 'obchod' };
}

function play(store: MemStore, n: number): void {
  for (let i = 0; i < n; i++) {
    const r = append(store.progress, { deviceId: store.local.deviceId, seq: store.local.seq }, draft(store.local.seq + 1 + (store.local.deviceId === 'bbbbbb' ? 50 : 0)));
    if (!r.ok) throw new Error('append');
    store.progress = r.progress;
    store.local = { ...store.local, seq: r.dev.seq };
  }
}

function device(deviceId: string, secret: string | null, opts: { world?: string; join?: boolean } = {}): MemStore {
  const local: LocalState = { ...newLocal(deviceId), sync: { rev: 0, lastSyncAt: null, lastError: null, dirty: true } };
  if (secret) local.secret = secret;
  if (opts.join) local.join = true;
  return new MemStore(newProgress(T0, opts.world ?? WORLD), local);
}

let server: FakeSupabase;
let secret: string;
let statuses: BusEvents['sync:status'][];
let merged: number[];

function client(store: MemStore, extra: Partial<ConstructorParameters<typeof SyncClient>[0]> = {}): SyncClient {
  const bus = createBus<BusEvents>();
  bus.on('sync:status', (s) => statuses.push(s));
  bus.on('progress:merged', ({ remoteEvents }) => merged.push(remoteEvents));
  return new SyncClient({
    store,
    rpc: new SupabaseRpc(URL_, KEY, { fetch: server.fetch }),
    bus,
    now: () => T0,
    pushDelayMs: 3000,
    retryDelaysMs: [5000, 15000],
    ...extra,
  });
}

const last = (): BusEvents['sync:status'] | undefined => statuses[statuses.length - 1];

beforeEach(() => {
  server = new FakeSupabase();
  secret = generateSecret();
  statuses = [];
  merged = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SupabaseRpc', () => {
  it('POST /rest/v1/rpc/<fn>, apikey без Authorization, тело с p_key/p_data/p_base_rev/p_device', async () => {
    const rpc = new SupabaseRpc(URL_, KEY, { fetch: server.fetch });
    const p = newProgress(T0, WORLD);
    await rpc.save(secret, p, 0, 'abcdef');
    const c = server.calls[0]!;
    expect(c.fn).toBe('game_save');
    expect(c.init.method).toBe('POST');
    const h = c.init.headers as Record<string, string>;
    expect(h.apikey).toBe(KEY);
    expect(h['Content-Type']).toBe('application/json');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(c.body).toEqual({ p_key: secret, p_data: p, p_base_rev: 0, p_device: 'abcdef' });
    expect(c.init.keepalive).toBeUndefined();
  });

  it('keepalive только при теле ≤ 60 КБ', async () => {
    const rpc = new SupabaseRpc(URL_, KEY, { fetch: server.fetch });
    const small = newProgress(T0, WORLD);
    await rpc.save(secret, small, 0, 'abcdef', { keepalive: true });
    expect(server.calls[0]!.init.keepalive).toBe(true);
    const big = { ...small, settings: { pad: { value: 'x'.repeat(KEEPALIVE_MAX_BYTES), at: 1 } } };
    await rpc.save(secret, big, 1, 'abcdef', { keepalive: true });
    expect(server.calls[1]!.init.keepalive).toBeUndefined();
  });

  it('разбор ответов: null, PGRST202, 5xx, сеть, 400 bad key, не JSON', async () => {
    const rpc = new SupabaseRpc(URL_, KEY, { fetch: server.fetch });
    expect(await rpc.load(secret)).toEqual({ kind: 'ok', value: null });
    expect((await rpc.save('short', newProgress(T0, WORLD), 0, 'x')).kind).toBe('rejected');
    server.fail = 'missing';
    expect((await rpc.load(secret)).kind).toBe('missing');
    server.fail = 503;
    expect(await rpc.load(secret)).toEqual({ kind: 'offline', detail: 'http_503' });
    server.fail = 'offline';
    expect(await rpc.load(secret)).toEqual({ kind: 'offline', detail: 'network' });
    const html = new SupabaseRpc(URL_, KEY, { fetch: async () => new Response('<html>', { status: 200 }) });
    expect((await html.load(secret)).kind).toBe('offline');
    const weird = new SupabaseRpc(URL_, KEY, { fetch: async () => json(200, { hello: 1 }) });
    expect((await weird.save(secret, newProgress(T0, WORLD), 0, 'x')).kind).toBe('rejected');
  });
});

describe('SyncClient: алгоритм §6.3', () => {
  it('новый мир: load → null → save(base_rev 0) → ok, rev 1, dirty снят', async () => {
    const a = device('aaaaaa', secret);
    play(a, 3);
    const s = client(a);
    await s.start();
    expect(server.calls.map((c) => c.fn)).toEqual(['game_load', 'game_save']);
    expect(server.saves()[0]!.body.p_base_rev).toBe(0);
    expect(a.local.sync).toMatchObject({ rev: 1, dirty: false, lastSyncAt: T0, lastError: null });
    expect(last()).toEqual({ state: 'ok', at: T0 });
    expect(statuses.map((x) => x.state)).toEqual(['syncing', 'syncing', 'ok']);
    expect(sameProgress(a.progress, server.rows.get(FakeSupabase.hash(secret))!.data)).toBe(true);
  });

  it('облако впереди: слияние, progress:merged, запись своих событий поверх', async () => {
    const a = device('aaaaaa', secret);
    play(a, 2);
    await client(a).start();
    const b = device('bbbbbb', secret);
    play(b, 3);
    await client(b).start();
    expect(merged).toEqual([2]);
    expect(b.progress.log.events).toHaveLength(5);
    expect(b.local.sync.rev).toBe(2);
    expect(server.saves().at(-1)!.body.p_base_rev).toBe(1);
    expect(sameProgress(b.progress, server.rows.get(FakeSupabase.hash(secret))!.data)).toBe(true);
  });

  it('облако уже равно результату: только load, без записи', async () => {
    const a = device('aaaaaa', secret);
    play(a, 2);
    await client(a).start();
    server.calls = [];
    const s = client(a);
    await s.start();
    expect(server.calls.map((c) => c.fn)).toEqual(['game_load']);
    expect(a.local.sync.dirty).toBe(false);
    expect(last()?.state).toBe('ok');
  });

  it('conflict ×2 → merge → повторная запись → ok, ничего не потеряно', async () => {
    const a = device('aaaaaa', secret);
    play(a, 1);
    const s = client(a);
    await s.start();
    let n = 0;
    server.beforeSave = (h) => {
      if (n < 2) server.otherDeviceWrites(h, ++n);
    };
    play(a, 2);
    s.markDirty();
    await s.flush();
    const saves = server.saves().slice(1);
    expect(saves.map((c) => c.body.p_base_rev)).toEqual([1, 2, 3]);
    expect(last()?.state).toBe('ok');
    const cloud = server.rows.get(FakeSupabase.hash(secret))!;
    expect(cloud.rev).toBe(4);
    expect(cloud.data.log.events.map((e) => e.id).sort()).toEqual(['aaaaaa.1', 'aaaaaa.2', 'aaaaaa.3', 'zzzzzz.1', 'zzzzzz.2']);
    expect(sameProgress(a.progress, cloud.data)).toBe(true);
    expect(merged).toEqual([1, 1]);
  });

  it('конфликт без конца: после 3 повторов статус conflict/retry и повтор по таймеру', async () => {
    vi.useFakeTimers();
    const a = device('aaaaaa', secret);
    const s = client(a);
    await s.start();
    let n = 0;
    server.beforeSave = (h) => server.otherDeviceWrites(h, ++n);
    play(a, 1);
    s.markDirty();
    await s.flush();
    expect(server.saves()).toHaveLength(1 + 4); // первая запись + 1 попытка + 3 повтора
    expect(last()).toEqual({ state: 'conflict', detail: 'retry' });
    expect(a.local.sync.dirty).toBe(true);
    server.beforeSave = null;
    await vi.advanceTimersByTimeAsync(5000);
    expect(last()?.state).toBe('ok');
    expect(a.local.sync.dirty).toBe(false);
  });

  it('параллельная первая запись двух устройств: второй получает conflict и сливает', async () => {
    const a = device('aaaaaa', secret);
    const b = device('bbbbbb', secret);
    play(a, 1);
    play(b, 1);
    // B уже прочитал «null», но A успел записать первым.
    server.beforeSave = (h) => {
      if (!server.rows.has(h)) server.rows.set(h, { data: structuredClone(a.progress), rev: 1, schema_v: 1, updated_by: 'aaaaaa' });
    };
    await client(b).start();
    expect(b.progress.log.events.map((e) => e.id)).toEqual(['aaaaaa.1', 'bbbbbb.1']);
    expect(server.rows.get(FakeSupabase.hash(secret))!.rev).toBe(2);
  });

  it('изменения во время запроса: dirty остаётся, следующая отправка через 3 с', async () => {
    vi.useFakeTimers();
    const a = device('aaaaaa', secret);
    const s = client(a);
    await s.start();
    server.beforeSave = () => {
      play(a, 1); // игрок ответил, пока летел запрос
      s.markDirty();
    };
    s.markDirty();
    await s.flush();
    expect(a.local.sync.dirty).toBe(true);
    server.beforeSave = null;
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.local.sync.dirty).toBe(false);
    expect(server.rows.get(FakeSupabase.hash(secret))!.data.log.events).toHaveLength(1);
  });

  it('дебаунс: серия изменений → одна запись через 3 с', async () => {
    vi.useFakeTimers();
    const a = device('aaaaaa', secret);
    const s = client(a);
    await s.start();
    server.calls = [];
    for (let i = 0; i < 5; i++) {
      play(a, 1);
      s.markDirty();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(last()?.state).toBe('pending');
    expect(server.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.saves()).toHaveLength(1);
    expect(last()?.state).toBe('ok');
  });
});

describe('SyncClient: старый клиент', () => {
  it('облако новее (schema_v 2): old_client, ни одной записи, синк стоп', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: { ...newProgress(T0, WORLD), v: 2 }, rev: 7, schema_v: 2, updated_by: 'x' });
    const a = device('aaaaaa', secret);
    play(a, 1);
    const s = client(a);
    await s.start();
    expect(last()).toEqual({ state: 'old_client' });
    s.markDirty();
    await s.flush();
    await s.start();
    expect(server.saves()).toHaveLength(0);
    expect(a.progress.v).toBe(1);
  });

  it('сервер ответил old_client на запись', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: newProgress(T0, WORLD), rev: 3, schema_v: 2, updated_by: 'x' });
    const a = device('aaaaaa', secret);
    a.local = { ...a.local, sync: { ...a.local.sync, rev: 3 } };
    play(a, 1);
    const s = client(a);
    s.markDirty();
    await s.flush();
    expect(server.saves()).toHaveLength(1);
    expect(last()).toEqual({ state: 'old_client' });
  });

  it('локальное хранилище только для чтения: не пишет', async () => {
    const a = device('aaaaaa', secret);
    a.readOnly = true;
    await client(a).start();
    expect(server.calls).toHaveLength(0);
    expect(last()?.state).toBe('old_client');
  });
});

describe('SyncClient: офлайн и ошибки', () => {
  it('сеть недоступна: offline, dirty, повтор по таймеру, затем ok', async () => {
    vi.useFakeTimers();
    server.fail = 'offline';
    const a = device('aaaaaa', secret);
    play(a, 2);
    const s = client(a);
    await s.start();
    expect(last()).toEqual({ state: 'offline', detail: 'network' });
    expect(a.local.sync).toMatchObject({ dirty: true, lastError: 'network' });
    await vi.advanceTimersByTimeAsync(5000); // первый повтор, сети всё ещё нет
    expect(last()?.state).toBe('offline');
    server.fail = null;
    await vi.advanceTimersByTimeAsync(15000);
    expect(last()?.state).toBe('ok');
    expect(a.local.sync).toMatchObject({ dirty: false, rev: 1, lastError: null });
  });

  it('событие online и возврат на вкладку запускают синк; уход вкладки — запись с keepalive', async () => {
    server.fail = 'offline';
    const a = device('aaaaaa', secret);
    const s = client(a);
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    s.attach({ win, doc });
    await s.start();
    server.fail = null;
    win.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(last()?.state).toBe('ok'));
    play(a, 1);
    s.markDirty();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(server.saves().at(-1)!.init.keepalive).toBe(true));
    await vi.waitFor(() => expect(a.local.sync.dirty).toBe(false));
    s.dispose();
  });

  it('PGRST202 → error apply_sql, без повторов', async () => {
    vi.useFakeTimers();
    server.fail = 'missing';
    const a = device('aaaaaa', secret);
    await client(a).start();
    expect(last()).toEqual({ state: 'error', detail: 'apply_sql' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(server.calls).toHaveLength(1);
  });

  it('503 (Supabase на паузе) → offline', async () => {
    server.fail = 503;
    const a = device('aaaaaa', secret);
    await client(a).start();
    expect(last()).toEqual({ state: 'offline', detail: 'http_503' });
  });

  it('нет секрета → no_secret, без запросов', async () => {
    const a = device('aaaaaa', null);
    await client(a).start();
    expect(last()).toEqual({ state: 'no_secret' });
    expect(server.calls).toHaveLength(0);
  });

  it('битый сейв в облаке не перезаписывается', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: { v: 1, junk: true } as unknown as Progress, rev: 2, schema_v: 1, updated_by: 'x' });
    const a = device('aaaaaa', secret);
    play(a, 1);
    await client(a).start();
    expect(last()).toEqual({ state: 'error', detail: 'remote_invalid' });
    expect(server.saves()).toHaveLength(0);
  });
});

describe('SyncClient: разные миры и подключение по ссылке', () => {
  function cloudWorld(events: number): Progress {
    let p = setFlag(newProgress(T0 - 1000, 'cloudworldcloud2'), 'beat.first.f1', T0);
    for (let i = 1; i <= events; i++) {
      const r = append(p, { deviceId: 'cccccc', seq: i - 1 }, draft(i));
      if (r.ok) p = r.progress;
    }
    return p;
  }

  it('локальный мир с прогрессом ≠ облачный: conflict different_worlds, запись не идёт', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: cloudWorld(2), rev: 4, schema_v: 1, updated_by: 'x' });
    const a = device('aaaaaa', secret, { world: 'localworldlocal2' });
    play(a, 1);
    const s = client(a);
    await s.start();
    expect(last()).toEqual({ state: 'conflict', detail: 'different_worlds' });
    expect(s.foreignWorld?.worldId).toBe('cloudworldcloud2');
    expect(server.saves()).toHaveLength(0);
    expect(a.progress.worldId).toBe('localworldlocal2');
  });

  it('выбор «облако»: локальный мир заменяется облачным', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: cloudWorld(2), rev: 4, schema_v: 1, updated_by: 'x' });
    const a = device('aaaaaa', secret, { world: 'localworldlocal2' });
    play(a, 1);
    const s = client(a);
    await s.start();
    await s.resolveWorlds('cloud');
    expect(a.progress.worldId).toBe('cloudworldcloud2');
    expect(a.progress.log.events).toHaveLength(2);
    expect(server.saves()).toHaveLength(0);
    expect(last()?.state).toBe('ok');
  });

  it('выбор «устройство»: облако перезаписано локальным миром', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: cloudWorld(2), rev: 4, schema_v: 1, updated_by: 'x' });
    const a = device('aaaaaa', secret, { world: 'localworldlocal2' });
    play(a, 1);
    const s = client(a);
    await s.start();
    await s.resolveWorlds('device');
    const cloud = server.rows.get(FakeSupabase.hash(secret))!;
    expect(cloud.data.worldId).toBe('localworldlocal2');
    expect(cloud.rev).toBe(5);
    expect(last()?.state).toBe('ok');
  });

  it('пустой локальный мир молча уступает облачному', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: cloudWorld(3), rev: 2, schema_v: 1, updated_by: 'x' });
    const a = device('aaaaaa', secret, { world: 'localworldlocal2' });
    await client(a).start();
    expect(a.progress.worldId).toBe('cloudworldcloud2');
    expect(a.progress.log.events).toHaveLength(3);
    expect(server.saves()).toHaveLength(0);
    expect(merged).toEqual([3]);
    expect(last()?.state).toBe('ok');
  });

  it('подключение офлайн, игра, потом сеть: локальные ответы вливаются в облачный мир', async () => {
    server.rows.set(FakeSupabase.hash(secret), { data: cloudWorld(2), rev: 2, schema_v: 1, updated_by: 'x' });
    const a = device('aaaaaa', secret, { world: 'localworldlocal2', join: true });
    play(a, 2); // сыграл офлайн до первой встречи с облаком
    await client(a).start();
    expect(a.progress.worldId).toBe('cloudworldcloud2');
    expect(a.progress.log.events.map((e) => e.id).sort()).toEqual(['aaaaaa.1', 'aaaaaa.2', 'cccccc.1', 'cccccc.2']);
    expect(a.local.join).toBeUndefined();
    expect(server.rows.get(FakeSupabase.hash(secret))!.rev).toBe(3);
  });

  it('подключение по ссылке, а мира нет: not_found, новый мир не создаётся', async () => {
    const a = device('aaaaaa', secret, { join: true });
    play(a, 1);
    const s = client(a);
    await s.start();
    s.markDirty();
    await s.flush();
    expect(last()).toEqual({ state: 'error', detail: 'not_found' });
    expect(server.saves()).toHaveLength(0);
  });

  it('два устройства с одной ссылкой сходятся к одному журналу (офлайн-ответы в обоих)', async () => {
    const a = device('aaaaaa', secret);
    play(a, 2);
    const sa = client(a);
    await sa.start();
    const b = device('bbbbbb', secret, { world: 'otherworldother2', join: true });
    const sb = client(b);
    await sb.start();
    play(a, 3);
    play(b, 4);
    sa.markDirty();
    sb.markDirty();
    await sb.flush();
    await sa.flush();
    await sb.start();
    expect(sameProgress(a.progress, b.progress)).toBe(true);
    expect(a.progress.log.events).toHaveLength(9);
    expect(sameProgress(merge(a.progress, b.progress), a.progress)).toBe(true);
  });
});
