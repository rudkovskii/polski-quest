// Общая модалка экранов фермы (Słownik, Spiżarnia, коробка, кровать, карточка растения) в стиле меню Stardew.
// Пока открыта: мир не принимает ввод (`world:input`), Esc/«✕»/тап мимо закрывают, стрелки ходят по `[data-nav]`,
// Enter/Пробел нажимает текущий. Одновременно открыта одна панель.
import { STAGE_INFO } from './glossary';
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { Stage } from '../types/farm';
import { el } from './dom';
import { THEME_CSS } from './theme';

export const PANEL_CSS = `
${THEME_CSS}
.pq-panel { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 12px;
  background: rgba(42, 20, 24, .55); font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink); }
.pq-panel[hidden] { display: none; }
.pq-frame { width: min(560px, 100%); max-height: calc(100dvh - 24px); display: flex; flex-direction: column; box-sizing: border-box;
  background: var(--pq-wood); border: 3px solid var(--pq-ink); border-radius: 12px; box-shadow: 0 4px 0 var(--pq-ink), inset 0 0 0 2px var(--pq-wood-dark); padding: 8px; }
.pq-frame.wide { width: min(940px, 100%); }
.pq-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--pq-cream); padding: 2px 4px 8px; }
.pq-head h2 { margin: 0; font-size: 21px; letter-spacing: .3px; }
.pq-x { font-family: inherit; font-weight: 700; font-size: 18px; line-height: 1; width: 36px; height: 36px; padding: 0; color: var(--pq-cream); background: var(--pq-wood-dark); border: 2px solid var(--pq-ink);
  border-radius: 6px; box-shadow: 0 2px 0 var(--pq-ink); cursor: pointer; touch-action: manipulation; }
.pq-body { background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 6px; padding: 12px; overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 0;
  box-sizing: border-box; -webkit-overflow-scrolling: touch; }
.pq-foot { color: var(--pq-cream); padding: 8px 4px 0; font-size: 14px; }
.pq-foot[hidden] { display: none; }
.pq-panel .is-focus { outline: 3px solid var(--pq-accent); outline-offset: 1px; }
/* F5a: после касания рамки выбора нет (на телефоне она читалась как «нажми сюда»); вернётся от стрелок и клавиш. */
.pq-panel.touch .is-focus { outline: none; }
.pq-panel .pq-btn[disabled] { opacity: .45; cursor: default; box-shadow: 0 3px 0 var(--pq-ink); }
.pq-panel .pq-btn.small { padding: 7px 10px; font-size: 14px; }
.pq-panel .pq-btn.on { background: var(--pq-accent); }
.pq-pl { font-weight: 700; }
.pq-muted { opacity: .72; }
@media (max-width: 640px) {
  .pq-panel { padding: 8px; }
  .pq-frame { width: 100%; max-height: calc(100dvh - 16px); }
}
`;

/** Стадия по-русски. */
export const STAGE_RU: Record<Stage, string> = { seed: STAGE_INFO.seed.ru, sprout: STAGE_INFO.sprout.ru, bush: STAGE_INFO.bush.ru, ripe: STAGE_INFO.ripe.ru, overripe: STAGE_INFO.overripe.ru };

/** Атрибуты навигационного элемента: `key` помогает вернуть фокус после перерисовки; `group` — для прыжков стрелками между блоками. */
export function nav(group = '', axis: 'v' | 'h' = 'v', key = ''): Record<string, string> {
  return { 'data-nav': key, 'data-nav-group': group, 'data-nav-axis': axis };
}

export interface PanelOptions {
  title: string;
  wide?: boolean;
  bus?: Bus<BusEvents>;
  /** Esc/B внутри панели: вернуть true, если шаг назад обработан экраном (подэкран), иначе панель закроется. */
  onCancel?: () => boolean;
}

export interface Panel {
  /** Фон-затемнение; родитель добавляет его в DOM сам. */
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Подписка на закрытие (любым способом). Возвращает отписку. */
  onClose(fn: () => void): () => void;
  setTitle(title: string): void;
  /** Поставить фокус на элемент или на `[data-nav="<key>"]`; без аргумента — на первый. */
  focus(target?: string | HTMLElement): void;
  /** После перерисовки содержимого: вернуть фокус на элемент с тем же ключом (или на ближайший по порядку). */
  syncFocus(): void;
  dispose(): void;
}

let active: { shut(quiet: boolean): void } | null = null;

