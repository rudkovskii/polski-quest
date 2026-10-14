// @vitest-environment happy-dom
// Экран босса (ТЗ §5.8, I-11): части по порядку без подсказок, событие `boss` с частями и кластерами,
// пороги (score ≥ 0.8, красный кластер ≥ 0.6), повтор только проваленных частей, прерывание между
// частями (local.resume), первая сдача → module.onComplete и печать в паспорте.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogEvent } from '../src/systems/log';
import { newProgress, type Progress } from '../src/systems/progress';
import type { Lesson, Step } from '../src/types/content';
import type { LessonResult } from '../src/types/bus';
import { BOSS_KEEP_DAYS, bossPlan, bossRewards, lastBoss, runBoss } from '../src/ui/boss';
import { runLesson, type LessonDeps } from '../src/ui/lesson';
import { createOverlay } from '../src/ui/overlay/host';
import { passportModel } from '../src/ui/passport';
import { mountPlay } from '../src/ui/play';
import { derive, deriveContent } from '../src/systems/derive';
import { act, byText, fakeAudio, fixture, flush, memStore, testBus } from './overlayKit';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 5, 10);
const content = fixture();
const boss = content.lessons.get('demo.boss')!.value;

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function deps(store: ReturnType<typeof memStore>, now = T0) {
  const bus = testBus();
  const events: LogEvent[] = [];
  const d: LessonDeps = {
    overlay: createOverlay(host, { bus }),
    content,
    store,
    audio: fakeAudio(),
    clock: { now: () => now, mono: () => 0 },
    random: () => 0.2,
    coarse: true,
    typeMs: 0,
    tz: 'Europe/Warsaw',
    onEvent: (e) => events.push(e),
  };
  return { d, bus, events };
}

const main = (): HTMLElement => host.querySelector('.pq-lesson-main') as HTMLElement;

/** Ответить на шаг (minimal_pair с play 0/1, choice): wrong — сначала неверно. */
async function answer(step: Step, wrong = false): Promise<void> {
  await flush(1);
  const root = main();
  if (step.t === 'minimal_pair') {
    const target = step.play === 'random' ? 0 : step.play;
    if (wrong) byText(root, step.pair[1 - target]!).click();
    byText(root, step.pair[target]!).click();
  } else if (step.t === 'choice') {
    if (wrong) byText(root, step.options[(step.answer + 1) % step.options.length]!).click();
    byText(root, step.options[step.answer]!).click();
  } else throw new Error(`шаг ${step.t} в тесте не поддержан`);
  act(root, 'next').click();
  await flush(1);
}

/** Пройти идущие части: wrong — id шагов `<part>.<i>` с неверной первой попыткой. Итог закрыть. */
async function playBoss(lesson: Lesson, p: Promise<LessonResult>, wrong: string[] = [], opts: { stopBefore?: string } = {}): Promise<string[]> {
  const played: string[] = [];
  await flush(1);
  act(host, 'start').click();
  for (let guard = 0; guard < 40; guard++) {
    await flush(1);
    if (host.querySelector('[data-summary]')) {
      act(host, 'next').click();
      break;
    }
    const cur = host.querySelector('.pq-boss-part.cur') as HTMLElement | null;
    if (!cur) break;
    const idx = Number(cur.textContent) - 1;
    const part = lesson.parts![idx]!;
    if (opts.stopBefore === part.id) {
      act(host, 'close').click();
      break;
    }
    const i = [...host.querySelectorAll('.pq-dot')].findIndex((x) => x.classList.contains('cur'));
    played.push(`${part.id}.${i}`);
    await answer(part.steps[i]!, wrong.includes(`${part.id}.${i}`));
  }
  await p;
  return played;
}

describe('bossPlan: что играть (§5.8)', () => {
  const parts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const base = { parts, passScore: 0.8, passedBefore: false, last: null, resume: null, now: T0 };

  it('первая попытка — все части', () => {
    expect(bossPlan(base)).toEqual({ kept: {}, todo: ['a', 'b', 'c'], retry: false });
  });
  it('прошлая несданная попытка ≤ 7 дней: сданные части сохраняются, повтор только проваленных', () => {
    const r = bossPlan({ ...base, last: { ts: T0 - DAY, parts: { a: 0.9, b: 0.5, c: 0.8 }, passed: false } });
    expect(r.todo).toEqual(['b']);
    expect(r.retry).toBe(true);
    expect(Object.keys(r.kept)).toEqual(['a', 'c']);
  });
  it('старше 7 дней, уже сдан раньше или прошлая попытка сдана — снова все части', () => {
    const last = { ts: T0 - (BOSS_KEEP_DAYS + 1) * DAY, parts: { a: 1, b: 0 }, passed: false };
    expect(bossPlan({ ...base, last }).todo).toEqual(['a', 'b', 'c']);
    expect(bossPlan({ ...base, last: { ...last, ts: T0 - DAY }, passedBefore: true }).todo).toEqual(['a', 'b', 'c']);
    expect(bossPlan({ ...base, last: { ts: T0 - DAY, parts: { a: 1, b: 1, c: 1 }, passed: true } }).todo).toEqual(['a', 'b', 'c']);
  });
  it('провал по красному кластеру: части ≥ 0.8, но со шагами проваленного кластера, повторяются', () => {
    const last = { ts: T0 - DAY, parts: { a: 0.9, b: 0.9, c: 1 }, passed: false, clusters: { R6: 0.3 } };
    const r = bossPlan({ ...base, last, redFailed: ['R6'], partClusters: { a: ['R6', 'R5'], b: ['R2'], c: ['R6'] } });
    expect(r.todo).toEqual(['a', 'c']);
    expect(Object.keys(r.kept)).toEqual(['b']);
  });
  it('resume текущей попытки добавляет пройденные части; «всё сдано, босс нет» → заново всё', () => {
    expect(bossPlan({ ...base, resume: [{ part: 'a', score: 0.4, tally: {}, ms: 1 }] }).todo).toEqual(['b', 'c']);
    expect(bossPlan({ ...base, last: { ts: T0 - DAY, parts: { a: 1, b: 1, c: 1 }, passed: false } }).todo).toEqual(['a', 'b', 'c']);
  });
});

