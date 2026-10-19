// @vitest-environment happy-dom
// F5b: пустой огород ведёт к столу, тап по коробке с любой точки, доска без противоречий, пауза фраз в играх 3 и 4,
// «созреет 0» утром и «до A0.1» с растущими словами.
import { afterEach, describe, expect, it } from 'vitest';
import sprites from '../public/atlas/sprites.json';
import { goalText, morningRipeLines } from '../src/systems/daygoal';
import { ASSEMBLE_POOL_MIN, PAUSE_TASKS, createFarm } from '../src/systems/farm';
import { DAY_MS, newGarden, type GardenSave } from '../src/systems/garden';
import { PHRASE_BY_ID } from '../src/systems/content';
import { canAssemble } from '../src/systems/quiz';
import type { Dir } from '../src/types/input';
import type { GameMode, PhraseHint } from '../src/types/farm';
import { mountAssembleGap } from '../src/ui/assembleGap';
import { mountBoard } from '../src/ui/board';
import { GUIDE_TEXT, mountGuide, type GuideStage } from '../src/ui/hintsGuide';
import { mountHud } from '../src/ui/hud';
import { mountMorning } from '../src/ui/morning';
import { approachCells, DELTA, LocationModel, STEP_MS, type WorldEvent } from '../src/world/location';
import { getMap, resolveSpawn } from '../src/world/maps';
import { run, seeded, send, testBus } from './helpers';

afterEach(() => document.body.replaceChildren());

const T0 = Date.UTC(2026, 9, 17, 9, 0);

function setup(seed = 7) {
  let saved: GardenSave = newGarden();
  let now = T0;
  const bus = testBus();
  const farm = createFarm({ bus, load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(seed) });
  return { bus, farm, setNow: (t: number) => (now = t), now: () => now, saved: () => saved };
}
type S = ReturnType<typeof setup>;

/** Ответы по растению в обе стороны верно: `rounds` кругов игр 1 и 2. */
function answerAll(s: S, id: string, rounds = 2): void {
  for (let i = 0; i < rounds; i++)
    // Слову для урожая нужна игра 5 (собрать само); фразы — игры 1 и 2.
    for (const m of [1, id.startsWith('p.') ? 2 : 5] as GameMode[]) {
      s.setNow(s.now() + 1000);
      const q = s.farm.next(m, id)!;
      s.farm.answer(q, q.answer);
    }
}

/** Посадить ближайшую фразу сборки вместе со словами и довести слова до ростка. Возвращает id фразы. */
function growPhrase(s: S): string {
  const hint = s.farm.phraseHint()!;
  s.farm.plant(hint.toPlant);
  for (const id of [...s.farm.state.items.keys()]) answerAll(s, id);
  const h2 = s.farm.phraseHint();
  const pid = h2 && h2.id === hint.id ? h2.id : hint.id;
  s.farm.plant(h2 && h2.id === hint.id ? h2.toPlant : [pid]);
  return pid;
}

// ───────────── 1. пустой огород ─────────────

describe('F5b: «Огород пуст» после урожая', () => {
  const at = { hero: { x: 100, y: 300 }, target: { x: 200, y: 120 }, via: 'door' as const };

  /** Как в main.ts: пустой огород после игры. */
  function mountWithFarm(s: S) {
    const root = document.createElement('div');
    document.body.append(root);
    const goals: (string | null)[] = [];
    s.bus.on('guide:goal', ({ use }) => goals.push(use));
    const g = mountGuide(
      root,
      {
        stage: (): GuideStage | null => {
          const g = s.saved();
          if (g.planted.length > 0 && g.log.length > 0) {
            const st = s.farm.stats();
            if (st.growing === 0 && st.bag === 0) return 'replant';
          }
          return null;
        },
        done: () => {},
      },
      s.bus,
    );
    return { root, g, goals, bubble: () => root.querySelector<HTMLElement>('[data-guide]')!, arrow: () => root.querySelector<HTMLElement>('[data-guide-arrow]')! };
  }

  it('после последнего урожая: пузырь «Огород пуст · Посади ещё слов за столом», стрелка к столу; гаснет после посадки', () => {
    const s = setup();
    s.farm.plant(['w.dzien_dobry', 'w.kot']);
    const v = mountWithFarm(s);
    expect(v.g.stage).toBeNull(); // ещё ничего не отвечено
    // три дня ответов в обе стороны: оба слова собраны
    for (let d = 0; d < 3; d++) for (const id of ['w.dzien_dobry', 'w.kot']) {
      s.setNow(T0 + d * DAY_MS + 60_000);
      answerAll(s, id, 2);
    }
    expect(s.farm.stats().growing).toBe(0);
    expect(v.g.stage).toBe('replant');
    expect(v.goals.at(-1)).toBe('desk');
    s.bus.emit('fx:guide', at);
    expect(v.bubble().hidden).toBe(false);
    expect(v.bubble().textContent).toBe(GUIDE_TEXT.replant);
    expect(v.bubble().textContent).toBe('Огород пуст · Посади ещё слов за столом');
    expect(v.arrow().hidden).toBe(false);
    // у самого стола свой пузырь не нужен
    s.bus.emit('fx:near', { use: 'desk', id: 'desk', x: 1, y: 1 });
    expect(v.bubble().hidden).toBe(true);
    s.bus.emit('fx:near', null);
    expect(v.bubble().hidden).toBe(false);
    // посадил — погас
    s.farm.plant(['w.pies']);
    expect(v.g.stage).toBeNull();
    expect(v.goals.at(-1)).toBeNull();
    s.bus.emit('fx:guide', at);
    expect(v.bubble().hidden).toBe(true);
    expect(v.arrow().hidden).toBe(true);
  });

  it('на грядках есть растущее — молчит', () => {
    const s = setup();
    s.farm.plant(['w.kot']);
    answerAll(s, 'w.kot', 1);
    const v = mountWithFarm(s);
    s.bus.emit('fx:guide', at);
    expect(v.g.stage).toBeNull();
    expect(v.bubble().hidden).toBe(true);
  });
});

