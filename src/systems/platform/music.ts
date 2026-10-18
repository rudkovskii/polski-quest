// Плеер музыки (V11b): HTMLAudio, плейлист по кругу, плавные переходы, разблокировка по первому жесту,
// пауза на скрытой вкладке. Настройки (вкл, громкость, трек, повтор) хранит вызывающий: `get`/`set`.
// `?mute=1` (`mute: true`): аудио не создаётся и не играет, переключатели работают как обычно.
import {
  MUSIC_DEFAULT,
  stepTrack,
  trackById,
  type MusicControl,
  type MusicRepeat,
  type MusicSettings,
  type MusicView,
} from '../musicSettings';

/** Во сколько раз музыка тише, пока открыта мини-игра. */
export const DUCK_FACTOR = 0.35;
/** Плавность: затухание старого трека и нарастание нового, мс. */
export const FADE_OUT_MS = 450;
export const FADE_IN_MS = 900;
const STEP_MS = 40;

export interface MusicDeps {
  /** `?mute=1`: аудио не создавать. */
  mute?: boolean;
  /** Каталог треков: `<base>music/<id>.m4a`. */
  base?: string;
  get(): MusicSettings;
  set(next: MusicSettings): void;
  /** Фабрика аудио-элемента (тесты подставляют заглушку). */
  create?(src: string): HTMLAudioElement;
  doc?: Document;
  /** Контекст Web Audio для iOS, где `HTMLAudioElement.volume` не работает (громкость идёт через GainNode). */
  ctxOf?(): AudioContext | null;
}

export interface MusicPlayer extends MusicControl {
  /** Игрок вошёл в `home`/`farm`: при выключенном «по всей ферме» музыка играет только дома. */
  setLocation(id: string): void;
  /** Мини-игра открыта: музыка тише. */
  setDuck(on: boolean): void;
  dispose(): void;
}

