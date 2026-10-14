// Режиссёр (ТЗ §4.12, §5.0, КОНЦЕПТ §5б, I-13): в любой момент ровно один следующий шаг. Чистая и
// детерминированная `nextStep(input)`: правила 1–10 по приоритету, слоты сюжетных битов из director.json,
// раскрытие элементов HUD (`reveals`). Ничего не пишет: флаги `beat.*`, `hud.*`, `spring.*` ставит склейка
// (src/flow.ts), когда шаг показан или выполнен. Меню режимов нет: что делать, решает только этот модуль.
import type { Condition, Effect, HudElement, Lesson, PaceSystem, Tuning } from '../types/content';
import type { Content } from './content';
import { condCtx, evaluate, lessonVariant, type CondCtx } from './conditions';
import { derive, deriveContent, isPlayedDay, type Derived } from './derive';
import { gardenItems } from './garden';
import type { LogEvent } from './log';
import { dayLines, isOpen, storyDay, systemState, type PaceCtx } from './pace';
import type { LocalState, Progress, WorldState } from './progress';
import { dueQueue, newContentLock, pickRemedy } from './queue';
import { cardId } from './srs';
import { daysBetween, isoWeekday, type Day, type Ts } from './time';

export type StepKind = 'intro' | 'resume' | 'spring' | 'beat' | 'water' | 'remedy' | 'scene' | 'boss' | 'evening' | 'sleep' | 'done';
/** Шаги первого дня (§5.0); флаги `beat.first.f1…f6`, финал — `beat.first_day_done`. */
export type FirstStep = 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6';
export type BeatSlot = 'start' | 'afterWater' | 'afterScene' | 'beforeSleep';

/** Куда вести игрока (§4.12). `item` — растение на грядке `plot` (полив одной грядки в F2). */
export interface Target {
  location: string;
  object?: string;
  npc?: string;
  plot?: string;
  screen?: string;
  item?: string;
}

export type LocalResume = NonNullable<LocalState['resume']>;

export interface TodayDone {
  water: boolean;
  remedy: boolean;
  scene: boolean;
  evening: boolean;
  sleep: boolean;
  /** Активные минуты сессии (таймер склейки, §4.8). */
  activeMin: number;
}

export interface DirectorInput {
  derived: Derived;
  world: WorldState;
  content: Content;
  tuning: Tuning;
  now: Ts;
  today: Day;
  weekday: number;
  /** Последний засчитанный день, кроме сегодняшнего. */
  lastPlayedDay: Day | null;
  todayDone: TodayDone;
  resume: LocalResume | null;
  /** Журнал: лекарство по тегам ошибок (§4.4) считается по событиям. */
  events: readonly LogEvent[];
  /** Пояс (тесты); по умолчанию пояс устройства. */
  tz?: string;
  /** Игровой день главы (P-06, pace.storyDay): день 1 — вступление, дальше +1 за засчитанный день. */
  day: number;
}

export interface DirectorStep {
  kind: StepKind;
  target: Target;
  /** Шаг первого дня (kind intro). */
  f?: FirstStep;
  /** scene / boss / remedy / resume / intro F4. */
  lesson?: string;
  /** Как поливать: day — обход, practice — одна грядка без SRS (F2), phonetic — вечер на звуки. */
  mode?: 'day' | 'practice' | 'phonetic';
  /** Вечер: сколько пар и какой кластер первым (F5 — 3 пары самого красного). */
  limit?: number;
  cluster?: string;
  /** Реплика бобра при входе в шаг (story/lines.json). */
  line?: string;
  /** Следующие коробки той же реплики (P-06: одна коробка = 2 строки по 40 символов). */
  lines?: string[];
  /** Шаг впервые показывает систему из расписания (P-06): склейка ставит флаг `sys.<system>`. */
  system?: PaceSystem;
  /** Вечер с выбором (день 6+): рыбалка или табличка. */
  choose?: boolean;
  /** Что раскрыть сейчас (правило `reveals`). */
  reveal?: HudElement[];
  /** Бит: id (флаг `beat.<id>`), эффекты. */
  beat?: string;
  do?: Effect[];
  /** done: мягкая опция «ещё 3 минуты» и чем её играть. */
  more3?: 'express' | 'phonetic';
  /** Какое правило сработало (dev-оверлей). */
  reason: string;
}

