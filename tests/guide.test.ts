// @vitest-environment happy-dom
// Подсветка цели и бобр-указатель (I-13, ТЗ §4.12): world/guide.ts (цель → объект, путь, клетка бобра,
// стрелка у края), модель локации (скрытые объекты `if`, бобр идёт к цели), HUD-оверлей ui/guide.ts
// (строка «Сейчас», пузырь Казика один раз за шаг, todo только в dev, раскрытие, подсказка управления).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '../src/systems/content';
import type { GuideStepView, PlotView } from '../src/types/bus';
import type { LocationMap } from '../src/types/content';
import { mountGuide } from '../src/ui/guide';
import { edgeArrow, faceTowards, guidePath, pointerCell, resolveGuide } from '../src/world/guide';
import { LocationModel, STEP_MS } from '../src/world/location';
import { testBus } from './overlayKit';

const content = getContent();
const metro = content.maps.get('ch01.metro')!.value;
const dzialka = content.maps.get('ch01.dzialka')!.value;

describe('resolveGuide: цель шага → что подсветить', () => {
  it('NPC в этой локации', () => {
    const m = new LocationModel(metro, [9, 12]);
    expect(resolveGuide(m, { location: 'ch01.metro', npc: 'brzechwa' })).toEqual({ key: 'npc:brzechwa', at: [8, 8], size: [1, 1], viaExit: false });
  });
  it('цель в другой локации → выход туда', () => {
    const m = new LocationModel(dzialka, [5, 8]);
    expect(resolveGuide(m, { location: 'ch01.metro', npc: 'brzechwa' })).toMatchObject({ key: 'exit:5,9', viaExit: true });
  });
  it('объект по id (альтанка, берег)', () => {
    const m = new LocationModel(dzialka, [5, 8]);
    expect(resolveGuide(m, { location: 'ch01.dzialka', object: 'ryby' })).toMatchObject({ key: 'trigger:ryby', at: [9, 6], size: [2, 2] });
  });
  it('растение: клетка слова, иначе первая с «!», иначе вся грядка', () => {
    const m = new LocationModel(dzialka, [5, 8]);
    const plots: PlotView[] = [
      {
        plot: 'grzadki',
        cells: [
          { at: [2, 2], item: 'lx.a', stage: 'seed', interval: 0, due: false, wilted: false },
          { at: [3, 2], item: 'lx.b', stage: 'sprout', interval: 1, due: true, wilted: false },
        ],
      },
    ];
    expect(resolveGuide(m, { location: 'ch01.dzialka', plot: 'grzadki', item: 'lx.a' }, plots)?.at).toEqual([2, 2]);
    expect(resolveGuide(m, { location: 'ch01.dzialka', plot: 'grzadki' }, plots)?.at).toEqual([3, 2]);
    expect(resolveGuide(m, { location: 'ch01.dzialka', plot: 'grzadki' }, [])).toMatchObject({ at: [2, 2], size: [6, 3] });
  });
  it('скрытый объект (`if` ложно) не цель', () => {
    const m = new LocationModel(metro, [9, 12]);
    expect(resolveGuide(m, { location: 'ch01.metro', npc: 'brzechwa' }, [], new Set(['npc:brzechwa']))).toBeNull();
  });
});

describe('путь, бобр-указатель, стрелка', () => {
  it('путь пунктиром — первые 3 клетки к соседней с целью', () => {
    const m = new LocationModel(metro, [9, 12]);
    const g = resolveGuide(m, { location: 'ch01.metro', npc: 'brzechwa' })!;
    const p = guidePath(m.grid, [9, 12], g, 3);
    expect(p).toHaveLength(3);
    expect(p[0]).toEqual([9, 11]);
  });
  it('бобр встаёт рядом с целью, но не туда, куда придёт Дима', () => {
    const m = new LocationModel(metro, [9, 12]);
    const g = resolveGuide(m, { location: 'ch01.metro', npc: 'brzechwa' })!;
    const cell = pointerCell(m.grid, g, [9, 12], [9, 11])!;
    const dist = Math.abs(cell[0] - 8) + Math.abs(cell[1] - 8);
    expect(dist).toBe(1);
    expect(cell).not.toEqual([8, 9]); // сюда придёт Дима (ближайшая к нему соседняя клетка)
    expect(faceTowards(cell, g.at, g.size)).toBe(cell[0] > 8 ? 'left' : cell[0] < 8 ? 'right' : cell[1] > 8 ? 'up' : 'down');
  });
  it('стрелка у края: цель в кадре — нет, за кадром — точка на краю в её сторону', () => {
    const view = { x: 0, y: 0, width: 100, height: 100 };
    expect(edgeArrow(view, { x: 50, y: 50 }, 8)).toBeNull();
    const a = edgeArrow(view, { x: 300, y: 50 }, 8)!;
    expect(a.x).toBeCloseTo(92);
    expect(a.y).toBeCloseTo(50);
    expect(a.angle).toBeCloseTo(0);
    const b = edgeArrow(view, { x: 50, y: -200 }, 8)!;
    expect(b.y).toBeCloseTo(8);
    expect(b.angle).toBeCloseTo(-Math.PI / 2);
  });
});

