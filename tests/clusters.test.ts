// Кластеры (ТЗ §4.3, §5.8, I-11): кластер шага, подсчёт ответов, вариант ремонтной сцены, итог босса
// с порогом красных кластеров и выбором частей для повтора; диагностика пишет `diag` → статусы в derive.
import { describe, expect, it } from 'vitest';
import { bossVerdict, mergeTally, repairVariant, stepCluster, tallyOf, tallyScores, variantSteps } from '../src/systems/clusters';
import { derive, deriveContent } from '../src/systems/derive';
import { getContent } from '../src/systems/content';
import { newProgress } from '../src/systems/progress';
import type { Step } from '../src/types/content';

const clustersOf = (item: string): readonly string[] => ({ 'lx.stol': ['R3', 'R10'], 'mp.a_b': ['R6'] })[item] ?? [];

describe('кластер шага и подсчёт', () => {
  it('step.cluster важнее кластеров слова; без cluster — первый кластер item; иначе null', () => {
    const a: Step = { t: 'listen', say: 'stół', options: ['stół', 'stal'], answer: 0, item: 'lx.stol', cluster: 'R4' };
    const b: Step = { t: 'listen', say: 'stół', options: ['stół', 'stal'], answer: 0, item: 'lx.stol' };
    const c: Step = { t: 'explain', md: 'x' };
    expect(stepCluster(a, clustersOf)).toBe('R4');
    expect(stepCluster(b, clustersOf)).toBe('R3');
    expect(stepCluster(c, clustersOf)).toBeNull();
    expect(stepCluster(b)).toBeNull();
  });

  it('tallyOf: частичный score (диакритика 0.75), шаги без кластера пропускаются; merge и точность', () => {
    const t = tallyOf([
      { cluster: 'R3', score: 1 },
      { cluster: 'R3', score: 0.75 },
      { cluster: 'R6', score: 0 },
      { cluster: null, score: 1 },
    ]);
    expect(t).toEqual({ R3: { ok: 1.75, n: 2 }, R6: { ok: 0, n: 1 } });
    expect(mergeTally(t, { R6: { ok: 1, n: 1 } }, undefined)).toEqual({ R3: { ok: 1.75, n: 2 }, R6: { ok: 1, n: 2 } });
    expect(tallyScores(mergeTally(t, { R6: { ok: 1, n: 1 } }))).toEqual({ R3: 0.875, R6: 0.5 });
  });
});

describe('вариант ремонтной сцены (§4.3: green пропуск, yellow short, red полная)', () => {
  it('статус → вариант и индексы шагов', () => {
    expect(repairVariant(undefined)).toBe('locked');
    expect(repairVariant('unknown')).toBe('locked');
    expect(repairVariant('green')).toBe('skip');
    expect(repairVariant('yellow')).toBe('short');
    expect(repairVariant('red')).toBe('full');
    expect(variantSteps(5, 'short', [4, 0, 2, 2, 9])).toEqual([0, 2, 4]);
    expect(variantSteps(3, 'full', [0])).toEqual([0, 1, 2]);
    expect(variantSteps(3, 'skip', [0])).toEqual([]);
    expect(variantSteps(3, 'short')).toEqual([0, 1, 2]);
  });

  it('у ремонтных сцен главы 1 (R1–R10) есть short и skipIf, short.steps в пределах урока', () => {
    const c = getContent();
    const repairs = c.phonetics.clusters.map((cl) => cl.repairLesson);
    expect(repairs.every(Boolean)).toBe(true);
    for (const id of repairs) {
      const l = c.lessons.get(id!)!.value;
      expect(l.kind, id).toBe('repair');
      expect(l.skipIf, id).toBeDefined();
      expect(l.short?.steps.length, id).toBeGreaterThan(0);
      expect(Math.max(...l.short!.steps), id).toBeLessThan(l.steps!.length);
    }
  });
});

