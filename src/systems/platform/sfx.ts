// Короткие звуки-эффекты без голоса: синтез WebAudio, тихо, в духе Stardew (мягкие тоны и шум, без семплов).
// Новый уровень (`hud:xp {up}`), шаги/полив/урожай (`fx:sfx` от сцены), «верно/неверно» (`farm:act`), окна (`world:input`).
// Тот же выключатель звука, что у озвучки; на `?mute=1` не подключается вовсе и AudioContext не трогает.
import type { Bus } from '../bus';
import type { BusEvents, SfxName } from '../../types/bus';
import { audioContext } from './audio';

/** Ноты арпеджио нового уровня: до-ми-соль-до, Гц, и длина каждой, с. */
export const LEVEL_UP_NOTES: readonly number[] = [523.25, 659.25, 783.99, 1046.5];
export const LEVEL_UP_STEP = 0.09;
/** Громкость по умолчанию: тихо. */
export const SFX_GAIN = 0.05;

/** Играет арпеджио на контексте `ctx` с момента `at`. Возвращает конец звучания, с. */
export function playLevelUp(ctx: AudioContext, at = ctx.currentTime, gain = SFX_GAIN): number {
  let t = at;
  LEVEL_UP_NOTES.forEach((hz, i) => {
    const last = i === LEVEL_UP_NOTES.length - 1;
    const len = last ? LEVEL_UP_STEP * 3 : LEVEL_UP_STEP;
    tone(ctx, 'triangle', hz, t, len, gain);
    t += LEVEL_UP_STEP;
  });
  return t + LEVEL_UP_STEP * 3;
}

/** Один тон с мягкой атакой и затуханием; `to` — куда плывёт частота к концу. */
function tone(ctx: AudioContext, type: OscillatorType, hz: number, at: number, len: number, gain: number, to?: number): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + len);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + Math.min(0.015, len / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(g).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + len + 0.02);
}

/** Короткий всплеск шума через фильтр: шаг по траве, плеск. `to` — куда плывёт частота фильтра. */
function noise(ctx: AudioContext, at: number, len: number, gain: number, type: BiquadFilterType, hz: number, to?: number): void {
  const n = Math.max(1, Math.floor(ctx.sampleRate * len));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(hz, at);
  if (to) f.frequency.exponentialRampToValueAtTime(to, at + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + Math.min(0.012, len / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(at);
  src.stop(at + len + 0.02);
}

/** Рецепты звуков действий: `k` = базовая громкость × регулятор. Длина в с — для троттлинга и тестов. */
export const SFX_RECIPES: Record<SfxName, { len: number; play(ctx: AudioContext, at: number, k: number): void }> = {
  step_grass: { len: 0.07, play: (c, t, k) => noise(c, t, 0.07, k * 0.55, 'bandpass', 1500 + Math.random() * 500) },
  step_wood: {
    len: 0.08,
    play: (c, t, k) => {
      tone(c, 'triangle', 150 + Math.random() * 25, t, 0.07, k * 1.1, 95);
      noise(c, t, 0.03, k * 0.35, 'highpass', 2400);
    },
  },
  water: {
    len: 0.32,
    play: (c, t, k) => {
      noise(c, t, 0.3, k * 0.5, 'bandpass', 2200, 900);
      tone(c, 'sine', 700, t + 0.1, 0.07, k * 0.35, 1100);
      tone(c, 'sine', 900, t + 0.2, 0.07, k * 0.3, 1400);
    },
  },
  pick: { len: 0.12, play: (c, t, k) => tone(c, 'sine', 880, t, 0.1, k * 0.9, 1320) },
  plim: {
    len: 0.4,
    play: (c, t, k) => {
      tone(c, 'sine', 1318.5, t, 0.32, k * 0.9);
      tone(c, 'triangle', 1976, t + 0.06, 0.3, k * 0.5);
    },
  },
  correct: {
    len: 0.16,
    play: (c, t, k) => {
      tone(c, 'triangle', 659.25, t, 0.07, k * 0.8);
      tone(c, 'triangle', 880, t + 0.06, 0.1, k * 0.8);
    },
  },
  wrong: { len: 0.2, play: (c, t, k) => tone(c, 'sine', 196, t, 0.18, k * 0.9, 150) },
  grow: {
    len: 0.3,
    play: (c, t, k) => {
      tone(c, 'triangle', 784, t, 0.09, k * 0.7);
      tone(c, 'triangle', 988, t + 0.07, 0.09, k * 0.7);
      tone(c, 'triangle', 1318.5, t + 0.14, 0.16, k * 0.7);
    },
  },
  open: { len: 0.1, play: (c, t, k) => tone(c, 'sine', 392, t, 0.09, k * 0.7, 523) },
  close: { len: 0.1, play: (c, t, k) => tone(c, 'sine', 523, t, 0.09, k * 0.6, 392) },
};

/** Не чаще: шаги бегущего героя и повторы одного звука не должны трещать. */
const MIN_GAP: Partial<Record<SfxName, number>> = { step_grass: 0.17, step_wood: 0.17, correct: 0.08, wrong: 0.08, water: 0.12, open: 0.12, close: 0.12 };

/** Играет звук действия. Возвращает false, если пропущен (слишком часто). */
export function playSfx(ctx: AudioContext, name: SfxName, volume = 1, last?: Map<SfxName, number>): boolean {
  const now = ctx.currentTime;
  const gap = MIN_GAP[name] ?? 0.03;
  if (last) {
    if (now - (last.get(name) ?? -1) < gap) return false;
    last.set(name, now);
  }
  SFX_RECIPES[name].play(ctx, now, SFX_GAIN * Math.max(0, Math.min(1, volume)));
  return true;
}

export interface SfxOptions {
  /** `?mute=1`: ничего не подключать, контекст не трогать. */
  mute?: boolean;
  /** Громкость эффектов 0..1 (регулятор в настройках; пока его нет — 1). */
  volume?: () => number;
}

/**
 * Подписка на шину: звук играет, если звук включён и контекст разбужен жестом игрока (без контекста молчим, свой не создаём).
 * Возвращает отписку.
 */
export function connectSfx(bus: Bus<BusEvents>, enabled: () => boolean, ctxOf: () => AudioContext | null = audioContext, opts: SfxOptions = {}): () => void {
  if (opts.mute) return () => undefined;
  const last = new Map<SfxName, number>();
  const run = (play: (ctx: AudioContext) => void): void => {
    if (!enabled()) return;
    const ctx = ctxOf();
    if (!ctx || ctx.state !== 'running') return;
    try {
      play(ctx);
    } catch {
      /* звук необязателен */
    }
  };
  const sfx = (name: SfxName): void => run((ctx) => void playSfx(ctx, name, opts.volume?.() ?? 1, last));
  const offs = [
    bus.on('hud:xp', ({ up }) => {
      if (up) run((ctx) => void playLevelUp(ctx, ctx.currentTime, SFX_GAIN * (opts.volume?.() ?? 1)));
    }),
    bus.on('fx:sfx', ({ name }) => sfx(name)),
    // Ответ: верно — мягкий «тик», неверно — приглушённый «бум».
    bus.on('farm:act', ({ kind }) => sfx(kind === 'miss' ? 'wrong' : 'correct')),
    // Окно (словарь, коробка, мини-игра, настройки): открылось — закрылось.
    bus.on('world:input', ({ enabled: on }) => sfx(on ? 'close' : 'open')),
  ];
  return () => {
    for (const off of offs) off();
  };
}
