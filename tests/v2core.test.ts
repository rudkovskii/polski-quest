// @vitest-environment happy-dom
// Ядро v2 «Игры о Польше»: контент, модель (kind, «сам», drillSeed), огород v2 отдельно от A1, шкала «Wiedza o Polsce», реестр игр,
// движок раунда, маршрутизация точек входа, локация Zagroda, сохранение v3.
import { describe, expect, it, vi } from 'vitest';
import { GAMES, GAME_BY_ENTRY, GAME_BY_ID } from '../src/games/registry';
import { hymnPool } from '../src/games/hymn';
import { A1_IDS, ALL_WORDS, PHRASES, TOPICS, WORDS, WORD_BY_ID } from '../src/systems/content';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, applyAnswer, derive, kindOf, newGarden, type GardenSave } from '../src/systems/garden';
import { ACTIVE_MAX, createPolska, newPolskaSave, unitProgress, wantOf, type PolskaSave } from '../src/systems/polska';
import { POLSKA_LEVELS, polskaScale } from '../src/systems/polskaScale';
import { exportSave, importSave, newSave, normalizeSave, SAVE_V } from '../src/systems/save';
import { GAME_IDS, GAME_KINDS, V2, parseV2, unitsOfGame } from '../src/systems/v2content';
import { BASE } from '../src/systems/xp';
import { KLUMBA_SIZE, PLOT_OBJECTS, VOIVODESHIPS, entryFrames, plotMap, plotViews } from '../src/systems/zagroda';
import type { GameCtx, GamePanel, PolskaGameId, Want } from '../src/types/polska';
import type { PropObject } from '../src/types/map';
import { mountPolskaGame, NEXT_DELAY_MS } from '../src/ui/polskaGame';
import { ROUND_SIZE } from '../src/ui/roundSummary';
import { mountBoard } from '../src/ui/board';
import { around, LocationModel } from '../src/world/location';
import { getMap, resolveSpawn, routeTo } from '../src/world/maps';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 18, 9, 0);

function mkPolska(start = NOW) {
  let t = start;
  let save: PolskaSave = newPolskaSave();
  const bus = testBus();
  const p = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => t, tz: () => 0 });
  return { p, bus, get save() { return save; }, tick: (ms: number) => (t += ms) };
}

const ctxFor = (s: ReturnType<typeof mkPolska>, g: PolskaGameId): GameCtx => ({
  units: s.p.units(g),
  unit: (id) => s.p.unit(id),
  info: (id) => s.p.info(id),
  seen: () => true,
  markSeen: () => {},
  doc: s.p.content.docs[g],
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 18, weekday: 0 }),
  rand: seeded(3),
});

