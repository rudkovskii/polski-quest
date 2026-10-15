// @vitest-environment happy-dom
// W-01: короткая версия «Wola». Словарь и валидатор, чистая петля (порция, полка, потолок, огород, сбор, итог),
// экраны (ноутбук 5 слов → intro → семя, полка темы, предупреждение потолка, огород: удобрение и сбор, банки дома,
// кровать «Do jutra»), хаб (подписи мест, переходы place:<id>) и изоляция сохранения от основной игры.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveContent, derive } from '../src/systems/derive';
import type { EventDraft } from '../src/systems/log';
import { lsKV, GameStorage, KEYS, type StorageLike } from '../src/systems/platform/storage';
import { append, newProgress, setSetting, type Progress } from '../src/systems/progress';
import type { VocabEntry, WolaVocab } from '../src/types/content';
import { createOverlay } from '../src/ui/overlay/host';
import { wolaContentFrom } from '../src/wola/content';
import { routePlaces } from '../src/wola/places';
import { HUB_MAP, PLACE_SPAWN, placeOf } from '../src/wola/systems/places';
import {
  CHECK_LESSON,
  dayCap,
  harvest,
  hubCounters,
  jarFlag,
  LAPTOP_LESSON,
  overCap,
  portion,
  shelf,
  wolaBook,
  wolaDay,
  wolaGarden,
} from '../src/wola/systems/wola';
import { runGarden } from '../src/wola/ui/garden';
import { capOk, runHome, slownik } from '../src/wola/ui/home';
import { counterText, mountHub } from '../src/wola/ui/hub';
import type { WolaDeps } from '../src/wola/ui/kit';
import { checkSteps, runSlowniczek } from '../src/wola/ui/laptop';
import { buildWolaVocab, plKey, slug } from '../tools/build_wola_vocab';
import { checkWola } from '../tools/lib/content_check';
import { readContentDir, readSchemas } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';
import { fakeAudio, flush, memStore, testBus } from './overlayKit';

const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 15, 8); // 10:00 в Варшаве

const disk = readContentDir(join(ROOT, 'content')).files;
const files = Object.fromEntries([...disk].map(([k, v]) => [`/content/${k}`, v]));
const { content, vocab } = wolaContentFrom(files);
const book = wolaBook(vocab);
const dc = deriveContent(content);

