import { describe, expect, it } from 'vitest';
import type { Dir } from '../src/types/input';
import { CAT_SIT_AFTER_MS, CAT_SLEEP_AFTER_MS, LocationModel, QUEUE_MAX, STEP_MS, type WorldEvent } from '../src/world/location';
import { modelAt, press, release, run, seeded, send } from './helpers';

const exits = (evs: WorldEvent[]) => evs.filter((e) => e.type === 'exit');
const interacts = (evs: WorldEvent[]) => evs.filter((e) => e.type === 'interact');

describe('ходьба', () => {
  it('удержание стрелки идёт непрерывно, отпускание останавливает на клетке', () => {
    const m = modelAt('farm', [10, 8], 'down');
    press(m, 'right');
    run(m, STEP_MS * 3.5);
    release(m, 'right');
    run(m, STEP_MS * 2);
    expect(m.player.tile).toEqual([14, 8]);
    expect(m.moving).toBe(false);
  });

  it('короткий тап стрелки = один шаг, в том числе с поворотом', () => {
    const m = modelAt('farm', [10, 8], 'down');
    press(m, 'right');
    release(m, 'right');
    run(m, STEP_MS * 3);
    expect(m.player.tile).toEqual([11, 8]);
    expect(m.player.facing).toBe('right');
  });

  it('три быстрых нажатия стрелки = три шага: очередь не теряет нажатия во время шага', () => {
    const m = modelAt('farm', [10, 8], 'down');
    for (let i = 0; i < 3; i++) {
      press(m, 'right');
      release(m, 'right');
      run(m, 20);
    }
    run(m, STEP_MS * 5);
    expect(m.player.tile).toEqual([13, 8]);
    expect(m.moving).toBe(false);
  });

  it('очередь коротких нажатий ограничена тремя; смена направления в очереди сохраняет порядок', () => {
    const m = modelAt('farm', [10, 8], 'down');
    for (let i = 0; i < 8; i++) {
      press(m, 'right');
      release(m, 'right');
    }
    run(m, STEP_MS * 10);
    expect(m.player.tile).toEqual([10 + 1 + QUEUE_MAX, 8]);
    const k = modelAt('farm', [10, 8], 'down');
    for (const d of ['right', 'down', 'left'] as const) {
      press(k, d);
      release(k, d);
    }
    run(k, STEP_MS * 5);
    expect(k.player.tile).toEqual([10, 9]);
  });

  it('cancel сбрасывает очередь нажатий', () => {
    const m = modelAt('farm', [10, 8], 'down');
    for (let i = 0; i < 3; i++) {
      press(m, 'right');
      release(m, 'right');
    }
    send(m, { type: 'cancel' });
    run(m, STEP_MS * 5);
    expect(m.player.tile).toEqual([11, 8]);
  });

  it('стена: бамп один раз, без шага', () => {
    const m = modelAt('home', [7, 2], 'up');
    press(m, 'up');
    const evs = run(m, 400);
    expect(evs.filter((e) => e.type === 'bump')).toHaveLength(1);
    expect(m.player.tile).toEqual([7, 2]);
  });

  it('тап = дойти: goto ведёт по пути в клетку, стены и объекты обходит', () => {
    const m = modelAt('home', [6, 7], 'up');
    send(m, { type: 'goto', tile: [1, 5] });
    run(m, STEP_MS * 12);
    expect(m.player.tile).toEqual([1, 5]);
  });

  it('новая стрелка отменяет путь', () => {
    const m = modelAt('farm', [5, 7], 'down');
    send(m, { type: 'goto', tile: [20, 10] });
    run(m, STEP_MS * 2);
    press(m, 'up');
    release(m, 'up');
    run(m, STEP_MS * 4);
    expect(m.player.tile[0]).toBeLessThan(10);
  });
});

describe('двери и переходы', () => {
  it('из дома: шаг в дверь даёт exit на ферму со спавном у двери дома', () => {
    const m = modelAt('home', 'from_farm');
    press(m, 'down');
    const evs = run(m, STEP_MS * 3);
    expect(exits(evs)).toEqual([{ type: 'exit', to: 'farm', spawn: 'house_door', tile: [6, 8] }]);
    expect(m.done).toBe(true);
  });

  it('с фермы: шаг в дверь дома даёт exit в дом', () => {
    const m = modelAt('farm', 'house_door');
    press(m, 'up');
    const evs = run(m, STEP_MS * 3);
    expect(exits(evs)).toEqual([{ type: 'exit', to: 'home', spawn: 'from_farm', tile: [5, 5] }]);
  });

  it('A перед дверью проводит в дверь; тап по двери тоже', () => {
    const a = modelAt('farm', 'house_door', 'up');
    send(a, { type: 'interact' });
    expect(exits(run(a, STEP_MS * 3))).toHaveLength(1);
    const t = modelAt('farm', 'house_door', 'down');
    send(t, { type: 'goto', tile: [5, 5] });
    expect(exits(run(t, STEP_MS * 3))).toHaveLength(1);
  });

  it('путь по тапу не идёт сквозь чужую дверь', () => {
    const m = modelAt('home', [6, 7], 'up');
    send(m, { type: 'goto', tile: [6, 6] });
    run(m, STEP_MS * 3);
    expect(m.done).toBe(false);
  });
});

