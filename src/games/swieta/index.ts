// Игра 4: Święta («Koło świąt», ФЕРМА_v2.md §5). Вход — сезонная доска у калитки, экран `full`: колесо года с 12 месяцами и праздниками на своих
// датах (основа — «Колесо праздников» из ПМЖ/Собес/swieta-kolo). Раунд — один праздник за раз: ближайший из не выращенных или выбранный на колесе;
// первый раз сначала карточка знакомства («Poznaj święto»), потом 3–6 заданий только про него. Календарь — calendar.ts, колесо — wheel.ts/hub.ts,
// задания — tasks.ts/plan.ts/view.ts, картины — pic.ts.
import type { GameCheck, GameCtx, PolskaGame, Want } from '../../types/polska';
import { sameTiles } from '../kit';
import { inDays, nearestHoliday, seasonalOrder, shortName } from './calendar';
import { renderHub } from './hub';
import { itemWord } from './icons';
import { takeTask } from './plan';
import { pickTask, type SwTask } from './tasks';
import { renderTask } from './view';

export * from './tasks';
export type { SwTask };

/** «Najbliższe święto: Wigilia za 3 dni» (итог раунда, баннер колеса). */
export function nearestLine(ctx: GameCtx): string | null {
  const near = nearestHoliday(ctx.units, ctx.date());
  return near ? `Najbliższe święto: ${shortName(near.unit)} ${inDays(near.days)}` : null;
}

export const game: PolskaGame<SwTask> = {
  id: 'swieta',
  title: { pl: 'Święta', ru: 'Праздники' },
  desc: 'Колесо года: выбери праздник, узнай, что это, и ответь на вопросы про него: когда, что делают, что на столе, что желают и открыты ли магазины',
  entry: 'seasonBoard',
  plot: 'klumba',
  kinds: ['holiday'],
  layout: 'full',

  pool(ctx) {
    return seasonalOrder(ctx.units, ctx.date());
  },

  hub: renderHub,

  nextTask(ctx, want: Want) {
    const u = ctx.unit(want.id);
    if (!u) return null;
    // Раунд из колеса: задания про этот праздник уже собраны (порядок рассказа). Иначе — обычное задание по просьбе движка.
    return takeTask(u.id) ?? pickTask(ctx, u, want);
  },

  render(task, panel) {
    renderTask(task, panel);
  },

  summaryLine: nearestLine,

  check(task, answer): GameCheck {
    const say = task.say;
    const rest = { ...(say ? { say } : {}), ...(task.note ? { note: task.note } : {}) };
    if (task.kind === 'pack') {
      const picked = Array.isArray(answer) ? answer.map(String) : [];
      const want = new Set(task.expect);
      const got = new Set(picked);
      const extra = [...got].filter((id) => !want.has(id));
      const missing = [...want].filter((id) => !got.has(id));
      const ok = picked.length > 0 && !extra.length && !missing.length;
      const names = (ids: string[]): string => ids.map((id) => itemWord(id).pl).join(', ');
      const note = ok ? undefined : [extra.length ? `Лишнее: ${names(extra)}` : '', missing.length ? `Не хватило: ${names(missing)}` : ''].filter(Boolean).join(' · ');
      return { ok, correct: task.correct, ...(note ? { note } : {}), ...(say ? { say } : {}) };
    }
    if (task.kind === 'wish') {
      const given = Array.isArray(answer) ? answer.map(String) : String(answer ?? '').split(/\s+/).filter(Boolean);
      return { ok: sameTiles(given, task.expectTiles ?? []), correct: task.correct, ...rest };
    }
    return { ok: String(answer) === task.answer, correct: task.correct, ...rest };
  },
};
