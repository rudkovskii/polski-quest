// Надписи над миром в DOM (текст в canvas запрещён): «+N» над грядкой и коробкой, подпись растения у героя, таблички объектов (`world/signs.ts`).
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
.pq-sign { position: fixed; z-index: 33; pointer-events: none; transform: translate(-50%, -100%); padding: 1px 6px; border-radius: 5px; background: rgba(255, 248, 232, .9);
  color: #2a1418; border: 1.5px solid #2a1418; font: 700 12px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap; }
.pq-sign.edge { background: #fff8e8; border-width: 2px; padding: 2px 7px; font-size: 13px; box-shadow: 0 2px 0 #2a1418; }
`;

/** Выход за кадром прижимается к краю экрана со стрелкой (просьба Шэфа 27.10: «как мне отсюда выйти?»). Отступы — под HUD сверху. */
export const EDGE_TOP = 150;
export const EDGE_BOTTOM = 24;
export const EDGE_PAD = 6;

/** Стрелка к выходу за кадром («← Ферма», «Дом →»); на экране — null. */
export function edgeText(text: string, x: number, y: number, vw: number, vh: number): string | null {
  if (x >= 0 && x <= vw && y >= 0 && y <= vh) return null;
  return x < 0 ? `← ${text}` : `${text} ${x > vw ? '→' : y < 0 ? '↑' : '↓'}`;
}

/** Место таблички выхода за кадром (низ середины): прижата к ближнему краю экрана, ниже HUD. */
export function edgePlace(x: number, y: number, vw: number, vh: number, w: number, h: number): { x: number; y: number } {
  const half = w / 2 + EDGE_PAD;
  const top = Math.min(EDGE_TOP + h, vh - EDGE_BOTTOM);
  return { x: Math.min(Math.max(x, half), Math.max(half, vw - half)), y: Math.min(Math.max(y, top), vh - EDGE_BOTTOM) };
}

export function mountFloats(parent: HTMLElement, bus: Bus<BusEvents> = globalBus): () => void {
  const label = el('div', { class: 'pq-label', hidden: true, 'data-plant-label': '', lang: 'pl' });
  const signs = el('div', { 'data-signs': '' });
  const signNodes = new Map<string, HTMLElement>();
  parent.append(el('style', {}, css), signs, label);
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
    // Камера едет за героем — таблички двигаются каждый кадр: узлы переиспользуем, меняем только место.
    bus.on('fx:signs', (list) => {
      const keep = new Set(list.map((s) => s.key));
      for (const [k, n] of signNodes) if (!keep.has(k)) (n.remove(), signNodes.delete(k));
      for (const s of list) {
        let n = signNodes.get(s.key);
        if (!n) signs.append((n = el('div', { class: 'pq-sign', 'data-sign': s.key })));
        signNodes.set(s.key, n);
        const vw = window.innerWidth;
        // Выход за кадром — у края экрана со стрелкой к нему; остальные таблички уходят за край вместе с объектом.
        const vh = window.innerHeight;
        const edgeT = s.key.startsWith('exit:') ? edgeText(s.text, s.x, s.y, vw, vh) : null;
        const text = edgeT ?? s.text;
        if (n.textContent !== text) n.textContent = text;
        n.classList.toggle('edge', !!edgeT);
        if (edgeT) {
          const edge = edgePlace(s.x, s.y, vw, vh, n.offsetWidth, n.offsetHeight);
          n.style.left = `${Math.round(edge.x)}px`;
          n.style.top = `${Math.round(edge.y)}px`;
          continue;
        }
        // Объект у края экрана: табличку не обрезаем, а прижимаем внутрь (объект за краем — табличка уходит вместе с ним).
        const half = n.offsetWidth / 2 + 4;
        const x = s.x >= 0 && s.x <= vw && half * 2 < vw ? Math.min(Math.max(s.x, half), vw - half) : s.x;
        n.style.left = `${Math.round(x)}px`;
        n.style.top = `${Math.round(s.y)}px`;
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
    label.remove();
    signs.remove();
  };
}
