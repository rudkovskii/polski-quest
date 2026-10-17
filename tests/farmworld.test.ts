import { describe, expect, it } from 'vitest';
import { modelAt, run, send } from './helpers';

describe('растения в мире', () => {
  it('автобег: герой встаёт сбоку от грядки; A у растения шлёт interact с use plant', () => {
    const m = modelAt('farm', [14, 12]);
    m.setPlants([{ id: 'w.kot', tile: [14, 15], label: 'kot' }, { id: 'w.pies', tile: [15, 15], label: 'pies' }]);
    expect(m.walkNear([14, 15])).toBe(true);
    run(m, 8000);
    expect(m.player.tile[1]).toBe(15);
    expect(Math.abs(m.player.tile[0] - 14)).toBe(1);
    m.faceTile([14, 15]);
    expect(m.walkNear([14, 15])).toBe(false);
    send(m, { type: 'interact' });
    const ev = run(m, 50).filter((e) => e.type === 'interact');
    expect(ev[0]).toMatchObject({ type: 'interact', use: 'plant', id: 'w.kot', label: 'kot' });
  });

  it('к коробке — ближайшая клетка рядом; растения проходимы', () => {
    const m = modelAt('farm', [12, 8]);
    const bin = m.object('prop:bin')!;
    m.walkNear(bin.at, bin.rects);
    run(m, 8000);
    expect(m.player.tile[1]).toBe(6);
    m.setPlants([{ id: 'w.kot', tile: [12, 14], label: 'kot' }]);
    expect(m.passable(12, 14)).toBe(true);
  });
});