describe('прогон demo.boss через runLesson', () => {
  it('всё верно → событие boss (сдан, части, score), печать и билет на итоге, resume чист', async () => {
    const store = memStore();
    const { d, events } = deps(store);
    const p = runLesson(boss, d);
    await flush(1);
    expect(host.querySelector('[data-boss-intro]')?.textContent).toContain('Без подсказок');
    let stamp = '';
    let reward = '';
    const watch = new MutationObserver(() => {
      stamp ||= host.querySelector('[data-stamp]')?.textContent ?? '';
      reward ||= host.querySelector('[data-role="reward"]')?.textContent ?? '';
    });
    watch.observe(host, { subtree: true, childList: true });
    const played = await playBoss(boss, p);
    watch.disconnect();
    expect(played).toEqual(['a.0', 'b.0']);
    expect(await p).toMatchObject({ passed: true, score: 1 });
    const ev = events.find((e) => e.k === 'boss')!;
    expect(ev).toMatchObject({ lesson: 'demo.boss', parts: { a: 1, b: 1 }, score: 1, passed: true, clusters: { R3: 1 } });
    expect(events.some((e) => e.k === 'lesson' || e.k === 'intro')).toBe(false);
    expect(stamp).toBe('PRAGA');
    expect(reward).toContain('Bilet');
    expect(store.local.resume).toBeUndefined();
    expect(host.querySelector('.pq-layer')).toBeNull();
  });

  it('ошибка в части a → не сдан (0.5 < 0.8), итог зовёт повторить только «Слух»; повтор играет только a и сдаёт', async () => {
    const store = memStore();
    const first = deps(store);
    let note = '';
    const watch = new MutationObserver(() => (note ||= host.querySelector('[data-summary] [data-role="retry"]')?.textContent ?? ''));
    watch.observe(host, { subtree: true, childList: true });
    const p1 = runLesson(boss, first.d);
    await playBoss(boss, p1, ['a.0']);
    watch.disconnect();
    expect(await p1).toMatchObject({ passed: false, score: 0.5 });
    expect(first.events.find((e) => e.k === 'boss')).toMatchObject({ parts: { a: 0, b: 1 }, score: 0.5, passed: false, clusters: { R3: 0 } });
    expect(note).toBe('Слух.');

    const second = deps(store, T0 + DAY);
    const p2 = runLesson(boss, second.d);
    await flush(1);
    expect(host.querySelector('[data-boss-intro]')?.textContent).toContain('Попробуй снова только части');
    const played = await playBoss(boss, p2);
    expect(played).toEqual(['a.0']);
    expect(await p2).toMatchObject({ passed: true, score: 1 });
    expect(second.events.find((e) => e.k === 'boss')).toMatchObject({ parts: { a: 1, b: 1 }, passed: true });
  });

  it('прервал между частями → resume хранит сданную часть; продолжение играет только оставшуюся', async () => {
    const store = memStore();
    const { d, events } = deps(store);
    const p1 = runLesson(boss, d);
    await playBoss(boss, p1, [], { stopBefore: 'b' });
    expect(await p1).toEqual({ passed: false, cancelled: true });
    expect(events).toEqual([]);
    expect(store.local.resume).toMatchObject({ lessonId: 'demo.boss', stepIndex: 1, startedAt: T0 });
    expect(store.local.resume!.answers).toEqual([{ part: 'a', score: 1, tally: { R3: { ok: 1, n: 1 } }, ms: 0 }]);

    const later = deps(store, T0 + 3 * DAY); // меньше 7 дней — части живы
    const p2 = runLesson(boss, later.d);
    expect(await playBoss(boss, p2)).toEqual(['b.0']);
    expect(later.events.find((e) => e.k === 'boss')).toMatchObject({ parts: { a: 1, b: 1 }, passed: true });
  });

  it('due-карточка в боссе → rev с src boss', async () => {
    let p: Progress = newProgress(T0 - 10 * DAY, 'w1');
    p = { ...p, log: { checkpoint: null, events: [{ id: 'old.1', ts: T0 - 5 * DAY, k: 'intro', item: 'lx.kawa', lesson: 'demo.s01', ok: ['rec', 'lis'] }] } };
    const store = memStore(p);
    const { d, events } = deps(store);
    await playBoss(boss, runLesson(boss, d));
    expect(events.filter((e) => e.k === 'rev')).toMatchObject([{ card: 'lx.kawa#rec', g: 2, src: 'boss' }]);
  });
});

