// @vitest-environment happy-dom
// P-11: блокер дня 2 (Казик на подходе к ящику), A и тап не уходят бобру, выходы не на пути к другой цели,
// порядок дня 2, посадка говорит, хвосты без звука и интерфейса.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_OFFERED, PLANTED_LINE, BED_EARLY, startFlow } from '../src/flow';
import { seedStoryDay } from '../src/dev/seedDay';
import { bus } from '../src/systems/bus';
import { condCtx, evaluate } from '../src/systems/conditions';
import { getContent } from '../src/systems/content';
import { derive, deriveContent } from '../src/systems/derive';
import type { GameStorage } from '../src/systems/platform/storage';
import { getSetting, newProgress, setFlag, setSetting } from '../src/systems/progress';
import type { GuideTarget } from '../src/types/bus';
import type { Dialogue } from '../src/types/content';
import type { DayGlue } from '../src/day';
import { autoOptions } from '../src/ui/exercises/options';
import { mountGuide } from '../src/ui/guide';
import { exerciseContent } from '../src/ui/lesson';
import { createOverlay } from '../src/ui/overlay/host';
import { passportModel } from '../src/ui/passport';
import { mountPlay, type Play } from '../src/ui/play';
import { mountTitle } from '../src/ui/screens/title';
import { openSoundMap } from '../src/ui/soundMap';
import { act, fakeAudio, fixture, flush, memStore, testBus } from './overlayKit';
import type { LocationMap } from '../src/types/content';
import { approachCells, bobrSpot, pointerCell, resolveGuide } from '../src/world/guide';
import { BOBR_KEY, LocationModel, type WorldEvent } from '../src/world/location';

vi.mock('../src/systems/platform/audio', async (orig) => ({ ...(await orig<object>()), unlockAudio: async () => false }));

const run = (m: LocationModel, ms: number, dt = 16): WorldEvent[] => {
  const out: WorldEvent[] = [];
  for (let t = 0; t < ms; t += dt) out.push(...m.update(dt));
  return out;
};
const of = <K extends WorldEvent['type']>(evs: WorldEvent[], k: K) => evs.filter((e) => e.type === k) as Extract<WorldEvent, { type: K }>[];
const load = (name: string) => JSON.parse(readFileSync(`content/modules/ch01/maps/${name}.json`, 'utf8')) as LocationMap;
const eq = (a: readonly number[], b: readonly number[]): boolean => a[0] === b[0] && a[1] === b[1];

/** Как сцена ставит NPC-Казика при цели шага (Location.applyGuide): свободные клетки без Димы и выходов. */
function seatBobr(m: LocationModel, g: NonNullable<ReturnType<typeof resolveGuide>>, home: [number, number]): [number, number] {
  const now = m.object(BOBR_KEY)!.at;
  const exits = m.objects.filter((o) => o.kind === 'exit' && !m.isHidden(o.key)).map((o) => o.at);
  const reserved = m.reserved();
  const free = (x: number, y: number): boolean =>
    (m.passable(x, y) && !reserved.some((r) => r[0] === x && r[1] === y) && !exits.some((e) => e[0] === x && e[1] === y)) || (x === now[0] && y === now[1]);
  const spot = bobrSpot({ w: m.parsed.w, h: m.parsed.h, passable: free }, g, { player: m.player.tile, facing: m.player.facing, bobr: now, home, walk: m.walkGrid(g.viaExit ? g.at : null) });
  m.moveObject(BOBR_KEY, spot.cell);
  return [spot.cell[0], spot.cell[1]];
}