describe('контент v2', () => {
  it('данные разобраны без ошибок: 4 игры, kind и префиксы id совпадают, id уникальны', () => {
    expect(V2.errors).toEqual([]);
    for (const g of GAME_IDS) expect(unitsOfGame(V2, g).length, g).toBeGreaterThan(0);
    for (const u of V2.units) {
      expect(kindOf(u.id), u.id).toBe(u.kind);
      expect(u.pl && u.ru, u.id).toBeTruthy();
    }
    expect(new Set(V2.units.map((u) => u.id)).size).toBe(V2.units.length);
  });

  it('проверка ловит испорченные данные: префикс, пустой pl, повтор, слово без sw.', () => {
    const r = parseV2({
      geo: { units: [{ id: 'date.x', kind: 'geo', pl: 'X', ru: 'x' }, { id: 'geo.a', kind: 'geo', pl: '', ru: 'a' }, { id: 'geo.a', kind: 'geo', pl: 'A', ru: 'a' }] },
      hymn: {},
      daty: {},
      swieta: {},
      words: [{ id: 'w.x', pl: 'x', ru: 'x' }],
    });
    expect(r.errors.join('\n')).toMatch(/префикс/);
    expect(r.errors.join('\n')).toMatch(/нет pl/);
    expect(r.errors.join('\n')).toMatch(/повтор id geo\.a/);
    expect(r.errors.join('\n')).toMatch(/sw\./);
  });

  it('drillSeed гимна: строки дриля (номера или id) — существующие строки', () => {
    expect(V2.drillSeed.length).toBeGreaterThan(0);
    for (const id of V2.drillSeed) expect(V2.byId.get(id)?.kind).toBe('hymn');
    const byN = parseV2({ geo: {}, hymn: { lines: [{ id: 'hymn.s1.1', kind: 'hymn', n: 1, pl: 'a', ru: 'a' }, { id: 'hymn.s1.2', kind: 'hymn', n: 2, pl: 'b', ru: 'b' }], drillSeed: 1 }, daty: {}, swieta: {}, words: [] });
    expect(byN.drillSeed).toEqual(['hymn.s1.1']);
  });

  it('тема «Święta i zwyczaje»: слова в словаре своей темой (последней), не в базе A1', () => {
    expect(V2.words.length).toBeGreaterThan(0);
    expect(TOPICS[TOPICS.length - 1]!.id).toBe('swieta');
    for (const w of V2.words) {
      expect(w.topic).toBe('swieta');
      expect(A1_IDS.has(w.id), w.id).toBe(false);
      expect(WORD_BY_ID.get(w.id)).toBe(w);
    }
    expect(ALL_WORDS.length).toBe(WORDS.length + V2.words.length);
    // Путь к A1 считает только базу A1.
    expect(BASE.words).toBe(WORDS.length);
    expect(BASE.phrases).toBe(PHRASES.length);
  });
});

describe('модель: kind, «сам», drillSeed', () => {
  it('kindOf по префиксу id', () => {
    expect(kindOf('w.kot')).toBe('word');
    expect(kindOf('sw.karp')).toBe('word');
    expect(kindOf('p.dzien_dobry')).toBe('phrase');
    expect(kindOf('geo.city.krakow')).toBe('geo');
    expect(kindOf('hymn.s1.1')).toBe('hymn');
    expect(kindOf('symbol.godlo')).toBe('symbol');
    expect(kindOf('date.konstytucja')).toBe('date');
    expect(kindOf('hol.wigilia')).toBe('holiday');
  });

  it('единица v2: урожай за 3 разных дня и только после ответа «сам»; слово — как раньше', () => {
    const grow = (id: string, self: boolean): ReturnType<typeof derive> => {
      const g: GardenSave = { ...newGarden(), planted: [{ t: NOW, id }] };
      const st = derive(g);
      let t = NOW;
      // «Сам»: у единиц v2 — `self`, у слова — `prod` (собрано в игре 5).
      const a = (side: 'pr' | 'rp', day: number, s = false): void => void applyAnswer(st, { t: (t += 1000), day, id, side, ok: true, mode: side === 'pr' ? 1 : s ? 5 : 2, ...(s ? { self: true, prod: true } : {}) });
      a('pr', 0);
      a('pr', 0);
      a('rp', 0);
      expect(st.items.get(id)!.stage).toBe('bush');
      a('rp', 1);
      a('rp', 2);
      if (self) a('rp', 2, true);
      return st;
    };
    // Слово с 19.10 тоже ждёт «сам» — собранное в игре 5 (`prod`).
    expect(grow('w.kot', false).items.get('w.kot')!.harvests).toBe(0);
    expect(grow('w.kot', true).items.get('w.kot')!.harvests).toBe(1);
    expect(grow('geo.city.krakow', false).items.get('geo.city.krakow')!.harvests).toBe(0);
    expect(grow('geo.city.krakow', true).items.get('geo.city.krakow')!.harvests).toBe(1);
  });

  it('drillSeed: строки дриля сажаются сразу кустиком, остальные семечком', () => {
    const s = mkPolska();
    const seed = V2.drillSeed[0]!;
    const other = s.p.units('hymn').find((u) => u.kind === 'hymn' && !V2.drillSeed.includes(u.id))!.id;
    s.p.plant([seed, other]);
    expect(s.p.info(seed).stage).toBe('bush');
    expect(s.p.info(other).stage).toBe('seed');
    expect(s.save.garden.planted.find((e) => e.id === seed)?.start).toBe('bush');
  });

  it('wantOf: семечко — A, росток без A — A, росток с A — B, кустик без «сам» — B сам', () => {
    const st = derive({ ...newGarden(), planted: [{ t: NOW, id: 'geo.city.krakow' }] });
    const it = st.items.get('geo.city.krakow')!;
    expect(wantOf(it, NOW)).toMatchObject({ side: 'A', self: false, stage: 'seed' });
    it.stage = 'sprout';
    expect(wantOf(it, NOW)).toMatchObject({ side: 'A' });
    it.sides.pr = true;
    expect(wantOf(it, NOW)).toMatchObject({ side: 'B', self: false });
    it.stage = 'bush';
    expect(wantOf(it, NOW)).toMatchObject({ side: 'B', self: true });
    expect(unitProgress(it, NOW, 0)).toMatch(/самому/);
  });
});

