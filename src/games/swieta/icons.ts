// Игра «Święta»: DOM-иконки предметов. Где в атласе декора (`public/atlas/custom.png`, кадры `w2_*`) есть подходящий кадр —
// рисуем его (×scale, пиксели не мылятся); остальным — мини-предмет огорода (`ui/atlasIcon`), эмодзи только запасом. Подпись словом всегда рядом (в карточке).
// Координаты кадров сверяет `tests/swieta.test.ts` с `custom.json` (после `npm run sprites` они могут уехать).
import { WORD_BY_ID } from '../../systems/content';
import { el } from '../../ui/dom';
import { ATLAS_SIZE } from '../../ui/stageIcon';
import { atlasIcon, plantIconFrame } from '../../ui/atlasIcon';

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Размер атласа custom.png — один на игру, из `ui/stageIcon` (его сверяет тест `farmui`). */
export { ATLAS_SIZE };

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
  'sw.wosk': 'w2_znicz/0',
};

/** Слова без кадра декора: мини-предмет огорода (`content/plants/icons.json`) — та же палитра и пиксель, что у грядок. */
export const WORD_ICON: Readonly<Record<string, string>> = {
  'sw.fajerwerki': 'balloon',
  'sw.szampan': 'wine',
  'sw.kreda': 'pencil',
  'sw.orszak': 'people',
  'sw.laurka': 'letter',
  'w.kwiat': 'flower',
  'sw.paczek': 'roll',
  'sw.faworki': 'cookie',
  'sw.marzanna': 'grain',
  'sw.kukla': 'woman',
  'sw.galazka': 'tree',
  'sw.baranek': 'sheep',
  'w.chleb': 'bread',
  'w.sol': 'salt',
  'sw.biala_kielbasa': 'sausage',
  'sw.chrzan': 'carrot',
  'sw.karp': 'fish',
  'sw.lany_poniedzialek': 'water',
  'w.woda': 'water',
  'sw.grill': 'meat',
  'w.lody': 'icecream',
  'w.prezent': 'gift',
  'sw.procesja': 'church',
  'sw.platek': 'flower',
  'sw.wianek': 'tulip',
  'sw.ognisko': 'sunset',
  'sw.bukiet': 'flower',
  'sw.ziola': 'sprout',
  'sw.cmentarz': 'monument',
  'w.klucz': 'key',
  'w.but': 'shoe',
  'sw.oplatek': 'paper',
  'sw.obrus': 'towel',
  'sw.sianko': 'grain',
  'sw.puste_nakrycie': 'plate',
  'w.barszcz': 'borscht',
  'sw.uszka': 'pasta',
  'w.pierogi': 'dumpling',
  'sw.zurek': 'soup',
  'sw.kolednik': 'star',
  'sw.tort': 'cake',
};

/** Запас, если у слова нет ни кадра, ни мини-предмета (новое слово в данных): эмодзи. */
export const WORD_EMOJI: Readonly<Record<string, string>> = {};

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

/** Предмет по id слова: кадр декора, иначе мини-предмет огорода, иначе эмодзи; на всякий случай — точка. `scale` — для кадров. */
export function itemIcon(id: string, scale = 2): HTMLSpanElement {
  const fk = WORD_FRAME[id];
  // Высокие кадры (ёлка, пальма 16×32) на ступень мельче, чтобы карточки были ровными.
  if (fk) return frameIcon(fk, FRAMES[fk].h > FRAMES[fk].w ? Math.max(1, scale - 1) : scale);
  const pf = WORD_ICON[id] ? plantIconFrame(WORD_ICON[id]) : null;
  const pi = pf ? atlasIcon(pf, scale, 'sw-ico') : null;
  if (pi) return pi;
  return el('span', { class: 'sw-ico emoji', 'data-emoji': id, 'aria-hidden': 'true' }, WORD_EMOJI[id] ?? '•');
}

/** Слово предмета: польское и русское (без пояснения в скобках). */
export function itemWord(id: string): { id: string; pl: string; ru: string } {
  const w = WORD_BY_ID.get(id);
  return { id, pl: w?.pl ?? id.replace(/^\w+\./, '').replace(/_/g, ' '), ru: (w?.ru ?? '').replace(/\s*\(.*$/, '').trim() };
}