describe('блокер дня 2: ящик у калитки', () => {
  const dz = load('dzialka');

  it('Казик никогда не встаёт на клетку подхода к ящику; тап по ящику с любой клетки — ящик, а не метро', () => {
    let checked = 0;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const probe = new LocationModel(dz, [9, 13]);
        if (!probe.passable(x, y) || probe.isExit([x, y]) || eq([x, y], [13, 4])) continue;
        for (const facing of ['up', 'down', 'left', 'right'] as const) {
          const m = new LocationModel(dz, [x, y], { facing });
          m.setHidden(['npc:brzechwa', 'npc:kapelusz']); // день 2: выход в метро открыт, Брзехвы и шляпы нет
          const g = resolveGuide(m, { location: 'ch01.dzialka', object: 'skrzynka' }, [], new Set(['npc:brzechwa', 'npc:kapelusz']))!;
          m.setGoal(g);
          // Казик стоял на старой клетке подхода (как в отчёте) — сцена пересаживает его.
          m.moveObject(BOBR_KEY, [10, 14]);
          const cell = seatBobr(m, g, [13, 4]);
          expect(approachCells(g).some((c) => eq(c, cell))).toBe(false);
          m.intent({ type: 'interact', target: m.targetAt([10, 15])! });
          const evs = run(m, 8000);
          expect(of(evs, 'exit'), `старт ${x},${y} ${facing}`).toHaveLength(0);
          expect(of(evs, 'interact').map((e) => e.id), `старт ${x},${y} ${facing}`).toEqual(['skrzynka']);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(300);
  });

  it('A у ящика берёт ящик даже с Казиком рядом; Казик на пути Димы уступает дорогу', () => {
    const m = new LocationModel(dz, [10, 12], { facing: 'down' });
    const g = resolveGuide(m, { location: 'ch01.dzialka', object: 'skrzynka' })!;
    m.setGoal(g);
    m.moveObject(BOBR_KEY, [10, 13]); // прямо на пути
    m.intent({ type: 'move', dir: 'down', held: true });
    const evs = run(m, 600);
    m.intent({ type: 'move', dir: 'down', held: false });
    run(m, 300);
    expect(of(evs, 'yield')).toHaveLength(1);
    expect(m.player.tile).toEqual([10, 14]);
    expect(m.object(BOBR_KEY)!.at).not.toEqual([10, 14]);
    expect(m.actionHint()?.key).toBe('trigger:skrzynka');
  });

  it('pointerCell без запасного варианта: нет места — null, а не клетка подхода', () => {
    const grid = { w: 5, h: 3, passable: (x: number, y: number) => y === 1 };
    const g = { key: 'trigger:t', at: [2, 0] as [number, number], size: [1, 1] as [number, number], viaExit: false };
    // Коридор: единственная клетка под целью (2,1) — подход; Дима слева, путь через весь коридор.
    expect(pointerCell(grid, g, [0, 1], [4, 1])).toEqual([3, 1]);
    expect(pointerCell({ ...grid, passable: (x, y) => y === 1 && x <= 2 }, g, [0, 1], [2, 1])).toBeNull();
  });
});


/** Пустая комната 10×8 (как в actionTarget.test.ts). */
function room(objects: LocationMap['objects']): LocationMap {
  return {
    id: 'demo.room',
    title: { pl: 'Pokój', ru: 'Комната' },
    tileset: 'ninja16',
    controls: 'walk',
    size: [10, 8],
    defaultGround: '.',
    legend: { '.': { tile: 'grass' }, '#': { tile: 'fence', solid: true } },
    layers: { ground: ['##########', '#........#', '#........#', '#........#', '#........#', '#........#', '#........#', '##########'] },
    spawns: { default: [4, 4] },
    objects,
  } as LocationMap;
}

describe('A и тап не уходят бобру (п. 2)', () => {
  it('подсвеченная цель по диагонали: A берёт её (шаг к подходу и действие), а не Казика рядом', () => {
    const m = new LocationModel(room([
      { type: 'npc', id: 'bobr', at: [5, 4] },
      { type: 'trigger', id: 'tablica', at: [5, 3], on: 'tap', do: [] },
    ]), [4, 4], { facing: 'left' });
    // Без цели — рядом только Казик (табличка по диагонали).
    expect(m.actionHint()?.key).toBe(BOBR_KEY);
    m.setGoal({ key: 'trigger:tablica', at: [5, 3], size: [1, 1], viaExit: false });
    expect(m.actionHint()).toEqual({ key: 'trigger:tablica', tile: [5, 3] });
    m.intent({ type: 'interact' });
    const evs = run(m, 1500);
    expect(of(evs, 'interact').map((e) => e.id)).toEqual(['tablica']);
  });

  it('тап по Казику прямо под подсвеченной табличкой — табличка (BAZAR с первого тапа)', () => {
    const m = new LocationModel(room([
      { type: 'npc', id: 'bobr', at: [6, 4] },
      { type: 'trigger', id: 'tablica', at: [6, 3], on: 'tap', do: [] },
    ]), [2, 4], { facing: 'right' });
    expect(m.targetAt([6, 4])).toBe(BOBR_KEY);
    m.setGoal({ key: 'trigger:tablica', at: [6, 3], size: [1, 1], viaExit: false });
    expect(m.targetAt([6, 4])).toBe('trigger:tablica');
    m.intent({ type: 'interact', target: m.targetAt([6, 4])! });
    expect(of(run(m, 3000), 'interact').map((e) => e.id)).toEqual(['tablica']);
  });

  it('путь тапа к цели не идёт через выход; выход сам — цель тапа по клетке', () => {
    const m = new LocationModel(room([
      { type: 'trigger', id: 'skrzynka', at: [5, 7], on: 'tap', do: [] },
      { type: 'exit', at: [4, 6], to: 'demo.other' },
    ]), [4, 4], { facing: 'down' });
    // (5,7) в стене снизу: подход только (5,6); прямой путь (4,5)→(4,6) идёт по выходу.
    m.intent({ type: 'interact', target: m.targetAt([5, 7])! });
    const evs = run(m, 3000);
    expect(of(evs, 'exit')).toHaveLength(0);
    expect(of(evs, 'interact').map((e) => e.id)).toEqual(['skrzynka']);
    const m2 = new LocationModel(room([{ type: 'exit', at: [4, 6], to: 'demo.other' }]), [4, 4]);
    m2.intent({ type: 'goto', tile: [4, 6] });
    expect(of(run(m2, 2000), 'exit')).toHaveLength(1);
  });

  it('pointerCell: Казик не на клетке Димы и не перед его лицом', () => {
    const grid = { w: 10, h: 10, passable: () => true };
    const g = { key: 'trigger:t', at: [5, 5] as [number, number], size: [1, 1] as [number, number], viaExit: false };
    for (const facing of ['up', 'down', 'left', 'right'] as const) {
      const cell = pointerCell(grid, g, [4, 6], [4, 6], { facing })!;
      expect(cell).not.toEqual([4, 6]);
      const d = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const)[facing];
      expect(cell).not.toEqual([4 + d[0], 6 + d[1]]);
      expect(approachCells(g).some((c) => eq(c, cell))).toBe(false);
    }
  });
});

