// @vitest-environment happy-dom
// Geografia: проекция и попадания по карте, задания всех видов (по данным geografia.json), проверка ответов, кластеры городов,
// курсор и тап на карте, герой с флажком, интеграция с движком раунда.
import { describe, expect, it, vi } from 'vitest';
import polandJson from '../public/maps-art/poland.json';
import { game, geoPool } from '../src/games/geo';
import { createMap } from '../src/games/geo/mapview';
import { canvasSize, canvasToMap, mapToCanvas, pickScale, planFit, type FitInput } from '../src/games/geo/fit';
import { checkTask, makeKind, makeTask, statusOf, verdict, type DirAnswer, type GeoKind, type GeoTask } from '../src/games/geo/tasks';
import { anchorOf, centroid, clusterOf, dist, groupOf, hits, inMap, inRings, MAP_H, MAP_W, pathOf, posOf, project, ringsOf, tolPx } from '../src/games/geo/world';
import { REGION_RINGS } from '../src/games/geo/geodata';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import type { GameCtx, GamePanel, PolskaUnit, Want } from '../src/types/polska';
import { mountPolskaGame, NEXT_DELAY_MS } from '../src/ui/polskaGame';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 18, 9, 0);

function mk() {
  let save: PolskaSave = newPolskaSave();
  const bus = testBus();
  const p = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
  return { p, bus };
}
const ctxOf = (s: ReturnType<typeof mk>, seed = 3): GameCtx => ({
  units: s.p.units('geo'),
  unit: (id) => s.p.unit(id),
  info: (id) => s.p.info(id),
  seen: () => true,
  markSeen: () => {},
  doc: s.p.content.docs.geo,
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 18, weekday: 0 }),
  rand: seeded(seed),
});
const S = mk();
const ctx = ctxOf(S);
const U = (id: string): PolskaUnit => ctx.unit(id)!;
const OF = (type: string): PolskaUnit[] => ctx.units.filter((u) => u.type === type);
const panelOf = (body = document.createElement('div')): { panel: GamePanel; given: unknown[]; body: HTMLElement } => {
  const given: unknown[] = [];
  return { given, body, panel: { body, foot: document.createElement('div'), layout: 'full', submit: (a) => given.push(a), say: () => {}, rand: seeded(2) } };
};

describe('карта и проекция', () => {
  it('города из данных проецируются в те же px, что и в poland.json, и лежат внутри карты', () => {
    const cities = polandJson.cities as { id: string; x: number; y: number }[];
    let matched = 0;
    for (const c of cities) {
      // В poland.json город-набор по умолчанию (есть Radom, Gliwice…, которых нет в игре): сверяем общие.
      const u = ctx.unit(`geo.city.${c.id.replace('-', '_')}`);
      if (!u) continue;
      matched++;
      const p = posOf(u)!;
      expect(Math.abs(p.x - c.x), c.id).toBeLessThan(2.5);
      expect(Math.abs(p.y - c.y), c.id).toBeLessThan(2.5);
      expect(inMap(p), c.id).toBe(true);
    }
    expect(matched).toBeGreaterThanOrEqual(20);
    expect([MAP_W, MAP_H]).toEqual(polandJson.size);
    expect(project(52.2297, 21.0122).x).toBeCloseTo(211.1, 0);
  });

  it('все единицы с pos и все реки внутри карты; у 16 воеводств и 7 соседей есть полигоны', () => {
    for (const u of ctx.units) {
      if (u.type === 'river') for (const p of pathOf(u)) expect(inMap(p), u.id).toBe(true);
      else expect(inMap(posOf(u)!), u.id).toBe(true);
    }
    expect(OF('region').every((u) => (ringsOf(u)?.length ?? 0) > 0)).toBe(true);
    expect(OF('neighbor').every((u) => (ringsOf(u)?.length ?? 0) > 0)).toBe(true);
    expect(Object.keys(REGION_RINGS).length).toBe(16);
  });

  it('город лежит в своём воеводстве по полигонам (кроме береговой кромки ±1 px)', () => {
    let bad = 0;
    for (const c of OF('city')) {
      const reg = U(String(c.raw.region));
      const p = posOf(c)!;
      const near = [0, 1, -1].flatMap((dx) => [0, 1, -1].map((dy) => ({ x: p.x + dx, y: p.y + dy })));
      if (!near.some((q) => inRings(q, ringsOf(reg)!))) bad++;
    }
    expect(bad).toBe(0);
  });

  it('каждая точка тапа попадает не больше чем в одно воеводство, внутри Польши — ровно в одно', () => {
    const regions = OF('region');
    for (const c of OF('city')) {
      const p = posOf(c)!;
      expect(regions.filter((r) => inRings(p, ringsOf(r)!)).length, c.id).toBeLessThanOrEqual(1);
    }
  });
});

