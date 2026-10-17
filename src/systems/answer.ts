// Проверка ответов: порт norm/stripDia/matches тренажёра (index.html:874–878, practice.js:35)
// плюс частичный зачёт: мягкая диакритика, орфография R10 (rz/ż, ó/u, ch/h), опечатка в длинной фразе.
// Чистые функции без DOM.

export type Verdict = 'exact' | 'diacritics' | 'ortho' | 'typo' | 'wrong';
export type DiacriticsMode = 'ok' | 'warn' | 'fail';

export interface Lenient {
  /** Режим диакритики: ok → 1, warn → 0.75, fail → 0. По умолчанию настройка игрока `diacritics` ('warn'). */
  diacritics?: DiacriticsMode;
  /** Зачёт 0.5 за rz/ż, ó/u, ch/h. По умолчанию true. */
  ortho?: boolean;
  /** Зачёт 0.5 за одну опечатку при длине ответа ≥ 8. По умолчанию false (глава 1). */
  typo?: boolean;
}

export interface Check {
  verdict: Verdict;
  score: 1 | 0.75 | 0.5 | 0;
  tags: string[];
  /** Вариант из accept, с которым сравнение дало лучший результат (его и показываем как правильный). */
  best: string;
}

export const TYPO_MIN_LEN = 8;
export const DIA_SCORE: Record<DiacriticsMode, 1 | 0.75 | 0> = { ok: 1, warn: 0.75, fail: 0 };

// ── Нормализация.

const QUOTES = /[„”“‟«»‹›"'‘’‚‛`´]/g;
const TRAIL_PUNCT = /[\s.,!?;:…]+$/;
const LEAD_PUNCT = /^[\s¡¿…]+/;
// Отклонение от буквы §4.6 (там только концевая): запятая, точка с запятой и двоеточие внутри фразы
// тоже не считаются ошибкой — «tak, proszę» = «tak proszę». Дефис и тире не трогаем.
const INNER_PUNCT = /\s*[,;:]\s*/g;

/** NFC → lower → без кавычек и апострофов → без пунктуации на концах и запятых внутри → пробелы схлопнуты. */
export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(QUOTES, '')
    .replace(INNER_PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAIL_PUNCT, '')
    .replace(LEAD_PUNCT, '');
}

const DIA: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** ą→a ć→c ę→e ł→l ń→n ó→o ś→s ź→z ż→z (вход уже в нижнем регистре). */
export function stripDia(s: string): string {
  return s.replace(/[ąćęłńóśźż]/g, (c) => DIA[c]!);
}

export type OrthoKind = 'rz_z' | 'o_u' | 'ch_h';
const ORTHO_KINDS: readonly OrthoKind[] = ['rz_z', 'o_u', 'ch_h'];

/** rz→ż, ó→u, ch→h: пары R10, которые звучат одинаково. `skip` — пара, которую не сводим. */
export function ortho(s: string, skip?: OrthoKind): string {
  let out = s;
  if (skip !== 'rz_z') out = out.replace(/rz/g, 'ż');
  if (skip !== 'o_u') out = out.replace(/ó/g, 'u');
  if (skip !== 'ch_h') out = out.replace(/ch/g, 'h');
  return out;
}

/** Расстояние Левенштейна (вставка, удаление, замена по 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

// ── Сравнение.

const RANK: Record<Verdict, number> = { exact: 4, diacritics: 3, ortho: 2, typo: 1, wrong: 0 };

function better(a: Check, b: Check | null): boolean {
  if (!b) return true;
  if (a.score !== b.score) return a.score > b.score;
  return RANK[a.verdict] > RANK[b.verdict];
}

/** Сравнить уже нормализованные ответ и эталон. */
function compare(na: string, nb: string, len: Required<Lenient>, wrongTags: readonly string[], best: string): Check {
  if (na === nb) return { verdict: 'exact', score: 1, tags: [], best };
  const dia = DIA_SCORE[len.diacritics];
  if (na.length > 0 && len.ortho) {
    const oa = ortho(na);
    const ob = ortho(nb);
    const pure = oa === ob;
    if (pure || stripDia(oa) === stripDia(ob)) {
      const same = (x: string, y: string) => (pure ? x === y : stripDia(x) === stripDia(y));
      const kinds = ORTHO_KINDS.filter((k) => !same(ortho(na, k), ortho(nb, k)));
      const tags = ['R10', ...kinds.map((k) => `orth.${k}`)];
      if (pure) return { verdict: 'ortho', score: 0.5, tags, best };
      // Орфография и диакритика сразу (zeka → rzeka): 0.5, но в режиме fail — незачёт.
      // Если пары R10 не понадобились (kinds пуст), это чистая диакритика: её ловит ветка ниже.
      if (kinds.length > 0) {
        tags.push('orth.diacritics');
        return dia === 0 ? { verdict: 'diacritics', score: 0, tags, best } : { verdict: 'ortho', score: 0.5, tags, best };
      }
    }
  }
  const sa = stripDia(na);
  const sb = stripDia(nb);
  if (na.length > 0 && sa === sb) return { verdict: 'diacritics', score: dia, tags: ['orth.diacritics'], best };
  if (len.typo && na.length >= TYPO_MIN_LEN && levenshtein(sa, sb) === 1) return { verdict: 'typo', score: 0.5, tags: ['orth.typo'], best };
  return { verdict: 'wrong', score: 0, tags: [...wrongTags], best };
}

/**
 * Проверить ответ против всех вариантов `accept`, взять лучший (§4.6).
 * `stepTags` — теги шага (`step.tags`), уходят в результат при `wrong`.
 */
export function checkAnswer(input: string, accept: readonly string[], lenient: Lenient = {}, stepTags: readonly string[] = []): Check {
  const len: Required<Lenient> = { diacritics: lenient.diacritics ?? 'warn', ortho: lenient.ortho ?? true, typo: lenient.typo ?? false };
  const na = norm(input);
  let res: Check | null = null;
  for (const a of accept) {
    const c = compare(na, norm(a), len, stepTags, a);
    if (better(c, res)) res = c;
    if (c.verdict === 'exact') break;
  }
  return res ?? { verdict: 'wrong', score: 0, tags: [...stepTags], best: '' };
}

/** Совместимость с тренажёром: `matches` = точное совпадение или совпадение без диакритики. */
export function matches(input: string, target: string): boolean {
  const a = norm(input);
  const b = norm(target);
  return a === b || stripDia(a) === stripDia(b);
}
