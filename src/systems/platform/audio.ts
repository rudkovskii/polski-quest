// Озвучка польского: файл из манифеста → Web Speech pl-PL → 'none'.
// Речь только через HTMLAudioElement (на iOS играет в беззвучном режиме и надёжнее после фона).
// Элементы пула создаются заранее и разблокируются тихим звуком внутри первого жеста (Title,
// любой click/touchend); потом им можно менять src без жеста. Web Audio (AudioContext) здесь
// только для SFX/музыки Phaser: его будим тем же жестом и на возврате из фона.
import type { Bus } from '../bus';
import type { AudioVia, BusEvents } from '../../types/bus';

export type { AudioVia } from '../../types/bus';

/** `public/audio/manifest.json`, пишет tools/build_audio.py. */
export interface AudioManifest {
  v: 1;
  /** Голос по умолчанию, `engine:id` (`say:Zosia` в срезе). */
  default?: string;
  /** `<voice>|<normal|slow>|<текст NFC>` → имя файла в `audio/`. */
  entries: Record<string, string>;
  files?: Record<string, { dur?: number; voice?: string; rate?: string }>;
  /** id слова, шага, реплики → текст и голос (`lx.maly`, `ch01.s03#4`, `dlg.ch01.x#n1`, `line.id`). */
  ids?: Record<string, { text: string; voice?: string; slow?: boolean }>;
}

export interface PlayOpts {
  voice?: string;
  slow?: boolean;
  /** true: встать в очередь за текущей фразой; по умолчанию новая фраза прерывает текущую. */
  queue?: boolean;
  /** Для события `audio:state` (чтобы UI знал, какая кнопка звучит). */
  id?: string;
}

export interface Speech {
  /** Резолвится, когда фраза доиграла (или прервана / пропущена). */
  play(text: string, opts?: PlayOpts): Promise<AudioVia>;
  /** Озвучить по id из манифеста; если id нет, а `text` дан — по тексту. */
  playId(id: string, opts?: PlayOpts & { text?: string }): Promise<AudioVia>;
  stop(): void;
  /** Вызывать из жеста (синхронная часть разблокирует элементы и Web Speech до первого await). */
  unlock(): Promise<void>;
  /** Манифест загружен (или не загрузился: тогда всё через Web Speech). */
  ready: Promise<void>;
  isUnlocked(): boolean;
  /** Длительность файла фразы из манифеста, с. */
  duration(text: string, opts?: { voice?: string; slow?: boolean }): number | undefined;
}

type Emit = <K extends 'audio:state' | 'audio:blocked'>(type: K, payload: BusEvents[K]) => void;

