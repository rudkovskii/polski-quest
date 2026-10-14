// Режиссёр (ТЗ §4.12, §5.0, I-13): каждое правило 1–10, слоты битов, раскрытие HUD, переходы
// дня 1 по битам `d01.*` (P-05) и последующих дней. Реальный контент (content/), журнал собирается событиями.
import { describe, expect, it } from 'vitest';
import { getContent } from '../src/systems/content';
import {
  beatFlag,
  directorInput,
  FIRST_DAY,
  FIRST_DAY_DONE,
  FIRST_DAY_LINES,
  day1Beats,
  day1Done,
  firstFlag,
  pocketSeeds,
  hudFlag,
  nextStep,
  reddestCluster,
  springFlag,
  stepKey,
  type DirectorStep,
  type LocalResume,
} from '../src/systems/director';
import type { EventDraft } from '../src/systems/log';
import { append, newProgress, setFlag, type Progress } from '../src/systems/progress';

const content = getContent();
const DAY = 86_400_000;
const H = 3_600_000;
const TZ = 'Europe/Warsaw';
const T0 = Date.UTC(2026, 9, 14, 8); // среда 14.10.2026, 10:00 в Варшаве
const at = (day: number, h = 10): number => T0 + day * DAY + (h - 10) * H;

class World {
  p: Progress = newProgress(T0 - 30 * DAY, 'w1');
  seq = 0;
  add(...drafts: EventDraft[]): this {
    for (const d of drafts) {
      const r = append(this.p, { deviceId: 'dev001', seq: this.seq }, d);
      if (!r.ok) throw new Error(`append ${d.k}`);
      this.p = r.progress;
      this.seq = r.dev.seq;
    }
    return this;
  }
  flag(...fs: string[]): this {
    for (const f of fs) this.p = setFlag(this.p, f, T0 - DAY);
    return this;
  }
  step(now: number, o: { resume?: LocalResume; activeMin?: number } = {}): DirectorStep {
    return nextStep(directorInput(this.p, content, now, { tz: TZ, local: o.resume ? { resume: o.resume } : null, activeMin: o.activeMin ?? 0 }));
  }
}

const D1 = day1Beats(content).map((b) => b.id);
const firstDone = (...fs: string[]): string[] => fs.map(firstFlag);
const ALL_FIRST = [...firstDone(...D1), FIRST_DAY_DONE];
/** Биты дня 1 до `id` (не включая) сделаны. */
const before = (id: string): string[] => firstDone(...D1.slice(0, D1.indexOf(id)));

/** Диагностика: R3 красный (хуже всех), R6 жёлтый, остальные зелёные. */
const diag = (ts: number): EventDraft => ({
  k: 'diag',
  ts,
  results: {
    R1: { ok: 10, n: 10 },
    R2: { ok: 10, n: 10 },
    R3: { ok: 2, n: 10 },
    R4: { ok: 10, n: 10 },
    R5: { ok: 10, n: 10 },
    R6: { ok: 7, n: 10 },
    R7: { ok: 10, n: 10 },
    R8: { ok: 10, n: 10 },
    R9: { ok: 10, n: 10 },
    R10: { ok: 10, n: 10 },
  },
});
const lesson = (id: string, ts: number, passed = true): EventDraft => ({ k: 'lesson', ts, lesson: id, score: passed ? 0.9 : 0.4, firstTry: passed ? 0.9 : 0.4, ms: 60_000, passed, answers: 10 });
const intro = (item: string, ts: number): EventDraft => ({ k: 'intro', ts, item, lesson: 'ch01.s01', ok: ['rec', 'lis'] });
const seg = (s: 'water' | 'scene' | 'evening' | 'sleep' | 'remedy', ts: number): EventDraft => ({ k: 'seg', ts, seg: s });

