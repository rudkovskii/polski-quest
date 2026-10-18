// @vitest-environment happy-dom
// Игра «Święta»: календарь и Пасха, ближайший праздник по дате, задания (что за праздник, когда, магазины, корзинка, стол,
// пожелания), проверка ответов, рисование в панели и совпадение иконок с атласом.
import { describe, expect, it } from 'vitest';
import atlas from '../public/atlas/custom.json';
import { dateChoices, game, maskedCustoms, packSpec, packTask, shopsQuestions, shopsTask, whatTask, whenTask, wishTask, customTilesTask, type SwTask } from '../src/games/swieta';
import { dayNo, easterDay, fmtSpan, inDays, nearestHoliday, nextSpan, seasonalOrder, shortName, spanIn, upcoming, ymdOf } from '../src/games/swieta/calendar';
import { ATLAS_SIZE, FRAMES, WORD_EMOJI, WORD_FRAME, itemWord } from '../src/games/swieta/icons';
import { GAMES } from '../src/games/registry';
import { V2, unitsOfGame } from '../src/systems/v2content';
import type { GameCtx, GamePanel, PolskaUnit, UnitInfo, Want } from '../src/types/polska';
import { seeded } from './helpers';

const UNITS = unitsOfGame(V2, 'swieta');
const BY_ID = new Map(UNITS.map((u) => [u.id, u]));
const doc = V2.docs.swieta;
const U = (id: string): PolskaUnit => BY_ID.get(`hol.${id}`)!;

const ctxAt = (y: number, m: number, d: number, seed = 1): GameCtx => ({
  units: UNITS,
  unit: (id) => BY_ID.get(id),
  info: (id) => ({ id, kind: 'holiday', stage: null, planted: false, drops: 0, sides: { A: false, B: false }, selfOk: false, days: 0, harvests: 0, next: '' }) as UnitInfo,
  doc,
  now: () => Date.UTC(y, m - 1, d, 9),
  date: () => ({ y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }),
  rand: seeded(seed),
});
const TODAY = ctxAt(2026, 10, 18);
const day = (y: number, m: number, d: number): number => dayNo(y, m, d);

function mkPanel(layout: 'panel' | 'full' = 'panel') {
  const sent: unknown[] = [];
  const panel: GamePanel = { body: document.createElement('div'), foot: document.createElement('div'), layout, submit: (a) => sent.push(a), say: () => {}, rand: seeded(2) };
  return { panel, sent };
}

