// @vitest-environment happy-dom
// DaySummary (I-12, ТЗ §5.9) и обход/экспресс в оверлее (§4.5, §5.5): цифры итога из журнала, «Dobranoc»
// пишет session + seg sleep, «ещё 3 минуты», пустой день, напоминание о ссылке; полив карточек через
// runLesson drill с src obchod/express, seg water/express/more3, мини-итог, карточка растения без полива.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventDraft, LogEvent } from '../src/systems/log';
import { append, newProgress, setFlag, type Progress } from '../src/systems/progress';
import { runDaySummary, type DaySummaryDeps } from '../src/ui/daySummary';
import { cardStep, runObchod, type ObchodDeps } from '../src/ui/obchod';
import { createOverlay } from '../src/ui/overlay/host';
import { runSettings } from '../src/ui/settings';
import { parseFile } from '../src/systems/exportImport';
import { getSetting } from '../src/systems/progress';
import { deriveContent } from '../src/systems/derive';
import { retrievalMsOf, summarizeDay } from '../src/systems/session';
import { act, buttons, fakeAudio, fixture, flush, memStore, testBus } from './overlayKit';

const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 5, 8); // 10:00 в Варшаве
const content = fixture();

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function progress(drafts: EventDraft[]): Progress {
  let p = newProgress(T0 - 2 * DAY, 'w1');
  let seq = 0;
  for (const d of drafts) {
    const r = append(p, { deviceId: 'dev001', seq }, d);
    if (!r.ok) throw new Error('append');
    p = r.progress;
    seq = r.dev.seq;
  }
  return p;
}
const intro = (item: string, ts: number): EventDraft => ({ k: 'intro', ts, item, lesson: 'demo.s01', ok: ['rec', 'lis'] });

function storeOf(p: Progress) {
  const s = memStore(p);
  s.local = { ...s.local, seq: p.log.events.length };
  return s;
}

const panelText = (): string => host.querySelector('.pq-wood')?.textContent ?? '';
const stat = (key: string): string => host.querySelector(`[data-stat="${key}"] b`)?.textContent ?? '';

