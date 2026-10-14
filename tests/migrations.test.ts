import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import {
  backupKey,
  backupsToPrune,
  canWrite,
  migrate,
  MIGRATIONS,
  sortBackups,
  type MigrationRegistry,
} from '../src/systems/migrations';
import { PROGRESS_V, validateProgress } from '../src/systems/progress';
import { GameStorage, KEYS } from '../src/systems/platform/storage';

const FIX = join(import.meta.dirname, 'fixtures');
const fixtures = readdirSync(FIX)
  .map((f) => /^progress_v(\d+)\.json$/.exec(f))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ file: m[0], v: Number(m[1]) }));
const load = (file: string): unknown => JSON.parse(readFileSync(join(FIX, file), 'utf8'));
const NOW = Date.UTC(2026, 9, 14, 10, 0);

/** Тестовый реестр «будущих» версий: проверяет цепочку, пока настоящих миграций нет. */
const FUTURE: MigrationRegistry = {
  ...MIGRATIONS,
  [PROGRESS_V]: (p) => ({ ...p, v: PROGRESS_V + 1, world: { ...p.world, pets: {} } }),
  [PROGRESS_V + 1]: (p) => ({ ...p, v: PROGRESS_V + 2, settings: { ...p.settings, migrated: { value: true, at: 0 } } }),
};

describe('migrations: фикстуры', () => {
  it('есть фикстура на каждую версию 1..PROGRESS_V', () => {
    expect(fixtures.map((f) => f.v).sort((a, b) => a - b)).toEqual(Array.from({ length: PROGRESS_V }, (_, i) => i + 1));
  });

  it.each(fixtures)('$file → последняя версия, результат проходит проверку', ({ file, v }) => {
    const raw = load(file);
    const r = migrate(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(v);
    expect(r.progress.v).toBe(PROGRESS_V);
    expect(validateProgress(r.progress)).toEqual([]);
  });

  it('текущая версия проходит без изменений', () => {
    const raw = load(`progress_v${PROGRESS_V}.json`);
    const r = migrate(raw);
    expect(r.ok && r.migrated).toBe(false);
    expect(r.ok && r.progress).toEqual(raw);
  });
});

describe('migrations: цепочка', () => {
  it('прогоняет все шаги по порядку и не мутирует вход', () => {
    const raw = load('progress_v1.json');
    const before = JSON.stringify(raw);
    const r = migrate(raw, FUTURE, PROGRESS_V + 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migrated).toBe(true);
    expect(r.progress.v).toBe(PROGRESS_V + 2);
    expect((r.progress.world as unknown as Record<string, unknown>).pets).toEqual({});
    expect(r.progress.settings.migrated).toEqual({ value: true, at: 0 });
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('v > PROGRESS_V отклоняется как «новее»: только чтение', () => {
    const raw = { ...(load('progress_v1.json') as object), v: PROGRESS_V + 1 };
    expect(migrate(raw)).toEqual({ ok: false, reason: 'newer', from: PROGRESS_V + 1 });
    expect(canWrite({ v: PROGRESS_V + 1 })).toBe(false);
    expect(canWrite({ v: PROGRESS_V })).toBe(true);
  });

  it('дыра в реестре и битые данные', () => {
    expect(migrate(load('progress_v1.json'), {}, PROGRESS_V + 1)).toMatchObject({ ok: false, reason: 'gap', missing: PROGRESS_V });
    expect(migrate({ v: 'x' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(migrate({ v: 1, worldId: 'w' })).toMatchObject({ ok: false, reason: 'invalid' });
    const bad: MigrationRegistry = { [PROGRESS_V]: (p) => p };
    expect(migrate(load('progress_v1.json'), bad, PROGRESS_V + 1)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('migrations: снапшоты', () => {
  it('ключ и хранение трёх последних', () => {
    expect(backupKey(1, '2026-10-14')).toBe('pq_backup_v1_2026-10-14');
    const keys = ['pq_backup_v2_2026-11-01', 'pq_local', 'pq_backup_v1_2026-10-14', 'pq_backup_v3_2026-12-01', 'pq_backup_v4_2027-01-05'];
    expect(sortBackups(keys)).toEqual(['pq_backup_v1_2026-10-14', 'pq_backup_v2_2026-11-01', 'pq_backup_v3_2026-12-01', 'pq_backup_v4_2027-01-05']);
    expect(backupsToPrune(keys, 3)).toEqual(['pq_backup_v1_2026-10-14']);
    expect(backupsToPrune(keys.slice(0, 2), 3)).toEqual([]);
  });

  it('storage пишет снапшот исходного JSON до миграции и сохраняет мигрированный', async () => {
    const idb = createStore('mig-snap', 'kv');
    const raw = load('progress_v1.json');
    const seed = new GameStorage({ idb, ls: null, targetV: PROGRESS_V });
    await seed.load(NOW);
    await seed.kv.setMany([[KEYS.progress, raw]]);

    const st = new GameStorage({ idb, ls: null, registry: FUTURE, targetV: PROGRESS_V + 2, tz: 'Europe/Warsaw' });
    const res = await st.load(NOW);
    expect(res.migratedFrom).toBe(1);
    expect(res.progress.v).toBe(PROGRESS_V + 2);
    const key = 'pq_backup_v1_2026-10-14';
    expect(await st.readBackup(key)).toEqual(raw);
    expect(res.local.backups).toEqual([key]);
    expect(((await st.kv.get(KEYS.progress)) as { v: number }).v).toBe(PROGRESS_V + 2);
  });

  it('после миграции остаются только 3 последних снапшота', async () => {
    const idb = createStore('mig-prune', 'kv');
    const st0 = new GameStorage({ idb, ls: null });
    await st0.load(NOW);
    await st0.kv.setMany([
      ['pq_backup_v1_2026-01-01', { v: 1 }],
      ['pq_backup_v1_2026-02-01', { v: 1 }],
      ['pq_backup_v1_2026-03-01', { v: 1 }],
      [KEYS.progress, load('progress_v1.json')],
    ]);
    const st = new GameStorage({ idb, ls: null, registry: FUTURE, targetV: PROGRESS_V + 1, tz: 'Europe/Warsaw' });
    await st.load(NOW);
    expect(await st.listBackups()).toEqual(['pq_backup_v1_2026-02-01', 'pq_backup_v1_2026-03-01', 'pq_backup_v1_2026-10-14']);
  });

  it('v > PROGRESS_V в хранилище: только чтение, запись отклоняется, данные не трогаются', async () => {
    const idb = createStore('mig-newer', 'kv');
    const newer = { ...(load('progress_v1.json') as object), v: PROGRESS_V + 1 };
    const st0 = new GameStorage({ idb, ls: null });
    await st0.load(NOW);
    await st0.kv.setMany([[KEYS.progress, newer]]);

    const st = new GameStorage({ idb, ls: null });
    const res = await st.load(NOW);
    expect(res.readOnly).toBe(true);
    expect(st.setProgress({ ...res.progress })).toBe(false);
    expect(() => st.append({ k: 'seg', ts: NOW, seg: 'water' })).toThrow();
    await st.flush();
    expect(await st.kv.get(KEYS.progress)).toEqual(newer);
  });
});
