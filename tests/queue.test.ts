import { describe, expect, it } from 'vitest';
import { derive, type Derived } from '../src/systems/derive';
import type { EventBody, LogEvent } from '../src/systems/log';
import { newProgress, type CardState, type DayStats } from '../src/systems/progress';
import {
  debtAt,
  dueQueue,
  interleaveTypes,
  isNewContentLocked,
  isSpring,
  newContentLock,
  newItemsCap,
  newItemsLeftToday,
  pickRemedy,
} from '../src/systems/queue';
import { addDays, dayStartOf } from '../src/systems/time';
import { DEFAULT_TUNING as T } from '../src/systems/tuning';

const TZ = 'Europe/Warsaw';
const W = { tz: TZ };
const TODAY = '2026-10-20';
const NOW = dayStartOf(TODAY, W) + 5 * 3_600_000; // 20.10 09:00
const DAY = 86_400_000;

/** Карточка: interval, просрочена на `overdueDays`, последний ответ — до сегодня. */
function card(interval: number, overdueDays = 0, extra: Partial<CardState> = {}): CardState {
  const due = dayStartOf(TODAY, W) - overdueDays * DAY;
  return { reps: 2, interval, ef: 2.5, due, lapses: 0, lastReviewAt: due - interval * DAY, lastGrade: 2, maxInterval: interval, createdAt: 0, ...extra };
}

const PLAYED: DayStats = { segs: ['water'], revs: 5, lessons: 0 };

function state(cards: Record<string, CardState>, extra: Partial<Derived> = {}): Derived {
  const base = derive(newProgress(0, 'w'), {}, NOW, TZ);
  return { ...base, cards, days: { [addDays(TODAY, -1)]: PLAYED }, ...extra };
}

function many(n: number, f: (i: number) => [string, CardState]): Record<string, CardState> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => f(i)));
}

describe('queue: порядок и братья', () => {
  it('сначала меньший interval, потом дольше просроченные; не due не берутся', () => {
    const s = state({
      'lx.a#rec': card(16, 1),
      'lx.b#rec': card(3, 0),
      'lx.c#rec': card(3, 4),
      'lx.d#rec': card(1, 0),
      'lx.e#rec': card(7, -1), // due завтра
    });
    expect(dueQueue(s, NOW, T, { mode: 'obchod' })).toEqual(['lx.d#rec', 'lx.c#rec', 'lx.b#rec', 'lx.a#rec']);
  });

  it('типы вперемешку: подряд не два одинаковых, где можно', () => {
    const s = state({
      'lx.a#rec': card(1, 3),
      'lx.b#rec': card(1, 2),
      'lx.c#lis': card(3, 0),
      'lx.d#rec': card(3, 0),
      'lx.e#pro': card(7, 0),
    });
    const q = dueQueue(s, NOW, T, { mode: 'obchod' });
    expect(q).toEqual(['lx.a#rec', 'lx.c#lis', 'lx.b#rec', 'lx.e#pro', 'lx.d#rec']);
    expect(interleaveTypes([{ type: 'a' }, { type: 'a' }])).toEqual([{ type: 'a' }, { type: 'a' }]);
  });

  it('братья: одна карточка слова за сессию', () => {
    const s = state({ 'lx.a#rec': card(1, 0), 'lx.a#lis': card(3, 2), 'lx.a#pro': card(7, 0), 'lx.b#rec': card(3, 0) });
    expect(dueQueue(s, NOW, T, { mode: 'obchod' })).toEqual(['lx.a#rec', 'lx.b#rec']);
  });

  it('братья: по слову уже отвечали сегодня другой карточкой — остальные ждут завтра', () => {
    const answered = card(3, -3, { lastReviewAt: NOW - 3_600_000 }); // rec отвечен сегодня утром
    const s = state({ 'lx.a#rec': answered, 'lx.a#lis': card(1, 0), 'lx.b#rec': card(1, 0) });
    expect(dueQueue(s, NOW, T, { mode: 'obchod' })).toEqual(['lx.b#rec']);
    // только что созданная (не отвеченная) карточка брата не прячет
    const fresh = { ...card(0, -1), lastReviewAt: NOW - 1000, createdAt: NOW - 1000 };
    expect(dueQueue(state({ 'lx.a#pro': fresh, 'lx.a#lis': card(1, 0) }), NOW, T, { mode: 'obchod' })).toEqual(['lx.a#lis']);
  });

  it('проваленная сегодня карточка возвращается не раньше чем через 5 других', () => {
    const lapsed = card(0, 0, { due: NOW - 60_000, lastReviewAt: NOW - 60_000, lastGrade: 0, reps: 0, lapses: 1 });
    const cards = { 'lx.z#rec': lapsed, ...many(7, (i) => [`lx.w${i}#rec`, card(3, i)]) };
    const q = dueQueue(state(cards), NOW, T, { mode: 'obchod' });
    expect(q.indexOf('lx.z#rec')).toBe(5);
    const few = dueQueue(state({ 'lx.z#rec': lapsed, 'lx.w#rec': card(3, 0) }), NOW, T, { mode: 'obchod' });
    expect(few).toEqual(['lx.w#rec', 'lx.z#rec']);
  });
});