describe('Пасха и подвижные праздники', () => {
  it('Meeus/Butcher: даты Пасхи сходятся с таблицей данных (2026–2030) и с ТЗ (2027 — 28.03, 2028 — 16.04)', () => {
    const easter = doc.easter as Record<string, string>;
    for (const [y, iso] of Object.entries(easter)) {
      const e = ymdOf(easterDay(Number(y)));
      expect(`${e.y}-${String(e.m).padStart(2, '0')}-${String(e.d).padStart(2, '0')}`, y).toBe(iso);
    }
    expect(fmtSpan({ start: easterDay(2027), end: easterDay(2027), movable: true })).toBe('28.03.2027');
    expect(fmtSpan({ start: easterDay(2028), end: easterDay(2028), movable: true })).toBe('16.04.2028');
  });

  it('все подвижные праздники сходятся с `dates` из данных; смещения: Tłusty −52, Boże Ciało +60', () => {
    let checked = 0;
    for (const u of UNITS) {
      const dates = u.raw.dates as Record<string, string> | undefined;
      if (!dates) continue;
      for (const [y, iso] of Object.entries(dates)) {
        const s = spanIn(u, Number(y))!;
        const d = ymdOf(s.start);
        expect(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`, `${u.id} ${y}`).toBe(iso);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(fmtSpan(spanIn(U('tlusty'), 2027)!)).toBe('4.02.2027');
  });

  it('диапазоны через границу года: 31.12–1.01 продолжается в январе', () => {
    const s = nextSpan(U('nowy_rok'), day(2027, 1, 1))!;
    expect(fmtSpan(s)).toBe('31.12–1.01');
    expect(s.start).toBe(day(2026, 12, 31));
    expect(s.end).toBe(day(2027, 1, 1));
    expect(fmtSpan(spanIn(U('majowka'), 2026)!)).toBe('1–3.05');
  });
});

describe('ближайший праздник по реальной дате', () => {
  it('18.10.2026 — Wszystkich Świętych за 14 дней (как в ТЗ), знак «dni»', () => {
    const near = nearestHoliday(UNITS, TODAY.date())!;
    expect(near.unit.id).toBe('hol.wszyscy');
    expect(near.days).toBe(14);
    expect(inDays(near.days)).toBe('za 14 dni');
    expect(inDays(1)).toBe('jutro');
    expect(inDays(0)).toBe('dziś');
  });

  it('идёт сегодня — «dziś»; следующий после Рождества — Sylwester; в январе — Трёх Королей; после Пасхи — ближайший по году', () => {
    expect(nearestHoliday(UNITS, { y: 2026, m: 12, d: 24 })).toMatchObject({ days: 0, unit: { id: 'hol.wigilia' } });
    expect(nearestHoliday(UNITS, { y: 2026, m: 12, d: 27 })).toMatchObject({ days: 4, unit: { id: 'hol.nowy_rok' } });
    expect(nearestHoliday(UNITS, { y: 2027, m: 1, d: 1 })).toMatchObject({ days: 0, unit: { id: 'hol.nowy_rok' } });
    expect(nearestHoliday(UNITS, { y: 2027, m: 1, d: 2 })).toMatchObject({ days: 4, unit: { id: 'hol.trzech_kroli' } });
    expect(nearestHoliday(UNITS, { y: 2027, m: 3, d: 22 })).toMatchObject({ days: 6, unit: { id: 'hol.wielkanoc' } });
    // 2 мая: majówka идёт (1–3.05), а не Dzień Matki.
    expect(nearestHoliday(UNITS, { y: 2027, m: 5, d: 2 })).toMatchObject({ days: 0, unit: { id: 'hol.majowka' } });
  });

  it('pool: ближайший первым, дальше по ходу года, imieniny (без даты) последними; все 22 единицы', () => {
    const pool = game.pool(TODAY);
    expect(pool.length).toBe(UNITS.length);
    expect(new Set(pool).size).toBe(UNITS.length);
    expect(pool[0]).toBe('hol.wszyscy');
    expect(pool.slice(0, 5)).toEqual(['hol.wszyscy', 'hol.zaduszki', 'hol.andrzejki', 'hol.mikolajki', 'hol.wigilia']);
    expect(pool[pool.length - 1]).toBe('hol.imieniny');
    expect(seasonalOrder(UNITS, { y: 2027, m: 3, d: 22 })[0]).toBe('hol.wielkanoc');
    const days = upcoming(UNITS, day(2026, 10, 18)).map((x) => x.days);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('строка «Najbliższe święto: … za N dni»: баннер у ближайшего праздника, в итоге раунда — всегда', () => {
    for (const side of ['A', 'B'] as const) {
      const t = game.nextTask(TODAY, { id: 'hol.wszyscy', side, self: false, stage: 'seed' })!;
      const { panel } = mkPanel();
      game.render(t, panel, TODAY);
      expect(panel.body.querySelector('[data-nearest]')?.textContent).toBe('Najbliższe święto: Wszystkich Świętych za 14 dni');
      const t2 = game.nextTask(TODAY, { id: 'hol.zaduszki', side, self: false, stage: 'seed' })!;
      const p2 = mkPanel().panel;
      game.render(t2, p2, TODAY);
      expect(p2.body.querySelector('[data-nearest]')).toBeNull();
    }
    expect(game.summaryLine!(TODAY)).toBe('Najbliższe święto: Wszystkich Świętych za 14 dni');
  });
});

describe('«Co to za święto?»', () => {
  it('по подсказке: предметы из clue, 4 разных названия, верное среди них; подсказки не делят праздник с неверными вариантами', () => {
    for (const u of UNITS) {
      const t = whatTask(TODAY, u, 'clue')!;
      expect(t.clue).toEqual(u.raw.clue);
      expect(new Set(t.options).size).toBe(4);
      expect(t.options).toContain(shortName(u));
      for (const name of t.options!) {
        const other = UNITS.find((x) => shortName(x) === name)!;
        if (other.id === u.id) continue;
        const shared = (other.raw.clue as string[]).filter((c) => (u.raw.clue as string[]).includes(c));
        expect(shared, `${u.id} против ${other.id}`).toEqual([]);
      }
      expect(game.check(t, shortName(u), TODAY).ok).toBe(true);
      expect(game.check(t, t.options!.find((o) => o !== shortName(u)), TODAY).ok).toBe(false);
    }
  });

  it('по обычаю: название спрятано в «___»; по дате: дата цифрами и неверные варианты не пересекаются с ней', () => {
    const t = whatTask(TODAY, U('tlusty'), 'custom')!;
    expect(t.big).toMatch(/___/);
    expect(t.big).not.toMatch(/tłusty/i);
    expect(maskedCustoms(U('wielkanoc')).some((s) => /Na ___ jemy/.test(s))).toBe(true);
    const d = whatTask(TODAY, U('wigilia'), 'date')!;
    expect(d.big).toBe('24.12');
    for (const u of UNITS) {
      const t2 = whatTask(TODAY, u, 'date');
      if (!t2 || t2.variant !== 'date') continue;
      const span = nextSpan(u, day(2026, 10, 18))!;
      for (const name of t2.options!) {
        const o = UNITS.find((x) => shortName(x) === name)!;
        if (o.id === u.id) continue;
        const s = nextSpan(o, day(2026, 10, 18))!;
        expect(s.start <= span.end && span.start <= s.end, `${u.id}: ${name} в те же дни`).toBe(false);
      }
    }
    expect(whatTask(TODAY, U('imieniny'), 'date')!.variant).not.toBe('date');
    const wk = whatTask(TODAY, U('wielkanoc'), 'date')!;
    expect(wk.big).toBe('28.03.2027 (niedziela)');
  });
});

describe('«Kiedy jest…?»', () => {
  it('дата цифрами, 4 разных варианта по порядку, верный среди них; годов словами нет', () => {
    for (const u of UNITS) {
      const t = whenTask(TODAY, u);
      if (u.id === 'hol.imieniny') {
        expect(t).toBeNull();
        continue;
      }
      expect(t, u.id).toBeTruthy();
      expect(new Set(t!.options).size).toBe(4);
      expect(t!.options).toContain(t!.answer);
      for (const o of t!.options!) expect(o, `${u.id} ${o}`).toMatch(/^[\d.–]+$/);
      expect(game.check(t!, t!.answer, TODAY).ok).toBe(true);
      expect(game.check(t!, t!.options!.find((o) => o !== t!.answer), TODAY).ok).toBe(false);
    }
  });

  it('подвижный праздник — с годом ближайшего вхождения и днём недели в подсказке; неверные сдвинуты на недели', () => {
    const t = whenTask(TODAY, U('wielkanoc'))!;
    expect(t.answer).toBe('28.03.2027');
    expect(t.hint).toContain('niedziela');
    const all = t.options!;
    expect(all.every((o) => /\.20\d\d$/.test(o))).toBe(true);
    const tl = dateChoices(ctxAt(2027, 3, 29), U('tlusty'))!;
    expect(tl.answer).toBe('24.02.2028');
    const jan = dateChoices(TODAY, U('trzech_kroli'))!;
    expect(jan.answer).toBe('6.01');
  });
});

describe('«Sklepy otwarte?»', () => {
  it('вопрос из shops_q с датой словами, три ответа tak/nie/krótko, верный по данным', () => {
    const w = shopsTask(TODAY, U('wszyscy'))!;
    expect(w.q).toBe('Pierwszego listopada: sklepy są otwarte czy zamknięte?');
    expect(w.options).toEqual(['otwarte', 'zamknięte', 'otwarte do czternastej']);
    expect(w.answer).toBe('zamknięte');
    expect(game.check(w, 'zamknięte', TODAY)).toMatchObject({ ok: true, say: 'Pierwszego listopada sklepy są zamknięte.' });
    expect(game.check(w, 'otwarte', TODAY).ok).toBe(false);

    const g = shopsTask(TODAY, U('wigilia'))!;
    expect(g.answer).toBe('otwarte do czternastej');
    expect(g.q).toMatch(/^Dwudziestego czwartego grudnia/);

    // Majówka: три разных вопроса по дням — 1 и 3 мая закрыты, 2 мая открыто.
    expect(shopsQuestions(U('majowka')).map((q) => q.shops)).toEqual(['closed', 'open', 'closed']);
    expect(shopsTask(TODAY, U('majowka'), 1)!.answer).toBe('otwarte');
    expect(shopsTask(TODAY, U('majowka'), 1)!.q).toMatch(/^Drugiego maja/);
  });

  it('без shops_q вопрос строится из shops (и из названия, если даты словами нет); у каждого праздника есть вопрос', () => {
    const t = shopsTask(TODAY, U('tlusty'))!;
    expect(t.q).toBe('Tłusty czwartek: sklepy są otwarte czy zamknięte?');
    expect(t.answer).toBe('otwarte');
    for (const u of UNITS) expect(shopsTask(TODAY, u), u.id).toBeTruthy();
    // Wielkanoc: закрыто, без даты словами.
    expect(shopsTask(TODAY, U('wielkanoc'))!.answer).toBe('zamknięte');
  });
});

describe('«Spakuj koszyk» и «Nakryj stół»', () => {
  it('корзинка Wielkanoc: все предметы in верно, лишнее (karp, choinka, znicz) неверно, пропуск неверно', () => {
    const spec = packSpec(U('wielkanoc'))!;
    expect(spec.src).toBe('basket');
    const t = packTask(TODAY, U('wielkanoc'))!;
    expect(t.kind).toBe('pack');
    expect(t.items!.length).toBe(spec.in.length + spec.out.length);
    expect(t.items!.map((i) => i.id).sort()).toEqual([...spec.in, ...spec.out].sort());
    expect(t.expect).toEqual(spec.in);
    expect(game.check(t, [...spec.in].reverse(), TODAY).ok).toBe(true);
    const wrongExtra = game.check(t, [...spec.in, 'sw.karp'], TODAY);
    expect(wrongExtra.ok).toBe(false);
    expect(wrongExtra.note).toContain('Лишнее: karp');
    const wrongMissing = game.check(t, spec.in.slice(1), TODAY);
    expect(wrongMissing.ok).toBe(false);
    expect(wrongMissing.note).toContain('Не хватило');
    expect(game.check(t, [], TODAY).ok).toBe(false);
    expect(game.check(t, 'pisanka', TODAY).ok).toBe(false);
    expect(game.check(t, spec.out, TODAY).ok).toBe(false);
    expect(t.correct).toContain('pisanka');
  });

  it('стол Wigilia: 12 предметов (8 нужных, 4 лишних), сцена «table», сам режим помечен', () => {
    const t = packTask(TODAY, U('wigilia'), true)!;
    expect(packSpec(U('wigilia'))!.src).toBe('table');
    expect(t.items!.length).toBe(12);
    expect(t.expect!.length).toBe(8);
    expect(t.packKind).toBe('table');
    expect(t.self).toBe(true);
    expect(t.q).toBe('Nakryj stół');
    expect(game.check(t, t.expect, TODAY).ok).toBe(true);
    expect(game.check(t, [...t.expect!, 'sw.grill'], TODAY).ok).toBe(false);
    expect(packTask(TODAY, U('wszyscy'))!.packKind).toBe('bag');
    expect(packTask(TODAY, U('andrzejki'))!.items!.length).toBe(7);
    expect(packTask(TODAY, U('tlusty'))).toBeNull();
  });

  it('в DOM: тап по предметам, счётчик, «Gotowe» отдаёт массив id; без выбора кнопка заблокирована; разметка подсвечивает ответ', () => {
    const t = packTask(TODAY, U('wielkanoc'))!;
    const { panel, sent } = mkPanel();
    game.render(t, panel, TODAY);
    const cards = [...panel.body.querySelectorAll<HTMLButtonElement>('[data-item]')];
    expect(cards.length).toBe(9);
    const done = panel.foot.querySelector<HTMLButtonElement>('[data-check]')!;
    expect(done.disabled).toBe(true);
    for (const id of t.expect!) cards.find((c) => c.dataset.item === id)!.click();
    expect(done.disabled).toBe(false);
    expect(panel.body.querySelector('[data-count]')?.textContent).toBe(String(t.expect!.length));
    cards.find((c) => c.dataset.item === 'sw.karp')!.click();
    cards.find((c) => c.dataset.item === 'sw.karp')!.click();
    done.click();
    expect(sent.length).toBe(1);
    expect([...(sent[0] as string[])].sort()).toEqual([...t.expect!].sort());
    expect(cards.filter((c) => c.classList.contains('right')).length).toBe(t.expect!.length);
    expect(game.check(t, sent[0], TODAY).ok).toBe(true);
  });

  it('предметы рисуются иконками: кадр атласа или эмодзи, у каждого есть слово и перевод', () => {
    for (const u of UNITS) {
      const spec = packSpec(u);
      const ids = [...(spec ? [...spec.in, ...spec.out] : []), ...((u.raw.clue as string[]) ?? [])];
      for (const id of ids) {
        const w = itemWord(id);
        expect(w.pl, id).not.toMatch(/^\w+\./);
        expect(w.ru, id).toBeTruthy();
        expect(WORD_FRAME[id] ?? WORD_EMOJI[id], `${id}: ни кадра, ни эмодзи`).toBeTruthy();
      }
    }
  });
});

describe('пожелания и «сам»', () => {
  it('Życzenia: ситуация, плитки из tiles_pl + distract_pl, верная сборка принимается, другой порядок и дистрактор — нет', () => {
    const t = wishTask(TODAY, U('imieniny'), false)!;
    expect(t.self).toBe(true);
    expect(t.q).toBe('Twoja sąsiadka ma imieniny.');
    expect(t.expectTiles).toEqual(['Wszystkiego', 'najlepszego']);
    expect([...t.tiles!].sort()).toEqual(['Wszystkiego', 'najlepszego', 'Wszystko', 'najlepsze'].sort());
    expect(game.check(t, ['Wszystkiego', 'najlepszego'], TODAY)).toMatchObject({ ok: true, say: 'Wszystkiego najlepszego!' });
    expect(game.check(t, ['wszystkiego', 'NAJLEPSZEGO'], TODAY).ok).toBe(true);
    expect(game.check(t, ['najlepszego', 'Wszystkiego'], TODAY).ok).toBe(false);
    expect(game.check(t, ['Wszystko', 'najlepsze'], TODAY).ok).toBe(false);
    const alt = wishTask(TODAY, U('imieniny'), true)!;
    expect(alt.variant).toBe('wish_alt');
    expect(game.check(alt, ['Sto', 'lat'], TODAY).ok).toBe(true);
    expect(wishTask(TODAY, U('majowka'))).toBeNull();
  });

  it('want.self: всегда self-задание; праздник без пожелания — обычай из плиток; с корзинкой — корзинка или пожелание', () => {
    for (const u of UNITS) {
      for (let s = 1; s <= 6; s++) {
        const t = game.nextTask(ctxAt(2026, 10, 18, s), { id: u.id, side: 'B', self: true, stage: 'bush' })!;
        expect(t, u.id).toBeTruthy();
        expect(t.self, u.id).toBe(true);
        expect(t.side).toBe('B');
        if (!u.raw.wish && !packSpec(u)) expect(t.variant).toBe('custom');
        if (u.raw.wish && !packSpec(u)) expect(t.variant).toMatch(/^wish/);
      }
    }
    const c = customTilesTask(TODAY, U('tlusty'))!;
    expect(c.tilesLang).toBe('ru');
    expect(game.check(c, c.expectTiles, TODAY).ok).toBe(true);
    expect([...c.tiles!].length).toBeGreaterThan(c.expectTiles!.length);
  });
});

describe('контракт игры: сторона A/B и self', () => {
  it('сторона A — «Co to za święto?»; B без self — когда/магазины/сцена; праздники без сцены не получают корзинку', () => {
    for (const u of UNITS) {
      const a = game.nextTask(TODAY, { id: u.id, side: 'A', self: false, stage: 'seed' })!;
      expect(a.kind, u.id).toBe('what');
      expect(a.side).toBe('A');
      expect(a.self).toBeUndefined();
      for (let s = 1; s <= 8; s++) {
        const b = game.nextTask(ctxAt(2026, 10, 18, s), { id: u.id, side: 'B', self: false, stage: 'sprout' })!;
        expect(b, u.id).toBeTruthy();
        expect(['when', 'shops', 'pack']).toContain(b.kind);
        expect(b.side).toBe('B');
        expect(b.self).toBeUndefined();
        if (b.kind === 'pack') expect(packSpec(u), u.id).toBeTruthy();
      }
    }
    expect(game.nextTask(TODAY, { id: 'hol.nie_ma', side: 'A', self: false, stage: 'seed' })).toBeNull();
  });

  it('любая единица × любая просьба × несколько дат: задание рисуется, верный ответ засчитан, «___» нет', () => {
    const wants: Omit<Want, 'id'>[] = [
      { side: 'A', self: false, stage: 'seed' },
      { side: 'B', self: false, stage: 'sprout' },
      { side: 'B', self: true, stage: 'bush' },
    ];
    for (const date of [[2026, 10, 18], [2027, 3, 1], [2026, 12, 31], [2028, 4, 16]] as const) {
      for (const u of UNITS) {
        for (const w of wants) {
          const ctx = ctxAt(date[0], date[1], date[2], 5);
          const t = game.nextTask(ctx, { id: u.id, ...w })!;
          expect(t, `${u.id} ${w.side}${w.self ? 'self' : ''}`).toBeTruthy();
          const { panel } = mkPanel();
          game.render(t, panel, ctx);
          expect(panel.body.childElementCount).toBeGreaterThan(0);
          expect(game.check(t, '___', ctx).ok).toBe(false);
          const right = solve(t);
          expect(game.check(t, right, ctx).ok, `${u.id} ${t.kind}/${t.variant}`).toBe(true);
        }
      }
    }
  });

  it('в DOM «Co to za święto?»: варианты — кнопки data-opt, клик отдаёт название; подсказка рисуется иконками', () => {
    const t = whatTask(TODAY, U('wszyscy'), 'clue')!;
    const { panel, sent } = mkPanel();
    game.render(t, panel, TODAY);
    expect(panel.body.querySelectorAll('[data-opt]').length).toBe(4);
    expect(panel.body.querySelectorAll('[data-clue] [data-item]').length).toBe(2);
    expect(panel.body.querySelector('[data-clue] [data-frame="w2_znicz/0"]')).toBeTruthy();
    expect(panel.body.querySelector('[data-clue] [data-frame="w2_fl_chrys/2"]')).toBeTruthy();
    panel.body.querySelector<HTMLElement>('[data-opt="Wszystkich Świętych"]')!.click();
    expect(sent).toEqual(['Wszystkich Świętych']);
  });

  it('реестр берёт нашу игру: id, вход, участок, layout panel', () => {
    const g = GAMES.find((x) => x.id === 'swieta')!;
    expect(g).toBe(game as unknown);
    expect([g.entry, g.plot, g.layout, [...g.kinds]]).toEqual(['seasonBoard', 'klumba', 'panel', ['holiday']]);
  });
});

describe('иконки и атлас', () => {
  it('кадры иконок совпадают с public/atlas/custom.json, размер атласа тот же', () => {
    const a = atlas as unknown as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { size: { w: number; h: number } } };
    expect(a.meta.size).toEqual(ATLAS_SIZE);
    for (const [k, f] of Object.entries(FRAMES)) expect(a.frames[k]!.frame, k).toMatchObject(f);
  });
});

/** Верный ответ на любое задание — по полям задания. */
function solve(t: SwTask): unknown {
  if (t.kind === 'pack') return t.expect;
  if (t.kind === 'wish') return t.expectTiles;
  return t.answer;
}
