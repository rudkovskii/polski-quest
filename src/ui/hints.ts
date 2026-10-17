// Пузыри-подсказки при первом подходе к столу, доске и коробке (решение 12 в ФЕРМА.md): 1–2 строки над объектом,
// каждая показывается один раз; флаг «показано» лежит в сохранении (`Save.hints`). Без сюжета и онбординга.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

/** Польское название и русская подсказка по `use` объекта. */
export const HINTS: Readonly<Record<string, { pl: string; ru: string }>> = {
  desk: { pl: 'Słownik', ru: 'Посади слова' },
  board: { pl: 'Tablica', ru: 'Выбери мини-игру' },
  bin: { pl: 'Skrzynka', ru: 'Сюда урожай' },
};

export const HINT_MS = 4500;

const css = `
${THEME_CSS}
.pq-hint { position: fixed; z-index: 36; pointer-events: none; transform: translate(-50%, -100%); max-width: min(220px, calc(100vw - 24px)); padding: 6px 10px;
  background: var(--pq-cream); color: var(--pq-ink); border: 2px solid var(--pq-ink); border-radius: 8px; box-shadow: 0 2px 0 var(--pq-ink); text-align: center;
  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; animation: pq-hint-in .18s ease-out; }
.pq-hint b { display: block; font-size: 15px; font-weight: 800; }
.pq-hint[hidden] { display: none; }
@keyframes pq-hint-in { from { opacity: 0; margin-top: 6px; } to { opacity: 1; margin-top: 0; } }
`;

export interface HintsDeps {
  /** Эта подсказка уже показывалась? */
  seen(use: string): boolean;
  /** Запомнить, что показана (пишет в сохранение). */
  mark(use: string): void;
  hideAfterMs?: number;
}

export function mountHints(parent: HTMLElement, deps: HintsDeps, bus: Bus<BusEvents> = globalBus): () => void {
  const node = el('div', { class: 'pq-hint', role: 'status', hidden: true, 'data-hint': '' });
  parent.append(el('style', {}, css), node);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    node.hidden = true;
  };
  const offs = [
    bus.on('fx:near', (p) => {
      if (!p) return hide();
      const h = HINTS[p.use];
      if (!h || deps.seen(p.use)) return;
      deps.mark(p.use);
      node.replaceChildren(el('b', {}, h.pl), h.ru);
      node.dataset.use = p.use;
      node.hidden = false;
      // Не вылезать за край экрана: у стола дом упирается в верх окна.
      const r = node.getBoundingClientRect();
      const half = r.width / 2 || 60;
      const vw = typeof innerWidth === 'number' && innerWidth > 0 ? innerWidth : p.x + half;
      node.style.left = `${Math.round(Math.min(Math.max(p.x, half + 6), vw - half - 6))}px`;
      node.style.top = `${Math.round(Math.max(p.y, (r.height || 40) + 6))}px`;
      if (timer) clearTimeout(timer);
      timer = setTimeout(hide, deps.hideAfterMs ?? HINT_MS);
    }),
    // Игрок сделал то, о чём подсказка, или открылся экран: пузырь не нужен и больше не всплывёт (в том числе после
    // закрытия экрана: подсказка только при подходе до первого открытия).
    bus.on('world:interact', ({ use }) => {
      hide();
      if (HINTS[use] && !deps.seen(use)) deps.mark(use);
    }),
    bus.on('world:input', ({ enabled }) => {
      if (!enabled) hide();
    }),
  ];
  return () => {
    for (const off of offs) off();
    hide();
    node.remove();
  };
}
