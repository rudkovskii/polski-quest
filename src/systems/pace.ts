// Темп главы (P-06, ПОЛИРОВКА §2 р. 4–6, СЮЖЕТ_v2 §3): номер игрового дня, расписание раскрытия систем
// («не больше одной новой системы в игровой день»), шаги урока, которые сегодня рано или не играются без
// звука, и реплики-варианты для режима без звука. Чистые функции: время и флаги приходят параметрами.
//
// Игровой день: день 1 длится, пока не поставлен флаг `beat.first_day_done` (вступление, сон первого дня);
// дальше каждый засчитанный день (`isPlayedDay`) добавляет 1. Сегодняшний день — текущий, даже если ещё
// не засчитан. Так первый день, растянутый на два календарных, не съедает день 2 с письмом и турникетом.
//
// Расписание (`director.json` → `schedule`): запись = одна система дня (`with` — что входит в неё же). Система
// открыта, если её день наступил и она уже показывалась (флаг `sys.<system>` записи) или может показаться
// сегодня: сегодня ещё не показывали другую систему. Флаг ставит склейка (src/flow.ts), когда шаг с системой
// выполнен. Дни в расписании разные и по возрастанию (валидатор), так что в свой день система одна.
import type { DayLines, Lesson, Line, PaceSystem, ScheduleEntry, Step } from '../types/content';
import type { Content } from './content';
import { isPlayedDay, type Derived } from './derive';
import { dayOf, type Day, type TimeOpts, type Ts } from './time';

/** Флаг конца первого дня (тот же, что FIRST_DAY_DONE в director.ts; здесь, чтобы conditions.ts не зависел от режиссёра). */
export const FIRST_DAY_DONE_FLAG = 'beat.first_day_done';
/** Флаг показа системы из расписания: `sys.<system записи>`, значение — время первого показа. */
export const sysFlag = (system: PaceSystem): string => `sys.${system}`;

export type SystemState = 'closed' | 'new' | 'open';

/** Номер игрового дня главы (атом `gameDay`): день 1 до сна дня 1, дальше +1 за каждый день, закрытый сном. */
export function storyDay(d: Pick<Derived, 'days' | 'today'>, flags: Readonly<Record<string, Ts>>, opts: TimeOpts = {}): number {
  const at = flags[FIRST_DAY_DONE_FLAG];
  if (at === undefined) return 1;
  const x = dayOf(at, opts);
  if (d.today <= x) return 1;
  let n = 2;
  // P-11: игровой день закрывает только сон. Не лёг спать — следующий календарный день продолжает тот же игровой
  // день (заголовок и сюжет не обгоняют игрока, прогресс дня не теряется).
  // Сон закрывает день, если в нём (или в незакрытых днях до него) что-то сыграно.
  let open = false;
  for (const day of Object.keys(d.days).sort()) {
    if (day <= x || day >= d.today) continue;
    const s = d.days[day]!;
    open ||= isPlayedDay(s);
    if (open && s.segs.includes('sleep')) {
      n++;
      open = false;
    }
  }
  return n;
}

export interface PaceCtx {
  /** Игровой день (storyDay). */
  day: number;
  today: Day;
  flags: Readonly<Record<string, Ts>>;
  schedule: readonly ScheduleEntry[];
  opts?: TimeOpts;
}

/** Контекст расписания из контента, вывода и флагов (склейка, UI). */
export function paceCtxOf(content: Pick<Content, 'director' | 'tuning'>, d: Pick<Derived, 'days' | 'today'>, flags: Readonly<Record<string, Ts>>, tz?: string): PaceCtx {
  const opts: TimeOpts = { dayStartHour: content.tuning.dayStartHour, ...(tz ? { tz } : {}) };
  return { day: storyDay(d, flags, opts), today: d.today, flags, schedule: content.director.schedule ?? [], opts };
}

/** Шлюз шагов урока на сегодня: закрытые системы, режим без звука, транскрипции и переводы пар из контента. */
export function stepGateOf(content: Pick<Content, 'vocab' | 'pairs'>, pace: PaceCtx, silent: boolean): StepGate {
  return {
    closed: (s) => !isOpen(s, pace),
    silent,
    trOf: (item) => content.vocab.get(item)?.value.tr,
    pairRu: (item) => !!content.pairs.get(item)?.ru,
  };
}

/** Запись расписания, в которую входит система (сама или в `with`). */
export function entryOf(schedule: readonly ScheduleEntry[], sys: PaceSystem): ScheduleEntry | undefined {
  return schedule.find((e) => e.system === sys || (e.with ?? []).includes(sys));
}

/**
 * Состояние системы сегодня: `closed` — рано (день не наступил, или раньше по расписанию не всё показано, или
 * сегодня уже показали другую систему), `new` — показывается впервые сегодня, `open` — показана в прошлые дни.
 * Системы вне расписания открыты всегда.
 */
export function systemState(sys: PaceSystem, c: PaceCtx): SystemState {
  const e = entryOf(c.schedule, sys);
  if (!e) return 'open';
  const shownAt = c.flags[sysFlag(e.system)];
  if (shownAt !== undefined) return dayOf(shownAt, c.opts) < c.today ? 'open' : 'new';
  // День 1 — вступление (P-05): его системы открыты с первого кадра, флаг не нужен.
  if (e.day <= 1) return 'open';
  if (c.day < e.day) return 'closed';
  // Система, не показанная в свой день (нечего было показать), не держит следующие: она просто ждёт дня,
  // когда сегодня ещё не показывали другую.
  return newToday(c).some((x) => x !== e.system) ? 'closed' : 'new';
}