describe('константы режиссёра ссылаются на существующий контент', () => {
  it('карты, объекты, урок вступления, слово', () => {
    const dz = content.maps.get(FIRST_DAY.dzialka)!.value;
    expect(content.maps.get(FIRST_DAY.metro)).toBeTruthy();
    for (const id of [FIRST_DAY.sleepObject, FIRST_DAY.eveningObject, FIRST_DAY.plot]) expect(dz.objects.some((o) => 'id' in o && o.id === id)).toBe(true);
    expect(content.lessons.get(FIRST_DAY.introLesson)?.value.introduces).toEqual([FIRST_DAY.introItem]);
    expect(content.vocab.get(FIRST_DAY.introItem)?.value.pl).toBe('Dzień dobry');
  });
  it('реплики шагов есть в story/lines.json', () => {
    const w = new World();
    const steps = [w.step(at(0))];
    for (const s of steps) if (s.line) expect(content.lines.has(s.line)).toBe(true);
    for (const id of ['kazik.water.due', 'kazik.debt.jam', 'kazik.sunday', 'kazik.repair', 'kazik.resume', 'kazik.sleep', 'kazik.return.spring', 'kazik.evening', 'sys.kazik.done', ...FIRST_DAY_LINES])
      expect(content.lines.has(id)).toBe(true);
    // День 1 без заглушек (P-05): реплики кода и эффектов битов есть и не todo.
    for (const id of FIRST_DAY_LINES) expect(content.lines.get(id)?.todo, id).toBeFalsy();
    for (const b of day1Beats(content)) for (const e of b.do ?? []) if (e.line) expect(content.lines.get(e.line)?.todo, e.line).toBeFalsy();
  });
});

