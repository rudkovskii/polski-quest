// @vitest-environment happy-dom
// V11a: раунды мини-игры (10 заданий, итог, «Ещё раунд») и надёжное сохранение (20 ответов → перезагрузка, pagehide, повтор после сбоя).
import 'fake-indexeddb/auto';
import { createStore } from 'idb-keyval';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_EVERY_MS, backupDue, markOf, shouldRemind, withMark } from '../src/systems/backup';
import { createFarm } from '../src/systems/farm';
import { GameStorage, KEYS, memoryKV, type KV, type StorageLike, type WriteEvent } from '../src/systems/platform/storage';
import type { Save } from '../src/systems/save';
import type { Question } from '../src/systems/quiz';
import { mountHud } from '../src/ui/hud';
import { mountMinigame, NEXT_DELAY_MS, type AnswerResult } from '../src/ui/minigame';
import { Round, ROUND_SIZE } from '../src/ui/roundSummary';
import { mountSettings } from '../src/ui/settings';
import { seeded, testBus } from './helpers';

afterEach(() => vi.useRealTimers());

const NOW = Date.UTC(2026, 9, 18, 9, 0);
const Q: Question = { mode: 1, id: 'w.kot', kind: 'choice', prompt: 'kot', promptLang: 'pl', options: ['собака', 'кот', 'дом', 'мама'], answer: 'кот' };

// ── Раунды.

function mkGame(results: (n: number) => AnswerResult) {
  const bus = testBus();
  const root = document.createElement('div');
  let n = 0;
  const nexts: number[] = [];
  const g = mountMinigame(root, {
    bus,
    next: () => (nexts.push(n), Q),
    answer: () => results(n++),
    say: () => {},
  });
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const no = () => q('[data-round-no]')!.textContent;
  /** Ответить и дождаться «Dalej» (или автоперехода после верного). */
  const answerOne = (): void => {
    q('[data-opt="кот"]')!.click();
    vi.advanceTimersByTime(NEXT_DELAY_MS + 1);
    if (q('[data-next]')) q('[data-next]')!.click();
    else vi.advanceTimersByTime(1000);
  };
  return { g, root, q, no, answerOne, bus, nexts };
}
const res = (ok: boolean, kind: 'water' | 'grow' | 'harvest' | 'miss', xp: number): AnswerResult => ({ ok, correct: 'кот', pl: 'kot', ru: 'кот', tr: 'кот', act: { kind, xp } });

describe('V11a: раунды', () => {
  it('счёт раунда: верно, полито, выросло, собрано, опыт, лучшая серия', () => {
    const r = new Round();
    const seq: [boolean, 'water' | 'grow' | 'harvest' | 'miss', number][] = [
      [true, 'water', 1], [true, 'grow', 4], [false, 'miss', 0], [true, 'harvest', 11], [true, 'water', 1], [true, 'water', 1], [false, 'miss', 0], [true, 'water', 1], [true, 'water', 1], [true, 'water', 1],
    ];
    for (const [ok, kind, xp] of seq) r.add({ ok, act: { kind, xp } });
    expect(r.done).toBe(true);
    expect(r.stats).toEqual({ total: 10, correct: 8, watered: 8, grew: 1, harvested: 1, xp: 21, bestStreak: 3 });
  });

  it('шапка «3 / 10»; после 10-го ответа итог, «Ещё раунд» начинает с 1 / 10, лимита раундов нет', () => {
    vi.useFakeTimers();
    const t = mkGame((n) => res(n % 5 !== 4, n % 5 === 4 ? 'miss' : 'water', n % 5 === 4 ? 0 : 1));
    t.g.start(1);
    expect(t.no()).toBe(`1 / ${ROUND_SIZE}`);
    t.answerOne();
    t.answerOne();
    expect(t.no()).toBe('3 / 10');
    for (let i = 0; i < 8; i++) t.answerOne();
    expect(t.q('[data-round-summary]')).not.toBeNull();
    expect(t.no()).toBe('10 / 10');
    const text = t.q('[data-round-summary]')!.textContent!;
    expect(text).toContain('Раунд 1');
    expect(text).toContain('8 из 10');
    expect(text).toContain('+8');
    expect(t.q('[data-more]')).not.toBeNull();
    expect(t.q('[data-end]')).not.toBeNull();
    // второй и третий раунд
    for (let r = 2; r <= 3; r++) {
      t.q('[data-more]')!.click();
      expect(t.q('[data-round-summary]')).toBeNull();
      expect(t.no()).toBe('1 / 10');
      for (let i = 0; i < 10; i++) t.answerOne();
      expect(t.q('[data-round-summary]')!.textContent).toContain(`Раунд ${r}`);
    }
    t.q('[data-end]')!.click();
    expect(t.g.isOpen).toBe(false);
  });

  it('выход посреди раунда не теряет ответы: они уже у фермы; новое открытие начинает раунд заново', () => {
    vi.useFakeTimers();
    let answers = 0;
    const t = mkGame(() => (answers++, res(true, 'water', 1)));
    t.g.start(1);
    for (let i = 0; i < 4; i++) t.answerOne();
    t.bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(t.g.isOpen).toBe(false);
    expect(answers).toBe(4);
    t.g.start(1);
    expect(t.no()).toBe('1 / 10');
  });

  it('клавиши в итоге: 1 — ещё раунд, Esc — закончить; автобег не останавливается между раундами (farm:auto не гаснет)', () => {
    vi.useFakeTimers();
    const t = mkGame(() => res(true, 'water', 1));
    const auto: boolean[] = [];
    t.bus.on('farm:auto', ({ on }) => auto.push(on));
    t.g.start(1);
    for (let i = 0; i < 10; i++) t.answerOne();
    expect(t.q('[data-round-summary]')).not.toBeNull();
    t.bus.emit('input:intent', { type: 'hotkey', n: 1, to: 'ui', source: 'keyboard' });
    expect(t.no()).toBe('1 / 10');
    expect(auto.includes(false)).toBe(false);
    for (let i = 0; i < 10; i++) t.answerOne();
    t.bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(t.g.isOpen).toBe(false);
    expect(auto.at(-1)).toBe(false);
  });
});

