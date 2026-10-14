// Полный список событий шины (ТЗ §2.2). Новые события добавлять сюда же.

export type LessonSrc = 'npc' | 'trigger' | 'remedy' | 'map';
export type ScreenId = 'passport' | 'settings' | 'summary' | 'export' | 'diary';
export type ProgressKind = 'cards' | 'world' | 'settings' | 'economy';
export type SyncState = 'ok' | 'pending' | 'offline' | 'error' | 'old_client' | 'no_secret';

/** Результат урока. Уточняется в I-07. */
export interface LessonResult {
  passed: boolean;
}

export interface BusEvents {
  'ui:dialog:open': { dialogueId: string; npcId: string };
  'ui:lesson:start': { lessonId: string; src: LessonSrc };
  'ui:lesson:end': { lessonId: string; result: LessonResult };
  'ui:obchod:start': { mode: 'day' | 'express'; fromItem?: string };
  'ui:screen:open': { screen: ScreenId };
  /** Title-сцена готова: показать DOM-кнопку «Нажми, чтобы начать» (I-01). */
  'ui:title:show': { build: string };
  /** Игрок тапнул по Title, аудио разблокировано: сцена идёт дальше (I-01). */
  'title:start': { audioUnlocked: boolean };
  'world:input': { enabled: boolean };
  'world:teleport': { location: string; spawn: string };
  'progress:changed': { kinds: ProgressKind[] };
  'progress:merged': { remoteEvents: number };
  'sync:status': { state: SyncState; at?: number; detail?: string };
  'audio:blocked': Record<string, never>;
}
