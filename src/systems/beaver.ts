// Бобёр на ферме (просьба Шэфа 19.10): на уровнях 0–9 он приходит в гости, с 10-го поселяется (хатка и пруд на участке).
// Чистая логика без Phaser и браузера: время и уровень приходят параметрами. Поведение бобра на карте — `world/beaverLife.ts`,
// спрайты и сцена — `scenes/beaverLayer.ts`.
//
// Визит:
//   — шанс растёт с уровнем линейно: `visitChance(L) = 10 % + 50 % × L/9` (уровень 0 — 10 %, 3 — 27 %, 5 — 38 %, 9 — 60 %);
//   — бросок кубика на выходе на ферму (`enterFarm`) и на каждой смене игрового часа при открытой ферме (`tick`);
//   — результат детерминирован: зерно = день + вид броска + слот времени (10 минут для входа, час для часового), тот же момент даёт тот же ответ;
//   — не чаще одного визита за 10 минут (`VISIT_GAP_MS`, `Save.beaver.lastVisit`); визит идёт 1–3 минуты (`stayMs`), вернулся на ферму
//     до конца визита — бобёр ещё тут (`active`).
// Поселение: уровень ≥ 10 (`SETTLE_LEVEL`) → `trySettle()` один раз пишет `Save.beaver.settled` (дата), дальше бобёр хозяин навсегда:
// уровень не падает, но и флаг не снимается, даже если он когда-нибудь упадёт.
import { unit, fnv1a } from './hash';
import { dayOf } from './garden';

/** С какого уровня (0…20, `systems/xp.ts`) бобёр поселяется. */
export const SETTLE_LEVEL = 10;
/** Шанс визита на уровне 0 и на уровне 9 (между ними линейно; с 10-го бобёр уже живёт на ферме). */
export const VISIT_P0 = 0.1;
export const VISIT_P9 = 0.6;
export const VISIT_TOP_LEVEL = 9;
/** Не чаще одного визита за столько, мс. */
export const VISIT_GAP_MS = 10 * 60_000;
/** Визит длится от и до, мс. */
export const VISIT_MIN_MS = 60_000;
export const VISIT_MAX_MS = 180_000;
/** Слот броска на входе на ферму и час часового броска, мс. */
export const ENTRY_SLOT_MS = 10 * 60_000;
export const HOUR_MS = 3_600_000;
/** Ночью бобёр-хозяин спит в хатке: с 21:00 до 06:00 по местному времени. */
export const NIGHT_FROM = 21;
export const NIGHT_TO = 6;
/** Ключ набора украшений (`registry.decor`), при котором на карте стоят хатка и пруд (`PropObject.unlock`). */
export const HOME_KEY = 'beaver.home';

/** Шанс визита на уровне `level` (0…): линейно от 10 % до 60 % на уровне 9, выше — потолок. */
export function visitChance(level: number): number {
  const l = Math.min(VISIT_TOP_LEVEL, Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)));
  return Math.round((VISIT_P0 + ((VISIT_P9 - VISIT_P0) * l) / VISIT_TOP_LEVEL) * 1000) / 1000;
}

/** Бобёр в сохранении. */
export interface BeaverSave {
  /** Когда поселился (epoch ms); null — ещё гость. Не сбрасывается. */
  settled: number | null;
  /** Когда начался последний визит (epoch ms). */
  lastVisit: number | null;
  /** Сколько визитов было. */
  visits: number;
}

export const newBeaverSave = (): BeaverSave => ({ settled: null, lastVisit: null, visits: 0 });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Привести прочитанное к `BeaverSave`: старое сохранение без раздела читается как «бобра ещё не было». */
export function normalizeBeaver(raw: unknown): BeaverSave {
  if (!raw || typeof raw !== 'object') return newBeaverSave();
  const r = raw as Record<string, unknown>;
  return {
    settled: isNum(r.settled) && r.settled > 0 ? r.settled : null,
    lastVisit: isNum(r.lastVisit) && r.lastVisit > 0 ? r.lastVisit : null,
    visits: isNum(r.visits) && r.visits >= 0 ? Math.floor(r.visits) : 0,
  };
}

export type Trigger = 'enter' | 'hour';

/** Один визит: зерно поведения (сцена делает из него свой генератор), длительность, когда начался. */
export interface VisitPlan {
  seed: number;
  stayMs: number;
  startedAt: number;
}

