// Тост «Есть обновление» (P-10a): новая сборка пришла, когда игрок уже играет. Перезагрузка только по кнопке —
// урок не рвётся. Событие `app:update` шлёт склейка (main.ts), кнопка шлёт `app:reload`.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { plBtn } from './overlay/kit';

const UPDATE = { pl: 'Odśwież', ru: 'Обновить' } as const;

const css = `
.pq-update-toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(12px + env(safe-area-inset-top)); z-index: 60;
  display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 14px; border: 2px solid #f4f4f4; border-radius: 6px;
  background: #29366f; color: #f4f4f4; box-shadow: 0 3px 0 #1a1c2c; font-size: 15px; white-space: nowrap; }
.pq-update-toast button { font: inherit; }
`;

export function mountUpdateToast(root: HTMLElement, bus: Bus<BusEvents> = globalBus): () => void {
  root.append(el('style', {}, css));
  let toast: HTMLElement | null = null;
  const off = bus.on('app:update', () => {
    if (toast) return;
    const go = plBtn(UPDATE, () => {
      toast?.remove();
      toast = null;
      bus.emit('app:reload', {});
    });
    toast = el('div', { class: 'pq-update-toast', role: 'status', 'data-update': '' }, el('span', {}, 'Есть обновление'), go);
    root.append(toast);
  });
  return () => {
    off();
    toast?.remove();
  };
}
