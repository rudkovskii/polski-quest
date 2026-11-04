// Тёплая тема DOM-оверлея в цветах мира (коричневое дерево, кремовая бумага, рыжие акценты).
// Весь вид панелей держится на токенах ниже: рамка-доска, бумага-вставка, кнопка, резкая тень-ступенька. Без картинок и без размытия.
export const THEME_CSS = `
:root { --pq-wood: #6c4a33; --pq-wood-dark: #46302a; --pq-cream: #f7ecd2; --pq-ink: #2a1418; --pq-accent: #d9782f; --pq-leaf: #6aa84a; }
/* ТЗ-верстка пакет 0 (аудит-верстки §5): токены сетки, шрифта и цвета; пока нигде не используются. */
:root { --ui: 1; --w-s: 400px; --w-m: 640px; --w-l: 960px; --w-xl: 1200px; --col: 560px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --gap-screen: 8px;
  --fs-cap: 12px; --fs-sm: 14px; --fs-body: 16px; --fs-lg: 19px; --fs-xl: 22px; --fs-hero: 30px;
  --pq-ink-2: #5a4636; --pq-ink-3: #6e5a48; --btn-h: 44px; }
/* Палитра деревянного интерфейса. Текст на этих фонах не ниже 4.5:1: тёмный (--pq-ink) на --pq-accent и --pq-gold, кремовый на дереве, --pq-green и --pq-red. */
:root { --pq-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --pq-wood-light: #8a6344; --pq-plate: #6a4831; --pq-paper: #fffaf0; --pq-tile: #f2dcae; --pq-tan: #e8d8ae; --pq-note: #ffe9c2; --pq-ok-soft: #e4f0cc;
  --pq-gold: #f2d552; --pq-red: #a8453a; --pq-green: #3f7030; --pq-green-text: #4a6b2a; --pq-off-bg: #cdbb98; --pq-off-ink: #38261d; --pq-focus: #a84a0c;
  --pq-r-s: 4px; --pq-r-m: 6px; --pq-r-l: 8px;
  --pq-line: 2px solid var(--pq-wood-dark); --pq-line-ink: 2px solid var(--pq-ink); --pq-line-bold: 3px solid var(--pq-ink); --pq-line-note: 2px dashed var(--pq-accent);
  /* Резкая тень-ступенька: без размытия, большая идёт в две ступени. */
  --pq-step-1: 0 1px 0 var(--pq-ink); --pq-step-2: 0 2px 0 var(--pq-ink); --pq-step-3: 0 3px 0 var(--pq-ink); --pq-step-big: 0 4px 0 var(--pq-ink), 0 7px 0 rgba(42, 20, 24, .3);
  /* Объём кнопки: светлая кромка сверху, тёмная снизу; ложится на любой цвет фона. */
  --pq-bevel: inset 0 2px 0 rgba(255, 232, 190, .2), inset 0 -2px 0 rgba(36, 16, 10, .22);
  --pq-tint-hover: linear-gradient(rgba(255, 232, 190, .16), rgba(255, 232, 190, .16));
  --pq-tint-hover-paper: linear-gradient(rgba(108, 74, 51, .12), rgba(108, 74, 51, .12));
  --pq-tint-active-paper: linear-gradient(rgba(108, 74, 51, .22), rgba(108, 74, 51, .22));
  /* Текстура дерева: доски и волокна, только градиенты с жёсткими краями. Панель целиком — --pq-board. */
  --pq-grain: repeating-linear-gradient(180deg, transparent 0 34px, rgba(36, 16, 10, .2) 34px 36px), repeating-linear-gradient(180deg, rgba(255, 226, 176, .06) 0 1px, transparent 1px 5px, rgba(36, 16, 10, .08) 5px 6px, transparent 6px 11px);
  --pq-board: var(--pq-grain), var(--pq-wood);
  /* Двойная рамка доски: тёмный контур (border), светлая кромка, тёмная кромка, снаружи ступенька. */
  --pq-board-edge: inset 0 0 0 1px var(--pq-wood-light), inset 0 0 0 3px var(--pq-wood-dark), var(--pq-step-big);
  /* Бумажная карточка в деревянной кромке (настройки, окно уровня, сцена). */
  --pq-card-edge: inset 0 0 0 3px var(--pq-wood), inset 0 0 0 4px var(--pq-wood-dark), var(--pq-step-big);
  /* Бумага внутри доски: тёмная кромка сверху, будто лист вдавлен в раму. */
  --pq-paper-edge: inset 0 2px 0 rgba(42, 20, 24, .14); }
@media (min-width: 768px) { :root { --gap-screen: 16px; } }
@media (max-width: 520px) { :root { --fs-xl: 20px; --fs-hero: 26px; } }
@media (min-width: 1280px) and (min-height: 760px) { :root { --ui: 1.15; } }
@media (min-width: 1680px) and (min-height: 940px) { :root { --ui: 1.3; } }
@media (min-width: 2300px) and (min-height: 1250px) { :root { --ui: 1.6; } }
.pq-btn { font: 600 15px/1 var(--pq-font); color: var(--pq-cream); background: var(--pq-wood);
  border: var(--pq-line-ink); border-radius: var(--pq-r-m); padding: 10px 14px; box-shadow: var(--pq-bevel), var(--pq-step-3); cursor: pointer; touch-action: manipulation;
  transition: background-color .1s, box-shadow .08s, transform .08s; }
.pq-btn:active { transform: translateY(2px); box-shadow: var(--pq-bevel), var(--pq-step-1); }
.pq-btn.danger { background: var(--pq-red); }
/* Отклик наведения — полупрозрачный слой поверх цвета кнопки: не спорит с цветными вариантами (.on, .danger, верный ответ). Только у мыши, на касании не залипает. */
@media (hover: hover) {
  .pq-btn:hover:not([disabled]), .pq-x:hover, .pq-xp:hover, .pq-goal:hover, .pq-wallet:hover, .pq-toast button:hover, .pq-update-toast button:hover, .pq-audio-toast:hover, .pq-say:hover { background-image: var(--pq-tint-hover); }
  .kp-opt:hover, .kp-pet:hover, .kp-level:hover, .dict-row:hover, .dict-topic:hover, .cw-var:hover, .pq-game .pq-opt:hover:not([disabled]), .pq-game .pq-tile:hover:not([disabled]), .pq-game .pq-letter:hover:not([disabled]) { background-image: var(--pq-tint-hover-paper); }
}
.kp-opt:active, .kp-pet:active, .kp-level:active, .dict-row:active, .dict-topic:active, .cw-var:active { background-image: var(--pq-tint-active-paper); }
.pq-x:active, .pq-xp:active, .pq-goal:active, .pq-wallet:active { transform: translateY(1px); }
/* Фокус с клавиатуры: тёмно-рыжая рамка на бумаге, золотая на дереве. */
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid var(--pq-focus); outline-offset: 1px; }
.pq-hud :focus-visible, .pq-head :focus-visible, .pq-game-head :focus-visible, .pq-game-foot :focus-visible, .pq-gap-foot :focus-visible, .pq-foot :focus-visible, .pq-toast :focus-visible, .pq-update-toast :focus-visible, .pq-audio-toast:focus-visible, .pq-note:focus-visible { outline-color: var(--pq-gold); }
.pq-x, .pq-xp, .pq-goal, .pq-wallet, .kp-opt, .kp-pet, .kp-level, .dict-row, .dict-topic, .cw-var { transition: background-color .1s, transform .08s; }
@media (prefers-reduced-motion: reduce) { .pq-btn, .pq-x, .pq-xp, .pq-goal, .pq-wallet, .kp-opt, .kp-pet, .kp-level, .dict-row, .dict-topic, .cw-var { transition: none; } }
`;
