// Огород «Фермы»: чистая модель роста (ФЕРМА.md, решения 6–8, 11). Без браузера и системных часов: время приходит параметром.
//
// Сохраняется только то, что сделал игрок: посадки (`planted`) и журнал ответов (`log`, только дописывается), плюс раскладка
// по грядкам (`slots`, `tier`) — чтобы растения не прыгали. Стадии, капли, дни, урожай, опыт выводятся из журнала заново.
//
// Правила роста (одинаковые для слов и фраз):
//   семя → росток: 2 капли (верно +1, ошибка −1, не ниже 0; стадия от ошибки не падает);
//   росток → куст: были верные ответы в обе стороны (pr — с польского, rp — на польский);
//   куст → урожай: верные ответы в 3 разных календарных дня (за весь цикл), хотя бы один верный rp; у слова этот rp —
//   «сам» (production, `AnswerEntry.prod`): собрано из букв в игре 5 без подсказки (или прежнее «напиши сам» в игре 2,
//   ответы до `GardenSave.prodFrom` засчитываются по старому правилу: любой верный rp). Фразам и единицам v2 production не нужен.
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
  /** v2: посадить сразу этой стадией (строки гимна, выученные в дриле собеса, `drillSeed`): кустик с обеими сторонами. */
  start?: 'bush';
}

export interface AnswerEntry {
  t: number;
  /** Календарный день устройства (`dayOf`). */
  day: number;
  id: string;
  side: Side;
  ok: boolean;
  mode: GameMode;
  /** v2: задание «сказать/собрать самому» (сторона B без подсказки). Нужно для урожая единиц игр о Польше. */
  self?: boolean;
  /** Игра 5: слово собрано (или напечатано точно) по-польски само, без подсказки — production, нужен слову для урожая. */
  prod?: boolean;
}

export interface GardenSave {
  planted: PlantEntry[];
  log: AnswerEntry[];
  /** Растение → номер грядки (индекс в PLOT_CELLS). */
  slots: Record<string, number>;
  /** Ступень расширения (индекс в PLOT_TIERS), только растёт. */
  tier: number;
  /**
   * С какого момента (мс) слову для урожая нужен ответ «сам» (`prod`, игра 5). Ответы журнала раньше — по прежнему
   * правилу: любой верный ответ по-польски засчитан как «сам» (в старом журнале «напиши сам» не отличить от выбора).
   * Новый огород — 0. Нет поля — старое сохранение: `withProdFrom` (при загрузке) ставит конец его журнала.
   */
  prodFrom?: number;
}

export function newGarden(): GardenSave {
  return { planted: [], log: [], slots: {}, tier: 0, prodFrom: 0 };
}

/** Календарный день по местному времени: `tzOffsetMin` = `Date#getTimezoneOffset()`. */
export function dayOf(t: number, tzOffsetMin = 0): number {
  return Math.floor((t - tzOffsetMin * 60_000) / DAY_MS);
}

