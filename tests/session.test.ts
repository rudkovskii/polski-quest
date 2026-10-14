// Петля дня (I-12, ТЗ §4.5, §4.8, §5.9): активное время, бюджет, отрезки и «день засчитан», лимит утра
// и экспресс, итог дня из журнала, dev-часы `?now=`.
import { describe, expect, it } from 'vitest';
import { derive, type DeriveContent } from '../src/systems/derive';
import type { EventDraft } from '../src/systems/log';
import { createClock, parseNowParam } from '../src/systems/platform/clock';
import { append, newProgress, type Progress } from '../src/systems/progress';
import {
  ACTIVE_IDLE_MS,
  activeMsAt,
  activityReset,
  activityStart,
  activityTouch,
  activityVisible,
  budget,
  dayState,
  planRound,
  retrievalSince,
  SEG_OF,
  summarizeDay,
} from '../src/systems/session';
import { DEFAULT_TUNING } from '../src/systems/tuning';

const DAY = 86_400_000;
const MIN = 60_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 5, 8); // понедельник 05.10.2026, 10:00 в Варшаве
const t = DEFAULT_TUNING;
const dc: DeriveContent = { tuning: t, dayStartHour: 4 };
const dz = (n: number, h = 10): number => T0 + n * DAY + (h - 10) * 3_600_000;

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
const intro = (item: string, ts = T0, ok: ('rec' | 'lis')[] = ['rec', 'lis']): EventDraft => ({ k: 'intro', ts, item, lesson: 'demo.s01', ok });
const rev = (card: string, ts: number, g: 0 | 1 | 2 | 3 = 2, ms = 2000): EventDraft => ({ k: 'rev', ts, card, g, ms, src: 'obchod' });
/** Карточка из тренажёра: reps — шаг лестницы 1-3-7-16-35 (interval 3 → reps 2, 16 → reps 4). */
const imp = (card: string, interval: number, due: number): EventDraft => ({ k: 'imp', ts: T0 - 5 * DAY, card, state: { reps: [1, 3, 7, 16, 35].indexOf(interval) + 1, interval, ef: 2.5, due }, from: 'trainer' });

describe('активное время (§4.8: вкладка видима и касание за последние 60 с)', () => {
  it('считает время после касания, но не дольше 60 с без новых касаний', () => {
    let a = activityStart(0);
    expect(activeMsAt(a, 10_000)).toBe(0); // касаний не было
    a = activityTouch(a, 10_000);
    expect(activeMsAt(a, 40_000)).toBe(30_000);
    expect(activeMsAt(a, 500_000)).toBe(ACTIVE_IDLE_MS);
    a = activityTouch(a, 500_000);
    expect(activeMsAt(a, 510_000)).toBe(ACTIVE_IDLE_MS + 10_000);
  });

  it('скрытая вкладка не считается, возврат сам по себе не касание', () => {
    let a = activityTouch(activityStart(0), 0);
    a = activityVisible(a, false, 20_000);
    a = activityTouch(a, 25_000); // касание в фоне не принимается
    expect(activeMsAt(a, 50_000)).toBe(20_000);
    a = activityVisible(a, true, 50_000);
    expect(activeMsAt(a, 60_000)).toBe(20_000);
    a = activityTouch(a, 60_000);
    expect(activeMsAt(a, 70_000)).toBe(30_000);
  });

  it('сброс после записи session обнуляет счётчик, но не касание', () => {
    let a = activityTouch(activityStart(0), 0);
    a = activityReset(a, 30_000);
    expect(activeMsAt(a, 40_000)).toBe(10_000);
  });

  it('мягкий потолок: 15 активных минут → предложить сон', () => {
    expect(budget(14 * MIN, t).softCap).toBe(false);
    expect(budget(15 * MIN, t)).toMatchObject({ softCap: true, targetMin: 12, softCapMin: 15 });
  });
});

