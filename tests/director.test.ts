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
  springFlag,
  stepKey,
  type DirectorStep,
  type LocalResume,
  LINES,
  LINES_MORE,
  waterable,
} from '../src/systems/director';
import type { EventDraft } from '../src/systems/log';
import { append, newProgress, setFlag, setSetting, type Progress } from '../src/systems/progress';
import { newToday, scheduleIssues, storyDay, sysFlag, systemState } from '../src/systems/pace';

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
  /** Флаг с моментом (системы расписания: sys.* в день показа). */
  flagAt(ts: number, ...fs: string[]): this {
    for (const f of fs) this.p = setFlag(this.p, f, ts);
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
    for (const id of [FIRST_DAY.eveningObject, FIRST_DAY.plot, 'skrzynka']) expect(dz.objects.some((o) => 'id' in o && o.id === id)).toBe(true);
    // P-10b: спать только в хатке Казика — постель там, альтанка на działce не кладёт спать.
    expect(content.maps.get(FIRST_DAY.chatka)!.value.objects.some((o) => 'id' in o && o.id === FIRST_DAY.sleepObject)).toBe(true);
    expect(dz.objects.some((o) => 'id' in o && o.id === 'altana_sleep')).toBe(false);
    expect(content.lessons.get(FIRST_DAY.introLesson)?.value.introduces).toEqual([FIRST_DAY.introItem]);
    expect(content.vocab.get(FIRST_DAY.introItem)?.value.pl).toBe('Dzień dobry');
  });
  it('реплики шагов есть в story/lines.json и без todo', () => {
    for (const id of [...Object.values(LINES), ...Object.values(LINES_MORE).flat(), ...FIRST_DAY_LINES]) {
      expect(content.lines.has(id), id).toBe(true);
      expect(content.lines.get(id)?.todo, id).toBeFalsy();
    }
    // День 1 без заглушек (P-05): реплики эффектов битов есть и не todo.
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
  it('в день 1 турникета и вечера нет (диагностика — день 2, вечер — день 5): после посадки — хатка; Obchód не раскрыт', () => {
    const s = new World().flag(...before('d01.wieczor'), hudFlag('passport')).step(at(0));
    expect(s).toMatchObject({ kind: 'intro', f: 'd01.wieczor' });
    expect(s.reveal).toBeUndefined();
    expect(new World().flag(...before('d01.sen'), hudFlag('passport')).step(at(0))).toMatchObject({ kind: 'intro', f: 'd01.sen', act: 'sleep' });
  });
  it('первый день закрыт → дальше обычные правила (тот же день: до завтра)', () => {
    const w = new World().flag(...ALL_FIRST).add(seg('sleep', at(-1, 12)));
    expect(w.flagAt(at(0, 9), FIRST_DAY_DONE).add(seg('sleep', at(0, 9.5))).step(at(0, 12.1)).kind).toBe('done');
  });
});

describe('игровой день и расписание систем (P-06)', () => {
  it('storyDay: день 1 до флага конца первого дня, дальше +1 за засчитанный день', () => {
    const w = new World();
    const d = (now: number): number => directorInput(w.p, content, now, { tz: TZ }).day;
    expect(d(at(0))).toBe(1);
    w.flagAt(at(0, 12), FIRST_DAY_DONE);
    expect(d(at(0, 13))).toBe(1);
    expect(d(at(1))).toBe(2);
    expect(d(at(5))).toBe(2); // пропуск календарных дней не двигает день главы
    w.add(seg('water', at(5, 10.5)));
    expect(d(at(6))).toBe(3);
    expect(storyDay({ days: {}, today: '2026-10-20' }, {})).toBe(1);
  });
  it('расписание из director.json: дни растут, система не повторяется, день 2 — обход с письмом, метро и диагностикой', () => {
    const sch = content.director.schedule ?? [];
    expect(scheduleIssues(sch)).toEqual([]);
    expect(sch.map((e) => [e.day, e.system])).toEqual([
      [1, 'walk'],
      [2, 'obchod'],
      [3, 'keyboard'],
      [4, 'shadow'],
      [5, 'evening'],
      [6, 'eveningChoice'],
      [7, 'express'],
      [8, 'reallife'],
      [14, 'map'],
    ]);
    expect(sch[1]!.with).toEqual(['letter', 'metro', 'diag']);
    expect(scheduleIssues([...sch, { day: 14, system: 'map', ru: 'x' }]).length).toBeGreaterThan(0);
  });
  it('систему нельзя открыть раньше её дня; в день — не больше одной новой', () => {
    const today = '2026-10-15';
    const sch = content.director.schedule ?? [];
    const ctx = (day: number, flags: Record<string, number> = {}) => ({ day, today, flags, schedule: sch, opts: { tz: TZ } });
    expect(systemState('keyboard', ctx(2))).toBe('closed');
    expect(systemState('keyboard', ctx(3))).toBe('new');
    // Вечер не показали в день 5 (не было пар) — в день 6 он может прийти, но не вместе с выбором вечера.
    const at6 = Date.UTC(2026, 9, 15, 9);
    expect(systemState('evening', ctx(6))).toBe('new');
    expect(systemState('eveningChoice', ctx(6, { [sysFlag('evening')]: at6 }))).toBe('closed');
    expect(newToday(ctx(6, { [sysFlag('evening')]: at6 }))).toEqual(['evening']);
    // Показанная вчера система открыта.
    expect(systemState('obchod', ctx(3, { [sysFlag('obchod')]: at6 - DAY }))).toBe('open');
    // День 1 (вступление) открыт всегда; вне расписания — тоже.
    expect(systemState('walk', ctx(1))).toBe('open');
  });
});

