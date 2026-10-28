// @vitest-environment happy-dom
// Гимн и символы с 26.10 — две игры (hymn, symbole) с общими заданиями: тест гоняет обе на общем контексте.
// Игра «Hymn i symbole»: данные, задания на все виды Want, проверка ответов, «Jaki jest następny wers?» (плитки по предыдущей строке; музыки и нот нет, 22.10),
// сборка флага и герба, раунд через общий движок.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { game, hymnPool } from '../src/games/hymn';
import { checkTask, cleanGloss, gapText, makeTask, nextLineId, posOf, stanzaOf, startCue, type HymnKind, type HymnTask } from '../src/games/hymn/tasks';
import { wordsOf } from '../src/games/kit';
import { GAMES } from '../src/games/registry';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import { newGarden } from '../src/systems/garden';
import type { GameCtx, GamePanel, Want } from '../src/types/polska';
import { mountPolskaGame, NEXT_DELAY_MS } from '../src/ui/polskaGame';
import { ROUND_SIZE } from '../src/ui/roundSummary';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 18, 9, 0);

/** Огород: `bush` — все строки гимна кустиками (для заданий порядка), иначе пустой. */
function mkPolska(bush = false) {
  let save: PolskaSave = newPolskaSave();
  if (bush) {
    const ids = ['hymn.s1.1', 'hymn.s1.2', 'hymn.s1.3', 'hymn.s1.4', 'hymn.ref.1', 'hymn.ref.2', 'hymn.ref.3', 'hymn.ref.4', 'hymn.s2.1', 'hymn.s2.2', 'hymn.s2.3', 'hymn.s2.4'];
    save = { ...save, garden: { ...newGarden(), planted: ids.map((id) => ({ t: NOW, id, start: 'bush' as const })) } };
  }
  const bus = testBus();
  const p = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
  return { p, bus, get save() { return save; } };
}

const ctxOf = (s: ReturnType<typeof mkPolska>, seed = 3): GameCtx => ({
  units: [...s.p.units('hymn'), ...s.p.units('symbole')],
  unit: (id) => s.p.unit(id),
  info: (id) => s.p.info(id),
  seen: () => true,
  markSeen: () => {},
  doc: s.p.content.docs.hymn,
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 18, weekday: 0 }),
  rand: seeded(seed),
});

/** Верный ответ на любое задание. */
function solve(t: HymnTask): unknown {
  return t.answer;
}

const mkPanel = (onSubmit: (a: unknown) => void = () => {}): GamePanel => ({ body: document.createElement('div'), foot: document.createElement('div'), layout: 'panel', submit: onSubmit, say: () => {}, rand: seeded(2) });

const WANTS: Want[] = [
  { id: '', side: 'A', self: false, stage: 'seed' },
  { id: '', side: 'A', self: false, stage: 'bush' },
  { id: '', side: 'B', self: false, stage: 'sprout' },
  { id: '', side: 'B', self: true, stage: 'bush' },
];

const setSearch = (q: string): void => history.replaceState({}, '', `/${q}`);

beforeEach(() => {
  setSearch('');
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  setSearch('');
});

