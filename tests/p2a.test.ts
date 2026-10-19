// @vitest-environment happy-dom
// P2a: урожай достижим за 3 дня при посаженной теме, прогресс до урожая виден, фразы открываются от ростков.
import { describe, expect, it } from 'vitest';
import { createFarm } from '../src/systems/farm';
import {
  DAY_MS,
  canProgress,
  dayOf,
  derive,
  newGarden,
  pickTask,
  plant,
  progressText,
  ripeSoon,
  syncSlots,
  type AnswerEntry,
  type GardenSave,
} from '../src/systems/garden';
import type { Question } from '../src/systems/quiz';
import type { GameMode } from '../src/types/farm';
import { mountMinigame } from '../src/ui/minigame';
import { mountPlantCard } from '../src/ui/plantCard';
import { seeded, testBus } from './helpers';

const T0 = Date.UTC(2026, 9, 17, 9, 0);

function setup() {
  let saved: GardenSave = newGarden();
  let now = T0;
  const farm = createFarm({ bus: testBus(), load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(7) });
  return { farm, setNow: (t: number) => (now = t), now: () => now };
}

/** Посадить тему целиком (19 слов) и играть 3 календарных дня по `per` ответов с точностью ~85%. */
function play(pattern: (i: number) => GameMode, per = 20, seed = 1): number {
  const s = setup();
  const topic = s.farm.words[0]!.topic;
  const ids = s.farm.words.filter((w) => w.topic === topic).slice(0, 19).map((w) => w.id);
  expect(ids).toHaveLength(19);
  s.farm.plant(ids);
  const r = seeded(seed);
  for (let d = 0; d < 3; d++) {
    let t = T0 + d * DAY_MS;
    for (let i = 0; i < per; i++) {
      s.setNow((t += 60_000));
      const q = s.farm.next(pattern(i));
      if (!q) continue;
      s.farm.answer(q, r() < 0.85 ? q.answer : 'zzz');
    }
  }
  return s.farm.stats().grownTotal;
}

