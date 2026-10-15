// Общее для экранов Wola (W-01): зависимости, рамка места (шапка с «Wola» назад), панель, запись событий.
import type { Bus } from '../../systems/bus';
import type { Content } from '../../systems/content';
import { derive, deriveContent, type Derived } from '../../systems/derive';
import type { EventDraft, LogEvent } from '../../systems/log';
import type { Progress } from '../../systems/progress';
import type { BusEvents } from '../../types/bus';
import { el } from '../../ui/dom';
import type { LessonStore } from '../../ui/lesson';
import type { Layer, Overlay } from '../../ui/overlay/host';
import { btn, plBtn, type AudioPort, type PlLabel } from '../../ui/overlay/kit';
import type { SettingsStore } from '../../ui/settings';
import type { SaladData } from '../systems/saladVisit';
import type { PlaceId } from '../systems/places';
import type { WolaBook } from '../systems/wola';
import { loadingEl, type PixAtlas } from './pix';
import { ensureWolaStyle } from './style';

export type WolaStore = LessonStore & SettingsStore & { setProgress(p: Progress): boolean };

export interface WolaDeps {
  overlay: Overlay;
  content: Content;
  book: WolaBook;
  store: WolaStore;
  bus: Bus<BusEvents>;
  audio: AudioPort;
  atlas: PixAtlas | null;
  /** Salad Story (W-02): меню, кассиры, уровни, гэги. */
  salad?: SaladData;
  clock: { now(): number; mono(): number };
  tz?: string;
  coarse?: boolean;
  /** Мс на букву при печати слова на ноутбуке; 0 — сразу (тесты). */
  typeMs?: number;
  /** Активные мс сессии (таймер склейки) для итога дня. */
  activeMs?: () => number;
  sessionStart?: () => number;
  onSession?: () => void;
  onEvent?(e: LogEvent): void;
  /** Wola (W-04): без звука «Как это пишется?» с ловушками написания (ExerciseCtx.spellTraps). */
  spellTraps?: boolean;
  /** Перейти в другое место после закрытия текущего (W-04: «Сначала огород» с ноутбука ведёт в огород). */
  go?(id: PlaceId): void;
  /** Картинки атласа готовы (W-04, `preloadPixImages`): до этого место показывает пиксельный загрузчик. */
  images?: Promise<void>;
}

export const BACK: PlLabel = { pl: 'Wola', ru: 'на улицу' };

export function derived(deps: Pick<WolaDeps, 'store' | 'content' | 'clock' | 'tz'>): Derived {
  return derive(deps.store.progress, deriveContent(deps.content), deps.clock.now(), deps.tz);
}

export function write(deps: Pick<WolaDeps, 'store' | 'onEvent'>, draft: EventDraft): LogEvent | null {
  const r = deps.store.append(draft);
  if (!r.ok) return null;
  deps.onEvent?.(r.event);
  return r.event;
}

export function changed(deps: Pick<WolaDeps, 'bus'>, kinds: BusEvents['progress:changed']['kinds'] = ['cards']): void {
  deps.bus.emit('progress:changed', { kinds });
}

export interface PlaceFrame {
  layer: Layer;
  stage: HTMLElement;
  /** Шапка: место для кнопок справа. */
  tools: HTMLElement;
  /** Низ экрана: кнопки действий места (огород: «Nawóz», «Zbiór»). */
  foot: HTMLElement;
  /** Обещание закрытия (кнопка «Wola», Esc/B). */
  closed: Promise<void>;
  close(): void;
}

