// Внешность игрока (P-03, ПОЛИРОВКА §2 решение 1): модель «Fotobudka», ключ, «Losuj», сборка листа
// аватара из слоёв art/avatar с подстановкой палитры. Чистое: без DOM и Phaser, время — параметром.
//
// Хранение: настройка `settings.avatar = { value: Appearance, at }` (progress.ts). Внешность меняется
// (зеркало), поэтому это не монотонный `world`, а LWW по `at`: merge.ts сливает settings по ключу
// (позже `at` выигрывает, при равенстве больший canonicalJson). Весь объект — одно значение, поэтому
// два устройства не смешивают половину причёски с одного и половину с другого.
import optionsJson from '../../art/avatar/avatar.json';
import { setSetting, type Progress, type Ts } from './progress';

export type AvatarKind = 'skin' | 'hair' | 'hairColor' | 'beard' | 'glasses' | 'top' | 'topColor';
/** Порядок строк Fotobudka: цвет идёт сразу под своей строкой. */
export const AVATAR_KINDS: readonly AvatarKind[] = ['skin', 'hair', 'hairColor', 'beard', 'glasses', 'top', 'topColor'];

export interface Appearance {
  skin: string;
  hair: string;
  hairColor: string;
  beard: string;
  glasses: string;
  top: string;
  topColor: string;
  /** Имя в паспорте (NPC: «pan Dima»). */
  name: string;
}

export interface AvatarOption {
  id: string;
  pl: string;
  ru: string;
  /** Слой art/avatar (null — слоя нет: «łysy», «bez brody»). */
  layer?: string | null;
  /** Имена палитры вместо `base` того же индекса. */
  ramp?: string[];
  /** Цвет бороды для цвета волос. */
  beard?: string;
}

export interface AvatarOptions {
  base: { skin: string[]; hair: string[]; beard: string[]; top: string[] };
  skin: AvatarOption[];
  hair: AvatarOption[];
  hairColor: AvatarOption[];
  beard: AvatarOption[];
  glasses: AvatarOption[];
  top: AvatarOption[];
  topColor: AvatarOption[];
  default: Record<AvatarKind, string>;
}

export const AVATAR_OPTIONS = optionsJson as unknown as AvatarOptions;
/** Ключ настройки в `progress.settings`. */
export const AVATAR_SETTING = 'avatar' as const;
export const DEFAULT_NAME = 'Dima';
export const NAME_MAX = 16;

