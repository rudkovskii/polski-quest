// Ферма целиком: модель огорода + база A1 + шина. Реализует FarmApi для экранов и даёт мини-игре задания и ответы.
// Хранилище, часы и озвучку подставляет склейка (main.ts): здесь нет браузера.
import type { BusEvents } from '../types/bus';
import type { FarmAct, FarmApi, FarmStats, GameMode, ItemInfo, PlantView } from '../types/farm';
import type { Bus } from './bus';
import { PHRASES, PHRASE_BY_ID, TOPICS, WORDS, WORD_BY_ID, isPhraseId, plOf } from './content';
import {
  PLOT_CELLS,
  TIER_CAP,
  applyAnswer,
  dayOf,
  derive,
  dueAt,
  levelOf,
  partialUnits,
  type LevelInfo,
  nextText,
  pickTask,
  plant,
  progressText,
  ripeSoon,
  sideOf,
  stageOf,
  statusOf,
  syncSlots,
  type AnswerEntry,
  type GardenSave,
  type GardenState,
} from './garden';
import { canAssemble, grade, makeQuestion, type Question } from './quiz';

export interface FarmDeps {
  bus: Bus<BusEvents>;
  load(): GardenSave;
  save(g: GardenSave): void;
  now(): number;
  /** `Date#getTimezoneOffset()` в момент `t`. */
  tz(t: number): number;
  say(id: string, slow?: boolean): void;
  rand?: () => number;
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

export interface Farm extends FarmApi {
  /** Следующее задание мини-игры (и `farm:focus` для героя). */
  next(mode: GameMode, only?: string): Question | null;
  answer(q: Question, given: string | readonly string[]): AnswerOut;
  /** Скоро урожай: сегодня одним верным ответом и завтра. */
  ripeSoon(): { today: number; tomorrow: number };
  /** Режим для «Повторить сейчас»: тот, что продвинет растение. */
  reviewMode(id: string): GameMode;
  plants(): PlantView[];
  /** На грядках: слов, фраз всего и сколько из фраз годятся для сборки (игры 3 и 4; остальные идут в игры 1 и 2). */
  counts(): { words: number; phrases: number; assemble: number };
  /** Пересчитать раскладку (время идёт: перезревшие возвращаются) и разослать грядки и опыт. */
  refresh(): void;
  readonly garden: GardenSave;
  readonly state: GardenState;
}

const STAGE_RANK: Record<string, number> = { seed: 0, sprout: 1, bush: 2, overripe: 3 };

export function createFarm(d: FarmDeps): Farm {
  const rand = d.rand ?? Math.random;
  let g: GardenSave = d.load();
  let st: GardenState = derive(g);
  /** Последние показанные id: основа правила «не повторять чаще, чем раз в N заданий». */
  const recent: string[] = [];
  const listeners = new Set<() => void>();

  const today = (): number => {
    const t = d.now();
    return dayOf(t, d.tz(t));
  };

  const grownWords = (): number => [...st.items.values()].filter((it) => !it.phrase && it.harvests > 0).length;
  const grownPhrases = (): number => [...st.items.values()].filter((it) => it.phrase && it.harvests > 0).length;
  const level = (): LevelInfo => levelOf(grownWords(), grownPhrases(), WORDS.length, PHRASES.length, partialUnits(st));
  /** Фраза для сборки из плиток (иначе растёт в играх 1 и 2 как слово). */
  const assemble = (id: string): boolean => {
    const p = PHRASE_BY_ID.get(id);
    return !!p && canAssemble(p);
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
      out.push({ slot, tile: [cell[0], cell[1]], id, label: plOf(id), stage, drops: it.drops, phrase: it.phrase });
    }
    return out.sort((a, b) => a.slot - b.slot);
  };

  const emitPlants = (): void => {
    d.bus.emit('farm:plants', { plants: plants(), cells: PLOT_CELLS.slice(0, TIER_CAP[g.tier]).map((c) => [c[0], c[1]]) });
  };
  const emitXp = (gain = 0, up = false): void => {
    const l = level();
    d.bus.emit('hud:xp', { level: l.level, ratio: l.ratio, xp: st.xp, next: l.next, ...(gain ? { gain } : {}), ...(up ? { up } : {}) });
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

  const farm: Farm = {
    words: WORDS,
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
      const l = level();
      const day = today();
      const items = [...st.items.values()];
      return {
        xp: st.xp,
        level: l.level,
        ratio: l.ratio,
        next: l.next,
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
    next(mode, only) {
      const now = d.now();
      const id = only ?? pickTask(g, st, mode, now, today(), { recent, assemble });
      if (!id) {
        d.bus.emit('farm:focus', { id: null, tile: null, label: '' });
        return null;
      }
      recent.push(id);
      if (recent.length > 8) recent.shift();
      const it = st.items.get(id);
      const stage = it ? stageOf(it, now) : null;
      const typed = mode === 2 && (stage === 'bush' || stage === 'overripe');
      const made = makeQuestion(mode, id, { word: (x) => WORD_BY_ID.get(x), phrase: (x) => PHRASE_BY_ID.get(x), words: WORDS, phrases: PHRASES }, rand, typed);
      const q = made && { ...made, progress: progressText(it, now, today()) };
      const slot = g.slots[id];
      const cell = slot !== undefined ? PLOT_CELLS[slot] : undefined;
      d.bus.emit('farm:focus', { id, tile: cell ? [cell[0], cell[1]] : null, label: plOf(id) });
      return q;
    },
    answer(q, given) {
      const now = d.now();
      const r = grade(q, given);
      const lvl0 = level().level;
      const slot = g.slots[q.id];
      const cell = slot !== undefined ? PLOT_CELLS[slot] : undefined;
      const e: AnswerEntry = { t: now, day: today(), id: q.id, side: sideOf(q.mode), ok: r.ok, mode: q.mode };
      g = { ...g, log: [...g.log, e] };
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
      const lvl1 = level().level;
      emitXp(o.xp, lvl1 !== lvl0);
      if (lvl1 !== lvl0) d.bus.emit('audio:play', { text: `Brawo! Poziom ${lvl1}.`, queue: true });
      changed();
      const c = content(q.id);
      const note = r.verdict === 'diacritics' ? 'Засчитано, но проверь польские буквы' : r.verdict === 'ortho' || r.verdict === 'typo' ? 'Засчитано, но есть ошибка в написании' : undefined;
      const day = today();
      return { ok: r.ok, correct: r.correct, ...c, ...(note ? { note } : {}), act, progress: progressText(st.items.get(q.id), now, day), tomorrow: ripeSoon(st, day).tomorrow };
    },
    ripeSoon: () => ripeSoon(st, today()),
    reviewMode(id) {
      const it = st.items.get(id);
      if (isPhraseId(id) && assemble(id)) return it && !it.sides.rp ? 3 : it && !it.sides.pr ? 4 : 3;
      if (!it) return 1;
      if (it.stage === 'seed') return 1;
      if (!it.sides.rp || !it.rpOk) return 2;
      if (!it.sides.pr) return 1;
      return 2;
    },
    plants,
    counts() {
      let words = 0;
      let phrases = 0;
      let long = 0;
      for (const p of plants()) p.phrase ? (phrases++, assemble(p.id) && long++) : words++;
      return { words, phrases, assemble: long };
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