describe('данные заданий', () => {
  const s = mkPolska();
  const units = [...s.p.units('hymn'), ...s.p.units('symbole')];

  it('строки: плитки = слова строки, у пропуска верное слово среди вариантов и в тексте', () => {
    for (const u of units.filter((x) => x.kind === 'hymn')) {
      expect((u.raw.tiles_pl as string[]).join(' ').toLowerCase(), u.id).toBe(wordsOf(u.pl).join(' ').toLowerCase());
      const g = u.raw.gap as { word: string; options: string[] };
      expect(g.options, u.id).toContain(g.word);
      expect(gapText(u.pl, g.word), u.id).toContain('____');
      expect(gapText(u.pl, g.word), u.id).not.toContain('(____');
    }
  });

  it('символы: вопросы с ответом и ≥ 2 дистракторами, плитки = слова факта', () => {
    const syms = units.filter((x) => x.kind === 'symbol');
    expect(syms.length).toBe(19);
    for (const u of syms) {
      const qs = u.raw.questions as { q: string; a: string; wrong: string[] }[];
      expect(qs.length, u.id).toBeGreaterThan(0);
      for (const q of qs) {
        expect(q.wrong.length, u.id).toBeGreaterThanOrEqual(2);
        expect(q.wrong, u.id).not.toContain(q.a);
      }
      if (u.raw.tiles_pl) expect((u.raw.tiles_pl as string[]).join(' ').toLowerCase(), u.id).toBe(wordsOf(u.pl).join(' ').toLowerCase());
    }
  });

  it('порядок строк: следующая и подсказка начала; у конца припева следующей нет', () => {
    expect(nextLineId('hymn.s1.1')).toBe('hymn.s1.2');
    expect(nextLineId('hymn.s2.4')).toBe('hymn.ref.1');
    expect(nextLineId('hymn.ref.3')).toBe('hymn.ref.4');
    expect(nextLineId('hymn.ref.4')).toBeNull();
    expect([startCue('s1'), startCue('ref'), startCue('s2'), startCue('s4')]).toEqual(['Начало гимна', 'Начало припева', 'Начало 2-го куплета', 'Начало 4-го куплета']);
    expect([stanzaOf('hymn.s3.2'), posOf('hymn.s3.2')]).toEqual(['s3', 2]);
    expect(cleanGloss('= przejdziemy, перейдём')).toBe('перейдём');
    expect(cleanGloss('погибла')).toBe('погибла');
  });

  it('посадка: куплет 1 и припев, символы в конце', () => {
    const pool = hymnPool(ctxOf(s));
    expect(pool.slice(0, 8).every((id) => /^hymn\.(s1|ref)\./.test(id))).toBe(true);
    expect(pool.slice(8).every((id) => id.startsWith('symbol.'))).toBe(true);
  });
});

