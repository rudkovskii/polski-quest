// Петля короткой версии «Wola» (W-01, ../ВОЛЯ.md решения 5–7): чистые функции от прогресса и словаря Wola.
//   • дом, ноутбук «Słowniczek»: дневная порция (настройка `wola.portion`, 5) — следующие слова по порядку словаря;
//     «Dodaj» = событие `intro` (lesson `wola.laptop`), слово семечком уходит в огород;
//   • дом, полка «Słownik»: темы-наборы, по 5 слов сверх порции (lesson `wola.slownik.<тема>`);
//   • мягкий потолок новых слов в день (`newItemsPerDay`, 8, 4–12): сверх — предупреждение, не запрет;
//   • план дня (W-04, research/01 §7 риск 3 «лавина повторений»): потолок новых подстраивается под долг огорода —
//     до PLAN.fullUpTo растений к удобрению полный, дальше линейно меньше, от PLAN.noneFrom новых нет («Сначала огород»);
//     удобрение за день — до PLAN.fertilizeMax растений, остаток ждёт завтра без наказания. Слова Salad Story в лимите;
//   • огород: растения = слова (garden.ts), «!» = карточка к повтору, зрелое = интервал ≥ 21 дня (порог банки
//     в tuning Wola) → «Zbiór» ставит флаг `wola.jar.<слово>`, банка уходит на полку дома;
//   • итог дня у кровати: добавлено, удобрено, собрано, минуты.
// Время приходит параметром, ничего не пишет: события и флаги пишет UI.
import type { VocabEntry, WolaTheme, WolaVocab } from '../../types/content';
import { derive, type DeriveContent, type Derived } from '../../systems/derive';
import { gardenItems, plantStage, type GardenItem, type GardenTuning } from '../../systems/garden';
import type { EventOf, LogEvent } from '../../systems/log';
import { getSetting, setFlag, type CardId, type CardState, type CardType, type Progress, type Ts } from '../../systems/progress';
import { summarizeDay, type DaySummary } from '../../systems/session';
import { EF_START, parseCardId, review, type Grade, type SrsTuning } from '../../systems/srs';
import { dayStart, dayStartAfter, type TimeOpts } from '../../systems/time';

export const LAPTOP_LESSON = 'wola.laptop';
export const SHELF_LESSON_PREFIX = 'wola.slownik.';
export const CHECK_LESSON = 'wola.sprawdzian';
export const JAR_FLAG_PREFIX = 'wola.jar.';
/** Зрелое слово (ВОЛЯ.md п. 7): интервал ≥ 21 дня. Wola ставит это первым порогом `tuning.jars.thresholds`. */
export const RIPE_DAYS = 21;
/** Сколько слов берёт полка за раз. */
export const SHELF_TAKE = 5;
export const PORTION_MIN = 3;
export const PORTION_MAX = 8;

export const shelfLesson = (theme: string): string => `${SHELF_LESSON_PREFIX}${theme}`;
export const jarFlag = (item: string): string => `${JAR_FLAG_PREFIX}${item}`;

export interface WolaBook {
  themes: WolaTheme[];
  /** Все слова в порядке порций (темы с `place` — в конце). */
  vocab: VocabEntry[];
  /** Слова дома (без тем с `place`): дневные порции и полка. */
  home: VocabEntry[];
  theme: ReadonlyMap<string, WolaTheme>;
  themeOf(item: string): string | undefined;
}

export function wolaBook(file: Pick<WolaVocab, 'themes' | 'vocab'>): WolaBook {
  const theme = new Map(file.themes.map((t) => [t.id, t]));
  const of = new Map(file.vocab.map((v) => [v.id, v.tags?.[0] ?? '']));
  const homeTheme = (v: VocabEntry): boolean => !theme.get(v.tags?.[0] ?? '')?.place;
  return { themes: file.themes, vocab: file.vocab, home: file.vocab.filter(homeTheme), theme, themeOf: (id) => of.get(id) };
}

/** Слова, у которых уже есть карточки (посажены: ноутбук, полка или Salad Story). */
export function planted(d: Pick<Derived, 'cards'>): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys(d.cards)) {
    const i = id.lastIndexOf('#');
    if (i > 0) out.add(id.slice(0, i));
  }
  return out;
}