describe('порог красного кластера (§5.8: каждый красный ≥ redClusterMin)', () => {
  const mp: Step = { t: 'minimal_pair', pair: ['łata', 'lata'], play: 0, cluster: 'R3' };
  const ch: Step = { t: 'choice', q: 'kawa — это…', options: ['кофе', 'квас'], answer: 0 };
  const lesson: Lesson = {
    id: 'demo.boss_r',
    kind: 'boss',
    title: { ru: 'Босс R3' },
    minutes: 3,
    pass: { score: 0.8, redClusterMin: 0.6 },
    parts: [
      { id: 'a', title: 'Слух', weight: 0.2, steps: [mp, mp] },
      { id: 'b', title: 'Смысл', weight: 0.8, steps: [ch, ch] },
    ],
  };
  const withDiag = (r3: number): Progress => {
    const p = newProgress(T0 - 10 * DAY, 'w1');
    return { ...p, log: { checkpoint: null, events: [{ id: 'd.1', ts: T0 - 2 * DAY, k: 'diag', results: { R3: { ok: r3, n: 5 } } }] } };
  };

  it('R3 красный, 1 из 2 в части a: score 0.9, но 0.5 < 0.6 → не сдан, повтор только a', async () => {
    const store = memStore(withDiag(1));
    const { d, events } = deps(store);
    expect(derive(store.progress, deriveContent(content), T0, 'Europe/Warsaw').clusterStatus.R3).toBe('red');
    const r = runBoss(lesson, d);
    await playBoss(lesson, r, ['a.1']);
    expect(await r).toMatchObject({ passed: false, score: 0.9 });
    expect(events.find((e) => e.k === 'boss')).toMatchObject({ clusters: { R3: 0.5 }, passed: false });
    const again = deps(store, T0 + DAY);
    const r2 = runBoss(lesson, again.d);
    expect(await playBoss(lesson, r2)).toEqual(['a.0', 'a.1']);
    expect(await r2).toMatchObject({ passed: true });
  });

  it('тот же ответ при жёлтом R3 → сдан', async () => {
    const store = memStore(withDiag(3.5));
    const { d } = deps(store);
    const r = runBoss(lesson, d);
    await playBoss(lesson, r, ['a.1']);
    expect(await r).toMatchObject({ passed: true, score: 0.9 });
  });
});

describe('награда и паспорт (§5.8, §5.10)', () => {
  it('bossRewards: печать биома модуля и предметы onComplete', () => {
    expect(bossRewards(content, boss)).toEqual({ stamp: 'Praga', items: ['Bilet'] });
    expect(bossRewards(content, content.lessons.get('demo.s01')!.value)).toEqual({ stamp: null, items: [] });
  });

  it('play: первая сдача → module.onComplete (флаг, предмет), печать Praga в паспорте; lastBoss', async () => {
    const bus = testBus();
    const store = memStore();
    const pl = mountPlay(host, { content, store, bus, audio: fakeAudio(), coarse: true, typeMs: 0, clock: { now: () => T0, mono: () => 0 } });
    const before = passportModel(content, store.progress, derive(store.progress, deriveContent(content), T0));
    expect(before.pages).toMatchObject([{ biome: 'praga', stamped: false }]);
    expect(before.pages[0]!.how).toContain('Сдай босса');
    const r = pl.openLesson('demo.boss');
    await playBoss(boss, r as Promise<LessonResult>);
    expect((await r)?.passed).toBe(true);
    expect(store.progress.world.flags['demo.done']).toBe(T0);
    expect(store.progress.world.items['it.bilet']).toBe(T0);
    expect(lastBoss(store.progress, 'demo.boss')).toMatchObject({ passed: true, parts: { a: 1, b: 1 } });

    bus.emit('ui:screen:open', { screen: 'passport' });
    await flush();
    const page = host.querySelector('[data-screen="passport"] [data-biome="praga"]') as HTMLElement;
    expect(page.dataset.stamped).toBe('true');
    expect(host.querySelector('[data-item="it.bilet"]')?.textContent).toContain('Bilet');
    expect(host.querySelector('[data-cando="demo.cd1"]')?.getAttribute('data-done')).toBe('true');
    act(host, 'close').click();
    await flush();
    expect(host.querySelector('[data-screen="passport"]')).toBeNull();
    pl.dispose();
  });
});