describe('P2a: очередь ведёт к урожаю', () => {
  it('19 слов, 3 дня по 20 ответов (85% верно), игры 1, 2 и 5 вперемешку → не меньше 8 урожаев', () => {
    // С 19.10 слову для урожая нужно собрать его самому в игре 5 («Собери слово»): один раз за рост, в любой день.
    for (const seed of [1, 2, 3]) {
      expect(play((i) => (i < 10 ? 1 : 5), 20, seed)).toBeGreaterThanOrEqual(8); // 10 в игре 1, потом 10 в игре 5
      expect(play((i) => ([1, 2, 5] as const)[i % 3]!, 20, seed)).toBeGreaterThanOrEqual(8); // по очереди
      expect(play((i) => (i < 7 ? 1 : i < 14 ? 2 : 5), 20, seed)).toBeGreaterThanOrEqual(7); // по раунду в каждой
    }
  });

  it('только игра 5: 19 слов, 3 дня по 20 ответов → не меньше 6 урожаев (другая сторона — сборкой «наоборот» по-русски)', () => {
    for (const seed of [1, 2, 3]) expect(play(() => 5, 20, seed)).toBeGreaterThanOrEqual(6);
  });

  it('только игры 1 и 2: урожая нет, но кусты говорят, что осталось собрать слово в игре «Собери слово»', () => {
    const s = setup();
    const ids = s.farm.words.filter((w) => w.topic === s.farm.words[0]!.topic).slice(0, 6).map((w) => w.id);
    s.farm.plant(ids);
    for (let d = 0; d < 3; d++)
      for (let i = 0; i < 20; i++) {
        s.setNow(T0 + d * DAY_MS + (i + 1) * 60_000);
        const q = s.farm.next(i % 2 ? 2 : 1)!;
        s.farm.answer(q, q.answer);
      }
    expect(s.farm.stats().grownTotal).toBe(0);
    for (const id of ids) expect(s.farm.info(id)).toMatchObject({ stage: 'bush', prod: false, next: 'Осталось: собери слово в игре «Собери слово» — и урожай' });
    expect(s.farm.counts().spell).toBe(6);
    // Одна сборка — и урожай.
    const q = s.farm.next(5)!;
    expect(s.farm.answer(q, q.answer).act.kind).toBe('harvest');
  });

  it('«наоборот»: в игре 2 — с польского выбором, не чаще каждого 3-го задания, по «Повторить» не бывает', () => {
    const s = setup();
    const ids = s.farm.words.slice(0, 6).map((w) => w.id);
    s.farm.plant(ids);
    const qs: Question[] = [];
    for (let d = 0; d < 3; d++)
      for (let i = 0; i < 20; i++) {
        s.setNow(T0 + d * DAY_MS + (i + 1) * 60_000);
        const q = s.farm.next(2);
        if (!q) break; // всё собрано
        qs.push(q);
        s.farm.answer(q, q.answer);
      }
    const rev = qs.map((q, i) => (q.reverse ? i : -1)).filter((i) => i >= 0);
    expect(rev.length).toBeGreaterThan(0);
    for (const i of rev) expect(qs[i]).toMatchObject({ mode: 1, kind: 'choice', promptLang: 'pl' });
    for (let k = 1; k < rev.length; k++) expect(rev[k]! - rev[k - 1]!).toBeGreaterThanOrEqual(3);
    for (const q of qs) if (!q.reverse) expect(q.mode).toBe(2);
    // Без игры 5 слова доходят до кустика с тремя днями и ждут сборки.
    for (const id of ids) expect(s.farm.info(id).next).toBe('Осталось: собери слово в игре «Собери слово» — и урожай');
    // Росток без «с польского»: по «Повторить» (only) — без подмены.
    const t = setup();
    t.farm.plant(['w.kot']);
    for (let i = 0; i < 2; i++) {
      const q = t.farm.next(2, 'w.kot')!;
      t.farm.answer(q, q.answer);
    }
    // P3a: в первые 10 ответов «наоборот» не бывает.
    expect(t.farm.next(2)!.reverse).toBeUndefined();
    for (let i = 0; i < 8; i++) {
      const q = t.farm.next(2, 'w.kot')!;
      t.farm.answer(q, q.answer);
    }
    expect(t.farm.next(2, 'w.kot')).toMatchObject({ mode: 2 });
    expect(t.farm.next(2, 'w.kot')!.reverse).toBeUndefined();
    expect(t.farm.next(2)).toMatchObject({ mode: 1, reverse: true });
  });

  it('одно слово, 3 дня по 2 ответа в разные стороны → урожай', () => {
    const s = setup();
    const id = s.farm.words[0]!.id;
    s.farm.plant([id]);
    const kinds: string[] = [];
    for (let d = 0; d < 3; d++) {
      for (const m of [1, 5] as const) {
        s.setNow(T0 + d * DAY_MS + m * 60_000);
        const q = s.farm.next(m)!;
        if (s.farm.info(id).status === 'grown') break;
        kinds.push(s.farm.answer(q, q.answer).act.kind);
      }
    }
    expect(kinds).toContain('harvest');
    expect(s.farm.info(id).status).toBe('grown');
  });

  const answer = (g: GardenSave, id: string, t: number, mode: GameMode, ok = true): GardenSave => {
    const e: AnswerEntry = { t, day: dayOf(t), id, side: mode === 1 || mode === 4 ? 'pr' : 'rp', ok, mode };
    const next = { ...g, log: [...g.log, e] };
    return syncSlots(next, derive(next), t);
  };
  const garden = (ids: string[]): GardenSave => {
    const g = newGarden();
    const p = plant(g, derive(g), ids, T0).save;
    return syncSlots(p, derive(p), T0);
  };

  it('порядок: урожай сейчас → нет зачёта дня → не хватает стороны → остальное', () => {
    const [a, b, c, d] = ['w.kot', 'w.pies', 'w.dom', 'w.mama'];
    let g = garden([a!, b!, c!, d!]);
    // a: день 1 — росток в обе стороны, день 2 — куст; b: день 1 — один ответ с польского; c, d — не трогали.
    g = answer(answer(g, a!, T0 + 1, 1), a!, T0 + 2, 2);
    g = answer(g, b!, T0 + 3, 1);
    g = answer(g, a!, T0 + DAY_MS, 1);
    const day2 = dayOf(T0 + DAY_MS);
    // День 2: у b нет зачёта дня (рост начат вчера) — он раньше новых c и d.
    expect(pickTask(g, derive(g), 2, T0 + DAY_MS + 5, day2)).toBe(b);
    // День 3: a созреет одним ответом — первым, даже если b тоже без зачёта дня.
    const t3 = T0 + 2 * DAY_MS;
    expect(pickTask(g, derive(g), 1, t3, dayOf(t3))).toBe(a);
    // В игре 2 слово без ответа «по-польски» идёт раньше новых; в игре 1 оно идёт обычным порядком.
    let h = garden([a!, b!, c!]);
    h = answer(answer(h, a!, T0 + 1, 2), b!, T0 + 2, 1);
    expect(pickTask(h, derive(h), 2, T0 + 3, dayOf(T0), { recent: [] })).toBe(b);
    expect(pickTask(h, derive(h), 1, T0 + 3, dayOf(T0), { recent: [] })).toBe(a);
  });

  it('росток, у которого обе стороны уже есть, растёт от ответа в любую сторону', () => {
    let g = garden(['w.kot']);
    g = answer(answer(g, 'w.kot', T0 + 1, 1), 'w.kot', T0 + 2, 2);
    const it0 = derive(g).items.get('w.kot')!;
    expect(it0.stage).toBe('sprout');
    expect(canProgress(it0, 'pr', dayOf(T0), T0 + 3)).toBe(true);
    expect(canProgress(it0, 'rp', dayOf(T0), T0 + 3)).toBe(true);
  });
});

