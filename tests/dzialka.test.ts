// Działka (I-12, ТЗ §4.10, §5.5): стадии растений по интервалу rec, «!» и подвявшие по due, банка при
// зрелости, раскладка слов по грядкам и сценарий «день 0 сцена → день 1 обход → день 4 → …» (1 → 3 → 7).
import { describe, expect, it } from 'vitest';
import { derive, type DeriveContent } from '../src/systems/derive';
import type { EventDraft } from '../src/systems/log';
import { append, newProgress, type CardState, type Progress } from '../src/systems/progress';
import { cellar } from '../src/systems/garden';
import { DEFAULT_TUNING } from '../src/systems/tuning';
import { cellAt, gardenItems, jarStage, JAR_SHOW_DAYS, layoutPlots, pickPlants, plantStage, plotsOf, worldMarks, type GardenItem } from '../src/world/dzialka';

const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 5, 8); // 10:00 в Варшаве, игровой день 2026-10-05
const dc: DeriveContent = { tuning: DEFAULT_TUNING, dayStartHour: 4 };

function card(p: Partial<CardState>): CardState {
  return { reps: 0, interval: 0, ef: 2.5, due: T0, lapses: 0, lastReviewAt: T0, lastGrade: 0, maxInterval: 0, createdAt: T0, ...p };
}

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
const rev = (c: string, ts: number, g: 0 | 1 | 2 | 3 = 2): EventDraft => ({ k: 'rev', ts, card: c, g, ms: 1500, src: 'obchod' });
const dz = (n: number, h = 10): number => T0 + n * DAY + (h - 10) * 3_600_000;

describe('стадии (§4.10)', () => {
  it('семя → росток → куст → банка по интервалу rec', () => {
    expect(plantStage(undefined)).toBe('seed');
    expect(plantStage(card({}))).toBe('seed');
    expect(plantStage(card({ reps: 1, interval: 1, maxInterval: 1 }))).toBe('sprout');
    expect(plantStage(card({ reps: 2, interval: 3, maxInterval: 3 }))).toBe('sprout');
    expect(plantStage(card({ reps: 3, interval: 7, maxInterval: 7 }))).toBe('bush');
    expect(plantStage(card({ reps: 4, interval: 16, maxInterval: 16 }))).toBe('bush');
    expect(plantStage(card({ reps: 5, interval: 35, maxInterval: 35 }))).toBe('jar');
  });

  it('банка монотонна: ошибка после зрелости не откатывает банку', () => {
    expect(plantStage(card({ reps: 0, interval: 0, maxInterval: 40, lapses: 1 }))).toBe('jar');
  });

  it('стадия банки по maxInterval: 35 młody, 90 dojrzały, 180 stary', () => {
    expect(jarStage(34)).toBeNull();
    expect(jarStage(35, DEFAULT_TUNING)).toBe('mlody');
    expect(jarStage(90, DEFAULT_TUNING)).toBe('dojrzaly');
    expect(jarStage(200, DEFAULT_TUNING)).toBe('stary');
  });
});

describe('due, «!» и подвявшие', () => {
  it('день 0 — посажено, без «!»; день 1 — «!» с карточкой полива', () => {
    const p = log([intro('lx.kawa')]);
    const d0 = derive(p, dc, dz(0, 20), TZ);
    expect(gardenItems(d0, dz(0, 20), DEFAULT_TUNING)[0]).toMatchObject({ item: 'lx.kawa', stage: 'sprout', interval: 1, dueCard: null, wilted: false });
    const d1 = derive(p, dc, dz(1), TZ);
    const g = gardenItems(d1, dz(1), DEFAULT_TUNING)[0]!;
    expect(g.dueCard).toBe('lx.kawa#rec'); // rec и lis due, первым узнавание
    expect(g.wilted).toBe(false);
  });

  it('до 04:00 игровой день ещё вчерашний: «!» появляется с 04:00', () => {
    const p = log([intro('lx.kawa')]);
    const night = Date.UTC(2026, 9, 6, 1); // 03:00 в Варшаве
    expect(gardenItems(derive(p, dc, night, TZ), night)[0]!.dueCard).toBeNull();
    const morning = Date.UTC(2026, 9, 6, 2, 30); // 04:30
    expect(gardenItems(derive(p, dc, morning, TZ), morning)[0]!.dueCard).not.toBeNull();
  });

  it('просрочено больше 2 суток → подвявшее', () => {
    const p = log([intro('lx.kawa')]);
    expect(gardenItems(derive(p, dc, dz(3), TZ), dz(3))[0]!.wilted).toBe(false);
    const g = gardenItems(derive(p, dc, dz(4), TZ), dz(4))[0]!;
    expect(g.wilted).toBe(true);
    expect(g.overdueDays).toBe(3);
  });

  it('братья: полили rec — у слова нет «!» до завтра, хотя lis тоже due', () => {
    const p = log([intro('lx.kawa'), rev('lx.kawa#rec', dz(1))]);
    const d = derive(p, dc, dz(1, 11), TZ);
    expect(d.cards['lx.kawa#lis']!.due).toBeLessThanOrEqual(dz(1, 11));
    expect(gardenItems(d, dz(1, 11))[0]!.dueCard).toBeNull();
  });

  it('фонетические карточки pair на грядку не попадают', () => {
    const d = { cards: { 'mp.a_b#pair': card({}) }, todayStart: T0 - 6 * 3_600_000 };
    expect(gardenItems(d, T0)).toEqual([]);
  });
});

