// Прогон урока (ТЗ §5.7, I-08): шаги по порядку через реестр src/ui/exercises, точки прогресса,
// `local.resume` после каждого шага, события журнала через append + appendGate:
//   rev    — первая попытка по due-карточке (ранние ответы отсекает appendGate и уходят в агрегат);
//   intro  — в конце сцены для слов из `introduces`, которых ещё нет (ok = типы, верные с первого раза);
//   lesson — итог сцены (score, firstTry, ms, passed, tags, answers); у босса — `boss` по частям.
// Проваленный с первой попытки шаг повторяется ещё раз в конце урока (без SRS, без подсказки):
// так ошибка не «застревает», а порядок шагов урока не ломается.
import type { Check } from '../systems/answer';
import type { Content } from '../systems/content';
import { appendGate, derive, deriveContent, type Derived } from '../systems/derive';
import { gradeFromAnswer, type StepKind } from '../systems/grade';
import type { EventDraft, LogEvent, Src } from '../systems/log';
import { getSetting, type AppendOpts, type AppendResult, type CardId, type CardType, type LocalState, type Progress } from '../systems/progress';
import { cardId } from '../systems/srs';
import type { Lesson, Step } from '../types/content';
import type { LessonResult } from '../types/bus';
import { el } from './dom';
import { mountStep } from './exercises/registry';
import type { ExerciseContent, ExerciseCtx, StepResult } from './exercises/types';
import type { IntentHandler, Layer, Overlay } from './overlay/host';
import { btn, portrait, react, type AudioPort, type PortraitSource } from './overlay/kit';

/** Хранилище прогресса: GameStorage подходит как есть, в тестах — память. */
export interface LessonStore {
  readonly progress: Progress;
  readonly local: LocalState;
  append(draft: EventDraft, opts?: AppendOpts): AppendResult;
  setLocal(l: LocalState): void;
}

export interface LessonDeps {
  overlay: Overlay;
  content: Content;
  store: LessonStore;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  /** Часы: `now` — epoch ms для событий, `mono` — для времени ответа. */
  clock?: { now(): number; mono(): number };
  random?: () => number;
  coarse?: boolean;
  /** Мс на букву в репликах; 0 — сразу. */
  typeMs?: number;
  tz?: string;
  /** Каждое записанное событие (dev: в консоль, склейка: progress:changed). */
  onEvent?(e: LogEvent): void;
}

/** Запись о пройденном шаге в `local.resume.answers` (сериализуемая). */
export interface StepRecord {
  /** Индекс шага в уроке. */
  i: number;
  /** Повтор проваленного шага в конце. */
  rep?: 1;
  graded: boolean;
  /** Верно с первой попытки. */
  ok?: boolean;
  score?: number;
  tags?: string[];
  ms: number;
  hinted?: 1;
  noAudio?: 1;
  parts?: { item?: string; ok: boolean }[];
}

interface PlanEntry {
  i: number;
  rep: boolean;
}

const DEFAULT_FIRST_TRY = 0.7;
const DEFAULT_BOSS_SCORE = 0.8;

export function lessonSteps(lesson: Lesson): { steps: Step[]; part: (string | null)[] } {
  if (lesson.steps) return { steps: [...lesson.steps], part: lesson.steps.map(() => null) };
  const steps: Step[] = [];
  const part: (string | null)[] = [];
  for (const p of lesson.parts ?? []) for (const s of p.steps) {
    steps.push(s);
    part.push(p.id);
  }
  return { steps, part };
}

/** План: шаги по порядку, затем повтор проваленных с первой попытки (по порядку провала). */
export function planOf(n: number, records: readonly StepRecord[]): PlanEntry[] {
  const plan: PlanEntry[] = [...Array(n).keys()].map((i) => ({ i, rep: false }));
  for (const r of records) if (!r.rep && r.graded && r.ok === false) plan.push({ i: r.i, rep: true });
  return plan;
}

/** Источник `rev` по виду урока (§3.11). */
export function srcOf(kind: Lesson['kind'] | 'world'): Src {
  if (kind === 'boss') return 'boss';
  if (kind === 'remedy') return 'remedy';
  if (kind === 'world') return 'world';
  return 'scene';
}

/** Карточки, которые проверяет шаг (ТЗ §3.5, таблица «Карточка при item»). */
export function cardsOfStep(step: Step, r: Pick<StepRecord, 'noAudio' | 'parts'>): { card: CardId; part?: number }[] {
  const it = step.item;
  switch (step.t) {
    case 'listen':
    case 'dictation':
      return it && !r.noAudio ? [{ card: cardId(it, 'lis') }] : [];
    case 'choice':
      return it ? [{ card: cardId(it, step.dir === 'ru-pl' ? 'pro' : 'rec') }] : [];
    case 'order':
    case 'type':
    case 'gap':
      return it ? [{ card: cardId(it, 'pro') }] : [];
    case 'minimal_pair':
      return it && it.startsWith('mp.') && !r.noAudio ? [{ card: cardId(it, 'pair') }] : [];
    case 'match':
      return (step.items ?? []).map((item, part) => ({ card: cardId(item, 'rec'), part }));
    default:
      return [];
  }
}

