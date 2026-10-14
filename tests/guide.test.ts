// @vitest-environment happy-dom
// Подсветка цели и бобр-указатель (I-13, ТЗ §4.12): world/guide.ts (цель → объект, путь, клетка бобра,
// стрелка у края), модель локации (скрытые объекты `if`, бобр идёт к цели), HUD-оверлей ui/guide.ts
// (строка «Сейчас», пузырь Казика один раз за шаг, todo только в dev, раскрытие, подсказка управления).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getContent } from '../src/systems/content';
import type { GuideStepView, PlotView } from '../src/types/bus';
import type { LocationMap } from '../src/types/content';
import { BUBBLE_LINE_CHARS, bubblePages, mountGuide } from '../src/ui/guide';
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
    const m = new LocationModel(dzialka, [9, 13]);
    expect(resolveGuide(m, { location: 'ch01.metro', npc: 'brzechwa' })).toMatchObject({ key: 'exit:9,15', viaExit: true });
  });
  it('объект по id (альтанка, берег)', () => {
    const m = new LocationModel(dzialka, [9, 13]);
    expect(resolveGuide(m, { location: 'ch01.dzialka', object: 'ryby' })).toMatchObject({ key: 'trigger:ryby', at: [13, 9], size: [1, 2] });
  });
  it('растение: клетка слова, иначе первая с «!», иначе вся грядка', () => {
    const m = new LocationModel(dzialka, [9, 13]);
    const plots: PlotView[] = [
      {
        plot: 'grzadki',
        cells: [
          { at: [2, 6], item: 'lx.a', stage: 'seed', interval: 0, due: false, wilted: false },
          { at: [3, 6], item: 'lx.b', stage: 'sprout', interval: 1, due: true, wilted: false },
        ],
      },
    ];
    expect(resolveGuide(m, { location: 'ch01.dzialka', plot: 'grzadki', item: 'lx.a' }, plots)?.at).toEqual([2, 6]);
    expect(resolveGuide(m, { location: 'ch01.dzialka', plot: 'grzadki' }, plots)?.at).toEqual([3, 6]);
    expect(resolveGuide(m, { location: 'ch01.dzialka', plot: 'grzadki' }, [])).toMatchObject({ at: [2, 6], size: [6, 3] });
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
    const m = new LocationModel(dzialka, [9, 13]);
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

  const view = (o: Partial<GuideStepView> = {}): GuideStepView => ({ key: 'water|', kind: 'water', label: 'полей грядки', here: true, reason: '5', line: 'sys.kazik.obchod', ...o });

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
    expect(bubble.dataset.line).toBe('sys.kazik.obchod');
    for (let i = 0; i < 10 && !bubble.hidden; i++) bubble.click(); // тап листает страницы, после последней — гаснет
    expect(bubble.hidden).toBe(true);
    bus.emit('guide:step', { step: view() });
    expect(bubble.hidden).toBe(true); // тот же шаг — не повторяется
    bus.emit('guide:step', { step: view({ key: 'sleep|', kind: 'sleep', line: 'sys.kazik.sleep' }) });
    expect(bubble.dataset.line).toBe('sys.kazik.sleep');
  });
  it('реплика-заглушка (todo) в игре не показывается, в dev — [todo: id]', () => {
    // В контенте заглушек больше нет (P-06): своя реплика-todo.
    const withTodo = { ...content, lines: new Map([...content.lines, ['test.todo', { id: 'test.todo', who: 'bobr', todo: true }]]) } as typeof content;
    const bus = testBus();
    mountGuide(root, { bus, content: withTodo });
    bus.emit('world:location', { id: 'ch01.dzialka', controls: 'tap' });
    bus.emit('guide:step', { step: view({ key: 'done|', kind: 'done', line: 'test.todo' }) });
    expect(root.querySelector<HTMLElement>('.pq-bubble')!.hidden).toBe(true);
    const root2 = document.createElement('div');
    document.body.append(root2);
    const bus2 = testBus();
    mountGuide(root2, { bus: bus2, content: withTodo, dev: true });
    bus2.emit('world:location', { id: 'ch01.dzialka', controls: 'tap' });
    bus2.emit('guide:step', { step: view({ key: 'done|', kind: 'done', line: 'test.todo', more3: true }) });
    expect(root2.querySelector('.pq-bubble')!.textContent).toContain('[todo: test.todo]');
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
    bus.emit('guide:reveal', { element: 'jars', line: 'sys.kazik.jar.first' });
    expect(btn.classList.contains('pq-reveal')).toBe(true);
    expect(root.querySelector<HTMLElement>('.pq-bubble')!.dataset.line).toBe('sys.kazik.jar.first');
  });
  it('подсказка управления — только после 3 с без ввода: пиктограмма клавиш (Mac) или пульс d-pad и «A» (телефон)', () => {
    vi.useFakeTimers();
    try {
      const bus = testBus();
      mountGuide(root, { bus, content, hintMs: 10_000 });
      bus.emit('guide:step', { step: view({ key: 'intro|f3', kind: 'intro', f: 'f3', moveHint: true, line: 'kazik.move.first' }) });
      bus.emit('world:location', { id: 'ch01.metro', controls: 'walk' });
      expect(root.querySelector('[data-hint=move]')).toBeNull(); // сразу — нет
      vi.advanceTimersByTime(3100);
      const hint = root.querySelector<HTMLElement>('[data-hint=move]')!;
      expect(hint).not.toBeNull();
      // Текст совпадает с управлением на Mac: стрелки и WASD — идти, E и Пробел — действие.
      expect(hint.textContent).toContain('↑');
      expect(hint.textContent).toContain('W');
      expect(hint.textContent).toContain('E');
      expect(hint.textContent).toContain('действие');
      bus.emit('input:intent', { type: 'move', dir: 'up', held: true, to: 'world', source: 'keyboard' });
      expect(root.querySelector('[data-hint=move]')).toBeNull(); // пошёл — подсказка ушла

      const root2 = document.createElement('div');
      document.body.append(root2);
      const dpad = document.createElement('div');
      dpad.className = 'pq-dpad';
      document.body.append(dpad);
      const bus2 = testBus();
      mountGuide(root2, { bus: bus2, content, coarse: () => true, hintMs: 10_000 });
      bus2.emit('world:location', { id: 'ch01.metro', controls: 'walk' });
      bus2.emit('guide:step', { step: view({ key: 'intro|f3', kind: 'intro', f: 'f3', moveHint: true }) });
      expect(dpad.classList.contains('pq-dpad-pulse')).toBe(false);
      vi.advanceTimersByTime(3100);
      expect(dpad.classList.contains('pq-dpad-pulse')).toBe(true);
      expect(root2.querySelector<HTMLElement>('[data-hint=move]')!.dataset.mode).toBe('touch');
      expect(root2.textContent).toContain('Крестовина');
      root2.remove();
      dpad.remove();
    } finally {
      vi.useRealTimers();
    }
  });
  it('подсказки нет, если игрок пошёл в первые 3 с; второй вход на ту же карту — без подсказки', () => {
    vi.useFakeTimers();
    try {
      const bus = testBus();
      mountGuide(root, { bus, content });
      bus.emit('guide:step', { step: view({ key: 'intro|f2', kind: 'intro', f: 'f2', moveHint: true }) });
      bus.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
      vi.advanceTimersByTime(1000);
      bus.emit('input:intent', { type: 'move', dir: 'up', held: true, to: 'world', source: 'keyboard' });
      vi.advanceTimersByTime(10_000);
      expect(root.querySelector('[data-hint=move]')).toBeNull();
      bus.emit('world:location', { id: 'ch01.metro', controls: 'walk' });
      bus.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
      vi.advanceTimersByTime(3100);
      expect(root.querySelector('[data-hint=move]')).toBeNull(); // działka уже пройдена
    } finally {
      vi.useRealTimers();
    }
  });
  it('пока открыт урок, бездействие не считается', () => {
    vi.useFakeTimers();
    try {
      const bus = testBus();
      mountGuide(root, { bus, content });
      bus.emit('guide:step', { step: view({ key: 'intro|f3', kind: 'intro', f: 'f3', moveHint: true }) });
      bus.emit('world:location', { id: 'ch01.metro', controls: 'walk' });
      bus.emit('world:input', { enabled: false });
      vi.advanceTimersByTime(5000);
      expect(root.querySelector('[data-hint=move]')).toBeNull();
      bus.emit('world:input', { enabled: true });
      vi.advanceTimersByTime(3100);
      expect(root.querySelector('[data-hint=move]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ui/guide: пузырь Казика в мире, строка «Сейчас» первые 3 дня (P-02)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => root.remove());
  const view = (o: Partial<GuideStepView> = {}): GuideStepView => ({ key: 'water|', kind: 'water', label: 'полей грядки', here: true, reason: '5', line: 'sys.kazik.obchod', ...o });

  it('реплика режется на страницы до 2 строк', () => {
    const pages = bubblePages({ pl: 'Idziemy!', ru: 'Идём!', rus: 'Это не огурец, это слово. Подвяло - значит, пора вспомнить. Полей вот это одно, и пойдём дальше к реке, там тоже дела.' });
    expect(pages[0]).toEqual({ pl: 'Idziemy!', plRu: 'Идём!' });
    expect(pages.length).toBeGreaterThan(2);
    for (const p of pages.slice(1)) expect(p.rus!.length).toBeLessThanOrEqual(BUBBLE_LINE_CHARS * 2);
    expect(pages.slice(1).map((p) => p.rus).join(' ')).toBe('Это не огурец, это слово. Подвяло - значит, пора вспомнить. Полей вот это одно, и пойдём дальше к реке, там тоже дела.');
  });
  it('Казик на карте: пузырь над спрайтом (не модальный), без портрета; шаг Димы гасит его', () => {
    vi.useFakeTimers();
    try {
      const bus = testBus();
      mountGuide(root, { bus, content, bubbleMinMs: 500 });
      bus.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
      bus.emit('world:anchor', { id: 'bobr', at: { x: 200, y: 300 } });
      bus.emit('guide:step', { step: view() });
      const bubble = root.querySelector<HTMLElement>('.pq-bubble')!;
      expect(bubble.hidden).toBe(false);
      expect(bubble.classList.contains('world')).toBe(true);
      expect(bubble.querySelector('.pq-portrait')).toBeNull();
      expect(bubble.style.transform).toMatch(/translate\(/);
      bus.emit('world:anchor', { id: 'bobr', at: { x: 260, y: 300 } });
      expect(bubble.hidden).toBe(false);
      // Сразу после появления шаг не гасит (реплику начали читать), позже — гасит.
      bus.emit('input:intent', { type: 'move', dir: 'up', held: true, to: 'world', source: 'keyboard' });
      expect(bubble.hidden).toBe(false);
      vi.advanceTimersByTime(600);
      bus.emit('input:intent', { type: 'move', dir: 'up', held: true, to: 'world', source: 'keyboard' });
      expect(bubble.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('пузырь гаснет сам через N секунд', () => {
    vi.useFakeTimers();
    try {
      const bus = testBus();
      mountGuide(root, { bus, content });
      bus.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
      bus.emit('world:anchor', { id: 'bobr', at: { x: 200, y: 300 } });
      bus.emit('guide:step', { step: view() });
      const bubble = root.querySelector<HTMLElement>('.pq-bubble')!;
      expect(bubble.hidden).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(bubble.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('Казика на карте нет — пузырь с портретом в углу', () => {
    const bus = testBus();
    mountGuide(root, { bus, content });
    bus.emit('world:location', { id: 'ch01.metro', controls: 'walk' });
    bus.emit('world:anchor', { id: 'bobr', at: null });
    bus.emit('guide:step', { step: view() });
    const bubble = root.querySelector<HTMLElement>('.pq-bubble')!;
    expect(bubble.classList.contains('world')).toBe(false);
    expect(bubble.querySelector('.pq-portrait')).not.toBeNull();
  });
  it('первые 3 дня строки «Сейчас» нет; 10 с бездействия — появилась; ввод — снова спряталась', () => {
    vi.useFakeTimers();
    try {
      const bus = testBus();
      mountGuide(root, { bus, content });
      bus.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
      bus.emit('guide:step', { step: view({ nowHidden: true }) });
      const now = root.querySelector<HTMLElement>('.pq-now')!;
      expect(now.hidden).toBe(true);
      vi.advanceTimersByTime(9000);
      expect(now.hidden).toBe(true);
      vi.advanceTimersByTime(1100);
      expect(now.hidden).toBe(false);
      expect(now.textContent).toContain('полей грядки');
      bus.emit('input:intent', { type: 'move', dir: 'left', held: true, to: 'world', source: 'keyboard' });
      expect(now.hidden).toBe(true);
      // С 4-го дня — как раньше, видна сразу.
      bus.emit('guide:step', { step: view({ key: 'sleep|', kind: 'sleep' }) });
      expect(now.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

});
