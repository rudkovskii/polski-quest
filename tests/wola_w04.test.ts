// @vitest-environment happy-dom
// W-04: правки по первому плейтесту Wola. Service worker и /wola/ (п. 2), ходьба: тап = шаг, A у двери, карта без
// перекрытий, клавиши 1/2/3 (п. 3), ловушки написания и дистракторы той же темы (п. 5), ноутбук «Сначала огород» и
// полоса «Wola», огород с нормой дня (пп. 1, 7), загрузчик мест (п. 7), профили ?dev=<id> и «Начать заново» (п. 8).
// План дня и симуляция 14 дней — tests/wola_plan.test.ts; лестница Salad Story — tests/salad.test.ts (W-04).
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardSource } from '../src/input/keyboard';
import { createRouter } from '../src/input/router';
import type { RoutedIntent } from '../src/input/types';
import { createBus } from '../src/systems/bus';
import { deriveContent, derive } from '../src/systems/derive';
import type { EventDraft } from '../src/systems/log';
import { answerWhichPage, WHICH_PAGE } from '../src/systems/platform/pwa';
import { GameStorage, KEYS, memoryKV, type StorageLike } from '../src/systems/platform/storage';
import { append, newProgress, setSetting, type Progress } from '../src/systems/progress';
import { spellingCandidates, spellingTraps } from '../src/systems/spelling';
import type { BusEvents } from '../src/types/bus';
import type { LocationMap, VocabEntry } from '../src/types/content';
import { findPath } from '../src/world/pathfind';
import { LocationModel, STEP_MS, type WorldEvent } from '../src/world/location';
import { listen } from '../src/ui/exercises/listen';
import type { ExerciseCtx } from '../src/ui/exercises/types';
import { createOverlay } from '../src/ui/overlay/host';
import { runSettings } from '../src/ui/settings';
import { wolaContentFrom } from '../src/wola/content';
import { routePlaces } from '../src/wola/places';
import { wolaProfile } from '../src/wola/profile';
import { HUB_MAP, PLACE_SPAWN } from '../src/wola/systems/places';
import { sameThemeWrong, wolaCardStep } from '../src/wola/systems/steps';
import { LAPTOP_LESSON, wolaBook } from '../src/wola/systems/wola';
import { runGarden } from '../src/wola/ui/garden';
import { runHome } from '../src/wola/ui/home';
import { JUMP_KEYS, labelAt, mountHub } from '../src/wola/ui/hub';
import { openPlace, type WolaDeps } from '../src/wola/ui/kit';
import { preloadPixImages } from '../src/wola/ui/pix';
import { BASE, WOLA_NAV, WOLA_SW_ADDON, workboxOptions } from '../tools/lib/pwa';
import { readContentDir } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';
import { fakeAudio, flush, memStore, testBus } from './overlayKit';

const DAY = 86_400_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 15, 8);

const disk = readContentDir(join(ROOT, 'content')).files;
const { content, vocab, salad } = wolaContentFrom(Object.fromEntries([...disk].map(([k, v]) => [`/content/${k}`, v])));
const book = wolaBook(vocab);
const dc = deriveContent(content);
const hub = content.maps.get(HUB_MAP)!.value as LocationMap;