describe('queue: лимиты режимов', () => {
  const cards = many(30, (i) => [`lx.w${i}#${['rec', 'lis', 'pro'][i % 3]}`, card(1 + (i % 5), i % 4)]);

  it('обход: раунд до 15', () => {
    expect(dueQueue(state(cards), NOW, T, { mode: 'obchod' })).toHaveLength(15);
    expect(dueQueue(state(cards), NOW, T, { mode: 'obchod', limit: 4 })).toHaveLength(4);
  });

  it('экспресс ≤ 12', () => {
    expect(dueQueue(state(cards), NOW, T, { mode: 'express' })).toHaveLength(12);
    expect(dueQueue(state(cards), NOW, T, { mode: 'express', limit: 50 })).toHaveLength(12);
  });

  it('шахта: только зрелые (interval ≥ 35), самые глубокие первыми', () => {
    const s = state({ 'lx.a#rec': card(35, 0), 'lx.b#rec': card(88, 0), 'lx.c#rec': card(16, 5) });
    expect(dueQueue(s, NOW, T, { mode: 'mine' })).toEqual(['lx.b#rec', 'lx.a#rec']);
  });
});

describe('queue: фонетическая колода', () => {
  const pairs = many(8, (i) => [`mp.p${i}#pair`, card(1, i % 3)]);
  const pairCluster = Object.fromEntries(Object.keys(pairs).map((id, i) => [id, i < 6 ? 'R3' : 'R6']));
  const base = { pairCluster, clusterStatus: { R3: 'red', R6: 'yellow' } as Derived['clusterStatus'] };

  it('фонетика ≤ 5 в день и только в своей очереди', () => {
    const s = state({ ...pairs, 'lx.a#rec': card(1, 0) }, base);
    const q = dueQueue(s, NOW, T, { mode: 'phonetic' });
    expect(q).toHaveLength(5);
    expect(q.every((id) => id.endsWith('#pair'))).toBe(true);
    expect(dueQueue(s, NOW, T, { mode: 'obchod' })).toEqual(['lx.a#rec']);
    expect(debtAt(s, NOW)).toBe(1);
  });

  it('уже отвеченные сегодня пары съедают дневной лимит', () => {
    const done = { 'mp.x#pair': card(1, -1, { lastReviewAt: NOW - 1000 }), 'mp.y#pair': card(1, -1, { lastReviewAt: NOW - 2000 }) };
    const s = state({ ...pairs, ...done }, { ...base, pairCluster: { ...pairCluster, 'mp.x#pair': 'R3', 'mp.y#pair': 'R3' } });
    expect(dueQueue(s, NOW, T, { mode: 'phonetic' })).toHaveLength(3);
  });

  it('закрытый (green) и неизвестный кластер в очередь не идут', () => {
    const s = state(pairs, { ...base, clusterStatus: { R3: 'green', R6: 'unknown' } });
    expect(dueQueue(s, NOW, T, { mode: 'phonetic' })).toEqual([]);
  });
});

