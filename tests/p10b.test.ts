// @vitest-environment happy-dom
// P-10b (ПОЛИРОВКА §5 пп. 5–10): один конец дня, правдивые счётчики, «Умею» по сценам, новые слова дней 2–3,
// режим без звука в обходе и турникете, перевод под вариантами (в dialogP07.test.ts), день 1 короче.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '../src/systems/content';
import { lessonVariant, condCtx } from '../src/systems/conditions';
import { derive, deriveContent } from '../src/systems/derive';
import { dayLines } from '../src/systems/pace';
import { newProgress, setFlag, setSetting, type Progress } from '../src/systems/progress';
import { summarizeDay } from '../src/systems/session';
import type { EventDraft } from '../src/systems/log';
import type { Lesson } from '../src/types/content';
import { summaryBody } from '../src/ui/daySummary';
import { runLesson, type LessonDeps } from '../src/ui/lesson';
import { runObchod, type ObchodDeps } from '../src/ui/obchod';
import { createOverlay } from '../src/ui/overlay/host';
import { passportModel, openPassport, STAMP_FIRST } from '../src/ui/passport';
import { act, buttons, fakeAudio, flush, memStore, testBus } from './overlayKit';

const content = getContent();
const T0 = Date.UTC(2026, 9, 15, 10);
const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

const progress = (events: EventDraft[], p0: Progress = newProgress(T0 - 5 * DAY, 'w1')): Progress => {
  const s = memStore(p0);
  for (const e of events) s.append(e);
  return s.progress;
};
const lesson = (id: string): Lesson => content.lessons.get(id)!.value;
const text = (): string => host.textContent ?? '';

describe('один конец дня: итог в хатке, одни цифры', () => {
  it('альтанка на działce не открывает итог; ui:screen:open summary не второй конец дня', () => {
    const dz = content.maps.get('ch01.dzialka')!.value;
    for (const o of dz.objects) if (o.type === 'trigger') expect(JSON.stringify(o.do)).not.toContain('summary');
    const chatka = content.maps.get('ch01.chatka')!.value;
    expect(chatka.objects.some((o) => o.type === 'trigger' && o.id === 'poslanie')).toBe(true);
  });

  it('день 1 в общем итоге: «Umiem: przywitać się» и крючок «Jutro: list.», без повтора «Idziemy spać»', () => {
    const p = progress([
      { k: 'intro', ts: T0, item: 'lx.dzien_dobry', lesson: 'ch01.intro', ok: ['rec'] },
      { k: 'lesson', ts: T0 + 1000, lesson: 'obchod.lx.dzien_dobry', score: 1, firstTry: 1, ms: 20_000, passed: true, answers: 1 },
      { k: 'intro', ts: T0 + 2000, item: 'lx.dziekuje', lesson: 'ch01.d01.brzechwa', ok: ['rec'] },
      { k: 'intro', ts: T0 + 3000, item: 'lx.prosze', lesson: 'ch01.d01.brzechwa', ok: ['rec'] },
      { k: 'intro', ts: T0 + 4000, item: 'lx.czesc', lesson: 'ch01.d01.brzechwa', ok: ['rec'] },
    ]);
    const s = summarizeDay(p, deriveContent(content), T0 + 60_000, TZ);
    const dl = dayLines(content.director.days, 1)!;
    expect(dl.sleep).toEqual([]);
    host.append(...summaryBody(s, content, { sleep: dl.sleep!, umiem: dl.umiem!, hook: dl.hook! }, 9 * 60_000));
    const stat = (k: string): string => host.querySelector(`[data-stat="${k}"] b`)?.textContent ?? '';
    expect(stat('watered')).toBe('1');
    expect(stat('planted')).toBe('4');
    expect(stat('active')).toBe('9 мин');
    expect(host.querySelector('[data-line="d01.ui.summary.umiem"]')?.textContent).toContain('Umiem: przywitać się');
    expect(host.querySelector('[data-hook="d01.ui.hook"]')?.textContent).toContain('Jutro: list.');
    expect(host.querySelector('.pq-bobr')).toBeNull(); // Казик уже сказал «Idziemy spać» у хатки
    expect(text()).not.toContain('Повторено');
    expect(text()).not.toContain('Złoty');
  });

  it('«Полито» = растения, совпадает с «!» на грядке перед обходом; «Завтра к поливу» — растения, не карточки', () => {
    const p = progress([
      { k: 'intro', ts: T0 - DAY, item: 'lx.kawa', lesson: 'ch01.s01', ok: ['rec', 'lis'] },
      { k: 'intro', ts: T0 - DAY, item: 'lx.woda', lesson: 'ch01.s01', ok: ['rec', 'lis'] },
      { k: 'rev', ts: T0, card: 'lx.kawa#rec', g: 2, ms: 4000, src: 'obchod' },
      { k: 'rev', ts: T0 + 1, card: 'lx.woda#rec', g: 2, ms: 4000, src: 'obchod' },
    ]);
    const s = summarizeDay(p, deriveContent(content), T0 + 60_000, TZ);
    expect(s.plants).toBe(2);
    expect(s.tomorrowPlants).toBeLessThanOrEqual(2); // у каждого слова rec и lis, но растений два
    expect(s.tomorrow).toBeGreaterThanOrEqual(s.tomorrowPlants);
  });
});

