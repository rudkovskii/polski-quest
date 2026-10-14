// Режиссёр (ТЗ §4.12, §5.0, КОНЦЕПТ §5б, I-13): в любой момент ровно один следующий шаг. Чистая и
// детерминированная `nextStep(input)`: правила 1–10 по приоритету, слоты сюжетных битов из director.json,
// раскрытие элементов HUD (`reveals`). Ничего не пишет: флаги `beat.*`, `hud.*`, `spring.*` ставит склейка
// (src/flow.ts), когда шаг показан или выполнен. Меню режимов нет: что делать, решает только этот модуль.
import type { Beat, Effect, HudElement, Lesson, Tuning } from '../types/content';
import type { Content } from './content';
import { condCtx, evaluate, lessonVariant, type CondCtx } from './conditions';
import { derive, deriveContent, isPlayedDay, type Derived } from './derive';
import { gardenItems } from './garden';
import type { LogEvent } from './log';
import type { LocalState, Progress, WorldState } from './progress';
import { dueQueue, newContentLock, pickRemedy } from './queue';
import { cardId } from './srs';
import { daysBetween, isoWeekday, type Day, type Ts } from './time';

export type StepKind = 'intro' | 'resume' | 'spring' | 'beat' | 'water' | 'remedy' | 'scene' | 'boss' | 'evening' | 'sleep' | 'done';
/** Шаг первого дня (P-05): id бита `d01.*` из director.json (слот `day1`); флаг `beat.<id>`, финал — `beat.first_day_done`. */
export type FirstStep = string;
/** Действие склейки у бита дня 1 (director.json `act`). */
export type FirstAct = NonNullable<Beat['act']>;
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
}

export interface DirectorStep {
  kind: StepKind;
  target: Target;
  /** Шаг первого дня (kind intro): id бита `d01.*`. */
  f?: FirstStep;
  /** Действие склейки у бита дня 1 (`card`, `fotobudka`, `bazar`, `water`, …); нет — только эффекты `do`. */
  act?: FirstAct;
  /** scene / boss / remedy / resume / intro F4. */
  lesson?: string;
  /** Как поливать: day — обход, practice — одна грядка без SRS (F2), phonetic — вечер на звуки. */
  mode?: 'day' | 'practice' | 'phonetic';
  /** Вечер: сколько пар и какой кластер первым (F5 — 3 пары самого красного). */
  limit?: number;
  cluster?: string;
  /** Реплика бобра при входе в шаг (story/lines.json). */
  line?: string;
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
  /** Первая карта дня 1 (P-05): зал Warszawa Wschodnia, спавн у фотобудки. */
  start: 'ch01.dworzec',
  startSpawn: 'start',
  plot: 'grzadki',
  /** Плитки у лотка пани Хели (d01.s4): «Dzień dobry» / «Do widzenia», `intro` слова, печать №1. */
  introLesson: 'ch01.intro',
  introItem: 'lx.dzien_dobry',
  /** Урок у забора (d01.s7): три чанка «угадай → услышь → выбери», каждое слово — семя в карман. */
  plotLesson: 'ch01.d01.brzechwa',
  plotDialogue: 'dlg.ch01.d01_imie',
  /** Объекты działki: альтанка (сон), берег Вислы (вечер на звуки). */
  sleepObject: 'altana_sleep',
  eveningObject: 'ryby',
  /** Пары на первый вечер (§5.0 F5). */
  firstEveningPairs: 3,
} as const;

/** Флаг шага первого дня. */
export const firstFlag = (f: FirstStep): string => `beat.${f}`;
export const FIRST_DAY_DONE = 'beat.first_day_done';
/** Флаги выбора звука в первом разговоре с Казиком (d01.s2): склейка переносит их в настройку `sound.mode`. */
export const SOUND_FLAGS = { on: 'd01.sound.on', mute: 'd01.sound.mute' } as const;
export const springFlag = (lastPlayed: Day): string => `spring.${lastPlayed}`;
export const hudFlag = (e: HudElement): string => `hud.${e}`;
/** Флаг показа бита: `once` (по умолчанию) — навсегда, иначе — на игровой день. */
export const beatFlag = (id: string, once: boolean, today: Day): string => (once ? `beat.${id}` : `beat.${id}.${today.replace(/-/g, '_')}`);

