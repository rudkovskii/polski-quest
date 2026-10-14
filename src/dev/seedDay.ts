// Dev (P-06): `/?reset=1&mute=1&day=N` — чистый мир сразу в игровой день N главы 1: первый день пройден
// N − 1 календарных дней назад, каждый следующий день засчитан (полив, сон), сцены прошлых дней сыграны,
// биты и системы прошлых дней показаны. Диагностика — «всё красное», чтобы шли ремонтные сцены.
// Только dev-прогон (`?dev=play`): прогресс в отдельной базе, облако выключено.
import type { Content } from '../systems/content';
import { lessonDay } from '../systems/director';
import { FIRST_DAY_DONE_FLAG, sysFlag } from '../systems/pace';
import { setFlag, setSetting, type Progress } from '../systems/progress';
import { defaultAppearance } from '../systems/avatar';
import type { GameStorage } from '../systems/platform/storage';

const DAY = 86_400_000;

export function seedStoryDay(s: GameStorage, content: Content, n: number, now: number): void {
  if (n < 2 || FIRST_DAY_DONE_FLAG in s.progress.world.flags) return;
  const dayTs = (k: number): number => now - (n - k) * DAY - 2 * 3_600_000; // игровой день k, за 2 ч до «сейчас»
  let p: Progress = s.progress;
  p = setSetting(p, 'avatar', defaultAppearance(), dayTs(1));
  for (const f of ['beat.first.f1', 'beat.first.f2', 'beat.first.f3', 'beat.first.f4', 'beat.first.f5', 'beat.first.f6', 'hud.passport', 'stamp.first'])
    p = setFlag(p, f, dayTs(1));
  p = setFlag(p, FIRST_DAY_DONE_FLAG, dayTs(1) + 3_600_000);
  for (const e of content.director.schedule ?? []) if (e.day > 1 && e.day < n) p = setFlag(p, sysFlag(e.system), dayTs(e.day));
  for (const b of content.director.beats ?? []) {
    const m = /^d(\d\d)\./.exec(b.id);
    if (m && Number(m[1]) < n) p = setFlag(p, `beat.${b.id}`, dayTs(Number(m[1])));
  }
  if (n > 2) p = setFlag(p, 'hud.obchod', dayTs(2));
  if (n > 7) p = setFlag(p, 'hud.express', dayTs(7));
  s.setProgress(p);
  for (const item of ['lx.dzien_dobry', 'lx.czesc', 'lx.dziekuje', 'lx.prosze']) s.append({ k: 'intro', ts: dayTs(1), item, lesson: 'ch01.intro', ok: ['rec'] });
  s.append({ k: 'lesson', ts: dayTs(1), lesson: 'ch01.intro', score: 1, firstTry: 1, ms: 60_000, passed: true, answers: 1 });
  s.append({ k: 'seg', ts: dayTs(1) + 3_600_000, seg: 'sleep' });
  if (n > 2) {
    const red = Object.fromEntries(content.phonetics.clusters.map((c) => [c.id, { ok: 2, n: 10 }]));
    s.append({ k: 'diag', ts: dayTs(2), results: red });
    s.append({ k: 'lesson', ts: dayTs(2), lesson: 'ch01.s00', score: 0.2, firstTry: 0.2, ms: 240_000, passed: true, answers: 12 });
  }
  for (const { value: l } of content.lessons.values()) {
    const d = lessonDay(l);
    if (l.kind === 'practice' || l.kind === 'diag' || l.id === 'ch01.intro' || d < 3 || d >= n) continue;
    s.append({ k: 'lesson', ts: dayTs(d), lesson: l.id, score: 0.9, firstTry: 0.9, ms: 240_000, passed: true, answers: 10 });
  }
  for (let k = 2; k < n; k++) {
    s.append({ k: 'seg', ts: dayTs(k), seg: 'water' });
    s.append({ k: 'seg', ts: dayTs(k) + 3_600_000, seg: 'sleep' });
  }
}
