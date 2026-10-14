// Режиссёр (ТЗ §4.12, §5.0, I-13): каждое правило 1–10, слоты битов, раскрытие HUD, переходы
// первого дня F1–F6 и последующих дней. Реальный контент (content/), журнал собирается событиями.
import { describe, expect, it } from 'vitest';
import { getContent } from '../src/systems/content';
import {
  beatFlag,
  directorInput,
  FIRST_DAY,
  FIRST_DAY_DONE,
  FIRST_REPAIR_FLAG,
  firstFlag,
  hudFlag,
  nextStep,
  reddestCluster,
  springFlag,
  stepKey,
  type DirectorStep,
  type FirstStep,
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

const firstDone = (...fs: FirstStep[]): string[] => fs.map(firstFlag);
const ALL_FIRST = [...firstDone('f1', 'f2', 'f3', 'f4', 'f5', 'f6'), FIRST_DAY_DONE];

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
    for (const id of ['kazik.water.first', 'kazik.water.due', 'kazik.debt.jam', 'kazik.sunday', 'kazik.move.first', 'kazik.repair', 'kazik.resume', 'kazik.sleep', 'kazik.return.spring', 'kazik.evening', 'kazik.done'])
      expect(content.lines.has(id)).toBe(true);
  });
});

describe('правило 1: первый день F1–F6 (§5.0)', () => {
  it('чистый мир → F1 вступление', () => {
    const s = new World().step(at(0));
    expect(s).toMatchObject({ kind: 'intro', f: 'f1', target: { screen: 'intro' } });
    expect(s.reason).toMatch(/^1:/);
  });
  it('F1 → F2: полить одну грядку «Dzień dobry» без SRS; раскрывается паспорт', () => {
    const s = new World().flag(firstFlag('f1')).add({ k: 'intro', ts: at(0), item: 'lx.dzien_dobry', lesson: 'ch01.intro', ok: ['rec'] }).step(at(0, 10.1));
    expect(s).toMatchObject({ kind: 'intro', f: 'f2', mode: 'practice', target: { location: 'ch01.dzialka', plot: 'grzadki', item: 'lx.dzien_dobry' }, line: 'kazik.water.first' });
    expect(s.reveal).toEqual(['passport']);
  });
  it('F2 → F3: путь к метро, к турникету Brzechwy; раскрывается Obchód', () => {
    const s = new World().flag(...firstDone('f1', 'f2'), hudFlag('passport')).step(at(0));
    expect(s).toMatchObject({ kind: 'intro', f: 'f3', target: { location: 'ch01.metro', npc: 'brzechwa' }, line: 'kazik.move.first' });
    expect(s.reveal).toEqual(['obchod']);
  });
  it('F3 → F4: турникет = диагностика 1.0', () => {
    const s = new World().flag(...firstDone('f1', 'f2', 'f3')).step(at(0));
    expect(s).toMatchObject({ kind: 'intro', f: 'f4', lesson: 'ch01.s00', target: { location: 'ch01.metro', npc: 'brzechwa' } });
  });
  it('диагностика уже есть (второе устройство): путь к метро не нужен', () => {
    const s = new World().flag(...firstDone('f1', 'f2')).add(diag(at(0))).step(at(0, 11));
    expect(s.f).toBe('f5');
  });
  it('F4: мало активных минут (флаг решения) → ремонтная сцена самого красного кластера', () => {
    const w = new World().flag(...firstDone('f1', 'f2', 'f3'), FIRST_REPAIR_FLAG).add(diag(at(0)));
    expect(reddestCluster({ clusterStatus: { R3: 'red', R6: 'yellow', R1: 'green', R9: 'red' }, clusterScore: { R3: 0.2, R6: 0.5, R9: 0.4 } })).toBe('R3');
    expect(reddestCluster({ clusterStatus: { R6: 'yellow', R1: 'green' }, clusterScore: { R6: 0.7 } })).toBe('R6');
    expect(reddestCluster({ clusterStatus: { R1: 'green' }, clusterScore: {} })).toBeNull();
    const s = w.step(at(0, 10.5));
    expect(s).toMatchObject({ kind: 'intro', f: 'f4', lesson: 'ch01.s03' });
    // Ремонт попробован → F5.
    w.add(lesson('ch01.s03', at(0, 10.6), false));
    expect(w.step(at(0, 10.7)).f).toBe('f5');
  });
  it('F4 без флага решения (минут хватило) → сразу F5: 3 пары самого красного кластера', () => {
    const s = new World().flag(...firstDone('f1', 'f2', 'f3')).add(diag(at(0))).step(at(0, 10.5));
    expect(s).toMatchObject({ kind: 'intro', f: 'f5', mode: 'phonetic', limit: 3, cluster: 'R3', target: { object: 'ryby' } });
  });
  it('F5 → F6: альтанка; все кластеры зелёные — вечер пропускается', () => {
    const w = new World().flag(...firstDone('f1', 'f2', 'f3', 'f4', 'f5')).add(diag(at(0)));
    expect(w.step(at(0, 11))).toMatchObject({ kind: 'intro', f: 'f6', target: { object: 'altana_sleep' }, line: 'kazik.sleep' });
    const green = new World().flag(...firstDone('f1', 'f2', 'f3', 'f4')).add({ k: 'diag', ts: at(0), results: { R1: { ok: 10, n: 10 } } });
    expect(green.step(at(0, 11)).f).toBe('f6');
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
      .add(diag(at(-1)), lesson('ch01.intro', at(-1)), intro('lx.woda', at(-1, 10.5)), seg('evening', at(-1, 11)), seg('sleep', at(-1, 12)));

  it('бит слота start (kazik_most) раньше полива; цель — бобр на działce', () => {
    const s = day2().step(at(0));
    expect(s).toMatchObject({ kind: 'beat', beat: 'kazik_most', line: 'kazik.dream.most', target: { location: 'ch01.dzialka', npc: 'bobr' } });
    expect(s.do).toEqual([{ line: 'kazik.dream.gryze' }]);
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
  it('бит afterScene (Brzechwa рифмует имя) после сцены, до вечера', () => {
    const w = day2().flag('beat.kazik_most').add(seg('water', at(0, 10.2)), lesson('ch01.s03', at(0, 10.4)), seg('scene', at(0, 10.4)));
    expect(w.step(at(0, 10.5))).toMatchObject({ kind: 'beat', beat: 'brzechwa_rym', target: { npc: 'brzechwa' } });
  });
  it('8 → 9 → 10: вечер на звуки, альтанка, до завтра с «ещё 3 минуты»', () => {
    const w = day2().flag('beat.kazik_most', 'beat.brzechwa_rym').add(seg('water', at(0, 10.2)), lesson('ch01.s03', at(0, 10.4)), seg('scene', at(0, 10.4)));
    expect(w.step(at(0, 10.5))).toMatchObject({ kind: 'evening', mode: 'phonetic', target: { object: 'ryby' } });
    w.add(seg('evening', at(0, 10.6)));
    expect(w.step(at(0, 10.7))).toMatchObject({ kind: 'sleep', line: 'kazik.sleep', target: { object: 'altana_sleep' } });
    w.add(seg('sleep', at(0, 10.8)));
    const done = w.step(at(0, 10.9));
    expect(done).toMatchObject({ kind: 'done', line: 'kazik.done' });
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
    const w = new World().flag(...firstDone('f1', 'f2', 'f3'));
    const a = w.step(at(0));
    expect(w.step(at(0))).toEqual(a);
    const b = w.add(diag(at(0))).step(at(0, 10.5));
    expect(stepKey(a)).not.toBe(stepKey(b));
  });
});
