// @vitest-environment happy-dom
// Контролёр v2 (волна 3): общие хуки движка игр о Польше — без автоперехода (19.10), строка итога (`summaryLine`),
// отложенный обход Zagroda после игры во весь экран (`polska:tour`), тихий урожай (`polska:act.quiet`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ICON_FRAME } from '../src/games/daty/model';
import { WORD_EMOJI, WORD_ICON } from '../src/games/swieta/icons';
import { atlasFrame, plantIconFrame } from '../src/ui/atlasIcon';
import { activeDecor, parseDecor } from '../src/systems/decor';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import { V2 } from '../src/systems/v2content';
import { getMap, withDecor } from '../src/world/maps';
import type { BusEvents } from '../src/types/bus';
import type { GameTask, PolskaGame } from '../src/types/polska';
import type { Question } from '../src/systems/quiz';
import { mountMinigame, NEXT_DELAY_MS } from '../src/ui/minigame';
import { mountPolskaGame, NEXT_DELAY_MS as PG_NEXT } from '../src/ui/polskaGame';
import { ROUND_SIZE } from '../src/ui/roundSummary';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 18, 9, 0);

function mk() {
  let save: PolskaSave = newPolskaSave();
  const bus = testBus();
  const p = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
  return { p, bus };
}

/** Игра-заглушка: верный ответ «ok»; `line` — строка итога раунда. */
function fakeGame(layout: 'panel' | 'full', line: string | null = null): PolskaGame {
  return {
    id: 'geo',
    title: { pl: 'Test', ru: 'Тест' },
    desc: '',
    entry: 'map',
    plot: 'sad',
    kinds: ['geo'],
    layout,
    pool: (ctx) => ctx.units.map((u) => u.id),
    nextTask: (_ctx, want) => ({ id: want.id, side: want.side, ...(want.self ? { self: true } : {}) }),
    render: (_t: GameTask, panel) => {
      panel.body.append(document.createElement('div'));
    },
    check: (_t, a) => ({ ok: a === 'ok', correct: 'ok' }),
    ...(line ? { summaryLine: () => line } : {}),
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('движок v2: без автоперехода после верного ответа', () => {
  it('верный ответ сам не листается; «Dalej · Следующий» нажимается после NEXT_DELAY_MS и листает', () => {
    const s = mk();
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountPolskaGame(root, { bus: s.bus, games: [fakeGame('full')], polska: s.p, now: () => NOW, rand: seeded(3), say: () => {} });
    vi.useFakeTimers();
    ui.start('geo');
    const first = ui.task!.id;
    ui.submit('ok');
    vi.advanceTimersByTime(60_000);
    expect(ui.task!.id).toBe(first);
    expect(root.querySelector('[data-feedback]')!.hasAttribute('hidden')).toBe(false);
    const next = root.querySelector<HTMLButtonElement>('[data-next]')!;
    expect(next.textContent).toContain('Следующий');
    vi.advanceTimersByTime(PG_NEXT + 5);
    next.click();
    expect(ui.task!.id).not.toBe(first);
    ui.stop();
  });
});

describe('движок v2: итог раунда и обход', () => {
  it('summaryLine игры — строкой в итоге; игра во весь экран при выходе шлёт polska:tour с подросшими объектами', () => {
    const s = mk();
    const tours: BusEvents['polska:tour'][] = [];
    s.bus.on('polska:tour', (t) => tours.push(t));
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountPolskaGame(root, { bus: s.bus, games: [fakeGame('full', 'Najbliższe święto: Wigilia za 3 dni')], polska: s.p, now: () => NOW, rand: seeded(5), say: () => {} });
    vi.useFakeTimers();
    ui.start('geo');
    for (let i = 0; i < ROUND_SIZE; i++) {
      ui.submit('ok');
      vi.advanceTimersByTime(PG_NEXT + 5);
      root.querySelector<HTMLButtonElement>('[data-next]')!.click();
    }
    expect(root.querySelector('[data-round-summary]')).toBeTruthy();
    expect(root.querySelector('[data-round-line]')!.textContent).toBe('Najbliższe święto: Wigilia za 3 dni');
    // Семечки за 10 верных ответов дали ростки → объекты сада подросли, есть кнопка «Na pole!».
    const go = root.querySelector<HTMLButtonElement>('button[data-round-plot]');
    expect(go).toBeTruthy();
    go!.click();
    expect(ui.isOpen).toBe(false);
    expect(tours).toHaveLength(1);
    expect(tours[0]!.plot).toBe('sad');
    expect(tours[0]!.go).toBe(true);
    expect(tours[0]!.objs.length).toBeGreaterThan(0);
    expect(tours[0]!.objs.every((o) => o.startsWith('sad_'))).toBe(true);
  });

  it('игра в нижней панели обход не шлёт', () => {
    const s = mk();
    const tours: unknown[] = [];
    s.bus.on('polska:tour', (t) => tours.push(t));
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountPolskaGame(root, { bus: s.bus, games: [fakeGame('panel')], polska: s.p, now: () => NOW, rand: seeded(5), say: () => {} });
    vi.useFakeTimers();
    ui.start('geo');
    for (let i = 0; i < 4; i++) {
      ui.submit('ok');
      vi.advanceTimersByTime(PG_NEXT + 5);
      root.querySelector<HTMLButtonElement>('[data-next]')!.click();
    }
    ui.stop();
    expect(tours).toHaveLength(0);
  });
});

describe('тихий урожай: тяжёлые даты', () => {
  it('ответ по дате с harvest: quiet помечает polska:act флагом quiet, обычная дата — нет', () => {
    const s = mk();
    const acts: BusEvents['polska:act'][] = [];
    s.bus.on('polska:act', (a) => acts.push(a));
    s.p.plant(['date.katyn', 'date.konstytucja']);
    s.p.answer({ id: 'date.katyn', side: 'A' }, true);
    s.p.answer({ id: 'date.konstytucja', side: 'A' }, true);
    expect(acts.find((a) => a.id === 'date.katyn')!.quiet).toBe(true);
    expect(acts.find((a) => a.id === 'date.konstytucja')!.quiet).toBeUndefined();
  });
});

describe('украшения мира к датам (swieta.json:decor)', () => {
  const defs = parseDecor((V2.docs.swieta as { decor?: unknown }).decor);
  const on = (y: number, m: number, d: number): string[] => activeDecor(defs, { y, m, d });

  it('знич 1–2.11, ёлка 24.12–6.01 через Новый год, флажки 11.11, пальма за неделю до Пасхи', () => {
    expect(defs.length).toBeGreaterThanOrEqual(10);
    expect(on(2026, 10, 31)).not.toContain('dec.znicze');
    expect(on(2026, 11, 1)).toContain('dec.znicze');
    expect(on(2026, 11, 2)).toContain('dec.znicze');
    expect(on(2026, 11, 3)).not.toContain('dec.znicze');
    expect(on(2026, 11, 11)).toContain('dec.flagi_listopad');
    expect(on(2026, 12, 23)).not.toContain('dec.choinka');
    for (const [y, m, d] of [[2026, 12, 24], [2026, 12, 31], [2027, 1, 1], [2027, 1, 6]] as const) expect(on(y, m, d), `${d}.${m}`).toContain('dec.choinka');
    expect(on(2027, 1, 7)).not.toContain('dec.choinka');
    // Пасха 2027 — 28 марта: пальма 21–27.03, писанки 27–29.03.
    expect(on(2027, 3, 21)).toContain('dec.palma');
    expect(on(2027, 3, 28)).toContain('dec.pisanki');
    expect(on(2027, 3, 28)).not.toContain('dec.palma');
    expect(on(2026, 10, 18)).toEqual([]);
  });

  it('карта с украшениями: объекты с decor стоят только в свой день, у каждого есть спрайт в данных', () => {
    const farm = getMap('farm');
    const decorIds = new Set(defs.map((x) => x.id));
    const props = [...farm.objects, ...getMap('home').objects].filter((o) => o.type === 'prop' && o.decor);
    expect(props.length).toBeGreaterThanOrEqual(6);
    for (const o of props) if (o.type === 'prop') expect(decorIds.has(o.decor!), o.id).toBe(true);
    const plain = withDecor(farm, new Set());
    expect(plain.objects.some((o) => o.type === 'prop' && o.decor)).toBe(false);
    const nov1 = withDecor(farm, new Set(on(2026, 11, 1)));
    expect(nov1.objects.filter((o) => o.type === 'prop' && o.decor === 'dec.znicze')).toHaveLength(3);
    expect(withDecor(getMap('home'), new Set(on(2026, 12, 25))).objects.some((o) => o.type === 'prop' && o.id === 'decor_choinka')).toBe(true);
  });
});

describe('мини-игры v1: поливать нечего посреди раунда', () => {
  it('после 3 ответов вопросы кончились: итог раунда «3 / 3» с подсказкой, а не пустой лист «10 / 10»', () => {
    vi.useFakeTimers();
    const bus = testBus();
    const root = document.createElement('div');
    let left = 3;
    const q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот' };
    const g = mountMinigame(root, { bus, next: () => (left-- > 0 ? q : null), answer: () => ({ ok: true, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот', act: { kind: 'water', xp: 1 } }), say: () => {} });
    g.start(1);
    for (let i = 0; i < 3; i++) {
      root.querySelector<HTMLElement>('[data-opt="кот"]')!.click();
      vi.advanceTimersByTime(NEXT_DELAY_MS + 1);
      root.querySelector<HTMLElement>('[data-next]')?.click();
    }
    expect(root.querySelector('[data-round-summary]')).not.toBeNull();
    expect(root.querySelector('[data-sum-note]')).not.toBeNull();
    expect(root.querySelector('[data-round-no]')!.textContent).toBe(`3 / ${ROUND_SIZE}`);
    g.stop();
  });
});

describe('пиксельные значки вместо эмодзи (Daty, Święta)', () => {
  it('у каждого значка даты и каждого предмета праздников есть кадр атласа', () => {
    for (const u of V2.units.filter((x) => x.kind === 'date')) {
      const name = ICON_FRAME[String(u.raw.icon)];
      expect(name, u.id).toBeTruthy();
      const frame = name!.includes('/') ? name! : plantIconFrame(name!);
      expect(frame && atlasFrame(frame), `${u.id} ${name}`).toBeTruthy();
    }
    for (const [id, name] of Object.entries(WORD_ICON)) expect(atlasFrame(plantIconFrame(name) ?? ''), `${id} → ${name}`).toBeTruthy();
    expect(Object.keys(WORD_EMOJI)).toHaveLength(0);
  });
});

describe('строка итога Daty', () => {
  it('ближайшая памятная дата по календарю игры', async () => {
    const { nearestDateLine } = await import('../src/games/daty');
    const s = mk();
    const ctx = (y: number, m: number, d: number) => ({ units: s.p.units('daty'), unit: (id: string) => s.p.unit(id), info: (id: string) => s.p.info(id), seen: () => true, markSeen: () => {}, doc: s.p.content.docs.daty as Record<string, unknown>, now: () => NOW, date: () => ({ y, m, d, weekday: 0 }), rand: seeded(1) });
    expect(nearestDateLine(ctx(2026, 10, 18))).toBe('Najbliższa data: 11.11 · Święto Niepodległości · za 24 dni');
    expect(nearestDateLine(ctx(2026, 11, 11))).toContain('dziś');
    expect(nearestDateLine(ctx(2026, 12, 20))).toMatch(/^Najbliższa data: \d+\.0[1-3] /);
  });
});

describe('свои слова × вид растения', () => {
  it('«пельмени» растёт пельменем (подпись мини-предмета), «вдохновение» — общим предметом; в банке тот же значок', async () => {
    const { lookOf, framesOf } = await import('../src/systems/plantLook');
    expect(lookOf('w.custom.x1', { pl: 'pielmienie', ru: 'пельмени', pos: 'noun' })).toMatchObject({ type: 'object', icon: 'dumpling' });
    expect(lookOf('w.custom.x2', { pl: 'inspiracja', ru: 'вдохновение', pos: 'noun' })).toMatchObject({ type: 'object', icon: 'cat_misc' });
    expect(framesOf(lookOf('w.custom.x1', { pl: 'pielmienie', ru: 'пельмени', pos: 'noun' })).held).toBe(plantIconFrame('dumpling'));
  });
});
