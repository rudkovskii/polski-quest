import { describe, expect, it } from 'vitest';
import type { CardState } from '../src/systems/progress';
import { cardId, fresh, fuzzDays, nextEf, orderEarlyDays, parseCardId, review, type Grade } from '../src/systems/srs';
import { dayOf, dayStartAfter, dayStartOf } from '../src/systems/time';
import { DEFAULT_TUNING as T } from '../src/systems/tuning';

const TZ = 'Europe/Warsaw';
const W = { tz: TZ };
const T0 = Date.UTC(2026, 9, 15, 10, 0); // 15.10 12:00 CEST
const DAY = 86_400_000;

/** Карточка после intro с верным ответом: reps 1, interval 1, due завтра 04:00. */
function introduced(): CardState {
  return { ...fresh(T0), reps: 1, interval: 1, maxInterval: 1, due: dayStartOf('2026-10-16', W) };
}

/** Отвечать grade g ровно в момент due (как обход в 04:00+1ч), вернуть историю. */
function run(card: CardState, grades: Grade[], id = 'lx.kawa#rec'): CardState[] {
  const out: CardState[] = [];
  let c = card;
  for (const g of grades) {
    c = review(c, g, c.due + 3_600_000, T, id, W);
    out.push(c);
  }
  return out;
}

