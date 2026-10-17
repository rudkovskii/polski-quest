// HUD: полоска опыта-заглушка «A0» в левом углу и кнопка настроек в правом. Опыт приходит событием `hud:xp` (F-03).
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-hud { position: fixed; left: 0; right: 0; top: 0; pointer-events: none; z-index: 30;
  padding: calc(env(safe-area-inset-top) + 8px) calc(env(safe-area-inset-right) + 10px) 0 calc(env(safe-area-inset-left) + 10px);
  display: flex; justify-content: space-between; align-items: flex-start; }
.pq-hud > * { pointer-events: auto; }
.pq-xp { display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 6px; background: var(--pq-wood-dark); border: 2px solid var(--pq-ink); border-radius: 8px;
  box-shadow: 0 3px 0 var(--pq-ink); color: var(--pq-cream); font: 700 15px/1 -apple-system, BlinkMacSystemFont, sans-serif; }
.pq-xp-lvl { min-width: 30px; text-align: center; padding: 4px 6px; background: var(--pq-accent); color: var(--pq-ink); border-radius: 4px; }
.pq-xp-bar { position: relative; width: 84px; height: 10px; background: #2a1418; border-radius: 3px; overflow: hidden; }
.pq-xp-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--pq-leaf); box-shadow: inset 0 2px 0 rgba(255,255,255,.35); }
.pq-gear { width: 44px; height: 44px; padding: 0; font-size: 22px; line-height: 40px; text-align: center; }
`;

export interface Hud {
  root: HTMLElement;
  gear: HTMLButtonElement;
  setXp(level: string, ratio: number): void;
  dispose(): void;
}

export function mountHud(parent: HTMLElement, o: { onSettings(): void; bus?: Bus<BusEvents> }): Hud {
  const bus = o.bus ?? globalBus;
  const lvl = el('span', { class: 'pq-xp-lvl', 'data-xp-level': '' }, 'A0');
  const fill = el('span', { class: 'pq-xp-fill', style: 'width: 0%' });
  const bar = el('span', { class: 'pq-xp-bar', role: 'progressbar', 'aria-label': 'Опыт', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, fill);
  const xp = el('div', { class: 'pq-xp' }, lvl, bar);
  const gear = el('button', { type: 'button', class: 'pq-btn pq-gear', 'aria-label': 'Настройки', onclick: () => o.onSettings() }, '⚙');
  const root = el('div', { class: 'pq-hud' }, el('style', {}, css), xp, gear);
  parent.append(root);
  const setXp = (level: string, ratio: number): void => {
    const r = Math.max(0, Math.min(1, ratio));
    lvl.textContent = level;
    fill.style.width = `${Math.round(r * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  };
  const off = bus.on('hud:xp', ({ level, ratio }) => setXp(level, ratio));
  return {
    root,
    gear,
    setXp,
    dispose() {
      off();
      root.remove();
    },
  };
}