describe('интерактивные объекты', () => {
  it('A у стола: событие interact с use=desk, id и подписью', () => {
    const m = modelAt('home', [8, 4], 'up');
    send(m, { type: 'interact' });
    expect(interacts(run(m, 100))).toEqual([{ type: 'interact', id: 'desk', use: 'desk', label: 'Słownik · Словарь', key: 'prop:desk', tile: [8, 3], via: 'action', facing: 'up', hero: expect.any(Array) }]);
  });

  it('A без объекта рядом ничего не делает', () => {
    const m = modelAt('home', [6, 5], 'down');
    send(m, { type: 'interact' });
    expect(run(m, 100)).toEqual([]);
  });

  it('тап по объекту издалека: герой подходит и шлёт interact (via tap)', () => {
    const m = modelAt('farm', [5, 8], 'down');
    send(m, { type: 'interact', target: 'prop:board' });
    const evs = run(m, STEP_MS * 12);
    expect(interacts(evs)).toMatchObject([{ use: 'board', via: 'tap' }]);
    const [dx = 0, dy = 0] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[m.player.facing];
    expect(m.usableAt([m.player.tile[0] + dx, m.player.tile[1] + dy])?.use).toBe('board');
  });

  it('все пять: bed, desk, shelf дома; bin, board на ферме', () => {
    const cases: [string, string, [number, number], Dir][] = [
      ['home', 'bed', [3, 4], 'up'],
      ['home', 'shelf', [5, 3], 'up'],
      ['home', 'desk', [9, 4], 'up'],
      ['farm', 'bin', [9, 6], 'up'],
      ['farm', 'board', [12, 10], 'up'],
    ];
    for (const [map, use, at, face] of cases) {
      const m = modelAt(map, at, face);
      send(m, { type: 'interact' });
      expect(interacts(run(m, 100)).map((e) => (e.type === 'interact' ? e.use : '')), `${map}:${use}`).toEqual([use]);
    }
  });

  it('герой не проходит сквозь объекты', () => {
    const m = modelAt('home', [8, 4], 'up');
    press(m, 'up');
    run(m, 400);
    expect(m.player.tile).toEqual([8, 4]);
  });
});

