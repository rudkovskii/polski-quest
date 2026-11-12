// Чья это копия игры (`edition.json` в корне). На `main` — игра Шэфа; персональные версии живут на ветках `ed/<id>`
// со своим `edition.json` и собираются в `/polski-quest/p/<ключ>/` (см. `deploy/editions.json`, `.github/workflows/deploy.yml`).
import editionJson from '../../edition.json';
import type { GameMode } from '../types/farm';

const ALL_MODES: readonly GameMode[] = [1, 2, 3, 4, 5];

export interface Edition {
  /** `main` — Шэф, иначе id игрока (`olya`). */
  id: string;
  /** Путь сборки на Pages (Vite `base`, scope service worker'а). */
  base: string;
  /** Своя база сохранения `polski-farm-<profile>`; null — основная. */
  profile: string | null;
  /** SHA-256 (hex) пароля на входе; null — без пароля. */
  gate: string | null;
  /** Цель пути в интерфейсе: «A1», «B1». */
  level: string;
  /** Только язык: вырезан блок v2 «Игры о Польше», Zagroda, праздничный декор и тема «Święta» (фильтры при сборке, файлы на месте). */
  languageOnly: boolean;
  /** Базовый онбординг при первом запуске + пункт «Как играть» в настройках. */
  onboarding: boolean;
  /** Сколько случайных новых слов базы садится само в первый вход нового дня (`systems/dailySeeds.ts`); 0 — выключено. */
  dailyRandom: number;
  /** Мини-игры фермы, которые есть в этой версии (12.11, Шэф: «оставить только слово → перевод и перевод → слово»). Без игры 5 урожаю слова не нужен ответ «сам». */
  modes: readonly GameMode[];
}

/** Старые `edition.json` без новых флагов читаются как `false` (число — как 0). */
export const EDITION: Edition = normalizeEdition(editionJson as Partial<Edition>);

export function normalizeEdition(e: Partial<Edition>): Edition {
  const n = e.dailyRandom;
  return {
    ...(e as Edition),
    languageOnly: e.languageOnly === true,
    onboarding: e.onboarding === true,
    dailyRandom: typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    modes: Array.isArray(e.modes) && e.modes.some((m) => ALL_MODES.includes(m)) ? ALL_MODES.filter((m) => e.modes!.includes(m)) : ALL_MODES,
  };
}
/** Название цели пути: «Путь к A1», «до B1: 12%». */
export const LEVEL: string = EDITION.level;
