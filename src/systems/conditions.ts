// Вычислитель условий (ТЗ §3.9, I-13 вместо condLite из I-08 и passportCond из I-11): чистая функция
// `evaluate(cond, ctx)` поверх производного состояния (§3.10), монотонного `world` и часов. Без побочных
// эффектов; время и контент приходят в контексте. Здесь же — что условия значат для уроков:
// `requires` (закрыт), `skipIf` (пропуск), `short.if` (короткая версия), §3.5, §4.3.
import type { Condition, Lesson, Step } from '../types/content';
import type { Content } from './content';
import { variantSteps, type RepairVariant } from './clusters';
import type { Derived } from './derive';
import type { WorldState } from './progress';
import { storyDay } from './pace';
import { cardId, parseCardId } from './srs';
import { isoWeekday, type TimeOpts, type Ts } from './time';

/** Отрезки дня, которые закрывают атом `stepDone` (§3.9): экспресс и «ещё 3 минуты» — тоже полив. */
const STEP_SEGS: Record<'water' | 'scene' | 'evening' | 'sleep', readonly string[]> = {
  water: ['water', 'express', 'more3'],
  scene: ['scene'],
  evening: ['evening'],
  sleep: ['sleep'],
};

/** Первый порог банки по умолчанию (tuning.jars.thresholds[0], §4.10). */
export const DEFAULT_JAR_FROM = 35;
/** «Освоено» в атоме `mastery` (§3.9): rec.interval ≥ 7 и lastGrade ≥ 2. */
export const MASTERED_INTERVAL = 7;

export interface CondCtx {
  derived: Pick<Derived, 'today' | 'lessonsDone' | 'bossResults' | 'cards' | 'clusterStatus' | 'daysPlayed' | 'daysSinceLast' | 'found' | 'days' | 'jars'>;
  world: Pick<WorldState, 'flags' | 'items' | 'unlocked'>;
  now: Ts;
  /** srs-слова модуля (для `mastery`); нет — атом ложен. */
  moduleItems?: (module: string) => readonly string[];
  /** Модуль слова (для `jars.module`). */
  itemModule?: (item: string) => string | undefined;
  /** Порог банки, дни (tuning.jars.thresholds[0]). */
  jarFrom?: number;
  /** Граница игрового дня для атома `gameDay` (tuning.dayStartHour, пояс устройства). */
  time?: TimeOpts;
  /** Неизвестный атом (контент новее движка): по умолчанию молча false. */
  onUnknown?: (c: Condition) => void;
}

/** Контекст из полного контента: модули слов, порог банок. */
export function condCtx(content: Pick<Content, 'modules' | 'vocab' | 'tuning'>, derived: CondCtx['derived'], world: CondCtx['world'], now: Ts): CondCtx {
  const byModule = new Map<string, string[]>();
  for (const [id, b] of content.modules) byModule.set(id, b.vocab.filter((v) => v.srs).map((v) => v.id));
  return {
    derived,
    world,
    now,
    moduleItems: (m) => byModule.get(m) ?? [],
    itemModule: (item) => content.vocab.get(item)?.module,
    jarFrom: content.tuning.jars.thresholds[0] ?? DEFAULT_JAR_FROM,
    time: { dayStartHour: content.tuning.dayStartHour },
  };
}

/** Доля srs-слов модуля: `seen` — есть хоть одна карточка; `mastered` — rec.interval ≥ 7 и lastGrade ≥ 2. */
export function masteryShare(ctx: CondCtx, module: string, level: 'seen' | 'mastered'): number {
  const items = ctx.moduleItems?.(module) ?? [];
  if (!items.length) return 0;
  const cards = ctx.derived.cards;
  let n = 0;
  for (const item of items) {
    if (level === 'seen') {
      if (cards[cardId(item, 'rec')] || cards[cardId(item, 'lis')] || cards[cardId(item, 'pro')]) n++;
    } else {
      const rec = cards[cardId(item, 'rec')];
      if (rec && rec.interval >= MASTERED_INTERVAL && rec.lastGrade >= 2) n++;
    }
  }
  return n / items.length;
}

/**
 * Банки (§4.13): из `derived.jars`, когда его заполнит I-19; до тех пор — rec с maxInterval ≥ порога
 * (зрелость монотонна), и все зрелые банки полные (трат ещё нет: заказы и кухня — этап 3).
 */
export function jarCount(ctx: CondCtx, o: { module?: string; full?: boolean } = {}): number {
  const fromDerived = Object.entries(ctx.derived.jars);
  const inModule = (item: string): boolean => !o.module || ctx.itemModule?.(item) === o.module;
  if (fromDerived.length) return fromDerived.filter(([item, j]) => j.matured && (!o.full || j.full) && inModule(item)).length;
  const from = ctx.jarFrom ?? DEFAULT_JAR_FROM;
  let n = 0;
  for (const [id, c] of Object.entries(ctx.derived.cards)) {
    const p = parseCardId(id);
    if (p?.type === 'rec' && c.maxInterval >= from && inModule(p.item)) n++;
  }
  return n;
}

