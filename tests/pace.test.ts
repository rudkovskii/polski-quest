// @vitest-environment happy-dom
// Темп P-06: шаги урока по расписанию систем и без звука, реплики `.mute`, диагностика 12 пунктов
// (ошибки не добавляют пунктов, выход «Wyjdź» в любой момент с сохранением ответов), без звука — чтение
// по транскрипции без карточек `lis`, реакция мира на ошибку, крючок дня в итоге, релизная проверка todo.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent, type Content } from '../src/systems/content';
import { derive, deriveContent } from '../src/systems/derive';
import type { LogEvent } from '../src/systems/log';
import { AUDIO_STEPS, lessonForToday, lineFor, muteLines, stepPlayable, type StepGate } from '../src/systems/pace';
import { newProgress, setSetting } from '../src/systems/progress';
import type { Lesson, Step } from '../src/types/content';
import { lineSpeech, runLesson, type LessonDeps } from '../src/ui/lesson';
import { createOverlay } from '../src/ui/overlay/host';
import { summaryBody } from '../src/ui/daySummary';
import { summarizeDay } from '../src/systems/session';
import { checkContent, errorsOf } from '../tools/lib/content_check';
import { readContentDir, readSchemas } from '../tools/lib/content_io';
import { act, byText, fakeAudio, flush, memStore, testBus } from './overlayKit';

const content = getContent();
const T0 = Date.UTC(2026, 9, 15, 10);

const gate = (o: Partial<StepGate> = {}): StepGate => ({
  closed: () => false,
  silent: false,
  trOf: (id) => content.vocab.get(id)?.value.tr,
  pairRu: (id) => !!content.pairs.get(id)?.ru,
  ...o,
});

describe('шаги урока по расписанию и без звука (pace)', () => {
  it('клавиатура закрыта (дни 1–2) — шаги с вводом не играются; «повтори вслух» — до дня 4', () => {
    const type: Step = { t: 'type', prompt: 'x', accept: ['a'] };
    const dict: Step = { t: 'dictation', say: 'a', accept: ['a'] };
    const shadow: Step = { t: 'shadow', pl: 'a', repeat: 1 };
    const closed = gate({ closed: (s) => s === 'keyboard' || s === 'shadow' });
    expect([type, dict, shadow].map((s) => stepPlayable(s, closed))).toEqual([false, false, false]);
    expect([type, dict, shadow].map((s) => stepPlayable(s, gate()))).toEqual([true, true, true]);
  });
  it('без звука: listen и dictation — только с транскрипцией, пара — с переводом, same_diff — нет', () => {
    const silent = gate({ silent: true });
    expect(stepPlayable({ t: 'listen', say: 'mleko', options: ['mleko', 'młeko'], answer: 0 }, silent)).toBe(false);
    expect(stepPlayable({ t: 'listen', say: 'mleko', options: ['mleko', 'młeko'], answer: 0, tr: 'мле́ко' }, silent)).toBe(true);
    expect(stepPlayable({ t: 'listen', say: 'woda', options: 'auto:x', answer: 0, item: 'lx.woda' }, silent)).toBe(true);
    expect(stepPlayable({ t: 'minimal_pair', pair: ['woda', 'wada'], play: 0, cluster: 'R1', item: 'mp.woda_wada' }, silent)).toBe(true);
    expect(stepPlayable({ t: 'minimal_pair', pair: ['woda', 'wada'], play: 0, cluster: 'R1', mode: 'same_diff', item: 'mp.woda_wada' }, silent)).toBe(false);
    expect(AUDIO_STEPS.has('stress')).toBe(true);
  });
  it('без звука в главе 1 нет шага на слух, которому нечем заменить звук', () => {
    const silent = gate({ silent: true });
    for (const { value: l } of content.lessons.values()) {
      const all = l.steps ?? (l.parts ?? []).flatMap((p) => p.steps);
      const lost = all.filter((s) => (s.t === 'listen' || s.t === 'dictation') && !stepPlayable(s, silent));
      expect([l.id, lost.length]).toEqual([l.id, 0]);
    }
  });
  it('lessonForToday: id шагов сохраняются (озвучка), всё отфильтровано — исходный урок', () => {
    const s01 = content.lessons.get('ch01.s01')!.value;
    const day3 = lessonForToday(s01, gate({ closed: (s) => s === 'shadow' }));
    expect(day3.steps!.length).toBe(s01.steps!.length - s01.steps!.filter((s) => s.t === 'shadow').length);
    expect(day3.steps!.some((s) => s.t === 'shadow')).toBe(false);
    expect(day3.steps![1]!.id).toBe('ch01.s01#1');
    expect(lessonForToday(s01, gate())).toBe(s01);
  });
  it('реплики без звука: `<id>.mute`, если есть', () => {
    expect(lineFor('d02.brzechwa.bramka.2', true, content.lines)).toBe('d02.brzechwa.bramka.2.mute');
    expect(lineFor('d02.brzechwa.bramka.2', false, content.lines)).toBe('d02.brzechwa.bramka.2');
    expect(lineFor('d02.brzechwa.bramka.1', true, content.lines)).toBe('d02.brzechwa.bramka.1');
    expect(muteLines(content.lines).get('d04.kazik.shadow.2')?.id).toBe('d04.kazik.shadow.2.mute');
    expect(muteLines(content.lines).has('d04.kazik.shadow.2')).toBe(true);
    expect(lineSpeech(content, 'd14.konduktor.err', true)?.pl).toBe('Proszę przeczytać.');
    expect(lineSpeech(content, 'd14.konduktor.err', false)?.pl).toBe('Proszę powtórzyć?');
  });
});

