import { describe, expect, it } from 'vitest';
import { eventsByKind, eventsOfDay, isSorted, parseEventId, revVerdict, type EventDraft } from '../src/systems/log';
import {
  append,
  getSetting,
  giveItem,
  insertEvents,
  maxSeqFor,
  newProgress,
  PROGRESS_V,
  raiseStage,
  setFlag,
  setSetting,
  validateProgress,
  type DeviceSeq,
  type Progress,
} from '../src/systems/progress';

const T0 = Date.UTC(2026, 9, 14, 8, 0); // 10:00 CEST
const WAW = { tz: 'Europe/Warsaw' };
const dev0: DeviceSeq = { deviceId: 'k7m2qa', seq: 0 };

function rev(ts: number, card = 'lx.kawa#rec'): EventDraft {
  return { k: 'rev', ts, card, g: 2, ms: 2000, src: 'obchod' };
}

function appendAll(p: Progress, dev: DeviceSeq, drafts: EventDraft[]): [Progress, DeviceSeq] {
  for (const d of drafts) {
    const r = append(p, dev, d);
    if (!r.ok) throw new Error(r.rejected);
    p = r.progress;
    dev = r.dev;
  }
  return [p, dev];
}

describe('progress: новый мир', () => {
  it('newProgress даёт валидный пустой прогресс текущей версии', () => {
    const p = newProgress(T0, 'q3x7c2ab5fkm4tzw');
    expect(p.v).toBe(PROGRESS_V);
    expect(p.log).toEqual({ checkpoint: null, events: [] });
    expect(validateProgress(p)).toEqual([]);
    expect(() => newProgress(T0, '')).toThrow();
  });
});