describe('порядок дня 2 (п. 3)', () => {
  const content = getContent();
  it('выход в метро на działce закрыт, пока письмо не прочитано', () => {
    const ex = load('dzialka').objects.find((o) => o.type === 'exit' && o.to === 'ch01.metro') as Extract<LocationMap['objects'][number], { type: 'exit' }>;
    const T = Date.UTC(2026, 9, 16, 9);
    let p = setFlag(newProgress(T - 86_400_000, 'w1'), 'beat.first_day_done', T - 86_400_000);
    const ok = (): boolean => evaluate(ex.if!, condCtx(content, derive(p, deriveContent(content), T), p.world, T));
    expect(ok()).toBe(false);
    p = setFlag(p, 'beat.d02.letter', T);
    expect(ok()).toBe(true);
  });

  it('атом dueLeft: «Wszystko podlane» только когда «!» не осталось', () => {
    const T = Date.UTC(2026, 9, 16, 9);
    const s = memStore(newProgress(T - 3 * 86_400_000, 'w1'));
    s.append({ k: 'intro', ts: T - 2 * 86_400_000, item: 'lx.dzien_dobry', lesson: 'ch01.intro', ok: ['rec'] });
    const ctx = (): ReturnType<typeof condCtx> => condCtx(content, derive(s.progress, deriveContent(content), T), s.progress.world, T);
    expect(evaluate({ dueLeft: { max: 0 } }, ctx())).toBe(false);
    for (const t of ['rec', 'lis']) s.append({ k: 'rev', ts: T - 60_000, card: `lx.dzien_dobry#${t}`, g: 2, ms: 1000, src: 'obchod' });
    expect(evaluate({ dueLeft: { max: 0 } }, ctx())).toBe(true);
  });

  it('урок ещё открыт: шаг «прерванный урок» и «Ушёл посреди фразы» не публикуются; закрыт без выхода — реплики нет', async () => {
    const T = Date.UTC(2026, 9, 16, 9);
    let now = T;
    const clock = { now: () => now, mono: () => now - T, offsetMs: 0 };
    const store = memStore();
    seedStoryDay(store as unknown as GameStorage, content, 2, now);
    const reveals: string[] = [];
    const offR = bus.on('guide:reveal', ({ line }) => void (line && reveals.push(line)));
    const steps: string[] = [];
    const offS = bus.on('guide:step', ({ step }) => void (step && steps.push(step.kind)));
    const play = { busy: true, overlay: createOverlay(document.createElement('div'), { bus: testBus() }), lines: async () => undefined, effects: async () => undefined, openLesson: async () => null } as unknown as Play;
    const day = { ui: { busy: false, obchod: async () => undefined, summary: async () => undefined }, activeMs: () => 0, refresh: async () => undefined } as unknown as DayGlue;
    startFlow({ content, store: Promise.resolve(store as never), clock, play, day, audio: { play: () => undefined, has: () => false } });
    bus.emit('link:ready', {} as never);
    await flush(4);
    // Диагностика идёт: позиция урока лежит в local.resume.
    store.setLocal({ ...store.local, resume: { lessonId: 'ch01.s00', stepIndex: 5, startedAt: now, answers: [] } });
    bus.emit('progress:changed', { kinds: ['cards'] });
    await flush(4);
    expect(steps).not.toContain('resume');
    expect(reveals).not.toContain('sys.kazik.resume.2');
    // Урок закончился нормально: resume снят — реплики про «ушёл» нет и потом.
    const { resume: _r, ...rest } = store.local;
    store.setLocal(rest as typeof store.local);
    (play as { busy: boolean }).busy = false;
    bus.emit('world:input', { enabled: true });
    await flush(4);
    expect(reveals).not.toContain('sys.kazik.resume.2');
    offR();
    offS();
  });
});