const introsSince = (events: readonly LogEvent[], since: Ts): EventOf<'intro'>[] =>
  events.filter((e): e is EventOf<'intro'> => e.k === 'intro' && e.ts >= since);

/**
 * План дня (W-04): автоподстройка нового под долг огорода, как `newItemsCap` основной игры (src/systems/queue.ts),
 * но по растениям Wola: до `fullUpTo` растений к удобрению — полный потолок, дальше линейно меньше, от `noneFrom`
 * новых нет. Удобрение за день — до `fertilizeMax` растений (одним заходом «Nawóz»), остальные ждут завтра.
 */
export const PLAN = { fullUpTo: 10, noneFrom: 20, fertilizeMax: 15, horizonDays: 7 } as const;

/** Баланс, которого хватает плану дня: SRS (прогноз) и порог банки. */
export type PlanTuning = GardenTuning & SrsTuning & { productionAfterReps: number };

const DAY_MS = 86_400_000;
const TYPE_ORDER: Record<CardType, number> = { rec: 0, lis: 1, pro: 2, pair: 3 };

export interface ForecastOptions {
  t: PlanTuning;
  time?: TimeOpts;
  /** Дней вперёд (без сегодняшнего). */
  days?: number;
  /** Растений в день, которые игрок удобряет (верно). */
  perDay?: number;
  /** Уже удобрено сегодня (сегодня осталось perDay − done). */
  doneToday?: number;
  /** Сегодня посадить ещё столько новых слов (rec + lis, к удобрению завтра). */
  extra?: number;
  /** Оценка ответа в прогнозе (2 — «верно, без спешки»). */
  grade?: Grade;
  /** У слова будет карточка `pro` (порог продукции); по умолчанию да. */
  pro?: (item: string) => boolean;
}

/**
 * Прогноз огорода (W-04): сколько растений будет к удобрению в начале каждого из следующих `days` дней, если каждый
 * день удобрять до `perDay` растений верно (как «Nawóz»: одна карточка растения в день, сначала хрупкие), а сегодня
 * посадить ещё `extra` слов. Учитывает братьев (вторая карточка слова ждёт завтра) и порог `pro`. У слова Wola по
 * 2–3 карточки, первые недели оно просится под удобрение через день, поэтому долг сегодня не видит волну через 3–7 дней.
 */
export function forecastDue(cards: Readonly<Record<CardId, CardState>>, now: Ts, o: ForecastOptions): number[] {
  const t = o.t;
  const time: TimeOpts = { dayStartHour: o.time?.dayStartHour ?? t.dayStartHour, ...(o.time?.tz ? { tz: o.time.tz } : {}) };
  const perDay = o.perDay ?? PLAN.fertilizeMax;
  const grade = o.grade ?? 2;
  const items = new Map<string, Map<CardType, CardState>>();
  for (const [id, c] of Object.entries(cards)) {
    const pc = parseCardId(id);
    if (!pc || pc.type === 'pair') continue;
    let m = items.get(pc.item);
    if (!m) items.set(pc.item, (m = new Map()));
    m.set(pc.type, c);
  }
  const tomorrow = dayStartAfter(now, 1, time);
  for (let i = 0; i < (o.extra ?? 0); i++) {
    const fresh: CardState = { reps: 0, interval: 0, ef: EF_START, due: tomorrow, lapses: 0, lastReviewAt: now, lastGrade: 0, maxInterval: 0, createdAt: now };
    items.set(`\u0000new${i}`, new Map<CardType, CardState>([['rec', fresh], ['lis', { ...fresh }]]));
  }
  /** Удобрить до `n` растений в момент `at` (сначала хрупкие); вернуть, сколько растений было к удобрению. */
  const fertilize = (at: Ts, n: number): number => {
    const due: { item: string; type: CardType; c: CardState }[] = [];
    for (const [item, m] of items) {
      let best: { type: CardType; c: CardState } | null = null;
      for (const [type, c] of m) {
        if (c.due > at) continue;
        if (!best || c.interval < best.c.interval || (c.interval === best.c.interval && (c.due < best.c.due || (c.due === best.c.due && TYPE_ORDER[type] < TYPE_ORDER[best.type])))) best = { type, c };
      }
      if (best) due.push({ item, ...best });
    }
    due.sort((a, b) => a.c.interval - b.c.interval || a.c.due - b.c.due || (a.item < b.item ? -1 : 1));
    for (const x of due.slice(0, Math.max(0, n))) {
      const m = items.get(x.item)!;
      const next = review(x.c, grade, at, t, `${x.item}#${x.type}`, time);
      m.set(x.type, next);
      const rec = m.get('rec');
      if (x.type === 'rec' && rec && rec.reps >= t.productionAfterReps && !m.has('pro') && (o.pro?.(x.item) ?? true)) {
        m.set('pro', { ...next, reps: 0, interval: 0, ef: EF_START, due: dayStartAfter(at, 1, time), lapses: 0, lastGrade: 0, maxInterval: 0, createdAt: at });
      }
    }
    return due.length;
  };
  // Сегодня — остаток дневной нормы, дальше — по `perDay` в день (в полдень игрового дня).
  fertilize(now, perDay - (o.doneToday ?? 0));
  const out: number[] = [];
  for (let k = 1; k <= (o.days ?? PLAN.horizonDays); k++) out.push(fertilize(dayStartAfter(now, k, time) + DAY_MS / 3, perDay));
  return out;
}

