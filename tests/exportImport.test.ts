import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileName, importPlan, parseFile, serializeFile, toFile } from '../src/systems/exportImport';
import type { EventDraft } from '../src/systems/log';
import { append, newProgress, PROGRESS_V, setFlag, setSetting, type Progress } from '../src/systems/progress';

const NOW = Date.UTC(2026, 9, 14, 8, 0);
const fixture = (): Progress => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/progress_v1.json'), 'utf8')) as Progress;

function bigProgress(): Progress {
  let p = newProgress(NOW, 'q3x7c2ab5fkm4tzw');
  let dev = { deviceId: 'k7m2qa', seq: 0 };
  const ds: EventDraft[] = [
    { k: 'rev', ts: 0, card: 'lx.kawa#rec', g: 3, ms: 1500, src: 'obchod' },
    { k: 'boss', ts: 0, lesson: 'ch01.boss', score: 0.85, parts: { a: 1, b: 0.7 }, clusters: { R1: 0.9 }, passed: true, ms: 600000 },
    { k: 'diag', ts: 0, results: { R1: { ok: 3, n: 4 } } },
    { k: 'mini', ts: 0, game: 'fish', score: 5, ms: 90000, floor: 2 },
    { k: 'order', ts: 0, npc: 'brzechwa', order: 'ord.kawa', items: ['lx.kawa'], cards: ['lx.kawa#rec'], ok: 1 },
    { k: 'session', ts: 0, mode: 'express', ms: 180000, retrievalMs: 90000 },
  ];
  for (let i = 0; i < 300; i++) {
    const r = append(p, dev, { ...ds[i % ds.length]!, ts: NOW + i * 7000 });
    if (!r.ok) throw new Error('append');
    p = r.progress;
    dev = r.dev;
  }
  p = setFlag(p, 'hud.zloty', NOW);
  p = setSetting(p, 'keyboard.mode', 'strip', NOW + 5);
  return p;
}

describe('экспорт → импорт', () => {
  it('идентичность: фикстура и прогресс на 300 событий', () => {
    for (const p of [fixture(), bigProgress()]) {
      const text = serializeFile(toFile(p, NOW));
      const parsed = parseFile(text);
      expect(parsed.kind).toBe('pq-save');
      if (parsed.kind !== 'pq-save' || parsed.status !== 'ok') throw new Error('not ok');
      expect(parsed.progress).toEqual(p);
      expect(parsed.exportedAt).toBe(NOW);
      expect('migratedFrom' in parsed).toBe(false);
      // И повторный круг даёт байт-в-байт тот же файл.
      expect(serializeFile(toFile(parsed.progress, NOW))).toBe(text);
    }
  });

  it('файл: формат, версия, компактный JSON, имя по дате', () => {
    const f = toFile(fixture(), NOW);
    expect(f).toMatchObject({ format: 'pq-save', v: PROGRESS_V, exportedAt: NOW });
    expect(serializeFile(f)).not.toContain('\n');
    expect(fileName(Date.UTC(2026, 9, 14, 22, 30), { tz: 'Europe/Warsaw' })).toBe('polski-quest-2026-10-15.json');
  });

  it('файл новой версии → «Обнови игру»', () => {
    const p = { ...fixture(), v: PROGRESS_V + 1 };
    expect(parseFile(serializeFile(toFile(p, NOW)))).toEqual({ kind: 'pq-save', status: 'newer', v: PROGRESS_V + 1 });
  });

  it('битый свой файл → invalid с ошибками', () => {
    const r = parseFile(JSON.stringify({ format: 'pq-save', v: 1, exportedAt: NOW, progress: { v: 1, worldId: 'w' } }));
    expect(r.kind === 'pq-save' && r.status).toBe('invalid');
  });

  it('экспорт тренажёра распознаётся отдельно (мастер импорта §9)', () => {
    const trainer = { v: 3, userId: null, trainer: { cards: [{ id: 'w1', pl: 'kawa' }], stats: {} }, lessons: {} };
    expect(parseFile(JSON.stringify(trainer)).kind).toBe('trainer');
    expect(parseFile(JSON.stringify({ cards: [], stats: {} })).kind).toBe('trainer');
  });

  it('мусор → unknown', () => {
    expect(parseFile('not json')).toEqual({ kind: 'unknown', reason: 'не JSON' });
    expect(parseFile('[1,2]').kind).toBe('unknown');
    expect(parseFile('{"hello":1}').kind).toBe('unknown');
  });

  it('голый объект прогресса тоже принимается', () => {
    const p = fixture();
    const r = parseFile(JSON.stringify(p));
    expect(r.kind === 'pq-save' && r.status === 'ok' && r.progress).toEqual(p);
  });

  it('другой мир → спросить «Заменить?», тот же → слияние', () => {
    const p = fixture();
    expect(importPlan(p, p)).toBe('merge');
    expect(importPlan(p, { ...p, worldId: 'zzzz' })).toBe('other_world');
    expect(importPlan(null, p)).toBe('new');
  });
});
