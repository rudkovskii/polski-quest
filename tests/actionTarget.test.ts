// @vitest-environment happy-dom
// P-10a: кнопка A и цель режиссёра. Приоритет A: подсвеченная цель рядом → объект перед лицом → соседний,
// Казик не перехватывает A, если он не цель; Казик не встаёт на клетку Димы и уступает дорогу; цель «поговори:
// Kazik» — сам Казик (подходит к Диме, A и тап говорят с ним); тап по цели — дойти и сделать.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startFlow } from '../src/flow';
import { seedStoryDay } from '../src/dev/seedDay';
import { bus } from '../src/systems/bus';
import { getContent } from '../src/systems/content';
import type { GameStorage } from '../src/systems/platform/storage';
import type { GuideTarget } from '../src/types/bus';
import type { LocationMap } from '../src/types/content';
import type { DayGlue } from '../src/day';
import type { Play } from '../src/ui/play';
import { besideCell, edgeArrow, resolveGuide } from '../src/world/guide';
import { BOBR_KEY, LocationModel, type WorldEvent } from '../src/world/location';
import { flush, memStore } from './overlayKit';

const run = (m: LocationModel, ms: number, dt = 16): WorldEvent[] => {
  const out: WorldEvent[] = [];
  for (let t = 0; t < ms; t += dt) out.push(...m.update(dt));
  return out;
};
const of = <K extends WorldEvent['type']>(evs: WorldEvent[], k: K) => evs.filter((e) => e.type === k) as Extract<WorldEvent, { type: K }>[];
const load = (name: string) => JSON.parse(readFileSync(`content/modules/ch01/maps/${name}.json`, 'utf8')) as LocationMap;

/** Пустая комната с NPC и триггерами, компаньон идёт следом (на карте нет NPC bobr). */
function room(objects: LocationMap['objects']): LocationMap {
  return {
    id: 'demo.room',
    title: { pl: 'Pokój', ru: 'Комната' },
    tileset: 'ninja16',
    controls: 'walk',
    size: [10, 8],
    defaultGround: '.',
    legend: { '.': { tile: 'grass' }, '#': { tile: 'fence', solid: true } },
    layers: { ground: ['##########', '#........#', '#........#', '#........#', '#........#', '#........#', '#........#', '##########'] },
    spawns: { default: [4, 4] },
    objects,
  } as LocationMap;
}

describe('A: цель режиссёра первая', () => {
  const dz = load('dzialka');

  it('у хатки: A шагает в подсвеченный выход, а не говорит с Казиком рядом («Kłoda!»)', () => {
    // Дима под входом в хатку (12,3) лицом вверх, Казик-NPC справа (13,4).
    const m = new LocationModel(dz, [12, 4], { facing: 'up' });
    m.setHidden([]); // выход в хатку открыт (флаг beat.d01.wieczor)
    expect(m.actionHint()?.key).toBe(BOBR_KEY); // без цели: рядом только Казик
    const g = resolveGuide(m, { location: 'ch01.chatka' })!;
    expect(g.key).toBe('exit:12,3');
    m.setGoal(g);
    expect(m.actionHint()).toEqual({ key: 'exit:12,3', tile: [12, 3] });
    m.intent({ type: 'interact' });
    const evs = run(m, 600);
    expect(of(evs, 'interact')).toHaveLength(0);
    expect(of(evs, 'exit')[0]).toMatchObject({ to: 'ch01.chatka' });
  });

  it('цель рядом сбоку важнее объекта перед лицом', () => {
    const m = new LocationModel(room([
      { type: 'npc', id: 'pan_marek', at: [4, 3] },
      { type: 'npc', id: 'pani_hela', at: [5, 4] },
    ]), [4, 4], { facing: 'up', companion: false });
    expect(m.actionHint()?.key).toBe('npc:pan_marek');
    m.setGoal(resolveGuide(m, { location: 'demo.room', npc: 'pani_hela' }));
    expect(m.actionHint()).toEqual({ key: 'npc:pani_hela', tile: [5, 4] });
    m.intent({ type: 'interact' });
    expect(of(run(m, 32), 'interact')[0]).toMatchObject({ id: 'pani_hela', via: 'action', facing: 'right' });
  });

  it('Казик-NPC не перехватывает A: соседний триггер важнее, Казик — только если больше ничего нет', () => {
    const map = room([
      { type: 'npc', id: 'bobr', at: [3, 4] },
      { type: 'trigger', id: 'skrzynka', at: [4, 5], on: 'tap', do: [] },
    ]);
    const m = new LocationModel(map, [4, 4], { facing: 'left' });
    expect(m.actionHint()?.key).toBe('trigger:skrzynka');
    const alone = new LocationModel(room([{ type: 'npc', id: 'bobr', at: [3, 4] }]), [4, 4], { facing: 'up' });
    expect(alone.actionHint()?.key).toBe(BOBR_KEY);
  });

  it('грядка: подсвеченная клетка сбоку — цель A (обычная соседняя — нет)', () => {
    const plot = dz.objects.find((o) => o.type === 'plot')!;
    const [px0, py0] = plot.at;
    const m = new LocationModel(dz, [px0 + 1, py0 - 1], { facing: 'up' });
    m.setGarden([{ at: [px0, py0], item: 'lx.woda' }, { at: [px0 + 1, py0], item: 'lx.kawa' }], 0);
    m.intent({ type: 'move', dir: 'left', held: true });
    m.intent({ type: 'move', dir: 'left', held: false });
    run(m, 50);
    // Смотрит влево на траву, растение «kawa» внизу — сбоку: без цели A его не трогает.
    expect(m.actionHint()).toBeNull();
    m.setGoal({ key: 'plot:grzadki', at: [px0 + 1, py0], size: [1, 1], viaExit: false });
    expect(m.actionHint()).toEqual({ key: 'plot:grzadki', tile: [px0 + 1, py0] });
  });
});