describe('правило 1: день 1 по битам d01.* (P-05, СЮЖЕТ_v2 §4)', () => {
  it('биты дня 1 по сюжету: вокзал → … → сон; карты и цели существуют', () => {
    expect(D1).toEqual([
      'd01.dworzec', 'd01.fotobudka', 'd01.peron', 'd01.walizka', 'd01.ulica', 'd01.tablica', 'd01.wejscie', 'd01.bazar',
      'd01.wisla', 'd01.dzialka', 'd01.podlewanie', 'd01.wiatr', 'd01.kapelusz', 'd01.brzechwa', 'd01.sadzenie', 'd01.wieczor', 'd01.sen',
    ]);
    for (const b of day1Beats(content)) {
      const map = content.maps.get(b.target.location)?.value;
      expect(map, b.id).toBeTruthy();
      const t = b.target;
      if (t.npc) expect(map!.objects.some((o) => o.type === 'npc' && o.id === t.npc), `${b.id}: npc ${t.npc}`).toBe(true);
      if (t.object) expect(map!.objects.some((o) => 'id' in o && o.id === t.object), `${b.id}: ${t.object}`).toBe(true);
      if (t.plot) expect(map!.objects.some((o) => o.type === 'plot' && o.id === t.plot), `${b.id}: ${t.plot}`).toBe(true);
    }
  });
  it('чистый мир → карточка рассказчика, затем фотобудка в зале вокзала', () => {
    const s = new World().step(at(0));
    expect(s).toMatchObject({ kind: 'intro', f: 'd01.dworzec', act: 'card', target: { location: 'ch01.dworzec', screen: 'intro' } });
    expect(s.reason).toMatch(/^1:/);
    expect(new World().flag(...before('d01.fotobudka')).step(at(0))).toMatchObject({ f: 'd01.fotobudka', act: 'fotobudka', target: { location: 'ch01.dworzec', object: 'fotobudka' } });
  });
  it('шаги идут строго по порядку: каждый флаг открывает следующий бит', () => {
    const w = new World();
    const seen: string[] = [];
    for (let guard = 0; guard < 40; guard++) {
      const s = w.step(at(0));
      if (s.kind !== 'intro') break;
      seen.push(s.f!);
      if (s.act === 'brzechwa') w.flag('seed.lx.dziekuje', 'seed.lx.prosze', 'seed.lx.czesc');
      if (s.act === 'plant') w.flag('plant.2_6.lx.dziekuje', 'plant.3_6.lx.prosze', 'plant.4_6.lx.czesc');
      else w.flag(firstFlag(s.f!));
      if (s.act === 'sleep') w.flag(FIRST_DAY_DONE).add(seg('sleep', at(0, 10.5)));
    }
    expect(seen).toEqual(D1);
    expect(w.step(at(0, 11)).kind).toBe('done');
  });
  it('цели сцен: чемодан, табличка, вход на базар, лоток Хели, Казик у Вислы, шляпа, Брзехва, постель', () => {
    const t = (id: string): DirectorStep => new World().flag(...before(id)).step(at(0));
    expect(t('d01.peron')).toMatchObject({ target: { location: 'ch01.peron' }, do: [{ line: 'd01.kazik.platform.1' }, { line: 'd01.narr.platform.1' }] });
    expect(t('d01.walizka')).toMatchObject({ act: 'sound', target: { npc: 'walizka' }, do: [{ startDialogue: 'dlg.ch01.d01_peron' }] });
    expect(t('d01.tablica').target).toEqual({ location: 'ch01.bazar', object: 'tablica_bazar' });
    expect(t('d01.wejscie').target).toEqual({ location: 'ch01.bazar', object: 'wejscie_bazar' });
    expect(t('d01.bazar')).toMatchObject({ act: 'bazar', lesson: 'ch01.intro', target: { location: 'ch01.bazar', npc: 'pani_hela' } });
    expect(t('d01.wisla')).toMatchObject({ target: { location: 'ch01.wisla', npc: 'bobr' }, do: [{ startDialogue: 'dlg.ch01.d01_wisla' }] });
    expect(t('d01.kapelusz').target).toEqual({ location: 'ch01.dzialka', npc: 'kapelusz' });
    expect(t('d01.brzechwa')).toMatchObject({ act: 'brzechwa', lesson: 'ch01.d01.brzechwa', target: { npc: 'brzechwa' } });
    expect(t('d01.sen')).toMatchObject({ act: 'sleep', target: { location: 'ch01.chatka', object: 'poslanie' } });
  });
  it('полив: одна грядка «Dzień dobry» практикой без SRS, Казик рядом; паспорт раскрыт после лотка', () => {
    const s = new World().flag(...before('d01.podlewanie')).add({ k: 'intro', ts: at(0), item: 'lx.dzien_dobry', lesson: 'ch01.intro', ok: ['rec'] }).step(at(0, 10.1));
    expect(s).toMatchObject({ f: 'd01.podlewanie', act: 'water', mode: 'practice', target: { location: 'ch01.dzialka', plot: 'grzadki', item: 'lx.dzien_dobry', npc: 'bobr' } });
    expect(s.reveal).toEqual(['passport']);
    expect(new World().flag(...before('d01.bazar')).step(at(0)).reveal).toBeUndefined();
  });
  it('посадка: шаг держится, пока в кармане есть семя; карман пуст → вечер у хатки', () => {
    const w = new World().flag(...before('d01.sadzenie'), 'seed.lx.dziekuje', 'seed.lx.prosze', 'seed.lx.czesc');
    expect(w.step(at(0))).toMatchObject({ f: 'd01.sadzenie', act: 'plant', target: { plot: 'grzadki' } });
    w.flag('plant.2_6.lx.dziekuje', 'plant.3_6.lx.prosze');
    expect(w.step(at(0)).f).toBe('d01.sadzenie');
    w.flag('plant.4_6.lx.czesc');
    expect(w.step(at(0)).f).toBe('d01.wieczor');
  });
  it('карман: семя без посадки; посаженное руками уходит из кармана', () => {
    expect(pocketSeeds({ 'seed.lx.a': 1, 'seed.lx.b': 2, 'plant.3_4.lx.a': 3, 'beat.x': 4 })).toEqual(['lx.b']);
    const plant = day1Beats(content).find((b) => b.act === 'plant')!;
    expect(day1Done(plant, { 'seed.lx.a': 1 })).toBe(false);
    expect(day1Done(plant, { 'seed.lx.a': 1, 'plant.1_1.lx.a': 2 })).toBe(true);
  });
  it('выход на следующую карту закрыт, пока сцена не сыграна (if по флагу бита)', () => {
    const exits = (loc: string): string[] => content.maps.get(loc)!.value.objects.filter((o) => o.type === 'exit').map((o) => JSON.stringify(o.type === 'exit' ? o.if ?? null : null));
    expect(exits('ch01.peron')).toContain(JSON.stringify({ flag: 'beat.d01.walizka' }));
    expect(exits('ch01.bazar')).toContain(JSON.stringify({ flag: 'beat.d01.bazar' }));
    expect(exits('ch01.wisla')).toContain(JSON.stringify({ flag: 'beat.d01.wisla' }));
    expect(exits('ch01.dzialka')).toContain(JSON.stringify({ flag: 'beat.d01.wieczor' }));
  });
  it('первый день закрыт → дальше обычные правила (тот же день: до завтра)', () => {
    const w = new World().flag(...ALL_FIRST).add(diag(at(0)), seg('evening', at(0, 11)), seg('sleep', at(0, 12)));
    expect(w.step(at(0, 12.1)).kind).toBe('done');
  });
});

