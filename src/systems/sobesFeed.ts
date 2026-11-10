// Лента собеса (10.11, ТЗ-лента-прогресса): строка тоста после применения `slowa/sobes.json`. Применение — `replaceSobes` (v2content)
// и `polska.syncContent()` (отпечатки ответов: изменённый ответ сбрасывает прогресс по вопросу).

const plural = (n: number, one: string, few: string, many: string): string => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

/** «Собес: новых вопросов 2, обновлено 1» — или пусто, если для игрока ничего не изменилось. */
export function sobesFeedLine(r: { added: readonly string[]; reset: readonly string[] }): string {
  const parts: string[] = [];
  if (r.added.length) parts.push(`${r.added.length} ${plural(r.added.length, 'новый вопрос', 'новых вопроса', 'новых вопросов')}`);
  if (r.reset.length) parts.push(`${r.reset.length} ${plural(r.reset.length, 'ответ обновлён', 'ответа обновлены', 'ответов обновлено')} — учим заново`);
  return parts.length ? `Собес: ${parts.join(', ')}` : '';
}
