// Игра «Hymn» («Maszt», ФЕРМА_v2.md §3). Гимн только текстом, без музыки и нот (решение Шэфа 22.10): uzupełnij, co dalej, kolejność строк и куплетов,
// «Jaki jest następny wers?» (собрать строку из плиток); перевод — справкой после ответа. Символы с 26.10 — отдельная игра `games/symbole`
// (просьба Шэфа), задания у обеих в `tasks.ts` этой папки. Посадка (`pool`): куплет 1 и припев, следующий куплет — когда посаженное подросло до ростка;
// строки из дриля собеса (`drillSeed`) движок сажает кустиками (решение Шэфа №4).
import type { GameCtx, PolskaGame } from '../../types/polska';
import { renderTask } from './view';
import { checkTask, makeTask, type HymnTask } from './tasks';

const STANZA_ORDER = ['s1', 'ref', 's2', 's3', 's4'];

/** Строки, которые можно сажать: куплеты по порядку, следующий открывается, когда все посаженные строки хотя бы ростки. */
export function hymnPool(ctx: GameCtx): string[] {
  const lines = ctx.units.filter((u) => u.kind === 'hymn');
  const stanza = (id: string): string => String(ctx.unit(id)?.raw.stanza ?? id.split('.')[1] ?? 's1');
  const out: string[] = [];
  for (const [i, s] of STANZA_ORDER.entries()) {
    const own = lines.filter((u) => stanza(u.id) === s).map((u) => u.id);
    out.push(...own);
    // Куплет 1 и припев сажаются вместе (i = 0, 1); дальше — только когда всё посаженное до этого подросло до ростка.
    if (i < 1) continue;
    const ready = out.every((id) => {
      const inf = ctx.info(id);
      return inf.harvests > 0 || (inf.stage !== null && inf.stage !== 'seed');
    });
    if (!ready) break;
  }
  return out;
}

export const game: PolskaGame<HymnTask> = {
  id: 'hymn',
  title: { pl: 'Hymn', ru: 'Гимн' },
  desc: 'Mazurek Dąbrowskiego строка за строкой: пропуски, что дальше, порядок',
  entry: 'mast',
  plot: 'pasieka',
  kinds: ['hymn'],
  layout: 'panel',
  pool: hymnPool,
  nextTask: makeTask,
  render: (task, panel) => renderTask(task, panel),
  check: (task, answer) => checkTask(task, answer),
};