function progressOf(drafts: EventDraft[], p0: Progress = newProgress(T0 - DAY, 'wola1')): Progress {
  let p = p0;
  let seq = 0;
  for (const d of drafts) {
    const r = append(p, { deviceId: 'dev001', seq }, d);
    if (!r.ok) throw new Error('append');
    p = r.progress;
    seq = r.dev.seq;
  }
  return p;
}
const intro = (item: string, ts: number, lesson = LAPTOP_LESSON): EventDraft => ({ k: 'intro', ts, item, lesson, ok: [] });
const d = (p: Progress, now: number) => derive(p, dc, now, TZ);

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function deps(p: Progress, now: number, extra: Partial<WolaDeps> = {}) {
  const bus = testBus();
  const store = memStore(p);
  store.local = { ...store.local, seq: p.log.events.length };
  const sfx: string[] = [];
  bus.on('sfx:play', ({ kind }) => sfx.push(kind));
  let clockNow = now;
  const w: WolaDeps = {
    overlay: createOverlay(host, { bus }),
    content,
    book,
    store,
    bus,
    audio: fakeAudio(),
    atlas: null,
    clock: { now: () => clockNow, mono: () => 0 },
    tz: TZ,
    typeMs: 0,
    ...extra,
  };
  return { w, store, bus, sfx, setNow: (t: number) => (clockNow = t) };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => host.querySelector<T>(sel);
const click = (sel: string): void => {
  const b = q<HTMLElement>(sel);
  if (!b) throw new Error(`нет ${sel}: ${host.innerHTML.slice(0, 300)}`);
  b.click();
};

/** Ответить на шаги урока в слое верно (выбор / чтение транскрипции / ввод), пока урок открыт. */
async function solve(root: HTMLElement, audio?: { played: { text: string }[] }): Promise<number> {
  const all = [...content.vocab.values()].map((x) => x.value);
  let n = 0;
  for (let guard = 0; guard < 60; guard++) {
    await flush();
    const main = root.querySelector('.pq-lesson-main');
    if (!main) return n;
    const next = main.querySelector<HTMLElement>('[data-act="next"]:not([hidden])');
    if (next) {
      next.click();
      continue;
    }
    const qt = main.querySelector('.q')?.textContent ?? '';
    const input = main.querySelector<HTMLInputElement>('input');
    if (input) {
      const v = all.find((x) => qt.includes(x.ru));
      input.value = v?.pl ?? '?';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      main.querySelector<HTMLElement>('[data-act="check"]')?.click();
      n++;
      continue;
    }
    const tr = /\[(.+)\]/.exec(qt)?.[1];
    const heard = audio?.played.at(-1)?.text;
    const hv = heard ? all.find((x) => x.pl === heard) : undefined;
    const targets = tr ? [all.find((x) => x.tr === tr)?.pl] : qt.endsWith(' — это…') ? [all.find((x) => `${x.pl} — это…` === qt)?.ru] : [hv?.pl, hv?.ru];
    const opt = [...main.querySelectorAll<HTMLElement>('[data-opt]')].find((b) => targets.includes(b.textContent?.trim()));
    if (!opt) throw new Error(`не нашёл ответ на «${qt}»`);
    opt.click();
    n++;
  }
  return n;
}

// ───────────────────────────── словарь ─────────────────────────────

describe('словарь Wola', () => {
  it('собран из главы 1 и тренажёра: темы, порядок порций, еда отдельно', () => {
    expect(vocab.vocab.length).toBeGreaterThanOrEqual(300);
    expect(vocab.themes.length).toBeGreaterThanOrEqual(10);
    const ids = vocab.vocab.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Первые порции — приветствия и «выживание» в Варшаве.
    expect(vocab.vocab.slice(0, 5).map((v) => v.pl)).toEqual(['Dzień dobry', 'cześć', 'dziękuję', 'proszę', 'przepraszam']);
    // Слова главы 1 сохраняют свои id и tr с ударением.
    expect(content.vocab.get('lx.dzien_dobry')?.value.tr).toBe('джень до́бры');
    // Тема еды — для Salad Story: не дома и в конце.
    const salad = vocab.themes.find((t) => t.place === 'salad')!;
    expect(salad.id).toBe('jedzenie');
    expect(book.home.some((v) => v.tags?.[0] === 'jedzenie')).toBe(false);
    expect(vocab.vocab.at(-1)?.tags?.[0]).toBe('jedzenie');
    expect(content.vocab.get('lx.kawa')?.value.tags).toEqual(['jedzenie']);
    // Все строки в NFC, все слова в SRS, транскрипция кириллицей.
    for (const v of vocab.vocab) {
      expect(v.pl).toBe(v.pl.normalize('NFC'));
      expect(v.srs).toBe(true);
      expect(v.tr && !/[a-z]/i.test(v.tr)).toBe(true);
    }
  });

  const DAY_OF: Record<string, number> = { powitania: 1, liczby: 2, zakupy: 3, ludzie: 4, czasowniki: 5, miasto: 6, czas: 7, zdrowie: 9, praca: 10, jedzenie: 11, dom: 12, wolny: 13, rozmowa: 14 };
  it('сборщик: дубли склеиваются, слово главы 1 главнее, пример тренажёра добавляется, id стабильны', () => {
    expect(plKey('Ile to kosztuje?')).toBe('ile to kosztuje');
    expect(slug('Płacę kartą')).toBe('lx.place_karta');
    const ch01 = JSON.parse(readFileSync(join(ROOT, 'content/modules/ch01/vocab.json'), 'utf8')) as VocabEntry[];
    // Тренажёр из текущего словаря (у кого есть пример) + дубли и ошибка «Dwa kawy».
    const trainer = vocab.vocab
      .filter((v) => v.ex && v.pl !== 'dwa')
      .map((v) => [DAY_OF[v.tags![0]!]!, v.pl, v.ru, v.tr ?? '', v.ex!.pl, v.ex!.ru] as [number, string, string, string, string, string]);
    trainer.push([2, 'dwa', 'два', 'два', 'Dwa kawy, proszę.', 'Два кофе.'], [8, 'bilet', 'билет', 'билет', 'Jeden bilet.', 'Один билет.'], [1, 'Dzień dobry', 'привет', 'джень добры', 'Dzień dobry!', 'Здравствуйте!']);
    const rebuilt = buildWolaVocab({ ch01, trainer, prev: vocab });
    expect(rebuilt.vocab.find((v) => v.pl === 'Dzień dobry')?.id).toBe('lx.dzien_dobry');
    expect(rebuilt.vocab.find((v) => v.pl === 'Dzień dobry')?.tr).toBe('джень до́бры');
    expect(rebuilt.vocab.filter((v) => v.pl === 'bilet').length).toBe(1);
    expect(rebuilt.vocab.find((v) => v.id === 'lx.telefon')).toBeUndefined(); // однокоренное главы 1 не берётся
    expect(rebuilt.vocab.find((v) => v.pl === 'dwa')?.ex?.pl).toBe('Dwie kawy, proszę.');
    // Прошлые id не меняются.
    for (const v of rebuilt.vocab) {
      const was = vocab.vocab.find((x) => plKey(x.pl) === plKey(v.pl));
      if (was) expect(v.id).toBe(was.id);
    }
  });
});

// ───────────────────────────── валидатор ─────────────────────────────

describe('валидатор content/wola', () => {
  const schemas = readSchemas();
  const wola = new Map([...disk].filter(([f]) => f.startsWith('wola/')));
  const errors = (m: Map<string, unknown>, prev: Set<string> | null = null) => checkWola(m, schemas, prev).filter((i) => i.level === 'error');

  it('текущий контент Wola без ошибок', () => {
    expect(errors(wola)).toEqual([]);
  });

  it('ловит: тему не из списка, латиницу в tr, неизвестное место, удалённый id', () => {
    const v = structuredClone(wola.get('wola/vocab.json')) as WolaVocab;
    v.vocab[0]!.tags = ['nie_ma'];
    v.vocab[1]!.tr = 'czesc';
    const removed = v.vocab.splice(2, 1)[0]!;
    const hub = structuredClone(wola.get('wola/maps/hub.json')) as { objects: { type: string; to?: string }[] };
    hub.objects.find((o) => o.to === 'place:salad')!.to = 'place:kino';
    const issues = errors(new Map<string, unknown>([...wola, ['wola/vocab.json', v], ['wola/maps/hub.json', hub]]), new Set([removed.id]));
    const msgs = issues.map((i) => i.msg).join('\n');
    expect(msgs).toContain('тема "nie_ma"');
    expect(msgs).toContain('не кириллицей');
    expect(msgs).toContain('неизвестное место "place:kino"');
    expect(msgs).toContain(`слово ${removed.id} удалено`);
    expect(msgs).toContain('на хабе нет входа в место place:salad');
  });
});

// ───────────────────────────── петля (чистое) ─────────────────────────────

describe('петля Wola', () => {
  it('порция ноутбука: 5 следующих слов; добавленные уходят, после 5 — пусто до завтра', () => {
    const p0 = progressOf([]);
    const a = portion(p0, book, d(p0, T0));
    expect(a.size).toBe(5);
    expect(a.next.map((v) => v.id)).toEqual(book.home.slice(0, 5).map((v) => v.id));
    const p1 = progressOf(a.next.slice(0, 2).map((v, i) => intro(v.id, T0 + i)));
    const b = portion(p1, book, d(p1, T0 + 10));
    expect(b.done).toBe(2);
    expect(b.left).toBe(3);
    expect(b.next[0]!.id).toBe(book.home[2]!.id);
    const p2 = progressOf(book.home.slice(0, 5).map((v, i) => intro(v.id, T0 + i)));
    expect(portion(p2, book, d(p2, T0 + 10)).left).toBe(0);
    // Назавтра — новая порция, следующие слова.
    const next = portion(p2, book, d(p2, T0 + DAY));
    expect(next.left).toBe(5);
    expect(next.next[0]!.id).toBe(book.home[5]!.id);
    // Настройка порции 3–8.
    expect(portion(setSetting(p0, 'wola.portion', 3, T0), book, d(p0, T0)).next.length).toBe(3);
  });

  it('полка: темы дома, взято / всего, следующие 5 темы; слова с полки не дублируют порцию', () => {
    const p0 = progressOf([]);
    const s0 = shelf(book, d(p0, T0));
    expect(s0.some((t) => t.theme.id === 'jedzenie')).toBe(false);
    const miasto = s0.find((t) => t.theme.id === 'miasto')!;
    expect(miasto.taken).toBe(0);
    expect(miasto.next.length).toBe(5);
    const p1 = progressOf(miasto.next.map((v, i) => intro(v.id, T0 + i, 'wola.slownik.miasto')));
    const m1 = shelf(book, d(p1, T0 + 10)).find((t) => t.theme.id === 'miasto')!;
    expect(m1.taken).toBe(5);
    expect(m1.next.some((v) => miasto.next.includes(v))).toBe(false);
    // Слова с полки не считаются в порцию ноутбука, но и не предлагаются ей снова.
    const por = portion(p1, book, d(p1, T0 + 10));
    expect(por.done).toBe(0);
    expect(por.next.some((v) => miasto.next.some((x) => x.id === v.id))).toBe(false);
  });

  it('мягкий потолок: 8 по умолчанию, настройка 4–12; выше — предупреждение, не запрет', () => {
    const p = progressOf(book.home.slice(0, 5).map((v, i) => intro(v.id, T0 + i)));
    const c = dayCap(p, d(p, T0 + 10));
    expect(c).toEqual({ today: 5, cap: 8 });
    expect(overCap(c, 3)).toBe(false);
    expect(overCap(c, 5)).toBe(true);
    expect(dayCap(setSetting(p, 'newItemsPerDay', 12, T0), d(p, T0 + 10)).cap).toBe(12);
  });

  it('огород: семя → «!» назавтра → удобрение растит; зрелое (≥ 21 дня) собирается в банку', () => {
    const item = book.home[0]!.id;
    let p = progressOf([intro(item, T0)]);
    let g = wolaGarden(d(p, T0 + 1), T0 + 1, content.tuning, p.world.flags);
    expect(g.plants.map((x) => [x.item, x.stage, !!x.dueCard])).toEqual([[item, 'seed', false]]);
    g = wolaGarden(d(p, T0 + DAY), T0 + DAY, content.tuning, p.world.flags);
    expect(g.due).toBe(1);
    // Удобрение по `lis` тоже растит (стадия — лучшая из rec и lis).
    p = progressOf([intro(item, T0), { k: 'rev', ts: T0 + DAY, card: `${item}#lis`, g: 2, ms: 3000, src: 'express' }]);
    expect(wolaGarden(d(p, T0 + DAY + 1), T0 + DAY + 1, content.tuning, p.world.flags).plants[0]!.stage).toBe('sprout');
    // Серия верных повторов: 1 → 3 → 7 → 16 → 35 дней: на 35 (≥ 21) — зрелое.
    const drafts: EventDraft[] = [intro(item, T0)];
    let ts = T0;
    for (const gap of [1, 3, 7, 16, 35]) {
      ts += gap * DAY;
      drafts.push({ k: 'rev', ts, card: `${item}#rec`, g: 2, ms: 2000, src: 'obchod' });
    }
    p = progressOf(drafts);
    const now = ts + 1;
    g = wolaGarden(d(p, now), now, content.tuning, p.world.flags);
    expect(g.plants[0]!.ripe).toBe(true);
    expect(g.ripe).toBe(1);
    // Незрелое не собирается; зрелое — флаг, растение уходит банкой на полку.
    expect(harvest(progressOf([intro(item, T0)]), { item, ripe: false }, now).world.flags).toEqual({});
    const p2 = harvest(p, g.plants[0]!, now);
    expect(p2.world.flags[jarFlag(item)]).toBe(now);
    const g2 = wolaGarden(d(p2, now), now, content.tuning, p2.world.flags);
    expect(g2.plants).toEqual([]);
    expect(g2.jars.map((j) => j.item)).toEqual([item]);
  });

  it('счётчики хаба и итог дня', () => {
    const items = book.home.slice(0, 3).map((v) => v.id);
    const p = progressOf([...items.map((it, i) => intro(it, T0 + i)), { k: 'rev', ts: T0 + DAY + 10, card: `${items[0]}#rec`, g: 2, ms: 60_000, src: 'obchod' }]);
    const now = T0 + DAY + 20;
    const c = hubCounters(p, book, d(p, now), now, content.tuning);
    expect(c.dom).toBe(5);
    expect(c.due).toBe(2);
    expect(counterText('dom', c)).toEqual({ text: 'новых слов: 5' });
    expect(counterText('ogrod', c)).toEqual({ text: '! 2', due: true });
    expect(counterText('salad', c)).toBeNull(); // нет данных Salad Story — подписи нет
    expect(counterText('salad', { ...c, salad: { text: 'уровень 1' } })?.text).toBe('уровень 1');
    const day = wolaDay(p, dc, now, TZ);
    expect(day.added).toEqual([]);
    expect(day.fertilized).toBe(1);
    expect(day.grewWola.map((x) => [x.item, x.from, x.to])).toEqual([[items[0], 'seed', 'sprout']]);
    expect(day.retrievalMs).toBe(60_000);
    expect(wolaDay(p, dc, T0 + 100, TZ).added).toEqual(items);
  });
});

// ───────────────────────────── экраны ─────────────────────────────

describe('экраны Wola', () => {
  it('ноутбук: 5 карточек «Dodaj» → 5 intro (wola.laptop) → проверка choice из 4 → семена в огороде', async () => {
    const { w, store, sfx } = deps(progressOf([]), T0, { typeMs: 1 });
    const words = portion(store.progress, book, d(store.progress, T0)).next;
    const run = runSlowniczek(w, { words, lesson: LAPTOP_LESSON, title: { pl: 'Słowniczek', ru: 'новые слова' } });
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 40));
      expect(q('[data-word]')?.textContent).toBe(words[i]!.pl);
      expect(q('[data-ru]')?.textContent).toBe(words[i]!.ru);
      expect(q('[data-progress]')?.getAttribute('data-progress')).toBe(String(i));
      click('[data-act="add"]');
      await flush();
    }
    expect(sfx.length).toBeGreaterThan(5); // стук клавиш при печати
    const intros = store.progress.log.events.filter((e) => e.k === 'intro');
    expect(intros.map((e) => (e as { item: string }).item)).toEqual(words.map((v) => v.id));
    expect(intros.every((e) => (e as { lesson: string; ok: string[] }).lesson === LAPTOP_LESSON && (e as { ok: string[] }).ok.length === 0)).toBe(true);
    // Проверка узнаванием: 4 варианта.
    await flush();
    expect(host.querySelectorAll('.wl-screen [data-opt]').length).toBe(4);
    expect(await solve(host.querySelector('.wl-screen')!)).toBe(5);
    await flush();
    expect(q('[data-check]')?.getAttribute('data-check')).toBe('5/5');
    click('[data-act="done"]');
    const r = await run;
    expect(r).toEqual({ added: words.map((v) => v.id), check: { right: 5, total: 5 } });
    expect(store.progress.log.events.some((e) => e.k === 'lesson' && e.lesson === CHECK_LESSON)).toBe(true);
    // В огороде — 5 семян.
    const g = wolaGarden(d(store.progress, T0 + 1000), T0 + 1000, content.tuning, store.progress.world.flags);
    expect(g.plants.map((x) => x.stage)).toEqual(['seed', 'seed', 'seed', 'seed', 'seed']);
  });

  it('проверка: варианты — переводы слов порции и темы, верный среди них', () => {
    const words = book.home.slice(0, 5);
    const steps = checkSteps(words, book.vocab);
    expect(steps.length).toBe(5);
    for (const [i, s] of steps.entries()) {
      if (s.t !== 'choice') throw new Error('choice');
      expect(s.options.length).toBe(4);
      expect(s.options[s.answer]).toBe(words[i]!.ru);
      expect(new Set(s.options).size).toBe(4);
    }
  });

  it('дом: ноутбук со счётчиком, полка темы сверх порции, потолок предупреждает, но не запрещает', async () => {
    const p = progressOf(book.home.slice(0, 5).map((v, i) => intro(v.id, T0 + i)));
    const { w, store } = deps(p, T0 + 1000);
    const home = runHome(w);
    await flush();
    expect(q('[data-place="dom"]')).not.toBeNull();
    expect(q('[data-count="laptop"]')).toBeNull(); // порция на сегодня сделана
    for (const id of ['laptop', 'slownik', 'sloiki', 'lozko']) expect(q(`[data-spot="${id}"]`)).not.toBeNull();
    click('[data-spot="slownik"]');
    await flush();
    expect(q('[data-panel="slownik"]')?.textContent).toContain('Сегодня новых: 5 из 8');
    click('[data-theme="liczby"]');
    await flush();
    // 5 + 5 > 8: предупреждение.
    expect(q('[data-warn="cap"]')?.textContent).toBe('Много на сегодня, огород не справится.');
    click('[data-panel="cap"] [data-act="yes"]');
    await flush();
    for (let i = 0; i < 5; i++) {
      click('[data-act="add"]');
      await flush();
    }
    // Проверку прерываем: слова уже добавлены.
    click('.wl-screen .pq-lesson [data-act="close"]');
    await flush();
    click('[data-act="done"]');
    await flush();
    const added = store.progress.log.events.filter((e) => e.k === 'intro' && e.lesson === 'wola.slownik.liczby');
    expect(added.length).toBe(5);
    expect(dayCap(store.progress, d(store.progress, T0 + 2000)).today).toBe(10);
    click('[data-panel="slownik"] [data-act="close"]');
    await flush();
    click('.wl-dom [data-act="close"]');
    await home;
  });

  it('потолок: «Не сейчас» — ничего не добавлено', async () => {
    const p = progressOf(book.home.slice(0, 8).map((v, i) => intro(v.id, T0 + i)));
    const { w } = deps(p, T0 + 1000);
    const r = capOk(w, 1);
    await flush();
    click('[data-panel="cap"] [data-act="no"]');
    expect(await r).toBe(false);
    const { w: w2 } = deps(progressOf([]), T0);
    expect(await capOk(w2, 5)).toBe(true);
    void slownik;
  });

  it('огород: «!» назавтра, «Nawóz» удобряет всё, растения растут; зрелое — «Zbiór» в банку, банка дома', async () => {
    const items = book.home.slice(0, 3).map((v) => v.id);
    const { w, store, setNow } = deps(progressOf(items.map((it, i) => intro(it, T0 + i))), T0 + DAY);
    const garden = runGarden(w);
    await flush();
    expect(q('.wl-garden')?.getAttribute('data-due')).toBe('3');
    expect(host.querySelectorAll('[data-plant][data-due]').length).toBe(3);
    click('[data-act="nawoz"]');
    expect(await solve(host.querySelector('.pq-obchod-layer')!, w.audio as ReturnType<typeof fakeAudio>)).toBe(3);
    await flush();
    click('.pq-obchod-layer [data-act="ok"]');
    await flush();
    expect(q('.wl-garden')?.getAttribute('data-due')).toBe('0');
    expect([...host.querySelectorAll('[data-plant]')].map((b) => b.getAttribute('data-stage'))).toEqual(['sprout', 'sprout', 'sprout']);
    expect(store.progress.log.events.filter((e) => e.k === 'rev' && e.src === 'express').length).toBe(3);
    click('.wl-ogrod [data-act="close"]');
    await garden;

    // Зрелое слово: история повторов до 35 дней → «Zbiór».
    const item = items[0]!;
    const drafts: EventDraft[] = [intro(item, T0)];
    let ts = T0;
    for (const gap of [1, 3, 7, 16, 35]) {
      ts += gap * DAY;
      drafts.push({ k: 'rev', ts, card: `${item}#rec`, g: 2, ms: 2000, src: 'obchod' });
      drafts.push({ k: 'rev', ts, card: `${item}#lis`, g: 2, ms: 2000, src: 'obchod' });
    }
    const r2 = deps(progressOf(drafts), ts + 1000);
    const garden2 = runGarden(r2.w);
    await flush();
    expect(q('[data-plant]')?.getAttribute('data-stage')).toBe('ripe');
    click('[data-act="zbior"]');
    await flush();
    click('[data-panel="zbior"] [data-act="yes"]');
    await flush();
    expect(r2.store.progress.world.flags[jarFlag(item)]).toBe(ts + 1000);
    expect(host.querySelectorAll('[data-plant]').length).toBe(0);
    click('.wl-ogrod [data-act="close"]');
    await garden2;
    // Банка на полке дома.
    const home = runHome(r2.w);
    await flush();
    expect(q('[data-spot="sloiki"] [data-count]')?.textContent).toBe('банок: 1');
    click('[data-spot="sloiki"]');
    await flush();
    expect(q(`[data-jar="${item}"]`)).not.toBeNull();
    click('[data-panel="sloiki"] [data-act="close"]');
    await flush();
    click('.wl-dom [data-act="close"]');
    await home;
    void setNow;
  });

  it('кровать: итог дня и «Do jutra» — session + seg sleep, назад на улицу', async () => {
    const items = book.home.slice(0, 2).map((v) => v.id);
    const p = progressOf([...items.map((it, i) => intro(it, T0 + i))]);
    let sessions = 0;
    const { w, store } = deps(p, T0 + 3_600_000, { activeMs: () => 5 * 60_000, sessionStart: () => T0, onSession: () => sessions++ });
    const home = runHome(w);
    await flush();
    click('[data-spot="lozko"]');
    await flush();
    expect(q('[data-stat="added"] b')?.textContent).toBe('2');
    expect(q('[data-stat="fertilized"] b')?.textContent).toBe('0');
    expect(q('[data-stat="harvested"] b')?.textContent).toBe('0');
    expect(q('[data-stat="active"] b')?.textContent).toBe('5 мин');
    click('[data-panel="lozko"] [data-act="sleep"]');
    await home; // «Do jutra» закрывает дом
    const tail = store.progress.log.events.slice(-2).map((e) => e.k);
    expect(tail).toEqual(['session', 'seg']);
    expect(sessions).toBe(1);
  });
});