/** Экран места: шапка «← Wola» + название, сцена на весь экран. Esc / B / «Wola» — назад на улицу. */
export function openPlace(deps: Pick<WolaDeps, 'overlay' | 'images'>, id: string, title: PlLabel): PlaceFrame {
  ensureWolaStyle(document);
  const layer = deps.overlay.open(`wl-layer wl-${id}`);
  const stage = el('div', { class: 'wl-stage' });
  const tools = el('div', { class: 'wl-tools', style: 'display:flex;gap:6px' });
  const foot = el('div', { class: 'wl-foot' });
  let done!: () => void;
  const closed = new Promise<void>((r) => (done = r));
  const close = (): void => {
    layer.close();
    done();
  };
  const back = plBtn(BACK, close, '', { 'data-act': 'close', 'data-nav': true, 'aria-label': 'Назад на улицу Wola' });
  layer.el.replaceChildren(
    el('div', { class: 'wl-place', 'data-place': id }, el('div', { class: 'wl-bar' }, back, el('h2', {}, el('span', { lang: 'pl' }, title.pl), el('small', {}, title.ru)), tools), stage, foot),
  );
  layer.handle(null);
  // Пока картинки атласа не готовы — пиксельный загрузчик поверх сцены (W-04), не тёмный экран.
  if (deps.images) {
    let ready = false;
    void deps.images.then(() => {
      ready = true;
      layer.el.querySelector('.wl-loading')?.remove();
    });
    queueMicrotask(() => {
      if (!ready && !layer.closed) layer.el.querySelector('.wl-place')?.append(loadingEl(title.pl));
    });
  }
  return { layer, stage, tools, foot, closed, close };
}

/** Панель в своём слое: заголовок, тело, кнопки. Возвращает выбранное действие (Esc — `cancel`). */
export function panel<A extends string>(
  overlay: Overlay,
  title: PlLabel | string,
  body: (HTMLElement | null)[],
  actions: { act: A; label: string | PlLabel; primary?: boolean }[],
  cancel: A,
  attrs: Record<string, string> = {},
): Promise<A> {
  ensureWolaStyle(document);
  const layer = overlay.open('wl-panel-layer');
  layer.el.style.justifyContent = 'center';
  return new Promise((resolve) => {
    const done = (a: A): void => {
      layer.close();
      resolve(a);
    };
    const buttons = actions.map((a) => {
      const at = { 'data-nav': true, 'data-act': a.act, ...(a.primary ? { 'data-primary': true } : {}) };
      return typeof a.label === 'string' ? btn(a.label, () => done(a.act), a.primary ? 'primary' : '', at) : plBtn(a.label, () => done(a.act), a.primary ? 'primary' : '', at);
    });
    const h2 = typeof title === 'string' ? el('h2', {}, title) : el('h2', {}, el('span', { lang: 'pl' }, title.pl), el('small', {}, title.ru));
    layer.el.replaceChildren(el('div', { class: 'pq-wood wl-panel', ...attrs }, h2, el('div', { class: 'body' }, ...body), el('div', { class: 'wl-row' }, ...buttons)));
    layer.handle({ cancel: () => (done(cancel), true) });
    // Выбор из тела панели (темы полки, банки): элемент с `data-pick` отвечает своим значением.
    layer.el.addEventListener('click', (e) => {
      const t = (e.target as Element | null)?.closest?.('[data-pick]') as HTMLButtonElement | null;
      if (t && !t.disabled && !layer.closed) done(t.getAttribute('data-pick') as A);
    });
    queueMicrotask(() => (buttons.find((b) => b.hasAttribute('data-primary')) ?? buttons[0])?.focus({ preventScroll: true }));
  });
}

export const stat = (label: string, value: string, key: string): HTMLElement =>
  el('div', { class: 'stat', 'data-stat': key }, el('span', {}, label), el('b', {}, value));

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
export const words = (n: number): string => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;

/** Размер сцены для подбора масштаба: размер слоя (есть раскладка) или окна. */
export function boxOf(node: HTMLElement): { w: number; h: number } {
  const r = node.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
  const win = node.ownerDocument.defaultView;
  return { w: win?.innerWidth || 375, h: Math.max(200, (win?.innerHeight || 700) - 60) };
}