function progressOf(drafts: EventDraft[], p0: Progress = newProgress(T0 - DAY, 'w04')): Progress {
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
  const w: WolaDeps = {
    overlay: createOverlay(host, { bus }),
    content,
    book,
    store,
    bus,
    audio: fakeAudio(),
    atlas: null,
    salad,
    clock: { now: () => now, mono: () => 0 },
    tz: TZ,
    typeMs: 0,
    spellTraps: true,
    ...extra,
  };
  return { w, store, bus };
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => host.querySelector<T>(sel);

// ───────────────────────────── п. 2: service worker ─────────────────────────────

describe('W-04 п. 2: service worker и /wola/', () => {
  it('конфигурация Workbox: fallback основной игры не берёт /wola, sw-wola.js подключён первым', () => {
    const o = workboxOptions();
    expect(o.navigateFallback).toBe('index.html');
    expect(o.navigateFallbackDenylist).toContain(WOLA_NAV);
    expect(o.importScripts).toEqual([WOLA_SW_ADDON]);
    // Workbox сверяет pathname + search.
    for (const u of ['/polski-quest/wola', '/polski-quest/wola/', '/polski-quest/wola/?mute=1&dev=w41', '/polski-quest/wola?mute=1', '/polski-quest/wola/index.html'])
      expect(WOLA_NAV.test(u), u).toBe(true);
    for (const u of ['/polski-quest/', '/polski-quest/?dev=play', '/polski-quest/wolanka/', '/polski-quest/index.html']) expect(WOLA_NAV.test(u), u).toBe(false);
    expect(existsSync(join(ROOT, 'public', WOLA_SW_ADDON))).toBe(true);
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).toMatch(/workbox: workboxOptions\(\)/);
  });

  /** public/sw-wola.js в поддельном окружении service worker'а. */
  function swEnv(clients: { url: string; answer: string | null }[]) {
    const handlers: Record<string, ((e: unknown) => void)[]> = {};
    const navigated: string[] = [];
    const page = new Response('<!doctype html><title>Wola</title>', { headers: { 'content-type': 'text/html' } });
    const cache = { match: vi.fn(async (url: string, o?: { ignoreSearch?: boolean }) => (url === `https://x.test${BASE}wola/index.html` && o?.ignoreSearch ? page.clone() : undefined)) };
    const caches = { keys: async () => ['pq-audio', 'workbox-precache-v2-https://x.test/polski-quest/'], open: async () => cache };
    const fetchMock = vi.fn(async () => new Response('net'));
    const self = {
      registration: { scope: `https://x.test${BASE}` },
      addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] ??= []).push(h),
      clients: {
        claim: vi.fn(async () => undefined),
        matchAll: async () =>
          clients.map((c) => ({
            url: c.url,
            postMessage: (_m: unknown, ports: MessagePort[]) => {
              if (c.answer) ports[0]!.postMessage({ page: c.answer });
            },
            navigate: async (u: string) => {
              navigated.push(u);
            },
          })),
      },
    };
    const code = readFileSync(join(ROOT, 'public', WOLA_SW_ADDON), 'utf8');
    new Function('self', 'caches', 'fetch', code)(self, caches, fetchMock);
    const fire = (type: string, e: Record<string, unknown>): void => {
      for (const h of handlers[type] ?? []) h(e);
    };
    return { fire, navigated, fetchMock, claim: self.clients.claim };
  }

  it('sw-wola.js: навигация под /wola — страница Wola из precache, остальное не трогает', async () => {
    const env = swEnv([]);
    const responded: Promise<Response>[] = [];
    const nav = (url: string, mode = 'navigate') => env.fire('fetch', { request: { url, mode }, respondWith: (p: Promise<Response>) => responded.push(p) });
    nav(`https://x.test${BASE}wola/?mute=1&dev=w41`);
    nav(`https://x.test${BASE}wola`);
    nav(`https://x.test${BASE}`);
    nav(`https://x.test${BASE}?dev=play`);
    nav(`https://x.test${BASE}wola/assets/x.js`, 'no-cors');
    expect(responded).toHaveLength(2);
    for (const r of responded) expect(await (await r).text()).toContain('<title>Wola</title>');
    expect(env.fetchMock).not.toHaveBeenCalled();
  });

  it('sw-wola.js: новый SW перезагружает вкладку /wola с чужой страницей (старая основная игра), Wola не трогает', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const env = swEnv([
        { url: `https://x.test${BASE}wola/?mute=1`, answer: null },
        { url: `https://x.test${BASE}wola/`, answer: 'wola' },
        { url: `https://x.test${BASE}`, answer: null },
      ]);
      let done: Promise<unknown> = Promise.resolve();
      env.fire('activate', { waitUntil: (p: Promise<unknown>) => (done = p) });
      await vi.advanceTimersByTimeAsync(2000);
      await done;
      expect(env.claim).toHaveBeenCalled();
      expect(env.navigated).toEqual([`https://x.test${BASE}wola/?mute=1`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('страница Wola отвечает service worker\'у «wola»', async () => {
    const listeners: ((e: MessageEvent) => void)[] = [];
    answerWhichPage('wola', { addEventListener: ((_t: string, h: (e: MessageEvent) => void) => listeners.push(h)) as never, startMessages: () => undefined });
    const ch = new MessageChannel();
    const got = new Promise<unknown>((r) => (ch.port1.onmessage = (e) => r(e.data)));
    for (const h of listeners) h({ data: { type: WHICH_PAGE }, ports: [ch.port2] } as unknown as MessageEvent);
    expect(await got).toEqual({ page: 'wola' });
    ch.port1.close();
  });
});

// ───────────────────────────── п. 3: ходьба ─────────────────────────────

function stepAll(m: LocationModel, ms: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let t = 0; t < ms; t += 16) out.push(...m.update(16));
  return out;
}