/** Реплики переходов (СЮЖЕТ §3, story/lines.json). `todo` там, где реплики пока нет. */
export const LINES = {
  waterDue: 'kazik.water.due',
  debtJam: 'kazik.debt.jam',
  sunday: 'kazik.sunday',
  repair: 'kazik.repair',
  resume: 'kazik.resume',
  sleep: 'kazik.sleep',
  spring: 'kazik.return.spring',
  evening: 'kazik.evening',
  done: 'sys.kazik.done',
  more3: 'kazik.express',
} as const;

/**
 * Реплики дня 1, которые показывает код (src/flow.ts, src/ui/intro.ts), а не эффекты битов (СЮЖЕТ_v2 §4 d01).
 * Остальные реплики дня 1 — в `do` битов `day1` и в их диалогах: валидатор собирает их сам.
 */
export const D01 = {
  card: 'd01.narr.card.1',
  fotobudka: 'd01.fotobudka.1',
  fotoNarr: 'd01.narr.fotobudka.1',
  soundOn: 'd01.kazik.platform.6a',
  helaTak: 'd01.hela.bazar.1',
  helaErr: 'd01.hela.bazar.err.1',
  rule: 'd01.rule.dzien_dobry',
  ruleTr: 'd01.rule.dzien_dobry.tr',
  helaHello: 'd01.hela.bazar.2',
  goscMowi: 'd01.kazik.bazar.2',
  umiem: 'd01.ui.umiem.1',
  zaDarmo: 'd01.hela.bazar.3',
  teZaDarmo: 'd01.hela.bazar.4',
  prawieKloda: 'd01.kazik.bazar.3',
  passportNote: 'd01.passport.note',
  passportNarr: 'd01.narr.passport.1',
  stamp: 'd01.hela.bazar.5',
  stampKazik: 'd01.kazik.bazar.4',
  passportWho: 'd01.kazik.bazar.5',
  praga: 'd01.kazik.bazar.6',
  notK: 'd01.kazik.bazar.7',
  watered: 'd01.kazik.dzialka.5',
  dziekuje: 'd01.brzechwa.plot.2',
  proszeHint: 'd01.kazik.plot.1',
  seeds: 'd01.kazik.plot.2',
  pierogi: 'd01.kazik.plot.3',
  pierogi2: 'd01.kazik.plot.4',
  summary: 'd01.ui.summary',
  summaryUmiem: 'd01.ui.summary.umiem',
  hook: 'd01.ui.hook',
  miau: 'd01.simba.night',
  notMe: 'd01.kazik.hut.3',
  dobranoc: 'd01.ui.dobranoc',
  idleKazik: 'idle.kazik.1',
} as const;

/**
 * Реплики бита первого дня, которые знает код (P-01, P-05): D01 и «done» закрытого дня.
 * `PQ_RELEASE=1 npm run build` (и `validate --release`) падает, если среди них или в битах `day1` есть `todo`.
 */
export const FIRST_DAY_LINES: readonly string[] = [...Object.values(D01), LINES.done, LINES.more3];

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
  };
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
  if (lesson.id === FIRST_DAY.introLesson || lesson.id === FIRST_DAY.plotLesson) return d.lessons[lesson.id] !== undefined;
  return d.lessonsDone.has(lesson.id);
}

function ctxOf(i: DirectorInput): CondCtx {
  return condCtx(i.content, i.derived, i.world, i.now);
}