describe('Казик-компаньон', () => {
  it('цель «поговори: Kazik» — сам компаньон: A и тап говорят с ним', () => {
    const m = new LocationModel(room([{ type: 'npc', id: 'pan_marek', at: [4, 3] }]), [4, 4], { facing: 'up' });
    expect(m.companion).not.toBeNull();
    expect(m.actionHint()?.key).toBe('npc:pan_marek'); // не цель — Казик не перехватывает
    m.setGoal({ key: BOBR_KEY, at: m.companion!.tile, size: [1, 1], viaExit: false });
    expect(m.companionIsGoal).toBe(true);
    expect(m.actionHint()?.key).toBe(BOBR_KEY);
    m.intent({ type: 'interact' });
    expect(of(run(m, 32), 'interact')[0]).toMatchObject({ kind: 'npc', id: 'bobr', key: BOBR_KEY, via: 'action' });
    // Тап по Казику: targetAt знает его клетку.
    expect(m.targetAt(m.companion!.tile)).toBe(BOBR_KEY);
  });

  it('никогда не стоит на клетке Димы: указатель уступает дорогу, путь обходит Диму', () => {
    const m = new LocationModel(room([{ type: 'npc', id: 'pan_marek', at: [7, 2] }]), [2, 4], { facing: 'right' });
    m.pointTo([5, 4], 'up');
    run(m, 2000);
    expect(m.companion!.tile).toEqual([5, 4]);
    // Дима идёт прямо через Казика.
    m.intent({ type: 'move', dir: 'right', held: true });
    for (let t = 0; t < 2000; t += 16) {
      m.update(16);
      const c = m.companion!;
      const cTo = c.step ? c.step.to : c.tile;
      const pTo = m.player.step ? m.player.step.to : m.player.tile;
      expect(cTo).not.toEqual(pTo);
      expect(c.tile).not.toEqual(m.player.tile);
    }
    m.intent({ type: 'move', dir: 'right', held: false });
  });

  it('указатель не идёт сквозь Диму: стоит Дима на пути — обходит', () => {
    const m = new LocationModel(room([]), [4, 4], { facing: 'down' });
    // Компаньон слева от Димы, цель справа — путь по прямой через Диму.
    m.companion!.tile = [3, 4];
    m.pointTo([6, 4]);
    for (let t = 0; t < 2000; t += 16) {
      m.update(16);
      expect(m.companion!.tile).not.toEqual(m.player.tile);
    }
    expect(m.companion!.tile).toEqual([6, 4]);
  });
});

