import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LocationMap, PropObject } from '../src/types/map';
import { frameFor, parseAscii, tileLayers, type TilesetMeta } from '../src/world/ascii';
import { LocationModel, around, buildObjects } from '../src/world/location';
import { findPath } from '../src/world/pathfind';
import { MAPS, getMap, resolveSpawn, START } from '../src/world/maps';

const tileset = JSON.parse(readFileSync('public/atlas/farm.json', 'utf8')) as TilesetMeta;
const sprites = JSON.parse(readFileSync('public/atlas/sprites.json', 'utf8')) as Record<string, { size: [number, number] }>;

describe('карты: форма и ссылки', () => {
  it('три карты: дом, ферма и Zagroda (v2); старт на ферме', () => {
    expect(Object.keys(MAPS).sort()).toEqual(['farm', 'home', 'zagroda']);
    expect(START).toEqual({ map: 'farm', spawn: 'start' });
  });

  for (const [id, map] of Object.entries(MAPS)) {
    describe(id, () => {
      it('ASCII разбирается, каждый тайл легенды есть в тайлсете', () => {
        expect(map.id).toBe(id);
        const parsed = parseAscii(map);
        expect([parsed.w, parsed.h]).toEqual(map.size);
        const { ground } = tileLayers(tileset, map, parsed);
        expect(ground.flat().every((i) => i >= 0)).toBe(true);
        for (const [ch, e] of Object.entries(map.legend)) expect(tileset.tiles[e.tile], `легенда "${ch}" → ${e.tile}`).toBeTruthy();
      });

      it('спрайты объектов есть в атласе', () => {
        for (const o of map.objects) if (o.type === 'prop') expect(sprites[o.sprite], `${o.id}: ${o.sprite}`).toBeTruthy();
      });

      it('спавны на проходимых клетках, не на двери', () => {
        const m = new LocationModel(map, resolveSpawn(map, 'default').tile, { cat: false });
        for (const [name, s] of Object.entries(map.spawns)) {
          expect(m.passable(s[0], s[1]), `спавн ${name}`).toBe(true);
          expect(m.isExit([s[0], s[1]]), `спавн ${name} не дверь`).toBe(false);
        }
      });

      it('объекты внутри карты, id уникальны', () => {
        const ids = map.objects.map((o) => ('id' in o ? `${o.type}:${o.id}` : `exit:${o.at}`));
        expect(new Set(ids).size).toBe(ids.length);
        for (const o of buildObjects(map)) {
          expect(o.at[0] >= 0 && o.at[1] >= 0 && o.at[0] + o.size[0] <= map.size[0] && o.at[1] + o.size[1] <= map.size[1], o.key).toBe(true);
        }
      });

      it('все проходимые клетки связаны с точкой входа', () => {
        const m = new LocationModel(map, resolveSpawn(map, 'default').tile, { cat: false });
        const from = resolveSpawn(map, 'default').tile;
        const [w, h] = map.size;
        // Кроме клеток внутри забора вокруг грядок: туда тоже должен быть вход (ворота), поэтому проверяем всё.
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            if (!m.passable(x, y) || m.isExit([x, y])) continue;
            const r = findPath({ w, h, passable: (cx, cy) => m.passable(cx, cy) && !m.isExit([cx, cy]) }, from, [x, y]);
            expect(r.exact, `клетка ${x},${y} недостижима`).toBe(true);
          }
      });
    });
  }

  it('двери ведут друг к другу: шаг в дверь даёт спавн на другой карте, откуда видна обратная дверь', () => {
    for (const map of Object.values(MAPS)) {
      for (const o of map.objects) {
        if (o.type !== 'exit') continue;
        const to = getMap(o.to);
        expect(to.spawns[o.spawn], `${map.id} → ${o.to}:${o.spawn}`).toBeTruthy();
        const back = to.objects.find((x) => x.type === 'exit' && x.to === map.id);
        expect(back, `у ${o.to} нет двери обратно в ${map.id}`).toBeTruthy();
        // Спавн стоит рядом с обратной дверью, лицом в сторону от неё не обязательно, но рядом.
        const s = to.spawns[o.spawn]!;
        const d = Math.abs(s[0] - back!.at[0]) + Math.abs(s[1] - back!.at[1]);
        expect(d).toBeLessThanOrEqual(2);
      }
    }
  });

  it('интерактивные объекты: стол, доска, коробка, полка, кровать, радио; к каждому можно подойти', () => {
    // v2: карта Польши и календарь в доме, мачта и сезонная доска на ферме.
    const uses: Record<string, string> = { home: 'bed,calendar,desk,map,radio,shelf', farm: 'bin,board,mast,seasonBoard' };
    for (const [id, list] of Object.entries(uses)) {
      const map = getMap(id);
      const found = map.objects.filter((o): o is PropObject => o.type === 'prop' && !!o.use).map((o) => o.use);
      expect(found.sort()).toEqual(list.split(','));
      const m = new LocationModel(map, resolveSpawn(map, 'default').tile, { cat: false });
      for (const o of m.objects.filter((x) => x.use)) {
        const free = around(o.rects).filter(([x, y]) => m.passable(x, y));
        expect(free.length, `${o.key}: подходов`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('грядки: участок 6×4 из земли, с запасом на расширение внутри забора', () => {
    const farm = getMap('farm');
    const plot = farm.objects.find((o) => o.type === 'plot')!;
    if (plot.type !== 'plot') throw new Error();
    expect(plot.size).toEqual([6, 4]);
    const parsed = parseAscii(farm);
    for (let y = plot.at[1]; y < plot.at[1] + 4; y++) for (let x = plot.at[0]; x < plot.at[0] + 6; x++) expect(parsed.ground[y]![x]).toBe('s');
    expect(plot.reserve!.size[0] * plot.reserve!.size[1]).toBeGreaterThan(24);
  });

  it('карты удобны на iPhone: дом крупно (zoom 3, по высоте целиком, камера вдоль комнаты), ферма zoom 2', async () => {
    const { pickZoom } = await import('../src/world/camera');
    const home = getMap('home');
    const farm = getMap('farm');
    // Высота между HUD (52 + чёлка 47) и d-pad (148 + полоска 34).
    const usable = 844 - 52 - 47 - 148 - 34;
    expect(pickZoom(390, 844, home.size[0] * 16, home.size[1] * 16, usable)).toBe(3);
    expect(home.size[1] * 16 * 3).toBeLessThanOrEqual(usable);
    expect(390 / 48).toBeGreaterThanOrEqual(7.5);
    // iPhone SE тоже 3; телефон боком: по высоте не влезает — остаётся 2, целиком.
    expect(pickZoom(375, 667, home.size[0] * 16, home.size[1] * 16, 667 - 52 - 20 - 148)).toBe(3);
    expect(pickZoom(844, 390, home.size[0] * 16, home.size[1] * 16, 390 - 52 - 148)).toBe(2);
    expect(pickZoom(390, 844, farm.size[0] * 16, farm.size[1] * 16, usable)).toBe(2);
    expect(pickZoom(390, 844, farm.size[0] * 16, farm.size[1] * 16)).toBe(2);
    // Mac: целый масштаб, не больше 4
    expect([3, 4]).toContain(pickZoom(1440, 900, home.size[0] * 16, home.size[1] * 16));
  });

  it('P3b: кровать видна целиком при спавне на iPhone (дом zoom 3, камера у героя)', async () => {
    const home = getMap('home');
    const bed = home.objects.find((o) => o.type === 'prop' && o.id === 'bed') as { at: [number, number]; size: [number, number] };
    const spawn = home.spawns.default!;
    const viewW = 375 / 3;
    const mw = home.size[0] * 16;
    const cx = Math.min(Math.max(Math.round((spawn[0] + 0.5) * 16), viewW / 2), mw - viewW / 2);
    expect(bed.at[0] * 16).toBeGreaterThanOrEqual(cx - viewW / 2);
    expect((bed.at[0] + bed.size[0]) * 16).toBeLessThanOrEqual(cx + viewW / 2);
  });

  it('кадры автотайлов: фрейм находится для каждой клетки', () => {
    const farm = getMap('farm');
    const parsed = parseAscii(farm);
    for (let y = 0; y < parsed.h; y++) for (let x = 0; x < parsed.w; x++) expect(frameFor(tileset, farm as LocationMap, parsed.ground, x, y)).toBeGreaterThanOrEqual(0);
  });
});