export interface SpeechDeps {
  /** База URL (`import.meta.env.BASE_URL`, с `/` в конце). */
  base: string;
  loadManifest?: () => Promise<unknown>;
  createAudio?: () => HTMLAudioElement;
  synth?: SpeechSynthesis | null;
  Utterance?: typeof SpeechSynthesisUtterance | null;
  emit?: Emit;
  poolSize?: number;
  /** Сколько ждать `voiceschanged`, мс. */
  voicesWaitMs?: number;
  /** Страховка, если `ended` не пришёл: длительность + этот запас, мс. */
  endSlackMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

export const SLOW_RATE_WEBSPEECH = 0.7;
const DEFAULT_VOICE = 'say:Zosia';

export const normText = (s: string): string => s.normalize('NFC').trim();
export const entryKey = (voice: string, slow: boolean, text: string): string => `${voice}|${slow ? 'slow' : 'normal'}|${normText(text)}`;

/** Тихий WAV (8 бит, 8 кГц, 50 мс) как data URI: разблокирует HTMLAudioElement без сети. */
export function silentWav(): string {
  const n = 400;
  const b = new Uint8Array(44 + n);
  const dv = new DataView(b.buffer);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // моно
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  str(36, 'data');
  dv.setUint32(40, n, true);
  b.fill(128, 44);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

function parseManifest(raw: unknown): AudioManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<AudioManifest>;
  if (!m.entries || typeof m.entries !== 'object') return null;
  return { v: 1, entries: m.entries, default: m.default, files: m.files ?? {}, ids: m.ids ?? {} };
}

interface Job {
  text: string;
  voice: string | undefined;
  slow: boolean;
  id: string | undefined;
  resolve: (v: AudioVia) => void;
  via: AudioVia;
  done: boolean;
  cancel?: () => void;
}

export function createSpeech(deps: SpeechDeps): Speech {
  const emit: Emit = deps.emit ?? (() => {});
  const setT = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  const synth = deps.synth === undefined ? (globalThis.speechSynthesis ?? null) : deps.synth;
  const Utter = deps.Utterance === undefined ? (globalThis.SpeechSynthesisUtterance ?? null) : deps.Utterance;
  const createAudio = deps.createAudio ?? (() => new Audio());
  const pool: HTMLAudioElement[] = [];
  for (let i = 0; i < Math.max(1, deps.poolSize ?? 2); i++) {
    const a = createAudio();
    a.preload = 'auto';
    a.setAttribute?.('playsinline', '');
    pool.push(a);
  }
  /** Элемент, который играл последним (или играет сейчас). */
  let active: HTMLAudioElement | null = null;
  let manifest: AudioManifest | null = null;
  let unlocked = false;
  let current: Job | null = null;
  let blocked: Job | null = null;
  const queue: Job[] = [];

  const load = deps.loadManifest ?? (async () => (await fetch(`${deps.base}audio/manifest.json`)).json());
  const ready = load()
    .then((raw) => {
      manifest = parseManifest(raw);
      if (!manifest) console.warn('audio: манифест не разобран, озвучка через Web Speech');
    })
    .catch((err: unknown) => console.warn('audio: манифест не загружен, озвучка через Web Speech', err));

  const defaultVoice = (): string => manifest?.default ?? DEFAULT_VOICE;
  const fileFor = (text: string, voice: string | undefined, slow: boolean): string | undefined => {
    if (!manifest) return undefined;
    const voices = voice && voice !== defaultVoice() ? [voice, defaultVoice()] : [defaultVoice()];
    for (const v of voices) {
      const f = manifest.entries[entryKey(v, slow, text)];
      if (f) return f;
    }
    return undefined;
  };
  const url = (file: string): string => `${deps.base}audio/${file}`;

  // ───────────── Web Speech ─────────────
  let plVoice: SpeechSynthesisVoice | null | undefined;
  const findPl = (): SpeechSynthesisVoice | null => {
    const vs = synth?.getVoices() ?? [];
    return vs.find((v) => v.lang?.toLowerCase().replace('_', '-') === 'pl-pl') ?? vs.find((v) => v.lang?.toLowerCase().startsWith('pl')) ?? null;
  };
  const waitPlVoice = (): Promise<SpeechSynthesisVoice | null> => {
    if (plVoice !== undefined && plVoice !== null) return Promise.resolve(plVoice);
    const now = findPl();
    if (now || !synth) return Promise.resolve((plVoice = now));
    return new Promise((done) => {
      let h: unknown;
      const fin = (): void => {
        clearT(h);
        synth.removeEventListener?.('voiceschanged', fin);
        // Не нашли — не кэшируем окончательно: голоса могут прийти позже.
        const v = findPl();
        if (v) plVoice = v;
        done(v);
      };
      synth.addEventListener?.('voiceschanged', fin);
      h = setT(fin, deps.voicesWaitMs ?? 1000);
    });
  };

  const speakWeb = async (job: Job): Promise<boolean> => {
    if (!synth || !Utter) return false;
    const voice = await waitPlVoice();
    if (!voice || job.done) return false;
    return new Promise<boolean>((done) => {
      const u = new Utter(job.text);
      u.lang = 'pl-PL';
      u.voice = voice;
      u.rate = job.slow ? SLOW_RATE_WEBSPEECH : 1;
      let settled = false;
      let guard: unknown;
      const fin = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearT(guard);
        done(ok);
      };
      // Safari иногда теряет onend: страховка по длине текста.
      guard = setT(() => fin(true), job.text.length * (job.slow ? 180 : 120) + (deps.endSlackMs ?? 2500) + 1000);
      u.onend = () => fin(true);
      u.onerror = () => fin(false);
      job.cancel = () => {
        synth.cancel();
        fin(true);
      };
      job.via = 'webspeech';
      emit('audio:state', { state: 'playing', via: 'webspeech', text: job.text, ...(job.id ? { id: job.id } : {}) });
      synth.speak(u);
    });
  };