describe('постель и календарь (Андрей п. 2)', () => {
  const content = getContent();
  it('постель в хатке отвечает всегда: ничего не сыграно — «рано»; после полива — итог и ночь', async () => {
    const T = Date.UTC(2026, 9, 16, 9);
    let now = T;
    const clock = { now: () => now, mono: () => now - T, offsetMs: 0 };
    const store = memStore();
    seedStoryDay(store as unknown as GameStorage, content, 2, now);
    const lines: string[] = [];
    let summaries = 0;
    const play = { busy: false, overlay: createOverlay(document.createElement('div'), { bus: testBus() }), lines: async (ids: readonly string[]) => void lines.push(...ids), effects: async () => undefined, openLesson: async () => null } as unknown as Play;
    const day = { ui: { busy: false, obchod: async () => undefined, summary: async () => void summaries++ }, activeMs: () => 0, refresh: async () => undefined } as unknown as DayGlue;
    const flow = startFlow({ content, store: Promise.resolve(store as never), clock, play, day, audio: { play: () => undefined, has: () => false } });
    bus.emit('link:ready', {} as never);
    await flush(4);
    const bed = { location: 'ch01.chatka', kind: 'trigger' as const, id: 'poslanie', key: 'trigger:poslanie', tile: [2, 1] as [number, number], via: 'action' as const };
    expect(flow.claim(bed)).toBe(true);
    await flush(4);
    expect(lines).toContain(BED_EARLY);
    expect(summaries).toBe(0);
    store.append({ k: 'seg', ts: (now += 60_000), seg: 'water' });
    expect(flow.claim(bed)).toBe(true);
    await flush(6);
    expect(summaries).toBe(1);
  });
});

