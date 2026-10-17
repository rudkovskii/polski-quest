// Огород «Фермы»: чистая модель роста (ФЕРМА.md, решения 6–8, 11). Без браузера и системных часов: время приходит параметром.
//
// Сохраняется только то, что сделал игрок: посадки (`planted`) и журнал ответов (`log`, только дописывается), плюс раскладка
// по грядкам (`slots`, `tier`) — чтобы растения не прыгали. Стадии, капли, дни, урожай, опыт выводятся из журнала заново.
//
// Правила роста (одинаковые для слов и фраз):
//   семя → росток: 2 капли (верно +1, ошибка −1, не ниже 0; стадия от ошибки не падает);
//   росток → куст: были верные ответы в обе стороны (pr — с польского, rp — на польский);
//   куст → урожай: верные ответы в 3 разных календарных дня (за весь цикл), хотя бы один верный rp.
// За один ответ — не больше одной стадии. Урожай сразу уходит в банку (Spiżarnia). Через 7, 21, 60 (дальше каждые 60)
// дней после сбора растение возвращается на грядку «перезревшим»; один верный ответ — обратно в банку.
import type { GameMode, ItemStatus, Side, Stage } from '../types/farm';

export const DAY_MS = 86_400_000;
export const RETURN_DAYS: readonly number[] = [7, 21, 60];
export const XP = { correct: 1, stage: 3, word: 10, phrase: 25 } as const;
export const SPROUT_DROPS = 2;
export const HARVEST_DAYS = 3;

/** Грядки: прямоугольники [x, y, w, h] на карте фермы по ступеням расширения (каждая следующая включает прежнюю). */
export const PLOT_TIERS: readonly (readonly [number, number, number, number])[] = [
  [12, 14, 6, 4], // участок 6×4 (plot:garden)
  [11, 13, 10, 6], // резерв 10×6
  [11, 12, 10, 8], // новые ряды сверху и снизу
  [21, 12, 5, 8], // второй участок справа
];

/** Клетки грядок по порядку номеров: сначала участок, потом резерв, потом ряды, потом второй участок. */
export const PLOT_CELLS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const [x0, y0, w, h] of PLOT_TIERS)
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const k = `${x},${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([x, y]);
      }
  return out;
})();

/** Сколько грядок на каждой ступени. */
export const TIER_CAP: readonly number[] = PLOT_TIERS.map((_, i) => {
  const seen = new Set<string>();
  for (const [x0, y0, w, h] of PLOT_TIERS.slice(0, i + 1)) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) seen.add(`${x},${y}`);
  return seen.size;
});

export interface PlantEntry {
  t: number;
  id: string;
}

export interface AnswerEntry {
  t: number;
  /** Календарный день устройства (`dayOf`). */
  day: number;
  id: string;
  side: Side;
  ok: boolean;
  mode: GameMode;
}

export interface GardenSave {
  planted: PlantEntry[];
  log: AnswerEntry[];
  /** Растение → номер грядки (индекс в PLOT_CELLS). */
  slots: Record<string, number>;
  /** Ступень расширения (индекс в PLOT_TIERS), только растёт. */
  tier: number;
}

export function newGarden(): GardenSave {
  return { planted: [], log: [], slots: {}, tier: 0 };
}

/** Календарный день по местному времени: `tzOffsetMin` = `Date#getTimezoneOffset()`. */
export function dayOf(t: number, tzOffsetMin = 0): number {
  return Math.floor((t - tzOffsetMin * 60_000) / DAY_MS);
}

export interface ItemState {
  id: string;
  phrase: boolean;
  plantedAt: number;
  /** Стадия роста; null — в банке. */
  stage: 'seed' | 'sprout' | 'bush' | null;
  drops: number;
  sides: Record<Side, boolean>;
  days: Set<number>;
  rpOk: boolean;
  harvests: number;
  lastHarvest: number | null;
  firstHarvestDay: number | null;
  lastAnswer: number | null;
  answers: number;
}

export interface GardenState {
  items: Map<string, ItemState>;
  xp: number;
  /** Первые сборы по дням: день → сколько. */
  grownByDay: Map<number, number>;
  answersByDay: Map<number, number>;
}

/** Что дал ответ (для автобега и «+N»). */
export interface Outcome {
  kind: 'water' | 'grow' | 'harvest' | 'miss' | 'none';
  xp: number;
  from: Stage | null;
  to: Stage | null;
  /** Вернулось из «перезрело» в банку. */
  rejar?: boolean;
}