describe('каждая единица: задание на все виды просьб, рисуется, верный ответ засчитан, неверный нет', () => {
  const seen = new Set<HymnKind>();
  for (const bush of [false, true]) {
    it(`все 39 единиц × 4 просьбы × 6 случайностей${bush ? ' (строки кустиками)' : ''}`, () => {
      const s = mkPolska(bush);
      for (const u of [...s.p.units('hymn'), ...s.p.units('symbole')]) {
        for (const w of WANTS) {
          for (let seed = 1; seed <= 6; seed++) {
            const ctx = ctxOf(s, seed * 17);
            const t = makeTask(ctx, { ...w, id: u.id });
            expect(t, `${u.id} ${w.side}${w.self ? ' self' : ''}`).toBeTruthy();
            seen.add(t!.kind);
            expect(t!.id).toBe(u.id);
            expect(t!.side).toBe(w.self ? 'B' : w.side);
            if (w.self) expect(t!.self, u.id).toBe(true);
            else expect(t!.self, u.id).toBeFalsy();
            const panel = mkPanel();
            game.render(t!, panel, ctx);
            expect(panel.body.childElementCount, u.id).toBeGreaterThan(0);
            expect(game.check(t!, solve(t!), ctx).ok, `${u.id} ${t!.kind}`).toBe(true);
            expect(game.check(t!, '___', ctx).ok, `${u.id} ${t!.kind}`).toBe(false);
            expect(checkTask(t!, null).ok).toBe(false);
            if (t!.mode === 'choice') {
              expect(t!.options.length).toBeGreaterThanOrEqual(3);
              expect(t!.options.length).toBeLessThanOrEqual(4);
              expect(new Set(t!.options.map((x) => x.toLowerCase())).size).toBe(t!.options.length);
              expect(t!.options).toContain(t!.answer);
            }
            if (t!.mode === 'order') expect(t!.options.join('|')).not.toBe((t!.answer as string[]).join('|'));
          }
        }
      }
    });
  }

  it('охват видов: пропуск, что дальше, порядок строк и куплетов, плитки; символы: вопрос, чей, флаг, герб, легенда', () => {
    const want: HymnKind[] = ['gap', 'next', 'order-lines', 'order-stanzas', 'tiles', 'q', 'whose', 'flag', 'godlo', 'order-lech'];
    expect([...seen].sort()).toEqual(expect.arrayContaining(want.sort()));
  });

  it('решение Шэфа 18.10: у строк гимна нет заданий на перевод (ни в вопросе, ни в вариантах), перевод — справкой после ответа', () => {
    for (const bush of [false, true]) {
      const s = mkPolska(bush);
      for (const u of [...s.p.units('hymn'), ...s.p.units('symbole')].filter((x) => x.kind === 'hymn')) {
        for (const w of WANTS) {
          for (let seed = 1; seed <= 6; seed++) {
            const ctx = ctxOf(s, seed * 31);
            const t = makeTask(ctx, { ...w, id: u.id })!;
            expect(['mean', 'gloss', 'line'], `${u.id} ${t.kind}`).not.toContain(t.kind);
            // Польский текст — кроме русской подсказки начала («Начало 2-го куплета») в плитках первой строки.
            expect(t.lang, `${u.id} ${t.kind}`).toBe(t.kind === 'tiles' && posOf(u.id) === 1 ? 'ru' : 'pl');
            expect(t.prompt, u.id).not.toBe(u.ru);
            expect(t.options, u.id).not.toContain(u.ru);
            if (Array.isArray(u.raw.gloss) && u.raw.gloss.length) expect(game.check(t, solve(t), ctx).note, u.id).toBeTruthy();
          }
        }
      }
    }
  });

  it('«Что дальше»: верный ответ — следующая строка, дистракторы из гимна; у ref.4 такого задания нет', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    for (let i = 0; i < 40; i++) {
      const t = makeTask(ctxOf(s, i + 1), { id: 'hymn.s1.1', side: 'A', self: false, stage: 'bush' });
      if (t!.kind !== 'next') continue;
      expect(t!.answer).toBe(ctx.unit('hymn.s1.2')!.pl);
      expect(t!.prompt).toBe(ctx.unit('hymn.s1.1')!.pl);
      for (const o of t!.options) expect(ctx.units.some((u) => u.pl === o), o).toBe(true);
    }
    for (let i = 0; i < 40; i++) expect(makeTask(ctxOf(s, i + 1), { id: 'hymn.ref.4', side: 'A', self: false, stage: 'bush' })!.kind).not.toBe('next');
  });

  it('символы: «Czyj to symbol» берёт четыре ответа справочника; герб и флаг — сборка частей', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    const whose = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => makeTask(ctxOf(s, i + 1), { id: 'symbol.syrenka', side: 'A', self: false, stage: 'seed' })!).find((t) => t.kind === 'whose');
    expect(whose && [...whose.options].sort()).toEqual(['Krakowa', 'Polski', 'Puszczy Białowieskiej', 'Warszawy']);
    expect(whose!.answer).toBe('Warszawy');
    const flag = makeTask(ctx, { id: 'symbol.flaga', side: 'B', self: true, stage: 'bush' })!;
    expect([flag.kind, flag.answer]).toEqual(['flag', { top: 'biały', bottom: 'czerwony' }]);
    expect(checkTask(flag, { top: 'czerwony', bottom: 'biały' }).ok).toBe(false);
    const godlo = makeTask(ctx, { id: 'symbol.godlo', side: 'B', self: true, stage: 'bush' })!;
    expect(godlo.answer).toEqual({ field: 'czerwone', eagle: 'biały', crown: 'złota' });
    expect(checkTask(godlo, { field: 'niebieskie', eagle: 'biały', crown: 'złota' }).ok).toBe(false);
  });
});

