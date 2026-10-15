// W-04 п. 1: лавина огорода. План дня Wola — потолок новых по долгу огорода (до 10 к удобрению полный, дальше меньше,
// от 20 новых нет), удобрение за день до 15 растений, слова Salad Story в лимите. Симуляция: 14 игровых дней по одному
// заходу (ноутбук → Salad Story → огород), долг на старте дня не растёт выше 15.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { derive, deriveContent } from '../src/systems/derive';
import { gardenItems } from '../src/systems/garden';
import type { EventDraft } from '../src/systems/log';
import { append, newProgress, setSetting, type Progress } from '../src/systems/progress';
import { wolaContentFrom } from '../src/wola/content';
import { buildVisit, mySalad, saladState, visitTpl } from '../src/wola/systems/saladVisit';
import { forecastDue, dayCap, dayPlan, fertilizedToday, LAPTOP_LESSON, newCapFor, newLeft, PLAN, planText, planted, portion, wolaBook, wolaGarden } from '../src/wola/systems/wola';
import { counterText } from '../src/wola/ui/hub';
import { readContentDir } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';

const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 15, 8);

const disk = readContentDir(join(ROOT, 'content')).files;
const { content, vocab, salad } = wolaContentFrom(Object.fromEntries([...disk].map(([k, v]) => [`/content/${k}`, v])));
const book = wolaBook(vocab);
const dc = deriveContent(content);
const t = content.tuning;

class Sim {
  p: Progress = newProgress(T0 - DAY, 'sim1');
  seq = 0;
  add(d: EventDraft): void {
    const r = append(this.p, { deviceId: 'dev001', seq: this.seq }, d);
    if (!r.ok) throw new Error(`append ${d.k}`);
    this.p = r.progress;
    this.seq = r.dev.seq;
  }
  d(now: number) {
    return derive(this.p, dc, now, TZ);
  }
}