export const isPhrase = (id: string): boolean => id.startsWith('p.');

/** Когда собранное вернётся на грядку перезревшим (null — не в банке). */
export function dueAt(it: ItemState): number | null {
  if (it.stage !== null || it.lastHarvest === null || it.harvests < 1) return null;
  const d = RETURN_DAYS[Math.min(it.harvests - 1, RETURN_DAYS.length - 1)]!;
  return it.lastHarvest + d * DAY_MS;
}

export function isOverripe(it: ItemState, now: number): boolean {
  const d = dueAt(it);
  return d !== null && now >= d;
}

/** Стадия для показа на грядке. */
export function stageOf(it: ItemState, now: number): Stage | null {
  if (it.stage) return it.stage;
  return isOverripe(it, now) ? 'overripe' : null;
}

function plantItem(st: GardenState, e: PlantEntry): void {
  if (st.items.has(e.id)) return;
  st.items.set(e.id, {
    id: e.id,
    phrase: isPhrase(e.id),
    plantedAt: e.t,
    stage: 'seed',
    drops: 0,
    sides: { pr: false, rp: false },
    days: new Set(),
    rpOk: false,
    harvests: 0,
    lastHarvest: null,
    firstHarvestDay: null,
    lastAnswer: null,
    answers: 0,
  });
}

/** Применить ответ к состоянию (мутирует). Не посаженное игнорируется. */
export function applyAnswer(st: GardenState, a: AnswerEntry): Outcome {
  const it = st.items.get(a.id);
  if (!it) return { kind: 'none', xp: 0, from: null, to: null };
  it.lastAnswer = a.t;
  it.answers++;
  st.answersByDay.set(a.day, (st.answersByDay.get(a.day) ?? 0) + 1);
  const from = stageOf(it, a.t);
  if (!a.ok) {
    it.drops = Math.max(0, it.drops - 1);
    return { kind: 'miss', xp: 0, from, to: from };
  }
  let xp = XP.correct;
  if (it.stage === null) {
    // В банке: перезревшее — обратно в банку на следующий срок; не перезревшее — просто верный ответ.
    if (from === 'overripe') {
      it.harvests++;
      it.lastHarvest = a.t;
      xp += XP.stage;
      st.xp += xp;
      return { kind: 'harvest', xp, from, to: null, rejar: true };
    }
    st.xp += xp;
    return { kind: 'water', xp, from, to: from };
  }
  it.drops++;
  it.sides[a.side] = true;
  it.days.add(a.day);
  if (a.side === 'rp') it.rpOk = true;
  let kind: Outcome['kind'] = 'water';
  let to: Stage | null = it.stage;
  if (it.stage === 'seed' && it.drops >= SPROUT_DROPS) {
    it.stage = 'sprout';
    it.drops = 0;
    to = 'sprout';
    kind = 'grow';
    xp += XP.stage;
  } else if (it.stage === 'sprout' && it.sides.pr && it.sides.rp) {
    it.stage = 'bush';
    it.drops = 0;
    to = 'bush';
    kind = 'grow';
    xp += XP.stage;
  } else if (it.stage === 'bush' && it.days.size >= HARVEST_DAYS && it.rpOk) {
    it.stage = null;
    it.drops = 0;
    it.harvests = 1;
    it.lastHarvest = a.t;
    it.firstHarvestDay = a.day;
    st.grownByDay.set(a.day, (st.grownByDay.get(a.day) ?? 0) + 1);
    to = 'ripe';
    kind = 'harvest';
    xp += it.phrase ? XP.phrase : XP.word;
  }
  st.xp += xp;
  return { kind, xp, from, to };
}

/** Состояние из сохранения: посадки и ответы по времени (посадка раньше ответа в тот же миг). */
export function derive(g: GardenSave): GardenState {
  const st: GardenState = { items: new Map(), xp: 0, grownByDay: new Map(), answersByDay: new Map() };
  const ev: ({ p: PlantEntry } | { a: AnswerEntry })[] = [...g.planted.map((p) => ({ p })), ...g.log.map((a) => ({ a }))];
  // Стабильная сортировка: при равном времени посадка первой.
  ev.sort((x, y) => ('p' in x ? x.p.t : x.a.t) - ('p' in y ? y.p.t : y.a.t) || ('p' in x ? 0 : 1) - ('p' in y ? 0 : 1));
  for (const e of ev) {
    if ('p' in e) plantItem(st, e.p);
    else applyAnswer(st, e.a);
  }
  return st;
}

