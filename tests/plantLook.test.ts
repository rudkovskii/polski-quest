import { describe, expect, it } from 'vitest';
import mapping from '../content/plants/mapping.json';
import sprites from '../public/atlas/sprites.json';
import { WORDS } from '../src/systems/content';
import { OBJECT_VARIANTS, VARIANT_COUNT, crc32, framesOf, lookOf } from '../src/systems/plantLook';

const atlas = sprites as unknown as Record<string, { frames: string[] }>;
/** Имя `<лист>/<n>` есть в атласе. */
const inAtlas = (name: string | null): boolean => {
  if (!name) return false;
  const [sheet, n] = name.split('/');
  return !!atlas[sheet!]?.frames[Number(n)];
};

describe('lookOf: слова базы', () => {
  it('существительное с иконкой растёт мини-предметом на низком кусте', () => {
    const look = lookOf('w.samochod');
    expect(look).toMatchObject({ type: 'object', icon: 'car' });
    if (look.type !== 'object') throw new Error('object');
    expect(OBJECT_VARIANTS).toContain(look.variant);
    const f = framesOf(look);
    expect(f.icon?.frame).toBeTruthy();
    expect(f.held).toBe(f.icon?.frame);
    expect(inAtlas(f.ripe) && inAtlas(f.icon!.frame)).toBe(true);
  });

  it('слово-цвет даёт ягоду или овощ этого цвета', () => {
    const want: Record<string, string[]> = {
      'w.czerwony': ['strawberry', 'tomato'],
      'w.niebieski': ['blueberry'],
      'w.zielony': ['cucumber'],
      'w.zolty': ['lemon', 'corn'],
      'w.czarny': ['blackberry'],
    };
    for (const [id, fruits] of Object.entries(want)) {
      const look = lookOf(id);
      expect(look.type, id).toBe('color');
      if (look.type === 'color') expect(fruits, id).toContain(look.fruit);
      const f = framesOf(lookOf(id));
      expect(inAtlas(f.ripe) && inAtlas(f.held), id).toBe(true);
    }
  });

  it('остальные слова — разные кусты, детерминированно', () => {
    const plants = WORDS.filter((w) => lookOf(w.id).type === 'plant');
    expect(plants.length).toBeGreaterThan(400);
    const variants = new Set<number>();
    for (const w of plants) {
      const a = lookOf(w.id, w);
      const b = lookOf(w.id, w);
      expect(a).toEqual(b);
      if (a.type === 'plant') variants.add(a.variant);
    }
    expect(variants.size).toBe(VARIANT_COUNT);
    expect(lookOf('w.byc')).toMatchObject({ type: 'plant' });
  });

  it('у каждого слова базы есть вид, и все его кадры лежат в атласе', () => {
    const kinds = { object: 0, color: 0, plant: 0 };
    for (const w of WORDS) {
      const look = lookOf(w.id, w);
      expect(['object', 'color', 'plant'], w.id).toContain(look.type);
      if (look.type === 'phrase' || look.type === 'unit') continue;
      kinds[look.type]++;
      expect(look.variant).toBeGreaterThanOrEqual(0);
      expect(look.variant).toBeLessThan(VARIANT_COUNT);
      const f = framesOf(look);
      expect(inAtlas(f.sprout) && inAtlas(f.bush) && inAtlas(f.ripe), w.id).toBe(true);
      if (look.type === 'object') expect(inAtlas(f.icon?.frame ?? null), `${w.id} ${look.icon}`).toBe(true);
    }
    expect(kinds.object).toBeGreaterThan(600);
    expect(kinds.color).toBe(13);
  });

  it('нечитаемые на 12×12 иконки заменены иконкой темы', () => {
    expect(lookOf('w.kon')).toMatchObject({ type: 'object', icon: 'cat_animal' });
    expect(lookOf('w.wifi')).toMatchObject({ type: 'object', icon: 'cat_tech' });
    expect(lookOf('w.joga')).toMatchObject({ type: 'object', icon: 'cat_leisure' });
  });

  it('crc32 совпадает с эталоном (Python zlib): вариант куста слова базы', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
    const words = (mapping as unknown as { words: Record<string, { look: { variant: number } }> }).words;
    for (const [id, v] of Object.entries(words)) expect(v.look.variant, id).toBe(crc32(id) % VARIANT_COUNT);
  });
});

describe('lookOf: вне базы', () => {
  it('своё слово Шэфа: существительное — предмет по лемме или переводу, иначе по категории', () => {
    expect(lookOf('w.custom.kundel', { pl: 'kundel', ru: 'дворняга собака', pos: 'noun' })).toMatchObject({ type: 'object', icon: 'dog' });
    expect(lookOf('w.custom.koparka', { pl: 'koparka', ru: 'экскаватор', pos: 'noun' })).toMatchObject({ type: 'object', icon: 'cat_misc' });
    expect(lookOf('w.custom.grzaniec', { pl: 'grzaniec', ru: 'штуковина', pos: 'noun', topic: 'jedzenie' })).toMatchObject({ type: 'object', icon: 'cat_food' });
  });

  it('своё слово: цвет — плод, глагол — куст, без данных — куст по id', () => {
    expect(lookOf('w.custom.turkusowy', { pl: 'turkusowy', ru: 'зелёный', pos: 'adj' })).toMatchObject({ type: 'color', fruit: 'cucumber' });
    const verb = lookOf('w.custom.skakac', { pl: 'skakać', ru: 'прыгать', pos: 'verb' });
    expect(verb.type).toBe('plant');
    expect(lookOf('w.custom.skakac', { pl: 'skakać', ru: 'прыгать', pos: 'verb' })).toEqual(verb);
    expect(lookOf('w.custom.nieznane').type).toBe('plant');
    expect(lookOf('w.custom.nieznane')).toEqual(lookOf('w.custom.nieznane'));
  });

  it('фразы и единицы v2 — прежний вид, свой мир', () => {
    expect(lookOf('p.mam_kota')).toEqual({ type: 'phrase' });
    expect(lookOf('geo.city.wroclaw')).toEqual({ type: 'unit' });
    expect(lookOf('hymn.s1.1')).toEqual({ type: 'unit' });
    expect(framesOf({ type: 'phrase' }).ripe).toBeNull();
  });
});
