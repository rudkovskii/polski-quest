// Огород v2 «Игры о Польше»: единицы (город, строка гимна, символ, дата, праздник) растут по правилам слов (`garden.ts`):
// семя → росток (2 капли) → кустик (верно в обе стороны A и B) → урожай (3 разных дня, хотя бы один верный ответ «сам»).
// Свой раздел сохранения (`Save.polska`), отдельно от огорода слов: путь к A1 его не видит, у него своя шкала (`polskaScale.ts`).
// Без браузера: время, хранилище и шина приходят параметрами (склейка — main.ts).
import type { BusEvents } from '../types/bus';
import type { Stage } from '../types/farm';
import type { PlotView, PolskaGameId, PolskaUnit, UnitInfo, Want } from '../types/polska';
import type { Bus } from './bus';
import {
  DAY_MS,
  HARVEST_DAYS,
  SPROUT_DROPS,
  answersOnDay,
  applyAnswer,
  dayOf,
  derive,
  dueAt,
  isOverripe,
  newGarden,
  normalizeGarden,
  stageOf,
  type AnswerEntry,
  type GardenSave,
  type GardenState,
  type ItemState,
  type PlantEntry,
} from './garden';
import { polskaScale, type PolskaScale } from './polskaScale';
import { V2, unitsOfGame, type V2Content } from './v2content';
import { entryFrames, plotMap, plotViews, type PlotRef } from './zagroda';

export interface PolskaSave {
  garden: GardenSave;
  /** Знакомство («Poznaj datę», «Poznaj święto») показано и принято кнопкой «Понятно»: id единицы → ISO-дата. Старое сохранение без поля — пусто. */
  seen: Record<string, string>;
}

export const newPolskaSave = (): PolskaSave => ({ garden: newGarden(), seen: {} });

export function normalizePolska(raw: unknown): PolskaSave {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const seen: Record<string, string> = {};
  if (r.seen && typeof r.seen === 'object' && !Array.isArray(r.seen)) {
    for (const [id, v] of Object.entries(r.seen as Record<string, unknown>)) if (typeof v === 'string' && v) seen[id] = v;
  }
  return { garden: normalizeGarden(r.garden), seen };
}

/** Сколько семян и ростков одной игры растёт одновременно: движок досаживает из `pool` до этого числа. */
export const ACTIVE_MAX = 8;
/** Одна и та же единица не раньше, чем через столько заданий (меньше, если в пуле мало). */
export const REPEAT_GAP_V2 = 3;

export interface PolskaAct {
  kind: 'water' | 'grow' | 'harvest' | 'miss';
  xp: number;
}

export interface PolskaAnswerOut {
  ok: boolean;
  act: PolskaAct;
  /** Что осталось единице («ещё 1 день до урожая»). */
  progress: string;
  /** Шкала «Wiedza o Polsce» до и после ответа (позиция в уровнях) и звание после. */
  scale: { from: number; to: number; sub: number; pl: string };
  /** Объект Zagroda, у которого растёт единица. */
  obj: string | null;
}

export interface PolskaDeps {
  bus?: Bus<BusEvents>;
  load(): PolskaSave;
  save(p: PolskaSave): void;
  now(): number;
  tz(t: number): number;
  content?: V2Content;
}