export function statusOf(st: GardenState, g: GardenSave, id: string, now: number): ItemStatus {
  const it = st.items.get(id);
  if (!it) return 'new';
  if (it.stage === null && !isOverripe(it, now)) return 'grown';
  return g.slots[id] !== undefined ? 'growing' : it.stage === null ? 'growing' : 'bag';
}

/** Сколько разных дней ещё нужно до урожая и что вообще нужно до следующей стадии, по-русски. */
export function nextText(it: ItemState | undefined, now: number): string {
  if (!it) return 'Посадить в словаре';
  const s = stageOf(it, now);
  if (s === 'overripe') return 'Один верный ответ — и обратно в банку';
  if (s === null) {
    const d = dueAt(it);
    const days = d === null ? 0 : Math.max(1, Math.ceil((d - now) / DAY_MS));
    return `В банке. Вернётся повторить через ${days} дн.`;
  }
  if (s === 'seed') {
    const n = SPROUT_DROPS - it.drops;
    return `Ещё ${n} ${n === 1 ? 'верный ответ' : 'верных ответа'} — и росток`;
  }
  if (s === 'sprout') {
    const need: string[] = [];
    if (!it.sides.pr) need.push('верно с польского');
    if (!it.sides.rp) need.push('верно на польский');
    return `До куста: ${need.join(' и ')}`;
  }
  const left = Math.max(0, HARVEST_DAYS - it.days.size);
  const parts: string[] = [];
  if (left > 0) parts.push(`верные ответы ещё в ${left} ${left === 1 ? 'другой день' : 'других дня'}`);
  if (!it.rpOk) parts.push('хотя бы раз по-польски');
  return parts.length ? `До урожая: ${parts.join(', ')}` : 'Следующий верный ответ — урожай';
}

/** Посадить: новые id в конец журнала посадок (уже посаженное пропускается). */
export function plant(g: GardenSave, st: GardenState, ids: readonly string[], now: number): { save: GardenSave; added: string[] } {
  const added: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (st.items.has(id) || seen.has(id)) continue;
    seen.add(id);
    added.push(id);
  }
  if (!added.length) return { save: g, added };
  return { save: { ...g, planted: [...g.planted, ...added.map((id) => ({ t: now, id }))] }, added };
}

/**
 * Разложить по грядкам: собранное (не перезревшее) освобождает грядку; растущие без грядки (в порядке посадки), потом
 * перезревшие (раньше срок — раньше) занимают свободные с наименьшим номером. Не хватает грядок — ступень расширения
 * растёт; на последней ступени лишние ждут в мешке.
 */
export function syncSlots(g: GardenSave, st: GardenState, now: number): GardenSave {
  const slots: Record<string, number> = {};
  const used = new Set<number>();
  for (const [id, n] of Object.entries(g.slots)) {
    const it = st.items.get(id);
    if (!it || used.has(n) || n >= PLOT_CELLS.length) continue;
    if (it.stage === null && !isOverripe(it, now)) continue;
    slots[id] = n;
    used.add(n);
  }
  const want: string[] = [];
  for (const p of g.planted) {
    const it = st.items.get(p.id);
    if (it && it.stage !== null && slots[p.id] === undefined && !want.includes(p.id)) want.push(p.id);
  }
  const over = [...st.items.values()].filter((it) => slots[it.id] === undefined && isOverripe(it, now)).sort((a, b) => (dueAt(a) ?? 0) - (dueAt(b) ?? 0));
  want.push(...over.map((it) => it.id));
  let tier = Math.max(0, Math.min(g.tier, TIER_CAP.length - 1));
  const need = used.size + want.length;
  while (tier < TIER_CAP.length - 1 && need > TIER_CAP[tier]!) tier++;
  // Растения на клетках за пределами ступени (не бывает, ступень не убывает) остаются как есть.
  let next = 0;
  for (const id of want) {
    while (next < TIER_CAP[tier]! && used.has(next)) next++;
    if (next >= TIER_CAP[tier]!) break;
    slots[id] = next;
    used.add(next);
  }
  const same = tier === g.tier && Object.keys(slots).length === Object.keys(g.slots).length && Object.entries(slots).every(([k, v]) => g.slots[k] === v);
  return same ? g : { ...g, slots, tier };
}

