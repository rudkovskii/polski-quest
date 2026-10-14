// Модель локации (ТЗ §2.7, §5.4–5.5, I-07): ходьба по intents, тап с путём, действие, выходы, бобр, tap-режим.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LocationMap } from '../src/types/content';
import { pickZoom } from '../src/world/camera';
import { LocationModel, STEP_MS, type WorldEvent } from '../src/world/location';

const map = (over: Partial<LocationMap> = {}): LocationMap => ({
  id: 't.room',
  title: { pl: 'x', ru: 'x' },
  tileset: 'ninja16',
  controls: 'walk',
  size: [8, 6],
  defaultGround: '.',
  legend: { '.': { tile: 'floor' }, '#': { tile: 'wall', solid: true }, '=': { tile: 'stairs' } },
  layers: { ground: ['########', '#......#', '#......#', '#......#', '#......#', '###=####'] },
  spawns: { default: [3, 3] },
  objects: [
    { type: 'word', id: 'tablica', at: [1, 1], item: 'lx.wyjscie', ex: 'listen', sprite: 'sign_exit' },
    { type: 'npc', id: 'pan_marek', at: [6, 1], facing: 'down' },
    { type: 'trigger', id: 'mat', at: [5, 4], on: 'enter', do: [], once: true },
    { type: 'exit', at: [3, 5], to: 'ch01.dzialka', spawn: 'from_metro' },
  ],
  ...over,
});

const run = (m: LocationModel, ms: number): WorldEvent[] => {
  const out: WorldEvent[] = [];
  for (let t = 0; t < ms; t += 16) out.push(...m.update(16));
  return out;
};
const of = <T extends WorldEvent['type']>(evs: WorldEvent[], type: T) => evs.filter((e) => e.type === type) as Extract<WorldEvent, { type: T }>[];

describe('ходьба по intents', () => {
  it('удержание = 6 клеток в секунду, отпускание — стоп на клетке', () => {
    const m = new LocationModel(map(), [1, 3]);
    m.intent({ type: 'move', dir: 'right', held: true });
    run(m, 450);
    m.intent({ type: 'move', dir: 'right', held: false });
    run(m, 400);
    expect(m.player.tile).toEqual([4, 3]); // за 0,45 с начат 3-й шаг, он доходит до клетки
    expect(m.moving).toBe(false);
  });
  it('короткое нажатие = один шаг, нажатие посреди шага ставится в очередь', () => {
    const m = new LocationModel(map(), [1, 3]);
    m.intent({ type: 'move', dir: 'right', held: true });
    m.intent({ type: 'move', dir: 'right', held: false });
    run(m, 50);
    m.intent({ type: 'move', dir: 'right', held: true });
    m.intent({ type: 'move', dir: 'right', held: false });
    run(m, 600);
    expect(m.player.tile).toEqual([3, 3]);
  });
  it('стена: стоит, смотрит в стену, одно событие bump на нажатие', () => {
    const m = new LocationModel(map(), [1, 3]);
    m.intent({ type: 'move', dir: 'left', held: true });
    const evs = run(m, 500);
    expect(m.player.tile).toEqual([1, 3]);
    expect(m.player.facing).toBe('left');
    expect(of(evs, 'bump')).toHaveLength(1);
  });
  it('NPC и слово непроходимы', () => {
    const m = new LocationModel(map(), [6, 3]);
    m.intent({ type: 'move', dir: 'up', held: true });
    run(m, 1000);
    expect(m.player.tile).toEqual([6, 2]);
  });
  it('интерполяция: позиция между клетками во время шага', () => {
    const m = new LocationModel(map(), [1, 3]);
    m.intent({ type: 'move', dir: 'right', held: true });
    m.update(STEP_MS / 2);
    const [x] = LocationModel.pos(m.player);
    expect(x).toBeCloseTo(1.5, 5);
  });
});

describe('тап и путь', () => {
  it('goto: путь BFS до клетки', () => {
    const m = new LocationModel(map(), [1, 3]);
    m.intent({ type: 'goto', tile: [6, 4] });
    run(m, 2000);
    expect(m.player.tile).toEqual([6, 4]);
  });
  it('goto в стену → к ближайшей достижимой', () => {
    const m = new LocationModel(map(), [1, 3]);
    m.intent({ type: 'goto', tile: [7, 3] });
    run(m, 2000);
    expect(m.player.tile).toEqual([6, 3]);
  });
  it('move отменяет путь goto', () => {
    const m = new LocationModel(map(), [1, 3]);
    m.intent({ type: 'goto', tile: [6, 3] });
    run(m, 200);
    m.intent({ type: 'move', dir: 'down', held: true });
    m.intent({ type: 'move', dir: 'down', held: false });
    run(m, 1500);
    expect(m.player.tile[1]).toBe(4);
    expect(m.player.tile[0]).toBeLessThan(6);
  });
  it('тап по объекту вдали: подойти, развернуться, interact', () => {
    const m = new LocationModel(map(), [5, 4 - 1]);
    m.intent({ type: 'interact', target: 'word:tablica' });
    const evs = run(m, 3000);
    const it = of(evs, 'interact');
    expect(it).toHaveLength(1);
    expect(it[0]).toMatchObject({ kind: 'word', id: 'tablica', item: 'lx.wyjscie', ex: 'listen', via: 'tap', tile: [1, 1] });
    const [px, py] = m.player.tile;
    expect(Math.abs(px - 1) + Math.abs(py - 1)).toBe(1);
  });
});

