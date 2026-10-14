import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { derive } from '../src/systems/derive';
import { newProgress, type Progress } from '../src/systems/progress';

const TZ = 'Europe/Warsaw';
const NOW = Date.UTC(2026, 9, 16, 10, 0); // 16.10 12:00 CEST
const fixture = (): Progress => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/progress_v1.json'), 'utf8')) as Progress;

/** Детерминированное перемешивание (LCG), чтобы проверить независимость от порядка. */
function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe('derive: каркас', () => {
  it('пустой журнал', () => {
    const d = derive(newProgress(NOW, 'w'), {}, NOW, TZ);
    expect(d.today).toBe('2026-10-16');
    expect(d.lessons).toEqual({});
    expect(d.lessonsDone.size).toBe(0);
    expect(d.bossResults).toEqual({});
    expect(d.daysPlayed).toBe(0);
    expect(d.lastPlayedDay).toBeNull();
    expect(d.daysSinceLast).toBeNull();
    expect(d.cards).toEqual({});
    expect(d.zloty).toBe(0);
  });

  it('небольшой журнал: уроки, сданные, игровые дни с границей 04:00', () => {
    const d = derive(fixture(), {}, NOW, TZ);
    expect(d.lessons['ch01.s01']).toEqual({ best: 0.8, attempts: 1, passedAt: Date.UTC(2026, 9, 12, 8, 7) });
    expect(d.lessons['ch01.s02']).toEqual({ best: 0.55, attempts: 1 });
    expect([...d.lessonsDone]).toEqual(['ch01.s01']);
    // 12.10: сцена; 13.10: полив + more3 в 02:30 14.10 (ещё игровой день 13-го).
    expect(Object.keys(d.days).sort()).toEqual(['2026-10-12', '2026-10-13']);
    expect(d.days['2026-10-13']).toEqual({ segs: ['more3', 'water'], revs: 2, lessons: 1 });
    expect(d.daysPlayed).toBe(2);
    expect(d.lastPlayedDay).toBe('2026-10-13');
    expect(d.daysSinceLast).toBe(3);
    expect(d.found.has('simba')).toBe(true);
  });

  it('боссы: лучший результат и первый проход', () => {
    let p = newProgress(NOW, 'w');
    const boss = (id: string, ts: number, score: number, passed: boolean) =>
      ({ id, ts, k: 'boss' as const, lesson: 'ch01.boss', score, parts: {}, passed, ms: 1 });
    p = { ...p, log: { checkpoint: null, events: [boss('a.1', 1, 0.5, false), boss('a.2', 2, 0.9, true), boss('a.3', 3, 0.7, true)] } };
    expect(derive(p, {}, NOW, TZ).bossResults['ch01.boss']).toEqual({ best: 0.9, attempts: 3, passedAt: 2 });
  });

  it('перемешанные события дают то же состояние', () => {
    const p = fixture();
    const base = derive(p, {}, NOW, TZ);
    for (const seed of [1, 7, 42, 1234]) {
      const q = { ...p, log: { ...p.log, events: shuffled(p.log.events, seed) } };
      expect(derive(q, {}, NOW, TZ)).toEqual(base);
    }
  });

  it('сон без дела день не засчитывает', () => {
    const p = newProgress(NOW, 'w');
    const q = { ...p, log: { checkpoint: null, events: [{ id: 'a.1', ts: NOW, k: 'seg' as const, seg: 'sleep' as const }] } };
    expect(derive(q, {}, NOW, TZ).daysPlayed).toBe(0);
  });

  it('renames: урок со старым id считается под новым', () => {
    const d = derive(fixture(), { renames: { 'ch01.s01': 'ch01.powitanie' } }, NOW, TZ);
    expect(d.lessonsDone.has('ch01.powitanie')).toBe(true);
    expect(d.lessons['ch01.s01']).toBeUndefined();
  });

  it('checkpoint засевает уроки и дни', () => {
    const p = fixture();
    const cp = {
      asOf: 0, covers: {}, cards: {}, zlotyEarned: 0, zlotySpent: 0,
      lessons: { 'ch01.s00': { passedAt: 5, best: 1 } }, bosses: {},
      days: { '2026-06-01': { segs: ['scene'], revs: 3, lessons: 1 } },
    };
    const d = derive({ ...p, log: { ...p.log, checkpoint: cp } }, {}, NOW, TZ);
    expect(d.lessonsDone.has('ch01.s00')).toBe(true);
    expect(d.daysPlayed).toBe(3);
  });
});