describe('модель локации: скрытые объекты и бобр-указатель', () => {
  const room: LocationMap = {
    id: 't.room',
    title: { pl: 'x', ru: 'x' },
    tileset: 'ninja16',
    controls: 'walk',
    size: [8, 6],
    defaultGround: '.',
    legend: { '.': { tile: 'floor' }, '#': { tile: 'wall', solid: true } },
    layers: { ground: ['########', '#......#', '#......#', '#......#', '#......#', '########'] },
    spawns: { default: [1, 4] },
    objects: [{ type: 'npc', id: 'pan_marek', at: [6, 1], facing: 'down', if: { flag: 'x' } }],
  };
  it('скрытый NPC не цель действия и не стена', () => {
    const m = new LocationModel(room, [5, 1]);
    expect(m.targetAt([6, 1])).toBe('npc:pan_marek');
    expect(m.passable(6, 1)).toBe(false);
    expect(m.setHidden(['npc:pan_marek'])).toBe(true);
    expect(m.setHidden(['npc:pan_marek'])).toBe(false);
    expect(m.targetAt([6, 1])).toBeNull();
    expect(m.passable(6, 1)).toBe(true);
  });
  it('бобр идёт к клетке у цели сам, Дима стоит; цель снята — снова следом', () => {
    const m = new LocationModel(room, [1, 4]);
    expect(m.companion).not.toBeNull();
    m.pointTo([5, 1], 'right');
    for (let t = 0; t < STEP_MS * 12; t += 16) m.update(16);
    expect(m.companion!.tile).toEqual([5, 1]);
    expect(m.companion!.facing).toBe('right');
    expect(m.player.tile).toEqual([1, 4]);
    m.pointTo(null);
    m.intent({ type: 'move', dir: 'right', held: true });
    for (let t = 0; t < STEP_MS + 20; t += 16) m.update(16);
    m.intent({ type: 'move', dir: 'right', held: false });
    for (let t = 0; t < STEP_MS * 2; t += 16) m.update(16);
    // Догнал: стоит вплотную позади Димы (клетка, с которой тот ушёл).
    const [px, py] = m.player.tile;
    expect(m.companion!.tile).toEqual([px - 1, py]);
  });
  it('объект можно переставить (бобр на działce садится у грядки)', () => {
    const m = new LocationModel(dzialka, [5, 8]);
    m.moveObject('npc:bobr', [3, 5]);
    expect(m.object('npc:bobr')!.at).toEqual([3, 5]);
    expect(m.targetAt([3, 5])).toBe('npc:bobr');
  });
});