describe('рендер: сборка флага и герба тап-тап', () => {
  const click = (root: HTMLElement, sel: string): void => root.querySelector<HTMLElement>(sel)!.click();

  it('флаг: два цвета, «Sprawdź» открывается с обоими, отдаёт {top, bottom}', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    const t = makeTask(ctx, { id: 'symbol.flaga', side: 'B', self: true, stage: 'bush' })!;
    let given: unknown = null;
    const panel = mkPanel((a) => (given = a));
    game.render(t, panel, ctx);
    const check = panel.foot.querySelector<HTMLButtonElement>('[data-check]')!;
    expect(check.disabled).toBe(true);
    click(panel.body, '[data-pick="top:biały"]');
    expect(check.disabled).toBe(true);
    click(panel.body, '[data-pick="bottom:czerwony"]');
    expect(check.disabled).toBe(false);
    check.click();
    expect(given).toEqual({ top: 'biały', bottom: 'czerwony' });
    expect(game.check(t, given, ctx).ok).toBe(true);
  });

  it('герб: три части, сброс очищает выбор', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    const t = makeTask(ctx, { id: 'symbol.godlo', side: 'B', self: true, stage: 'bush' })!;
    let given: unknown = null;
    const panel = mkPanel((a) => (given = a));
    game.render(t, panel, ctx);
    for (const p of ['field:czerwone', 'eagle:biały', 'crown:złota']) click(panel.body, `[data-pick="${p}"]`);
    expect(panel.body.querySelector('[data-shield]')!.getAttribute('data-shield')).toBe('czerwone|biały|złota');
    click(panel.foot, '[data-reset]');
    expect(panel.body.querySelector('[data-shield]')!.getAttribute('data-shield')).toBe('||');
    expect(panel.foot.querySelector<HTMLButtonElement>('[data-check]')!.disabled).toBe(true);
    for (const p of ['field:niebieskie', 'eagle:biały', 'crown:złota']) click(panel.body, `[data-pick="${p}"]`);
    click(panel.foot, '[data-check]');
    expect(given).toEqual({ field: 'niebieskie', eagle: 'biały', crown: 'złota' });
    expect(game.check(t, given, ctx).ok).toBe(false);
  });
});

