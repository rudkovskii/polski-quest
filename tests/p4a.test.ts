// @vitest-environment happy-dom
// P4a: баги теста 4. Стрелка над домом ведёт в дверь (B2), шапка словаря низкая (B1), позиция героя пишется на стоянке (B3),
// слова в мини-игре не рвутся и итог виден (B4/B5), тема целиком — мягкий выбор, повторы без пользы. «Напиши сам» с 19.10 — игра 5.
import { describe, expect, it, vi } from 'vitest';
import sprites from '../public/atlas/sprites.json';
import { createFarm } from '../src/systems/farm';
import { canProgress, DAY_MS, dayOf, harvestsNow, isOverripe, newGarden, sideOf, type GardenSave } from '../src/systems/garden';
import type { Question } from '../src/systems/quiz';
import type { GameMode } from '../src/types/farm';
import { mountGuide } from '../src/ui/hintsGuide';
import { mountSettings } from '../src/ui/settings';
import { newSave, normalizeSave, SFX_VOLUME_DEFAULT } from '../src/systems/save';
import { mountDictionary, TOPIC_QUICK } from '../src/ui/dictionary';
import { mountMinigame, optSizeClass } from '../src/ui/minigame';
import { LocationModel, STEP_MS } from '../src/world/location';
import { getMap, resolveSpawn } from '../src/world/maps';
import { PositionGate } from '../src/world/positionGate';
import { run, seeded, send, testBus } from './helpers';

const size = (id: string): [number, number] | undefined => (sprites as unknown as Record<string, { size: [number, number] }>)[id]?.size;
const farmAt = (spawn: string | [number, number]): LocationModel => {
  const m = getMap('farm');
  const s = resolveSpawn(m, spawn, 'down');
  return new LocationModel(m, s.tile, { facing: s.facing, rand: seeded(3), spriteSize: size });
};

describe('B2: стрелка над домом', () => {
  it('тап по стрелке над крышей (и выше крыши при мелком зуме) с фермы ведёт в дверь и заходит в дом', () => {
    for (const start of ['start', [12, 10], [2, 8]] as const) {
      const m = farmAt(start as string | [number, number]);
      // Стрелка висит над дверью (x 5,5) на 0,3–1,6 клетки выше спрайта двери (верх двери — y 4); крыша — y 2..4.
      for (const y of [3.6, 3.0, 2.4, 2.05, 1.6, 0.8]) expect(m.targetAtPoint(5.5, y, { doorZone: true }), `y=${y}`).toBe('exit:5,5');
      const key = m.targetAtPoint(5.5, 2.2, { doorZone: true })!;
      send(m, { type: 'interact', target: key });
      const evs = run(m, STEP_MS * 40);
      expect(evs.filter((e) => e.type === 'exit'), JSON.stringify(start)).toEqual([{ type: 'exit', to: 'home', spawn: 'from_farm', tile: [5, 5] }]);
    }
  });

  it('цель указателя на карте: стол/доска, иначе дверь', () => {
    expect(farmAt('start').guideTarget('desk')).toBe('exit:5,5');
    expect(farmAt('start').guideTarget('board')).toBe('prop:board');
  });

  it('указатель сообщает миру, где стрелка; скрытый — null', () => {
    const bus = testBus();
    const seen: ({ x: number; y: number } | null)[] = [];
    bus.on('guide:arrow', (p) => seen.push(p));
    const root = document.createElement('div');
    const g = mountGuide(root, { stage: () => 'desk', done: () => {} }, bus);
    bus.emit('fx:guide', { hero: { x: 180, y: 300 }, target: { x: 180, y: 200 }, via: 'door' });
    expect(seen.at(-1)).toEqual({ x: 180, y: 184 });
    bus.emit('fx:guide', null);
    expect(seen.at(-1)).toBeNull();
    g.dispose();
  });
});

describe('B3: позиция героя', () => {
  it('пишется на каждой стоянке с новой клеткой или поворотом, в движении — нет', () => {
    const gate = new PositionGate();
    expect(gate.tick(false, 'farm', [5, 7], 'down')).toEqual({ location: 'farm', x: 5, y: 7, facing: 'down' });
    expect(gate.tick(true, 'farm', [6, 7], 'right')).toBeNull();
    // Автобег мини-игры закончился у грядки: клетка записывается.
    expect(gate.tick(false, 'farm', [13, 13], 'down')).toEqual({ location: 'farm', x: 13, y: 13, facing: 'down' });
    expect(gate.tick(false, 'farm', [13, 13], 'down')).toBeNull();
    expect(gate.tick(false, 'farm', [13, 13], 'left')).not.toBeNull();
    gate.reset();
    expect(gate.tick(false, 'farm', [13, 13], 'left')).not.toBeNull();
  });
});

