// @vitest-environment happy-dom
// V11c: путь к A1 — метрика очков, 20 подуровней, A1 = вся база, пересчёт старого сохранения, монотонность, карточка и экран пути.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHRASES, WORDS } from '../src/systems/content';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, derive, newGarden, type GardenSave, type ItemState } from '../src/systems/garden';
import { connectSfx } from '../src/systems/platform/sfx';
import { canAssemble } from '../src/systems/quiz';
import { A1_LEVEL, BASE, SUBLEVELS, SUB_COUNT, THRESHOLDS, baseOf, growthText, pathOf, pointsOf, thresholds, weightOf } from '../src/systems/xp';
import { mountHud } from '../src/ui/hud';
import { CARD_MS, mountLevelUp, mountPath } from '../src/ui/levelUp';
import { Round, renderRoundSummary } from '../src/ui/roundSummary';
import { mountSummary } from '../src/ui/summary';
import { seeded, testBus } from './helpers';

afterEach(() => vi.useRealTimers());

const T0 = Date.UTC(2026, 9, 17, 9, 0);

function setup(load: GardenSave = newGarden()) {
  const bus = testBus();
  let saved = load;
  let now = T0;
  const farm = createFarm({ bus, load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(7) });
  return { bus, farm, saved: () => saved, setNow: (t: number) => (now = t) };
}
const solveId = (f: ReturnType<typeof setup>['farm'], mode: 1 | 2, id: string, ok = true) => {
  const q = f.next(mode, id)!;
  return f.answer(q, ok ? q.answer : 'не то');
};
const item = (id: string, over: Partial<ItemState> = {}): ItemState =>
  ({ id, phrase: id.startsWith('p.'), plantedAt: 0, stage: 'seed', drops: 0, sides: { pr: false, rp: false }, days: new Set(), rpOk: false, sideAns: { pr: 0, rp: 0 }, harvests: 0, lastHarvest: null, firstHarvestDay: null, lastAnswer: null, answers: 1, xp: 0, ...over }) as ItemState;

describe('V11c: база и пороги', () => {
  it('A1 = слова + короткие фразы + 2 × фразы сборки, считается из контента', () => {
    const assemble = PHRASES.filter(canAssemble).length;
    expect(BASE).toEqual({ words: WORDS.length, phrases: PHRASES.length, assemble, short: PHRASES.length - assemble, total: WORDS.length + (PHRASES.length - assemble) + 2 * assemble });
    expect(baseOf([], []).total).toBe(0);
    expect(BASE.total).toBeGreaterThan(1167 + 2 * 200);
  });

  it('20 порогов: строго возрастают, первые частые (5, 15, 30, 50), 20-й — 95 % пути, дальше A1', () => {
    expect(THRESHOLDS).toHaveLength(SUB_COUNT);
    expect(THRESHOLDS.slice(0, 4)).toEqual([5, 15, 30, 50]);
    for (let i = 1; i < THRESHOLDS.length; i++) expect(THRESHOLDS[i]).toBeGreaterThan(THRESHOLDS[i - 1]!);
    expect(THRESHOLDS[19]).toBe(Math.round(BASE.total * 0.95));
    // шаги растут: следующий подуровень не легче предыдущего (после первых шести)
    const steps = THRESHOLDS.map((t, i) => t - (THRESHOLDS[i - 1] ?? 0));
    for (let i = 7; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    for (const total of [30, 100, 399, 400, 5000]) {
      const t = thresholds(total);
      expect(t).toHaveLength(SUB_COUNT);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]!);
    }
  });

  it('у каждого подуровня польское название, перевод, значок и подпись; названия не повторяются', () => {
    expect(SUBLEVELS).toHaveLength(SUB_COUNT + 1);
    expect(new Set(SUBLEVELS.map((l) => l.pl)).size).toBe(SUB_COUNT + 1);
    for (const l of [...SUBLEVELS, A1_LEVEL]) expect([l.pl, l.ru, l.icon, l.note, l.gift].every((x) => x.length > 0)).toBe(true);
    expect(SUBLEVELS.slice(1, 4).map((l) => l.pl)).toEqual(['Ziarenko', 'Kiełek', 'Listek']);
    expect(SUBLEVELS[20]!.pl).toBe('Gospodarstwo');
    expect(A1_LEVEL.pl).toBe('Rolnik A1');
  });
});