/** Пресет «Дима» (черновик по текущему спрайту; уточнить у Шэфа: ПОЛИРОВКА §4 п.1). */
export function defaultAppearance(opts: AvatarOptions = AVATAR_OPTIONS): Appearance {
  return { ...opts.default, name: DEFAULT_NAME };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Имя: буквы (с польскими), пробел, дефис, апостроф; до 16 знаков; пустое → Dima. */
export function normalizeName(x: unknown): string {
  if (typeof x !== 'string') return DEFAULT_NAME;
  const s = x
    .normalize('NFC')
    .replace(/[^\p{L}\p{M} '’-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return s || DEFAULT_NAME;
}

/**
 * Привести что угодно (облако, импорт, старая версия) к допустимой внешности: неизвестный вариант
 * поля → вариант пресета по умолчанию. Лишние поля отбрасываются.
 */
export function normalizeAppearance(x: unknown, opts: AvatarOptions = AVATAR_OPTIONS): Appearance {
  const out = defaultAppearance(opts);
  if (!isObj(x)) return out;
  for (const k of AVATAR_KINDS) {
    const v = x[k];
    if (typeof v === 'string' && opts[k].some((o) => o.id === v)) out[k] = v;
  }
  out.name = normalizeName(x.name);
  return out;
}

/** Ключ внешности для кэша текстуры: только то, что видно (имя не входит). */
export function avatarKey(a: Appearance): string {
  return AVATAR_KINDS.map((k) => a[k]).join('.');
}

export function sameAppearance(a: Appearance, b: Appearance): boolean {
  return avatarKey(a) === avatarKey(b) && a.name === b.name;
}

export function optionOf(kind: AvatarKind, id: string, opts: AvatarOptions = AVATAR_OPTIONS): AvatarOption {
  return opts[kind].find((o) => o.id === id) ?? opts[kind].find((o) => o.id === opts.default[kind])!;
}

/** Стрелка ‹ › в строке: следующий/предыдущий вариант по кругу. */
export function cycle(a: Appearance, kind: AvatarKind, delta: number, opts: AvatarOptions = AVATAR_OPTIONS): Appearance {
  const list = opts[kind];
  const i = Math.max(0, list.findIndex((o) => o.id === a[kind]));
  const n = list.length;
  return { ...a, [kind]: list[(((i + delta) % n) + n) % n]!.id };
}

/** mulberry32: детерминированный ГСЧ по seed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** «Losuj»: случайная внешность, детерминированная по seed. Имя не трогается. */
export function randomAppearance(seed: number, name: string = DEFAULT_NAME, opts: AvatarOptions = AVATAR_OPTIONS): Appearance {
  const r = rng(seed);
  const out = defaultAppearance(opts);
  for (const k of AVATAR_KINDS) out[k] = opts[k][Math.floor(r() * opts[k].length)]!.id;
  out.name = normalizeName(name);
  return out;
}

// ── Прогресс.

/** Игрок уже прошёл Fotobudka на этом мире (на любом устройстве). */
export function hasAppearance(p: Progress): boolean {
  return AVATAR_SETTING in p.settings;
}

/** Внешность из прогресса; не выбрана — пресет «Дима». */
export function appearanceOf(p: Progress, opts: AvatarOptions = AVATAR_OPTIONS): Appearance {
  const s = p.settings[AVATAR_SETTING];
  return s ? normalizeAppearance(s.value, opts) : defaultAppearance(opts);
}

export function setAppearance(p: Progress, a: Appearance, now: Ts, opts: AvatarOptions = AVATAR_OPTIONS): Progress {
  return setSetting(p, AVATAR_SETTING, normalizeAppearance(a, opts), now);
}

// ── Сборка листа: 12 кадров 16×32 в ряд (как dima: вниз, вверх, влево, вправо × 3).

/** Кадр sprite-as-data: строки, ссылка на кадр i или зеркало `{ flip: i }` (tools/sprites_build.py). */
export type SpriteFrame = string[] | number | { flip: number };

export interface SpriteData {
  id: string;
  size: [number, number];
  anchor: [number, number];
  keys: Record<string, string | null>;
  anims: Record<string, number[]>;
  frames: SpriteFrame[];
}

export interface AvatarArt {
  options: AvatarOptions;
  /** Имя палитры → [r, g, b]. */
  palette: Record<string, [number, number, number]>;
  layers: Record<string, SpriteData>;
}

export interface AvatarSheet {
  width: number;
  height: number;
  frameW: number;
  frameH: number;
  frames: number;
  anchor: [number, number];
  anims: Record<string, number[]>;
  /** RGBA, строка за строкой. */
  pixels: Uint8ClampedArray;
}

export function expandFrames(frames: readonly SpriteFrame[]): string[][] {
  const out: string[][] = [];
  frames.forEach((f, i) => {
    if (Array.isArray(f)) out.push(f);
    else {
      const ref = typeof f === 'number' ? f : f.flip;
      const src = out[ref];
      if (!src || ref >= i) throw new Error(`кадр ${i}: ссылка на ${ref}`);
      out.push(typeof f === 'number' ? src : src.map((r) => [...r].reverse().join('')));
    }
  });
  return out;
}

/** Слои внешности снизу вверх с подстановками: body, top, beard, hair, glasses. */
export function avatarLayers(a: Appearance, opts: AvatarOptions = AVATAR_OPTIONS): { layer: string; recolor: Record<string, string> }[] {
  const zip = (from: string[], to: string[] | undefined): Record<string, string> => {
    const m: Record<string, string> = {};
    from.forEach((n, i) => (m[n] = to?.[i] ?? n));
    return m;
  };
  const hc = optionOf('hairColor', a.hairColor, opts);
  const out = [{ layer: 'avatar_body', recolor: zip(opts.base.skin, optionOf('skin', a.skin, opts).ramp) }];
  const add = (kind: AvatarKind, recolor: Record<string, string>): void => {
    const layer = optionOf(kind, a[kind], opts).layer;
    if (layer) out.push({ layer, recolor });
  };
  add('top', zip(opts.base.top, optionOf('topColor', a.topColor, opts).ramp));
  add('beard', zip(opts.base.beard, hc.beard ? [hc.beard] : undefined));
  add('hair', zip(opts.base.hair, hc.ramp));
  add('glasses', {});
  return out;
}

export function composeAvatar(a: Appearance, art: AvatarArt): AvatarSheet {
  const body = art.layers.avatar_body;
  if (!body) throw new Error('нет слоя avatar_body');
  const [fw, fh] = body.size;
  const n = body.frames.length;
  const width = fw * n;
  const pixels = new Uint8ClampedArray(width * fh * 4);
  for (const { layer, recolor } of avatarLayers(a, art.options)) {
    const d = art.layers[layer];
    if (!d) throw new Error(`нет слоя ${layer}`);
    const rgb: Record<string, [number, number, number] | null> = {};
    for (const [ch, name] of Object.entries(d.keys)) {
      if (name === null) rgb[ch] = null;
      else {
        const c = art.palette[recolor[name] ?? name];
        if (!c) throw new Error(`${layer}: нет цвета ${name}`);
        rgb[ch] = c;
      }
    }
    expandFrames(d.frames).forEach((rows, fi) => {
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const c = rgb[row[x]!];
          if (!c) continue;
          const o = (y * width + fi * fw + x) * 4;
          pixels[o] = c[0];
          pixels[o + 1] = c[1];
          pixels[o + 2] = c[2];
          pixels[o + 3] = 255;
        }
      });
    });
  }
  return { width, height: fh, frameW: fw, frameH: fh, frames: n, anchor: body.anchor, anims: body.anims, pixels };
}

/** Кадр «стоит лицом к нам» и голова для портрета/фото (верх кадра 16×16 с запасом под кудри). */
export const AVATAR_FRONT_FRAME = 1;
export const AVATAR_HEAD: { y: number; h: number } = { y: 2, h: 16 };
/** Кадры поворота превью: вниз, влево, вверх, вправо (стрелками ‹ ›). */
export const AVATAR_TURN = [1, 7, 4, 10] as const;
