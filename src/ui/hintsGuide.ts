// Первые шаги новичка без экранов-инструкций (решение 12 в ФЕРМА.md допускает мелкие пузыри): пузырь над героем и
// стрелка к цели. Этап 1 «Иди к столу: там словарь» (стрелка к двери дома, в доме — к столу) горит, пока игрок не откроет
// словарь; этап 2 «Теперь к доске на огороде» — до первой мини-игры. Флаги этапов лежат в сохранении (`Save.hints`:
// `guide:desk`, `guide:board`), решает склейка (main.ts). Мир сообщает экранные точки героя и цели событием `fx:guide`.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

export type GuideStage = 'desk' | 'board';

export const GUIDE_TEXT: Readonly<Record<GuideStage, string>> = {
  desk: 'Иди к столу: там словарь',
  board: 'Теперь к доске на огороде',
};

const css = `
${THEME_CSS}
.pq-guide { position: fixed; z-index: 33; pointer-events: none; transform: translate(-50%, -100%); max-width: min(240px, calc(100vw - 24px)); padding: 5px 10px;
  background: var(--pq-cream); color: var(--pq-ink); border: 2px solid var(--pq-ink); border-radius: 8px; box-shadow: 0 2px 0 var(--pq-ink); text-align: center;
  font: 700 14px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap; }
.pq-guide::after { content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -6px; border: 6px solid transparent; border-bottom: 0; border-top-color: var(--pq-ink); }
.pq-guide-arrow { position: fixed; z-index: 33; pointer-events: none; width: 0; height: 0; margin: -12px 0 0 -11px; border: 11px solid transparent; border-bottom: 0;
  border-top: 16px solid var(--pq-accent); filter: drop-shadow(0 2px 0 var(--pq-ink)); transform-origin: 50% 50%; }
.pq-guide-arrow[data-bob] { animation: pq-guide-bob .9s ease-in-out infinite; }
.pq-guide[hidden], .pq-guide-arrow[hidden] { display: none; }
@keyframes pq-guide-bob { 0%, 100% { translate: 0 -6px; } 50% { translate: 0 0; } }
`;

export interface GuideDeps {
  /** Текущий этап по сохранению (null — новичок уже прошёл первые шаги). */
  stage(): GuideStage | null;
  /** Этап пройден: записать флаг в сохранение. */
  done(stage: GuideStage): void;
}

export interface Guide {
  readonly stage: GuideStage | null;
  dispose(): void;
}

/** Стрелка у героя смотрит на цель, если цель за краем экрана или далеко; рядом с видимой целью — прыгает над ней. */
const ARROW_GAP = 46;

export function mountGuide(parent: HTMLElement, deps: GuideDeps, bus: Bus<BusEvents> = globalBus): Guide {
  const bubble = el('div', { class: 'pq-guide', role: 'status', hidden: true, 'data-guide': '' });
  const arrow = el('div', { class: 'pq-guide-arrow', hidden: true, 'aria-hidden': 'true', 'data-guide-arrow': '' });
  parent.append(el('style', {}, css), bubble, arrow);
  let stage = deps.stage();
  /** Герой у самой цели (над ней «A» и пузырь подсказки): свой пузырь не нужен. */
  let atGoal = false;
  let last: BusEvents['fx:guide'] = null;

  const hide = (): void => {
    bubble.hidden = true;
    arrow.hidden = true;
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
    bubble.style.top = `${Math.round(Math.max(p.hero.y - 8, (r.height || 30) + 6))}px`;
    const onScreen = p.target.x > 16 && p.target.x < vw - 16 && p.target.y > 40 && p.target.y < vh - 16;
    arrow.hidden = false;
    if (onScreen) {
      arrow.dataset.bob = '';
      arrow.style.left = `${Math.round(p.target.x)}px`;
      arrow.style.top = `${Math.round(p.target.y - 4)}px`;
      arrow.style.transform = '';
    } else {
      delete arrow.dataset.bob;
      const dx = p.target.x - p.hero.x;
      const dy = p.target.y - (p.hero.y + 20);
      const len = Math.hypot(dx, dy) || 1;
      arrow.style.left = `${Math.round(p.hero.x + (dx / len) * ARROW_GAP)}px`;
      arrow.style.top = `${Math.round(p.hero.y + 20 + (dy / len) * ARROW_GAP)}px`;
      // Треугольник смотрит вниз (0°): поворот к цели.
      arrow.style.transform = `rotate(${Math.round((Math.atan2(dy, dx) * 180) / Math.PI - 90)}deg)`;
    }
  };
  const setStage = (s: GuideStage | null): void => {
    stage = s;
    atGoal = false;
    bus.emit('guide:goal', { use: s });
    paint();
  };
  const finish = (s: GuideStage): void => {
    if (stage !== s) return;
    deps.done(s);
    setStage(s === 'desk' ? (deps.stage() === 'board' ? 'board' : null) : null);
  };

  const offs = [
    bus.on('fx:guide', (p) => {
      last = p;
      paint();
    }),
    bus.on('fx:near', (p) => {
      atGoal = !!p && p.use === stage;
      paint();
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
