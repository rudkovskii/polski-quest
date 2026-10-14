// Склейка петли дня (I-12), как cloud.ts: вызывается из main.ts одной строкой.
//   • таймер активного времени (§4.8): касания (pointerdown/keydown на документе, intents) и видимость вкладки;
//   • грядки и «!» (`world:marks`) на входе в локацию и после каждого изменения прогресса;
//     там же объекты карты с ложным `if` (I-13);
//   • позиция Димы → `local.position` (`world:position`, §3.10);
//   • настройки `controls.*` → роутер ввода;
//   • оверлей петли дня: обход, экспресс, DaySummary, Settings (src/ui/day.ts).
import type { Router } from './input';
import { bus } from './systems/bus';
import type { Content } from './systems/content';
import { derive, deriveContent } from './systems/derive';
import type { LogEvent } from './systems/log';
import type { Clock } from './systems/platform/clock';
import { getSetting } from './systems/progress';
import { activeMsAt, activityReset, activityStart, activityTouch, activityVisible, type Activity } from './systems/session';
import type { SyncState } from './types/bus';
import { mountDay, type DayStore, type DayUi } from './ui/day';
import type { Overlay } from './ui/overlay/host';
import type { AudioPort } from './ui/overlay/kit';
import { worldMarks } from './world/dzialka';
import { buildObjects } from './world/location';
import { condCtx, evaluator } from './systems/conditions';
import type { Condition } from './types/content';

export interface DayOptions {
  root: HTMLElement;
  overlay: Overlay;
  content: Content;
  store: Promise<DayStore>;
  audio: AudioPort;
  clock: Clock;
  router?: Router;
  hasLink?: () => boolean;
  build?: string;
  onEvent?(e: LogEvent): void;
}

export interface DayGlue {
  ui: DayUi;
  activeMs(): number;
  /** Пересчитать пометки мира сейчас (dev). */
  refresh(): Promise<void>;
}

export function startDay(o: DayOptions): DayGlue {
  const { clock, content } = o;
  const doc = o.root.ownerDocument;
  let act: Activity = activityStart(clock.mono(), doc.visibilityState !== 'hidden');
  let sessionStart = clock.now();
  const touch = (): void => {
    act = activityTouch(act, clock.mono());
  };
  doc.addEventListener('pointerdown', touch, { capture: true, passive: true });
  doc.addEventListener('keydown', touch, { capture: true, passive: true });
  doc.addEventListener('visibilitychange', () => {
    act = activityVisible(act, doc.visibilityState !== 'hidden', clock.mono());
  });
  bus.on('input:intent', touch);

  let syncState: SyncState | null = null;
  bus.on('sync:status', ({ state }) => (syncState = state));

  const ui = mountDay(o.root, {
    overlay: o.overlay,
    content,
    store: o.store,
    bus,
    audio: o.audio,
    clock,
    activeMs: () => activeMsAt(act, clock.mono()),
    sessionStart: () => sessionStart,
    onSession: () => {
      act = activityReset(act, clock.mono());
      sessionStart = clock.now();
    },
    syncState: () => syncState,
    ...(o.hasLink ? { hasLink: o.hasLink } : {}),
    ...(o.build ? { build: o.build } : {}),
    onEvent: (e) => o.onEvent?.(e),
  });

  // ── Пометки мира: грядки и «!».
  let location: string | null = null;
  let queued = false;
  const refresh = async (): Promise<void> => {
    const store = await o.store;
    const id = location;
    if (!id) return;
    const map = content.maps.get(id)?.value;
    if (!map) return;
    const now = clock.now();
    const d = derive(store.progress, deriveContent(content), now);
    // Объекты с ложным `if` (§3.7, I-13): сцена их прячет, они не цель и не препятствие.
    const ok = evaluator(condCtx(content, d, store.progress.world, now));
    const hidden = buildObjects(map)
      .filter((o) => { const c = (o.src as { if?: Condition }).if; return !!c && !ok(c); })
      .map((o) => o.key);
    bus.emit('world:marks', { ...worldMarks(map, d, now, content.tuning, store.progress.world.flags), hidden });
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void refresh();
    });
  };
  bus.on('world:location', ({ id }) => {
    location = id;
    void refresh(); // сразу: сцена уже подписана и ждёт грядки
  });
  bus.on('progress:changed', schedule);
  bus.on('progress:merged', schedule);

  // ── Позиция (§5.4: «пишется в local.position при остановке»).
  bus.on('world:position', ({ location: loc, x, y }) => {
    void o.store.then((s) => {
      const p = s.local.position;
      if (p && p.location === loc && p.x === x && p.y === y) return;
      s.setLocal({ ...s.local, position: { location: loc, x, y } });
    });
  });

  // ── Настройки управления → роутер.
  const applyControls = async (): Promise<void> => {
    if (!o.router) return;
    const s = await o.store;
    o.router.setControls({ dpad: getSetting(s.progress, 'controls.dpad'), dpadSide: getSetting(s.progress, 'controls.dpadSide') });
  };
  void applyControls();
  bus.on('progress:changed', ({ kinds }) => {
    if (kinds.includes('settings')) void applyControls();
  });
  bus.on('progress:merged', () => void applyControls());

  return { ui, activeMs: () => activeMsAt(act, clock.mono()), refresh };
}
