// @vitest-environment happy-dom
// Игра «Hymn i symbole»: данные и мелодия, задания на все виды Want, проверка ответов, караоке (пауза без таймера, `?mute=1` без AudioContext),
// сборка флага и герба, раунд через общий движок.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { game, hymnPool } from '../src/games/hymn';
import { beatsOf, configureHymnAudio, melodyContext, noteOf, parseMelody, parsePitch, playNotes, soundAllowed } from '../src/games/hymn/melody';
import { checkTask, cleanGloss, gapText, makeTask, nextLineId, posOf, prevLineId, stanzaOf, type HymnKind, type HymnTask } from '../src/games/hymn/tasks';
import { stopMelody } from '../src/games/hymn/view';
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
  units: s.p.units('hymn'),
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
  configureHymnAudio({ sound: () => false, factory: undefined });
});
afterEach(() => {
  stopMelody();
  document.body.replaceChildren();
  vi.useRealTimers();
  setSearch('');
});

describe('мелодия: данные и ноты', () => {
  const s = mkPolska();
  const doc = s.p.content.docs.hymn;
  const mel = parseMelody(doc);

  it('20 строк, у каждой 2 такта 3/4 (6 долей), темп 116', () => {
    expect(mel.bpm).toBe(116);
    const lines = s.p.units('hymn').filter((u) => u.kind === 'hymn');
    expect(lines.length).toBe(20);
    for (const u of lines) {
      const n = mel.lines.get(u.id);
      expect(n, u.id).toBeTruthy();
      expect(beatsOf(n!), u.id).toBe(6);
    }
  });

  it('мотив: строки 1 и 3 куплета одинаковы, 2 и 4 — свои; в каждой строке только ноты F-dur (с B♭)', () => {
    const k = (id: string): string => JSON.stringify(mel.lines.get(id));
    for (const v of ['s1', 's2', 's3', 's4']) {
      expect(k(`hymn.${v}.1`)).toBe(k('hymn.s1.1'));
      expect(k(`hymn.${v}.3`)).toBe(k('hymn.s1.3'));
      expect(k(`hymn.${v}.1`)).toBe(k(`hymn.${v}.3`));
      expect(k(`hymn.${v}.2`)).toBe(k('hymn.s1.2'));
      expect(k(`hymn.${v}.4`)).toBe(k('hymn.s1.4'));
    }
    const allowed = new Set(['F', 'G', 'A', 'B♭', 'C', 'D', 'E']);
    for (const ns of mel.lines.values()) for (const n of ns) if (n.hz) expect(allowed.has(n.label), n.p).toBe(true);
  });

  it('сверка с нотной записью (Commons «Mazurek Dąbrowskiego Akordy 01», 3/4, F-dur): начало и конец строк', () => {
    const first = (id: string, k: number): string => mel.lines.get(id)!.slice(0, k).map((n) => `${n.p}:${n.d}`).join(' ');
    expect(first('hymn.s1.1', 4)).toBe('A4:0.75 Bb4:0.25 C5:1 C5:1');
    expect(first('hymn.s1.4', 5)).toBe('G4:0.75 G4:0.25 C5:1.5 E4:0.5 G4:1');
    expect(first('hymn.ref.3', 4)).toBe('A4:0.5 C5:0.5 F5:1.5 E5:0.5');
    expect(first('hymn.ref.4', 3)).toBe('C5:0.5 C5:0.5 Bb4:1.5');
    // Строка куплета и припева кончается тоникой F4 и паузой, остальные строки — на своих долях.
    expect(mel.lines.get('hymn.s1.4')!.at(-1)).toMatchObject({ p: 'R', d: 1 });
    expect(mel.lines.get('hymn.ref.2')!.at(-1)).toMatchObject({ p: 'C5', d: 2 });
  });

  it('высота: A4 = 440 Гц, Bb4 ниже B4 на полтона, пауза не звучит', () => {
    expect(parsePitch('A4')!.hz).toBeCloseTo(440, 5);
    expect(parsePitch('Bb4')!.hz).toBeCloseTo(466.16, 1);
    expect(parsePitch('Bb4')!.label).toBe('B♭');
    expect(parsePitch('R')).toBeNull();
    expect(noteOf('R', 1).hz).toBeNull();
  });
});

