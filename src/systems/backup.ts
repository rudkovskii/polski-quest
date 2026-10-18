// Напоминание скачать копию сохранения раз в 7 дней (V11a). Чистая логика: время приходит параметром, метки лежат в `Save.hints`
// одним флагом на вид (`backup:<мс>` — когда скачали, `backup-remind:<мс>` — когда напомнили), без новых полей сохранения.
export const BACKUP_EVERY_MS = 7 * 24 * 3600_000;
const SAVED = 'backup:';
const REMIND = 'backup-remind:';

export type BackupMark = 'saved' | 'remind';
const PREFIX: Record<BackupMark, string> = { saved: SAVED, remind: REMIND };

/** Время метки в `hints` (null — метки нет). */
export function markOf(hints: readonly string[], kind: BackupMark): number | null {
  const p = PREFIX[kind];
  const h = hints.find((x) => x.startsWith(p));
  if (!h) return null;
  const n = Number(h.slice(p.length));
  return Number.isFinite(n) ? n : null;
}

/** `hints` с новой меткой вместо старой. */
export function withMark(hints: readonly string[], kind: BackupMark, at: number): string[] {
  const p = PREFIX[kind];
  return [...hints.filter((x) => !x.startsWith(p)), `${p}${Math.round(at)}`];
}

/** Копию давно не скачивали: с последней копии (а если не было — с первого запуска) прошло 7 дней и больше. */
export function backupDue(now: number, created: number, hints: readonly string[]): boolean {
  const base = markOf(hints, 'saved') ?? created;
  return now - base >= BACKUP_EVERY_MS;
}

/** Показывать напоминание сейчас: копия просрочена и последнее напоминание было не раньше 7 дней назад. */
export function shouldRemind(now: number, created: number, hints: readonly string[]): boolean {
  if (!backupDue(now, created, hints)) return false;
  const r = markOf(hints, 'remind');
  return r === null || now - r >= BACKUP_EVERY_MS;
}