/** Число [0, 1) для броска: зависит только от дня, вида броска и слота времени. */
export const rollUnit = (day: number, trigger: Trigger, slot: number): number => unit(`beaver:${day}:${trigger}:${slot}`);

/** Выпал ли визит в этом слоте при этом уровне. */
export const visitRoll = (day: number, trigger: Trigger, slot: number, level: number): boolean => rollUnit(day, trigger, slot) < visitChance(level);

/** Длительность визита по зерну, целые секунды. */
export const stayMsOf = (seed: number): number => Math.round((VISIT_MIN_MS + unit(`beaver:stay:${seed}`) * (VISIT_MAX_MS - VISIT_MIN_MS)) / 1000) * 1000;

/** Ночь (спит в хатке) по часу 0…24. */
export const isNight = (hour: number): boolean => hour >= NIGHT_FROM || hour < NIGHT_TO;

/** Детерминированный генератор [0, 1) от зерна (mulberry32): поведение визита повторяется от зерна дня и слота. */
export function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Phase = 'visitor' | 'resident';

export interface BeaverDeps {
  load(): BeaverSave;
  save(b: BeaverSave): void;
  now(): number;
  /** Номер уровня 0…21 (`FarmStats.path.sub`; 21 — A1). */
  level(): number;
  /** `Date#getTimezoneOffset()` для момента `t`. */
  tz?(t: number): number;
}

export interface BeaverApi {
  phase(): Phase;
  /** Уровень достиг порога, а бобёр ещё не поселён: записать заселение. true — только в тот раз, когда записали. */
  trySettle(): boolean;
  /** Зашли на ферму: визит (новый или идущий) или null. */
  enterFarm(): VisitPlan | null;
  /** Раз в несколько секунд при открытой ферме: смена игрового часа → бросок. */
  tick(): VisitPlan | null;
  /** Идущий сейчас визит. */
  active(): VisitPlan | null;
  /** Бобёр ушёл (сцена закрыла визит). */
  end(): void;
  now(): number;
  level(): number;
  /** Местный час 0…24 (для сна хозяина). */
  hour(): number;
}

export function createBeaver(d: BeaverDeps): BeaverApi {
  let current: VisitPlan | null = null;
  let hourSlot: number | null = null;
  const tz = (t: number): number => d.tz?.(t) ?? 0;

  const settled = (): boolean => d.load().settled !== null;

  const start = (trigger: Trigger, slot: number, now: number): VisitPlan | null => {
    const b = d.load();
    // С порога заселения гостей нет: бобёр вот-вот поселится (или уже живёт).
    if (b.settled !== null || d.level() >= SETTLE_LEVEL) return null;
    if (b.lastVisit !== null && now - b.lastVisit < VISIT_GAP_MS && now >= b.lastVisit) return null;
    const day = dayOf(now, tz(now));
    if (!visitRoll(day, trigger, slot, d.level())) return null;
    const seed = fnv1a(`beaver:${day}:${trigger}:${slot}`);
    current = { seed, stayMs: stayMsOf(seed), startedAt: now };
    d.save({ ...b, lastVisit: now, visits: b.visits + 1 });
    return current;
  };

  return {
    phase: () => (settled() ? 'resident' : 'visitor'),
    trySettle() {
      const b = d.load();
      if (b.settled !== null || d.level() < SETTLE_LEVEL) return false;
      current = null;
      d.save({ ...b, settled: d.now() });
      return true;
    },
    enterFarm() {
      const now = d.now();
      hourSlot = Math.floor(now / HOUR_MS);
      if (settled()) return null;
      if (current && now >= current.startedAt && now < current.startedAt + current.stayMs) return current;
      current = null;
      return start('enter', Math.floor(now / ENTRY_SLOT_MS), now);
    },
    tick() {
      const now = d.now();
      const slot = Math.floor(now / HOUR_MS);
      if (hourSlot === slot) return null;
      hourSlot = slot;
      if (settled()) return null;
      if (current && now >= current.startedAt && now < current.startedAt + current.stayMs) return null;
      current = null;
      return start('hour', slot, now);
    },
    active: () => current,
    end() {
      current = null;
    },
    now: () => d.now(),
    level: () => d.level(),
    hour() {
      const t = d.now();
      const dt = new Date(t - tz(t) * 60_000);
      return dt.getUTCHours() + dt.getUTCMinutes() / 60;
    },
  };
}
