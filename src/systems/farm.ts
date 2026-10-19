// Ферма целиком: модель огорода + база A1 + шина. Реализует FarmApi для экранов и даёт мини-игре задания и ответы.
// Хранилище, часы и озвучку подставляет склейка (main.ts): здесь нет браузера.
import type { BusEvents } from '../types/bus';
import type { CustomAdd, CustomApi, FarmAct, FarmApi, FarmStats, GameMode, ItemInfo, PhraseHint, PlantView, Side } from '../types/farm';
import type { Bus } from './bus';
import { ALL_WORDS, BASE_WORDS, PHRASES, PHRASE_BY_ID, TOPICS, WORD_BY_ID, isA1, isPhraseId, plOf, setCustomWords } from './content';
import { CUSTOM_LIMIT, MAX_EX, MAX_PL, MAX_RU, baseMatches, cleanLine, customId, forgetItem, isCustomId, normalizeCustom, type CustomWord } from './customWords';
import {
  PLOT_CELLS,
  TIER_CAP,
  applyAnswer,
  dayOf,
  derive,
  dueAt,
  nextText,
  pickTask,
  plant,
  progressText,
  ripeSoon,
  REVERSE_AFTER,
  REVERSE_EVERY,
  FOCUS_EVERY,
  wantsReverse,
  isAssembleMode,
  needsProd,
  sideOf,
  stageOf,
  statusOf,
  syncSlots,
  withProdFrom,
  type AnswerEntry,
  type GardenSave,
  type GardenState,
} from './garden';
import { lookOf } from './plantLook';
import { canAssemble, canSpell, grade, makeQuestion, type Question } from './quiz';
import { BASE, SUB_COUNT, THRESHOLDS, pathOf, pointsOf, type PathInfo } from './xp';

export interface FarmDeps {
  bus: Bus<BusEvents>;
  load(): GardenSave;
  save(g: GardenSave): void;
  now(): number;
  /** `Date#getTimezoneOffset()` в момент `t`. */
  tz(t: number): number;
  say(id: string, slow?: boolean): void;
  rand?: () => number;
  /** Свои слова (`Save.custom`). Нет — своих слов не бывает (тесты). */
  customs?: { load(): CustomWord[]; save(list: CustomWord[]): void };
}

export interface AnswerOut {
  ok: boolean;
  correct: string;
  pl: string;
  ru: string;
  tr: string;
  note?: string;
  act: FarmAct;
  /** Что осталось этому растению после ответа («до урожая: ещё 1 день»). */
  progress: string;
  /** Сколько растений созреет завтра (сегодня уже засчитано, завтра последний день). */
  tomorrow: number;
}

/** Фраз в пуле сборки меньше этого — одну и ту же не крутим (F5b). */
export const ASSEMBLE_POOL_MIN = 3;
/** На сколько заданий (ответов в любой игре) фраза уходит на паузу после ответа, если в пуле сборки мало фраз. */
export const PAUSE_TASKS = 3;

export interface Farm extends FarmApi {
  /** Следующее задание мини-игры (и `farm:focus` для героя). `dir` — сторона игры 5 (переключатель «↔ наоборот»). */
  next(mode: GameMode, only?: string, opts?: { dir?: Side }): Question | null;
  answer(q: Question, given: string | readonly string[]): AnswerOut;
  /** Скоро урожай: сегодня одним верным ответом и завтра. */
  ripeSoon(): { today: number; tomorrow: number; soon: number };
  /** Режим для «Повторить сейчас»: тот, что продвинет растение. */
  reviewMode(id: string): GameMode;
  plants(): PlantView[];
  /**
   * На грядках: слов, фраз всего и сколько из фраз годятся для сборки (игры 3 и 4; остальные идут в игры 1 и 2);
   * `spell` — кусты слов, которым для урожая не хватает слова, собранного самому (игра 5).
   */
  counts(): { words: number; phrases: number; assemble: number; spell: number };
  /** Пересчитать раскладку (время идёт: перезревшие возвращаются) и разослать грядки и опыт. */
  refresh(): void;
  /**
   * Игры 3 и 4: все фразы сборки на паузе (в пуле меньше `ASSEMBLE_POOL_MIN`, каждая только что отвечена), задание не выдаётся.
   * Тогда панель предлагает посадить ещё (`hint`) или выйти. null — задание есть, или сборке нечего (фраз на грядках нет), или игра 1/2.
   */
  gap(mode: GameMode): { hint: PhraseHint | null } | null;
  /** Ближайшая ещё не посаженная фраза для сборки и что ей нужно (null — таких нет). */
  phraseHint(): PhraseHint | null;
  readonly garden: GardenSave;
  readonly state: GardenState;
}