describe('DaySummary', () => {
  function deps(p: Progress, now: number, extra: Partial<DaySummaryDeps> = {}) {
    const bus = testBus();
    const events: LogEvent[] = [];
    const store = storeOf(p);
    let sessions = 0;
    const d: DaySummaryDeps = {
      overlay: createOverlay(host, { bus }),
      content,
      store,
      bus,
      clock: { now: () => now, mono: () => 0 },
      tz: TZ,
      activeMs: () => 7 * 60_000,
      sessionStart: () => now - 3_600_000,
      onSession: () => sessions++,
      onEvent: (e) => events.push(e),
      ...extra,
    };
    return { d, bus, events, store, sessions: () => sessions };
  }

  it('цифры дня и «Dobranoc» → session(day) + seg sleep', async () => {
    const now = T0 + DAY + 3_600_000;
    const p = progress([
      intro('lx.kawa', T0),
      intro('lx.stol', T0),
      { k: 'rev', ts: T0 + DAY, card: 'lx.kawa#rec', g: 2, ms: 90_000, src: 'obchod' },
      { k: 'rev', ts: T0 + DAY + 1, card: 'lx.stol#lis', g: 0, ms: 30_000, src: 'obchod' },
      intro('lx.maly', T0 + DAY + 2),
      { k: 'seg', ts: T0 + DAY + 3, seg: 'water' },
    ]);
    const { d, events, store, sessions } = deps(p, now);
    const done = runDaySummary(d);
    await flush(1);
    // P-10b: «Полито» = растений (kawa и stół), как на кнопке Obchód; «Повторено из нужного» и złoty убраны.
    expect(stat('watered')).toBe('2');
    expect(host.querySelector('[data-stat="coverage"]')).toBeNull();
    expect(host.querySelector('[data-stat="zloty"]')).toBeNull();
    expect(stat('grew')).toBe('1'); // kawa: маленький росток (1 день) → крепкий (3 дня) — на грядке видно
    expect(panelText()).toContain('kawa: росток → крепкий росток');
    expect(stat('planted')).toBe('1');
    expect(stat('retrieval')).toBe('2 мин');
    expect(stat('active')).toBe('7 мин');
    expect(panelText()).toContain('mały');
    act(host, 'sleep').click();
    expect(await done).toBe('sleep');
    expect(events.map((e) => e.k)).toEqual(['session', 'seg']);
    expect(events[0]).toMatchObject({ k: 'session', mode: 'day', ms: 7 * 60_000, retrievalMs: 120_000 });
    expect(events[1]).toMatchObject({ k: 'seg', seg: 'sleep' });
    expect(store.progress.log.events.at(-1)).toMatchObject({ k: 'seg', seg: 'sleep' });
    expect(sessions()).toBe(1);
    expect(host.querySelector('.pq-sleep')).toBeNull();
  });

  it('пустой день: «Сегодня ещё ничего» и кнопка экспресса', async () => {
    const { d, events } = deps(progress([intro('lx.kawa', T0)]), T0 + DAY);
    const done = runDaySummary(d);
    await flush(1);
    expect(host.querySelector('[data-empty]')?.textContent).toContain('Сегодня ещё ничего');
    act(host, 'express').click();
    expect(await done).toBe('express');
    expect(events).toEqual([]);
  });

  it('«ещё 3 минуты повторений» — ссылкой, итог закрывается без сна', async () => {
    const p = progress([intro('lx.kawa', T0), { k: 'rev', ts: T0 + DAY, card: 'lx.kawa#rec', g: 2, ms: 2000, src: 'obchod' }]);
    const { d, events } = deps(p, T0 + DAY + 1000);
    const done = runDaySummary(d);
    await flush(1);
    expect(act(host, 'more3').className).toContain('ghost');
    act(host, 'more3').click();
    expect(await done).toBe('more3');
    expect(events).toEqual([]);
  });

  it('Esc закрывает без событий', async () => {
    const { d, bus, events } = deps(progress([]), T0);
    const done = runDaySummary(d);
    await flush(1);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(await done).toBe('close');
    expect(events).toEqual([]);
  });

  it('напоминание «Сохрани ссылку», пока флаг link.saved не стоит', async () => {
    const opened: string[] = [];
    const a = deps(progress([]), T0, { hasLink: () => true });
    a.bus.on('ui:screen:open', ({ screen }) => opened.push(screen));
    const done = runDaySummary(a.d);
    await flush(1);
    act(host, 'link').click();
    expect(await done).toBe('close');
    expect(opened).toEqual(['link']);

    const b = deps(setFlag(progress([]), 'link.saved', T0), T0, { hasLink: () => true });
    void runDaySummary(b.d);
    await flush(1);
    expect(host.querySelector('[data-remind]')).toBeNull();
  });
});