describe('queue: весна', () => {
  const cards = {
    'lx.a#rec': card(1, 9),
    'lx.b#rec': card(3, 8),
    'lx.c#rec': card(7, 8),
    'lx.d#rec': card(16, 8),
    'lx.e#lis': card(35, 8),
    'lx.f#rec': card(88, 8),
    'lx.g#rec': card(3, 10),
    'lx.h#pro': card(1, 8),
  };
  const away = { days: { [addDays(TODAY, -8)]: PLAYED } };

  it('после ≥ 7 дней паузы первые 5 — самые длинные интервалы', () => {
    const s = state(cards, away);
    expect(isSpring(s, T)).toBe(true);
    const q = dueQueue(s, NOW, T, { mode: 'obchod' });
    expect(q.slice(0, 5)).toEqual(['lx.f#rec', 'lx.e#lis', 'lx.d#rec', 'lx.c#rec', 'lx.g#rec']);
    expect(q.slice(5).sort()).toEqual(['lx.a#rec', 'lx.b#rec', 'lx.h#pro']);
  });

  it('не весна: пауза 6 дней; сегодня уже играл; экспресс', () => {
    expect(isSpring(state(cards, { days: { [addDays(TODAY, -6)]: PLAYED } }), T)).toBe(false);
    expect(isSpring(state(cards, { days: { [addDays(TODAY, -8)]: PLAYED, [TODAY]: PLAYED } }), T)).toBe(false);
    expect(isSpring(state(cards, { days: {} }), T)).toBe(false); // первый день в игре
    expect(dueQueue(state(cards, away), NOW, T, { mode: 'express' })[0]).toBe('lx.a#rec');
  });
});

describe('queue: новые слова и долг', () => {
  const due = (n: number) => many(n, (i) => [`lx.d${i}#rec`, card(1, 0)]);

  it('потолок новых 8 в день', () => {
    const s = state({});
    expect(newItemsCap(s, NOW, T)).toBe(8);
    expect(newItemsLeftToday(s, NOW, T)).toBe(8);
    expect(newItemsLeftToday({ ...s, newItemsByDay: { [TODAY]: 5 } }, NOW, T)).toBe(3);
    expect(newItemsLeftToday({ ...s, newItemsByDay: { [TODAY]: 8 } }, NOW, T)).toBe(0);
    expect(newItemsLeftToday({ ...s, newItemsByDay: { [addDays(TODAY, -1)]: 8 } }, NOW, T)).toBe(8);
    expect(newItemsLeftToday(s, NOW, T, { perDay: 12, bonus: 4 })).toBe(16);
  });

  it('автоподстройка под долг: до 15 полный, к 60 половина', () => {
    expect(newItemsCap(state(due(15)), NOW, T)).toBe(8);
    expect(newItemsCap(state(due(30)), NOW, T)).toBe(7);
    expect(newItemsCap(state(due(45)), NOW, T)).toBe(5);
    expect(newItemsCap(state(due(60)), NOW, T)).toBe(4);
    expect(newItemsCap(state(due(61)), NOW, T)).toBe(0);
  });

  it('блок при долге 61, не 60; сцены без новых слов не закрываются', () => {
    const s60 = state(due(60));
    const s61 = state(due(61));
    expect(newContentLock(s60, NOW, T, 3)).toBeNull();
    expect(isNewContentLocked(s60, NOW, T, 3)).toBe(false);
    expect(newContentLock(s61, NOW, T, 3)).toBe('debt');
    expect(isNewContentLocked(s61, NOW, T, 0)).toBe(false);
    expect(dueQueue(s61, NOW, T, { mode: 'obchod' })).toHaveLength(15); // обход открыт
    expect(dueQueue(s61, NOW, T, { mode: 'express' })).toHaveLength(12);
  });

  it('сцена не влезает в остаток лимита → limit', () => {
    const s = { ...state({}), newItemsByDay: { [TODAY]: 5 } };
    expect(newContentLock(s, NOW, T, 3)).toBeNull();
    expect(newContentLock(s, NOW, T, 4)).toBe('limit');
  });

  it('долг считается на момент now: карточка с due в 04:00 следующего дня ещё не долг', () => {
    const s = state({ 'lx.a#rec': card(1, -1) });
    expect(debtAt(s, NOW)).toBe(0);
    expect(debtAt(s, NOW + DAY)).toBe(1);
  });
});

