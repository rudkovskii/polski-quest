// Игра 2: Hymn i symbole («Maszt», ФЕРМА_v2.md §3). ЗАГЛУШКА ядра v2: выбор/плитки из `games/stub.ts`, но посадка уже по правилу ТЗ:
// сначала куплет 1 и припев, следующий куплет — когда все строки предыдущих хотя бы ростки; строки из дриля (`drillSeed`) приходят кустиками.
// Игровой агент заменяет рендер и задания (ułóż wers, uzupełnij, co dalej, karaoke, złóż godło/flagę), `pool` можно оставить.
import type { GameCtx } from '../../types/polska';
import { bandOrder, makeStubGame } from '../stub';

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

export const game = makeStubGame({
  id: 'hymn',
  title: { pl: 'Hymn i symbole', ru: 'Гимн и символы' },
  desc: 'Mazurek Dąbrowskiego строка за строкой, герб, флаг и символы',
  entry: 'mast',
  plot: 'pasieka',
  kinds: ['hymn', 'symbol'],
  layout: 'panel',
  pool: hymnPool,
});