export function createMusicPlayer(deps: MusicDeps): MusicPlayer {
  const doc = deps.doc ?? document;
  const base = deps.base ?? '/';
  const muted = !!deps.mute;
  const listeners = new Set<(v: MusicView) => void>();
  let audio: HTMLAudioElement | null = null;
  let gain: GainNode | null = null;
  let fixedVolume = false;
  let loadedId = '';
  let location = 'home';
  let duck = false;
  let blocked = false;
  /** Множитель плавного перехода 0..1. */
  let fade = 0;
  let ramp: ReturnType<typeof setInterval> | null = null;
  let switching = 0;
  let disposed = false;
  let unlockOff: (() => void) | null = null;

  const cfg = (): MusicSettings => ({ ...MUSIC_DEFAULT, ...deps.get() });
  const hidden = (): boolean => doc.visibilityState === 'hidden';
  const placeOk = (c: MusicSettings): boolean => c.everywhere || location === 'home';
  const wanted = (c = cfg()): boolean => c.on && !muted && !hidden() && placeOk(c);
  const view = (): MusicView => ({ ...cfg(), playing: !!audio && !audio.paused && !blocked && wanted(), muted });
  const emit = (): void => {
    const v = view();
    for (const fn of [...listeners]) fn(v);
  };
  const commit = (patch: Partial<MusicSettings>): void => {
    deps.set({ ...cfg(), ...patch });
  };

  const level = (): number => (cfg().volume / 100) * (duck ? DUCK_FACTOR : 1) * fade;
  const applyVolume = (): void => {
    if (!audio) return;
    const v = Math.min(1, Math.max(0, level()));
    if (gain) gain.gain.value = v;
    else audio.volume = v;
  };
  const stopRamp = (): void => {
    if (ramp) clearInterval(ramp);
    ramp = null;
  };
  /** Плавно привести `fade` к `to` за `ms`; потом `done`. */
  const fadeTo = (to: number, ms: number, done?: () => void): void => {
    stopRamp();
    const from = fade;
    if (ms <= 0 || from === to) {
      fade = to;
      applyVolume();
      done?.();
      return;
    }
    const steps = Math.max(1, Math.round(ms / STEP_MS));
    let n = 0;
    ramp = setInterval(() => {
      n++;
      fade = from + (to - from) * Math.min(1, n / steps);
      applyVolume();
      if (n >= steps) {
        stopRamp();
        done?.();
      }
    }, STEP_MS);
  };

  const ensureAudio = (): HTMLAudioElement => {
    if (audio) return audio;
    const a = deps.create ? deps.create('') : new Audio();
    a.preload = 'auto';
    a.addEventListener('ended', onEnded);
    audio = a;
    // iOS: громкость элемента не меняется. Тогда идём через GainNode общего AudioContext.
    try {
      a.volume = 0.5;
      fixedVolume = Math.abs(a.volume - 0.5) > 0.01;
    } catch {
      fixedVolume = true;
    }
    if (fixedVolume) {
      try {
        const ctx = deps.ctxOf?.() ?? null;
        if (ctx) {
          gain = ctx.createGain();
          ctx.createMediaElementSource(a).connect(gain);
          gain.connect(ctx.destination);
        }
      } catch {
        gain = null;
      }
    }
    return a;
  };

  function onEnded(): void {
    // repeat=one играет через `loop`; сюда попадаем только в режиме «по кругу».
    if (disposed) return;
    commit({ track: stepTrack(cfg().track, 1) });
    loadedId = '';
    sync();
  }

  const onGesture = (): void => {
    disarm();
    blocked = false;
    sync();
  };
  const arm = (): void => {
    if (unlockOff) return;
    const evs = ['click', 'touchend', 'keydown'];
    for (const e of evs) doc.addEventListener(e, onGesture, { capture: true });
    unlockOff = () => {
      for (const e of evs) doc.removeEventListener(e, onGesture, { capture: true });
    };
  };
  function disarm(): void {
    unlockOff?.();
    unlockOff = null;
  }

  const startPlayback = (a: HTMLAudioElement): void => {
    let p: Promise<void> | void;
    try {
      p = a.play();
    } catch {
      blocked = true;
      arm();
      emit();
      return;
    }
    if (p && typeof p.then === 'function') {
      p.then(
        () => {
          blocked = false;
          emit();
        },
        () => {
          // Автозапуск без жеста: ждём первый жест и повторяем.
          blocked = true;
          arm();
          emit();
        },
      );
    }
  };

  /** Привести звук к настройкам: играть, сменить трек, поставить на паузу. */
  function sync(): void {
    if (disposed || muted) {
      emit();
      return;
    }
    const c = cfg();
    if (!wanted(c)) {
      if (audio && !audio.paused) {
        if (hidden()) {
          stopRamp();
          fade = 0;
          audio.pause();
        } else {
          fadeTo(0, FADE_OUT_MS, () => {
            if (!wanted()) audio?.pause();
            emit();
          });
        }
      }
      emit();
      return;
    }
    const a = ensureAudio();
    a.loop = c.repeat === 'one';
    if (loadedId !== c.track) {
      // Смена трека: старый затухает, новый нарастает.
      const token = ++switching;
      const load = (): void => {
        if (token !== switching || disposed) return;
        loadedId = c.track;
        a.src = `${base}music/${c.track}.m4a`;
        fade = 0;
        applyVolume();
        startPlayback(a);
        fadeTo(1, FADE_IN_MS);
      };
      if (!a.paused && loadedId) fadeTo(0, FADE_OUT_MS, load);
      else load();
      emit();
      return;
    }
    if (a.paused) {
      startPlayback(a);
      fadeTo(1, FADE_IN_MS);
    } else if (fade < 1 && !ramp) fadeTo(1, FADE_IN_MS);
    else applyVolume();
    emit();
  }

  const onVisibility = (): void => sync();
  doc.addEventListener('visibilitychange', onVisibility);
  // Музыка была включена в прошлый раз: пробуем сразу, браузер без жеста откажет, тогда ждём первый жест.
  if (!muted && cfg().on) queueMicrotask(sync);

  const api: MusicPlayer = {
    view,
    setOn(on) {
      if (cfg().on === on) return;
      commit({ on });
      if (on) blocked = false;
      sync();
    },
    toggle() {
      api.setOn(!cfg().on);
    },
    select(id, play = false) {
      const track = trackById(id).id;
      commit({ track, ...(play ? { on: true } : {}) });
      if (play) blocked = false;
      sync();
    },
    next() {
      api.select(stepTrack(cfg().track, 1));
    },
    prev() {
      api.select(stepTrack(cfg().track, -1));
    },
    setVolume(v) {
      commit({ volume: Math.min(100, Math.max(0, Math.round(v))) });
      applyVolume();
      emit();
    },
    setRepeat(r: MusicRepeat) {
      commit({ repeat: r });
      if (audio) audio.loop = r === 'one';
      emit();
    },
    setEverywhere(on) {
      commit({ everywhere: on });
      sync();
    },
    setLocation(id) {
      if (location === id) return;
      location = id;
      sync();
    },
    setDuck(on) {
      if (duck === on) return;
      duck = on;
      applyVolume();
      emit();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      disposed = true;
      stopRamp();
      disarm();
      doc.removeEventListener('visibilitychange', onVisibility);
      audio?.pause();
      audio = null;
      listeners.clear();
    },
  };
  return api;
}
