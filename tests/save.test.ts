import 'fake-indexeddb/auto';
import { createStore, type UseStore } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { GameStorage, KEYS, memoryKV, type StorageLike } from '../src/systems/platform/storage';
import { exportFileName, exportSave, importSave, newSave, normalizeSave, SAVE_V } from '../src/systems/save';
import { getMap, resolveSpawn } from '../src/world/maps';
import { modelAt, press, release, run } from './helpers';
import { STEP_MS } from '../src/world/location';

const NOW = Date.UTC(2026, 9, 17, 9, 0);
let n = 0;
const freshIdb = (): UseStore => createStore(`pq-farm-test-${++n}`, 'kv');

class MemLS implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
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

describe('сохранение: позиция', () => {
  it('первый запуск — чистое сохранение без позиции; запись переживает перезапуск', async () => {
    const idb = freshIdb();
    const a = new GameStorage({ idb, ls: null });
    const r = await a.load(NOW);
    expect(r.created).toBe(true);
    expect(r.save.position).toBeNull();
    a.update((s) => ({ ...s, position: { map: 'farm', x: 14, y: 8, facing: 'left' } }), NOW + 1000);
    await a.flush();
    const b = new GameStorage({ idb, ls: null });
    const r2 = await b.load(NOW + 5000);
    expect(r2.created).toBe(false);
    expect(r2.save.position).toEqual({ map: 'farm', x: 14, y: 8, facing: 'left' });
  });

  it('позиция из сохранения ставит героя туда же; испорченная или в стене — на спавн по умолчанию', () => {
    const farm = getMap('farm');
    expect(resolveSpawn(farm, [14, 8], 'left')).toEqual({ tile: [14, 8], facing: 'left' });
    expect(resolveSpawn(farm, [0, 0], 'left').tile).toEqual([5, 7]); // вне проходимого (деревья по краю)
    expect(resolveSpawn(farm, [99, 99]).tile).toEqual([5, 7]);
    const home = getMap('home');
    expect(resolveSpawn(home, [8, 3]).tile).toEqual([6, 7]); // стол
    expect(resolveSpawn(home, [6, 5], 'up')).toEqual({ tile: [6, 5], facing: 'up' });
  });

  it('герой прошёл и остановился: итоговая клетка и поворот ложатся в сохранение и возвращаются в модель', async () => {
    const m = modelAt('farm', [10, 8], 'down');
    press(m, 'right');
    run(m, STEP_MS * 2.3);
    release(m, 'right');
    run(m, STEP_MS * 2);
    const st = new GameStorage({ kv: memoryKV(), ls: null });
    await st.load(NOW);
    st.update((s) => ({ ...s, position: { map: 'farm', x: m.player.tile[0], y: m.player.tile[1], facing: m.player.facing } }), NOW);
    await st.flush();
    const p = (await new GameStorage({ kv: st.kv, ls: null }).load(NOW)).save.position!;
    const again = modelAt(p.map, [p.x, p.y], p.facing);
    expect(again.player.tile).toEqual(m.player.tile);
    expect(again.player.facing).toBe('right');
  });

  it('закрыли вкладку до записи в IndexedDB: аварийная копия подхватывается', async () => {
    const ls = new MemLS();
    const idb = freshIdb();
    const a = new GameStorage({ idb, ls });
    await a.load(NOW);
    await a.flush();
    a.update((s) => ({ ...s, position: { map: 'home', x: 6, y: 5, facing: 'up' } }), NOW + 10);
    a.flushSync();
    expect(ls.getItem(KEYS.tail)).not.toBeNull();
    const b = new GameStorage({ idb, ls });
    const r = await b.load(NOW + 99);
    expect(r.recovered).toBe(true);
    expect(r.save.position?.map).toBe('home');
  });

  it('wipe стирает всё: после него загрузка даёт чистое сохранение', async () => {
    const kv = memoryKV();
    const a = new GameStorage({ kv, ls: null });
    await a.load(NOW);
    a.update((s) => ({ ...s, position: { map: 'farm', x: 1, y: 1, facing: 'up' } }), NOW);
    await a.flush();
    await a.wipe();
    const b = new GameStorage({ kv, ls: null });
    expect((await b.load(NOW)).created).toBe(true);
  });
});

describe('сохранение: экспорт и импорт', () => {
  it('круг: экспорт → импорт даёт то же сохранение', () => {
    const s = { ...newSave(NOW), position: { map: 'home' as const, x: 3, y: 4, facing: 'down' as const }, settings: { ...newSave(NOW).settings, sound: false, sfxVolume: 60 } };
    const r = importSave(exportSave(s));
    expect(r).toEqual({ ok: true, save: s });
  });

  it('огород (v2) переживает экспорт и импорт; сохранение v1 читается с пустым огородом', () => {
    const garden = { planted: [{ t: 1, id: 'w.kot' }], log: [{ t: 2, day: 0, id: 'w.kot', side: 'pr' as const, ok: true, mode: 1 as const }], slots: { 'w.kot': 0 }, tier: 0 };
    const s = { ...newSave(NOW), garden };
    // Огород без отметки игры 5 получает её при загрузке: весь старый журнал — по прежнему правилу урожая.
    expect(importSave(exportSave(s))).toEqual({ ok: true, save: { ...s, garden: { ...garden, prodFrom: 3 } } });
    const s2 = { ...s, garden: { ...garden, prodFrom: 3 } };
    expect(importSave(exportSave(s2))).toEqual({ ok: true, save: s2 });
    const old = normalizeSave({ v: 1, created: 1, updated: 2, position: null, settings: { sound: true } });
    expect(old?.garden).toEqual({ planted: [], log: [], slots: {}, tier: 0, prodFrom: 0 });
  });

  it('подсказки: флаги переживают экспорт; сохранение без них читается, мусор отбрасывается', () => {
    const s = { ...newSave(NOW), hints: ['desk', 'bin'] };
    expect(importSave(exportSave(s))).toEqual({ ok: true, save: s });
    expect(normalizeSave({ v: 2, created: 1, updated: 2, position: null, settings: {} })?.hints).toEqual([]);
    expect(normalizeSave({ v: 2, created: 1, updated: 2, position: null, settings: {}, hints: ['desk', 5, 'desk', null] })?.hints).toEqual(['desk']);
  });

  it('чужой файл, мусор и версия из будущего отклоняются', () => {
    expect(importSave('не json')).toEqual({ ok: false, reason: 'json' });
    expect(importSave('{"app":"other","save":{}}')).toEqual({ ok: false, reason: 'format' });
    expect(importSave(JSON.stringify({ app: 'polski-quest-farm', v: SAVE_V + 1, save: newSave(NOW) }))).toEqual({ ok: false, reason: 'version' });
  });

  it('нормализация отбрасывает мусор в позиции и включает звук по умолчанию', () => {
    const s = normalizeSave({ v: 1, created: 1, updated: 2, position: { map: 'farm', x: 'a', y: 2, facing: 'down' }, settings: {} });
    expect(s?.position).toBeNull();
    expect(s?.settings.sound).toBe(true);
    expect(normalizeSave(null)).toBeNull();
    expect(normalizeSave({ v: 0 })).toBeNull();
  });

  it('имя файла по дате', () => {
    expect(exportFileName(Date.UTC(2026, 9, 17, 9, 0), 0)).toBe('ferma-2026-10-17.json');
  });
});