describe('контент дней 2–14 (P-06/P-08)', () => {
  it('диагностика: 12 пунктов без диктанта, у каждого кластер и правило с переводом; без звука — транскрипция', () => {
    const s00 = content.lessons.get('ch01.s00')!.value;
    expect(s00.steps!.length).toBe(12);
    expect(s00.steps!.some((s) => s.t === 'dictation' || s.t === 'explain')).toBe(false);
    for (const s of s00.steps!) {
      expect(s.cluster).toBeTruthy();
      expect(s.why).toMatch(/:/);
      if (s.t === 'listen') expect(s.tr).toBeTruthy();
    }
    expect(new Set(s00.steps!.map((s) => s.cluster)).size).toBe(10);
  });
  it('не больше 3 новых слов в сцене; у каждой сцены дня свой gameDay', () => {
    for (const { value: l } of content.lessons.values()) expect([l.id, (l.introduces ?? []).length <= 3]).toEqual([l.id, true]);
    expect(content.tuning.maxIntroducesPerLesson).toBe(3);
  });
  it('ни одной реплики todo; все реплики дней 2–14 есть в lines', () => {
    expect([...content.lines.values()].filter((l) => l.todo)).toEqual([]);
    for (const d of content.dialogues.values()) for (const n of Object.values(d.value.nodes)) expect((n as { todo?: boolean }).todo).toBeUndefined();
  });
  it('обещание «chrząszcz» дня 2 и развязка дня 14', () => {
    expect(content.lines.get('d02.brzechwa.peron.1')?.pl).toContain('chrząszcz');
    const done = content.modules.get('ch01')!.module.onComplete!;
    expect(done.some((e) => e.line === 'd14.brzechwa.1')).toBe(true);
    expect(done.some((e) => e.startLesson === 'ch01.chrzaszcz')).toBe(true);
  });
  it('релизная проверка: todo в любой реплике — ошибка сборки (PQ_RELEASE)', () => {
    const { files } = readContentDir('content');
    const schemas = readSchemas();
    const lines = JSON.parse(JSON.stringify(files.get('story/lines.json'))) as { id: string; who: string; todo?: boolean }[];
    lines.push({ id: 'd09.test.todo', who: 'bobr', todo: true });
    const broken = new Map(files);
    broken.set('story/lines.json', lines);
    expect(errorsOf(checkContent({ files: broken, schemas })).filter((i) => i.code === 'todo')).toEqual([]);
    expect(errorsOf(checkContent({ files: broken, schemas, release: true })).some((i) => i.code === 'todo' && i.msg.includes('d09.test.todo'))).toBe(true);
    expect(errorsOf(checkContent({ files, schemas, release: true }))).toEqual([]);
  });
});

