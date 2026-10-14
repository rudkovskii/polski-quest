// Полный список событий шины (ТЗ §2.2). Новые события добавлять сюда же.
import type { DpadSide, RoutedIntent, Source } from './input';

export type LessonSrc = 'npc' | 'trigger' | 'remedy' | 'map';
export type ScreenId = 'passport' | 'settings' | 'summary' | 'export' | 'diary' | 'link';
export type ProgressKind = 'cards' | 'world' | 'settings' | 'economy';
/**
 * Состояние синка (I-06, точка синка в HUD): idle — ещё не запускался; no_secret — нет ссылки;
 * pending — есть изменения, отправка через 3 с; syncing — запрос в полёте; ok — сошлось;
 * offline — сеть или Supabase недоступны, повтор сам; conflict — нужен выбор игрока
 * (detail `different_worlds`) или 3 конфликта подряд (detail `retry`, повтор сам);
 * old_client — облако новее клиента, синк стоп; error — detail `apply_sql` (SQL не применён),
 * `not_found` (по ссылке нет мира), `remote_invalid`, `http_<код>`.
 */
export type SyncState =
  | 'idle'
  | 'no_secret'
  | 'pending'
  | 'syncing'
  | 'ok'
  | 'offline'
  | 'conflict'
  | 'old_client'
  | 'error';

/** Итог «Подключить» на LinkSetup: ok — мир найден; offline — сохранили секрет, сольём при сети. */
export type ConnectResult = 'ok' | 'offline' | 'not_found' | 'invalid';
export type LinkMode = 'stored' | 'url' | 'new' | 'joined';

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
  /**
   * Экран LinkSetup (§5.2, I-06): «Начать» / «У меня есть ссылка». Действия делает склейка
   * (src/cloud.ts), экран только вызывает их и показывает результат.
   */
  'ui:start:show': { create: () => void; connect: (input: string) => Promise<ConnectResult> };
  /** Компонент «Сохрани свою ссылку» (§5.2): F6 и Settings. `onSaved` = чекбокс «Я сохранил». */
  'ui:link:show': { link: string; saved: boolean; onSaved: () => void };
  /** Секрет есть, мир выбран: дальше шаг режиссёра (I-13). `mode` — откуда взялся мир. */
  'link:ready': { mode: LinkMode };
  'audio:blocked': Record<string, never>;
  /** Intent после роутера (ТЗ §2.7): `to` = мир или оверлей по фокусу (I-03). */
  'input:intent': RoutedIntent;
  /** Сменился последний источник ввода (I-03). */
  'input:source': { source: Source };
  /** Показать или спрятать d-pad; решает роутер по источнику, устройству и настройке (I-03). */
  'input:dpad': { visible: boolean; side: DpadSide };
}
