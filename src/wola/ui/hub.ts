// Улица Воли поверх карты (W-01): подписи мест над дверями (`world:spots` от сцены) со счётчиками — дома «новых слов: 5»,
// в огороде «!» и число растений к удобрению, у Salad Story «уровень N» или «новое блюдо дня» (W-02); ⚙ настроек и название района. Тап по подписи — дойти до двери
// (intent `goto`, тот же путь, что тап по клетке). Пока открыт экран места, подписи спрятаны.
// W-04: подписи не закрывают двери — над домом и салатной на клетку выше двери, у огорода под калиткой; в правом углу
// мелкие кнопки мест «1 🏠 / 2 🥗 / 3 🌱» (и клавиши 1/2/3) — мгновенный переход, ходьба остаётся основным способом.
import type { Bus } from '../../systems/bus';
import type { BusEvents } from '../../types/bus';
import { el } from '../../ui/dom';
import { btn } from '../../ui/overlay/kit';
import { PLACE_LABEL, PLACES, type PlaceId } from '../systems/places';
import { planText, type HubCounters } from '../systems/wola';
import { ensureWolaStyle } from './style';

export interface HubDeps {
  bus: Bus<BusEvents>;
  counters(): HubCounters | null;
  /** Дойти до двери места (склейка шлёт `goto` клетки двери). */
  goTo(id: PlaceId): void;
  /** Мгновенный переход в место (W-04: кнопки в углу и клавиши 1/2/3). Нет — кнопок нет. */
  jump?(id: PlaceId): void;
  settings(): void;
}

/** Где подпись места относительно двери (W-04): над фасадом или под калиткой — дверь не закрыта. */
export const LABEL_SIDE: Record<PlaceId, 'above' | 'below'> = { dom: 'above', salad: 'above', ogrod: 'below' };
/** Кнопки быстрого перехода: номер клавиши, значок. */
export const JUMP_KEYS: { id: PlaceId; key: number; icon: string }[] = [
  { id: 'dom', key: 1, icon: '🏠' },
  { id: 'salad', key: 2, icon: '🥗' },
  { id: 'ogrod', key: 3, icon: '🌱' },
];

/** Экранная точка подписи по точке двери (`world:spots`: x — центр, y — верх клетки двери, cell — клетка в px). */
export function labelAt(id: PlaceId, s: { x: number; y: number; cell?: number }): { x: number; y: number; below: boolean } {
  const cell = s.cell ?? 16;
  return LABEL_SIDE[id] === 'below' ? { x: s.x, y: s.y + cell + 2, below: true } : { x: s.x, y: s.y - Math.round(cell * 0.5), below: false };
}

export interface HubUi {
  refresh(): void;
  dispose(): void;
}

export function counterText(id: PlaceId, c: HubCounters | null): { text: string; due?: boolean } | null {
  if (!c) return null;
  if (id === 'dom') return c.dom ? { text: `новых слов: ${c.dom}` } : c.jarsDue ? { text: `банки: ! ${c.jarsDue}`, due: true } : null;
  if (id === 'ogrod') {
    // План дня (W-04): не «! 26» долгом, а «план на сегодня: удобрить N, новых M» (N ≤ 15, остаток ждёт завтра).
    if (c.plan) {
      const parts = [c.plan.fertilize || c.plan.fresh ? planText(c.plan) : '', c.ripe ? `★ ${c.ripe}` : ''].filter(Boolean);
      return parts.length ? { text: parts.join(' · '), due: c.plan.fertilize > 0 } : null;
    }
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
  const jumps = deps.jump
    ? el(
        'div',
        { class: 'wl-jump', 'data-hub': 'jump' },
        ...JUMP_KEYS.map((j) =>
          el('button', { type: 'button', 'data-jump': j.id, 'aria-label': `${PLACE_LABEL[j.id].pl} — сразу туда (клавиша ${j.key})`, title: `${PLACE_LABEL[j.id].ru} · клавиша ${j.key}`, onclick: () => deps.jump?.(j.id) }, el('span', { class: 'k' }, String(j.key)), j.icon),
        ),
      )
    : null;
  root.append(layer, title, hud, ...(jumps ? [jumps] : []));
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
  // Название района — только пока Дима не пошёл (W-04: на Mac 800×600 оно наезжало на подпись «Mój dom»).
  let walked = false;
  const show = (): void => {
    layer.hidden = !worldOn;
    hud.hidden = !worldOn;
    title.hidden = !worldOn || walked;
    if (jumps) jumps.hidden = !worldOn;
  };
  const offs = [
    deps.bus.on('world:spots', ({ spots }) => {
      const seen = new Set<string>();
      for (const s of spots) {
        const b = buttons.get(s.id as PlaceId);
        if (!b) continue;
        seen.add(s.id);
        b.hidden = false;
        const at = labelAt(s.id as PlaceId, s);
        b.classList.toggle('below', at.below);
        b.style.top = `${at.y}px`;
        // Подпись у края экрана не уезжает за край (дверь дома у левого края на телефоне).
        const half = (b.offsetWidth || 0) / 2;
        const vw = root.ownerDocument.defaultView?.innerWidth ?? 0;
        b.style.left = `${half && vw ? Math.min(vw - half - 4, Math.max(half + 4, at.x)) : at.x}px`;
      }
      for (const [id, b] of buttons) if (!seen.has(id)) b.hidden = true;
    }),
    deps.bus.on('world:input', ({ enabled }) => {
      worldOn = enabled;
      show();
    }),
    deps.bus.on('input:intent', (i) => {
      if (walked || i.to !== 'world' || (i.type !== 'move' && i.type !== 'goto')) return;
      walked = true;
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
      jumps?.remove();
    },
  };
}