describe('srs: лестница', () => {
  it('intro → grade 2 по due: 3, 7, 16, 35, затем round(35 × ef)', () => {
    const h = run(introduced(), [2, 2, 2, 2, 2, 2]);
    expect(h.map((c) => c.interval)).toEqual([3, 7, 16, 35, Math.round(35 * 2.5), Math.round(88 * 2.5)]);
    expect(h.map((c) => c.reps)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(h.every((c) => c.ef === 2.5)).toBe(true);
  });

  it('с нуля grade 2 даёт 1, 3, 7, 16, 35', () => {
    expect(run(fresh(T0), [2, 2, 2, 2, 2]).map((c) => c.interval)).toEqual([1, 3, 7, 16, 35]);
  });

  it('grade 0: reps 0, lapses + 1, interval 0, due = now', () => {
    const c = run(introduced(), [2, 2])[1]!;
    const now = c.due + 1000;
    const r = review(c, 0, now, T, 'x#rec', W);
    expect(r).toMatchObject({ reps: 0, lapses: 1, interval: 0, due: now, lastGrade: 0, lastReviewAt: now });
    expect(r.maxInterval).toBe(7);
    expect(r.ef).toBeCloseTo(2.18, 6);
  });

  it('grade 1 не двигает шаг: r = 0 → 1, иначе прежний interval, ef падает', () => {
    const z = review(fresh(T0), 1, T0, T, 'x#rec', W);
    expect(z).toMatchObject({ reps: 0, interval: 1 });
    const c = run(introduced(), [2, 2])[1]!; // interval 7, reps 3
    const r = review(c, 1, c.due, T, 'x#rec', W);
    expect(r).toMatchObject({ reps: 3, interval: 7 });
    expect(r.ef).toBeCloseTo(2.36, 6);
  });

  it('grade 3 перепрыгивает шаг; на вершине × ef; дальше × ef × 1.3', () => {
    const h = run(introduced(), [3, 3, 3, 3]);
    expect(h.map((c) => c.interval)).toEqual([7, 16, 35, Math.round(35 * 2.8)]);
    const top = run(introduced(), [2, 2, 2, 2])[3]!; // interval 35, reps 5
    const r = review(top, 3, top.due, T, 'x#rec', W);
    expect(r.interval).toBe(Math.round(35 * 2.5 * 1.3));
    expect(r.ef).toBeCloseTo(2.6, 6);
  });

  it('ef в [1.3, 2.8]', () => {
    let c = fresh(T0);
    for (let i = 0; i < 20; i++) c = review(c, 0, T0 + i, T, 'x#rec', W);
    expect(c.ef).toBe(1.3);
    for (let i = 0; i < 20; i++) c = review(c, 3, c.due, T, 'x#rec', W);
    expect(c.ef).toBe(2.8);
    expect(nextEf(2.75, 3, T)).toBe(2.8);
    expect(nextEf(1.35, 0, T)).toBe(1.3);
    expect(c.interval).toBe(36500); // предохранитель от ухода due за 9999 год
  });
});

describe('srs: время и детерминизм', () => {
  it('due = 04:00 нужного игрового дня, даже если ответ ночью', () => {
    const night = Date.UTC(2026, 9, 16, 0, 30); // 16.10 02:30 CEST = игровой день 15.10
    const r = review(fresh(T0), 2, night, T, 'x#rec', W);
    expect(r.due).toBe(dayStartOf('2026-10-16', W));
    const r2 = review({ ...fresh(T0), reps: 1, interval: 1 }, 2, T0, T, 'x#rec', W);
    expect(r2.due).toBe(dayStartOf('2026-10-18', W));
    expect(dayOf(r2.due, W)).toBe('2026-10-18');
  });

  it('переход на зимнее время: due всё равно 04:00 местного', () => {
    const r = review({ ...fresh(T0), reps: 2, interval: 3 }, 2, Date.UTC(2026, 9, 22, 10), T, 'x#rec', W);
    expect(r.interval).toBe(7);
    expect(new Date(r.due).toISOString()).toBe('2026-10-29T03:00:00.000Z'); // 04:00 CET
  });

  it('разброс ±5 % для interval ≥ 7: детерминирован, только в due, номинал не меняется', () => {
    expect(fuzzDays(3, 'a#rec', 2, 0.05)).toBe(0);
    expect(fuzzDays(7, 'a#rec', 3, 0.05)).toBe(0); // 7 × 5 % < 0.5
    const offsets = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const f = fuzzDays(88, `lx.w${i}#rec`, 6, 0.05);
      expect(Math.abs(f)).toBeLessThanOrEqual(Math.round(88 * 0.05));
      expect(fuzzDays(88, `lx.w${i}#rec`, 6, 0.05)).toBe(f);
      offsets.add(f);
    }
    expect(offsets.size).toBeGreaterThan(3);
    const c = run(introduced(), [2, 2, 2, 2, 2], 'lx.w7#rec')[4]!;
    expect(c.interval).toBe(88);
    expect(c.due).toBe(dayStartAfter(c.lastReviewAt, 88 + fuzzDays(88, 'lx.w7#rec', 6, 0.05), W));
    expect(fuzzDays(88, 'x', 1, 0)).toBe(0);
  });

  it('два одинаковых входа дают побитово одинаковый результат', () => {
    const a = run(introduced(), [2, 1, 3, 0, 2, 2, 3], 'lx.dom#lis');
    const b = run(introduced(), [2, 1, 3, 0, 2, 2, 3], 'lx.dom#lis');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('вход не мутируется', () => {
    const c = Object.freeze(introduced());
    const snap = JSON.stringify(c);
    for (const g of [0, 1, 2, 3] as Grade[]) review(c, g, c.due, T, 'x#rec', W);
    expect(JSON.stringify(c)).toBe(snap);
  });

  it('maxInterval монотонен, lastGrade и lastReviewAt проставлены', () => {
    const h = run(introduced(), [2, 2, 2, 0, 2]);
    expect(h.map((c) => c.maxInterval)).toEqual([3, 7, 16, 16, 16]);
    expect(h.map((c) => c.lastGrade)).toEqual([2, 2, 2, 0, 2]);
    expect(h[4]!.lastReviewAt).toBeGreaterThan(h[3]!.lastReviewAt);
  });

  it('fresh: reps 0, interval 0, ef 2.5, due = now', () => {
    expect(fresh(T0)).toMatchObject({ reps: 0, interval: 0, ef: 2.5, due: T0, lapses: 0, createdAt: T0 });
    expect(T0 + DAY).toBeGreaterThan(T0);
  });
});

describe('srs: id карточек и исключение заказов', () => {
  it('cardId / parseCardId', () => {
    expect(cardId('lx.kawa', 'rec')).toBe('lx.kawa#rec');
    expect(parseCardId('mp.lata_lata#pair')).toEqual({ item: 'mp.lata_lata', type: 'pair' });
    expect(parseCardId('lx.kawa#xyz')).toBeNull();
    expect(parseCardId('#rec')).toBeNull();
  });

  it('earlyDays только для зрелых: 3 дня < 10 % интервала', () => {
    expect(orderEarlyDays({ interval: 35 }, 3)).toBe(3);
    expect(orderEarlyDays({ interval: 30 }, 3)).toBe(0);
    expect(orderEarlyDays({ interval: 7 }, 3)).toBe(0);
    expect(orderEarlyDays(undefined, 3)).toBe(0);
  });
});
