// Модель локации (ТЗ §2.7, §5.4–5.5, I-07, P-02): ходьба по intents (4,5 клетки/с, поворот на месте, удержание,
// очередь коротких нажатий), тап с путём, действие и «A»-пузырёк, грядки по клеткам, выходы, бобр, tap-режим.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LocationMap } from '../src/types/content';
import { pickZoom } from '../src/world/camera';
import { CELLS_PER_SEC, LocationModel, STEP_MS, TURN_MS, type WorldEvent } from '../src/world/location';

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
  it('скорость 4–5 клеток в секунду', () => {
    expect(CELLS_PER_SEC).toBeGreaterThanOrEqual(4);
    expect(CELLS_PER_SEC).toBeLessThanOrEqual(5);
    expect(STEP_MS).toBeCloseTo(1000 / CELLS_PER_SEC, 5);
  });
  it('удержание = идти, отпускание — стоп на клетке', () => {
    const m = new LocationModel(map(), [1, 3], { facing: 'right' });
    m.intent({ type: 'move', dir: 'right', held: true });
    run(m, 560); // 2 полных шага (444 мс) и начат 3-й
    m.intent({ type: 'move', dir: 'right', held: false });
    run(m, 400);
    expect(m.player.tile).toEqual([4, 3]); // начатый шаг доходит до клетки
    expect(m.moving).toBe(false);
  });
  it('удержание без пауз: шаги идут встык, остаток времени переходит в следующий шаг', () => {
    const m = new LocationModel(map(), [1, 3], { facing: 'right' });
    m.intent({ type: 'move', dir: 'right', held: true });
    m.update(STEP_MS * 1.5);
    expect(m.player.tile).toEqual([2, 3]);
    expect(LocationModel.pos(m.player)[0]).toBeCloseTo(2.5, 5);
  });
  it('короткое нажатие туда, куда смотрит, = один шаг; нажатие посреди шага ставится в очередь', () => {
    const m = new LocationModel(map(), [1, 3], { facing: 'right' });
    m.intent({ type: 'move', dir: 'right', held: true });
    m.intent({ type: 'move', dir: 'right', held: false });
    run(m, 50);
    m.intent({ type: 'move', dir: 'right', held: true });
    m.intent({ type: 'move', dir: 'right', held: false });
    run(m, 600);
    expect(m.player.tile).toEqual([3, 3]);
  });
  it('очередь коротких нажатий в разные стороны: каждое — шаг, без пауз на поворот', () => {
    const m = new LocationModel(map(), [2, 2], { facing: 'right' });
    m.intent({ type: 'move', dir: 'right', held: true });
    m.intent({ type: 'move', dir: 'right', held: false });
    m.update(30);
    m.intent({ type: 'move', dir: 'down', held: true });
    m.intent({ type: 'move', dir: 'down', held: false });
    run(m, STEP_MS * 2 + 50);
    expect(m.player.tile).toEqual([3, 3]);
    expect(m.player.facing).toBe('down');
  });
  it('короткое нажатие в другую сторону = поворот на месте без шага', () => {
    const m = new LocationModel(map(), [3, 3], { facing: 'down' });
    m.intent({ type: 'move', dir: 'left', held: true });
    run(m, TURN_MS / 2);
    m.intent({ type: 'move', dir: 'left', held: false });
    run(m, 500);
    expect(m.player.tile).toEqual([3, 3]);
    expect(m.player.facing).toBe('left');
  });
  it('удержание в другую сторону: поворот, через TURN_MS пошёл', () => {
    const m = new LocationModel(map(), [3, 3], { facing: 'down' });
    m.intent({ type: 'move', dir: 'left', held: true });
    m.update(TURN_MS - 10);
    expect(m.moving).toBe(false);
    expect(m.player.facing).toBe('left');
    m.update(20);
    expect(m.moving).toBe(true);
    m.intent({ type: 'move', dir: 'left', held: false });
    run(m, 400);
    expect(m.player.tile).toEqual([2, 3]);
  });
  it('смена направления на ходу: без остановки и без паузы на поворот', () => {
    const m = new LocationModel(map(), [1, 1], { facing: 'right' });
    m.intent({ type: 'move', dir: 'right', held: true });
    m.update(STEP_MS / 2);
    // Роутер: новое удержание (вниз), потом снятие старого (вправо).
    m.intent({ type: 'move', dir: 'down', held: true });
    m.intent({ type: 'move', dir: 'right', held: false });
    m.update(STEP_MS / 2 + STEP_MS / 4); // шаг вправо дошёл, следующий вниз уже идёт
    expect(m.player.tile).toEqual([2, 1]);
    expect(m.player.step?.to).toEqual([2, 2]);
    expect(LocationModel.pos(m.player)[1]).toBeCloseTo(1.25, 5);
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
    const m = new LocationModel(map(), [1, 3], { facing: 'right' });
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
    const m = new LocationModel(map(), [6, 3], { facing: 'up' });
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
      const evs = run(m, TURN_MS + 20); // поворот, если смотрел не туда, и шаг
      m.intent({ type: 'move', dir, held: false });
      return [...evs, ...run(m, 300)];
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

describe('tap-локация (режим остался для карт-меню)', () => {
  const tapMap = map({
    controls: 'tap',
    objects: [
      { type: 'plot', id: 'grzadki', at: [1, 1], size: [3, 2] },
      { type: 'npc', id: 'bobr', at: [5, 2], facing: 'left' },
      { type: 'trigger', id: 'altana_sleep', at: [5, 4], on: 'tap', do: [] },
      { type: 'exit', at: [3, 5], to: 'ch01.metro', spawn: 'from_dzialka' },
    ],
  });
  it('ходьбы нет: move и goto игнорируются', () => {
    const m = new LocationModel(tapMap, [3, 4]);
    m.intent({ type: 'move', dir: 'up', held: true });
    m.intent({ type: 'goto', tile: [3, 3] });
    run(m, 1000);
    expect(m.player.tile).toEqual([3, 4]);
    expect(m.actionHint()).toBeNull(); // «A»-пузырька в tap-режиме нет
  });
  it('тап по грядке: interact с клеткой грядки; по траве — не цель; по выходу — переход', () => {
    const m = new LocationModel(tapMap, [3, 4]);
    const target = m.targetAt([2, 2]);
    expect(target).toBe('plot:grzadki@2,2');
    m.intent({ type: 'interact', target: target! });
    expect(of(run(m, 16), 'interact')[0]).toMatchObject({ kind: 'plot', id: 'grzadki', tile: [2, 2], via: 'tap' });
    expect(m.targetAt([4, 3])).toBeNull();
    m.intent({ type: 'interact', target: m.targetAt([3, 5])! });
    expect(of(run(m, 16), 'exit')[0]).toMatchObject({ to: 'ch01.metro' });
  });
  it('Tab/стрелки двигают выделение, Enter = interact выделенного', () => {
    const m = new LocationModel(tapMap, [3, 4]);
    m.intent({ type: 'focus', dir: 'next' });
    expect(m.highlight()?.key).toBe('plot:grzadki');
    m.intent({ type: 'focus', dir: 'right' });
    expect(m.highlight()?.key).toBe('npc:bobr');
    m.intent({ type: 'interact' });
    expect(of(run(m, 16), 'interact')[0]).toMatchObject({ kind: 'npc', id: 'bobr', via: 'action' });
  });
});

describe('działka с ходьбой (P-02)', () => {
  const dz = JSON.parse(readFileSync('content/modules/ch01/maps/dzialka.json', 'utf8')) as LocationMap;
  const plot = dz.objects.find((o) => o.type === 'plot')!;
  const [px0, py0] = plot.at;
  const cell = (x: number, y: number) => ({ at: [px0 + x, py0 + y] as [number, number] });
  const garden = [{ ...cell(0, 0), item: 'lx.woda' }, { ...cell(1, 0), item: 'lx.kawa' }, cell(2, 0), cell(3, 0)];

  it('карта ходьбы: d-pad, а не тап; стрелками доходишь от калитки до грядок', () => {
    expect(dz.controls).toBe('walk');
    const m = new LocationModel(dz, dz.spawns.default as [number, number], { facing: 'up' });
    m.intent({ type: 'move', dir: 'up', held: true });
    run(m, 3000);
    expect(m.player.tile[1]).toBeLessThan(dz.spawns.default![1]!);
  });
  it('A у грядки: подойти, повернуться к клетке — полив именно этого растения', () => {
    // Встать под клеткой «lx.kawa» (на клетку ниже грядки) и посмотреть вверх.
    const below: [number, number] = [px0 + 1, py0 + plot.size![1]!];
    const m = new LocationModel(dz, below, { facing: 'left' });
    m.setGarden(garden.map((c) => ({ ...c, at: [c.at[0], c.at[1] + plot.size![1]! - 1] as [number, number] })), 0);
    m.intent({ type: 'move', dir: 'up', held: true });
    m.intent({ type: 'move', dir: 'up', held: false }); // короткое: только поворот
    run(m, 200);
    expect(m.player.tile).toEqual(below);
    expect(m.actionHint()).toEqual({ key: 'plot:grzadki', tile: [px0 + 1, py0 + plot.size![1]! - 1] });
    m.intent({ type: 'interact' });
    expect(of(run(m, 16), 'interact')[0]).toMatchObject({ kind: 'plot', id: 'grzadki', via: 'action', tile: [px0 + 1, py0 + plot.size![1]! - 1] });
  });
  it('A по пустой клетке: без семян — не цель (нет пузырька), с семенем — посадка', () => {
    const m = new LocationModel(dz, [px0 + 2, py0 - 1], { facing: 'down' });
    m.setGarden(garden, 0);
    expect(m.actionHint()).toBeNull();
    m.intent({ type: 'interact' });
    expect(of(run(m, 16), 'interact')).toHaveLength(0);
    m.setGarden(garden, 1);
    expect(m.actionHint()).toEqual({ key: 'plot:grzadki', tile: [px0 + 2, py0] });
    m.intent({ type: 'interact' });
    expect(of(run(m, 16), 'interact')[0]).toMatchObject({ kind: 'plot', tile: [px0 + 2, py0], via: 'action' });
  });
  it('грядка — только перед лицом: соседнее растение сбоку A не поливает', () => {
    const m = new LocationModel(dz, [px0 + 1, py0 - 1], { facing: 'up' });
    m.setGarden(garden, 0);
    expect(m.actionHint()).toBeNull();
  });
  it('тап по растению вдали: дойти до соседней с ним клетки, повернуться, полить именно его', () => {
    const m = new LocationModel(dz, dz.spawns.default as [number, number]);
    m.setGarden(garden, 0);
    const t = m.targetAt([px0 + 1, py0]);
    expect(t).toBe(`plot:grzadki@${px0 + 1},${py0}`);
    m.intent({ type: 'interact', target: t! });
    const evs = of(run(m, 8000), 'interact');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: 'plot', tile: [px0 + 1, py0], via: 'tap' });
    const [x, y] = m.player.tile;
    expect(Math.abs(x - (px0 + 1)) + Math.abs(y - py0)).toBe(1); // рядом, не на ней
    const ahead = [x + { up: 0, down: 0, left: -1, right: 1 }[m.player.facing], y + { up: -1, down: 1, left: 0, right: 0 }[m.player.facing]];
    expect(ahead).toEqual([px0 + 1, py0]); // смотрит на неё
  });
  it('тап по пустой клетке без семян — просто дойти туда', () => {
    const m = new LocationModel(dz, dz.spawns.default as [number, number]);
    m.setGarden(garden, 0);
    expect(m.targetAt([px0 + 3, py0])).toBeNull();
  });
  it('берег — A перед ним; выход — шаг в калитку', () => {
    // P-10b: альтанка больше не триггер сна (спать только в хатке), A проверяем на береге Вислы.
    expect(dz.objects.some((o) => o.type === 'trigger' && o.id === 'altana_sleep')).toBe(false);
    const alt = dz.objects.find((o) => o.type === 'trigger' && o.id === 'ryby') as Extract<LocationMap['objects'][number], { type: 'trigger' }>;
    const m = new LocationModel(dz, [alt.at[0] - 1, alt.at[1]], { facing: 'right' });
    expect(m.actionHint()?.key).toBe('trigger:ryby');
    const ex = dz.objects.find((o) => o.type === 'exit')!;
    const m2 = new LocationModel(dz, [ex.at[0], ex.at[1] - 1], { facing: 'down' });
    m2.intent({ type: 'move', dir: 'down', held: true });
    expect(of(run(m2, 600), 'exit')[0]).toMatchObject({ to: 'ch01.metro' });
  });
});

describe('камера', () => {
  it('целый zoom: iPhone портрет — 2 (≈12 клеток в ширину), Mac 800×600 — 3, большой экран ≤ 4', () => {
    expect(pickZoom(393, 760, 320, 224)).toBe(2); // metro на iPhone
    expect(pickZoom(375, 812, 256, 256)).toBe(2); // działka на iPhone SE
    expect(pickZoom(430, 932, 256, 256)).toBe(2); // działka на iPhone Pro Max
    expect(pickZoom(800, 600, 256, 256)).toBe(3); // Mac, маленькое окно
    expect(pickZoom(1024, 768, 320, 224)).toBe(4);
    expect(pickZoom(2560, 1400, 160, 112)).toBe(4);
    expect(pickZoom(1440, 800, 1600, 1600)).toBe(4); // большая карта: база по короткой стороне, не крупнее 4
    expect(pickZoom(300, 300, 64, 64)).toBe(4); // крошечная карта растягивается, но не больше 4
  });
});
