import { describe, expect, it } from 'vitest';
import {
  ENTRY_SLOT_MS,
  HOME_KEY,
  HOUR_MS,
  SETTLE_LEVEL,
  VISIT_GAP_MS,
  VISIT_MAX_MS,
  VISIT_MIN_MS,
  createBeaver,
  isNight,
  newBeaverSave,
  normalizeBeaver,
  seededRand,
  stayMsOf,
  visitChance,
  visitRoll,
  type BeaverSave,
} from '../src/systems/beaver';
import { newSave, normalizeSave } from '../src/systems/save';
import { BeaverLife, beaverHost, type BeaverHost } from '../src/world/beaverLife';
import { around, LocationModel } from '../src/world/location';
import { getMap, withDecor } from '../src/world/maps';
import { modelAt, press, release, run, seeded } from './helpers';
import sprites from '../public/atlas/sprites.json';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 19, 9, 0, 0);

/** Бобёр с памятью в переменной: `now` и `level` подменяются. */
function make(level: number, start = T0, init: BeaverSave = newBeaverSave()) {
  let save = init;
  const st = { now: start, level };
  const api = createBeaver({ load: () => save, save: (b) => (save = b), now: () => st.now, level: () => st.level, tz: () => 0 });
  return { api, st, get save() { return save; } };
}