describe('правило 2: прерванный урок', () => {
  const resume = (startedAt: number): LocalResume => ({ lessonId: 'ch01.s03', stepIndex: 4, startedAt, answers: [] });
  it('моложе resumeHours (6 ч) → тот же урок', () => {
    const s = new World().flag(...ALL_FIRST).add(diag(at(-1))).step(at(0), { resume: resume(at(0) - 2 * H) });
    expect(s).toMatchObject({ kind: 'resume', lesson: 'ch01.s03', line: 'kazik.resume', target: { location: 'ch01.metro' } });
  });
  it('старше — урок сначала, шаг по правилам дня', () => {
    const s = new World().flag(...ALL_FIRST).add(diag(at(-1))).step(at(0), { resume: resume(at(0) - 7 * H) });
    expect(s.kind).not.toBe('resume');
  });
});

describe('правило 3: весна (пауза ≥ 7 дней)', () => {
  const w = (): World => new World().flag(...ALL_FIRST, beatFlag('kazik_most', true, '')).add(diag(at(-9)), intro('lx.woda', at(-9)), seg('water', at(-9, 11)));
  it('8 дней без игры → весна с репликой бобра, затем обход', () => {
    const s = w().step(at(0));
    expect(s).toMatchObject({ kind: 'spring', mode: 'day', line: 'kazik.return.spring', target: { plot: 'grzadki' } });
  });
  it('весна за эту паузу уже была → обычный полив', () => {
    const s = w().flag(springFlag('2026-10-05')).step(at(0));
    expect(s.kind).toBe('water');
  });
  it('6 дней — ещё не весна', () => {
    const s = w().step(at(-3));
    expect(s.kind).toBe('water');
  });
});

