// @vitest-environment happy-dom
// День 1 целиком через склейку режиссёра (P-05, src/flow.ts): Title → карточка → вокзал и фотобудка → перрон →
// улица → базар и паспорт → Висла → działka и полив → шляпа Брзехвы и три семечка → посадка из кармана → хатка →
// итог → ночь. Оверлей подменён (реплики и уроки пишут в журнал вызовов), мир — событиями шины, как от сцены.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/intro', () => ({
  loadIntroAtlas: vi.fn(async () => null),
  runCaption: vi.fn(async () => undefined),
  runTiles: vi.fn(async (d: { store: { append(e: unknown): unknown } }) => {
    const ts = Date.UTC(2026, 9, 14, 8, 5);
    d.store.append({ k: 'intro', ts, item: 'lx.dzien_dobry', lesson: 'ch01.intro', ok: ['rec'] });
    d.store.append({ k: 'lesson', ts, lesson: 'ch01.intro', score: 1, firstTry: 1, ms: 5000, passed: true, answers: 1 });
    return { firstTry: true, attempts: 1 };
  }),
  runPassport: vi.fn(async (d: { onStamp?: () => void }) => d.onStamp?.()),
  runNight: vi.fn(async () => undefined),
}));

import { startFlow, type Flow } from '../src/flow';
import { bus } from '../src/systems/bus';
import { getContent } from '../src/systems/content';
import { setAppearance, defaultAppearance } from '../src/systems/avatar';
import { getSetting, setFlag } from '../src/systems/progress';
import type { WorldInteract } from '../src/types/bus';
import * as intro from '../src/ui/intro';
import type { Play } from '../src/ui/play';
import type { DayGlue } from '../src/day';
import { flush, memStore } from './overlayKit';

const content = getContent();
const T = Date.UTC(2026, 9, 14, 8);
let now = T;
const clock = { now: () => now, mono: () => now - T, offsetMs: 0 };
const store = memStore(undefined);
const calls: string[] = [];
const teleports: { location: string; spawn: unknown; facing?: string }[] = [];