describe('обход и экспресс в оверлее', () => {
  function deps(p: Progress, now: () => number, mono: () => number = () => 0) {
    const bus = testBus();
    const events: LogEvent[] = [];
    const changed: string[][] = [];
    bus.on('progress:changed', ({ kinds }) => changed.push(kinds));
    const store = storeOf(p);
    const d: ObchodDeps = {
      overlay: createOverlay(host, { bus }),
      content,
      store,
      audio: fakeAudio(),
      bus,
      clock: { now, mono },
      tz: TZ,
      random: () => 0.2,
      coarse: true,
      typeMs: 0,
      onEvent: (e) => events.push(e),
    };
    return { d, events, store, changed, bus };
  }

  /** Ответить на шаг полива верно: кнопка с переводом (rec) или с польским словом (lis). */
  async function answerRight(): Promise<void> {
    await flush(1);
    const main = host.querySelector('.pq-lesson-main') as HTMLElement;
    const card = host.querySelector('.pq-lesson')?.getAttribute('data-lesson') ?? '';
    const item = card.replace(/^(obchod|express)\./, '').split('#')[0]!;
    const v = content.vocab.get(item)!.value;
    const b = buttons(main).find((x) => x.textContent?.trim() === v.ru || x.textContent?.trim() === v.pl);
    if (!b) throw new Error(`нет ответа для ${card}: ${buttons(main).map((x) => x.textContent).join(' | ')}`);
    b.click();
    await flush(1);
    act(main, 'next').click();
    await flush(2);
  }

  it('шаг полива по типу карточки: rec — выбор перевода, lis — на слух, pro — набрать', () => {
    expect(cardStep('lx.kawa#rec', content)).toMatchObject({ t: 'choice', item: 'lx.kawa' });
    expect(cardStep('lx.kawa#lis', content)).toMatchObject({ t: 'listen', say: 'kawa', item: 'lx.kawa' });
    expect(cardStep('lx.kawa#pro', content)).toMatchObject({ t: 'type', accept: ['kawa'], item: 'lx.kawa' });
    expect(cardStep('mp.x#pair', content)).toBeNull();
  });

  it('раунд: по карточке на растение, rev src obchod, seg water, «ещё раунд» нет — всё полито', async () => {
    const p = progress([intro('lx.kawa', T0), intro('lx.stol', T0 + 1)]);
    const { d, events, changed } = deps(p, () => T0 + DAY);
    const done = runObchod(d, { mode: 'day' });
    await answerRight();
    await answerRight();
    await flush(1);
    expect(host.querySelector('[data-panel="Obchód"]')).not.toBeNull();
    expect(host.querySelector('[data-act="more"]')).toBeNull(); // братья ждут завтра — полива больше нет
    act(host, 'ok').click();
    const r = await done;
    expect(r).toMatchObject({ answered: 2, correct: 2, empty: false, left: 0 });
    const revs = events.filter((e) => e.k === 'rev');
    expect(revs).toHaveLength(2);
    expect(revs.every((e) => e.k === 'rev' && e.src === 'obchod' && e.g === 2)).toBe(true);
    expect(events.at(-1)).toMatchObject({ k: 'seg', seg: 'water' });
    expect(events.some((e) => e.k === 'lesson')).toBe(false);
    expect(changed.length).toBeGreaterThanOrEqual(3);
    expect(host.querySelector('.pq-obchod-layer')).toBeNull();
  });

  it('тап по растению без полива: карточка растения, без событий', async () => {
    const p = progress([intro('lx.kawa', T0)]);
    const { d, events } = deps(p, () => T0 + 3_600_000);
    const done = runObchod(d, { mode: 'day', fromItem: 'lx.kawa' });
    await flush(1);
    expect(panelText()).toContain('kawa');
    expect(panelText()).toContain('росток');
    act(host, 'ok').click();
    expect(await done).toMatchObject({ answered: 0, empty: true });
    expect(events).toEqual([]);
  });

  it('нет due: «Всё полито»', async () => {
    const { d } = deps(progress([intro('lx.kawa', T0)]), () => T0 + 3_600_000);
    const done = runObchod(d, { mode: 'day' });
    await flush(1);
    expect(panelText()).toContain('Всё полито');
    act(host, 'ok').click();
    expect((await done).empty).toBe(true);
  });

  it('отмена до первого ответа — ни rev, ни seg', async () => {
    const { d, events, bus } = deps(progress([intro('lx.kawa', T0)]), () => T0 + DAY);
    const done = runObchod(d, { mode: 'day' });
    await flush(1);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(await done).toMatchObject({ answered: 0, empty: true });
    expect(events).toEqual([]);
  });

  it('экспресс: потолок 3 минуты, rev src express, seg express, session express, мини-итог в 2 строки', async () => {
    const p = progress([intro('lx.kawa', T0), intro('lx.stol', T0 + 1), intro('lx.maly', T0 + 2)]);
    let mono = 0;
    const { d, events } = deps(p, () => T0 + DAY, () => mono);
    const done = runObchod(d, { mode: 'express' });
    mono = 3.5 * 60_000; // первая карточка заняла 3.5 минуты
    await answerRight();
    await flush(1);
    expect(host.querySelectorAll('.pq-obchod .line2')).toHaveLength(2);
    act(host, 'ok').click();
    expect(await done).toMatchObject({ answered: 1, correct: 1 });
    expect(events.map((e) => e.k)).toEqual(['rev', 'seg', 'session']);
    expect(events[0]).toMatchObject({ src: 'express' });
    expect(events[1]).toMatchObject({ seg: 'express' });
    expect(events[2]).toMatchObject({ k: 'session', mode: 'express', ms: 210_000, retrievalMs: expect.any(Number) });
  });

  it('«ещё 3 минуты» пишет seg more3', async () => {
    const { d, events } = deps(progress([intro('lx.kawa', T0)]), () => T0 + DAY);
    const done = runObchod(d, { mode: 'express', more3: true });
    await answerRight();
    await flush(1);
    act(host, 'ok').click();
    await done;
    expect(events.find((e) => e.k === 'seg')).toMatchObject({ seg: 'more3' });
  });

  it('P-10b: обход сон не предлагает (спать — только в хатке), даже после 15 активных минут раунд идёт до конца', async () => {
    const p = progress([intro('lx.kawa', T0), intro('lx.stol', T0 + 1)]);
    const { d } = deps(p, () => T0 + DAY);
    const run = runObchod({ ...d, activeMs: () => 16 * 60_000 }, { mode: 'day' });
    await answerRight();
    await answerRight();
    await flush(1);
    expect(host.querySelector('[data-act="sleep"]')).toBeNull();
    act(host, 'ok').click();
    const r = await run;
    expect(r).toMatchObject({ answered: 2 });
    expect(r).not.toHaveProperty('sleep');
  });
});