/** Типы карточек, которые `intro` может отметить верными (rec, lis) по шагу. */
function introTypeOf(step: Step): CardType | null {
  if (step.t === 'listen' || step.t === 'dictation') return 'lis';
  if ((step.t === 'choice' && step.dir !== 'ru-pl') || step.t === 'match') return 'rec';
  return null;
}

export function exerciseContent(c: Content): ExerciseContent {
  let all: ReturnType<ExerciseContent['allVocab']> | null = null;
  return {
    vocab: (id) => c.vocab.get(id)?.value,
    allVocab: () => (all ??= [...c.vocab.values()].map((v) => v.value)),
    speaker: (id) => ({ id, name: c.characters.get(id)?.name ?? id }),
  };
}

export interface RunOptions {
  /** Уже открытый слой (урок из диалога); иначе урок открывает свой и закрывает в конце. */
  layer?: Layer;
  /** Не показывать итог (короткое упражнение у объекта-слова). */
  noSummary?: boolean;
  /** Слово в мире (`world:interact` kind word): src 'world', без события `lesson` и без resume. */
  drill?: boolean;
}

/**
 * Пройти урок. Отмена (Esc, «B», ×) оставляет позицию в `local.resume`; повторный вызов в пределах
 * `tuning.resumeHours` продолжает с неё.
 */