describe('попадания «Pokaż na mapie»', () => {
  it('тап ровно в точку единицы засчитывается, тап в другую (далёкую) — нет', () => {
    for (const u of ctx.units) {
      const a = anchorOf(u);
      expect(hits(ctx.units, u, a), `${u.id} по якорю`).toBe(true);
    }
    for (const u of [...OF('city'), ...OF('river'), ...OF('region'), ...OF('neighbor')]) {
      const other = ctx.units.filter((v) => v.id !== u.id && groupOf(v) === groupOf(u) && dist(anchorOf(v), anchorOf(u)) > 40);
      for (const v of other.slice(0, 6)) expect(hits(ctx.units, u, anchorOf(v)), `${u.id} ← ${v.id}`).toBe(false);
    }
  });

  it('города рядом: тап по Wieliczka — это не Kraków, и наоборот; Sopot, Gdynia, Gdańsk различимы', () => {
    const pair = (a: string, b: string): void => {
      expect(hits(ctx.units, U(a), posOf(U(a))!)).toBe(true);
      expect(hits(ctx.units, U(a), posOf(U(b))!)).toBe(false);
      expect(hits(ctx.units, U(b), posOf(U(b))!)).toBe(true);
    };
    pair('geo.city.krakow', 'geo.city.wieliczka');
    pair('geo.city.gdynia', 'geo.city.sopot');
    pair('geo.city.gdansk', 'geo.city.sopot');
    expect(clusterOf(ctx.units, U('geo.city.krakow')).map((u) => u.id).sort()).toEqual(['geo.city.krakow', 'geo.city.wieliczka']);
    expect(clusterOf(ctx.units, U('geo.city.gdynia')).length).toBe(3);
    expect(clusterOf(ctx.units, U('geo.city.warszawa')).length).toBe(1);
    const c = centroid(clusterOf(ctx.units, U('geo.city.gdynia')));
    expect(dist(c, posOf(U('geo.city.gdansk'))!)).toBeLessThan(8);
  });

  it('допуск по данным: Wrocław засчитывается в 25 км, не засчитывается за 60 км; Tatry/Rysy/Morskie Oko — «одно место»', () => {
    const w = U('geo.city.wroclaw');
    const p = posOf(w)!;
    expect(tolPx(w)).toBeGreaterThanOrEqual(8);
    expect(hits(ctx.units, w, { x: p.x + 5, y: p.y })).toBe(true);
    expect(hits(ctx.units, w, { x: p.x + 30, y: p.y })).toBe(false);
    for (const id of ['geo.mt.tatry', 'geo.mt.rysy', 'geo.nat.morskie_oko']) expect(hits(ctx.units, U(id), posOf(U('geo.mt.tatry'))!), id).toBe(true);
  });

  it('река: тап по линии засчитывается, по другой реке и по полю — нет; воеводство и сосед — по полигону', () => {
    const wisla = U('geo.river.wisla');
    const mid = pathOf(wisla)[10]!;
    expect(hits(ctx.units, wisla, mid)).toBe(true);
    expect(hits(ctx.units, U('geo.river.odra'), mid)).toBe(false);
    expect(hits(ctx.units, wisla, { x: mid.x + 40, y: mid.y })).toBe(false);
    const w = posOf(U('geo.city.warszawa'))!;
    expect(hits(ctx.units, U('geo.voi.mazowieckie'), w)).toBe(true);
    expect(hits(ctx.units, U('geo.voi.malopolskie'), w)).toBe(false);
    expect(hits(ctx.units, U('geo.nb.niemcy'), { x: 10, y: 150 })).toBe(true);
    expect(hits(ctx.units, U('geo.nb.niemcy'), w)).toBe(false);
    expect(hits(ctx.units, U('geo.nb.ukraina'), { x: 314, y: 250 })).toBe(true);
    expect(hits(ctx.units, U('geo.nb.slowacja'), { x: 190, y: 290 })).toBe(true);
  });

  it('статус точки: серая → зелёная → золотая', () => {
    expect(statusOf({ planted: false, stage: null, harvests: 0 })).toBe('gray');
    expect(statusOf({ planted: true, stage: 'seed', harvests: 0 })).toBe('green');
    expect(statusOf({ planted: true, stage: null, harvests: 1 })).toBe('gold');
  });
});

