// @vitest-environment happy-dom
// Игра «Sobes» (30.10, личная версия Шэфа): импорт вопросов из дриля (статусы «учу» + разметка кусков в базе), задания на все виды
// просьб, проверка, самооценка «скажи вслух», лишние куски — только настоящие куски других ответов, карточка знакомства, экран вопросов.
import { describe, expect, it } from 'vitest';
import { game } from '../src/games/sobes';
import { makeTask, type SobesKind, type SobesTask } from '../src/games/sobes/tasks';
import { createPolska, newPolskaSave, type PolskaSave } from '../src/systems/polska';
import { plotOf } from '../src/systems/zagroda';
import type { GameCtx, GamePanel, Want } from '../src/types/polska';
import { activeRows, buildSobes } from '../tools/sobes_import';
import { seeded, testBus } from './helpers';

const NOW = Date.UTC(2026, 9, 30, 10, 0);

function mk() {
  let save: PolskaSave = newPolskaSave();
  return createPolska({ bus: testBus(), load: () => save, save: (x) => (save = x), now: () => NOW, tz: () => 0 });
}
const ctxOf = (p: ReturnType<typeof mk>, seed = 3, seen: (id: string) => boolean = () => true, marked: string[] = []): GameCtx => ({
  units: p.units('sobes'),
  unit: (id) => p.unit(id),
  info: (id) => p.info(id),
  seen,
  markSeen: (id) => marked.push(id),
  doc: p.content.docs.sobes ?? {},
  now: () => NOW,
  date: () => ({ y: 2026, m: 10, d: 30, weekday: 5 }),
  rand: seeded(seed),
});
const panel = (submit: (a: unknown) => void = () => {}): GamePanel => ({ body: document.createElement('div'), foot: document.createElement('div'), layout: 'panel', submit, say: () => {}, rand: seeded(2) });
const WANTS: Want[] = [
  { id: '', side: 'A', self: false, stage: 'seed' },
  { id: '', side: 'B', self: false, stage: 'sprout' },
  { id: '', side: 'B', self: true, stage: 'bush' },
];

const BASE = `## Symbole

### 1. Jak wygląda godło Polski?
Godło Polski to biały orzeł w złotej koronie na czerwonym tle.

**Kawałki:** Godło Polski to / biały orzeł / w złotej koronie / na czerwonym tle.
**Ru:** Как выглядит герб?
**Sedno:** белый орёл · золотая корона · красный фон

### 2. Jakie kolory ma flaga Polski?
Flaga Polski ma dwa kolory: biały na górze i czerwony na dole.

**Kawałki:** Flaga Polski ma dwa kolory: / biały na górze / i czerwony NA GÓRZE.
**Ru:** Цвета флага?
**Sedno:** белый · красный

### 3. Kiedy był chrzest Polski?
Chrzest Polski był w 966 roku.

### 4. Hymn?
Hymn Polski to Mazurek Dąbrowskiego.
**Krótko:** Mazurek Dąbrowskiego.

**Kawałki:** Hymn Polski to / Mazurek Dąbrowskiego.
**Ru:** Гимн?
**Sedno:** Mazurek Dąbrowskiego
`;
const PROGRESS = `<!-- STATUSY:START -->  … <!-- STATUSY:END -->
<!-- STATUSY:START -->
| # | Вопрос | Категория | Слой | Статус | Серия | В приложении | Последний | Следующий |
|---|---|---|---|---|---|---|---|---|
| 1 | Jak wygląda godło Polski? | Символы | **ядро** | учу | 2 | — | 20.10.2026 | — |
| 2 | Jakie kolory? | Символы | **ядро** | учу | 3 | — | 26.10.2026 | — |
| 3 | Chrzest | Символы | **ядро** | учу | 0 | — | 25.10.2026 | — |
| 4 | Hymn | Символы | **ядро** | учу | 3 | — | 30.10.2026 | — |
| 5 | Хвост | Символы | хвост | учу | 0 | — | 30.10.2026 | — |
| 6 | Знаю | Символы | **ядро** | знаю | 4 | — | 30.10.2026 | — |
<!-- STATUSY:END -->
`;

describe('Sobes: импорт из дриля', () => {
  it('берёт ядро и личное со статусом «учу», свежее первым; хвост и «знаю» — нет', () => {
    expect(activeRows(PROGRESS).map((r) => r.n)).toEqual([4, 2, 3, 1]);
  });

  it('куски сверяются с ответом, вопрос без разметки — в списке «без разметки», Krótko не мешает', () => {
    const { doc, missing, errors } = buildSobes(BASE, PROGRESS);
    expect(doc.units.map((u) => u.id)).toEqual(['ans.4', 'ans.1']);
    expect(missing).toEqual([3]);
    expect(errors).toEqual(['№2: куски не совпадают с ответом — поправь строку Kawałki']);
    const h = doc.units[0]!;
    expect(h.answer).toBe('Hymn Polski to Mazurek Dąbrowskiego.');
    expect(h.short).toBe('Mazurek Dąbrowskiego.');
    expect(h.sedno).toEqual(['Mazurek Dąbrowskiego']);
  });
});

