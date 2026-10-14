// Экспорт и импорт файла сохранения (ТЗ §5.12). Чистая логика: собрать файл, распознать и проверить.
// Отдача файла (navigator.share / загрузка) и чтение <input type=file> — в UI (I-12).
import { migrate, type MigrationRegistry } from './migrations';
import type { Progress } from './progress';
import { dayOf, type TimeOpts, type Ts } from './time';

export const SAVE_FORMAT = 'pq-save';

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  v: number;
  exportedAt: Ts;
  progress: Progress;
}

export function toFile(p: Progress, now: Ts): SaveFile {
  return { format: SAVE_FORMAT, v: p.v, exportedAt: now, progress: p };
}

/** Текст файла: компактный JSON без отступов (журнал ~5 КБ в день). */
export function serializeFile(file: SaveFile): string {
  return JSON.stringify(file);
}

/** `polski-quest-YYYY-MM-DD.json` по календарной дате устройства. */
export function fileName(now: Ts, opts: Pick<TimeOpts, 'tz'> = {}): string {
  return `polski-quest-${dayOf(now, { dayStartHour: 0, tz: opts.tz })}.json`;
}

export type ParsedFile =
  /** Свой формат, доведён до текущей версии. `migratedFrom` — исходная версия, если была старее. */
  | { kind: 'pq-save'; status: 'ok'; progress: Progress; exportedAt: Ts | null; migratedFrom?: number }
  /** Файл от более новой версии игры: «Обнови игру». */
  | { kind: 'pq-save'; status: 'newer'; v: number }
  /** Свой формат, но битый. */
  | { kind: 'pq-save'; status: 'invalid'; errors: string[] }
  /** Экспорт старого тренажёра (`v: 3`, `trainer.cards`) → мастер импорта §9 (I-36). */
  | { kind: 'trainer'; data: unknown }
  | { kind: 'unknown'; reason: string };

/**
 * Распознать текст файла. Принимает обёртку `pq-save`, а также голый объект прогресса
 * (на случай ручного копирования из dev-инструментов).
 */
export function parseFile(text: string, registry?: MigrationRegistry): ParsedFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'unknown', reason: 'не JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'unknown', reason: 'не объект' };
  const o = raw as Record<string, unknown>;

  let progressRaw: unknown;
  let exportedAt: Ts | null = null;
  if (o.format === SAVE_FORMAT) {
    progressRaw = o.progress;
    exportedAt = typeof o.exportedAt === 'number' ? o.exportedAt : null;
  } else if (typeof o.worldId === 'string' && o.log && typeof o.log === 'object') {
    progressRaw = o;
  } else if (isTrainer(o)) {
    return { kind: 'trainer', data: raw };
  } else {
    return { kind: 'unknown', reason: 'формат не распознан' };
  }

  const r = migrate(progressRaw, registry);
  if (r.ok) {
    return r.migrated
      ? { kind: 'pq-save', status: 'ok', progress: r.progress, exportedAt, migratedFrom: r.from }
      : { kind: 'pq-save', status: 'ok', progress: r.progress, exportedAt };
  }
  if (r.reason === 'newer') return { kind: 'pq-save', status: 'newer', v: r.from };
  if (r.reason === 'gap') return { kind: 'pq-save', status: 'invalid', errors: [`нет миграции ${r.missing}→${r.missing + 1}`] };
  return { kind: 'pq-save', status: 'invalid', errors: r.errors };
}

function isTrainer(o: Record<string, unknown>): boolean {
  const t = o.trainer;
  if (t && typeof t === 'object' && 'cards' in t) return true;
  return Array.isArray(o.cards) && 'stats' in o; // совсем старый экспорт: голый объект тренажёра
}

/** Что делать с файлом относительно текущего мира (§5.12): тот же мир — слияние, иначе спросить «Заменить?». */
export function importPlan(current: Progress | null, incoming: Progress): 'merge' | 'other_world' | 'new' {
  if (!current) return 'new';
  return current.worldId === incoming.worldId ? 'merge' : 'other_world';
}
