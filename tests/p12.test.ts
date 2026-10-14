// @vitest-environment happy-dom
// P-12 (четвёртый плейтест, 7 → 8): колонка HUD и тапы по хатке, A у двери и у Казика, без звука — чтение,
// старая сборка из кэша, перекрытия, «Dalej» после ошибки, путь к цели через карты, спрайт Брзехвы, мелочи.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nowShown } from '../src/flow';
import { getContent } from '../src/systems/content';
import { derive, deriveContent } from '../src/systems/derive';
import { lessonDoneFor } from '../src/systems/director';
import type { LogEvent } from '../src/systems/log';
import { fetchRemoteBuild, indexBuild } from '../src/systems/platform/pwa';
import { newProgress, setSetting } from '../src/systems/progress';
import { isSilent, setSoundUnavailable, soundUnavailable } from '../src/systems/sound';
import { staleBuild } from '../src/systems/update';
import { buildWordIndex, formKey, matchWords, tokenize } from '../src/systems/words';
import type { Lesson, LocationMap, Step } from '../src/types/content';
import type { GuideStepView } from '../src/types/bus';
import { summaryBody } from '../src/ui/daySummary';
import { autoOptions } from '../src/ui/exercises/options';
import { listen } from '../src/ui/exercises/listen';
import type { ExerciseCtx, StepResult } from '../src/ui/exercises/types';
import { mountGuide } from '../src/ui/guide';
import { errLinesOf, exerciseContent, runLesson, type LessonDeps } from '../src/ui/lesson';
import { createOverlay } from '../src/ui/overlay/host';
import { hudDodge } from '../src/world/camera';
import { nextHop, resolveGuide } from '../src/world/guide';
import { BOBR_KEY, LocationModel, type WorldEvent } from '../src/world/location';
import { act, byText, fakeAudio, flush, memStore, testBus } from './overlayKit';

const content = getContent();
const load = (name: string) => JSON.parse(readFileSync(`content/modules/ch01/maps/${name}.json`, 'utf8')) as LocationMap;
const run = (m: LocationModel, ms: number, dt = 16): WorldEvent[] => {
  const out: WorldEvent[] = [];
  for (let t = 0; t < ms; t += dt) out.push(...m.update(dt));
  return out;
};
const T0 = Date.UTC(2026, 9, 15, 10);

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
  setSoundUnavailable(false);
});

// ── 1. Колонка кнопок справа.

describe('1. колонка HUD не ловит тапы по миру, цель не встаёт под неё', () => {
  it('index.html: правило оверлея целиком в :where (у #overlay > :where(*) id давал специфичность 1,0,0)', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(':where(#overlay > *) { pointer-events: auto; }');
    expect(html).not.toMatch(/^\s*#overlay > :where\(\*\)/m);
    const day = readFileSync('src/ui/day.ts', 'utf8');
    expect(day).toMatch(/\.pq-dhud \{[^}]*pointer-events: none/);
    expect(day).toMatch(/\.pq-dhud \.pq-btn \{[^}]*pointer-events: auto/);
  });

  it('hudDodge: хатка под колонкой (как у Андрея: колонка x 257–367, y 52–207) — картинка уезжает вниз или влево', () => {
    const hud = { left: 257, top: 52, right: 367, bottom: 207 };
    const view = { width: 375, height: 812, bottom: 148 };
    // Хатка 2×2 клетки по 32 px у правого края: под колонкой.
    const [dx, dy] = hudDodge({ left: 247, top: 140, right: 311, bottom: 204 }, hud, view);
    expect(dx < 0 || dy > 0).toBe(true);
    const moved = { left: 247 + dx, top: 140 + dy, right: 311 + dx, bottom: 204 + dy };
    const under = moved.right > hud.left && moved.left < hud.right && moved.bottom > hud.top && moved.top < hud.bottom;
    expect(under).toBe(false);
    // Цель не под колонкой — камера на месте; колонки нет — тоже.
    expect(hudDodge({ left: 40, top: 300, right: 72, bottom: 332 }, hud, view)).toEqual([0, 0]);
    expect(hudDodge({ left: 247, top: 140, right: 311, bottom: 204 }, null, view)).toEqual([0, 0]);
    // Вниз нельзя (упрётся в d-pad) — влево.
    const [lx, ly] = hudDodge({ left: 300, top: 100, right: 340, bottom: 640 }, hud, view);
    expect(ly).toBe(0);
    expect(lx).toBeLessThan(0);
  });

  it('пузырь Казика не заходит под колонку кнопок: левее или ниже неё', () => {
    const bus = testBus();
    mountGuide(host, { bus, content, bubbleMinMs: 0 });
    bus.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
    bus.emit('ui:hud:rect', { left: 257, top: 52, right: 367, bottom: 207 });
    bus.emit('world:anchor', { id: 'bobr', at: { x: 300, y: 150 } });
    const view: GuideStepView = { key: 'water|', kind: 'water', label: 'полей', here: true, reason: '5', line: 'sys.kazik.obchod' };
    bus.emit('guide:step', { step: view });
    const bubble = host.querySelector<HTMLElement>('.pq-bubble')!;
    expect(bubble.hidden).toBe(false);
    const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(bubble.style.transform)!;
    const x = Number(m[1]);
    const y = Number(m[2]);
    // happy-dom не меряет: ширина по умолчанию 200, высота 48.
    const under = x + 200 > 257 - 8 && x < 367 + 8 && y + 48 > 52 - 8 && y < 207 + 8;
    expect(under).toBe(false);
  });
});