// ── Сохранение.

class MemLS implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

describe('V11a: сохранение', () => {
  it('20 ответов → «перезагрузка» хранилища → огород совпадает', async () => {
    const kv = memoryKV();
    const a = new GameStorage({ kv, ls: null });
    await a.load(NOW);
    let now = NOW;
    const bus = testBus();
    const farm = createFarm({ bus, load: () => a.save.garden, save: (garden) => a.update((s: Save) => ({ ...s, garden }), now), now: () => now, tz: () => 0, say: () => {}, rand: seeded(3) });
    farm.plant(['w.dzien_dobry', 'w.tak', 'w.nie', 'w.dom', 'w.kot']);
    for (let i = 0; i < 20; i++) {
      now += 1000;
      const q = farm.next(1);
      if (!q) break;
      farm.answer(q, q.answer);
    }
    await a.flush();
    expect(a.save.garden.log).toHaveLength(20);
    const b = new GameStorage({ kv, ls: null });
    const r = await b.load(now + 5);
    expect(r.created).toBe(false);
    expect(r.save.garden).toEqual(a.save.garden);
    expect(r.save.garden.log).toHaveLength(20);
  });

  it('запись не позже 1 с при непрерывных ответах', async () => {
    vi.useFakeTimers();
    const kv = memoryKV();
    const spy = vi.spyOn(kv, 'setMany');
    const a = new GameStorage({ kv, ls: null });
    await a.load(NOW);
    spy.mockClear();
    // ответы каждые 300 мс: дебаунс 400 мс сдвигался бы бесконечно, но maxWait 1 с срабатывает
    for (let i = 0; i < 5; i++) {
      a.update((s) => ({ ...s, hints: [`h${i}`] }), NOW + i);
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(spy).toHaveBeenCalled();
  });

  it('pagehide и скрытие вкладки пишут сразу (и аварийную копию), не дожидаясь дебаунса', async () => {
    const idb = createStore(`pq-v11a-${Math.random()}`, 'kv');
    const ls = new MemLS();
    const a = new GameStorage({ idb, ls, debounceMs: 60_000, maxWaitMs: 120_000 });
    await a.load(NOW);
    await a.flush();
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    a.attachLifecycle({ win, doc });
    a.update((s) => ({ ...s, hints: ['p'] }), NOW + 5);
    expect(a.dirty).toBe(true);
    win.dispatchEvent(new Event('pagehide'));
    expect(ls.getItem(KEYS.tail)).toContain('"hints":["p"]');
    await a.flush();
    expect(a.dirty).toBe(false);
    a.update((s) => ({ ...s, hints: ['v'] }), NOW + 9);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(ls.getItem(KEYS.tail)).toContain('"hints":["v"]');
    const b = new GameStorage({ idb, ls });
    expect((await b.load(NOW + 99)).save.hints).toEqual(['v']);
  });

  it('сбой записи: событие error, повтор, потом saved; данные не потеряны', async () => {
    vi.useFakeTimers();
    const mem = memoryKV();
    let fail = 0;
    const kv: KV = { ...mem, kind: 'memory', setMany: (e) => (fail-- > 0 ? Promise.reject(new Error('quota')) : mem.setMany(e)) };
    const a = new GameStorage({ kv, ls: null, retryMs: 500 });
    await a.load(NOW);
    fail = 2;
    const ev: WriteEvent['type'][] = [];
    a.onWrite((e) => ev.push(e.type));
    a.update((s) => ({ ...s, hints: ['x'] }), NOW + 1);
    await vi.advanceTimersByTimeAsync(450);
    expect(ev).toEqual(['error']);
    await vi.advanceTimersByTimeAsync(600);
    expect(ev).toEqual(['error', 'error']);
    await vi.advanceTimersByTimeAsync(1100);
    expect(ev).toEqual(['error', 'error', 'saved']);
    expect(a.dirty).toBe(false);
    expect(a.lastSavedAt).not.toBeNull();
    expect((await new GameStorage({ kv: mem, ls: null }).load(NOW)).save.hints).toEqual(['x']);
  });

  it('IndexedDB упал, запись ушла в localStorage: следующая загрузка берёт более свежую копию оттуда', async () => {
    const idb = createStore(`pq-v11a-${Math.random()}`, 'kv');
    const ls = new MemLS();
    const a = new GameStorage({ idb, ls });
    await a.load(NOW);
    await a.flush();
    ls.setItem(KEYS.save, JSON.stringify({ ...a.save, updated: NOW + 1000, hints: ['новее'] }));
    const b = new GameStorage({ idb, ls });
    expect((await b.load(NOW + 2000)).save.hints).toEqual(['новее']);
  });
});

describe('V11a: копия раз в 7 дней', () => {
  it('напоминание: нет копии неделю — напомнить; после напоминания молчим неделю; скачали — отсчёт заново', () => {
    const created = NOW;
    expect(backupDue(NOW + BACKUP_EVERY_MS - 1, created, [])).toBe(false);
    expect(shouldRemind(NOW + BACKUP_EVERY_MS, created, [])).toBe(true);
    const h1 = withMark([], 'remind', NOW + BACKUP_EVERY_MS);
    expect(shouldRemind(NOW + BACKUP_EVERY_MS + 1000, created, h1)).toBe(false);
    expect(shouldRemind(NOW + 2 * BACKUP_EVERY_MS, created, h1)).toBe(true);
    const h2 = withMark(h1, 'saved', NOW + 8 * 24 * 3600_000);
    expect(markOf(h2, 'saved')).toBe(NOW + 8 * 24 * 3600_000);
    expect(backupDue(NOW + 10 * 24 * 3600_000, created, h2)).toBe(false);
    expect(h2.filter((x) => x.startsWith('backup:'))).toHaveLength(1);
  });
});

describe('V11a: HUD и настройки', () => {
  it('галочка горит 1 с; сбой показывает тост «Не сохранилось, повторяю», успех его убирает', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const hud = mountHud(root, { onSettings: () => {}, bus: testBus() });
    const mark = root.querySelector('[data-saved]')!;
    hud.flashSaved();
    expect(mark.classList.contains('on')).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(mark.classList.contains('on')).toBe(false);
    hud.setSaveError(true);
    expect(root.querySelector('[data-toast]')!.textContent).toBe('Не сохранилось, повторяю');
    expect((root.querySelector('[data-toast]') as HTMLElement).hidden).toBe(false);
    hud.flashSaved();
    expect(mark.classList.contains('on')).toBe(false);
    hud.setSaveError(false);
    expect((root.querySelector('[data-toast]') as HTMLElement).hidden).toBe(true);
  });

  it('настройки показывают время последнего сохранения и подсказку про копию', () => {
    const root = document.createElement('div');
    const t = new Date(2026, 9, 18, 14, 5).getTime();
    const s = mountSettings(root, {
      bus: testBus(),
      getSound: () => true,
      setSound: () => {},
      exportSave: () => 'f.json',
      importSave: async () => ({ ok: true, message: '' }),
      reset: async () => {},
      lastSaved: () => t,
      backupDue: () => true,
    });
    s.open();
    expect(root.querySelector('[data-last-saved]')!.textContent).toMatch(/^Последнее сохранение: 14[:.]05$/);
    expect(root.querySelector('[data-note]')!.textContent).toContain('Копию не скачивали');
  });
});
