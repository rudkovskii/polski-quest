// @vitest-environment happy-dom
// Игра «Sobes» (30.10, личная версия Шэфа): импорт вопросов из дриля (статусы «учу» + разметка кусков в базе), задания на все виды
// просьб, проверка, самооценка «скажи вслух», лишние куски — только настоящие куски других ответов, карточка знакомства, экран вопросов.
import { describe, expect, it } from 'vitest';
import { game } from '../src/games/sobes';
import { makeTask, makeStep, normChunk, type SobesKind, type SobesTask } from '../src/games/sobes/tasks';
import { fitBundle, kin, Ladder, newBundle, LONG } from '../src/games/sobes/plan';
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
            const raw = (u.raw.chunks as string[]).slice(t!.given.length, t!.given.length + (t!.answer as string[]).length);
            expect(t!.answer).toEqual(raw.map((c) => normChunk(c, ctx.units)));
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

  it('лишние варианты «что дальше» — настоящие куски ответов (без подсказки регистром и точкой), не из уже сказанного', () => {
    const p = mk();
    const ctx = ctxOf(p, 5);
    const all = new Set(p.units('sobes').flatMap((u) => (u.raw.chunks as string[]).map((c) => normChunk(c, ctx.units))));
    for (const u of p.units('sobes')) {
      const t = makeTask(ctx, { id: u.id, side: 'B', self: false, stage: 'sprout' })!;
      expect(t.options.length).toBe(4);
      for (const o of t.options) {
        expect(all.has(o), o).toBe(true);
        expect(o, o).not.toMatch(/[.,;:!?]$/);
      }
      const said = t.given.map((c) => normChunk(c, ctx.units).toLowerCase());
      for (const o of t.options) expect(said).not.toContain(o.toLowerCase());
    }
  });

  it('куски без подсказки: строчная в начале, имена и названия остаются с заглавной', () => {
    const p = mk();
    const units = p.units('sobes');
    expect(normChunk('Hymn Polski to Mazurek Dąbrowskiego.', units)).toBe('hymn Polski to Mazurek Dąbrowskiego');
    expect(normChunk('Kraków, Łódź, Wrocław,', units)).toBe('Kraków, Łódź, Wrocław');
    expect(normChunk('w 1797 roku.', units)).toBe('w 1797 roku');
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

  it('экран вопросов: «Новая связка» читает карточки подряд, потом лесенка по связке', () => {
    const p = mk();
    const marked: string[] = [];
    const seenSet = new Set<string>();
    const ctx = ctxOf(p, 3, (id) => seenSet.has(id), marked);
    const calls: [unknown, number][] = [];
    const pn = panel();
    game.hub!(pn, ctx, (id, size) => calls.push([id, size]));
    expect(pn.body.querySelectorAll('[data-question]').length).toBe(p.units('sobes').length);
    (pn.body.querySelector('[data-sobes-new]') as HTMLElement).click();
    const ids = newBundle(ctx, p.units('sobes').map((u) => u.id));
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < ids.length; i++) {
      expect(pn.body.querySelector('[data-answer-card]')!.getAttribute('data-answer-card')).toBe(ids[i]);
      expect(calls).toEqual([]);
      (pn.foot.querySelector('[data-read-next]') as HTMLElement).click();
    }
    expect(marked).toEqual(ids);
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toEqual(ids);
  });

  it('экран вопросов: отмеченный один вопрос — связка из двух, «Учить выбранные» прилипает снизу', () => {
    const p = mk();
    const ctx = ctxOf(p, 3, () => false);
    const pn = panel();
    const calls: [unknown, number][] = [];
    game.hub!(pn, ctx, (id, size) => calls.push([id, size]));
    const first = p.units('sobes')[3]!.id;
    (pn.body.querySelector(`[data-question="${first}"]`) as HTMLElement).click();
    const go = pn.body.querySelector('[data-sobes-sel]') as HTMLElement;
    expect(go.textContent).toContain('(2)');
    go.click();
    for (let i = 0; i < 5 && !calls.length; i++) (pn.foot.querySelector('[data-read-next]') as HTMLElement).click();
    expect((calls[0]![0] as string[])[0]).toBe(first);
    expect((calls[0]![0] as string[]).length).toBe(2);
  });
});

