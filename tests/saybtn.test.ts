// @vitest-environment happy-dom
// Кнопка 🔊 у каждой польской фразы (просьба Шэфа 19.10, `ui/sayButton.ts`): у польского вопроса и у каждого польского варианта
// в v1 и во всех играх v2; тап шлёт `audio:play` с правильным текстом и НЕ выбирает вариант; у русских — кнопки нет; клавиша G; отзыв.
import { describe, expect, it, vi } from 'vitest';
import { createKeyboardSource } from '../src/input/keyboard';
import { createRouter } from '../src/input/router';
import { GAMES } from '../src/games/registry';
import { createBus } from '../src/systems/bus';
import type { Question } from '../src/systems/quiz';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import type { BusEvents } from '../src/types/bus';
import type { GameCtx, GamePanel, PolskaGameId, Want } from '../src/types/polska';
import { mountMinigame } from '../src/ui/minigame';
import { mountPolskaGame, NEXT_DELAY_MS } from '../src/ui/polskaGame';
import { hasCyrillic, polishPart, sayButton, SLOW_WINDOW_MS, spokenText } from '../src/ui/sayButton';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 18, 9, 0);

function mkPolska() {
  let save: PolskaSave = newPolskaSave();
  const bus = testBus();
  const p = createPolska({ bus, load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
  // Знакомство («Poznaj …») здесь не проверяется: все единицы уже «знакомы».
  for (const u of p.content.units) p.markSeen(u.id);
  return { p, bus };
}
const ctxFor = (s: ReturnType<typeof mkPolska>, g: PolskaGameId, seed = 3): GameCtx => ({
  units: s.p.units(g),
  unit: (id) => s.p.unit(id),
  info: (id) => s.p.info(id),
  seen: (id) => s.p.seen(id),
  markSeen: (id) => s.p.markSeen(id),
  doc: s.p.content.docs[g],
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 18, weekday: 0 }),
  rand: seeded(seed),
});

