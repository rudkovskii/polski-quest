// Точка сохранения в облаке (ТЗ §5: зелёная ok, жёлтая pending, серая offline, красная error/old_client).
// Живёт в правом верхнем углу поверх Title и мира. Тап открывает «Сохрани свою ссылку».
// P-01: пока открыт модальный слой (урок, диалог, итог), точки нет — на телефоне она лежала поверх
// крестика урока (✕ x 309–353, точка x 327–371) и вместо выхода открывала ссылку.
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
    return `Сохранено в облаке ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const map: Partial<Record<SyncState, string>> = {
    offline: 'Нет связи с облаком, сохраню позже',
    old_client: 'Обнови игру: закрой и открой заново',
    no_secret: 'Нет ссылки: прогресс только на этом устройстве',
    pending: 'Есть новое, скоро сохраню в облако',
    syncing: 'Сохраняю в облако',
    conflict: 'В облаке другая версия',
    error: 'Не получилось сохранить в облако',
  };
  return map[state] ?? 'Сохранение в облаке';
}

export function mountSyncDot(root: HTMLElement): void {
  root.append(el('style', {}, css));
  const dot = el('i');
  const btn = el('button', { type: 'button', class: 'pq-sync', 'aria-label': 'Сохранение в облаке' }, dot);
  btn.addEventListener('click', () => bus.emit('ui:screen:open', { screen: 'link' }));
  // Модальный слой открыт (world:input выключен) — точку прячем, крестик и кнопки слоя свободны.
  bus.on('world:input', ({ enabled }) => {
    btn.hidden = !enabled;
  });
  bus.on('sync:status', ({ state, at, detail }) => {
    dot.style.setProperty('--c', COLORS[syncColor(state, detail)]!);
    const text = label(state, at);
    btn.setAttribute('aria-label', text);
    btn.title = detail && state === 'error' ? `${text} (${detail})` : text;
  });
  root.append(btn);
}