// ── 2. A у двери хатки и у Казика.

describe('2. A: дверь — цель, Казик рядом; цель — Казик, а не росток', () => {
  const dz = load('dzialka');
  const door = { key: 'exit:12,3', at: [12, 3] as [number, number], size: [1, 1] as [number, number], viaExit: true };
  const flags = new Set(['beat.d01.wieczor']);
  const open = (m: LocationModel): void => {
    m.setHidden(m.objects.filter((o) => o.kind === 'exit' && o.key === 'exit:9,15').map((o) => o.key));
    void flags;
  };

  it('Андрей: справа от двери у стены хатки ([13,4], лицом вверх), Казик снизу — A ведёт в дверь', () => {
    const m = new LocationModel(dz, [13, 4], { facing: 'up' });
    open(m);
    m.moveObject(BOBR_KEY, [13, 5]);
    m.setGoal(door);
    expect(m.actionHint()?.key).toBe('exit:12,3');
    m.intent({ type: 'interact' });
    const evs = run(m, 1500);
    expect(evs.some((e) => e.type === 'exit' && e.to === 'ch01.chatka')).toBe(true);
    expect(evs.some((e) => e.type === 'interact' && e.key === BOBR_KEY)).toBe(false);
  });

  it('Марина: Казик у двери, героиня справа ниже ([13,5]) — A берёт дверь, не «Я прорабствую»', () => {
    const m = new LocationModel(dz, [13, 5], { facing: 'left' });
    open(m);
    m.moveObject(BOBR_KEY, [13, 4]);
    m.setGoal(door);
    expect(m.actionHint()?.key).toBe('exit:12,3');
    m.intent({ type: 'interact' });
    const evs = run(m, 2000);
    expect(evs.some((e) => e.type === 'exit')).toBe(true);
    expect(evs.some((e) => e.type === 'interact')).toBe(false);
  });

  it('шаг на клетку Казика у двери: он уступает не на подход к двери, а меняется местами', () => {
    const m = new LocationModel(dz, [13, 5], { facing: 'up' });
    open(m);
    m.moveObject(BOBR_KEY, [13, 4]);
    m.setGoal(door);
    m.intent({ type: 'move', dir: 'up', held: true });
    const evs = run(m, 300);
    m.intent({ type: 'move', dir: 'up', held: false });
    run(m, 400);
    const y = evs.find((e) => e.type === 'yield');
    expect(y && y.type === 'yield' ? y.to : null).toEqual([13, 5]);
    expect(m.object(BOBR_KEY)!.at).not.toEqual([12, 4]);
  });

  it('тап по крыше или стене хатки, когда дверь — цель, ведёт в дверь', () => {
    const m = new LocationModel(dz, [9, 9]);
    open(m);
    m.setGoal(door);
    expect(m.doorFor([13, 2])).toEqual([12, 3]);
    expect(m.doorFor([12, 2])).toEqual([12, 3]);
    expect(m.doorFor([13, 3])).toEqual([12, 3]);
    expect(m.doorFor([5, 5])).toBeNull(); // трава
    m.setGoal(null);
    expect(m.doorFor([13, 2])).toBeNull();
  });

  it('Марина, день 2: цель — Казик сбоку, перед лицом росток — A говорит с Казиком', () => {
    const m = new LocationModel(dz, [2, 9], { facing: 'up' });
    m.setGarden([{ at: [2, 8], item: 'lx.dziekuje' }], 0);
    m.moveObject(BOBR_KEY, [1, 9]);
    m.setGoal({ key: BOBR_KEY, at: [1, 9], size: [1, 1], viaExit: false });
    expect(m.actionHint()?.key).toBe(BOBR_KEY);
    m.intent({ type: 'interact' });
    const evs = run(m, 100);
    const ia = evs.find((e) => e.type === 'interact');
    expect(ia && ia.type === 'interact' ? ia.key : null).toBe(BOBR_KEY);
  });

  it('инвариант: NPC-Казик не остаётся на клетке Димы (старый твин довозил его туда)', () => {
    const m = new LocationModel(dz, [3, 9], { facing: 'up' });
    m.objects.find((o) => o.key === BOBR_KEY)!.at = [3, 9];
    const evs = run(m, 50);
    expect(m.object(BOBR_KEY)!.at).not.toEqual([3, 9]);
    expect(evs.some((e) => e.type === 'yield')).toBe(true);
  });
});

