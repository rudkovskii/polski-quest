// Мелодия гимна для караоке: разбор нот из `hymn.json` (`melody`), синтез WebAudio (triangle, тихо) и «немой» прогон для показа ритма.
// Правила: звук только по тапу на ▶ (жест нужен браузеру), только если выключатель звука разрешает (`configureHymnAudio`) и нет `?mute=1`;
// на `?mute=1` и при выключенном звуке AudioContext не создаётся вовсе, ноты бегут подсветкой. Гимн звучит только здесь (не в радио, ФЕРМА_v2 §3).

export interface Note {
  /** Как в данных: «A4», «Bb4», «R» (пауза). */
  p: string;
  /** Длительность в долях (четвертная = 1). */
  d: number;
  /** Гц; null — пауза. */
  hz: number | null;
  /** MIDI-номер; null — пауза. */
  midi: number | null;
  /** Название ноты без октавы: A, B♭, C. */
  label: string;
}

export interface HymnMelody {
  bpm: number;
  lines: ReadonlyMap<string, readonly Note[]>;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** «Bb4» → {hz, midi, label}; «R» и мусор → null. */
export function parsePitch(p: string): { hz: number; midi: number; label: string } | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(p.trim());
  if (!m) return null;
  const midi = 12 * (Number(m[3]) + 1) + STEP[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { hz: 440 * 2 ** ((midi - 69) / 12), midi, label: `${m[1]}${m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : ''}` };
}

export function noteOf(p: string, d: number): Note {
  const x = parsePitch(p);
  return { p, d, hz: x?.hz ?? null, midi: x?.midi ?? null, label: x?.label ?? '' };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function notesOf(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  const out: Note[] = [];
  for (const n of raw) {
    if (!Array.isArray(n) || typeof n[0] !== 'string' || typeof n[1] !== 'number' || !(n[1] > 0)) continue;
    out.push(noteOf(n[0], n[1]));
  }
  return out;
}

/** Мелодия из `doc.melody`: `lines[].notes`, а если их нет — `patterns[line.pattern]`. */
export function parseMelody(doc: Readonly<Record<string, unknown>>): HymnMelody {
  const m = obj(doc.melody);
  const patterns = obj(m.patterns);
  const lines = new Map<string, readonly Note[]>();
  if (Array.isArray(m.lines)) {
    for (const l of m.lines) {
      const o = obj(l);
      if (typeof o.line !== 'string') continue;
      const notes = notesOf(o.notes ?? patterns[String(o.pattern)]);
      if (notes.length) lines.set(o.line, notes);
    }
  }
  const bpm = typeof m.tempo_bpm === 'number' && m.tempo_bpm > 30 && m.tempo_bpm < 240 ? m.tempo_bpm : 116;
  return { bpm, lines };
}

/** Сколько долей в строке. */
export const beatsOf = (notes: readonly Note[]): number => notes.reduce((s, n) => s + n.d, 0);

// ───────────────────────── выключатель и AudioContext ─────────────────────────

type CtxFactory = () => AudioContext;

interface Gate {
  /** Разрешает ли звук настройка игры. По умолчанию нет: пока main.ts не подключил выключатель, гимн идёт без звука. */
  sound: () => boolean;
  /** Переопределение создания контекста (тесты). */
  factory?: CtxFactory;
}

let gate: Gate = { sound: () => false };
let shared: AudioContext | null = null;

/** Подключение выключателя звука (`main.ts`: `configureHymnAudio({ sound: () => store.save.settings.sound })`) и фабрики контекста для тестов. */
export function configureHymnAudio(g: Partial<Gate>): void {
  gate = { ...gate, ...g };
  if ('factory' in g) shared = null;
}

/** `?mute=1`: контекст не создавать вообще. */
export function isMuted(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('mute') === '1';
  } catch {
    return false;
  }
}

export const soundAllowed = (): boolean => !isMuted() && gate.sound();

/** Контекст для синтеза, если звук разрешён; иначе null (контекст при этом не создаётся). Вызывать из обработчика тапа. */
export function melodyContext(): AudioContext | null {
  if (!soundAllowed()) return null;
  if (!shared) {
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const make: CtxFactory | null = gate.factory ?? (Ctor ? () => new Ctor() : null);
    if (!make) return null;
    try {
      shared = make();
    } catch {
      return null;
    }
  }
  try {
    if (shared.state === 'suspended') void shared.resume();
  } catch {
    /* без звука */
  }
  return shared;
}

/** Контекст уже есть и разбужен (жест был раньше): можно запускать без тапа. */
export const melodyWarm = (): boolean => soundAllowed() && !!shared && shared.state === 'running';

/** Громкость синтеза: тихо. */
export const MELODY_GAIN = 0.05;

/** Одна нота: мягкая атака и спад, triangle. */
function tone(ctx: AudioContext, hz: number, at: number, len: number, nodes: OscillatorNode[]): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(MELODY_GAIN, at + Math.min(0.02, len / 3));
  g.gain.setValueAtTime(MELODY_GAIN, at + Math.max(0.02, len * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(g).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + len + 0.03);
  nodes.push(osc);
}

export interface PlayHooks {
  /** Начала нота i (подсветка). */
  onNote?(i: number): void;
  /** Прогон дошёл до конца. */
  onEnd?(): void;
  /** Вернёт false, когда экран закрыт или перерисован: прогон тихо обрывается. */
  alive?(): boolean;
}

export interface PlayHandle {
  stop(): void;
  readonly running: boolean;
}

/** Проиграть ноты и/или показать подсветкой. `ctx` null — «немой» прогон (только onNote по таймерам). Не зацикливается, не ждёт ничего сам. */
export function playNotes(notes: readonly Note[], bpm: number, ctx: AudioContext | null, hooks: PlayHooks = {}): PlayHandle {
  const beat = 60 / bpm;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const nodes: OscillatorNode[] = [];
  let running = true;
  const stop = (): void => {
    if (!running) return;
    running = false;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    for (const o of nodes) {
      try {
        o.stop();
      } catch {
        /* уже остановлена */
      }
    }
    nodes.length = 0;
  };
  const t0 = ctx ? ctx.currentTime + 0.06 : 0;
  let at = 0;
  notes.forEach((n, i) => {
    const len = n.d * beat;
    if (ctx && n.hz) tone(ctx, n.hz, t0 + at, Math.max(0.05, len * 0.92), nodes);
    timers.push(
      setTimeout(() => {
        if (!running) return;
        if (hooks.alive && !hooks.alive()) return stop();
        hooks.onNote?.(i);
      }, at * 1000),
    );
    at += len;
  });
  timers.push(
    setTimeout(() => {
      if (!running) return;
      if (hooks.alive && !hooks.alive()) return stop();
      running = false;
      hooks.onEnd?.();
    }, at * 1000 + 30),
  );
  return {
    stop,
    get running() {
      return running;
    },
  };
}
