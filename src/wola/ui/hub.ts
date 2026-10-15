// Улица Воли поверх карты (W-01): подписи мест над дверями (`world:spots` от сцены) со счётчиками — дома «новых слов: 5»,
// в огороде «!» и число растений к удобрению, у Salad Story «уровень N» или «новое блюдо дня» (W-02); ⚙ настроек и название района. Тап по подписи — дойти до двери
// (intent `goto`, тот же путь, что тап по клетке). Пока открыт экран места, подписи спрятаны.
import type { Bus } from '../../systems/bus';
import type { BusEvents } from '../../types/bus';
import { el } from '../../ui/dom';
import { btn } from '../../ui/overlay/kit';
import { PLACE_LABEL, PLACES, type PlaceId } from '../systems/places';
import type { HubCounters } from '../systems/wola';
import { ensureWolaStyle } from './style';

export interface HubDeps {
  bus: Bus<BusEvents>;
  counters(): HubCounters | null;
  /** Дойти до двери места (склейка шлёт `goto` клетки двери). */
  goTo(id: PlaceId): void;
  settings(): void;
}

export interface HubUi {
  refresh(): void;
  dispose(): void;
}

export function counterText(id: PlaceId, c: HubCounters | null): { text: string; due?: boolean } | null {
  if (!c) return null;
  if (id === 'dom') return c.dom ? { text: `новых слов: ${c.dom}` } : c.jarsDue ? { text: `банки: ! ${c.jarsDue}`, due: true } : null;
  if (id === 'ogrod') {
    const parts = [c.due ? `! ${c.due}` : '', c.ripe ? `★ ${c.ripe}` : ''].filter(Boolean);
    return parts.length ? { text: parts.join(' · '), due: c.due > 0 } : null;
  }
  return c.salad ?? null;
}

export function mountHub(root: HTMLElement, deps: HubDeps): HubUi {
  ensureWolaStyle(root.ownerDocument);
  const layer = el('div', { class: 'wl-spots', 'data-hub': 'spots' });
  const title = el('div', { class: 'wl-title', 'data-hub': 'title' }, el('span', { lang: 'pl' }, 'Wola'), el('small', {}, 'район Воля, Варшава'));
  const gear = btn('⚙', () => deps.settings(), 'icon', { 'aria-label': 'Настройки', 'data-act': 'settings' });
  const hud = el('div', { class: 'wl-hud', 'data-hub': 'hud' }, gear);
  root.append(layer, title, hud);
  const buttons = new Map<PlaceId, HTMLButtonElement>();
  for (const id of PLACES) {
    const b = el('button', { type: 'button', class: 'wl-spot', 'data-place': id, hidden: true, 'aria-label': `${PLACE_LABEL[id].pl} — ${PLACE_LABEL[id].ru}`, onclick: () => deps.goTo(id) });
    buttons.set(id, b);
    layer.append(b);
  }
  const paint = (): void => {
    const c = deps.counters();
    for (const id of PLACES) {
      const n = counterText(id, c);
      buttons.get(id)!.replaceChildren(
        el('span', { class: 'wl-tag' }, el('span', { lang: 'pl' }, PLACE_LABEL[id].pl), el('small', {}, PLACE_LABEL[id].ru), n ? el('span', { class: `cnt${n.due ? ' due' : ''}`, 'data-count': id }, n.text) : null),
      );
    }
  };
  paint();
  let worldOn = true;
  const show = (): void => {
    layer.hidden = !worldOn;
    hud.hidden = !worldOn;
    title.hidden = !worldOn;
  };
  const offs = [
    deps.bus.on('world:spots', ({ spots }) => {
      const seen = new Set<string>();
      for (const s of spots) {
        const b = buttons.get(s.id as PlaceId);
        if (!b) continue;
        seen.add(s.id);
        b.hidden = false;
        b.style.top = `${s.y - 2}px`;
        // Подпись у края экрана не уезжает за край (дверь дома у левого края на телефоне).
        const half = (b.offsetWidth || 0) / 2;
        const vw = root.ownerDocument.defaultView?.innerWidth ?? 0;
        b.style.left = `${half && vw ? Math.min(vw - half - 4, Math.max(half + 4, s.x)) : s.x}px`;
      }
      for (const [id, b] of buttons) if (!seen.has(id)) b.hidden = true;
    }),
    deps.bus.on('world:input', ({ enabled }) => {
      worldOn = enabled;
      show();
    }),
    deps.bus.on('progress:changed', paint),
    deps.bus.on('progress:merged', paint),
  ];
  return {
    refresh: paint,
    dispose() {
      for (const off of offs) off();
      layer.remove();
      hud.remove();
      title.remove();
    },
  };
}
