// Петля короткой версии «Wola» (W-01, ../ВОЛЯ.md решения 5–7): чистые функции от прогресса и словаря Wola.
//   • дом, ноутбук «Słowniczek»: дневная порция (настройка `wola.portion`, 5) — следующие слова по порядку словаря;
//     «Dodaj» = событие `intro` (lesson `wola.laptop`), слово семечком уходит в огород;
//   • дом, полка «Słownik»: темы-наборы, по 5 слов сверх порции (lesson `wola.slownik.<тема>`);
//   • мягкий потолок новых слов в день (`newItemsPerDay`, 8, 4–12): сверх — предупреждение, не запрет;
//   • огород: растения = слова (garden.ts), «!» = карточка к повтору, зрелое = интервал ≥ 21 дня (порог банки
//     в tuning Wola) → «Zbiór» ставит флаг `wola.jar.<слово>`, банка уходит на полку дома;
//   • итог дня у кровати: добавлено, удобрено, собрано, минуты.
// Время приходит параметром, ничего не пишет: события и флаги пишет UI.
import type { VocabEntry, WolaTheme, WolaVocab } from '../../types/content';
import { derive, type DeriveContent, type Derived } from '../../systems/derive';
import { gardenItems, plantStage, type GardenItem, type GardenTuning } from '../../systems/garden';
import type { EventOf, LogEvent } from '../../systems/log';
import { getSetting, setFlag, type CardState, type Progress, type Ts } from '../../systems/progress';
import { summarizeDay, type DaySummary } from '../../systems/session';
import { dayStart } from '../../systems/time';

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

export interface Portion {
  /** Размер порции (настройка). */
  size: number;
  /** Добавлено сегодня с ноутбука. */
  done: number;
  /** Сколько ещё можно добавить сегодня с ноутбука (до размера порции и пока есть слова). */
  left: number;
  /** Следующие слова порции по порядку словаря. */
  next: VocabEntry[];
}

export function portionSize(p: Progress): number {
  const n = getSetting(p, 'wola.portion');
  return Math.min(PORTION_MAX, Math.max(PORTION_MIN, Number.isFinite(n) ? Math.round(n) : 5));
}

/** Дневная порция ноутбука на сегодня. */
export function portion(p: Progress, book: WolaBook, d: Pick<Derived, 'cards' | 'todayStart'>): Portion {
  const size = portionSize(p);
  const done = introsSince(p.log.events, d.todayStart).filter((e) => e.lesson === LAPTOP_LESSON).length;
  const have = planted(d);
  const fresh = book.home.filter((v) => !have.has(v.id));
  const left = Math.max(0, Math.min(size - done, fresh.length));
  return { size, done, left, next: fresh.slice(0, left) };
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
  /** Мягкий потолок (`newItemsPerDay`, 4–12). */
  cap: number;
}

export function dayCap(p: Progress, d: Pick<Derived, 'newItemsByDay' | 'today'>): DayCap {
  return { today: d.newItemsByDay[d.today] ?? 0, cap: getSetting(p, 'newItemsPerDay') };
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

export function wolaGarden(d: Pick<Derived, 'cards' | 'todayStart'>, now: Ts, t: GardenTuning, flags: Readonly<Record<string, Ts>>): WolaGarden {
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
  /** Дома: сколько новых слов ждёт на ноутбуке сегодня. */
  dom: number;
  /** Огород: растений к удобрению. */
  due: number;
  /** Огород: зрелых к сбору. */
  ripe: number;
  /** Банок на полке пора проверить. */
  jarsDue: number;
}

export function hubCounters(p: Progress, book: WolaBook, d: Derived, now: Ts, t: GardenTuning): HubCounters {
  const g = wolaGarden(d, now, t, p.world.flags);
  return { dom: portion(p, book, d).left, due: g.due, ripe: g.ripe, jarsDue: g.jars.filter((j) => j.dueCard).length };
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
  return { ...s, added: s.planted, fertilized: s.plants, grewWola, harvestedToday };
}