// ── Константы первого дня и точки мира (ids контента, проверяет director.test.ts).

export const FIRST_DAY = {
  dzialka: 'ch01.dzialka',
  metro: 'ch01.metro',
  plot: 'grzadki',
  /** Сцена вступления (F1): две плитки «Dzień dobry» / «Do widzenia», `intro` слова, печать №1. */
  introLesson: 'ch01.intro',
  introItem: 'lx.dzien_dobry',
  /** Объекты działki: альтанка (сон), берег Вислы (вечер на звуки). */
  sleepObject: 'altana_sleep',
  eveningObject: 'ryby',
  /** Пары на первый вечер (§5.0 F5). */
  firstEveningPairs: 3,
} as const;

/** Флаг шага первого дня. */
export const firstFlag = (f: FirstStep): string => `beat.first.${f}`;
export const FIRST_DAY_DONE = 'beat.first_day_done';
/** Решение после диагностики (склейка): активных минут меньше порога → сначала ремонтная сцена (§5.0 F4). */
export const FIRST_REPAIR_FLAG = 'beat.first.f4r';
export const springFlag = (lastPlayed: Day): string => `spring.${lastPlayed}`;
export const hudFlag = (e: HudElement): string => `hud.${e}`;
/** Флаг показа бита: `once` (по умолчанию) — навсегда, иначе — на игровой день. */
export const beatFlag = (id: string, once: boolean, today: Day): string => (once ? `beat.${id}` : `beat.${id}.${today.replace(/-/g, '_')}`);

/**
 * Реплики переходов (СЮЖЕТ_v2 §5 «Системные реплики sys.*», story/lines.json). Первый день (waterFirst, move)
 * ведёт вступление P-05; реплики конкретного дня — `director.json` → `days`.
 */
export const LINES = {
  waterFirst: 'kazik.water.first',
  waterDue: 'sys.kazik.obchod',
  debtJam: 'sys.kazik.jam',
  sunday: 'sys.kazik.sunday.1',
  move: 'kazik.move.first',
  repair: 'sys.kazik.repair',
  extraRepair: 'sys.kazik.extra_repair',
  resume: 'sys.kazik.resume',
  sleep: 'sys.kazik.sleep',
  spring: 'sys.kazik.return',
  evening: 'sys.kazik.evening',
  done: 'sys.kazik.done',
  more3: 'sys.kazik.express',
} as const;

/** Вторые коробки системных реплик (СЮЖЕТ_v2: `<id>.2`). */
export const LINES_MORE: Readonly<Record<string, readonly string[]>> = {
  'sys.kazik.jam': ['sys.kazik.jam.2'],
  'sys.kazik.sunday.1': ['sys.kazik.sunday.2'],
  'sys.kazik.repair': ['sys.kazik.repair.2'],
  'sys.kazik.resume': ['sys.kazik.resume.2'],
  'sys.kazik.return': ['sys.kazik.return.2'],
  'sys.kazik.done': ['sys.kazik.done.2'],
};

/** Реплика шага и её продолжение: первая — `line`, остальные — `lines`. */
function withLines(ids: readonly string[] | undefined, fallback?: string): Pick<DirectorStep, 'line' | 'lines'> {
  const list = ids?.length ? [...ids] : fallback ? [fallback, ...(LINES_MORE[fallback] ?? [])] : [];
  if (!list.length) return {};
  return { line: list[0]!, ...(list.length > 1 ? { lines: list.slice(1) } : {}) };
}

/** Реплики вступления F1 (src/ui/intro.ts), по порядку карточек. */
export const INTRO_LINES = {
  oct: 'intro.caption.oct',
  kloda: 'intro.kazik.kloda',
  bobr: 'intro.caption.bobr',
  hela: 'intro.hela.za_darmo',
  passportK: 'intro.passport.k',
  empty: 'intro.caption.empty',
  dzienDobry: 'intro.kazik.dzien_dobry',
  dopiero: 'intro.kazik.dopiero',
  goscMowi: 'intro.kazik.gosc_mowi',
  shadow: 'kazik.shadow.first',
  poRusku: 'intro.kazik.po_rusku',
  miau: 'intro.simba.miau',
  pokazalo: 'intro.caption.pokazalo',
} as const;

