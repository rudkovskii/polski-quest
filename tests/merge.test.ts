// Слияние прогрессов (ТЗ §6.4): property-тесты на случайных журналах нескольких устройств
// (500 прогонов с seed) и точечные правила по полям.
import { describe, expect, it } from 'vitest';
import type { LogEvent } from '../src/systems/log';
import {
  canonicalJson,
  covers,
  DifferentWorlds,
  isPristine,
  merge,
  mergeReport,
  rebaseOnto,
  sameProgress,
} from '../src/systems/merge';
import { newProgress, validateProgress, type Checkpoint, type Progress, type Stage } from '../src/systems/progress';

const T0 = Date.UTC(2026, 9, 15, 6, 0);
const DAY = 86_400_000;
const WORLD = 'w0rldw0rldw0rld2';
const DEVICES = ['aaaaaa', 'bbbbbb', 'cccccc'] as const;

// ── Генератор.

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type R = () => number;
const int = (r: R, n: number): number => Math.floor(r() * n);
const pick = <T>(r: R, arr: readonly T[]): T => arr[int(r, arr.length)]!;
function shuffle<T>(r: R, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(r, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Общий пул событий: у каждого устройства своя цепочка seq, плюс импортные `imp.*`. */
function eventPool(r: R): LogEvent[] {
  const out: LogEvent[] = [];
  for (const dev of DEVICES) {
    const n = int(r, 14);
    let ts = T0 + int(r, DAY);
    for (let seq = 1; seq <= n; seq++) {
      ts += int(r, 3) * 60_000; // бывают одинаковые ts у разных устройств
      const id = `${dev}.${seq.toString(36)}`;
      out.push(
        r() < 0.6
          ? { id, ts, k: 'rev', card: `lx.w${int(r, 6)}#rec`, g: pick(r, [0, 1, 2, 3] as const), ms: 1000 + int(r, 5000), src: 'obchod' }
          : { id, ts, k: 'seg', seg: pick(r, ['water', 'scene', 'evening', 'sleep'] as const) },
      );
    }
  }
  for (let i = 0; i < int(r, 3); i++) {
    out.push({ id: `imp.t${i}`, ts: T0 - DAY, k: 'imp', card: `lx.old${i}#rec`, state: { reps: 2, interval: 3, ef: 2.5, due: T0 + DAY }, from: 'trainer' });
  }
  return out;
}

/** Цепочка сравнимых свёрток (§3.12: свёртка только после успешного синка, поэтому линейна). */
function checkpointChain(r: R): Checkpoint[] {
  const chain: Checkpoint[] = [];
  const cov: Record<string, number> = {};
  for (let i = 0; i < 3; i++) {
    for (const d of DEVICES) if (r() < 0.6) cov[d] = (cov[d] ?? 0) + int(r, 4);
    chain.push(checkpoint({ ...cov }, T0 + i * DAY, i));
  }
  return chain;
}

function checkpoint(c: Record<string, number>, asOf: number, tag: number): Checkpoint {
  return {
    asOf,
    covers: c,
    cards: { [`lx.cp${tag}#rec`]: { reps: 1, interval: 1, ef: 2.5, due: asOf + DAY, lapses: 0, lastReviewAt: asOf, lastGrade: 2, maxInterval: 1, createdAt: asOf } },
    lessons: {},
    bosses: {},
    days: {},
    zlotyEarned: tag,
    zlotySpent: 0,
  };
}

const FLAG_KEYS = ['beat.first.f1', 'beat.first.f2', 'hud.obchod', 'spring.2026-10-20', 'link.saved'];
const BIOMES = ['praga', 'dzialka', 'metro'];
const SETTING_KEYS = ['diacritics', 'newItemsPerDay', 'reducedMotion', 'controls.dpad', 'custom', 'avatar'];
// Внешность (P-03, settings.avatar): объект целиком, в том числе с теми же полями в другом порядке.
const AVATAR_A = { skin: 'tan', hair: 'curly', hairColor: 'ginger', beard: 'none', glasses: 'round', top: 'tee', topColor: 'red', name: 'Dima' };
const AVATAR_B = { name: 'Dima', topColor: 'red', top: 'tee', glasses: 'round', beard: 'none', hairColor: 'ginger', hair: 'curly', skin: 'tan' };
const SETTING_VALUES: unknown[] = ['warn', 'ok', 'fail', 8, 12, true, false, { a: 1, b: 2 }, { b: 2, a: 1 }, ['x', 'y'], AVATAR_A, AVATAR_B, { ...AVATAR_A, hair: 'long' }];

function stamps(r: R, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) if (r() < 0.4) out[k] = T0 + int(r, 5) * 1000;
  return out;
}

/** Реплика мира на устройстве: подмножество пула с повторами, вариантами и в случайном порядке. */
function replica(r: R, pool: readonly LogEvent[], chain: readonly Checkpoint[] | null): Progress {
  const p = newProgress(T0 - int(r, 3) * DAY, WORLD);
  const events: LogEvent[] = [];
  for (const e of pool) {
    if (r() < 0.55) events.push(e);
    if (r() < 0.05) events.push(e); // повтор
    if (r() < 0.02 && e.k === 'rev') events.push({ ...e, g: ((e.g + 1) % 4) as 0 | 1 | 2 | 3 }); // тот же id, другое содержимое
  }
  const unlocked: Progress['world']['unlocked'] = {};
  for (const b of BIOMES) if (r() < 0.5) unlocked[b] = { stage: int(r, 4) as Stage, at: T0 + int(r, 4) * 1000 };
  const settings: Progress['settings'] = {};
  for (const k of SETTING_KEYS) if (r() < 0.5) settings[k] = { value: pick(r, SETTING_VALUES), at: T0 + int(r, 3) };
  let cp: Checkpoint | null = null;
  if (chain && r() < 0.5) cp = pick(r, chain);
  else if (!chain && r() < 0.6) {
    // Несравнимые свёртки (не должны случаться): только коммутативность и идемпотентность.
    const c: Record<string, number> = {};
    for (const d of DEVICES) if (r() < 0.6) c[d] = int(r, 6);
    cp = checkpoint(c, T0 + int(r, 3) * DAY, int(r, 3));
  }
  return {
    ...p,
    log: { checkpoint: cp, events: shuffle(r, events) },
    world: { flags: stamps(r, FLAG_KEYS), items: stamps(r, ['ticket', 'key']), unlocked, challenges: stamps(r, ['ch.kawa']) },
    settings,
  };
}

const RUNS = 500;
const eq = (a: Progress, b: Progress): boolean => canonicalJson(a) === canonicalJson(b);

describe('merge: property-тесты (500 прогонов, seed)', () => {
  it('коммутативность, идемпотентность, поглощение, ассоциативность, порядок и повторы', () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const pool = eventPool(r);
      const chain = checkpointChain(r);
      const [a, b, c] = [replica(r, pool, chain), replica(r, pool, chain), replica(r, pool, chain)];
      const ab = merge(a, b);
      const ctx = `seed ${seed}`;

      expect(eq(ab, merge(b, a)), `${ctx}: a∪b = b∪a`).toBe(true);
      expect(eq(merge(ab, ab), ab), `${ctx}: m∪m = m`).toBe(true);
      expect(eq(merge(ab, a), ab) && eq(merge(b, ab), ab), `${ctx}: m∪a = m`).toBe(true);
      expect(eq(merge(merge(a, b), c), merge(a, merge(b, c))), `${ctx}: (a∪b)∪c = a∪(b∪c)`).toBe(true);

      // Любой порядок слияний и повторы дают одно и то же.
      const ref = merge(ab, c);
      for (const order of [[c, a, b], [b, c, a], [c, b, a, a], [a, b, a, c, b, c]]) {
        const folded = order.slice(1).reduce((acc, x) => merge(acc, x), order[0]!);
        expect(eq(folded, ref), `${ctx}: порядок ${order.length}`).toBe(true);
      }

      expect(validateProgress(ref), ctx).toEqual([]);
    }
  });

  it('ни одно непокрытое событие не теряется, мир и настройки сливаются по правилам', () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed * 7919);
      const pool = eventPool(r);
      const chain = checkpointChain(r);
      const a = replica(r, pool, chain);
      const b = replica(r, pool, chain);
      const m = merge(a, b);
      const cp = m.log.checkpoint;
      const ids = new Set(m.log.events.map((e) => e.id));
      for (const e of [...a.log.events, ...b.log.events]) {
        const [dev, seq36] = e.id.split('.');
        const covered = cp !== null && cp.covers[dev!] !== undefined && parseInt(seq36!, 36) <= cp.covers[dev!]!;
        expect(ids.has(e.id), `seed ${seed}: ${e.id}`).toBe(!covered);
      }
      for (const key of ['flags', 'items', 'challenges'] as const) {
        for (const k of new Set([...Object.keys(a.world[key]), ...Object.keys(b.world[key])])) {
          expect(m.world[key][k]).toBe(Math.min(a.world[key][k] ?? Infinity, b.world[key][k] ?? Infinity));
        }
      }
      for (const k of Object.keys(m.settings)) {
        expect(m.settings[k]!.at).toBe(Math.max(a.settings[k]?.at ?? -Infinity, b.settings[k]?.at ?? -Infinity));
      }
      expect(m.createdAt).toBe(Math.min(a.createdAt, b.createdAt));
    }
  });

  it('несравнимые свёртки: коммутативно и идемпотентно, с предупреждением', () => {
    let warned = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed * 104729);
      const pool = eventPool(r);
      const a = replica(r, pool, null);
      const b = replica(r, pool, null);
      const rep = mergeReport(a, b);
      warned += rep.warnings.length;
      expect(eq(rep.progress, merge(b, a)), `seed ${seed}`).toBe(true);
      expect(eq(merge(rep.progress, rep.progress), rep.progress), `seed ${seed}`).toBe(true);
      expect(validateProgress(rep.progress)).toEqual([]);
    }
    expect(warned).toBeGreaterThan(0);
  });
});