describe('W-04 п. 3: ходьба по Воле', () => {
  it('короткий тап в другую сторону — поворот и шаг; удержание — идти; без tapStep — только поворот (основная игра)', () => {
    const spawn = hub.spawns['from_dom']! as [number, number];
    const m = new LocationModel(hub, spawn, { facing: 'down', companion: false, tapStep: true, doorA: true });
    m.intent({ type: 'move', dir: 'right', held: true });
    m.intent({ type: 'move', dir: 'right', held: false });
    stepAll(m, STEP_MS * 3);
    expect(m.player.tile).toEqual([spawn[0] + 1, spawn[1]]);
    expect(m.player.facing).toBe('right');
    // Удержание: идёт, пока держат.
    m.intent({ type: 'move', dir: 'right', held: true });
    stepAll(m, STEP_MS * 3 + 10);
    m.intent({ type: 'move', dir: 'right', held: false });
    stepAll(m, STEP_MS * 2);
    expect(m.player.tile[0]).toBeGreaterThanOrEqual(spawn[0] + 4);
    // Основная игра: короткое нажатие — только поворот.
    const main = new LocationModel(hub, spawn, { facing: 'down', companion: false });
    main.intent({ type: 'move', dir: 'right', held: true });
    main.intent({ type: 'move', dir: 'right', held: false });
    stepAll(main, STEP_MS * 3);
    expect(main.player.tile).toEqual(spawn);
    expect(main.player.facing).toBe('right');
  });

  it('A у двери — войти: перед дверью, по диагонали и в паре шагов', () => {
    for (const [id, spawn] of Object.entries(PLACE_SPAWN)) {
      const at = hub.spawns[spawn]! as [number, number];
      const m = new LocationModel(hub, at, { facing: 'left', companion: false, tapStep: true, doorA: true });
      expect(m.actionHint()?.key, id).toMatch(/^exit:/);
      m.intent({ type: 'interact' });
      const ev = stepAll(m, STEP_MS * 4).find((e) => e.type === 'exit');
      expect(ev && ev.type === 'exit' ? ev.to : null, id).toBe(`place:${id}`);
    }
    // В двух шагах от двери дома (сбоку) — A тоже ведёт в дверь.
    const m = new LocationModel(hub, [4, 6], { facing: 'down', companion: false, doorA: true });
    m.intent({ type: 'interact' });
    const ev = stepAll(m, STEP_MS * 6).find((e) => e.type === 'exit');
    expect(ev && ev.type === 'exit' ? ev.to : null).toBe('place:dom');
    // Без doorA (основная игра) A у двери молчит.
    const plain = new LocationModel(hub, hub.spawns['from_dom'] as [number, number], { facing: 'up', companion: false });
    expect(plain.actionHint()).toBeNull();
  });

  it('карта: прямые пути между тремя дверями, декор не на пути; от огорода до дома ≤ 8 шагов', () => {
    const m = new LocationModel(hub, [5, 7], { companion: false });
    const doors = Object.fromEntries(hub.objects.filter((o) => o.type === 'exit').map((o) => [(o as { to: string }).to.slice(6), o.at as [number, number]]));
    const man = (a: number[], b: number[]) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!);
    for (const [from, spawn] of Object.entries(PLACE_SPAWN))
      for (const [to, door] of Object.entries(doors)) {
        if (from === to) continue;
        const s = hub.spawns[spawn]!;
        const p = findPath(m.walkGrid(door), [s[0]!, s[1]!], door);
        expect(p.exact, `${from}→${to}`).toBe(true);
        // Без обходов: путь = манхэттенское расстояние (трамвай, фонари, лавка не мешают), и не длиннее 8.
        expect(p.path.length, `${from}→${to}`).toBe(man(s, door));
        expect(p.path.length, `${from}→${to}`).toBeLessThanOrEqual(8);
      }
    // ≈ 2 с удержания: 8 клеток при 4,5 клетки/с.
    expect(8 * STEP_MS).toBeLessThanOrEqual(2000);
  });

  it('подписи мест не закрывают двери: над домом и салатной — выше двери, у огорода — под калиткой', () => {
    expect(labelAt('dom', { x: 100, y: 200, cell: 40 })).toEqual({ x: 100, y: 180, below: false });
    expect(labelAt('salad', { x: 100, y: 200, cell: 40 }).y).toBeLessThan(200);
    expect(labelAt('ogrod', { x: 100, y: 200, cell: 40 })).toEqual({ x: 100, y: 242, below: true });
  });

  it('клавиши 1/2/3: intent hotkey в мир; в оверлее — выбрать вариант ответа с этим номером', () => {
    const bus = createBus<BusEvents>();
    const got: RoutedIntent[] = [];
    bus.on('input:intent', (i) => got.push(i));
    const r = createRouter({ bus, coarse: false });
    const kb = createKeyboardSource(r, document);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', bubbles: true, cancelable: true }));
    expect(got.at(-1)).toMatchObject({ type: 'hotkey', n: 3, to: 'world' });
    // Оверлей: цифра 2 — второй вариант.
    const ov = createOverlay(host, { bus });
    const layer = ov.open();
    const picked: number[] = [];
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.dataset['opt'] = String(i);
      b.onclick = () => picked.push(i);
      layer.el.append(b);
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', bubbles: true, cancelable: true }));
    expect(got.at(-1)).toMatchObject({ type: 'hotkey', n: 2, to: 'ui' });
    expect(picked).toEqual([1]);
    layer.close();
    ov.dispose();
    kb.dispose();
    r.dispose();
  });

  it('кнопки мест в углу улицы: 1 дом, 2 Salad Story, 3 огород — мгновенный переход', () => {
    const bus = testBus();
    const jumped: string[] = [];
    const h = mountHub(host, { bus, counters: () => null, goTo: () => undefined, settings: () => undefined, jump: (id) => jumped.push(id) });
    const bs = [...host.querySelectorAll<HTMLButtonElement>('[data-jump]')];
    expect(bs.map((b) => b.dataset['jump'])).toEqual(JUMP_KEYS.map((j) => j.id));
    expect(bs.map((b) => b.querySelector('.k')?.textContent)).toEqual(['1', '2', '3']);
    bs[2]!.click();
    expect(jumped).toEqual(['ogrod']);
    bus.emit('world:input', { enabled: false });
    expect(q<HTMLElement>('[data-hub="jump"]')!.hidden).toBe(true);
    h.dispose();
  });

  it('переход «после этого места»: queue открывает место, когда текущее закрыто', async () => {
    const bus = testBus();
    const opened: string[] = [];
    let close!: () => void;
    const r = routePlaces(bus, {
      run: (id) => {
        opened.push(id);
        return id === 'dom' ? new Promise<void>((res) => (close = res)) : Promise.resolve();
      },
    });
    void r.open('dom');
    r.queue('ogrod');
    expect(opened).toEqual(['dom']);
    close();
    await flush();
    expect(opened).toEqual(['dom', 'ogrod']);
    r.dispose();
  });
});

