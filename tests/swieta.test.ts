// @vitest-environment happy-dom
// Игра «Święta»: календарь и Пасха, ближайший праздник по дате, колесо года (узлы, позиции дат, «сегодня», ближайший), карточка знакомства
// (только в первый раз и до вопросов), раунд про один праздник, задания (что за праздник, когда, магазины, корзинка, стол, пожелания),
// проверка ответов, рисование в панели и совпадение иконок с атласом.
import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import atlas from '../public/atlas/custom.json';
import { customChoiceTask, dateChoices, game, maskedCustoms, packSpec, packTask, shopsQuestions, shopsTask, whatTask, whenTask, wishTask, customTilesTask, type SwTask } from '../src/games/swieta';
import { dayNo, easterDay, fmtSpan, inDays, nearestHoliday, nextSpan, seasonalOrder, shortName, spanIn, upcoming, ymdOf } from '../src/games/swieta/calendar';
import { ATLAS_SIZE, FRAMES, WORD_EMOJI, WORD_FRAME, WORD_ICON, itemWord } from '../src/games/swieta/icons';
import { plantIconFrame } from '../src/ui/atlasIcon';
import { GAMES } from '../src/games/registry';
import { forgetSelection, renderHub, nodeItem } from '../src/games/swieta/hub';
import { buildRound, clearSession, slotsOf, startSession, takeTask } from '../src/games/swieta/plan';
import { boldRuns, isFirst, sentences, shopsLine, shortIntro, shownCustoms } from '../src/games/swieta/story';
import { CLASSES, MARK_UNITS, TRACKS, markerOfUnit, parseWheel, placeMarkers, todayAngle, growthOf, type Marker, type WheelNode } from '../src/games/swieta/wheel';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import { mountPolskaGame, NEXT_DELAY_MS } from '../src/ui/polskaGame';
import { ROUND_SIZE } from '../src/ui/roundSummary';
import { testBus } from './helpers';
import { V2, unitsOfGame } from '../src/systems/v2content';
import type { GameCtx, GamePanel, PolskaUnit, UnitInfo, Want } from '../src/types/polska';
import { seeded } from './helpers';

const UNITS = unitsOfGame(V2, 'swieta');
const BY_ID = new Map(UNITS.map((u) => [u.id, u]));
const doc = V2.docs.swieta;
const U = (id: string): PolskaUnit => BY_ID.get(`hol.${id}`)!;

const ctxAt = (y: number, m: number, d: number, seed = 1): GameCtx => {
  const seen = new Set<string>();
  return {
  seen: (id) => seen.has(id),
  markSeen: (id) => void seen.add(id),
  units: UNITS,
  unit: (id) => BY_ID.get(id),
  info: (id) => ({ id, kind: 'holiday', stage: null, planted: false, drops: 0, sides: { A: false, B: false }, selfOk: false, days: 0, harvests: 0, next: '' }) as UnitInfo,
  doc,
  now: () => Date.UTC(y, m - 1, d, 9),
  date: () => ({ y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }),
  rand: seeded(seed),
  };
};
const TODAY = ctxAt(2026, 10, 18);
const day = (y: number, m: number, d: number): number => dayNo(y, m, d);

beforeEach(() => {
  clearSession();
  forgetSelection();
});

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

  it('строка «Najbliższe święto: … za N dni» в итоге раунда; на заданиях баннера нет (он на колесе)', () => {
    for (const side of ['A', 'B'] as const) {
      const t = game.nextTask(TODAY, { id: 'hol.wszyscy', side, self: false, stage: 'seed' })!;
      const { panel } = mkPanel('full');
      game.render(t, panel, TODAY);
      expect(panel.body.querySelector('[data-nearest]')).toBeNull();
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
    // 24.12 — выходной с 2025 года, магазины закрыты (раньше было «до 14:00»); Niedziela Palmowa — торговое воскресенье
    expect(g.answer).toBe('zamknięte');
    expect(g.q).toMatch(/^Dwudziestego czwartego grudnia/);
    expect(shopsTask(TODAY, U('palmowa'))!.answer).toBe('otwarte');
    expect(U('wigilia').raw.shops).toBe('closed');
    expect(U('palmowa').raw.shops).toBe('open');

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
        expect(WORD_FRAME[id] ?? (WORD_ICON[id] && plantIconFrame(WORD_ICON[id])) ?? WORD_EMOJI[id], `${id}: ни кадра, ни мини-предмета`).toBeTruthy();
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
    expect([g.entry, g.plot, g.layout, [...g.kinds]]).toEqual(['seasonBoard', 'klumba', 'full', ['holiday']]);
    expect(typeof g.hub).toBe('function');
  });
});