// ── 3. Без звука.

describe('3. без звука: задания на слух — чтение, знакомые дистракторы, ошибки не в карту звуков', () => {
  it('isSilent: настройка off или звука нет на деле (mute, audio:state none, «Не слышу»)', () => {
    const p = newProgress(T0, 'w1');
    expect(isSilent(p)).toBe(false);
    expect(isSilent(setSetting(p, 'sound.mode', 'off', T0))).toBe(true);
    setSoundUnavailable(true);
    expect(soundUnavailable()).toBe(true);
    expect(isSilent(p)).toBe(true);
    setSoundUnavailable(false);
    expect(isSilent(p)).toBe(false);
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toMatch(/if \(mute\) setSoundUnavailable\(true\)/);
    expect(main).toMatch(/state === 'none'\) setSoundUnavailable\(true\)/);
  });

  it('обход: правильный ответ знакомый — дистракторы тоже знакомые (peron среди wejście/wyjście, а не apteka)', () => {
    const known = new Set(['lx.peron', 'lx.wejscie', 'lx.wyjscie', 'lx.dziekuje', 'lx.prosze', 'lx.czesc', 'lx.dzien_dobry']);
    const ex = exerciseContent(content, (id) => known.has(id));
    const pl = new Set([...known].map((id) => content.vocab.get(id)!.value.pl));
    for (let k = 0; k < 12; k++) {
      const r = autoOptions({ t: 'listen', say: 'peron', options: 'auto:metro', answer: 0, item: 'lx.peron' }, `obchod#${k}`, ex);
      expect(r.options).toContain('peron');
      expect(r.options.every((o) => pl.has(o))).toBe(true);
    }
  });

  function ctxOf(o: Partial<ExerciseCtx> = {}): ExerciseCtx {
    const layer = createOverlay(host, { bus: testBus() }).open('t');
    return {
      layer,
      root: layer.el,
      stepId: 'x#0',
      content: exerciseContent(content),
      audio: fakeAudio(),
      diacritics: 'warn',
      translations: 'auto',
      keyboardMode: 'system',
      coarse: true,
      now: () => 0,
      random: () => 0.3,
      typeMs: 0,
      ...o,
    } as ExerciseCtx;
  }

  it('«Не слышу» в задании на слух: звук помечен недоступным, шаг без оценки (noAudio, graded: false)', async () => {
    let heard = 0;
    const ctx = ctxOf({ cantHear: () => void heard++ });
    const step: Step = { t: 'listen', say: 'dziękuję', options: ['dziękuję', 'proszę'], answer: 0, item: 'lx.dziekuje' };
    const p = listen.mount(step as Extract<Step, { t: 'listen' }>, ctx);
    act(ctx.root, 'cant-hear').click();
    const r: StepResult = await p;
    expect(heard).toBe(1);
    expect(r).toMatchObject({ status: 'done', graded: false, noAudio: true });
    expect(r.first).toBeUndefined();
  });

  it('без звука listen читается транскрипцией, кнопки «Не слышу» нет', async () => {
    const ctx = ctxOf({ silent: true, cantHear: () => undefined });
    void listen.mount({ t: 'listen', say: 'dziękuję', options: ['dziękuję', 'proszę'], answer: 0, item: 'lx.dziekuje' } as Extract<Step, { t: 'listen' }>, ctx);
    expect(ctx.root.textContent).toContain('Как это пишется?');
    expect(ctx.root.querySelector('[data-act="cant-hear"]')).toBeNull();
    expect(ctx.root.querySelector('[data-audio]')).toBeNull();
  });

  function deps(store: ReturnType<typeof memStore>) {
    const events: LogEvent[] = [];
    const d: LessonDeps = {
      overlay: createOverlay(host, { bus: testBus() }),
      content,
      store,
      audio: fakeAudio(),
      clock: { now: () => T0, mono: () => 0 },
      random: () => 0.2,
      coarse: true,
      typeMs: 0,
      tz: 'Europe/Warsaw',
      onEvent: (e) => events.push(e),
    };
    return { d, events };
  }

  it('турникет без звука: ошибки не идут в карту звуков, верные — идут; проверка всё равно пройдена', async () => {
    setSoundUnavailable(true);
    const store = memStore(newProgress(T0 - 86_400_000, 'w1'));
    const { d, events } = deps(store);
    const lesson: Lesson = {
      id: 'ch01.s00',
      kind: 'diag',
      title: { ru: 't' },
      minutes: 1,
      steps: [
        { t: 'minimal_pair', pair: ['lata', 'łata'], play: 1, mode: 'which', cluster: 'R3', tr: 'ўа́та' },
        { t: 'minimal_pair', pair: ['kasza', 'Kasia'], play: 1, mode: 'which', cluster: 'R6', tr: 'ка́ща' },
      ],
    };
    const p = runLesson(lesson, d);
    await flush(2);
    const root = host.querySelector('.pq-lesson-main') as HTMLElement;
    byText(root, 'lata').click(); // неверно (R3)
    await flush(1);
    act(root, 'next').click();
    await flush(2);
    byText(root, 'Kasia').click(); // верно (R6)
    await flush(1);
    act(root, 'next').click();
    await p;
    const diag = events.find((e) => e.k === 'diag');
    expect(diag && diag.k === 'diag' ? diag.results : null).toEqual({ R6: { ok: 1, n: 1 } });
    const dv = derive(store.progress, deriveContent(content), T0);
    expect(dv.clusterStatus.R3).toBe('unknown');
    expect(lessonDoneFor(lesson, dv)).toBe(true);
  });
});