export interface ItemState {
  id: string;
  phrase: boolean;
  /** Вид (v2): word, phrase или единица игры о Польше. */
  kind: PlantKind;
  /** Для урожая нужен верный ответ «сам» (`AnswerEntry.self`): у единиц игр о Польше. */
  needSelf: boolean;
  /** Был верный ответ «сам» (за цикл роста). */
  selfOk: boolean;
  /** Для урожая нужен ответ «сам» по-польски (`AnswerEntry.prod`, игра 5): у слов. */
  needProd: boolean;
  /** Был такой ответ (за цикл роста). */
  prodOk: boolean;
  plantedAt: number;
  /** Стадия роста; null — в банке. */
  stage: 'seed' | 'sprout' | 'bush' | null;
  drops: number;
  sides: Record<Side, boolean>;
  days: Set<number>;
  rpOk: boolean;
  /** Ответов по сторонам (с польского / по-польски) (P3a: «наоборот» не раньше двух ответов в прямой стороне). */
  sideAns: Record<Side, number>;
  harvests: number;
  lastHarvest: number | null;
  firstHarvestDay: number | null;
  lastAnswer: number | null;
  answers: number;
  /** Весь опыт, набранный этим растением (для частичного зачёта на полоске, пока оно не выращено). */
  xp: number;
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

/** Вид растения (v2): слово и фраза (v1, тема «Święta i zwyczaje» — тоже слова) и единицы игр о Польше. */
export type PlantKind = 'word' | 'phrase' | 'geo' | 'hymn' | 'symbol' | 'date' | 'holiday';
/** Виды единиц игр о Польше (v2): у них своя шкала «Wiedza o Polsce», в путь к A1 они не идут. */
export const POLSKA_KINDS: readonly PlantKind[] = ['geo', 'hymn', 'symbol', 'date', 'holiday'];
/** Префикс id → вид: `geo.city.wroclaw`, `hymn.s1.1`, `symbol.godlo`, `date.konstytucja`, `hol.wigilia`; `p.` фраза; остальное (`w.`, `sw.`) слово. */
export function kindOf(id: string): PlantKind {
  if (id.startsWith('p.')) return 'phrase';
  if (id.startsWith('geo.')) return 'geo';
  if (id.startsWith('hymn.')) return 'hymn';
  if (id.startsWith('symbol.')) return 'symbol';
  if (id.startsWith('date.')) return 'date';
  if (id.startsWith('hol.')) return 'holiday';
  return 'word';
}
export const isPolskaKind = (k: PlantKind): boolean => POLSKA_KINDS.includes(k);

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
  const kind = kindOf(e.id);
  const bush = e.start === 'bush';
  st.items.set(e.id, {
    id: e.id,
    phrase: isPhrase(e.id),
    kind,
    needSelf: isPolskaKind(kind),
    selfOk: false,
    needProd: kind === 'word',
    prodOk: bush,
    plantedAt: e.t,
    stage: bush ? 'bush' : 'seed',
    drops: 0,
    sides: { pr: bush, rp: bush },
    days: new Set(),
    rpOk: bush,
    sideAns: { pr: 0, rp: 0 },
    harvests: 0,
    lastHarvest: null,
    firstHarvestDay: null,
    lastAnswer: null,
    answers: 0,
    xp: 0,
  });
}

/** Применить ответ к состоянию (мутирует). Не посаженное игнорируется. `legacy` — ответ до `prodFrom`: любой верный rp = «сам». */
export function applyAnswer(st: GardenState, a: AnswerEntry, legacy = false): Outcome {
  const it = st.items.get(a.id);
  if (!it) return { kind: 'none', xp: 0, from: null, to: null };
  it.lastAnswer = a.t;
  it.answers++;
  it.sideAns[a.side]++;
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
      it.xp += xp;
      return { kind: 'harvest', xp, from, to: null, rejar: true };
    }
    st.xp += xp;
    it.xp += xp;
    return { kind: 'water', xp, from, to: from };
  }
  it.drops++;
  it.sides[a.side] = true;
  it.days.add(a.day);
  if (a.side === 'rp') it.rpOk = true;
  if (a.self) it.selfOk = true;
  if (a.prod || (legacy && a.side === 'rp')) it.prodOk = true;
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
  } else if (it.stage === 'bush' && it.days.size >= HARVEST_DAYS && it.rpOk && (!it.needSelf || it.selfOk) && (!it.needProd || it.prodOk)) {
    it.stage = null;
    it.drops = 0;
    it.selfOk = false;
    it.prodOk = false;
    it.harvests = 1;
    it.lastHarvest = a.t;
    it.firstHarvestDay = a.day;
    st.grownByDay.set(a.day, (st.grownByDay.get(a.day) ?? 0) + 1);
    to = 'ripe';
    kind = 'harvest';
    xp += it.phrase ? XP.phrase : XP.word;
  }
  st.xp += xp;
  it.xp += xp;
  return { kind, xp, from, to };
}

