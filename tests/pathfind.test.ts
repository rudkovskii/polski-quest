// Поиск пути для тапа: BFS по 4 соседям, недостижимое → ближайшая достижимая.
import { describe, expect, it } from 'vitest';
import { around, findPath, pathToAdjacent, type Grid } from '../src/world/pathfind';

/** '#' = стена, остальное проходимо. */
function grid(rows: string[]): Grid {
  return { w: rows[0]!.length, h: rows.length, passable: (x, y) => rows[y]?.[x] !== undefined && rows[y]![x] !== '#' };
}

const steps = (p: readonly (readonly [number, number])[]): boolean =>
  p.every((c, i) => i === 0 || Math.abs(c[0] - p[i - 1]![0]) + Math.abs(c[1] - p[i - 1]![1]) === 1);

describe('findPath', () => {
  const g = grid(['.....', '.###.', '...#.', '.#...']);
  it('кратчайший путь без диагоналей, старт не входит', () => {
    const r = findPath(g, [0, 0], [4, 0]);
    expect(r.exact).toBe(true);
    expect(r.path).toHaveLength(4);
    expect(r.path.at(-1)).toEqual([4, 0]);
    expect(steps([[0, 0], ...r.path])).toBe(true);
  });
  it('обходит стены', () => {
    const r = findPath(g, [0, 2], [4, 2]);
    expect(r.exact).toBe(true);
    expect(r.path.at(-1)).toEqual([4, 2]);
    expect(r.path.some(([x, y]) => g.passable(x, y) === false)).toBe(false);
    expect(r.path).toHaveLength(6); // под стеной (3,2): (1,2) (2,2) (2,3) (3,3) (4,3) (4,2)
  });
  it('уже на месте → пустой путь', () => {
    expect(findPath(g, [2, 2], [2, 2])).toEqual({ path: [], end: [2, 2], exact: true });
  });
  it('цель в стене → к ближайшей достижимой клетке', () => {
    const r = findPath(g, [0, 0], [2, 1]);
    expect(r.exact).toBe(false);
    const d = Math.abs(r.end[0] - 2) + Math.abs(r.end[1] - 1);
    expect(d).toBe(1);
    expect(g.passable(r.end[0], r.end[1])).toBe(true);
  });
  it('закрытая комната → ближайшая к ней клетка снаружи', () => {
    const h = grid(['......', '.###..', '.#.#..', '.###..']);
    const r = findPath(h, [5, 3], [2, 2]);
    expect(r.exact).toBe(false);
    expect(Math.abs(r.end[0] - 2) + Math.abs(r.end[1] - 2)).toBe(2);
  });
  it('вне карты → не падает', () => {
    expect(findPath(g, [0, 0], [99, 99]).exact).toBe(false);
  });
});

describe('pathToAdjacent', () => {
  it('подходит к соседней клетке объекта, не заходя в него', () => {
    const g = grid(['.....', '..#..', '.....']);
    const r = pathToAdjacent(g, [0, 0], [2, 1]);
    expect(r.exact).toBe(true);
    const [x, y] = r.end;
    expect(Math.abs(x - 2) + Math.abs(y - 1)).toBe(1);
    expect(r.path).toHaveLength(2); // (1,0) → (2,0)
  });
  it('уже рядом → пустой путь', () => {
    const g = grid(['...', '.#.', '...']);
    expect(pathToAdjacent(g, [1, 0], [1, 1])).toMatchObject({ path: [], exact: true });
  });
  it('многоклеточный объект: любая клетка по периметру', () => {
    expect(around([2, 2], [2, 1])).toEqual(
      expect.arrayContaining([[2, 1], [3, 1], [2, 3], [3, 3], [1, 2], [4, 2]]),
    );
    const g = grid(['......', '......', '......']);
    const r = pathToAdjacent(g, [0, 0], [3, 1], [2, 1]);
    expect(r.exact).toBe(true);
    expect(r.path.at(-1)).toEqual([3, 0]);
  });
  it('к объекту не подойти → ближе всего к нему', () => {
    const g = grid(['..#..', '..#..', '..#..']);
    const r = pathToAdjacent(g, [0, 1], [4, 1]);
    expect(r.exact).toBe(false);
    expect(r.end).toEqual([1, 1]);
  });
});