/**
 * Реплики бита первого дня (§5.0 F1–F6, P-01): вступление, переходы режиссёра первого дня, итог и «done».
 * Диалоги первого дня (турникет-диагностика и ремонтные сцены кластеров) валидатор собирает сам по контенту.
 * `PQ_RELEASE=1 npm run build` (и `validate --release`) падает, если среди них есть `todo`.
 */
export const FIRST_DAY_LINES: readonly string[] = [
  ...Object.values(INTRO_LINES),
  LINES.waterFirst,
  LINES.move,
  LINES.resume,
  LINES.evening,
  LINES.sleep,
  LINES.done,
  LINES.more3,
];

// ── Вход из прогресса (для склейки и тестов).

export interface InputOptions {
  local?: Pick<LocalState, 'resume'> | null;
  activeMin?: number;
  tz?: string;
}

export function directorInput(p: Progress, content: Content, now: Ts, o: InputOptions = {}): DirectorInput {
  const derived = derive(p, deriveContent(content), now, o.tz);
  const today = derived.today;
  const segs = derived.days[today]?.segs ?? [];
  let last: Day | null = null;
  for (const [d, s] of Object.entries(derived.days)) if (d < today && isPlayedDay(s) && (!last || d > last)) last = d;
  return {
    derived,
    world: p.world,
    content,
    tuning: content.tuning,
    now,
    today,
    weekday: isoWeekday(today),
    lastPlayedDay: last,
    todayDone: {
      water: segs.some((s) => s === 'water' || s === 'express' || s === 'more3'),
      remedy: segs.includes('remedy'),
      scene: segs.includes('scene'),
      evening: segs.includes('evening'),
      sleep: segs.includes('sleep'),
      activeMin: o.activeMin ?? 0,
    },
    resume: o.local?.resume ?? null,
    events: p.log.events,
    ...(o.tz ? { tz: o.tz } : {}),
    day: storyDay(derived, p.world.flags, { dayStartHour: content.tuning.dayStartHour, ...(o.tz ? { tz: o.tz } : {}) }),
  };
}

/** Контекст расписания систем для входа режиссёра. */
export function paceOf(i: Pick<DirectorInput, 'day' | 'today' | 'world' | 'content' | 'tz'>): PaceCtx {
  return {
    day: i.day,
    today: i.today,
    flags: i.world.flags,
    schedule: i.content.director.schedule ?? [],
    opts: { dayStartHour: i.content.tuning.dayStartHour, ...(i.tz ? { tz: i.tz } : {}) },
  };
}

/** Система открыта сегодня (расписание P-06). */
export const systemOpen = (i: Pick<DirectorInput, 'day' | 'today' | 'world' | 'content' | 'tz'>, sys: PaceSystem): boolean => isOpen(sys, paceOf(i));

/** День урока: `gameDay.min` в его `requires` (P-06, расписание сцен по дням); нет — 1. */
export function lessonDay(l: Pick<Lesson, 'requires'>): number {
  const walk = (c: Condition | undefined): number => {
    if (!c) return 1;
    if (c.gameDay?.min !== undefined) return c.gameDay.min;
    if (c.all) return Math.max(1, ...c.all.map(walk));
    return 1;
  };
  return walk(l.requires);
}

/** Сцена главы (не практика и не лекарство): у неё есть день и квота. */
const isScene = (l: Lesson): boolean => l.kind !== 'practice' && l.kind !== 'remedy';

/** Сцены (уроки главы с итогом) сегодня: события `lesson`/`boss` с начала игрового дня. */
export function scenesTodayIds(i: Pick<DirectorInput, 'events' | 'derived' | 'content'>): Set<string> {
  const ids = new Set<string>();
  for (const e of i.events) {
    if (e.ts < i.derived.todayStart || (e.k !== 'lesson' && e.k !== 'boss')) continue;
    const l = i.content.lessons.get(e.lesson)?.value;
    if (l && isScene(l)) ids.add(e.lesson);
  }
  return ids;
}
export const scenesToday = (i: Pick<DirectorInput, 'events' | 'derived' | 'content'>): number => scenesTodayIds(i).size;

/**
 * Сколько сцен можно сегодня (P-06): сцены этого дня по расписанию (кроме пропущенных зелёным кластером) и ещё
 * одна, если с прошлых дней осталась несыгранная («ещё одна свая»). Без расписания (урок без gameDay) — одна.
 */
