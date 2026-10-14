// Вычислитель условий (ТЗ §3.9, I-13): каждый атом, комбинаторы, варианты уроков (requires/skipIf/short)
// и сверка с repairVariant для ремонтных сцен 1.1–1.10 на реальном контенте.
import { describe, expect, it } from 'vitest';
import { repairVariant } from '../src/systems/clusters';
import { condCtx, evaluate, inDateWindow, jarCount, lessonOfVariant, lessonVariant, masteryShare, type CondCtx } from '../src/systems/conditions';
import { getContent } from '../src/systems/content';
import { derive, deriveContent, type ClusterStatus, type Derived } from '../src/systems/derive';
import type { EventDraft } from '../src/systems/log';
import { append, newProgress, type CardState, type Progress, type WorldState } from '../src/systems/progress';
import type { Condition } from '../src/types/content';

const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 14, 8); // среда 14.10.2026, 10:00 в Варшаве

const card = (interval: number, o: Partial<CardState> = {}): CardState => ({
  reps: 1,
  interval,
  ef: 2.5,
  due: T0 + DAY,
  lapses: 0,
  lastReviewAt: T0,
  lastGrade: 2,
  maxInterval: interval,
  createdAt: T0 - 10 * DAY,
  ...o,
});

function ctx(d: Partial<Derived> = {}, w: Partial<WorldState> = {}, extra: Partial<CondCtx> = {}): CondCtx {
  return {
    derived: {
      today: '2026-10-14',
      lessonsDone: new Set(),
      bossResults: {},
      cards: {},
      clusterStatus: {},
      daysPlayed: 0,
      daysSinceLast: null,
      found: new Set(),
      days: {},
      jars: {},
      ...d,
    },
    world: { flags: {}, items: {}, unlocked: {}, ...w },
    now: T0,
    ...extra,
  };
}

const ev = (c: Condition, x: CondCtx): boolean => evaluate(c, x);

