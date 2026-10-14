// Разблокировка аудио по первому жесту (ТЗ §5.2, §7.2). Полный рантайм аудио — I-08.

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  return ctx;
}

/** Вызывать строго внутри обработчика жеста (tap/click). */
export async function unlockAudio(): Promise<boolean> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx ??= new Ctor();
    // Тихий буфер: iOS разблокирует вывод только после реального воспроизведения внутри жеста.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    if (ctx.state !== 'running') await ctx.resume();
    return ctx.state === 'running';
  } catch (err) {
    console.warn('audio unlock failed', err);
    return false;
  }
}
