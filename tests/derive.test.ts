import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContent } from '../src/systems/content';
import { appendGate, derive, deriveContent, wordCards, type DeriveContent } from '../src/systems/derive';
import type { EventBody, LogEvent } from '../src/systems/log';
import { append, newProgress, type CardId, type Progress } from '../src/systems/progress';
import { dayStartOf } from '../src/systems/time';
import { DEFAULT_TUNING } from '../src/systems/tuning';
import { readContentDir } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';

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

// ───────────────────────── I-05: карточки, pro, долг, кластеры ─────────────────────────


const W = { tz: TZ };
const D0 = Date.UTC(2026, 9, 12, 8, 0); // 12.10 10:00 CEST
const H = 3_600_000;
const at = (day: string, hour: number) => dayStartOf(day, W) + (hour - 4) * H;
const ev = (id: string, ts: number, body: EventBody): LogEvent => ({ id, ts, ...body }) as LogEvent;
const withEvents = (events: LogEvent[]): Progress => ({ ...newProgress(D0, 'w'), log: { checkpoint: null, events } });
const intro = (id: string, ts: number, item: string, ok: ('rec' | 'lis')[]) => ev(id, ts, { k: 'intro', item, lesson: 'ch01.s01', ok });
const rev = (id: string, ts: number, card: CardId, g: 0 | 1 | 2 | 3, src: 'obchod' | 'order' = 'obchod', tags?: string[]) =>
  ev(id, ts, { k: 'rev', card, g, ms: 2000, src, ...(tags ? { tags } : {}) });

describe('derive: карточки из intro', () => {
  it('intro создаёт rec и lis; верный тип — reps 1, interval 1; оба due завтра 04:00', () => {
    const d = derive(withEvents([intro('a.1', D0, 'lx.kawa', ['rec'])]), {}, D0, TZ);
    expect(Object.keys(d.cards).sort()).toEqual(['lx.kawa#lis', 'lx.kawa#rec']);
    expect(d.cards['lx.kawa#rec']).toMatchObject({ reps: 1, interval: 1, due: dayStartOf('2026-10-13', W), createdAt: D0 });
    expect(d.cards['lx.kawa#lis']).toMatchObject({ reps: 0, interval: 0, due: dayStartOf('2026-10-13', W) });
    expect(d.newItemsByDay).toEqual({ '2026-10-12': 1 });
    expect(d.debt).toBe(0);
    expect(derive(withEvents([intro('a.1', D0, 'lx.kawa', ['rec'])]), {}, at('2026-10-13', 5), TZ).debt).toBe(2);
  });

  it('типы карточек из vocab: srs:false без карточек, длинная фраза без pro, cards задаёт явно', () => {
    expect(wordCards({ srs: false, pl: 'wyjście' })).toEqual([]);
    expect(wordCards({ srs: true, pl: 'kawa' })).toEqual(['rec', 'lis', 'pro']);
    expect(wordCards({ srs: true, pl: 'Poproszę kawę z mlekiem, proszę' })).toEqual(['rec', 'lis']);
    expect(wordCards({ srs: true, pl: 'kawa', cards: ['rec'] })).toEqual(['rec']);
    const c: DeriveContent = { cardsOf: (i) => (i === 'lx.znak' ? ['rec'] : []) };
    const d = derive(withEvents([intro('a.1', D0, 'lx.znak', ['rec', 'lis']), intro('a.2', D0 + 1, 'lx.nie', ['rec'])]), c, D0, TZ);
    expect(Object.keys(d.cards)).toEqual(['lx.znak#rec']);
    expect(d.newItemsByDay['2026-10-12']).toBe(1);
  });
});

