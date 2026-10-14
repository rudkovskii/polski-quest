// Навигация intents внутри оверлея (ТЗ §2.7, I-08): стрелки двигают фокус между элементами
// `[data-nav]`, Tab делает браузер сам, `interact` (Enter, пробел, «A») нажимает выбранное или
// главную кнопку `[data-primary]`. Своих keydown здесь нет: всё приходит из src/input через bus.
import type { Dir } from '../../input';

const NAV = '[data-nav]';

function usable(node: Element): node is HTMLElement {
  const h = node as HTMLElement;
  return !(h as HTMLButtonElement).disabled && !h.closest('[hidden]') && !h.closest('[inert]');
}

export function navItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll(NAV)].filter(usable);
}

/** Элемент в фокусе внутри root (или null). */
export function focusedIn(root: HTMLElement): HTMLElement | null {
  const a = root.ownerDocument.activeElement as HTMLElement | null;
  return a && a !== root && root.contains(a) ? a : null;
}

function center(r: DOMRect): [number, number] {
  return [r.left + r.width / 2, r.top + r.height / 2];
}

/**
 * Следующий элемент в направлении dir. По геометрии, если она есть (браузер); без раскладки
 * (тесты) и когда в направлении никого нет — по порядку в DOM: вверх/влево = назад, вниз/вправо = вперёд.
 */
export function nextNav(items: readonly HTMLElement[], from: HTMLElement | null, dir: Dir): HTMLElement | null {
  if (!items.length) return null;
  const idx = from ? items.indexOf(from) : -1;
  if (idx < 0) return items[0]!;
  const rects = items.map((x) => x.getBoundingClientRect());
  const r0 = rects[idx]!;
  if (r0.width > 0 || r0.height > 0) {
    const [x0, y0] = center(r0);
    let best: { i: number; d: number } | null = null;
    rects.forEach((r, i) => {
      if (i === idx || (r.width === 0 && r.height === 0)) return;
      const [x, y] = center(r);
      const dx = x - x0;
      const dy = y - y0;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 4) return;
      const d = along + across * 2;
      if (!best || d < best.d) best = { i, d };
    });
    if (best) return items[(best as { i: number }).i]!;
  }
  const step = dir === 'up' || dir === 'left' ? -1 : 1;
  return items[(idx + step + items.length) % items.length]!;
}

export function moveFocus(root: HTMLElement, dir: Dir): HTMLElement | null {
  const items = navItems(root);
  const cur = focusedIn(root);
  const next = nextNav(items, cur && items.includes(cur) ? cur : null, dir);
  next?.focus({ preventScroll: false });
  return next;
}

/** Главная кнопка слоя: «Проверить», «Дальше». */
export function primaryOf(root: HTMLElement): HTMLButtonElement | null {
  const list = [...root.querySelectorAll('[data-primary]')].filter(usable) as HTMLButtonElement[];
  return list[list.length - 1] ?? null;
}

/** interact: нажать элемент в фокусе, иначе главную кнопку. true — что-то нажато. */
export function activate(root: HTMLElement): boolean {
  const cur = focusedIn(root);
  if (cur && usable(cur) && (cur.tagName === 'BUTTON' || cur.hasAttribute('data-nav'))) {
    cur.click();
    return true;
  }
  const p = primaryOf(root);
  if (p) {
    p.click();
    return true;
  }
  return false;
}
