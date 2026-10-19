// Роутер ввода: сырые intents трёх источников → один поток `input:intent` в шину.
// Решает, кому адресован intent (мир или оверлей), сводит удержания («последний источник
// выигрывает»), применяет режим локации `walk | tap` и видимость d-pad.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { ControlsSettings, Dir, Focus, Intent, MapControls, Source } from './types';

export interface RouterOptions {
  bus?: Bus<BusEvents>;
  /** Устройство с грубым указателем (`pointer: coarse`). По умолчанию из matchMedia. */
  coarse?: boolean;
  controls?: Partial<ControlsSettings>;
  mapControls?: MapControls;
  focus?: Focus;
  /** Касание уже было в прошлых запусках (флаг в сохранении): d-pad виден с первого кадра. */
  touchSeen?: boolean;
  /** Первое касание в этом запуске (main.ts пишет флаг в сохранение). */
  onTouch?: () => void;
}

export interface RouterState {
  focus: Focus;
  mapControls: MapControls;
  controls: ControlsSettings;
  lastSource: Source | null;
  coarse: boolean;
  touchSeen: boolean;
  /** Текущее направление ходьбы в мире после сведения удержаний, null = стоим. */
  heldDir: Dir | null;
  dpadVisible: boolean;
}

export interface Router {
  /** Сырой intent от источника. true = intent принят (источник гасит действие браузера). */
  push(source: Source, intent: Intent): boolean;
  setFocus(focus: Focus): void;
  setMapControls(mode: MapControls): void;
  setControls(controls: Partial<ControlsSettings>): void;
  /** Было касание пальцем: на Mac d-pad появляется только после него. */
  noteTouch(): void;
  readonly state: Readonly<RouterState>;
  dispose(): void;
}

interface Held {
  source: Source;
  dir: Dir;
}

/**
 * Сенсорное устройство: грубый основной указатель, любой грубый указатель или точки касания (iPhone, iPad, эмулятор
 * телефона). Mac с трекпадом: `maxTouchPoints` = 0, указатель точный.
 */
export function detectCoarse(): boolean {
  const mq = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
  const touchPoints = typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  return mq('(pointer: coarse)') || mq('(any-pointer: coarse)') || touchPoints > 0;
}

/** Правило видимости d-pad. */
export function dpadVisible(s: Omit<RouterState, 'dpadVisible' | 'heldDir'>): boolean {
  if (s.focus === 'ui' || s.mapControls === 'tap') return false;
  if (s.controls.dpad === 'never') return false;
  if (s.controls.dpad === 'always') return true;
  // auto: телефон и планшет показывают сразу; после нажатия клавиши d-pad прячется до касания.
  return (s.coarse || s.touchSeen) && s.lastSource !== 'keyboard';
}