describe('progress: append', () => {
  it('id = deviceId.seq36, seq растёт, вход не мутируется', () => {
    const p0 = newProgress(T0, 'w');
    const r = append(p0, dev0, rev(T0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.id).toBe('k7m2qa.1');
    expect(r.dev.seq).toBe(1);
    expect(p0.log.events).toHaveLength(0);
    const [p] = appendAll(newProgress(T0, 'w'), { deviceId: 'k7m2qa', seq: 35 }, [rev(T0), rev(T0 + 1)]);
    expect(p.log.events.map((e) => e.id)).toEqual(['k7m2qa.10', 'k7m2qa.11']);
    expect(parseEventId('k7m2qa.10')).toEqual({ deviceId: 'k7m2qa', seq: 36 });
    expect(parseEventId('imp.tr_1')).toBeNull();
  });

  it('сортировка (ts, id) сохраняется, даже если часы устройства отстают', () => {
    const [p] = appendAll(newProgress(T0, 'w'), dev0, [rev(T0 + 5000), rev(T0 + 1000), rev(T0 + 3000), rev(T0 + 1000)]);
    expect(isSorted(p.log.events)).toBe(true);
    expect(p.log.events.map((e) => e.ts)).toEqual([T0 + 1000, T0 + 1000, T0 + 3000, T0 + 5000]);
    expect(validateProgress(p)).toEqual([]);
  });

  it('компактная запись: без undefined и пустых tags', () => {
    const r = append(newProgress(T0, 'w'), dev0, { k: 'rev', ts: T0, card: 'lx.kawa#rec', g: 2, ms: 2000, src: 'obchod', tags: [] });
    expect(r.ok && Object.keys(r.event)).toEqual(['id', 'k', 'ts', 'card', 'g', 'ms', 'src']);
    const r2 = append(newProgress(T0, 'w'), dev0, { k: 'mini', ts: T0, game: 'fish', score: 3, ms: 1000, floor: undefined });
    expect(r2.ok && 'floor' in r2.event).toBe(false);
    // Типичный день ≈ 50 ответов + сцена укладывается в ~5–6 КБ JSON.
    const drafts: EventDraft[] = Array.from({ length: 50 }, (_, i) => rev(T0 + i * 1000, `lx.slowo_${i}#rec`));
    const [p] = appendAll(newProgress(T0, 'w'), dev0, drafts);
    expect(JSON.stringify(p.log.events).length).toBeLessThan(6000);
  });

  it('фильтр ранних ответов: rev по карточке не в срок не пишется', () => {
    const p = newProgress(T0, 'w');
    const due = new Map([['lx.kawa#rec', T0 - 1], ['lx.mleko#rec', T0 + 86_400_000]]);
    const opts = { dueOf: (c: string) => due.get(c), time: WAW };
    expect(append(p, dev0, rev(T0, 'lx.kawa#rec'), opts).ok).toBe(true);
    const early = append(p, dev0, rev(T0, 'lx.mleko#rec'), opts);
    expect(early.ok).toBe(false);
    expect(!early.ok && early.rejected).toBe('early');
    expect(!early.ok && early.dev.seq).toBe(0); // seq не тратится
    const none = append(p, dev0, rev(T0, 'lx.nic#rec'), opts);
    expect(!none.ok && none.rejected).toBe('no_card');
    // Не-rev события фильтр не трогает.
    expect(append(p, dev0, { k: 'seg', ts: T0, seg: 'water' }, opts).ok).toBe(true);
  });

  it('исключение заказов задаётся снаружи: earlyDays только для src order', () => {
    const due = T0 + 2 * 86_400_000;
    expect(revVerdict({ due, now: T0, src: 'order', earlyDays: 3, opts: WAW })).toBe('ok');
    expect(revVerdict({ due, now: T0, src: 'order', earlyDays: 1, opts: WAW })).toBe('early');
    expect(revVerdict({ due, now: T0, src: 'obchod', earlyDays: 3, opts: WAW })).toBe('early');
  });

  it('insertEvents: объединение по id (повторный импорт не дублирует)', () => {
    const imp = { id: 'imp.tr_1', ts: T0 - 1000, k: 'imp' as const, card: 'lx.kawa#rec', state: { reps: 3, interval: 7, ef: 2.5, due: T0 }, from: 'trainer' as const };
    const [p] = appendAll(newProgress(T0, 'w'), dev0, [rev(T0)]);
    const p1 = insertEvents(p, [imp]);
    const p2 = insertEvents(p1, [imp, imp]);
    expect(p2).toBe(p1);
    expect(p1.log.events.map((e) => e.id)).toEqual(['imp.tr_1', 'k7m2qa.1']);
  });

  it('maxSeqFor находит последний seq устройства', () => {
    const [p] = appendAll(newProgress(T0, 'w'), { deviceId: 'k7m2qa', seq: 40 }, [rev(T0), rev(T0 - 5)]);
    expect(maxSeqFor(p, 'k7m2qa')).toBe(42);
    expect(maxSeqFor(p, 'zzzzzz')).toBe(0);
  });

  it('eventsByKind и eventsOfDay', () => {
    const night = Date.UTC(2026, 9, 15, 1, 0); // 03:00 CEST 15.10 → игровой день 14.10
    const [p] = appendAll(newProgress(T0, 'w'), dev0, [rev(T0), { k: 'seg', ts: T0 + 1, seg: 'water' }, rev(night)]);
    expect(eventsByKind(p.log.events, 'rev').map((e) => e.card)).toHaveLength(2);
    expect(eventsOfDay(p.log.events, '2026-10-14', WAW)).toHaveLength(3);
    expect(eventsOfDay(p.log.events, '2026-10-15', WAW)).toHaveLength(0);
  });
});

describe('progress: world и settings', () => {
  it('флаги и предметы монотонны: хранится самый ранний момент', () => {
    let p = newProgress(T0, 'w');
    p = setFlag(p, 'hud.zloty', T0 + 10);
    expect(setFlag(p, 'hud.zloty', T0 + 20)).toBe(p);
    p = setFlag(p, 'hud.zloty', T0 + 5);
    expect(p.world.flags['hud.zloty']).toBe(T0 + 5);
    p = giveItem(p, 'it.bilet', T0);
    expect(p.world.items).toEqual({ 'it.bilet': T0 });
  });
  it('стадия биома не опускается', () => {
    let p = raiseStage(newProgress(T0, 'w'), 'praga', 2, T0);
    expect(raiseStage(p, 'praga', 1, T0 + 1)).toBe(p);
    p = raiseStage(p, 'praga', 3, T0 + 2);
    expect(p.world.unlocked.praga).toEqual({ stage: 3, at: T0 + 2 });
  });
  it('настройки: значение по умолчанию не пишется, правка хранится с at', () => {
    let p = newProgress(T0, 'w');
    expect(getSetting(p, 'newItemsPerDay')).toBe(8);
    expect(p.settings).toEqual({});
    p = setSetting(p, 'newItemsPerDay', 6, T0);
    expect(getSetting(p, 'newItemsPerDay')).toBe(6);
    expect(p.settings.newItemsPerDay).toEqual({ value: 6, at: T0 });
  });
  it('validateProgress ловит дубли и беспорядок в журнале', () => {
    const p = newProgress(T0, 'w');
    const e = { id: 'k7m2qa.1', ts: T0, k: 'seg', seg: 'water' };
    expect(validateProgress({ ...p, log: { checkpoint: null, events: [e, e] } })[0]).toMatch(/дубль/);
    expect(validateProgress({ ...p, log: { checkpoint: null, events: [{ ...e, ts: T0 + 1 }, { ...e, id: 'k7m2qa.2' }] } })[0]).toMatch(/не отсортированы/);
    expect(validateProgress({ ...p, log: { checkpoint: null, events: [{ ...e, k: 'xxx' }] } })[0]).toMatch(/не событие/);
    expect(validateProgress(null)).toEqual(['не объект']);
  });
});