describe('огород v2 и шкала «Wiedza o Polsce»', () => {
  it('autoPlant держит не больше ACTIVE_MAX семян и ростков игры', () => {
    const s = mkPolska();
    const pool = s.p.units('geo').map((u) => u.id);
    expect(s.p.autoPlant('geo', pool).length).toBe(ACTIVE_MAX);
    expect(s.p.autoPlant('geo', pool).length).toBe(0);
  });

  it('три дня игры по правилам движка: урожай, шкала растёт, A1 не меняется', () => {
    const s = mkPolska();
    const game = GAME_BY_ID.get('daty')!;
    const ctx = ctxFor(s, 'daty');
    const scale0 = s.p.scale();
    expect(scale0.sub).toBe(0);
    for (let day = 0; day < 3; day++) {
      for (let n = 0; n < 30; n++) {
        s.p.autoPlant('daty', game.pool(ctx));
        const want = s.p.pick('daty');
        if (!want) break;
        const task = game.nextTask(ctx, want)!;
        expect(task.id).toBe(want.id);
        s.p.answer({ id: task.id, side: task.side, ...(task.self ? { self: true } : {}) }, true);
        s.tick(5000);
      }
      s.tick(DAY_MS);
    }
    const sc = s.p.scale();
    expect(sc.grown).toBeGreaterThan(0);
    expect(sc.games.daty.grown).toBe(sc.grown);
    expect(sc.pos).toBeGreaterThan(scale0.pos);
    expect(s.p.xp()).toBeGreaterThan(0);
  });

  it('шкала: 10 уровней по возрастанию, 100 % — только когда всё выращено; медали 50 и 100', () => {
    for (let i = 1; i < POLSKA_LEVELS.length; i++) expect(POLSKA_LEVELS[i]!.at).toBeGreaterThan(POLSKA_LEVELS[i - 1]!.at);
    const units = V2.units;
    const all = derive({ ...newGarden(), planted: units.map((u) => ({ t: NOW, id: u.id })) });
    for (const it of all.items.values()) {
      it.harvests = 1;
      it.stage = null;
    }
    const full = polskaScale(units, all.items);
    expect(full.sub).toBe(10);
    expect(full.games.geo.medal).toBe(100);
    expect(full.bonusXp).toBeGreaterThan(0);
    const half = derive({ ...newGarden(), planted: unitsOfGame(V2, 'swieta').map((u) => ({ t: NOW, id: u.id })) });
    const list = [...half.items.values()];
    list.slice(0, Math.ceil(list.length / 2)).forEach((it) => ((it.harvests = 1), (it.stage = null)));
    expect(polskaScale(units, half.items).games.swieta.medal).toBe(50);
  });

  it('A1 считается только по базе A1: выращенные слова «Święta» не двигают путь к A1', () => {
    let g: GardenSave = newGarden();
    const farm = createFarm({ bus: testBus(), load: () => g, save: (x) => (g = x), now: () => NOW, tz: () => 0, say: () => {}, rand: seeded(1) });
    const p0 = farm.stats().path.points;
    const ids = V2.words.slice(0, 5).map((w) => w.id);
    expect(farm.plant(ids).planted).toBe(5);
    const st = farm.state;
    for (const id of ids) {
      const it = st.items.get(id)!;
      it.harvests = 1;
      it.stage = null;
    }
    expect(farm.stats().path.points).toBe(p0);
    expect(farm.stats().base).toEqual(BASE);
  });
});