// ───────────────────────────── п. 5: угадывание без знания ─────────────────────────────

describe('W-04 п. 5: дистракторы', () => {
  it('ловушки написания: rz/ż, ó/u, ę/e, sz/ś… того же слова; настоящие слова словаря не ловушки', () => {
    expect(spellingCandidates('rzeka')).toContain('żeka');
    expect(spellingCandidates('może')).toContain('morze');
    expect(spellingCandidates('góra')).toContain('gura');
    expect(spellingCandidates('proszę')).toEqual(expect.arrayContaining(['prosze', 'proszen', 'prośę']));
    expect(spellingCandidates('Dzień dobry')).toContain('Dzień dobri');
    // ci/si перед гласной — мягкость, не «ć»: ciasto ≠ ćasto.
    expect(spellingCandidates('ciasto')).not.toContain('ćasto');
    const words = new Set(['morze']);
    const t = spellingTraps('może', 2, 's', (s) => words.has(s));
    expect(t).toHaveLength(2);
    expect(t).not.toContain('morze');
    expect(spellingTraps('rzeka', 2, 'a')).toEqual(spellingTraps('rzeka', 2, 'a'));
    // Короткое слово без ловушек — сколько есть (добор — в упражнении).
    expect(spellingTraps('tak', 2, 'x').length).toBeLessThanOrEqual(2);
  });

  it('«Как это пишется?» без звука в Wola: варианты — написания того же слова, в вопросе перевод', async () => {
    const v = [...content.vocab.values()].map((x) => x.value).find((x) => x.pl === 'przepraszam')!;
    expect(v).toBeDefined();
    const root = document.createElement('div');
    host.append(root);
    const ctx: ExerciseCtx = {
      layer: { el: root, handle: () => undefined, closed: false, close: () => undefined },
      root,
      stepId: 'obchod.lx#lis',
      content: { vocab: (id) => content.vocab.get(id)?.value, allVocab: () => [...content.vocab.values()].map((x) => x.value), speaker: () => ({ name: '', portrait: null }) as never, known: () => true },
      audio: fakeAudio(false),
      diacritics: 'warn',
      translations: 'auto',
      keyboardMode: 'auto',
      now: () => 0,
      random: () => 0.5,
      silent: true,
      spellTraps: true,
    };
    void listen.mount({ t: 'listen', say: v.pl, options: `auto:${v.tags?.[0]}`, answer: 0, item: v.id }, ctx);
    await flush();
    const opts = [...root.querySelectorAll('[data-opt]')].map((b) => b.textContent ?? '');
    expect(opts).toContain('przepraszam');
    expect(opts).toHaveLength(3);
    // Все неверные — то же слово с ошибкой написания (rz/ż, sz/ś…), не другие слова.
    for (const o of opts.filter((x) => x !== 'przepraszam')) expect(spellingCandidates('przepraszam'), o).toContain(o);
    expect(root.querySelector('[data-gloss]')?.textContent).toContain(v.ru);
    // Без spellTraps (основная игра) — как раньше: другие слова.
    const root2 = document.createElement('div');
    host.append(root2);
    void listen.mount({ t: 'listen', say: v.pl, options: `auto:${v.tags?.[0]}`, answer: 0, item: v.id }, { ...ctx, root: root2, layer: { ...ctx.layer, el: root2 }, spellTraps: false });
    await flush();
    const opts2 = [...root2.querySelectorAll('[data-opt]')].map((b) => b.textContent ?? '');
    expect(opts2.filter((x) => x !== 'przepraszam').some((o) => spellingCandidates('przepraszam').includes(o))).toBe(false);
  });

  it('огород: «X — это…» — неверные переводы из той же темы, а не «река/манго»', () => {
    const all = [...content.vocab.values()].map((x) => x.value);
    const v = all.find((x) => x.id === 'lx.do_widzenia') ?? book.home[0]!;
    const themeRu = new Set(all.filter((x) => x.tags?.[0] === v.tags?.[0]).map((x) => x.ru));
    const wrong = sameThemeWrong(v, all, () => true);
    expect(wrong).toHaveLength(2);
    for (const w of wrong) expect(themeRu.has(w), w).toBe(true);
    const step = wolaCardStep(`${v.id}#rec`, (id) => content.vocab.get(id)?.value, all, () => true);
    expect(step).toMatchObject({ t: 'choice', options: [v.ru, ...wrong], answer: 0, item: v.id });
    expect(wolaCardStep(`${v.id}#lis`, (id) => content.vocab.get(id)?.value, all, () => true)).toMatchObject({ t: 'listen', say: v.pl });
    expect(wolaCardStep(`${v.id}#pair`, (id) => content.vocab.get(id)?.value, all, () => true)).toBeNull();
    // Еда к еде.
    const food = all.find((x) => x.id === 'lx.kurczak')!;
    const foodRu = new Set(all.filter((x) => x.tags?.[0] === food.tags?.[0]).map((x) => x.ru));
    for (const w of sameThemeWrong(food, all, () => true)) expect(foodRu.has(w), w).toBe(true);
  });
});

