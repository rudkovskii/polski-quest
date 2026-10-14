// @vitest-environment happy-dom
// Прогон урока (I-08, ТЗ §5.7, §3.11, §4.7): шаги по порядку, resume, события журнала rev/intro/lesson
// через append + appendGate, повтор проваленного шага в конце, итог, world:input на время оверлея.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogEvent } from '../src/systems/log';
import { append, newProgress, type Progress } from '../src/systems/progress';
import type { Lesson, Step } from '../src/types/content';
import type { LessonResult } from '../src/types/bus';
import { cardsOfStep, lessonSteps, planOf, runLesson, type LessonDeps } from '../src/ui/lesson';
import { createOverlay } from '../src/ui/overlay/host';
import { act, byText, fakeAudio, fixture, flush, memStore, testBus, type } from './overlayKit';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 5, 10); // 12:00 в Варшаве, игровой день 2026-10-05
const content = fixture();
const demo = content.lessons.get('demo.s01')!.value;

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function deps(store: ReturnType<typeof memStore>, now = T0) {
  const bus = testBus();
  const events: LogEvent[] = [];
  const input: boolean[] = [];
  bus.on('world:input', ({ enabled }) => input.push(enabled));
  const audio = fakeAudio();
  const d: LessonDeps = {
    overlay: createOverlay(host, { bus }),
    content,
    store,
    audio,
    clock: { now: () => now, mono: () => 0 },
    random: () => 0.2,
    coarse: true,
    typeMs: 0,
    tz: 'Europe/Warsaw',
    onEvent: (e) => events.push(e),
  };
  return { d, bus, events, input, audio };
}

/** Индекс текущего пункта плана по точкам прогресса. */
function curIndex(): number {
  return [...host.querySelectorAll('.pq-dot')].findIndex((x) => x.classList.contains('cur'));
}

/** Ответить на шаг: верно или (wrong) сначала неверно, потом верно. */
async function answer(step: Step, wrong = false): Promise<void> {
  await flush(1);
  const root = host.querySelector('.pq-lesson-main') as HTMLElement;
  const next = async (): Promise<void> => {
    act(root, 'next').click();
    await flush(1);
  };
  const input = (): HTMLInputElement => root.querySelector('input.pq-answer') as HTMLInputElement;
  switch (step.t) {
    case 'explain':
    case 'say':
      return next();
    case 'shadow':
      for (let i = 0; i < step.repeat; i++) await next();
      return;
    case 'choice':
      if (wrong) byText(root, step.options[(step.answer + 1) % step.options.length]!).click();
      byText(root, step.options[step.answer]!).click();
      return next();
    case 'listen': {
      if (wrong) [...root.querySelectorAll<HTMLButtonElement>('[data-opt]')].find((b) => b.textContent !== step.say)!.click();
      byText(root, step.say).click();
      return next();
    }
    case 'minimal_pair': {
      const target = step.play === 'random' ? 0 : step.play; // random() = 0.2
      if (wrong) byText(root, step.pair[1 - target]!).click();
      byText(root, step.pair[target]!).click();
      return next();
    }
    case 'stress':
      if (wrong) byText(root, step.syllables[(step.answer + 1) % step.syllables.length]!).click();
      byText(root, step.syllables[step.answer]!).click();
      return next();
    case 'gap':
      if (step.options) {
        byText(root, step.answer).click();
        return next();
      }
      type(input(), step.answer);
      act(root, 'check').click();
      return next();
    case 'type':
    case 'dictation': {
      const right = step.t === 'type' ? step.accept[0] : (step.accept?.[0] ?? step.say);
      if (wrong) {
        type(input(), 'zzz');
        act(root, 'check').click();
        act(root, 'retry').click();
      }
      type(input(), right);
      act(root, 'check').click();
      return next();
    }
    case 'order': {
      const pool = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('.pq-order-pool [data-tile]')];
      for (const w of step.answer) pool().find((b) => b.textContent === w)!.click();
      act(root, 'check').click();
      return next();
    }
    case 'match':
      for (const [pl, ru] of step.pairs) {
        byText(root, pl).click();
        byText(root, ru).click();
      }
      return next();
  }
}

/** Пройти урок от текущего шага: wrongAt — индексы шагов, где первая попытка неверна. */
async function playThrough(lesson: Lesson, p: Promise<LessonResult>, wrongAt: number[] = []): Promise<LessonResult> {
  const { steps } = lessonSteps(lesson);
  const reps: number[] = [];
  for (let guard = 0; guard < 60; guard++) {
    await flush(1);
    if (host.querySelector('[data-summary]')) {
      act(host, 'next').click();
      break;
    }
    const k = curIndex();
    if (k < 0) break;
    const i = k < steps.length ? k : reps[k - steps.length]!;
    const wrong = k < steps.length && wrongAt.includes(i);
    if (wrong && steps[i]!.t !== 'match' && steps[i]!.t !== 'gap') reps.push(i);
    await answer(steps[i]!, wrong);
  }
  return p;
}