describe('правило 2: прерванный урок', () => {
  const resume = (startedAt: number): LocalResume => ({ lessonId: 'ch01.s03', stepIndex: 4, startedAt, answers: [] });
  it('моложе resumeHours (6 ч) → тот же урок', () => {
    const s = new World().flag(...ALL_FIRST).add(diag(at(-1))).step(at(0), { resume: resume(at(0) - 2 * H) });
    expect(s).toMatchObject({ kind: 'resume', lesson: 'ch01.s03', line: 'sys.kazik.resume', lines: ['sys.kazik.resume.2'], target: { location: 'ch01.metro' } });
  });
  it('старше — урок сначала, шаг по правилам дня', () => {
    const s = new World().flag(...ALL_FIRST).add(diag(at(-1))).step(at(0), { resume: resume(at(0) - 7 * H) });
    expect(s.kind).not.toBe('resume');
  });
});

describe('правило 3: весна (пауза ≥ 7 дней)', () => {
  const w = (): World => new World().flagAt(at(-10), ...ALL_FIRST).flag('beat.d02.title', 'beat.d03.title').add(diag(at(-9)), intro('lx.woda', at(-9)), seg('water', at(-9, 11)));
  it('8 дней без игры → весна с репликой бобра, затем обход', () => {
    const s = w().step(at(0));
    expect(s).toMatchObject({ kind: 'spring', mode: 'day', line: 'sys.kazik.return', lines: ['sys.kazik.return.2'], target: { plot: 'grzadki' } });
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

/** Мир после первого дня (вчера): «Dzień dobry» посажено, первый день закрыт. */
const afterDay1 = (): World =>
  new World().flag(...ALL_FIRST, hudFlag('passport')).add(lesson('ch01.intro', at(-1)), intro('lx.dzien_dobry', at(-1, 10.5)), seg('sleep', at(-1, 12)));

describe('день 2 «Bramka słucha» (P-06): обход, письмо, метро, диагностика', () => {
  it('утро: заголовок дня пузырём, потом обход с зарубками (система obchod)', () => {
    const w = afterDay1();
    expect(w.step(at(0))).toMatchObject({ kind: 'beat', beat: 'd02.title', line: 'd02.ui.title', target: { location: 'ch01.dzialka' } });
    w.flag('beat.d02.title');
    expect(w.step(at(0))).toMatchObject({ kind: 'water', mode: 'day', line: 'd02.kazik.obchod.1', lines: ['d02.kazik.obchod.2'], system: 'obchod' });
  });
  it('после обхода: «Wszystko podlane», письмо в ящике у калитки, потом турникет', () => {
    const w = afterDay1().flag('beat.d02.title').flagAt(at(0, 10.1), sysFlag('obchod')).add(seg('water', at(0, 10.2)));
    expect(w.step(at(0, 10.3))).toMatchObject({ kind: 'beat', beat: 'd02.podlane', line: 'd02.kazik.obchod.3' });
    w.flag('beat.d02.podlane');
    expect(w.step(at(0, 10.3))).toMatchObject({ kind: 'beat', beat: 'd02.letter', system: 'letter', target: { location: 'ch01.dzialka', object: 'skrzynka' }, do: [{ startDialogue: 'dlg.ch01.list' }] });
    w.flag('beat.d02.letter');
    expect(w.step(at(0, 10.4))).toMatchObject({ kind: 'scene', lesson: 'ch01.s00', line: 'd02.kazik.most.1', target: { location: 'ch01.metro', npc: 'brzechwa' } });
  });
  it('Obchód в HUD раскрывается в день 2 (флаг sys.obchod), а не в первый', () => {
    const w = afterDay1().flag('beat.d02.title').flagAt(at(0, 10.1), sysFlag('obchod'));
    expect(w.step(at(0, 10.2)).reveal).toContain('obchod');
  });
  it('после диагностики: перрон с обещанием «chrząszcz», вторая сцена в день 2 не нужна', () => {
    const w = afterDay1().flag('beat.d02.title', 'beat.d02.podlane', 'beat.d02.letter').flagAt(at(0, 10.1), sysFlag('obchod'));
    w.add(seg('water', at(0, 10.2)), diag(at(0, 10.5)), lesson('ch01.s00', at(0, 10.5)), seg('scene', at(0, 10.5)));
    // P-10b: сразу после турникета — вывески метро у Брзехвы (три новых слова дня 2).
    expect(w.step(at(0, 10.6))).toMatchObject({ kind: 'beat', beat: 'd02.znaki', target: { location: 'ch01.metro', npc: 'brzechwa' }, do: [{ startLesson: 'ch01.d02.znaki' }] });
    w.add(lesson('ch01.d02.znaki', at(0, 10.55)));
    expect(w.step(at(0, 10.6))).toMatchObject({ kind: 'beat', beat: 'd02.peron', do: [{ startDialogue: 'dlg.ch01.peron' }] });
    w.flag('beat.d02.peron');
    const s = w.step(at(0, 10.7));
    expect(s).toMatchObject({ kind: 'sleep', line: 'd02.kazik.hut.1' });
  });
  it('экспресс и «ещё 3 минуты» до дня 7 не предлагаются', () => {
    const w = afterDay1().flag('beat.d02.title').flagAt(at(0, 10.1), sysFlag('obchod'));
    for (const g of ['water', 'scene', 'sleep'] as const) w.add(seg(g, at(0, 10.2)));
    w.add(intro('lx.kawa', at(-1, 10.5)));
    const done = w.step(at(0, 11));
    expect(done.kind).toBe('done');
    expect(done.more3).toBeUndefined();
  });
});

/** День N: первый день вчера-позавчера…, каждый день засчитан полив. */
/** Диагностика «всё красное»: все ремонтные сцены играются. */
const diagRed = (ts: number): EventDraft => ({ k: 'diag', ts, results: Object.fromEntries(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'].map((c) => [c, { ok: 2, n: 10 }])) });
const dayN = (n: number): World => {
  const w = afterDay1().add(diagRed(at(0, 10.5)), lesson('ch01.s00', at(0, 10.5)), lesson('ch01.d02.znaki', at(0, 10.55)));
  w.flagAt(at(0, 10.1), sysFlag('obchod'));
  for (let d = 0; d < n - 2; d++) w.add(seg('water', at(d, 10.2)), seg('sleep', at(d, 12)));
  for (let k = 2; k <= n; k++) w.flag(`beat.d${String(k).padStart(2, '0')}.title`);
  w.flag('beat.d02.podlane', 'beat.d02.letter', 'beat.d02.peron');
  return w;
};

describe('стык дня 1 (P-05) и дня 2 (P-06)', () => {
  /** Мир, прошедший день 1 по битам, как в игре: уроки лотка и забора, семена посажены, сон. */
  const played = (): World => {
    const w = new World();
    for (let guard = 0; guard < 40; guard++) {
      const s = w.step(at(0));
      if (s.kind !== 'intro') break;
      if (s.act === 'bazar') w.add(lesson('ch01.intro', at(0, 10.1)), { k: 'intro', ts: at(0, 10.1), item: 'lx.dzien_dobry', lesson: 'ch01.intro', ok: ['rec'] });
      if (s.act === 'brzechwa') w.add(lesson('ch01.d01.brzechwa', at(0, 10.3))).flag('seed.lx.dziekuje', 'seed.lx.prosze', 'seed.lx.czesc');
      if (s.act === 'plant') w.flag('plant.2_6.lx.dziekuje', 'plant.3_6.lx.prosze', 'plant.4_6.lx.czesc');
      else w.flag(firstFlag(s.f!));
      if (s.act === 'sleep') w.add(seg('sleep', at(0, 10.5))).flagAt(at(0, 10.5), FIRST_DAY_DONE);
    }
    return w;
  };
  it('день 1 закрыт сном: в тот же день — «до завтра» без экспресса и без «ещё 3 минуты»', () => {
    const w = played();
    expect(directorInput(w.p, content, at(0, 11), { tz: TZ }).day).toBe(1);
    const s = w.step(at(0, 11));
    expect(s).toMatchObject({ kind: 'done', line: 'sys.kazik.done' });
    expect(s.more3).toBeUndefined();
  });
  it('назавтра — день 2: заголовок, обход (система obchod), письмо, турникет; уроки дня 1 сценой не зовутся', () => {
    const w = played();
    expect(directorInput(w.p, content, at(1), { tz: TZ }).day).toBe(2);
    expect(w.step(at(1))).toMatchObject({ kind: 'beat', beat: 'd02.title' });
    w.flag('beat.d02.title');
    expect(w.step(at(1))).toMatchObject({ kind: 'water', system: 'obchod', line: 'd02.kazik.obchod.1' });
    w.flagAt(at(1, 10.1), sysFlag('obchod')).add(seg('water', at(1, 10.2))).flag('beat.d02.podlane');
    expect(w.step(at(1, 10.3))).toMatchObject({ kind: 'beat', beat: 'd02.letter', target: { object: 'skrzynka' } });
    w.flag('beat.d02.letter');
    expect(w.step(at(1, 10.4))).toMatchObject({ kind: 'scene', lesson: 'ch01.s00', target: { location: 'ch01.metro' } });
  });
  it('итог дня 1 — карточка P-05: крючок «Jutro: list.» и в director.days[1]', () => {
    expect(content.director.days?.find((d) => d.day === 1)?.hook).toBe('d01.ui.hook');
  });
});

describe('дни 3–14 (P-06): одна новая система в день', () => {
  it('день 3: ремонт ударения у киоска (s01), вечером табличка — экранная клавиатура', () => {
    const w = dayN(3);
    expect(directorInput(w.p, content, at(1), { tz: TZ }).day).toBe(3);
    w.add(seg('water', at(1, 10.2)));
    const sc = w.step(at(1, 10.3));
    expect(sc).toMatchObject({ kind: 'scene', lesson: 'ch01.s01' });
    w.add(lesson('ch01.s01', at(1, 10.4)), seg('scene', at(1, 10.4)));
    expect(w.step(at(1, 10.5))).toMatchObject({ kind: 'beat', beat: 'd03.tabliczka', system: 'keyboard', target: { npc: 'bobr' } });
  });
  it('день 3: сцены дня 4 закрыты (requires gameDay) — квота одна сцена', () => {
    const w = dayN(3).add(seg('water', at(1, 10.2)), lesson('ch01.s01', at(1, 10.4)), seg('scene', at(1, 10.4))).flag('beat.d03.tabliczka');
    const s = w.step(at(1, 10.5));
    expect(['sleep', 'evening']).toContain(s.kind);
    expect(s.kind).not.toBe('scene');
  });
  it('день 4: две сцены у тележки (s02 и s03), перед ними «повтори вслух»', () => {
    const w = dayN(4).flag('beat.d03.tabliczka').flagAt(at(1, 11), sysFlag('keyboard')).add(lesson('ch01.s01', at(1, 10.4)));
    w.add(seg('water', at(2, 10.2)));
    expect(w.step(at(2, 10.3))).toMatchObject({ kind: 'beat', beat: 'd04.shadow', system: 'shadow', line: 'd04.kazik.shadow.1', do: [{ line: 'd04.kazik.shadow.2' }] });
    w.flag('beat.d04.shadow');
    expect(w.step(at(2, 10.3))).toMatchObject({ kind: 'scene', lesson: 'ch01.s02' });
    w.add(lesson('ch01.s02', at(2, 10.4)));
    expect(w.step(at(2, 10.5))).toMatchObject({ kind: 'scene', lesson: 'ch01.s03' });
    w.add(lesson('ch01.s03', at(2, 10.6)));
    expect(w.step(at(2, 10.7)).kind).not.toBe('scene');
  });
  it('пропущенная вчера сцена идёт второй сегодня с репликой «ещё одна свая»', () => {
    const w = dayN(5).flag('beat.d03.tabliczka', 'beat.d04.shadow').add(lesson('ch01.s01', at(1, 10.4)), lesson('ch01.s02', at(2, 10.4)));
    w.add(seg('water', at(3, 10.2)), lesson('ch01.s03', at(3, 10.3)));
    expect(w.step(at(3, 10.4))).toMatchObject({ kind: 'scene', lesson: 'ch01.s04' });
    const v = dayN(5).flag('beat.d03.tabliczka', 'beat.d04.shadow').add(lesson('ch01.s01', at(1, 10.4)), lesson('ch01.s02', at(2, 10.4)));
    v.add(seg('water', at(3, 10.2)), lesson('ch01.s04', at(3, 10.3)));
    expect(v.step(at(3, 10.4))).toMatchObject({ kind: 'scene', lesson: 'ch01.s03', line: 'sys.kazik.extra_repair' });
  });
  it('день 5: первый вечер у Вислы (система evening) с репликами дня', () => {
    const w = dayN(5).flag('beat.d03.tabliczka', 'beat.d04.shadow', 'beat.d05.simba');
    for (const id of ['ch01.s01', 'ch01.s02', 'ch01.s03', 'ch01.s04']) w.add(lesson(id, at(2, 10.4)));
    w.add(seg('water', at(3, 10.2)), seg('scene', at(3, 10.3)), lesson('ch01.s04', at(3, 10.3)));
    const s = w.step(at(3, 10.5));
    expect(s).toMatchObject({ kind: 'evening', system: 'evening', line: 'd05.kazik.evening.1', lines: ['d05.kazik.evening.2'] });
    expect(s.choose).toBeUndefined();
  });
  it('день 6: выбор вечера (рыбалка или табличка), если вечер уже был', () => {
    const w = dayN(6).flag('beat.d03.tabliczka', 'beat.d04.shadow', 'beat.d05.simba', 'beat.d06.simba').flagAt(at(3, 11), sysFlag('evening'));
    for (const id of ['ch01.s01', 'ch01.s02', 'ch01.s03', 'ch01.s04', 'ch01.s05', 'ch01.s06']) w.add(lesson(id, at(2, 10.4)));
    w.add(seg('water', at(4, 10.2)), seg('scene', at(4, 10.3)));
    expect(w.step(at(4, 10.5))).toMatchObject({ kind: 'evening', choose: true, system: 'eveningChoice', line: 'd06.kazik.evening.1' });
  });
  it('воскресенье до дня 7 — обычный день со сценой; с дня 7 — без новых сцен', () => {
    // at(4) = воскресенье 18.10.2026, при dayN(6) это день 6.
    const w = dayN(6).flag('beat.d03.tabliczka', 'beat.d04.shadow');
    for (const id of ['ch01.s01', 'ch01.s02', 'ch01.s03', 'ch01.s04']) w.add(lesson(id, at(2, 10.4)));
    w.add(seg('water', at(4, 10.2)));
    expect(w.step(at(4, 10.3))).toMatchObject({ kind: 'scene', lesson: 'ch01.s05' });
    const late = dayN(7).flagAt(at(4, 10), sysFlag('express')).flag('beat.d03.tabliczka', 'beat.d04.shadow', 'beat.d07.morning', 'beat.d07.express');
    for (const id of ['ch01.s01', 'ch01.s02', 'ch01.s03', 'ch01.s04', 'ch01.s05', 'ch01.s06']) late.add(lesson(id, at(2, 10.4)));
    // день 7 приходится на понедельник 19.10 — сцен по расписанию нет (s07 — день 8)
    late.add(seg('water', at(5, 10.2)));
    expect(late.step(at(5, 10.3)).kind).not.toBe('scene');
  });
  it('день 7: экспресс-обход вводится битом, «ещё 3 минуты» с этого дня — экспресс', () => {
    const w = dayN(7).flag('beat.d03.tabliczka', 'beat.d04.shadow', 'beat.d07.morning');
    w.add(seg('water', at(5, 10.2)));
    expect(w.step(at(5, 10.3))).toMatchObject({ kind: 'beat', beat: 'd07.express', system: 'express', line: 'd07.kazik.express.1' });
  });
  it('день 14: босс только с дня 14, после печати — первый пролёт', () => {
    const all = ['ch01.s01', 'ch01.s02', 'ch01.s03', 'ch01.s04', 'ch01.s05', 'ch01.s06', 'ch01.s07', 'ch01.s08', 'ch01.s09', 'ch01.s10', 'ch01.s11', 'ch01.s12', 'ch01.s12r'];
    const flags = ['beat.d03.tabliczka', 'beat.d04.shadow', 'beat.d07.express', 'beat.d08.reallife', 'beat.d14.morning', 'beat.d07.morning'];
    const d13 = dayN(13).flag(...flags);
    for (const id of all) d13.add(lesson(id, at(1, 10.4)));
    d13.add(seg('water', at(11, 10.2)));
    expect(d13.step(at(11, 10.3)).kind).not.toBe('boss');
    const d14 = dayN(14).flag(...flags, ...(content.director.beats ?? []).filter((b) => !b.id.startsWith('d14.')).map((b) => `beat.${b.id}`));
    for (const id of all) d14.add(lesson(id, at(1, 10.4)));
    d14.add(seg('water', at(12, 10.2)));
    expect(d14.step(at(12, 10.3))).toMatchObject({ kind: 'boss', lesson: 'ch01.boss', target: { npc: 'konduktor' } });
    d14.flag('ch01.done').add({ k: 'boss', ts: at(12, 10.5), lesson: 'ch01.boss', parts: {}, score: 0.9, passed: true } as unknown as EventDraft);
    d14.add(seg('scene', at(12, 10.5)), seg('evening', at(12, 10.6)));
    expect(d14.step(at(12, 10.7))).toMatchObject({ kind: 'beat', beat: 'd14.most', target: { npc: 'bobr' }, do: [{ startDialogue: 'dlg.ch01.most' }] });
  });
});

describe('правила 5–10 обычного дня', () => {
  /** День 2 после утра: R3 красный, R6 жёлтый, «woda» посажено вчера. */
  const day2 = (): World =>
    new World()
      .flag(...ALL_FIRST, hudFlag('passport'), hudFlag('obchod'), 'beat.d02.title', 'beat.d02.podlane', 'beat.d02.letter', 'beat.d02.peron')
      .add(diag(at(-1)), lesson('ch01.s00', at(-1)), lesson('ch01.d02.znaki', at(-1)), lesson('ch01.intro', at(-1)), lesson('ch01.d01.brzechwa', at(-1)), intro('lx.woda', at(-1, 10.5)), seg('sleep', at(-1, 12)));

  it('мечта Казика о мосте — сцена дня 1 (Висла): старых битов kazik_most / brzechwa_rym нет, день 2 начинается с полива', () => {
    expect(content.director.beats.some((b) => b.id === 'kazik_most' || b.id === 'brzechwa_rym')).toBe(false);
    expect(day2().step(at(0)).kind).toBe('water');
  });
  it('5: полив, пока сегодня не поливали', () => {
    const w = day2();
    expect(w.step(at(0))).toMatchObject({ kind: 'water', mode: 'day' });
    w.add(seg('water', at(0, 10.2)));
    expect(w.step(at(0, 10.3)).kind).not.toBe('water');
  });
  it('5: затор (долг > 60) держит полив и после раунда', () => {
    const w = day2();
    const items = [...content.vocab.values()].map((v) => v.value).filter((v) => v.srs).slice(0, 40);
    for (const v of items) w.add(intro(v.id, at(-3)));
    w.add(seg('water', at(0, 10.2)));
    const s = w.step(at(0, 10.3));
    expect(s).toMatchObject({ kind: 'water', line: 'sys.kazik.jam', lines: ['sys.kazik.jam.2'] });
    expect(s.reason).toMatch(/затор/);
  });
  it('6: лекарство — только по сыгранной сцене своего дня (ремонт дня 6 раньше срока не зовём)', () => {
    const w = day2().add(seg('water', at(0, 10.2)));
    for (let k = 0; k < 3; k++) w.add({ k: 'rev', ts: at(0, 10.3 + k * 0.01), card: 'lx.woda#rec', g: 0, ms: 3000, src: 'obchod', tags: ['gr.register'] });
    expect(w.step(at(0, 10.5)).kind).not.toBe('remedy');
    // День 9: сцена s03 (день 4) давно сыграна, ошибки ł/l копятся — подбить сваю.
    const d9 = dayN(9).flag(...(content.director.beats ?? []).map((b) => `beat.${b.id}`));
    for (const id of ['ch01.s01', 'ch01.s02', 'ch01.s03', 'ch01.s04', 'ch01.s05', 'ch01.s06', 'ch01.s07']) d9.add(lesson(id, at(2, 10.4)));
    d9.add(seg('water', at(7, 10.2)));
    for (let k = 0; k < 3; k++) d9.add({ k: 'rev', ts: at(7, 10.3 + k * 0.01), card: 'lx.woda#rec', g: 0, ms: 3000, src: 'obchod', tags: ['ph.l_w'] });
    expect(d9.step(at(7, 10.5))).toMatchObject({ kind: 'remedy', lesson: 'ch01.s03', line: 'sys.kazik.repair', lines: ['sys.kazik.repair.2'] });
  });
  it('7: сцена дня 3 — первый несданный урок своего дня (зелёные ремонты пропущены)', () => {
    const w = day2().add(seg('water', at(0, 10.2)), seg('sleep', at(0, 12)), seg('water', at(1, 10.2)));
    expect(directorInput(w.p, content, at(1, 10.3), { tz: TZ }).day).toBe(3);
    // R1 зелёный → s01 пропущен; день 3 без сцены.
    expect(w.step(at(1, 10.3)).kind).not.toBe('scene');
  });
  it('8 → 9 → 10: альтанка, до завтра', () => {
    const w = day2().add(seg('water', at(0, 10.2)), seg('scene', at(0, 10.4)));
    expect(w.step(at(0, 10.7))).toMatchObject({ kind: 'sleep', line: 'd02.kazik.hut.1', target: { location: 'ch01.chatka', object: 'poslanie' } });
    w.add(seg('sleep', at(0, 10.8)));
    const done = w.step(at(0, 10.9));
    expect(done).toMatchObject({ kind: 'done', line: 'sys.kazik.done' });
    // «Жми +3 минуты» (sys.kazik.done.2) — только когда кнопка есть; в день 2 её нет.
    expect(done.lines).toBeUndefined();
    expect(done.more3).toBeUndefined();
    expect(done.reason).toMatch(/^10:/);
  });
});

describe('раскрытие HUD и детерминизм', () => {
  it('reveal: банка → jars с репликой; флаг hud.* выключает повтор', () => {
    const w = new World().flag(...ALL_FIRST, hudFlag('passport'), hudFlag('obchod'), 'beat.d02.title').add(diag(at(-60)), intro('lx.woda', at(-60)));
    w.add({ k: 'imp', ts: at(-50), card: 'lx.kawa#rec', state: { reps: 5, interval: 35, ef: 2.5, due: at(30) }, from: 'trainer' });
    expect(w.step(at(0)).reveal).toContain('jars');
    expect(w.flag(hudFlag('jars')).step(at(0)).reveal ?? []).not.toContain('jars');
  });
  it('один и тот же вход → один и тот же шаг; stepKey меняется при смене шага', () => {
    const w = afterDay1();
    const a = w.step(at(0));
    expect(w.step(at(0))).toEqual(a);
    const b = w.flag('beat.d02.title').step(at(0));
    // День 1 (P-05): тот же вход — тот же бит; флаг бита — следующий.
    const w1 = new World().flag(...before('d01.bazar'));
    const c = w1.step(at(0));
    expect(w1.step(at(0))).toEqual(c);
    expect(stepKey(w1.flag(firstFlag('d01.bazar')).step(at(0, 10.5)))).not.toBe(stepKey(c));
    expect(stepKey(a)).not.toBe(stepKey(b));
  });
});

describe('режим без звука (P-10b): карточки на слух не пропадают', () => {
  it('sound.mode off → lis-карточки на месте, растения с «!» те же; туда и обратно ничего не теряется', () => {
    const w = afterDay1();
    const input = (p: Progress) => directorInput(p, content, at(0, 10), { tz: TZ });
    const lis = (p: Progress): number => Object.keys(input(p).derived.cards).filter((c) => c.endsWith('#lis')).length;
    const n = lis(w.p);
    const due = waterable(input(w.p));
    expect(n).toBeGreaterThan(0);
    const off = setSetting(w.p, 'sound.mode', 'off', at(-1));
    expect(lis(off)).toBe(n);
    expect(waterable(input(off))).toBe(due);
    const on = setSetting(off, 'sound.mode', 'on', at(-1, 1));
    expect(lis(on)).toBe(n);
    expect(waterable(input(on))).toBe(due);
  });
});
