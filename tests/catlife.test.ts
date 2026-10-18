import { describe, expect, it } from 'vitest';
import { CAT_FREE_AFTER_MS, CAT_LIFE_MAX, CAT_PAUSE_MAX_MS, CAT_PAUSE_MIN_MS, CAT_REACT_MAX_MS, CatLife, type LifeHost, type LifeOrder } from '../src/world/catLife';
import type { LocationModel } from '../src/world/location';
import { modelAt, press, release, run, seeded } from './helpers';

const cheb = (a: readonly number[], b: readonly number[]): number => Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!));
const man = (a: readonly number[], b: readonly number[]): number => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!);
const FREE_MODES = ['lie', 'sniff', 'crouch', 'pounce'];

/** Кот в покое стоит там, где не мешает: не дверь, не подход к двери, не клетка героя, не перед ним и не над ним. */
function badRest(m: LocationModel): string | null {
  const c = m.cat!;
  if (c.step) return null;
  const p = m.player;
  if (m.isExit(c.tile)) return 'на двери';
  if (m.objects.some((o) => o.kind === 'exit' && man(o.at, c.tile) === 1)) return 'на подходе к двери';
  if (c.tile[0] === p.tile[0] && c.tile[1] === p.tile[1]) return 'на клетке героя';
  const d = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as Record<string, [number, number]>)[p.facing]!;
  if (c.tile[0] === p.tile[0] + d[0] && c.tile[1] === p.tile[1] + d[1]) return 'перед героем';
  if (c.tile[0] === p.tile[0] && c.tile[1] === p.tile[1] - 1) return 'над героем';
  return null;
}

