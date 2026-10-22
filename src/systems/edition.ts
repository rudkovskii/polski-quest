// Чья это копия игры (`edition.json` в корне). На `main` — игра Шэфа; персональные версии живут на ветках `ed/<id>`
// со своим `edition.json` и собираются в `/polski-quest/p/<ключ>/` (см. `deploy/editions.json`, `.github/workflows/deploy.yml`).
import editionJson from '../../edition.json';

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
}

/** Старые `edition.json` без новых флагов читаются как `false`. */
export const EDITION: Edition = { ...(editionJson as Edition), languageOnly: (editionJson as Partial<Edition>).languageOnly === true, onboarding: (editionJson as Partial<Edition>).onboarding === true };
/** Название цели пути: «Путь к A1», «до B1: 12%». */
export const LEVEL: string = EDITION.level;