describe('отрезки дня и «день засчитан»', () => {
  it('сон без дела день не засчитывает, полив — засчитывает', () => {
    const d1 = derive(log([{ k: 'seg', ts: T0, seg: 'sleep' }]), dc, dz(0, 12), TZ);
    expect(dayState(d1, t)).toMatchObject({ day: '2026-10-05', counted: false, slept: true, segs: ['sleep'] });
    const d2 = derive(log([{ k: 'seg', ts: T0, seg: SEG_OF.obchod }]), dc, dz(0, 12), TZ);
    expect(dayState(d2, t)).toMatchObject({ counted: true, slept: false, segs: ['water'] });
  });

  it('прерванная после первого отрезка сессия засчитана (экспресс тоже)', () => {
    const d = derive(log([{ k: 'seg', ts: T0, seg: 'express' }]), dc, dz(0, 12), TZ);
    expect(dayState(d, t).counted).toBe(true);
  });

  it('воскресенье и блок новых сцен при долге > 60', () => {
    const many: EventDraft[] = Array.from({ length: 61 }, (_, i) => intro(`lx.w${i}`, T0 + i));
    const sunday = dz(6); // 11.10.2026
    const d = derive(log(many), dc, sunday, TZ);
    const s = dayState(d, t);
    expect(s.sunday).toBe(true);
    expect(s.debt).toBe(122);
    expect(s.locked).toBe(true);
  });
});

describe('лимит утра и экспресс', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => intro(`lx.w${String(i).padStart(2, '0')}`, T0 + i));

  it('раунд обхода — до 15 карточек, по одной на слово', () => {
    const d = derive(log(twenty), dc, dz(1), TZ);
    const r = planRound(d, dz(1), t, { mode: 'day' });
    expect(r.cards).toHaveLength(15);
    expect(new Set(r.cards.map((c) => c.split('#')[0])).size).toBe(15);
    expect(r.debt).toBe(40);
    expect(r.maxMs).toBe(Infinity);
  });

  it('тап по растению: его карточка первой, даже если вне первых 15', () => {
    const d = derive(log(twenty), dc, dz(1), TZ);
    const plain = planRound(d, dz(1), t, { mode: 'day' });
    const outside = ['lx.w00', 'lx.w19'].find((w) => !plain.cards.some((c) => c.startsWith(`${w}#`)))!;
    const r = planRound(d, dz(1), t, { mode: 'day', fromItem: outside });
    expect(r.cards[0]!.startsWith(`${outside}#`)).toBe(true);
    expect(r.cards).toHaveLength(15);
  });

  it('экспресс: до 12 карточек и 3 минут; «ещё 3 минуты» — director.more3Min', () => {
    const d = derive(log(twenty), dc, dz(1), TZ);
    const e = planRound(d, dz(1), t, { mode: 'express' });
    expect(e.cards).toHaveLength(12);
    expect(e.maxMs).toBe(3 * MIN);
    expect(planRound(d, dz(1), t, { mode: 'express', minutes: t.director.more3Min }).maxMs).toBe(3 * MIN);
  });

  it('нет due — пустой раунд', () => {
    const d = derive(log([intro('lx.kawa')]), dc, dz(0, 12), TZ);
    expect(planRound(d, dz(0, 12), t, { mode: 'day' }).cards).toEqual([]);
  });
});