/** Потолок новых слов на сегодня при долге огорода `debt` (растений к удобрению) и базовом потолке `base`. */
export function newCapFor(debt: number, base: number): number {
  if (debt <= PLAN.fullUpTo) return base;
  if (debt >= PLAN.noneFrom) return 0;
  return Math.max(0, Math.round((base * (PLAN.noneFrom - debt)) / (PLAN.noneFrom - PLAN.fullUpTo)));
}

/** Растений удобрено сегодня: слова, по которым сегодня был ответ обхода или экспресса (как «Удобрено» у кровати). */
export function fertilizedToday(events: readonly LogEvent[], todayStart: Ts): number {
  const items = new Set<string>();
  for (const e of events) if (e.k === 'rev' && e.ts >= todayStart && (e.src === 'obchod' || e.src === 'express')) items.add(e.card.slice(0, e.card.lastIndexOf('#')));
  return items.size;
}

export interface Portion {
  /** Размер порции (настройка). */
  size: number;
  /** Добавлено сегодня с ноутбука. */
  done: number;
  /** Сколько ещё можно добавить сегодня с ноутбука (до размера порции и пока есть слова). */
  left: number;
  /** Следующие слова порции по порядку словаря. */
  next: VocabEntry[];
  /** Новых сегодня нет из-за долга огорода (≥ PLAN.noneFrom): ноутбук пишет «Сначала огород». */
  blocked?: boolean;
}

export function portionSize(p: Progress): number {
  const n = getSetting(p, 'wola.portion');
  return Math.min(PORTION_MAX, Math.max(PORTION_MIN, Number.isFinite(n) ? Math.round(n) : 5));
}

/**
 * Дневная порция ноутбука на сегодня. С `now` (W-04) — ещё и в пределах плана дня: потолок новых по долгу огорода
 * минус уже введённые сегодня любым путём (ноутбук, полка, Salad Story). `blocked` — порция урезана долгом до нуля.
 */
export function portion(p: Progress, book: WolaBook, d: Pick<Derived, 'cards' | 'todayStart'> & Partial<Pick<Derived, 'newItemsByDay' | 'today'>>, now?: Ts, t?: GardenTuning | PlanTuning, tz?: string): Portion {
  const size = portionSize(p);
  const done = introsSince(p.log.events, d.todayStart).filter((e) => e.lesson === LAPTOP_LESSON).length;
  const have = planted(d);
  const fresh = book.home.filter((v) => !have.has(v.id));
  let left = Math.max(0, Math.min(size - done, fresh.length));
  let blocked = false;
  if (now !== undefined && d.newItemsByDay && d.today) {
    const c = dayCap(p, d as Pick<Derived, 'cards' | 'todayStart' | 'newItemsByDay' | 'today'>, now, t, tz ? { tz } : {});
    const room = Math.max(0, c.cap - c.today);
    if (room < left) {
      // «Сначала огород»: новых нет из-за огорода (долг ≥ 20 или волна в прогнозе), а не потому что потолок дня выбран.
      blocked = room === 0 && (c.debt >= PLAN.noneFrom || !!c.wave);
      left = room;
    }
  }
  return { size, done, left, next: fresh.slice(0, left), ...(blocked ? { blocked } : {}) };
}

