import { describe, expect, it } from 'vitest';
import { checkAnswer, type Check, type Verdict } from '../src/systems/answer';
import { fastMs, gradeFromAnswer, type StepKind } from '../src/systems/grade';
import { DEFAULT_TUNING as T } from '../src/systems/tuning';

const chk = (verdict: Verdict, score: number) => ({ verdict, score: score as Check['score'] });
const g = (kind: StepKind, verdict: Verdict, score: number, ms: number, interval: number, extra: { attempt?: number; hinted?: boolean } = {}) =>
  gradeFromAnswer({ kind, check: chk(verdict, score), ms, interval, ...extra }, T);

describe('grade: матрица verdict × скорость × interval (§4.7)', () => {
  const kinds: StepKind[] = ['choice', 'listen', 'match', 'minimal_pair', 'type', 'dictation', 'order', 'gap'];
  const cases: [Verdict, number, number /*медленно, interval 16*/, number /*быстро, interval 3*/, number /*быстро, interval 7*/][] = [
    ['wrong', 0, 0, 0, 0],
    ['diacritics', 0, 0, 0, 0], // режим fail
    ['ortho', 0.5, 1, 1, 1],
    ['typo', 0.5, 1, 1, 1],
    ['diacritics', 0.75, 1, 1, 1], // warn
    ['diacritics', 1, 2, 2, 2], // ok: как exact, но без grade 3
    ['exact', 1, 2, 2, 3],
  ];
  for (const kind of kinds) {
    const fast = fastMs(kind, T)! - 1;
    for (const [v, s, slow16, fast3, fast7] of cases) {
      it(`${kind}: ${v} ${s}`, () => {
        expect(g(kind, v, s, 60_000, 16)).toBe(slow16);
        expect(g(kind, v, s, fast, 3)).toBe(fast3);
        expect(g(kind, v, s, fast, 7)).toBe(fast7);
      });
    }
  }

  it('пороги скорости: выбор 2.5 с, ввод 6 с (строго меньше)', () => {
    expect(fastMs('choice', T)).toBe(2500);
    expect(fastMs('dictation', T)).toBe(6000);
    expect(g('choice', 'exact', 1, 2499, 7)).toBe(3);
    expect(g('choice', 'exact', 1, 2500, 7)).toBe(2);
    expect(g('listen', 'exact', 1, 4000, 35)).toBe(2);
    expect(g('type', 'exact', 1, 4000, 35)).toBe(3);
    expect(g('type', 'exact', 1, 6000, 35)).toBe(2);
  });

  it('подсказка: верный ответ → 1, неверный → 0', () => {
    expect(g('type', 'exact', 1, 1000, 35, { hinted: true })).toBe(1);
    expect(g('type', 'wrong', 0, 1000, 35, { hinted: true })).toBe(0);
  });

  it('только первая попытка идёт в SRS', () => {
    expect(g('type', 'exact', 1, 1000, 7, { attempt: 1 })).toBe(3);
    expect(g('type', 'exact', 1, 1000, 7, { attempt: 2 })).toBeNull();
  });

  it('say, explain, shadow, stress SRS не трогают', () => {
    for (const k of ['say', 'explain', 'shadow', 'stress'] as StepKind[]) expect(g(k, 'exact', 1, 100, 35)).toBeNull();
    expect(fastMs('say', T)).toBeNull();
  });

  it('связка с checkAnswer: zeka → rzeka = 1, dziekuje в режиме ok = 2', () => {
    expect(gradeFromAnswer({ kind: 'dictation', check: checkAnswer('zeka', ['rzeka']), ms: 3000, interval: 7 }, T)).toBe(1);
    expect(gradeFromAnswer({ kind: 'type', check: checkAnswer('dziekuje', ['dziękuję'], { diacritics: 'ok' }), ms: 1000, interval: 35 }, T)).toBe(2);
  });
});