// ───────────── 2. тап по коробке ─────────────

const size = (id: string): [number, number] | undefined => (sprites as unknown as Record<string, { size: [number, number] }>)[id]?.size;
const interacts = (evs: WorldEvent[]) => evs.filter((e): e is Extract<WorldEvent, { type: 'interact' }> => e.type === 'interact');
function farmAt(spawn: string | [number, number], seed = 3, facing: Dir = 'down'): LocationModel {
  const m = getMap('farm');
  const s = resolveSpawn(m, spawn, facing);
  return new LocationModel(m, s.tile, { facing: s.facing, rand: seeded(seed), spriteSize: size });
}

describe('F5b: тап по коробке издалека', () => {
  const starts: [number, number][] = [
    [25, 3],
    [20, 15],
    [4, 18],
    [14, 7],
    [26, 10],
  ];
  const bin = 'prop:bin';

  it('с пяти стартов: путь есть, герой на клетке слева от коробки, ровно один interact', () => {
    for (const st of starts) for (const seed of [1, 2, 3]) {
      const m = farmAt(st, seed);
      send(m, { type: 'interact', target: bin });
      const evs = run(m, STEP_MS * 60);
      expect(interacts(evs).map((e) => e.use), `${st} seed ${seed}`).toEqual(['bin']);
      expect(m.player.tile, `${st}`).toEqual([8, 5]);
      const d = DELTA[m.player.facing];
      expect(m.usableAt([m.player.tile[0] + d[0], m.player.tile[1] + d[1]])?.key).toBe(bin);
    }
  });

  it('кот сидит на клетке подхода: герой всё равно доходит, кот уступает', () => {
    const m = farmAt([20, 15]);
    const cat = m.cat!;
    cat.tile = [8, 5];
    cat.mode = 'sit';
    send(m, { type: 'interact', target: bin });
    const evs = run(m, STEP_MS * 60);
    expect(interacts(evs)).toHaveLength(1);
    expect(m.player.tile).toEqual([8, 5]);
  });

  it('путь оборвался на полпути (остановился не рядом): подход планируется заново и interact приходит', () => {
    const m = farmAt([20, 15]);
    send(m, { type: 'interact', target: bin });
    const first = run(m, STEP_MS * 5);
    expect(interacts(first)).toHaveLength(0);
    // обрыв пути: остаток шагов потерян, `pending` остался
    (m as unknown as { path: unknown[] }).path = [];
    const evs = run(m, STEP_MS * 60);
    expect(interacts(evs).map((e) => e.use)).toEqual(['bin']);
    expect(m.player.tile).toEqual([8, 5]);
  });

  it('двойной тап (интент пришёл дважды) не даёт двух открытий и не ломает подход', () => {
    const m = farmAt([14, 7]);
    send(m, { type: 'interact', target: bin });
    run(m, STEP_MS * 2);
    send(m, { type: 'interact', target: bin });
    const evs = run(m, STEP_MS * 60);
    expect(interacts(evs)).toHaveLength(1);
    expect(approachCells(m.object(bin)!).face).toContainEqual(m.player.tile);
  });
});

// ───────────── 3. доска ─────────────