describe('посадка говорит (п. 4)', () => {
  it('после посадки — «Posadzone: dziękuję» с переводом пузырём Казика', async () => {
    const content = getContent();
    expect(content.lines.get(PLANTED_LINE)?.pl).toBe('Posadzone:');
    const T = Date.UTC(2026, 9, 15, 15);
    const clock = { now: () => T, mono: () => 0, offsetMs: 0 };
    const store = memStore(newProgress(T - 3_600_000, 'w1'));
    store.append({ k: 'intro', ts: T - 60_000, item: 'lx.dziekuje', lesson: 'ch01.d01.brzechwa', ok: ['rec'] });
    store.setProgress(setFlag(store.progress, 'seed.lx.dziekuje', T - 60_000));
    const notes: { pl: string; ru: string }[] = [];
    const off = bus.on('guide:note', (n) => void notes.push(n));
    const play = { busy: false, overlay: createOverlay(document.createElement('div'), { bus: testBus() }), lines: async () => undefined, effects: async () => undefined, openLesson: async () => null } as unknown as Play;
    const day = { ui: { busy: false, obchod: async () => undefined, summary: async () => undefined }, activeMs: () => 0, refresh: async () => undefined } as unknown as DayGlue;
    const flow = startFlow({ content, store: Promise.resolve(store as never), clock, play, day, audio: { play: () => undefined, has: () => false } });
    await flush(2);
    expect(flow.claim({ location: 'ch01.dzialka', kind: 'plot', id: 'grzadki', key: 'plot:grzadki', tile: [3, 7], via: 'action' })).toBe(true);
    await flush(4);
    expect('plant.3_7.lx.dziekuje' in store.progress.world.flags).toBe(true);
    expect(notes).toEqual([{ pl: 'Posadzone: dziękuję', ru: 'Посажено: спасибо', key: 'plant.lx.dziekuje' }]);
    off();
  });

  it('пузырь заметки и подпись растения в DOM', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const b = testBus();
    const g = mountGuide(root, { bus: b, content: getContent() });
    b.emit('world:location', { id: 'ch01.dzialka', controls: 'walk' });
    b.emit('guide:note', { pl: 'Posadzone: dziękuję', ru: 'Посажено: спасибо', key: 'plant.lx.dziekuje' });
    expect(root.querySelector('[data-bubble]')?.textContent).toContain('Posadzone: dziękuję');
    b.emit('world:label', { text: 'dziękuję', at: { x: 100, y: 200 } });
    const label = root.querySelector<HTMLElement>('[data-plant-label]')!;
    expect(label.hidden).toBe(false);
    expect(label.textContent).toBe('dziękuję');
    b.emit('world:label', null);
    expect(label.hidden).toBe(true);
    g.dispose();
    root.remove();
  });
});

describe('хвосты без звука и интерфейса (п. 5)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => host.remove());

  it('«Bez dźwięku» посреди диалога: следующая реплика уже без ▶ и «медленно», настройка сразу off', async () => {
    const content = fixture();
    const store = memStore();
    const play = mountPlay(host, { content, store, bus: testBus(), audio: fakeAudio(), coarse: true, typeMs: 0 });
    const dlg: Dialogue = {
      id: 'dlg.demo.sound',
      npc: 'pan_marek',
      start: 'a',
      nodes: {
        a: { who: 'pan_marek', pl: 'Tak?', ru: 'Да?', choices: [{ pl: 'Bez dźwięku', ru: 'Без звука', next: 'b', do: [{ setFlag: 'd01.sound.mute' }] }] },
        b: { who: 'pan_marek', pl: 'Idziemy!', ru: 'Идём!', end: true },
      },
    };
    (content.dialogues as Map<string, { module: string; value: Dialogue }>).set(dlg.id, { module: 'demo', value: dlg });
    const p = play.openDialog(dlg.id);
    await flush();
    expect(host.querySelector('[data-audio]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[data-choice="0"]')!.click();
    await flush();
    expect(host.textContent).toContain('Idziemy!');
    expect(host.querySelector('[data-audio]')).toBeNull();
    expect(getSetting(store.progress, 'sound.mode')).toBe('off');
    act(host, 'next').click();
    await p;
    (content.dialogues as Map<string, unknown>).delete(dlg.id);
    play.dispose();
  });

  it('карта звуков прячет слой диалога под собой («Słucham!» не торчит), после — возвращает', async () => {
    const overlay = createOverlay(host, { bus: testBus() });
    const below = overlay.open('pq-dialog-layer');
    below.el.append(Object.assign(document.createElement('button'), { textContent: 'Słucham!' }));
    const p = openSoundMap(overlay, getContent(), [{ id: 'R1', short: 'ударение', status: 'green' }]);
    expect(below.el.style.visibility).toBe('hidden');
    act(host, 'next').click();
    await p;
    expect(below.el.style.visibility).toBe('');
    below.close();
  });

  it('паспорт без звука: цели «на слух» — «по чтению»', () => {
    const content = getContent();
    const T = Date.UTC(2026, 9, 16, 9);
    let p = newProgress(T - 86_400_000, 'w1');
    const d = derive(p, deriveContent(content), T);
    const texts = (): string[] => passportModel(content, p, d).canDo.map((c) => c.ru);
    expect(texts().some((t) => t.includes('на слух') || t.startsWith('Услышав'))).toBe(true);
    p = setSetting(p, 'sound.mode', 'off', T);
    expect(texts().some((t) => t.includes('на слух') || t.startsWith('Услышав') || t.includes('под диктовку'))).toBe(false);
    expect(texts().some((t) => t.includes('по чтению'))).toBe(true);
  });

  it('окно ссылки: пузырь Казика прячется; экран сам открывается один раз (флаг link.offered)', () => {
    const b = testBus();
    const g = mountGuide(host, { bus: b, content: getContent() });
    b.emit('world:location', { id: 'ch01.chatka', controls: 'walk' });
    b.emit('guide:note', { pl: 'Do jutra!', ru: 'До завтра!', key: 'x' });
    expect(host.querySelector<HTMLElement>('[data-bubble]')!.hidden).toBe(false);
    b.emit('ui:link:show', { link: 'https://example.test/#x', saved: false, onSaved: () => undefined });
    expect(host.querySelector<HTMLElement>('[data-bubble]')!.hidden).toBe(true);
    g.dispose();
    expect(LINK_OFFERED).toBe('link.offered');
    expect(readFileSync('src/flow.ts', 'utf8')).toContain('!(LINK_OFFERED in st.progress.world.flags)');
  });
});