const seed = (p: Progress, items: string[], ts: number): Progress => {
  let dev = { deviceId: 'old001', seq: 0 };
  for (const item of items) {
    const r = append(p, dev, { k: 'intro', ts, item, lesson: 'demo.s00', ok: ['rec', 'lis'] });
    if (!r.ok) throw new Error('seed');
    p = r.progress;
    dev = r.dev;
  }
  return p;
};

describe('план и карточки шага', () => {
  it('план: шаги по порядку + повтор проваленных с первой попытки', () => {
    expect(planOf(3, [])).toEqual([0, 1, 2].map((i) => ({ i, rep: false })));
    const plan = planOf(3, [{ i: 0, graded: true, ok: false, ms: 1 }, { i: 1, graded: true, ok: true, ms: 1 }, { i: 2, graded: false, ms: 1 }]);
    expect(plan.at(-1)).toEqual({ i: 0, rep: true });
    expect(plan).toHaveLength(4);
  });

  it('карточки по таблице §3.5: listen/dictation → lis, choice → rec/pro, order/type/gap → pro, match → rec по items, mp → pair', () => {
    expect(cardsOfStep({ t: 'listen', say: 'x', options: ['a', 'b'], answer: 0, item: 'lx.a' }, {})).toEqual([{ card: 'lx.a#lis' }]);
    expect(cardsOfStep({ t: 'listen', say: 'x', options: ['a', 'b'], answer: 0, item: 'lx.a' }, { noAudio: 1 })).toEqual([]);
    expect(cardsOfStep({ t: 'choice', q: 'x', options: ['a', 'b'], answer: 0, item: 'lx.a', dir: 'ru-pl' }, {})).toEqual([{ card: 'lx.a#pro' }]);
    expect(cardsOfStep({ t: 'choice', q: 'x', options: ['a', 'b'], answer: 0, item: 'lx.a' }, {})).toEqual([{ card: 'lx.a#rec' }]);
    expect(cardsOfStep({ t: 'gap', text: 'a ___', answer: 'b', item: 'lx.b' }, {})).toEqual([{ card: 'lx.b#pro' }]);
    expect(cardsOfStep({ t: 'minimal_pair', pair: ['a', 'b'], play: 0, cluster: 'R3', item: 'mp.a_b' }, {})).toEqual([{ card: 'mp.a_b#pair' }]);
    expect(cardsOfStep({ t: 'match', pairs: [['a', 'а'], ['b', 'б'], ['c', 'ц']], items: ['lx.a', 'lx.b'] }, {})).toEqual([
      { card: 'lx.a#rec', part: 0 },
      { card: 'lx.b#rec', part: 1 },
    ]);
    expect(cardsOfStep({ t: 'stress', word: 'x', syllables: ['x'], answer: 0, item: 'lx.a' }, {})).toEqual([]);
  });
});

describe('урок demo.s01 целиком', () => {
  it('новые слова: intro для introduces, итог lesson, без rev (карточек ещё нет); оверлей выключает мир', async () => {
    const store = memStore();
    const { d, events, input } = deps(store);
    const r = await playThrough(demo, runLesson(demo, d));
    expect(r).toMatchObject({ passed: true, score: 1, firstTry: 1 });
    expect(r.planted).toEqual(['lx.maly', 'lx.slucham', 'lx.stol']);
    expect(events.map((e) => e.k)).toEqual(['intro', 'intro', 'intro', 'lesson']);
    const intro = events.filter((e) => e.k === 'intro');
    expect(intro.find((e) => e.item === 'lx.maly')).toMatchObject({ lesson: 'demo.s01', ok: ['lis', 'rec'] });
    expect(intro.find((e) => e.item === 'lx.slucham')).toMatchObject({ ok: ['rec'] });
    expect(events.at(-1)).toMatchObject({ k: 'lesson', lesson: 'demo.s01', score: 1, firstTry: 1, passed: true, answers: 10 });
    expect(store.progress.log.events).toHaveLength(4);
    expect(store.local.resume).toBeUndefined();
    expect(input).toEqual([false, true]);
    expect(host.querySelector('.pq-layer')).toBeNull();
  });

  it('due-карточки: rev по первой попытке (верно → 2, неверно → 0 с тегом), без двойного rev; повтор ошибки в конце', async () => {
    const store = memStore(seed(newProgress(T0 - 5 * DAY, 'w1'), ['lx.maly', 'lx.stol'], T0 - 3 * DAY));
    const { d, events } = deps(store);
    const r = await playThrough(demo, runLesson(demo, d), [7]); // choice «stół это…» — сначала стул
    const revs = events.filter((e) => e.k === 'rev');
    expect(revs.map((e) => [e.card, e.g, e.src])).toEqual([
      ['lx.maly#lis', 2, 'scene'],
      ['lx.stol#rec', 0, 'scene'],
      ['lx.stol#lis', 2, 'scene'],
      ['lx.maly#rec', 2, 'scene'],
    ]);
    expect(revs[1]).toMatchObject({ tags: ['ff.stol'] });
    // intro только для слова, которого ещё нет
    expect(events.filter((e) => e.k === 'intro').map((e) => e.item)).toEqual(['lx.slucham']);
    const lesson = events.find((e) => e.k === 'lesson')!;
    expect(lesson).toMatchObject({ firstTry: 0.9, tags: { 'ff.stol': 1 }, answers: 10, passed: true });
    expect(r.firstTry).toBe(0.9);
  });

  it('ранний ответ (карточка не due) в rev не пишется: appendGate', async () => {
    const store = memStore(seed(newProgress(T0 - DAY, 'w1'), ['lx.maly', 'lx.stol'], T0 - 60_000));
    const { d, events } = deps(store);
    await playThrough(demo, runLesson(demo, d));
    expect(events.filter((e) => e.k === 'rev')).toEqual([]);
    expect(events.at(-1)?.k).toBe('lesson');
  });

  it('несданная сцена: firstTry < pass.firstTry (0.7) → passed false, итог без стыда', async () => {
    const store = memStore();
    const { d, events } = deps(store);
    const r = await playThrough(demo, runLesson(demo, d), [1, 2, 3, 7, 9]);
    expect(r.passed).toBe(false);
    expect(events.at(-1)).toMatchObject({ k: 'lesson', passed: false, firstTry: 0.5 });
  });
});