describe('V11c: метрика очков', () => {
  const assembleId = PHRASES.find(canAssemble)!.id;
  const shortId = PHRASES.find((p) => !canAssemble(p))!.id;

  it('слово 1, фраза сборки 2, короткая фраза 1; растущее — семечко 0,1 / росток 0,3 / кустик 0,6', () => {
    expect([weightOf('w.kot'), weightOf(assembleId), weightOf(shortId)]).toEqual([1, 2, 1]);
    const pts = (...xs: ItemState[]) => pointsOf(xs);
    expect(pts(item('w.kot', { harvests: 1, stage: null }))).toMatchObject({ grown: 1, partial: 0 });
    expect(pts(item(assembleId, { harvests: 1, stage: null }))).toMatchObject({ grown: 2, partial: 0 });
    expect(pts(item('w.kot', { stage: 'seed' })).partial).toBeCloseTo(0.1);
    expect(pts(item('w.kot', { stage: 'sprout' })).partial).toBeCloseTo(0.3);
    expect(pts(item('w.kot', { stage: 'bush' })).partial).toBeCloseTo(0.6);
    expect(pts(item(assembleId, { stage: 'bush' })).partial).toBeCloseTo(1.2);
    // посаженное без ответов очков не даёт
    expect(pts(item('w.kot', { stage: 'bush', answers: 0 })).partial).toBe(0);
    // перезревшее (в банке, harvests > 0, снова на грядке) остаётся выращенным
    expect(pts(item('w.kot', { harvests: 2, stage: null, lastHarvest: 1 }))).toMatchObject({ grown: 1 });
  });

  it('A1 — только когда выращена вся база; частичный зачёт A1 не даёт', () => {
    const all = [...WORDS.map((w) => item(w.id, { harvests: 1, stage: null })), ...PHRASES.map((p) => item(p.id, { harvests: 1, stage: null }))];
    const full = pointsOf(all);
    expect(full.grown).toBe(BASE.total);
    expect(pathOf(full)).toMatchObject({ a1: true, sub: 21, pct: 1, toNext: null, pl: 'Rolnik A1' });
    const almost = pointsOf(all.slice(1).concat(item(all[0]!.id, { stage: 'bush' })));
    const p = pathOf(almost);
    expect(p.a1).toBe(false);
    expect(p.sub).toBe(SUB_COUNT);
    expect(p.pct).toBeLessThan(1);
    expect(p.toNext).toBeGreaterThan(0);
  });

  it('пороги: подуровень берётся ровно на пороге, внутри подуровня полоска от 0 до 1', () => {
    const lv = (x: number) => pathOf({ grown: x, partial: 0 });
    expect(lv(0)).toMatchObject({ sub: 0, pl: 'Ziemia', ratio: 0, toNext: 5 });
    expect(lv(4.9).sub).toBe(0);
    expect(lv(5)).toMatchObject({ sub: 1, pl: 'Ziarenko', nextPl: 'Kiełek' });
    expect(lv(15).sub).toBe(2);
    expect(lv(THRESHOLDS[19]! - 1).sub).toBe(19);
    expect(lv(THRESHOLDS[19]!)).toMatchObject({ sub: 20, pl: 'Gospodarstwo', nextPl: 'Rolnik A1' });
    expect(lv(10).ratio).toBeCloseTo(0.5);
    expect(lv(10).pos).toBeCloseTo(1.5);
  });

  it('монотонность: больше очков — не ниже позиция', () => {
    let prev = -1;
    for (let x = 0; x <= BASE.total; x += 7) {
      const p = pathOf({ grown: Math.floor(x), partial: x % 1 });
      expect(p.pos).toBeGreaterThanOrEqual(prev);
      prev = p.pos;
    }
  });
});

