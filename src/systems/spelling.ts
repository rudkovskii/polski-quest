// Правдоподобные неверные написания польского слова для вариантов ответа:
// то же слово с типичной ошибкой русскоязычного: rz/ż, ó/u, ch/h, ę/e, ą/om, sz/ś, cz/ć, ł/l, i/y, оглушение в конце.
// Транскрипция их не различает: ответ — знание написания. Чисто, детерминированно (порядок по сиду).
import { fnv1a } from './hash';

/** Пара «как пишется» → «как могли бы написать». `end` — только в конце слова. */
interface Swap {
  from: string;
  to: string;
  end?: boolean;
}

// Порядок = приоритет. Сначала омофоны — пары, которые звучат одинаково и в транскрипции не различаются (rz/ż, ó/u,
// ch/h, носовые на конце, мягкие ś/si, оглушение в конце): их транскрипция не выдаёт. Потом — пары, которые
// транскрипция различает (sz/ś, cz/ć, ł/l, i/y): это запас для слов без омофонных ловушек.
const SWAPS: readonly Swap[] = [
  { from: 'rz', to: 'ż' },
  { from: 'ż', to: 'rz' },
  { from: 'ó', to: 'u' },
  { from: 'u', to: 'ó' },
  { from: 'ch', to: 'h' },
  { from: 'h', to: 'ch' },
  { from: 'ę', to: 'e', end: true },
  { from: 'ę', to: 'en' },
  { from: 'ą', to: 'om', end: true },
  { from: 'ą', to: 'on' },
  { from: 'em', to: 'ę', end: true },
  { from: 'e', to: 'ę', end: true },
  { from: 'ci', to: 'ć' },
  { from: 'si', to: 'ś' },
  { from: 'ś', to: 'si' },
  { from: 'ź', to: 'zi' },
  { from: 'zi', to: 'ź' },
  { from: 'ni', to: 'ń' },
  { from: 'ń', to: 'ni' },
  { from: 'w', to: 'f', end: true },
  { from: 'd', to: 't', end: true },
  { from: 'g', to: 'k', end: true },
  { from: 'b', to: 'p', end: true },
  { from: 'z', to: 's', end: true },
  { from: 'ż', to: 'sz', end: true },
  { from: 'sz', to: 'ś' },
  { from: 'ś', to: 'sz' },
  { from: 'cz', to: 'ć' },
  { from: 'ć', to: 'cz' },
  { from: 'ź', to: 'ż' },
  { from: 'ł', to: 'l' },
  { from: 'l', to: 'ł' },
  { from: 'y', to: 'i' },
  { from: 'i', to: 'y' },
  { from: 'k', to: 'g', end: true },
];

const isUpper = (ch: string): boolean => ch !== ch.toLocaleLowerCase('pl') && ch === ch.toLocaleUpperCase('pl');

/** Все варианты одной заменой (по одному вхождению), в порядке приоритета замен и вхождений. */
export function spellingCandidates(word: string): string[] {
  const lower = word.toLocaleLowerCase('pl');
  const out: string[] = [];
  const seen = new Set<string>([lower]);
  for (const s of SWAPS) {
    let i = lower.indexOf(s.from);
    while (i >= 0) {
      const after = i + s.from.length;
      // «В конце» — в конце слова фразы (перед пробелом, знаком или концом строки).
      const atEnd = after === lower.length || /[\s,.!?…]/u.test(lower[after]!);
      // «ci»/«si»/«zi»/«ni» перед гласной — это мягкость, а не «ć» (ciasto ≠ ćasto): только перед согласной/концом.
      // «i» перед гласной — тоже знак мягкости (dzień, gdzie): «gdzye» никто не напишет.
      const softBeforeVowel = /^(ci|si|zi|ni|i)$/.test(s.from) && after < lower.length && /[aeiouyąęó]/.test(lower[after]!);
      if ((!s.end || atEnd) && !softBeforeVowel) {
        let to = s.to;
        if (isUpper(word[i]!)) to = to[0]!.toLocaleUpperCase('pl') + to.slice(1);
        const v = word.slice(0, i) + to + word.slice(after);
        const key = v.toLocaleLowerCase('pl');
        if (!seen.has(key)) {
          seen.add(key);
          out.push(v);
        }
      }
      i = lower.indexOf(s.from, i + 1);
    }
  }
  return out;
}

/**
 * До `n` неверных написаний слова: разные замены, без совпадений с настоящими словами словаря (`isWord`: «morze» —
 * не опечатка «może», а другое слово). Порядок выбора стабилен по `seed`, но приоритетные ловушки (rz/ż, ó/u…) первыми.
 * Мало замен (короткое «tak») — добираются варианты двумя заменами.
 */
export function spellingTraps(word: string, n: number, seed: string, isWord: (s: string) => boolean = () => false): string[] {
  const ok = (v: string): boolean => !isWord(v) && v.toLocaleLowerCase('pl') !== word.toLocaleLowerCase('pl');
  const one = spellingCandidates(word).filter(ok);
  // Первые кандидаты — омофонные ловушки; среди них порядок по сиду, чтобы не было одной и той же пары каждый раз.
  const head = one.slice(0, Math.max(n + 1, 3));
  const rest = one.slice(head.length);
  let h = fnv1a(`${seed}:${word}`) || 1;
  const order = head.map((v) => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    return { v, k: h };
  });
  order.sort((a, b) => a.k - b.k);
  const out = [...order.map((x) => x.v), ...rest].slice(0, n);
  if (out.length >= n) return out;
  // Две замены: из каждого варианта ещё одна.
  for (const v of one) {
    for (const w of spellingCandidates(v)) {
      if (out.length >= n) return out;
      if (ok(w) && !out.some((x) => x.toLocaleLowerCase('pl') === w.toLocaleLowerCase('pl'))) out.push(w);
    }
  }
  return out;
}