describe('атомы условий (§3.9)', () => {
  it('always', () => {
    expect(ev({ always: true }, ctx())).toBe(true);
  });
  it('all / any / not', () => {
    const x = ctx({}, { flags: { a: 1 } });
    expect(ev({ all: [{ flag: 'a' }, { always: true }] }, x)).toBe(true);
    expect(ev({ all: [{ flag: 'a' }, { flag: 'b' }] }, x)).toBe(false);
    expect(ev({ any: [{ flag: 'b' }, { flag: 'a' }] }, x)).toBe(true);
    expect(ev({ any: [{ flag: 'b' }, { flag: 'c' }] }, x)).toBe(false);
    expect(ev({ not: { flag: 'b' } }, x)).toBe(true);
    expect(ev({ not: { flag: 'a' } }, x)).toBe(false);
  });
  it('flag и item — по монотонному world', () => {
    const x = ctx({}, { flags: { 'ch01.done': 5 }, items: { 'it.bilet_miesieczny': 7 } });
    expect(ev({ flag: 'ch01.done' }, x)).toBe(true);
    expect(ev({ flag: 'ch02.done' }, x)).toBe(false);
    expect(ev({ item: 'it.bilet_miesieczny' }, x)).toBe(true);
    expect(ev({ item: 'it.klucz' }, x)).toBe(false);
  });
  it('lessonDone и bossPassed', () => {
    const x = ctx({ lessonsDone: new Set(['ch01.s11']), bossResults: { 'ch01.boss': { best: 0.9, attempts: 1, passedAt: T0 }, 'ch02.boss': { best: 0.5, attempts: 2 } } });
    expect(ev({ lessonDone: 'ch01.s11' }, x)).toBe(true);
    expect(ev({ lessonDone: 'ch01.s12' }, x)).toBe(false);
    expect(ev({ bossPassed: 'ch01.boss' }, x)).toBe(true);
    expect(ev({ bossPassed: 'ch02.boss' }, x)).toBe(false);
  });
  it('mastery: seen = есть карточка, mastered = rec.interval ≥ 7 и lastGrade ≥ 2', () => {
    const cards = { 'lx.a#rec': card(7), 'lx.b#lis': card(1), 'lx.c#rec': card(16, { lastGrade: 1 }) };
    const x = ctx({ cards }, {}, { moduleItems: (m) => (m === 'mod' ? ['lx.a', 'lx.b', 'lx.c', 'lx.d'] : []) });
    expect(masteryShare(x, 'mod', 'seen')).toBe(0.75);
    expect(masteryShare(x, 'mod', 'mastered')).toBe(0.25);
    expect(ev({ mastery: { module: 'mod', level: 'seen', min: 0.5 } }, x)).toBe(true);
    expect(ev({ mastery: { module: 'mod', level: 'mastered', min: 0.5 } }, x)).toBe(false);
    expect(ev({ mastery: { module: 'other', level: 'seen', min: 0 } }, x)).toBe(true); // 0 ≥ 0
    expect(ev({ mastery: { module: 'other', level: 'seen', min: 0.1 } }, x)).toBe(false);
  });
  it('cards: карточек с interval ≥ minInterval не меньше min (пары не в счёт)', () => {
    const x = ctx({ cards: { 'lx.a#rec': card(35), 'lx.a#lis': card(40), 'lx.b#rec': card(16), 'mp.x#pair': card(90) } });
    expect(ev({ cards: { minInterval: 35, min: 2 } }, x)).toBe(true);
    expect(ev({ cards: { minInterval: 35, min: 3 } }, x)).toBe(false);
  });
  it('cluster: текущий статус, нет данных = unknown', () => {
    const x = ctx({ clusterStatus: { R3: 'red' } as Record<string, ClusterStatus> });
    expect(ev({ cluster: { id: 'R3', status: 'red' } }, x)).toBe(true);
    expect(ev({ cluster: { id: 'R3', status: 'green' } }, x)).toBe(false);
    expect(ev({ cluster: { id: 'R4', status: 'unknown' } }, x)).toBe(true);
  });
  it('daysPlayed ≥ N', () => {
    expect(ev({ daysPlayed: 5 }, ctx({ daysPlayed: 5 }))).toBe(true);
    expect(ev({ daysPlayed: 5 }, ctx({ daysPlayed: 4 }))).toBe(false);
  });
  it('dateWindow: в окне, в том числе через Новый год', () => {
    expect(ev({ dateWindow: { from: '10-01', to: '10-20' } }, ctx())).toBe(true);
    expect(ev({ dateWindow: { from: '10-15', to: '11-03' } }, ctx())).toBe(false);
    expect(inDateWindow('2026-12-30', '12-20', '01-06')).toBe(true);
    expect(inDateWindow('2027-01-03', '12-20', '01-06')).toBe(true);
    expect(inDateWindow('2027-01-07', '12-20', '01-06')).toBe(false);
  });
  it('weekday: ISO-день игрового дня (14.10.2026 — среда, 3)', () => {
    expect(ev({ weekday: [3] }, ctx())).toBe(true);
    expect(ev({ weekday: [7] }, ctx())).toBe(false);
    expect(ev({ weekday: [7] }, ctx({ today: '2026-10-18' }))).toBe(true);
  });
  it('stage: стадия биома ≥ min, нет записи = 0', () => {
    const x = ctx({}, { unlocked: { praga: { stage: 2, at: T0 } } });
    expect(ev({ stage: { biome: 'praga', min: 2 } }, x)).toBe(true);
    expect(ev({ stage: { biome: 'praga', min: 3 } }, x)).toBe(false);
    expect(ev({ stage: { biome: 'mazury', min: 0 } }, x)).toBe(true);
    expect(ev({ stage: { biome: 'mazury', min: 1 } }, x)).toBe(false);
  });
  it('found: секрет найден хоть раз', () => {
    expect(ev({ found: 'simba' }, ctx({ found: new Set(['simba']) }))).toBe(true);
    expect(ev({ found: 'simba' }, ctx())).toBe(false);
  });
  it('jars: зрелые rec (maxInterval ≥ порога), фильтр по модулю; derived.jars важнее', () => {
    const cards = { 'lx.a#rec': card(16, { maxInterval: 35 }), 'lx.b#rec': card(40), 'lx.c#rec': card(16), 'lx.c#lis': card(90) };
    const x = ctx({ cards }, {}, { itemModule: (i) => (i === 'lx.a' ? 'ch01' : 'ch02'), jarFrom: 35 });
    expect(jarCount(x)).toBe(2);
    expect(ev({ jars: { min: 2 } }, x)).toBe(true);
    expect(ev({ jars: { min: 3 } }, x)).toBe(false);
    expect(ev({ jars: { min: 1, module: 'ch01' } }, x)).toBe(true);
    expect(ev({ jars: { min: 2, module: 'ch01' } }, x)).toBe(false);
    const y = ctx({ jars: { 'lx.a': { matured: true, full: false }, 'lx.b': { matured: true, full: true } } });
    expect(ev({ jars: { min: 2 } }, y)).toBe(true);
    expect(ev({ jars: { min: 2, full: true } }, y)).toBe(false);
  });
  it('hud: элемент раскрыт = флаг hud.<element>', () => {
    const x = ctx({}, { flags: { 'hud.obchod': 1 } });
    expect(ev({ hud: 'obchod' }, x)).toBe(true);
    expect(ev({ hud: 'orders' }, x)).toBe(false);
  });
  it('daysSinceLast: ≥ N, никогда не играл — ложно', () => {
    expect(ev({ daysSinceLast: 7 }, ctx({ daysSinceLast: 8 }))).toBe(true);
    expect(ev({ daysSinceLast: 7 }, ctx({ daysSinceLast: 6 }))).toBe(false);
    expect(ev({ daysSinceLast: 0 }, ctx({ daysSinceLast: null }))).toBe(false);
  });
  it('stepDone: отрезок сегодня завершён; экспресс закрывает полив', () => {
    const days = { '2026-10-14': { segs: ['express', 'scene'] as never, revs: 3, lessons: 1 }, '2026-10-13': { segs: ['evening'] as never, revs: 0, lessons: 0 } };
    const x = ctx({ days });
    expect(ev({ stepDone: 'water' }, x)).toBe(true);
    expect(ev({ stepDone: 'scene' }, x)).toBe(true);
    expect(ev({ stepDone: 'evening' }, x)).toBe(false); // вчерашний вечер не в счёт
    expect(ev({ stepDone: 'sleep' }, x)).toBe(false);
  });
  it('неизвестный атом ложен и попадает в onUnknown', () => {
    const seen: unknown[] = [];
    expect(evaluate({ streakDays: 3 } as unknown as Condition, ctx({}, {}, { onUnknown: (c) => seen.push(c) }))).toBe(false);
    expect(seen).toHaveLength(1);
  });
});