describe('B1: шапка словаря', () => {
  it('вкладки и поиск в одну строку, поле фиксированной высоты, шапка ≤ 90 px; на телефоне строка слова в одну линию', () => {
    const root = document.createElement('div');
    const farm = createFarm({ bus: testBus(), load: () => newGarden(), save: () => {}, now: () => 0, tz: () => 0, say: () => {} });
    mountDictionary(root, farm, testBus()).open();
    const css = [...root.querySelectorAll('style')].map((x) => x.textContent).join('');
    const rule = (sel: string): string => css.match(new RegExp(`${sel.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.dict-search')).not.toMatch(/180px/);
    expect(rule('.dict-search')).toMatch(/flex: 1 1 auto/);
    expect(rule('.dict-search')).toMatch(/max-height: 40px/);
    // F5a: шапка из рядов (вкладки и поиск в одну строку), липкая, ≤ 120 px.
    expect(rule('.dict-headrow')).toMatch(/flex-direction: row/);
    expect(rule('.dict-head')).toMatch(/max-height: 120px/);
    // 8 строк по 40 px + зазоры 3 px помещаются в видимую часть списка (телефон: шапка + карточка + 8 строк < 812).
    expect(css).toMatch(/\.dict-row \{ grid-template-columns: auto minmax\(0, 1fr\) auto; padding: 4px 8px; min-height: 40px/);
    expect(8 * 40 + 7 * 3).toBeLessThanOrEqual(360);
  });
});

describe('тема целиком: мягкий выбор', () => {
  function open() {
    const root = document.createElement('div');
    let saved: GardenSave = newGarden();
    const farm = createFarm({ bus: testBus(), load: () => saved, save: (g) => (saved = g), now: () => Date.UTC(2026, 9, 17, 9), tz: () => 0, say: () => {} });
    const plant = vi.spyOn(farm, 'plant');
    mountDictionary(root, farm, testBus()).open();
    return { root, farm, plant };
  }

  it('больше 8 слов: «Посадить 7 (быстрее урожай)» сажает 7 самых частых, «Всю тему (N)» — все', () => {
    const { root, farm, plant } = open();
    root.querySelector<HTMLElement>('[data-topic="kolory"]')!.click();
    const quick = root.querySelector<HTMLButtonElement>('[data-bulk]')!;
    const all = root.querySelector<HTMLButtonElement>('[data-bulk-all]')!;
    expect(quick.textContent).toBe(`Посадить ${TOPIC_QUICK} (быстрее урожай)`);
    expect(all.hidden).toBe(false);
    expect(all.textContent).toBe('Всю тему (14)');
    quick.click();
    const ids = plant.mock.calls[0]![0];
    expect(ids).toHaveLength(7);
    const freq = (id: string) => farm.word(id)!.freq;
    expect(ids.every((id) => freq(id) === 1)).toBe(true);
    // Остаток (7) уже без мягкого выбора: одна кнопка на всю тему.
    expect(quick.textContent).toBe('Посадить всю тему (7)');
    expect(all.hidden).toBe(true);
  });

  it('8 и меньше — одна кнопка на всю тему', () => {
    const { root } = open();
    root.querySelector<HTMLElement>('[data-topic="kolory"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-bulk-all]')!.click();
    expect(root.querySelector<HTMLButtonElement>('[data-bulk]')!.hidden).toBe(true);
  });
});

describe('B4/B5: мини-игра', () => {
  it('длинное слово — мельче, без посимвольного переноса; итог после ответа не прокручивает ни лист, ни страницу', () => {
    expect(optSizeClass('кот')).toBe('');
    expect(optSizeClass('присаживайтесь')).toBe(' xlong');
    expect(optSizeClass('сверхъестественнопротивоположный')).toBe(' xxlong');
    const Q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['присаживайтесь', 'кот', 'дом', 'мама'], answer: 'кот' };
    const root = document.createElement('div');
    const g = mountMinigame(root, { bus: testBus(), next: () => Q, answer: () => ({ ok: false, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот', progress: 'слово выучено и лежит в банке' }), say: () => {} });
    g.start(1);
    const paper = root.querySelector<HTMLElement>('[data-game]')!;
    Object.defineProperty(paper, 'scrollHeight', { value: 480, configurable: true });
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    root.querySelector<HTMLButtonElement>('.pq-opt')!.click();
    expect(spy).not.toHaveBeenCalled();
    expect(paper.scrollTop).toBe(0);
    g.stop();
  });
});

/** Прогон как у Димы в тесте 4: 19 слов, дни по (игра 1, игра 2) ответов, 87% верно. */
function simulate(seed: number, onTask: (q: Question, mode: GameMode, useful: boolean, day: number) => void): number {
  let saved: GardenSave = newGarden();
  const T0 = Date.UTC(2026, 9, 17, 9, 0);
  let now = T0;
  const farm = createFarm({ bus: testBus(), load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(seed) });
  farm.plant(farm.words.slice(0, 19).map((w) => w.id));
  const r = seeded(seed + 100);
  // По дням: игра 1, игра 2, игра 5 («Собери слово», с 19.10 нужна слову для урожая).
  const plan: [number, number, number][] = [
    [20, 8, 5],
    [19, 3, 3],
    [18, 4, 4],
  ];
  let t = 0;
  plan.forEach(([g1, g2, g5], d) => {
    for (const [mode, n] of [
      [1, g1],
      [2, g2],
      [5, g5],
    ] as [GameMode, number][])
      for (let i = 0; i < n; i++) {
        now = T0 + d * DAY_MS + ++t * 60_000;
        const q = farm.next(mode)!;
        const it = farm.state.items.get(q.id)!;
        const side = q.kind === 'spell' ? q.dir : sideOf(q.reverse ? (mode === 1 ? 2 : 1) : mode);
        const prod = q.kind === 'spell' && q.dir === 'rp';
        const day = dayOf(now, 0);
        const useful = isOverripe(it, now) || canProgress(it, side, day, now, prod) || harvestsNow(it, side, day, prod) || !it.days.has(day);
        onTask(q, mode, useful, d);
        farm.answer(q, r() < 0.87 ? q.answer : 'zzz');
      }
  });
  return farm.stats().grownTotal;
}

describe('очередь: игра 2 без ввода, игра 5 и повторы', () => {
  it('за 3 дня игра 2 — только выбор, игра 5 — всегда сборка слова; урожай есть в каждом прогоне', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const kinds: Record<number, Set<string>> = { 1: new Set(), 2: new Set(), 5: new Set() };
      const grown = simulate(seed, (q, mode) => kinds[mode]!.add(q.kind));
      expect([...kinds[2]!]).toEqual(['choice']);
      expect([...kinds[5]!]).toEqual(['spell']);
      expect(grown, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('при рабочем наборе ≥ 4 одно слово не чаще раза в 4 задания; задания без пользы — только когда больше нечего дать', () => {
    let useless = 0;
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      let seq: string[] = [];
      let lastDay = -1;
      simulate(seed, (q, _m, useful, d) => {
        if (d !== lastDay) (seq = []), (lastDay = d);
        const k = seq.lastIndexOf(q.id);
        if (k >= 0) expect(seq.length - k, `seed ${seed} ${q.id}`).toBeGreaterThanOrEqual(4);
        seq.push(q.id);
        total++;
        if (!useful) useless++;
      });
    }
    expect(useless / total).toBeLessThan(0.02);
  });
});

describe('настройки: громкость эффектов', () => {
  const deps = (muted: boolean, set = vi.fn()) => ({
    bus: testBus(), muted, getSound: () => true, setSound: () => {}, getSfxVolume: () => 60, setSfxVolume: set,
    exportSave: () => '', importSave: async () => ({ ok: true, message: '' }), reset: async () => {},
  });

  it('по умолчанию 60 %, старое сохранение без поля получает 60, мусор обрезается в 0–100', () => {
    expect(SFX_VOLUME_DEFAULT).toBe(60);
    expect(newSave(1).settings.sfxVolume).toBe(60);
    expect(normalizeSave({ v: 2, created: 1, updated: 2, position: null, settings: { sound: true } })!.settings.sfxVolume).toBe(60);
    expect(normalizeSave({ v: 2, created: 1, updated: 2, position: null, settings: { sfxVolume: 250 } })!.settings.sfxVolume).toBe(100);
  });

  it('слайдер 0–100 меняет громкость; при ?mute=1 виден, но неактивен', () => {
    const root = document.createElement('div');
    const set = vi.fn();
    const p = mountSettings(root, deps(false, set));
    p.open();
    const vol = root.querySelector<HTMLInputElement>('[data-sfx-volume]')!;
    expect([vol.min, vol.max, vol.value, vol.disabled]).toEqual(['0', '100', '60', false]);
    vol.value = '35';
    vol.dispatchEvent(new Event('input'));
    expect(set).toHaveBeenCalledWith(35);
    expect(root.querySelector('[data-sfx-volume-out]')!.textContent).toBe('35%');
    const muted = document.createElement('div');
    const pm = mountSettings(muted, deps(true));
    pm.open();
    const mv = muted.querySelector<HTMLInputElement>('[data-sfx-volume]')!;
    expect(mv.hidden).toBe(false);
    expect(mv.disabled).toBe(true);
  });
});
