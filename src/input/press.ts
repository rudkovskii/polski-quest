// Долгое нажатие для DOM-оверлея. Слушатели
// pointerdown/pointerup живут здесь, в src/input, как у drag.ts: экраны сами их не вешают (AGENTS.md).
// Короткий тап остаётся обычным click; после долгого нажатия click гасится, чтобы вариант не выбрался.

export interface LongPressOptions {
  /** Какие элементы контейнера слушать. */
  selector: string;
  /** Сколько держать, мс. */
  ms?: number;
  /** Сдвиг пальца, после которого это уже не нажатие (CSS px). */
  slop?: number;
  onLongPress(item: HTMLElement): void;
}

export function attachLongPress(container: HTMLElement, opts: LongPressOptions): () => void {
  const ms = opts.ms ?? 450;
  const slop = opts.slop ?? 10;
  let cur: { id: number; item: HTMLElement; x0: number; y0: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let suppress: HTMLElement | null = null;

  const stop = (): void => {
    if (cur) clearTimeout(cur.timer);
    cur = null;
  };

  const onDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (cur || (e.button ?? 0) > 0) return;
    const item = (e.target as Element | null)?.closest?.(opts.selector) as HTMLElement | null;
    if (!item || !container.contains(item)) return;
    suppress = null;
    const c = {
      id: e.pointerId,
      item,
      x0: e.clientX,
      y0: e.clientY,
      timer: setTimeout(() => {
        if (cur !== c) return;
        cur = null;
        suppress = item;
        opts.onLongPress(item);
      }, ms),
    };
    cur = c;
  };

  const onMove = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (cur && e.pointerId === cur.id && Math.hypot(e.clientX - cur.x0, e.clientY - cur.y0) > slop) stop();
  };

  const onUp = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (cur && e.pointerId === cur.id) stop();
  };

  // click после долгого нажатия не выбирает вариант (фаза захвата: раньше onclick кнопки).
  const onClick = (ev: Event): void => {
    if (!suppress) return;
    const item = (ev.target as Element | null)?.closest?.(opts.selector);
    if (item === suppress) {
      ev.stopPropagation();
      ev.preventDefault();
    }
    suppress = null;
  };
  // Долгое нажатие на телефоне открывает системное меню: внутри контейнера оно не нужно.
  const onMenu = (ev: Event): void => {
    if ((ev.target as Element | null)?.closest?.(opts.selector)) ev.preventDefault();
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  container.addEventListener('click', onClick, true);
  container.addEventListener('contextmenu', onMenu);
  return () => {
    stop();
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onUp);
    container.removeEventListener('click', onClick, true);
    container.removeEventListener('contextmenu', onMenu);
  };
}
