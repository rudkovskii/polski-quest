// Игра «Święta»: DOM-иконки предметов. Где в атласе декора (`public/atlas/custom.png`, кадры `w2_*`) есть подходящий кадр —
// рисуем его (×scale, пиксели не мылятся); остальным предметам даём эмодзи. Подпись словом всегда рядом (в карточке).
// Координаты кадров сверяет `tests/swieta.test.ts` с `custom.json` (после `npm run sprites` они могут уехать).
import { WORD_BY_ID } from '../../systems/content';
import { el } from '../../ui/dom';

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Размер атласа custom.png (`meta.size` в custom.json). */
export const ATLAS_SIZE = { w: 256, h: 752 } as const;

export const FRAMES = {
  'w2_pisanki/0': { x: 73, y: 707, w: 16, h: 16 },
  'w2_znicz/0': { x: 103, y: 725, w: 16, h: 16 },
  'w2_choinka/0': { x: 215, y: 463, w: 16, h: 32 },
  'w2_palma/0': { x: 91, y: 513, w: 16, h: 32 },
  'w2_fl_chrys/2': { x: 1, y: 689, w: 16, h: 16 },
  'w2_flag/0': { x: 235, y: 689, w: 16, h: 16 },
  'w2_basket/0': { x: 1, y: 671, w: 16, h: 16 },
  'w2_basket/1': { x: 19, y: 671, w: 16, h: 16 },
  'w2_season_board/0': { x: 109, y: 513, w: 32, h: 32 },
  'w2_season_board/1': { x: 143, y: 513, w: 32, h: 32 },
  'w2_season_board/2': { x: 177, y: 513, w: 32, h: 32 },
  'w2_season_board/3': { x: 211, y: 513, w: 32, h: 32 },
} as const satisfies Record<string, AtlasFrame>;
export type FrameKey = keyof typeof FRAMES;

/** Слово → кадр атласа декора. */
export const WORD_FRAME: Readonly<Record<string, FrameKey>> = {
  'sw.pisanka': 'w2_pisanki/0',
  'sw.znicz': 'w2_znicz/0',
  'sw.choinka': 'w2_choinka/0',
  'sw.palma': 'w2_palma/0',
  'sw.chryzantema': 'w2_fl_chrys/2',
  'sw.flaga': 'w2_flag/0',
};

/** Слова без кадра в атласе: эмодзи. */
export const WORD_EMOJI: Readonly<Record<string, string>> = {
  'sw.fajerwerki': '🎆',
  'sw.szampan': '🍾',
  'sw.kreda': '🖍️',
  'sw.orszak': '👑',
  'sw.laurka': '💌',
  'w.kwiat': '🌷',
  'sw.paczek': '🍩',
  'sw.faworki': '🥨',
  'sw.marzanna': '🌾',
  'sw.kukla': '🎭',
  'sw.galazka': '🌿',
  'sw.baranek': '🐑',
  'w.chleb': '🍞',
  'w.sol': '🧂',
  'sw.biala_kielbasa': '🌭',
  'sw.chrzan': '🥕',
  'sw.karp': '🐟',
  'sw.lany_poniedzialek': '💦',
  'w.woda': '💧',
  'sw.grill': '🍖',
  'w.lody': '🍦',
  'w.prezent': '🎁',
  'sw.procesja': '🚶',
  'sw.platek': '🌸',
  'sw.wianek': '🏵️',
  'sw.ognisko': '🔥',
  'sw.bukiet': '💐',
  'sw.ziola': '🌿',
  'sw.cmentarz': '🪦',
  'sw.wosk': '🕯️',
  'w.klucz': '🔑',
  'w.but': '👞',
  'sw.oplatek': '🫓',
  'sw.obrus': '🧶',
  'sw.sianko': '🌾',
  'sw.puste_nakrycie': '🍽️',
  'w.barszcz': '🍲',
  'sw.uszka': '🥟',
  'w.pierogi': '🥟',
  'sw.zurek': '🥣',
  'sw.kolednik': '🎤',
  'sw.tort': '🎂',
};

const base = (): string => {
  try {
    return import.meta.env.BASE_URL ?? '/';
  } catch {
    return '/';
  }
};

/** Иконка кадра атласа: `scale` целое (×1, ×2…). */
export function frameIcon(key: FrameKey, scale = 2): HTMLSpanElement {
  const f: AtlasFrame = FRAMES[key];
  return el('span', {
    class: 'sw-ico',
    'data-frame': key,
    'aria-hidden': 'true',
    style: `width:${f.w * scale}px;height:${f.h * scale}px;background-image:url(${base()}atlas/custom.png);background-position:-${f.x * scale}px -${f.y * scale}px;background-size:${ATLAS_SIZE.w * scale}px ${ATLAS_SIZE.h * scale}px`,
  });
}

/** Предмет по id слова: кадр из атласа, иначе эмодзи; на всякий случай — точка. `scale` — для кадров. */
export function itemIcon(id: string, scale = 2): HTMLSpanElement {
  const fk = WORD_FRAME[id];
  // Высокие кадры (ёлка, пальма 16×32) на ступень мельче, чтобы карточки были ровными.
  if (fk) return frameIcon(fk, FRAMES[fk].h > FRAMES[fk].w ? Math.max(1, scale - 1) : scale);
  return el('span', { class: 'sw-ico emoji', 'data-emoji': id, 'aria-hidden': 'true' }, WORD_EMOJI[id] ?? '•');
}

/** Слово предмета: польское и русское (без пояснения в скобках). */
export function itemWord(id: string): { id: string; pl: string; ru: string } {
  const w = WORD_BY_ID.get(id);
  return { id, pl: w?.pl ?? id.replace(/^\w+\./, '').replace(/_/g, ' '), ru: (w?.ru ?? '').replace(/\s*\(.*$/, '').trim() };
}