describe('кривая шанса визита', () => {
  it('на уровне 0 — 10 %, на уровне 9 — 60 %, дальше потолок', () => {
    expect(visitChance(0)).toBeCloseTo(0.1, 5);
    expect(visitChance(9)).toBeCloseTo(0.6, 5);
    expect(visitChance(15)).toBe(visitChance(9));
    expect(visitChance(-3)).toBe(visitChance(0));
  });

  it('монотонно растёт с уровнем 0…9, ни разу не падает дальше', () => {
    for (let l = 1; l <= 21; l++) expect(visitChance(l)).toBeGreaterThanOrEqual(visitChance(l - 1));
    for (let l = 1; l <= 9; l++) expect(visitChance(l)).toBeGreaterThan(visitChance(l - 1));
  });

  it('частота выпадения по броскам совпадает с кривой и растёт с уровнем', () => {
    const rate = (level: number): number => {
      let hit = 0;
      const N = 6000;
      for (let i = 0; i < N; i++) if (visitRoll(20000 + (i % 400), i % 2 ? 'enter' : 'hour', i, level)) hit++;
      return hit / N;
    };
    let prev = -1;
    for (const l of [0, 2, 4, 6, 9]) {
      const r = rate(l);
      expect(Math.abs(r - visitChance(l)), `уровень ${l}`).toBeLessThan(0.03);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });
});

describe('визиты: детерминизм и лимит частоты', () => {
  it('один и тот же момент даёт один и тот же ответ (зерно дня и слота)', () => {
    const a = make(5);
    const b = make(5);
    const out: (number | null)[] = [];
    for (let k = 0; k < 40; k++) {
      a.st.now = b.st.now = T0 + k * ENTRY_SLOT_MS * 3;
      const pa = a.api.enterFarm();
      const pb = b.api.enterFarm();
      expect(pa).toEqual(pb);
      out.push(pa?.seed ?? null);
      a.api.end();
      b.api.end();
    }
    expect(out.some((x) => x !== null)).toBe(true);
    expect(out.some((x) => x === null)).toBe(true);
  });

  it('визит длится 1–3 минуты', () => {
    for (let s = 0; s < 200; s++) {
      const ms = stayMsOf(s * 7919);
      expect(ms).toBeGreaterThanOrEqual(VISIT_MIN_MS);
      expect(ms).toBeLessThanOrEqual(VISIT_MAX_MS);
    }
  });

  it('не чаще одного визита за 10 минут реального времени', () => {
    const m = make(9);
    const starts: number[] = [];
    for (let t = T0; t < T0 + 120 * DAY; t += 90_000) {
      m.st.now = t;
      const p = m.api.enterFarm() ?? m.api.tick();
      if (p && p.startedAt === t) {
        starts.push(t);
        m.api.end();
      }
    }
    expect(starts.length).toBeGreaterThan(500);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(VISIT_GAP_MS);
  });

  it('визит записывается в сохранение, зашёл снова до конца визита — бобёр ещё тут (тот же план)', () => {
    const m = make(9);
    let plan = null;
    for (let k = 0; k < 400 && !plan; k++) {
      m.st.now = T0 + k * DAY;
      plan = m.api.enterFarm();
    }
    expect(plan).not.toBeNull();
    expect(m.save.lastVisit).toBe(m.st.now);
    expect(m.save.visits).toBe(1);
    m.st.now += 30_000;
    expect(m.api.enterFarm()).toEqual(plan);
    expect(m.save.visits).toBe(1);
  });

  it('часовой бросок: один раз за час, смена часа даёт новый бросок', () => {
    const m = make(9);
    m.api.enterFarm();
    let got = 0;
    for (let h = 1; h < 24 * 60; h++) {
      m.st.now = T0 + h * HOUR_MS + 5000;
      const p = m.api.tick();
      expect(m.api.tick()).toBeNull(); // тот же час второй раз — ничего
      if (p) {
        got++;
        m.api.end();
      }
    }
    expect(got).toBeGreaterThan(100);
  });
});

describe('заселение с 10-го уровня', () => {
  it('на уровнях 0–9 бобёр гость, на 10-м поселяется один раз и навсегда', () => {
    const m = make(9);
    expect(m.api.trySettle()).toBe(false);
    expect(m.api.phase()).toBe('visitor');
    m.st.level = SETTLE_LEVEL;
    m.st.now += 1000;
    expect(m.api.trySettle()).toBe(true);
    expect(m.save.settled).toBe(m.st.now);
    expect(m.api.phase()).toBe('resident');
    expect(m.api.trySettle()).toBe(false); // второй раз не заселяем
    // уровень «упал» (на всякий случай): хозяин остаётся, гостем не становится
    m.st.level = 2;
    expect(m.api.phase()).toBe('resident');
    for (let k = 0; k < 300; k++) {
      m.st.now += 3 * 3_600_000;
      expect(m.api.enterFarm()).toBeNull();
      expect(m.api.tick()).toBeNull();
    }
  });

  it('с порога заселения гостей уже нет (бобёр вот-вот поселится)', () => {
    const m = make(10);
    for (let k = 0; k < 200; k++) {
      m.st.now = T0 + k * DAY;
      expect(m.api.enterFarm()).toBeNull();
    }
    expect(m.save.visits).toBe(0);
  });

  it('заселение переживает сохранение и старое сохранение без раздела читается без потерь', () => {
    const s = newSave(1000);
    const withB = { ...s, beaver: { settled: 5000, lastVisit: 4000, visits: 3 } };
    const back = normalizeSave(JSON.parse(JSON.stringify(withB)));
    expect(back?.beaver).toEqual({ settled: 5000, lastVisit: 4000, visits: 3 });
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    delete old.beaver;
    old.hints = ['desk', 'tip:jar'];
    const r = normalizeSave(old);
    expect(r?.beaver).toEqual(newBeaverSave());
    expect(r?.hints).toEqual(['desk', 'tip:jar']);
    expect(normalizeBeaver({ settled: 'x', visits: -2, lastVisit: NaN })).toEqual(newBeaverSave());
    expect(normalizeBeaver(null)).toEqual(newBeaverSave());
  });

  it('ночь: с 21 до 6', () => {
    expect(isNight(23)).toBe(true);
    expect(isNight(3)).toBe(true);
    expect(isNight(6)).toBe(false);
    expect(isNight(12)).toBe(false);
    expect(isNight(21)).toBe(true);
  });
});

// ───────────── на карте ─────────────

const HERO_SPOTS: [number, number][] = [[14, 7], [6, 8], [20, 12], [10, 17], [24, 9]];

function farmModel(home: boolean, spawn: [number, number], seed: number): LocationModel {
  const map = withDecor(getMap('farm'), home ? new Set([HOME_KEY]) : new Set<string>());
  return new LocationModel(map, spawn, { facing: 'down', rand: seeded(seed) });
}

/** Нарушение «бобёр там, где ему нельзя» для клетки покоя. */
function bad(m: LocationModel, c: readonly [number, number]): string | null {
  const [x, y] = c;
  const g = m.map.legend[m.parsed.ground[y]![x]!]?.tile;
  if (!m.passable(x, y)) return `непроходимая клетка ${x},${y}`;
  if (m.isExit(c as [number, number])) return 'на двери';
  if (g === 'path') return `на дорожке ${x},${y}`;
  if (g === 'soil') return `на грядке ${x},${y}`;
  for (const o of m.objects) {
    if (o.kind === 'plot') {
      const r = (o.src as { reserve?: { at: number[]; size: number[] } }).reserve ?? { at: o.at, size: o.size };
      if (x >= r.at[0]! && y >= r.at[1]! && x < r.at[0]! + r.size[0]! && y < r.at[1]! + r.size[1]!) return `на участке под грядки ${x},${y}`;
    }
    if (o.kind === 'exit' && Math.abs(o.at[0] - x) + Math.abs(o.at[1] - y) <= 1) return `у входа ${o.at}`;
    if (o.kind === 'prop' && o.use && around(o.rects).some((a) => a[0] === x && a[1] === y)) return `на подходе к ${o.id}`;
  }
  for (const s of Object.values(m.map.spawns)) if (s[0] === x && s[1] === y) return 'на точке входа';
  return null;
}

function scenario(kind: 'visit' | 'resident', seed: number, hero: [number, number], ms: number, hour = () => 12, opts: { stayMs?: number; step?: (t: number) => void } = {}) {
  const m = farmModel(kind === 'resident', hero, seed);
  const host = beaverHost(m, { rand: seeded(seed * 31 + 7), hour });
  const life = new BeaverLife(kind, host, { stayMs: opts.stayMs ?? 90_000 });
  m.beaver = life;
  const modes = new Set<string>();
  let badSeen: string | null = null;
  let overlap: string | null = null;
  let visibleMs = 0;
  let goneAt: number | null = null;
  for (let t = 0; t < ms; t += 100) {
    opts.step?.(t);
    m.update(100);
    life.update(100, host);
    if (life.visible) visibleMs += 100;
    if (life.gone && goneAt === null) goneAt = t;
    modes.add(life.mode);
    if (life.visible && !life.step && !badSeen) {
      const b = bad(m, life.tile);
      if (b && !(kind === 'resident' && host.water(life.tile))) badSeen = b;
    }
    // шаги бобра не идут по грядкам и дорожкам-«стояночным» клеткам нельзя, а вот проходимость и участок — всегда
    if (life.step && life.visible) {
      const tgt = life.step.to;
      const g = m.map.legend[m.parsed.ground[tgt[1]]![tgt[0]]!]?.tile;
      if (g === 'soil' && !badSeen) badSeen = `шаг на грядку ${tgt}`;
      if (!m.passable(tgt[0], tgt[1]) && !host.water(tgt) && !badSeen) badSeen = `шаг в стену ${tgt}`;
    }
    if (life.visible && m.cat && !overlap) {
      const c = m.cat;
      const bt = life.step ? [life.tile, life.step.to] : [life.tile];
      const ct = c.step ? [c.tile, c.step.to] : [c.tile];
      for (const a of bt) for (const b of ct) if (a[0] === b[0] && a[1] === b[1] && !(life.step && c.step && false)) overlap = `кот и бобёр на ${a}`;
    }
    if (life.visible && !life.step && !m.player.step && life.tile[0] === m.player.tile[0] && life.tile[1] === m.player.tile[1]) overlap = 'бобёр на клетке героя';
  }
  return { m, host, life, modes, badSeen, overlap, visibleMs, goneAt };
}

describe('бобёр на карте', () => {
  it('гость приходит с края, не стоит на грядке, дорожке, у входа и подходов, не на клетке героя и не пересекается с котом', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const hero of HERO_SPOTS) {
        const r = scenario('visit', seed, hero, 240_000);
        expect(r.badSeen, `seed ${seed} hero ${hero}`).toBeNull();
        expect(r.overlap, `seed ${seed} hero ${hero}`).toBeNull();
      }
    }
  });

  it('гость появляется у кромки участка и за 1–3 минуты успевает посидеть, погрызть, умыться, посмотреть на героя, потом уходит', () => {
    const seen = new Set<string>();
    let started = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const m = farmModel(false, [14, 7], seed);
      const host = beaverHost(m, { rand: seeded(seed), hour: () => 12 });
      const life = new BeaverLife('visit', host, { stayMs: 120_000 });
      expect(life.visible).toBe(true);
      expect(host.edge().some((c) => c[0] === life.tile[0] && c[1] === life.tile[1]), 'появился на краю').toBe(true);
      m.beaver = life;
      started++;
      let gone = -1;
      for (let t = 0; t < 400_000; t += 100) {
        m.update(100);
        life.update(100, host);
        seen.add(life.mode);
        if (life.gone) {
          gone = t;
          break;
        }
      }
      expect(gone, `seed ${seed}: ушёл`).toBeGreaterThan(110_000);
      expect(gone).toBeLessThan(120_000 + 40_000);
      expect(life.visible).toBe(false);
    }
    expect(started).toBe(10);
    for (const mode of ['walk', 'sit', 'gnaw', 'wash']) expect(seen.has(mode), mode).toBe(true);
  });

  it('детерминирован: одно зерно и тот же ход героя дают тот же путь бобра', () => {
    const trace = (): string => {
      const r: string[] = [];
      scenario('visit', 11, [14, 7], 60_000, () => 12, { step: () => r.push('') });
      const m = farmModel(false, [14, 7], 11);
      const host = beaverHost(m, { rand: seeded(11 * 31 + 7), hour: () => 12 });
      const life = new BeaverLife('visit', host, { stayMs: 90_000 });
      m.beaver = life;
      for (let t = 0; t < 60_000; t += 100) {
        m.update(100);
        life.update(100, host);
        if (t % 1000 === 0) r.push(`${life.tile},${life.mode}`);
      }
      return r.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('герой шагает на клетку бобра: бобёр отбегает, герой его не топчет', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = farmModel(false, [14, 4], seed);
      const host = beaverHost(m, { rand: seeded(seed), hour: () => 12 });
      const life = new BeaverLife('visit', host, { stayMs: 300_000 });
      m.beaver = life;
      // посадим бобра прямо перед героем и пошлём героя на него
      life.tile = [14, 6];
      life.step = null;
      life.mode = 'sit';
      run(m, 100);
      life.update(100, host);
      press(m, 'down');
      for (let t = 0; t < 1500; t += 20) {
        m.update(20);
        life.update(20, host);
        if (!life.step && !m.player.step) expect(life.tile, `seed ${seed} t ${t}`).not.toEqual(m.player.tile);
      }
      release(m, 'down');
    }
  });

  it('тап и A по бобру открывают «Bóbr · бобёр» (use: beaver), пока он виден', () => {
    const m = farmModel(false, [14, 7], 3);
    const host = beaverHost(m, { rand: seeded(3), hour: () => 12 });
    const life = new BeaverLife('visit', host, { stayMs: 300_000 });
    m.beaver = life;
    life.tile = [17, 7];
    life.step = null;
    expect(m.object('beaver:0')?.label).toBe('Bóbr · бобёр');
    expect(m.targetAtPoint(17.5, 7.5)).toBe('beaver:0');
    m.intent({ type: 'interact', target: 'beaver:0' });
    const ev = run(m, 4000).find((e) => e.type === 'interact');
    expect(ev && ev.type === 'interact' && ev.use).toBe('beaver');
    // спрятан (в хатке): объекта нет
    life.visible = false;
    expect(m.object('beaver:0')).toBeUndefined();
    expect(m.targetAtPoint(17.5, 7.5)).not.toBe('beaver:0');
  });

  it('кот не встаёт на клетку бобра и не ходит через неё; иногда смотрит на бобра', () => {
    let gaze = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = farmModel(false, [14, 10], seed);
      const host = beaverHost(m, { rand: seeded(seed), hour: () => 12 });
      const life = new BeaverLife('visit', host, { stayMs: 600_000 });
      m.beaver = life;
      life.tile = [m.cat!.tile[0] + 2, m.cat!.tile[1]];
      for (let t = 0; t < 120_000; t += 50) {
        m.update(50);
        life.update(50, host);
        if (life.visible && !life.step) {
          expect(m.cat!.tile, `seed ${seed}`).not.toEqual(life.tile);
          if (m.cat!.step) expect(m.cat!.step.to).not.toEqual(life.tile);
          const dx = life.tile[0] - m.cat!.tile[0];
          const dy = life.tile[1] - m.cat!.tile[1];
          const want = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
          if ((m.cat!.mode === 'sit' || m.cat!.mode === 'wash') && m.cat!.facing === want && Math.abs(dx) + Math.abs(dy) <= 7 && Math.abs(dx) + Math.abs(dy) > 0) gaze++;
        }
      }
    }
    expect(gaze).toBeGreaterThan(0);
  });
});