describe('derive: rev, порог pro, imp', () => {
  it('pro появляется при rec.reps ≥ 3: введение + два верных повторения', () => {
    const e1 = [intro('a.1', D0, 'lx.kawa', ['rec', 'lis']), rev('a.2', at('2026-10-13', 9), 'lx.kawa#rec', 2)];
    const d1 = derive(withEvents(e1), {}, at('2026-10-13', 10), TZ);
    expect(d1.cards['lx.kawa#rec']).toMatchObject({ reps: 2, interval: 3 });
    expect(d1.cards['lx.kawa#pro']).toBeUndefined();
    const e2 = [...e1, rev('a.3', at('2026-10-16', 9), 'lx.kawa#rec', 2)];
    const d2 = derive(withEvents(e2), {}, at('2026-10-16', 10), TZ);
    expect(d2.cards['lx.kawa#rec']).toMatchObject({ reps: 3, interval: 7 });
    expect(d2.cards['lx.kawa#pro']).toMatchObject({ reps: 0, interval: 0, due: dayStartOf('2026-10-17', W) });
    // grade 1 шаг не двигает: pro не открывается
    const e3 = [...e1, rev('a.3', at('2026-10-16', 9), 'lx.kawa#rec', 1)];
    expect(derive(withEvents(e3), {}, at('2026-10-16', 10), TZ).cards['lx.kawa#pro']).toBeUndefined();
    // без pro в cards слова не открывается
    expect(derive(withEvents(e2), { cardsOf: () => ['rec', 'lis'] }, at('2026-10-16', 10), TZ).cards['lx.kawa#pro']).toBeUndefined();
  });

  it('imp затем rev: состояние тренажёра, потом шаг лестницы; reps 3 сразу открывает pro', () => {
    const due = at('2026-10-14', 4);
    const imp = ev('imp.tr_1', D0, { k: 'imp', card: 'lx.kawa#rec', state: { reps: 3, interval: 7, ef: 2.3, due }, from: 'trainer' });
    const d0 = derive(withEvents([imp]), {}, D0, TZ);
    expect(d0.cards['lx.kawa#rec']).toMatchObject({ reps: 3, interval: 7, ef: 2.3, due, maxInterval: 7 });
    expect(d0.cards['lx.kawa#pro']).toBeDefined();
    const d1 = derive(withEvents([imp, rev('a.1', at('2026-10-14', 9), 'lx.kawa#rec', 2)]), {}, at('2026-10-14', 10), TZ);
    expect(d1.cards['lx.kawa#rec']).toMatchObject({ reps: 4, interval: 16, ef: 2.3 });
    // imp по уже введённому слову не перетирает игровую историю
    const d2 = derive(withEvents([intro('a.0', D0 - 1000, 'lx.kawa', []), imp]), {}, D0, TZ);
    expect(d2.cards['lx.kawa#rec']).toMatchObject({ reps: 0 });
  });

  it('ранний rev не двигает SRS; заказ за ≤ 3 дня до due — только для зрелых', () => {
    const e = [intro('a.1', D0, 'lx.kawa', ['rec'])];
    const early = derive(withEvents([...e, rev('a.2', D0 + H, 'lx.kawa#rec', 2)]), {}, D0 + 2 * H, TZ);
    expect(early.cards['lx.kawa#rec']).toMatchObject({ reps: 1, interval: 1, lastReviewAt: D0 });
    expect(early.days['2026-10-12']!.revs).toBe(1); // в статистике есть
    const ripe = ev('imp.tr_2', D0, { k: 'imp', card: 'lx.mleko#rec', state: { reps: 6, interval: 40, ef: 2.5, due: at('2026-10-15', 4) }, from: 'trainer' });
    const young = ev('imp.tr_3', D0, { k: 'imp', card: 'lx.chleb#rec', state: { reps: 3, interval: 7, ef: 2.5, due: at('2026-10-15', 4) }, from: 'trainer' });
    const d = derive(
      withEvents([ripe, young, rev('a.3', D0 + H, 'lx.mleko#rec', 2, 'order'), rev('a.4', D0 + H, 'lx.chleb#rec', 2, 'order')]),
      {}, D0 + 2 * H, TZ,
    );
    expect(d.cards['lx.mleko#rec']!.interval).toBe(100);
    expect(d.cards['lx.chleb#rec']!.interval).toBe(7);
  });

  it('grade 0 возвращает карточку в ту же сессию: следующий ответ засчитан', () => {
    const t1 = at('2026-10-13', 9);
    const d = derive(withEvents([intro('a.1', D0, 'lx.kawa', ['rec']), rev('a.2', t1, 'lx.kawa#rec', 0), rev('a.3', t1 + 60_000, 'lx.kawa#rec', 2)]), {}, t1 + H, TZ);
    expect(d.cards['lx.kawa#rec']).toMatchObject({ reps: 1, interval: 1, lapses: 1, lastGrade: 2 });
  });

  it('rev по несуществующей карточке игнорируется', () => {
    const d = derive(withEvents([rev('a.1', D0, 'lx.nic#rec', 2), rev('a.2', D0, 'lx.kawa#pro', 2)]), {}, D0, TZ);
    expect(d.cards).toEqual({});
  });

  it('renames: старые id в intro и rev попадают в новую карточку', () => {
    const c: DeriveContent = { renames: { 'lx.stary_stol': 'lx.stol' } };
    const d = derive(withEvents([intro('a.1', D0, 'lx.stary_stol', ['rec']), rev('a.2', at('2026-10-13', 9), 'lx.stary_stol#rec', 2)]), c, at('2026-10-13', 10), TZ);
    expect(Object.keys(d.cards).sort()).toEqual(['lx.stol#lis', 'lx.stol#rec']);
    expect(d.cards['lx.stol#rec']!.reps).toBe(2);
  });

  it('checkpoint засевает карточки, опоздавшее событие (ts ≤ lastReviewAt) не применяется', () => {
    const card = { reps: 3, interval: 7, ef: 2.5, due: at('2026-10-20', 4), lapses: 0, lastReviewAt: at('2026-10-13', 9), lastGrade: 2 as const, maxInterval: 7, createdAt: D0 };
    const cp = { asOf: at('2026-10-13', 12), covers: {}, cards: { 'lx.stary_stol#rec': card }, lessons: {}, bosses: {}, days: {}, zlotyEarned: 0, zlotySpent: 0 };
    const late = rev('b.1', at('2026-10-13', 8), 'lx.stol#rec', 0);
    const p = { ...withEvents([late]), log: { checkpoint: cp, events: [late] } };
    const d = derive(p, { renames: { 'lx.stary_stol': 'lx.stol' } }, at('2026-10-14', 10), TZ);
    expect(d.cards['lx.stol#rec']).toEqual(card);
    expect(d.cards['lx.stol#pro']).toBeDefined(); // порог проверяется и для карточек из свёртки
  });
});