export function sceneQuota(i: DirectorInput): { quota: number; backlog: boolean } {
  const ctx = ctxOf(i);
  const today = scenesTodayIds(i);
  let planned = 0;
  let backlog = false;
  for (const { value: l } of i.content.lessons.values()) {
    if (!isScene(l) || l.id === FIRST_DAY.introLesson) continue;
    const day = lessonDay(l);
    const v = lessonVariant(l, ctx);
    if (day === i.day && v !== 'skip') planned++;
    // Хвост с прошлых дней: ещё не сыгран или сыгран сегодня (тогда он и занял лишнее место).
    else if (day < i.day && v !== 'skip' && v !== 'locked' && (!lessonDoneFor(l, i.derived) || today.has(l.id))) backlog = true;
  }
  return { quota: Math.max(planned, backlog ? 0 : 1) + (backlog ? 1 : 0), backlog };
}

// ── Помощники (экспорт для склейки и тестов).

/** Самый красный кластер (§5.0 F4–F5): красные, затем жёлтые; внутри — ниже точность диагностики. */
export function reddestCluster(d: Pick<Derived, 'clusterStatus' | 'clusterScore'>): string | null {
  const num = (id: string): number => Number(id.replace(/\D/g, '')) || 0;
  for (const status of ['red', 'yellow'] as const) {
    const list = Object.keys(d.clusterStatus)
      .filter((c) => d.clusterStatus[c] === status)
      .sort((a, b) => (d.clusterScore[a] ?? 1) - (d.clusterScore[b] ?? 1) || num(a) - num(b));
    if (list.length) return list[0]!;
  }
  return null;
}

/** Диагностика пройдена: есть статус хоть одного кластера (событие `diag`). */
export function diagDone(d: Pick<Derived, 'clusterStatus'>): boolean {
  return Object.values(d.clusterStatus).some((s) => s !== 'unknown');
}

/** Урок «закрыт» для режиссёра: диагностика — по событию diag, вступление — по попытке, босс — сдан, прочие — сданы. */
export function lessonDoneFor(lesson: Lesson, d: Derived): boolean {
  if (lesson.kind === 'diag') return diagDone(d);
  if (lesson.kind === 'boss') return d.bossResults[lesson.id]?.passedAt !== undefined;
  if (lesson.id === FIRST_DAY.introLesson) return d.lessons[lesson.id] !== undefined;
  return d.lessonsDone.has(lesson.id);
}

function ctxOf(i: DirectorInput): CondCtx {
  return condCtx(i.content, i.derived, i.world, i.now);
}

/** Ремонтный урок кластера (phonetics.clusters[].repairLesson). */
function repairOf(i: DirectorInput, cluster: string | null): Lesson | null {
  if (!cluster) return null;
  const id = i.content.phonetics.clusters.find((c) => c.id === cluster)?.repairLesson;
  return id ? (i.content.lessons.get(id)?.value ?? null) : null;
}

const lessonTarget = (l: Lesson, i: DirectorInput): Target => ({
  location: l.location ?? i.content.world.start.location,
  ...(l.npc ? { npc: l.npc } : {}),
});

/** Растения с «!» сейчас (что польёт обход). */
export function waterable(i: Pick<DirectorInput, 'derived' | 'now' | 'tuning'>): number {
  return gardenItems(i.derived, i.now, i.tuning).filter((g) => g.dueCard).length;
}

/** Пары на вечер (очередь phonetic, §4.3). */
export function phoneticDue(i: Pick<DirectorInput, 'derived' | 'now' | 'tuning'>): number {
  return dueQueue(i.derived, i.now, i.tuning, { mode: 'phonetic' }).length;
}

/**
 * Следующая сцена (правило 7): первый несданный урок самого раннего открытого модуля по `order`,
 * пропуская `skipIf` и закрытые `requires`; урок с новыми словами — только если они влезают в лимит
 * дня и долг не выше порога (иначе ищется урок без новых слов: босс, ремонт). Все сданы → нет.
 */