describe('F5b: доска и ближайшая фраза', () => {
  it('ближайшая фраза — только из фраз сборки (≥ 3 плиток), не равная слову; слово не в двух строках сразу', () => {
    const s = setup();
    for (let i = 0; i < 40; i++) {
      const h = s.farm.phraseHint();
      if (!h) break;
      const p = PHRASE_BY_ID.get(h.id)!;
      expect(canAssemble(p), p.pl).toBe(true);
      expect(p.tiles_pl.length).toBeGreaterThanOrEqual(3);
      const words = p.words.map((w) => s.farm.word(w)?.pl.toLowerCase().replace(/[.!?]/g, '').trim());
      expect(words.includes(p.pl.toLowerCase().replace(/[.!?]/g, '').trim()), p.pl).toBe(false);
      for (const w of h.need) expect(h.growing).not.toContain(w);
      s.farm.plant(h.toPlant);
      for (const id of [...s.farm.state.items.keys()]) answerAll(s, id, 1);
      if (h.ready) s.farm.plant([h.id]);
    }
    expect(s.farm.phraseHint()?.id).not.toBe('p.nie_ma_za_co');
  });

  it('«Nie ma za co.» не предлагается; в доске «Нужно» и «Уже растут» без общих слов, «Нужно» пропадает, когда всё растёт', () => {
    const s = setup();
    expect(s.farm.phraseHint()!.id).not.toBe('p.nie_ma_za_co');
    const parent = document.createElement('div');
    document.body.append(parent);
    const board = mountBoard(parent, { counts: () => s.farm.counts(), onPick: () => {}, phraseHint: () => s.farm.phraseHint(), plant: (ids) => s.farm.plant(ids) });
    board.open();
    const need = () => parent.querySelector('.board-need')?.textContent ?? '';
    const growing = () => parent.querySelector('.board-growing')?.textContent ?? '';
    expect(need()).toMatch(/^Нужно: /);
    expect(growing()).toBe('');
    parent.querySelector<HTMLButtonElement>('[data-act="plant-missing"]')!.click();
    // все недостающие посажены: растут, «Нужно» нет
    expect(need()).toBe('');
    expect(growing()).toMatch(/^Уже растут: /);
  });
});

// ───────────── 4. пауза фраз ─────────────

describe('F5b: игры 3 и 4 с одной фразой', () => {
  it('одна фраза: после ответа пауза на 3 ответа, между ними gap с подсказкой «посади ещё»; потом фраза возвращается', () => {
    const s = setup();
    const pid = growPhrase(s);
    expect(s.farm.counts().assemble).toBe(1);
    expect(s.farm.gap(3)).toBeNull();
    const q1 = s.farm.next(3)!;
    expect(q1.id).toBe(pid);
    s.farm.answer(q1, q1.answer);
    // повтора нет: нечего выдать, gap объясняет
    expect(s.farm.next(3)).toBeNull();
    expect(s.farm.next(4)).toBeNull();
    const gap = s.farm.gap(3)!;
    expect(gap).not.toBeNull();
    expect(gap.hint === null || typeof gap.hint.pl === 'string').toBe(true);
    expect(s.farm.gap(1)).toBeNull();
    // «Повторить сейчас» не ограничено паузой
    expect(s.farm.next(3, pid)!.id).toBe(pid);
    // три ответа в других играх — фраза снова в очереди
    const others = [...s.farm.state.items.values()].filter((it) => !it.phrase).map((it) => it.id);
    for (let i = 0; i < PAUSE_TASKS; i++) {
      s.setNow(s.now() + 1000);
      const q = s.farm.next(1, others[i % others.length])!;
      expect(s.farm.next(3)).toBeNull();
      s.farm.answer(q, q.answer);
    }
    expect(s.farm.gap(3)).toBeNull();
    expect(s.farm.next(3)!.id).toBe(pid);
  });

  it('три и больше фраз в пуле сборки: паузы нет, очередь как раньше', () => {
    const s = setup();
    for (let i = 0; i < ASSEMBLE_POOL_MIN; i++) growPhrase(s);
    expect(s.farm.counts().assemble).toBeGreaterThanOrEqual(ASSEMBLE_POOL_MIN);
    for (let i = 0; i < 6; i++) {
      const q = s.farm.next(3)!;
      expect(q).not.toBeNull();
      s.farm.answer(q, q.answer);
    }
    expect(s.farm.gap(3)).toBeNull();
  });

  it('нет ни одной фразы сборки: gap молчит (там «Пока нечего поливать»)', () => {
    const s = setup();
    expect(s.farm.next(3)).toBeNull();
    expect(s.farm.gap(3)).toBeNull();
  });

  it('карточка: «Фраз на грядках мало», кнопка посадить ближайшую (и заново в игру), выход; гаснет вместе с игрой', () => {
    const bus = testBus();
    const root = document.createElement('div');
    document.body.append(root);
    const log: string[] = [];
    const hint: PhraseHint = { id: 'p.x', pl: 'Jak się masz?', ru: 'Как дела?', need: ['masz'], growing: [], toPlant: ['w.masz'], ready: false };
    let gap: { hint: typeof hint | null } | null = { hint };
    const g = mountAssembleGap(root, {
      bus,
      gap: () => gap,
      plant: (ids) => log.push(`plant:${ids}`),
      restart: (m) => log.push(`restart:${m}`),
      exit: () => log.push('exit'),
    });
    gap = null;
    expect(g.check(3)).toBe(false);
    expect(g.isOpen).toBe(false);
    gap = { hint };
    expect(g.check(3)).toBe(true);
    expect(root.textContent).toContain('Фраз на грядках мало');
    expect(root.textContent).toContain('Посади ещё фраз: «Jak się masz?»');
    root.querySelector<HTMLButtonElement>('[data-gap-plant]')!.click();
    expect(log).toEqual(['plant:w.masz', 'restart:3']);
    expect(g.isOpen).toBe(false);
    g.check(4);
    root.querySelector<HTMLButtonElement>('[data-gap-exit]')!.click();
    expect(log.at(-1)).toBe('exit');
    expect(g.isOpen).toBe(false);
    // слова ещё растут: только текст и «Выйти»
    gap = { hint: { ...hint, need: [], growing: ['masz'], toPlant: [] } };
    g.check(3);
    expect(root.querySelector('[data-gap-plant]')).toBeNull();
    expect(root.textContent).toContain('ещё растут');
    bus.emit('world:input', { enabled: true });
    expect(g.isOpen).toBe(false);
  });
});

