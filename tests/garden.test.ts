import { describe, expect, it } from 'vitest';
import { PHRASES, WORDS, WORD_BY_ID, PHRASE_BY_ID } from '../src/systems/content';
import {
  DAY_MS,
  PLOT_CELLS,
  TIER_CAP,
  XP,
  applyAnswer,
  dayOf,
  derive,
  levelOf,
  newGarden,
  nextText,
  normalizeGarden,
  pickTask,
  plant,
  stageOf,
  statusOf,
  syncSlots,
  type AnswerEntry,
  type GardenSave,
} from '../src/systems/garden';
import { distractors, grade, makeQuestion } from '../src/systems/quiz';
import type { GameMode } from '../src/types/farm';
import { seeded } from './helpers';

const T0 = Date.UTC(2026, 9, 17, 10, 0);
const D = (n: number, h = 0): number => T0 + n * DAY_MS + h * 3_600_000;

function garden(ids: string[], t = T0): GardenSave {
  const g = newGarden();
  return syncSlots(plant(g, derive(g), ids, t).save, derive(plant(g, derive(g), ids, t).save), t);
}

function answer(g: GardenSave, id: string, t: number, mode: GameMode, ok = true): GardenSave {
  const e: AnswerEntry = { t, day: dayOf(t), id, side: mode === 1 || mode === 4 ? 'pr' : 'rp', ok, mode };
  const next = { ...g, log: [...g.log, e] };
  return syncSlots(next, derive(next), t);
}

const stage = (g: GardenSave, id: string, now: number) => stageOf(derive(g).items.get(id)!, now);

describe('рост', () => {
  it('семя → росток за 2 верных, ошибка снимает каплю, но не стадию', () => {
    let g = garden(['w.kot']);
    expect(stage(g, 'w.kot', T0)).toBe('seed');
    g = answer(g, 'w.kot', T0 + 1, 1);
    g = answer(g, 'w.kot', T0 + 2, 1, false);
    expect(derive(g).items.get('w.kot')!.drops).toBe(0);
    expect(stage(g, 'w.kot', T0)).toBe('seed');
    g = answer(g, 'w.kot', T0 + 3, 1);
    g = answer(g, 'w.kot', T0 + 4, 1);
    expect(stage(g, 'w.kot', T0)).toBe('sprout');
    g = answer(g, 'w.kot', T0 + 5, 1, false);
    g = answer(g, 'w.kot', T0 + 6, 2, false);
    expect(stage(g, 'w.kot', T0)).toBe('sprout');
  });

  it('куст — верно в обе стороны', () => {
    let g = garden(['w.kot']);
    for (let i = 1; i <= 4; i++) g = answer(g, 'w.kot', T0 + i, 1);
    expect(stage(g, 'w.kot', T0)).toBe('sprout');
    g = answer(g, 'w.kot', T0 + 5, 2);
    expect(stage(g, 'w.kot', T0)).toBe('bush');
  });

  it('нельзя созреть за один календарный день: урожай только на 3-й разный день', () => {
    let g = garden(['w.kot']);
    for (let i = 1; i <= 30; i++) g = answer(g, 'w.kot', T0 + i * 1000, (i % 2 ? 1 : 2) as GameMode);
    expect(stage(g, 'w.kot', T0)).toBe('bush');
    g = answer(g, 'w.kot', D(1), 1);
    expect(stage(g, 'w.kot', D(1))).toBe('bush');
    expect(nextText(derive(g).items.get('w.kot'), D(1))).toMatch(/1 другой день/);
    g = answer(g, 'w.kot', D(2), 1);
    expect(derive(g).items.get('w.kot')!.stage).toBeNull();
    expect(statusOf(derive(g), g, 'w.kot', D(2))).toBe('grown');
    expect(g.slots['w.kot']).toBeUndefined();
  });

  it('урожай требует хотя бы один верный ответ на польский', () => {
    // pr три дня, но rp ни разу → дальше ростка не идёт.
    let g = garden(['w.kot']);
    for (const d of [0, 1, 2, 3]) for (let i = 0; i < 3; i++) g = answer(g, 'w.kot', D(d, i + 1), 1);
    expect(stage(g, 'w.kot', D(3))).toBe('sprout');
  });

  it('опыт: +1 верный, +3 стадия, +10 урожай слова, +25 фразы', () => {
    let g = garden(['w.kot']);
    g = answer(g, 'w.kot', T0 + 1, 1);
    expect(derive(g).xp).toBe(1);
    g = answer(g, 'w.kot', T0 + 2, 1);
    expect(derive(g).xp).toBe(2 + XP.stage);
    const st = derive(garden(['p.dzien_dobry']));
    st.items.get('p.dzien_dobry')!.stage = 'bush';
    st.items.get('p.dzien_dobry')!.days = new Set([dayOf(D(0)), dayOf(D(1))]);
    st.items.get('p.dzien_dobry')!.rpOk = true;
    const o = applyAnswer(st, { t: D(2), day: dayOf(D(2)), id: 'p.dzien_dobry', side: 'pr', ok: true, mode: 4 });
    expect(o).toMatchObject({ kind: 'harvest', xp: XP.correct + XP.phrase });
  });

  it('перезревание через 7, 21, 60 дней; один верный — обратно в банку', () => {
    let g = garden(['w.kot']);
    g = answer(g, 'w.kot', T0 + 1, 1);
    g = answer(g, 'w.kot', T0 + 2, 1);
    g = answer(g, 'w.kot', T0 + 3, 2);
    g = answer(g, 'w.kot', D(1), 1);
    g = answer(g, 'w.kot', D(2), 2);
    const h = D(2);
    expect(stage(g, 'w.kot', h + 6 * DAY_MS)).toBeNull();
    expect(stage(g, 'w.kot', h + 7 * DAY_MS)).toBe('overripe');
    g = syncSlots(g, derive(g), h + 7 * DAY_MS);
    expect(g.slots['w.kot']).toBe(0);
    expect(statusOf(derive(g), g, 'w.kot', h + 7 * DAY_MS)).toBe('growing');
    expect(pickTask(g, derive(g), 1, h + 7 * DAY_MS, dayOf(h + 7 * DAY_MS))).toBe('w.kot');
    g = answer(g, 'w.kot', h + 7 * DAY_MS, 1, false);
    expect(stage(g, 'w.kot', h + 7 * DAY_MS)).toBe('overripe');
    const t2 = h + 7 * DAY_MS + 1;
    g = answer(g, 'w.kot', t2, 1);
    expect(stage(g, 'w.kot', t2)).toBeNull();
    expect(g.slots['w.kot']).toBeUndefined();
    expect(stage(g, 'w.kot', t2 + 20 * DAY_MS)).toBeNull();
    expect(stage(g, 'w.kot', t2 + 21 * DAY_MS)).toBe('overripe');
    g = answer(g, 'w.kot', t2 + 21 * DAY_MS, 2);
    expect(stage(g, 'w.kot', t2 + 21 * DAY_MS + 59 * DAY_MS)).toBeNull();
    expect(stage(g, 'w.kot', t2 + 21 * DAY_MS + 60 * DAY_MS)).toBe('overripe');
  });
});