describe('derive: журнал двух устройств', () => {
  // iPhone (dev a) и Mac (dev b) с одной ссылкой; оба играли офлайн и потом слились.
  const iphone: LogEvent[] = [
    intro('aaaaaa.1', at('2026-10-12', 10), 'lx.kawa', ['rec', 'lis']),
    intro('aaaaaa.2', at('2026-10-12', 10) + 1, 'lx.herbata', ['rec']),
    rev('aaaaaa.3', at('2026-10-13', 8), 'lx.kawa#rec', 2),
    rev('aaaaaa.4', at('2026-10-13', 8) + 5000, 'lx.herbata#rec', 2),
    rev('aaaaaa.5', at('2026-10-16', 7), 'lx.kawa#rec', 2),
  ];
  const mac: LogEvent[] = [
    // та же сцена пройдена и на Mac: слово не вводится второй раз
    intro('bbbbbb.1', at('2026-10-12', 21), 'lx.kawa', ['rec']),
    // Mac офлайн ответил по той же due-карточке позже в тот же день: это уже ранний ответ
    rev('bbbbbb.2', at('2026-10-13', 20), 'lx.kawa#rec', 0),
    rev('bbbbbb.3', at('2026-10-13', 20) + 5000, 'lx.kawa#lis', 2),
    rev('bbbbbb.4', at('2026-10-16', 22), 'lx.herbata#rec', 3),
  ];
  const now = at('2026-10-17', 9);
  const merged = [...iphone, ...mac].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));

  it('слияние: каждая карточка учитывает только ответы в срок, слово введено один раз', () => {
    const d = derive(withEvents(merged), {}, now, TZ);
    expect(d.newItemsByDay).toEqual({ '2026-10-12': 2 });
    expect(d.cards['lx.kawa#rec']).toMatchObject({ reps: 3, interval: 7, lapses: 0 }); // grade 0 с Mac — ранний
    expect(d.cards['lx.kawa#lis']).toMatchObject({ reps: 2, interval: 3 });
    expect(d.cards['lx.kawa#pro']).toMatchObject({ due: dayStartOf('2026-10-17', W) });
    expect(d.cards['lx.herbata#rec']).toMatchObject({ reps: 3, interval: 16, lastGrade: 3 }); // 3 → прыжок на 16
    expect(d.days['2026-10-13']!.revs).toBe(4);
  });

  it('порядок журналов и перемешивание не меняют состояние', () => {
    const base = derive(withEvents(merged), {}, now, TZ);
    expect(derive(withEvents([...mac, ...iphone]), {}, now, TZ)).toEqual(base);
    for (const seed of [3, 11, 99, 2026]) expect(derive(withEvents(shuffled(merged, seed)), {}, now, TZ)).toEqual(base);
  });

  it('appendGate: append пишет те же решения, что derive применяет', () => {
    let p = withEvents(iphone.slice(0, 2));
    const d = derive(p, {}, at('2026-10-13', 8), TZ);
    const gate = appendGate(d, DEFAULT_TUNING, TZ);
    const ok = append(p, { deviceId: 'aaaaaa', seq: 2 }, { k: 'rev', ts: at('2026-10-13', 8), card: 'lx.kawa#rec', g: 2, ms: 1, src: 'obchod' }, gate);
    expect(ok.ok).toBe(true);
    p = ok.progress;
    const gate2 = appendGate(derive(p, {}, at('2026-10-13', 20), TZ), DEFAULT_TUNING, TZ);
    const early = append(p, { deviceId: 'aaaaaa', seq: 3 }, { k: 'rev', ts: at('2026-10-13', 20), card: 'lx.kawa#rec', g: 0, ms: 1, src: 'obchod' }, gate2);
    expect(!early.ok && early.rejected).toBe('early');
    const none = append(p, { deviceId: 'aaaaaa', seq: 3 }, { k: 'rev', ts: at('2026-10-13', 20), card: 'lx.kawa#pro', g: 2, ms: 1, src: 'obchod' }, gate2);
    expect(!none.ok && none.rejected).toBe('no_card');
    expect(gate2.earlyDaysOf?.('lx.kawa#rec')).toBe(0); // не зрелое: исключения заказов нет
  });
});