describe('план дня Wola (W-04)', () => {
  it('потолок новых по долгу: до 10 полный, дальше меньше, от 20 — ноль', () => {
    expect(newCapFor(0, 8)).toBe(8);
    expect(newCapFor(PLAN.fullUpTo, 8)).toBe(8);
    expect(newCapFor(15, 8)).toBe(4);
    expect(newCapFor(19, 8)).toBeGreaterThan(0);
    expect(newCapFor(19, 8)).toBeLessThan(4);
    expect(newCapFor(PLAN.noneFrom, 8)).toBe(0);
    expect(newCapFor(40, 8)).toBe(0);
    for (let debt = 0; debt < 40; debt++) expect(newCapFor(debt + 1, 8)).toBeLessThanOrEqual(newCapFor(debt, 8));
  });

  it('ноутбук: при долге ≥ 20 порция пуста и «Сначала огород»; молодой огород после удобрения — всё ещё волна', () => {
    const s = new Sim();
    // 25 слов вчера: сегодня 25 растений к удобрению.
    for (const v of book.home.slice(0, 25)) s.add({ k: 'intro', ts: T0 - DAY + 60_000, item: v.id, lesson: LAPTOP_LESSON, ok: [] });
    const now = T0 + 3_600_000;
    let d = s.d(now);
    expect(wolaGarden(d, now, t, s.p.world.flags).due).toBe(25);
    const por = portion(s.p, book, d, now, t);
    expect(por.left).toBe(0);
    expect(por.blocked).toBe(true);
    const plan = dayPlan(s.p, book, d, now, t);
    expect(plan).toMatchObject({ fertilize: 15, fresh: 0, debt: 25, done: 0, gardenFirst: true });
    expect(planText(plan)).toBe('план на сегодня: удобрить 15, новых 0');
    // Без `now` (старый вызов) — порция как раньше: размер порции.
    expect(portion(s.p, book, d).left).toBe(5);
    // Удобрил 15: долг 10, правило долга дало бы полный потолок, но 25 молодых растений ещё неделю просят удобрения
    // через день — прогноз держит новые (волна), ноутбук всё ещё «Сначала огород».
    const due = gardenItems(d, now, t).filter((g) => g.dueCard).slice(0, 15);
    for (const g of due) s.add({ k: 'rev', ts: now + 1000, card: g.dueCard!, g: 2, ms: 2000, src: 'express' });
    d = s.d(now + 2000);
    expect(fertilizedToday(s.p.log.events, d.todayStart)).toBe(15);
    expect(newCapFor(10, 8)).toBe(8);
    const c = dayCap(s.p, d, now + 2000, t);
    expect(c).toMatchObject({ debt: 10, wave: true });
    expect(dayPlan(s.p, book, d, now + 2000, t)).toMatchObject({ fertilize: 0, fresh: 0, debt: 10, done: 15, gardenFirst: true });
  });

  it('зрелый огород: удобрил 15 из 25 — остаток ждёт без наказания, порция полная', () => {
    const s = new Sim();
    const now = T0 + 3_600_000;
    // 25 зрелых слов (интервал 30 дней, срок сегодня) — импорт из тренажёра.
    for (const v of book.home.slice(0, 25)) {
      // lis и pro раньше rec (днём раньше: порядок событий — по времени): иначе импорт rec (reps ≥ 3) сам откроет свежую pro.
      for (const ty of ['lis', 'pro']) s.add({ k: 'imp', ts: T0 - 41 * DAY, card: `${v.id}#${ty}`, state: { reps: 5, interval: 30, ef: 2.5, due: T0 + 20 * DAY }, from: 'trainer' });
      s.add({ k: 'imp', ts: T0 - 40 * DAY, card: `${v.id}#rec`, state: { reps: 5, interval: 30, ef: 2.5, due: T0 - 3_600_000 }, from: 'trainer' });
    }
    let d = s.d(now);
    expect(dayPlan(s.p, book, d, now, t)).toMatchObject({ fertilize: 15, fresh: 0, debt: 25, gardenFirst: true });
    const due = gardenItems(d, now, t).filter((g) => g.dueCard).slice(0, 15);
    for (const g of due) s.add({ k: 'rev', ts: now + 1000, card: g.dueCard!, g: 2, ms: 2000, src: 'express' });
    d = s.d(now + 2000);
    const after = dayPlan(s.p, book, d, now + 2000, t);
    // Прогноз: завтра 10 оставшихся + 5 новых = 15, дальше меньше.
    expect(forecastDue(d.cards, now + 2000, { t, doneToday: 15, extra: 5 })[0]).toBe(15);
    expect(after).toMatchObject({ fertilize: 0, debt: 10, done: 15, gardenFirst: false });
    expect(after.fresh).toBe(5);
    expect(portion(s.p, book, d, now + 2000, t).blocked).toBeUndefined();
    // Остаток не вянет назавтра: просрочка 1 день, вялым растение становится только после WILT_DAYS.
    const tomorrow = s.d(now + DAY);
    expect(gardenItems(tomorrow, now + DAY, t).filter((g) => g.dueCard && g.wilted)).toHaveLength(0);
  });

  it('слова Salad Story в лимите: введённые на кассе уменьшают порцию ноутбука', () => {
    const s = new Sim();
    const now = T0 + 3_600_000;
    s.p = setSetting(s.p, 'newItemsPerDay', 6, now - 10);
    for (const id of ['lx.salatka', 'lx.kurczak', 'lx.losos']) s.add({ k: 'intro', ts: now - 5000, item: id, lesson: 'wola.salad.1', ok: [] });
    const d = s.d(now);
    const c = dayCap(s.p, d, now, t);
    expect(c).toMatchObject({ today: 3, cap: 6, base: 6, debt: 0 });
    expect(newLeft(c)).toBe(3);
    expect(portion(s.p, book, d, now, t).left).toBe(3);
  });

  it('счётчик над огородом: «план на сегодня: удобрить N, новых M»', () => {
    const plan = { fertilize: 12, fresh: 3, debt: 12, done: 0, gardenFirst: false };
    expect(counterText('ogrod', { dom: 3, plan, due: 12, ripe: 0, jarsDue: 0 })?.text).toBe('план на сегодня: удобрить 12, новых 3');
    expect(counterText('ogrod', { dom: 0, plan: { ...plan, fertilize: 0, fresh: 0 }, due: 0, ripe: 0, jarsDue: 0 })).toBeNull();
  });

  it.each([2, 3] as const)('14 дней по одному заходу (ноутбук, Salad Story, огород до 15, ответы g%i): долг на старте дня не больше 15', (grade) => {
    const s = new Sim();
    const debts: number[] = [];
    const fresh: number[] = [];
    for (let day = 0; day < 14; day++) {
      const now = T0 + day * DAY;
      let d = s.d(now);
      debts.push(wolaGarden(d, now, t, s.p.world.flags).due);
      // Ноутбук: порция плана дня.
      const por = portion(s.p, book, d, now, t);
      fresh.push(por.left);
      for (const v of por.next) s.add({ k: 'intro', ts: now + 1000, item: v.id, lesson: LAPTOP_LESSON, ok: ['rec'] });
      // Salad Story: визит вводит не больше остатка лимита (и не больше maxNewWords).
      d = s.d(now + 2000);
      const st = saladState(s.p.log.events, salad, { dayStartHour: t.dayStartHour, tz: TZ }, now + 2000);
      const room = newLeft(dayCap(s.p, d, now + 2000, t));
      const v = buildVisit({
        data: salad,
        vocab: (id) => content.vocab.get(id)?.value,
        state: st,
        tpl: visitTpl(st),
        mine: mySalad(s.p, salad.menu),
        planted: planted(d),
        due: [],
        seed: `sim:${day}`,
        day: d.today,
        newLeft: room,
      });
      expect(v.introduces.length).toBeLessThanOrEqual(room);
      for (const id of v.introduces) s.add({ k: 'intro', ts: now + 3000, item: id, lesson: v.lesson.id, ok: ['rec'] });
      // Огород: один заход «Nawóz» — до 15 растений, все верно.
      d = s.d(now + 4000);
      const plan = dayPlan(s.p, book, d, now + 4000, t);
      expect(plan.fertilize).toBeLessThanOrEqual(PLAN.fertilizeMax);
      const due = gardenItems(d, now + 4000, t).filter((g) => g.dueCard).slice(0, plan.fertilize);
      for (const g of due) s.add({ k: 'rev', ts: now + 5000, card: g.dueCard!, g: grade, ms: 2500, src: 'express' });
    }
    expect(Math.max(...debts), `долг по дням: ${debts.join(', ')}; новых: ${fresh.join(', ')}`).toBeLessThanOrEqual(PLAN.fertilizeMax);
    // Новые слова не перекрыты наглухо: за две недели ноутбук дал полторы-две порции в первые дни и потом ещё.
    expect(fresh.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(15);
    expect(fresh.slice(7).some((n) => n > 0)).toBe(true);
  });
});
