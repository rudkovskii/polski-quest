// Salad Story (W-02, ../ВОЛЯ.md п. 8, research/12_salad_story.md): чистые функции места.
//   • saladState — уровень лестницы, серия, откат, «Spróbowane», печати, задание «в реале» — из событий `visit`;
//   • buildVisit — визит по шаблону уровня и сиду: слоты levels.json → обычные шаги уроков (lesson `wola.salad.<N>`),
//     заказ-облачко, кассир, реплики кассира над шагами, новые слова визита (≤ maxNewWords);
//   • mySalad — «мой обычный заказ» из настройки `wola.salad` (по умолчанию первый салат меню);
//   • saladTexts — все польские строки, которые визит может озвучить (tools/build_audio.py, тест генератора).
// Время и случайность приходят параметрами (seed), ничего не пишет.
import type { EventOf, LogEvent, VisitOrder } from '../../systems/log';
import { fnv1a } from '../../systems/hash';
import { plPrice, priceDigits, priceTraps } from '../../systems/plNumber';
import { getSetting, type Progress } from '../../systems/progress';
import { dayOf, type Day, type TimeOpts } from '../../systems/time';
import type {
  Cashier,
  CashierLine,
  Lesson,
  SaladCashiers,
  SaladDish,
  SaladEvents,
  SaladLevel,
  SaladLevels,
  SaladMenu,
  SaladQuestion,
  SaladSlot,
  SaladText,
  Step,
  VocabEntry,
} from '../../types/content';

export interface SaladData {
  menu: SaladMenu;
  cashiers: SaladCashiers;
  levels: SaladLevels;
  events: SaladEvents;
}

export const SALAD_LESSON_PREFIX = 'wola.salad.';
export const saladLesson = (tpl: number): string => `${SALAD_LESSON_PREFIX}${tpl}`;
/** Уровни с карточкой «Zadanie w realu» берутся из levels.json (`realTask`). */

// ── Случайность по сиду.