describe('P2a: прогресс до урожая виден', () => {
  it('строки: полив до ростка, ответ по-польски, дни до урожая, созреет со следующим', () => {
    let g = newGarden();
    g = plant(g, derive(g), ['w.kot'], T0).save;
    const day = (n: number) => dayOf(T0 + n * DAY_MS);
    const at = (gg: GardenSave) => derive(gg).items.get('w.kot');
    const add = (gg: GardenSave, t: number, mode: GameMode): GardenSave => ({ ...gg, log: [...gg.log, { t, day: dayOf(t), id: 'w.kot', side: mode === 1 ? 'pr' : 'rp', ok: true, mode, ...(mode === 5 ? { prod: true } : {}) }] });
    expect(progressText(at(g), T0, day(0))).toBe('ещё 2 полива до ростка');
    g = add(g, T0 + 1, 1);
    expect(progressText(at(g), T0, day(0))).toBe('ещё 1 полив до ростка');
    g = add(g, T0 + 2, 1);
    expect(progressText(at(g), T0, day(0))).toBe('нужно ответить по-польски');
    g = add(g, T0 + 3, 2);
    expect(at(g)!.stage).toBe('bush');
    // Выбор по-польски сделал кустик, но слово ещё не собрано само.
    expect(progressText(at(g), T0 + 4, day(0))).toBe('собери слово в игре «Собери слово»; до урожая: ещё 2 дня');
    g = add(g, T0 + 4, 5);
    expect(progressText(at(g), T0 + 4, day(0))).toBe('до урожая: ещё 2 дня');
    g = add(g, T0 + DAY_MS, 1);
    expect(progressText(at(g), T0 + DAY_MS, day(1))).toBe('до урожая: ещё 1 день');
    expect(ripeSoon(derive(g), day(1))).toMatchObject({ today: 0, tomorrow: 1 });
    expect(progressText(at(g), T0 + 2 * DAY_MS, day(2))).toBe('созреет со следующим верным ответом');
    expect(ripeSoon(derive(g), day(2))).toMatchObject({ today: 1, tomorrow: 0 });
    expect(progressText(undefined, T0)).toBe('не посажено');
  });

  it('ферма: строка в задании и после ответа, «созреет завтра» в ответе, карточка растения', () => {
    const s = setup();
    const id = 'w.kot';
    s.farm.plant([id]);
    const q1 = s.farm.next(1, id)!;
    expect(q1.progress).toBe('ещё 2 полива до ростка');
    s.farm.answer(q1, q1.answer);
    const q2 = s.farm.next(1, id)!;
    const r2 = s.farm.answer(q2, q2.answer);
    expect(r2.progress).toBe('нужно ответить по-польски');
    const q3 = s.farm.next(5, id)!;
    const r3 = s.farm.answer(q3, q3.answer);
    expect(r3.progress).toBe('до урожая: ещё 2 дня');
    s.setNow(T0 + DAY_MS);
    const q4 = s.farm.next(1, id)!;
    const r4 = s.farm.answer(q4, q4.answer);
    expect(r4).toMatchObject({ progress: 'до урожая: ещё 1 день', tomorrow: 1 });
    expect(s.farm.ripeSoon()).toMatchObject({ today: 0, tomorrow: 1 });

    const root = document.createElement('div');
    const card = mountPlantCard(root, s.farm, { onReview: () => {} });
    card.open(id);
    expect(root.querySelector('[data-next]')?.textContent).toContain('До урожая: ещё 1 день');
  });

  it('панель мини-игры: строка до урожая под вопросом и после ответа, «созреет завтра: N» в шапке', () => {
    const root = document.createElement('div');
    const Q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот', progress: 'ещё 1 полив до ростка' };
    const g = mountMinigame(root, {
      bus: testBus(),
      next: () => Q,
      answer: (_q, a) => ({ ok: a === 'кот', correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот', progress: 'нужно ответить по-польски', tomorrow: 3 }),
      say: () => {},
    });
    g.start(1);
    expect(root.querySelector('[data-progress]')?.textContent).toContain('Ещё 1 полив до ростка');
    expect((root.querySelector('[data-soon]') as HTMLElement).hidden).toBe(true);
    (root.querySelector('[data-opt="кот"]') as HTMLButtonElement).click();
    expect(root.querySelector('[data-progress-after]')?.textContent).toContain('Нужно ответить по-польски');
    const soon = root.querySelector('[data-soon]') as HTMLElement;
    expect(soon.hidden).toBe(false);
    expect(soon.textContent).toBe('🌾 созреет завтра: 3');
    g.stop();
  });

  it('задание «наоборот»: пометка «↔ наоборот» в шапке и подсказка по стороне задания', () => {
    const root = document.createElement('div');
    const R: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот', reverse: true };
    const g = mountMinigame(root, { bus: testBus(), next: () => R, answer: () => ({ ok: true, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот' }), say: () => {} });
    g.start(2);
    const mark = root.querySelector('[data-reverse]') as HTMLElement;
    expect(mark.hidden).toBe(false);
    expect(mark.textContent).toBe('↔ наоборот');
    expect(root.querySelector('.pq-q-hint')?.textContent).toBe('Выбери перевод');
    g.stop();
  });
});

describe('P2a: фразы открываются от ростков', () => {
  it('фразу можно сажать, когда все её слова хотя бы ростки', () => {
    const s = setup();
    const f = s.farm;
    expect(f.missingWords('p.dzien_dobry')).toEqual(['w.dzien_dobry']);
    f.plant(['w.dzien_dobry']);
    expect(f.missingWords('p.dzien_dobry')).toEqual(['w.dzien_dobry']); // семя — ещё нет
    for (let i = 0; i < 2; i++) {
      const q = f.next(1, 'w.dzien_dobry')!;
      f.answer(q, q.answer);
    }
    expect(f.info('w.dzien_dobry').stage).toBe('sprout');
    expect(f.missingWords('p.dzien_dobry')).toEqual([]);
    expect(f.plant(['p.dzien_dobry']).planted).toBe(1);
  });
});