describe('Sobes: связка (D-88)', () => {
  const ids = (p: ReturnType<typeof mk>): string[] => p.units('sobes').map((u) => u.id);
  const play = (lad: Ladder, wrong: (t: SobesTask) => boolean): SobesTask[] => {
    const out: SobesTask[] = [];
    for (let t = lad.next(); t; t = lad.next()) {
      out.push(t);
      const bad = wrong(t);
      const ans = t.kind === 'say' ? (bad ? 'no' : 'said') : bad ? '__' : t.answer;
      lad.answered(t, !bad, ans);
      if (out.length > 60) throw new Error('loop');
    }
    return out;
  };

  it('связки: 2–3 вопроса, сумма кусков ≤ 11, длинный — вдвоём, похожие не вместе, одиночной нет', () => {
    const p = mk();
    const ctx = ctxOf(p, 1, () => false);
    const all = ids(p);
    const len = (id: string): number => (p.unit(id)!.raw.chunks as string[]).length;
    for (let i = 0; i < all.length; i++) {
      const b = fitBundle(ctx, all.slice(i), { avoidKin: true, known: all.slice(0, i), rest: all });
      expect(b.length, all[i]).toBeGreaterThanOrEqual(2);
      expect(b.length).toBeLessThanOrEqual(3);
      if (b.some((id) => len(id) >= LONG)) expect(b.length).toBe(2);
      else if (b.length === 3) expect(b.reduce((a, id) => a + len(id), 0)).toBeLessThanOrEqual(11);
      for (const x of b) for (const y of b) if (x !== y && b.length === 3) expect(kin(x, y)).toBe(false);
    }
  });

  it('лесенка: собери → что дальше → скажи; первым — кого читали первым; подряд один вопрос не идёт', () => {
    const p = mk();
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = ctxOf(p, seed);
      const b = fitBundle(ctx, ids(p).slice(seed % 18), { avoidKin: true });
      const lad = new Ladder(ctx, b, 'new', b[0]!);
      const ts = play(lad, () => false);
      // Первым — кого читали первым (если у него есть задание первой ступени: ответ из 2 кусков не собирают).
      if ((p.unit(b[0]!)!.raw.chunks as string[]).length >= 3) expect(ts[0]!.id).toBe(b[0]);
      const order = ts.map((t) => t.kind);
      expect(order.lastIndexOf('order')).toBeLessThan(order.indexOf('next'));
      expect(order.lastIndexOf('next')).toBeLessThan(order.indexOf('say'));
      for (const id of b) expect(ts.filter((t) => t.kind === 'say' && t.id === id).length).toBe(1);
      const multi = b.filter((id) => !b.every((x) => x === id)).length > 1;
      if (multi) for (let i = 1; i < ts.length; i++) if (ts[i]!.id === ts[i - 1]!.id) expect(ts[i]!.part !== undefined || ts[i]!.kind !== ts[i - 1]!.kind || b.length === 1).toBe(true);
      expect(ts.every((t) => t.inBundle)).toBe(true);
    }
  });

  it('ошибка — один повтор, не раньше чем через два задания', () => {
    const p = mk();
    for (let seed = 1; seed <= 15; seed++) {
      const ctx = ctxOf(p, seed);
      const b = fitBundle(ctx, ids(p).slice(seed % 18), { avoidKin: true });
      const lad = new Ladder(ctx, b, 'new');
      const ts = play(lad, (t) => !t.retry);
      const plain = ts.filter((t) => !t.retry);
      expect(ts.filter((t) => t.retry).length).toBe(plain.length);
      ts.forEach((t, i) => {
        if (!t.retry) return;
        const j = ts.findIndex((x, k) => k < i && x.id === t.id && x.kind === t.kind && x.part === t.part && !x.retry);
        expect(j).toBeGreaterThanOrEqual(0);
        if (lad.ids.length > 1) expect(i - j).toBeGreaterThanOrEqual(2);
      });
    }
  });

  it('длинный ответ: два окна сборки (начало и конец) и два стыка', () => {
    const p = mk();
    const long = p.units('sobes').find((u) => (u.raw.chunks as string[]).length >= LONG);
    if (!long) return;
    const ctx = ctxOf(p, 4);
    const other = p.units('sobes').find((u) => u.id !== long.id && (u.raw.chunks as string[]).length === 2)!;
    const ts = play(new Ladder(ctx, [long.id, other.id], 'new'), () => false).filter((t) => t.id === long.id);
    const orders = ts.filter((t) => t.kind === 'order');
    expect(orders.map((t) => t.given.length).sort((a, b) => a - b)).toEqual([0, (long.raw.chunks as string[]).length - 4]);
    const nexts = ts.filter((t) => t.kind === 'next').map((t) => t.given.length);
    const half = Math.ceil((long.raw.chunks as string[]).length / 2);
    expect(nexts.some((k) => k < half)).toBe(true);
    expect(nexts.some((k) => k >= half)).toBe(true);
  });

  it('повтор: сначала «скажи вслух» без сути; не собралось — «что дальше» и «скажи» с сутью', () => {
    const p = mk();
    const ctx = ctxOf(p, 2);
    const b = fitBundle(ctx, ids(p), { avoidKin: true });
    const lad = new Ladder(ctx, b, 'review');
    const ts = play(lad, (t) => t.bare === true && t.id === b[0]);
    expect(ts.slice(0, b.length).every((t) => t.kind === 'say' && t.bare)).toBe(true);
    const rest = ts.slice(b.length);
    expect(rest.map((t) => `${t.id}:${t.kind}`)).toEqual([`${b[0]}:next`, `${b[0]}:say`]);
    expect(rest[1]!.bare).toBeFalsy();
  });

  it('«Сказал» — без экрана результата; верно на ступенях 1–2 — только кусок, ошибка — весь ответ', () => {
    const p = mk();
    const ctx = ctxOf(p, 3);
    const u = p.units('sobes').find((x) => (x.raw.chunks as string[]).length >= 3)!;
    const say = makeStep(ctx, u.id, 'say', { bundle: [u.id] })!;
    expect(game.check(say, 'said', ctx).skipFeedback).toBe(true);
    expect(game.check(say, 'no', ctx).skipFeedback).toBeFalsy();
    const nx = makeStep(ctx, u.id, 'next', { bundle: [u.id] })!;
    const raw = (u.raw.chunks as string[])[nx.given.length]!;
    expect(game.check(nx, nx.answer, ctx).correct).toBe(raw);
    expect(game.check(nx, '__', ctx).correct).toBe(u.raw.answer);
  });
});