export function rngOf(seed: string): () => number {
  let a = fnv1a(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickOne = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length]!;
function shuffle<T>(r: () => number, xs: readonly T[]): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const cap = (s: string): string => (s ? s[0]!.toLocaleUpperCase('pl') + s.slice(1) : s);
const noDot = (s: string): string => s.replace(/[.!?…]+$/u, '');

// ── Уровни.

export function levelOf(data: SaladData, n: number): SaladLevel | undefined {
  return data.levels.levels.find((l) => l.n === n);
}

/** Последний играбельный уровень: ready подряд с 1-го (locked обрывает лестницу). */
export function levelCap(data: SaladData): number {
  let n = 0;
  for (let i = 1; i <= 10; i++) {
    const l = levelOf(data, i);
    if (!l || l.status !== 'ready') break;
    n = i;
  }
  return Math.max(1, n);
}

// ── «Мой салат» (настройка `wola.salad`).

export interface MyOrder {
  salad: string;
  size: VisitOrder['size'];
  /** null — dressing салата по умолчанию. */
  dressing: string | null;
  osobno: boolean;
  bread: string | null;
}

/** «Мой обычный заказ»: настройка или первый салат меню, обычная порция, его dressing, без палочки. */
export function mySalad(p: Progress | null, menu: SaladMenu): MyOrder {
  const s = p ? getSetting(p, 'wola.salad') : null;
  const first = menu.salads[0]!;
  const salad = s && menu.salads.some((x) => x.id === s.salad) ? s.salad : first.id;
  const size = s?.size === 'powiekszona' ? 'powiekszona' : 'normalna';
  const dressing = s?.dressing && menu.dressings.some((d) => d.id === s.dressing) ? s.dressing : null;
  const bread = s?.bread && menu.breads.some((b) => b.id === s.bread) ? s.bread : null;
  return { salad, size, dressing, osobno: !!s?.osobno, bread };
}

// ── Состояние из журнала.

export interface SaladState {
  /** Текущий уровень лестницы (1…cap). */
  level: number;
  cap: number;
  /** Зачётных визитов подряд на текущем уровне и сколько в них разных дней. */
  streak: number;
  streakDays: number;
  /** Визитов на текущем уровне по его шаблону (для `once`, `first2`). */
  atLevel: number;
  /** Визитов по шаблону уровня (любого): tpl → число. */
  byTpl: Record<number, number>;
  visits: number;
  /** Визитов сегодня. */
  today: number;
  /** Два визита подряд ниже порога: следующий — по шаблону уровня ниже. */
  fallback: boolean;
  /** «Spróbowane»: салаты, dressingi, палочки, которые уже заказывали. */
  tried: { salads: string[]; dressings: string[]; breads: string[] };
  /** Печати карточки постоянного клиента: зачётные визиты (по `stampsPerCard` на карточку). */
  stamps: number;
  /** Золотые печати: «Udało się» на «I jak było?». */
  gold: number;
  /** Задание «в реале» ждёт ответа «I jak było?»: уровень задания. */
  openTask: number | null;
  /** Уровни, чьё задание уже было выдано. */
  tasksGiven: number[];
  /** Уровни, чьё задание получилось в реале («Udało się»). */
  tasksDone: number[];
  /** Гэги, которые уже случались (альбом «Wpadki»). */
  wpadki: string[];
  /** Последние заказы, свежие в конце (для «To co zwykle?»). */
  lastOrders: VisitOrder[];
  /** Гэги последнего визита (разминка ставит пару sok/sos, пока гэг «горит»). */
  lastGags: string[];
  last?: EventOf<'visit'>;
}

export function visitsOf(events: readonly LogEvent[]): EventOf<'visit'>[] {
  return events.filter((e): e is EventOf<'visit'> => e.k === 'visit');
}

export function saladState(events: readonly LogEvent[], data: SaladData, opts: TimeOpts = {}, now?: number): SaladState {
  const pass = data.levels.pass;
  const capN = levelCap(data);
  const visits = visitsOf(events);
  let level = 1;
  let streak: Day[] = [];
  let low = 0;
  let atLevel = 0;
  const byTpl: Record<number, number> = {};
  const tried = { salads: new Set<string>(), dressings: new Set<string>(), breads: new Set<string>() };
  let stamps = 0;
  let gold = 0;
  let openTask: number | null = null;
  const tasksGiven = new Set<number>();
  const tasksDone = new Set<number>();
  const wpadki = new Set<string>();
  const today = now !== undefined ? dayOf(now, opts) : null;
  let todayN = 0;
  for (const v of visits) {
    const day = dayOf(v.ts, opts);
    if (day === today) todayN++;
    byTpl[v.tpl] = (byTpl[v.tpl] ?? 0) + 1;
    if (v.real) {
      if (v.real === 'ok') {
        gold++;
        if (openTask !== null) tasksDone.add(openTask);
      }
      openTask = null;
    }
    if (v.task) {
      openTask = v.task;
      tasksGiven.add(v.task);
    }
    tried.salads.add(v.order.salad);
    if (v.order.dressing) tried.dressings.add(v.order.dressing);
    if (v.order.bread) tried.breads.add(v.order.bread);
    for (const g of v.gags ?? []) wpadki.add(g);
    const ok = v.firstTry >= pass.firstTry;
    if (ok) stamps++;
    if (v.jump && v.tpl === level + 1) {
      // «Spróbuj wyżej»: визит уровнем выше на ≥ jumpFirstTry засчитывает текущий уровень.
      if (v.firstTry >= pass.jumpFirstTry && level < capN) {
        level++;
        streak = [];
        atLevel = 0;
      }
    } else if (v.tpl === level) {
      atLevel++;
      streak = ok ? [...streak, day] : [];
      if (streak.length >= pass.streak && new Set(streak).size >= pass.minDays && level < capN) {
        level++;
        streak = [];
        atLevel = 0;
      }
    }
    low = v.firstTry < pass.fallbackBelow ? low + 1 : 0;
  }
  const last = visits.at(-1);
  return {
    level,
    cap: capN,
    streak: streak.length,
    streakDays: new Set(streak).size,
    atLevel,
    byTpl,
    visits: visits.length,
    today: todayN,
    fallback: low >= 2 && level > 1,
    tried: { salads: [...tried.salads], dressings: [...tried.dressings], breads: [...tried.breads] },
    stamps,
    gold,
    openTask,
    tasksGiven: [...tasksGiven].sort((a, b) => a - b),
    tasksDone: [...tasksDone].sort((a, b) => a - b),
    wpadki: [...wpadki],
    lastOrders: visits.slice(-5).map((v) => v.order),
    lastGags: last?.gags ?? [],
    ...(last ? { last } : {}),
  };
}

/** Уровень шаблона следующего визита: откат на уровень ниже, прыжок на уровень выше, иначе текущий. */
export function visitTpl(s: Pick<SaladState, 'level' | 'cap' | 'fallback'>, jump = false): number {
  if (jump) return Math.min(s.cap, s.level + 1);
  return s.fallback ? Math.max(1, s.level - 1) : s.level;
}

/**
 * Карточка «Zadanie w realu» после визита: у уровня шаблона есть задание (2, 4, 7, 9), визит зачётный, прошлое задание не
 * ждёт ответа и это задание ещё не получилось в реале.
 */
export function showRealTask(data: SaladData, s: Pick<SaladState, 'openTask' | 'tasksDone'>, tpl: number, firstTry: number): boolean {
  const lv = levelOf(data, tpl);
  return !!lv?.realTask && firstTry >= data.levels.pass.firstTry && s.openTask === null && !s.tasksDone.includes(tpl);
}

/** Можно ли «Spróbuj wyżej»: есть следующий играбельный уровень. */
export const canJump = (s: Pick<SaladState, 'level' | 'cap'>): boolean => s.level < s.cap;

/** Блюдо дня на доске: открытый (не сезонный) салат по сиду дня. */
export function danieDnia(data: SaladData, level: number, day: Day): SaladDish {
  const open = data.menu.salads.filter((s) => !s.season && s.from <= Math.max(level, 2));
  return pickOne(rngOf(`danie:${day}`), open);
}

/** Подпись над дверью на улице: «уровень N» или «новое блюдо дня» (с уровня 4, блюдо ещё не пробовали). */
export function saladCounter(s: Pick<SaladState, 'level' | 'tried'>, data: SaladData, day: Day): { text: string; due?: boolean } {
  const d = danieDnia(data, s.level, day);
  if (s.level >= 4 && !s.tried.salads.includes(d.id)) return { text: 'новое блюдо дня', due: true };
  return { text: `уровень ${s.level}` };
}

// ── Визит.

export interface VisitInput {
  data: SaladData;
  vocab(id: string): VocabEntry | undefined;
  state: SaladState;
  /** Уровень шаблона (visitTpl). */
  tpl: number;
  jump?: boolean;
  mine: MyOrder;
  /** Слова, у которых уже есть карточки. */
  planted: ReadonlySet<string>;
  /** Карточки к повтору сегодня (`lx.x#lis`), для разминки. */
  due: readonly string[];
  /** Слово знакомо (карточка rec с интервалом ≥ 3): у вопроса нет шага «понять на слух» в режиме `new`. */
  familiar?(id: string): boolean;
  seed: string;
  day: Day;
}

/** Реплика кассира над шагом (пузырь в сцене, озвучка). */
export interface BubbleLine {
  pl: string;
  ru: string;
}

export interface Visit {
  lesson: Lesson & { steps: [Step, ...Step[]] };
  level: number;
  tpl: number;
  jump: boolean;
  cashier: Cashier;
  order: VisitOrder;
  /** Новые слова визита (intro в конце). */
  introduces: string[];
  /** id шага → реплика кассира, которую сцена показывает пузырём перед шагом. */
  bubbles: Record<string, BubbleLine>;
  /** Сработавшие события (ev.*). */
  events: string[];
  /** Ошибка кассира в повторе заказа (уровень 7+). */
  slip?: 'size' | 'mix';
  /** Сумма к оплате (уровень 9+). */
  total?: { zl: number; gr: number };
  /** Задание «в реале» уровня (заполнено). */
  realTask?: { pl: string; ru: string };
  /** Доска меню: блюдо дня, сезон. */
  board: { danie: SaladDish; season?: { pl: string; ru: string } };
  /** Подстановки (гэги, итог). */
  vars: Record<string, string>;
}

type Vars = Record<string, string>;
const fill = (t: string, v: Vars): string => t.replace(/\{([A-Za-z]+)\}/g, (m, k: string) => v[k] ?? m);

/** Реплика кассира по ключу: его ask, иначе common; варианты с minLevel ≤ уровня. */
export function cashierLines(data: SaladData, c: Cashier | null, key: string, tpl: number): CashierLine[] {
  const own = c?.ask[key]?.filter((l) => (l.minLevel ?? 1) <= tpl) ?? [];
  if (own.length) return own;
  return (data.cashiers.common[key] ?? []).filter((l) => (l.minLevel ?? 1) <= tpl);
}

const SIZE_RU: Record<VisitOrder['size'], string> = { normalna: 'обычная', powiekszona: 'увеличенная' };

interface Ctx {
  in: VisitInput;
  r: () => number;
  level: SaladLevel;
  tpl: number;
  cashier: Cashier;
  order: VisitOrder & { without?: string };
  vars: Vars;
  steps: Step[];
  bubbles: Record<string, BubbleLine>;
  events: string[];
  intro: Set<string>;
  skipOrder: boolean;
  first: boolean;
  atTpl: number;
  slip?: 'size' | 'mix';
  total?: { zl: number; gr: number };
  seq: number;
}

function salad(data: SaladData, id: string): SaladDish {
  return data.menu.salads.find((s) => s.id === id) ?? data.menu.salads[0]!;
}

/** Слова, которые учат (dressing с lx): из них выбирается «другой» dressing. */
const learnableDressings = (data: SaladData) => data.menu.dressings.filter((d) => d.lx);

function orderVars(data: SaladData, o: VisitOrder & { without?: string }, vocab: VisitInput['vocab']): Vars {
  const s = salad(data, o.salad);
  const d = data.menu.dressings.find((x) => x.id === (o.dressing ?? s.dressing));
  const size = data.menu.sizes.find((x) => x.id === o.size)!;
  const bread = data.menu.breads.find((b) => b.id === o.bread) ?? data.menu.breads[0]!;
  const drink = data.menu.drinks.find((b) => b.id === o.drink) ?? data.menu.drinks[0]!;
  const bez = o.without ? data.menu.ingredients.find((i) => i.lx === o.without) : undefined;
  const bezRu = o.without ? (vocab(o.without)?.ru ?? '') : '';
  return {
    salad: s.name,
    saladRu: s.ru,
    dressing: d?.pl ?? '',
    Dressing: cap(d?.pl ?? ''),
    dressingRu: d?.ru ?? '',
    size: size.pl,
    sizeAcc: size.acc,
    sizeRu: SIZE_RU[o.size],
    bread: bread.short ?? bread.pl,
    Bread: cap(bread.short ?? bread.pl),
    breadRu: bread.ru,
    drink: drink.acc ?? drink.pl,
    Drink: cap(drink.acc ?? drink.pl),
    DrinkNom: cap(drink.pl),
    drinkRu: drink.ru,
    bez: bez?.gen ?? 'cebuli',
    bezRu: bez ? genRu(bezRu) : 'лука',
    mix: o.osobno ? 'osobno' : 'wymieszany',
    mixRu: o.osobno ? 'отдельно' : 'перемешана',
  };
}

/** «бекон» → «бекона» для «без …» в русской подписи (только слова меню, которые бывают «без»). */
function genRu(ru: string): string {
  const m: Record<string, string> = { бекон: 'бекона', гренки: 'гренок', курица: 'курицы', сыр: 'сыра', лосось: 'лосося', огурец: 'огурца' };
  return m[ru] ?? ru;
}

/** Заказ визита (облачко над Димой): уровни 1–3 — «мой салат», дальше разнообразие по сиду. */
export function planOrder(inp: VisitInput, r: () => number, tpl: number): VisitOrder & { without?: string } {
  const { data, mine } = inp;
  const m = data.menu;
  const open = m.salads.filter((s) => s.from <= tpl && (!s.season || tpl >= m.season.from));
  let saladId = mine.salad;
  let size = mine.size;
  let dressing = mine.dressing ?? salad(data, mine.salad).dressing;
  let osobno = mine.osobno;
  let bread: string | undefined = mine.bread ?? undefined;
  let drink: string | undefined;
  let place: VisitOrder['place'] = 'miejsce';
  if (tpl >= 4) {
    if (r() >= 0.5) {
      // Просроченное слово в огороде тянет салат, где оно есть (research §6.4).
      const dueItems = new Set(inp.due.map((c) => c.slice(0, c.lastIndexOf('#'))));
      const withDue = open.filter((s) => s.has.some((h) => dueItems.has(h)));
      const danie = danieDnia(data, inp.state.level, inp.day);
      const pool = withDue.length ? withDue : open.some((s) => s.id === danie.id) && !inp.state.tried.salads.includes(danie.id) ? [danie] : open;
      saladId = pickOne(r, pool).id;
    }
    size = r() < 0.5 ? 'normalna' : 'powiekszona';
    const def = salad(data, saladId).dressing;
    const other = learnableDressings(data).filter((d) => d.id !== def);
    dressing = r() < 0.5 && other.length ? pickOne(r, other).id : def;
    osobno = r() < (tpl === 4 ? 0.7 : 0.5);
    if (tpl >= 5) {
      bread = r() < 0.5 ? pickOne(r, m.breads.filter((b) => b.from <= tpl)).id : undefined;
      drink = r() < 0.5 ? pickOne(r, m.drinks.filter((b) => b.from <= tpl)).id : undefined;
      place = r() < 0.75 ? 'miejsce' : 'wynos';
    }
  }
  const s = salad(data, saladId);
  const without = tpl >= 7 ? (['lx.bekon', 'lx.grzanki'].find((x) => s.has.includes(x)) ?? undefined) : undefined;
  return {
    salad: saladId,
    size,
    dressing,
    osobno,
    ...(bread ? { bread } : {}),
    ...(drink ? { drink } : {}),
    place,
    ...(without ? { without } : {}),
  };
}

export function buildVisit(inp: VisitInput): Visit {
  const { data } = inp;
  const tpl = Math.max(1, Math.min(10, inp.tpl));
  const level = levelOf(data, tpl);
  if (!level) throw new Error(`Salad Story: нет уровня ${tpl}`);
  const r = rngOf(`salad:${inp.seed}:${tpl}`);
  // Кассир: не тот же, что в прошлый визит.
  const prev = inp.state.last?.cashier;
  const cashier = pickOne(r, data.cashiers.cashiers.filter((c) => c.id !== prev).length ? data.cashiers.cashiers.filter((c) => c.id !== prev) : data.cashiers.cashiers);
  const order = planOrder(inp, r, tpl);
  const atTpl = inp.state.byTpl[tpl] ?? 0;
  // Новые слова визита: первые maxNewWords слов уровня без карточек (в порядке уровня).
  const intro = new Set(level.words.filter((w) => !inp.planted.has(w)).slice(0, data.levels.visit.maxNewWords));
  const ctx: Ctx = {
    in: inp,
    r,
    level,
    tpl,
    cashier,
    order,
    vars: orderVars(data, order, inp.vocab),
    steps: [],
    bubbles: {},
    events: [],
    intro,
    skipOrder: false,
    first: atTpl === 0,
    atTpl,
    seq: 0,
  };
  for (const slot of level.slots) expand(ctx, slot);
  trim(ctx);
  const usedAll = new Set(ctx.steps.map((s) => s.item).filter((x): x is string => !!x));
  // Новые слова визита: слова уровня без карточек, которые есть в шагах (в порядке уровня, не больше maxNewWords).
  const introduces = level.words.filter((w) => !inp.planted.has(w) && usedAll.has(w)).slice(0, data.levels.visit.maxNewWords);
  const lessonId = saladLesson(tpl);
  // Слово шага без карточки и не из новых этого визита — шаг остаётся, SRS не трогает (слово введут позже).
  const usable = (id: string): boolean => inp.planted.has(id) || introduces.includes(id);
  const steps = ctx.steps.map((s, i) => {
    const out = { ...s, id: `${lessonId}#v${inp.state.visits}.${i}` } as Step;
    if (out.item && !usable(out.item)) delete out.item;
    return out;
  });
  const bubbles: Record<string, BubbleLine> = {};
  ctx.steps.forEach((s, i) => {
    const b = ctx.bubbles[s.id ?? ''];
    if (b) bubbles[steps[i]!.id!] = b;
  });
  const rt = level.realTask;
  const realTask = rt ? { pl: fill(rt.pl, ctx.vars), ru: fill(rt.ru, ctx.vars) } : undefined;
  const seasonOn = tpl >= data.menu.season.from;
  const { without: _w, ...visitOrder } = order;
  return {
    lesson: {
      id: lessonId,
      kind: 'practice',
      title: { pl: level.title.pl, ru: level.title.ru },
      minutes: 2,
      npc: cashier.id,
      ...(introduces.length ? { introduces } : {}),
      pass: { firstTry: data.levels.pass.firstTry },
      steps: steps as [Step, ...Step[]],
    },
    level: inp.state.level,
    tpl,
    jump: !!inp.jump,
    cashier,
    order: visitOrder,
    introduces,
    bubbles,
    events: ctx.events,
    ...(ctx.slip ? { slip: ctx.slip } : {}),
    ...(ctx.total ? { total: ctx.total } : {}),
    ...(realTask ? { realTask } : {}),
    board: { danie: danieDnia(data, inp.state.level, inp.day), ...(seasonOn ? { season: data.menu.season.board } : {}) },
    vars: ctx.vars,
  };
}

/** Визит длиннее maxSteps: сначала без разминки, потом без «повтори вслух». */
function trim(c: Ctx): void {
  const max = c.in.data.levels.visit.maxSteps;
  for (const kind of ['warmup', 'shadow', 'explain'] as const) {
    if (c.steps.length <= max) return;
    const i = c.steps.findIndex((s) => (s.id ?? '').startsWith(`${kind}:`));
    if (i >= 0) c.steps.splice(i, 1);
  }
}

function push(c: Ctx, kind: string, s: Step, bubble?: BubbleLine): void {
  const id = `${kind}:${++c.seq}`;
  c.steps.push({ ...s, id } as Step);
  if (bubble) c.bubbles[id] = bubble;
}

function line(c: Ctx, key: string, vars: Vars = c.vars): BubbleLine {
  const l = pickOne(c.r, cashierLines(c.in.data, c.cashier, key, c.tpl));
  return { pl: fill(l.pl, vars), ru: fill(l.ru, vars) };
}

const answer = (c: Ctx, key: string, vars: Vars = c.vars): SaladText & { pl: string; ru: string } => {
  const a = c.in.data.levels.answers[key];
  if (!a) throw new Error(`Salad Story: нет ответа "${key}" в levels.json`);
  return { ...a, pl: fill(a.pl, vars), ru: fill(a.ru, vars) };
};

function expand(c: Ctx, slot: SaladSlot): void {
  switch (slot.slot) {
    case 'greet':
      push(c, 'greet', { t: 'say', who: c.cashier.id, ...line(c, 'greet') });
      return;
    case 'serve': {
      const l = line(c, slot.line === 'name' ? 'name' : 'serve');
      push(c, 'serve', { t: 'say', who: c.cashier.id, ...l });
      return;
    }
    case 'warmup':
      return warmup(c);
    case 'pick':
      return pickSlot(c, slot.count, c.first ? slot.options[0] : slot.options[1]);
    case 'pick_salad':
      return pickSalad(c);
    case 'listen': {
      const v = c.in.vocab(slot.item);
      push(c, 'listen', { t: 'listen', say: slot.say, options: slot.options as [string, string], answer: 0, item: slot.item, show: 'text', ...(v?.tr ? { tr: v.tr } : {}) });
      return;
    }
    case 'explain':
      if (slot.once && !c.first) return;
      push(c, 'explain', { t: 'explain', md: slot.md, ...(slot.table ? { table: slot.table } : {}) });
      return;
    case 'order':
      if (c.skipOrder) return;
      return orderSlot(c, slot.as);
    case 'shadow': {
      const t = slot.what === 'osobno' ? { pl: `${answer(c, 'order').pl} Dressing osobno.`, ru: `${answer(c, 'order').ru} Заправку отдельно.` } : answer(c, 'order');
      push(c, 'shadow', { t: 'shadow', pl: t.pl, ru: t.ru, repeat: 1 });
      return;
    }
    case 'questions':
      return questions(c, slot.pool, slot.pick, slot.listen, slot.as);
    case 'event':
      return eventSlot(c, slot.pool, !!slot.always);
    case 'friend':
      return friend(c);
    case 'compose':
      return compose(c);
    case 'price':
      return price(c);
  }
}

// ── Разминка: созревшее слово из огорода.

function warmup(c: Ctx): void {
  const { in: inp } = c;
  // Гэг sok/sos «горит» (прошлый визит) — разминка на эту пару.
  if (inp.state.lastGags.includes('gag.sok_sos') && inp.planted.has('lx.sos')) {
    push(c, 'warmup', { t: 'listen', say: 'sos', options: ['sos', 'sok'], answer: 0, item: 'lx.sos', tags: ['ph.sok_sos'], tr: 'сос' });
    return;
  }
  const salad = new Set(inp.data.levels.levels.flatMap((l) => l.words));
  const due = inp.due.filter((card) => salad.has(card.slice(0, card.lastIndexOf('#'))));
  if (!due.length) return;
  const card = pickOne(c.r, due);
  const id = card.slice(0, card.lastIndexOf('#'));
  const v = inp.vocab(id);
  if (!v) return;
  const others = shuffle(c.r, [...salad].filter((w) => w !== id && inp.planted.has(w)).map((w) => inp.vocab(w)).filter((x): x is VocabEntry => !!x && x.pl !== v.pl));
  if (card.endsWith('#lis')) {
    const opts = [v.pl, ...others.slice(0, 2).map((x) => x.pl)];
    if (opts.length < 2) return;
    push(c, 'warmup', { t: 'listen', say: v.pl, options: opts as [string, string], answer: 0, item: id, ...(v.tr ? { tr: v.tr } : {}) });
  } else {
    const opts = [v.ru, ...others.filter((x) => x.ru !== v.ru).slice(0, 2).map((x) => x.ru)];
    if (opts.length < 2) return;
    push(c, 'warmup', { t: 'choice', q: `${v.pl} — это…`, options: opts as [string, string], answer: 0, item: id });
  }
}

// ── Уровень 1: витрина.

function pickSlot(c: Ctx, count: number, n: number): void {
  const { data, vocab, planted } = c.in;
  const ing = data.menu.ingredients;
  const levelIng = c.level.words.filter((w) => ing.some((i) => i.lx === w));
  const fresh = levelIng.filter((w) => c.intro.has(w));
  const known = shuffle(c.r, levelIng.filter((w) => planted.has(w)));
  const rest = shuffle(c.r, levelIng.filter((w) => !c.intro.has(w) && !planted.has(w)));
  const targets = [...fresh, ...known, ...rest].slice(0, count);
  for (const t of targets) {
    const v = vocab(t);
    const it = ing.find((i) => i.lx === t)!;
    const pool = shuffle(c.r, ing.filter((i) => i.lx !== t && levelIng.includes(i.lx)));
    const more = shuffle(c.r, ing.filter((i) => i.lx !== t && !levelIng.includes(i.lx)));
    const items = [it, ...[...pool, ...more].slice(0, n - 1)].map((i) => ({ sprite: i.sprite, label: vocab(i.lx)?.pl ?? i.lx }));
    push(c, 'pick', { t: 'pick', prompt: `Ткни на витрине: ${v?.pl ?? t}`, say: v?.pl ?? t, items: items as [{ sprite: string; label: string }, { sprite: string; label: string }], answer: 0, item: t, ...(v?.tr ? { tr: v.tr } : {}) });
  }
}

function pickSalad(c: Ctx): void {
  const { data, vocab } = c.in;
  const s = salad(data, c.order.salad);
  const drink = data.menu.drinks[0]!;
  const bread = data.menu.breads[0]!;
  const v = vocab('lx.salatka');
  const items = [
    { sprite: s.sprite, label: 'sałatka' },
    { sprite: bread.sprite, label: 'paluch' },
    ...(c.first ? [] : [{ sprite: drink.sprite, label: drink.pl }]),
  ];
  push(c, 'pick', { t: 'pick', prompt: 'А где здесь sałatka?', say: 'sałatka', items: items as [(typeof items)[0], (typeof items)[0]], answer: 0, item: 'lx.salatka', ...(v?.tr ? { tr: v.tr } : {}) });
}

// ── Заказ салата.

const WHY_ACC = 'После poproszę: -a → -ę. sałatka → sałatkę. Название салата не меняем.';

function orderSlot(c: Ctx, as: 'choice' | 'tiles' | 'gap_then_type' | 'type'): void {
  const { data } = c.in;
  const s = salad(data, c.order.salad);
  const want = `${s.name}${c.tpl >= 6 ? `, ${SIZE_RU[c.order.size]} порция` : ''}`;
  const right = answer(c, 'order');
  if (as === 'choice') {
    const others = data.menu.salads.filter((x) => x.id !== s.id && x.from <= Math.max(2, c.tpl));
    const byForm = c.first || c.r() < 0.5;
    const wrong = byForm ? answer(c, 'order.nom') : answer(c, 'order', { ...c.vars, salad: pickOne(c.r, others).name });
    push(c, 'order', {
      t: 'choice',
      q: `Закажи свой салат: ${s.name} (${s.ru})`,
      options: [right.pl, wrong.pl],
      answer: 0,
      dir: 'ru-pl',
      item: 'lx.salatka',
      ...(byForm ? { errorTagByOption: { '1': 'gr.acc_fem' }, why: WHY_ACC } : {}),
    });
    return;
  }
  if (as === 'tiles') {
    push(c, 'order', {
      t: 'order',
      prompt: `Закажи: ${s.name} (${s.ru})`,
      tiles: ['Poproszę', 'sałatkę', s.name, 'sałatka', 'sałatki'],
      answer: ['Poproszę', 'sałatkę', s.name],
      item: 'lx.salatka',
      tags: ['gr.acc_fem'],
      why: WHY_ACC,
    });
    return;
  }
  if (as === 'gap_then_type' && c.atTpl < 2) {
    const g = answer(c, 'order.gap');
    push(c, 'order', { t: 'gap', text: g.pl, answer: 'sałatkę', accept: ['sałatkę'], item: 'lx.salatka', tags: ['gr.acc_fem'], why: WHY_ACC });
    return;
  }
  push(c, 'order', { t: 'type', prompt: `Закажи с клавиатуры: ${want}`, accept: orderAccept(c) as [string, ...string[]], item: 'lx.salatka', tags: ['gr.acc_fem'], why: WHY_ACC });
}

/** Варианты набранного заказа: Poproszę / Chciałbym (с уровня 6), порция до или после названия. */
export function orderAccept(c: Pick<Ctx, 'tpl' | 'order' | 'vars'>): string[] {
  const name = c.vars['salad']!;
  const acc = c.vars['sizeAcc']!;
  const verbs = c.tpl >= 6 ? ['Poproszę', 'Chciałbym'] : ['Poproszę'];
  const out: string[] = [];
  for (const v of verbs) {
    if (c.tpl >= 6) out.push(`${v} sałatkę ${name}, ${acc}`, `${v} ${acc} sałatkę ${name}`);
    if (c.tpl < 6 || c.order.size === 'normalna') out.push(`${v} sałatkę ${name}`);
    if (c.tpl >= 6 && name === 'Cezar') out.push(`${v} Cezara, ${acc}`);
  }
  return out;
}

// ── Вопросы кассира.

interface AnswerSpec {
  right: { pl: string; ru: string };
  wrong: { pl: string; tag?: string };
  /** Пропуск для gap: фраза с ___, верное слово, вариант-ловушка. */
  gap?: { text: string; answer: string; trap: string; tag?: string; accept?: string[] };
  item?: string;
  why?: string;
  /** Чего хочет Дима (русская подсказка в задании). */
  want: string;
}

function spec(c: Ctx, q: SaladQuestion): AnswerSpec | null {
  const { data } = c.in;
  const o = c.order;
  const a = (k: string, v?: Vars) => answer(c, k, v);
  switch (q.want) {
    case 'size': {
      const right = a(`size.${o.size}`);
      const other = a(o.size === 'normalna' ? 'size.powiekszona' : 'size.normalna');
      const sz = data.menu.sizes.find((x) => x.id === o.size)!;
      return {
        right,
        wrong: { pl: other.pl, tag: 'gr.rozmiar' },
        gap: { text: a('size.gap').pl, answer: sz.pl, trap: sz.acc, tag: 'gr.acc_over', accept: [sz.pl] },
        item: sz.lx,
        why: `Ответ на вопрос кассира — просто слово: ${cap(sz.pl)}.`,
        want: `${SIZE_RU[o.size]} порция`,
      };
    }
    case 'dressing_ok': {
      const def = salad(data, o.salad).dressing;
      const want = data.menu.dressings.find((d) => d.id === o.dressing);
      const defD = data.menu.dressings.find((d) => d.id === def)!;
      // Bubble спрашивает про dressing салата по умолчанию.
      c.vars['dressing'] = defD.pl;
      c.vars['Dressing'] = cap(defD.pl);
      if (!want || want.id === def) {
        const other = pickOne(c.r, learnableDressings(data).filter((d) => d.id !== def));
        return { right: a('dressing.ok'), wrong: { pl: a('dressing.other', { ...c.vars, dressing: other.pl }).pl }, item: 'lx.moze_byc', want: `заправка ${defD.ru} подходит` };
      }
      const right = a('dressing.other', { ...c.vars, dressing: want.pl, dressingRu: want.ru });
      return {
        right,
        wrong: { pl: a('dressing.ok').pl },
        ...(want.lx ? { gap: { text: a('dressing.gap').pl, answer: want.pl, trap: want.pl.replace(/y$/u, 'ę'), tag: 'gr.acc_over', accept: [want.pl] } } : {}),
        ...(want.lx ? { item: want.lx } : {}),
        why: `Ответ на вопрос — просто слово, без -ę: ${want.pl}.`,
        want: `другая заправка: ${want.ru}`,
      };
    }
    case 'dressing_name': {
      const want = data.menu.dressings.find((d) => d.id === o.dressing) ?? data.menu.dressings.find((d) => d.id === salad(data, o.salad).dressing)!;
      const other = pickOne(c.r, data.menu.dressings.filter((d) => d.id !== want.id && d.lx));
      return {
        right: a('dressing.name', { ...c.vars, Dressing: cap(want.pl), dressingRu: cap(want.ru) }),
        wrong: { pl: a('dressing.name', { ...c.vars, Dressing: cap(other.pl) }).pl },
        ...(want.lx ? { gap: { text: '___, poproszę.', answer: cap(want.pl), trap: cap(want.pl).replace(/y$/u, 'ę'), tag: 'gr.acc_over', accept: [want.pl] } } : {}),
        ...(want.lx ? { item: want.lx } : {}),
        why: 'Ответ на вопрос — просто слово, без -ę.',
        want: `заправка: ${want.ru}`,
      };
    }
    case 'osobno':
      if (o.osobno)
        return {
          right: a('osobno.sos'),
          wrong: { pl: a('osobno.sok').pl, tag: 'ph.sok_sos' },
          gap: { text: a('osobno.gap').pl, answer: 'Sos', trap: 'Sok', tag: 'ph.sok_sos', accept: ['Sos', 'sos'] },
          // Различает ответы слово sos (а не osobno): sos / sok.
          item: 'lx.sos',
          why: 'sos = соус, sok = сок. Одна буква — и вместо заправки стакан сока.',
          want: 'заправку отдельно',
        };
      return { right: a('osobno.mix'), wrong: { pl: a('osobno.sos').pl }, item: 'lx.wymieszac', want: 'заправку вмешать в салат' };
    case 'bread': {
      if (o.bread) {
        const b = data.menu.breads.find((x) => x.id === o.bread)!;
        const other = data.menu.breads.find((x) => x.id !== o.bread) ?? b;
        return {
          right: a('bread.yes'),
          wrong: { pl: a('bread.no').pl },
          gap: { text: 'Tak, ___.', answer: b.short ?? b.pl, trap: other.short ?? other.pl, accept: [b.short ?? b.pl] },
          ...(b.lx ? { item: b.lx } : {}),
          want: `палочку: ${b.ru}`,
        };
      }
      return { right: a('bread.no'), wrong: { pl: a('bread.yes').pl }, item: 'lx.nie_dziekuje', want: 'палочку не надо' };
    }
    case 'bread_which': {
      const b = data.menu.breads.find((x) => x.id === o.bread) ?? data.menu.breads[0]!;
      const other = data.menu.breads.find((x) => x.id !== b.id) ?? b;
      return { right: a('bread.which', { ...c.vars, Bread: cap(b.short ?? b.pl), breadRu: cap(b.ru) }), wrong: { pl: `${cap(other.short ?? other.pl)}.` }, ...(b.lx ? { item: b.lx } : {}), want: b.ru };
    }
    case 'drink': {
      if (o.drink) {
        const d = data.menu.drinks.find((x) => x.id === o.drink)!;
        const acc = d.acc ?? d.pl;
        const nomDiffers = acc !== d.pl;
        const otherDrink = data.menu.drinks.find((x) => x.id !== d.id) ?? d;
        return {
          right: a('drink.yes'),
          wrong: nomDiffers ? { pl: a('drink.nom').pl, tag: 'gr.acc_fem' } : { pl: a('drink.no').pl },
          gap: { text: a('drink.gap').pl, answer: cap(acc), trap: nomDiffers ? cap(d.pl) : cap(otherDrink.acc ?? otherDrink.pl), ...(nomDiffers ? { tag: 'gr.acc_fem' } : {}), accept: [acc] },
          ...(d.lx ? { item: d.lx } : {}),
          ...(nomDiffers ? { why: `После poproszę: -a → -ę: ${d.pl} → ${acc}.` } : {}),
          want: `попить: ${d.ru}`,
        };
      }
      return { right: a('drink.no'), wrong: { pl: a('drink.yes', { ...c.vars, Drink: 'Wodę' }).pl }, item: 'lx.nie_dziekuje', want: 'пить не надо' };
    }
    case 'place': {
      const here = o.place !== 'wynos';
      return {
        right: a(here ? 'place.miejsce' : 'place.wynos'),
        wrong: { pl: a(here ? 'place.wynos' : 'place.miejsce').pl, tag: 'gr.miejsce' },
        gap: { text: a('place.gap').pl, answer: here ? 'miejscu' : 'wynos', trap: here ? 'wynos' : 'miejscu', tag: 'gr.miejsce' },
        item: here ? 'lx.na_miejscu' : 'lx.na_wynos',
        want: here ? 'поесть здесь' : 'взять с собой',
      };
    }
    case 'more':
      return { right: a('more.no'), wrong: { pl: a('more.yes').pl }, gap: { text: 'To ___.', answer: 'wszystko', trap: 'wszyscy', accept: ['wszystko'] }, item: 'lx.to_wszystko', want: 'больше ничего' };
    case 'without': {
      const bez = o.without;
      if (bez) {
        const lx = bez === 'lx.bekon' ? 'lx.bez_bekonu' : 'lx.bez_grzanek';
        return { right: a('without.bez'), wrong: { pl: a('without.all').pl }, item: lx, want: `без: ${c.vars['bezRu']}` };
      }
      return { right: a('without.all'), wrong: { pl: a('without.bez', { ...c.vars, bez: 'bekonu' }).pl }, want: 'со всем, как есть' };
    }
    case 'app': {
      const yes = c.r() < 0.5;
      return { right: a(yes ? 'app.yes' : 'app.no'), wrong: { pl: a(yes ? 'app.no' : 'app.yes').pl }, item: yes ? 'lx.ma_pan_aplikacje' : 'lx.nie_dziekuje', want: yes ? 'приложение есть' : 'приложения нет' };
    }
    case 'pay': {
      const card = c.r() < 0.6;
      return { right: a(card ? 'pay.karta' : 'pay.blik'), wrong: { pl: a(card ? 'pay.blik' : 'pay.karta').pl }, item: card ? 'lx.karta_narz' : 'lx.blikiem', want: card ? 'платишь картой' : 'платишь через BLIK' };
    }
    case 'receipt': {
      const yes = c.r() < 0.3;
      return { right: a(yes ? 'receipt.yes' : 'receipt.no'), wrong: { pl: a(yes ? 'receipt.no' : 'receipt.yes').pl }, ...(yes ? {} : { item: 'lx.nie_dziekuje' }), want: yes ? 'чек нужен' : 'чек не нужен' };
    }
  }
}

function questions(c: Ctx, pool: string[], [min, max]: number[], listen: 'always' | 'never' | 'first2' | 'new', as: 'choice' | 'gap_options' | 'gap' | 'mixed'): void {
  const { data } = c.in;
  const n = min! + Math.floor(c.r() * (max! - min! + 1));
  const avail = pool.filter((q) => data.levels.questions[q]);
  // q.dressing и q.jaki_dressing — один вопрос о заправке; q.paluch тянет q.paluch_jaki не берём (ответ «Tak, buraczkowy» уже про вид).
  const chosen: string[] = [];
  for (const q of shuffle(c.r, avail)) {
    if (chosen.length >= n) break;
    if ((q === 'q.dressing' && chosen.includes('q.jaki_dressing')) || (q === 'q.jaki_dressing' && chosen.includes('q.dressing'))) continue;
    chosen.push(q);
  }
  // Порядок как на кассе: размер → dressing → osobno → палочка → напиток → ещё → место.
  const ORDER = ['q.ze_wszystkim', 'q.rozmiar', 'q.dressing', 'q.jaki_dressing', 'q.osobno', 'q.paluch', 'q.paluch_jaki', 'q.picie', 'q.cos_jeszcze', 'q.miejsce', 'q.aplikacja', 'q.platnosc', 'q.paragon'];
  chosen.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  for (const qid of chosen) {
    const q = data.levels.questions[qid]!;
    const sp = spec(c, q);
    if (!sp) continue;
    const bub = line(c, qid);
    const wantListen = listen === 'always' || (listen === 'first2' && c.atTpl < 2) || (listen === 'new' && !(c.in.familiar?.(q.lx) ?? false));
    if (wantListen) {
      const other = otherQuestionRu(c, qid, bub.ru);
      const v = c.in.vocab(q.lx);
      push(c, 'q', { t: 'listen', say: bub.pl, options: [bub.ru, other], answer: 0, item: q.lx, show: 'text', ...(v && v.pl === bub.pl && v.tr ? { tr: v.tr } : {}) }, bub);
    }
    // Пропуск без настоящей ловушки (вариант совпал с ответом) — выбор целой фразой.
    if (sp.gap && sp.gap.trap.toLowerCase() === sp.gap.answer.toLowerCase()) delete sp.gap;
    const mode = as === 'mixed' ? (sp.gap && c.r() < 0.5 ? 'gap_options' : 'choice') : as;
    const head = `Кассир: «${bub.pl}» Ты хочешь: ${sp.want}.`;
    const tags = sp.wrong.tag ? [sp.wrong.tag] : [];
    if ((mode === 'gap_options' || mode === 'gap') && sp.gap) {
      const g = sp.gap;
      push(
        c,
        'a',
        {
          t: 'gap',
          text: g.text,
          answer: g.answer,
          ...(mode === 'gap_options' ? { options: [g.answer, g.trap] as [string, string] } : { accept: (g.accept ?? [g.answer]) as [string, ...string[]] }),
          ...(sp.item ? { item: sp.item } : {}),
          ...(g.tag ? { tags: [g.tag] } : {}),
          ...(sp.why ? { why: sp.why } : {}),
          hint: head,
        },
        bub,
      );
      continue;
    }
    if (mode === 'gap') {
      // Нет пропуска для этого вопроса: ответ набором целиком.
      push(c, 'a', { t: 'type', prompt: `${head} Ответь:`, accept: [noDot(sp.right.pl)], ...(sp.item ? { item: sp.item } : {}), ...(tags.length ? { tags } : {}), ...(sp.why ? { why: sp.why } : {}) }, bub);
      continue;
    }
    push(
      c,
      'a',
      {
        t: 'choice',
        q: head,
        options: [sp.right.pl, sp.wrong.pl],
        answer: 0,
        dir: 'ru-pl',
        ...(sp.item ? { item: sp.item } : {}),
        ...(sp.wrong.tag ? { errorTagByOption: { '1': sp.wrong.tag } } : {}),
        ...(sp.why ? { why: sp.why } : {}),
      },
      bub,
    );
  }
}

function otherQuestionRu(c: Ctx, qid: string, ru: string): string {
  const keys = Object.keys(c.in.data.levels.questions).filter((k) => k !== qid);
  for (const k of shuffle(c.r, keys)) {
    const l = c.in.data.cashiers.common[k]?.[0];
    if (l && l.ru !== ru && !l.ru.includes('{')) return l.ru;
  }
  return 'Что-нибудь ещё?';
}

// ── События.

function eventSlot(c: Ctx, pool: string[], always: boolean): void {
  const { data, state } = c.in;
  for (const id of shuffle(c.r, pool)) {
    const ev = data.events.events.find((e) => e.id === id);
    if (!ev || c.tpl < ev.minLevel) continue;
    const chance = c.tpl >= 10 && ev.level10Chance !== undefined ? ev.level10Chance : ev.chance;
    const roll = c.r() < chance;
    if (id === 'ev.co_zwykle') {
      const n = ev.sameOrderLast ?? 3;
      const last = state.lastOrders.slice(-n);
      if (!roll || last.length < n || !last.every((o) => o.salad === last[0]!.salad)) continue;
      c.order.salad = last[0]!.salad;
      Object.assign(c.vars, orderVars(data, c.order, c.in.vocab));
      const bub = line(c, 'co_zwykle');
      push(c, 'ev', { t: 'choice', q: `Кассир: «${bub.pl}» Ты хочешь как обычно.`, options: [answer(c, 'zwykle.yes').pl, answer(c, 'bread.no').pl], answer: 0, dir: 'ru-pl' }, bub);
      c.skipOrder = true;
      c.events.push(id);
      return;
    }
    if (id === 'ev.kasjer_pomylka') {
      if (!roll && !always) continue;
      const slip = roll ? (c.r() < 0.5 ? 'size' : 'mix') : undefined;
      const said = { ...c.vars };
      let fix = '';
      if (slip === 'size') {
        const other = data.menu.sizes.find((s) => s.id !== c.order.size)!;
        said['size'] = other.pl;
        fix = answer(c, 'check.fix', { ...c.vars, wrong: other.pl, right: c.vars['size']!, wrongRu: SIZE_RU[other.id], rightRu: c.vars['sizeRu']! }).pl;
      } else if (slip === 'mix') {
        said['mix'] = c.order.osobno ? 'wymieszany' : 'osobno';
        fix = answer(c, 'check.fix', { ...c.vars, wrong: said['mix'], right: c.vars['mix']!, wrongRu: '', rightRu: '' }).pl;
      }
      const bub = line(c, 'powtorka', said);
      const ok = answer(c, 'check.ok').pl;
      const wrongFix = slip ? ok : answer(c, 'check.fix', { ...c.vars, wrong: c.vars['size']!, right: data.menu.sizes.find((s) => s.id !== c.order.size)!.pl }).pl;
      push(
        c,
        'ev',
        {
          t: 'choice',
          q: `Кассир повторяет заказ: «${bub.pl}» Всё верно?`,
          options: slip ? [fix, ok] : [ok, wrongFix],
          answer: 0,
          dir: 'ru-pl',
          item: slip ? 'lx.nie_tylko' : 'lx.zgadza_sie',
          why: slip ? 'Кассир ошибся: поправь «Nie …, tylko …» (не …, а …).' : 'Всё совпадает с заказом: «Zgadza się».',
        },
        bub,
      );
      if (slip) c.slip = slip;
      c.events.push(id);
      return;
    }
    if (id === 'ev.nie_ma') {
      if (!roll) continue;
      if (c.order.compose?.length) {
        // Свой салат: нет белка → «To poproszę tofu».
        const miss = c.order.compose[1]!;
        const ing = data.menu.ingredients.find((i) => i.lx === miss);
        const sub = ['lx.tofu', 'lx.jajka'].find((x) => x !== miss)!;
        const subV = c.in.vocab(sub);
        const bub = line(c, 'nie_ma_item', { ...c.vars, item: ing?.gen ?? '', itemRu: c.in.vocab(miss)?.ru ?? '' });
        push(c, 'ev', { t: 'choice', q: `Кассир: «${bub.pl}» Возьми вместо этого: ${subV?.ru ?? ''}.`, options: [answer(c, 'nie_ma.item', { ...c.vars, item: subV?.pl ?? '', itemRu: subV?.ru ?? '' }).pl, `Poproszę ${ing?.gen ?? ''}.`], answer: 0, dir: 'ru-pl', item: 'lx.to_poprosze' }, bub);
        c.order.compose[1] = sub;
      } else {
        const missing = salad(data, c.order.salad);
        const alt = pickOne(c.r, data.menu.salads.filter((s) => s.id !== missing.id && s.from <= c.tpl && !s.season));
        const bub = line(c, 'nie_ma', { ...c.vars, salad: missing.name });
        c.order.salad = alt.id;
        Object.assign(c.vars, orderVars(data, c.order, c.in.vocab));
        push(c, 'ev', { t: 'choice', q: `Кассир: «${bub.pl}» Возьми ${alt.name}.`, options: [answer(c, 'nie_ma.other').pl, answer(c, 'order', { ...c.vars, salad: missing.name }).pl], answer: 0, dir: 'ru-pl', item: 'lx.to_poprosze' }, bub);
      }
      c.events.push(id);
      return;
    }
    if (id === 'ev.sezon') {
      if (!roll) continue;
      const s = salad(data, data.menu.season.salad);
      c.order.salad = s.id;
      Object.assign(c.vars, orderVars(data, c.order, c.in.vocab));
      const b = data.menu.season.board;
      push(c, 'ev', { t: 'listen', say: b.pl, options: [b.ru, 'Сезон дынь!'], answer: 0, item: 'lx.dynia', tags: ['ff.dynia'], show: 'text' }, { pl: b.pl, ru: b.ru });
      c.events.push(id);
      return;
    }
  }
}

// ── Уровень 7: записка коллеги.

function friend(c: Ctx): void {
  const { data } = c.in;
  const f = pickOne(c.r, data.menu.salads.filter((s) => s.id !== c.order.salad && !s.season && s.from <= c.tpl));
  push(c, 'friend', { t: 'explain', md: `📝 Записка от Wojtka: «Возьми мне **${f.name}** (${f.ru}). Спасибо!»` });
  push(c, 'friend', {
    t: 'order',
    prompt: `Закажи и для Wojtka: ${f.name}`,
    tiles: ['I', 'sałatkę', f.name, 'dla kolegi', 'sałatka', 'kolega'],
    answer: ['I', 'sałatkę', f.name, 'dla kolegi'],
    item: 'lx.dla_kolegi',
    tags: ['gr.acc_fem'],
    why: 'dla kolegi = для коллеги, одним куском. sałatka → sałatkę.',
  });
}

// ── Уровень 8: свой салат по слотам.

function compose(c: Ctx): void {
  const { data, vocab } = c.in;
  const comp = data.menu.compose;
  const greetAns = answer(c, 'compose');
  push(c, 'compose', { t: 'choice', q: 'Сегодня собираешь свой салат', options: [greetAns.pl, answer(c, 'order').pl], answer: 0, dir: 'ru-pl', ...(greetAns.lx ? { item: greetAns.lx } : {}) });
  const picked: string[] = [];
  for (const slot of comp.slots) {
    const want = pickOne(c.r, slot.options.filter((o) => slot.id !== 'bialko' || !['lx.tofu', 'lx.jajka'].includes(o) || c.r() < 0.3));
    const other = pickOne(c.r, slot.options.filter((o) => o !== want));
    picked.push(want);
    const bub = line(c, slot.ask);
    const v = vocab(want);
    const ov = vocab(other);
    const ing = data.menu.ingredients;
    const sp = (lx: string) => ing.find((i) => i.lx === lx)?.sprite ?? comp.sprite;
    // Основа — картинкой (витрина), белок и добавки — словом.
    if (slot.id === 'baza')
      push(c, 'compose', { t: 'pick', prompt: `Кассир: «${bub.pl}» Ткни: ${v?.pl ?? want}`, items: [{ sprite: sp(want), label: v?.pl ?? want }, { sprite: sp(other), label: ov?.pl ?? other }], answer: 0, item: want, ...(v?.tr ? { tr: v.tr } : {}) }, bub);
    else push(c, 'compose', { t: 'choice', q: `Кассир: «${bub.pl}» Ты хочешь: ${v?.ru ?? want}.`, options: [cap(v?.pl ?? want), cap(ov?.pl ?? other)], answer: 0, dir: 'ru-pl', item: want }, bub);
  }
  c.order.compose = picked;
  c.order.salad = 'm.wlasna';
  c.skipOrder = true;
}

// ── Уровень 9: сумма на слух.

export function priceOf(data: SaladData, o: VisitOrder): number {
  const s = data.menu.salads.find((x) => x.id === o.salad);
  const base = s ? s.price : data.menu.compose.price;
  const extra = data.menu.sizes.find((x) => x.id === o.size)?.extra ?? 0;
  const bread = data.menu.breads.find((b) => b.id === o.bread)?.price ?? 0;
  return base + extra + bread;
}

/** Гроши на кассе (со 2-го визита уровня): реальный формат «trzydzieści siedem dwadzieścia». */
export const PRICE_GROSZE = [0, 20, 50] as const;

function price(c: Ctx): void {
  const zl = priceOf(c.in.data, c.order);
  const gr = c.atTpl > 0 ? pickOne(c.r, PRICE_GROSZE) : 0;
  c.total = { zl, gr };
  const words = plPrice(zl, gr, 'kasa');
  const bub = line(c, 'razem', { ...c.vars, price: words, priceRu: priceDigits(zl, gr) });
  const traps = priceTraps(zl, 2);
  push(c, 'price', { t: 'listen', say: bub.pl, options: [priceDigits(zl, gr), ...traps.map((t) => priceDigits(t, gr))] as [string, string], answer: 0, item: 'lx.razem', tags: ['ph.teen_ty'], show: 'text' });
}

// ── Все строки для озвучки (tools/build_audio.py): реплики кассиров и шаги с `say`/`pl`, раскрытые по меню.

export interface SpokenText {
  text: string;
  /** Нужна и медленная версия (listen, pick, shadow). */
  slow: boolean;
}

export function saladTexts(data: SaladData, vocab: (id: string) => VocabEntry | undefined): SpokenText[] {
  const out = new Map<string, boolean>();
  const add = (t: string, slow = false): void => {
    const k = t.normalize('NFC').trim();
    if (k) out.set(k, (out.get(k) ?? false) || slow);
  };
  const m = data.menu;
  const salads = [...m.salads.map((s) => s.name)];
  const domains: Record<string, string[]> = {
    salad: salads,
    dressing: m.dressings.map((d) => d.pl),
    Dressing: m.dressings.map((d) => cap(d.pl)),
    size: m.sizes.map((s) => s.pl),
    mix: ['osobno', 'wymieszany'],
    item: m.ingredients.map((i) => i.gen),
    bez: ['bekonu', 'grzanek', 'cebuli'],
    price: totals(data).flatMap(({ zl }) => PRICE_GROSZE.map((gr) => plPrice(zl, gr, 'kasa'))),
  };
  const expandAll = (t: string): string[] => {
    const keys = [...t.matchAll(/\{([A-Za-z]+)\}/g)].map((x) => x[1]!).filter((k, i, a) => a.indexOf(k) === i);
    let acc = [t];
    for (const k of keys) {
      const vals = domains[k];
      if (!vals) continue;
      acc = acc.flatMap((s) => vals.map((v) => s.split(`{${k}}`).join(v)));
    }
    return acc;
  };
  // Реплики кассиров: пузыри вопросов слушаются медленно на «Подсказку» шага listen.
  const listened = new Set([...Object.keys(data.levels.questions), 'razem', 'co_zwykle', 'nie_ma', 'nie_ma_item', 'powtorka']);
  const lines = (key: string, ls: CashierLine[]): void => {
    for (const l of ls) for (const t of expandAll(l.pl)) add(t, listened.has(key));
  };
  for (const [k, ls] of Object.entries(data.cashiers.common)) lines(k, ls);
  for (const c of data.cashiers.cashiers) for (const [k, ls] of Object.entries(c.ask)) lines(k, ls);
  for (const lv of data.levels.levels) {
    for (const s of lv.slots) if (s.slot === 'listen') add(s.say, true);
    if (lv.realTask) for (const t of expandAll(lv.realTask.pl)) add(t, true);
  }
  // pick: ингредиенты витрины, «sałatka».
  for (const i of m.ingredients) add(vocab(i.lx)?.pl ?? '', true);
  add('sałatka', true);
  // shadow и задание «в реале»: заказ своего салата.
  for (const name of salads) {
    const order = fill(data.levels.answers['order']!.pl, { salad: name });
    add(order, true);
    add(`${order} Dressing osobno.`, true);
  }
  add(m.season.board.pl, true);
  add('sos', true);
  // Разминка: слова лестницы на слух.
  for (const lv of data.levels.levels) for (const w of lv.words) add(vocab(w)?.pl ?? '', true);
  return [...out].map(([text, slow]) => ({ text, slow }));
}

/** Все суммы, которые может назвать касса (салат + порция + палочка). */
export function totals(data: SaladData): { zl: number }[] {
  const set = new Set<number>();
  const bases = [...data.menu.salads.map((s) => s.price), data.menu.compose.price];
  for (const b of bases) for (const s of data.menu.sizes) for (const br of [0, ...data.menu.breads.map((x) => x.price)]) set.add(b + s.extra + br);
  return [...set].sort((a, b) => a - b).map((zl) => ({ zl }));
}

/** Какие тексты визит отдаёт озвучке (тест: все они в saladTexts). */
export function visitAudioTexts(v: Visit): { text: string; slow: boolean }[] {
  const out: { text: string; slow: boolean }[] = [];
  for (const s of v.lesson.steps) {
    if (s.t === 'say') out.push({ text: s.pl, slow: false });
    else if (s.t === 'listen') out.push({ text: s.say, slow: true });
    else if (s.t === 'pick' && s.say) out.push({ text: s.say, slow: true });
    else if (s.t === 'shadow') out.push({ text: s.pl, slow: true });
  }
  for (const b of Object.values(v.bubbles)) out.push({ text: b.pl, slow: false });
  return out;
}

// ── Контракт данных для валидатора (tools/lib/content_check.ts).

/** Реплики кассира, которые зовёт генератор (кроме вопросов `q.*` из levels.questions и слотов своего салата). */
export const SALAD_LINE_KEYS = ['greet', 'serve', 'name', 'razem', 'jak_bylo', 'co_zwykle', 'nie_ma', 'nie_ma_item', 'powtorka', 'compose'] as const;
/** Ответы Димы, которые зовёт генератор (levels.json → answers). */
export const SALAD_ANSWER_KEYS = [
  'order', 'order.nom', 'order.gap', 'size.normalna', 'size.powiekszona', 'size.gap', 'dressing.ok', 'dressing.other', 'dressing.name',
  'dressing.gap', 'osobno.sos', 'osobno.sok', 'osobno.mix', 'osobno.gap', 'bread.yes', 'bread.no', 'bread.which', 'drink.yes', 'drink.nom',
  'drink.no', 'drink.gap', 'place.miejsce', 'place.wynos', 'place.gap', 'more.no', 'more.yes', 'without.bez', 'without.all', 'app.no',
  'app.yes', 'pay.karta', 'pay.blik', 'receipt.no', 'receipt.yes', 'check.ok', 'check.fix', 'zwykle.yes', 'nie_ma.other', 'nie_ma.item', 'compose',
] as const;
/** Подстановки в репликах и ответах. */
export const SALAD_VARS: ReadonlySet<string> = new Set([
  'salad', 'saladRu', 'dressing', 'Dressing', 'dressingRu', 'size', 'sizeAcc', 'sizeRu', 'bread', 'Bread', 'breadRu', 'drink', 'Drink', 'DrinkNom',
  'drinkRu', 'bez', 'bezRu', 'mix', 'mixRu', 'price', 'priceRu', 'item', 'itemRu', 'wrong', 'right', 'wrongRu', 'rightRu',
]);
