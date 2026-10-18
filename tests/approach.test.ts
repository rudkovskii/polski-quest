// P1a: тап по объекту всегда ведёт на клетку подхода со стороны лица, поворачивает к объекту и открывает экран; тап по
// видимой части спрайта (выше клеток коллизии) попадает в объект; тап по двери проводит сквозь неё.
import { describe, expect, it } from 'vitest';
import sprites from '../public/atlas/sprites.json';
import type { Dir } from '../src/types/input';
import type { LocationMap } from '../src/types/map';
import { approachCells, DELTA, LocationModel, STEP_MS, type WorldEvent } from '../src/world/location';
import { getMap, resolveSpawn } from '../src/world/maps';
import { run, seeded, send } from './helpers';

const size = (id: string): [number, number] | undefined => (sprites as unknown as Record<string, { size: [number, number] }>)[id]?.size;

function at(map: string | LocationMap, spawn: string | [number, number], facing?: Dir): LocationModel {
  const m = typeof map === 'string' ? getMap(map) : map;
  const s = resolveSpawn(m, spawn, facing);
  return new LocationModel(m, s.tile, { facing: s.facing, rand: seeded(3), spriteSize: size });
}

const interacts = (evs: WorldEvent[]) => evs.filter((e): e is Extract<WorldEvent, { type: 'interact' }> => e.type === 'interact');

/** Тап по объекту и дождаться: ровно одно interact, герой на клетке лица, смотрит на объект. */
function tapAndCheck(map: string, use: string, start: [number, number] | string): void {
  const m = at(map, start, 'down');
  const key = `prop:${use}`;
  const o = m.object(key)!;
  send(m, { type: 'interact', target: key });
  const evs = run(m, STEP_MS * 40);
  const label = `${map}:${use} из ${JSON.stringify(start)}`;
  expect(interacts(evs).map((e) => e.use), label).toEqual([use]);
  expect(approachCells(o).face, label).toContainEqual(m.player.tile);
  const d = DELTA[m.player.facing];
  expect(m.usableAt([m.player.tile[0] + d[0], m.player.tile[1] + d[1]])?.key, label).toBe(key);
}

describe('тап по объекту: клетка подхода со стороны лица', () => {
  const home: [string, ([number, number] | string)[]][] = [
    ['bed', ['from_farm', [8, 2], [10, 7], [6, 3], [1, 7]]],
    ['shelf', ['from_farm', [8, 2], [1, 7], [10, 2], [3, 2]]],
    ['desk', ['from_farm', [8, 2], [10, 2], [1, 7], [7, 3], [10, 3]]],
  ];
  const farm: [string, ([number, number] | string)[]][] = [
    ['bin', ['house_door', [9, 4], [20, 15], [25, 3], [11, 5]]],
    ['board', ['house_door', [12, 8], [13, 8], [20, 15], [14, 18], [25, 3], [11, 9]]],
  ];
  for (const [use, starts] of home) it(`дом: ${use}`, () => starts.forEach((s) => tapAndCheck('home', use, s)));
  for (const [use, starts] of farm) it(`ферма: ${use}`, () => starts.forEach((s) => tapAndCheck('farm', use, s)));

  it('по умолчанию лицо снизу: стол — клетки под ним, не за ним у стены', () => {
    const o = at('home', 'from_farm').object('prop:desk')!;
    expect(approachCells(o).face).toEqual([
      [8, 4],
      [9, 4],
    ]);
    expect(approachCells(o).rest).toContainEqual([8, 2]);
  });

  it('уже на клетке лица: действие сразу, без шага', () => {
    const m = at('home', [9, 4], 'left');
    send(m, { type: 'interact', target: 'prop:desk' });
    expect(interacts(run(m, 50))).toMatchObject([{ use: 'desk', via: 'tap', facing: 'up' }]);
    expect(m.player.tile).toEqual([9, 4]);
  });

  it('стоит за столом и тапает: обходит стол к лицу', () => {
    const m = at('home', [8, 2], 'down');
    send(m, { type: 'interact', target: 'prop:desk' });
    const evs = run(m, STEP_MS * 12);
    expect(interacts(evs)).toHaveLength(1);
    expect(m.player.tile[1]).toBe(4);
  });

  it('клетки лица заняты: ближайшая другая сторона', () => {
    const map: LocationMap = {
      id: 't',
      name: 't',
      size: [6, 5],
      defaultGround: 'F',
      legend: { F: { tile: 'floor' } },
      layers: { ground: ['FFFFFF', 'FFFFFF', 'FFFFFF', 'FFFFFF', 'FFFFFF'] },
      spawns: { default: [0, 0, 'down'] },
      objects: [
        { type: 'prop', id: 'desk', use: 'desk', sprite: 'desk', at: [2, 1], size: [2, 1] },
        { type: 'prop', id: 'rock', sprite: 'rock', at: [1, 2], size: [4, 1] },
      ],
    };
    const m = at(map, [0, 0], 'down');
    send(m, { type: 'interact', target: 'prop:desk' });
    const evs = run(m, STEP_MS * 10);
    expect(interacts(evs)).toHaveLength(1);
    expect([
      [1, 1],
      [2, 0],
    ]).toContainEqual(m.player.tile);
  });
});

