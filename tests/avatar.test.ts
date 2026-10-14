// Внешность игрока (P-03): ключ, «Losuj» по seed, нормализация, сборка слоёв (пресет = спрайт dima),
// хранение в settings.avatar и слияние двух устройств (LWW), сериализация.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appearanceOf,
  AVATAR_KINDS,
  AVATAR_OPTIONS,
  avatarKey,
  avatarLayers,
  composeAvatar,
  cycle,
  defaultAppearance,
  expandFrames,
  hasAppearance,
  normalizeAppearance,
  normalizeName,
  randomAppearance,
  setAppearance,
  type Appearance,
} from '../src/systems/avatar';
import { AVATAR_ART } from '../src/systems/avatarArt';
import { canonicalJson, isPristine, merge } from '../src/systems/merge';
import { newProgress, setSetting, validateProgress } from '../src/systems/progress';
import { ROOT } from '../tools/lib/files';

const T0 = Date.UTC(2026, 9, 14, 10);
const WORLD = 'w0rldw0rldw0rld2';

describe('ключ внешности', () => {
  it('поля по порядку строк, имя не входит', () => {
    const a = defaultAppearance();
    expect(avatarKey(a)).toBe('light.short.dark.full.none.hoodie.teal');
    expect(avatarKey({ ...a, name: 'Ola' })).toBe(avatarKey(a));
  });
  it('каждое поле меняет ключ; все комбинации различны', () => {
    const a = defaultAppearance();
    for (const k of AVATAR_KINDS) expect(avatarKey(cycle(a, k, 1))).not.toBe(avatarKey(a));
    const total = AVATAR_KINDS.reduce((n, k) => n * AVATAR_OPTIONS[k].length, 1);
    const keys = new Set<string>();
    const walk = (i: number, cur: Appearance): void => {
      if (i === AVATAR_KINDS.length) return void keys.add(avatarKey(cur));
      for (const o of AVATAR_OPTIONS[AVATAR_KINDS[i]!]) walk(i + 1, { ...cur, [AVATAR_KINDS[i]!]: o.id });
    };
    walk(0, a);
    expect(keys.size).toBe(total);
  });
  it('стрелки ходят по кругу', () => {
    const a = defaultAppearance();
    const n = AVATAR_OPTIONS.hair.length;
    expect(cycle(a, 'hair', n)).toEqual(a);
    expect(cycle(cycle(a, 'hair', -1), 'hair', 1)).toEqual(a);
    expect(cycle(a, 'hair', -1).hair).toBe(AVATAR_OPTIONS.hair[n - 1]!.id);
  });
});

describe('Losuj', () => {
  it('детерминирован по seed, имя сохраняет, варианты допустимы', () => {
    expect(randomAppearance(42, 'Ola')).toEqual(randomAppearance(42, 'Ola'));
    expect(randomAppearance(42, 'Ola').name).toBe('Ola');
    const seen = new Set<string>();
    for (let s = 1; s <= 60; s++) {
      const a = randomAppearance(s);
      expect(normalizeAppearance(a)).toEqual(a);
      seen.add(avatarKey(a));
    }
    expect(seen.size).toBeGreaterThan(50);
    // Каждый вариант каждой строки выпадает.
    for (const k of AVATAR_KINDS) {
      const ids = new Set(Array.from({ length: 200 }, (_, s) => randomAppearance(s)[k]));
      expect(ids.size).toBe(AVATAR_OPTIONS[k].length);
    }
  });
});

describe('нормализация и сериализация', () => {
  it('мусор → пресет «Дима», неизвестный вариант → вариант по умолчанию', () => {
    expect(normalizeAppearance(null)).toEqual(defaultAppearance());
    expect(normalizeAppearance('x')).toEqual(defaultAppearance());
    const a = normalizeAppearance({ skin: 'tan', hair: 'mohawk', name: 'Ola', extra: 1 });
    expect(a).toEqual({ ...defaultAppearance(), skin: 'tan', name: 'Ola' });
  });
  it('имя: польские буквы, без мусора, до 16, пустое → Dima', () => {
    expect(normalizeName('  Łukasz  Żółć ')).toBe('Łukasz Żółć');
    expect(normalizeName('<b>Ola</b>')).toBe('bOlab');
    expect(normalizeName('')).toBe('Dima');
    expect(normalizeName(5)).toBe('Dima');
    expect(normalizeName('a'.repeat(30))).toHaveLength(16);
  });
  it('settings.avatar переживает JSON и проходит validateProgress', () => {
    const a = randomAppearance(7, 'Dima');
    const p = setAppearance(newProgress(T0, WORLD), a, T0 + 5);
    const back = JSON.parse(JSON.stringify(p));
    expect(validateProgress(back)).toEqual([]);
    expect(appearanceOf(back)).toEqual(a);
    expect(hasAppearance(back)).toBe(true);
    expect(hasAppearance(newProgress(T0, WORLD))).toBe(false);
    expect(appearanceOf(newProgress(T0, WORLD))).toEqual(defaultAppearance());
    expect(isPristine(p)).toBe(false);
  });
});