describe('sayButton: поведение кнопки', () => {
  it('тап озвучивает текст, не всплывает; повторный тап вскоре — медленно, ещё один — снова обычно; aria-label', () => {
    const said: [string, boolean | undefined][] = [];
    const b = sayButton('Co obchodzimy jedenastego listopada?', (t, s) => said.push([t, s]));
    const parent = document.createElement('div');
    let bubbled = 0;
    parent.addEventListener('click', () => bubbled++);
    parent.append(b);
    expect(b.getAttribute('aria-label')).toBe('Озвучить: Co obchodzimy jedenastego listopada?');
    expect(b.hasAttribute('data-nav')).toBe(false);
    b.click();
    b.click();
    b.click();
    expect(said).toEqual([
      ['Co obchodzimy jedenastego listopada?', undefined],
      ['Co obchodzimy jedenastego listopada?', true],
      ['Co obchodzimy jedenastego listopada?', undefined],
    ]);
    expect(bubbled).toBe(0);
  });

  it('после паузы снова обычная скорость', () => {
    vi.useFakeTimers();
    const said: (boolean | undefined)[] = [];
    const b = sayButton('kot', (_t, s) => said.push(s));
    const spy = vi.spyOn(performance, 'now');
    spy.mockReturnValue(1000);
    b.click();
    spy.mockReturnValue(1000 + SLOW_WINDOW_MS + 1);
    b.click();
    expect(said).toEqual([undefined, undefined]);
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('spokenText и polishPart: пропуски, многоточие, русские куски', () => {
    expect(spokenText('… Jeszcze Polska nie zginęła')).toBe('Jeszcze Polska nie zginęła');
    expect(spokenText('Jeszcze Polska ____ zginęła')).toBe('Jeszcze Polska, zginęła');
    expect(polishPart('11 listopada 1918 · Праздник независимости')).toBe('11 listopada 1918');
    expect(polishPart('pono — говорят · jeszcze — ещё')).toBe('pono, jeszcze');
    expect(polishPart('Лишнее: choinka')).toBe('');
    expect(polishPart('Najbliższa data: 11.11 · Święto Niepodległości · za 24 dni')).toBe('Najbliższa data: 11.11, Święto Niepodległości, za 24 dni');
    expect(hasCyrillic('kot')).toBe(false);
    expect(hasCyrillic('кот')).toBe(true);
  });
});

describe('v2: у польского вопроса и каждого польского варианта есть 🔊, у русских нет', () => {
  it('geo, hymn, daty, swieta: вопрос, варианты, карточки; тап по 🔊 озвучивает и не выбирает', () => {
    const stats = { prompts: 0, opts: 0, ruOpts: 0, ruPrompts: 0 };
    for (const g of GAMES) {
      const s = mkPolska();
      for (let seed = 1; seed <= 4; seed++) {
        const ctx = ctxFor(s, g.id, seed);
        const pool = g.pool(ctx);
        const ids = pool.filter((_, i) => i % Math.max(1, Math.floor(pool.length / 24)) === 0);
        for (const id of ids) {
          for (const want of [
            { id, side: 'A', self: false, stage: 'seed' },
            { id, side: 'B', self: false, stage: 'sprout' },
            { id, side: 'B', self: false, stage: 'bush' },
            { id, side: 'B', self: true, stage: 'bush' },
          ] as Want[]) {
            const task = g.nextTask(ctx, want);
            if (!task) continue;
            const said: string[] = [];
            let given: unknown = null;
            const panel: GamePanel = { body: document.createElement('div'), foot: document.createElement('div'), layout: g.layout, submit: (a) => (given = a), say: (t) => said.push(t), rand: seeded(2) };
            document.body.append(panel.body);
            g.render(task, panel, ctx);
            const where = `${g.id} ${id} ${want.side}${want.self ? ' self' : ''}`;
            // Вопрос: польский — с кнопкой, русский — без.
            for (const p of panel.body.querySelectorAll<HTMLElement>('[data-prompt]')) {
              const q = p.querySelector<HTMLElement>('.pq-q')!;
              const hasBtn = !!p.querySelector('.pq-say');
              if (q.lang === 'pl') {
                expect(hasBtn, `${where}: польский вопрос «${q.textContent}» без 🔊`).toBe(true);
                stats.prompts++;
              } else {
                expect(hasBtn, `${where}: у русского вопроса есть 🔊`).toBe(false);
                stats.ruPrompts++;
              }
            }
            // Варианты (кнопки выбора в сетке): польский — в обёртке с 🔊.
            for (const opt of panel.body.querySelectorAll<HTMLElement>('.pq-opts [data-opt]')) {
              const text = opt.dataset.opt!;
              const w = opt.closest('.pq-optw');
              if (hasCyrillic(text)) {
                expect(w, `${where}: русский вариант «${text}» с 🔊`).toBeNull();
                stats.ruOpts++;
                continue;
              }
              // Флаг и герб (`hy-pick`): тап по слову сразу его произносит (отдельной 🔊 в ряду нет, места нет).
              if (opt.classList.contains('hy-pick')) continue;
              expect(w, `${where}: польский вариант «${text}» без 🔊`).not.toBeNull();
              const btn = w!.querySelector<HTMLElement>(':scope > .pq-say')!;
              expect(btn.hasAttribute('data-nav'), 'в рамку стрелок 🔊 не входит').toBe(false);
              said.length = 0;
              btn.click();
              expect(said, `${where}: 🔊 «${text}»`).toEqual([spokenText(text)]);
              expect(given, `${where}: тап по 🔊 выбрал вариант`).toBeNull();
              expect(opt.classList.contains('right') || opt.classList.contains('wrong')).toBe(false);
              stats.opts++;
            }
            // Карточки предметов (Święta): «Spakuj koszyk» и подсказки-предметы.
            for (const c of panel.body.querySelectorAll<HTMLElement>('.sw-card')) {
              const w = c.closest('.pq-optw');
              expect(w, `${where}: карточка ${c.dataset.item} без 🔊`).not.toBeNull();
              said.length = 0;
              w!.querySelector<HTMLElement>(':scope > .pq-say')!.click();
              expect(said.length).toBe(1);
              expect(given).toBeNull();
              stats.opts++;
            }
            panel.body.remove();
          }
        }
      }
    }
    // Проверка не пустая: были и польские вопросы, и варианты во всех видах.
    expect(stats.prompts).toBeGreaterThan(50);
    expect(stats.opts).toBeGreaterThan(100);
  });
});

describe('v2: движок — отзыв, клавиша G, без автоперехода', () => {
  const fixture = () => {
    const s = mkPolska();
    const said: string[] = [];
    s.bus.on('audio:play', (p) => said.push(p.text ?? ''));
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountPolskaGame(root, { bus: s.bus, games: GAMES, polska: s.p, now: () => NOW, rand: seeded(7), say: (t, slow) => s.bus.emit('audio:play', { text: t, ...(slow ? { slow } : {}) }) });
    return { s, said, root, ui };
  };

  it('Daty: вопрос «Co obchodzimy…» и 4 польских варианта с 🔊; тап — только звук; Dalej листает', () => {
    const { said, root, ui } = fixture();
    ui.start('daty');
    const t = ui.task as unknown as { mode: string; q: string; options?: string[] };
    const q = root.querySelector('[data-prompt] .pq-say') as HTMLElement;
    expect(q).toBeTruthy();
    said.length = 0;
    q.click();
    expect(said).toEqual([spokenText(t.q)]);
    if (t.options?.length) {
      const wraps = root.querySelectorAll('.pq-optw');
      expect(wraps.length).toBe(t.options.length);
      said.length = 0;
      (wraps[1]!.querySelector('.pq-say') as HTMLElement).click();
      expect(said).toEqual([spokenText(t.options[1]!)]);
      expect(root.querySelector('[data-feedback]:not([hidden])')).toBeNull();
    }
    expect(ui.task).toBeTruthy();
    ui.stop();
  });

  it('после ответа 🔊 в отзыве: правильный польский ответ; сам не листается', () => {
    vi.useFakeTimers();
    const { said, root, ui } = fixture();
    ui.start('geo');
    const first = ui.task!.id;
    ui.submit({ x: -1, y: -1 });
    const fbBtn = root.querySelector<HTMLElement>('[data-feedback] .pq-say')!;
    expect(fbBtn).toBeTruthy();
    said.length = 0;
    fbBtn.click();
    expect(said.length).toBe(1);
    expect(hasCyrillic(said[0]!)).toBe(false);
    vi.advanceTimersByTime(NEXT_DELAY_MS + 5);
    expect(ui.task!.id).toBe(first);
    ui.stop();
    vi.useRealTimers();
  });

  it('клавиша G (intent say): вариант под рамкой, без рамки — вопрос', () => {
    const { s, said, root, ui } = fixture();
    ui.start('hymn');
    const t = ui.task as unknown as { mode: string; options: string[]; prompt: string; lang: string };
    said.length = 0;
    s.bus.emit('input:intent', { type: 'say', to: 'ui', source: 'keyboard' });
    expect(said.length).toBe(1);
    if (t.lang === 'pl') expect(said[0]).toBe(spokenText(t.prompt));
    if (t.mode === 'choice') {
      s.bus.emit('input:intent', { type: 'move', dir: 'down', held: true, to: 'ui', source: 'keyboard' });
      s.bus.emit('input:intent', { type: 'move', dir: 'right', held: true, to: 'ui', source: 'keyboard' });
      const focused = root.querySelector('.is-focus') as HTMLElement | null;
      if (focused?.closest('.pq-optw')) {
        said.length = 0;
        s.bus.emit('input:intent', { type: 'say', to: 'ui', source: 'keyboard' });
        expect(said).toEqual([spokenText(focused.dataset.opt!)]);
      }
    }
    ui.stop();
  });
});

describe('v1: мини-игра', () => {
  const mk = (q: Question) => {
    const root = document.createElement('div');
    const bus = testBus();
    const played: { text?: string; slow?: boolean }[] = [];
    bus.on('audio:play', (p) => played.push({ ...(p.text ? { text: p.text } : {}), ...(p.slow ? { slow: p.slow } : {}) }));
    let answered = 0;
    const g = mountMinigame(root, {
      bus,
      next: () => q,
      answer: () => (answered++, { ok: false, correct: 'kot', pl: 'kot', ru: 'кот', tr: 'кот' }),
      say: () => {},
    });
    g.start(q.mode);
    return { root, played, bus, answered: () => answered };
  };

  it('«Слово → перевод»: польский вопрос с 🔊, русские варианты без', () => {
    const { root, played, answered } = mk({ mode: 1, id: 'w.kot', kind: 'choice', prompt: 'Nie ma za co', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот' });
    expect(root.querySelectorAll('.pq-qblock .pq-say')).toHaveLength(1);
    expect(root.querySelectorAll('.pq-optw, .pq-opt .pq-say')).toHaveLength(0);
    root.querySelector<HTMLElement>('.pq-qblock .pq-say')!.click();
    expect(played).toEqual([{ text: 'Nie ma za co' }]);
    expect(answered()).toBe(0);
  });

  it('«Перевод → слово»: русский вопрос без 🔊, у каждого польского варианта 🔊; тап по ней не выбирает; тап по варианту выбирает', () => {
    const { root, played, answered } = mk({ mode: 2, id: 'w.kot', kind: 'choice', prompt: 'кот', promptLang: 'ru', options: ['pies', 'kot', 'dom', 'mama'], answer: 'kot' });
    expect(root.querySelectorAll('.pq-qblock .pq-say')).toHaveLength(0);
    const wraps = root.querySelectorAll('.pq-optw');
    expect(wraps).toHaveLength(4);
    const texts = ['pies', 'kot', 'dom', 'mama'];
    wraps.forEach((w, i) => {
      played.length = 0;
      (w.querySelector('.pq-say') as HTMLElement).click();
      expect(played).toEqual([{ text: texts[i]! }]);
    });
    expect(answered()).toBe(0);
    expect(root.querySelector('.pq-opt.right, .pq-opt.wrong')).toBeNull();
    played.length = 0;
    root.querySelector<HTMLElement>('[data-opt="pies"]')!.click();
    expect(answered()).toBe(1);
    // Неверный польский вариант звучит при выборе (как и раньше), в отзыве — 🔊 с правильным словом.
    expect(played).toEqual([{ text: 'pies' }]);
    const fbBtn = root.querySelector<HTMLElement>('[data-feedback] .pq-say')!;
    played.length = 0;
    fbBtn.click();
    expect(played).toEqual([{ text: 'kot' }]);
  });

  it('«Фраза по-русски»: польский вопрос с 🔊; русская сборка без', () => {
    const { root, played } = mk({ mode: 4, id: 'p.a', kind: 'tiles', prompt: 'Dzień dobry', promptLang: 'pl', tiles: ['а', 'б'], answer: ['а', 'б'] } as unknown as Question);
    root.querySelector<HTMLElement>('.pq-say')!.click();
    expect(played).toEqual([{ text: 'Dzień dobry' }]);
    const m3 = mk({ mode: 3, id: 'p.a', kind: 'tiles', prompt: 'добрый день', promptLang: 'ru', tiles: ['a', 'b'], answer: ['a', 'b'] } as unknown as Question);
    expect(m3.root.querySelectorAll('.pq-say')).toHaveLength(0);
  });

  it('клавиша G озвучивает вариант под рамкой, без рамки — вопрос; верный ответ сам не листается', () => {
    vi.useFakeTimers();
    const { root, played, bus } = mk({ mode: 2, id: 'w.kot', kind: 'choice', prompt: 'кот', promptLang: 'ru', options: ['pies', 'kot', 'dom', 'mama'], answer: 'kot' });
    played.length = 0;
    bus.emit('input:intent', { type: 'say', to: 'ui', source: 'keyboard' });
    expect(played).toEqual([{ text: 'pies' }]);
    bus.emit('input:intent', { type: 'move', dir: 'right', held: true, to: 'ui', source: 'keyboard' });
    bus.emit('input:intent', { type: 'move', dir: 'right', held: true, to: 'ui', source: 'keyboard' });
    played.length = 0;
    bus.emit('input:intent', { type: 'say', to: 'ui', source: 'keyboard' });
    expect(played).toEqual([{ text: 'kot' }]);
    vi.advanceTimersByTime(NEXT_DELAY_MS);
    expect(root.querySelector('[data-next]')).toBeNull();
    vi.useRealTimers();
  });
});

describe('ввод: клавиша G', () => {
  it('в оверлее G даёт intent say, в мире — ничего; в поле ввода G печатается', () => {
    const bus = createBus<BusEvents>();
    const got: string[] = [];
    bus.on('input:intent', (i) => got.push(`${i.type}:${i.to}`));
    const r = createRouter({ bus, coarse: false });
    const kb = createKeyboardSource(r);
    const press = (target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true, cancelable: true }));
    press();
    expect(got).toEqual([]);
    r.setFocus('ui');
    press();
    expect(got).toEqual(['say:ui']);
    const input = document.createElement('input');
    document.body.append(input);
    press(input);
    expect(got).toEqual(['say:ui']);
    kb.dispose();
    r.dispose();
    input.remove();
  });
});
