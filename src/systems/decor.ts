// Украшения мира к реальным датам (ФЕРМА_v2 §5, «как фестивали Stardew без сюжета»): `swieta.json:decor` → какие украшения сегодня.
// Чистая логика: дата приходит параметром (часы игры с `?now=`). Объекты карт с полем `decor` сцена ставит, только если украшение активно.

export interface DecorDef {
  id: string;
  /** Праздник или дата, к которой украшение (для подписи и тестов). */
  for: string;
  /** Окно дат из поля `window` данных: фиксированное «MM-DD → MM-DD» или дни от Пасхи. */
  span: { rule: 'fixed'; from: string; to: string } | { rule: 'easter'; from: number; to: number };
  where: string;
  sprite: string;
}

/** Номер дня от 1970-01-01 (UTC, без часовых поясов): сравнение и разница дат. */
export const dayNum = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);

/** День Пасхи (григорианский календарь, алгоритм Мееуса) как `dayNum`. */
export function easterNum(y: number): number {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNum(y, month, day);
}

const mmdd = (s: string): [number, number] => {
  const [m, d] = s.split('-').map(Number);
  return [m ?? 1, d ?? 1];
};

/** Активно ли украшение в этот день. Окно «12-24 → 01-06» переходит через Новый год. */
export function decorActive(def: DecorDef, y: number, m: number, d: number): boolean {
  const today = dayNum(y, m, d);
  const w = def.span;
  if (w.rule === 'easter') {
    const e = easterNum(y);
    return today >= e + w.from && today <= e + w.to;
  }
  const [fm, fd] = mmdd(w.from);
  const [tm, td] = mmdd(w.to);
  const from = fm * 100 + fd;
  const to = tm * 100 + td;
  const now = m * 100 + d;
  return from <= to ? now >= from && now <= to : now >= from || now <= to;
}

/** Разбор `decor` из swieta.json (лишнее и битое пропускается). */
export function parseDecor(raw: unknown): DecorDef[] {
  if (!Array.isArray(raw)) return [];
  const out: DecorDef[] = [];
  for (const x of raw) {
    const o = x as Record<string, unknown>;
    const w = (o['window'] ?? {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.sprite !== 'string') continue;
    if (w.rule === 'easter' && typeof w.from === 'number' && typeof w.to === 'number') out.push({ id: o.id, for: String(o.for ?? ''), where: String(o.where ?? ''), sprite: o.sprite, span: { rule: 'easter', from: w.from, to: w.to } });
    else if (w.rule === 'fixed' && typeof w.from === 'string' && typeof w.to === 'string') out.push({ id: o.id, for: String(o.for ?? ''), where: String(o.where ?? ''), sprite: o.sprite, span: { rule: 'fixed', from: w.from, to: w.to } });
  }
  return out;
}

/** id украшений, активных в этот день. */
export function activeDecor(defs: readonly DecorDef[], date: { y: number; m: number; d: number }): string[] {
  return defs.filter((x) => decorActive(x, date.y, date.m, date.d)).map((x) => x.id);
}