describe('кнопка действия и подсветка', () => {
  it('действие с объектом перед Димой, иначе с соседним', () => {
    const m = new LocationModel(map(), [6, 2], { facing: 'left' });
    expect(m.highlight()).toEqual({ key: 'npc:pan_marek', tile: [6, 1] });
    m.intent({ type: 'interact' });
    const evs = run(m, 20);
    expect(of(evs, 'interact')[0]).toMatchObject({ kind: 'npc', id: 'pan_marek', via: 'action' });
    expect(m.player.facing).toBe('up');
  });
  it('нет соседей — нет события и нет подсветки', () => {
    const m = new LocationModel(map(), [3, 3]);
    expect(m.highlight()).toBeNull();
    m.intent({ type: 'interact' });
    expect(of(run(m, 20), 'interact')).toHaveLength(0);
  });
  it('во время шага подсветки нет, действие выполняется по приходу', () => {
    const m = new LocationModel(map(), [6, 3]);
    m.intent({ type: 'move', dir: 'up', held: true });
    m.intent({ type: 'move', dir: 'up', held: false });
    m.update(10);
    expect(m.highlight()).toBeNull();
    m.intent({ type: 'interact' });
    const evs = run(m, 300);
    expect(of(evs, 'interact')[0]).toMatchObject({ id: 'pan_marek' });
  });
});

describe('триггеры и выходы', () => {
  it('trigger on enter срабатывает при входе, once — один раз', () => {
    const m = new LocationModel(map(), [4, 4]);
    const go = (dir: 'left' | 'right'): WorldEvent[] => {
      m.intent({ type: 'move', dir, held: true });
      m.intent({ type: 'move', dir, held: false });
      return run(m, 300);
    };
    expect(of(go('right'), 'interact')).toMatchObject([{ kind: 'trigger', id: 'mat', via: 'enter' }]);
    go('left');
    expect(of(go('right'), 'interact')).toHaveLength(0);
  });
  it('шаг на выход → событие exit, дальше модель стоит', () => {
    const m = new LocationModel(map(), [3, 4]);
    m.intent({ type: 'move', dir: 'down', held: true });
    const evs = run(m, 1000);
    expect(of(evs, 'exit')).toEqual([{ type: 'exit', to: 'ch01.dzialka', spawn: 'from_metro', tile: [3, 5] }]);
    expect(m.done).toBe(true);
    expect(m.player.tile).toEqual([3, 5]);
  });
});

describe('бобр-компаньон', () => {
  it('в walk-локации идёт следом, на клетку, которую Дима покинул', () => {
    const m = new LocationModel(map(), [2, 3]);
    expect(m.companion).not.toBeNull();
    m.intent({ type: 'move', dir: 'right', held: true });
    run(m, 500);
    m.intent({ type: 'move', dir: 'right', held: false });
    run(m, 300);
    const [px, py] = m.player.tile;
    expect(m.companion!.tile).toEqual([px - 1, py]);
  });
  it('в tap-локации и там, где бобр стоит NPC, компаньона нет', () => {
    expect(new LocationModel(map({ controls: 'tap' }), [3, 3]).companion).toBeNull();
    const withBobr = map({ objects: [{ type: 'npc', id: 'bobr', at: [5, 2] }] });
    expect(new LocationModel(withBobr, [3, 3]).companion).toBeNull();
  });
});

describe('tap-локация (działka)', () => {
  const dz = JSON.parse(readFileSync('content/modules/ch01/maps/dzialka.json', 'utf8')) as LocationMap;
  it('ходьбы нет: move и goto игнорируются', () => {
    const m = new LocationModel(dz, [5, 8]);
    m.intent({ type: 'move', dir: 'up', held: true });
    m.intent({ type: 'goto', tile: [5, 6] });
    run(m, 1000);
    expect(m.player.tile).toEqual([5, 8]);
  });
  it('тап по грядке: interact с клеткой грядки', () => {
    const m = new LocationModel(dz, [5, 8]);
    const target = m.targetAt([4, 3]);
    expect(target).toBe('plot:grzadki@4,3');
    m.intent({ type: 'interact', target: target! });
    expect(of(run(m, 16), 'interact')[0]).toMatchObject({ kind: 'plot', id: 'grzadki', tile: [4, 3], via: 'tap' });
  });
  it('тап по пустой траве — не цель; по выходу — переход', () => {
    const m = new LocationModel(dz, [5, 8]);
    expect(m.targetAt([3, 6])).toBeNull();
    const ex = m.targetAt([5, 9]);
    m.intent({ type: 'interact', target: ex! });
    expect(of(run(m, 16), 'exit')[0]).toMatchObject({ to: 'ch01.metro', spawn: 'from_dzialka' });
  });
  it('Tab/стрелки двигают выделение, Enter = interact выделенного', () => {
    const m = new LocationModel(dz, [5, 8]);
    m.intent({ type: 'focus', dir: 'next' });
    expect(m.highlight()?.key).toBe('plot:grzadki');
    m.intent({ type: 'focus', dir: 'right' });
    expect(m.highlight()?.key).toBe('trigger:altana_sleep');
    m.intent({ type: 'focus', dir: 'down' });
    expect(m.highlight()?.key).toBe('npc:bobr');
    m.intent({ type: 'interact' });
    expect(of(run(m, 16), 'interact')[0]).toMatchObject({ kind: 'npc', id: 'bobr', via: 'action' });
  });
});

describe('камера', () => {
  it('целый zoom: iPhone портрет видит 300–400 px, маленькая карта растягивается, на Mac ≤ 4', () => {
    expect(pickZoom(393, 760, 320, 224)).toBe(1); // metro на iPhone
    expect(pickZoom(375, 812, 192, 160)).toBe(2); // działka на iPhone (край забора чуть обрезан)
    expect(pickZoom(1024, 768, 320, 224)).toBe(3);
    expect(pickZoom(2560, 1400, 160, 112)).toBe(4);
    expect(pickZoom(1440, 800, 1600, 1600)).toBe(2); // большая карта: база по короткой стороне
  });
});
