// Игра 2: Hymn i symbole («Maszt», ФЕРМА_v2.md §3). Гимн: ułóż wers, uzupełnij, co dalej, kolejność строк и куплетов (перевод — справкой после ответа), караоке с мелодией
// (WebAudio, тихо, под выключателем, на `?mute=1` без AudioContext — ноты видны дорожкой). Символы: вопросы-шаблоны с дистракторами, czyj to symbol,
// сборка флага и герба тап-тап, порядок легенды о Лехе. Посадка (`pool`): куплет 1 и припев, следующий куплет — когда посаженное подросло до ростка;
// строки из дриля собеса (`drillSeed`) движок сажает кустиками (решение Шэфа №4).
import type { GameCtx, PolskaGame } from '../../types/polska';
import { bandOrder } from '../stub';
import { renderTask, stopMelody } from './view';
import { checkTask, makeTask, type HymnTask } from './tasks';

export { configureHymnAudio } from './melody';

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
  const symbols = bandOrder(ctx.units.filter((u) => u.kind === 'symbol'));
  return [...out, ...symbols];
}

export const game: PolskaGame<HymnTask> = {
  id: 'hymn',
  title: { pl: 'Hymn i symbole', ru: 'Гимн и символы' },
  desc: 'Mazurek Dąbrowskiego строка за строкой с мелодией, герб, флаг и символы',
  entry: 'mast',
  plot: 'pasieka',
  kinds: ['hymn', 'symbol'],
  layout: 'panel',
  pool: hymnPool,
  nextTask: makeTask,
  render(task, panel) {
    renderTask(task, {
      ...panel,
      submit(answer) {
        stopMelody();
        panel.submit(answer);
      },
    });
  },
  check: (task, answer) => checkTask(task, answer),
};