describe('Sobes: игра', () => {
  it('ответы из sobes.json загружены, растут в пасеке, вход — мачта', () => {
    const p = mk();
    const units = p.units('sobes');
    expect(units.length).toBeGreaterThan(0);
    expect(p.content.errors).toEqual([]);
    for (const u of units) {
      expect(u.kind).toBe('answer');
      expect((u.raw.chunks as string[]).join(' ')).toBe(u.raw.answer);
      expect(plotOf(u).obj).toBe('hive_ref');
    }
    expect(game.entry).toBe('mast');
  });

  it('каждый ответ на каждую просьбу: задание рисуется, верный ответ засчитан, неверный нет', () => {
    const p = mk();
    const kinds = new Set<SobesKind>();
    for (const u of p.units('sobes')) {
      for (const w of WANTS) {
        for (let seed = 1; seed <= 6; seed++) {
          const ctx = ctxOf(p, seed);
          const t = game.nextTask(ctx, { ...w, id: u.id });
          expect(t, u.id).not.toBeNull();
          kinds.add(t!.kind);
          const pn = panel();
          game.render(t!, pn, ctx);
          expect(pn.body.textContent).toContain(u.pl);
          if (t!.kind === 'order') {
            expect((t!.answer as string[]).length).toBeLessThanOrEqual(4);
            expect([...t!.given, ...(t!.answer as string[])].join(' ')).toBe(u.raw.answer === undefined ? '' : (u.raw.chunks as string[]).slice(0, t!.given.length + (t!.answer as string[]).length).join(' '));
            expect(game.check(t!, t!.answer, ctx).ok).toBe(true);
            expect(game.check(t!, [...(t!.answer as string[])].reverse(), ctx).ok).toBe(false);
          } else if (t!.kind === 'next') {
            expect(t!.options).toContain(t!.answer);
            expect(new Set(t!.options).size).toBe(t!.options.length);
            expect(game.check(t!, t!.answer, ctx).ok).toBe(true);
            const wrong = t!.options.find((o) => o !== t!.answer);
            if (wrong) expect(game.check(t!, wrong, ctx).ok).toBe(false);
          } else {
            expect(t!.self).toBe(true);
            expect(game.check(t!, 'said', ctx).ok).toBe(true);
            expect(game.check(t!, 'hint', ctx).ok).toBe(false);
            expect(game.check(t!, 'no', ctx).ok).toBe(false);
            expect(game.check(t!, 'said', ctx).say).toBe(u.raw.answer);
          }
        }
      }
    }
    expect([...kinds].sort()).toEqual(['next', 'order', 'say']);
  });

  it('лишние варианты «что дальше» — настоящие куски других ответов', () => {
    const p = mk();
    const all = new Set(p.units('sobes').flatMap((u) => u.raw.chunks as string[]));
    for (const u of p.units('sobes')) {
      const t = makeTask(ctxOf(p, 5), { id: u.id, side: 'B', self: false, stage: 'sprout' })!;
      for (const o of t.options) expect(all.has(o), o).toBe(true);
    }
  });

  it('«скажи вслух»: ответа не видно до «Показать», потом эталон по кускам и самооценка', () => {
    const p = mk();
    const u = p.units('sobes')[0]!;
    const ctx = ctxOf(p);
    const t = game.nextTask(ctx, { id: u.id, side: 'B', self: true, stage: 'bush' }) as SobesTask;
    const got: unknown[] = [];
    const pn = panel((a) => got.push(a));
    game.render(t, pn, ctx);
    expect(pn.body.querySelector('[data-answer]')).toBeNull();
    (pn.foot.querySelector('[data-show]') as HTMLElement).click();
    expect(pn.body.querySelectorAll('[data-answer] .sb-line').length).toBe((u.raw.chunks as string[]).length);
    expect([...pn.foot.querySelectorAll('[data-grade]')].map((b) => (b as HTMLElement).dataset.grade)).toEqual(['said', 'hint', 'no']);
    (pn.foot.querySelector('[data-grade="said"]') as HTMLElement).click();
    expect(got).toEqual(['said']);
  });

  it('новый ответ сначала карточкой; «Понятно» ставит знакомство и открывает задание', () => {
    const p = mk();
    const u = p.units('sobes')[0]!;
    const marked: string[] = [];
    const ctx = ctxOf(p, 3, () => false, marked);
    const t = game.nextTask(ctx, { id: u.id, side: 'A', self: false, stage: 'seed' })!;
    const pn = panel();
    game.render(t, pn, ctx);
    expect(pn.body.querySelector('[data-answer-card]')).not.toBeNull();
    expect(pn.body.querySelectorAll('[data-answer] .sb-line').length).toBe((u.raw.chunks as string[]).length);
    expect(marked).toEqual([]);
    (pn.foot.querySelector('[data-understood]') as HTMLElement).click();
    expect(marked).toEqual([u.id]);
    expect(pn.body.querySelector('[data-answer-card]')).toBeNull();
    expect(pn.body.querySelector('[data-built]')).not.toBeNull();
  });

  it('экран вопросов: тап — раунд по вопросу, «Dalej» — вперемешку по всем', () => {
    const p = mk();
    const ctx = ctxOf(p);
    const calls: [unknown, number][] = [];
    const pn = panel();
    game.hub!(pn, ctx, (id, size) => calls.push([id, size]));
    const rows = pn.body.querySelectorAll('[data-question]');
    expect(rows.length).toBe(p.units('sobes').length);
    (rows[0] as HTMLElement).click();
    (pn.foot.querySelector('[data-sobes-go]') as HTMLElement).click();
    expect(calls[0]).toEqual([p.units('sobes')[0]!.id, 4]);
    expect(calls[1]![1]).toBe(10);
  });
});
