// Путь к A1 (V11c): праздничная карточка нового уровня (стиль Stardew) и экран «Путь к A1» с лестницей из 20 уровней (номера в пиксельных плашках).
// Звук нового уровня играет `connectSfx` на том же событии `hud:xp {up}` (под выключателем звука, с `?mute=1` не подключён).
import { bus as globalBus, type Bus } from '../systems/bus';
import { A1_LEVEL, SUBLEVELS, SUB_COUNT, type Sublevel } from '../systems/xp';
import type { BusEvents } from '../types/bus';
import type { FarmApi } from '../types/farm';
import { el } from './dom';
import { createPanel, nav } from './panel';
import { THEME_CSS } from './theme';

/** Сколько висит карточка, мс (тап закрывает раньше). */
export const CARD_MS = 5500;

/** Пиксельная плашка с номером уровня (общая для карточки и лестницы). */
const BADGE_CSS = `
.pq-bd { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 28px; height: 28px; padding: 0 4px; background: var(--pq-cream); color: var(--pq-ink);
  border: 2px solid var(--pq-ink); border-radius: 4px; box-shadow: 0 2px 0 var(--pq-ink), inset 0 0 0 2px var(--pq-wood); font: 800 14px/1 ui-monospace, 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; }
.pq-bd.big { min-width: 64px; height: 64px; font-size: 32px; border-radius: 6px; box-shadow: 0 3px 0 var(--pq-ink), inset 0 0 0 3px var(--pq-wood); }
.pq-bd.cur { background: var(--pq-accent); }
.pq-bd.done { background: #e9f1d6; }
`;

const cardCss = `
${THEME_CSS}
${BADGE_CSS}
.pq-lvlcard { position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 74px); transform: translateX(-50%); z-index: 90; width: min(300px, calc(100vw - 32px)); box-sizing: border-box;
  background: var(--pq-cream); color: var(--pq-ink); border: 3px solid var(--pq-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--pq-ink), inset 0 0 0 3px var(--pq-wood);
  padding: 14px 14px 12px; text-align: center; cursor: pointer; touch-action: manipulation; font: 15px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: pq-lvl-pop .45s cubic-bezier(.2, 1.4, .4, 1); }
.pq-lvlcard[hidden] { display: none; }
.pq-lvlcard .rib { display: inline-block; margin-top: -26px; padding: 4px 14px; background: var(--pq-accent); color: var(--pq-ink); border: 2px solid var(--pq-ink); border-radius: 6px; box-shadow: 0 2px 0 var(--pq-ink);
  font-weight: 800; font-size: 13px; letter-spacing: .4px; text-transform: uppercase; }
.pq-lvlcard .ico { font-size: 46px; line-height: 1.15; margin-top: 10px; animation: pq-lvl-bob 1.4s ease-in-out infinite; }
.pq-lvlcard h3 { margin: 0; font-size: 26px; font-weight: 800; }
.pq-lvlcard .ru { opacity: .75; font-size: 15px; }
.pq-lvlcard .plus { margin: 6px 0 2px; font-weight: 800; color: #4a6b2a; }
.pq-lvlcard .note { font-style: italic; opacity: .85; }
.pq-lvlcard .gift { margin-top: 8px; padding: 6px 8px; background: var(--pq-wood); color: var(--pq-cream); border-radius: 6px; font-weight: 700; font-size: 14px; }
@keyframes pq-lvl-pop { from { opacity: 0; transform: translateX(-50%) translateY(-18px) scale(.8); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
@keyframes pq-lvl-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) { .pq-lvlcard, .pq-lvlcard .ico { animation: none; } }
`;

/** Плашка: номер уровня («0» — старт), для A1 — кубок. */
const badge = (l: Sublevel, cls = ''): HTMLElement => el('span', { class: `pq-bd ${cls}`.trim(), 'aria-hidden': 'true' }, l.n > SUB_COUNT ? '🏆' : String(l.n));

export interface LevelUpCard {
  readonly isOpen: boolean;
  close(): void;
  dispose(): void;
}