describe('правила 4–10 обычного дня', () => {
  /** День 2: первый день пройден вчера, R3 красный, R6 жёлтый, слова посажены вчера. */
  const day2 = (): World =>
    new World()
      .flag(...ALL_FIRST, hudFlag('passport'), hudFlag('obchod'))
      .add(diag(at(-1)), lesson('ch01.intro', at(-1)), lesson('ch01.d01.brzechwa', at(-1)), intro('lx.woda', at(-1, 10.5)), seg('evening', at(-1, 11)), seg('sleep', at(-1, 12)));

  it('мечта Казика о мосте теперь сцена дня 1 (Висла): бита kazik_most на день 2 нет, сразу полив', () => {
    expect(content.director.beats.some((b) => b.id === 'kazik_most' || b.id === 'brzechwa_rym')).toBe(false);
    expect(day2().step(at(0)).kind).toBe('water');
  });
  it('5: полив, пока сегодня не поливали', () => {
    const w = day2().flag('beat.kazik_most');
    expect(w.step(at(0))).toMatchObject({ kind: 'water', mode: 'day', line: 'kazik.water.due' });
    w.add(seg('water', at(0, 10.2)));
    expect(w.step(at(0, 10.3)).kind).not.toBe('water');
  });
  it('5: затор (долг > 60) держит полив и после раунда', () => {
    const w = day2().flag('beat.kazik_most');
    const items = [...content.vocab.values()].map((v) => v.value).filter((v) => v.srs).slice(0, 40);
    for (const v of items) w.add(intro(v.id, at(-3)));
    w.add(seg('water', at(0, 10.2)));
    const s = w.step(at(0, 10.3));
    expect(s).toMatchObject({ kind: 'water', line: 'kazik.debt.jam' });
    expect(s.reason).toMatch(/затор/);
  });
  it('6: лекарство по тегу ошибок после полива', () => {
    const w = day2().flag('beat.kazik_most').add(seg('water', at(0, 10.2)));
    for (let k = 0; k < 3; k++) w.add({ k: 'rev', ts: at(0, 10.3 + k * 0.01), card: 'lx.woda#rec', g: 0, ms: 3000, src: 'obchod', tags: ['gr.register'] });
    const s = w.step(at(0, 10.5));
    expect(s).toMatchObject({ kind: 'remedy', lesson: 'ch01.s05', line: 'kazik.repair' });
  });
  it('7: сцена — первый несданный урок, зелёные ремонты пропущены (skipIf), до диагностики закрыты', () => {
    const w = day2().flag('beat.kazik_most').add(seg('water', at(0, 10.2)));
    const s = w.step(at(0, 10.3));
    expect(s).toMatchObject({ kind: 'scene', lesson: 'ch01.s03', target: { location: 'ch01.metro', npc: 'pan_marek' } });
  });
  it('7: воскресенье — новых сцен нет, дальше вечер', () => {
    const sunday = 4; // 18.10.2026
    const w = day2().flag('beat.kazik_most').add(seg('water', at(sunday, 10.2)));
    expect(w.step(at(sunday, 10.3)).kind).not.toBe('scene');
  });
  it('7: все уроки главы сданы → босс', () => {
    const w = day2().flag('beat.kazik_most').add(seg('water', at(0, 10.2)));
    for (const id of ['ch01.s03', 'ch01.s06', 'ch01.s11', 'ch01.s12', 'ch01.s12r']) w.add(lesson(id, at(0, 10.25)));
    const s = w.step(at(0, 10.3));
    expect(s).toMatchObject({ kind: 'boss', lesson: 'ch01.boss', target: { npc: 'konduktor' } });
  });
  it('8 → 9 → 10: вечер на звуки, альтанка, до завтра с «ещё 3 минуты»', () => {
    const w = day2().flag('beat.kazik_most', 'beat.brzechwa_rym').add(seg('water', at(0, 10.2)), lesson('ch01.s03', at(0, 10.4)), seg('scene', at(0, 10.4)));
    expect(w.step(at(0, 10.5))).toMatchObject({ kind: 'evening', mode: 'phonetic', target: { object: 'ryby' } });
    w.add(seg('evening', at(0, 10.6)));
    expect(w.step(at(0, 10.7))).toMatchObject({ kind: 'sleep', line: 'kazik.sleep', target: { object: 'altana_sleep' } });
    w.add(seg('sleep', at(0, 10.8)));
    const done = w.step(at(0, 10.9));
    expect(done).toMatchObject({ kind: 'done', line: 'sys.kazik.done' });
    expect(done.reason).toMatch(/^10:/);
  });
  it('done: «ещё 3 минуты» = экспресс, если есть что полить', () => {
    const w = day2().flag('beat.kazik_most', 'beat.brzechwa_rym');
    for (const s of ['water', 'scene', 'evening', 'sleep'] as const) w.add(seg(s, at(0, 10.1)));
    // Слово с due сегодня, полив уже был (братья, вторая карточка) — экспресс доступен.
    w.add(intro('lx.kawa', at(-1, 10.5)));
    expect(w.step(at(0, 11))).toMatchObject({ kind: 'done', more3: 'express' });
  });
});

describe('раскрытие HUD и детерминизм', () => {
  it('reveal: банка → jars с репликой; флаг hud.* выключает повтор', () => {
    const w = new World().flag(...ALL_FIRST, hudFlag('passport'), hudFlag('obchod'), 'beat.kazik_most').add(diag(at(-60)), intro('lx.woda', at(-60)));
    w.add({ k: 'imp', ts: at(-50), card: 'lx.kawa#rec', state: { reps: 5, interval: 35, ef: 2.5, due: at(30) }, from: 'trainer' });
    expect(w.step(at(0)).reveal).toEqual(['jars']);
    expect(w.flag(hudFlag('jars')).step(at(0)).reveal).toBeUndefined();
  });
  it('один и тот же вход → один и тот же шаг; stepKey меняется при смене шага', () => {
    const w = new World().flag(...before('d01.bazar'));
    const a = w.step(at(0));
    expect(w.step(at(0))).toEqual(a);
    const b = w.flag(firstFlag('d01.bazar')).step(at(0, 10.5));
    expect(stepKey(a)).not.toBe(stepKey(b));
  });
});