// ───────────────────────────── хаб и переходы ─────────────────────────────

describe('хаб Wola', () => {
  it('карта хаба: ходьба, три двери place:<id>, спавн возврата у каждой, без бобра', () => {
    const hub = content.maps.get(HUB_MAP)!.value;
    expect(hub.controls).toBe('walk');
    const doors = hub.objects.filter((o) => o.type === 'exit').map((o) => [placeOf((o as { to: string }).to), o.at]);
    expect(doors.map((x) => x[0]).sort()).toEqual(['dom', 'ogrod', 'salad']);
    for (const [id, at] of doors) {
      const sp = hub.spawns[PLACE_SPAWN[id as 'dom']]!;
      // Спавн возврата — соседняя клетка двери.
      expect(Math.abs(sp[0]! - (at as number[])[0]!) + Math.abs(sp[1]! - (at as number[])[1]!)).toBe(1);
    }
    expect(hub.objects.some((o) => o.type === 'npc')).toBe(false);
    // Быстро: от двери до двери не больше 6 с ходьбы (4,5 клетки/с) — манхэттен ≤ 27 клеток.
    const at = doors.map((x) => x[1] as number[]);
    for (const a of at) for (const b of at) expect(Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!)).toBeLessThanOrEqual(27);
  });

  it('переходы: выход place:dom → телепорт к двери и экран места; повторный вход, пока открыт, не открывается', async () => {
    const bus = testBus();
    const tp: unknown[] = [];
    bus.on('world:teleport', (e) => tp.push(e));
    const opened: string[] = [];
    let close!: () => void;
    const routes = routePlaces(bus, { run: (id) => (opened.push(id), new Promise<void>((r) => (close = r))) });
    bus.emit('world:exit', { from: HUB_MAP, to: 'place:dom' });
    bus.emit('world:exit', { from: HUB_MAP, to: 'place:ogrod' });
    expect(opened).toEqual(['dom']);
    expect(tp).toEqual([{ location: HUB_MAP, spawn: 'from_dom', facing: 'down' }]);
    expect(routes.busy).toBe(true);
    close();
    await flush();
    expect(routes.busy).toBe(false);
    bus.emit('world:exit', { from: HUB_MAP, to: 'place:salad' });
    bus.emit('world:exit', { from: HUB_MAP, to: 'ch01.metro' }); // не место — не наше
    expect(opened).toEqual(['dom', 'salad']);
    routes.dispose();
  });

  it('подписи мест: по world:spots над дверями, со счётчиками; прячутся под экраном места; тап — дойти', () => {
    const bus = testBus();
    const went: string[] = [];
    const hub = mountHub(host, { bus, counters: () => ({ dom: 5, due: 3, ripe: 1, jarsDue: 0 }), goTo: (id) => went.push(id), settings: () => undefined });
    bus.emit('world:spots', { location: HUB_MAP, spots: [{ id: 'dom', x: 100, y: 200, cell: 32 }, { id: 'ogrod', x: 150, y: 400, cell: 32 }] });
    const dom = q<HTMLButtonElement>('.wl-spot[data-place="dom"]')!;
    expect(dom.hidden).toBe(false);
    expect(dom.style.top).toBe('198px');
    expect(q('[data-count="dom"]')?.textContent).toBe('новых слов: 5');
    expect(q('[data-count="ogrod"]')?.textContent).toBe('! 3 · ★ 1');
    expect(q<HTMLButtonElement>('.wl-spot[data-place="salad"]')!.hidden).toBe(true);
    dom.click();
    expect(went).toEqual(['dom']);
    bus.emit('world:input', { enabled: false });
    expect(q<HTMLElement>('.wl-spots')!.hidden).toBe(true);
    bus.emit('world:input', { enabled: true });
    expect(q<HTMLElement>('.wl-spots')!.hidden).toBe(false);
    hub.dispose();
  });
});