  // ───────────── файл ─────────────
  type FileResult = 'ok' | 'error' | 'blocked';
  const playFile = (job: Job, file: string): Promise<FileResult> => {
    const src = url(file);
    // Предзагруженный элемент берём как есть, иначе другой, не тот, что играл последним.
    let el = pool.find((a) => a.src.endsWith(src));
    if (!el) {
      el = pool.find((a) => a !== active) ?? pool[0]!;
      el.src = src;
    }
    const a = el;
    active = a;
    preloadNext();
    const dur = manifest?.files?.[file]?.dur;
    return new Promise<FileResult>((done) => {
      let settled = false;
      let guard: unknown;
      const fin = (r: FileResult): void => {
        if (settled) return;
        settled = true;
        clearT(guard);
        a.removeEventListener('ended', onEnd);
        a.removeEventListener('error', onErr);
        done(r);
      };
      const onEnd = (): void => fin('ok');
      const onErr = (): void => fin('error');
      a.addEventListener('ended', onEnd);
      a.addEventListener('error', onErr);
      job.cancel = () => {
        a.pause();
        fin('ok');
      };
      try {
        a.currentTime = 0;
      } catch {
        /* элемент ещё не загрузил метаданные */
      }
      let p: Promise<void> | undefined;
      try {
        p = a.play();
      } catch (err) {
        fin(isBlocked(err) ? 'blocked' : 'error');
        return;
      }
      Promise.resolve(p).then(
        () => {
          if (settled) return;
          job.via = 'file';
          emit('audio:state', { state: 'playing', via: 'file', text: job.text, ...(job.id ? { id: job.id } : {}) });
          // iOS иногда не шлёт ended после возврата из фона: страхуемся по длительности.
          guard = setT(() => fin('ok'), (dur ?? 10) * 1000 + (deps.endSlackMs ?? 2500));
        },
        (err: unknown) => fin(isBlocked(err) ? 'blocked' : 'error'),
      );
    });
  };

  const preloadNext = (): void => {
    const next = queue[0];
    if (!next) return;
    const f = fileFor(next.text, next.voice, next.slow);
    if (!f) return;
    const free = pool.find((a) => a !== active);
    if (free && !free.src.endsWith(url(f))) {
      free.src = url(f);
      free.load?.();
    }
  };

  const finish = (job: Job, via: AudioVia): void => {
    if (job.done) return;
    job.done = true;
    job.resolve(via);
  };

  let running = false;
  const pump = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (queue.length && !blocked) {
        const job = queue.shift()!;
        current = job;
        await runJob(job);
        current = null;
      }
    } finally {
      running = false;
      if (!current && !queue.length && !blocked) emit('audio:state', { state: 'idle' });
    }
  };

  const runJob = async (job: Job): Promise<void> => {
    const file = fileFor(job.text, job.voice, job.slow);
    if (file) {
      const r = await playFile(job, file);
      if (job.done) return;
      if (r === 'ok') return finish(job, 'file');
      if (r === 'blocked') {
        // Жест потерян (возврат из фона, iOS): ждём unlock() из тоста и повторяем.
        blocked = job;
        unlocked = false;
        emit('audio:state', { state: 'blocked', text: job.text, ...(job.id ? { id: job.id } : {}) });
        emit('audio:blocked', {});
        return;
      }
      console.warn('audio: файл не сыграл, Web Speech', file);
    }
    if (await speakWeb(job)) return finish(job, 'webspeech');
    if (job.done) return;
    // Медленной версии нет ни файлом, ни Web Speech — хотя бы обычная.
    const normal = job.slow ? fileFor(job.text, job.voice, false) : undefined;
    if (normal && normal !== file && (await playFile(job, normal)) === 'ok') return finish(job, 'file');
    if (job.done) return;
    emit('audio:state', { state: 'none', via: 'none', text: job.text, ...(job.id ? { id: job.id } : {}) });
    finish(job, 'none');
  };

  const stop = (): void => {
    for (const j of queue.splice(0)) finish(j, 'none');
    if (blocked) {
      finish(blocked, 'none');
      blocked = null;
    }
    if (current) {
      const j = current;
      j.cancel?.();
      finish(j, j.via);
    }
  };

  const play = async (text: string, opts: PlayOpts = {}): Promise<AudioVia> => {
    const t = normText(text);
    if (!t) return 'none';
    await ready;
    // stop() после await: две быстрые фразы подряд = вторая прерывает первую, а не встаёт за ней.
    if (!opts.queue) stop();
    return new Promise<AudioVia>((resolve) => {
      queue.push({ text: t, voice: opts.voice, slow: !!opts.slow, id: opts.id, resolve, via: 'none', done: false });
      if (current) preloadNext();
      void pump();
    });
  };

  const playId = async (id: string, opts: PlayOpts & { text?: string } = {}): Promise<AudioVia> => {
    await ready;
    const rec = manifest?.ids?.[id];
    const text = rec?.text ?? opts.text;
    if (!text) {
      console.warn('audio: нет озвучки для id', id);
      emit('audio:state', { state: 'none', via: 'none', id });
      return 'none';
    }
    return play(text, { ...opts, voice: opts.voice ?? rec?.voice, id });
  };

  const unlock = (): Promise<void> => {
    // Всё синхронно до первого await: iOS засчитывает жест только так.
    const tasks: Promise<unknown>[] = [];
    const silent = silentWav();
    for (const a of pool) {
      if (a === undefined) continue;
      if (a === active && current && !current.done) continue;
      try {
        a.src = silent;
        const p = a.play();
        tasks.push(Promise.resolve(p).catch(() => undefined));
      } catch {
        /* старые браузеры */
      }
    }
    if (synth && Utter) {
      try {
        const u = new Utter(' ');
        u.volume = 0;
        synth.speak(u);
      } catch {
        /* нет Web Speech */
      }
    }
    unlocked = true;
    const retry = blocked;
    blocked = null;
    return Promise.all(tasks).then(() => {
      if (retry && !retry.done) {
        queue.unshift(retry);
        void pump();
      }
    });
  };

  const duration = (text: string, opts: { voice?: string; slow?: boolean } = {}): number | undefined => {
    const f = fileFor(text, opts.voice, !!opts.slow);
    return f ? manifest?.files?.[f]?.dur : undefined;
  };

  return { play, playId, stop, unlock, ready, isUnlocked: () => unlocked, duration };
}

