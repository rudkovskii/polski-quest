// Маленький элемент HUD (v2): шкала «Wiedza o Polsce» под кнопкой настроек — флажок, звание, номер уровня и полоска.
// Отдельно от пути к A1 (`ui/hud.ts` не трогаем). Данные — событие `polska:scale`, тап открывает вкладку «Polska» на доске.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-polska { position: fixed; z-index: 30; top: calc(env(safe-area-inset-top) + 60px); right: calc(env(safe-area-inset-right) + 10px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 3px; padding: 4px 7px; background: var(--pq-wood-dark); border: 2px solid var(--pq-ink); border-radius: 8px;
  box-shadow: 0 3px 0 var(--pq-ink); color: var(--pq-cream); font: 700 12px/1 -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; touch-action: manipulation; }
.pq-polska[hidden] { display: none; }
.pq-polska .lbl { white-space: nowrap; }
.pq-polska .flag { display: inline-block; width: 12px; height: 8px; margin-right: 4px; vertical-align: -1px; background: linear-gradient(#fff 50%, #d4213d 50%); border: 1px solid var(--pq-ink); }
.pq-polska .bar { position: relative; width: 72px; height: 6px; background: #2a1418; border-radius: 3px; overflow: hidden; }
.pq-polska .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #d4213d; }
.pq-polska.flash { animation: pq-polska-flash 1.4s ease-out; }
@keyframes pq-polska-flash { 0%, 40% { background: #f2d552; color: var(--pq-ink); } 100% { background: var(--pq-wood-dark); } }
`;

export interface PolskaHud {
  readonly root: HTMLElement;
  set(p: BusEvents['polska:scale']): void;
}

/** `onTap` — открыть вкладку «Polska». Элемент скрыт, пока в игры о Польше не играли (ничего не посажено). */
export function mountPolskaHud(parent: HTMLElement, opts: { onTap(): void; visible?: () => boolean }, bus: Bus<BusEvents> = globalBus): PolskaHud {
  const lbl = el('span', { class: 'lbl', 'data-polska-level': '' }, '');
  const fill = el('div', { class: 'fill' });
  const root = el(
    'button',
    { type: 'button', class: 'pq-polska', 'data-polska-hud': '', hidden: true, title: 'Wiedza o Polsce · Знания о Польше', 'aria-label': 'Wiedza o Polsce', onclick: () => opts.onTap() },
    el('span', {}, el('span', { class: 'flag' }), lbl),
    el('div', { class: 'bar' }, fill),
  );
  parent.append(el('style', {}, css), root);
  const api: PolskaHud = {
    root,
    set(p) {
      lbl.textContent = `${p.pl} · ${p.sub}/${p.of}`;
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, p.ratio)) * 100)}%`;
      root.hidden = opts.visible ? !opts.visible() : false;
      if (p.up) {
        root.classList.remove('flash');
        void root.offsetWidth;
        root.classList.add('flash');
      }
    },
  };
  bus.on('polska:scale', (p) => api.set(p));
  return api;
}
