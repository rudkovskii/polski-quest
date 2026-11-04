// Тост «Новая версия · Обновить»: новая сборка пришла, а открыт экран (мини-игра, словарь, меню). Перезагрузка по кнопке —
// урок не рвётся; без открытых экранов склейка перезагружается сама. Событие `app:update` шлёт склейка (main.ts), кнопка шлёт `app:reload`.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';

const css = `
.pq-update-toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(64px + env(safe-area-inset-top)); z-index: 90; width: min(92vw, 440px); box-sizing: border-box;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 10px 10px 16px; border: var(--pq-line-bold); border-radius: var(--pq-r-l);
  background: var(--pq-board); color: var(--pq-cream); box-shadow: var(--pq-board-edge); font: 800 22px/1.2 var(--pq-font); animation: pq-upd-in .35s ease-out; }
.pq-update-toast button { font: inherit; font-weight: 800; min-height: 52px; padding: 8px 20px; font-size: 20px; border: var(--pq-line-ink); border-radius: var(--pq-r-l); background: var(--pq-gold); color: var(--pq-ink); box-shadow: var(--pq-step-2); cursor: pointer; white-space: nowrap; }
@keyframes pq-upd-in { from { transform: translate(-50%, -24px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
`;

export function mountUpdateToast(root: HTMLElement, bus: Bus<BusEvents> = globalBus): () => void {
  root.append(el('style', {}, css));
  let toast: HTMLElement | null = null;
  const off = bus.on('app:update', () => {
    if (toast) return;
    const go = el('button', {
      type: 'button',
      onclick: () => {
        toast?.remove();
        toast = null;
        bus.emit('app:reload', {});
      },
    }, 'Обновить');
    toast = el('div', { class: 'pq-update-toast', role: 'status', 'data-update': '' }, el('span', {}, 'Новая версия ·'), go);
    root.append(toast);
  });
  return () => {
    off();
    toast?.remove();
  };
}
