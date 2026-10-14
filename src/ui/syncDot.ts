// Точка синка (ТЗ §5: зелёная ok, жёлтая pending, серая offline, красная error/old_client).
// Пока HUD нет (I-13), живёт в правом верхнем углу поверх Title. Тап открывает «Сохрани свою ссылку».
import { bus } from '../systems/bus';
import type { SyncState } from '../types/bus';
import { el } from './dom';

const css = `
.pq-sync { position: absolute; top: calc(4px + env(safe-area-inset-top)); right: calc(4px + env(safe-area-inset-right)); width: 44px; height: 44px; padding: 0; border: 0; background: none; cursor: pointer; touch-action: manipulation; z-index: 5; }
.pq-sync i { display: block; width: 12px; height: 12px; margin: auto; border-radius: 50%; border: 2px solid #1a1c2c; background: var(--c, #566c86); }
`;

const COLORS: Record<string, string> = { green: '#38b764', yellow: '#ffcd75', grey: '#566c86', red: '#b13e53' };

export function syncColor(state: SyncState, detail?: string): keyof typeof COLORS {
  switch (state) {
    case 'ok':
      return 'green';
    case 'pending':
    case 'syncing':
      return 'yellow';
    case 'conflict':
      return detail === 'different_worlds' ? 'red' : 'yellow';
    case 'error':
    case 'old_client':
      return 'red';
    default:
      return 'grey'; // idle, no_secret, offline
  }
}

function label(state: SyncState, at?: number): string {
  if (state === 'ok' && at) {
    const d = new Date(at);
    return `Синхронизировано ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const map: Partial<Record<SyncState, string>> = {
    offline: 'Облако недоступно, сольём при сети',
    old_client: 'Обнови игру: закрой и открой заново',
    no_secret: 'Нет ссылки',
    pending: 'Есть несохранённое',
    syncing: 'Синхронизация',
    conflict: 'Конфликт сохранений',
    error: 'Ошибка синка',
  };
  return map[state] ?? 'Синк';
}

export function mountSyncDot(root: HTMLElement): void {
  root.append(el('style', {}, css));
  const dot = el('i');
  const btn = el('button', { type: 'button', class: 'pq-sync', 'aria-label': 'Синк' }, dot);
  btn.addEventListener('click', () => bus.emit('ui:screen:open', { screen: 'link' }));
  bus.on('sync:status', ({ state, at, detail }) => {
    dot.style.setProperty('--c', COLORS[syncColor(state, detail)]!);
    const text = label(state, at);
    btn.setAttribute('aria-label', text);
    btn.title = detail && state === 'error' ? `${text} (${detail})` : text;
  });
  root.append(btn);
}