describe('«Jaki jest następny wers?»: собрать следующую строку из плиток', () => {
  const task = (id: string, self: boolean, seed = 1): { t: HymnTask; ctx: GameCtx } => {
    const ctx = ctxOf(mkPolska(), seed);
    return { t: makeTask(ctx, { id, side: 'B', self, stage: 'bush' })!, ctx };
  };

  it('«сам» — плитки: слова строки + 3 лишних; строка перед ней показана польским текстом, заголовок и русская подсказка', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { t, ctx } = task('hymn.s1.3', true, seed);
      expect(t.kind).toBe('tiles');
      expect(t.self).toBe(true);
      expect(t.title).toBe('Jaki jest następny wers?');
      expect(t.hint).toContain('Собери следующую строку');
      expect(t.prompt).toBe(`… ${ctx.unit('hymn.s1.2')!.pl}`);
      expect(t.lang).toBe('pl');
      expect(t.options.length).toBe(wordsOf(ctx.unit('hymn.s1.3')!.pl).length + 3);
      expect(t.answer).toEqual(wordsOf(ctx.unit('hymn.s1.3')!.pl));
    }
    // Без «сам» — одно лишнее слово.
    const plain = task('hymn.s1.3', false).t;
    expect(plain.options.length).toBe((plain.answer as string[]).length + 1);
  });

  it('первая строка куплета, припева и гимна: вместо предыдущей строки русская подсказка начала', () => {
    expect(task('hymn.s1.1', true).t.prompt).toBe('Начало гимна');
    expect(task('hymn.ref.1', true).t.prompt).toBe('Начало припева');
    const s2 = task('hymn.s2.1', true).t;
    expect(s2.prompt).toBe('Начало 2-го куплета');
    expect(s2.lang).toBe('ru');
    expect(s2.title).toBe('Jaki jest pierwszy wers?');
  });

  it('рисуется: заголовок, строка-опора с 🔊 (у польской), каждая плитка звучит при тапе; нот и кнопок мелодии нет', () => {
    const ctx = ctxOf(mkPolska(), 2);
    const t = makeTask(ctx, { id: 'hymn.s1.3', side: 'B', self: true, stage: 'bush' })!;
    const said: string[] = [];
    const panel = mkPanel();
    panel.say = (x) => void said.push(x);
    document.body.append(panel.body);
    game.render(t, panel, ctx);
    expect(panel.body.querySelector('[data-title]')!.textContent).toBe('Jaki jest następny wers?');
    expect(panel.body.querySelector('[data-prompt] .pq-say')).toBeTruthy();
    const tile = panel.body.querySelector<HTMLElement>('[data-tile]')!;
    tile.click();
    expect(said).toEqual([tile.dataset.tile]);
    expect(panel.body.querySelector('[data-strip], .hy-n, [data-play-line], [data-play-ctx], [data-karaoke]')).toBeNull();
    expect(panel.body.textContent).not.toMatch(/Poprzedni|Ten wers|Karaoke/);
  });

  it('верная сборка принята, перестановка нет', () => {
    const { t } = task('hymn.s1.3', true);
    const words = t.answer as string[];
    expect(checkTask(t, [...words]).ok).toBe(true);
    expect(checkTask(t, [...words].reverse()).ok).toBe(false);
  });
});

describe('через общий движок: раунд и выход', () => {
  it('10 заданий гимна и символов с верными ответами; без звука; контекст не падает', () => {
    setSearch('?mute=1');
    const s = mkPolska();
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountPolskaGame(root, { bus: s.bus, games: GAMES, polska: s.p, now: () => NOW, rand: seeded(9), say: () => {} });
    ui.start('hymn');
    // Экран чтения гимна → «Dalej», карточка нового куплета → «Rozumiem».
    root.querySelector<HTMLButtonElement>('[data-hy-go]')!.click();
    root.querySelector<HTMLButtonElement>('[data-understood]')?.click();
    expect(ui.isOpen).toBe(true);
    vi.useFakeTimers();
    const kinds = new Set<string>();
    for (let i = 0; i < ROUND_SIZE; i++) {
      const t = ui.task as HymnTask;
      expect(t, `задание ${i + 1}`).toBeTruthy();
      kinds.add(t.kind);
      ui.submit(solve(t));
      expect(root.querySelector('[data-feedback]')!.getAttribute('data-feedback'), t.kind).toBe('ok');
      vi.advanceTimersByTime(NEXT_DELAY_MS + 10);
      root.querySelector<HTMLButtonElement>('[data-next]')!.click();
    }
    vi.useRealTimers();
    expect(root.querySelector('[data-round-summary]')).toBeTruthy();
    // Строки из дриля (куплет 1) пришли кустиками: первые задания — «сам».
    expect(s.save.garden.log.some((e) => e.self)).toBe(true);
    expect(s.save.garden.log.every((e) => e.ok)).toBe(true);
    ui.stop();
    expect(ui.isOpen).toBe(false);
    root.remove();
  });

  it('движок раньше сажает строки дриля кустиками: первое задание по ним — «сам»', () => {
    const s = mkPolska();
    const ctx = ctxOf(s);
    s.p.autoPlant('hymn', game.pool(ctx));
    for (const id of s.p.content.drillSeed) expect(s.p.info(id).stage, id).toBe('bush');
    const w = s.p.pick('hymn', {});
    expect(w).toMatchObject({ side: 'B', self: true });
  });
});