describe('Zagroda: участки и точки входа', () => {
  it('у каждого воеводства своя яблоня, у каждой единицы — объект с картой; клумба вмещает все праздники', () => {
    const refs = plotMap(V2.units);
    expect(VOIVODESHIPS.length).toBe(16);
    expect(unitsOfGame(V2, 'swieta').length).toBeLessThanOrEqual(KLUMBA_SIZE);
    const objs = new Set(PLOT_OBJECTS.map((p) => p.obj));
    for (const u of V2.units) expect(objs.has(refs.get(u.id)!.obj), u.id).toBe(true);
    // Воеводства из данных попадают каждое на свою яблоню.
    for (const u of V2.units.filter((x) => x.id.startsWith('geo.voi.'))) expect(refs.get(u.id)!.obj).toBe(`sad_${u.id.slice(8)}`);
  });

  it('карта zagroda: все объекты участков стоят (use zplot), к каждому можно подойти', () => {
    const map = getMap('zagroda');
    const ids = new Set(map.objects.filter((o): o is PropObject => o.type === 'prop' && o.use === 'zplot').map((o) => o.id));
    for (const p of PLOT_OBJECTS) expect(ids.has(p.obj), p.obj).toBe(true);
    const m = new LocationModel(map, resolveSpawn(map, 'default').tile, { cat: false });
    for (const o of m.objects.filter((x) => x.use)) expect(around(o.rects).some(([x, y]) => m.passable(x, y)), o.key).toBe(true);
    for (const sp of ['sad', 'pasieka', 'miesiace', 'klumba', 'from_farm']) expect(map.spawns[sp], sp).toBeTruthy();
  });

  it('калитка: с фермы на восток в Zagroda и обратно шагом', () => {
    const farm = getMap('farm');
    const gate = farm.objects.find((o) => o.type === 'exit' && o.to === 'zagroda');
    expect(gate && gate.at[0]).toBe(farm.size[0] - 1);
    const back = getMap('zagroda').objects.find((o) => o.type === 'exit' && o.to === 'farm');
    expect(back && back.at[0]).toBe(0);
  });

  it('вид объектов по прогрессу: пусто → ничего, урожай → pct 1', () => {
    const units = unitsOfGame(V2, 'daty').filter((u) => u.raw.month === 5);
    const st = derive({ ...newGarden(), planted: units.map((u) => ({ t: NOW, id: u.id })) });
    let v = plotViews(V2.units, st.items, NOW).find((x) => x.obj === 'bed_5')!;
    expect(v).toMatchObject({ units: units.length, planted: units.length, grown: 0, best: 'seed', group: 'month:5' });
    for (const it of st.items.values()) ((it.harvests = 1), (it.stage = null));
    v = plotViews(V2.units, st.items, NOW).find((x) => x.obj === 'bed_5')!;
    expect(v.pct).toBe(1);
  });

  it('кадры точек входа: карта в рулоне до игры, мачта до верха 3 мая и 11 ноября, сезон доски по месяцу', () => {
    const empty = new Map();
    expect(entryFrames(V2.units, empty, 10, 18)).toEqual({ map: 0, calendar: 0, mast: 0, seasonBoard: 2 });
    expect(entryFrames(V2.units, empty, 5, 3).mast).toBe(9);
    expect(entryFrames(V2.units, empty, 11, 11).mast).toBe(9);
    expect(entryFrames(V2.units, empty, 1, 5).seasonBoard).toBe(3);
  });
});