// ───────────────────────────── пп. 1, 7: дом и огород ─────────────────────────────

const intro = (item: string, ts: number): EventDraft => ({ k: 'intro', ts, item, lesson: LAPTOP_LESSON, ok: [] });

describe('W-04 пп. 1, 7: план дня в доме и огороде, полоса «Wola», загрузчик', () => {
  it('дом: план дня над комнатой; ноутбук при долге ≥ 20 — «Сначала огород», кнопка ведёт в огород', async () => {
    const p = progressOf(book.home.slice(0, 22).map((v, i) => intro(v.id, T0 - DAY + i)));
    const went: string[] = [];
    const { w } = deps(p, T0 + 3_600_000, { go: (id) => went.push(id) });
    const home = runHome(w);
    await flush();
    expect(q('.wl-dom .wl-plan')?.textContent).toBe('план на сегодня: удобрить 15, новых 0');
    expect(q('[data-count="laptop"]')?.textContent).toBe('сначала огород');
    q<HTMLElement>('[data-spot="laptop"]')!.click();
    await flush();
    expect(q('[data-garden-first]')).not.toBeNull();
    expect(q('[data-screen="slowniczek-rest"] [data-plan]')?.textContent).toBe('план на сегодня: удобрить 15, новых 0');
    q<HTMLElement>('.wl-laptop-layer [data-act="go"]')!.click();
    await home;
    expect(went).toEqual(['ogrod']);
  });

  it('ноутбук: полоса «Wola» над ноутбуком видна и в проверке — уходит на улицу', async () => {
    const { w, store } = deps(progressOf([]), T0);
    const home = runHome(w);
    await flush();
    q<HTMLElement>('[data-spot="laptop"]')!.click();
    await flush();
    expect(q('.wl-laptop-layer .wl-laptop-bar [data-act="leave"]')).not.toBeNull();
    expect(q('[data-screen="slowniczek"] [data-plan]')?.textContent).toMatch(/^план на сегодня: удобрить 0, новых 5$/);
    for (let i = 0; i < 5; i++) {
      q<HTMLElement>('.wl-laptop-layer [data-act="add"]')!.click();
      await flush();
    }
    // Идёт проверка: выход по-прежнему виден.
    expect(q('.wl-laptop-layer .pq-lesson')).not.toBeNull();
    q<HTMLElement>('.wl-laptop-layer .wl-laptop-bar [data-act="leave"]')!.click();
    await home;
    expect(q('.wl-laptop-layer')).toBeNull();
    expect(q('.wl-dom')).toBeNull();
    expect(store.progress.log.events.filter((e) => e.k === 'intro')).toHaveLength(5);
  });

  it('огород: «Nawóz» — норма дня (до 15), остальные «подождут до завтра»; норма сделана — «ещё по желанию»', async () => {
    // Без звука (настройка): «Как это пишется?» читается транскрипцией и засчитывается в lis.
    const p = setSetting(progressOf(book.home.slice(0, 18).map((v, i) => intro(v.id, T0 - DAY + i))), 'sound.mode', 'off', T0);
    const { w, store } = deps(p, T0 + 3_600_000);
    const g = runGarden(w);
    await flush();
    expect(q('.wl-garden .wl-plan')?.textContent).toContain('удобрить 15');
    expect(q('.wl-garden .wl-plan small')?.textContent).toContain('остальные 3 — завтра');
    expect(q('[data-act="nawoz"]')?.getAttribute('data-norm')).toBe('15');
    q<HTMLElement>('[data-act="nawoz"]')!.click();
    // Ответить на все шаги верно.
    const all = [...content.vocab.values()].map((x) => x.value);
    for (let guard = 0; guard < 80; guard++) {
      await flush();
      const layer = q('.pq-obchod-layer');
      const main = layer?.querySelector('.pq-lesson-main');
      if (!main) break;
      const next = main.querySelector<HTMLElement>('[data-act="next"]:not([hidden])');
      if (next) {
        next.click();
        continue;
      }
      const qt = main.querySelector('.q')?.textContent ?? '';
      const tr = /\[(.+)\]/.exec(qt)?.[1];
      const shown = main.querySelector('.q b[lang="pl"]')?.textContent;
      const target = tr ? all.find((x) => x.tr === tr)?.pl : shown ?? all.find((x) => `${x.pl} — это…` === qt)?.ru;
      [...main.querySelectorAll<HTMLElement>('[data-opt]')].find((b) => b.textContent?.trim() === target)!.click();
    }
    await flush();
    expect(q('.pq-obchod-layer [data-rest]')?.getAttribute('data-rest')).toBe('3');
    expect(q('.pq-obchod-layer [data-act="more"]')).toBeNull();
    q<HTMLElement>('.pq-obchod-layer [data-act="ok"]')!.click();
    await flush();
    expect(store.progress.log.events.filter((e) => e.k === 'rev' && e.src === 'obchod')).toHaveLength(15);
    expect(q('[data-act="nawoz"]')?.getAttribute('data-norm')).toBe('0');
    expect(q('[data-act="nawoz"]')?.textContent).toContain('ещё по желанию');
    q<HTMLElement>('.wl-ogrod [data-act="close"]')!.click();
    await g;
  });

  it('загрузчик места: пока картинки не готовы — пиксельные блоки, потом убираются; предзагрузка декодирует оба атласа', async () => {
    let ready!: () => void;
    const images = new Promise<void>((r) => (ready = r));
    const { w } = deps(progressOf([]), T0, { images });
    const f = openPlace(w, 'dom', { pl: 'Mój dom', ru: 'Мой дом' });
    await flush();
    expect(q('.wl-place .wl-loading')).not.toBeNull();
    ready();
    await flush();
    expect(q('.wl-place .wl-loading')).toBeNull();
    f.close();
    const srcs: string[] = [];
    await preloadPixImages('/b/', () => {
      const img = { src: '', decode: async () => void srcs.push(img.src) };
      return img as unknown as HTMLImageElement;
    });
    expect(srcs.sort()).toEqual(['/b/atlas/custom.png', '/b/atlas/ninja16.png']);
    // Готовые картинки — загрузчика нет вовсе.
    const r2 = deps(progressOf([]), T0, { images: Promise.resolve() });
    const f2 = openPlace(r2.w, 'dom', { pl: 'Mój dom', ru: 'Мой дом' });
    await flush();
    expect(q('.wl-loading')).toBeNull();
    f2.close();
  });
});