describe('сценарий «день 0 сцена → день 1 обход → …»: интервалы 1 → 3 → 7 на грядке', () => {
  it('стадия и интервал клетки растут после поливов', () => {
    const map = { id: 'demo.ogrod', objects: [{ type: 'plot' as const, id: 'grzadki', at: [1, 1] as [number, number], size: [4, 2] as [number, number] }] };
    const drafts: EventDraft[] = [intro('lx.kawa')];
    const view = (n: number, h = 10) => {
      const now = dz(n, h);
      const d = derive(log(drafts), dc, now, TZ);
      return worldMarks(map, d, now, DEFAULT_TUNING).plots[0]!.cells[0]!;
    };
    expect(view(0, 20)).toMatchObject({ item: 'lx.kawa', stage: 'sprout', interval: 1, due: false });
    expect(view(1)).toMatchObject({ stage: 'sprout', interval: 1, due: true });
    drafts.push(rev('lx.kawa#rec', dz(1)));
    expect(view(1, 11)).toMatchObject({ stage: 'sprout', interval: 3, due: false });
    expect(view(2).due).toBe(true); // lis (reps 1, interval 1) ждёт полива на следующий день
    drafts.push(rev('lx.kawa#lis', dz(2)));
    expect(view(3).due).toBe(false);
    expect(view(4)).toMatchObject({ interval: 3, due: true });
    drafts.push(rev('lx.kawa#rec', dz(4)));
    expect(view(4, 11)).toMatchObject({ stage: 'bush', interval: 7, due: false });
  });
});

describe('раскладка по грядкам', () => {
  const g = (item: string, o: Partial<GardenItem> = {}): GardenItem => ({
    item,
    stage: 'sprout',
    interval: 1,
    dueCard: null,
    overdueDays: 0,
    wilted: false,
    nextDue: T0 + DAY,
    plantedAt: T0,
    lastReviewAt: T0,
    jar: null,
    ...o,
  });

  it('пустые клетки, порядок посадки, построчно', () => {
    const plots = [{ id: 'grzadki', at: [2, 2] as [number, number], size: [3, 2] as [number, number] }];
    const v = layoutPlots(plots, [g('lx.b', { plantedAt: T0 + 5 }), g('lx.a', { plantedAt: T0 + 1 })], T0)[0]!;
    expect(v.cells.map((c) => c.at)).toEqual([[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]]);
    expect(v.cells.map((c) => c.item ?? '-')).toEqual(['lx.a', 'lx.b', '-', '-', '-', '-']);
    expect(v.cells[2]!.stage).toBe('empty');
  });

  it('слов больше клеток: сначала due, потом недавно политые; клетки по порядку посадки', () => {
    const items = [
      g('lx.old', { plantedAt: 1, lastReviewAt: 10 }),
      g('lx.due', { plantedAt: 2, dueCard: 'lx.due#rec' }),
      g('lx.fresh', { plantedAt: 3, lastReviewAt: 50 }),
    ];
    expect(pickPlants(items, 2, T0).map((x) => x.item)).toEqual(['lx.due', 'lx.fresh']);
  });

  it('полили — растение остаётся на своей клетке (слов не больше клеток)', () => {
    const plots = [{ id: 'p', at: [0, 0] as [number, number], size: [2, 1] as [number, number] }];
    const before = layoutPlots(plots, [g('lx.a', { plantedAt: 1, dueCard: 'lx.a#rec' }), g('lx.b', { plantedAt: 2 })], T0)[0]!;
    const after = layoutPlots(plots, [g('lx.a', { plantedAt: 1, lastReviewAt: T0 + 5 }), g('lx.b', { plantedAt: 2 })], T0)[0]!;
    expect(before.cells[0]!.item).toBe('lx.a');
    expect(after.cells[0]!.item).toBe('lx.a');
    expect(before.cells[0]!.due).toBe(true);
    expect(after.cells[0]!.due).toBe(false);
  });

  it('старая банка без полива уходит в подвал, свежая стоит на грядке', () => {
    const items = [
      g('lx.jar_old', { stage: 'jar', jar: 'mlody', lastReviewAt: T0 - (JAR_SHOW_DAYS + 1) * DAY }),
      g('lx.jar_new', { stage: 'jar', jar: 'mlody', lastReviewAt: T0 - DAY }),
    ];
    expect(pickPlants(items, 5, T0).map((x) => x.item)).toEqual(['lx.jar_new']);
    expect(cellar(items).map((x) => x.item).sort()).toEqual(['lx.jar_new', 'lx.jar_old']);
  });

  it('plotsOf, cellAt, dueItems для «!» над словами', () => {
    const map = {
      id: 'x',
      objects: [
        { type: 'plot' as const, id: 'a', at: [1, 1] as [number, number], size: [2, 1] as [number, number] },
        { type: 'npc' as const, id: 'bobr', at: [5, 5] as [number, number] },
      ],
    };
    expect(plotsOf(map)).toEqual([{ id: 'a', at: [1, 1], size: [2, 1] }]);
    const p = log([intro('lx.kawa'), intro('lx.stol', T0 + 1000)]);
    const m = worldMarks(map, derive(p, dc, dz(1), TZ), dz(1), DEFAULT_TUNING);
    expect(m.dueItems.sort()).toEqual(['lx.kawa', 'lx.stol']);
    expect(cellAt(m.plots, [2, 1])?.item).toBe('lx.stol');
    expect(cellAt(m.plots, [9, 9])).toBeUndefined();
  });
});