describe('NPC-Казик и цель', () => {
  it('moveObject не ставит NPC на клетку Димы и туда, куда он шагает', () => {
    const dz = load('dzialka');
    const m = new LocationModel(dz, [9, 10], { facing: 'up' });
    expect(m.moveObject(BOBR_KEY, [9, 10])).toBe(false);
    m.intent({ type: 'move', dir: 'up', held: true });
    run(m, 50); // шаг начался: (9,10) → (9,9)
    expect(m.moveObject(BOBR_KEY, [9, 9])).toBe(false);
    expect(m.moveObject(BOBR_KEY, [10, 10])).toBe(true);
  });

  it('besideCell: сзади, потом сбоку, перед лицом — только если больше некуда; не на занятых клетках', () => {
    const grid = { w: 10, h: 10, passable: () => true };
    expect(besideCell(grid, [5, 5], 'up')).toEqual([5, 6]);
    expect(besideCell(grid, [5, 5], 'up', [[5, 6]])).toEqual([4, 5]);
    expect(besideCell(grid, [5, 5], 'right', [], [5, 4])).toEqual([5, 4]); // уже рядом сбоку — остаётся
    expect(besideCell(grid, [5, 5], 'right', [], [6, 5])).toEqual([4, 5]); // стоит перед лицом — уходит назад
    const walls = { w: 10, h: 10, passable: (x: number, y: number) => x === 5 && y === 4 };
    expect(besideCell(walls, [5, 5], 'up')).toEqual([5, 4]);
    expect(besideCell({ w: 10, h: 10, passable: () => false }, [5, 5], 'up')).toBeNull();
  });

  it('тап по цели: путь перегородили по дороге — новый путь, действие не теряется', () => {
    const map = room([{ type: 'trigger', id: 'tablica', at: [8, 1], on: 'tap', do: [] }]);
    const m = new LocationModel(map, [1, 6], { facing: 'up', companion: false });
    m.intent({ type: 'interact', target: m.targetAt([8, 1])! });
    run(m, 300);
    // Кто-то встал на путь (NPC-бобр пересел к цели): клетка впереди стала непроходимой.
    const next = (m as unknown as { path: [number, number][] }).path[0]!;
    (m as unknown as { objects: unknown[] }).objects.push({ key: 'npc:x', kind: 'npc', id: 'x', at: next, size: [1, 1], solid: true, src: { type: 'npc', id: 'x', at: next } });
    m.setHidden(['none']); // пересобрать твёрдые клетки
    const evs = run(m, 6000);
    expect(of(evs, 'interact')).toHaveLength(1);
    expect(of(evs, 'interact')[0]).toMatchObject({ id: 'tablica', via: 'tap' });
  });
});

describe('стрелка у края: видимая зона без HUD и d-pad', () => {
  it('цель под d-pad (низ экрана) — тоже «за краем», стрелка над крестом', () => {
    const view = { x: 0, y: 0, width: 200, height: 400 };
    const target = { x: 100, y: 380 };
    expect(edgeArrow(view, target, 4)).toBeNull();
    const inner = { x: 0, y: 32, width: 200, height: 400 - 32 - 74 };
    const a = edgeArrow(inner, target, 4)!;
    expect(a).not.toBeNull();
    expect(a.y).toBeLessThan(400 - 74);
  });
});

describe('склейка: «поговори: Kazik» без цели-объекта', () => {
  it('подсвечен Казик (guide:target npc bobr), тап по нему играет бит', async () => {
    const content = getContent();
    const T = Date.UTC(2026, 9, 16, 9);
    let now = T;
    const clock = { now: () => now, mono: () => now - T, offsetMs: 0 };
    const store = memStore();
    seedStoryDay(store as unknown as GameStorage, content, 2, now);
    store.append({ k: 'seg', ts: (now += 1000), seg: 'water' });
    const targets: (GuideTarget | null)[] = [];
    bus.on('guide:target', ({ target }) => void targets.push(target));
    const calls: string[] = [];
    const play = {
      busy: true,
      lines: async (ids: readonly string[]) => void calls.push(...ids.map((i) => `line:${i}`)),
      effects: async () => undefined,
      openLesson: async () => ({ cancelled: true }),
    } as unknown as Play;
    const day = { ui: { busy: false, obchod: async () => undefined, summary: async () => undefined }, activeMs: () => 0, refresh: async () => undefined } as unknown as DayGlue;
    const flow = startFlow({ content, store: Promise.resolve(store as never), clock, play, day, audio: { play: () => undefined, has: () => false } });
    bus.emit('link:ready', {} as never);
    await flush(6);
    bus.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
    await flush(6);
    const s = flow.step!;
    expect(s.kind).toBe('beat');
    expect(s.target.npc).toBeUndefined();
    expect(targets.at(-1)).toMatchObject({ location: 'ch01.dzialka', npc: 'bobr' });
    expect('beat.' + s.beat in store.progress.world.flags).toBe(false); // занят оверлеем — сам не сыграл
    (play as { busy: boolean }).busy = false;
    expect(flow.claim({ location: 'ch01.dzialka', kind: 'npc', id: 'bobr', key: BOBR_KEY, tile: [13, 4], via: 'action' })).toBe(true);
    await flush(6);
    expect(`beat.${s.beat}` in store.progress.world.flags).toBe(true);
  });
});