describe('паспорт: печать базара и «Умею» по сценам', () => {
  it('после первой печати — «Bazar», а не Praga; Praga ждёт главу', async () => {
    let p = newProgress(T0, 'w1');
    p = setFlag(p, 'beat.d01.bazar', T0);
    p = setFlag(p, STAMP_FIRST, T0);
    const d = derive(p, deriveContent(content), T0);
    const m = passportModel(content, p, d);
    expect(m.first).toMatchObject({ stamped: true });
    const run = openPassport(createOverlay(host, { bus: testBus() }), m);
    await flush(1);
    const first = host.querySelector('[data-page="first"]')!;
    expect(first.querySelector('[data-seal="bazar"]')?.textContent).toBe('Bazar');
    expect(first.textContent).toContain('Bazar Różyckiego · №1');
    expect(host.querySelector('[data-biome="praga"]')?.getAttribute('data-stamped')).toBe('false');
    // «Умею»: после базара засчитано «здороваюсь», остальное — по сценам.
    expect(host.querySelector('[data-cando="ch01.cd0"]')?.getAttribute('data-done')).toBe('true');
    expect(host.querySelector('[data-role="cando-title"]')?.textContent).toBe('Умею · 1 из 6');
    act(host, 'close').click();
    await run;
  });

  it('can-do засчитывается по своим сценам до босса (критерии в module.json)', () => {
    const p = progress([
      { k: 'diag', ts: T0 - DAY, results: { R1: { n: 2, ok: 2 }, R8: { n: 1, ok: 0 }, R9: { n: 1, ok: 1 } } },
      { k: 'lesson', ts: T0 - DAY, lesson: 'ch01.s00', score: 1, firstTry: 1, ms: 1000, passed: true, answers: 12 },
      { k: 'lesson', ts: T0, lesson: 'ch01.s08', score: 1, firstTry: 1, ms: 1000, passed: true, answers: 10 },
      { k: 'lesson', ts: T0, lesson: 'ch01.s12', score: 1, firstTry: 1, ms: 1000, passed: true, answers: 10 },
    ]);
    const d = derive(p, deriveContent(content), T0 + 1000);
    const done = Object.fromEntries(passportModel(content, p, d).canDo.map((c) => [c.id, c.done]));
    // cd2: ударение (R1 зелёный), слоги (s08 сдан), оглушение (R9 зелёный) — без босса.
    expect(done).toMatchObject({ 'ch01.cd0': false, 'ch01.cd1': false, 'ch01.cd2': true, 'ch01.cd3': true, 'ch01.cd4': true, 'ch01.cd5': false });
    for (const c of content.modules.get('ch01')!.module.canDo!) expect(c.when, c.id).toBeDefined();
  });
});