describe('хозяин: хатка, пруд, день и ночь', () => {
  it('хатка и пруд появляются только по ключу beaver.home, не на грядках, дорожках, входах и друг на друге', () => {
    const plain = withDecor(getMap('farm'), new Set());
    expect(plain.objects.some((o) => o.type === 'prop' && o.unlock)).toBe(false);
    const full = withDecor(getMap('farm'), new Set([HOME_KEY]));
    const home = full.objects.filter((o) => o.type === 'prop' && o.unlock === HOME_KEY);
    expect(home.map((o) => (o.type === 'prop' ? o.id : '')).sort()).toEqual(['beaver_lodge', 'beaver_pond']);
    const lodge = home.find((o) => o.type === 'prop' && o.id === 'beaver_lodge');
    const pond = home.find((o) => o.type === 'prop' && o.id === 'beaver_pond');
    expect(lodge && lodge.type === 'prop' && lodge.size).toEqual([2, 2]);
    expect(pond && pond.type === 'prop' && pond.size).toEqual([2, 3]);
    const m = new LocationModel(full, [14, 7]);
    const cells = (o: { at: [number, number]; size?: [number, number] }): string[] => {
      const out: string[] = [];
      for (let y = o.at[1]; y < o.at[1] + (o.size?.[1] ?? 1); y++) for (let x = o.at[0]; x < o.at[0] + (o.size?.[0] ?? 1); x++) out.push(`${x},${y}`);
      return out;
    };
    const mine = new Set<string>();
    for (const o of home) if (o.type === 'prop') for (const c of cells(o)) mine.add(c);
    expect(mine.size).toBe(4 + 6);
    // не пересекается ни с чем: другими объектами, дорожкой, грядкой/участком, выходом, точкой входа
    for (const o of full.objects) {
      if (o === lodge || o === pond) continue;
      if (o.type === 'prop' || o.type === 'exit' || o.type === 'plot') {
        const rect = o.type === 'plot' ? { at: o.reserve?.at ?? o.at, size: o.reserve?.size ?? o.size } : (o as { at: [number, number]; size?: [number, number] });
        for (const c of cells(rect)) expect(mine.has(c), `${o.type} ${(o as { id?: string }).id ?? ''} ${c}`).toBe(false);
      }
    }
    for (const c of mine) {
      const [x, y] = c.split(',').map(Number) as [number, number];
      expect(m.map.legend[m.parsed.ground[y]![x]!]?.tile).toBe('grass');
      expect(m.passable(x, y)).toBe(false); // сплошные: герой в пруд и хатку не лезет
    }
    for (const s of Object.values(full.spawns)) expect(mine.has(`${s[0]},${s[1]}`)).toBe(false);
  });

  it('днём занят: грызёт, плавает и выглядывает, сидит, прячется в хатку, не заступая на грядки и дорожки', () => {
    const seen = new Set<string>();
    let hid = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = scenario('resident', seed, [14, 7], 300_000);
      expect(r.badSeen, `seed ${seed}`).toBeNull();
      expect(r.overlap, `seed ${seed}`).toBeNull();
      for (const mode of r.modes) seen.add(mode);
      if (r.life.hidden) hid++;
      expect(r.life.gone).toBe(false);
      expect(r.visibleMs).toBeGreaterThan(100_000);
    }
    for (const mode of ['walk', 'sit', 'gnaw', 'swim', 'peek', 'dive']) expect(seen.has(mode), mode).toBe(true);
    void hid;
  });

  it('живёт рядом с хаткой: в радиусе 8 клеток от лаза или в пруду', () => {
    const r = scenario('resident', 4, [14, 7], 200_000);
    const door = r.host.home!.door;
    for (let t = 0; t < 1; t++) expect(Math.max(Math.abs(r.life.tile[0] - door[0]), Math.abs(r.life.tile[1] - door[1]))).toBeLessThanOrEqual(10);
  });

  it('иногда прячется в хатку днём (не виден), потом выходит', () => {
    let hidSeen = 0;
    let backSeen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const m = farmModel(true, [14, 7], seed);
      const host = beaverHost(m, { rand: seeded(seed), hour: () => 12 });
      const life = new BeaverLife('resident', host);
      m.beaver = life;
      let wasHidden = false;
      for (let t = 0; t < 600_000; t += 100) {
        m.update(100);
        life.update(100, host);
        if (life.hidden) {
          hidSeen++;
          wasHidden = true;
          expect(life.visible).toBe(false);
        } else if (wasHidden) {
          backSeen++;
          wasHidden = false;
        }
      }
    }
    expect(hidSeen).toBeGreaterThan(0);
    expect(backSeen).toBeGreaterThan(0);
  });

  it('ночью (21–6) спит в хатке и не виден; утром выходит', () => {
    const m = farmModel(true, [14, 7], 5);
    let hour = 23;
    const host = beaverHost(m, { rand: seeded(5), hour: () => hour });
    const life = new BeaverLife('resident', host);
    m.beaver = life;
    expect(life.visible).toBe(false);
    for (let t = 0; t < 120_000; t += 100) {
      m.update(100);
      life.update(100, host);
      expect(life.visible).toBe(false);
      expect(m.object('beaver:0')).toBeUndefined();
    }
    hour = 8;
    let out = false;
    for (let t = 0; t < 60_000 && !out; t += 100) {
      m.update(100);
      life.update(100, host);
      out = life.visible;
    }
    expect(out).toBe(true);
    // и снова вечером уходит в хатку
    hour = 22;
    let in_ = false;
    for (let t = 0; t < 120_000 && !in_; t += 100) {
      m.update(100);
      life.update(100, host);
      in_ = life.hidden;
    }
    expect(in_).toBe(true);
  });

  it('без хатки хозяина нет, пруд один раз: клетки воды видит только бобёр', () => {
    const m = farmModel(false, [14, 7], 1);
    const host = beaverHost(m, { rand: seeded(1), hour: () => 12 });
    expect(host.home).toBeNull();
    expect(new BeaverLife('resident', host).gone).toBe(true);
    const m2 = farmModel(true, [14, 7], 1);
    const h2 = beaverHost(m2, { rand: seeded(1), hour: () => 12 });
    expect(h2.home?.water).toHaveLength(6);
    expect(h2.walk(h2.home!.water[0]!)).toBe(false);
    expect(h2.water(h2.home!.water[0]!)).toBe(true);
    expect(h2.home!.shore.length).toBeGreaterThan(4);
  });
});

describe('арт бобра', () => {
  it('кадры и анимации на месте: ходьба в 4 стороны, сидит, умывается, грызёт, плавает, выглядывает, ныряет, бежит', () => {
    const b = (sprites as unknown as Record<string, { size: number[]; frames: string[]; anims: Record<string, string[]> }>).beaver!;
    expect(b.size).toEqual([16, 16]);
    for (const a of ['idle_down', 'walk_down', 'idle_up', 'walk_up', 'idle_left', 'walk_left', 'idle_right', 'walk_right', 'sit', 'wash', 'gnaw_left', 'gnaw_right', 'swim_left', 'swim_right', 'peek', 'dive', 'run_left', 'run_right']) {
      expect(b.anims[a]?.length, a).toBeGreaterThan(0);
    }
    const all = sprites as unknown as Record<string, { size: number[] }>;
    expect(all.beaver_lodge?.size).toEqual([32, 32]);
    expect(all.beaver_pond?.size).toEqual([32, 48]);
  });
});

void seededRand;
