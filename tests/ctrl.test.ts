// @vitest-environment happy-dom
// Контролёр v2 (волна 3): общие хуки движка игр о Польше — пауза на успех (`panel.hold`), строка итога (`summaryLine`),
// отложенный обход Zagroda после игры во весь экран (`polska:tour`), тихий урожай (`polska:act.quiet`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import type { BusEvents } from '../src/types/bus';
import type { GameTask, PolskaGame } from '../src/types/polska';
import { AUTO_NEXT_MS, mountPolskaGame } from '../src/ui/polskaGame';
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

describe('движок v2: пауза на успех (panel.hold)', () => {
  it('без hold верный ответ листается через AUTO_NEXT_MS; с hold — не раньше, чем просила игра', () => {
    const s = mk();
    const root = document.createElement('div');
    document.body.append(root);
    let panelRef: { hold?: (ms: number) => void } | null = null;
    const g = fakeGame('full');
    g.render = (_t, panel) => {
      panelRef = panel;
      panel.body.append(document.createElement('div'));
    };
    const ui = mountPolskaGame(root, { bus: s.bus, games: [g], polska: s.p, now: () => NOW, rand: seeded(3), say: () => {} });
    vi.useFakeTimers();
    ui.start('geo');
    const first = ui.task!.id;
    ui.submit('ok');
    vi.advanceTimersByTime(AUTO_NEXT_MS + 5);
    expect(ui.task!.id).not.toBe(first);
    const second = ui.task!.id;
    ui.submit('ok');
    panelRef!.hold!(2000);
    vi.advanceTimersByTime(AUTO_NEXT_MS + 5);
    expect(ui.task?.id ?? second).toBe(second);
    expect(root.querySelector('[data-feedback]')!.hasAttribute('hidden')).toBe(false);
    vi.advanceTimersByTime(1200);
    expect(ui.task!.id).not.toBe(second);
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
      vi.advanceTimersByTime(AUTO_NEXT_MS + 5);
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
      vi.advanceTimersByTime(AUTO_NEXT_MS + 5);
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