/** Сегодня (игровой день) в окне MM-DD…MM-DD, окно может идти через Новый год. */
export function inDateWindow(today: string, from: string, to: string): boolean {
  const md = today.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

export function evaluate(c: Condition, ctx: CondCtx): boolean {
  const d = ctx.derived;
  if (c.always !== undefined) return c.always === true;
  if (c.all !== undefined) return c.all.every((x) => evaluate(x, ctx));
  if (c.any !== undefined) return c.any.some((x) => evaluate(x, ctx));
  if (c.not !== undefined) return !evaluate(c.not, ctx);
  if (c.flag !== undefined) return c.flag in ctx.world.flags;
  if (c.item !== undefined) return c.item in ctx.world.items;
  if (c.lessonDone !== undefined) return d.lessonsDone.has(c.lessonDone);
  if (c.bossPassed !== undefined) return d.bossResults[c.bossPassed]?.passedAt !== undefined;
  if (c.mastery !== undefined) return masteryShare(ctx, c.mastery.module, c.mastery.level) >= c.mastery.min;
  if (c.cards !== undefined) {
    let n = 0;
    for (const [id, card] of Object.entries(d.cards)) if (parseCardId(id)?.type !== 'pair' && card.interval >= c.cards.minInterval) n++;
    return n >= c.cards.min;
  }
  if (c.cluster !== undefined) return (d.clusterStatus[c.cluster.id] ?? 'unknown') === c.cluster.status;
  if (c.daysPlayed !== undefined) return d.daysPlayed >= c.daysPlayed;
  if (c.dateWindow !== undefined) return inDateWindow(d.today, c.dateWindow.from, c.dateWindow.to);
  if (c.weekday !== undefined) return c.weekday.includes(isoWeekday(d.today));
  if (c.stage !== undefined) return (ctx.world.unlocked[c.stage.biome]?.stage ?? 0) >= c.stage.min;
  if (c.found !== undefined) return d.found.has(c.found);
  if (c.jars !== undefined) return jarCount(ctx, { ...(c.jars.module ? { module: c.jars.module } : {}), ...(c.jars.full ? { full: true } : {}) }) >= c.jars.min;
  if (c.hud !== undefined) return `hud.${c.hud}` in ctx.world.flags;
  if (c.daysSinceLast !== undefined) return d.daysSinceLast !== null && d.daysSinceLast >= c.daysSinceLast;
  if (c.gameDay !== undefined) {
    const n = storyDay(d, ctx.world.flags, ctx.time);
    return (c.gameDay.min === undefined || n >= c.gameDay.min) && (c.gameDay.max === undefined || n <= c.gameDay.max);
  }
  if (c.stepDone !== undefined) {
    const segs = d.days[d.today]?.segs ?? [];
    return STEP_SEGS[c.stepDone].some((s) => segs.includes(s as never));
  }
  ctx.onUnknown?.(c);
  return false;
}

/** Замыкание для UI (диалоги, карта): `cond(c)`. */
export function evaluator(ctx: CondCtx): (c: Condition) => boolean {
  return (c) => evaluate(c, ctx);
}

// ── Уроки (§3.5, §4.3): requires → закрыт, skipIf → пропуск, short.if → короткая версия.

/**
 * Вариант урока: `locked` — `requires` ложно; `skip` — `skipIf` истинно (ремонт зелёного кластера);
 * `short` — `short.if` истинно (жёлтый); иначе `full`. Для ремонтных сцен 1.1–1.10 совпадает с
 * `repairVariant(clusterStatus)` из clusters.ts (тест в conditions.test.ts).
 */
export function lessonVariant(lesson: Pick<Lesson, 'requires' | 'skipIf' | 'short'>, ctx: CondCtx): RepairVariant {
  if (lesson.requires && !evaluate(lesson.requires, ctx)) return 'locked';
  if (lesson.skipIf && evaluate(lesson.skipIf, ctx)) return 'skip';
  if (lesson.short && evaluate(lesson.short.if, ctx)) return 'short';
  return 'full';
}

/**
 * Урок в варианте: для `short` — только `short.steps` (через variantSteps), шаги сохраняют исходные
 * id `<lessonId>#<i>` (по ним озвучка из манифеста). `full` — тот же объект. skip/locked — null.
 */
export function lessonOfVariant(lesson: Lesson, variant: RepairVariant): Lesson | null {
  if (variant === 'skip' || variant === 'locked') return null;
  if (variant === 'full' || !lesson.steps) return lesson;
  const all = lesson.steps;
  const idx = variantSteps(all.length, variant, lesson.short?.steps);
  if (idx.length === all.length || !idx.length) return lesson;
  const steps = idx.map((i) => ({ ...all[i]!, id: all[i]!.id ?? `${lesson.id}#${i}` }) as Step);
  return { ...lesson, steps: steps as [Step, ...Step[]] };
}