describe('кот занят своим, когда герой стоит', () => {
  it('до 3 с покоя держится рядом, потом уходит в свои дела в радиусе 3–5 клеток', () => {
    const m = modelAt('farm', [14, 7], 'down', 4);
    run(m, CAT_FREE_AFTER_MS - 200);
    expect(man(m.cat!.tile, m.player.tile)).toBeLessThanOrEqual(2);
    run(m, 400);
    let far = 0;
    let free = 0;
    for (let t = 0; t < 40_000; t += 16) {
      m.update(16);
      if (m.cat!.step === null && cheb(m.cat!.tile, m.player.tile) >= 3) far++;
      if (m.cat!.step === null) expect(cheb(m.cat!.tile, m.player.tile)).toBeLessThanOrEqual(CAT_LIFE_MAX);
      if (FREE_MODES.includes(m.cat!.mode)) free++;
    }
    expect(far).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
  });

  it('за 2 минуты пробует разные дела: умывается, нюхает, выслеживает, лежит, прыгает', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = modelAt('farm', [14, 10], 'down', seed);
      for (let t = 0; t < 120_000; t += 16) {
        m.update(16);
        seen.add(m.cat!.mode);
      }
    }
    for (const mode of ['wash', 'sniff', 'crouch', 'pounce', 'lie', 'sit', 'follow']) expect(seen.has(mode), mode).toBe(true);
  });

  it('герой пошёл: через 0,5–1 с кот бросает дело и идёт по следу', () => {
    const m = modelAt('farm', [14, 7], 'down', 4);
    for (let t = 0; t < 120_000 && !FREE_MODES.includes(m.cat!.mode) && m.cat!.mode !== 'wash'; t += 16) m.update(16);
    expect(['wash', ...FREE_MODES]).toContain(m.cat!.mode);
    press(m, 'right');
    run(m, 300);
    expect(m.cat!.mode).not.toBe('follow'); // ещё доигрывает
    run(m, CAT_REACT_MAX_MS);
    expect(m.cat!.mode).toBe('follow');
    run(m, 2500);
    expect(man(m.cat!.tile, m.player.tile)).toBeLessThanOrEqual(3);
    release(m, 'right');
  });

  it('короткий шаг героя тоже будит кота: дело брошено, даже если герой снова встал', () => {
    const m = modelAt('farm', [14, 7], 'down', 4);
    for (let t = 0; t < 120_000 && !FREE_MODES.includes(m.cat!.mode); t += 16) m.update(16);
    press(m, 'left');
    release(m, 'left');
    run(m, CAT_REACT_MAX_MS + 100);
    expect(FREE_MODES).not.toContain(m.cat!.mode);
  });

  it('запретные клетки соблюдает во всех делах: дверь, подходы, клетка героя, перед ним и над ним', () => {
    for (const [map, spawn, facing] of [['farm', 'house_door', 'up'], ['farm', [14, 10], 'down'], ['farm', [6, 8], 'right'], ['home', 'from_farm', 'up'], ['home', [6, 5], 'left']] as const) {
      for (const seed of [1, 2, 3]) {
        const m = modelAt(map, spawn as never, facing, seed);
        for (let t = 0; t < 60_000; t += 16) {
          m.update(16);
          expect(badRest(m), `${map} ${seed} t=${t}`).toBeNull();
        }
      }
    }
  });

  it('в мини-игре (автобег) кот держится рядом и своими делами не занят', () => {
    const m = modelAt('farm', [14, 7], 'down', 4);
    m.leash = true;
    for (let t = 0; t < 30_000; t += 16) {
      m.update(16);
      if (m.cat!.step === null) expect(man(m.cat!.tile, m.player.tile)).toBeLessThanOrEqual(2);
      expect(FREE_MODES).not.toContain(m.cat!.mode);
    }
  });

  it('детерминирован по seed', () => {
    const trace = (seed: number): string => {
      const m = modelAt('farm', [14, 10], 'down', seed);
      const out: string[] = [];
      for (let t = 0; t < 40_000; t += 160) {
        run(m, 160);
        out.push(`${m.cat!.tile}:${m.cat!.mode}`);
      }
      return out.join('|');
    };
    expect(trace(5)).toBe(trace(5));
    expect(trace(5)).not.toBe(trace(6));
  });

  it('иногда сидит на заборе и спрыгивает, когда герой пошёл', () => {
    let perched = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const m = modelAt('farm', [16, 10], 'down', seed);
      for (let t = 0; t < 120_000 && !perched; t += 16) {
        m.update(16);
        if (m.cat!.perch && !m.cat!.step) {
          perched = true;
          expect(m.passable(m.cat!.tile[0], m.cat!.tile[1])).toBe(false);
          press(m, 'up');
          release(m, 'up');
          run(m, CAT_REACT_MAX_MS + 800);
          expect(m.cat!.perch).toBeFalsy();
          expect(m.passable(m.cat!.tile[0], m.cat!.tile[1])).toBe(true);
        }
      }
      if (perched) break;
    }
    expect(perched).toBe(true);
  });

  it('в доме у радио, на ковре или у кровати, не только по центру комнаты', () => {
    const tiles = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = modelAt('home', [6, 5], 'down', seed);
      for (let t = 0; t < 8000; t += 16) {
        m.update(16);
        tiles.add(String(m.cat!.tile));
      }
    }
    expect(tiles.size).toBeGreaterThan(3);
  });
});

describe('CatLife: решения', () => {
  const host = (seed: number): LifeHost => ({
    rand: seeded(seed),
    hero: [10, 10],
    size: [28, 22],
    rest: () => true,
    places: () => [{ kind: 'sniff', stand: [12, 10], look: [13, 10] }],
  });

  it('все цели в радиусе 3–5 от героя, паузы между делами 3–8 с', () => {
    const h = host(3);
    const life = new CatLife();
    let at: readonly [number, number] = [11, 10];
    const kinds = new Set<string | null>();
    for (let n = 0; n < 60; n++) {
      let order: LifeOrder | null = life.tick(0, at, h);
      kinds.add(life.kind);
      let sit = 0;
      let guard = 0;
      while (life.active && guard++ < 5000) {
        if (order?.k === 'goto') {
          expect(cheb(order.cell, h.hero)).toBeLessThanOrEqual(CAT_LIFE_MAX);
          at = order.cell;
        } else if (order?.k === 'hop') at = order.cell;
        order = life.tick(100, at, h);
        sit += 100;
        if (sit > 120_000) break;
      }
      expect(guard).toBeLessThan(5000);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    expect(CAT_PAUSE_MIN_MS).toBe(3000);
    expect(CAT_PAUSE_MAX_MS).toBe(8000);
  });
});