export interface ShelfTheme {
  theme: WolaTheme;
  total: number;
  /** Взято (посажено) слов темы. */
  taken: number;
  /** Следующие до SHELF_TAKE слов темы. */
  next: VocabEntry[];
}

/** Полка «Słownik»: темы дома, сколько взято, что дальше. */
export function shelf(book: WolaBook, d: Pick<Derived, 'cards'>): ShelfTheme[] {
  const have = planted(d);
  return book.themes
    .filter((t) => !t.place)
    .map((t) => {
      const words = book.home.filter((v) => v.tags?.[0] === t.id);
      return { theme: t, total: words.length, taken: words.filter((v) => have.has(v.id)).length, next: words.filter((v) => !have.has(v.id)).slice(0, SHELF_TAKE) };
    });
}

export interface DayCap {
  /** Новых слов сегодня (любым путём: ноутбук, полка, Salad Story). */
  today: number;
  /** Потолок на сегодня: `newItemsPerDay` (4–12), с `now` — урезанный долгом огорода и прогнозом (W-04). */
  cap: number;
  /** Настройка `newItemsPerDay` без поправки на долг. */
  base: number;
  /** Долг огорода: растений к удобрению сейчас (0 без `now`). */
  debt: number;
  /** Потолок урезан прогнозом: иначе через несколько дней к удобрению станет больше PLAN.fertilizeMax. */
  wave?: boolean;
}

/**
 * Потолок новых на сегодня (W-04). Без `now` — просто настройка (как W-01). С `now`:
 *   1. правило долга (`newCapFor`): до 10 растений к удобрению — полный потолок, дальше меньше, от 20 — ноль;
 *   2. прогноз (`forecastDue`): новых не больше, чем огород выдержит — ни в один из ближайших PLAN.horizonDays дней
 *      к удобрению не станет больше PLAN.fertilizeMax при удобрении до PLAN.fertilizeMax в день.
 * Нужен `t` с SRS-балансом для прогноза; без него — только правило долга.
 */
export function dayCap(p: Progress, d: Pick<Derived, 'newItemsByDay' | 'today'> & Partial<Pick<Derived, 'cards' | 'todayStart'>>, now?: Ts, t?: GardenTuning | PlanTuning, o: { tz?: string; pro?: (item: string) => boolean } = {}): DayCap {
  const base = getSetting(p, 'newItemsPerDay');
  const today = d.newItemsByDay[d.today] ?? 0;
  if (now === undefined || !d.cards || d.todayStart === undefined) return { today, cap: base, base, debt: 0 };
  const debt = wolaGarden({ cards: d.cards, todayStart: d.todayStart }, now, t, p.world.flags).due;
  const rule = newCapFor(debt, base);
  if (!t || !('ladder' in t) || rule <= today) return { today, cap: rule, base, debt };
  // Прогноз: сколько ещё новых сегодня огород выдержит.
  const doneToday = fertilizedToday(p.log.events, d.todayStart);
  const fits = (extra: number): boolean =>
    Math.max(0, ...forecastDue(d.cards!, now, { t, ...(o.tz ? { time: { tz: o.tz } } : {}), doneToday, extra, ...(o.pro ? { pro: o.pro } : {}) })) <= PLAN.fertilizeMax;
  let room = rule - today;
  while (room > 0 && !fits(room)) room--;
  return { today, cap: today + room, base, debt, ...(today + room < rule ? { wave: true } : {}) };
}

/** Сколько ещё новых слов можно ввести сегодня (план дня). Salad Story берёт не больше этого. */
export function newLeft(c: DayCap): number {
  return Math.max(0, c.cap - c.today);
}

export interface DayPlan {
  /** Удобрить сегодня: растений к удобрению, но не больше остатка дневной нормы PLAN.fertilizeMax. */
  fertilize: number;
  /** Новых слов на ноутбуке сегодня (порция в пределах потолка по долгу). */
  fresh: number;
  /** Растений к удобрению всего (долг). */
  debt: number;
  /** Удобрено сегодня. */
  done: number;
  /** Новые закрыты долгом: «Сначала огород». */
  gardenFirst: boolean;
}

