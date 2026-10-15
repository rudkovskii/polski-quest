// @vitest-environment happy-dom
// W-02: Salad Story. Генератор визита (детерминизм, валидные шаги всех уровней × сиды, новые слова, «мой салат»),
// прогрессия из журнала (переход, прыжок, откат, печати, задание в реале), числа и цены, валидатор данных, гейт шагов,
// экран: визит уровня 1 → слова в огороде, переход на уровень 2, гэг sok/sos и поднос, «Zadanie w realu» и «I jak było?».
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { derive, deriveContent } from '../src/systems/derive';
import type { EventDraft, LogEvent, VisitOrder } from '../src/systems/log';
import { lessonForToday, wolaStepGate, type StepGate } from '../src/systems/pace';
import { plForm, plNumber, plPrice, priceDigits, priceTraps, zlotyForm } from '../src/systems/plNumber';
import { append, newProgress, setSetting, type Progress } from '../src/systems/progress';
import { dayOf } from '../src/systems/time';
import type { Lesson, Step } from '../src/types/content';
import { createOverlay } from '../src/ui/overlay/host';
import { wolaContentFrom } from '../src/wola/content';
import {
  buildVisit,
  levelCap,
  mySalad,
  saladCounter,
  saladState,
  saladTexts,
  showRealTask,
  visitAudioTexts,
  visitTpl,
  askJakBylo,
  visitPassed,
  type SaladState,
  type Visit,
  type VisitInput,
} from '../src/wola/systems/saladVisit';
import { hubCounters, planted, wolaBook, wolaDay, wolaGarden } from '../src/wola/systems/wola';
import { counterText } from '../src/wola/ui/hub';
import type { WolaDeps } from '../src/wola/ui/kit';
import { mySaladSection } from '../src/wola/ui/mySalad';
import { planVisit, runSalad } from '../src/wola/ui/salad';
import { checkWola } from '../tools/lib/content_check';
import { readContentDir, readSchemas } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';
import { fakeAudio, flush, memStore, testBus } from './overlayKit';

const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 15, 10); // 12:00 в Варшаве

const disk = readContentDir(join(ROOT, 'content')).files;
const files = Object.fromEntries([...disk].map(([k, v]) => [`/content/${k}`, v]));
const { content, vocab, salad: data } = wolaContentFrom(files);
const book = wolaBook(vocab);
const dc = deriveContent(content);
const voc = (id: string) => content.vocab.get(id)?.value;
const opts = { dayStartHour: content.tuning.dayStartHour, tz: TZ };
const day0 = dayOf(T0, opts);
const empty: SaladState = saladState([], data, opts, T0);

function input(tpl: number, seed: string, more: Partial<VisitInput> = {}): VisitInput {
  return { data, vocab: voc, state: empty, tpl, mine: mySalad(null, data.menu), planted: new Set(), due: [], seed, day: day0, ...more };
}

function progressOf(drafts: EventDraft[], p0: Progress = newProgress(T0 - DAY, 'wola1')): Progress {
  let p = p0;
  let seq = 0;
  for (const d of drafts) {
    const r = append(p, { deviceId: 'dev001', seq }, d);
    if (!r.ok) throw new Error('append');
    p = r.progress;
    seq = r.dev.seq;
  }
  return p;
}

const order: VisitOrder = { salad: 'm.cezar', size: 'normalna', dressing: 'd.vegan_aioli', osobno: false, place: 'miejsce' };
const visitEv = (ts: number, tpl: number, firstTry: number, more: Partial<Extract<EventDraft, { k: 'visit' }>> = {}): EventDraft => ({
  k: 'visit',
  ts,
  level: tpl,
  tpl,
  cashier: 'kasjerka_ola',
  order,
  score: firstTry,
  firstTry,
  ms: 60_000,
  ...more,
});
const state = (drafts: EventDraft[], now = T0 + 30 * DAY): SaladState => saladState(progressOf(drafts).log.events, data, opts, now);

// ── Проверка шага: схема + смысл (варианты, плитки, пропуск, слово в словаре Wola, кассир — персонаж).

const schemas = readSchemas();
const ajv = new Ajv2020({ allErrors: true, discriminator: true, strict: true, strictRequired: false, strictTypes: false });
for (const [name, s] of schemas) ajv.addSchema(s, name);
const stepSchema = ajv.getSchema('steps.schema.json')!;

function stepIssues(s: Step): string[] {
  const out: string[] = [];
  if (!stepSchema(s)) out.push(`схема: ${JSON.stringify(stepSchema.errors?.slice(0, 2))} ${JSON.stringify(s)}`);
  if (s.item && !content.vocab.has(s.item)) out.push(`нет слова ${s.item}`);
  switch (s.t) {
    case 'say':
      if (!content.characters.has(s.who)) out.push(`кассир ${s.who} не персонаж`);
      break;
    case 'choice':
    case 'listen':
      if (Array.isArray(s.options) && (s.answer >= s.options.length || new Set(s.options).size !== s.options.length)) out.push(`варианты ${JSON.stringify(s.options)}`);
      break;
    case 'pick':
      if (s.answer >= s.items.length || new Set(s.items.map((i) => i.sprite)).size !== s.items.length) out.push(`картинки ${JSON.stringify(s.items)}`);
      break;
    case 'order': {
      const pool = [...s.tiles];
      for (const w of s.answer) {
        const i = pool.indexOf(w);
        if (i < 0) out.push(`плитки ${w}`);
        else pool.splice(i, 1);
      }
      break;
    }
    case 'gap':
      if (s.text.split('___').length !== 2) out.push(`gap без ___: ${s.text}`);
      if (s.options && (!s.options.includes(s.answer) || new Set(s.options).size !== s.options.length)) out.push(`gap варианты ${JSON.stringify(s.options)}`);
      break;
    case 'type':
      if (!s.accept.length) out.push('type без accept');
      break;
    default:
      break;
  }
  return out;
}