// ── Точечные правила.

function ev(id: string, ts: number, g: 0 | 1 | 2 | 3 = 2): LogEvent {
  return { id, ts, k: 'rev', card: 'lx.kawa#rec', g, ms: 1500, src: 'obchod' };
}
function withEvents(events: LogEvent[], patch: Partial<Progress> = {}): Progress {
  const p = newProgress(T0, WORLD);
  return { ...p, ...patch, log: { checkpoint: null, events } };
}

describe('merge: правила полей', () => {
  it('разные миры → DifferentWorlds с обоими id', () => {
    const a = newProgress(T0, 'aaaaaaaaaaaaaaaa');
    const b = newProgress(T0, 'bbbbbbbbbbbbbbbb');
    expect(() => merge(a, b)).toThrow(DifferentWorlds);
    try {
      merge(a, b);
    } catch (e) {
      expect(e).toMatchObject({ a: 'aaaaaaaaaaaaaaaa', b: 'bbbbbbbbbbbbbbbb' });
    }
  });

  it('журнал: объединение по id, сортировка (ts, id), повторы схлопываются', () => {
    const a = withEvents([ev('aaaaaa.1', T0), ev('aaaaaa.2', T0 + 2000)]);
    const b = withEvents([ev('bbbbbb.1', T0 + 1000), ev('aaaaaa.1', T0), ev('bbbbbb.1', T0 + 1000)]);
    expect(merge(a, b).log.events.map((e) => e.id)).toEqual(['aaaaaa.1', 'bbbbbb.1', 'aaaaaa.2']);
    expect(mergeReport(a, b).addedToA).toBe(1);
  });

  it('журнал: одинаковый ts у разных устройств упорядочен по id', () => {
    const a = withEvents([ev('bbbbbb.1', T0)]);
    const b = withEvents([ev('aaaaaa.1', T0)]);
    expect(merge(a, b).log.events.map((e) => e.id)).toEqual(['aaaaaa.1', 'bbbbbb.1']);
  });

  it('журнал: пустые tags не создают ложных различий', () => {
    const a = withEvents([{ ...ev('aaaaaa.1', T0), tags: [] } as LogEvent]);
    const b = withEvents([ev('aaaaaa.1', T0)]);
    expect(sameProgress(merge(a, b), b)).toBe(true);
  });

  it('checkpoint: больший покрывает, покрытые события выброшены, imp.* остаются', () => {
    const small = checkpoint({ aaaaaa: 1 }, T0, 0);
    const big = checkpoint({ aaaaaa: 2, bbbbbb: 1 }, T0 + DAY, 1);
    expect(covers(big, small)).toBe(true);
    const imp: LogEvent = { id: 'imp.1', ts: T0 - DAY, k: 'imp', card: 'lx.x#rec', state: { reps: 1, interval: 1, ef: 2.5, due: T0 }, from: 'trainer' };
    const a: Progress = { ...withEvents([ev('aaaaaa.2', T0), ev('aaaaaa.3', T0 + 1), ev('bbbbbb.1', T0 + 2), imp]), log: { checkpoint: small, events: [ev('aaaaaa.2', T0), ev('aaaaaa.3', T0 + 1), ev('bbbbbb.1', T0 + 2), imp] } };
    const b: Progress = { ...withEvents([]), log: { checkpoint: big, events: [ev('aaaaaa.3', T0 + 1)] } };
    const m = mergeReport(a, b);
    expect(m.progress.log.checkpoint).toBe(big);
    expect(m.progress.log.events.map((e) => e.id)).toEqual(['imp.1', 'aaaaaa.3']);
    expect(m.warnings).toEqual([]);
  });

  it('world.unlocked: max(stage), при равенстве min(at)', () => {
    const a = { ...newProgress(T0, WORLD), world: { flags: {}, items: {}, challenges: {}, unlocked: { praga: { stage: 2 as Stage, at: 5 }, metro: { stage: 1 as Stage, at: 9 } } } };
    const b = { ...newProgress(T0, WORLD), world: { flags: {}, items: {}, challenges: {}, unlocked: { praga: { stage: 1 as Stage, at: 1 }, metro: { stage: 1 as Stage, at: 3 } } } };
    expect(merge(a, b).world.unlocked).toEqual({ metro: { stage: 1, at: 3 }, praga: { stage: 2, at: 5 } });
  });

  it('settings: LWW по at, при равенстве больший JSON значения', () => {
    const a = { ...newProgress(T0, WORLD), settings: { diacritics: { value: 'ok', at: 10 }, newItemsPerDay: { value: 6, at: 5 } } };
    const b = { ...newProgress(T0, WORLD), settings: { diacritics: { value: 'fail', at: 10 }, newItemsPerDay: { value: 12, at: 7 } } };
    const m = merge(a, b);
    expect(m.settings.diacritics).toEqual({ value: 'ok', at: 10 }); // '"ok"' > '"fail"'
    expect(m.settings.newItemsPerDay).toEqual({ value: 12, at: 7 });
  });

  it('createdAt = min, v = max', () => {
    const a = newProgress(T0 + 5, WORLD);
    const b = newProgress(T0, WORLD);
    expect(merge(a, b).createdAt).toBe(T0);
  });

  it('сценарий §6.5: офлайн на iPhone, потом Mac — оба видят все ответы', () => {
    const cloud = withEvents([ev('aaaaaa.1', T0)]);
    const mac = withEvents([...cloud.log.events, ev('bbbbbb.1', T0 + 5000)]);
    const iphone = withEvents([...cloud.log.events, ev('aaaaaa.2', T0 + 1000), ev('aaaaaa.3', T0 + 9000)]);
    const n1 = mac; // Mac записал rev n+1
    const n2 = merge(iphone, n1); // iPhone получил conflict и слил
    expect(n2.log.events.map((e) => e.id)).toEqual(['aaaaaa.1', 'aaaaaa.2', 'bbbbbb.1', 'aaaaaa.3']);
    expect(sameProgress(merge(mac, n2), n2)).toBe(true);
  });
});