/** Содержимое карточки уровня `n` (0…21) — отдельно, чтобы тесты не ждали таймеров. */
export function cardContent(n: number): HTMLElement[] {
  const l: Sublevel = n > SUB_COUNT ? A1_LEVEL : SUBLEVELS[Math.max(0, n)]!;
  const a1 = n > SUB_COUNT;
  return [
    el('div', { class: 'rib' }, a1 ? 'Вся база выращена!' : 'Новый уровень!'),
    el('div', { class: 'ico', 'aria-hidden': 'true' }, badge(l, 'big')),
    el('h3', { 'data-card-name': '' }, l.pl),
    el('div', { class: 'ru' }, a1 ? 'Уровень A1' : l.ru),
    el('div', { class: 'plus', 'data-card-plus': '' }, a1 ? 'Вся база выращена' : `${n} из ${SUB_COUNT}`),
    ...(a1 ? [el('div', { class: 'gift', 'data-card-gift': '' }, 'Открыто: золотая лейка')] : []),
  ];
}

/** Карточка нового уровня на `hud:xp {up}`. Не блокирует ввод: висит сверху, гаснет сама или по тапу. */
export function mountLevelUp(parent: HTMLElement, o: { bus?: Bus<BusEvents>; ms?: number } = {}): LevelUpCard {
  const bus = o.bus ?? globalBus;
  const card = el('div', { class: 'pq-lvlcard', role: 'status', 'data-levelup': '', hidden: true });
  parent.append(el('style', {}, cardCss), card);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const close = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    card.hidden = true;
  };
  card.addEventListener('click', close);
  const off = bus.on('hud:xp', ({ up, sub }) => {
    if (!up || sub === undefined) return;
    card.replaceChildren(...cardContent(sub));
    card.hidden = false;
    // Повторный показ перезапускает анимацию.
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
    if (timer) clearTimeout(timer);
    timer = setTimeout(close, o.ms ?? CARD_MS);
  });
  return {
    get isOpen() {
      return !card.hidden;
    },
    close,
    dispose() {
      off();
      close();
      card.remove();
    },
  };
}

const pathCss = `
${THEME_CSS}
${BADGE_CSS}
.path { display: flex; flex-direction: column; gap: 10px; }
.path-hero { background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; padding: 10px; }
.path-hero .top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.path-hero .nm { font-size: 22px; font-weight: 800; line-height: 1.1; }
.path-hero .ru { font-size: 14px; opacity: .75; }
.path-bar { height: 16px; background: #e4d4a8; border: 2px solid var(--pq-ink); border-radius: 8px; overflow: hidden; }
.path-bar i { display: block; height: 100%; background: var(--pq-leaf); }
.path-hint { font-size: 14px; opacity: .85; margin-top: 6px; }
.path-rows { display: flex; flex-direction: column; gap: 3px; }
.path-row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 4px; border-bottom: 1px dashed var(--pq-wood-dark); font-size: 15px; }
.path-ladder { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; list-style: none; }
.path-step { display: grid; grid-template-columns: 22px 34px 1fr auto; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; font-size: 15px; }
.path-step .mk { text-align: center; font-weight: 800; }
.path-step .pq-bd { justify-self: center; }
.path-step .nm b { font-weight: 800; }
.path-step .nm span { opacity: .7; font-size: 13px; margin-left: 4px; }
.path-step .at { font-size: 12px; opacity: .7; font-variant-numeric: tabular-nums; white-space: nowrap; }
.path-step.done { background: #e9f1d6; }
.path-step.done .mk { color: #4a6b2a; }
.path-step.cur { background: var(--pq-accent); border: 2px solid var(--pq-ink); box-shadow: 0 2px 0 var(--pq-ink); }
.path-step.next { opacity: .55; }
.path-note { font-size: 13px; opacity: .8; }
`;