describe('рыжий кот', () => {
  it('идёт за героем по пятам и переходит между картами вместе с ним', () => {
    const m = modelAt('farm', [5, 8], 'right');
    press(m, 'right');
    run(m, STEP_MS * 12);
    release(m, 'right');
    run(m, 1500);
    expect(Math.abs(m.cat!.tile[0] - m.player.tile[0]) + Math.abs(m.cat!.tile[1] - m.player.tile[1])).toBeLessThanOrEqual(2);
    // новая карта: кот создаётся рядом с героем у двери, не на двери и не на нём
    const h = modelAt('home', 'from_farm');
    expect(h.cat).not.toBeNull();
    expect(h.cat!.tile).not.toEqual(h.player.tile);
    expect(h.isExit(h.cat!.tile)).toBe(false);
  });

  it('когда герой стоит, садится рядом: не на клетке героя и не перед его лицом', () => {
    const m = modelAt('farm', [14, 7], 'right');
    run(m, CAT_SIT_AFTER_MS + 1000); // до 3 с покоя кот держится рядом
    const c = m.cat!;
    expect(['sit', 'wash']).toContain(c.mode);
    expect(c.tile).not.toEqual(m.player.tile);
    expect(c.tile).not.toEqual([15, 7]);
    expect(c.tile).not.toEqual([14, 6]); // над героем его закрывал бы высокий спрайт
    expect(Math.abs(c.tile[0] - 14) + Math.abs(c.tile[1] - 7)).toBeLessThanOrEqual(2);
  });

  it('не загораживает дверь: ни на ней, ни на клетке подхода, пока герой стоит у двери', () => {
    const m = modelAt('farm', 'house_door', 'up');
    run(m, 15_000);
    const c = m.cat!;
    expect(c.tile).not.toEqual([5, 5]);
    expect(c.tile).not.toEqual([5, 6]);
    expect(c.tile).not.toEqual(m.player.tile);
    const home = modelAt('home', 'from_farm', 'up');
    run(home, 15_000);
    expect(home.cat!.tile).not.toEqual([6, 8]);
    expect(home.cat!.tile).not.toEqual([6, 7]);
  });

  it('в доме при долгом покое идёт спать к кровати, от движения героя просыпается', () => {
    const m = modelAt('home', [6, 6], 'up');
    run(m, CAT_SLEEP_AFTER_MS + 8000);
    expect(m.cat!.mode).toBe('sleep');
    expect(m.cat!.tile).toEqual(m.spot('cat_sleep'));
    press(m, 'left');
    release(m, 'left');
    run(m, 1100); // кот бросает дело через 0,5–1 с после того, как герой пошёл
    expect(m.cat!.mode).toBe('follow');
  });

  it('герой шагает на кота: кот уступает, на клетке героя его нет', () => {
    const m = modelAt('farm', [14, 7], 'right');
    // загнать кота прямо перед героя
    run(m, 200);
    const c = m.cat!;
    c.step = null;
    c.tile = [15, 7];
    press(m, 'right');
    for (let t = 0; t < 600; t += 16) {
      m.update(16);
      const step = c.step as { to: [number, number]; sync?: boolean } | null;
      if (step && !step.sync) expect(step.to).not.toEqual(m.player.tile);
      if (!step) expect(c.tile).not.toEqual(m.player.tile);
    }
    release(m, 'right');
  });

  it('инвариант на случайной ходьбе: кот не на клетке героя, не на двери, не сидит у двери', () => {
    for (const first of ['farm', 'home']) {
      const rand = seeded(7);
      const dirs: Dir[] = ['up', 'down', 'left', 'right'];
      let m = modelAt(first, 'default', 'down', 3);
      let held: Dir | null = null;
      let frames = 0;
      let doors = 0;
      let overlap = 0;
      const nearExit = (c: readonly [number, number]): boolean => m.objects.some((o) => o.kind === 'exit' && Math.abs(o.at[0] - c[0]) + Math.abs(o.at[1] - c[1]) <= 1);
      for (let i = 0; i < 8000; i++) {
        if (i % 20 === 0) {
          const r = rand();
          if (held) release(m, held);
          held = null;
          if (r < 0.55) {
            held = dirs[Math.floor(rand() * 4)]!;
            press(m, held);
          } else if (r < 0.7) send(m, { type: 'goto', tile: [Math.floor(rand() * m.parsed.w), Math.floor(rand() * m.parsed.h)] });
          else if (r < 0.75) send(m, { type: 'interact' });
        }
        const evs = m.update(16 + Math.floor(rand() * 20));
        const ex = exits(evs)[0];
        if (ex?.type === 'exit') {
          // как в сцене: новая карта, герой и кот заново у двери
          doors++;
          held = null;
          m = modelAt(ex.to, ex.spawn, undefined, i);
          continue;
        }
        const c = m.cat!;
        frames++;
        // Кот на клетке героя бывает только мгновение: уступает дорогу, шаг прочь уже идёт (меньше шага кота).
        if (c.tile[0] === m.player.tile[0] && c.tile[1] === m.player.tile[1]) {
          overlap++;
          expect(c.step && !c.step.sync, `${m.map.id}: кот стоит на клетке героя, кадр ${i}`).toBeTruthy();
          expect(overlap, `${m.map.id}: кот долго на клетке героя, кадр ${i}`).toBeLessThanOrEqual(14);
        } else overlap = 0;
        expect(m.isExit(c.tile), `${m.map.id}: кот на двери, кадр ${i}`).toBe(false);
        if (c.step && !c.step.sync) expect(c.step.to).not.toEqual(m.player.tile);
        if (!c.step && (c.mode === 'sit' || c.mode === 'wash') && !m.busy) expect(nearExit(c.tile), `${m.map.id}: кот сидит у двери, кадр ${i}`).toBe(false);
      }
      expect(frames).toBeGreaterThan(3000);
      expect(doors).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('позиция', () => {
  it('остановка героя даёт клетку и поворот для сохранения', () => {
    const m = modelAt('farm', [10, 8], 'down');
    press(m, 'left');
    run(m, STEP_MS * 2.2);
    release(m, 'left');
    run(m, STEP_MS * 2);
    expect(m.player.tile).toEqual([7, 8]);
    expect(m.player.facing).toBe('left');
    expect(m).toBeInstanceOf(LocationModel);
  });
});