export function nextLesson(i: DirectorInput): Lesson | null {
  const ctx = ctxOf(i);
  const modules = [...i.content.modules.values()]
    .map((b) => b.module)
    .filter((m) => !m.unlock?.hard || evaluate(m.unlock.hard, ctx))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
  for (const m of modules) {
    for (const id of m.lessons ?? []) {
      const l = i.content.lessons.get(id)?.value;
      if (!l || l.kind === 'practice' || l.kind === 'remedy' || lessonDoneFor(l, i.derived)) continue;
      const v = lessonVariant(l, ctx);
      if (v === 'skip' || v === 'locked') continue;
      const fresh = (l.introduces ?? []).filter((it) => !i.derived.cards[cardId(it, 'rec')] && !i.derived.cards[cardId(it, 'lis')]).length;
      if (newContentLock(i.derived, i.now, i.tuning, fresh) !== null) continue;
      return l;
    }
  }
  return null;
}

// ── Правила.

function firstDay(i: DirectorInput): DirectorStep | null {
  const flags = i.world.flags;
  if (FIRST_DAY_DONE in flags) return null;
  const has = (f: FirstStep): boolean => firstFlag(f) in flags;
  const d = i.derived;
  const F = FIRST_DAY;
  const reveal = reveals(i);
  const step = (s: Omit<DirectorStep, 'kind' | 'reason'> & { f: FirstStep }, why: string): DirectorStep => ({
    kind: 'intro',
    ...s,
    ...(reveal.length ? { reveal } : {}),
    reason: `1: первый день ${s.f.toUpperCase()} (${why})`,
  });

  if (!has('f1')) return step({ f: 'f1', target: { location: F.dzialka, screen: 'intro' } }, 'вступление');
  if (!has('f2')) return step({ f: 'f2', target: { location: F.dzialka, plot: F.plot, item: F.introItem, npc: 'bobr' }, mode: 'practice', line: LINES.waterFirst }, 'одна грядка по просьбе Казика');

  // P-06: диагностика — день 2, вечер — день 5 (расписание). В первый день их нет: после полива — посадка и сон.
  const diagToday = systemOpen(i, 'diag');
  const diag = diagToday ? ([...i.content.lessons.values()].map((x) => x.value).find((l) => l.kind === 'diag') ?? null) : null;
  const isDiag = diagDone(d);
  if (diag && !has('f3') && !isDiag) return step({ f: 'f3', target: { location: diag?.location ?? F.metro, ...(diag?.npc ? { npc: diag.npc } : {}) }, line: LINES.move }, 'путь к метро');

  const red = reddestCluster(d);
  const repair = repairOf(i, red);
  const repairTried = !!repair && d.lessons[repair.id] !== undefined;
  const f4done = !diagToday || has('f4') || (isDiag && (!(FIRST_REPAIR_FLAG in flags) || !repair || repairTried));
  if (!f4done) {
    if (!isDiag && diag) return step({ f: 'f4', target: lessonTarget(diag, i), lesson: diag.id }, 'турникет = диагностика');
    if (repair) {
      const v = lessonVariant(repair, ctxOf(i));
      if (v !== 'skip' && v !== 'locked') return step({ f: 'f4', target: lessonTarget(repair, i), lesson: repair.id }, `ремонт самого красного ${red}`);
    }
  }

  // F5: пары из очереди; если ремонтная сцена их уже прогнала сегодня — те же пары кластера практикой (без SRS).
  const pairs = phoneticDue(i) + (red ? i.content.phonetics.pairs.filter((p) => p.cluster === red).length : 0);
  if (systemOpen(i, 'evening') && !has('f5') && !i.todayDone.evening && pairs > 0)
    return step(
      { f: 'f5', target: { location: F.dzialka, object: F.eveningObject }, mode: 'phonetic', limit: F.firstEveningPairs, ...(red ? { cluster: red } : {}), line: LINES.evening },
      'вечер: пары самого красного кластера',
    );
  return step({ f: 'f6', target: { location: F.dzialka, object: F.sleepObject }, line: LINES.sleep }, 'альтанка → итог дня');
}

/** Раскрытия HUD (§4.12): правила `reveals`, условие истинно, флага `hud.<el>` ещё нет. */
export function reveals(i: DirectorInput): HudElement[] {
  const ctx = ctxOf(i);
  const out: HudElement[] = [];
  for (const r of i.content.director.reveals ?? [])
    if (!(hudFlag(r.element) in i.world.flags) && !out.includes(r.element) && evaluate(r.if, ctx)) out.push(r.element);
  return out;
}