const play = {
  overlay: {} as Play['overlay'],
  busy: false,
  lines: async (ids: readonly string[]) => void calls.push(...ids.map((i) => `line:${i}`)),
  effects: async (list: readonly { line?: string; startDialogue?: string; setFlag?: string }[]) => {
    for (const e of list) {
      if (e.line) calls.push(`line:${e.line}`);
      if (e.startDialogue) {
        calls.push(`dlg:${e.startDialogue}`);
        // Диалог перрона: Дима выбирает «Bez dźwięku».
        if (e.startDialogue === 'dlg.ch01.d01_peron') store.setProgress(setFlag(store.progress, 'd01.sound.mute', (now += 1000)));
      }
    }
  },
  openLesson: async (id: string, o?: { item?: string }) => {
    calls.push(`lesson:${id}${o?.item ? `#${o.item}` : ''}`);
    if (o?.item) store.append({ k: 'intro', ts: (now += 1000), item: o.item, lesson: id, ok: ['rec'] });
    return { cancelled: false, passed: true } as never;
  },
  openDialog: async (id: string) => void calls.push(`dlg:${id}`),
  dialogFor: () => null,
  openPassport: async () => undefined,
  interact: async () => undefined,
  dispose: () => undefined,
} as unknown as Play;

const day = {
  ui: {
    busy: false,
    obchod: async (o: unknown) => void calls.push(`obchod:${JSON.stringify(o)}`),
    summary: async () => {
      calls.push('summary');
      store.append({ k: 'seg', ts: (now += 1000), seg: 'sleep' });
    },
    settings: async () => undefined,
  },
  activeMs: () => 0,
  refresh: async () => undefined,
} as unknown as DayGlue;

let flow: Flow;
const at = (location: string): Promise<void> => {
  bus.emit('world:location', { id: location, controls: 'walk' });
  return flush(6);
};
const tap = async (p: Omit<WorldInteract, 'key' | 'tile' | 'via'> & Partial<WorldInteract>): Promise<boolean> => {
  const hit = flow.claim({ key: `${p.kind}:${p.id}`, tile: [0, 0], via: 'action', ...p });
  await flush(6);
  return hit;
};
const f = (): string | undefined => flow.step?.f;
const flags = (): Record<string, number> => store.progress.world.flags;

beforeAll(() => {
  bus.on('world:teleport', (t) => void teleports.push(t));
  // Fotobudka: «Gotowe» сразу, внешность пишется в настройки (как src/ui/creator.ts).
  bus.on('ui:creator:show', ({ done, opened }) => {
    opened?.();
    const a = defaultAppearance();
    store.setProgress(setAppearance(store.progress, a, (now += 1000)));
    done(a);
  });
  flow = startFlow({ content, store: Promise.resolve(store as never), clock, play, day, audio: { play: () => undefined, has: () => false } });
});

describe('день 1 через склейку режиссёра', () => {
  it('Title → карточка рассказчика → зал вокзала у фотобудки, лицом к ней', async () => {
    bus.emit('link:ready', {} as never);
    await flush(6);
    expect(intro.runCaption).toHaveBeenCalledTimes(1);
    expect(teleports.at(-1)).toEqual({ location: 'ch01.dworzec', spawn: 'start', facing: 'up' });
    expect('beat.d01.dworzec' in flags()).toBe(true);
    await at('ch01.dworzec');
    expect(f()).toBe('d01.fotobudka');
  });

  it('фотобудка: A по будке → «Bez uśmiechu» → Fotobudka → подпись; выход на перрон открыт', async () => {
    expect(await tap({ location: 'ch01.dworzec', kind: 'trigger', id: 'fotobudka' })).toBe(true);
    expect(calls).toContain('line:d01.fotobudka.1');
    expect(calls).toContain('line:d01.narr.fotobudka.1');
    expect('beat.d01.fotobudka' in flags()).toBe(true);
    expect(store.progress.settings.avatar).toBeTruthy();
    expect(flow.step?.target.location).toBe('ch01.peron');
  });

  it('перрон: реплики при входе сами; A по чемодану → диалог, «Bez dźwięku» → настройка sound.mode', async () => {
    await at('ch01.peron');
    expect(calls).toContain('line:d01.kazik.platform.1');
    expect(f()).toBe('d01.walizka');
    // A по Казику не по делу — «Kłoda!», а не чужой диалог.
    expect(await tap({ location: 'ch01.peron', kind: 'npc', id: 'bobr' })).toBe(true);
    expect(calls.at(-1)).toBe('line:idle.kazik.1');
    await tap({ location: 'ch01.peron', kind: 'npc', id: 'walizka' });
    expect(calls).toContain('dlg:dlg.ch01.d01_peron');
    expect(getSetting(store.progress, 'sound.mode')).toBe('off');
    expect(f()).toBe('d01.ulica');
  });

  it('улица и базар: табличка, вход на базар (enter), лоток Хели → плитки, паспорт, печать №1', async () => {
    await at('ch01.bazar');
    expect(calls).toContain('line:d01.kazik.street.2');
    expect(f()).toBe('d01.tablica');
    await tap({ location: 'ch01.bazar', kind: 'trigger', id: 'tablica_bazar' });
    expect(calls).toContain('line:d01.sign.bazar');
    await tap({ location: 'ch01.bazar', kind: 'trigger', id: 'wejscie_bazar', via: 'enter' });
    expect(calls).toContain('line:d01.kazik.bazar.1');
    expect(f()).toBe('d01.bazar');
    await tap({ location: 'ch01.bazar', kind: 'npc', id: 'pani_hela' });
    expect(intro.runTiles).toHaveBeenCalledTimes(1);
    expect(intro.runPassport).toHaveBeenCalledTimes(1);
    expect('stamp.first' in flags()).toBe(true);
    expect(calls).toContain('line:d01.kazik.bazar.7');
    expect('hud.passport' in flags()).toBe(true); // паспорт раскрыт
    expect(f()).toBe('d01.wisla');
  });

  it('Висла → działka: мечта о мосте, реплики участка, полив «Dzień dobry» практикой', async () => {
    await at('ch01.wisla');
    await tap({ location: 'ch01.wisla', kind: 'npc', id: 'bobr' });
    expect(calls).toContain('dlg:dlg.ch01.d01_wisla');
    await at('ch01.dzialka');
    expect(calls).toContain('line:d01.kazik.dzialka.4');
    expect(f()).toBe('d01.podlewanie');
    await tap({ location: 'ch01.dzialka', kind: 'plot', id: 'grzadki', item: 'lx.dzien_dobry', tile: [2, 6] });
    expect(calls).toContain(`obchod:${JSON.stringify({ mode: 'day', fromItem: 'lx.dzien_dobry', practice: true })}`);
    expect(calls).toContain('line:d01.brzechwa.plot.1'); // ветер: шляпа летит сразу после полива
    expect(f()).toBe('d01.kapelusz');
  });

  it('шляпа → Брзехва: три чанка урока по одному слову, знакомство, семена в карман', async () => {
    await tap({ location: 'ch01.dzialka', kind: 'npc', id: 'kapelusz' });
    expect(f()).toBe('d01.brzechwa');
    await tap({ location: 'ch01.dzialka', kind: 'npc', id: 'brzechwa' });
    const seq = calls.filter((c) => /lesson:ch01\.d01|d01\.brzechwa\.plot\.2|d01\.kazik\.plot\.1|dlg\.ch01\.d01_imie/.test(c));
    expect(seq).toEqual([
      'line:d01.brzechwa.plot.2',
      'lesson:ch01.d01.brzechwa#lx.dziekuje',
      'line:d01.kazik.plot.1',
      'lesson:ch01.d01.brzechwa#lx.prosze',
      'dlg:dlg.ch01.d01_imie',
      'lesson:ch01.d01.brzechwa#lx.czesc',
    ]);
    for (const it of ['lx.dziekuje', 'lx.prosze', 'lx.czesc']) expect(`seed.${it}` in flags()).toBe(true);
    expect(f()).toBe('d01.sadzenie');
  });

  it('посадка из кармана: A по пустым клеткам грядки — по семени на клетку; карман пуст → вечер', async () => {
    for (const [x, i] of [[3, 1], [4, 2], [5, 3]] as const) {
      expect(await tap({ location: 'ch01.dzialka', kind: 'plot', id: 'grzadki', tile: [x, 6] })).toBe(true);
      expect(Object.keys(flags()).filter((k) => k.startsWith('plant.')).length).toBe(i);
    }
    expect(Object.keys(flags()).filter((k) => k.startsWith('plant.')).sort()).toEqual(['plant.3_6.lx.dziekuje', 'plant.4_6.lx.prosze', 'plant.5_6.lx.czesc']);
    expect(calls).toContain('line:d01.kazik.hut.1');
    expect(calls).not.toContain('line:d01.kazik.hut.2'); // P-10b: повтор «спать» убран
    expect(flow.step?.target).toMatchObject({ location: 'ch01.chatka', object: 'poslanie' });
  });

  it('хатка: A по постели → итог дня → ночь («miau», Казик); день 1 закрыт', async () => {
    await at('ch01.chatka');
    await tap({ location: 'ch01.chatka', kind: 'trigger', id: 'poslanie' });
    expect(calls.filter((c) => c === 'summary')).toHaveLength(1);
    expect(intro.runNight).toHaveBeenCalledTimes(1);
    expect(vi.mocked(intro.runNight).mock.calls[0]![0]).toMatchObject({ dark: ['d01.simba.night', 'd01.kazik.hut.3'] });
    expect('beat.first_day_done' in flags()).toBe(true);
    expect(flow.step?.kind).toBe('done');
  });

  // ── P-10b: дни 2 и 3 кончаются так же — один итог в хатке и ночь; альтанка спать не кладёт.

  /** Пройти шаг режиссёра «как игрок»: склейка делает действие, журнал пишем за подменённые обход и урок. */
  async function complete(): Promise<void> {
    const s = flow.step!;
    if (s.kind === 'beat' || s.kind === 'water' || s.kind === 'scene' || s.kind === 'remedy' || s.kind === 'evening') await flow.act();
    const ts = (now += 60_000);
    if (s.kind === 'water') store.append({ k: 'seg', ts, seg: 'water' });
    if (s.kind === 'evening') store.append({ k: 'seg', ts, seg: 'evening' });
    if ((s.kind === 'scene' || s.kind === 'remedy') && s.lesson) {
      const l = content.lessons.get(s.lesson)!.value;
      if (l.kind === 'diag') store.append({ k: 'diag', ts, results: Object.fromEntries(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'].map((c) => [c, { n: 1, ok: 1 }])) });
      for (const item of l.introduces ?? []) store.append({ k: 'intro', ts, item, lesson: l.id, ok: ['rec'] });
      store.append({ k: 'lesson', ts, lesson: l.id, score: 1, firstTry: 1, ms: 60_000, passed: true, answers: 3 });
      store.append({ k: 'seg', ts, seg: s.kind === 'remedy' ? 'remedy' : 'scene' });
    }
    bus.emit('progress:changed', { kinds: ['cards'] });
    await flush(6);
  }
  async function untilSleep(): Promise<string[]> {
    const seen: string[] = [];
    await flow.refresh();
    for (let g = 0; g < 30 && flow.step && flow.step.kind !== 'sleep'; g++) {
      seen.push(`${flow.step.kind}:${flow.step.lesson ?? flow.step.beat ?? ''}`);
      await complete();
    }
    return seen;
  }

  it('день 2: обход, письмо, турникет, перрон → сон в хатке (не альтанка) → итог → ночь с «miau»', async () => {
    now = T + 86_400_000 + 2 * 3_600_000;
    const seen = await untilSleep();
    expect(seen).toContain('scene:ch01.s00');
    expect(seen).toContain('beat:d02.znaki'); // P-10b: вывески метро у Брзехвы — три новых слова дня 2
    expect(calls).toContain('dlg:dlg.ch01.peron'); // бит перрона (без цели) играется сам: Брзехва, «chrząszcz», вывески
    expect(flow.step).toMatchObject({ kind: 'sleep', target: { location: 'ch01.chatka', object: 'poslanie' } });
    // Альтанка на działce больше не триггер сна: тап по ней режиссёр не забирает, итога нет.
    await at('ch01.dzialka');
    expect(await tap({ location: 'ch01.dzialka', kind: 'trigger', id: 'altana_sleep' })).toBe(false);
    expect(calls.filter((c) => c === 'summary')).toHaveLength(1);
    await at('ch01.chatka');
    await tap({ location: 'ch01.chatka', kind: 'trigger', id: 'poslanie' });
    await flush(20);
    expect(calls.filter((c) => c === 'summary')).toHaveLength(2);
    expect(intro.runNight).toHaveBeenCalledTimes(1); // счётчик мока — за этот тест
    expect(vi.mocked(intro.runNight).mock.calls[0]![0]).toMatchObject({ dark: ['d01.simba.night'] });
    expect(flow.step?.kind).toBe('done');
  });

  it('день 3: киоск s01 идёт и при зелёном R1 (новые слова дня), табличка, сон → итог → ночь', async () => {
    now = T + 2 * 86_400_000 + 2 * 3_600_000;
    const seen = await untilSleep();
    expect(seen).toContain('scene:ch01.s01');
    expect(seen).toContain('beat:d03.tabliczka');
    expect(flow.step).toMatchObject({ kind: 'sleep', target: { location: 'ch01.chatka' } });
    await at('ch01.chatka');
    await tap({ location: 'ch01.chatka', kind: 'trigger', id: 'poslanie' });
    await flush(20);
    expect(calls.filter((c) => c === 'summary')).toHaveLength(3);
    expect(intro.runNight).toHaveBeenCalledTimes(1);
    expect(flow.step?.kind).toBe('done');
  });
});