/** План на сегодня (W-04): «удобрить N, новых M» — на ноутбуке и над огородом на улице. */
export function dayPlan(p: Progress, book: WolaBook, d: Derived, now: Ts, t?: GardenTuning | PlanTuning, tz?: string): DayPlan {
  const debt = wolaGarden(d, now, t, p.world.flags).due;
  const done = fertilizedToday(p.log.events, d.todayStart);
  const fertilize = Math.min(debt, Math.max(0, PLAN.fertilizeMax - done));
  const por = portion(p, book, d, now, t, tz);
  return { fertilize, fresh: por.left, debt, done, gardenFirst: !!por.blocked };
}

/** Строка плана: «план на сегодня: удобрить 12, новых 3». */
export function planText(pl: Pick<DayPlan, 'fertilize' | 'fresh'>): string {
  return `план на сегодня: удобрить ${pl.fertilize}, новых ${pl.fresh}`;
}

/** Добавить ещё `n` — выше потолка? Тогда UI предупреждает «огород не справится», но не запрещает. */
export function overCap(c: DayCap, n: number): boolean {
  return c.today + n > c.cap;
}

// ── Огород.

export interface Plant extends GardenItem {
  /** Зрелое (интервал ≥ 21): можно собрать в банку. */
  ripe: boolean;
}

export interface WolaGarden {
  /** Растения на грядках (несобранные слова), в порядке посадки. */
  plants: Plant[];
  /** Растений с «!» (к повтору сегодня). */
  due: number;
  /** Зрелых, ждут «Zbiór». */
  ripe: number;
  /** Банки на полке дома (собранные слова), старшие первыми; `dueCard` — банку пора проверить. */
  jars: GardenItem[];
}

export function harvested(flags: Readonly<Record<string, Ts>>): Set<string> {
  const out = new Set<string>();
  for (const f of Object.keys(flags)) if (f.startsWith(JAR_FLAG_PREFIX)) out.add(f.slice(JAR_FLAG_PREFIX.length));
  return out;
}

/** Стадия растения Wola: по лучшей из карточек `rec` и `lis` (наибольший maxInterval, потом reps). */
export function wolaStage(cards: Derived['cards'], item: string, t?: GardenTuning): GardenItem['stage'] {
  let top: CardState | undefined;
  for (const c of [cards[`${item}#rec`], cards[`${item}#lis`]]) {
    if (!c) continue;
    if (!top || c.maxInterval > top.maxInterval || (c.maxInterval === top.maxInterval && c.reps > top.reps)) top = c;
  }
  return plantStage(top, t);
}

export function wolaGarden(d: Pick<Derived, 'cards' | 'todayStart'>, now: Ts, t: GardenTuning | undefined, flags: Readonly<Record<string, Ts>>): WolaGarden {
  const all = gardenItems(d, now, t);
  const jarSet = harvested(flags);
  // Растение растёт от любого удобрения (ВОЛЯ.md п. 7): стадия — по лучшей из карточек узнавания и слуха, а не только
  // по `rec` (экспресс часто берёт `lis`, и посаженное вчера семя иначе осталось бы семенем после удобрения).
  const best = (item: string): GardenItem['stage'] => wolaStage(d.cards, item, t);
  const plants: Plant[] = all
    .filter((g) => !jarSet.has(g.item))
    .map((g) => {
      const stage = best(g.item);
      return { ...g, stage, ripe: stage === 'jar' };
    });
  const jars = all.filter((g) => jarSet.has(g.item)).sort((a, b) => (flags[jarFlag(a.item)] ?? 0) - (flags[jarFlag(b.item)] ?? 0));
  return { plants, due: plants.filter((g) => g.dueCard).length, ripe: plants.filter((g) => g.ripe).length, jars };
}

/** «Zbiór»: зрелое слово в банку (флаг монотонный). Незрелое не собирается. */
export function harvest(p: Progress, g: Pick<Plant, 'item' | 'ripe'>, now: Ts): Progress {
  return g.ripe ? setFlag(p, jarFlag(g.item), now) : p;
}

