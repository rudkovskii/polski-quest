// Короткие звуки-эффекты без голоса: синтез WebAudio-тоном. Сейчас один — новый уровень опыта (`hud:xp {up}`).
// Тихий по умолчанию; тот же выключатель звука, что у озвучки; на `?mute=1` не подключается вовсе.
import type { Bus } from '../bus';
import type { BusEvents } from '../../types/bus';
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
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
    t += LEVEL_UP_STEP;
  });
  return t + LEVEL_UP_STEP * 3;
}

/** Подписка на шину: новый уровень → звук, если звук включён и контекст разбужен жестом игрока (без контекста молчим). */
export function connectSfx(bus: Bus<BusEvents>, enabled: () => boolean, ctxOf: () => AudioContext | null = audioContext): () => void {
  return bus.on('hud:xp', ({ up }) => {
    if (!up || !enabled()) return;
    const ctx = ctxOf();
    if (!ctx || ctx.state !== 'running') return;
    try {
      playLevelUp(ctx);
    } catch {
      /* звук необязателен */
    }
  });
}