// ── Урок в оверлее: диагностика и без звука.

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function deps(store: ReturnType<typeof memStore>, c: Content = content) {
  const bus = testBus();
  const events: LogEvent[] = [];
  const d: LessonDeps = {
    overlay: createOverlay(host, { bus }),
    content: c,
    store,
    audio: fakeAudio(),
    clock: { now: () => T0, mono: () => 0 },
    random: () => 0.2,
    coarse: true,
    typeMs: 0,
    tz: 'Europe/Warsaw',
    onEvent: (e) => events.push(e),
  };
  return { d, events };
}

const main = (): HTMLElement => host.querySelector('.pq-lesson-main') as HTMLElement;

/** Ответить на шаг диагностики: верно или неверно (одна попытка). */
async function answerDiag(s: Step, right: boolean): Promise<void> {
  await flush(1);
  const root = main();
  if (s.t === 'stress') byText(root, s.syllables[right ? s.answer : (s.answer + 1) % s.syllables.length]!).click();
  else if (s.t === 'listen' || s.t === 'choice') {
    const opts = s.options as string[];
    byText(root, opts[right ? s.answer : (s.answer + 1) % opts.length]!).click();
  }
  await flush(1);
  act(root, 'next').click();
  await flush(1);
}

describe('диагностика дня 2 в оверлее', () => {
  const s00 = content.lessons.get('ch01.s00')!.value;
  it('ошибки не добавляют пунктов: 12 точек, после неверного — правило и «Hyk!», без повтора', async () => {
    const store = memStore(newProgress(T0 - 86_400_000, 'w1'));
    const { d, events } = deps(store);
    const run = runLesson(s00, d);
    await flush(2);
    expect(host.querySelectorAll('.pq-dot').length).toBe(12);
    expect(act(host, 'close').textContent).toContain('Wyjdź');
    const first = s00.steps![0]!;
    byText(main(), (first as Extract<Step, { t: 'stress' }>).syllables[0]!).click();
    await flush(1);
    expect(main().querySelector('[data-fb=rule]')?.textContent).toContain('te-LE-fon');
    expect(main().querySelector('.pq-ex-fb')?.textContent).toContain('Hyk!');
    act(main(), 'next').click();
    await flush(1);
    for (const s of s00.steps!.slice(1)) await answerDiag(s, false);
    await flush(2);
    expect(host.querySelectorAll('.pq-dot').length).toBe(0); // урок закрыт, повтора ошибок нет
    const r = await run;
    expect(r.passed).toBe(true);
    expect(events.filter((e) => e.k === 'diag').length).toBe(1);
  });
  it('«Wyjdź» посреди: ответы засчитаны (diag + lesson), resume стёрт, непроверенные кластеры — unknown', async () => {
    const store = memStore(newProgress(T0 - 86_400_000, 'w1'));
    const { d, events } = deps(store);
    const run = runLesson(s00, d);
    for (const s of s00.steps!.slice(0, 7)) await answerDiag(s, true);
    expect(host.querySelector('.pq-diag-mid')).toBeTruthy(); // Казик после 6-го пункта
    act(host, 'close').click();
    const r = await run;
    expect(r).toMatchObject({ passed: true, exited: true });
    expect(store.local.resume).toBeUndefined();
    const diag = events.find((e) => e.k === 'diag');
    expect(diag && diag.k === 'diag' ? Object.keys(diag.results).sort() : []).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    const dv = derive(store.progress, deriveContent(content), T0);
    expect(dv.clusterStatus.R1).toBe('green');
    expect(dv.clusterStatus.R9).toBe('unknown');
    expect(dv.clusterStatus.R6).toBe('unknown');
    expect(dv.lessonsDone.has('ch01.s00')).toBe(true);
  });
  it('выход до первого ответа — ничего не засчитано, турникет подождёт', async () => {
    const store = memStore(newProgress(T0 - 86_400_000, 'w1'));
    const { d, events } = deps(store);
    const run = runLesson(s00, d);
    await flush(2);
    act(host, 'close').click();
    expect(await run).toMatchObject({ cancelled: true });
    expect(events.length).toBe(0);
  });
});

