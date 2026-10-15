// Звуки интерфейса без голоса (Wola, W-01): стук клавиш ноутбука «Słowniczek». Синтез Web Audio (шумовой щелчок
// 20 мс), файлов нет. Громкость тихая: `sfxVolume` × KEY_GAIN. Склейка не подключает это при `?mute=1` и при
// «без звука» (`enabled`), поэтому на проверках вслух ничего не звучит.
import type { Bus } from '../bus';
import type { BusEvents } from '../../types/bus';

/** Доля от `sfxVolume`: по умолчанию 0,8 × 0,15 ≈ 0,12 — щелчок слышен, но не мешает. */
export const KEY_GAIN = 0.15;

export interface SfxOptions {
  /** Громкость эффектов 0..1 (настройка `sfxVolume`). */
  volume(): number;
  /** Звук разрешён сейчас (не «без звука»). */
  enabled(): boolean;
}

export function connectSfx(bus: Bus<BusEvents>, o: SfxOptions): () => void {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  const play = (): void => {
    if (!o.enabled()) return;
    const vol = Math.max(0, Math.min(1, o.volume())) * KEY_GAIN;
    if (vol <= 0) return;
    try {
      const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx ??= new AC();
      if (ctx.state === 'suspended') void ctx.resume();
      if (!noise) {
        const n = Math.round(ctx.sampleRate * 0.02);
        noise = ctx.createBuffer(1, n, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      }
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.playbackRate.value = 0.9 + Math.random() * 0.3;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(hp).connect(g).connect(ctx.destination);
      src.start();
    } catch {
      /* звук интерфейса не критичен */
    }
  };
  return bus.on('sfx:play', ({ kind }) => {
    if (kind === 'key') play();
  });
}