// ── Хаб: счётчики на местах.

export interface HubCounters {
  /** Дома: сколько новых слов ждёт на ноутбуке сегодня (в пределах плана дня). */
  dom: number;
  /** План дня (W-04): «удобрить N, новых M» над огородом. */
  plan?: DayPlan;
  /** Огород: растений к удобрению. */
  due: number;
  /** Огород: зрелых к сбору. */
  ripe: number;
  /** Банок на полке пора проверить. */
  jarsDue: number;
  /** Salad Story (W-02): «уровень N» или «новое блюдо дня». */
  salad?: { text: string; due?: boolean };
}

export function hubCounters(p: Progress, book: WolaBook, d: Derived, now: Ts, t: GardenTuning | PlanTuning, tz?: string): HubCounters {
  const g = wolaGarden(d, now, t, p.world.flags);
  const plan = dayPlan(p, book, d, now, t, tz);
  return { dom: plan.fresh, plan, due: g.due, ripe: g.ripe, jarsDue: g.jars.filter((j) => j.dueCard).length };
}

// ── Итог дня у кровати.

export interface WolaDay extends DaySummary {
  /** Добавлено сегодня: ноутбук и полка (все intro дня). */
  added: string[];
  /** Удобрено растений (полив обхода и экспресса, как Obchód основной игры). */
  fertilized: number;
  /** Растения, сменившие стадию сегодня (по стадии Wola: лучшая из rec и lis). */
  grewWola: { item: string; from: GardenItem['stage']; to: GardenItem['stage'] }[];
  /** Собрано в банки сегодня. */
  harvestedToday: string[];
  /** Salad Story (W-02): визитов сегодня; слова, повторённые на кассе (тоже удобрение). */
  saladVisits: number;
  saladWords: string[];
}

const RANK: Record<GardenItem['stage'], number> = { seed: 0, sprout: 1, bush: 2, jar: 3 };

export function wolaDay(p: Progress, dc: DeriveContent, now: Ts, tz?: string): WolaDay {
  const s = summarizeDay(p, dc, now, tz);
  const start = dayStart(now, { dayStartHour: dc.dayStartHour ?? dc.tuning?.dayStartHour, tz });
  const after = derive(p, dc, now, tz);
  const before = derive({ ...p, log: { ...p.log, events: p.log.events.filter((e) => e.ts < start) } }, dc, start - 1, tz);
  const gt = dc.tuning as GardenTuning | undefined;
  const planted = new Set(s.planted);
  const grewWola: WolaDay['grewWola'] = [];
  for (const item of new Set(Object.keys(after.cards).map((c) => c.slice(0, c.lastIndexOf('#'))))) {
    if (planted.has(item) || !before.cards[`${item}#rec`]) continue;
    const from = wolaStage(before.cards, item, gt);
    const to = wolaStage(after.cards, item, gt);
    if (RANK[to] > RANK[from]) grewWola.push({ item, from, to });
  }
  const harvestedToday = Object.entries(p.world.flags)
    .filter(([f, ts]) => f.startsWith(JAR_FLAG_PREFIX) && ts >= start && ts <= now)
    .sort((a, b) => a[1] - b[1])
    .map(([f]) => f.slice(JAR_FLAG_PREFIX.length));
  // Salad Story (W-02): ответы на кассе (`src: 'order'`) удобряют растения так же, как обход.
  const today = p.log.events.filter((e) => e.ts >= start && e.ts <= now);
  const itemOf = (card: string): string => card.slice(0, card.lastIndexOf('#'));
  const watered = new Set(today.filter((e): e is EventOf<'rev'> => e.k === 'rev' && (e.src === 'obchod' || e.src === 'express')).map((e) => itemOf(e.card)));
  const saladWords = [...new Set(today.filter((e): e is EventOf<'rev'> => e.k === 'rev' && e.src === 'order').map((e) => itemOf(e.card)))];
  const extra = saladWords.filter((w) => !watered.has(w)).length;
  const saladVisits = today.filter((e) => e.k === 'visit').length;
  return { ...s, added: s.planted, fertilized: s.plants + extra, grewWola, harvestedToday, saladVisits, saladWords, empty: s.empty && !saladVisits };
}
