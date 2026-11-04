import { describe, expect, it } from 'vitest';
import { MIN_AMBIENT, daylight, indoorLight, lightChanged } from '../src/systems/daylight';
import { patchBand } from '../src/world/ascii';
import { FxBudget } from '../src/world/fxBudget';
import { bakeLightmap, bakeVignette, bayer, LIGHT_STEPS } from '../src/world/lightmap';
import { lightsOf } from '../src/world/lights';

describe('свет суток', () => {
  it('полдень нейтральный: цвета арта как есть, ламп нет', () => {
    const d = daylight(12);
    expect(d.ambient).toEqual([1, 1, 1]);
    expect(d.lamps).toBe(0);
  });

  it('в любой час мир не темнее порога и каналы в 0–1', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const { ambient } = daylight(h);
      for (const v of ambient) {
        expect(v).toBeGreaterThanOrEqual(MIN_AMBIENT);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ночью лампы горят, свет заворачивается через сутки', () => {
    expect(daylight(23).lamps).toBe(1);
    expect(daylight(-1)).toEqual(daylight(23));
    expect(daylight(36)).toEqual(daylight(12));
  });

  it('вечером тень падает в другую сторону, чем утром', () => {
    expect(daylight(8).shadowX).toBeGreaterThan(0);
    expect(daylight(18.5).shadowX).toBeLessThan(0);
  });

  it('в доме свет ровнее, чем снаружи ночью', () => {
    expect(indoorLight(daylight(23)).ambient[0]).toBeGreaterThan(daylight(23).ambient[0]);
  });

  it('карту света пересобираем только при заметной смене', () => {
    expect(lightChanged(daylight(12), daylight(12.01))).toBe(false);
    expect(lightChanged(daylight(12), daylight(19))).toBe(true);
  });
});

describe('карта света', () => {
  it('без ламп — ровный окружающий свет, без растра', () => {
    const px = bakeLightmap(8, 8, [0.5, 0.55, 0.75], []);
    const first = [...px.slice(0, 4)];
    for (let i = 0; i < px.length; i += 4) expect([...px.slice(i, i + 4)]).toEqual(first);
    expect(first[3]).toBe(255);
    expect(first[0]! / 255).toBeCloseTo(Math.round(0.5 * LIGHT_STEPS) / LIGHT_STEPS, 2);
  });

  it('лампа светлее у центра, чем у края, и не выходит за 255', () => {
    const w = 40;
    const px = bakeLightmap(w, w, [0.5, 0.5, 0.5], [{ x: 20, y: 20, r: 18, color: [1, 1, 1], power: 2 }]);
    const at = (x: number, y: number): number => px[(y * w + x) * 4]!;
    expect(at(20, 20)).toBe(255);
    expect(at(20, 20)).toBeGreaterThan(at(34, 20));
    expect(at(1, 1)).toBeLessThan(at(20, 20));
  });

  it('виньетка: середина прозрачна, угол темнее', () => {
    const w = 60;
    const px = bakeVignette(w, w, 0.5, [0, 0, 0]);
    expect(px[(30 * w + 30) * 4 + 3]).toBe(0);
    expect(px[3]).toBeGreaterThan(40);
  });

  it('порог растра в 0–1', () => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(bayer(x, y)).toBeGreaterThan(0), expect(bayer(x, y)).toBeLessThan(1);
  });

  it('днём горит только открытый огонь; ночью и лампы', () => {
    const refs = [
      { key: 'prop:a', sprite: 'v3_lantern', x: 10, y: 10, cast: true },
      { key: 'prop:b', sprite: 'ks_kominek', x: 50, y: 10, cast: true },
    ];
    expect(lightsOf(refs, daylight(12), null)).toHaveLength(1);
    expect(lightsOf(refs, daylight(23), null)).toHaveLength(2);
    expect(lightsOf(refs, daylight(23), { x: 0, y: 0 })).toHaveLength(3);
  });
});

describe('запас по кадрам', () => {
  it('долгие медленные кадры убирают движение один раз; простой не считается', () => {
    const b = new FxBudget();
    let cuts = 0;
    for (let i = 0; i < 400; i++) if (b.tick(50, 15)) cuts++;
    expect(cuts).toBe(0);
    for (let i = 0; i < 400; i++) if (b.tick(50, 60)) cuts++;
    expect(cuts).toBe(1);
  });

  it('ровные 60 кадров эффекты не трогают', () => {
    const b = new FxBudget();
    for (let i = 0; i < 2000; i++) expect(b.tick(16.7, 60)).toBe(false);
  });
});

describe('мелочи', () => {
  it('пятна травы: все три тона есть, значения в пределах', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) seen.add(patchBand(x, y, 3));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

});
