// Карты дня 1 (P-05): вокзал, перрон, улица → базар, Висла, działka, хатка. Связность по ходьбе (от спавна прихода
// до цели сцены и до выхода дальше), выходы ведут в существующие спавны, выход закрыт флагом сцены, размер под iPhone.
import { describe, expect, it } from 'vitest';
import { getContent } from '../src/systems/content';
import { pickZoom, TILE } from '../src/world/camera';
import { LocationModel, type WorldEvent } from '../src/world/location';
import { findPath, pathToAdjacent } from '../src/world/pathfind';
import type { LocationMap, MapObject } from '../src/types/content';

const content = getContent();
const map = (id: string): LocationMap => content.maps.get(id)!.value;
const DAY1 = ['ch01.dworzec', 'ch01.peron', 'ch01.bazar', 'ch01.wisla', 'ch01.dzialka', 'ch01.chatka'];
const WALKED = ['ch01.dworzec', 'ch01.peron', 'ch01.bazar', 'ch01.wisla'];

const obj = (m: LocationMap, f: (o: MapObject) => boolean): MapObject => {
  const o = m.objects.find(f);
  if (!o) throw new Error(`${m.id}: нет объекта`);
  return o;
};
const byId = (m: LocationMap, id: string): MapObject => obj(m, (o) => 'id' in o && o.id === id);
const exitTo = (m: LocationMap, to: string): MapObject => obj(m, (o) => o.type === 'exit' && o.to === to);
const size = (o: MapObject): [number, number] => ('size' in o && o.size ? [o.size[0], o.size[1]] : [1, 1]);

/** Модель без скрытых объектов: всё, что откроется по ходу дня, уже открыто. */
const model = (id: string, spawn: string): LocationModel => {
  const m = map(id);
  return new LocationModel(m, m.spawns[spawn] as [number, number]);
};
/** Дойти до клетки рядом с объектом (NPC, триггер на твёрдом тайле) или на сам объект (выход, enter-триггер). */
const reach = (id: string, spawn: string, o: MapObject, onto = false): boolean => {
  const mm = model(id, spawn);
  const from = mm.player.tile;
  if (onto) return findPath(mm.grid, from, o.at as [number, number]).exact || (from[0] === o.at[0] && from[1] === o.at[1]);
  return pathToAdjacent(mm.grid, from, o.at as [number, number], size(o)).exact;
};

describe('карты дня 1', () => {
  it('все в биоме Praga; выходы ведут в существующие карты и спавны; спавны проходимы', () => {
    const praga = content.world.biomes.find((b) => b.id === 'praga')!;
    for (const id of DAY1) {
      expect(praga.locations, id).toContain(id);
      const m = map(id);
      expect(m.controls).toBe('walk');
      for (const [name, xy] of Object.entries(m.spawns)) expect(new LocationModel(m, xy as [number, number]).passable(xy[0]!, xy[1]!), `${id}.${name}`).toBe(true);
      for (const o of m.objects) {
        if (o.type !== 'exit') continue;
        const to = content.maps.get(o.to)?.value;
        expect(to, `${id} → ${o.to}`).toBeTruthy();
        expect(to!.spawns[o.spawn ?? 'default'], `${id} → ${o.to}:${o.spawn}`).toBeTruthy();
      }
    }
  });

  it('ногами от входа до цели сцены и до выхода дальше', () => {
    const d = map('ch01.dworzec');
    expect(reach('ch01.dworzec', 'start', byId(d, 'fotobudka'))).toBe(true);
    expect(reach('ch01.dworzec', 'start', exitTo(d, 'ch01.peron'), true)).toBe(true);
    const p = map('ch01.peron');
    expect(reach('ch01.peron', 'from_dworzec', byId(p, 'walizka'))).toBe(true);
    expect(reach('ch01.peron', 'from_dworzec', exitTo(p, 'ch01.bazar'), true)).toBe(true);
    const b = map('ch01.bazar');
    for (const id of ['tablica_bazar', 'kiosk', 'pani_hela']) expect(reach('ch01.bazar', 'from_peron', byId(b, id)), id).toBe(true);
    const gate = byId(b, 'wejscie_bazar');
    expect(reach('ch01.bazar', 'from_peron', { ...gate, at: [gate.at[0] + 2, gate.at[1]] } as MapObject, true)).toBe(true);
    expect(reach('ch01.bazar', 'from_peron', exitTo(b, 'ch01.wisla'), true)).toBe(true);
    const w = map('ch01.wisla');
    expect(reach('ch01.wisla', 'from_bazar', byId(w, 'bobr'))).toBe(true);
    expect(reach('ch01.wisla', 'from_bazar', exitTo(w, 'ch01.dzialka'), true)).toBe(true);
    const z = map('ch01.dzialka');
    for (const id of ['grzadki', 'kapelusz', 'brzechwa']) expect(reach('ch01.dzialka', 'from_wisla', byId(z, id)), id).toBe(true);
    expect(reach('ch01.dzialka', 'from_wisla', exitTo(z, 'ch01.chatka'), true)).toBe(true);
    expect(reach('ch01.chatka', 'from_dzialka', byId(map('ch01.chatka'), 'poslanie'))).toBe(true);
  });

  it('вход на базар: enter-триггер перекрывает весь проход в заборе', () => {
    const b = map('ch01.bazar');
    const gate = byId(b, 'wejscie_bazar');
    const mm = model('ch01.bazar', 'from_peron');
    const [x0, y] = gate.at;
    const [w] = size(gate);
    // Ряд забора: проходимы только клетки триггера.
    for (let x = 0; x < b.size[0]; x++) expect(mm.passable(x, y), `x=${x}`).toBe(x >= x0 && x < x0 + w);
  });

  it('выход с перрона закрыт, пока сцена с чемоданом не сыграна (if → скрыт)', () => {
    const m = map('ch01.peron');
    const walk = (hidden: string[]): WorldEvent[] => {
      const mm = new LocationModel(m, [8, 10]);
      mm.setHidden(hidden);
      mm.intent({ type: 'move', dir: 'down', held: true });
      const out: WorldEvent[] = [];
      for (let t = 0; t < 400; t += 16) out.push(...mm.update(16));
      return out;
    };
    const exits = m.objects.filter((o) => o.type === 'exit' && o.to === 'ch01.bazar').map((o) => `exit:${o.at[0]},${o.at[1]}`);
    expect(walk(exits).some((e) => e.type === 'exit')).toBe(false);
    expect(walk([]).find((e) => e.type === 'exit')).toMatchObject({ type: 'exit', to: 'ch01.bazar', spawn: 'from_peron' });
  });

  it('iPhone (zoom 2, 375×812): карта с ходьбой заполняет экран, пустоты по краям нет', () => {
    for (const id of WALKED) {
      const [w, h] = map(id).size;
      const zoom = pickZoom(375, 812, w * TILE, h * TILE);
      expect(zoom, id).toBe(2);
      expect(w * TILE * zoom, id).toBeGreaterThanOrEqual(375);
      expect(h * TILE * zoom, id).toBeGreaterThanOrEqual(812);
    }
  });
});