describe('грядки', () => {
  it('24 грядки, потом резерв 10×6, потом ряды и второй участок; дальше мешок', () => {
    expect(TIER_CAP).toEqual([24, 60, 80, 120]);
    expect(PLOT_CELLS.length).toBe(120);
    expect(PLOT_CELLS[0]).toEqual([12, 14]);
    const ids = WORDS.slice(0, 30).map((w) => w.id);
    let g = garden(ids.slice(0, 24));
    expect(g.tier).toBe(0);
    expect(Object.keys(g.slots).length).toBe(24);
    g = syncSlots(plant(g, derive(g), ids.slice(24), T0).save, derive(plant(g, derive(g), ids.slice(24), T0).save), T0);
    expect(g.tier).toBe(1);
    expect(Object.keys(g.slots).length).toBe(30);
    const all = WORDS.slice(0, 130).map((w) => w.id);
    const big = garden(all);
    expect(big.tier).toBe(3);
    expect(Object.keys(big.slots).length).toBe(120);
    expect(statusOf(derive(big), big, all[125]!, T0)).toBe('bag');
    expect(statusOf(derive(big), big, all[0]!, T0)).toBe('growing');
  });

  it('посадка повторно не дублирует; урожай освобождает грядку, мешок занимает её', () => {
    let g = garden(['w.kot', 'w.pies']);
    const r = plant(g, derive(g), ['w.kot', 'w.dom'], T0);
    expect(r.added).toEqual(['w.dom']);
    g = syncSlots(r.save, derive(r.save), T0);
    expect(g.slots).toEqual({ 'w.kot': 0, 'w.pies': 1, 'w.dom': 2 });
  });
});

describe('выбор задания', () => {
  it('только посаженное на грядках, нужного вида; приоритет: ближе к урожаю, новые в конце, подряд не повторяет', () => {
    let g = garden(['w.kot', 'w.pies', 'w.dom', 'p.dzien_dobry']);
    expect(pickTask(g, derive(g), 3, T0, dayOf(T0))).toBe('p.dzien_dobry');
    g = answer(g, 'w.pies', T0 + 1, 1);
    expect(pickTask(g, derive(g), 1, T0 + 2, dayOf(T0))).toBe('w.pies');
    expect(pickTask(g, derive(g), 1, T0 + 2, dayOf(T0), 'w.pies')).toBe('w.kot');
    expect(pickTask(newGarden(), derive(newGarden()), 1, T0, 0)).toBeNull();
  });
});