const STAGE_RANK: Record<string, number> = { seed: 0, sprout: 1, bush: 2, overripe: 3 };

export function createFarm(d: FarmDeps): Farm {
  const rand = d.rand ?? Math.random;
  // Сохранение до игры 5: отметка, с какого ответа слову нужен «сам» (старые ответы — по прежнему правилу).
  let g: GardenSave = withProdFrom(d.load());
  // Свои слова: в реестр содержимого до первого расчёта (иначе их растения остались бы без слова).
  let customs: CustomWord[] = normalizeCustom(d.customs?.load());
  setCustomWords(customs);
  // Растения своих слов, которых нет в сохранении (битый импорт): убираем, чтобы задание не вышло без слова.
  for (const id of new Set([...g.planted.map((p) => p.id), ...g.log.map((a) => a.id)])) if (isCustomId(id) && !WORD_BY_ID.has(id)) g = forgetItem(g, id);
  let st: GardenState = derive(g);
  /** Последние показанные id: основа правила «не повторять чаще, чем раз в N заданий». */
  const recent: string[] = [];
  /** Заданий с последнего «наоборот» (P2a: не чаще, чем каждое 3-е). */
  let sinceReverse = REVERSE_EVERY - 1;
  /** Заданий выдано (P3a: каждое FOCUS_EVERY-е берётся из-за пределов рабочего набора). */
  let issued = 0;
  /** Ответов дано (любая игра): отсчёт паузы фраз сборки. */
  let answered = 0;
  /** Фраза сборки → после какого числа ответов она снова в очереди (пока в пуле сборки < ASSEMBLE_POOL_MIN). */
  const pausedUntil = new Map<string, number>();
  const listeners = new Set<() => void>();

  const today = (): number => {
    const t = d.now();
    return dayOf(t, d.tz(t));
  };

  const grownWords = (): number => [...st.items.values()].filter((it) => !it.phrase && it.harvests > 0).length;
  /** Растущие слова базы A1 (подсказка «уже растут N» у полоски пути к A1). */
  const growingWords = (): number => [...st.items.values()].filter((it) => !it.phrase && isA1(it.id) && it.harvests === 0 && it.stage !== null).length;
  const grownPhrases = (): number => [...st.items.values()].filter((it) => it.phrase && it.harvests > 0).length;
  /** Путь к A1 — только по базе A1: слова темы «Święta i zwyczaje» (v2) в очки не идут. */
  const path = (): PathInfo => pathOf(pointsOf([...st.items.values()].filter((it) => isA1(it.id))));
  /** Позиция на пути при запуске фермы: от неё считается рост за сессию («+0,4 уровня»). */
  const pos0 = path().pos;
  /** Фраза для сборки из плиток (иначе растёт в играх 1 и 2 как слово). */
  const assemble = (id: string): boolean => {
    const p = PHRASE_BY_ID.get(id);
    return !!p && canAssemble(p);
  };

  /** Фразы сборки на паузе: только пока их в пуле мало. */
  const pausedAssemble = (): Set<string> => {
    const out = new Set<string>();
    if (farm.counts().assemble >= ASSEMBLE_POOL_MIN) return out;
    for (const [id, until] of pausedUntil) if (until > answered) out.add(id);
    return out;
  };

  const plants = (): PlantView[] => {
    const now = d.now();
    const out: PlantView[] = [];
    for (const [id, slot] of Object.entries(g.slots)) {
      const it = st.items.get(id);
      const cell = PLOT_CELLS[slot];
      if (!it || !cell) continue;
      const stage = stageOf(it, now);
      if (!stage) continue;
      out.push({ slot, tile: [cell[0], cell[1]], id, label: plOf(id), stage, drops: it.drops, phrase: it.phrase, look: lookOf(id, WORD_BY_ID.get(id)) });
    }
    return out.sort((a, b) => a.slot - b.slot);
  };

  const emitPlants = (): void => {
    d.bus.emit('farm:plants', { plants: plants(), cells: PLOT_CELLS.slice(0, TIER_CAP[g.tier]).map((c) => [c[0], c[1]]) });
  };
  const emitXp = (gain = 0, up = false): void => {
    const l = path();
    d.bus.emit('hud:xp', {
      level: l.ru,
      ratio: l.ratio,
      sub: l.sub,
      of: SUB_COUNT,
      pct: l.pct,
      pos: l.pos,
      toNext: l.toNext,
      xp: st.xp,
      growing: growingWords(),
      ...(gain ? { gain } : {}),
      ...(up ? { up } : {}),
    });
  };
  const changed = (): void => {
    d.save(g);
    for (const fn of [...listeners]) fn();
  };

  const missingWords = (pid: string): string[] => {
    const p = PHRASE_BY_ID.get(pid);
    if (!p) return [];
    const now = d.now();
    // P2a: фраза открывается, когда все её слова хотя бы ростки (раньше — кусты).
    return p.words.filter((w) => {
      if (!WORD_BY_ID.has(w)) return false;
      const it = st.items.get(w);
      if (!it) return true;
      if (it.harvests > 0) return false;
      return (STAGE_RANK[stageOf(it, now) ?? 'seed'] ?? 0) < STAGE_RANK.sprout!;
    });
  };

  const info = (id: string): ItemInfo => {
    const now = d.now();
    const it = st.items.get(id);
    const status = statusOf(st, g, id, now);
    return {
      id,
      kind: isPhraseId(id) ? 'phrase' : 'word',
      status,
      stage: it ? stageOf(it, now) : null,
      drops: it?.drops ?? 0,
      sides: { pr: it?.sides.pr ?? false, rp: it?.sides.rp ?? false },
      prod: isPhraseId(id) ? null : (it?.prodOk ?? false),
      days: it?.days.size ?? 0,
      next: nextText(it, now, today()),
      harvests: it?.harvests ?? 0,
      dueAt: it ? dueAt(it) : null,
      slot: g.slots[id] ?? null,
    };
  };

  const content = (id: string): { pl: string; ru: string; tr: string } => {
    const w = WORD_BY_ID.get(id) ?? PHRASE_BY_ID.get(id);
    return w ? { pl: w.pl, ru: w.ru, tr: w.tr } : { pl: id, ru: '', tr: '' };
  };

  const custom: CustomApi = {
    list: () => ALL_WORDS.filter((w) => isCustomId(w.id)),
    add(input): CustomAdd {
      const pl = cleanLine(input.pl, MAX_PL);
      const ru = cleanLine(input.ru, MAX_RU);
      if (!pl || !ru) return { ok: false, reason: 'empty' };
      const id = customId(pl, ru, customs);
      if (customs.some((c) => c.id === id)) return { ok: true, id, existed: true };
      if (customs.length >= CUSTOM_LIMIT) return { ok: false, reason: 'limit' };
      const exPl = cleanLine(input.ex?.pl, MAX_EX);
      const c: CustomWord = {
        id,
        pl,
        ru,
        pos: input.pos ?? (pl.includes(' ') ? 'phrase' : 'noun'),
        ...(input.gender ? { gender: input.gender } : {}),
        ...(exPl ? { ex: { pl: exPl, ru: cleanLine(input.ex?.ru, MAX_EX) } } : {}),
        added: d.now(),
      };
      saveCustoms([...customs, c]);
      return { ok: true, id, existed: false };
    },
    update(id, patch) {
      const c = customs.find((x) => x.id === id);
      if (!c) return false;
      const pl = patch.pl === undefined ? c.pl : cleanLine(patch.pl, MAX_PL);
      const ru = patch.ru === undefined ? c.ru : cleanLine(patch.ru, MAX_RU);
      if (!pl || !ru) return false;
      const exPl = patch.ex === undefined ? (c.ex?.pl ?? '') : cleanLine(patch.ex?.pl, MAX_EX);
      const exRu = patch.ex === undefined ? (c.ex?.ru ?? '') : cleanLine(patch.ex?.ru, MAX_EX);
      const { ex: _drop, ...rest } = c;
      saveCustoms(customs.map((x) => (x.id === id ? { ...rest, pl, ru, ...(exPl ? { ex: { pl: exPl, ru: exRu } } : {}) } : x)));
      return true;
    },
    remove(id) {
      if (!customs.some((x) => x.id === id)) return false;
      const now = d.now();
      const left = forgetItem(g, id);
      st = derive(left);
      g = syncSlots(left, st, now);
      customs = customs.filter((x) => x.id !== id);
      setCustomWords(customs);
      d.customs?.save(customs);
      emitPlants();
      emitXp();
      changed();
      return true;
    },
    base: (...ru) => baseMatches(BASE_WORDS, ...ru),
  };
  /** Записать список своих слов: реестр содержимого, сохранение, оповестить экраны. */
  function saveCustoms(list: CustomWord[]): void {
    customs = list;
    setCustomWords(customs);
    d.customs?.save(customs);
    for (const fn of [...listeners]) fn();
  }

  const farm: Farm = {
    custom,
    words: ALL_WORDS,
    phrases: PHRASES,
    topics: TOPICS,
    word: (id) => WORD_BY_ID.get(id),
    phrase: (id) => PHRASE_BY_ID.get(id),
    info,
    missingWords,
    plant(ids) {
      const now = d.now();
      const ok = ids.filter((id) => (WORD_BY_ID.has(id) || PHRASE_BY_ID.has(id)) && (!isPhraseId(id) || missingWords(id).length === 0));
      const r = plant(g, st, ok, now);
      if (!r.added.length) return { planted: 0, bag: 0, skipped: ids.length };
      g = syncSlots(r.save, (st = derive(r.save)), now);
      const onPlot = r.added.filter((id) => g.slots[id] !== undefined).length;
      emitPlants();
      changed();
      return { planted: onPlot, bag: r.added.length - onPlot, skipped: ids.length - r.added.length };
    },
    stats(): FarmStats {
      const l = path();
      const day = today();
      const items = [...st.items.values()];
      return {
        xp: st.xp,
        level: l.ru,
        ratio: l.ratio,
        path: l,
        base: BASE,
        thresholds: THRESHOLDS,
        sessionGain: Math.max(0, l.pos - pos0),
        grownToday: st.grownByDay.get(day) ?? 0,
        grownTotal: items.filter((it) => it.harvests > 0).length,
        grownWords: grownWords(),
        grownPhrases: grownPhrases(),
        growing: Object.keys(g.slots).length,
        bag: items.filter((it) => it.stage !== null && g.slots[it.id] === undefined).length,
        answersToday: st.answersByDay.get(day) ?? 0,
      };
    },
    pantry() {
      const by = new Map<string, string[]>();
      for (const it of st.items.values()) {
        if (it.harvests < 1) continue;
        const topic = WORD_BY_ID.get(it.id)?.topic ?? PHRASE_BY_ID.get(it.id)?.topic ?? 'rozmowa';
        by.set(topic, [...(by.get(topic) ?? []), it.id]);
      }
      return TOPICS.filter((t) => by.has(t.id)).map((t) => ({ topic: t.id, ids: by.get(t.id)! }));
    },
    say: (id, slow) => d.say(id, slow),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    next(mode, only, opts) {
      const now = d.now();
      // Игра 5: сторона сборки (по умолчанию по-польски); «наоборот» — в другую.
      const dir: Side = opts?.dir ?? 'rp';
      // «Наоборот» не в первые REVERSE_AFTER ответов: сначала привычная сторона (P3a).
      const canReverse = !only && !isAssembleMode(mode) && sinceReverse >= REVERSE_EVERY - 1 && g.log.length >= REVERSE_AFTER;
      const outside = !only && ++issued % FOCUS_EVERY === 0;
      const exclude = !only && isAssembleMode(mode) ? pausedAssemble() : undefined;
      const spellable = (x: string, side: Side): boolean => {
        const w = WORD_BY_ID.get(x);
        return !!w && canSpell(w, side);
      };
      const id =
        only ??
        pickTask(g, st, mode, now, today(), { recent, assemble, reverse: canReverse, outside, ...(exclude?.size ? { exclude } : {}), ...(mode === 5 ? { side: dir, spellable } : {}) });
      if (!id) {
        d.bus.emit('farm:focus', { id: null, tile: null, label: '' });
        return null;
      }
      recent.push(id);
      if (recent.length > 8) recent.shift();
      const it = st.items.get(id);
      const other: Side = dir === 'rp' ? 'pr' : 'rp';
      // «Наоборот»: растению не хватает другой стороны — в игре 2 спросим с польского, в игре 1 — на польский (выбором),
      // в игре 5 соберём слово в другую сторону. Слово, которое в сторону игры 5 не собрать (перевод не из букв), — всегда в другую.
      const cantDirect = mode === 5 && !spellable(id, dir);
      const reverse = (cantDirect && spellable(id, other)) || (canReverse && !!it && wantsReverse(it, mode, today(), now, mode === 5 ? dir : undefined) && (mode !== 5 || spellable(id, other)));
      if (!only) sinceReverse = reverse ? 0 : sinceReverse + 1;
      const qmode: GameMode = reverse && mode <= 2 ? (mode === 1 ? 2 : 1) : mode;
      // «Напиши сам» в игре 2 больше нет (19.10): слово «по-польски само» собирается в игре 5 («Собери слово»).
      const made = makeQuestion(qmode, id, { word: (x) => WORD_BY_ID.get(x), phrase: (x) => PHRASE_BY_ID.get(x), words: ALL_WORDS, phrases: PHRASES }, rand, mode === 5 ? { dir: reverse ? other : dir } : {});
      const q = made && { ...made, progress: progressText(it, now, today()), ...(reverse ? { reverse: true } : {}) };
      const slot = g.slots[id];
      const cell = slot !== undefined ? PLOT_CELLS[slot] : undefined;
      d.bus.emit('farm:focus', { id, tile: cell ? [cell[0], cell[1]] : null, label: plOf(id) });
      return q;
    },
    answer(q, given) {
      const now = d.now();
      const r = grade(q, given);
      const p0 = path();
      const slot = g.slots[q.id];
      const cell = slot !== undefined ? PLOT_CELLS[slot] : undefined;
      // Игра 5: сторона — куда собирали; «сам» (production) — по-польски, без подсказки, буквы точно.
      const side: Side = q.kind === 'spell' ? q.dir : sideOf(q.mode);
      const prod = q.kind === 'spell' && q.dir === 'rp' && r.ok && r.verdict === 'exact' && !q.hinted;
      const e: AnswerEntry = { t: now, day: today(), id: q.id, side, ok: r.ok, mode: q.mode, ...(prod ? { prod: true } : {}) };
      g = { ...g, log: [...g.log, e] };
      answered++;
      // Игры 3 и 4 с одной-двумя фразами: ответленная фраза отдыхает 3 ответа, а не крутится по кругу (F5b).
      if (isAssembleMode(q.mode) && farm.counts().assemble < ASSEMBLE_POOL_MIN) pausedUntil.set(q.id, answered + PAUSE_TASKS);
      const o = applyAnswer(st, e);
      g = syncSlots(g, st, now);
      const act: FarmAct = {
        kind: o.kind === 'none' ? 'water' : o.kind,
        id: q.id,
        label: plOf(q.id),
        tile: cell ? [cell[0], cell[1]] : null,
        xp: o.xp,
      };
      d.bus.emit('farm:act', act);
      emitPlants();
      const p1 = path();
      emitXp(o.xp, p1.sub > p0.sub);
      if (p1.sub > p0.sub) d.bus.emit('audio:play', { text: `Brawo! ${p1.pl}.`, queue: true });
      changed();
      const c = content(q.id);
      // Слово по-польски засчитано, но не «само» (подсказка, ошибка в буквах при вводе): для урожая его ещё надо собрать.
      const notSelf = q.kind === 'spell' && q.dir === 'rp' && r.ok && !prod ? ' (не как «сам»)' : '';
      const note =
        r.verdict === 'diacritics'
          ? `Засчитано${notSelf}, но проверь польские буквы`
          : r.verdict === 'ortho' || r.verdict === 'typo'
            ? `Засчитано${notSelf}, но есть ошибка в написании`
            : q.kind === 'spell' && q.hinted && r.ok
              ? `Засчитано с подсказкой${notSelf}`
              : undefined;
      const day = today();
      return { ok: r.ok, correct: r.correct, ...c, ...(note ? { note } : {}), act, path: { from: p0.pos, to: p1.pos, sub: p1.sub, pl: p1.pl }, progress: progressText(st.items.get(q.id), now, day), tomorrow: ripeSoon(st, day).tomorrow };
    },
    ripeSoon: () => ripeSoon(st, today()),
    reviewMode(id) {
      const it = st.items.get(id);
      if (isPhraseId(id) && assemble(id)) return it && !it.sides.rp ? 3 : it && !it.sides.pr ? 4 : 3;
      if (!it) return 1;
      if (it.stage === 'seed') return 1;
      // Кусту слова для урожая не хватает слова, собранного самому: «Повторить» открывает игру 5.
      if (needsProd(it)) return 5;
      if (!it.sides.rp || !it.rpOk) return 2;
      if (!it.sides.pr) return 1;
      return 2;
    },
    plants,
    counts() {
      let words = 0;
      let phrases = 0;
      let long = 0;
      let spell = 0;
      for (const p of plants()) {
        if (p.phrase) {
          phrases++;
          if (assemble(p.id)) long++;
        } else {
          words++;
          const it = st.items.get(p.id);
          if (it && needsProd(it)) spell++;
        }
      }
      return { words, phrases, assemble: long, spell };
    },
    gap(mode) {
      if (!isAssembleMode(mode)) return null;
      const n = farm.counts().assemble;
      if (n === 0 || n >= ASSEMBLE_POOL_MIN) return null;
      const paused = pausedAssemble();
      const free = plants().some((p) => p.phrase && assemble(p.id) && !paused.has(p.id));
      return free ? null : { hint: farm.phraseHint() };
    },
    phraseHint() {
      let best: { p: (typeof PHRASES)[number]; miss: string[]; fresh: number } | null = null;
      for (const p of PHRASES) {
        // Только фразы сборки (≥ 3 плиток), не равные слову («Nie ma za co.» = слово «nie ma za co»: сборка не тренируется, F5b).
        if (!canAssemble(p) || st.items.has(p.id) || equalsWord(p)) continue;
        const miss = missingWords(p.id);
        const fresh = miss.filter((w) => !st.items.has(w)).length;
        if (!best || miss.length < best.miss.length || (miss.length === best.miss.length && fresh < best.fresh)) best = { p, miss, fresh };
      }
      if (!best) return null;
      const label = (w: string): string => WORD_BY_ID.get(w)?.pl ?? w;
      return {
        id: best.p.id,
        pl: best.p.pl,
        ru: best.p.ru,
        // Одно слово не стоит в обеих строках: «Нужно» — ещё не посаженные, «Уже растут» — посаженные, но не ростки.
        need: best.miss.filter((w) => !st.items.has(w)).map(label),
        growing: best.miss.filter((w) => st.items.has(w)).map(label),
        toPlant: best.miss.length ? best.miss.filter((w) => !st.items.has(w)) : [best.p.id],
        ready: best.miss.length === 0,
      };
    },
    refresh() {
      const now = d.now();
      const ng = syncSlots(g, st, now);
      if (ng !== g) {
        g = ng;
        changed();
      }
      emitPlants();
      emitXp();
    },
    get garden() {
      return g;
    },
    get state() {
      return st;
    },
  };
  return farm;
}

const normPl = (s: string): string => s.toLowerCase().replace(/[.!?,;:…«»"']/g, '').replace(/\s+/g, ' ').trim();
/** Фраза совпадает с одним из своих слов (то же написание): отдельной фразы тут нет, слово уже есть в базе. */
function equalsWord(p: { pl: string; words: readonly string[] }): boolean {
  const k = normPl(p.pl);
  return p.words.some((w) => {
    const x = WORD_BY_ID.get(w);
    return !!x && normPl(x.pl) === k;
  });
}

