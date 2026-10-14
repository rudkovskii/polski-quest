import 'fake-indexeddb/auto';
import { createStore, type UseStore } from 'idb-keyval';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventDraft } from '../src/systems/log';
import { newProgress, validateProgress } from '../src/systems/progress';
import { GameStorage, KEYS, memoryKV, type KV, type StorageLike } from '../src/systems/platform/storage';

const NOW = Date.UTC(2026, 9, 14, 8, 0);
let dbN = 0;
const freshIdb = (): UseStore => createStore(`pq-test-${++dbN}`, 'kv');

class MemLS implements StorageLike {
  m = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

/** IndexedDB, который падает на каждой операции. */
const brokenIdb: UseStore = () => Promise.reject(new Error('InvalidStateError'));

function drafts(n: number): EventDraft[] {
  const kinds: EventDraft[] = [
    { k: 'rev', ts: 0, card: 'lx.kawa#rec', g: 2, ms: 2100, src: 'obchod', tags: ['R10'] },
    { k: 'intro', ts: 0, item: 'lx.mleko', lesson: 'ch01.s02', ok: ['rec'] },
    { k: 'lesson', ts: 0, lesson: 'ch01.s02', score: 0.9, firstTry: 0.8, ms: 300000, passed: true, answers: 12, tags: { R1: 1 } },
    { k: 'seg', ts: 0, seg: 'water' },
    { k: 'found', ts: 0, secret: 'simba', spot: 'dzialka.shed' },
  ];
  return Array.from({ length: n }, (_, i) => ({ ...kinds[i % kinds.length]!, ts: NOW + i * 1000 }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('storage: IndexedDB', () => {
  it('первый запуск: новый мир, deviceId из 6 символов base32, всё уже на диске', async () => {
    const idb = freshIdb();
    const st = new GameStorage({ idb, ls: null });
    const res = await st.load(NOW);
    expect(res.created).toBe(true);
    expect(res.backend).toBe('idb');
    expect(res.local.deviceId).toMatch(/^[a-z2-7]{6}$/);
    expect(res.progress.worldId).toMatch(/^[a-z2-7]{16}$/);
    expect(validateProgress(res.progress)).toEqual([]);
    const again = await new GameStorage({ idb, ls: null }).load(NOW + 1);
    expect(again.created).toBe(false);
    expect(again.progress).toEqual(res.progress);
    expect(again.local.deviceId).toBe(res.local.deviceId);
  });

  it('append 1000 событий и перезагрузка дают тот же объект', async () => {
    const idb = freshIdb();
    const st = new GameStorage({ idb, ls: null });
    await st.load(NOW);
    for (const d of drafts(1000)) expect(st.append(d).ok).toBe(true);
    await st.flush();
    const reloaded = new GameStorage({ idb, ls: null });
    const res = await reloaded.load(NOW + 10);
    expect(res.progress).toEqual(st.progress);
    expect(res.local).toEqual(st.local);
    expect(res.local.seq).toBe(1000);
    expect(validateProgress(res.progress)).toEqual([]);
  });

  it('дебаунс: серия изменений = одна запись через 400 мс', async () => {
    vi.useFakeTimers();
    const inner = memoryKV();
    const writes: string[][] = [];
    const kv: KV = { ...inner, kind: 'idb', setMany: (e) => (writes.push(e.map(([k]) => k)), inner.setMany(e)) };
    const st = new GameStorage({ kv, ls: null });
    await st.load(NOW);
    writes.length = 0;
    for (const d of drafts(10)) {
      st.append(d);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([[KEYS.progress, KEYS.local]]);
    expect(st.dirty).toBe(false);
  });

  it('непрерывные изменения не откладывают запись дольше maxWait', async () => {
    vi.useFakeTimers();
    const inner = memoryKV();
    let n = 0;
    const kv: KV = { ...inner, kind: 'idb', setMany: (e) => (n++, inner.setMany(e)) };
    const st = new GameStorage({ kv, ls: null, maxWaitMs: 2000 });
    await st.load(NOW);
    n = 0;
    for (const d of drafts(30)) {
      st.append(d);
      await vi.advanceTimersByTimeAsync(100); // каждые 100 мс, дебаунс бы не сработал никогда
    }
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('seq восстанавливается из журнала, если pq_local отстал (id не повторяются)', async () => {
    const idb = freshIdb();
    const st = new GameStorage({ idb, ls: null });
    await st.load(NOW);
    for (const d of drafts(5)) st.append(d);
    await st.flush();
    await st.kv.setMany([[KEYS.local, { ...st.local, seq: 2 }]]); // pq_local «откатился»
    const res = await new GameStorage({ idb, ls: null }).load(NOW);
    expect(res.local.seq).toBe(5);
  });
});

describe('storage: запасные бэкенды', () => {
  it('IndexedDB падает → localStorage, данные переживают перезагрузку', async () => {
    const ls = new MemLS();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = new GameStorage({ idb: brokenIdb, ls });
    const res = await st.load(NOW);
    expect(res.backend).toBe('local');
    for (const d of drafts(20)) st.append(d);
    await st.flush();
    expect(ls.getItem(KEYS.progress)).not.toBeNull();
    const again = await new GameStorage({ idb: brokenIdb, ls }).load(NOW);
    expect(again.progress).toEqual(st.progress);
    warn.mockRestore();
  });

  it('нет ни IndexedDB, ни localStorage → память, игра не падает', async () => {
    const ls = new MemLS();
    ls.failWrites = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = new GameStorage({ idb: brokenIdb, ls });
    const res = await st.load(NOW);
    expect(res.backend).toBe('memory');
    expect(st.append(drafts(1)[0]!).ok).toBe(true);
    await expect(st.flush()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('ошибка записи не теряет изменения: данные остаются грязными до следующей попытки', async () => {
    const inner = memoryKV();
    let fail = false;
    const kv: KV = { ...inner, kind: 'idb', setMany: (e) => (fail ? Promise.reject(new Error('disk')) : inner.setMany(e)) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = new GameStorage({ kv, ls: null });
    await st.load(NOW);
    fail = true;
    st.append(drafts(1)[0]!);
    await st.flush();
    expect(st.dirty).toBe(true);
    fail = false;
    await st.flush();
    expect(st.dirty).toBe(false);
    expect(await inner.get(KEYS.progress)).toEqual(st.progress);
    warn.mockRestore();
  });
});

describe('storage: закрытие вкладки', () => {
  it('pagehide: синхронная копия в localStorage спасает ответы, если IndexedDB не успела', async () => {
    const ls = new MemLS();
    const inner = memoryKV();
    let hang = false;
    // IndexedDB «не успевает»: запись так и не завершается, как при закрытой вкладке.
    const kv: KV = { ...inner, kind: 'idb', setMany: (e) => (hang ? new Promise(() => {}) : inner.setMany(e)) };
    const st = new GameStorage({ kv, ls });
    await st.load(NOW);
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const detach = st.attachLifecycle({ win, doc });
    hang = true;
    for (const d of drafts(7)) st.append(d);
    win.dispatchEvent(new Event('pagehide'));
    expect(ls.getItem(KEYS.tail)).not.toBeNull();
    detach();

    // Следующий запуск: IndexedDB со старым прогрессом, в localStorage — аварийная копия.
    hang = false;
    const next = new GameStorage({ kv, ls });
    const res = await next.load(NOW + 60_000);
    expect(res.recovered).toBe(true);
    expect(res.progress).toEqual(st.progress);
    expect(res.local.seq).toBe(7); // seq догнал журнал, хотя pq_local не записался
    expect(await inner.get(KEYS.progress)).toEqual(st.progress); // перенесено в IndexedDB
    expect(ls.getItem(KEYS.tail)).toBeNull(); // и копия убрана
  });

  it('visibilitychange → hidden пишет сразу, без ожидания дебаунса', async () => {
    const idb = freshIdb();
    const st = new GameStorage({ idb, ls: new MemLS(), debounceMs: 60_000 });
    await st.load(NOW);
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    st.attachLifecycle({ win: new EventTarget(), doc });
    st.append(drafts(1)[0]!);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await st.flush();
    const res = await new GameStorage({ idb, ls: null }).load(NOW);
    expect(res.progress.log.events).toHaveLength(1);
  });

  it('битые данные не затираются молча: копия рядом и новый мир', async () => {
    const idb = freshIdb();
    const st0 = new GameStorage({ idb, ls: null });
    await st0.load(NOW);
    await st0.kv.setMany([[KEYS.progress, { v: 1, worldId: 42 }]]);
    const res = await new GameStorage({ idb, ls: null, tz: 'Europe/Warsaw' }).load(NOW);
    expect(res.created).toBe(true);
    expect(res.problems.length).toBeGreaterThan(0);
    expect(await st0.kv.get('pq_backup_corrupt_2026-10-14')).toEqual({ v: 1, worldId: 42 });
  });

  it('replaceProgress («Заменить» при импорте) пишет сразу', async () => {
    const idb = freshIdb();
    const st = new GameStorage({ idb, ls: null });
    await st.load(NOW);
    const other = newProgress(NOW - 1000, 'otherworld');
    expect(await st.replaceProgress(other)).toBe(true);
    expect((await new GameStorage({ idb, ls: null }).load(NOW)).progress.worldId).toBe('otherworld');
  });
});