export function createRouter(opts: RouterOptions = {}): Router {
  const bus = opts.bus ?? globalBus;
  const state: RouterState = {
    focus: opts.focus ?? 'world',
    mapControls: opts.mapControls ?? 'walk',
    controls: { dpad: 'auto', dpadSide: 'left', ...opts.controls },
    lastSource: null,
    coarse: opts.coarse ?? detectCoarse(),
    touchSeen: opts.touchSeen ?? false,
    heldDir: null,
    dpadVisible: false,
  };
  /** Удержания в мире по порядку нажатия; действует последнее. */
  let held: Held[] = [];
  let lastDpad: { visible: boolean; side: string } | null = null;

  const emit = (intent: Intent, to: Focus, source: Source): void => {
    bus.emit('input:intent', { ...intent, to, source });
  };

  const syncDpad = (): void => {
    state.dpadVisible = dpadVisible(state);
    const side = state.controls.dpadSide;
    if (lastDpad && lastDpad.visible === state.dpadVisible && lastDpad.side === side) return;
    lastDpad = { visible: state.dpadVisible, side };
    bus.emit('input:dpad', { visible: state.dpadVisible, side });
  };

  const noteSource = (source: Source): void => {
    if (state.lastSource === source) return;
    state.lastSource = source;
    bus.emit('input:source', { source });
    syncDpad();
  };

  const top = (): Held | undefined => held[held.length - 1];

  /** Отпустить все удержания в мире (смена фокуса, режима, новый goto). */
  const releaseAll = (): void => {
    const t = top();
    held = [];
    state.heldDir = null;
    if (t) emit({ type: 'move', dir: t.dir, held: false }, 'world', t.source);
  };

  const worldMove = (source: Source, dir: Dir, isHeld: boolean): void => {
    const before = top();
    if (isHeld) {
      held = held.filter((h) => !(h.source === source && h.dir === dir));
      held.push({ source, dir });
      state.heldDir = dir;
      if (before?.dir !== dir) emit({ type: 'move', dir, held: true }, 'world', source);
      return;
    }
    const idx = held.findIndex((h) => h.source === source && h.dir === dir);
    if (idx < 0) return; // удержание уже снято (goto, смена фокуса)
    held.splice(idx, 1);
    const after = top();
    state.heldDir = after?.dir ?? null;
    if (!after) emit({ type: 'move', dir, held: false }, 'world', source);
    else if (after.dir !== before?.dir) emit({ type: 'move', dir: after.dir, held: true }, 'world', after.source);
  };

  const push = (source: Source, intent: Intent): boolean => {
    const active = !(intent.type === 'move' && !intent.held);
    if (active) noteSource(source);

    if (state.focus === 'ui') {
      // Оверлей: тап по карте = «тап мимо оверлея» = cancel; Tab остаётся браузеру.
      if (source === 'pointer') {
        emit({ type: 'cancel' }, 'ui', source);
        return true;
      }
      if (intent.type === 'focus' || intent.type === 'goto') return false;
      // В оверлее стрелка = один шаг выбора: отпускание не нужно (и не тянется хвост из мира).
      if (intent.type === 'move' && !intent.held) return true;
      emit(intent, 'ui', source);
      return true;
    }

    switch (intent.type) {
      case 'move':
        if (state.mapControls === 'tap') {
          // tap-локация: d-pad молчит, стрелки клавиатуры переключают выделенный объект.
          if (source !== 'keyboard') return false;
          if (intent.held) emit({ type: 'focus', dir: intent.dir }, 'world', source);
          return true;
        }
        worldMove(source, intent.dir, intent.held);
        return true;
      case 'focus':
        if (state.mapControls !== 'tap') return false;
        emit(intent, 'world', source);
        return true;
      case 'goto':
        releaseAll();
        emit(intent, 'world', source);
        return true;
      case 'cancel':
        if (source === 'pointer') return false; // тап мимо карты в мире ничего не значит
        emit(intent, 'world', source);
        return true;
      case 'interact':
        emit(intent, 'world', source);
        return true;
      case 'hotkey':
        emit(intent, 'world', source);
        return true;
      case 'say':
        return false; // в мире озвучивать нечего, клавиша G свободна
    }
  };

  const offWorldInput = bus.on('world:input', ({ enabled }) => router.setFocus(enabled ? 'world' : 'ui'));

  const router: Router = {
    push,
    setFocus(focus) {
      if (state.focus === focus) return;
      if (focus === 'ui') releaseAll();
      state.focus = focus;
      syncDpad();
    },
    setMapControls(mode) {
      if (state.mapControls === mode) return;
      releaseAll();
      state.mapControls = mode;
      syncDpad();
    },
    setControls(controls) {
      state.controls = { ...state.controls, ...controls };
      syncDpad();
    },
    noteTouch() {
      if (state.touchSeen) return;
      state.touchSeen = true;
      opts.onTouch?.();
      syncDpad();
    },
    get state() {
      return state;
    },
    dispose() {
      offWorldInput();
      held = [];
    },
  };

  syncDpad();
  return router;
}