// ───────────────────────────── сохранение ─────────────────────────────

describe('сохранение Wola отдельно от основной игры', () => {
  function fakeLs(): StorageLike & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
  }

  it('localStorage: ключи Wola с пространством `wola:`, основная игра их не видит и наоборот', async () => {
    const ls = fakeLs();
    const main = new GameStorage({ idb: null, ls, randomId: (n) => 'a'.repeat(n) });
    await main.load(T0);
    main.append(intro('lx.kawa', T0, 'ch01.s01'));
    await main.flush();
    const wola = new GameStorage({ idb: null, ls, lsNamespace: 'wola:', randomId: (n) => 'b'.repeat(n) });
    const r = await wola.load(T0);
    expect(r.created).toBe(true); // мир Wola новый, прогресс основной игры не подхвачен
    wola.append(intro('lx.dzien_dobry', T0));
    await wola.flush();
    expect(ls.map.has(KEYS.progress)).toBe(true);
    expect(ls.map.has(`wola:${KEYS.progress}`)).toBe(true);
    const mainAgain = new GameStorage({ idb: null, ls });
    await mainAgain.load(T0);
    expect(mainAgain.progress.log.events.map((e) => (e as { item?: string }).item)).toEqual(['lx.kawa']);
    const wolaAgain = new GameStorage({ idb: null, ls, lsNamespace: 'wola:' });
    await wolaAgain.load(T0);
    expect(wolaAgain.progress.log.events.map((e) => (e as { item?: string }).item)).toEqual(['lx.dzien_dobry']);
    // Ключи бэкенда: каждый видит только своё.
    expect((await lsKV(ls).keys()).sort()).toEqual([KEYS.local, KEYS.progress].sort());
    expect((await lsKV(ls, 'pq_', 'wola:').keys()).sort()).toEqual([KEYS.local, KEYS.progress].sort());
  });

  it('аварийная копия (pagehide) Wola не попадает в основную игру', async () => {
    const ls = fakeLs();
    ls.setItem(KEYS.tail, JSON.stringify(progressOf([intro('lx.kawa', T0, 'ch01.s01')], newProgress(T0, 'mainworld'))));
    const wola = new GameStorage({ idb: null, ls, lsNamespace: 'wola:' });
    const r = await wola.load(T0);
    expect(r.recovered).toBe(false);
    expect(wola.progress.worldId).not.toBe('mainworld');
  });
});