function isBlocked(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'NotAllowedError';
}

// ───────────────────────── синглтон и склейка ─────────────────────────

let ctx: AudioContext | null = null;
let speech: Speech | null = null;

export function audioContext(): AudioContext | null {
  return ctx;
}

/** Общий экземпляр для игры (создаётся лениво, манифест грузится сразу). */
export function getSpeech(): Speech {
  speech ??= createSpeech({ base: import.meta.env.BASE_URL, emit: (t, p) => emitter?.(t, p) });
  return speech;
}

let emitter: Emit | null = null;

/**
 * Разблокировка аудио: элементы речи, Web Speech и AudioContext.
 * Вызывать строго внутри обработчика жеста (tap/click): синхронная часть идёт первой.
 */
export async function unlockAudio(): Promise<boolean> {
  const sp = getSpeech().unlock();
  let ok = false;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      ctx ??= new Ctor();
      // Тихий буфер: iOS разблокирует вывод только после реального воспроизведения внутри жеста.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      if (ctx.state !== 'running') await ctx.resume();
      ok = ctx.state === 'running';
    }
  } catch (err) {
    console.warn('audio unlock failed', err);
  }
  await sp;
  return ok || getSpeech().isUnlocked();
}

/**
 * Склейка с шиной (вызывает main.ts): `audio:play`/`audio:stop`/`audio:unlock`, разблокировка на первом
 * жесте (click/touchend — это «жест» для iOS), `visibilitychange` → `AudioContext.resume()`, стоп в фоне.
 */
export function connectAudio(bus: Bus<BusEvents>, doc: Document = document): () => void {
  emitter = (t, p) => bus.emit(t, p);
  const sp = getSpeech();
  const offs: (() => void)[] = [];
  offs.push(
    bus.on('audio:play', ({ id, text, slow, voice, queue, done }) => {
      const opts: PlayOpts = { slow: !!slow, queue: !!queue };
      if (voice) opts.voice = voice;
      const p = id ? sp.playId(id, text ? { ...opts, text } : opts) : text ? sp.play(text, opts) : Promise.resolve<AudioVia>('none');
      void p.then((via) => done?.(via));
    }),
  );
  offs.push(bus.on('audio:stop', () => sp.stop()));
  // Тост «Нажми, чтобы включить звук»: emit идёт синхронно из обработчика тапа, жест сохраняется.
  offs.push(bus.on('audio:unlock', () => void unlockAudio()));

  const onGesture = (): void => {
    if (sp.isUnlocked()) return;
    void unlockAudio();
  };
  doc.addEventListener('click', onGesture, true);
  doc.addEventListener('touchend', onGesture, true);
  const onVis = (): void => {
    if (doc.visibilityState === 'hidden') {
      sp.stop();
      return;
    }
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  };
  doc.addEventListener('visibilitychange', onVis);
  offs.push(() => {
    doc.removeEventListener('click', onGesture, true);
    doc.removeEventListener('touchend', onGesture, true);
    doc.removeEventListener('visibilitychange', onVis);
  });
  return () => {
    for (const off of offs) off();
    emitter = null;
  };
}