describe('реестр игр и маршрутизация', () => {
  it('4 игры: свои папки, разные точки входа и участки, виды покрывают все единицы', () => {
    expect(GAMES.map((g) => g.id).sort()).toEqual(['daty', 'geo', 'hymn', 'swieta']);
    expect(new Set(GAMES.map((g) => g.entry)).size).toBe(4);
    expect(new Set(GAMES.map((g) => g.plot)).size).toBe(4);
    for (const g of GAMES) expect([...g.kinds]).toEqual([...GAME_KINDS[g.id]]);
    for (const [use, id] of [['map', 'geo'], ['mast', 'hymn'], ['calendar', 'daty'], ['seasonBoard', 'swieta']] as const) expect(GAME_BY_ENTRY.get(use)?.id).toBe(id);
  });

  it('точки входа стоят на картах: карта и календарь в доме, мачта и сезонная доска на ферме', () => {
    const uses = (id: string): string[] => getMap(id).objects.filter((o): o is PropObject => o.type === 'prop' && !!o.use).map((o) => o.use!);
    expect(uses('home')).toEqual(expect.arrayContaining(['map', 'calendar']));
    expect(uses('farm')).toEqual(expect.arrayContaining(['mast', 'seasonBoard']));
  });

  it('«Idź»: маршрут к точке входа через двери', () => {
    expect(routeTo('home', 'map')).toMatchObject({ key: 'prop:map', here: true });
    expect(routeTo('farm', 'map')).toMatchObject({ here: false, map: 'home' });
    expect(routeTo('farm', 'map')!.key).toMatch(/^exit:/);
    expect(routeTo('zagroda', 'calendar')).toMatchObject({ here: false, map: 'home' });
    // Из Zagroda в дом — через ферму: первая дверь ведёт на ферму.
    const door = routeTo('zagroda', 'calendar')!.key;
    const ex = getMap('zagroda').objects.find((o) => o.type === 'exit' && `exit:${o.at[0]},${o.at[1]}` === door);
    expect(ex && ex.type === 'exit' && ex.to).toBe('farm');
    expect(routeTo('home', 'nope')).toBeNull();
  });

  it('каждая игра даёт задание на любую просьбу движка, рисует его и проверяет ответ', () => {
    for (const g of GAMES) {
      const s = mkPolska();
      const ctx = ctxFor(s, g.id);
      const pool = g.pool(ctx);
      expect(pool.length, g.id).toBeGreaterThan(0);
      for (const want of [
        { id: pool[0]!, side: 'A', self: false, stage: 'seed' },
        { id: pool[0]!, side: 'B', self: false, stage: 'sprout' },
        { id: pool[0]!, side: 'B', self: true, stage: 'bush' },
      ] as Want[]) {
        const task = g.nextTask(ctx, want);
        expect(task, `${g.id} ${want.side}`).toBeTruthy();
        let given: unknown = null;
        const panel: GamePanel = { body: document.createElement('div'), foot: document.createElement('div'), layout: g.layout, submit: (a) => (given = a), say: () => {}, rand: seeded(2) };
        g.render(task!, panel, ctx);
        expect(panel.body.childElementCount).toBeGreaterThan(0);
        void given;
        expect(g.check(task!, '___', ctx).ok).toBe(false);
      }
    }
  });

  it('гимн: сначала куплет 1 и припев, следующий куплет — когда посаженное подросло', () => {
    const s = mkPolska();
    const ctx = ctxFor(s, 'hymn');
    const lines = hymnPool(ctx).filter((id) => id.startsWith('hymn.'));
    expect(lines.every((id) => /^hymn\.(s1|ref)\./.test(id))).toBe(true);
  });
});

