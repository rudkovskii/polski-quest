// Модель сохранения «Фермы»: одна запись (позиция героя, настройки) плюс экспорт и импорт файлом.
// Чистые функции без браузера. v2 (F-03): огород — посадки, журнал ответов, раскладка по грядкам (systems/garden.ts).
import type { Dir } from '../types/input';
import { normalizeCustom, type CustomWord } from './customWords';
import { newGarden, normalizeGarden, type GardenSave } from './garden';
import { newBeaverSave, normalizeBeaver, type BeaverSave } from './beaver';
import { MUSIC_DEFAULT, normalizeMusic, type MusicSettings } from './musicSettings';
import { newPolskaSave, normalizePolska, type PolskaSave } from './polska';

/** v3 (ФЕРМА_v2): раздел `polska` — огород игр о Польше. v2 → v3 без потерь: старое сохранение получает пустой `polska`. */
export const SAVE_V = 3;
const APP = 'polski-quest-farm';

export interface Position {
  map: string;
  x: number;
  y: number;
  facing: Dir;
}

export interface Settings {
  /** Озвучка включена. */
  sound: boolean;
  /** Громкость эффектов (шаги, урожай, ответы), 0–100 %. По умолчанию SFX_VOLUME_DEFAULT. */
  sfxVolume: number;
  /** Музыка (V11b): вкл/выкл, громкость, трек, повтор. По умолчанию выключена. */
  music: MusicSettings;
}

/** Громкость эффектов по умолчанию, %. */
export const SFX_VOLUME_DEFAULT = 60;

export interface Save {
  v: number;
  created: number;
  updated: number;
  position: Position | null;
  settings: Settings;
  /** Огород: посадки, журнал ответов (только дописывается), грядки. Опыт и стадии выводятся из него. */
  garden: GardenSave;
  /** v3: огород игр о Польше (единицы geo/hymn/symbol/date/holiday), отдельно от огорода слов. */
  polska: PolskaSave;
  /** Свои слова («Moje słowa», `w.custom.<хеш>`): растут в `garden` как обычные, в путь к A1 не входят. Старые сохранения читаются как пустой список. */
  custom: CustomWord[];
  /** Подсказки-пузыри, которые уже показаны (по `use` объекта: desk, board, bin). Каждая показывается один раз. */
  hints: string[];
  /** Бобёр (`systems/beaver.ts`): когда поселился, когда был последний визит. Старые сохранения читаются как «бобра ещё не было». */
  beaver: BeaverSave;
}

export function newSave(now: number): Save {
  return { v: SAVE_V, created: now, updated: now, position: null, settings: { sound: true, sfxVolume: SFX_VOLUME_DEFAULT, music: { ...MUSIC_DEFAULT } }, garden: newGarden(), polska: newPolskaSave(), custom: [], hints: [], beaver: newBeaverSave() };
}

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Привести прочитанное к `Save`: мусор в позиции отбрасывается, лишнее — тоже. null — это вообще не сохранение. */
export function normalizeSave(raw: unknown): Save | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.v) || r.v < 1) return null;
  // Сохранение из будущего (новее клиента) читаем только в части, которую знаем.
  const pos = r.position as Record<string, unknown> | null | undefined;
  const position: Position | null =
    pos && typeof pos.map === 'string' && isNum(pos.x) && isNum(pos.y) && DIRS.includes(pos.facing as Dir)
      ? { map: pos.map, x: Math.trunc(pos.x), y: Math.trunc(pos.y), facing: pos.facing as Dir }
      : null;
  const st = (r.settings ?? {}) as Record<string, unknown>;
  return {
    // После нормализации форма текущая (v2 → v3: пустой `polska`), версия — текущая.
    v: SAVE_V,
    created: isNum(r.created) ? r.created : 0,
    updated: isNum(r.updated) ? r.updated : 0,
    position,
    settings: { sound: st.sound !== false, sfxVolume: isNum(st.sfxVolume) ? Math.min(100, Math.max(0, Math.round(st.sfxVolume))) : SFX_VOLUME_DEFAULT, music: normalizeMusic(st.music) },
    garden: normalizeGarden(r.garden),
    polska: normalizePolska(r.polska),
    custom: normalizeCustom(r.custom),
    hints: Array.isArray(r.hints) ? [...new Set(r.hints.filter((h): h is string => typeof h === 'string'))].slice(0, 32) : [],
    beaver: normalizeBeaver(r.beaver),
  };
}

export function exportSave(save: Save): string {
  return `${JSON.stringify({ app: APP, v: save.v, save }, null, 1)}\n`;
}

export type ImportResult = { ok: true; save: Save } | { ok: false; reason: 'json' | 'format' | 'version' };

export function importSave(text: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  const d = doc as { app?: unknown; v?: unknown; save?: unknown } | null;
  if (!d || d.app !== APP) return { ok: false, reason: 'format' };
  if (isNum(d.v) && d.v > SAVE_V) return { ok: false, reason: 'version' };
  const save = normalizeSave(d.save);
  return save ? { ok: true, save } : { ok: false, reason: 'format' };
}

/** `ferma-YYYY-MM-DD.json` по локальной дате устройства (часы передаёт склейка). */
export function exportFileName(now: number, tzOffsetMin = 0): string {
  const d = new Date(now - tzOffsetMin * 60_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `ferma-${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}.json`;
}