// ───────────── 5. утро и HUD ─────────────

describe('F5b: «созреет 0» и «до A0.1»', () => {
  /** День 1: ответы в обе стороны по 3 словам; утро дня 2. */
  function day2() {
    const s = setup();
    const ids = ['w.dzien_dobry', 'w.kot', 'w.pies'];
    s.farm.plant(ids);
    for (const id of ids) answerAll(s, id, 2);
    s.setNow(T0 + DAY_MS + 60_000);
    return { s, ids };
  }

  it('утро дня 2: сегодня созревать нечему, но к урожаю идут растения — карточка это говорит, не голый ноль', () => {
    const { s, ids } = day2();
    const r = s.farm.ripeSoon();
    expect(r.today).toBe(0);
    expect(r.soon).toBe(ids.length);
    expect(morningRipeLines(0, 3).extra).toContain('К урожаю идут 3');
    expect(morningRipeLines(0, 0).extra).toBeUndefined();
    expect(morningRipeLines(4, 3).extra).toBeUndefined();
    expect(goalText({ watered: 0, tomorrow: 0, soon: 3 })).toBe('Сегодня: полито 0 · к урожаю идут 3');
    expect(goalText({ watered: 5, tomorrow: 2, soon: 3 })).toBe('Сегодня: полито 5 · созреет завтра 2');
    expect(goalText({ watered: 5, tomorrow: 0 })).toBe('Сегодня: полито 5');
  });

  it('карточка утра дня 2 показывает надежду рядом с нулём', async () => {
    const { s } = day2();
    const r = s.farm.ripeSoon();
    const bus = testBus();
    const root = document.createElement('div');
    document.body.append(root);
    const m = mountMorning(root, { bus, today: () => 2, recap: () => ({ label: 'Вчера', day: 1, grown: 0, watered: 12 }), ripeToday: () => r.today, ripeSoon: () => r.soon, seenDay: () => 1, mark: () => {}, delayMs: 0 });
    bus.emit('world:location', { id: 'farm', controls: 'walk' });
    await new Promise((res) => setTimeout(res, 20));
    expect(m.isOpen).toBe(true);
    const text = root.querySelector('[data-morning]')!.textContent ?? '';
    expect(text).toContain('Сегодня созреет: 0');
    expect(text).toContain('К урожаю идут 3');
  });

  it('HUD «до A1: N%»: растущие слова из фермы двигают долю пути, число растущих — в подсказке', () => {
    const s = setup();
    const root = document.createElement('div');
    document.body.append(root);
    mountHud(root, { bus: s.bus, onSettings: () => {} });
    const next = () => root.querySelector('[data-xp-next]')!.textContent;
    const tip = () => root.querySelector<HTMLElement>('[data-xp]')!.title;
    s.farm.refresh();
    expect(next()).toBe('до A1: 0%');
    s.farm.plant(['w.dzien_dobry', 'w.kot', 'w.pies']);
    s.farm.refresh();
    expect(tip()).toContain('уже растут 3');
    s.bus.emit('hud:xp', { level: 'Уровень 2', ratio: 0.1, sub: 2, of: 20, pct: 0.0149, toNext: 14, growing: 11 });
    expect(next()).toBe('до A1: 1%');
    expect(tip()).toBe('До уровня 3: 14 оч. · уже растут 11');
  });
});
