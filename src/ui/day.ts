// Петля дня в оверлее (I-12): обработчики `ui:obchod:start` (обход, экспресс, полив по тапу грядки),
// `ui:screen:open` (summary → DaySummary, settings/export → Settings) и HUD локаций: «Obchód (N)»,
// «Ekspres», подвал (список банок), паспорт, шестерёнка. I-13: HUD во всех локациях, каждый элемент
// появляется только после флага `hud.<element>` (§4.12): obchod → Obchód и Ekspres, jars → Spiżarnia,
// passport → Paszport; шестерёнка видна всегда. В весну долг словами («грядки подсохли», §4.2).
// Один поток за раз: пока идёт обход или открыт экран, новые запросы игнорируются.
import type { Bus } from '../systems/bus';
import type { Content } from '../systems/content';
import { derive, deriveContent } from '../systems/derive';
import { cellar, gardenItems } from '../systems/garden';
import type { LogEvent } from '../systems/log';
import type { BusEvents, SyncState } from '../types/bus';
import { runDaySummary, type SummaryView } from './daySummary';
import { el } from './dom';
import type { LessonStore } from './lesson';
import { runObchod, stageLabel, type ObchodOptions } from './obchod';
import type { Overlay } from './overlay/host';
import { BTN, btn, plBtn, setPlLabel, type AudioPort } from './overlay/kit';
import { runSettings, type SettingsStore } from './settings';
import { dayState } from '../systems/session';

export type DayStore = LessonStore & SettingsStore;

export interface DayDeps {
  overlay: Overlay;
  content: Content;
  store: DayStore | Promise<DayStore>;
  bus: Bus<BusEvents>;
  audio: AudioPort;
  clock?: { now(): number; mono(): number };
  tz?: string;
  coarse?: boolean;
  typeMs?: number;
  /** Таймер активного времени (склейка, systems/session.ts). */
  activeMs?: () => number;
  sessionStart?: () => number;
  onSession?: () => void;
  hasLink?: () => boolean;
  syncState?: () => SyncState | null;
  /** Версия сборки для Settings. */
  build?: string;
  onEvent?(e: LogEvent): void;
}

export interface DayUi {
  readonly busy: boolean;
  obchod(o: ObchodOptions): Promise<void>;
  /** Итог дня; `view` — своя карточка (день 1, P-05). */
  summary(view?: SummaryView): Promise<void>;
  settings(): Promise<void>;
  dispose(): void;
}

