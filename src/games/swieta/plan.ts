// Игра «Święta»: раунд про один праздник — какие задания и в каком порядке. Чистая логика без DOM.
// Первый раз (после рассказа): картина или предмет → дата → обычай из карточки → сцена или магазины → пожелание «сам». Дальше 5 разных заданий:
// «что за праздник» (картина, предмет, обычай или дата), обычай, два «вспомнить» (дата, магазины, сцена) и одно «сам».
import type { GameCtx, PolskaUnit } from '../../types/polska';
import { shuffle } from '../kit';
import { shownCustoms } from './story';
import { customChoiceTask, customTilesTask, customsOf, maskedCustoms, packSpec, packTask, picTask, shopsTask, whatTask, whenTask, wishTask, type SwTask } from './tasks';
import type { WheelNode } from './wheel';

export type Slot = 'pic' | 'clue' | 'mask' | 'date' | 'custom' | 'when' | 'shops' | 'pack' | 'wish' | 'tiles';

export const ROUND_MIN = 3;
export const ROUND_MAX = 6;

const has = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/** Какие задания вообще есть у этого праздника (для узла без картины — без `pic`). */
export function slotsOf(ctx: GameCtx, u: PolskaUnit, node: WheelNode | null): Slot[] {
  const out: Slot[] = [];
  if (node?.img && node.pic) out.push('pic');
  if (has(u.raw.clue)) out.push('clue');
  if (maskedCustoms(u).length) out.push('mask');
  if (whatTask(ctx, u, 'date')?.variant === 'date') out.push('date');
  if (customsOf(u).length) out.push('custom');
  if (whenTask(ctx, u)) out.push('when');
  if (shopsTask(ctx, u)) out.push('shops');
  if (packSpec(u)) out.push('pack');
  if ((u.raw.wish as { pl?: unknown } | undefined)?.pl) out.push('wish');
  if (customsOf(u).length && customTilesTask(ctx, u)) out.push('tiles');
  return out;
}

/** Задание по слоту. `first` — раунд после рассказа: обычаи только те, что были в карточке. */
function make(ctx: GameCtx, u: PolskaUnit, node: WheelNode | null, slot: Slot, first: boolean, self = false): SwTask | null {
  switch (slot) {
    case 'pic':
      return node?.img && node.pic ? picTask(ctx, u, { img: node.img, credit: node.credit }) : null;
    case 'clue':
      return has(u.raw.clue) ? whatTask(ctx, u, 'clue') : null;
    case 'mask': {
      const t = maskedCustoms(u).length ? whatTask(ctx, u, 'custom') : null;
      return t?.variant === 'custom' ? t : null;
    }
    case 'date': {
      const t = whatTask(ctx, u, 'date');
      return t?.variant === 'date' ? t : null;
    }
    case 'custom':
      return customChoiceTask(ctx, u, first ? shownCustoms(u) : undefined);
    case 'when':
      return whenTask(ctx, u);
    case 'shops':
      return shopsTask(ctx, u);
    case 'pack':
      return packTask(ctx, u, self);
    case 'wish':
      return wishTask(ctx, u, first ? false : undefined);
    case 'tiles':
      return customTilesTask(ctx, u, first ? shownCustoms(u) : undefined);
  }
}

/** Задание «сам»: пожелание, обычай из плиток или сцена; без него кустик не созреет. */
function selfTask(ctx: GameCtx, u: PolskaUnit, node: WheelNode | null, first: boolean, avoidPack: boolean): SwTask | null {
  const order: Slot[] = [];
  const wish = (u.raw.wish as { pl?: unknown } | undefined)?.pl ? ('wish' as const) : null;
  if (wish) order.push(wish);
  order.push('tiles');
  if (!avoidPack) order.push('pack');
  // Без пожелания чаще берём обычай, с пожеланием — пожелание (оно же в карточке).
  const pick = order[0] === 'wish' || ctx.rand() < 0.5 ? order : [...order].reverse();
  for (const slot of pick) {
    const t = make(ctx, u, node, slot, first, true);
    if (t) return { ...t, self: true };
  }
  return null;
}

/** Раунд про один праздник: 3–6 заданий. */
export function buildRound(ctx: GameCtx, u: PolskaUnit, node: WheelNode | null, first: boolean): SwTask[] {
  const out: SwTask[] = [];
  const used = new Set<Slot>();
  const take = (slot: Slot): boolean => {
    if (used.has(slot)) return false;
    const t = make(ctx, u, node, slot, first);
    if (!t) return false;
    used.add(slot);
    out.push(t);
    return true;
  };
  const avail = slotsOf(ctx, u, node);
  const can = (s: Slot): boolean => avail.includes(s);
  let packUsed = false;
  if (first) {
    // Порядок рассказа: картина (или предмет) → когда → обычай → сцена или магазины.
    take(can('pic') ? 'pic' : 'clue') || take('clue');
    take('when');
    take('custom');
    if (can('pack')) packUsed = take('pack');
    take('shops');
  } else {
    const what = shuffle((['pic', 'clue', 'mask', 'date'] as Slot[]).filter(can), ctx.rand);
    for (const s of what) if (take(s)) break;
    take('custom');
    const b = shuffle((['when', 'shops', 'pack'] as Slot[]).filter(can), ctx.rand);
    let n = 0;
    for (const s of b) {
      if (n >= 2) break;
      if (take(s)) {
        n++;
        if (s === 'pack') packUsed = true;
      }
    }
  }
  const cap = first ? 4 : ROUND_MAX - 1;
  out.length = Math.min(out.length, cap);
  const me = selfTask(ctx, u, node, first, packUsed);
  if (me) out.push(me);
  // Не набралось до минимума (мало данных у праздника): добираем любыми другими.
  for (const s of shuffle(avail, ctx.rand)) {
    if (out.length >= ROUND_MIN) break;
    take(s);
  }
  return out.slice(0, ROUND_MAX);
}

// ---------- очередь заданий текущего раунда ----------

/** Раунд, который ведёт колесо: задания про один праздник, готовые заранее (движок просит их по одному через `nextTask`). */
let session: { id: string; queue: SwTask[] } | null = null;

export function startSession(id: string, tasks: readonly SwTask[]): void {
  session = { id, queue: [...tasks] };
}
export function clearSession(): void {
  session = null;
}
/** Следующее задание очереди этого праздника; null — очереди нет или она кончилась (тогда игра отдаёт обычное задание по просьбе движка). */
export function takeTask(id: string): SwTask | null {
  if (!session || session.id !== id) return null;
  const t = session.queue.shift() ?? null;
  if (!session.queue.length) session = null;
  return t;
}
