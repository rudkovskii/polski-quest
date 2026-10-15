// Шаги удобрения огорода Wola (W-04, плейтест: дистракторы «река», «поезд», «манго» к «Do widzenia» отсекались сразу).
// Узнавание («X — это…»): неверные переводы — знакомые слова той же темы (еда к еде, приветствия к приветствиям), потом
// той же темы, потом знакомые той же части речи. На слух и набор — как в основной игре; без звука «Как это пишется?»
// получает ловушки написания в самом упражнении (ExerciseCtx.spellTraps). Чисто, детерминированно по id карточки.
import { fnv1a } from '../../systems/hash';
import { parseCardId } from '../../systems/srs';
import type { Step, VocabEntry } from '../../types/content';

function stable<T>(xs: readonly T[], seed: string): T[] {
  let h = fnv1a(seed) || 1;
  return xs
    .map((x) => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      return { x, k: h };
    })
    .sort((a, b) => a.k - b.k)
    .map((e) => e.x);
}

/** До `n` неверных переводов для слова `v`: знакомые той же темы → та же тема → знакомые той же части речи → любые. */
export function sameThemeWrong(v: VocabEntry, pool: readonly VocabEntry[], known: (id: string) => boolean, n = 2): string[] {
  const theme = v.tags?.[0];
  const others = pool.filter((x) => x.id !== v.id && x.ru !== v.ru);
  const tiers = [
    others.filter((x) => x.tags?.[0] === theme && known(x.id) && x.pos === v.pos),
    others.filter((x) => x.tags?.[0] === theme && known(x.id)),
    others.filter((x) => x.tags?.[0] === theme),
    others.filter((x) => known(x.id) && x.pos === v.pos),
    others.filter((x) => x.pos === v.pos),
    others,
  ];
  const out: string[] = [];
  tiers.forEach((tier, i) => {
    for (const x of stable(tier, `${v.id}:${i}`)) if (out.length < n && !out.includes(x.ru)) out.push(x.ru);
  });
  return out;
}

/** Шаг карточки огорода Wola; `pair` и неизвестное — null (склейка берёт шаг основной игры). */
export function wolaCardStep(card: string, vocab: (id: string) => VocabEntry | undefined, pool: readonly VocabEntry[], known: (id: string) => boolean): Step | null {
  const p = parseCardId(card);
  if (!p || p.type === 'pair') return null;
  const v = vocab(p.item);
  if (!v) return null;
  if (p.type === 'lis') return { t: 'listen', say: v.pl, options: `auto:${v.tags?.[0] ?? v.pos}`, answer: 0, item: v.id };
  if (p.type === 'pro') return { t: 'type', prompt: v.ru, accept: [v.pl], item: v.id };
  const wrong = sameThemeWrong(v, pool, known);
  return { t: 'choice', q: `${v.pl} — это…`, options: [v.ru, ...wrong] as [string, string], answer: 0, item: v.id };
}