describe('из журнала: derive → condCtx на реальном контенте', () => {
  const content = getContent();
  function log(drafts: EventDraft[]): Progress {
    let p = newProgress(T0 - DAY, 'w1');
    let seq = 0;
    for (const d of drafts) {
      const r = append(p, { deviceId: 'dev001', seq }, d);
      if (!r.ok) throw new Error('append');
      p = r.progress;
      seq = r.dev.seq;
    }
    return p;
  }
  it('lessonDone и stepDone из событий, mastery ch01 seen растёт с intro', () => {
    const p = log([
      { k: 'lesson', ts: T0, lesson: 'ch01.s11', score: 0.9, firstTry: 0.9, ms: 1000, passed: true, answers: 10 },
      { k: 'seg', ts: T0, seg: 'scene' },
      { k: 'intro', ts: T0, item: 'lx.woda', lesson: 'ch01.s01', ok: ['rec'] },
    ]);
    const d = derive(p, deriveContent(content), T0 + 60_000, TZ);
    const x = condCtx(content, d, p.world, T0 + 60_000);
    expect(evaluate({ lessonDone: 'ch01.s11' }, x)).toBe(true);
    expect(evaluate({ stepDone: 'scene' }, x)).toBe(true);
    expect(masteryShare(x, 'ch01', 'seen')).toBeGreaterThan(0);
    expect(evaluate({ mastery: { module: 'ch01', level: 'mastered', min: 0.01 } }, x)).toBe(false);
  });
});

describe('варианты уроков (§3.5, §4.3): requires / skipIf / short', () => {
  const content = getContent();
  const withStatus = (s: Record<string, ClusterStatus>): CondCtx => ctx({ clusterStatus: s });
  const repairs = [...content.lessons.values()].map((x) => x.value).filter((l) => l.kind === 'repair');

  it('ремонтные сцены 1.1–1.10: вариант совпадает с repairVariant статуса кластера', () => {
    expect(repairs.length).toBe(10);
    const cl = content.phonetics.clusters;
    for (const l of repairs) {
      const c = cl.find((x) => x.repairLesson === l.id)!.id;
      for (const st of ['unknown', 'green', 'yellow', 'red'] as const) expect([l.id, st, lessonVariant(l, withStatus({ [c]: st }))]).toEqual([l.id, st, repairVariant(st)]);
    }
  });
  it('short оставляет только short.steps и сохраняет id шагов (озвучка)', () => {
    const l = content.lessons.get('ch01.s03')!.value;
    const short = lessonOfVariant(l, 'short')!;
    expect(short.steps!.length).toBe(l.short!.steps.length);
    expect(short.steps![0]!.id).toBe(`ch01.s03#${l.short!.steps[0]}`);
    expect(lessonOfVariant(l, 'full')).toBe(l);
    expect(lessonOfVariant(l, 'skip')).toBeNull();
    expect(lessonOfVariant(l, 'locked')).toBeNull();
  });
  it('requires босса: закрыт, пока не сданы 1.11, 1.12, 1.12r', () => {
    const boss = content.lessons.get('ch01.boss')!.value;
    expect(lessonVariant(boss, ctx())).toBe('locked');
    expect(lessonVariant(boss, ctx({ lessonsDone: new Set(['ch01.s11', 'ch01.s12', 'ch01.s12r']) }))).toBe('full');
  });
});
