// @vitest-environment happy-dom
// P2b: первый выход из дома (тап по указателю над дверью), стрелка к цели за краем экрана, названия мини-игр по-русски,
// подпись растения не залипает после выхода из экрана/мини-игры/старта, коробка не закрыта головой героя.
import { describe, expect, it } from 'vitest';
import { approachCells, STEP_MS } from '../src/world/location';
import { LabelGate, PLANT_LABEL_MS } from '../src/world/labelGate';
import { edgePoint, mountGuide } from '../src/ui/hintsGuide';
import { MODE_NAME, STAGE_INFO } from '../src/ui/glossary';
import { mountBoard } from '../src/ui/board';
import { modelAt, run, send, testBus } from './helpers';

describe('первый выход из дома', () => {
  it('указатель висит над ковриком у двери: тап по нему выводит на ферму с первого раза', () => {
    for (const start of [[6, 7], [3, 3], [10, 2]] as [number, number][]) {
      const m = modelAt('home', start, 'up');
      // Клетка прямо над дверью — коврик; с указателем (doorZone) это дверь, без него — обычная ходьба.
      expect(m.targetAtPoint(6.5, 7.5)).toBeNull();
      const key = m.targetAtPoint(6.5, 7.5, { doorZone: true });
      expect(key, JSON.stringify(start)).toBe('exit:6,8');
      send(m, { type: 'interact', target: key! });
      const evs = run(m, STEP_MS * 20);
      expect(evs.filter((e) => e.type === 'exit')).toEqual([{ type: 'exit', to: 'farm', spawn: 'house_door', tile: [6, 8] }]);
    }
  });

  it('зона двери не трогает остальной пол', () => {
    const m = modelAt('home', [6, 7], 'up');
    expect(m.targetAtPoint(5.5, 7.5, { doorZone: true })).toBeNull();
    expect(m.targetAtPoint(6.5, 4.5, { doorZone: true })).toBeNull();
  });
});

describe('стрелка к цели за кадром', () => {
  const box = { l: 28, r: 347, t: 84, b: 662 };
  it('edgePoint: точка на границе прямоугольника по лучу к цели', () => {
    const p = edgePoint(100, 300, 1000, 0, box);
    expect(p).toEqual({ x: 347, y: 300 });
    const q = edgePoint(100, 300, 0, 1000, box);
    expect(q).toEqual({ x: 100, y: 662 });
    const d = edgePoint(100, 300, 500, 500, box);
    expect(d.x).toBeLessThanOrEqual(347);
    expect(d.y).toBeLessThanOrEqual(662);
    expect(Math.abs(d.x - 100 - (d.y - 300))).toBeLessThan(1e-6);
  });

  it('доска за нижним краем: стрелка стоит у края экрана и повёрнута к ней', () => {
    const bus = testBus();
    const root = document.createElement('div');
    document.body.append(root);
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true });
    mountGuide(root, { stage: () => 'board', done: () => undefined }, bus);
    bus.emit('fx:guide', { hero: { x: 100, y: 300 }, target: { x: 300, y: 1500 }, via: 'object' });
    const arrow = root.querySelector<HTMLElement>('[data-guide-arrow]')!;
    expect(arrow.hidden).toBe(false);
    expect(arrow.dataset.bob).toBeUndefined();
    expect(parseInt(arrow.style.top, 10)).toBe(812 - 150);
    expect(arrow.style.transform).toMatch(/rotate\(/);
    root.remove();
  });
});

describe('жаргон', () => {
  it('доска: названия игр по-русски, польское мелко; «кусты» заменены на «кустик»', () => {
    const root = document.createElement('div');
    const b = mountBoard(root, { counts: () => ({ words: 3, phrases: 0, assemble: 0 }), onPick: () => undefined });
    b.open();
    const txt = (m: number) => root.querySelector(`[data-mode="${m}"]`)!.textContent ?? '';
    expect(txt(1)).toContain('Польское слово → перевод');
    expect(txt(2)).toContain('Перевод → польское слово');
    expect(txt(3)).toContain('Собери фразу по-польски');
    expect(txt(4)).toContain('Собери фразу по-русски');
    expect(root.querySelector('[data-mode="1"] .board-pl')?.textContent).toBe(MODE_NAME[1].pl);
    expect(txt(3)).toContain('подрастут до ростка'); // P3a: правило — росток, не кустик
    expect(txt(3)).not.toMatch(/кусты/);
  });

  it('стадии: русские подписи и значки', () => {
    expect(Object.values(STAGE_INFO).map((s) => s.ru)).toEqual(['семечко', 'росток', 'кустик', 'урожай', 'перезрело — повтори']);
  });
});

describe('подпись растения', () => {
  it('после выхода из экрана/мини-игры/старта растение под боком молчит, пока герой не отойдёт и не вернётся', () => {
    const g = new LabelGate();
    g.arm();
    expect(g.show('p:kot@1,1', 0)).toBe(false);
    expect(g.show('p:kot@1,1', 100)).toBe(false);
    expect(g.show(null, 200)).toBe(false); // отошёл
    expect(g.show('p:kot@1,1', 300)).toBe(true);
    expect(g.show('p:kot@1,1', 300 + PLANT_LABEL_MS + 1)).toBe(false);
    // Мини-игра: подпись задания держится (sticky) даже после arm; после выхода — снова молчим.
    g.arm();
    expect(g.show('q:kot', 0, true)).toBe(true);
    g.arm();
    expect(g.show('p:pies@2,2', 10)).toBe(false);
    expect(g.show('p:kot@1,1', 20)).toBe(true); // другое растение подписывается
  });
});

describe('коробка урожая', () => {
  it('герой подходит сбоку: голова не закрывает её переднюю стенку', () => {
    const m = modelAt('farm', 'house_door');
    const o = m.object('prop:bin')!;
    const face = approachCells(o).face;
    expect(face.every(([x, y]) => x < o.at[0] && y === o.at[1])).toBe(true);
    send(m, { type: 'interact', target: 'prop:bin' });
    const evs = run(m, STEP_MS * 60);
    expect(evs.filter((e) => e.type === 'interact').map((e) => (e as { use: string }).use)).toEqual(['bin']);
    expect(m.player.facing).toBe('right');
  });
});