export async function runLesson(lesson: Lesson, deps: LessonDeps, opts: RunOptions = {}): Promise<LessonResult> {
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  const { content, store } = deps;
  const tuning = content.tuning;
  const { steps, part } = lessonSteps(lesson);
  const startNow = clock.now();
  const drill = opts.drill === true;
  const src = srcOf(drill ? 'world' : lesson.kind);

  // Resume (§5.7): тот же урок, не старше resumeHours.
  let records: StepRecord[] = [];
  let pos = 0;
  let startedAt = startNow;
  const saved = drill ? undefined : store.local.resume;
  if (saved && saved.lessonId === lesson.id && startNow - saved.startedAt < tuning.resumeHours * 3_600_000) {
    records = (saved.answers as StepRecord[]).filter((r) => r && typeof r.i === 'number' && r.i < steps.length);
    pos = Math.min(saved.stepIndex, records.length);
    records = records.slice(0, pos);
    startedAt = saved.startedAt;
  }

  const derived: Derived = derive(store.progress, deriveContent(content), startNow, deps.tz);
  const gate = appendGate(derived, tuning, deps.tz);
  const revDone = new Set<CardId>();
  const record = (draft: EventDraft, gated = false): LogEvent | null => {
    const r = store.append(draft, gated ? gate : undefined);
    if (!r.ok) return null;
    deps.onEvent?.(r.event);
    return r.event;
  };

  // ── Хром урока: шапка, точки, место под шаг.
  const layer = opts.layer ?? deps.overlay.open('pq-lesson-layer');
  const npc = lesson.npc ? exerciseContent(content).speaker(lesson.npc) : null;
  const pic = npc ? portrait(npc, deps.portraits, 40) : null;
  const dots = el('div', { class: 'pq-dots', 'aria-hidden': 'true' });
  const main = el('div', { class: 'pq-lesson-main' });
  let stepHandler: IntentHandler | null = null;
  const closeBtn = btn('✕', () => stepHandler?.cancel?.(), 'icon ghost', { 'aria-label': 'Прервать урок', 'data-act': 'close' });
  const shell = el(
    'div',
    { class: 'pq-lesson', 'data-lesson': lesson.id },
    el('div', { class: 'pq-wood' }, el('div', { class: 'pq-lesson-top' }, pic, el('div', { class: 'title' }, lesson.title.pl ? `${lesson.title.pl} · ${lesson.title.ru}` : lesson.title.ru), closeBtn), dots, main),
  );
  layer.el.replaceChildren(shell);
  // Обработчики шага ставятся через этот слой: × в шапке зовёт тот же cancel, что и Esc.
  const stepLayer: Layer = {
    el: layer.el,
    handle(h) {
      stepHandler = h;
      layer.handle(h);
    },
    get closed() {
      return layer.closed;
    },
    close: () => layer.close(),
  };

  const paintDots = (plan: PlanEntry[], cur: number): void => {
    dots.replaceChildren(
      ...plan.map((p, k) => {
        const r = k < cur ? recordAt(k) : undefined;
        const cls = ['pq-dot', p.rep ? 'rep' : '', k === cur ? 'cur' : '', r?.graded ? (r.ok ? 'ok' : 'bad') : r ? 'ok' : ''].filter(Boolean).join(' ');
        return el('span', { class: cls });
      }),
    );
  };
  // records идут в порядке плана: k-я запись = k-й пункт плана.
  const recordAt = (k: number): StepRecord | undefined => records[k];

  const settings = {
    diacritics: getSetting(store.progress, 'diacritics'),
    translations: getSetting(store.progress, 'translations'),
    keyboardMode: getSetting(store.progress, 'keyboard.mode'),
  };
  const exContent = exerciseContent(content);

  const saveResume = (stepIndex: number): void => {
    if (drill) return;
    store.setLocal({ ...store.local, resume: { lessonId: lesson.id, stepIndex, startedAt, answers: records } });
  };
  const clearResume = (): void => {
    if (drill || !store.local.resume) return;
    const { resume: _r, ...rest } = store.local;
    store.setLocal(rest as LocalState);
  };

  const writeRevs = (step: Step, res: StepResult, rec: StepRecord): void => {
    if (rec.rep || !res.first) return;
    const kind = step.t as StepKind;
    const list = cardsOfStep(step, rec);
    for (const { card, part: pi } of list) {
      const state = derived.cards[card];
      if (!state || revDone.has(card)) continue;
      const partOk = pi === undefined ? null : (rec.parts?.[pi]?.ok ?? false);
      const check: Pick<Check, 'verdict' | 'score'> = partOk === null ? (res.first as Pick<Check, 'verdict' | 'score'>) : partOk ? { verdict: 'exact', score: 1 } : { verdict: 'wrong', score: 0 };
      const ms = pi === undefined ? res.first.ms : Math.round(res.first.ms / Math.max(1, list.length));
      const g = gradeFromAnswer({ kind, check, ms, interval: state.interval, attempt: 1, hinted: res.first.hinted }, tuning);
      if (g === null) continue;
      const tags = g === 0 || check.score < 1 ? res.first.tags : [];
      const ev = record({ k: 'rev', ts: clock.now(), card, g, ms, src, ...(tags.length ? { tags } : {}) }, true);
      if (ev) revDone.add(card);
    }
  };

  let plan = planOf(steps.length, records);
  let cancelled = false;
  while (pos < plan.length) {
    const entry = plan[pos]!;
    const step = steps[entry.i]!;
    paintDots(plan, pos);
    main.scrollTop = 0;
    const ctx: ExerciseCtx = {
      layer: stepLayer,
      root: main,
      stepId: step.id ?? `${lesson.id}#${entry.i}`,
      content: exContent,
      audio: deps.audio,
      portraits: deps.portraits ?? null,
      diacritics: settings.diacritics,
      translations: settings.translations,
      keyboardMode: settings.keyboardMode,
      now: () => clock.mono(),
      random: deps.random ?? Math.random,
      react: (k) => react(pic, k),
      ...(deps.coarse !== undefined ? { coarse: deps.coarse } : {}),
      ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
      ...(entry.rep ? { repeat: true } : {}),
    };
    const res = await mountStep(step, ctx);
    // Отмена до ответа — шаг не засчитан. Ответил и нажал Esc — шаг засчитан, пауза на следующем.
    if (res.status === 'cancel' && !(res.first && res.graded)) {
      cancelled = true;
      break;
    }
    const rec: StepRecord = { i: entry.i, graded: res.graded, ms: res.ms };
    if (entry.rep) rec.rep = 1;
    if (res.first) {
      rec.ok = res.first.verdict !== 'wrong' && res.first.score > 0;
      rec.score = res.first.score;
      if (res.first.tags.length) rec.tags = res.first.tags;
      if (res.first.hinted) rec.hinted = 1;
    }
    if (res.noAudio) rec.noAudio = 1;
    if (res.parts) rec.parts = res.parts;
    records.push(rec);
    writeRevs(step, res, rec);
    pos++;
    plan = planOf(steps.length, records);
    saveResume(pos);
    if (res.status === 'cancel') {
      cancelled = true;
      break;
    }
  }

  const close = (): void => {
    if (!opts.layer) layer.close();
    else layer.handle(null);
  };

  if (cancelled) {
    close();
    return { passed: false, cancelled: true };
  }

  // ── Итог.
  const graded = records.filter((r) => r.graded && !r.rep);
  const n = graded.length;
  const firstTry = n ? graded.filter((r) => r.ok).length / n : 1;
  const score = n ? graded.reduce((s, r) => s + (r.score ?? 0), 0) / n : 1;
  const ms = records.reduce((s, r) => s + r.ms, 0);
  const tags: Record<string, number> = {};
  for (const r of graded) if (!r.ok) for (const t of r.tags ?? []) tags[t] = (tags[t] ?? 0) + 1;

  const planted: string[] = [];
  let passed = true;
  if (!drill) {
    const isBoss = lesson.kind === 'boss' || !!lesson.parts;
    if (isBoss) {
      const parts: Record<string, number> = {};
      let total = 0;
      let wsum = 0;
      for (const p of lesson.parts ?? []) {
        const rs = graded.filter((r) => part[r.i] === p.id);
        const ps = rs.length ? rs.reduce((s, r) => s + (r.score ?? 0), 0) / rs.length : 1;
        parts[p.id] = round3(ps);
        const w = p.weight ?? 1;
        total += w * ps;
        wsum += w;
      }
      const bossScore = wsum ? total / wsum : score;
      passed = bossScore >= (lesson.pass?.score ?? DEFAULT_BOSS_SCORE);
      record({ k: 'boss', ts: clock.now(), lesson: lesson.id, score: round3(bossScore), parts, passed, ms });
    } else {
      // intro: слова урока, которых ещё нет; ok — типы (rec/lis), верные с первой попытки.
      for (const item of lesson.introduces ?? []) {
        if (Object.keys(derived.cards).some((c) => c.startsWith(`${item}#`))) continue;
        const ok = new Set<CardType>();
        for (const r of graded) {
          const s = steps[r.i]!;
          const type = introTypeOf(s);
          if (!type) continue;
          if (s.t === 'match') {
            const k = (s.items ?? []).indexOf(item);
            if (k >= 0 && r.parts?.[k]?.ok && !r.noAudio) ok.add(type);
          } else if (s.item === item && r.ok && !r.noAudio) ok.add(type);
        }
        if (record({ k: 'intro', ts: clock.now(), item, lesson: lesson.id, ok: [...ok].sort() })) planted.push(item);
      }
      const minFirst = lesson.pass?.firstTry ?? DEFAULT_FIRST_TRY;
      const minScore = lesson.pass?.score ?? 0;
      passed = firstTry >= minFirst && score >= minScore;
      record({
        k: 'lesson',
        ts: clock.now(),
        lesson: lesson.id,
        score: round3(score),
        firstTry: round3(firstTry),
        ms,
        passed,
        ...(Object.keys(tags).length ? { tags } : {}),
        answers: n,
      });
    }
  }
  clearResume();

  const result: LessonResult = { passed, score: round3(score), firstTry: round3(firstTry), ms, planted };
  if (!opts.noSummary && !drill) await summary(main, stepLayer, dots, { lesson, result, n, graded: graded.filter((r) => r.ok).length, content });
  close();
  return result;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Итог урока (§5.7): score, first-try, посаженные слова. Без оценок «плохо»: только что получилось. */
function summary(
  main: HTMLElement,
  layer: Layer,
  dots: HTMLElement,
  o: { lesson: Lesson; result: LessonResult; n: number; graded: number; content: Content },
): Promise<void> {
  const { result } = o;
  const words = (result.planted ?? []).map((id) => o.content.vocab.get(id)?.value.pl ?? id);
  const min = Math.max(1, Math.round((result.ms ?? 0) / 60_000));
  dots.replaceChildren();
  return new Promise((resolve) => {
    const done = btn('Dalej', () => {
      layer.handle(null);
      resolve();
    }, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'next' });
    main.replaceChildren(
      el(
        'div',
        { class: 'pq-summary', 'data-summary': o.lesson.id },
        el('div', { class: 'pq-big' }, result.passed ? 'Gotowe!' : 'Prawie.'),
        o.n ? el('div', { class: 'stat' }, el('span', {}, 'С первого раза'), el('b', {}, `${o.graded} из ${o.n}`)) : null,
        o.n ? el('div', { class: 'stat' }, el('span', {}, 'Точность'), el('b', {}, `${Math.round((result.score ?? 0) * 100)} %`)) : null,
        el('div', { class: 'stat' }, el('span', {}, 'Время'), el('b', {}, `${min} мин`)),
        words.length ? el('div', { class: 'planted' }, '🌱 Посажено: ', el('b', { lang: 'pl' }, words.join(', '))) : null,
        el('div', { class: 'pq-ex-actions' }, el('span', { class: 'grow' }), done),
      ),
    );
    layer.handle({
      cancel: () => {
        done.click();
        return true;
      },
    });
    queueMicrotask(() => done.focus({ preventScroll: true }));
  });
}