describe('движок раунда v2', () => {
  it('10 заданий → итог раунда со шкалой; герой бежит к объекту; выход возвращает мир', () => {
    const s = mkPolska();
    const root = document.createElement('div');
    const focus: (string | null)[] = [];
    const inputs: boolean[] = [];
    s.bus.on('polska:focus', (f) => focus.push(f.obj));
    s.bus.on('world:input', ({ enabled }) => inputs.push(enabled));
    const autos: string[] = [];
    s.bus.on('polska:auto', (a) => autos.push(`${a.on}:${a.layout}:${a.plot ?? ''}`));
    const ui = mountPolskaGame(root, { bus: s.bus, games: GAMES, polska: s.p, now: () => NOW, rand: seeded(5), say: () => {} });
    ui.start('hymn');
    expect(ui.isOpen).toBe(true);
    expect(autos[0]).toBe('true:panel:pasieka');
    expect(focus.some((o) => o?.startsWith('hive_'))).toBe(true);
    vi.useFakeTimers();
    for (let i = 0; i < ROUND_SIZE; i++) {
      expect(ui.task, `задание ${i + 1}`).toBeTruthy();
      expect(root.querySelector('[data-round-no]')!.textContent).toBe(`${i + 1} / ${ROUND_SIZE}`);
      ui.submit('неверно');
      expect(root.querySelector('[data-feedback]')!.getAttribute('data-feedback')).toBe('bad');
      vi.advanceTimersByTime(NEXT_DELAY_MS + 10);
      root.querySelector<HTMLButtonElement>('[data-next]')!.click();
    }
    vi.useRealTimers();
    expect(s.save.garden.log.length).toBe(ROUND_SIZE);
    expect(root.querySelector('[data-round-summary]')).toBeTruthy();
    expect(root.querySelector('[data-round-polska]')!.textContent).toMatch(/Wiedza o Polsce/);
    ui.stop();
    expect(ui.isOpen).toBe(false);
    expect(inputs).toEqual([false, true]);
  });

  it('доска: вкладка «Polska» с «Idź» и «Graj tu»', () => {
    const root = document.createElement('div');
    const went: string[] = [];
    const played: string[] = [];
    const b = mountBoard(root, {
      bus: testBus(),
      counts: () => ({ words: 0, phrases: 0, assemble: 0 }),
      onPick: () => {},
      polska: {
        games: () => GAMES.map((g) => ({ id: g.id, title: g.title, desc: g.desc, progress: 'выращено 0 из 1', where: 'Sad 0/16' })),
        scale: () => 'Przybysz · 0/10',
        go: (id) => went.push(id),
        play: (id) => played.push(id),
      },
    });
    b.open('polska');
    expect(root.querySelectorAll('[data-game]').length).toBe(4);
    root.querySelector<HTMLButtonElement>('[data-go="geo"]')!.click();
    expect(went).toEqual(['geo']);
    b.open('polska');
    root.querySelector<HTMLButtonElement>('[data-play="hymn"]')!.click();
    expect(played).toEqual(['hymn']);
    b.open('words');
    expect(root.querySelector('[data-mode="1"]')).toBeTruthy();
  });
});

describe('сохранение v3', () => {
  it('v2 → v3 без потерь: огород слов на месте, `polska` пустой; экспорт и импорт сохраняют огород v2', () => {
    const old = { v: 2, created: 1, updated: 2, position: null, settings: {}, garden: { planted: [{ t: 5, id: 'w.kot' }], log: [], slots: {}, tier: 0 }, hints: [] };
    const s = normalizeSave(old)!;
    expect(SAVE_V).toBe(3);
    expect(s.v).toBe(3);
    expect(s.garden.planted).toEqual([{ t: 5, id: 'w.kot' }]);
    expect(s.polska.garden.planted).toEqual([]);
    const save = newSave(NOW);
    save.polska = { garden: { ...newGarden(), planted: [{ t: NOW, id: 'hymn.s1.1', start: 'bush' }], log: [{ t: NOW + 1, day: 1, id: 'hymn.s1.1', side: 'rp', ok: true, mode: 2, self: true }] }, seen: { 'date.nato': '2026-10-19' } };
    const r = importSave(exportSave(save));
    expect(r.ok && r.save.polska).toEqual(save.polska);
  });
});