describe('merge: хелперы', () => {
  it('isPristine: пустой мир да, с флагом или событием нет', () => {
    const p = newProgress(T0, WORLD);
    expect(isPristine(p)).toBe(true);
    expect(isPristine({ ...p, world: { ...p.world, flags: { 'beat.first.f1': T0 } } })).toBe(false);
    expect(isPristine(withEvents([ev('aaaaaa.1', T0)]))).toBe(false);
  });

  it('rebaseOnto: локальные события вливаются в облачный мир', () => {
    const remote = { ...withEvents([ev('aaaaaa.1', T0)]), createdAt: T0 - DAY };
    const local = { ...withEvents([ev('cccccc.1', T0 + 1)]), worldId: 'localworldlocal2' };
    const m = rebaseOnto(local, remote);
    expect(m.worldId).toBe(WORLD);
    expect(m.createdAt).toBe(T0 - DAY);
    expect(m.log.events.map((e) => e.id)).toEqual(['aaaaaa.1', 'cccccc.1']);
  });

  it('canonicalJson и sameProgress не зависят от порядка ключей', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    const p = newProgress(T0, WORLD);
    const reordered = JSON.parse(JSON.stringify({ settings: p.settings, world: p.world, log: p.log, createdAt: p.createdAt, worldId: p.worldId, v: p.v }));
    expect(sameProgress(p, reordered)).toBe(true);
    expect(sameProgress(p, { ...p, createdAt: 1 })).toBe(false);
  });
});