describe('слияние внешности двумя устройствами (LWW по at)', () => {
  const base = newProgress(T0, WORLD);
  const mac = setAppearance(base, randomAppearance(1, 'Dima'), T0 + 1000);
  const phone = setAppearance(base, randomAppearance(2, 'Dima'), T0 + 2000);
  it('позже выбранная побеждает при любом порядке; объект целиком', () => {
    for (const m of [merge(mac, phone), merge(phone, mac)]) {
      expect(appearanceOf(m)).toEqual(randomAppearance(2, 'Dima'));
      expect(m.settings.avatar!.at).toBe(T0 + 2000);
    }
    expect(canonicalJson(merge(mac, phone))).toBe(canonicalJson(merge(phone, mac)));
    expect(canonicalJson(merge(mac, mac))).toBe(canonicalJson(mac));
  });
  it('равное время: детерминированно (больший canonicalJson), коммутативно', () => {
    const x = setAppearance(base, randomAppearance(3), T0);
    const y = setAppearance(base, randomAppearance(4), T0);
    expect(canonicalJson(merge(x, y))).toBe(canonicalJson(merge(y, x)));
  });
  it('выбор на одном устройстве и другая настройка на другом не мешают друг другу', () => {
    const other = setSetting(base, 'diacritics', 'ok', T0 + 3000);
    const m = merge(mac, other);
    expect(appearanceOf(m)).toEqual(randomAppearance(1, 'Dima'));
    expect(m.settings.diacritics!.value).toBe('ok');
  });
  it('новое устройство без выбора получает внешность из облака', () => {
    expect(hasAppearance(merge(base, phone))).toBe(true);
  });
});

describe('сборка слоёв', () => {
  const pal = JSON.parse(readFileSync(join(ROOT, 'art/palette.json'), 'utf8')).colors as Record<string, string>;
  it('пресет «Дима» совпадает со спрайтом dima пиксель в пиксель', () => {
    const dima = JSON.parse(readFileSync(join(ROOT, 'art/sprites/dima.sprite.json'), 'utf8')) as { keys: Record<string, string | null>; frames: string[][] };
    const s = composeAvatar(defaultAppearance(), AVATAR_ART);
    expect([s.width, s.height, s.frames]).toEqual([16 * 12, 32, 12]);
    let diff = 0;
    dima.frames.forEach((rows, fi) =>
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          const name = dima.keys[ch];
          const o = (y * s.width + fi * 16 + x) * 4;
          const want = name ? [...pal[name]!.slice(1).match(/../g)!.map((h) => parseInt(h, 16)), 255] : [0, 0, 0, 0];
          const got = [s.pixels[o], s.pixels[o + 1], s.pixels[o + 2], s.pixels[o + 3]];
          if (want[3] === 0 ? got[3] !== 0 : got.join() !== want.join()) diff++;
        }),
      ),
    );
    expect(diff).toBe(0);
  });
  it('любой вариант собирается из палитры, альфа 0/255, внешность меняет пиксели', () => {
    const rgbs = new Set(Object.values(pal).map((h) => h.toLowerCase()));
    const ref = composeAvatar(defaultAppearance(), AVATAR_ART).pixels;
    for (const k of AVATAR_KINDS)
      for (const o of AVATAR_OPTIONS[k]) {
        const a = { ...defaultAppearance(), [k]: o.id };
        const s = composeAvatar(a, AVATAR_ART);
        for (let i = 0; i < s.pixels.length; i += 4) {
          const al = s.pixels[i + 3]!;
          expect(al === 0 || al === 255).toBe(true);
          if (al) expect(rgbs.has(`#${[0, 1, 2].map((j) => s.pixels[i + j]!.toString(16).padStart(2, '0')).join('')}`)).toBe(true);
        }
        if (o.id !== AVATAR_OPTIONS.default[k]) expect(Buffer.from(s.pixels).equals(Buffer.from(ref))).toBe(false);
      }
  });
  it('порядок слоёв и подстановки', () => {
    const a: Appearance = { ...defaultAppearance(), hair: 'bald', beard: 'none', glasses: 'round', skin: 'dark', topColor: 'red' };
    const L = avatarLayers(a);
    expect(L.map((l) => l.layer)).toEqual(['avatar_body', 'avatar_top_hoodie', 'avatar_glasses_round']);
    expect(L[0]!.recolor.brown_7).toBe('grey_3');
    expect(L[1]!.recolor.blue_1).toBe('orange_0');
  });
  it('ссылки на кадры: копия и зеркало', () => {
    expect(expandFrames([['ab.'], 0, { flip: 0 }])).toEqual([['ab.'], ['ab.'], ['.ba']]);
    expect(() => expandFrames([0])).toThrow();
  });
});