/** Сторона мини-игры: 1 и 4 — с польского (узнать), 2 и 3 — на польский (написать/собрать). */
export const sideOf = (mode: GameMode): Side => (mode === 1 || mode === 4 ? 'pr' : 'rp');
export const modeKind = (mode: GameMode): 'word' | 'phrase' => (mode <= 2 ? 'word' : 'phrase');

/** Продвинет ли верный ответ в эту сторону растение сегодня (стадию или к урожаю). */
export function canProgress(it: ItemState, side: Side, day: number, now: number): boolean {
  if (isOverripe(it, now)) return true;
  if (it.stage === 'seed') return true;
  if (it.stage === 'sprout') return !it.sides[side];
  if (it.stage === 'bush') return !it.days.has(day) || (side === 'rp' && !it.rpOk);
  return false;
}

const STAGE_RANK: Record<string, number> = { seed: 0, sprout: 1, bush: 2 };

/**
 * Следующее задание мини-игры из посаженного на грядках: перезревшие → ближе к урожаю (из тех, кому ответ сегодня
 * поможет) → давно не отвечал → новые; потом все остальные по давности. Подряд одно и то же не даёт, если есть выбор.
 */
export function pickTask(g: GardenSave, st: GardenState, mode: GameMode, now: number, day: number, lastId: string | null = null): string | null {
  const kind = modeKind(mode);
  const side = sideOf(mode);
  const pool = [...st.items.values()].filter((it) => (kind === 'phrase') === it.phrase && (g.slots[it.id] !== undefined || isOverripe(it, now)) && (it.stage !== null || isOverripe(it, now)));
  if (!pool.length) return null;
  const key = (it: ItemState): number[] => {
    const over = isOverripe(it, now);
    const group = over ? 0 : canProgress(it, side, day, now) ? 1 : 2;
    const fresh = it.answers === 0 ? 1 : 0;
    // Кому ответ сегодня не поможет, тех просто по кругу: кто давно не отвечал — первым.
    const progress = group !== 1 ? 0 : (STAGE_RANK[it.stage ?? 'seed'] ?? 0) * 100 + it.days.size * 10 + it.drops;
    return [group, fresh, -progress, it.lastAnswer ?? 0, g.slots[it.id] ?? 0];
  };
  const sorted = pool
    .map((it) => ({ it, k: key(it) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i]! - b.k[i]!;
      return 0;
    });
  const pick = sorted.find((x) => x.it.id !== lastId) ?? sorted[0]!;
  return pick.it.id;
}

/** Уровень по выращенному: A0 → A0.5 (400 слов) → A0.8 (800) → A1 (вся база слов и фраз). */
export function levelOf(words: number, phrases: number, totalWords: number, totalPhrases: number): { level: string; ratio: number } {
  const all = totalWords + totalPhrases;
  if (words >= totalWords && phrases >= totalPhrases) return { level: 'A1', ratio: 1 };
  if (words >= 800) return { level: 'A0.8', ratio: Math.min(1, (words + phrases - 800) / Math.max(1, all - 800)) };
  if (words >= 400) return { level: 'A0.5', ratio: (words - 400) / 400 };
  return { level: 'A0', ratio: words / 400 };
}

/** Нормализация раздела сохранения (мусор отбрасывается). */
export function normalizeGarden(raw: unknown): GardenSave {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const planted = Array.isArray(r.planted) ? r.planted.filter((p): p is PlantEntry => !!p && typeof p === 'object' && typeof p.id === 'string' && num(p.t)).map((p) => ({ t: p.t, id: p.id })) : [];
  const log = Array.isArray(r.log)
    ? r.log
        .filter((a): a is AnswerEntry => !!a && typeof a === 'object' && typeof a.id === 'string' && num(a.t) && num(a.day) && (a.side === 'pr' || a.side === 'rp') && typeof a.ok === 'boolean' && [1, 2, 3, 4].includes(a.mode))
        .map((a) => ({ t: a.t, day: a.day, id: a.id, side: a.side, ok: a.ok, mode: a.mode }))
    : [];
  const slots: Record<string, number> = {};
  if (r.slots && typeof r.slots === 'object') for (const [k, v] of Object.entries(r.slots as Record<string, unknown>)) if (num(v) && v >= 0) slots[k] = Math.trunc(v);
  const tier = num(r.tier) ? Math.max(0, Math.min(TIER_CAP.length - 1, Math.trunc(r.tier))) : 0;
  return { planted, log, slots, tier };
}
