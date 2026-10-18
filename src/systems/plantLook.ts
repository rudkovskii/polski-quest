// Вид растения по слову («пёстрый огород»): существительное растёт мини-предметом на кусте (мини-машинка), слово-цвет — ягодой
// или овощем этого цвета, остальное — разными кустами и цветами. Чистая логика: данные `content/plants/*` (выгрузка арт-агента),
// кадры атласа `plant_*` (art/plants). Правила для слов вне базы (свои слова Шэфа `w.custom.*`) — порт `data/plants/tools/classify.py`.
import iconsJson from '../../content/plants/icons.json';
import mappingJson from '../../content/plants/mapping.json';
import plantsJson from '../../content/plants/plants.json';
import rulesJson from '../../content/plants/rules.json';
import type { PlantLook } from '../types/farm';

export type { PlantLook } from '../types/farm';

/** Что нужно знать о слове, чтобы подобрать вид вне базы A1. */
export interface LookWord {
  pl: string;
  ru?: string;
  pos?: string;
  topic?: string;
}

interface Rules {
  variants: number;
  color_fruits: Record<string, string[]>;
  ru_colors: Record<string, string>;
  lemma_icons: Record<string, string>;
  ru_stems: Record<string, string>;
  topic_category: Record<string, string>;
  ru_category: [string, string][];
  fallback_icon: string;
}
interface IconMeta {
  sheet: string;
  frame: number;
}
interface VariantMeta {
  id: string;
  sheet: string;
  slot: [number, number];
}
interface FruitMeta {
  id: string;
  sheet: string;
  frame: number;
}

const RULES = rulesJson as unknown as Rules;
const ICONS = iconsJson.icons as unknown as Record<string, IconMeta>;
const MAPPING = mappingJson.words as unknown as Record<string, { pl: string; look: PlantLook }>;
const VARIANTS = plantsJson.variants as unknown as VariantMeta[];
const FRUITS = plantsJson.fruits as unknown as FruitMeta[];

export const VARIANT_COUNT = RULES.variants;
/** Кусты с низкой листвой: предмет сидит над ними без голого стебля (у высоких «насажен на ножку»). Мини-предметы растут только на них. */
export const OBJECT_VARIANTS: readonly number[] = [0, 1, 3, 5, 6, 12, 13];
/** Иконки, нечитаемые на 12×12: вместо них иконка темы. */
const ICON_SWAP: Readonly<Record<string, string>> = { horse: 'cat_animal', wifi: 'cat_tech', yoga: 'cat_leisure', dance: 'cat_leisure' };
/** Слово-цвет несёт плод; на руках над головой героя плод показывается мини-иконкой. */
const FRUIT_ICON: Readonly<Record<string, string>> = {
  strawberry: 'strawberry', tomato: 'tomato', lemon: 'lemon', corn: 'grain', cucumber: 'cucumber', blueberry: 'grapes', blackberry: 'plum',
  raspberry: 'raspberry', eggplant: 'plum', plum: 'plum', carrot: 'carrot', pumpkin: 'pumpkin', cauliflower: 'cabbage', radish: 'beet',
  potato: 'potato', mushroom: 'mushroom',
};

/** CRC-32 строки (как `zlib.crc32` в tools/classify.py): вариант куста и плод цвета для слов вне базы. */
export function crc32(s: string): number {
  const bytes = new TextEncoder().encode(s);
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const stem = (tok: string): string => tok.slice(0, Math.max(3, tok.length - 2));

/** Основа русской подписи мини-предмета → иконка (только однословные подписи без «(категория)»; первая выигрывает). */
const ICON_BY_RU: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [name, meta] of Object.entries(ICONS)) {
    const ru = (meta as IconMeta & { ru?: string }).ru ?? '';
    if (name.startsWith('cat_') || ru.includes('(')) continue;
    for (const alt of ru.split('/').map((x) => x.trim().toLowerCase())) if (/^[а-яё-]{4,}$/.test(alt) && !m.has(stem(alt))) m.set(stem(alt), name);
  }
  return m;
})();

function ruTokens(ru: string): string[] {
  const clean = ru.toLowerCase().replace(/\([^)]*\)/g, ' ');
  return clean.split(/[^а-яёa-z-]+/).filter((t) => t.length >= 3);
}

const COLOR_ENDING = /^(ый|ий|ой|ая|ое|ые)$/;