describe('ui/guide: строка «Сейчас», пузырь, раскрытие', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => root.remove());

  const view = (o: Partial<GuideStepView> = {}): GuideStepView => ({ key: 'water|', kind: 'water', label: 'полей грядки', here: true, reason: '5', line: 'kazik.water.due', ...o });

  it('строка «Сейчас» видна в локации; тап — guide:act, если цель здесь', () => {
    const bus = testBus();
    const acts: string[] = [];
    bus.on('guide:act', ({ key }) => acts.push(key));
    mountGuide(root, { bus, content });
    bus.emit('guide:step', { step: view() });
    const now = root.querySelector<HTMLElement>('.pq-now')!;
    expect(now.hidden).toBe(true); // ещё Title: мира нет
    bus.emit('world:location', { id: 'ch01.dzialka', controls: 'tap' });
    expect(now.hidden).toBe(false);
    expect(now.textContent).toContain('Сейчас: полей грядки');
    now.querySelector<HTMLElement>('.bar')!.click();
    expect(acts).toEqual(['water|']);
    bus.emit('world:input', { enabled: false });
    expect(now.hidden).toBe(true); // открыт урок — строки нет
  });
  it('реплика бобра один раз за шаг; новый шаг — новая реплика', () => {
    const bus = testBus();
    mountGuide(root, { bus, content });
    bus.emit('world:location', { id: 'ch01.dzialka', controls: 'tap' });
    bus.emit('guide:step', { step: view() });
    const bubble = root.querySelector<HTMLElement>('.pq-bubble')!;
    expect(bubble.hidden).toBe(false);
    expect(bubble.dataset.line).toBe('kazik.water.due');
    bubble.click();
    expect(bubble.hidden).toBe(true);
    bus.emit('guide:step', { step: view() });
    expect(bubble.hidden).toBe(true); // тот же шаг — не повторяется
    bus.emit('guide:step', { step: view({ key: 'sleep|', kind: 'sleep', line: 'kazik.sleep' }) });
    expect(bubble.dataset.line).toBe('kazik.sleep');
  });
  it('реплика-заглушка (todo) в игре не показывается, в dev — [todo: id]', () => {
    const bus = testBus();
    mountGuide(root, { bus, content });
    bus.emit('world:location', { id: 'ch01.dzialka', controls: 'tap' });
    bus.emit('guide:step', { step: view({ key: 'done|', kind: 'done', line: 'kazik.done' }) });
    expect(root.querySelector<HTMLElement>('.pq-bubble')!.hidden).toBe(true);
    const root2 = document.createElement('div');
    document.body.append(root2);
    const bus2 = testBus();
    mountGuide(root2, { bus: bus2, content, dev: true });
    bus2.emit('world:location', { id: 'ch01.dzialka', controls: 'tap' });
    bus2.emit('guide:step', { step: view({ key: 'done|', kind: 'done', line: 'kazik.done', more3: true }) });
    expect(root2.querySelector('.pq-bubble')!.textContent).toContain('[todo: kazik.done]');
    const more: string[] = [];
    bus2.on('guide:more3', () => more.push('x'));
    root2.querySelector<HTMLElement>('[data-act=more3]')!.click();
    expect(more).toEqual(['x']);
    root2.remove();
  });
  it('раскрытие HUD: элемент data-hud получает анимацию, реплика — пузырём', () => {
    const bus = testBus();
    const btn = document.createElement('button');
    btn.dataset.hud = 'jars';
    root.append(btn);
    mountGuide(root, { bus, content });
    bus.emit('world:location', { id: 'ch01.dzialka', controls: 'tap' });
    bus.emit('guide:reveal', { element: 'jars', line: 'kazik.jar.first' });
    expect(btn.classList.contains('pq-reveal')).toBe(true);
    expect(root.querySelector<HTMLElement>('.pq-bubble')!.dataset.line).toBe('kazik.jar.first');
  });
  it('подсказка управления в walk-локации: пиктограмма клавиш (Mac) или пульс d-pad (телефон)', () => {
    const bus = testBus();
    mountGuide(root, { bus, content, hintMs: 10_000 });
    bus.emit('guide:step', { step: view({ key: 'intro|f3', kind: 'intro', f: 'f3', moveHint: true, line: 'kazik.move.first' }) });
    bus.emit('world:location', { id: 'ch01.metro', controls: 'walk' });
    expect(root.querySelector('[data-hint=move]')).not.toBeNull();
    const root2 = document.createElement('div');
    document.body.append(root2);
    const dpad = document.createElement('div');
    dpad.className = 'pq-dpad';
    document.body.append(dpad);
    const bus2 = testBus();
    mountGuide(root2, { bus: bus2, content, coarse: () => true, hintMs: 10_000 });
    bus2.emit('world:location', { id: 'ch01.metro', controls: 'walk' });
    bus2.emit('guide:step', { step: view({ key: 'intro|f3', kind: 'intro', f: 'f3', moveHint: true }) });
    expect(dpad.classList.contains('pq-dpad-pulse')).toBe(true);
    expect(root2.querySelector('[data-hint=move]')).toBeNull();
    root2.remove();
    dpad.remove();
  });
});
