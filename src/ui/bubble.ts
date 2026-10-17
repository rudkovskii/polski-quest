// Пузырь-заглушка над миром: название объекта, с которым герой что-то сделал. Настоящие экраны (словарь, доска,
// коробка, банки, сон) приходят в F-03 и слушают то же событие `world:interact`.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-bubble { position: fixed; left: 50%; top: calc(env(safe-area-inset-top) + 64px); transform: translateX(-50%); z-index: 40; pointer-events: none;
  max-width: calc(100vw - 40px); padding: 10px 16px; background: var(--pq-cream); color: var(--pq-ink); border: 2px solid var(--pq-ink); border-radius: 10px;
  box-shadow: 0 3px 0 var(--pq-ink); font: 700 18px/1.25 -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; }
.pq-bubble[hidden] { display: none; }
`;

export const BUBBLE_MS = 2200;

export function mountBubble(parent: HTMLElement, bus: Bus<BusEvents> = globalBus, hideAfterMs = BUBBLE_MS): () => void {
  const node = el('div', { class: 'pq-bubble', role: 'status', hidden: true, 'data-bubble': '' });
  parent.append(el('style', {}, css), node);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = bus.on('world:interact', ({ label, use }) => {
    node.textContent = label;
    node.dataset.use = use;
    node.hidden = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      node.hidden = true;
    }, hideAfterMs);
  });
  return () => {
    off();
    if (timer) clearTimeout(timer);
    node.remove();
  };
}