describe('иконки и атлас', () => {
  it('кадры иконок совпадают с public/atlas/custom.json, размер атласа тот же', () => {
    const a = atlas as unknown as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { size: { w: number; h: number } } };
    expect(a.meta.size).toEqual(ATLAS_SIZE);
    for (const [k, f] of Object.entries(FRAMES)) expect(a.frames[k]!.frame, k).toMatchObject(f);
  });
});

// ---------- колесо года ----------

const NODES = parseWheel(doc, UNITS);
const NODE = (id: string): WheelNode => NODES.find((n) => n.id === id)!;
const placeAt = (y: number, m: number, d: number) => placeMarkers(NODES, UNITS, { y, m, d });
const iso = (n: number): string => {
  const x = ymdOf(n);
  return `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
};

describe('данные колеса: 19 праздников колеса + праздники игры', () => {
  it('19 узлов из колеса, у каждого картина с автором и лицензией, файл лежит в public/swieta, справка RU и PL', () => {
    const wheel = NODES.filter((n) => n.img);
    expect(wheel.length).toBe(19);
    for (const n of wheel) {
      expect(existsSync(`public/swieta/${n.img}`), n.id).toBe(true);
      expect(n.credit?.author, n.id).toBeTruthy();
      expect(n.credit?.license, n.id).toBeTruthy();
      expect(n.credit?.page, n.id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(n.intro?.ru.length, n.id).toBeGreaterThan(0);
      expect(n.intro?.pl.length, n.id).toBeGreaterThan(0);
      expect(CLASSES).toContain(n.cls);
    }
  });

  it('все 22 праздника игры достижимы с колеса, id единиц не потеряны; без пары в колесе — только справка', () => {
    const covered = new Set(NODES.map((n) => n.unit).filter(Boolean));
    for (const u of UNITS) expect(covered.has(u.id), u.id).toBe(true);
    expect(UNITS.length).toBe(22);
    expect(NODES.filter((n) => !n.unit).map((n) => n.id).sort()).toEqual(['1-sierpnia', '11-listopada', 'popielec']);
    // Три майских дня колеса идут одной единицей majówka; картина не про неё.
    expect(['1-maja', '2-maja', '3-maja'].map((id) => [NODE(id).unit, NODE(id).pic])).toEqual([['hol.majowka', false], ['hol.majowka', false], ['hol.majowka', false]]);
    expect(NODE('15-sierpnia').unit).toBe('hol.zielna');
    expect(NODE('1-listopada').pic).toBe(true);
  });

  it('значок есть у каждого узла: кадр атласа или мини-предмет', () => {
    for (const n of NODES) {
      const id = nodeItem(n, n.unit ? BY_ID.get(n.unit)! : null);
      expect(WORD_FRAME[id] ?? (WORD_ICON[id] && plantIconFrame(WORD_ICON[id])), `${n.id}: ${id}`).toBeTruthy();
    }
  });
});

describe('колесо: позиции дат, «сегодня», ближайший', () => {
  it('26 датированных значков и «Imieniny» без даты; Новый год наверху, угол по дню года', () => {
    const { placed, undated } = placeAt(2026, 10, 18);
    expect(placed.length).toBe(26);
    expect(undated.map((n) => n.unit)).toEqual(['hol.imieniny']);
    const m = (id: string): Marker => placed.find((x) => x.node.id === id)!;
    expect(m('nowy-rok').angle).toBeCloseTo((0.5 / 365) * 360, 5);
    expect(m('1-listopada').doy).toBe(305);
    expect(m('1-listopada').angle).toBeCloseTo((304.5 / 365) * 360, 5);
    expect(m('wigilia').angle).toBeGreaterThan(m('11-listopada').angle);
    // Високосный год: 1 ноября — 306-й день из 366.
    const leap = placeAt(2028, 10, 18).placed.find((x) => x.node.id === '1-listopada')!;
    expect(leap.doy).toBe(306);
    expect(leap.angle).toBeCloseTo((305.5 / 366) * 360, 5);
  });

  it('подвижные праздники сдвигаются с Пасхой: в 2027 Wielkanoc 28.03, в 2028 — 16.04', () => {
    const e27 = placeAt(2027, 1, 10).placed.find((x) => x.node.id === 'wielkanoc')!;
    const e28 = placeAt(2028, 1, 10).placed.find((x) => x.node.id === 'wielkanoc')!;
    expect(iso(e27.span!.start)).toBe('2027-03-28');
    expect(iso(e28.span!.start)).toBe('2028-04-16');
    expect(e28.angle).toBeGreaterThan(e27.angle);
    expect(placeAt(2027, 1, 10).placed.find((x) => x.node.id === 'tlusty')!.span!.start).toBe(easterDay(2027) - 52);
  });

  it('стрелка «сегодня» по дню года', () => {
    expect(todayAngle({ y: 2026, m: 1, d: 1 })).toBeCloseTo((0.5 / 365) * 360, 5);
    expect(todayAngle({ y: 2026, m: 10, d: 18 })).toBeCloseTo((290.5 / 365) * 360, 5);
    expect(todayAngle({ y: 2028, m: 12, d: 31 })).toBeCloseTo((365.5 / 366) * 360, 5);
  });

  it('ближайший: 18.10 — Wszystkich Świętych через 14 дней; 2 мая — majówka идёт, метка 2 мая; после Рождества — Новый год', () => {
    const near = markerOfUnit(placeAt(2026, 10, 18).placed, 'hol.wszyscy')!;
    expect(near.days).toBe(14);
    expect(markerOfUnit(placeAt(2027, 5, 2).placed, 'hol.majowka')!.node.id).toBe('2-maja');
    expect(markerOfUnit(placeAt(2027, 5, 2).placed, 'hol.majowka')!.days).toBe(0);
    expect(markerOfUnit(placeAt(2026, 12, 28).placed, 'hol.nowy_rok')!.days).toBeLessThanOrEqual(4);
  });

  it('значки не налезают друг на друга и сидят на дорожках внутри кольца месяцев', () => {
    for (const [y, m, d] of [[2026, 10, 18], [2027, 3, 29], [2028, 4, 16], [2029, 1, 1]] as const) {
      const { placed } = placeAt(y, m, d);
      let min = Infinity;
      for (let i = 0; i < placed.length; i++) {
        expect(TRACKS).toContain(placed[i]!.r);
        expect(Math.hypot(placed[i]!.x, placed[i]!.y)).toBeCloseTo(placed[i]!.r, 5);
        for (let j = i + 1; j < placed.length; j++) min = Math.min(min, Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y));
      }
      expect(min, `${y}-${m}-${d}`).toBeGreaterThan(MARK_UNITS * 0.8);
    }
  });
});

// ---------- справка и первый раз ----------

describe('справка знакомства', () => {
  it('2–4 предложения; польские слова латиницей жирным, римские цифры нет', () => {
    for (const n of NODES) {
      if (!n.intro) continue;
      const k = sentences([shortIntro(n.intro.ru)]).length;
      expect(k, n.id).toBeGreaterThanOrEqual(2);
      expect(k, n.id).toBeLessThanOrEqual(4);
    }
    const runs = boldRuns('Ночь называется Sylwester, по имени папы Сильвестра I. Урбан IV. Час W. Крест K+M+B над дверью');
    expect(runs.filter((r) => r.b).map((r) => r.t)).toEqual(['Sylwester', 'K+M+B']);
    expect(boldRuns('просто по-русски')).toEqual([{ t: 'просто по-русски', b: false }]);
  });

  it('магазины строкой: из заметки данных, иначе из shops; первый раз — нет ответов по единице', () => {
    expect(shopsLine(U('wigilia'))!.ru).toMatch(/закрыты/);
    expect(shopsLine(U('wigilia'))!.pl).toBe('W Wigilię sklepy są zamknięte.');
    expect(shopsLine(U('palmowa'))!.ru).toMatch(/открыты/);
    expect(shopsLine(U('palmowa'))!.pl).toBe('Niedziela handlowa: sklepy są otwarte.');
    expect(shopsLine(U('wszyscy'))!.pl).toBe('Sklepy są zamknięte.');
    // «Первый раз» = нет флага «знакомство принято» (а не «нет ответов»): ответы без флага карточку не отменяют.
    const c = ctxAt(2026, 10, 18);
    const answered: GameCtx = { ...c, info: (id) => ({ ...c.info(id), answers: 5 }) };
    expect(isFirst(answered, 'hol.wszyscy')).toBe(true);
    c.markSeen('hol.wszyscy');
    expect(isFirst(c, 'hol.wszyscy')).toBe(false);
    expect(isFirst(c, 'hol.wigilia')).toBe(true);
    expect(growthOf({ ...TODAY.info('hol.wszyscy'), planted: true, stage: 'sprout' })).toBe('sprout');
    expect(growthOf({ ...TODAY.info('hol.wszyscy'), harvests: 1 })).toBe('ripe');
  });
});

describe('раунд про один праздник', () => {
  it('3–6 заданий, все про этот праздник, решаются и рисуются; в раунде есть задание «сам»', () => {
    for (const u of UNITS) {
      const node = NODES.find((n) => n.unit === u.id && n.pic) ?? NODES.find((n) => n.unit === u.id)!;
      for (const first of [true, false]) {
        for (let seed = 1; seed <= 4; seed++) {
          const ctx = ctxAt(2026, 10, 18, seed);
          const tasks = buildRound(ctx, u, node, first);
          expect(tasks.length, `${u.id} ${first}`).toBeGreaterThanOrEqual(3);
          expect(tasks.length).toBeLessThanOrEqual(6);
          expect(tasks.every((t) => t.id === u.id)).toBe(true);
          expect(tasks.some((t) => t.self), `${u.id}: нет «сам»`).toBe(true);
          expect(tasks.some((t) => t.side === 'A') && tasks.some((t) => t.side === 'B')).toBe(true);
          for (const t of tasks) {
            expect(game.check(t, solve(t), ctx).ok, `${u.id} ${t.kind}/${t.variant}`).toBe(true);
            const { panel } = mkPanel('full');
            game.render(t, panel, ctx);
            expect(panel.body.querySelector('[data-q]')).toBeTruthy();
          }
        }
      }
    }
  });

  it('первый раз: картина (или предмет) → когда → обычай из карточки; обычаи и пожелание — те, что показаны', () => {
    const u = U('wszyscy');
    const tasks = buildRound(TODAY, u, NODE('1-listopada'), true);
    expect(tasks.map((t) => `${t.kind}/${t.variant}`).slice(0, 3)).toEqual(['what/pic', 'when/date', 'custom/custom']);
    expect(tasks[0]!.pic).toMatchObject({ img: '1-listopada.jpg' });
    const customs = (u.raw.customs as { pl: string }[]).slice(0, 3).map((c) => c.pl);
    expect(customs).toContain(tasks[2]!.answer);
    expect(tasks[tasks.length - 1]!.self).toBe(true);
    // Без картины (картина про соседний праздник) — по предмету.
    const maj = buildRound(TODAY, U('majowka'), NODE('1-maja'), true);
    expect(maj[0]!.variant).toBe('clue');
    expect(shownCustoms(u)).toEqual([0, 1, 2]);
  });

  it('позже: картина, предмет, обычай или дата + обычай + «вспомнить» + «сам»; слотов хватает каждому празднику', () => {
    for (const u of UNITS) {
      const node = NODES.find((n) => n.unit === u.id) ?? null;
      expect(slotsOf(TODAY, u, node).length, u.id).toBeGreaterThanOrEqual(5);
    }
  });

  it('очередь раунда: задания по одному, потом обычное по просьбе движка', () => {
    const tasks = buildRound(TODAY, U('wszyscy'), NODE('1-listopada'), true);
    startSession('hol.wszyscy', tasks);
    expect(takeTask('hol.zaduszki')).toBeNull();
    const got = tasks.map(() => game.nextTask(TODAY, { id: 'hol.wszyscy', side: 'A', self: false, stage: 'seed' })!);
    expect(got.map((t) => `${t.kind}/${t.variant}`)).toEqual(tasks.map((t) => `${t.kind}/${t.variant}`));
    expect(game.nextTask(TODAY, { id: 'hol.wszyscy', side: 'A', self: false, stage: 'seed' })!.kind).toBe('what');
  });

  it('обычай «по-русски → по-польски»: верное предложение среди четырёх разных, подпись и проверка', () => {
    for (const u of UNITS) {
      const t = customChoiceTaskOf(u);
      expect(t.options!.length, u.id).toBeGreaterThanOrEqual(3);
      expect(new Set(t.options).size).toBe(t.options!.length);
      expect(t.options).toContain(t.answer);
      expect(t.qLang).toBe('ru');
      expect(game.check(t, t.answer, TODAY).ok).toBe(true);
      expect(game.check(t, t.options!.find((o) => o !== t.answer), TODAY).ok).toBe(false);
    }
  });
});

const customChoiceTaskOf = (u: PolskaUnit): SwTask => customChoiceTask(TODAY, u)!;

// ---------- экран колеса и движок ----------

function mkHub(ctx: GameCtx = TODAY, answers = 0) {
  const begun: [string, number][] = [];
  const body = document.createElement('div');
  const foot = document.createElement('div');
  const spoken: string[] = [];
  const panel: GamePanel = { body, foot, layout: 'full', submit: () => {}, say: (t) => spoken.push(t), rand: seeded(2) };
  const c: GameCtx = { ...ctx, info: (id) => ({ ...ctx.info(id), answers }), seen: answers > 0 ? () => true : ctx.seen };
  renderHub(panel, c, (id, size) => begun.push([id, size]));
  return { body, foot, begun, spoken, panel };
}

describe('экран колеса', () => {
  it('рисует 12 месяцев, стрелку «сегодня», значки; ближайший подсвечен и выбран по умолчанию', () => {
    const { body } = mkHub();
    expect(body.querySelectorAll('svg text').length).toBeGreaterThanOrEqual(12);
    expect(body.querySelector('[data-today-label]')!.textContent).toBe('dziś 18.10');
    expect(body.querySelector('[data-hand]')).toBeTruthy();
    expect(body.querySelectorAll('.sw-mk').length).toBe(26);
    expect(body.querySelector('.sw-mk.near')!.getAttribute('data-node')).toBe('1-listopada');
    expect(body.querySelector('.sw-mk.sel')!.getAttribute('data-node')).toBe('1-listopada');
    expect(body.querySelector('[data-nearest-text]')!.textContent).toBe('Najbliższe święto: Wszystkich Świętych za 14 dni');
    expect(body.querySelector('[data-sel-name]')!.textContent).toBe('Wszystkich Świętych');
    expect(body.querySelector('[data-undated]')).toBeTruthy();
    // тип праздника цветом
    const cls = (id: string): string => body.querySelector<HTMLElement>(`[data-node="${id}"]`)!.getAttribute('data-class')!;
    expect([cls('3-maja'), cls('1-listopada'), cls('andrzejki')]).toEqual(['state', 'rel', 'folk']);
  });

  it('по умолчанию — ближайший из ещё не выращенных', () => {
    const grown = (id: string) => ({ ...TODAY.info(id), harvests: id === 'hol.wszyscy' ? 1 : 0, planted: true });
    const { body } = mkHub({ ...TODAY, info: grown });
    expect(body.querySelector('.sw-mk.sel')!.getAttribute('data-node')).toBe('zaduszki');
    expect(body.querySelector('.sw-mk.near')!.getAttribute('data-node')).toBe('1-listopada');
  });

  it('тап по значку выбирает праздник; у праздника без единицы нет вопросов, только справка', () => {
    const { body, foot } = mkHub(TODAY, 3);
    body.querySelector<HTMLElement>('[data-node="andrzejki"]')!.click();
    expect(body.querySelector('[data-sel-name]')!.textContent).toBe('Andrzejki');
    expect(foot.querySelector('[data-play]')).toBeTruthy();
    body.querySelector<HTMLElement>('[data-node="popielec"]')!.click();
    expect(body.querySelector('[data-sel-name]')!.textContent).toBe('Środa Popielcowa');
    expect(foot.querySelector('[data-play]')).toBeNull();
    expect(foot.querySelector('[data-info]')).toBeTruthy();
  });

  it('первый раз: кнопка «Poznaj», карточка с картиной, подписью автора, справкой, обычаями и пожеланием — до всяких вопросов', () => {
    const { body, foot, begun, spoken } = mkHub(TODAY, 0);
    expect(foot.querySelector('[data-play]')).toBeNull();
    foot.querySelector<HTMLElement>('[data-poznaj]')!.click();
    expect(begun).toEqual([]);
    const card = body.querySelector('[data-card="intro"]')!;
    expect(card).toBeTruthy();
    expect(card.querySelector('[data-pic="1-listopada.jpg"]')).toBeTruthy();
    expect(card.querySelector('[data-credit]')!.textContent).toMatch(/© Marek Ślusarczyk.*CC BY 3\.0/);
    expect(card.querySelector('[data-credit] a')!.getAttribute('href')).toMatch(/commons\.wikimedia\.org/);
    expect(card.querySelector('[data-card-name]')!.textContent).toBe('Wszystkich Świętych');
    expect(card.querySelector('[data-about-ru] b')!.textContent).toBe('chryzantemy');
    expect(card.querySelectorAll('[data-customs] .sw-row').length).toBe(3);
    expect(card.querySelector('[data-shops]')).toBeTruthy();
    // справка знакомства — «О празднике»: польские предложения по одному, у каждого своя 🔊; истории (intro) в первой карточке нет, повторов нет
    expect(card.querySelector('[data-intro]')).toBeNull();
    expect(card.querySelectorAll('[data-about-pl] .pq-say').length).toBe(3);
    card.querySelector<HTMLElement>('[data-about-pl] .pq-say')!.click();
    expect(spoken).toEqual(['Cała Polska odwiedza groby bliskich.']);
    foot.querySelector<HTMLElement>('[data-start]')!.click();
    expect(begun.length).toBe(1);
    expect(begun[0]![0]).toBe('hol.wszyscy');
    expect(begun[0]![1]).toBeGreaterThanOrEqual(3);
    expect(begun[0]![1]).toBeLessThanOrEqual(6);
    // раунд собран заранее, первый вопрос — по картине из карточки
    expect((game.nextTask(TODAY, { id: 'hol.wszyscy', side: 'A', self: false, stage: 'seed' }) as SwTask).variant).toBe('pic');
  });

  it('не первый раз: карточки нет, «Graj» сразу начинает раунд; справка открывается кнопкой «ℹ» и возвращает к колесу', () => {
    const { body, foot, begun } = mkHub(TODAY, 5);
    expect(foot.querySelector('[data-poznaj]')).toBeNull();
    foot.querySelector<HTMLElement>('[data-info]')!.click();
    expect(body.querySelector('[data-card="info"]')).toBeTruthy();
    expect(body.querySelector('[data-phrase]')).toBeTruthy();
    expect(begun).toEqual([]);
    foot.querySelector<HTMLElement>('[data-back]')!.click();
    expect(body.querySelector('[data-wheel]')).toBeTruthy();
    foot.querySelector<HTMLElement>('[data-play]')!.click();
    expect(begun.length).toBe(1);
    expect(body.querySelector('[data-card]')).toBeNull();
  });

  it('праздник без картины (значок вместо неё) тоже открывает карточку', () => {
    const { body, foot } = mkHub(TODAY, 0);
    body.querySelector<HTMLElement>('[data-node="mikolajki"]')!.click();
    foot.querySelector<HTMLElement>('[data-poznaj]')!.click();
    const card = body.querySelector('[data-card="intro"]')!;
    expect(card.querySelector('[data-pic]')).toBeNull();
    expect(card.querySelector('[data-customs]')).toBeTruthy();
    expect(card.querySelector('[data-wish]')).toBeTruthy();
  });
});

describe('«О празднике» (about): данные, колесо, карточка', () => {
  const sw = V2.docs.swieta.wheel as { id: string; about?: { ru: string; pl: string[]; key: string[] } }[];
  const mkBusHub = (ctx: GameCtx = TODAY, answers = 5) => {
    const bus = testBus();
    const heard: string[] = [];
    bus.on('audio:play', (p) => heard.push(p.text ?? ''));
    const body = document.createElement('div');
    const foot = document.createElement('div');
    const panel: GamePanel = { body, foot, layout: 'full', submit: () => {}, say: (t) => bus.emit('audio:play', { text: t }), rand: seeded(2) };
    renderHub(panel, { ...ctx, info: (id) => ({ ...ctx.info(id), answers }), seen: answers > 0 ? () => true : ctx.seen }, () => {});
    return { body, foot, heard };
  };

  it('у каждого из 27 узлов есть about: RU ≤ 380 знаков и 3–4 предложения, PL 2–3 предложения, key встречаются в RU', () => {
    expect(sw.length).toBe(27);
    for (const n of sw) {
      const a = n.about!;
      expect(a, n.id).toBeTruthy();
      expect(a.ru.length, n.id).toBeLessThanOrEqual(380);
      expect(sentences([a.ru]).length, n.id).toBeGreaterThanOrEqual(3);
      expect(sentences([a.ru]).length, n.id).toBeLessThanOrEqual(5);
      expect(a.pl.length, n.id).toBeGreaterThanOrEqual(2);
      expect(a.pl.length, n.id).toBeLessThanOrEqual(3);
      for (const x of a.pl) expect(/[а-яё]/i.test(x), `${n.id}: ${x}`).toBe(false);
      expect(a.key.length, n.id).toBeGreaterThan(0);
      for (const k of a.key) expect(a.ru, n.id).toContain(k);
    }
    for (const n of NODES) expect(n.about, n.id).toBeTruthy();
  });

  it('в карточке выбранного праздника на колесе блок «О празднике»: RU с жирными польскими словами и польские предложения', () => {
    const { body } = mkBusHub();
    const box = body.querySelector('[data-sel] [data-about]')!;
    expect(box).toBeTruthy();
    expect(box.querySelector('[data-about-ru]')!.textContent).toMatch(/^1 ноября/);
    expect([...box.querySelectorAll('[data-about-ru] b')].map((b) => b.textContent)).toEqual(['chryzantemy', 'znicze']);
    expect([...box.querySelectorAll('[data-about-sentence]')].map((x) => x.textContent)).toEqual([
      'Cała Polska odwiedza groby bliskich.',
      'Na grobach stoją chryzantemy i znicze.',
      'Sklepy są w ten dzień zamknięte.',
    ]);
  });

  it('у каждого узла колеса блок показывается, и 🔊 каждого польского предложения шлёт audio:play с этим предложением (русский — без кнопки)', () => {
    const { body, heard } = mkBusHub();
    for (const n of NODES) {
      body.querySelector<HTMLElement>(`[data-node="${n.id}"]`)!.click();
      const box = body.querySelector('[data-sel] [data-about]')!;
      expect(box, n.id).toBeTruthy();
      expect(box.querySelector('[data-about-ru] .pq-say'), n.id).toBeNull();
      const sentencesPl = [...box.querySelectorAll('[data-about-sentence]')].map((x) => x.textContent!);
      expect(sentencesPl, n.id).toEqual(n.about!.pl);
      const btns = [...box.querySelectorAll<HTMLElement>('[data-about-pl] .pq-say')];
      expect(btns.length, n.id).toBe(n.about!.pl.length);
      heard.length = 0;
      btns.forEach((b) => b.click());
      expect(heard, n.id).toEqual(n.about!.pl);
    }
  });

  it('на узком экране блок свёрнут и разворачивается кнопкой «Подробнее»; выбор другого праздника сворачивает; чистый вид не сломан', () => {
    const { body } = mkBusHub();
    const hub = body.querySelector<HTMLElement>('[data-hub]')!;
    const box = () => body.querySelector<HTMLElement>('[data-sel] [data-about]')!;
    expect(box().classList.contains('open')).toBe(false);
    expect(hub.classList.contains('about-open')).toBe(false);
    const more = box().querySelector<HTMLElement>('[data-about-more]')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    expect(box().classList.contains('open')).toBe(true);
    expect(hub.classList.contains('about-open')).toBe(true);
    expect(box().querySelector('[data-about-more]')!.getAttribute('aria-expanded')).toBe('true');
    box().querySelector<HTMLElement>('[data-about-more]')!.click();
    expect(box().classList.contains('open')).toBe(false);
    box().querySelector<HTMLElement>('[data-about-more]')!.click();
    body.querySelector<HTMLElement>('[data-node="andrzejki"]')!.click();
    expect(box().classList.contains('open')).toBe(false);
    expect(hub.classList.contains('about-open')).toBe(false);
    expect(body.querySelector('[data-wheel]')).toBeTruthy();
  });

  it('карточка «Poznaj święto»: about целиком и без повтора истории; в «ℹ Справка» история (intro) идёт ниже about', () => {
    const first = mkBusHub(ctxAt(2026, 10, 18), 0);
    first.foot.querySelector<HTMLElement>('[data-poznaj]')!.click();
    const card = first.body.querySelector('[data-card="intro"]')!;
    const about = card.querySelector('[data-about]')!;
    expect(about.classList.contains('full')).toBe(true);
    expect(about.querySelector('[data-about-more]')).toBeNull();
    expect(card.querySelector('[data-intro]')).toBeNull();
    const second = mkBusHub(TODAY, 5);
    second.foot.querySelector<HTMLElement>('[data-info]')!.click();
    const info = second.body.querySelector('[data-card="info"]')!;
    expect(info.querySelector('[data-about]')).toBeTruthy();
    expect(info.querySelector('[data-intro]')).toBeTruthy();
    const order = [...info.querySelectorAll('[data-about], [data-intro]')].map((x) => (x.hasAttribute('data-about') ? 'about' : 'intro'));
    expect(order).toEqual(['about', 'intro']);
    expect(info.querySelector('[data-about-ru]')!.textContent).not.toBe(info.querySelector('[data-intro]')!.textContent);
    // 🔊 в карточке тоже шлёт audio:play
    info.querySelector<HTMLElement>('[data-about-pl] .pq-say')!.click();
    expect(second.heard).toEqual(['Cała Polska odwiedza groby bliskich.']);
  });

  it('польские предложения about не повторяют обычаи, заметку о магазинах, пожелание и историю того же праздника', () => {
    for (const n of NODES) {
      const u = n.unit ? BY_ID.get(n.unit) : undefined;
      const seen = new Set<string>([...(n.intro?.pl ?? [])]);
      if (u) {
        for (const c of (u.raw.customs as { pl: string }[] | undefined) ?? []) seen.add(c.pl);
        const sn = u.raw.shops_note as { pl?: string } | undefined;
        if (sn?.pl) seen.add(sn.pl);
        const w = u.raw.wish as { pl?: string } | undefined;
        if (w?.pl) seen.add(w.pl);
      }
      for (const s of n.about!.pl) expect(seen.has(s), `${n.id}: ${s}`).toBe(false);
      expect(new Set(n.about!.pl).size, n.id).toBe(n.about!.pl.length);
    }
  });

  it('about не противоречит магазинам: Wigilia — закрыты, Niedziela Palmowa — открыты', () => {
    const wg = NODES.find((n) => n.id === 'wigilia')!.about!;
    const pm = NODES.find((n) => n.id === 'palmowa')!.about!;
    expect(wg.ru).toMatch(/выходной, магазины закрыты/);
    expect(wg.pl).toContain('Sklepy są w ten dzień zamknięte.');
    expect(wg.ru + wg.pl.join(' ')).not.toMatch(/14:00|czternast/);
    expect(pm.ru).toMatch(/магазины работают/);
    expect(pm.pl).toContain('Sklepy są w tę niedzielę otwarte.');
    expect(pm.ru + pm.pl.join(' ')).not.toMatch(/закрыты|zamknięte|bez handlu/);
  });

  it('праздник без картины и без истории (Mikołajki) тоже получает about в карточке знакомства', () => {
    const { body, foot } = mkBusHub(ctxAt(2026, 10, 18), 0);
    body.querySelector<HTMLElement>('[data-node="mikolajki"]')!.click();
    foot.querySelector<HTMLElement>('[data-poznaj]')!.click();
    const card = body.querySelector('[data-card="intro"]')!;
    expect(card.querySelector('[data-pic]')).toBeNull();
    expect(card.querySelector('[data-about-ru]')!.textContent).toMatch(/Mikołajki/);
    expect(card.querySelectorAll('[data-about-pl] .pq-say').length).toBe(3);
  });
});

function mkEngine() {
  let t = Date.UTC(2026, 9, 18, 9, 0);
  let save: PolskaSave = newPolskaSave();
  const bus = testBus();
  const p = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => t, tz: () => 0 });
  const root = document.createElement('div');
  const ui = mountPolskaGame(root, { bus, games: GAMES, polska: p, now: () => t, rand: seeded(5), say: () => {} });
  return { p, bus, root, ui, get save() { return save; } };
}

describe('игра: колесо → знакомство → раунд про один праздник → колесо', () => {
  it('открытие даёт колесо, а не задание; карточка только в первый раз; раунд короткий и только про этот праздник', () => {
    const e = mkEngine();
    const autos: string[] = [];
    e.bus.on('polska:auto', (a) => autos.push(`${a.on}:${a.layout}:${a.plot ?? ''}`));
    e.ui.start('swieta');
    expect(autos[0]).toBe('true:full:klumba');
    expect(e.ui.task).toBeNull();
    expect(e.root.querySelector('[data-hub] [data-wheel]')).toBeTruthy();
    expect(e.root.querySelector('[data-round-no]')!.hasAttribute('hidden')).toBe(true);
    e.root.querySelector<HTMLElement>('[data-poznaj]')!.click();
    expect(e.root.querySelector('[data-card="intro"]')).toBeTruthy();
    expect(e.ui.task).toBeNull();
    expect(e.save.garden.log.length).toBe(0);
    e.root.querySelector<HTMLElement>('[data-start]')!.click();
    expect(e.ui.task).toBeTruthy();
    expect(e.p.info('hol.wszyscy').planted).toBe(true);
    vi.useFakeTimers();
    let n = 0;
    const kinds: string[] = [];
    while (e.ui.task && !e.root.querySelector('[data-round-summary]')) {
      const t = e.ui.task as SwTask;
      expect(t.id).toBe('hol.wszyscy');
      kinds.push(`${t.kind}/${t.variant}`);
      expect(e.root.querySelector('[data-round-no]')!.textContent).toMatch(new RegExp(`^${n + 1} / \\d$`));
      e.ui.submit(solve(t));
      vi.advanceTimersByTime(NEXT_DELAY_MS + 10);
      e.root.querySelector<HTMLButtonElement>('[data-next]')!.click();
      n++;
    }
    vi.useRealTimers();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
    expect(n).toBeLessThan(ROUND_SIZE);
    expect(kinds.slice(0, 3)).toEqual(['what/pic', 'when/date', 'custom/custom']);
    expect(e.save.garden.log.length).toBe(n);
    expect(e.save.garden.log.every((a) => a.id === 'hol.wszyscy')).toBe(true);
    // итог: «К колесу»
    const more = e.root.querySelector<HTMLButtonElement>('[data-more]')!;
    expect(more.textContent).toBe('К колесу');
    more.click();
    expect(e.root.querySelector('[data-wheel]')).toBeTruthy();
    expect(e.root.querySelector('.sw-mk.sel')!.getAttribute('data-node')).toBe('1-listopada');
    expect(['seed', 'sprout', 'bush']).toContain(e.root.querySelector('.sw-mk.sel')!.getAttribute('data-growth'));
    // второй раз: карточки нет, раунд сразу
    expect(e.root.querySelector('[data-poznaj]')).toBeNull();
    e.root.querySelector<HTMLElement>('[data-play]')!.click();
    expect((e.ui.task as SwTask).id).toBe('hol.wszyscy');
    expect(e.root.querySelector('[data-card]')).toBeNull();
    e.ui.stop();
    expect(e.ui.isOpen).toBe(false);
  });

  it('раунд про выбранный на колесе праздник; остальные не трогаются', () => {
    const e = mkEngine();
    e.ui.start('swieta');
    e.root.querySelector<HTMLElement>('[data-node="wigilia"]')!.click();
    e.root.querySelector<HTMLElement>('[data-poznaj]')!.click();
    e.root.querySelector<HTMLElement>('[data-start]')!.click();
    expect((e.ui.task as SwTask).id).toBe('hol.wigilia');
    e.ui.submit('неверно');
    expect(e.save.garden.log.map((a) => a.id)).toEqual(['hol.wigilia']);
    e.ui.stop();
  });
});

/** Верный ответ на любое задание — по полям задания. */
function solve(t: SwTask): unknown {
  if (t.kind === 'pack') return t.expect;
  if (t.kind === 'wish') return t.expectTiles;
  return t.answer;
}
