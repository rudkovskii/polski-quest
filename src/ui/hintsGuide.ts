// Первые шаги новичка без экранов-инструкций (решение 12 в ФЕРМА.md допускает мелкие пузыри): пузырь над героем и
// стрелка к цели. Этап 1 «Иди к столу: там словарь» (стрелка к двери дома, в доме — к столу) горит, пока игрок не откроет
// словарь; этап 2 «Теперь к доске на огороде» — до первой мини-игры. Флаги этапов лежат в сохранении (`Save.hints`:
// `guide:desk`, `guide:board`), решает склейка (main.ts). Мир сообщает экранные точки героя и цели событием `fx:guide`.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

export type GuideStage = 'desk' | 'board' | 'replant';

export const GUIDE_TEXT: Readonly<Record<GuideStage, string>> = {
  desk: 'Иди к столу: там словарь',
  board: 'Теперь к доске на огороде',
  // F5b: огород опустел после урожая — игра не молчит, а ведёт к столу (посадить ещё); гаснет, когда на грядках снова растёт.
  replant: 'Огород пуст · Посади ещё слов за столом',
};

/** Объект, к которому ведёт этап: пустой огород ведёт к столу, как и первый шаг. */
export const GUIDE_GOAL: Readonly<Record<GuideStage, 'desk' | 'board'>> = { desk: 'desk', board: 'board', replant: 'desk' };

const css = `
${THEME_CSS}
.pq-guide { position: fixed; z-index: 33; pointer-events: none; transform: translate(-50%, -100%); max-width: min(240px, calc(100vw - 24px)); padding: 5px 10px;
  background: var(--pq-cream); color: var(--pq-ink); border: 2px solid var(--pq-ink); border-radius: 8px; box-shadow: 0 2px 0 var(--pq-ink); text-align: center;
  font: 700 14px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap; }
.pq-guide[data-stage="replant"] { white-space: normal; width: max-content; }
.pq-guide::after { content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -6px; border: 6px solid transparent; border-bottom: 0; border-top-color: var(--pq-ink); }
.pq-guide-arrow { position: fixed; z-index: 33; pointer-events: none; width: 0; height: 0; margin: -16px 0 0 -15px; border: 15px solid transparent; border-bottom: 0;
  border-top: 22px solid var(--pq-accent); filter: drop-shadow(0 2px 0 var(--pq-ink)); transform-origin: 50% 50%; }
.pq-guide-arrow[data-bob] { animation: pq-guide-bob .9s ease-in-out infinite; }
.pq-guide[hidden], .pq-guide-arrow[hidden] { display: none; }
@keyframes pq-guide-bob { 0%, 100% { translate: 0 -6px; } 50% { translate: 0 0; } }
`;

export interface GuideDeps {
  /** Текущий этап по сохранению (null — новичок уже прошёл первые шаги). */
  stage(): GuideStage | null;
  /** Этап пройден: записать флаг в сохранение (для `replant` не вызывается: он не одноразовый, гаснет сам, когда на грядках что-то растёт). */
  done(stage: GuideStage): void;
}

export interface Guide {
  readonly stage: GuideStage | null;
  dispose(): void;
}

/** Отступы края экрана для стрелки-компаса: сверху HUD, снизу d-pad. */
const EDGE = 28;
const EDGE_TOP = 84;
const EDGE_BOTTOM = 150;
/** Низ плашек HUD на телефоне, px: пузырь указателя держится ниже. */
const HUD_BOTTOM = 106;

/** Точка, где луч из (x, y) в направлении (dx, dy) выходит из прямоугольника `box` (точка внутри него). */
export function edgePoint(x: number, y: number, dx: number, dy: number, box: { l: number; r: number; t: number; b: number }): { x: number; y: number } {
  const cx = Math.min(Math.max(x, box.l), box.r);
  const cy = Math.min(Math.max(y, box.t), box.b);
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = ux > 0 ? (box.r - cx) / ux : ux < 0 ? (box.l - cx) / ux : Infinity;
  const ty = uy > 0 ? (box.b - cy) / uy : uy < 0 ? (box.t - cy) / uy : Infinity;
  const k = Math.min(tx, ty);
  return { x: cx + ux * k, y: cy + uy * k };
}