describe('Salad Story: генератор визита', () => {
  it('детерминирован по сиду: тот же сид — тот же визит, другой — другой', () => {
    for (const tpl of [1, 4, 7, 10]) {
      const a = buildVisit(input(tpl, 'd1:0'));
      expect(buildVisit(input(tpl, 'd1:0'))).toEqual(a);
    }
    const many = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(buildVisit(input(5, `d${i}:3`)).lesson.steps.map((s) => s.t + (s.t === 'choice' ? s.options[0] : '')))));
    expect(many.size).toBeGreaterThan(3);
  });

  it('все уровни × 50 сидов (новичок и ветеран): шаги валидные, ≤ maxSteps, новых слов ≤ 3, звук из saladTexts', () => {
    const texts = new Set(saladTexts(data, voc).map((t) => t.text));
    const all = new Set([...content.vocab.keys()]);
    const veteran = { ...empty, visits: 40, byTpl: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 5])), lastOrders: [order, order, order, order, order] };
    for (const lv of data.levels.levels) {
      for (let k = 0; k < 50; k++) {
        for (const [st, pl] of [[empty, new Set<string>()], [veteran, all]] as const) {
          const v = buildVisit(input(lv.n, `s${k}`, { state: st, planted: pl, due: k % 3 ? [] : ['lx.kurczak#lis', 'lx.salatka#rec', 'lx.sos#lis'] }));
          const issues = v.lesson.steps.flatMap(stepIssues);
          expect(issues, `уровень ${lv.n}, сид ${k}`).toEqual([]);
          expect(v.lesson.steps.length).toBeLessThanOrEqual(data.levels.visit.maxSteps);
          expect(v.lesson.steps.filter((s) => s.t !== 'say' && s.t !== 'explain' && s.t !== 'shadow').length).toBeGreaterThan(0);
          expect(new Set(v.lesson.steps.map((s) => s.id)).size).toBe(v.lesson.steps.length);
          expect(v.introduces.length).toBeLessThanOrEqual(data.levels.visit.maxNewWords);
          for (const w of v.introduces) expect(lv.words).toContain(w);
          // Шаг со словом без карточки — только из новых слов визита.
          for (const s of v.lesson.steps) if (s.item && !pl.has(s.item)) expect(v.introduces).toContain(s.item);
          for (const t of visitAudioTexts(v)) expect(texts.has(t.text), `нет озвучки «${t.text}» (уровень ${lv.n})`).toBe(true);
          if (v.realTask) expect(texts.has(v.realTask.pl), `нет озвучки задания «${v.realTask.pl}»`).toBe(true);
          expect(v.lesson.id).toBe(`wola.salad.${lv.n}`);
        }
      }
    }
  });

  it('строки для озвучки: без неразвёрнутых подстановок', () => {
    const left = saladTexts(data, voc).filter((t) => /\{[A-Za-z]+\}/.test(t.text));
    expect(left).toEqual([]);
  });

  it('уровень 1: за три визита вводит все 7 слов витрины, пока по 3 (W-04: короче — 2 витрины + sałatka)', () => {
    let pl = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const v = buildVisit(input(1, `x${i}`, { planted: pl, state: { ...empty, visits: i, byTpl: { 1: i } } }));
      expect(v.introduces.length).toBeLessThanOrEqual(3);
      expect(v.lesson.steps.filter((s) => s.t === 'pick').length).toBe(3);
      pl = new Set([...pl, ...v.introduces]);
    }
    expect([...pl].sort()).toEqual([...data.levels.levels[0]!.words].sort());
  });

  it('«мой салат» из настроек: уровни 1–3 вокруг него, по умолчанию — первый салат меню', () => {
    expect(mySalad(null, data.menu)).toEqual({ salad: data.menu.salads[0]!.id, size: 'normalna', dressing: null, osobno: false, bread: null });
    const p = setSetting(newProgress(T0, 'w'), 'wola.salad', { salad: 'm.cobb', size: 'powiekszona', osobno: true }, T0);
    const mine = mySalad(p, data.menu);
    expect(mine).toMatchObject({ salad: 'm.cobb', size: 'powiekszona', osobno: true });
    const l1 = buildVisit(input(1, 'a', { mine }));
    const pickSalad = l1.lesson.steps.find((s) => s.t === 'pick' && s.say === 'sałatka');
    expect(pickSalad && pickSalad.t === 'pick' ? pickSalad.items[pickSalad.answer]!.sprite : '').toBe(data.menu.salads.find((s) => s.id === 'm.cobb')!.sprite);
    const l2 = buildVisit(input(2, 'a', { mine }));
    expect(l2.order).toMatchObject({ salad: 'm.cobb', size: 'powiekszona', osobno: true });
    const ch = l2.lesson.steps.find((s) => s.t === 'choice');
    expect(ch && ch.t === 'choice' ? ch.options[ch.answer] : '').toBe('Poproszę sałatkę Cobb.');
    expect(l2.realTask?.pl).toBe('Poproszę sałatkę Cobb.');
    const l3 = buildVisit(input(3, 'a', { mine }));
    const size = l3.lesson.steps.find((s) => s.t === 'choice' && s.q.includes('Normalna czy'));
    expect(size && size.t === 'choice' ? size.options[size.answer] : '').toBe('Powiększona.');
    // Неизвестный салат в настройке — первый салат меню.
    expect(mySalad(setSetting(newProgress(T0, 'w'), 'wola.salad', { salad: 'm.nie_ma', size: 'normalna' }, T0), data.menu).salad).toBe('m.cezar');
  });

  it('sok/sos: на уровне 4 ответ «Sok osobno.» помечен ph.sok_sos (гэг), слово шага — sos', () => {
    let found: Step | undefined;
    for (let k = 0; k < 40 && !found; k++) found = buildVisit(input(4, `o${k}`, { planted: new Set(['lx.sos']) })).lesson.steps.find((s) => s.t === 'choice' && s.options.includes('Sok osobno.'));
    expect(found).toBeDefined();
    if (found?.t !== 'choice') return;
    const wrong = found.options.indexOf('Sok osobno.');
    expect(found.errorTagByOption?.[String(wrong)]).toBe('ph.sok_sos');
    expect(found.item).toBe('lx.sos');
    expect(data.events.gags.find((g) => g.onTag === 'ph.sok_sos')?.sprite).toBe('wola.gag/2');
  });

  it('события: «To co zwykle?» после трёх одинаковых заказов, ошибка кассира на уровне 7, «nie ma» на 8', () => {
    const usual = { ...empty, lastOrders: [order, order, order] };
    const v5 = buildVisit(input(5, 'z', { state: usual }));
    expect(v5.events).toContain('ev.co_zwykle');
    expect(v5.lesson.steps.some((s) => s.t === 'order')).toBe(false); // заказ заменил «Tak, poproszę.»
    let slip = false;
    for (let k = 0; k < 20; k++) {
      const v7 = buildVisit(input(7, `p${k}`));
      expect(v7.events).toContain('ev.kasjer_pomylka');
      const ch = v7.lesson.steps.find((s) => s.t === 'choice' && s.q.startsWith('Кассир повторяет'));
      expect(ch).toBeDefined();
      if (v7.slip && ch?.t === 'choice') {
        slip = true;
        expect(ch.options[ch.answer]).toMatch(/^Nie .+, tylko .+\.$/);
      }
    }
    expect(slip).toBe(true);
    const v8s = Array.from({ length: 20 }, (_, k) => buildVisit(input(8, `n${k}`)));
    expect(v8s.some((v) => v.events.includes('ev.nie_ma'))).toBe(true);
    for (const v of v8s) expect(v.order.compose?.length).toBe(3);
  });

  it('уровень 9: сумма на слух — верная цифра и ловушка -naście/-dzieści', () => {
    const v = buildVisit(input(9, 'c', { state: { ...empty, byTpl: { 9: 0 } } }));
    const p = v.lesson.steps.find((s) => s.t === 'listen' && s.say.startsWith('Razem'));
    expect(p?.t).toBe('listen');
    if (p?.t !== 'listen' || !Array.isArray(p.options)) return;
    expect(p.options[p.answer]).toBe(priceDigits(v.total!.zl, v.total!.gr));
    expect(p.say).toBe(`Razem ${plPrice(v.total!.zl, v.total!.gr, 'kasa')}.`);
    expect(p.tags).toEqual(['ph.teen_ty']);
  });
});