describe('итог дня (§5.9)', () => {
  it('полито, выросло, созрело, посажено, покрытие, минуты, завтра', () => {
    const p = log([
      intro('lx.kawa', dz(-1)), // вчера: rec 1, lis 1 → сегодня due
      imp('lx.stol#rec', 3, dz(-1, 4)), // росток 3 → куст 7
      imp('lx.maly#rec', 16, dz(0, 4)), // куст 16 → банка 35
      rev('lx.kawa#rec', dz(0, 11), 2, 3000),
      rev('lx.stol#rec', dz(0, 11) + 1, 2, 4000),
      rev('lx.maly#rec', dz(0, 11) + 2, 0, 5000), // ошибка: не созрело
      intro('lx.chleb', dz(0, 12)),
      { k: 'seg', ts: dz(0, 12), seg: 'water' },
    ]);
    const s = summarizeDay(p, dc, dz(0, 13), TZ);
    expect(s).toMatchObject({ day: '2026-10-05', answered: 3, watered: 2, reviewed: 3, planted: ['lx.chleb'], zloty: null, counted: true, empty: false });
    // P-10b: «выросло» — по виду на грядке: kawa маленький росток → крепкий (1 → 3 дня), stół крепкий росток → куст.
    expect(s.grew).toEqual([
      { item: 'lx.kawa', from: 'sprout', to: 'sprout_big' },
      { item: 'lx.stol', from: 'sprout_big', to: 'bush' },
    ]);
    expect(s.plants).toBe(3); // полито растений: kawa, stół, mały (как на кнопке Obchód)
    expect(s.matured).toEqual([]);
    expect(s.wasDue).toBe(5); // + ещё due: lx.kawa#lis и lx.maly#pro (открылась при импорте reps 4)
    expect(s.retrievalMs).toBe(12_000);
    // Завтра: kawa#lis и maly#pro (долг), maly#rec (g 0 → due сейчас), lx.chleb rec+lis,
    // stol#pro (открылась сегодня при reps 3, due завтра).
    expect(s.tomorrow).toBe(6);
    expect(s.tomorrowPlants).toBe(4); // kawa, mały, chleb, stół
  });

  it('созрело: куст 16 → банка при верном ответе', () => {
    const p = log([imp('lx.maly#rec', 16, dz(0, 4)), rev('lx.maly#rec', dz(0, 11), 2)]);
    const s = summarizeDay(p, dc, dz(0, 12), TZ);
    expect(s.grew).toEqual([{ item: 'lx.maly', from: 'bush', to: 'jar' }]);
    expect(s.matured).toEqual(['lx.maly']);
  });

  it('пустой день: «Сегодня ещё ничего»', () => {
    const p = log([intro('lx.kawa', dz(-1))]);
    const s = summarizeDay(p, dc, dz(0, 12), TZ);
    expect(s).toMatchObject({ empty: true, answered: 0, counted: false, wasDue: 2 });
  });

  it('вчерашние события в сегодняшний итог не попадают', () => {
    const p = log([intro('lx.kawa', dz(-2)), rev('lx.kawa#rec', dz(-1), 2)]);
    expect(summarizeDay(p, dc, dz(0, 12), TZ).answered).toBe(0);
  });

  it('retrievalSince: Σ rev.ms с начала сессии', () => {
    const p = log([intro('lx.kawa', dz(-1)), rev('lx.kawa#rec', dz(0, 9), 2, 1000), rev('lx.kawa#lis', dz(0, 11), 2, 2500)]);
    expect(retrievalSince(p.log.events, dz(0, 10))).toBe(2500);
  });
});

describe('dev-часы ?now=', () => {
  const real = Date.UTC(2026, 9, 14, 8);
  it('ISO и сдвиги +1d / -2h / +90m', () => {
    expect(parseNowParam('2026-10-14T10:00:00Z', real)).toBe(Date.UTC(2026, 9, 14, 10));
    expect(parseNowParam('+1d', real)).toBe(real + DAY);
    expect(parseNowParam(' 8d', real)).toBe(real + 8 * DAY); // «+» из адресной строки после URLSearchParams
    expect(parseNowParam('-2h', real)).toBe(real - 2 * 3_600_000);
    expect(parseNowParam('+90m', real)).toBe(real + 90 * MIN);
    expect(parseNowParam('', real)).toBeNull();
    expect(parseNowParam('завтра', real)).toBeNull();
    expect(parseNowParam(null, real)).toBeNull();
  });

  it('часы со сдвигом идут дальше', () => {
    let r = real;
    const c = createClock('+1d', () => r, () => 0);
    expect(c.now()).toBe(real + DAY);
    r += 5000;
    expect(c.now()).toBe(real + DAY + 5000);
    expect(createClock(null, () => r).offsetMs).toBe(0);
  });
});
