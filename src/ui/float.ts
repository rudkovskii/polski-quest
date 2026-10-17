// Надписи над миром в DOM (текст в canvas запрещён): «+N» над грядкой и коробкой, подпись растения у героя.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';

const css = `
.pq-float { position: fixed; z-index: 35; pointer-events: none; transform: translate(-50%, -100%); font: 800 16px/1 -apple-system, BlinkMacSystemFont, sans-serif;
  color: #fff8e8; text-shadow: 0 2px 0 #2a1418, 1px 0 0 #2a1418, -1px 0 0 #2a1418, 0 -1px 0 #2a1418; animation: pq-float-up 1.1s ease-out forwards; white-space: nowrap; }
.pq-float.xp { color: #f2d552; }
.pq-float.miss { color: #a9d4ec; }
@keyframes pq-float-up { from { opacity: 1; margin-top: 0; } to { opacity: 0; margin-top: -28px; } }
.pq-label { position: fixed; z-index: 34; pointer-events: none; transform: translate(-50%, -100%); padding: 3px 7px; border-radius: 6px; background: #fff8e8; color: #2a1418;
  border: 2px solid #2a1418; font: 700 14px/1.1 -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap; box-shadow: 0 2px 0 #2a1418; }
.pq-label[hidden] { display: none; }
`;

export function mountFloats(parent: HTMLElement, bus: Bus<BusEvents> = globalBus): () => void {
  const label = el('div', { class: 'pq-label', hidden: true, 'data-plant-label': '' });
  parent.append(el('style', {}, css), label);
  const offs = [
    bus.on('fx:float', ({ x, y, text, kind }) => {
      const n = el('div', { class: `pq-float ${kind}`, style: `left:${Math.round(x)}px;top:${Math.round(y)}px` }, text);
      parent.append(n);
      setTimeout(() => n.remove(), 1200);
    }),
    bus.on('fx:label', (p) => {
      if (!p) {
        label.hidden = true;
        return;
      }
      label.textContent = p.text;
      label.style.left = `${Math.round(p.x)}px`;
      label.style.top = `${Math.round(p.y)}px`;
      label.hidden = false;
    }),
  ];
  return () => {
    for (const off of offs) off();
    label.remove();
  };
}