export interface Polska {
  readonly content: V2Content;
  units(game: PolskaGameId): PolskaUnit[];
  unit(id: string): PolskaUnit | undefined;
  info(id: string): UnitInfo;
  /** Знакомство с единицей уже принято («Понятно»)? Нет флага — карточку покажут, даже если ответы уже есть. */
  seen(id: string): boolean;
  /** Отметить знакомство принятым (ISO-дата по часам игры) и сохранить. Повторный вызов ничего не меняет. */
  markSeen(id: string): void;
  /** Посадить (строки гимна из `drillSeed` — сразу кустиком). Возвращает добавленные id. */
  plant(ids: readonly string[]): string[];
  /** Досадить из `pool` игры, пока семян и ростков этой игры меньше ACTIVE_MAX. */
  autoPlant(game: PolskaGameId, pool: readonly string[]): string[];
  /** Какую единицу и как спросить (null — нечего). `only` — эту единицу. */
  pick(game: PolskaGameId, opts?: { recent?: readonly string[]; only?: string; exclude?: ReadonlySet<string> }): Want | null;
  answer(t: { id: string; side: 'A' | 'B'; self?: boolean }, ok: boolean): PolskaAnswerOut;
  plots(): PlotView[];
  ref(id: string): PlotRef | undefined;
  scale(): PolskaScale;
  /** Опыт v2: ответы, стадии, урожаи и бонусы за закрытые наборы. */
  xp(): number;
  /** Строка прогресса игры для доски: «12 из 72 · sad 3/16». */
  progress(game: PolskaGameId): { units: number; planted: number; grown: number; growing: number; objDone: number; objTotal: number };
  refresh(): void;
  onChange(fn: () => void): () => void;
  readonly save: PolskaSave;
  readonly state: GardenState;
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** «Что осталось» единице v2, с маленькой буквы. A — узнать, B — вспомнить, «сам» — сказать или собрать без подсказки. */
export function unitProgress(it: ItemState | undefined, now: number, day: number): string {
  if (!it) return 'не посажено';
  const s = stageOf(it, now);
  if (s === 'overripe') return 'один верный ответ, и снова в коллекции';
  if (s === null) {
    const d = dueAt(it);
    const days = d === null ? 0 : Math.max(1, Math.ceil((d - now) / DAY_MS));
    return `в коллекции, вернётся повторить через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }
  if (s === 'seed') {
    const n = Math.max(1, SPROUT_DROPS - it.drops);
    return `ещё ${n} ${plural(n, 'полив', 'полива', 'поливов')} до ростка`;
  }
  if (s === 'sprout') return !it.sides.pr ? 'нужно узнать (выбрать ответ)' : 'нужно вспомнить самому';
  const left = Math.max(0, HARVEST_DAYS - it.days.size - (it.days.has(day) ? 0 : 1));
  const days = left > 0 ? `до урожая: ещё ${left} ${plural(left, 'день', 'дня', 'дней')}` : '';
  if (!it.selfOk) return left > 0 ? `нужно сказать самому; ${days}` : 'скажи самому — и урожай';
  return left > 0 ? days : 'созреет со следующим верным ответом';
}

const RANK: Record<string, number> = { seed: 0, sprout: 1, bush: 2 };

/** Что спросить у единицы: сторона и «сам». Чистая функция (тест). */
export function wantOf(it: ItemState, now: number, todayAnswers = 0): Omit<Want, 'id'> | null {
  const s = stageOf(it, now);
  if (s === 'overripe') return { side: 'A', self: false, stage: 'overripe' };
  // Семечко: первый ответ «узнать» (A), после верного — уже «вспомнить» (B): первый раунд не из 10 одинаковых заданий.
  if (s === 'seed') return { side: it.sides.pr ? 'B' : 'A', self: false, stage: s };
  if (s === 'sprout') return { side: it.sides.pr ? 'B' : 'A', self: false, stage: s };
  if (s === 'bush') {
    if (!it.selfOk) return { side: 'B', self: true, stage: s };
    if (!it.rpOk) return { side: 'B', self: false, stage: s };
    return { side: todayAnswers % 2 ? 'B' : 'A', self: false, stage: s };
  }
  return null;
}

export function createPolska(d: PolskaDeps): Polska {
  const content = d.content ?? V2;
  const refs = plotMap(content.units);
  const drill = new Set(content.drillSeed);
  let p: PolskaSave = d.load();
  let st: GardenState = derive(p.garden);
  const listeners = new Set<() => void>();
  const today = (): number => {
    const t = d.now();
    return dayOf(t, d.tz(t));
  };
  const byGame = new Map<PolskaGameId, PolskaUnit[]>();
  const units = (g: PolskaGameId): PolskaUnit[] => {
    let u = byGame.get(g);
    if (!u) byGame.set(g, (u = unitsOfGame(content, g)));
    return u;
  };

  const scale = (): PolskaScale => polskaScale(content.units, st.items, refs);
  const xp = (): number => st.xp + scale().bonusXp;
  const emit = (gain = 0, up = false): void => {
    if (!d.bus) return;
    const t = d.now();
    // Местная дата из часов игры (для мачты в праздники и сезонной доски).
    const local = new Date(t - d.tz(t) * 60_000);
    d.bus.emit('polska:plots', { views: plotViews(content.units, st.items, t, refs), entries: entryFrames(content.units, st.items, local.getUTCMonth() + 1, local.getUTCDate()) });
    const s = scale();
    d.bus.emit('polska:scale', { sub: s.sub, of: s.of, pl: s.pl, ru: s.ru, ratio: s.ratio, pct: s.pct, xp: st.xp + s.bonusXp, ...(gain ? { gain } : {}), ...(up ? { up } : {}) });
  };
  const commit = (next: GardenSave): void => {
    p = { ...p, garden: next };
    d.save(p);
    for (const fn of [...listeners]) fn();
  };

  const info = (id: string): UnitInfo => {
    const now = d.now();
    const it = st.items.get(id);
    const u = content.byId.get(id);
    return {
      id,
      kind: u?.kind ?? 'geo',
      stage: it ? stageOf(it, now) : null,
      planted: !!it,
      drops: it?.drops ?? 0,
      sides: { A: it?.sides.pr ?? false, B: it?.sides.rp ?? false },
      selfOk: it?.selfOk ?? false,
      days: it?.days.size ?? 0,
      harvests: it?.harvests ?? 0,
      answers: it?.answers ?? 0,
      next: unitProgress(it, now, today()),
    };
  };

  const seen = (id: string): boolean => Object.prototype.hasOwnProperty.call(p.seen, id);
  const markSeen = (id: string): void => {
    if (!content.byId.has(id) || seen(id)) return;
    p = { ...p, seen: { ...p.seen, [id]: new Date(d.now()).toISOString().slice(0, 10) } };
    d.save(p);
  };

  const plant = (ids: readonly string[]): string[] => {
    const now = d.now();
    const added: PlantEntry[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (!content.byId.has(id) || st.items.has(id) || seen.has(id)) continue;
      seen.add(id);
      added.push(drill.has(id) ? { t: now, id, start: 'bush' } : { t: now, id });
    }
    if (!added.length) return [];
    const g = { ...p.garden, planted: [...p.garden.planted, ...added] };
    st = derive(g);
    commit(g);
    emit();
    return added.map((e) => e.id);
  };

  const api: Polska = {
    seen,
    markSeen,
    content,
    units,
    unit: (id) => content.byId.get(id),
    info,
    plant,
    autoPlant(game, pool) {
      const now = d.now();
      const mine = new Set(units(game).map((u) => u.id));
      let active = 0;
      for (const it of st.items.values()) {
        if (!mine.has(it.id)) continue;
        const s = stageOf(it, now);
        if (s === 'seed' || s === 'sprout') active++;
      }
      const want: string[] = [];
      for (const id of pool) {
        if (active + want.length >= ACTIVE_MAX) break;
        if (!mine.has(id) || st.items.has(id)) continue;
        // Строки из дриля приходят кустиками: место среди семян не занимают.
        if (drill.has(id)) {
          want.push(id);
          active--;
          continue;
        }
        want.push(id);
      }
      return plant(want);
    },
    pick(game, opts = {}) {
      const now = d.now();
      const day = today();
      const todayMap = answersOnDay(p.garden, day);
      if (opts.only) {
        const it = st.items.get(opts.only);
        if (!it) return null;
        const w = wantOf(it, now, todayMap.get(it.id) ?? 0) ?? { side: 'A' as const, self: false, stage: 'bush' as Stage };
        return { id: opts.only, ...w };
      }
      const mine = new Set(units(game).map((u) => u.id));
      const pool = [...st.items.values()].filter((it) => mine.has(it.id) && (it.stage !== null || isOverripe(it, now)) && !opts.exclude?.has(it.id));
      if (!pool.length) return null;
      const gap = Math.max(0, Math.min(REPEAT_GAP_V2, pool.length - 1));
      const banned = new Set(gap > 0 ? (opts.recent ?? []).slice(-gap) : []);
      const key = (it: ItemState): number[] => {
        const over = isOverripe(it, now);
        const has = it.days.has(day);
        const harvestNow = it.stage === 'bush' && it.days.size + (has ? 0 : 1) >= HARVEST_DAYS;
        // Сегодня ей больше нечего дать: кустик, день засчитан, «сам» и B уже были.
        const useless = it.stage === 'bush' && has && it.selfOk && it.rpOk && !harvestNow;
        const progress = (RANK[it.stage ?? 'seed'] ?? 0) * 100 + it.days.size * 10 + it.drops;
        return [banned.has(it.id) ? 1 : 0, useless ? 1 : 0, over ? 0 : 1, harvestNow ? 0 : 1, it.stage !== null && it.days.size > 0 && !has ? 0 : 1, todayMap.get(it.id) ?? 0, -progress, it.lastAnswer ?? 0, it.plantedAt];
      };
      const best = pool
        .map((it) => ({ it, k: key(it) }))
        .sort((a, b) => {
          for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i]! - b.k[i]!;
          return 0;
        })[0]?.it;
      if (!best) return null;
      const w = wantOf(best, now, todayMap.get(best.id) ?? 0);
      return w ? { id: best.id, ...w } : null;
    },
    answer(t, ok) {
      const now = d.now();
      const day = today();
      const s0 = scale();
      const e: AnswerEntry = { t: now, day, id: t.id, side: t.side === 'A' ? 'pr' : 'rp', ok, mode: t.side === 'A' ? 1 : 2, ...(t.self ? { self: true } : {}) };
      const g = { ...p.garden, log: [...p.garden.log, e] };
      const o = applyAnswer(st, e);
      commit(g);
      const s1 = scale();
      const act: PolskaAct = { kind: o.kind === 'none' ? 'water' : o.kind, xp: o.xp + (s1.bonusXp - s0.bonusXp) };
      const ref = refs.get(t.id);
      const u = content.byId.get(t.id);
      d.bus?.emit('polska:act', { kind: act.kind, id: t.id, label: u?.pl ?? t.id, obj: ref?.obj ?? null, xp: act.xp, ...(u?.raw.harvest === 'quiet' ? { quiet: true } : {}) });
      emit(act.xp, s1.sub > s0.sub);
      return { ok, act, progress: unitProgress(st.items.get(t.id), now, day), scale: { from: s0.pos, to: s1.pos, sub: s1.sub, pl: s1.pl }, obj: ref?.obj ?? null };
    },
    plots: () => plotViews(content.units, st.items, d.now(), refs),
    ref: (id) => refs.get(id),
    scale,
    xp,
    progress(game) {
      const list = units(game);
      let planted = 0;
      let grown = 0;
      let growing = 0;
      for (const u of list) {
        const it = st.items.get(u.id);
        if (!it) continue;
        planted++;
        if (it.harvests > 0) grown++;
        else if (it.stage !== null) growing++;
      }
      const objs = new Set(list.map((u) => refs.get(u.id)?.obj).filter((x): x is string => !!x));
      const views = api.plots().filter((v) => objs.has(v.obj) && v.units > 0);
      return { units: list.length, planted, grown, growing, objDone: views.filter((v) => v.pct >= 1).length, objTotal: views.length };
    },
    refresh: () => emit(),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get save() {
      return p;
    },
    get state() {
      return st;
    },
  };
  return api;
}