export const isOpen = (sys: PaceSystem, c: PaceCtx): boolean => systemState(sys, c) !== 'closed';

/** Записи расписания, впервые показанные сегодня (правило: не больше одной). */
export function newToday(c: Pick<PaceCtx, 'today' | 'flags' | 'schedule' | 'opts'>): PaceSystem[] {
  return c.schedule.filter((e) => {
    const at = c.flags[sysFlag(e.system)];
    return at !== undefined && dayOf(at, c.opts) === c.today;
  }).map((e) => e.system);
}

/** Проблемы расписания (валидатор и тест): дни по возрастанию и разные, система не повторяется. */
export function scheduleIssues(schedule: readonly ScheduleEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let prev = 0;
  schedule.forEach((e, i) => {
    if (e.day <= prev) out.push(`schedule[${i}]: день ${e.day} не больше предыдущего (${prev}): в игровой день не больше одной новой системы`);
    prev = Math.max(prev, e.day);
    for (const s of [e.system, ...(e.with ?? [])]) {
      if (seen.has(s)) out.push(`schedule[${i}]: система ${s} уже есть в расписании`);
      seen.add(s);
    }
  });
  return out;
}

/** Реплики дня из `director.days`. */
export function dayLines(days: readonly DayLines[] | undefined, day: number): DayLines | undefined {
  return days?.find((d) => d.day === day);
}

// ── Шаги урока: что сегодня рано (система закрыта) и что без звука.

/** Шаги с полем ввода (экранная клавиатура, день 3). */
const KEYBOARD_STEPS: ReadonlySet<Step['t']> = new Set(['type', 'dictation']);
/** Шаги на слух: без звука — чтение по транскрипции, а если её нет — пропуск. */
export const AUDIO_STEPS: ReadonlySet<Step['t']> = new Set(['listen', 'dictation', 'minimal_pair', 'stress']);

export interface StepGate {
  /** Система закрыта (по расписанию): клавиатура, озвучка «повтори вслух». */
  closed: (sys: PaceSystem) => boolean;
  /** Режим без звука (`settings['sound.mode'] === 'off'`). */
  silent: boolean;
  /** Транскрипция слова (vocab.tr). */
  trOf?: (item: string) => string | undefined;
  /** Пара есть и у неё есть перевод (без звука минимальная пара = «какое слово значит …»). */
  pairRu?: (item: string) => boolean;
}

/** Шаг играется сегодня: система открыта; без звука — есть чем заменить звук. */
export function stepPlayable(s: Step, g: StepGate): boolean {
  if (KEYBOARD_STEPS.has(s.t) && g.closed('keyboard')) return false;
  if (s.t === 'shadow' && g.closed('shadow')) return false;
  if (!g.silent) return true;
  switch (s.t) {
    case 'listen':
      // Без звука: «как пишется [транскрипция]?». Нет транскрипции — показ написания сделал бы шаг пустым.
      return !!(s.tr ?? (s.item ? g.trOf?.(s.item) : undefined));
    case 'dictation':
      return !!(s.tr ?? (s.item ? g.trOf?.(s.item) : undefined));
    case 'minimal_pair':
      return s.mode !== 'same_diff' && (!!s.tr || (!!s.item && !!g.pairRu?.(s.item)));
    default:
      return true;
  }
}

/** Урок без шагов, которые сегодня не играются (id шагов сохраняются: `<lessonId>#<i>`). Все отфильтрованы — исходный. */
export function lessonForToday(lesson: Lesson, g: StepGate): Lesson {
  if (!lesson.steps) {
    if (!lesson.parts) return lesson;
    const parts = lesson.parts.map((p) => {
      const steps = p.steps.map((s, i) => ({ s, i })).filter(({ s }) => stepPlayable(s, g)).map(({ s, i }) => ({ ...s, id: s.id ?? `${lesson.id}#${p.id}.${i}` }) as Step);
      return steps.length && steps.length !== p.steps.length ? { ...p, steps: steps as [Step, ...Step[]] } : p;
    });
    return parts.some((p, i) => p !== lesson.parts![i]) ? { ...lesson, parts: parts as typeof lesson.parts } : lesson;
  }
  const keep = lesson.steps.map((s, i) => ({ s, i })).filter(({ s }) => stepPlayable(s, g));
  if (!keep.length || keep.length === lesson.steps.length) return lesson;
  const steps = keep.map(({ s, i }) => ({ ...s, id: s.id ?? `${lesson.id}#${i}` }) as Step);
  return { ...lesson, steps: steps as [Step, ...Step[]] };
}

// ── Реплики без звука (СЮЖЕТ_v2 §7): у строки `<id>.mute` есть вариант для режима без звука.

export const MUTE_SUFFIX = '.mute';

/** Реплика с учётом режима: без звука — `<id>.mute`, если есть. */
export function lineFor(id: string, silent: boolean, lines: ReadonlyMap<string, Line>): string {
  return silent && lines.has(id + MUTE_SUFFIX) ? id + MUTE_SUFFIX : id;
}

/** Карта реплик, где без звука `get(id)` отдаёт вариант `<id>.mute` (для диалогов и окна реплик). */
export function muteLines(lines: ReadonlyMap<string, Line>): ReadonlyMap<string, Line> {
  return new Proxy(lines as Map<string, Line>, {
    get(target, prop) {
      if (prop === 'get') return (id: string) => target.get(lineFor(id, true, target)) ?? target.get(id);
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