describe('Settings и копия', () => {
  it('настройка пишется LWW-ключом и шлёт progress:changed settings', async () => {
    const bus = testBus();
    const kinds: string[][] = [];
    bus.on('progress:changed', ({ kinds: k }) => kinds.push(k));
    const store = storeOf(progress([]));
    const done = runSettings({ overlay: createOverlay(host, { bus }), store, bus, clock: { now: () => T0 }, build: 'test' });
    await flush(1);
    (host.querySelector('[data-setting="controls.dpad"][data-value="never"]') as HTMLButtonElement).click();
    (host.querySelector('[data-setting="keyboard.mode"][data-value="strip"]') as HTMLButtonElement).click();
    act(host, 'new-plus').click();
    expect(getSetting(store.progress, 'controls.dpad')).toBe('never');
    expect(getSetting(store.progress, 'keyboard.mode')).toBe('strip');
    expect(getSetting(store.progress, 'newItemsPerDay')).toBe(9);
    expect(store.progress.settings['controls.dpad']).toEqual({ value: 'never', at: T0 });
    expect(kinds.every((k) => k.includes('settings'))).toBe(true);
    expect(host.querySelector('[data-setting="controls.dpad"][data-value="never"]')?.getAttribute('aria-pressed')).toBe('true');
    act(host, 'close').click();
    await done;
  });

  it('экспорт файла pq-save и импорт: слияние того же мира, другой мир — «Заменить?» с автоэкспортом', async () => {
    const bus = testBus();
    const saved: { name: string; text: string }[] = [];
    const mine = progress([intro('lx.kawa', T0)]);
    const store = storeOf(mine);
    let pickText: string | null = null;
    const done = runSettings({
      overlay: createOverlay(host, { bus }),
      store,
      bus,
      clock: { now: () => T0 },
      saveFile: async (name, text) => {
        saved.push({ name, text });
        return 'downloaded';
      },
      pickFile: async () => pickText,
    });
    await flush(1);
    act(host, 'export').click();
    await flush(2);
    expect(saved[0]!.name).toBe('polski-quest-2026-10-05.json');
    const parsed = parseFile(saved[0]!.text);
    expect(parsed).toMatchObject({ kind: 'pq-save', status: 'ok' });

    // Тот же мир с ещё одним событием другого устройства → «Слить».
    let other = mine;
    const r = append(other, { deviceId: 'dev002', seq: 0 }, intro('lx.stol', T0 + 5));
    if (r.ok) other = r.progress;
    pickText = JSON.stringify({ format: 'pq-save', v: 1, exportedAt: T0, progress: other });
    act(host, 'import').click();
    await flush(2);
    (host.querySelector('.pq-confirm [data-act="yes"]') as HTMLButtonElement).click();
    await flush(2);
    expect(store.progress.log.events).toHaveLength(2);
    expect(host.querySelector('[data-msg]')?.textContent).toContain('Слито');

    // Другой мир → подтверждение замены, перед заменой — копия текущего.
    pickText = JSON.stringify({ format: 'pq-save', v: 1, exportedAt: T0, progress: newProgress(T0, 'w2') });
    act(host, 'import').click();
    await flush(2);
    expect(host.querySelector('.pq-confirm')?.textContent).toContain('другой мир');
    (host.querySelector('.pq-confirm [data-act="yes"]') as HTMLButtonElement).click();
    await flush(3);
    expect(saved).toHaveLength(2);
    expect(store.progress.worldId).toBe('w2');

    // Тренажёр и мусор — понятные сообщения.
    pickText = JSON.stringify({ v: 3, trainer: { cards: [] } });
    act(host, 'import').click();
    await flush(2);
    expect(host.querySelector('[data-msg]')?.textContent).toContain('тренажёра');
    act(host, 'close').click();
    await done;
  });
});