export function mountGuide(parent: HTMLElement, deps: GuideDeps, bus: Bus<BusEvents> = globalBus): Guide {
  const bubble = el('div', { class: 'pq-guide', role: 'status', hidden: true, 'data-guide': '' });
  const arrow = el('div', { class: 'pq-guide-arrow', hidden: true, 'aria-hidden': 'true', 'data-guide-arrow': '' });
  parent.append(el('style', {}, css), bubble, arrow);
  let stage = deps.stage();
  /** Герой у самой цели (над ней «A» и пузырь подсказки): свой пузырь не нужен. */
  let atGoal = false;
  let last: BusEvents['fx:guide'] = null;

  let arrowKey = '';
  /** Сообщить миру, где стрелка (центр треугольника): тап по ней ведёт к цели, а не в клетку под ней (B2). */
  const tellArrow = (p: { x: number; y: number } | null): void => {
    const key = p ? `${Math.round(p.x)},${Math.round(p.y)}` : '';
    if (key === arrowKey) return;
    arrowKey = key;
    bus.emit('guide:arrow', p);
  };
  const hide = (): void => {
    bubble.hidden = true;
    arrow.hidden = true;
    tellArrow(null);
  };
  const paint = (): void => {
    const p = last;
    if (!stage || !p || atGoal) return hide();
    bubble.textContent = GUIDE_TEXT[stage];
    bubble.dataset.stage = stage;
    bubble.hidden = false;
    const r = bubble.getBoundingClientRect();
    const half = r.width / 2 || 90;
    const vw = typeof innerWidth === 'number' && innerWidth > 0 ? innerWidth : p.hero.x + half;
    const vh = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : p.target.y + 100;
    bubble.style.left = `${Math.round(Math.min(Math.max(p.hero.x, half + 6), vw - half - 6))}px`;
    // Не залезать на плашки HUD сверху (опыт, «Сегодня», шкала Polska): низ пузыря не выше HUD_BOTTOM.
    bubble.style.top = `${Math.round(Math.max(p.hero.y - 8, (r.height || 30) + HUD_BOTTOM))}px`;
    const onScreen = p.target.x > 16 && p.target.x < vw - 16 && p.target.y > 60 && p.target.y < vh - 110;
    arrow.hidden = false;
    if (onScreen) {
      arrow.dataset.bob = '';
      arrow.style.left = `${Math.round(p.target.x)}px`;
      arrow.style.top = `${Math.round(p.target.y - 4)}px`;
      arrow.style.transform = '';
      // Треугольник 30×15 над точкой (margin -16px) и качается на 6 px вверх.
      tellArrow({ x: p.target.x, y: p.target.y - 4 - 12 });
    } else {
      delete arrow.dataset.bob;
      // Цель за кадром: стрелка стоит у края экрана на луче от героя к цели (не у героя), смотрит на цель.
      const hx = p.hero.x;
      const hy = p.hero.y + 20;
      const dx = p.target.x - hx;
      const dy = p.target.y - hy;
      const pos = edgePoint(hx, hy, dx, dy, { l: EDGE, r: vw - EDGE, t: EDGE_TOP, b: vh - EDGE_BOTTOM });
      arrow.style.left = `${Math.round(pos.x)}px`;
      arrow.style.top = `${Math.round(pos.y)}px`;
      // Треугольник смотрит вниз (0°): поворот к цели.
      arrow.style.transform = `rotate(${Math.round((Math.atan2(dy, dx) * 180) / Math.PI - 90)}deg)`;
      tellArrow({ x: pos.x, y: pos.y - 8 });
    }
  };
  const setStage = (s: GuideStage | null): void => {
    stage = s;
    atGoal = false;
    bus.emit('guide:goal', { use: s ? GUIDE_GOAL[s] : null });
    paint();
  };
  const finish = (s: GuideStage): void => {
    if (stage !== s || s === 'replant') return;
    deps.done(s);
    const nxt = deps.stage();
    setStage(s === 'desk' ? (nxt === 'board' || nxt === 'replant' ? nxt : null) : nxt === 'replant' ? nxt : null);
  };
  // Грядки изменились (посадка, урожай): «Огород пуст» появляется и гаснет сам. Одноразовые этапы новичка не трогаем.
  const resync = (): void => {
    if (stage !== null && stage !== 'replant') return;
    const nxt = deps.stage();
    if ((nxt === null || nxt === 'replant') && nxt !== stage) setStage(nxt);
  };

  const offs = [
    bus.on('fx:guide', (p) => {
      last = p;
      paint();
    }),
    bus.on('fx:near', (p) => {
      atGoal = !!p && !!stage && p.use === GUIDE_GOAL[stage];
      paint();
    }),
    bus.on('farm:plants', resync),
    // Смена карты: «Огород пуст» говорит про грядки слов — в Zagroda (игры о Польше) он не нужен.
    bus.on('world:location', resync),
    // Экран или мини-игра закрылись: мог измениться и огород без `farm:plants` (посадка в словаре), и этап.
    bus.on('world:input', ({ enabled }) => {
      if (enabled) resync();
    }),
    bus.on('world:interact', ({ use }) => {
      if (use === 'desk') finish('desk');
    }),
    // Мини-игра началась (панель снизу, автобег): второй этап пройден.
    bus.on('farm:auto', ({ on }) => {
      if (on && stage === 'board') finish('board');
      if (on) hide();
    }),
  ];
  setStage(stage);

  return {
    get stage() {
      return stage;
    },
    dispose() {
      for (const off of offs) off();
      bubble.remove();
      arrow.remove();
    },
  };
}