describe('без звука в уроке', () => {
  it('listen: «Как это пишется? [транскрипция]», кнопок ▶ нет, ответ чтением идёт в карточку lis (P-10b)', async () => {
    let p = newProgress(T0 - 3 * 86_400_000, 'w1');
    p = setSetting(p, 'sound.mode', 'off', T0 - 86_400_000);
    const store = memStore(p);
    store.append({ k: 'intro', ts: T0 - 2 * 86_400_000, item: 'lx.woda', lesson: 'ch01.s01', ok: ['rec', 'lis'] });
    const { d, events } = deps(store);
    const lesson: Lesson = { id: 'test.silent', kind: 'practice', title: { ru: 't' }, minutes: 1, steps: [{ t: 'listen', say: 'woda', options: ['woda', 'wada'], answer: 0, item: 'lx.woda' }] };
    const run = runLesson(lesson, d, { noSummary: true });
    await flush(2);
    expect(main().querySelector('[data-tr]')?.textContent).toBe('[во́да]');
    expect(main().querySelector('[data-audio]')).toBeNull();
    byText(main(), 'woda').click();
    await flush(1);
    act(main(), 'next').click();
    await run;
    // P-10b: карточка «на слух» без звука не пропадает — чтение транскрипции засчитывается в неё.
    expect(events.some((e) => e.k === 'rev' && e.card.endsWith('#lis'))).toBe(true);
  });
  it('реакция мира на ошибку: реплика NPC урока перед правилом', async () => {
    const store = memStore(newProgress(T0 - 86_400_000, 'w1'));
    const { d } = deps(store);
    const lesson: Lesson = {
      id: 'test.react',
      kind: 'practice',
      title: { ru: 't' },
      minutes: 1,
      errLine: 'd04.marek.cart.err',
      steps: [{ t: 'choice', q: 'cena?', options: ['цена', 'сено'], answer: 0 }],
    };
    const run = runLesson(lesson, d, { noSummary: true, drill: true });
    await flush(2);
    byText(main(), 'сено').click();
    await flush(1);
    expect(main().querySelector('[data-fb=react]')?.textContent).toContain('Siano? Nie mamy siana.');
    byText(main(), 'цена').click();
    await flush(1);
    act(main(), 'next').click();
    // Повтор ошибки в конце урока: реакция мира только на первую ошибку шага.
    await flush(2);
    byText(main(), 'цена').click();
    await flush(1);
    act(main(), 'next').click();
    await run;
  });
});

describe('итог дня: реплики сна и крючок на завтра', () => {
  it('день 2: «Турникет пустил…» и «Jutro: piszesz sam.»', () => {
    const p = newProgress(T0 - 86_400_000, 'w1');
    const s = summarizeDay(p, deriveContent(content), T0, 'Europe/Warsaw');
    const body = summaryBody({ ...s, empty: false }, content, { sleep: ['d02.kazik.hut.1'], hook: 'd02.ui.hook' });
    const text = body.map((x) => x.textContent).join(' ');
    expect(text).toContain('Турникет пустил');
    expect(text).toContain('Jutro: piszesz sam.');
  });
});