describe('P-01: итог дня по сценарию плейтеста Андрея', () => {
  // Андрей: вступление → полил «Dzień dobry» по просьбе Казика (карточка ещё не due) → 9 минут диагностики →
  // начал урок шипящих (ответ по паре на слух записан из сцены) → итог дня. Было: «Полито 0 из 1», «0 мин».
  it('ранний полив засчитан («Полито 1 из 1»), минуты = вступление + полив + диагностика, ответы сцены не полив', async () => {
    const day = T0 + DAY; // 10:00 следующего дня от T0
    const p = progress([
      { k: 'lesson', ts: day, lesson: 'ch01.intro', score: 1, firstTry: 1, ms: 60_000, passed: true, answers: 1 },
      intro('lx.kawa', day),
    ]);
    const bus = testBus();
    const events: LogEvent[] = [];
    const store = storeOf(p);
    let mono = 0;
    const clock = { now: () => day + 120_000, mono: () => mono };
    const obchodDeps: ObchodDeps = { overlay: createOverlay(host, { bus }), content, store, audio: fakeAudio(), bus, clock, tz: TZ, random: () => 0.2, coarse: true, typeMs: 0, onEvent: (e) => events.push(e) };
    // F2: одна грядка практикой.
    const run = runObchod(obchodDeps, { mode: 'day', fromItem: 'lx.kawa', practice: true });
    await flush(1);
    mono = 20_000;
    buttons(host.querySelector('.pq-lesson-main')!).find((b) => b.textContent === 'кофе')!.click();
    await flush(1);
    act(host, 'next').click();
    expect(await run).toMatchObject({ answered: 1, correct: 1 });
    expect(events.filter((e) => e.k === 'rev')).toEqual([]); // SRS не тронут: карточка не due
    expect(events.at(-1)).toMatchObject({ k: 'lesson', lesson: 'obchod.lx.kawa', firstTry: 1, answers: 1, ms: 20_000 });
    // Диагностика 9 минут и ответ по паре в сцене (src scene: время уже внутри урока).
    store.append({ k: 'lesson', ts: day + 15 * 60_000, lesson: 'demo.s01', score: 0.55, firstTry: 0.55, ms: 9 * 60_000, passed: false, answers: 34 });
    store.append({ k: 'rev', ts: day + 16 * 60_000, card: 'mp.lata_lata#pair', g: 0, ms: 4_000, src: 'scene' });

    const sum = runDaySummary({ overlay: createOverlay(host, { bus }), content, store, bus, clock: { now: () => day + 20 * 60_000, mono: () => 0 }, tz: TZ });
    await flush(1);
    expect(stat('watered')).toBe('1'); // P-10b: одно растение (ранний полив «kawa»)
    expect(stat('retrieval')).toBe('10 мин'); // 1 + 0,3 + 9
    expect(stat('planted')).toBe('1');
    act(host, 'sleep').click();
    await sum;
    expect(store.progress.log.events.find((e) => e.k === 'session')).toMatchObject({ retrievalMs: 60_000 + 20_000 + 9 * 60_000 });
  });

  it('полив = только обход и экспресс: вечер и сцены в «полито» не входят (плейтест Марины: «Всё полито» и «5 из 15»)', () => {
    const now = T0 + DAY + 3_600_000;
    const p = progress([
      intro('lx.kawa', T0),
      { k: 'rev', ts: T0 + DAY, card: 'lx.kawa#rec', g: 2, ms: 5_000, src: 'obchod' },
      { k: 'rev', ts: T0 + DAY + 1, card: 'lx.kawa#lis', g: 0, ms: 5_000, src: 'scene' },
      { k: 'rev', ts: T0 + DAY + 2, card: 'mp.lata_lata#pair', g: 0, ms: 5_000, src: 'phonetic' },
    ]);
    const s = summarizeDay(p, deriveContent(content), now, TZ);
    expect(s).toMatchObject({ answered: 1, watered: 1 });
    // Минуты: обход 5 с + вечер 5 с; ответ сцены без события lesson (урок прерван) не считается.
    expect(s.retrievalMs).toBe(10_000);
    expect(retrievalMsOf(p.log.events, T0 + DAY, now)).toBe(10_000);
  });

  it('меньше полуминуты вспоминания — «1 мин», а не «0 мин»', async () => {
    const p = progress([intro('lx.kawa', T0), { k: 'rev', ts: T0 + DAY, card: 'lx.kawa#rec', g: 2, ms: 8_000, src: 'obchod' }]);
    const bus = testBus();
    void runDaySummary({ overlay: createOverlay(host, { bus }), content, store: storeOf(p), bus, clock: { now: () => T0 + DAY + 1000, mono: () => 0 }, tz: TZ });
    await flush(1);
    expect(stat('retrieval')).toBe('1 мин');
  });
});