describe('новые слова дней 2 и 3', () => {
  const dlg = (id: string) => content.dialogues.get(id)!.value;
  it('день 2: после турникета на перроне — 3 вывески метро (сцена ≤ 3 новых слов, у каждого tr)', () => {
    const peron = dlg('dlg.ch01.peron');
    expect(Object.values(peron.nodes).some((n) => (n as { lesson?: string }).lesson === 'ch01.d02.znaki')).toBe(true);
    const l = lesson('ch01.d02.znaki');
    expect(l.introduces).toEqual(['lx.wejscie', 'lx.wyjscie', 'lx.peron']);
    for (const it of l.introduces!) {
      expect(content.vocab.get(it)!.value.srs).toBe(true);
      expect(content.vocab.get(it)!.value.tr).toBeTruthy();
      expect(l.steps!.some((s) => s.item === it && s.t !== 'say')).toBe(true); // у слова есть проверка
    }
    expect(l.kind).toBe('practice'); // играет перрон, режиссёр не зовёт его отдельной сценой
  });

  it('день 3: киоск «Kawa czy woda?» с тремя словами идёт и при зелёном R1 (разминка), и при красном (полностью)', () => {
    const l = lesson('ch01.s01');
    expect(l.introduces).toEqual(['lx.woda', 'lx.kawa', 'lx.herbata']);
    const at = (status: 'green' | 'yellow' | 'red') => {
      let p = newProgress(T0 - 3 * DAY, 'w1');
      p = progress(
        [
          { k: 'diag', ts: T0 - DAY, results: { R1: status === 'green' ? { n: 2, ok: 2 } : status === 'yellow' ? { n: 2, ok: 1 } : { n: 2, ok: 0 } } },
          { k: 'lesson', ts: T0 - DAY, lesson: 'ch01.s00', score: 1, firstTry: 1, ms: 1000, passed: true, answers: 12 },
          { k: 'seg', ts: T0 - 2 * DAY, seg: 'sleep' },
          { k: 'seg', ts: T0 - DAY, seg: 'sleep' },
        ],
        setFlag(p, 'beat.first_day_done', T0 - 2 * DAY),
      );
      const d = derive(p, deriveContent(content), T0);
      return lessonVariant(l, condCtx(content, d, p.world, T0));
    };
    expect(at('green')).toBe('short');
    expect(at('red')).toBe('full');
    // Разминка учит все три слова: у каждого есть шаг в short.
    const short = l.short!.steps.map((i) => l.steps![i]!);
    for (const it of l.introduces!) expect(short.some((s) => s.item === it), it).toBe(true);
    expect(content.dialogues.get('dlg.ch01.s01')!.value.if).not.toMatchObject({ all: expect.arrayContaining([{ not: { cluster: { id: 'R1', status: 'green' } } }]) });
  });

  it('не больше 3 новых слов в одной сцене дней 1–3', () => {
    for (const id of ['ch01.intro', 'ch01.d01.brzechwa', 'ch01.d02.znaki', 'ch01.s01']) expect((lesson(id).introduces ?? []).length, id).toBeLessThanOrEqual(3);
  });
});

