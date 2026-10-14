// Миграции схемы прогресса (ТЗ §3.12). migrations[n] переводит n → n+1; чистые функции без контента.
// Снапшот перед миграцией пишет platform/storage.ts (ключ — `backupKey`), здесь только логика.
import { PROGRESS_V, validateProgress, type Progress } from './progress';
import type { Day } from './time';

// Старые версии по определению без типа.
export type Migration = (p: any) => any;
export type MigrationRegistry = Readonly<Record<number, Migration>>;

/**
 * Реестр. Пример будущего шага:
 *   1: (p) => ({ ...p, v: 2, world: { ...p.world, pets: {} } }),
 * На каждую версию — фикстура `tests/fixtures/progress_v<n>.json`.
 */
export const MIGRATIONS: MigrationRegistry = {};

export type MigrateResult =
  | { ok: true; progress: Progress; from: number; migrated: boolean }
  /** Прогресс новее клиента: только чтение, синк выключен, баннер «Обнови игру». */
  | { ok: false; reason: 'newer'; from: number }
  | { ok: false; reason: 'invalid'; errors: string[]; from?: number }
  | { ok: false; reason: 'gap'; from: number; missing: number };

export function versionOf(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as { v?: unknown }).v;
  return Number.isInteger(v) && (v as number) >= 1 ? (v as number) : null;
}

/** Довести сырой прогресс до `target`. Вход не мутируется (каждый шаг получает глубокую копию). */
export function migrate(raw: unknown, registry: MigrationRegistry = MIGRATIONS, target: number = PROGRESS_V): MigrateResult {
  const from = versionOf(raw);
  if (from === null) return { ok: false, reason: 'invalid', errors: ['v: нет версии'] };
  if (from > target) return { ok: false, reason: 'newer', from };
  let cur: unknown = raw;
  for (let n = from; n < target; n++) {
    const step = registry[n];
    if (!step) return { ok: false, reason: 'gap', from, missing: n };
    cur = step(structuredClone(cur));
    if (versionOf(cur) !== n + 1) return { ok: false, reason: 'invalid', from, errors: [`миграция ${n}→${n + 1} не поставила v`] };
  }
  const errors = target === PROGRESS_V ? validateProgress(cur) : [];
  if (errors.length) return { ok: false, reason: 'invalid', errors, from };
  return { ok: true, progress: cur as Progress, from, migrated: from < target };
}

/** Старый клиент никогда не пишет данные новой версии (дублирует проверку сервера, §6.2). */
export function canWrite(p: { v: number }, clientV: number = PROGRESS_V): boolean {
  return p.v <= clientV;
}

// ── Снапшоты перед миграцией: `pq_backup_v<n>_<YYYY-MM-DD>`, хранить 3 последних.

export const BACKUP_PREFIX = 'pq_backup_';
const BACKUP_RE = /^pq_backup_v(\d+)_(\d{4}-\d{2}-\d{2})$/;

export function backupKey(fromV: number, day: Day): string {
  return `${BACKUP_PREFIX}v${fromV}_${day}`;
}

/** Ключи снапшотов по возрастанию (дата, версия). Чужие ключи отбрасываются. */
export function sortBackups(keys: readonly string[]): string[] {
  return keys
    .map((k) => ({ k, m: BACKUP_RE.exec(k) }))
    .filter((x): x is { k: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => (a.m[2]! < b.m[2]! ? -1 : a.m[2]! > b.m[2]! ? 1 : Number(a.m[1]) - Number(b.m[1])))
    .map((x) => x.k);
}

/** Какие снапшоты удалить, чтобы осталось `keep` последних. */
export function backupsToPrune(keys: readonly string[], keep = 3): string[] {
  const sorted = sortBackups(keys);
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}