/** Ремонтный урок кластера (phonetics.clusters[].repairLesson); для дня 2+ (P-06). */
export function repairOf(i: DirectorInput, cluster: string | null): Lesson | null {
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

/** Семена в кармане (P-02): флаг `seed.<item>` без `plant.<x>_<y>.<item>`. Без world/: тот же разбор, что `plantedPins`. */
export function pocketSeeds(flags: Readonly<Record<string, number>>): string[] {
  const planted = new Set<string>();
  for (const name of Object.keys(flags)) {
    const m = /^plant\.\d+_\d+\.(.+)$/.exec(name);
    if (m) planted.add(m[1]!);
  }
  return Object.keys(flags)
    .filter((n) => n.startsWith('seed.') && !planted.has(n.slice(5)))
    .map((n) => n.slice(5));
}

/** Биты дня 1 по порядку (director.json, слот `day1`). */
export function day1Beats(content: Pick<Content, 'director'>): Beat[] {
  return (content.director.beats ?? []).filter((b) => b.slot === 'day1');
}

/** Бит дня 1 сделан: флаг `beat.<id>`; посадка — когда карман пуст (сажают руками, флага нет). */
export function day1Done(b: Beat, flags: Readonly<Record<string, number>>): boolean {
  if (firstFlag(b.id) in flags) return true;
  return b.act === 'plant' && pocketSeeds(flags).length === 0;
}

/**
 * Правило 1 (P-05, СЮЖЕТ_v2 §4 d01): день 1 — сцены на картах по порядку битов `day1`: вокзал и фотобудка, перрон,
 * улица, базар и паспорт, Висла, działka и полив, шляпа Брзехвы и три семечка, посадка, хатка и сон.
 * Первый несделанный бит с истинным `if` — шаг `intro`; после сна склейка ставит `beat.first_day_done`.
 */
function firstDay(i: DirectorInput): DirectorStep | null {
  const flags = i.world.flags;
  if (FIRST_DAY_DONE in flags) return null;
  const reveal = reveals(i);
  const ctx = ctxOf(i);
  for (const b of day1Beats(i.content)) {
    if (day1Done(b, flags) || !evaluate(b.if, ctx)) continue;
    const water = b.act === 'water';
    return {
      kind: 'intro',
      f: b.id,
      beat: b.id,
      ...(b.act ? { act: b.act } : {}),
      target: { ...b.target, ...(water ? { item: FIRST_DAY.introItem } : {}) },
      ...(water ? { mode: 'practice' as const } : {}),
      ...(b.act === 'brzechwa' ? { lesson: FIRST_DAY.plotLesson } : b.act === 'bazar' ? { lesson: FIRST_DAY.introLesson } : {}),
      ...(b.line ? { line: b.line } : {}),
      ...(b.do?.length ? { do: b.do } : {}),
      ...(reveal.length ? { reveal } : {}),
      reason: `1: день 1, ${b.id}${b.act ? ` (${b.act})` : ''}`,
    };
  }
  return null;
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
    return {
      kind: 'beat',
      beat: b.id,
      target: { ...b.target },
      ...(b.line ? { line: b.line } : {}),
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
    if (l) return withReveal({ kind: 'resume', target: lessonTarget(l, i), lesson: l.id, line: LINES.resume, reason: '2: прерванный урок' });
  }

  // 3. Весна: пауза ≥ springAfterDays, сегодня ещё ничего, за эту паузу весны не было.
  const todayPlayed = isPlayedDay(d.days[i.today]);
  if (i.lastPlayedDay && !todayPlayed && daysBetween(i.lastPlayedDay, i.today) >= t.springAfterDays && !(springFlag(i.lastPlayedDay) in i.world.flags))
    return withReveal({
      kind: 'spring',
      target: { location: FIRST_DAY.dzialka, plot: FIRST_DAY.plot, npc: 'bobr' },
      mode: 'day',
      line: i.content.director.spring?.line ?? LINES.spring,
      reason: `3: весна (${daysBetween(i.lastPlayedDay, i.today)} дн. без игры)`,
    });

  // После сна в тот же день — только «до завтра» (§5.9): день закрыт, даже если сцены не было.
  if (i.todayDone.sleep) return withReveal(doneStep(i));

  const b0 = beatAt(i, 'start');
  if (b0) return withReveal(b0);

  // 5. Полив: есть «!» и (сегодня ещё не поливали или затор).
  const locked = d.debt > t.debtLockThreshold;
  if (waterable(i) > 0 && (!i.todayDone.water || locked))
    return withReveal({
      kind: 'water',
      target: { location: FIRST_DAY.dzialka, plot: FIRST_DAY.plot, npc: 'bobr' },
      mode: 'day',
      line: locked ? LINES.debtJam : i.weekday === 7 ? LINES.sunday : LINES.waterDue,
      reason: locked ? `5: затор, долг ${d.debt} > ${t.debtLockThreshold}` : '5: утренний полив',
    });

  const b1 = beatAt(i, 'afterWater');
  if (b1) return withReveal(b1);

  // 6. Лекарство по тегам ошибок (§4.4), одно в день.
  const rem = pickRemedy(i.events, i.now, t, i.content.errorTags, { dayStartHour: t.dayStartHour, tz: i.tz });
  const remLesson = rem ? i.content.lessons.get(rem.lesson)?.value : undefined;
  if (rem && remLesson && !i.todayDone.remedy)
    return withReveal({ kind: 'remedy', target: lessonTarget(remLesson, i), lesson: remLesson.id, line: LINES.repair, reason: `6: лекарство по тегу ${rem.tag} (${rem.errors} ошибок)` });

  // 7. Сцена дня или босс: не воскресенье, есть следующий урок, новые слова не закрыты.
  if (!i.todayDone.scene && i.weekday !== 7) {
    const l = nextLesson(i);
    if (l)
      return withReveal({
        kind: l.kind === 'boss' ? 'boss' : 'scene',
        target: lessonTarget(l, i),
        lesson: l.id,
        reason: `7: ${l.kind === 'boss' ? 'босс' : 'сцена'} ${l.id}`,
      });
  }

  const b2 = beatAt(i, 'afterScene');
  if (b2) return withReveal(b2);

  // 8. Вечер: пары красных/жёлтых кластеров (письмо и мастерская — этап 2).
  if (!i.todayDone.evening && phoneticDue(i) > 0)
    return withReveal({ kind: 'evening', target: { location: FIRST_DAY.dzialka, object: FIRST_DAY.eveningObject }, mode: 'phonetic', line: LINES.evening, reason: '8: вечер на звуки' });

  const b3 = beatAt(i, 'beforeSleep');
  if (b3) return withReveal(b3);

  // 9. Сон.
  if (!i.todayDone.sleep) return withReveal({ kind: 'sleep', target: { location: FIRST_DAY.dzialka, object: FIRST_DAY.sleepObject }, line: LINES.sleep, reason: '9: альтанка' });

  // 10. До завтра + «ещё 3 минуты».
  return withReveal(doneStep(i));
}

function doneStep(i: DirectorInput): DirectorStep {
  const more3 = i.derived.debt > 0 && waterable(i) > 0 ? 'express' : phoneticDue(i) > 0 ? 'phonetic' : undefined;
  return {
    kind: 'done',
    target: { location: FIRST_DAY.dzialka },
    line: i.content.director.done?.line ?? LINES.done,
    ...(more3 ? { more3 } : {}),
    reason: '10: день закрыт',
  };
}

/** Ключ шага: реплика показывается один раз за шаг, подсветка меняется при смене ключа. */
export function stepKey(s: DirectorStep): string {
  return [s.kind, s.f ?? '', s.lesson ?? '', s.beat ?? '', s.target.location, s.target.npc ?? '', s.target.object ?? '', s.target.item ?? ''].join('|');
}