describe('resume (§5.7: local.resume после каждого шага)', () => {
  it('отмена на шаге 3 → resume; повторный запуск продолжает с шага 3, lesson пишется один раз', async () => {
    const store = memStore();
    const { d, events, bus } = deps(store);
    const steps = demo.steps!;
    const p = runLesson(demo, d);
    for (let i = 0; i < 3; i++) await answer(steps[i]!);
    await flush(1);
    expect(curIndex()).toBe(3);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    const r1 = await p;
    expect(r1).toEqual({ passed: false, cancelled: true });
    expect(store.local.resume).toMatchObject({ lessonId: 'demo.s01', stepIndex: 3, startedAt: T0 });
    expect(store.local.resume!.answers).toHaveLength(3);
    expect(events).toEqual([]);
    expect(host.querySelector('.pq-layer')).toBeNull();

    const again = deps(store, T0 + 3_600_000);
    const p2 = runLesson(demo, again.d);
    await flush(1);
    expect(curIndex()).toBe(3);
    const r2 = await playThrough(demo, p2);
    expect(r2.passed).toBe(true);
    expect(again.events.filter((e) => e.k === 'lesson')).toHaveLength(1);
    expect(again.events.find((e) => e.k === 'lesson')).toMatchObject({ answers: 10 });
    expect(store.local.resume).toBeUndefined();
  });

  it('× в шапке = отмена; ответил и нажал Esc — шаг засчитан, пауза на следующем', async () => {
    const store = memStore();
    const { d, bus } = deps(store);
    const steps = demo.steps!;
    const p = runLesson(demo, d);
    await answer(steps[0]!);
    await flush(1);
    byText(host.querySelector('.pq-lesson-main')!, 'łata').click();
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    await p;
    expect(store.local.resume).toMatchObject({ stepIndex: 2 });

    const p2 = runLesson(demo, deps(store).d);
    await flush(1);
    expect(curIndex()).toBe(2);
    act(host, 'close').click();
    expect((await p2).cancelled).toBe(true);
    expect(store.local.resume).toMatchObject({ stepIndex: 2 });
  });

  it('resume старше tuning.resumeHours — урок с начала', async () => {
    const store = memStore();
    store.setLocal({ ...store.local, resume: { lessonId: 'demo.s01', stepIndex: 5, startedAt: T0 - 7 * 3_600_000, answers: [] } });
    const p = runLesson(demo, deps(store).d);
    await flush(1);
    expect(curIndex()).toBe(0);
    act(host, 'close').click();
    await p;
  });
});

describe('босс и упражнение у слова', () => {
  it('урок с parts → событие boss со score по частям', async () => {
    const boss = content.lessons.get('demo.boss')!.value;
    const store = memStore();
    const { d, events } = deps(store);
    const r = await playThrough(boss, runLesson(boss, d), [0]);
    const ev = events.find((e) => e.k === 'boss')!;
    expect(ev).toMatchObject({ lesson: 'demo.boss', parts: { a: 0, b: 1 }, score: 0.5, passed: false });
    expect(r.passed).toBe(false);
    expect(events.some((e) => e.k === 'lesson')).toBe(false);
  });

  it('drill (объект-слово в мире): src world, без lesson/intro, без resume и итога', async () => {
    const store = memStore(seed(newProgress(T0 - 5 * DAY, 'w1'), ['lx.kawa'], T0 - 3 * DAY));
    const { d, events } = deps(store);
    const lesson: Lesson = { id: 'word.demo.kawa', kind: 'practice', title: { ru: 'kawa' }, minutes: 1, steps: [{ t: 'choice', q: 'kawa — это…', options: ['кофе', 'квас'], answer: 0, item: 'lx.kawa' }] };
    const p = runLesson(lesson, d, { drill: true, noSummary: true });
    await answer(lesson.steps![0]);
    await p;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ k: 'rev', card: 'lx.kawa#rec', g: 2, src: 'world' });
    expect(store.local.resume).toBeUndefined();
  });
});
