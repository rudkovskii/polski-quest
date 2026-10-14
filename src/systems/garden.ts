// Растения działki и банки (ТЗ §4.10 «Растения działki», §4.13, §5.5): чистые функции от выведенных
// карточек. Растение = слово, стадия по его карточке `rec`; «!» = у слова есть карточка к поливу
// (due ≤ now, не фонетика, не придержана братом); подвявшее = просрочено больше WILT_DAYS дней.
// Банка (słoik): rec.maxInterval ≥ первого порога `tuning.jars.thresholds` (35), стадия по maxInterval.
// Только визуал и список подвала: трата банок (заказы, кухня) — I-19/I-45.
import type { Tuning } from '../types/content';
import type { Derived } from './derive';
import type { CardId, CardState, CardType } from './progress';
import { cardId, parseCardId } from './srs';
import type { Ts } from './time';

export type PlantStage = 'seed' | 'sprout' | 'bush' | 'jar';
export type JarStage = 'mlody' | 'dojrzaly' | 'stary';

/** Просрочено больше стольких игровых дней → растение подвявшее (§4.10). */
export const WILT_DAYS = 2;
const DAY_MS = 86_400_000;
/** Росток делится на маленький (interval 1–2) и большой (3–6): так на грядке видно 1 → 3 → 7. */
export const SPROUT_BIG_FROM = 3;
export const BUSH_FROM = 7;
const DEFAULT_JAR_FROM = 35;

export type GardenTuning = Pick<Tuning, 'jars'>;

/** Порог зрелости банки: первый порог `jars.thresholds` (35). */
export function jarFrom(t?: GardenTuning): number {
  return t?.jars.thresholds[0] ?? DEFAULT_JAR_FROM;
}

/**
 * Стадия растения по карточке `rec` (§4.10): семя (reps 0, ничего не вспомнено), росток (interval 1–6),
 * куст (7–34), банка (maxInterval ≥ 35, монотонно: банка не «откатывается» после ошибки).
 */
export function plantStage(rec: Pick<CardState, 'reps' | 'interval' | 'maxInterval'> | undefined, t?: GardenTuning): PlantStage {
  if (!rec) return 'seed';
  if (rec.maxInterval >= jarFrom(t)) return 'jar';
  if (rec.interval >= BUSH_FROM) return 'bush';
  if (rec.interval >= 1 || rec.reps > 0) return 'sprout';
  return 'seed';
}

const STAGE_RANK: Record<PlantStage, number> = { seed: 0, sprout: 1, bush: 2, jar: 3 };
export function stageRank(s: PlantStage): number {
  return STAGE_RANK[s];
}

/** Стадия банки по maxInterval (§4.10): 35 młody, 90 dojrzały, 180 stary; ниже порога банки нет. */
export function jarStage(maxInterval: number, t?: GardenTuning): JarStage | null {
  const [a = 35, b = 90, c = 180] = t?.jars.thresholds ?? [];
  if (maxInterval >= c) return 'stary';
  if (maxInterval >= b) return 'dojrzaly';
  if (maxInterval >= a) return 'mlody';
  return null;
}

export interface GardenItem {
  item: string;
  stage: PlantStage;
  /** Интервал rec в днях (0 у семени); у слова без rec — наибольший из его карточек. */
  interval: number;
  /** Карточка к поливу сегодня; нет — слово не due (или придержано братом до завтра). */
  dueCard: CardId | null;
  /** Насколько просрочен полив, игровых дней (0 — due сегодня или не due). */
  overdueDays: number;
  wilted: boolean;
  /** Ближайший срок любой карточки слова. */
  nextDue: Ts;
  /** Когда слово посажено (самая ранняя карточка). */
  plantedAt: Ts;
  lastReviewAt: Ts;
  /** Банка есть (зрелость монотонна). */
  jar: JarStage | null;
}

/** Порядок типов при выборе карточки полива одного слова: сначала узнавание, потом слух, потом речь. */
const TYPE_ORDER: Record<CardType, number> = { rec: 0, lis: 1, pro: 2, pair: 3 };

/**
 * Растения всех посаженных слов. Братья (§4.2): если сегодня уже отвечали по одной карточке слова,
 * другие его карточки ждут завтра — у такого слова нет «!».
 */
export function gardenItems(state: Pick<Derived, 'cards' | 'todayStart'>, now: Ts, t?: GardenTuning): GardenItem[] {
  const byItem = new Map<string, { id: CardId; type: CardType; c: CardState }[]>();
  for (const [id, c] of Object.entries(state.cards)) {
    const p = parseCardId(id);
    if (!p || p.type === 'pair') continue;
    let list = byItem.get(p.item);
    if (!list) byItem.set(p.item, (list = []));
    list.push({ id, type: p.type, c });
  }
  const out: GardenItem[] = [];
  for (const [item, list] of byItem) {
    const rec = state.cards[cardId(item, 'rec')];
    const touchedToday = list.filter((x) => x.c.lastReviewAt > x.c.createdAt && x.c.lastReviewAt >= state.todayStart).map((x) => x.type);
    const due = list
      .filter((x) => x.c.due <= now && touchedToday.every((ty) => ty === x.type))
      .sort((a, b) => a.c.interval - b.c.interval || a.c.due - b.c.due || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
    const first = due[0];
    // Просрочка в игровых днях: due — начало дня (04:00), считаем от начала сегодняшнего.
    const overdue = first ? Math.max(0, Math.round((state.todayStart - first.c.due) / DAY_MS)) : 0;
    const maxInterval = Math.max(0, ...list.map((x) => (x.type === 'rec' ? x.c.maxInterval : 0)));
    out.push({
      item,
      stage: plantStage(rec ?? { reps: Math.max(...list.map((x) => x.c.reps)), interval: Math.max(...list.map((x) => x.c.interval)), maxInterval: 0 }, t),
      interval: rec ? rec.interval : Math.max(...list.map((x) => x.c.interval)),
      dueCard: first?.id ?? null,
      overdueDays: overdue,
      wilted: overdue > WILT_DAYS,
      nextDue: Math.min(...list.map((x) => x.c.due)),
      plantedAt: Math.min(...list.map((x) => x.c.createdAt)),
      lastReviewAt: Math.max(...list.map((x) => x.c.lastReviewAt)),
      jar: jarStage(maxInterval, t),
    });
  }
  return out.sort((a, b) => a.plantedAt - b.plantedAt || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
}

/** Подвал (spiżarnia, список): слова с банкой, старшие банки первыми. */
export function cellar(items: readonly GardenItem[]): GardenItem[] {
  const rank: Record<JarStage, number> = { stary: 0, dojrzaly: 1, mlody: 2 };
  return items.filter((x) => x.jar).sort((a, b) => rank[a.jar!] - rank[b.jar!] || a.plantedAt - b.plantedAt);
}