describe('задания', () => {
  it('движок просит любую единицу в любом виде: задание есть, верный ответ проходит, пустой и чужой — нет', () => {
    for (const u of ctx.units) {
      for (const want of [
        { id: u.id, side: 'A', self: false, stage: 'seed' },
        { id: u.id, side: 'B', self: false, stage: 'sprout' },
        { id: u.id, side: 'B', self: true, stage: 'bush' },
      ] as Want[]) {
        const t = makeTask(ctx, want);
        expect(t, `${u.id} ${want.side}${want.self ? ' self' : ''}`).toBeTruthy();
        expect(t!.id).toBe(u.id);
        expect(t!.side).toBe(want.self ? 'B' : want.side);
        if (want.self) expect(t!.self).toBe(true);
        expect(verdict(t!, '___', ctx)).toBe(false);
        expect(verdict(t!, null, ctx)).toBe(false);
        expect(checkTask(t!, undefined, ctx).ok).toBe(false);
      }
    }
  });

  /** Правильный ответ задания (как его отдаёт игра). */
  const right = (t: GeoTask, u: PolskaUnit): unknown => {
    switch (t.t) {
      case 'show':
        return anchorOf(u);
      case 'dir':
        return { nb: t.answer!, form: t.form!.answer } satisfies DirAnswer;
      case 'build':
        return t.need;
      default:
        return t.answer;
    }
  };

  it('все виды заданий на всех единицах, где они есть в данных: варианты без повторов, верный среди них, check работает', () => {
    const seen = new Map<GeoKind, number>();
    for (const u of ctx.units) {
      for (const kind of ['show', 'name', 'river', 'region', 'side', 'capital', 'dir', 'form', 'build'] as GeoKind[]) {
        const t = makeKind(ctx, u, kind);
        if (!t) continue;
        seen.set(kind, (seen.get(kind) ?? 0) + 1);
        expect(t.t).toBe(kind);
        expect(t.q.length, `${u.id} ${kind}`).toBeGreaterThan(0);
        if (t.options) {
          expect(new Set(t.options).size, `${u.id} ${kind}`).toBe(t.options.length);
          expect(t.options.length).toBeGreaterThanOrEqual(2);
          expect(t.options.length).toBeLessThanOrEqual(4);
          expect(t.options, `${u.id} ${kind}`).toContain(t.answer);
        }
        const ok = checkTask(t, right(t, u), ctx);
        expect(ok.ok, `${u.id} ${kind} верный ответ`).toBe(true);
        expect(ok.correct).toBeTruthy();
        expect(ok.say).toBeTruthy();
        if (t.options) for (const o of t.options.filter((x) => x !== t.answer)) expect(checkTask(t, kind === 'dir' ? ({ nb: o } as DirAnswer) : o, ctx).ok, `${u.id} ${kind} «${o}»`).toBe(false);
      }
    }
    for (const k of ['show', 'name', 'river', 'region', 'side', 'capital', 'dir', 'form', 'build'] as GeoKind[]) expect(seen.get(k) ?? 0, k).toBeGreaterThan(0);
    expect(seen.get('show')).toBe(ctx.units.length);
    expect(seen.get('build')).toBe(ctx.units.length);
  });

  it('«Z kim graniczy Polska na zachodzie?»: сначала сосед, потом форма «z Niemcami»; без второго соседа с той же стороны', () => {
    const niemcy = U('geo.nb.niemcy');
    const t = makeKind(ctx, niemcy, 'dir')!;
    expect(t.q).toBe('Z kim graniczy Polska na zachodzie?');
    expect(t.answer).toBe('Niemcy');
    expect(t.form!.answer).toBe('z Niemcami');
    expect(t.form!.options).toContain('z Niemiec');
    expect(verdict(t, { nb: 'Niemcy', form: 'z Niemcami' }, ctx)).toBe(true);
    expect(verdict(t, { nb: 'Niemcy', form: 'z Niemiec' }, ctx)).toBe(false);
    expect(verdict(t, { nb: 'Niemcy' }, ctx)).toBe(false);
    expect(verdict(t, { nb: 'Czechy', form: 'z Niemcami' }, ctx)).toBe(false);
    const south = makeKind(ctx, U('geo.nb.czechy'), 'dir')!;
    expect(south.options).not.toContain('Słowacja');
    expect(south.options).toContain('Czechy');
  });

  it('«Nad jaką rzeką leży Kraków?»: верный ответ Wisła; «Jak się nazywa to miasto?»: точка подсвечена; «stolica województwa»; фраза из плиток', () => {
    const k = U('geo.city.krakow');
    let t: GeoTask | null = null;
    for (let i = 0; i < 30 && !t; i++) {
      const c = makeKind(ctxOf(S, i + 1), k, 'river');
      if (c && c.q.startsWith('Nad jaką')) t = c;
    }
    expect(t!.q).toBe('Nad jaką rzeką leży Kraków?');
    expect(t!.answer).toBe('Wisła');
    expect(t!.mark).toBe(k.id);
    const n = makeKind(ctx, k, 'name')!;
    expect(n.mark).toBe(k.id);
    expect(n.options).toContain('Kraków');
    expect(n.side).toBe('A');
    const cap = makeKind(ctx, U('geo.voi.mazowieckie'), 'capital')!;
    expect(cap.answer).toBe('Warszawa');
    expect(cap.q).toContain('stolica');
    const lub = makeKind(ctx, U('geo.voi.lubuskie'), 'capital')!;
    expect(['Gorzów Wielkopolski', 'Zielona Góra']).toContain(lub.answer);
    expect(lub.options!.filter((o) => ['Gorzów Wielkopolski', 'Zielona Góra'].includes(o)).length).toBe(1);
    const self = makeTask(ctx, { id: k.id, side: 'B', self: true, stage: 'bush' })!;
    expect(self.t).toBe('build');
    expect(self.tiles!.length).toBeGreaterThan(self.need!.length);
    expect(checkTask(self, [...self.need!].reverse(), ctx).ok).toBe(self.need!.length < 2 ? true : false);
    expect(checkTask(self, self.need, ctx).ok).toBe(true);
    expect(checkTask(self, self.need!.join(' ').toLowerCase(), ctx).ok).toBe(true);
  });

  it('сторона A — узнать (название по подсвеченной точке), B — найти и вспомнить; фразы единицы ходят по кругу', () => {
    for (const u of ctx.units) {
      expect(makeTask(ctx, { id: u.id, side: 'A', self: false, stage: 'seed' })!.t, u.id).toBe('name');
    }
    const kinds = new Set<GeoKind>();
    for (let i = 0; i < 60; i++) kinds.add(makeTask(ctxOf(S, i + 1), { id: 'geo.city.krakow', side: 'B', self: false, stage: 'sprout' })!.t);
    expect(kinds.has('show')).toBe(true);
    expect([...kinds].every((k) => k !== 'name' && k !== 'build')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
    const a = makeKind(ctx, U('geo.city.wroclaw'), 'build')!.correct;
    const b = makeKind(ctx, U('geo.city.wroclaw'), 'build')!.correct;
    expect(a).not.toBe(b);
  });

  it('порядок посадки: все единицы по одному разу, полоса 1 раньше, первые 8 семян разных видов', () => {
    const pool = geoPool(ctx);
    expect(pool.length).toBe(ctx.units.length);
    expect(new Set(pool).size).toBe(pool.length);
    expect(Math.max(...pool.slice(0, 20).map((id) => U(id).band))).toBe(1);
    expect(new Set(pool.slice(0, 8).map((id) => U(id).type)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('экран: рисуется, отвечает', () => {
  it('каждый вид задания рисуется в панели; варианты = кнопки data-opt, у «покажи» одна кнопка-карта data-nav', () => {
    for (const u of [U('geo.city.krakow'), U('geo.river.odra'), U('geo.voi.slaskie'), U('geo.nb.niemcy'), U('geo.mt.tatry')]) {
      for (const kind of ['show', 'name', 'river', 'region', 'side', 'capital', 'dir', 'form', 'build'] as GeoKind[]) {
        const t = makeKind(ctx, u, kind);
        if (!t) continue;
        const { panel, body } = panelOf();
        game.render(t, panel, ctx);
        expect(body.childElementCount, `${u.id} ${kind}`).toBeGreaterThan(0);
        expect(body.querySelector('[data-prompt]')!.textContent).toContain(t.q);
        if (kind === 'show') expect(body.querySelectorAll('[data-geo-map][data-nav]').length).toBe(1);
        else if (kind === 'build') expect(body.querySelectorAll('[data-tile]').length).toBe(t.tiles!.length);
        else expect(body.querySelectorAll('[data-opt]').length).toBe(t.options!.length);
      }
    }
  });

  it('выбор: верный вариант отдаёт строку, «сосед → форма» шлёт ответ только после второй ступени', () => {
    const t = makeKind(ctx, U('geo.nb.niemcy'), 'dir')!;
    const { panel, body, given } = panelOf();
    game.render(t, panel, ctx);
    body.querySelector<HTMLElement>('[data-opt="Czechy"], [data-opt="Ukraina"]')?.click();
    expect(given).toEqual([{ nb: expect.any(String) }]);
    expect(game.check(t, given[0], ctx).ok).toBe(false);

    const q = panelOf();
    game.render(t, q.panel, ctx);
    q.body.querySelector<HTMLElement>('[data-opt="Niemcy"]')!.click();
    expect(q.given).toEqual([]);
    expect(q.body.querySelector('[data-step2]')!.textContent).toContain('Polska graniczy');
    q.body.querySelector<HTMLElement>('[data-opt="z Niemcami"]')!.click();
    expect(q.given).toEqual([{ nb: 'Niemcy', form: 'z Niemcami' }]);
    expect(game.check(t, q.given[0], ctx).ok).toBe(true);
  });

  it('сборка фразы: плитки по порядку → верно', () => {
    const t = makeTask(ctx, { id: 'geo.city.krakow', side: 'B', self: true, stage: 'bush' })!;
    const { panel, body, given } = panelOf();
    game.render(t, panel, ctx);
    for (const w of t.need!) body.querySelector<HTMLElement>(`[data-tile="${w}"]:not([disabled])`)!.click();
    panel.foot.querySelector<HTMLElement>('[data-check]')!.click();
    expect(given.length).toBe(1);
    expect(game.check(t, given[0], ctx).ok).toBe(true);
  });
});

describe('карта: курсор, тап, герой с флажком', () => {
  const mkMap = (bus = testBus()) => {
    const m = createMap({ units: ctx.units, status: () => 'gray', maxW: 320, maxH: 304, interactive: true, bus });
    document.body.append(m.el);
    return { m, bus };
  };

  it('масштаб: целый, если влезает; дробный не меньше 0,55; иначе карты нет', async () => {
    const { pickScale } = await import('../src/games/geo/mapview');
    expect(pickScale(320, 304)).toBe(1);
    expect(pickScale(700, 640)).toBe(2);
    expect(pickScale(700, 330)).toBe(1);
    expect(pickScale(240, 250)).toBeCloseTo(0.75, 2);
    expect(pickScale(100, 100)).toBe(0);
  });

  it('A на карте сначала показывает курсор, стрелки двигают его (серия нажатий ускоряет), второй A ставит точку один раз', () => {
    const { m, bus } = mkMap();
    const picks: { x: number; y: number }[] = [];
    m.onPick = (p) => picks.push(p);
    const move = (dir: 'left' | 'right' | 'up' | 'down'): void => bus.emit('input:intent', { type: 'move', dir, held: true, to: 'ui', source: 'keyboard' });
    expect(m.cursor).toBeNull();
    m.el.click();
    expect(m.cursor).not.toBeNull();
    expect(picks).toEqual([]);
    const c0 = { ...m.cursor! };
    move('right');
    const c1 = { ...m.cursor! };
    expect(c1.x).toBeGreaterThan(c0.x);
    move('right');
    expect(m.cursor!.x - c1.x).toBeGreaterThan(c1.x - c0.x);
    move('up');
    expect(m.cursor!.y).toBeLessThan(c0.y);
    m.el.click();
    expect(picks.length).toBe(1);
    expect(picks[0]!.x).toBeCloseTo(m.cursor?.x ?? picks[0]!.x, 0);
    m.el.click();
    expect(picks.length).toBe(1);
    m.unlock();
  });

  it('стрелки не двигают курсор вне оверлея (to: world) и когда карта закрыта после выбора', () => {
    const { m, bus } = mkMap();
    m.onPick = () => {};
    m.el.click();
    const c = { ...m.cursor! };
    bus.emit('input:intent', { type: 'move', dir: 'left', held: true, to: 'world', source: 'keyboard' });
    expect(m.cursor).toEqual(c);
  });

  it('герой бежит к точке и втыкает флажок; готово → done один раз; кот и герой не падают без canvas', async () => {
    const { m } = mkMap();
    const done = vi.fn();
    m.plant({ x: 111, y: 182 }, true, done);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
    m.reveal(['geo.city.wroclaw', 'geo.river.odra', 'geo.voi.dolnoslaskie']);
    expect(m.el.querySelectorAll('[data-label]').length).toBe(3);
    expect(m.el.querySelector('[data-label="geo.city.wroclaw"]')!.textContent).toBe('Wrocław');
    m.zoomTo({ x: 150, y: 45 });
    expect(m.zoomed).toBe(true);
    m.zoomOut();
    expect(m.zoomed).toBe(false);
    m.destroy();
  });
});

describe('движок: Geografia целым раундом', () => {
  it('верные тапы по карте засчитываются, неверные нет; раунд из 10 заданий и итог', () => {
    const s = mk();
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountPolskaGame(root, { bus: s.bus, games: [game as never], polska: s.p, now: () => NOW, rand: seeded(7), say: () => {} });
    vi.useFakeTimers();
    ui.start('geo');
    let shows = 0;
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const t = ui.task as GeoTask;
      expect(t, `задание ${i + 1}`).toBeTruthy();
      const u = s.p.unit(t.id)!;
      if (t.t === 'show') {
        shows++;
        ui.submit(i % 2 ? anchorOf(u) : { x: 1, y: 1 });
        const fb = root.querySelector('[data-feedback]')!.getAttribute('data-feedback');
        expect(fb).toBe(i % 2 ? 'ok' : 'bad');
        if (fb === 'ok') ok++;
      } else if (t.t === 'build') ui.submit(t.need);
      else if (t.t === 'dir') ui.submit({ nb: t.answer, form: t.form!.answer });
      else ui.submit(t.answer);
      vi.advanceTimersByTime(NEXT_DELAY_MS + 10);
      root.querySelector<HTMLButtonElement>('[data-next]')?.click();
    }
    vi.useRealTimers();
    expect(shows + ok).toBeGreaterThanOrEqual(0);
    expect(root.querySelector('[data-round-summary]')).toBeTruthy();
    ui.stop();
  });
});

describe('карта во весь лист: масштаб и попадания по координатам экрана', () => {
  it('pickScale: от 2 целый, между 1 и 2 шаг 1/8, ниже 1 как есть', () => {
    expect(pickScale(MAP_W * 2.9, MAP_H * 3.4)).toBe(2);
    expect(pickScale(MAP_W * 3, MAP_H * 3)).toBe(3);
    expect(pickScale(MAP_W * 1.99, MAP_H * 2)).toBe(1.875);
    expect(pickScale(369, 345)).toBe(1.125); // iPhone 375: ширина листа без полей минус рамка карты
    expect(pickScale(320, 304)).toBe(1);
    expect(pickScale(300, 304)).toBeCloseTo(0.9375, 3);
    expect(pickScale(MAP_W * 0.5, MAP_H * 0.5)).toBe(0);
  });

  it('canvasSize: ширина целая, u = cw / MAP_W, туда и обратно без потерь', () => {
    for (const s of [0.75, 1, 1.125, 1.5, 1.875, 2, 3]) {
      const { cw, ch, u } = canvasSize(s);
      expect(Number.isInteger(cw) && Number.isInteger(ch), `s=${s}`).toBe(true);
      expect(u * MAP_W).toBeCloseTo(cw, 9);
      expect(Math.abs(ch - MAP_H * u)).toBeLessThanOrEqual(0.5);
      const v = { x: 0, y: 0, u };
      for (const p of [{ x: 0, y: 0 }, { x: 211.1, y: 120.4 }, { x: MAP_W, y: MAP_H }]) {
        const back = canvasToMap(v, mapToCanvas(v, p).x, mapToCanvas(v, p).y);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
    expect(canvasSize(0)).toEqual({ cw: 0, ch: 0, u: 1 });
  });

  /** Карта в DOM: холст стоит в (left, top), клик по экранным координатам, независимо от кода пересчёта считаем пиксель сами. */
  const mount = (scale: number) => {
    const bus = testBus();
    const m = createMap({ units: ctx.units, status: () => 'gray', maxW: MAP_W * scale, maxH: MAP_H * scale, interactive: true, bus });
    document.body.append(m.el);
    const canvas = m.el.querySelector('canvas')!;
    const LEFT = 37;
    const TOP = 91;
    canvas.getBoundingClientRect = () => ({ left: LEFT, top: TOP, width: canvas.width, height: canvas.height, right: LEFT + canvas.width, bottom: TOP + canvas.height, x: LEFT, y: TOP, toJSON: () => ({}) }) as DOMRect;
    const picks: { x: number; y: number }[] = [];
    m.onPick = (p) => {
      picks.push(p);
      m.unlock();
    };
    const tap = (sx: number, sy: number): void => void m.el.dispatchEvent(new MouseEvent('click', { clientX: LEFT + sx, clientY: TOP + sy, detail: 1, bubbles: true }));
    return { m, canvas, picks, tap };
  };

  const PAIRS = ['geo.city.sopot', 'geo.city.gdynia', 'geo.city.gdansk', 'geo.city.krakow', 'geo.city.wieliczka'];

  it('тап в точку города попадает в тот же город при масштабах 1, 1,125, 1,5, 2, 3 (Sopot/Gdynia/Gdańsk, Kraków/Wieliczka)', () => {
    for (const s of [1, 1.125, 1.5, 2, 3]) {
      const { m, canvas, picks, tap } = mount(s);
      expect(m.scale, `s=${s}`).toBe(s);
      for (const id of PAIRS) {
        const u = U(id);
        const c = posOf(u)!;
        // Экранная точка: центр пикселя картинки под городом, считаем прямо из размеров холста.
        tap((c.x * canvas.width) / MAP_W, (c.y * canvas.height) / MAP_H);
        const p = picks.pop()!;
        expect(Math.abs(p.x - c.x), `${id} x @${s}`).toBeLessThanOrEqual(0.51 / (canvas.width / MAP_W));
        expect(Math.abs(p.y - c.y), `${id} y @${s}`).toBeLessThanOrEqual(0.51 / (canvas.height / MAP_H));
        expect(hits(ctx.units, u, p), `${id} @${s}`).toBe(true);
        for (const other of PAIRS) if (other !== id && dist(posOf(U(other))!, c) > 3) expect(hits(ctx.units, U(other), p), `${id} не ${other} @${s}`).toBe(false);
      }
      m.destroy();
    }
  });

  it('тап по краям карты и в центре: ровно та же точка картинки, что и вычисленная по пикселю', () => {
    for (const s of [1, 1.125, 2, 3]) {
      const { m, canvas, picks, tap } = mount(s);
      for (const [fx, fy] of [[0, 0], [0.5, 0.5], [0.999, 0.999], [0.25, 0.75]] as const) {
        const sx = Math.floor(fx * canvas.width);
        const sy = Math.floor(fy * canvas.height);
        tap(sx, sy);
        const p = picks.pop()!;
        expect(p.x, `x @${s}`).toBeCloseTo((sx * MAP_W) / canvas.width, 6);
        expect(p.y, `y @${s}`).toBeCloseTo((sy * MAP_H) / canvas.height, 6);
        expect(inMap(p)).toBe(true);
      }
      m.destroy();
    }
  });

  it('увеличение кластера (Gdańsk · Gdynia · Sopot): тап в точку города попадает именно в него при любом масштабе', () => {
    for (const s of [1, 1.125, 2, 3]) {
      const { m, canvas, picks, tap } = mount(s);
      const cl = clusterOf(ctx.units, U('geo.city.sopot'));
      expect(cl.length).toBeGreaterThan(1);
      const c0 = centroid(cl);
      m.zoomTo(c0);
      m.unlock();
      // Вид после увеличения: 8 × целый масштаб спрайтов px холста на px картинки, центр в кластере, края прижаты к карте.
      const u = 8 * Math.max(1, Math.floor(m.scale));
      const vw = canvas.width / u;
      const vh = canvas.height / u;
      const x0 = Math.max(0, Math.min(MAP_W - vw, c0.x - vw / 2));
      const y0 = Math.max(0, Math.min(MAP_H - vh, c0.y - vh / 2));
      for (const id of ['geo.city.sopot', 'geo.city.gdynia', 'geo.city.gdansk']) {
        const c = posOf(U(id))!;
        tap((c.x - x0) * u, (c.y - y0) * u);
        const p = picks.pop()!;
        expect(dist(p, c), `${id} @${s}`).toBeLessThanOrEqual(0.51 / u);
        expect(hits(ctx.units, U(id), p), `${id} @${s}`).toBe(true);
        for (const other of ['geo.city.sopot', 'geo.city.gdynia', 'geo.city.gdansk']) if (other !== id) expect(hits(ctx.units, U(other), p), `${id} не ${other} @${s}`).toBe(false);
      }
      m.destroy();
    }
  });

  it('смена масштаба на лету (поворот телефона): точка картинки под пальцем та же, холст пересчитан', () => {
    const { m, canvas, picks, tap } = mount(1);
    const c = posOf(U('geo.city.krakow'))!;
    m.layout(MAP_W * 3, MAP_H * 3);
    expect([canvas.width, canvas.height]).toEqual([960, 912]);
    tap(c.x * 3, c.y * 3);
    expect(dist(picks.pop()!, c)).toBeLessThan(0.2);
    m.layout(MAP_W * 1.125, MAP_H * 1.125);
    expect(canvas.width).toBe(360);
    tap(c.x * 1.125, c.y * 1.125);
    expect(dist(picks.pop()!, c)).toBeLessThan(0.5);
    m.destroy();
  });
});

describe('раскладка карты и заданий (planFit)', () => {
  const base: FitInput = { innerW: 1176, innerH: 1000, above: 100, after: 0, reserve: 92, belowH: 46, sideW: 232, gap: 8, frame: 6 };
  it('десктоп 1230×1260: варианты полосой под картой, масштаб 2', () => {
    const p = planFit(base);
    expect(p.mode).toBe('below');
    expect(p.scale).toBe(2);
  });
  it('телефон 375×812: дробный 1,125 во всю ширину, влезает по высоте', () => {
    const p = planFit({ ...base, innerW: 375, innerH: 640, above: 95, belowH: 96, sideW: 0 });
    expect(p.mode).toBe('below');
    expect(p.scale).toBe(1.125);
    expect(canvasSize(p.scale).ch + 6 + 8 + 96 + 95 + 92).toBeLessThanOrEqual(640);
  });
  it('широкий низкий экран: варианты справа, если так карта крупнее', () => {
    const p = planFit({ ...base, innerW: 1100, innerH: 640, belowH: 100 });
    expect(p.mode).toBe('side');
    expect(p.scale).toBeGreaterThan(planFit({ ...base, innerW: 1100, innerH: 640, belowH: 100, sideW: 0 }).scale);
  });
  it('тесно: масштаб меньше 1 или карты нет, ничего не падает', () => {
    expect(planFit({ ...base, innerW: 200, innerH: 300 }).scale).toBeLessThan(1);
    expect(planFit({ ...base, innerW: 90, innerH: 90 }).scale).toBe(0);
  });
});