describe('уровень', () => {
  it('A0 → A0.5 (400) → A0.8 (800) → A1 (вся база)', () => {
    expect(levelOf(0, 0, 1167, 398)).toEqual({ level: 'A0', ratio: 0 });
    expect(levelOf(200, 0, 1167, 398).ratio).toBeCloseTo(0.5);
    expect(levelOf(400, 0, 1167, 398).level).toBe('A0.5');
    expect(levelOf(800, 10, 1167, 398).level).toBe('A0.8');
    expect(levelOf(1167, 397, 1167, 398).level).toBe('A0.8');
    expect(levelOf(1167, 398, 1167, 398)).toEqual({ level: 'A1', ratio: 1 });
  });
});

describe('задания', () => {
  const db = { word: (id: string) => WORD_BY_ID.get(id), phrase: (id: string) => PHRASE_BY_ID.get(id), words: WORDS };
  it('PL→RU: 4 разных варианта, правильный среди них, отвлекающие из той же темы', () => {
    const w = WORDS.find((x) => x.topic === 'jedzenie' && x.pos === 'noun')!;
    const q = makeQuestion(1, w.id, db, seeded(3))!;
    expect(q.kind).toBe('choice');
    if (q.kind !== 'choice') return;
    expect(new Set(q.options).size).toBe(4);
    expect(q.options).toContain(w.ru);
    const ds = distractors(w, WORDS, 'ru', seeded(4));
    for (const d of ds) expect(WORDS.find((x) => x.ru === d)!.topic).toBe('jedzenie');
    expect(grade(q, w.ru).ok).toBe(true);
    expect(grade(q, q.options.find((o) => o !== w.ru)!).ok).toBe(false);
  });
  it('RU→PL: куст — ввод с мягкой проверкой (без диакритики засчитывается)', () => {
    const w = WORD_BY_ID.get('w.dzien_dobry')!;
    const q = makeQuestion(2, w.id, db, seeded(1), true)!;
    expect(q.kind).toBe('type');
    expect(grade(q, 'dzien dobry').ok).toBe(true);
    expect(grade(q, 'do widzenia').ok).toBe(false);
  });
  it('плитки: польская и русская сборка с лишними плитками', () => {
    const p = PHRASES[0]!;
    const q3 = makeQuestion(3, p.id, db, seeded(1))!;
    const q4 = makeQuestion(4, p.id, db, seeded(1))!;
    if (q3.kind !== 'tiles' || q4.kind !== 'tiles') throw new Error('tiles');
    expect(q3.tiles.length).toBe(p.tiles_pl.length + p.distract_pl.length);
    expect(grade(q3, p.tiles_pl).ok).toBe(true);
    expect(grade(q3, [...p.tiles_pl].reverse()).ok).toBe(p.tiles_pl.length === 1);
    expect(grade(q4, p.tiles_ru).ok).toBe(true);
  });
});

describe('сохранение огорода', () => {
  it('normalizeGarden отбрасывает мусор', () => {
    const g = normalizeGarden({ planted: [{ t: 1, id: 'w.kot' }, { id: 5 }], log: [{ t: 2, day: 0, id: 'w.kot', side: 'pr', ok: true, mode: 1 }, { t: 'x' }], slots: { 'w.kot': 0, bad: 'x' }, tier: 9 });
    expect(g.planted).toHaveLength(1);
    expect(g.log).toHaveLength(1);
    expect(g.slots).toEqual({ 'w.kot': 0 });
    expect(g.tier).toBe(3);
    expect(normalizeGarden(null)).toEqual(newGarden());
  });
});

describe('выбор задания по кругу', () => {
  it('кому ответ сегодня не поможет — по давности, а не по каплям', () => {
    let g = garden(['w.kot', 'w.pies', 'w.dom']);
    let t = T0;
    for (let i = 0; i < 6; i++) for (const id of ['w.kot', 'w.pies', 'w.dom']) g = answer(g, id, ++t, 1);
    // все ростки, режим 1 им не помогает: идут по кругу
    const seen: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 6; i++) {
      const id: string = pickTask(g, derive(g), 1, t + 1, dayOf(t), last)!;
      seen.push(id);
      g = answer(g, id, ++t, 1);
      last = id;
    }
    expect(new Set(seen).size).toBe(3);
  });
});