describe('derive: кластеры и фонетическая колода (§4.3)', () => {
  const content = deriveContent(buildContent(Object.fromEntries([...readContentDir(join(ROOT, 'tests', 'fixtures', 'content-mini')).files].map(([k, v]) => [`/content/${k}`, v]))));
  const diag = (id: string, ts: number, r3: [number, number]) => ev(id, ts, { k: 'diag', results: { R3: { ok: r3[0], n: r3[1] }, R1: { ok: 5, n: 5 } } });

  it('deriveContent из фикстуры: renames, типы карточек, кластеры слов и пар', () => {
    expect(content.renames).toEqual({ 'lx.stary_stol': 'lx.stol' });
    expect(content.cardsOf!('lx.mleko')).toEqual([]);
    expect(content.cardsOf!('lx.kawa')).toEqual(['rec', 'lis', 'pro']);
    expect(content.clustersOf!('lx.maly')).toEqual(['R3']);
    expect(content.clustersOf!('mp.lawa_lawa')).toEqual(['R3']);
    expect(content.pairsByCluster).toEqual({ R3: ['mp.lata_lata', 'mp.lawa_lawa'] });
    expect(content.repairLessons).toEqual({ R3: 'demo.s01' });
  });

  it('до диагностики unknown; diag даёт green/yellow/red; red и yellow получают pair-карточки', () => {
    expect(derive(withEvents([]), content, D0, TZ).clusterStatus).toEqual({ R3: 'unknown' });
    const red = derive(withEvents([diag('a.1', D0, [2, 5])]), content, D0, TZ);
    expect(red.clusterStatus).toEqual({ R1: 'green', R3: 'red' });
    expect(Object.keys(red.cards).sort()).toEqual(['mp.lata_lata#pair', 'mp.lawa_lawa#pair']);
    expect(red.pairCluster).toEqual({ 'mp.lata_lata#pair': 'R3', 'mp.lawa_lawa#pair': 'R3' });
    expect(red.debt).toBe(0); // фонетика в долг не входит
    expect(derive(withEvents([diag('a.1', D0, [3, 5])]), content, D0, TZ).clusterStatus.R3).toBe('yellow');
    const green = derive(withEvents([diag('a.1', D0, [5, 5])]), content, D0, TZ);
    expect(green.clusterStatus.R3).toBe('green');
    expect(green.cards).toEqual({});
  });

  it('сданный ремонт после диагностики: red → yellow', () => {
    const lesson = ev('a.2', D0 + H, { k: 'lesson', lesson: 'demo.s01', score: 0.9, firstTry: 0.8, ms: 1, passed: true, answers: 10 });
    expect(derive(withEvents([diag('a.1', D0, [1, 5]), lesson]), content, D0 + 2 * H, TZ).clusterStatus.R3).toBe('yellow');
    // ремонт до последней диагностики не считается
    expect(derive(withEvents([{ ...lesson, ts: D0 - H }, diag('a.1', D0, [1, 5])]), content, D0 + 2 * H, TZ).clusterStatus.R3).toBe('red');
  });

  it('закрытие: два дня с точностью ≥ 0.9 при ≥ 5 ответах', () => {
    const day = (d: string, pre: string, okN: number, n: number) =>
      Array.from({ length: n }, (_, i) => rev(`${pre}.${i}`, at(d, 9) + i, i % 2 ? 'mp.lata_lata#pair' : 'mp.lawa_lawa#pair', i < okN ? 2 : 0));
    const base = [diag('a.0', D0, [1, 5])];
    const one = derive(withEvents([...base, ...day('2026-10-13', 'b', 5, 5)]), content, at('2026-10-15', 9), TZ);
    expect(one.clusterStatus.R3).toBe('red');
    const two = derive(withEvents([...base, ...day('2026-10-13', 'b', 5, 5), ...day('2026-10-14', 'c', 9, 10)]), content, at('2026-10-15', 9), TZ);
    expect(two.clusterStatus.R3).toBe('green');
    const thin = derive(withEvents([...base, ...day('2026-10-13', 'b', 4, 4), ...day('2026-10-14', 'c', 4, 4)]), content, at('2026-10-15', 9), TZ);
    expect(thin.clusterStatus.R3).toBe('red'); // < 5 ответов в день
    const bad = derive(withEvents([...base, ...day('2026-10-13', 'b', 5, 5), ...day('2026-10-14', 'c', 8, 10)]), content, at('2026-10-15', 9), TZ);
    expect(bad.clusterStatus.R3).toBe('red'); // 0.8 < 0.9
  });

  it('фикстура progress_v1: R1 0.8 → yellow, R10 0.25 → red; карточки из intro/rev/imp', () => {
    const d = derive(fixture(), {}, NOW, TZ);
    expect(d.clusterStatus).toEqual({ R1: 'yellow', R10: 'red' });
    expect(Object.keys(d.cards).sort()).toEqual(['lx.czesc#lis', 'lx.czesc#rec', 'lx.dzien_dobry#lis', 'lx.dzien_dobry#rec', 'lx.kawa#pro', 'lx.kawa#rec']);
    expect(d.cards['lx.dzien_dobry#rec']).toMatchObject({ reps: 2, interval: 3 });
    expect(d.cards['lx.czesc#lis']).toMatchObject({ reps: 0, lapses: 1 });
  });
});