describe('склейка: после сна ничего не подсвечено', () => {
  it('шаг «до завтра» — guide:target null', async () => {
    const content = getContent();
    const T = Date.UTC(2026, 9, 16, 9);
    const clock = { now: () => T, mono: () => 0, offsetMs: 0 };
    const store = memStore();
    seedStoryDay(store as unknown as GameStorage, content, 2, T);
    for (const g of ['water', 'scene', 'sleep'] as const) store.append({ k: 'seg', ts: T - 60_000, seg: g });
    const targets: (GuideTarget | null)[] = [];
    const off = bus.on('guide:target', ({ target }) => void targets.push(target));
    const play = { busy: false, overlay: createOverlay(document.createElement('div'), { bus: testBus() }), lines: async () => undefined, effects: async () => undefined, openLesson: async () => null } as unknown as Play;
    const day = { ui: { busy: false, obchod: async () => undefined, summary: async () => undefined }, activeMs: () => 0, refresh: async () => undefined } as unknown as DayGlue;
    const flow = startFlow({ content, store: Promise.resolve(store as never), clock, play, day, audio: { play: () => undefined, has: () => false } });
    bus.emit('link:ready', {} as never);
    await flush(4);
    expect(flow.step?.kind).toBe('done');
    expect(targets.at(-1)).toBeNull();
    off();
  });
});

describe('Андрей: задания на слух и клавиатура', () => {
  it('на слух: знакомые слова похожей длины (proszę / dziękuję) не стоят вместе', () => {
    const content = getContent();
    const known = new Set(['lx.dziekuje', 'lx.prosze', 'lx.czesc', 'lx.dzien_dobry']);
    const ex = exerciseContent(content, (id) => known.has(id));
    for (let k = 0; k < 20; k++) {
      const r = autoOptions({ t: 'listen', say: 'dziękuję', options: 'auto:greeting', answer: 0, item: 'lx.dziekuje' }, `obchod#${k}`, ex);
      expect(r.options).toContain('dziękuję');
      expect(r.options).not.toContain('proszę');
    }
    // Без сведений о знакомых словах — как раньше.
    const plain = exerciseContent(content);
    expect(autoOptions({ t: 'listen', say: 'dziękuję', options: 'auto:greeting', answer: 0, item: 'lx.dziekuje' }, 'x', plain).options.length).toBe(3);
  });

  it('титул: Enter / E (intent interact) — как тап по кнопке', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountTitle(root);
    let started = 0;
    const off = bus.on('title:start', () => void started++);
    bus.emit('ui:title:show', { build: 'test' });
    bus.emit('input:intent', { type: 'interact', to: 'world', source: 'keyboard' });
    await flush(3);
    expect(started).toBe(1);
    expect(root.querySelector('.pq-title')).toBeNull();
    off();
    root.remove();
  });
});

describe('слой оверлея не съедает тапы по миру', () => {
  it('#overlay > * — нулевая специфичность: pointer-events: none у HUD, «Сейчас» и подписи растения работает', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('#overlay > :where(*) { pointer-events: auto; }');
    expect(html).not.toMatch(/#overlay > \* \{ pointer-events: auto; \}/);
  });
});
