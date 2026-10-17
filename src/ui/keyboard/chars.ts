// Польские буквы для экранной клавиатуры.

/** Полоска над полем, порядок как в алфавите. */
export const STRIP_CHARS = ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ź', 'ż'] as const;

/** «ąę» на QWERTY и раскладка «польская программистская»: x → ź, z → ż. */
export const POLISH_OF: Readonly<Record<string, string>> = {
  a: 'ą',
  c: 'ć',
  e: 'ę',
  l: 'ł',
  n: 'ń',
  o: 'ó',
  s: 'ś',
  z: 'ż',
  x: 'ź',
};

/** Alt/Option + клавиша (по `e.code`) → польская буква. */
export const ALT_CODES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(POLISH_OF).map(([base, pl]) => [`Key${base.toUpperCase()}`, pl]),
);

export function upper(ch: string): string {
  return ch.toLocaleUpperCase('pl');
}
