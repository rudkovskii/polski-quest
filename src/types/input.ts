// Типы системы ввода . Живут в types/, чтобы на них ссылалась шина (types/bus.ts);
// src/input/types.ts реэкспортирует их для кода ввода.

export type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * Намерение игрока. Источники (клавиатура, d-pad, тап) дают одни и те же intents.
 *
 * `move` в мире после роутера: `held: true` = «иди в dir, пока не придёт `held: false` того же dir
 * или `held: true` другого dir». Роутер сам сводит одновременные удержания (последнее нажатое
 * побеждает, после отпускания возвращается предыдущее), мир хранит одно текущее направление.
 * `move` отменяет текущий путь `goto` (это делает мир); новый `goto` отменяет удержание (роутер шлёт
 * `held: false`).
 */
export type Intent =
  | { type: 'move'; dir: Dir; held: boolean } // held=false: отпустили
  | { type: 'goto'; tile: [number, number] } // тап по клетке: путь BFS
  | { type: 'interact'; target?: string } // кнопка действия / тап по объекту (target = id объекта)
  | { type: 'cancel' } // Esc, кнопка «B», тап мимо оверлея
  /**
   * Переключить выделенный интерактивный объект в локации `controls: tap` :
   * стрелки → dir, Tab → next, Shift+Tab → prev. В режиме `walk` роутер его не пропускает.
   */
  | { type: 'focus'; dir: Dir | 'next' | 'prev' }
  /** Цифра 1–9 на клавиатуре: в оверлее (F-03) — выбрать вариант ответа с этим номером; мир её не использует. */
  | { type: 'hotkey'; n: number }
  /** Клавиша G (на русской раскладке П): озвучить польский текст под рамкой выбора; мир её не использует. */
  | { type: 'say' };

export type Source = 'keyboard' | 'dpad' | 'pointer';

/** Куда идут intents: в мир (Phaser) или в DOM-оверлей. */
export type Focus = 'world' | 'ui';

/** Режим управления локации: walk (ходьба) или tap (только тап; в мире Фермы не используется). */
export type MapControls = 'walk' | 'tap';

/** Настройки `controls.*` . */
export type DpadSetting = 'auto' | 'always' | 'never';
export type DpadSide = 'left' | 'right';
export interface ControlsSettings {
  dpad: DpadSetting;
  dpadSide: DpadSide;
}

/** Intent после роутера: кому он адресован и откуда пришёл. */
export type RoutedIntent = Intent & { to: Focus; source: Source };