describe('данные заданий', () => {
  const s = mkPolska();
  const units = s.p.units('hymn');

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

  it('порядок строк: следующая и предыдущая; у конца припева следующей нет', () => {
    expect(nextLineId('hymn.s1.1')).toBe('hymn.s1.2');
    expect(nextLineId('hymn.s2.4')).toBe('hymn.ref.1');
    expect(nextLineId('hymn.ref.3')).toBe('hymn.ref.4');
    expect(nextLineId('hymn.ref.4')).toBeNull();
    expect(prevLineId('hymn.s1.1')).toBeNull();
    expect(prevLineId('hymn.s1.2')).toBe('hymn.s1.1');
    expect(prevLineId('hymn.ref.1', 's2')).toBe('hymn.s2.4');
    expect(prevLineId('hymn.s2.1')).toBe('hymn.ref.4');
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
      for (const u of s.p.units('hymn')) {
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
            stopMelody();
          }
        }
      }
    });
  }

  it('охват видов: пропуск, что дальше, порядок строк и куплетов, плитки, караоке; символы: вопрос, чей, флаг, герб, легенда', () => {
    const want: HymnKind[] = ['gap', 'next', 'order-lines', 'order-stanzas', 'tiles', 'karaoke', 'q', 'whose', 'flag', 'godlo', 'order-lech'];
    expect([...seen].sort()).toEqual(expect.arrayContaining(want.sort()));
  });

  it('решение Шэфа 18.10: у строк гимна нет заданий на перевод (ни в вопросе, ни в вариантах), перевод — справкой после ответа', () => {
    for (const bush of [false, true]) {
      const s = mkPolska(bush);
      for (const u of s.p.units('hymn').filter((x) => x.kind === 'hymn')) {
        for (const w of WANTS) {
          for (let seed = 1; seed <= 6; seed++) {
            const ctx = ctxOf(s, seed * 31);
            const t = makeTask(ctx, { ...w, id: u.id })!;
            expect(['mean', 'gloss', 'line'], `${u.id} ${t.kind}`).not.toContain(t.kind);
            expect(t.lang, `${u.id} ${t.kind}`).toBe('pl');
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

describe('караоке и мелодия', () => {
  /** Поддельный AudioContext: считает созданные осцилляторы. */
  const fakeCtx = () => {
    const made = { ctx: 0, osc: 0, started: 0, stopped: 0 };
    const node = () => ({ connect: () => ({ connect: () => ({}) }), gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    const factory = (): AudioContext => {
      made.ctx++;
      return {
        currentTime: 0,
        state: 'running',
        destination: {},
        resume: () => Promise.resolve(),
        createGain: () => node(),
        createOscillator: () => {
          made.osc++;
          const o = { type: '', frequency: { setValueAtTime() {} }, connect: () => ({ connect: () => ({}) }), start: () => made.started++, stop: () => made.stopped++ };
          return o;
        },
      } as unknown as AudioContext;
    };
    return { made, factory };
  };

  const karaoke = (seed: number) => {
    const s = mkPolska();
    for (let k = 0; k < 60; k++) {
      const ctx = ctxOf(s, seed + k);
      const t = makeTask(ctx, { id: 'hymn.s1.3', side: 'B', self: true, stage: 'bush' })!;
      if (t.kind !== 'karaoke') continue;
      let given: unknown = null;
      const panel = mkPanel((a) => (given = a));
      document.body.append(panel.body);
      game.render(t, panel, ctx);
      return { t, panel, ctx, given: () => given };
    }
    throw new Error('караоке не выпало');
  };

  it('«сам» по строке с мелодией даёт караоке: слова по одному из трёх, контекст — предыдущая строка', () => {
    const { t, panel } = karaoke(1);
    expect(t.steps!.length).toBe(5);
    for (const st of t.steps!) {
      expect(st.options.length).toBe(3);
      expect(st.options).toContain(st.word);
    }
    expect(t.ctxText).toBe('kiedy my żyjemy.');
    expect(panel.body.querySelectorAll('[data-strip]').length).toBe(2);
    expect(panel.body.querySelectorAll('.hy-n').length).toBe(t.ctxNotes!.length + t.notes!.length);
  });

  it('верные слова по одному → ответ массивом; ошибка на слове → сразу ответ с неверным словом', () => {
    const a = karaoke(1);
    const pick = (root: HTMLElement, w: string): void => root.querySelector<HTMLElement>(`[data-opt="${w}"]`)!.click();
    for (const w of a.t.answer as string[]) {
      expect(a.given()).toBeNull();
      pick(a.panel.body, w);
    }
    expect(a.given()).toEqual(a.t.answer);
    expect(game.check(a.t, a.given(), a.ctx).ok).toBe(true);

    const b = karaoke(1);
    const first = (b.t.answer as string[])[0]!;
    pick(b.panel.body, first);
    const wrong = b.t.steps![1]!.options.find((o) => o !== (b.t.answer as string[])[1])!;
    pick(b.panel.body, wrong);
    expect(b.given()).toEqual([first, wrong]);
    expect(game.check(b.t, b.given(), b.ctx).ok).toBe(false);
  });

  it('?mute=1: AudioContext не создаётся даже при включённом звуке; ноты подсвечиваются, прогон кончается паузой и ждёт', () => {
    const { made, factory } = fakeCtx();
    configureHymnAudio({ sound: () => true, factory });
    setSearch('?mute=1');
    expect(soundAllowed()).toBe(false);
    expect(melodyContext()).toBeNull();
    vi.useFakeTimers();
    const { panel, t } = karaoke(1);
    expect(panel.body.querySelector('[data-quiet]')).toBeTruthy();
    panel.body.querySelector<HTMLElement>('[data-play-ctx]')!.click();
    vi.advanceTimersByTime(10);
    expect(panel.body.querySelectorAll('[data-strip="Poprzedni wers"] .hy-n.on').length).toBe(1);
    // Прошли все 6 долей контекста: подсветка снята, первая нота строки-задания мигает и ждёт ответа.
    vi.advanceTimersByTime((6 * 60 * 1000) / 116 + 100);
    expect(panel.body.querySelectorAll('.hy-n.on').length).toBe(0);
    expect(panel.body.querySelector('[data-strip="Ten wers"] .hy-n.wait')).toBeTruthy();
    // Без таймера: время идёт, ответа нет — и никто за Диму не отвечает.
    let submitted = false;
    panel.submit = () => (submitted = true);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(submitted).toBe(false);
    expect(panel.body.querySelector('[data-strip="Ten wers"] .hy-n.wait')).toBeTruthy();
    expect(made.ctx).toBe(0);
    expect(made.osc).toBe(0);
    void t;
  });

  it('звук выключен в настройках: контекст тоже не создаётся', () => {
    const { made, factory } = fakeCtx();
    configureHymnAudio({ sound: () => false, factory });
    vi.useFakeTimers();
    const { panel } = karaoke(1);
    panel.body.querySelector<HTMLElement>('[data-play-line]')!.click();
    vi.advanceTimersByTime(8000);
    expect(made.ctx).toBe(0);
  });

  it('звук разрешён: по тапу создаётся один контекст, на каждую звучащую ноту — осциллятор; смена задания гасит звук', () => {
    const { made, factory } = fakeCtx();
    configureHymnAudio({ sound: () => true, factory });
    vi.useFakeTimers();
    const { panel, t } = karaoke(1);
    expect(made.ctx).toBe(0);
    expect(panel.body.querySelector('[data-quiet]')).toBeNull();
    panel.body.querySelector<HTMLElement>('[data-play-line]')!.click();
    expect(made.ctx).toBe(1);
    expect(made.osc).toBe(t.notes!.filter((n) => n.hz).length);
    expect(made.started).toBe(made.osc);
    // Новое задание: старый прогон останавливает осцилляторы.
    const before = made.stopped;
    const ctx2 = ctxOf(mkPolska());
    game.render(makeTask(ctx2, { id: 'hymn.s1.1', side: 'A', self: false, stage: 'seed' })!, mkPanel(), ctx2);
    expect(made.stopped).toBeGreaterThan(before);
    panel.body.querySelector<HTMLElement>('[data-play-ctx]')!.click();
    expect(made.ctx).toBe(1);
  });

  it('прогон обрывается, если экран перерисован или закрыт', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.append(host);
    const marks: number[] = [];
    const notes = parseMelody(mkPolska().p.content.docs.hymn).lines.get('hymn.s1.1')!;
    playNotes(notes, 116, null, { alive: () => host.isConnected, onNote: (i) => marks.push(i) });
    vi.advanceTimersByTime(300);
    const n = marks.length;
    expect(n).toBeGreaterThan(0);
    host.remove();
    vi.advanceTimersByTime(10_000);
    expect(marks.length).toBeLessThanOrEqual(n + 1);
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
