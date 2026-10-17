// Жест «перетащить» для DOM-оверлея. Слушатели pointerdown/pointerup живут
// здесь, в src/input: экраны сами их не вешают (AGENTS.md, check:banned). Тап без сдвига не считается
// перетаскиванием: его обрабатывает обычный click экрана, а после настоящего перетаскивания click
// гасится, чтобы плитка не прыгнула второй раз.

export interface DragInfo {
  /** Элемент, за который взялись (ближайший к цели `selector`). */
  item: HTMLElement;
  /** Текущие координаты указателя (client). */
  x: number;
  y: number;
}

export interface DragOptions {
  /** Какие элементы контейнера можно тащить. */
  selector: string;
  /** Сдвиг пальца, после которого это перетаскивание, а не тап (CSS px). */
  slop?: number;
  onStart?(d: DragInfo): void;
  onMove?(d: DragInfo): void;
  /** Отпустили после перетаскивания. */
  onDrop(d: DragInfo): void;
  /** Перетаскивание сорвалось (pointercancel, потеря захвата). */
  onCancel?(d: DragInfo): void;
}

export function attachDrag(container: HTMLElement, opts: DragOptions): () => void {
  const slop = opts.slop ?? 8;
  let cur: { id: number; item: HTMLElement; x0: number; y0: number; dragging: boolean } | null = null;
  let suppressUntil = 0;

  const info = (e: PointerEvent): DragInfo => ({ item: cur!.item, x: e.clientX, y: e.clientY });

  const onDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (cur || (e.button ?? 0) > 0) return;
    const item = (e.target as Element | null)?.closest?.(opts.selector) as HTMLElement | null;
    if (!item || !container.contains(item) || (item as HTMLButtonElement).disabled) return;
    cur = { id: e.pointerId, item, x0: e.clientX, y0: e.clientY, dragging: false };
  };

  const onMove = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (!cur || e.pointerId !== cur.id) return;
    if (!cur.dragging) {
      if (Math.hypot(e.clientX - cur.x0, e.clientY - cur.y0) < slop) return;
      cur.dragging = true;
      try {
        container.setPointerCapture?.(e.pointerId);
      } catch {
        /* захват недоступен (тесты, старый Safari): тащим без него */
      }
      opts.onStart?.(info(e));
    }
    e.preventDefault();
    opts.onMove?.(info(e));
  };

  const finish = (ev: Event, drop: boolean): void => {
    const e = ev as PointerEvent;
    if (!cur || e.pointerId !== cur.id) return;
    const was = cur;
    if (was.dragging) {
      suppressUntil = e.timeStamp + 400;
      if (drop) opts.onDrop(info(e));
      else opts.onCancel?.(info(e));
    }
    cur = null;
  };
  const onUp = (e: Event): void => finish(e, true);
  const onCancelEv = (e: Event): void => finish(e, false);

  /** Click сразу после перетаскивания — хвост того же жеста. */
  const onClick = (ev: Event): void => {
    if (ev.timeStamp <= suppressUntil) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onCancelEv);
  container.addEventListener('click', onClick, true);
  return () => {
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onCancelEv);
    container.removeEventListener('click', onClick, true);
  };
}