/** Правила для слова, которого нет в mapping (порядок: цвет → не существительное → лемма → перевод → тема → ключевые слова → `cat_misc`). */
export function resolveWord(id: string, w: LookWord): PlantLook {
  const hash = crc32(id);
  const variant = hash % VARIANT_COUNT;
  const low = w.pl.toLowerCase();
  const pos = w.pos ?? 'noun';
  const ru = w.ru ?? '';
  let cname: string | null = Object.hasOwn(RULES.color_fruits, low) && pos !== 'noun' ? low : null;
  if (!cname && pos === 'adj') {
    const first = ruTokens(ru)[0];
    if (first) {
      for (const [k, v] of Object.entries(RULES.ru_colors)) {
        if (first.startsWith(k) && COLOR_ENDING.test(first.slice(k.length))) {
          cname = v;
          break;
        }
      }
    }
  }
  if (cname) {
    const fl = RULES.color_fruits[cname]!;
    return { type: 'color', fruit: fl[hash % fl.length]!, variant };
  }
  if (pos !== 'noun') return { type: 'plant', variant };
  const obj = (icon: string): PlantLook => ({ type: 'object', icon, variant });
  const lemma = Object.hasOwn(RULES.lemma_icons, low) ? RULES.lemma_icons[low] : undefined;
  if (lemma) return obj(lemma);
  for (const t of ruTokens(ru).slice(0, 2)) {
    const hit = Object.hasOwn(RULES.ru_stems, stem(t)) ? RULES.ru_stems[stem(t)] : undefined;
    if (hit) return obj(hit);
  }
  // Свои слова Шэфа: перевод совпал с подписью мини-предмета («пельмени» → dumpling «пельмени / вареники»).
  for (const t of ruTokens(ru).slice(0, 2)) {
    const hit = ICON_BY_RU.get(stem(t));
    if (hit) return obj(hit);
  }
  const byTopic = w.topic ? RULES.topic_category[w.topic] : undefined;
  if (byTopic) return obj(byTopic);
  const lowRu = ru.toLowerCase();
  for (const [cat, rx] of RULES.ru_category) if (new RegExp(rx).test(lowRu)) return obj(cat);
  return obj(RULES.fallback_icon);
}

/** Куст предмета: низкий (см. `OBJECT_VARIANTS`), стабильно по исходному варианту; иконка нечитаемая — иконка темы. */
function polish(look: PlantLook): PlantLook {
  if (look.type !== 'object') return look;
  const variant = OBJECT_VARIANTS.includes(look.variant) ? look.variant : OBJECT_VARIANTS[look.variant % OBJECT_VARIANTS.length]!;
  return { type: 'object', icon: ICON_SWAP[look.icon] ?? look.icon, variant };
}

/** Ids единиц v2 (свой мир в Zagroda): на ферме у них прежние спрайты. */
const V2_PREFIX = /^(geo|hymn|symbol|date|hol)\./;

/**
 * Вид растения: фраза `p.` и единицы v2 — свой (прежние спрайты); слово базы — по `mapping.json`; остальное (свои слова `w.custom.*`,
 * слова темы «Święta») — по правилам из слова; нет слова — куст по id. Детерминировано: то же слово, тот же вид.
 */
export function lookOf(id: string, word?: LookWord | null): PlantLook {
  if (id.startsWith('p.')) return { type: 'phrase' };
  if (V2_PREFIX.test(id)) return { type: 'unit' };
  const known = MAPPING[id];
  if (known) return polish(known.look);
  if (word) return polish(resolveWord(id, word));
  return { type: 'plant', variant: crc32(id) % VARIANT_COUNT };
}

/** Кадры атласа для вида (`<лист>/<n>`); null — нет своего кадра, сцена рисует прежний общий. */
export interface LookFrames {
  sprout: string | null;
  bush: string | null;
  ripe: string | null;
  /** Предмет урожая поверх `ripe` (куст-основа) и смещение его левого верхнего угла от левого верхнего угла спрайта 16×32. */
  icon: { frame: string; dx: number; dy: number } | null;
  /** Плод над головой героя при сборе (null — общий). */
  held: string | null;
}

const iconFrame = (id: string): string | null => {
  const m = ICONS[ICON_SWAP[id] ?? id];
  return m ? `${m.sheet}/${m.frame}` : null;
};

export function framesOf(look: PlantLook): LookFrames {
  const none: LookFrames = { sprout: null, bush: null, ripe: null, icon: null, held: null };
  if (look.type === 'phrase' || look.type === 'unit') return none;
  const v = VARIANTS[look.variant];
  if (!v) return none;
  const base = { sprout: `${v.sheet}/0`, bush: `${v.sheet}/1` };
  if (look.type === 'plant') return { ...base, ripe: `${v.sheet}/2`, icon: null, held: null };
  if (look.type === 'color') {
    const f = FRUITS.find((x) => x.id === look.fruit);
    return { ...base, ripe: f ? `${f.sheet}/${f.frame}` : `${v.sheet}/2`, icon: null, held: iconFrame(FRUIT_ICON[look.fruit] ?? '') };
  }
  const frame = iconFrame(look.icon);
  return { ...base, ripe: `${v.sheet}/3`, icon: frame ? { frame, dx: v.slot[0], dy: v.slot[1] } : null, held: frame };
}