/** Состояние из сохранения: посадки и ответы по времени (посадка раньше ответа в тот же миг). */
export function derive(g: GardenSave): GardenState {
  const st: GardenState = { items: new Map(), xp: 0, grownByDay: new Map(), answersByDay: new Map() };
  const ev: ({ p: PlantEntry } | { a: AnswerEntry })[] = [...g.planted.map((p) => ({ p })), ...g.log.map((a) => ({ a }))];
  // Стабильная сортировка: при равном времени посадка первой.
  ev.sort((x, y) => ('p' in x ? x.p.t : x.a.t) - ('p' in y ? y.p.t : y.a.t) || ('p' in x ? 0 : 1) - ('p' in y ? 0 : 1));
  // Нет отметки — сохранение до игры 5: весь журнал по прежнему правилу.
  const prodFrom = g.prodFrom ?? Infinity;
  for (const e of ev) {
    if ('p' in e) plantItem(st, e.p);
    else applyAnswer(st, e.a, e.a.t < prodFrom);
  }
  return st;
}

export function statusOf(st: GardenState, g: GardenSave, id: string, now: number): ItemStatus {
  const it = st.items.get(id);
  if (!it) return 'new';
  if (it.stage === null && !isOverripe(it, now)) return 'grown';
  return g.slots[id] !== undefined ? 'growing' : it.stage === null ? 'growing' : 'bag';
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/**
 * Одна строка «что осталось» (P2a), с маленькой буквы: «ещё 1 полив до ростка», «нужно ответить по-польски»,
 * «до урожая: ещё 1 день», «созреет со следующим верным ответом». `day` — сегодняшний календарный день: засчитан ли он уже.
 */
export function progressText(it: ItemState | undefined, now: number, day?: number): string {
  if (!it) return 'не посажено';
  const s = stageOf(it, now);
  if (s === 'overripe') return 'один верный ответ, и слово снова в банке';
  if (s === null) {
    const d = dueAt(it);
    const days = d === null ? 0 : Math.max(1, Math.ceil((d - now) / DAY_MS));
    return `слово выучено и лежит в банке, вернётся повторить через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }
  if (s === 'seed') {
    const n = Math.max(1, SPROUT_DROPS - it.drops);
    return `ещё ${n} ${plural(n, 'полив', 'полива', 'поливов')} до ростка`;
  }
  if (s === 'sprout') {
    if (!it.sides.pr && !it.sides.rp) return 'нужно ответить в обе стороны: с польского и по-польски';
    if (!it.sides.rp) return 'нужно ответить по-польски';
    if (!it.sides.pr) return 'нужно ответить с польского';
    return 'ещё 1 полив до кустика';
  }
  // Куст: дни (сегодняшний, если ещё не засчитан, идёт в счёт) и ответ по-польски (у слова — собранный сам, игра 5).
  const today = day !== undefined && !it.days.has(day);
  const left = Math.max(0, HARVEST_DAYS - it.days.size);
  if (needsProd(it)) {
    if (left <= 1 && (left === 0 || today)) return `осталось: ${SPELL_TODO} — и урожай`;
    return `${SPELL_TODO}; до урожая: ещё ${left} ${plural(left, 'день', 'дня', 'дней')}`;
  }
  if (!it.rpOk) {
    if (left <= 1 && (left === 0 || today)) return 'нужно ответить по-польски — и урожай';
    return `нужно ответить по-польски; до урожая: ещё ${left} ${plural(left, 'день', 'дня', 'дней')}`;
  }
  if (left === 0 || (left === 1 && today)) return 'созреет со следующим верным ответом';
  if (today) return `до урожая: ещё ${left} ${plural(left, 'день', 'дня', 'дней')}, сегодняшний тоже в счёт`;
  return `до урожая: ещё ${left} ${plural(left, 'день', 'дня', 'дней')}`;
}

/** Чего не хватает слову для урожая, если не хватает ответа «сам» (подсказка в задании, карточке, словаре и на доске). */
export const SPELL_TODO = 'собери слово в игре «Собери слово»';

/** Кусту слова для урожая не хватает ответа «сам» по-польски (игра 5). */
export function needsProd(it: ItemState): boolean {
  return it.stage === 'bush' && it.needProd && !it.prodOk;
}

/** Что нужно до урожая, с большой буквы (словарь, карточка растения). */
export function nextText(it: ItemState | undefined, now: number, day?: number): string {
  if (!it) return 'Посадить в словаре';
  const t = progressText(it, now, day);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Скоро урожай: `today` — созреет сегодня одним верным ответом (куст, дни набраны с учётом сегодняшнего, по-польски был);
 * `tomorrow` — сегодня уже засчитан и завтра будет последний нужный день.
 * `soon` (F5b) — растущие, которым после сегодняшнего зачёта до урожая остаётся один день, но которые пока не куст с
 * польской стороной (в `today` и `tomorrow` не вошли): утром второго дня «сегодня созреет 0» не должно быть единственной новостью.
 */
export function ripeSoon(st: GardenState, day: number): { today: number; tomorrow: number; soon: number } {
  let today = 0;
  let tomorrow = 0;
  let soon = 0;
  for (const it of st.items.values()) {
    if (it.stage === null) continue;
    const has = it.days.has(day);
    const days = it.days.size + (has ? 0 : 1);
    if (it.stage === 'bush' && it.rpOk && !needsProd(it)) {
      if (days >= HARVEST_DAYS) {
        today++;
        continue;
      }
      if (has && it.days.size + 1 >= HARVEST_DAYS) {
        tomorrow++;
        continue;
      }
    }
    if (days >= HARVEST_DAYS - 1) soon++;
  }
  return { today, tomorrow, soon };
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

/** Сторона мини-игры: 1 и 4 — с польского (узнать), 2, 3 и 5 — на польский (написать/собрать; игра 5 «наоборот» — pr). */
export const sideOf = (mode: GameMode): Side => (mode === 1 || mode === 4 ? 'pr' : 'rp');
export const modeKind = (mode: GameMode): 'word' | 'phrase' => (mode <= 2 || mode === 5 ? 'word' : 'phrase');
/** Игры сборки фраз (3 и 4). */
export const isAssembleMode = (mode: GameMode): boolean => mode === 3 || mode === 4;

/** Продвинет ли верный ответ в эту сторону растение сегодня (стадию или к урожаю). `prod` — ответ будет «сам» (игра 5 по-польски). */
export function canProgress(it: ItemState, side: Side, day: number, now: number, prod = false): boolean {
  if (isOverripe(it, now)) return true;
  if (it.stage === 'seed') return true;
  // Росток: ответ в недостающую сторону, или обе стороны уже были (за один ответ — одна стадия, куст ждёт следующего).
  if (it.stage === 'sprout') return !it.sides[side] || it.sides[side === 'pr' ? 'rp' : 'pr'];
  if (it.stage === 'bush') return !it.days.has(day) || (side === 'rp' && !it.rpOk) || (prod && needsProd(it));
  return false;
}

const STAGE_RANK: Record<string, number> = { seed: 0, sprout: 1, bush: 2 };

export interface PickOpts {
  /** Последние показанные id (самые свежие в конце): их не повторяем, пока есть из чего выбрать. */
  recent?: readonly string[];
  /** Можно ли собрать фразу из плиток (игры 3 и 4). Остальные фразы растут через игры 1 и 2 как слова. По умолчанию все. */
  assemble?: (id: string) => boolean;
  /** Можно дать задание «наоборот» (игры 1 и 2): тогда нужда в другой стороне тоже поднимает слово в очереди. */
  reverse?: boolean;
  /** Это «редкое» задание: взять растение из-за пределов рабочего набора (каждое FOCUS_EVERY-е). */
  outside?: boolean;
  /** Растения на паузе (игры 3 и 4 с одной-двумя фразами, F5b): их не берём вовсе, даже если больше брать нечего (тогда null). */
  exclude?: ReadonlySet<string>;
  /** Игра 5: сторона сборки (по умолчанию rp — по-польски, ответ «сам»; pr — по-русски). */
  side?: Side;
  /** Игра 5: слово годится для сборки в эту сторону (русский перевод из букв). По умолчанию все. */
  spellable?: (id: string, side: Side) => boolean;
}

/** Сколько заданий подряд одно растение не повторяется (P3a: было 5; при 5 очередь вынужденно крутит ≥ 6 растений и не концентрируется). */
export const REPEAT_GAP = 3;
/** Сколько заданий подряд одно растение не повторяется: min(REPEAT_GAP, в пуле − 1). */
export const repeatGap = (pool: number): number => Math.max(0, Math.min(REPEAT_GAP, pool - 1));

/** Ответов по растениям за календарный день `day` (журнал дописывается по времени, идём с конца). */
export function answersOnDay(g: GardenSave, day: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = g.log.length - 1; i >= 0; i--) {
    const a = g.log[i]!;
    if (a.day < day) break;
    if (a.day === day) out.set(a.id, (out.get(a.id) ?? 0) + 1);
  }
  return out;
}

/**
 * Дать ли задание «наоборот» (игра 2 — с польского выбором, игра 1 — на польский выбором, игра 5 — сборка в другую сторону `side`):
 * растению для куста или урожая не хватает другой стороны, а ответ в сторону игры ему сейчас не нужен.
 * `side` — сторона игры (по умолчанию `sideOf(mode)`; у игры 5 её выбирает игрок переключателем).
 */
export function wantsReverse(it: ItemState, mode: GameMode, day: number, now: number, side: Side = sideOf(mode)): boolean {
  if (isAssembleMode(mode) || it.stage === null || isOverripe(it, now)) return false;
  if (it.sideAns[side] < REVERSE_MIN_DIRECT) return false;
  const other: Side = side === 'pr' ? 'rp' : 'pr';
  const prodOf = (s: Side): boolean => mode === 5 && s === 'rp';
  if (harvestsNow(it, side, day, prodOf(side))) return false;
  if (harvestsNow(it, other, day, prodOf(other))) return true;
  const needs = (s: Side): boolean => needsSide(it, s) || (prodOf(s) && needsProd(it));
  return !needs(side) && needs(other);
}

/** Задание «наоборот» не чаще, чем каждое REVERSE_EVERY-е. */
export const REVERSE_EVERY = 3;
/** «Наоборот» не раньше, чем у слова столько верных ответов в прямой стороне игры (P3a). */
export const REVERSE_MIN_DIRECT = 2;
/** «Наоборот» не в первые столько заданий за всё время (первый день: новичку сначала нужна привычная сторона). */
export const REVERSE_AFTER = 10;
/** Рабочий набор очереди: столько ближайших к урожаю растений получают почти все задания (P3a). */
export const FOCUS_SIZE = 8;
/** Из скольких заданий одно берётся из-за пределов рабочего набора. */
export const FOCUS_EVERY = 5;

/**
 * На сегодня больше нечего дать: ни стадии, ни зачёта дня (куст уже засчитан сегодня и с «по-польски»). Уходит в конец очереди.
 * `prod` — игра может дать ответ «сам» (игра 5): кусту слова без него ещё есть что дать.
 */
export function settledToday(it: ItemState, day: number, now: number, prod = false): boolean {
  if (it.stage !== 'bush' || isOverripe(it, now)) return false;
  return !(['pr', 'rp'] as Side[]).some((s) => canProgress(it, s, day, now, prod && s === 'rp') || harvestsNow(it, s, day, prod && s === 'rp'));
}

/** Верный ответ в эту сторону сейчас соберёт урожай. `prod` — ответ будет «сам» (игра 5 по-польски). */
export function harvestsNow(it: ItemState, side: Side, day: number, prod = false): boolean {
  return (
    it.stage === 'bush' &&
    (it.rpOk || side === 'rp') &&
    (!it.needProd || it.prodOk || (prod && side === 'rp')) &&
    it.days.size + (it.days.has(day) ? 0 : 1) >= HARVEST_DAYS
  );
}

/** Растению сегодня не хватает зачёта дня для урожая: рост уже начат в прошлые дни, сегодня верного ответа ещё нет. */
export function needsDay(it: ItemState, day: number): boolean {
  return it.stage !== null && it.days.size > 0 && !it.days.has(day);
}

/** Растению для куста или урожая не хватает именно этой стороны. */
export function needsSide(it: ItemState, side: Side): boolean {
  if (it.stage === 'seed' || it.stage === 'sprout') return !it.sides[side];
  return it.stage === 'bush' && side === 'rp' && !it.rpOk;
}

/**
 * Следующее задание мини-игры из посаженного на грядках. Игры 1 и 2 берут слова и «короткие» фразы (их не собрать из плиток),
 * игры 3 и 4 — фразы, пригодные для сборки.
 * Порядок (P2a: очередь ведёт растения к урожаю, а не размазывает ответы по всей теме):
 *   перезревшие → кому верный ответ сейчас даст урожай → кому сегодня не хватает зачёта дня (рост начат раньше; ближе к
 *   урожаю — раньше) → кому не хватает этой стороны (игра 2 — «по-польски», игра 1 — «с польского»; ближе к урожаю —
 *   раньше; с `reverse` — и другой стороны, тогда ферма даёт задание «наоборот») → прежние правила: у кого сегодня меньше
 *   ответов, кому ответ поможет, ближе к урожаю, давно не отвечал.
 * Одно и то же растение не раньше, чем через `repeatGap` заданий.
 */
export function pickTask(g: GardenSave, st: GardenState, mode: GameMode, now: number, day: number, opts: PickOpts = {}): string | null {
  const side = mode === 5 ? (opts.side ?? 'rp') : sideOf(mode);
  const assemble = opts.assemble ?? (() => true);
  const spellable = opts.spellable ?? (() => true);
  const rev = !!opts.reverse && !isAssembleMode(mode);
  const other: Side = side === 'pr' ? 'rp' : 'pr';
  // Игра 5: слова (фразы — нет). «Наоборот» берёт слово, которое собирается и в другую сторону.
  const pool = [...st.items.values()].filter((it) => {
    if (!(g.slots[it.id] !== undefined || isOverripe(it, now)) || !(it.stage !== null || isOverripe(it, now))) return false;
    if (mode === 5) return !it.phrase && (spellable(it.id, side) || (rev && spellable(it.id, other)));
    if (mode <= 2) return !it.phrase || !assemble(it.id);
    return it.phrase && assemble(it.id);
  });
  if (!pool.length) return null;
  const today = answersOnDay(g, day);
  const gap = repeatGap(pool.length);
  const banned = new Set(gap > 0 ? (opts.recent ?? []).slice(-gap) : []);
  // Ответ «сам» (production): игра 5 по-польски. «Наоборот» игры 5 по-русски даёт его в другую сторону.
  const prodS = mode === 5 && side === 'rp';
  const prodO = mode === 5 && other === 'rp';
  // «Наоборот» только растениям, у которых уже есть 2 верных ответа в прямой стороне игры.
  const revFor = (it: ItemState): boolean => rev && it.sideAns[side] >= REVERSE_MIN_DIRECT && (mode !== 5 || spellable(it.id, other));
  const direct = (it: ItemState): boolean => mode !== 5 || spellable(it.id, side);
  const settled = (it: ItemState): boolean => settledToday(it, day, now, mode === 5);
  const progressOf = (it: ItemState): number => (STAGE_RANK[it.stage ?? 'seed'] ?? 0) * 100 + it.days.size * 10 + it.drops;
  // Рабочий набор (P3a): FOCUS_SIZE ближайших к урожаю растений, которым сегодня ещё есть что дать; порядок устойчивый (по посадке).
  const focus = new Set(
    pool
      .filter((it) => it.stage !== null && !settled(it))
      .sort((a, b) => progressOf(b) - progressOf(a) || b.answers - a.answers || a.plantedAt - b.plantedAt || (g.slots[a.id] ?? 0) - (g.slots[b.id] ?? 0))
      .slice(0, FOCUS_SIZE)
      .map((it) => it.id),
  );
  const key = (it: ItemState): number[] => {
    const over = isOverripe(it, now);
    const r = revFor(it);
    const d = direct(it);
    const helps = over || (d && canProgress(it, side, day, now, prodS)) || (r && canProgress(it, other, day, now, prodO));
    const progress = progressOf(it);
    const day0 = !over && needsDay(it, day);
    const needs = (s: Side, prod: boolean): boolean => needsSide(it, s) || (prod && needsProd(it));
    const side0 = !over && !day0 && ((d && needs(side, prodS)) || (r && needs(other, prodO)));
    const inFocus = focus.has(it.id);
    const harvest = (d && harvestsNow(it, side, day, prodS)) || (r && harvestsNow(it, other, day, prodO));
    // Ответу в этой игре сегодня нечего дать (ни стадии, ни зачёта дня): в конец, даже если растение в рабочем наборе
    // (P4a: `Dobranoc` 3 раза за 18 заданий без пользы).
    const useless = !helps && !harvest && it.days.has(day);
    return [
      // Созревшее на сегодня (зачёт дня есть, до урожая нужен только следующий день) — в самый конец.
      settled(it) ? 1 : 0,
      useless ? 1 : 0,
      over ? 0 : 1,
      !over && harvest ? 0 : 1,
      // Рабочий набор вперёд; для «редкого» задания (каждое FOCUS_EVERY-е) — наоборот, остальные вперёд, ближние к урожаю раньше.
      opts.outside ? (inFocus ? 1 : 0) : inFocus ? 0 : 1,
      opts.outside && !inFocus ? -progress : 0,
      day0 ? 0 : 1,
      side0 ? 0 : 1,
      day0 || side0 ? -progress : 0,
      today.get(it.id) ?? 0,
      helps ? 0 : 1,
      it.answers === 0 ? 0 : 1,
      helps ? -progress : 0,
      it.lastAnswer ?? 0,
      g.slots[it.id] ?? 0,
    ];
  };
  const sorted = pool
    .filter((it) => !banned.has(it.id) && !opts.exclude?.has(it.id))
    .map((it) => ({ it, k: key(it) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i]! - b.k[i]!;
      return 0;
    });
  return (sorted[0]?.it ?? pool.find((it) => !opts.exclude?.has(it.id)))?.id ?? null;
}

/** Нормализация раздела сохранения (мусор отбрасывается). */
export function normalizeGarden(raw: unknown): GardenSave {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const planted = Array.isArray(r.planted)
    ? r.planted.filter((p): p is PlantEntry => !!p && typeof p === 'object' && typeof p.id === 'string' && num(p.t)).map((p) => (p.start === 'bush' ? { t: p.t, id: p.id, start: 'bush' as const } : { t: p.t, id: p.id }))
    : [];
  const log = Array.isArray(r.log)
    ? r.log
        .filter((a): a is AnswerEntry => !!a && typeof a === 'object' && typeof a.id === 'string' && num(a.t) && num(a.day) && (a.side === 'pr' || a.side === 'rp') && typeof a.ok === 'boolean' && [1, 2, 3, 4, 5].includes(a.mode))
        .map((a) => ({ t: a.t, day: a.day, id: a.id, side: a.side, ok: a.ok, mode: a.mode, ...(a.self === true ? { self: true } : {}), ...(a.prod === true ? { prod: true } : {}) }))
    : [];
  const slots: Record<string, number> = {};
  if (r.slots && typeof r.slots === 'object') for (const [k, v] of Object.entries(r.slots as Record<string, unknown>)) if (num(v) && v >= 0) slots[k] = Math.trunc(v);
  const tier = num(r.tier) ? Math.max(0, Math.min(TIER_CAP.length - 1, Math.trunc(r.tier))) : 0;
  return withProdFrom({ planted, log, slots, tier, ...(num(r.prodFrom) ? { prodFrom: r.prodFrom } : {}) });
}

/** Сохранение до игры 5 (нет `prodFrom`): весь его журнал — по прежнему правилу (любой верный rp = «сам»), прогресс не теряется. */
export function withProdFrom(g: GardenSave): GardenSave {
  if (g.prodFrom !== undefined) return g;
  return { ...g, prodFrom: g.log.reduce((m, a) => Math.max(m, a.t + 1), 0) };
}