describe('V11c: ферма', () => {
  it('первый подуровень берётся в первую сессию: 15 слов, каждое отвечено в обе стороны', () => {
    const s = setup();
    const ids = WORDS.slice(0, 15).map((w) => w.id);
    s.farm.plant(ids);
    const ups: number[] = [];
    s.bus.on('hud:xp', (x) => x.up && ups.push(x.sub!));
    expect(s.farm.stats().path.sub).toBe(0);
    for (let round = 0; round < 3; round++) for (const id of ids) solveId(s.farm, round === 1 ? 2 : 1, id);
    const p = s.farm.stats().path;
    expect(p.sub).toBeGreaterThanOrEqual(1);
    expect(ups[0]).toBe(1);
    expect(s.farm.stats().sessionGain).toBeGreaterThan(1);
  });

  it('очки и подуровень не падают за серию ответов, в том числе неверных', () => {
    const s = setup();
    const ids = WORDS.slice(0, 20).map((w) => w.id);
    s.farm.plant(ids);
    const rand = seeded(3);
    let prev = 0;
    for (let i = 0; i < 160; i++) {
      if (i === 80) s.setNow(T0 + DAY_MS);
      if (i === 120) s.setNow(T0 + 2 * DAY_MS);
      solveId(s.farm, rand() < 0.5 ? 1 : 2, ids[i % ids.length]!, rand() < 0.75);
      const pos = s.farm.stats().path.pos;
      expect(pos).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = pos;
    }
    expect(prev).toBeGreaterThan(1);
  });

  it('старое сохранение (только посадки и журнал, без полей уровня) пересчитывается без миграции', () => {
    const ids = WORDS.slice(0, 12).map((w) => w.id);
    const old: GardenSave = { planted: ids.map((id) => ({ t: T0, id })), log: [], slots: {}, tier: 0 };
    let t = T0;
    for (let d = 0; d < 3; d++)
      for (const id of ids)
        for (const [side, mode] of [['pr', 1], ['rp', 2]] as const) old.log.push({ t: (t += 1000), day: Math.floor((T0 + d * DAY_MS) / DAY_MS), id, side, ok: true, mode });
    const st = derive(old);
    const expected = pathOf(pointsOf(st.items.values()));
    expect(expected.grown).toBe(12);
    const s = setup(old);
    s.setNow(T0 + 3 * DAY_MS);
    const stats = s.farm.stats();
    expect(stats.path.grown).toBe(12);
    expect(stats.path.sub).toBe(expected.sub);
    expect(stats.path.sub).toBe(pathOf({ grown: 12, partial: 0 }).sub);
    expect(stats.sessionGain).toBe(0);
  });
});