function beatAt(i: DirectorInput, slot: BeatSlot): DirectorStep | null {
  const ctx = ctxOf(i);
  for (const b of i.content.director.beats ?? []) {
    if (b.slot !== slot) continue;
    if (beatFlag(b.id, b.once !== false, i.today) in i.world.flags) continue;
    if (!evaluate(b.if, ctx)) continue;
    // Бит вводит систему (P-06): ждёт её дня и того, чтобы сегодня не показывали другую.
    if (b.system && systemState(b.system, paceOf(i)) === 'closed') continue;
    return {
      kind: 'beat',
      beat: b.id,
      target: { ...b.target },
      ...(b.line ? { line: b.line } : {}),
      ...(b.system ? { system: b.system } : {}),
      ...(b.do?.length ? { do: b.do } : {}),
      reason: `4: бит ${b.id} (слот ${slot})`,
    };
  }
  return null;
}

/**
 * Следующий шаг. Порядок (§4.12): 1 первый день → 2 прерванный урок → 3 весна → [бит start] → 5 полив →
 * [бит afterWater] → 6 лекарство → 7 сцена/босс → [бит afterScene] → 8 вечер → [бит beforeSleep] → 9 сон → 10 до завтра.
 */
export function nextStep(i: DirectorInput): DirectorStep {
  const first = firstDay(i);
  if (first) return first;

  const reveal = reveals(i);
  const withReveal = (s: DirectorStep): DirectorStep => (reveal.length && !s.reveal ? { ...s, reveal } : s);
  const t = i.tuning;
  const d = i.derived;

  // 2. Прерванный урок моложе resumeHours.
  const r = i.resume;
  if (r && i.now - r.startedAt < t.resumeHours * 3_600_000 && i.now >= r.startedAt) {
    const l = i.content.lessons.get(r.lessonId)?.value;
    if (l) return withReveal({ kind: 'resume', target: lessonTarget(l, i), lesson: l.id, ...withLines(undefined, LINES.resume), reason: '2: прерванный урок' });
  }

  // 3. Весна: пауза ≥ springAfterDays, сегодня ещё ничего, за эту паузу весны не было.
  const todayPlayed = isPlayedDay(d.days[i.today]);
  if (i.lastPlayedDay && !todayPlayed && daysBetween(i.lastPlayedDay, i.today) >= t.springAfterDays && !(springFlag(i.lastPlayedDay) in i.world.flags))
    return withReveal({
      kind: 'spring',
      target: { location: FIRST_DAY.dzialka, plot: FIRST_DAY.plot, npc: 'bobr' },
      mode: 'day',
      ...withLines(undefined, i.content.director.spring?.line ?? LINES.spring),
      reason: `3: весна (${daysBetween(i.lastPlayedDay, i.today)} дн. без игры)`,
    });

  // После сна в тот же день — только «до завтра» (§5.9): день закрыт, даже если сцены не было.
  if (i.todayDone.sleep) return withReveal(doneStep(i));

  const b0 = beatAt(i, 'start');
  if (b0) return withReveal(b0);

  // 5. Полив: есть «!» и (сегодня ещё не поливали или затор). Утренний обход с зарубками — система дня 2 (P-06).
  const locked = d.debt > t.debtLockThreshold;
  const pace = paceOf(i);
  const days = i.content.director.days;
  const today = dayLines(days, i.day);
  const obchod = systemState('obchod', pace);
  const sunday = i.weekday === 7 && isOpen('sunday', pace);
  if (obchod !== 'closed' && waterable(i) > 0 && (!i.todayDone.water || locked))
    return withReveal({
      kind: 'water',
      target: { location: FIRST_DAY.dzialka, plot: FIRST_DAY.plot, npc: 'bobr' },
      mode: 'day',
      ...(locked ? withLines(undefined, LINES.debtJam) : sunday ? withLines(undefined, LINES.sunday) : withLines(today?.water, LINES.waterDue)),
      ...(obchod === 'new' ? { system: 'obchod' as const } : {}),
      reason: locked ? `5: затор, долг ${d.debt} > ${t.debtLockThreshold}` : '5: утренний полив',
    });

  const b1 = beatAt(i, 'afterWater');
  if (b1) return withReveal(b1);

  // 6. Лекарство по тегам ошибок (§4.4), одно в день; урок, закрытый расписанием или зелёным кластером, не зовём.
  const rem = pickRemedy(i.events, i.now, t, i.content.errorTags, { dayStartHour: t.dayStartHour, tz: i.tz });
  const remLesson = rem ? i.content.lessons.get(rem.lesson)?.value : undefined;
  const remOk = !!remLesson && !['skip', 'locked'].includes(lessonVariant(remLesson, ctxOf(i))) && !(isScene(remLesson) && !lessonDoneFor(remLesson, d));
  if (rem && remLesson && remOk && !i.todayDone.remedy)
    return withReveal({ kind: 'remedy', target: lessonTarget(remLesson, i), lesson: remLesson.id, ...withLines(undefined, LINES.repair), reason: `6: лекарство по тегу ${rem.tag} (${rem.errors} ошибок)` });

  // 7. Сцены дня или босс (P-06: по расписанию дней, квота дня + одна из прошлых); в воскресенье — нет.
  if (!sunday) {
    const done = scenesToday(i);
    const { quota, backlog } = sceneQuota(i);
    const l = done < quota ? nextLesson(i) : null;
    if (l) {
      const extra = done > 0 && backlog && lessonDay(l) < i.day;
      return withReveal({
        kind: l.kind === 'boss' ? 'boss' : 'scene',
        target: lessonTarget(l, i),
        lesson: l.id,
        ...(extra ? withLines(undefined, LINES.extraRepair) : done === 0 ? withLines(today?.scene) : {}),
        ...(l.kind === 'diag' && systemState('diag', pace) === 'new' ? { system: 'diag' as const } : {}),
        reason: `7: ${l.kind === 'boss' ? 'босс' : 'сцена'} ${l.id} (${done + 1} из ${quota})`,
      });
    }
  }

  const b2 = beatAt(i, 'afterScene');
  if (b2) return withReveal(b2);

  // 8. Вечер: пары красных/жёлтых кластеров. Вечер — система дня 5, выбор вечера — дня 6 (P-06).
  const evening = systemState('evening', pace);
  const choice = systemState('eveningChoice', pace);
  const red = reddestCluster(d);
  const pairs = phoneticDue(i) + (evening === 'new' && red ? i.content.phonetics.pairs.filter((p) => p.cluster === red).length : 0);
  if (!i.todayDone.evening && evening !== 'closed' && pairs > 0) {
    const choose = choice !== 'closed' && evening === 'open';
    const first = choose ? choice === 'new' : evening === 'new';
    return withReveal({
      kind: 'evening',
      target: { location: FIRST_DAY.dzialka, object: FIRST_DAY.eveningObject },
      mode: 'phonetic',
      ...(choose ? { choose: true } : {}),
      ...(evening === 'new' && red && !phoneticDue(i) ? { cluster: red, limit: i.tuning.phoneticPerDay } : {}),
      ...withLines(first ? today?.evening : undefined, LINES.evening),
      ...(first ? { system: choose ? ('eveningChoice' as const) : ('evening' as const) } : {}),
      reason: choose ? '8: вечер с выбором' : '8: вечер на звуки',
    });
  }

  const b3 = beatAt(i, 'beforeSleep');
  if (b3) return withReveal(b3);

  // 9. Сон.
  if (!i.todayDone.sleep) return withReveal({ kind: 'sleep', target: { location: FIRST_DAY.dzialka, object: FIRST_DAY.sleepObject }, ...withLines(today?.sleep, LINES.sleep), reason: '9: альтанка' });

  // 10. До завтра + «ещё 3 минуты».
  return withReveal(doneStep(i));
}

function doneStep(i: DirectorInput): DirectorStep {
  // «Ещё 3 минуты»: экспресс — система дня 7, вечерние пары — дня 5 (P-06).
  const more3 = i.derived.debt > 0 && waterable(i) > 0 && systemOpen(i, 'express') ? 'express' : phoneticDue(i) > 0 && systemOpen(i, 'evening') ? 'phonetic' : undefined;
  return {
    kind: 'done',
    target: { location: FIRST_DAY.dzialka },
    ...withLines(undefined, i.content.director.done?.line ?? LINES.done),
    ...(more3 ? { more3 } : {}),
    reason: '10: день закрыт',
  };
}

/** Ключ шага: реплика показывается один раз за шаг, подсветка меняется при смене ключа. */
export function stepKey(s: DirectorStep): string {
  return [s.kind, s.f ?? '', s.lesson ?? '', s.beat ?? '', s.target.location, s.target.npc ?? '', s.target.object ?? '', s.target.item ?? ''].join('|');
}