describe('чтение гимна (27.10: «приходится наугад учить»)', () => {
  const mount = () => {
    const s = mkPolska();
    const root = document.createElement('div');
    document.body.append(root);
    const said: string[] = [];
    const ui = mountPolskaGame(root, { bus: s.bus, games: GAMES, polska: s.p, now: () => NOW, rand: seeded(9), say: (t) => said.push(t) });
    ui.start('hymn');
    return { s, root, ui, said };
  };
  const lines = (root: HTMLElement): string[] => [...root.querySelectorAll('[data-hy-text] [data-line]')].map((x) => x.getAttribute('data-line')!);

  it('перед раундом — текст куплета с транскрипцией, переводом и 🔊; переключатели и вкладки куплетов', () => {
    const { root, ui, said } = mount();
    expect(root.querySelector('[data-hymn-read]')).toBeTruthy();
    expect(ui.task).toBeNull();
    expect(lines(root)).toEqual(['hymn.s1.1', 'hymn.s1.2', 'hymn.s1.3', 'hymn.s1.4']);
    const first = root.querySelector('[data-line="hymn.s1.1"]')!;
    expect(first.querySelector('.pl')!.textContent).toBe('Jeszcze Polska nie zginęła,');
    expect(first.querySelector('.ru')!.textContent).toBe('Ещё Польша не погибла,');
    expect(first.querySelector('.tr')).toBeTruthy();
    first.querySelector<HTMLElement>('[data-saytext]')!.click();
    expect(said).toEqual(['Jeszcze Polska nie zginęła']);
    root.querySelector<HTMLElement>('[data-show-ru]')!.click();
    expect(root.querySelector('[data-hy-text] .ru')).toBeNull();
    root.querySelector<HTMLElement>('[data-stanza="s4"]')!.click();
    expect(lines(root)[0]).toBe('hymn.s4.1');
    ui.stop();
    root.remove();
  });

  it('«Проверь себя» прикрывает строки, тап открывает одну и озвучивает', () => {
    const { root, ui, said } = mount();
    root.querySelector<HTMLElement>('[data-hide]')!.click();
    expect(root.querySelectorAll('.hy-line.hid').length).toBe(4);
    root.querySelector<HTMLElement>('[data-peek="hymn.s1.2"]')!.click();
    expect(root.querySelectorAll('.hy-line.hid').length).toBe(3);
    expect(said.at(-1)).toBe('kiedy my żyjemy.');
    ui.stop();
    root.remove();
  });

  it('«Учить» ведёт раунд только по выбранному куплету; прочитанный куплет без карточки', () => {
    const { root, ui } = mount();
    root.querySelector<HTMLElement>('[data-stanza="ref"]')!.click();
    root.querySelector<HTMLElement>('[data-learn="ref"]')!.click();
    expect(ui.task!.id).toMatch(/^hymn\.ref\./);
    expect(root.querySelector('[data-stanza-card]')).toBeNull();
    ui.stop();
    root.remove();
  });

  it('новый куплет в раунде сначала карточкой целиком, «Rozumiem» → задание', () => {
    const s = mkPolska();
    const ctx = { ...ctxOf(s), seen: () => false };
    const t = makeTask({ ...ctx }, { id: 'hymn.s2.3', side: 'A', self: false, stage: 'seed' })!;
    const panel = mkPanel();
    let seen = 0;
    game.render(t, panel, { ...ctx, markSeen: () => void seen++ });
    const card = panel.body.querySelector('[data-stanza-card="s2"]')!;
    expect(card.querySelectorAll('[data-line]').length).toBe(4);
    expect(card.querySelector('.hy-line.cur')!.getAttribute('data-line')).toBe('hymn.s2.3');
    panel.foot.querySelector<HTMLElement>('[data-understood]')!.click();
    expect(seen).toBe(4);
    expect(panel.body.querySelector('[data-stanza-card]')).toBeNull();
    expect(panel.body.childElementCount).toBeGreaterThan(0);
  });
});