describe('тап по видимой части спрайта', () => {
  it('верх стола, полки, кровати, доски, коробки (выше клеток коллизии) — это объект', () => {
    const h = at('home', 'from_farm');
    expect(h.targetAtPoint(8.6, 2.4)).toBe('prop:desk');
    expect(h.targetAtPoint(5.5, 1.5)).toBe('prop:shelf');
    expect(h.targetAtPoint(3.5, 2.2)).toBe('prop:bed');
    expect(h.targetAtPoint(6.5, 6.5)).toBeNull();
    const f = at('farm', 'house_door');
    expect(f.targetAtPoint(12.4, 8.3)).toBe('prop:board');
    expect(f.targetAtPoint(10.2, 4.6)).toBe('prop:bin');
  });

  it('тап в верх стола из зала: герой встаёт перед столом и открывает его', () => {
    const m = at('home', 'from_farm', 'up');
    const key = m.targetAtPoint(8.5, 2.5)!;
    send(m, { type: 'interact', target: key });
    const evs = run(m, STEP_MS * 12);
    expect(interacts(evs).map((e) => e.use)).toEqual(['desk']);
    expect(m.player.tile[1]).toBe(4);
    expect(m.player.facing).toBe('up');
  });
});

describe('тап по двери', () => {
  it('снаружи: тап по двери в стене дома заводит в дом (с разных стартов)', () => {
    for (const start of ['house_door', [12, 8], [3, 7]] as const) {
      const m = at('farm', start as string | [number, number], 'down');
      for (const y of [5.5, 4.5, 3.6]) expect(m.targetAtPoint(5.5, y), `y=${y}`).toBe('exit:5,5');
      send(m, { type: 'interact', target: 'exit:5,5' });
      const evs = run(m, STEP_MS * 20);
      expect(evs.filter((e) => e.type === 'exit'), JSON.stringify(start)).toEqual([{ type: 'exit', to: 'home', spawn: 'from_farm', tile: [5, 5] }]);
    }
  });

  it('изнутри: тап по двери выводит на ферму', () => {
    for (const start of ['from_farm', [10, 2], [1, 7]] as const) {
      const m = at('home', start as string | [number, number], 'up');
      expect(m.targetAtPoint(6.5, 8.4)).toBe('exit:6,8');
      send(m, { type: 'interact', target: 'exit:6,8' });
      const evs = run(m, STEP_MS * 20);
      expect(evs.filter((e) => e.type === 'exit'), JSON.stringify(start)).toEqual([{ type: 'exit', to: 'farm', spawn: 'house_door', tile: [6, 8] }]);
    }
  });

  it('P4a: стена и крыша дома — дверь (раньше герой уходил за дом), трава рядом — нет', () => {
    const m = at('farm', 'house_door');
    expect(m.targetAtPoint(3.5, 5.5)).toBe('exit:5,5');
    expect(m.targetAtPoint(7.5, 2.2)).toBe('exit:5,5');
    expect(m.targetAtPoint(2.5, 5.5)).toBeNull();
    expect(m.targetAtPoint(5.5, 6.5)).toBeNull();
  });
});