describe('Salad Story: прогресс из журнала', () => {
  it('переход: 3 зачётных визита подряд на 2 разных днях; незачётный обнуляет серию', () => {
    expect(empty.level).toBe(1);
    expect(state([visitEv(T0, 1, 1), visitEv(T0 + 1000, 1, 0.9), visitEv(T0 + 2000, 1, 1)]).level).toBe(1); // один день
    expect(state([visitEv(T0, 1, 1), visitEv(T0 + 1000, 1, 0.9), visitEv(T0 + DAY, 1, 1)]).level).toBe(2);
    const reset = state([visitEv(T0, 1, 1), visitEv(T0 + DAY, 1, 0.5), visitEv(T0 + DAY + 1, 1, 1), visitEv(T0 + 2 * DAY, 1, 1)]);
    expect(reset.level).toBe(1);
    expect(reset.streak).toBe(2);
    expect(reset.streakDays).toBe(2);
  });

  it('прыжок вперёд: визит уровнем выше на ≥ 90 % засчитывает текущий', () => {
    expect(state([visitEv(T0, 2, 0.95, { level: 1, jump: 1 })]).level).toBe(2);
    expect(state([visitEv(T0, 2, 0.85, { level: 1, jump: 1 })]).level).toBe(1);
    expect(visitTpl({ level: 3, cap: levelCap(data), fallback: false }, true)).toBe(4);
  });

  it('откат: два визита подряд ниже 60 % — следующий по шаблону уровня ниже, уровень не отнимается', () => {
    const up = [visitEv(T0, 1, 1), visitEv(T0 + 1, 1, 1), visitEv(T0 + DAY, 1, 1)];
    const s = state([...up, visitEv(T0 + DAY + 5, 2, 0.4), visitEv(T0 + DAY + 6, 2, 0.5)]);
    expect(s.level).toBe(2);
    expect(s.fallback).toBe(true);
    expect(visitTpl(s)).toBe(1);
    expect(state([...up, visitEv(T0 + DAY + 5, 2, 0.4), visitEv(T0 + DAY + 6, 2, 0.5), visitEv(T0 + DAY + 7, 1, 0.8)]).fallback).toBe(false);
  });

  it('печати, «Spróbowane», задание в реале и «I jak było?»', () => {
    const s = state([
      visitEv(T0, 2, 0.9),
      visitEv(T0 + 1, 2, 0.5, { order: { ...order, salad: 'm.cobb', bread: 'm.paluch_ziarna' } }),
      visitEv(T0 + 2, 2, 1, { task: 2 }),
    ]);
    expect(s.stamps).toBe(2);
    expect(s.tried.salads.sort()).toEqual(['m.cezar', 'm.cobb']);
    expect(s.tried.breads).toEqual(['m.paluch_ziarna']);
    expect(s.openTask).toBe(2);
    expect(showRealTask(data, s, 2, 1)).toBe(false); // ждёт ответа
    const after = state([visitEv(T0 + 2, 2, 1, { task: 2 }), visitEv(T0 + DAY, 2, 1, { real: 'ok' })]);
    expect(after.openTask).toBeNull();
    expect(after.gold).toBe(1);
    expect(after.tasksDone).toEqual([2]);
    expect(showRealTask(data, after, 2, 1)).toBe(false); // получилось — больше не даём
    expect(showRealTask(data, after, 4, 1)).toBe(true);
    expect(showRealTask(data, after, 4, 0.5)).toBe(false);
    expect(showRealTask(data, after, 3, 1)).toBe(false); // у уровня 3 задания нет
  });

  it('подпись на улице: «уровень N» или «новое блюдо дня» с уровня 4', () => {
    expect(saladCounter(empty, data, day0)).toEqual({ text: 'уровень 1' });
    expect(saladCounter({ ...empty, level: 4, tried: { salads: [], dressings: [], breads: [] } }, data, day0)).toEqual({ text: 'новое блюдо дня', due: true });
  });
});

