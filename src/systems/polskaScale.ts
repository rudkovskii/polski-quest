// Шкала «Wiedza o Polsce» (решение Шэфа 3): своя, отдельно от пути к A1 (`systems/xp.ts` её не видит и не меняется от неё).
// Выводится из огорода v2: выращенная единица 1 очко, растущая (после первого ответа) частично — семечко 0,1 / росток 0,3 / кустик 0,6.
// 10 уровней по доле всех единиц v2; 4 полоски по играм и медали за 50 % и 100 % урожая игры.
// Бонусный опыт за закрытый набор (воеводство, куплет +25; месяц +10; сезон праздников +25) — только в опыт v2, не в очки шкалы.
import type { PolskaGameId, PolskaUnit } from '../types/polska';
import type { ItemState } from './garden';
import { gameOfKind } from './v2content';
import { plotMap, type PlotRef } from './zagroda';

export interface PolskaLevel {
  n: number;
  pl: string;
  ru: string;
  /** Доля всех единиц v2 (с частичным зачётом), с которой начинается уровень. */
  at: number;
}

export const POLSKA_LEVELS: readonly PolskaLevel[] = [
  { n: 0, pl: 'Przybysz', ru: 'Новичок', at: 0 },
  { n: 1, pl: 'Turysta', ru: 'Турист', at: 0.02 },
  { n: 2, pl: 'Gość', ru: 'Гость', at: 0.05 },
  { n: 3, pl: 'Sąsiad', ru: 'Сосед', at: 0.1 },
  { n: 4, pl: 'Bywalec', ru: 'Завсегдатай', at: 0.18 },
  { n: 5, pl: 'Znajomy Polski', ru: 'Знакомый Польши', at: 0.28 },
  { n: 6, pl: 'Mieszkaniec', ru: 'Житель', at: 0.4 },
  { n: 7, pl: 'Znawca', ru: 'Знаток', at: 0.55 },
  { n: 8, pl: 'Przewodnik', ru: 'Экскурсовод', at: 0.7 },
  { n: 9, pl: 'Ekspert', ru: 'Эксперт', at: 0.85 },
  { n: 10, pl: 'Ambasador Polski', ru: 'Посол Польши', at: 1 },
];

export const POLSKA_PARTIAL = { seed: 0.1, sprout: 0.3, bush: 0.6 } as const;
export const GROUP_BONUS: Readonly<Record<string, number>> = { voi: 25, stanza: 25, month: 10, season: 25, symbols: 25 };

export interface PolskaGameBar {
  game: PolskaGameId;
  units: number;
  grown: number;
  growing: number;
  /** Доля выращенного, 0…1. */
  pct: number;
  /** Медаль: 0 — нет, 50 — половина урожая, 100 — вся игра. */
  medal: 0 | 50 | 100;
}

export interface PolskaScale {
  /** 0…10. */
  sub: number;
  of: number;
  pl: string;
  ru: string;
  /** 0…1 внутри уровня. */
  ratio: number;
  /** Непрерывная позиция sub + ratio (для «+0,3» в итоге раунда). */
  pos: number;
  points: number;
  total: number;
  grown: number;
  pct: number;
  games: Record<PolskaGameId, PolskaGameBar>;
  /** Закрытые наборы (группы) и бонус опыта за них. */
  groupsDone: number;
  bonusXp: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Шкала по единицам v2 и состоянию огорода v2. Чистая функция. */
export function polskaScale(units: readonly PolskaUnit[], items: ReadonlyMap<string, ItemState>, refs: Map<string, PlotRef> = plotMap(units)): PolskaScale {
  const games = {} as Record<PolskaGameId, PolskaGameBar>;
  for (const g of ['geo', 'hymn', 'daty', 'swieta'] as PolskaGameId[]) games[g] = { game: g, units: 0, grown: 0, growing: 0, pct: 0, medal: 0 };
  let grown = 0;
  let partial = 0;
  const groups = new Map<string, { n: number; grown: number }>();
  for (const u of units) {
    const bar = games[gameOfKind(u.kind)];
    bar.units++;
    const it = items.get(u.id);
    const ref = refs.get(u.id);
    const gr = ref ? (groups.get(ref.group) ?? { n: 0, grown: 0 }) : null;
    if (gr && ref) {
      gr.n++;
      groups.set(ref.group, gr);
    }
    if (!it) continue;
    if (it.harvests > 0) {
      grown++;
      bar.grown++;
      if (gr) gr.grown++;
      continue;
    }
    if (it.stage === null) continue;
    bar.growing++;
    if (it.answers > 0) partial += POLSKA_PARTIAL[it.stage];
  }
  for (const b of Object.values(games)) {
    b.pct = b.units ? b.grown / b.units : 0;
    b.medal = b.units && b.grown >= b.units ? 100 : b.units && b.grown * 2 >= b.units ? 50 : 0;
  }
  let groupsDone = 0;
  let bonusXp = 0;
  for (const [key, g] of groups) {
    if (g.n === 0 || g.grown < g.n) continue;
    groupsDone++;
    bonusXp += GROUP_BONUS[key.split(':')[0]!] ?? 0;
  }
  const total = units.length;
  const points = round2(Math.min(total, grown + partial));
  const pct = total ? points / total : 0;
  let sub = 0;
  while (sub + 1 < POLSKA_LEVELS.length && pct >= POLSKA_LEVELS[sub + 1]!.at && (sub + 1 < POLSKA_LEVELS.length - 1 || grown >= total)) sub++;
  const lo = POLSKA_LEVELS[sub]!.at;
  const hi = POLSKA_LEVELS[sub + 1]?.at ?? 1;
  const ratio = sub === POLSKA_LEVELS.length - 1 ? 1 : Math.min(0.99, Math.max(0, (pct - lo) / Math.max(1e-9, hi - lo)));
  const lvl = POLSKA_LEVELS[sub]!;
  return { sub, of: POLSKA_LEVELS.length - 1, pl: lvl.pl, ru: lvl.ru, ratio, pos: sub + ratio, points, total, grown, pct, games, groupsDone, bonusXp };
}