// ───────────────────────────── п. 8: профили и «Начать заново» ─────────────────────────────

function fakeLs(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('W-04 п. 8: профили проверки и «Начать заново»', () => {
  it('?dev=<id> — своя база polski-quest-wola-<id> и своё пространство localStorage', () => {
    expect(wolaProfile('w41')).toEqual({ db: 'polski-quest-wola-w41', ls: 'wola-w41:', id: 'w41' });
    expect(wolaProfile(null)).toEqual({ db: 'polski-quest-wola', ls: 'wola:', id: null });
    expect(wolaProfile('../x')).toEqual({ db: 'polski-quest-wola', ls: 'wola:', id: null });
    expect(readFileSync(join(ROOT, 'src/wola/main.ts'), 'utf8')).toMatch(/new GameStorage\(\{ dbName: profile\.db, lsNamespace: profile\.ls \}\)/);
  });

  it('wipe: хранилище стёрто вместе с аварийной копией, дальше ничего не пишется', async () => {
    const ls = fakeLs();
    const kv = memoryKV();
    const st = new GameStorage({ kv, ls, lsNamespace: 'wola-x:' });
    await st.load(T0);
    st.append({ k: 'intro', ts: T0, item: 'lx.tak', lesson: LAPTOP_LESSON, ok: [] });
    await st.flush();
    ls.setItem(`wola-x:${KEYS.tail}`, '{}');
    ls.setItem('wola-y:pq_progress', 'другой профиль');
    expect((await kv.keys()).length).toBeGreaterThan(0);
    await st.wipe();
    expect(await kv.keys()).toEqual([]);
    expect(ls.map.has(`wola-x:${KEYS.tail}`)).toBe(false);
    expect(ls.map.get('wola-y:pq_progress')).toBe('другой профиль');
    st.flushSync();
    await st.flush();
    expect(await kv.keys()).toEqual([]);
    const again = await new GameStorage({ kv, ls, lsNamespace: 'wola-x:' }).load(T0 + 1);
    expect(again.created).toBe(true);
  });

  it('«Начать заново»: подтверждение → автоэкспорт копии → сброс; копия не сохранилась — сброса нет', async () => {
    for (const saved of ['downloaded', 'failed'] as const) {
      const bus = testBus();
      const store = memStore(progressOf([intro('lx.tak', T0)]));
      const files: string[] = [];
      let reset = 0;
      const done = runSettings({
        overlay: createOverlay(host, { bus }),
        store,
        bus,
        clock: { now: () => T0 },
        wola: true,
        saveFile: async (name) => {
          files.push(name);
          return saved;
        },
        reset: async () => {
          reset++;
        },
      });
      await flush();
      // «Без звука» — первым в настройках Wola.
      expect(q('.pq-settings h3')?.textContent).toBe('Звук');
      q<HTMLElement>('[data-act="reset"]')!.click();
      await flush();
      // Под Enter — «Отмена», а не сброс.
      expect(q('.pq-confirm [data-act="no"]')?.hasAttribute('data-primary')).toBe(true);
      expect(q('.pq-confirm [data-act="yes"]')?.hasAttribute('data-primary')).toBe(false);
      q<HTMLElement>('.pq-confirm [data-act="yes"]')!.click();
      await flush();
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^polski-quest-wola-/);
      expect(reset, saved).toBe(saved === 'downloaded' ? 1 : 0);
      if (saved === 'failed') expect(q('[data-msg]')?.textContent).toContain('сброс отменён');
      q<HTMLElement>('.pq-settings [data-act="close"]')!.click();
      await done;
    }
    void derive;
    void dc;
    void ({} as VocabEntry);
  });
});