// ── 4. Старая сборка из кэша.

describe('4. версия сборки без кэша', () => {
  it('staleBuild: version.json или meta index.html не совпали с __BUILD_ID__ — устарела; не прочитали — нет', () => {
    expect(staleBuild({ local: '0.1.0+74835bd', index: '0.1.0+74835bd', remote: '0.1.0+74835bd' })).toBe(false);
    expect(staleBuild({ local: '0.1.0+c732548', index: '0.1.0+c732548', remote: '0.1.0+74835bd' })).toBe(true);
    expect(staleBuild({ local: '0.1.0+74835bd', index: '0.1.0+c732548', remote: null })).toBe(true);
    expect(staleBuild({ local: '0.1.0+74835bd', index: null, remote: null })).toBe(false);
  });

  it('fetchRemoteBuild: version.json с cache: no-store и меткой времени; ошибка сети — null', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ build: '0.1.0+abc1234' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchRemoteBuild('/polski-quest/', { fetch: fake, now: 42 })).toBe('0.1.0+abc1234');
    expect(calls[0]!.url).toBe('/polski-quest/version.json?t=42');
    expect(calls[0]!.init?.cache).toBe('no-store');
    const broken = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchRemoteBuild('/', { fetch: broken })).toBeNull();
    const missing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchRemoteBuild('/', { fetch: missing })).toBeNull();
  });

  it('index.html знает сборку (meta pq-build), version.json рядом и не в precache SW; main проверяет версию', () => {
    const meta = document.createElement('meta');
    meta.name = 'pq-build';
    meta.content = '0.1.0+abc1234';
    document.head.append(meta);
    expect(indexBuild(document)).toBe('0.1.0+abc1234');
    meta.remove();
    const cfg = readFileSync('vite.config.ts', 'utf8');
    expect(cfg).toMatch(/fileName: 'version\.json'/);
    expect(cfg).toMatch(/meta name="pq-build"/);
    expect(cfg).toMatch(/globIgnores: \['\*\*\/version\.json'\]/);
    expect(readFileSync('src/main.ts', 'utf8')).toMatch(/watchVersion\(\{ base: import\.meta\.env\.BASE_URL, local: __BUILD_ID__, isStale: staleBuild/);
  });
});