describe('итог босса (§5.8)', () => {
  const parts = [
    { id: 'signs', weight: 0.3 },
    { id: 'dict', weight: 0.3 },
    { id: 'spell', weight: 0.2 },
    { id: 'traps', weight: 0.2 },
  ];
  const pass = { score: 0.8, redClusterMin: 0.6 };

  it('взвешенный score; ≥ 0.8 и нет красных кластеров ниже 0.6 → сдан, повторять нечего', () => {
    const v = bossVerdict({ parts, scores: { signs: 1, dict: 0.75, spell: 0.75, traps: 1 }, tallies: {}, status: {}, pass });
    expect(v).toMatchObject({ score: 0.875, passed: true, failedParts: [], redFailed: [] });
  });

  it('score < 0.8 → не сдан, повтор только частей ниже порога', () => {
    const v = bossVerdict({ parts, scores: { signs: 1, dict: 0.5, spell: 0.5, traps: 1 }, tallies: {}, status: {}, pass });
    expect(v.score).toBe(0.75);
    expect(v.passed).toBe(false);
    expect(v.failedParts).toEqual(['dict', 'spell']);
  });

  it('красный кластер < 0.6 валит босса даже при score ≥ 0.8; повтор — части со шагами этого кластера', () => {
    const tallies = {
      signs: { R6: { ok: 1, n: 2 }, R3: { ok: 2, n: 2 } },
      dict: { R6: { ok: 0, n: 1 }, R5: { ok: 1, n: 1 } },
      spell: {},
      traps: {},
    };
    const v = bossVerdict({ parts, scores: { signs: 0.9, dict: 0.875, spell: 1, traps: 1 }, tallies, status: { R6: 'red', R3: 'red', R5: 'yellow' }, pass });
    expect(v.score).toBeGreaterThanOrEqual(0.8);
    expect(v.passed).toBe(false);
    expect(v.redFailed).toEqual(['R6']);
    expect(v.clusters).toEqual({ R3: 1, R5: 1, R6: 0.333 });
    expect(v.failedParts).toEqual(['signs', 'dict']);
  });

  it('жёлтый кластер ниже порога босса не валит; красный с одним ответом не решает судьбу (минимум 2)', () => {
    const tallies = { signs: { R6: { ok: 0, n: 2 }, R1: { ok: 0, n: 1 } } };
    expect(bossVerdict({ parts, scores: { signs: 0.8, dict: 1, spell: 1, traps: 1 }, tallies, status: { R6: 'yellow', R1: 'red' }, pass }).passed).toBe(true);
    expect(bossVerdict({ parts, scores: { signs: 0.8, dict: 1, spell: 1, traps: 1 }, tallies, status: { R6: 'red' }, pass }).passed).toBe(false);
    // без redClusterMin порога по кластерам нет
    expect(bossVerdict({ parts, scores: { signs: 0.8, dict: 1, spell: 1, traps: 1 }, tallies, status: { R6: 'red' }, pass: { score: 0.8 } }).passed).toBe(true);
  });

  it('часть без результата = 0; без весов части равны', () => {
    const v = bossVerdict({ parts: [{ id: 'a' }, { id: 'b' }], scores: { a: 1 }, tallies: {}, status: {} });
    expect(v).toMatchObject({ score: 0.5, passed: false, failedParts: ['b'] });
  });
});

describe('диагностика → статус кластеров', () => {
  it('событие diag (как пишет сцена 1.0) даёт green/yellow/red и pair-карточки красных', () => {
    const c = getContent();
    let p = newProgress(Date.UTC(2026, 9, 1, 10), 'w1');
    const ts = Date.UTC(2026, 9, 2, 10);
    p = { ...p, log: { checkpoint: null, events: [{ id: 'd.1', ts, k: 'diag', results: { R1: { ok: 2, n: 2 }, R6: { ok: 0.75, n: 2 }, R7: { ok: 1.5, n: 2 } } }] } };
    const d = derive(p, deriveContent(c), ts + 3_600_000, 'Europe/Warsaw');
    expect(d.clusterStatus).toMatchObject({ R1: 'green', R6: 'red', R7: 'yellow', R8: 'unknown' });
    expect(Object.keys(d.cards).filter((k) => k.endsWith('#pair')).length).toBe(c.phonetics.pairs.filter((x) => x.cluster === 'R6' || x.cluster === 'R7').length);
  });
});
