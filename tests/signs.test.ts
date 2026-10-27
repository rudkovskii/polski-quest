// Таблички у интерактивных объектов карты (просьба Шэфа 27.10): каждый объект с `use` и каждая дверь подписаны на языке интерфейса,
// участки Zagroda — одной табличкой на группу; в версии «только язык» таблички убранных объектов пропадают вместе с ними.
import { describe, expect, it } from 'vitest';
import farm from '../content/maps/farm.json';
import home from '../content/maps/home.json';
import zagroda from '../content/maps/zagroda.json';
import type { LocationMap } from '../src/types/map';
import { languageOnlyMap } from '../src/world/maps';
import { signsOf, USE_SIGNS } from '../src/world/signs';

const ALL_MAPS: Record<string, LocationMap> = { farm: farm as unknown as LocationMap, home: home as unknown as LocationMap, zagroda: zagroda as unknown as LocationMap };
const h = (): number => 32;

describe('таблички объектов', () => {
  it('дом: все вещи и дверь подписаны по-русски, над своим объектом', () => {
    const s = signsOf(ALL_MAPS.home!, 16, h);
    expect(s.map((x) => x.text).sort()).toEqual(['Итог дня', 'Карта Польши', 'Кладовая', 'Месяцы и даты', 'Радио', 'Словарь', 'Ферма'].sort());
    const desk = s.find((x) => x.key === 'prop:desk')!;
    expect(desk.x).toBe(9 * 16);
    // Дверь в нижней стене — табличка под проёмом.
    expect(s.find((x) => x.text === 'Ферма')!.y).toBeGreaterThan(9 * 16);
  });

  it('каждый интерактивный объект на всех картах подписан; польский тоже есть', () => {
    for (const m of Object.values(ALL_MAPS))
      for (const o of m.objects) if (o.type === 'prop' && o.use && o.use !== 'zplot') expect(USE_SIGNS[o.use], `${m.id}:${o.id}`).toBeTruthy();
    expect(signsOf(ALL_MAPS.home!, 16, h, 'pl').find((x) => x.key === 'prop:desk')!.text).toBe('Słownik');
  });

  it('ферма: «Символы и гимн» у мачты, дверь в Zagroda; Zagroda — 4 таблички на группы, сад у дорожки', () => {
    const farm = signsOf(ALL_MAPS.farm!, 16, h).map((x) => x.text);
    expect(farm).toEqual(expect.arrayContaining(['Символы и гимн', 'Мини-игры', 'Коробка урожая', 'Праздники', 'Дом', 'Загорода']));
    const z = signsOf(ALL_MAPS.zagroda!, 16, h);
    expect(z.filter((x) => x.key.startsWith('plot:')).map((x) => x.key).sort()).toEqual(['plot:bed', 'plot:hive', 'plot:klumba', 'plot:sad']);
    expect(z.find((x) => x.key === 'plot:sad')!.y).toBeGreaterThan(12 * 16);
  });

  it('«только язык»: нет табличек у карты, календаря, мачты, праздников и двери в Zagroda', () => {
    const texts = [...signsOf(languageOnlyMap(ALL_MAPS.home!), 16, h), ...signsOf(languageOnlyMap(ALL_MAPS.farm!), 16, h)].map((x) => x.text);
    for (const t of ['Карта Польши', 'Месяцы и даты', 'Символы и гимн', 'Праздники']) expect(texts).not.toContain(t);
    expect(texts).toEqual(expect.arrayContaining(['Словарь', 'Мини-игры', 'Дом']));
  });
});