describe('без звука: обход и турникет', () => {
  function obchodDeps(store: ReturnType<typeof memStore>, now: number): ObchodDeps {
    const bus = testBus();
    return { overlay: createOverlay(host, { bus }), content, store, audio: fakeAudio(), bus, clock: { now: () => now, mono: () => 0 }, tz: TZ, random: () => 0.2, coarse: true, typeMs: 0 };
  }

  it('карточка на слух в обходе — чтение по транскрипции, без ▶; ответ пишется в lis; режим туда-обратно ничего не теряет', async () => {
    let p = newProgress(T0 - 3 * DAY, 'w1');
    p = setSetting(p, 'sound.mode', 'off', T0 - DAY);
    const store = memStore(p);
    store.append({ k: 'intro', ts: T0 - 2 * DAY, item: 'lx.woda', lesson: 'ch01.s01', ok: ['rec', 'lis'] });
    // rec уже полит вчера и ждёт неделю — сегодня к поливу только lis.
    store.append({ k: 'rev', ts: T0 - DAY, card: 'lx.woda#rec', g: 3, ms: 2000, src: 'obchod' });
    const d0 = derive(store.progress, deriveContent(content), T0, TZ);
    expect(Object.keys(d0.cards)).toContain('lx.woda#lis');
    const run = runObchod(obchodDeps(store, T0), { mode: 'day' });
    await flush(2);
    const main = host.querySelector('.pq-lesson-main') as HTMLElement;
    expect(main.querySelector('[data-tr]')?.textContent).toBe('[во́да]');
    expect(host.querySelector('[data-audio]')).toBeNull();
    buttons(main).find((b) => b.textContent === 'woda')!.click();
    await flush(1);
    act(main, 'next').click();
    await flush(2);
    act(host, 'ok').click();
    expect(await run).toMatchObject({ answered: 1 });
    expect(store.progress.log.events.some((e) => e.k === 'rev' && e.card === 'lx.woda#lis')).toBe(true);
    // Туда и обратно: карточки на месте.
    const back = setSetting(setSetting(store.progress, 'sound.mode', 'on', T0 + 1), 'sound.mode', 'off', T0 + 2);
    expect(Object.keys(derive(back, deriveContent(content), T0 + 3, TZ).cards).sort()).toEqual(Object.keys(derive(store.progress, deriveContent(content), T0 + 3, TZ).cards).sort());
  });

  it('турникет без звука: нет «Pip!/Hyk!», отклик текстом; ▶ под ответом нет', async () => {
    let p = newProgress(T0 - DAY, 'w1');
    p = setSetting(p, 'sound.mode', 'off', T0 - DAY);
    const store = memStore(p);
    const bus = testBus();
    const deps: LessonDeps = { overlay: createOverlay(host, { bus }), content, store, audio: fakeAudio(), clock: { now: () => T0, mono: () => 0 }, coarse: true, typeMs: 0, random: () => 0.2 };
    const s00 = lesson('ch01.s00');
    const one: Lesson = { ...s00, steps: [s00.steps!.find((s) => s.t === 'listen')!] };
    const run = runLesson(one, deps);
    await flush(2);
    const main = host.querySelector('.pq-lesson-main') as HTMLElement;
    const step = one.steps![0]!;
    const wrong = (step as { options: string[]; answer: number }).options.find((_, i) => i !== (step as { answer: number }).answer)!;
    buttons(main).find((b) => b.textContent === wrong)!.click();
    await flush(1);
    expect(main.textContent).not.toContain('Hyk!');
    expect(main.textContent).not.toContain('Pip!');
    expect(main.querySelector('[data-audio]')).toBeNull();
    expect(main.querySelector('[data-fb="rule"]')).not.toBeNull();
    act(main, 'next').click();
    await run;
  });
});

describe('день 1 короче: дубли реплик убраны, сюжет на месте', () => {
  it('нет «пирогов», повтора «читать/грызть», «дерево есть, слов нет» и второго «спать»', () => {
    const beats = content.director.beats.filter((b) => b.slot === 'day1');
    const said = JSON.stringify(beats) + JSON.stringify(content.dialogues.get('dlg.ch01.d01_wisla')!.value);
    for (const id of ['d01.kazik.street.3', 'd01.kazik.wisla.2', 'd01.kazik.hut.2']) expect(said).not.toContain(`"${id}"`);
    // Сюжетные биты на месте: порядок не менялся.
    expect(beats.map((b) => b.id)).toEqual([
      'd01.dworzec', 'd01.fotobudka', 'd01.peron', 'd01.walizka', 'd01.ulica', 'd01.tablica', 'd01.wejscie', 'd01.bazar', 'd01.wisla',
      'd01.dzialka', 'd01.podlewanie', 'd01.wiatr', 'd01.kapelusz', 'd01.brzechwa', 'd01.sadzenie', 'd01.wieczor', 'd01.sen',
    ]);
    expect(said).toContain('"d01.kazik.wisla.3"');
    expect(said).toContain('"d01.kazik.hut.1"');
  });
});