const css = `
.pq-dhud { position: absolute; right: calc(8px + env(safe-area-inset-right)); top: calc(52px + env(safe-area-inset-top)); display: flex; flex-direction: column; align-items: flex-end; gap: 6px; z-index: 5; pointer-events: none; }
.pq-dhud[hidden] { display: none; }
.pq-dhud .pq-btn { font-size: 15px; padding: 6px 10px; pointer-events: auto; }
.pq-dhud .pq-btn[hidden] { display: none; }
.pq-cellar { width: min(100% - 16px, 520px); max-height: calc(100% - 24px); overflow-y: auto; margin: auto; padding: 18px; display: flex; flex-direction: column; gap: 8px; }
.pq-cellar h2 { margin: 0; font-size: 22px; color: #543c52; }
.pq-cellar .jar { display: flex; justify-content: space-between; gap: 10px; font-size: 18px; border-bottom: 2px dotted #c8966b; padding: 4px 0; }
.pq-cellar .jar small { color: #543c52; font-size: 15px; }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-day-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-day-style';
  s.textContent = css;
  doc.head.append(s);
}

export function mountDay(root: HTMLElement, deps: DayDeps): DayUi {
  ensureStyle(root.ownerDocument);
  const { bus, content } = deps;
  const storeP = Promise.resolve(deps.store);
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  let busy = false;

  const once = async (fn: (s: DayStore) => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await fn(await storeP);
    } finally {
      busy = false;
      void refreshHud();
    }
  };

  const obchodDeps = (store: DayStore) => ({
    overlay: deps.overlay,
    content,
    store,
    audio: deps.audio,
    bus,
    clock,
    ...(deps.tz ? { tz: deps.tz } : {}),
    ...(deps.coarse !== undefined ? { coarse: deps.coarse } : {}),
    ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
    ...(deps.activeMs ? { activeMs: deps.activeMs } : {}),
    ...(deps.onEvent ? { onEvent: deps.onEvent } : {}),
  });

  const summaryDeps = (store: DayStore, view?: SummaryView) => ({
    ...(view ? { view } : {}),
    overlay: deps.overlay,
    content,
    store,
    bus,
    clock,
    ...(deps.tz ? { tz: deps.tz } : {}),
    ...(deps.activeMs ? { activeMs: deps.activeMs } : {}),
    ...(deps.sessionStart ? { sessionStart: deps.sessionStart } : {}),
    ...(deps.onSession ? { onSession: deps.onSession } : {}),
    ...(deps.hasLink ? { hasLink: deps.hasLink } : {}),
    ...(deps.onEvent ? { onEvent: deps.onEvent } : {}),
  });

  async function obchodLoop(store: DayStore, o: ObchodOptions): Promise<void> {
    let opts = o;
    for (let guard = 0; guard < 20; guard++) {
      const r = await runObchod(obchodDeps(store), opts);
      if (r.sleep) return summaryFlow(store);
      if (!r.again) return;
      opts = { mode: 'day' };
    }
  }

  async function summaryFlow(store: DayStore, view?: SummaryView): Promise<void> {
    const out = await runDaySummary(summaryDeps(store, view));
    if (out === 'more3') await runObchod(obchodDeps(store), { mode: 'express', more3: true });
    else if (out === 'express') await runObchod(obchodDeps(store), { mode: 'express' });
  }

  const ui: DayUi = {
    get busy() {
      return busy;
    },
    obchod: (o) => once((s) => obchodLoop(s, o)),
    summary: (view) => once((s) => summaryFlow(s, view)),
    settings: () =>
      once((s) =>
        runSettings({
          overlay: deps.overlay,
          store: s,
          bus,
          clock,
          ...(deps.hasLink ? { hasLink: deps.hasLink } : {}),
          ...(deps.syncState ? { syncState: deps.syncState } : {}),
          ...(deps.build ? { build: deps.build } : {}),
        }),
      ),
    dispose() {
      for (const off of offs) off();
      hud.remove();
    },
  };

  // ── HUD локаций: элементы по флагам hud.* (I-13).
  // Кнопки HUD: польское слово + русская подпись (P-01, ПОЛИРОВКА §2.10).
  const obchodBtn = plBtn(BTN.obchod, () => void ui.obchod({ mode: 'day' }), '', { 'data-hud': 'obchod' });
  const expressBtn = plBtn(BTN.express, () => void ui.obchod({ mode: 'express' }), '', { 'data-hud': 'express', 'data-act': 'express' });
  const cellarBtn = plBtn(BTN.cellar, () => void once((s) => cellarPanel(s)), '', { 'data-hud': 'jars' });
  const passportBtn = plBtn(BTN.passport, () => bus.emit('ui:screen:open', { screen: 'passport' }), '', { 'data-hud': 'passport' });
  const hud = el(
    'div',
    { class: 'pq-dhud', hidden: true, 'data-hud-bar': 'location' },
    obchodBtn,
    expressBtn,
    cellarBtn,
    passportBtn,
    btn('⚙', () => void ui.settings(), 'icon', { 'data-hud': 'settings', 'aria-label': 'Настройки' }),
  );
  root.prepend(hud);
  let hudOn = false;
  /** Мир доступен (нет открытого оверлея): HUD под модальным слоем не нужен. */
  let worldOn = true;

  async function refreshHud(): Promise<void> {
    hud.hidden = !hudOn || !worldOn;
    if (!hudOn) return;
    const store = await storeP;
    const now = clock.now();
    const d = derive(store.progress, deriveContent(content), now, deps.tz);
    const flags = store.progress.world.flags;
    const shown = (e: string): boolean => `hud.${e}` in flags;
    obchodBtn.hidden = !shown('obchod');
    // Ekspres — своя система (P-06, день 7): до неё кнопки нет.
    expressBtn.hidden = !shown('express');
    cellarBtn.hidden = !shown('jars');
    passportBtn.hidden = !shown('passport');
    // Число на кнопке = растения с «!» (что польёт раунд сейчас). Долг (§4.2) больше на братьев,
    // придержанных до завтра; с ним «Obchód (3)» вёл бы в «Всё полито». Весна: словами, без числа.
    const n = gardenItems(d, now, content.tuning).filter((g) => g.dueCard).length;
    setPlLabel(obchodBtn, dayState(d, content.tuning).spring && n > 0 ? { pl: 'Obchód', ru: 'грядки подсохли' } : { pl: `Obchód (${n})`, ru: BTN.obchod.ru });
  }

  async function cellarPanel(store: DayStore): Promise<void> {
    const now = clock.now();
    const d = derive(store.progress, deriveContent(content), now, deps.tz);
    const jars = cellar(gardenItems(d, now, content.tuning));
    const layer = deps.overlay.open('pq-cellar-layer');
    layer.el.style.justifyContent = 'center';
    await new Promise<void>((resolve) => {
      const close = (): void => {
        layer.close();
        resolve();
      };
      const ok = btn('OK', close, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'ok' });
      layer.el.append(
        el(
          'div',
          { class: 'pq-wood pq-cellar', 'data-screen': 'cellar' },
          el('h2', {}, el('span', { lang: 'pl' }, BTN.cellar.pl), ' ', el('small', {}, BTN.cellar.ru)),
          ...(jars.length
            ? jars.map((g) => {
                const v = content.vocab.get(g.item)?.value;
                return el('div', { class: 'jar', 'data-item': g.item }, el('span', { lang: 'pl' }, v?.pl ?? g.item, ' ', el('small', {}, v?.ru ?? '')), el('b', {}, stageLabel(g)));
              })
            : [el('div', {}, 'Пока пусто. Слово закатывается в банку, когда помнишь его 35 дней.')]),
          el('div', { style: 'display:flex;justify-content:flex-end' }, ok),
        ),
      );
      layer.handle({ cancel: () => (close(), true) });
      queueMicrotask(() => ok.focus({ preventScroll: true }));
    });
  }

  const offs = [
    bus.on('ui:obchod:start', ({ mode, fromItem }) => void ui.obchod({ mode, ...(fromItem ? { fromItem } : {}) })),
    bus.on('ui:screen:open', ({ screen }) => {
      if (screen === 'summary') void ui.summary();
      else if (screen === 'settings' || screen === 'export') void ui.settings();
    }),
    bus.on('world:location', () => {
      hudOn = true;
      void refreshHud();
    }),
    bus.on('world:input', ({ enabled }) => {
      worldOn = enabled;
      hud.hidden = !hudOn || !worldOn;
    }),
    bus.on('progress:changed', () => void refreshHud()),
    bus.on('progress:merged', () => void refreshHud()),
  ];
  return ui;
}