describe('числа и цены по-польски', () => {
  it('plNumber, формы złoty / złote / złotych, plPrice, ловушки', () => {
    expect(plNumber(37)).toBe('trzydzieści siedem');
    expect(plNumber(14)).toBe('czternaście');
    expect(plNumber(40)).toBe('czterdzieści');
    expect(plNumber(52)).toBe('pięćdziesiąt dwa');
    expect(plNumber(120)).toBe('sto dwadzieścia');
    expect([1, 2, 4, 5, 12, 14, 21, 22, 25, 33, 112].map(zlotyForm)).toEqual(['złoty', 'złote', 'złote', 'złotych', 'złotych', 'złotych', 'złotych', 'złote', 'złotych', 'złote', 'złotych']);
    expect(plForm(24)).toBe('few');
    expect(plPrice(43)).toBe('czterdzieści trzy złote');
    expect(plPrice(1)).toBe('jeden złoty');
    expect(plPrice(21)).toBe('dwadzieścia jeden złotych');
    expect(plPrice(37, 20)).toBe('trzydzieści siedem złotych dwadzieścia groszy');
    expect(plPrice(37, 22)).toBe('trzydzieści siedem złotych dwadzieścia dwa grosze');
    expect(plPrice(37, 20, 'kasa')).toBe('trzydzieści siedem dwadzieścia');
    expect(priceDigits(37, 5)).toBe('37,05 zł');
    expect(priceTraps(40)).toContain(14);
    expect(priceTraps(14)).toContain(40);
    expect(priceTraps(37)).toContain(73);
    expect(() => plNumber(1000)).toThrow();
  });
});

describe('валидатор content/wola/salad', () => {
  const wola = new Map([...disk].filter(([f]) => f.startsWith('wola/')));
  const errs = (m: Map<string, unknown>) => checkWola(m, schemas, null, disk.get('errorTags.json')).filter((i) => i.level === 'error').map((i) => i.msg);

  it('текущие данные без ошибок и предупреждений', () => {
    expect(checkWola(wola, schemas, null, disk.get('errorTags.json'))).toEqual([]);
  });

  it('ловит: висячие слова и dressing, нет ответа и реплики, чужую подстановку, неизвестный тег, порядок уровней', () => {
    const menu = structuredClone(wola.get('wola/salad/menu.json')) as typeof data.menu;
    menu.salads[1]!.has.push('lx.nie_ma_slowa');
    menu.salads[2]!.dressing = 'd.nie_ma';
    const levels = structuredClone(wola.get('wola/salad/levels.json')) as typeof data.levels;
    delete levels.answers['osobno.sok'];
    levels.answers['order']!.pl = 'Poproszę {sałatkę}.';
    levels.levels[2]!.n = 7;
    const cashiers = structuredClone(wola.get('wola/salad/cashiers.json')) as typeof data.cashiers;
    delete cashiers.common['q.picie'];
    const events = structuredClone(wola.get('wola/salad/events.json')) as typeof data.events;
    events.gags[0]!.onTag = 'ph.nie_ma';
    const msgs = errs(new Map([...wola, ['wola/salad/menu.json', menu], ['wola/salad/levels.json', levels], ['wola/salad/cashiers.json', cashiers], ['wola/salad/events.json', events]])).join('\n');
    expect(msgs).toContain('lx.nie_ma_slowa');
    expect(msgs).toContain('dressing "d.nie_ma"');
    expect(msgs).toContain('нет ответа "osobno.sok"');
    expect(msgs).toContain('нет реплики "q.picie"');
    expect(msgs).toContain('ph.nie_ma');
    expect(msgs).toContain('уровни идут 1, 2, 3');
    const noFile = new Map(wola);
    noFile.delete('wola/salad/events.json');
    expect(errs(noFile).join('\n')).toContain('нет файла Salad Story');
  });
});

describe('гейт шагов: в Wola клавиатура и «повтори вслух» не закрыты', () => {
  const lesson: Lesson = {
    id: 'wola.salad.6',
    kind: 'practice',
    title: { ru: 't' },
    minutes: 1,
    steps: [
      { t: 'type', prompt: 'x', accept: ['sałatkę'] },
      { t: 'dictation', say: 'sałatka', tr: 'саўа́тка' },
      { t: 'shadow', pl: 'Poproszę sałatkę.', repeat: 1 },
      { t: 'listen', say: 'Co podać?', options: ['Что подать?', 'Что-нибудь ещё?'], answer: 0, show: 'text' },
    ],
  };
  it('основная игра до «дня клавиатуры» режет type/dictation, Wola — нет; без звука listen-перевод остаётся', () => {
    const main: StepGate = { closed: () => true, silent: false };
    expect(lessonForToday(lesson, main).steps!.map((s) => s.t)).toEqual(['listen']);
    expect(lessonForToday(lesson, wolaStepGate(false)).steps!.map((s) => s.t)).toEqual(['type', 'dictation', 'shadow', 'listen']);
    expect(lessonForToday(lesson, wolaStepGate(true)).steps!.map((s) => s.t)).toEqual(['type', 'dictation', 'shadow', 'listen']);
    expect(lessonForToday(lesson, { closed: () => false, silent: true }).steps!.map((s) => s.t)).toEqual(['type', 'dictation', 'shadow']);
  });
});