describe('V11c: HUD, карточка, путь, итоги', () => {
  it('карточка нового подуровня: название, перевод, «+1 подуровень · 2/20», подпись; гаснет сама; без up молчит', () => {
    vi.useFakeTimers();
    const bus = testBus();
    const root = document.createElement('div');
    const c = mountLevelUp(root, { bus });
    bus.emit('hud:xp', { level: 'Ziarenko', ratio: 0.2, sub: 1, of: 20 });
    expect(c.isOpen).toBe(false);
    bus.emit('hud:xp', { level: 'Kiełek', ratio: 0, sub: 2, of: 20, up: true });
    expect(c.isOpen).toBe(true);
    const text = root.querySelector('[data-levelup]')!.textContent!;
    expect(text).toContain('Kiełek');
    expect(text).toContain('Проросток');
    expect(text).toContain('+1 подуровень · 2/20');
    expect(text).toContain('Открыто:');
    vi.advanceTimersByTime(CARD_MS + 10);
    expect(c.isOpen).toBe(false);
    bus.emit('hud:xp', { level: 'Rolnik A1', ratio: 1, sub: 21, of: 20, up: true });
    expect(root.querySelector('[data-levelup]')!.textContent).toContain('Rolnik A1');
    root.querySelector<HTMLElement>('[data-levelup]')!.click();
    expect(c.isOpen).toBe(false);
  });

  it('звук подуровня — тот же `hud:xp {up}`; с mute ничего не подключено и контекст не трогается', () => {
    const bus = testBus();
    const ctxOf = vi.fn(() => null);
    const off = connectSfx(bus, () => true, ctxOf, { mute: true });
    bus.emit('hud:xp', { level: 'Kiełek', ratio: 0, sub: 2, of: 20, up: true });
    expect(ctxOf).not.toHaveBeenCalled();
    off();
  });

  it('экран «Путь к A1»: лестница из 20 подуровней и A1, текущий отмечен, слова и фразы из скольких, честная строка', () => {
    const s = setup();
    const root = document.createElement('div');
    document.body.append(root);
    const screen = mountPath(root, s.farm);
    s.farm.plant(WORDS.slice(0, 15).map((w) => w.id));
    for (let r = 0; r < 3; r++) for (const w of WORDS.slice(0, 15)) solveId(s.farm, r === 1 ? 2 : 1, w.id);
    screen.open();
    expect(screen.isOpen).toBe(true);
    const sub = s.farm.stats().path.sub;
    expect(root.querySelectorAll('[data-step]')).toHaveLength(SUB_COUNT + 2);
    expect(root.querySelectorAll('.path-step.done')).toHaveLength(sub);
    expect(root.querySelector('.path-step.cur')!.getAttribute('data-step')).toBe(String(sub));
    expect(root.querySelector('[data-path-words]')!.textContent).toBe(`0 из ${BASE.words}`);
    expect(root.querySelector('[data-path-phrases]')!.textContent).toBe(`0 из ${BASE.phrases}`);
    expect(root.querySelector('[data-path-next]')!.textContent).toMatch(/^До «.+»: ещё \d+ оч/);
    expect(root.querySelector('[data-path-pct]')!.textContent).toMatch(/^До A1: \d+% · \d+ из \d+ очков$/);
    const honest = root.querySelector('[data-path-honest]')!.textContent!;
    expect(honest).toContain(`A1 ≈ ${BASE.words} слов и ${BASE.phrases} фраз базы`);
    expect(honest).toContain('ориентир 1100–1500 слов');
    screen.close();
    expect(screen.isOpen).toBe(false);
  });

  it('HUD открывает путь по тапу; кровать показывает подуровень, рост за сессию и кнопку «Путь к A1»', () => {
    const s = setup();
    const root = document.createElement('div');
    document.body.append(root);
    let opened = 0;
    mountHud(root, { bus: s.bus, onSettings: () => {}, onLevel: () => opened++ });
    s.farm.plant(['w.kot', 'w.pies']);
    s.farm.refresh();
    solveId(s.farm, 1, 'w.kot');
    expect(root.querySelector('[data-xp-level]')!.textContent).toBe('Ziemia · 0/20');
    root.querySelector<HTMLElement>('[data-xp]')!.click();
    expect(opened).toBe(1);
    const sum = mountSummary(root, s.farm, s.bus, undefined, () => (opened += 10));
    sum.openBed();
    expect(root.querySelector('[data-level]')!.textContent).toContain('0/20');
    expect(root.querySelector('[data-level-hint]')!.textContent).toMatch(/^До A1: 0% · до «Ziarenko» ещё \d+ оч\.$/);
    root.querySelector<HTMLElement>('[data-open-path]')!.click();
    expect(opened).toBe(11);
  });

  it('итог раунда: звание и рост за раунд («+0,4 подуровня»), без роста — только звание', () => {
    expect([growthText(0.04), growthText(0.4), growthText(1), growthText(2), growthText(1.25)]).toEqual(['', '+0,4 подуровня', '+1 подуровень', '+2 подуровня', '+1,3 подуровня']);
    const r = new Round();
    r.add({ ok: true, act: { kind: 'water', xp: 1 }, path: { from: 1.2, to: 1.4, sub: 1, pl: 'Ziarenko' } });
    r.add({ ok: true, act: { kind: 'grow', xp: 4 }, path: { from: 1.4, to: 1.6, sub: 1, pl: 'Ziarenko' } });
    expect(r.stats.path).toEqual({ from: 1.2, to: 1.6, sub: 1, pl: 'Ziarenko' });
    expect(renderRoundSummary(1, r.stats).querySelector('[data-round-way]')!.textContent).toBe('Ziarenko · 1/20 · +0,4 подуровня');
    const flat = new Round();
    flat.add({ ok: false, path: { from: 2, to: 2, sub: 2, pl: 'Kiełek' } });
    expect(renderRoundSummary(1, flat.stats).querySelector('[data-round-way]')!.textContent).toBe('Kiełek · 2/20');
    expect(renderRoundSummary(1, new Round().stats).querySelector('[data-round-way]')).toBeNull();
  });
});