export interface PathScreen {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

const pts = (x: number): string => String(Math.floor(x));
const plural = (n: number, one: string, few: string, many: string): string => {
  const a = n % 100;
  const b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

/** Экран «Путь к A1»: где ты, сколько выращено из скольких, лестница из 20 уровней и честная строка про объём A1. */
export function mountPath(parent: HTMLElement, api: FarmApi, bus?: Bus<BusEvents>): PathScreen {
  const panel = createPanel({ title: 'Путь к A1', bus });
  const content = el('div', { class: 'path' });
  const closeBtn = el('button', { type: 'button', class: 'pq-btn', 'data-done': '', ...nav('done', 'v', 'done'), onclick: () => panel.close() }, 'Закрыть');
  panel.body.append(el('style', {}, pathCss), content, el('div', { style: 'margin-top:12px' }, closeBtn));
  parent.append(panel.root);

  function render(): void {
    const s = api.stats();
    const p = s.path;
    const b = s.base;
    const pct = Math.floor(p.pct * 100);
    const hero = el(
      'div',
      { class: 'path-hero' },
      el('div', { class: 'top' }, badge(SUBLEVELS[Math.min(p.sub, SUB_COUNT + 1)] ?? A1_LEVEL, 'big cur'), el('div', {}, el('div', { class: 'nm', 'data-path-name': '' }, p.a1 ? p.pl : p.sub === 0 ? p.ru : `Уровень ${p.sub} из ${SUB_COUNT}`), el('div', { class: 'ru' }, p.a1 ? 'Вся база выращена' : p.sub === 0 ? 'Пока ни одного очка' : p.pl))),
      el('div', { class: 'path-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: `width:${pct}%` })),
      el('div', { class: 'path-hint', 'data-path-pct': '' }, p.a1 ? 'Вся база выращена: A1 достигнут' : `До A1: ${pct}% · ${pts(p.points)} из ${b.total} очков`),
      p.toNext !== null ? el('div', { class: 'path-hint', 'data-path-next': '' }, `До ${p.nextTo}: ещё ${p.toNext} ${plural(p.toNext, 'очко', 'очка', 'очков')}`) : null,
    );
    const growing = p.points - p.grown;
    const rows = el(
      'div',
      { class: 'path-rows' },
      el('div', { class: 'path-row' }, el('span', {}, 'Слов выращено'), el('b', { 'data-path-words': '' }, `${s.grownWords} из ${b.words}`)),
      el('div', { class: 'path-row' }, el('span', {}, 'Фраз выращено'), el('b', { 'data-path-phrases': '' }, `${s.grownPhrases} из ${b.phrases}`)),
      el('div', { class: 'path-row' }, el('span', {}, 'Растёт сейчас'), el('b', {}, growing > 0.05 ? `${s.growing} (≈ ${pts(growing)} оч.)` : String(s.growing))),
    );
    const steps: HTMLElement[] = [];
    const add = (l: Sublevel, from: number | null): void => {
      const cls = l.n < p.sub ? 'done' : l.n === p.sub ? 'cur' : 'next';
      steps.push(
        el(
          'li',
          { class: `path-step ${cls}`, 'data-step': String(l.n), ...(cls === 'cur' ? { 'aria-current': 'step' } : {}) },
          el('span', { class: 'mk' }, cls === 'done' ? '✓' : cls === 'cur' ? '▶' : '·'),
          badge(l, cls === 'cur' ? 'cur' : cls === 'done' ? 'done' : ''),
          el('span', { class: 'nm' }, el('b', {}, l.ru), l.n >= 1 && l.n <= SUB_COUNT ? el('span', {}, l.pl) : null),
          el('span', { class: 'at' }, from === null ? '' : `от ${from} оч.`),
        ),
      );
    };
    add(SUBLEVELS[0]!, null);
    for (let n = 1; n <= SUB_COUNT; n++) add(SUBLEVELS[n]!, s.thresholds[n - 1]!);
    add(A1_LEVEL, b.total);
    const ladder = el('ol', { class: 'path-ladder', 'data-ladder': '' }, ...steps);
    content.replaceChildren(
      hero,
      rows,
      ladder,
      el('div', { class: 'path-note', 'data-path-honest': '' }, `A1 ≈ ${b.words} слов и ${b.phrases} фраз базы, как у экзамена A1 (ориентир 1100–1500 слов). Официального списка слов для польского нет, это международный ориентир.`),
      el('div', { class: 'path-note' }, `Очки: слово — 1, фраза сборки — 2 (всего ${b.assemble} таких фраз), растущее даёт часть: семечко 0,1, росток 0,3, кустик 0,6. Вся база = ${b.total} очков.`),
    );
  }

  /** На открытии: фокус кнопки сам прокрутил бы вниз, поэтому текущий уровень ставим в центр после фокуса (начало пути — наверх). */
  const reveal = (): void => {
    if (api.stats().path.sub < 3) panel.body.scrollTop = 0;
    else (panel.body.querySelector('.path-step.cur') as (HTMLElement & { scrollIntoView?: (o?: unknown) => void }) | null)?.scrollIntoView?.({ block: 'center' });
  };

  let off: (() => void) | null = null;
  panel.onClose(() => {
    off?.();
    off = null;
  });
  return {
    open() {
      if (!panel.isOpen) {
        panel.open();
        off = api.onChange(() => panel.isOpen && render());
      }
      render();
      panel.focus();
      reveal();
    },
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
  };
}