// ───────────────────────────── экран ─────────────────────────────

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function deps(p: Progress, now: number) {
  const bus = testBus();
  const store = memStore(p);
  store.local = { ...store.local, seq: p.log.events.length };
  let clockNow = now;
  const audio = fakeAudio();
  const w: WolaDeps = {
    overlay: createOverlay(host, { bus }),
    content,
    book,
    store,
    bus,
    audio,
    atlas: null,
    salad: data,
    clock: { now: () => clockNow, mono: () => 0 },
    tz: TZ,
    typeMs: 0,
  };
  return { w, store, audio, setNow: (t: number) => (clockNow = t) };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => host.querySelector<T>(sel);
const click = (sel: string): void => {
  const b = q<HTMLElement>(sel);
  if (!b) throw new Error(`нет ${sel}: ${host.innerHTML.slice(0, 400)}`);
  b.click();
};

/** Пройти визит: ответы знаем из planVisit; `wrong(step)` — где ошибиться (выбор/картинка). */
async function play(v: Visit, wrong: (s: Step) => boolean = () => false): Promise<{ gagSeen: string[]; reacts: string[] }> {
  const steps = v.lesson.steps;
  const failed: number[] = [];
  const gagSeen: string[] = [];
  const reacts: string[] = [];
  for (let guard = 0; guard < 80; guard++) {
    await flush();
    const main = q('.wl-ss-lesson .pq-lesson-main');
    if (!main) return { gagSeen, reacts };
    for (const g of main.querySelectorAll('[data-gag]')) if (!gagSeen.includes(g.getAttribute('data-gag')!)) gagSeen.push(g.getAttribute('data-gag')!);
    const r = main.querySelector('[data-fb="react"]')?.textContent;
    if (r && !reacts.includes(r)) reacts.push(r);
    const next = main.querySelector<HTMLElement>('[data-act="next"]:not([hidden])');
    if (next) {
      next.click();
      continue;
    }
    const dots = [...host.querySelectorAll('.wl-ss-lesson .pq-dot')];
    const cur = dots.findIndex((d) => d.classList.contains('cur'));
    const rep = cur >= steps.length;
    const s = steps[rep ? failed[cur - steps.length]! : cur]!;
    const bad = !rep && wrong(s);
    if (bad) failed.push(cur);
    const opt = (text: string): void => {
      const b = [...main.querySelectorAll<HTMLElement>('[data-opt]')].find((x) => x.textContent?.trim() === text);
      if (!b) throw new Error(`нет варианта «${text}» в шаге ${JSON.stringify(s)}`);
      b.click();
    };
    if (s.t === 'pick') {
      const target = bad ? s.items.find((_, i) => i !== s.answer)! : s.items[s.answer]!;
      click(`.wl-ss-lesson [data-sprite="${target.sprite}"]`);
    } else if (s.t === 'choice' || (s.t === 'listen' && Array.isArray(s.options))) {
      const options = s.options as string[];
      opt(bad ? options.find((_, i) => i !== s.answer)! : options[s.answer]!);
    } else if (s.t === 'gap' && s.options) opt(s.answer);
    else if (s.t === 'gap' || s.t === 'type') {
      const input = main.querySelector<HTMLInputElement>('input')!;
      input.value = s.t === 'gap' ? s.answer : s.accept[0]!;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      main.querySelector<HTMLElement>('[data-act="check"]')!.click();
    } else if (s.t === 'order') {
      for (const w of s.answer) [...main.querySelectorAll<HTMLElement>('.pq-order-pool [data-tile]')].find((b) => b.textContent === w)!.click();
      main.querySelector<HTMLElement>('[data-act="check"]')!.click();
    } else throw new Error(`шаг ${s.t} без решателя`);
  }
  throw new Error('визит не закончился');
}

const visits = (p: Progress): Extract<LogEvent, { k: 'visit' }>[] => p.log.events.filter((e): e is Extract<LogEvent, { k: 'visit' }> => e.k === 'visit');

describe('Salad Story: экран', () => {
  it('визит уровня 1: витрина → поднос, «Smacznego!», Spróbowane, печать; слова визита — intro wola.salad.1 и семена в огороде', async () => {
    const { w, store, audio } = deps(progressOf([]), T0);
    const place = runSalad(w);
    await flush();
    expect(q('[data-lobby]')?.getAttribute('data-lobby')).toBe('1');
    expect(q('[data-mine]')?.getAttribute('data-mine')).toBe('m.cezar');
    const v = planVisit(w);
    expect(v.tpl).toBe(1);
    click('[data-act="order"]');
    await flush();
    expect(q('[data-think]')?.textContent).toContain('Cezar');
    await play(v);
    await flush();
    expect(q('[data-result]')?.getAttribute('data-passed')).toBe('1');
    expect(q('.wl-ss-result .big')?.textContent).toContain('Smacznego!');
    expect(q('[data-sprobowane="m.cezar"]')?.textContent).toContain('новое');
    expect(q('[data-stamp]')?.getAttribute('data-stamp')).toBe('1');
    expect(q('[data-tray="m.cezar"] [data-item="bowl"]')).not.toBeNull();
    const intros = store.progress.log.events.filter((e) => e.k === 'intro');
    expect(intros.map((e) => (e.k === 'intro' ? e.lesson : '')).every((l) => l === 'wola.salad.1')).toBe(true);
    expect(intros.map((e) => (e.k === 'intro' ? e.item : '')).sort()).toEqual([...v.introduces].sort());
    expect(q('[data-planted]')?.getAttribute('data-planted')?.split(',').sort()).toEqual([...v.introduces].sort());
    const [ev] = visits(store.progress);
    expect(ev).toMatchObject({ level: 1, tpl: 1, order: { salad: 'm.cezar' }, firstTry: 1 });
    // Огород: слова визита посажены; итог дня у кровати их считает.
    const dd = derive(store.progress, dc, T0 + 1000, TZ);
    expect([...planted(dd)].sort()).toEqual([...v.introduces].sort());
    expect(wolaGarden(dd, T0 + 1000, content.tuning, {}).plants.map((x) => x.item).sort()).toEqual([...v.introduces].sort());
    const sum = wolaDay(store.progress, dc, T0 + 1000, TZ);
    expect(sum.added.sort()).toEqual([...v.introduces].sort());
    expect(sum.saladVisits).toBe(1);
    // Звук: реплики кассира и слова — через audio.play (без звука вслух в тестах).
    expect(audio.played.some((x) => x.text === 'kurczak' || x.text === 'łosoś')).toBe(true);
    click('[data-act="done"]');
    await flush();
    expect(q('[data-lobby]')).not.toBeNull();
    click('.wl-salad [data-act="close"]');
    await place;
  });

  it('3 визита на 2 днях → уровень 2; назавтра слова визита на удобрение (src order — тоже удобрение)', async () => {
    const r = deps(progressOf([]), T0);
    const run = async (): Promise<void> => {
      const place = runSalad(r.w);
      await flush();
      const v = planVisit(r.w);
      click('[data-act="order"]');
      await play(v);
      await flush();
      click('[data-act="done"]');
      await flush();
      click('.wl-salad [data-act="close"]');
      await place;
    };
    await run();
    r.setNow(T0 + 60_000);
    await run();
    expect(saladState(r.store.progress.log.events, data, opts, T0 + 60_000).level).toBe(1);
    r.setNow(T0 + DAY);
    // Назавтра: слова первого визита ждут удобрения, разминка/шаги визита повторяют их с src: 'order'.
    const d1 = derive(r.store.progress, dc, T0 + DAY, TZ);
    expect(hubCounters(r.store.progress, book, d1, T0 + DAY, content.tuning).due).toBeGreaterThan(0);
    await run();
    const st = saladState(r.store.progress.log.events, data, opts, T0 + DAY);
    expect(st.level).toBe(2);
    expect(r.store.progress.log.events.some((e) => e.k === 'rev' && e.src === 'order')).toBe(true);
    expect(wolaDay(r.store.progress, dc, T0 + DAY + 1000, TZ).fertilized).toBeGreaterThan(0);
    expect(counterText('salad', { dom: 0, due: 0, ripe: 0, jarsDue: 0, salad: saladCounter(st, data, dayOf(T0 + DAY, opts)) })?.text).toBe('уровень 2');
    // Лобби показывает уровень 2.
    const place = runSalad(r.w);
    await flush();
    expect(q('[data-lobby]')?.getAttribute('data-lobby')).toBe('2');
    click('.wl-salad [data-act="close"]');
    await place;
  });

  it('уровень 2: «Zadanie w realu» после зачётного визита; «I jak było?» — только назавтра, под Enter «Później», отметка скромная', async () => {
    const up = [visitEv(T0 - 2 * DAY, 1, 1), visitEv(T0 - 2 * DAY + 1, 1, 1), visitEv(T0 - DAY, 1, 1)];
    const r = deps(progressOf(up), T0);
    const place = runSalad(r.w);
    await flush();
    const v = planVisit(r.w);
    expect(v.tpl).toBe(2);
    click('[data-act="order"]');
    await play(v);
    await flush();
    expect(q('[data-real-task]')?.getAttribute('data-real-task')).toBe('Poproszę sałatkę Cezar.');
    expect(visits(r.store.progress).at(-1)?.task).toBe(2);
    click('[data-act="done"]');
    await flush();
    // Тот же игровой день: «I jak było?» не спрашивают (W-04: раньше через две минуты после задания).
    r.setNow(T0 + 120_000);
    const same = planVisit(r.w);
    click('[data-act="order"]');
    await flush();
    expect(q('[data-jak-bylo]')).toBeNull();
    await play(same);
    await flush();
    expect(visits(r.store.progress).at(-1)?.real).toBeUndefined();
    click('[data-act="done"]');
    await flush();
    r.setNow(T0 + DAY);
    const v2 = planVisit(r.w);
    click('[data-act="order"]');
    await flush();
    expect(q('[data-jak-bylo]')).not.toBeNull();
    expect(r.audio.played.at(-1)?.text).toBe('I jak było?');
    // Фокус (и Enter) — на нейтральной «Później», не на «Udało się».
    expect(document.activeElement?.getAttribute('data-act')).toBe('real-later');
    expect(q('[data-act="real-ok"]')?.hasAttribute('data-primary')).toBe(false);
    click('[data-act="real-ok"]');
    await play(v2);
    await flush();
    expect(visits(r.store.progress).at(-1)?.real).toBe('ok');
    expect(q('[data-real-task]')).toBeNull(); // задание получилось — больше не даём
    click('[data-act="done"]');
    await flush();
    // Скромная отметка вместо золотой звезды.
    expect(q('[data-real-done]')?.textContent).toBe('✓ заказано в реале: 1');
    expect(q('.wl-ss-stamps .gold')).toBeNull();
    click('.wl-salad [data-act="close"]');
    await place;
  });

  it('уровень 4: «Sok osobno.» → гэг (стакан сока, переспрос кассира) поверх правила; на подносе сок; гэг в журнале', async () => {
    // Уровень 4 прыжками: 1 → 2 → 3 → 4.
    const ups = [visitEv(T0 - 3 * DAY, 2, 1, { level: 1, jump: 1 }), visitEv(T0 - 2 * DAY, 3, 1, { level: 2, jump: 1 }), visitEv(T0 - DAY, 4, 1, { level: 3, jump: 1 })];
    let r = deps(progressOf(ups), T0);
    let v = planVisit(r.w);
    for (let k = 1; k < 40 && !v.lesson.steps.some((s) => s.t === 'choice' && s.options.includes('Sok osobno.')); k++) {
      r = deps(progressOf(ups), T0 + k * DAY);
      v = planVisit(r.w);
    }
    expect(v.tpl).toBe(4);
    const place = runSalad(r.w);
    await flush();
    click('[data-act="order"]');
    const seen = await play(v, (s) => s.t === 'choice' && s.options.includes('Sok osobno.'));
    expect(seen.gagSeen).toContain('gag.sok_sos');
    expect(seen.reacts.some((t) => t.includes('Sok… osobno?'))).toBe(true);
    await flush();
    expect(visits(r.store.progress).at(-1)?.gags).toEqual(['gag.sok_sos']);
    expect(q('[data-tray] [data-item="sok"]')).not.toBeNull();
    expect(q('[data-tray] [data-item="sos"]')).toBeNull();
    expect(q('[data-wpadki]')?.textContent).toContain('сок вместо соуса');
    // Ошибка — первая попытка в SRS (rev g0 по sos, если карточка есть) и тег в итоге урока.
    const lessonEv = r.store.progress.log.events.filter((e) => e.k === 'lesson').at(-1);
    expect(lessonEv && lessonEv.k === 'lesson' ? lessonEv.tags?.['ph.sok_sos'] : 0).toBe(1);
    click('[data-act="done"]');
    await flush();
    click('.wl-salad [data-act="close"]');
    await place;
    // Следующий визит: разминка на пару sos/sok, пока гэг «горит».
    const st = saladState(r.store.progress.log.events, data, opts, r.w.clock.now());
    expect(st.lastGags).toEqual(['gag.sok_sos']);
    const warm = buildVisit(input(10, 'w', { state: st, planted: new Set(['lx.sos']) })).lesson.steps.find((s) => s.t === 'listen' && s.say === 'sos');
    expect(warm).toBeDefined();
  });

  it('настройки: «Мой салат» — один выбор меняет заказ уровней 1–3', () => {
    let p = newProgress(T0, 'w');
    const put = (k: 'wola.salad', v: Progress['settings'][string]['value']) => {
      p = setSetting(p, k, v as never, T0);
    };
    const box = mySaladSection(data.menu, { put: put as never, progress: () => p });
    host.append(box);
    const sel = box.querySelector<HTMLSelectElement>('[data-setting="wola.salad.salad"]')!;
    expect(sel.value).toBe('m.cezar');
    sel.value = 'm.losos_quinoa';
    sel.dispatchEvent(new Event('change'));
    expect(mySalad(p, data.menu).salad).toBe('m.losos_quinoa');
    const osobno = box.querySelector<HTMLSelectElement>('[data-setting="wola.salad.osobno"]')!;
    osobno.value = '1';
    osobno.dispatchEvent(new Event('change'));
    expect(mySalad(p, data.menu)).toMatchObject({ salad: 'm.losos_quinoa', osobno: true });
    expect(box.querySelector('[data-my-salad]')?.textContent).toContain('Poproszę sałatkę Łosoś Quinoa');
    expect(buildVisit(input(2, 'q', { mine: mySalad(p, data.menu) })).order.salad).toBe('m.losos_quinoa');
  });
});

// ───────────────────────────── W-04 ─────────────────────────────

const graded = (v: Visit): Step[] => v.lesson.steps.filter((x) => !['say', 'explain', 'shadow'].includes(x.t));
const tagsOf = (x: Step): string[] => [...((x as { tags?: string[] }).tags ?? []), ...Object.values((x as { errorTagByOption?: Record<string, string> }).errorTagByOption ?? {})];

describe('W-04: лестница Salad Story', () => {
  it('зачёт визита: одна ошибка не ломает (2 из 3, 3 из 4, 4 из 5), две из трёх — ломают; старые события — от 2/3', () => {
    const pass = data.levels.pass;
    expect(visitPassed(2 / 3, 3, pass)).toBe(true);
    expect(visitPassed(3 / 4, 4, pass)).toBe(true);
    expect(visitPassed(4 / 5, 5, pass)).toBe(true);
    expect(visitPassed(5 / 6, 6, pass)).toBe(true);
    expect(visitPassed(1 / 3, 3, pass)).toBe(false);
    expect(visitPassed(3 / 5, 5, pass)).toBe(false);
    expect(visitPassed(8 / 10, 10, pass)).toBe(true);
    expect(visitPassed(7 / 10, 10, pass)).toBe(false);
    expect(visitPassed(0.667, undefined, pass)).toBe(true);
    expect(visitPassed(0.5, undefined, pass)).toBe(false);
    expect(visitPassed(1, 0, pass)).toBe(true);
  });

  it('серия уровня 2 не обнуляется одной ошибкой: три визита по одной ошибке на двух днях → уровень 3', () => {
    const up = [visitEv(T0 - 3 * DAY, 1, 1), visitEv(T0 - 3 * DAY + 1, 1, 1), visitEv(T0 - 2 * DAY, 1, 1)];
    const one = (ts: number) => visitEv(ts, 2, 4 / 5, { answers: 5 });
    expect(saladState(progressOf([...up, one(T0 - DAY)]).log.events, data, opts, T0).streak).toBe(1);
    const st = saladState(progressOf([...up, one(T0 - DAY), one(T0 - DAY + 1000), one(T0)]).log.events, data, opts, T0);
    expect(st.level).toBe(3);
    // Марина: старое событие 67 % из трёх шагов — тоже зачёт, серия жива.
    const old = saladState(progressOf([...up, visitEv(T0 - DAY, 2, 1), visitEv(T0, 2, 0.667)]).log.events, data, opts, T0);
    expect(old.streak).toBe(2);
  });

  it('уровень 1 короче уровня 2; на уровне 2 не меньше 5 оцениваемых шагов и разные формулировки кассира', () => {
    const greet = new Set<string>();
    const more = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const st = { ...empty, visits: i, byTpl: { 1: 3, 2: i } };
      const l1 = buildVisit(input(1, `s${i}`, { state: st }));
      const l2 = buildVisit(input(2, `s${i}`, { state: st }));
      expect(l1.lesson.steps.length).toBeLessThan(l2.lesson.steps.length);
      expect(graded(l1).length).toBeLessThan(graded(l2).length);
      expect(graded(l2).length).toBeGreaterThanOrEqual(5);
      // Первый шаг уровня 2 — «Что это значит?» по приветствию кассира, перевод — вариант ответа.
      const first = l2.lesson.steps[0]!;
      expect(first.t).toBe('listen');
      if (first.t === 'listen') greet.add(first.say);
      for (const x of l2.lesson.steps) if (x.t === 'listen' && /jeszcze|poza tym/i.test(x.say)) more.add(x.say);
    }
    expect(greet.size).toBeGreaterThanOrEqual(3);
    expect(more.size).toBeGreaterThanOrEqual(2);
  });

  it('гэги: у каждого уровня есть смешная развязка; на уровнях 1–2 у каждой оцениваемой ошибки свой гэг', () => {
    const gagTags = new Set(data.events.gags.map((g) => g.onTag));
    for (const lv of data.levels.levels) {
      const tags = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const st = { ...empty, visits: i, byTpl: { [lv.n]: i }, lastOrders: [] };
        const v = buildVisit(input(lv.n, `g${i}`, { state: st, planted: new Set(data.levels.levels.flatMap((l) => l.words)) }));
        for (const x of v.lesson.steps) for (const t of tagsOf(x)) tags.add(t);
        if (lv.n <= 2) for (const x of graded(v)) if (!(x.id ?? '').includes('warmup')) expect(tagsOf(x).some((t) => gagTags.has(t)), `${lv.n}: ${JSON.stringify(x)}`).toBe(true);
      }
      expect([...tags].some((t) => gagTags.has(t)), `уровень ${lv.n}: ${[...tags].join(',')}`).toBe(true);
    }
    // У каждого гэга есть название для «Wpadki».
    for (const g of data.events.gags) expect(g.title?.ru, g.id).toBeTruthy();
  });

  it('«I jak było?» — только в визит следующего дня', () => {
    const st = saladState(progressOf([visitEv(T0, 2, 1, { task: 2 })]).log.events, data, opts, T0);
    expect(st.openTask).toBe(2);
    expect(askJakBylo(st, dayOf(T0 + 60_000, opts))).toBe(false);
    expect(askJakBylo(st, dayOf(T0 + DAY, opts))).toBe(true);
  });

  it('экран: перевод в пузыре кассира спрятан во время «Что это значит?», появляется после ответа; ошибка — гэг, «Wpadki» с названием', async () => {
    const up = [visitEv(T0 - 2 * DAY, 1, 1), visitEv(T0 - 2 * DAY + 1, 1, 1), visitEv(T0 - DAY, 1, 1)];
    const r = deps(progressOf(up), T0);
    const place = runSalad(r.w);
    await flush();
    const v = planVisit(r.w);
    expect(v.tpl).toBe(2);
    click('[data-act="order"]');
    await flush();
    // Первый шаг — приветствие-вопрос: польский в пузыре виден, русский спрятан.
    const say = q('[data-say]')!;
    expect(say.hidden).toBe(false);
    expect(say.querySelector<HTMLElement>('[data-say-ru]')?.hidden).toBe(true);
    const first = v.lesson.steps[0]!;
    const right = first.t === 'listen' && Array.isArray(first.options) ? first.options[first.answer]! : '';
    [...host.querySelectorAll<HTMLElement>('.wl-ss-lesson [data-opt]')].find((b) => b.textContent?.trim() === right)!.click();
    await flush();
    expect(say.querySelector<HTMLElement>('[data-say-ru]')?.hidden).toBe(false);
    // Дальше: ошибка в «Czy coś jeszcze?» (ответ «Tak, poproszę.») — гэг «две миски», визит всё равно зачтён.
    const rest = await play({ ...v, lesson: { ...v.lesson, steps: v.lesson.steps } }, (x) => x.t === 'choice' && x.options.includes('Tak, poproszę.'));
    expect(rest.reacts.some((t) => t.includes('dwie miski'))).toBe(true);
    await flush();
    const ev = visits(r.store.progress).at(-1)!;
    expect(ev.answers).toBeGreaterThanOrEqual(5);
    expect(ev.firstTry).toBeLessThan(1);
    expect(q('[data-result]')?.getAttribute('data-passed')).toBe('1');
    expect(q('[data-wpadki]')?.textContent).toBe('Wpadki: два салата вместо одного');
    expect(q('[data-tray] [data-item="bowl2"]')).not.toBeNull();
    click('[data-act="done"]');
    await flush();
    click('.wl-salad [data-act="close"]');
    await place;
  });
});