describe('queue: лекарство по тегам (§4.4)', () => {
  const tags = new Map([['ff.stol', { remedy: 'rm.stol' }], ['R3', { remedy: 'rm.l' }], ['gr.x', {}]]);
  const ev = (id: string, ts: number, body: EventBody): LogEvent => ({ id, ts, ...body }) as LogEvent;
  const err = (id: string, ts: number, tag: string) => ev(id, ts, { k: 'rev', card: 'lx.stol#rec', g: 0, ms: 1, src: 'obchod', tags: [tag] });
  const shown = (id: string, ts: number, lesson: string) => ev(id, ts, { k: 'lesson', lesson, score: 1, firstTry: 1, ms: 1, passed: true, answers: 4 });

  it('≥ 3 ошибки за 7 дней и есть remedy → лекарство', () => {
    const e = [err('a.1', NOW - 2 * DAY, 'ff.stol'), err('a.2', NOW - DAY, 'ff.stol')];
    expect(pickRemedy(e, NOW, T, tags, W)).toBeNull();
    const e3 = [...e, err('a.3', NOW - 1000, 'ff.stol')];
    expect(pickRemedy(e3, NOW, T, tags, W)).toEqual({ tag: 'ff.stol', lesson: 'rm.stol', errors: 3 });
    // ошибки из итога урока считаются числом
    const lesson = ev('a.4', NOW - DAY, { k: 'lesson', lesson: 'ch01.s02', score: 0.5, firstTry: 0.5, ms: 1, passed: false, answers: 10, tags: { R3: 4, 'gr.x': 9 } });
    expect(pickRemedy([...e3, lesson], NOW, T, tags, W)).toEqual({ tag: 'R3', lesson: 'rm.l', errors: 4 });
  });

  it('ошибки старше окна не считаются', () => {
    const e = [err('a.1', NOW - 8 * DAY, 'ff.stol'), err('a.2', NOW - DAY, 'ff.stol'), err('a.3', NOW - 1000, 'ff.stol')];
    expect(pickRemedy(e, NOW, T, tags, W)).toBeNull();
  });

  it('кулдаун 3 дня после показа; ошибки до показа сгорают; одно в день', () => {
    const before = [err('a.1', NOW - 5 * DAY, 'ff.stol'), err('a.2', NOW - 5 * DAY, 'ff.stol'), err('a.3', NOW - 5 * DAY, 'ff.stol')];
    const after = [err('b.1', NOW - DAY, 'ff.stol'), err('b.2', NOW - DAY, 'ff.stol'), err('b.3', NOW - 1000, 'ff.stol')];
    expect(pickRemedy([...before, shown('s.1', NOW - 4 * DAY, 'rm.stol')], NOW, T, tags, W)).toBeNull();
    expect(pickRemedy([...before, shown('s.1', NOW - 4 * DAY, 'rm.stol'), ...after], NOW, T, tags, W)?.errors).toBe(3);
    expect(pickRemedy([shown('s.1', NOW - 2 * DAY, 'rm.stol'), ...after], NOW, T, tags, W)).toBeNull();
    const other = [err('c.1', NOW - DAY, 'R3'), err('c.2', NOW - DAY, 'R3'), err('c.3', NOW - DAY, 'R3')];
    expect(pickRemedy([...after, ...other, shown('s.2', NOW - 1000, 'rm.l')], NOW, T, tags, W)).toBeNull();
  });
});
