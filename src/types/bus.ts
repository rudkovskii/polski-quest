// Полный список событий шины (ТЗ §2.2). Новые события добавлять сюда же.
import type { DpadSide, MapControls, RoutedIntent, Source } from './input';

export type LessonSrc = 'npc' | 'trigger' | 'remedy' | 'map';
export type ScreenId = 'passport' | 'settings' | 'summary' | 'export' | 'diary';
export type ProgressKind = 'cards' | 'world' | 'settings' | 'economy';
export type SyncState = 'ok' | 'pending' | 'offline' | 'error' | 'old_client' | 'no_secret';

/** Результат урока. Уточняется в I-07. */
export interface LessonResult {
  passed: boolean;
}

/** Действие с объектом локации: кнопка «A»/пробел, тап или вход в триггер (I-07, ТЗ §5.4). */
export interface WorldInteract {
  location: string;
  kind: 'npc' | 'word' | 'sign' | 'board' | 'trigger' | 'plot' | 'secret';
  /** id объекта карты (для sign — "x,y", для board — тип доски). */
  id: string;
  /** Ключ объекта в локации: `npc:bobr`, `word:tablica_wyjscie`, `plot:grzadki`… */
  key: string;
  /** Клетка объекта (для грядки — та, по которой тапнули). */
  tile: [number, number];
  via: 'action' | 'tap' | 'enter';
  /** lxId слова (`word`, `sign`). */
  item?: string;
  /** Тип упражнения объекта `word`. */
  ex?: string;
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
  /** Игрок взаимодействует с объектом локации (I-07). Слушают ui (диалог, упражнение) и systems. */
  'world:interact': WorldInteract;
  /** Игрок ушёл в выход локации (I-07); `to: "worldmap"` — на глобальную карту (I-11). */
  'world:exit': { from: string; to: string; spawn?: string };
  /** Локация загружена: склейка переключает режим ввода `walk | tap` (I-07). */
  'world:location': { id: string; controls: MapControls };
  'world:teleport': { location: string; spawn: string };
  'progress:changed': { kinds: ProgressKind[] };
  'progress:merged': { remoteEvents: number };
  'sync:status': { state: SyncState; at?: number; detail?: string };
  'audio:blocked': Record<string, never>;
  /** Intent после роутера (ТЗ §2.7): `to` = мир или оверлей по фокусу (I-03). */
  'input:intent': RoutedIntent;
  /** Сменился последний источник ввода (I-03). */
  'input:source': { source: Source };
  /** Показать или спрятать d-pad; решает роутер по источнику, устройству и настройке (I-03). */
  'input:dpad': { visible: boolean; side: DpadSide };
}