// ── 5. Перекрытия.

describe('5. перекрытия: герой не встаёт под NPC, Казик не на голове, «Dobranoc» видна', () => {
  it('тап по Брзехве на działce и в метро: Дима подходит сбоку, а не снизу', () => {
    const dz = load('dzialka');
    const m = new LocationModel(dz, [5, 10], { facing: 'up' });
    m.setHidden([]);
    m.intent({ type: 'interact', target: 'npc:brzechwa' });
    const evs = run(m, 4000);
    expect(evs.some((e) => e.type === 'interact' && e.key === 'npc:brzechwa')).toBe(true);
    expect(m.player.tile[1]).toBe(1); // та же строка, что Брзехва [6,1]
    const metro = new LocationModel(load('metro'), [9, 12], { facing: 'up' });
    metro.intent({ type: 'interact', target: 'npc:brzechwa' });
    const e2 = run(metro, 4000);
    expect(e2.some((e) => e.type === 'interact' && e.key === 'npc:brzechwa')).toBe(true);
    expect(metro.player.tile[1]).toBe(8);
    expect(Math.abs(metro.player.tile[0] - 8)).toBe(1);
  });

  it('Казик-компаньон после остановки не стоит прямо над Димой (метро: «сел на голову»)', () => {
    const m = new LocationModel(load('metro'), [9, 10], { facing: 'down', companion: true });
    m.intent({ type: 'move', dir: 'down', held: true });
    run(m, 230);
    m.intent({ type: 'move', dir: 'down', held: false });
    run(m, 800);
    const c = m.companion!.tile;
    const [px, py] = m.player.tile;
    expect(c[0] === px && c[1] === py - 1).toBe(false);
    expect(Math.abs(c[0] - px) + Math.abs(c[1] - py)).toBeLessThanOrEqual(2);
  });

  it('сцена: Дима на одной строке с Казиком рисуется поверх (глубина +0.5), старые твины Казика гасятся', () => {
    const src = readFileSync('src/scenes/Location.ts', 'utf8');
    expect(src).toMatch(/\(s === this\.player \? 0\.5 : 0\)/);
    expect((src.match(/killTweensOf/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('итог дня: тело прокручивается, «Dobranoc» в ряду вне прокрутки; выросшие слова — по переходу', () => {
    const css = readFileSync('src/ui/daySummary.ts', 'utf8');
    expect(css).toMatch(/\.pq-sleep \.body \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.pq-sleep > \.row \{[^}]*flex: none/);
    expect(css).toMatch(/env\(safe-area-inset-bottom\)/);
    const body = summaryBody(
      {
        day: '2026-10-17',
        empty: false,
        plants: 7,
        grew: [
          { item: 'lx.czesc', from: 'sprout', to: 'sprout_big' },
          { item: 'lx.dziekuje', from: 'sprout', to: 'sprout_big' },
          { item: 'lx.wyjscie', from: 'seed', to: 'sprout' },
        ],
        matured: [],
        planted: [],
        retrievalMs: 60_000,
        tomorrowPlants: 10,
      } as unknown as Parameters<typeof summaryBody>[0],
      content,
    );
    const list = body.find((e) => e.classList.contains('list'))!;
    expect(list.textContent).toBe('cześć, dziękuję: росток → крепкий росток; wyjście: семя → росток');
  });
});

// ── 6. «Dalej» после ошибки.

describe('6. после ошибки в уроке видна «Dalej»', () => {
  it('выбор: после неверного — правильный ответ, правило и «Dalej»; тап по подсвеченному верному — тоже дальше', async () => {
    const store = memStore(newProgress(T0 - 86_400_000, 'w1'));
    const overlay = createOverlay(host, { bus: testBus() });
    const lesson: Lesson = { id: 'test.dalej', kind: 'practice', title: { ru: 't' }, minutes: 1, steps: [{ t: 'choice', q: 'cena?', options: ['цена', 'сено'], answer: 0 }] };
    const p = runLesson(lesson, { overlay, content, store, audio: fakeAudio(), clock: { now: () => T0, mono: () => 0 }, coarse: true, typeMs: 0 }, { noSummary: true, drill: true });
    await flush(2);
    const root = host.querySelector('.pq-lesson-main') as HTMLElement;
    byText(root, 'сено').click();
    await flush(1);
    expect(root.querySelector('.pq-ex-fb')?.textContent).toContain('Правильно');
    const next = act(root, 'next');
    expect(next.textContent).toContain('Dalej');
    byText(root, 'цена').click(); // подсвеченный верный
    await flush(2);
    // Повтор ошибки в конце урока — новый шаг, снова выбор.
    byText(host.querySelector('.pq-lesson-main') as HTMLElement, 'цена').click();
    await flush(1);
    act(host.querySelector('.pq-lesson-main') as HTMLElement, 'next').click();
    await p;
  });

  it('ввод текстом: после ошибки «Ещё раз» и рядом «Dalej»', () => {
    const src = readFileSync('src/ui/exercises/frame.ts', 'utf8');
    expect(src).toMatch(/show\(retryBtn, true\);\s*show\(laterBtn, true\);/);
  });
});

// ── 7. После турникета цель сразу.

describe('7. после турникета: следующий шаг виден и подсвечен сразу', () => {
  it('nextHop: из метро в хатку — через działkę; resolveGuide подсвечивает выход на działkę', () => {
    const maps = new Map([...content.maps].map(([id, d]) => [id, d.value as unknown as { objects: readonly { type: string; to?: string }[] }]));
    expect(nextHop(maps, 'ch01.metro', 'ch01.chatka')).toBe('ch01.dzialka');
    expect(nextHop(maps, 'ch01.dzialka', 'ch01.chatka')).toBe('ch01.chatka');
    expect(nextHop(maps, 'ch01.metro', 'ch01.metro')).toBeNull();
    const metro = new LocationModel(load('metro'), [9, 8]);
    const g = resolveGuide(metro, { location: 'ch01.chatka', object: 'poslanie' }, [], new Set(), (a, b) => nextHop(maps, a, b));
    expect(g).toMatchObject({ key: 'exit:9,13', viaExit: true });
    // Без маршрута — как раньше: выхода прямо в хатку нет, подсветки нет.
    expect(resolveGuide(metro, { location: 'ch01.chatka', object: 'poslanie' })).toBeNull();
  });

  it('строка «Сейчас» видна сразу у разговора с человеком (урок табличек у Брзехвы) и у сна; у полива — прячется', () => {
    expect(nowShown({ kind: 'beat', target: { location: 'ch01.metro', npc: 'brzechwa' } } as Parameters<typeof nowShown>[0])).toBe(true);
    expect(nowShown({ kind: 'sleep', target: { location: 'ch01.chatka', object: 'poslanie' } } as Parameters<typeof nowShown>[0])).toBe(true);
    expect(nowShown({ kind: 'water', target: { location: 'ch01.dzialka' } } as Parameters<typeof nowShown>[0])).toBe(false);
  });

  it('урок табличек: бит у Брзехвы без лишней реплики — первый A/тап запускает урок', () => {
    const beat = content.director.beats.find((b) => b.id === 'd02.znaki')!;
    expect(beat.target.npc).toBe('brzechwa');
    expect(beat.line).toBeUndefined();
    expect(beat.do).toEqual([{ startLesson: 'ch01.d02.znaki' }]);
  });
});

// ── 8. Спрайт Брзехвы.

describe('8. Брзехва на карте похож на портрет', () => {
  it('sprite-as-data 16×32 со шляпой, очками, бабочкой; в атласе; персонаж ссылается на него', () => {
    const sp = JSON.parse(readFileSync('art/sprites/brzechwa.sprite.json', 'utf8')) as { size: number[]; frames: string[][]; keys: Record<string, string | null>; anims: Record<string, number[]> };
    expect(sp.size).toEqual([16, 32]);
    expect(sp.frames.length).toBe(4);
    for (const f of sp.frames) {
      expect(f.length).toBe(32);
      for (const r of f) expect(r.length).toBe(16);
    }
    expect(sp.keys.r).toBe('accent_brick'); // лента шляпы
    expect(sp.keys.b).toBe('red_0'); // бабочка
    expect(sp.frames[0]!.join('')).toContain('l'); // стёкла очков
    for (const k of ['idle_down', 'idle_up', 'idle_left', 'idle_right']) expect(sp.anims[k]).toBeDefined();
    const atlas = JSON.parse(readFileSync('public/atlas/sprites.json', 'utf8')) as Record<string, { size: number[] }>;
    expect(atlas.brzechwa?.size).toEqual([16, 32]);
    expect(content.characters.get('brzechwa')?.sprite).toBe('brzechwa');
  });
});

// ── 9. Мелочи.

describe('9. реплика по тегу ошибки, тап по слову, длина «Akcent», повтор ударения', () => {
  const s01 = content.lessons.get('ch01.s01')!.value;

  it('errLines: prosię — без «Ta-TA?» про ударение, правило про ś и перевод «поросёнок»; ударение — «Ta-TA?»; аканье — «Wada?»', () => {
    const f = errLinesOf(content, s01, false)!;
    expect(f(['ph.stress'])?.pl).toBe('Ta-TA? Nie. TA-ta!');
    expect(f(['ph.vowel_o'])?.pl).toContain('Woda nie ma wad');
    expect(f(['ph.prosie'])).toBeUndefined();
    const step = s01.steps!.find((s) => s.t === 'choice' && (s.options as string[]).includes('Woda, prosię.')) as Extract<Step, { t: 'choice' }>;
    const k = String(step.options.indexOf('Woda, prosię.'));
    expect(step.errorTagByOption?.[k]).toBe('ph.prosie');
    const tag = content.errorTags.get('ph.prosie');
    expect(tag?.hint).toContain('поросёнок');
    expect(tag?.hint).toContain('si = [щ]');
  });

  it('урок «Akcent» не длиннее 12 шагов; короткая версия ссылается на существующие шаги', () => {
    expect(s01.steps!.length).toBeLessThanOrEqual(12);
    for (const i of s01.short?.steps ?? []) expect(i).toBeLessThan(s01.steps!.length);
  });

  it('ударение Warszawa / telefon: на турникете дня 2, в уроке дня 3 нет — не больше двух дней подряд', () => {
    const stressWords = (l: Lesson): string[] => (l.steps ?? []).filter((s) => s.t === 'stress').map((s) => (s as Extract<Step, { t: 'stress' }>).word.toLowerCase());
    const s00 = content.lessons.get('ch01.s00')!.value;
    expect(stressWords(s00)).toEqual(expect.arrayContaining(['telefon', 'warszawa']));
    expect(stressWords(s01)).not.toContain('telefon');
    expect(stressWords(s01)).not.toContain('warszawa');
  });

  it('тап по слову в реплике: каждое слово из vocab в story/lines.json размечено (перевод слова, не «Вся фраза»)', () => {
    const idx = buildWordIndex([...content.vocab.values()].map((x) => x.value));
    const miss: string[] = [];
    for (const l of content.lines.values()) {
      if (!l.pl) continue;
      const spans = matchWords(l.pl, idx, l.words ? { refs: l.words } : {});
      const covered = new Set<number>();
      for (const s of spans) if (s.lx) for (let i = s.start; i < s.end; i++) covered.add(i);
      for (const t of tokenize(l.pl)) if (t.word && idx.byForm.has(formKey(t.text)) && !covered.has(t.start)) miss.push(`${l.id}: ${t.text}`);
    }
    expect(miss).toEqual([]);
  });
});