export function createPanel(opts: PanelOptions): Panel {
  const bus = opts.bus ?? globalBus;
  const title = el('h2', {}, opts.title);
  const xBtn = el('button', { type: 'button', class: 'pq-x', 'aria-label': 'Закрыть', 'data-close': '' }, '✕');
  const body = el('div', { class: 'pq-body' });
  const footer = el('div', { class: 'pq-foot', hidden: true });
  const frame = el(
    'div',
    { class: opts.wide ? 'pq-frame wide' : 'pq-frame', role: 'dialog', 'aria-label': opts.title },
    el('div', { class: 'pq-head' }, title, xBtn),
    body,
    footer,
  );
  const root = el('div', { class: 'pq-panel', hidden: true }, el('style', {}, PANEL_CSS), frame);
  const closers = new Set<() => void>();
  let isOpen = false;
  let focused: HTMLElement | null = null;
  let focusedKey = '';
  let focusedIdx = 0;
  const lastInGroup = new Map<string, HTMLElement>();
  let offIntent: (() => void) | null = null;
  let offSource: (() => void) | null = null;

  const items = (): HTMLElement[] => [...body.querySelectorAll<HTMLElement>('[data-nav]')].filter((n) => !(n as HTMLButtonElement).disabled && !n.hidden && !n.closest('[hidden]'));
  const groupOf = (n: HTMLElement): string => n.getAttribute('data-nav-group') ?? '';

  const setFocus = (n: HTMLElement | null): void => {
    if (focused && focused !== n) focused.classList.remove('is-focus');
    focused = n;
    if (!n) return;
    n.classList.add('is-focus');
    focusedKey = n.getAttribute('data-nav') ?? '';
    focusedIdx = items().indexOf(n);
    lastInGroup.set(groupOf(n), n);
    if (typeof n.scrollIntoView === 'function') n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const move = (dir: 'up' | 'down' | 'left' | 'right'): void => {
    const list = items();
    if (!list.length) return;
    const forward = dir === 'down' || dir === 'right';
    const cur = focused ? list.indexOf(focused) : -1;
    if (cur < 0) {
      setFocus((forward ? list[0] : list[list.length - 1]) ?? null);
      return;
    }
    const here = list[cur]!;
    const groups: string[] = [];
    for (const n of list) if (!groups.includes(groupOf(n))) groups.push(groupOf(n));
    const horizontal = here.getAttribute('data-nav-axis') === 'h';
    const onMainAxis = horizontal ? dir === 'left' || dir === 'right' : dir === 'up' || dir === 'down';
    if (!onMainAxis && groups.length > 1) {
      const gi = groups.indexOf(groupOf(here)) + (forward ? 1 : -1);
      if (gi >= 0 && gi < groups.length) {
        const g = groups[gi] ?? '';
        const mem = lastInGroup.get(g);
        setFocus(mem && list.includes(mem) ? mem : (list.find((n) => groupOf(n) === g) ?? list[0] ?? null));
        return;
      }
    }
    setFocus(list[Math.max(0, Math.min(list.length - 1, cur + (forward ? 1 : -1)))] ?? null);
  };

  const onIntent = (i: BusEvents['input:intent']): void => {
    if (!isOpen || i.to !== 'ui') return;
    if (i.source !== 'pointer') root.classList.remove('touch');
    if (i.type === 'cancel') {
      if (!opts.onCancel?.()) api.close();
    }
    else if (i.type === 'move') move(i.dir);
    else if (i.type === 'interact') {
      const list = items();
      if (!focused || !list.includes(focused)) setFocus(list[0] ?? null);
      focused?.click();
    }
  };

  const shut = (quiet: boolean): void => {
    if (!isOpen) return;
    isOpen = false;
    if (active === self) active = null;
    root.hidden = true;
    offIntent?.();
    offIntent = null;
    offSource?.();
    offSource = null;
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.blur();
    if (!quiet) bus.emit('world:input', { enabled: true });
    for (const fn of [...closers]) fn();
  };
  const self = { shut };

  xBtn.onclick = () => api.close();
  // Клик мышью по элементу навигации переносит на него фокус (capture: до обработчика кнопки, который может перерисовать список).
  body.addEventListener(
    'click',
    (e) => {
      const n = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-nav]') : null;
      if (n && body.contains(n) && !(n instanceof HTMLInputElement)) setFocus(n);
    },
    true,
  );
  root.addEventListener('click', (e) => {
    if (e.target === root) api.close();
  });

  const api: Panel = {
    root,
    body,
    footer,
    open() {
      if (isOpen) return;
      if (active) active.shut(true);
      active = self;
      isOpen = true;
      root.hidden = false;
      bus.emit('world:input', { enabled: false });
      offIntent = bus.on('input:intent', onIntent);
      // Последний источник ввода — касание или мышь: рамку выбора прячем; от клавиатуры и d-pad она возвращается.
      root.classList.remove('touch');
      offSource = bus.on('input:source', ({ source }) => root.classList.toggle('touch', source === 'pointer'));
      body.scrollTop = 0;
      lastInGroup.clear();
      setFocus(items()[0] ?? null);
    },
    close() {
      shut(false);
    },
    get isOpen() {
      return isOpen;
    },
    onClose(fn) {
      closers.add(fn);
      return () => closers.delete(fn);
    },
    setTitle(t) {
      title.textContent = t;
      frame.setAttribute('aria-label', t);
    },
    focus(target) {
      if (typeof target === 'string') {
        setFocus(items().find((n) => n.getAttribute('data-nav') === target) ?? null);
      } else setFocus(target ?? items()[0] ?? null);
    },
    syncFocus() {
      const list = items();
      if (!list.length) return setFocus(null);
      if (focused && list.includes(focused)) return;
      const byKey = focusedKey ? list.find((n) => n.getAttribute('data-nav') === focusedKey) : undefined;
      focused = null;
      setFocus(byKey ?? list[Math.min(focusedIdx, list.length - 1)] ?? null);
    },
    dispose() {
      shut(false);
      closers.clear();
      root.remove();
    },
  };
  return api;
}
