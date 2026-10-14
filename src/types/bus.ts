// Полный список событий шины (ТЗ §2.2). Новые события добавлять сюда же.
import type { DpadSide, MapControls, RoutedIntent, Source } from './input';

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

/** Чем прозвучала фраза (ТЗ §7.2): файл из манифеста, Web Speech pl-PL или никак (показать текст). */
export type AudioVia = 'file' | 'webspeech' | 'none';
/**
 * Состояние озвучки (I-09): playing — звучит (`via`); idle — очередь пуста; blocked — iOS отклонил play()
 * после фона, ждём тап (`audio:blocked`); none — фразу озвучить нечем, показать значок «звука нет».
 */
export type AudioState = 'idle' | 'playing' | 'blocked' | 'none';

/** Результат урока (I-08). Поля, кроме passed, необязательны: их нет у отменённого до начала урока. */
export interface LessonResult {
  passed: boolean;
  /** Урок прерван (Esc / «B» / ×): позиция лежит в `local.resume`, событие `lesson` не записано. */
  cancelled?: boolean;
  /** Средний score первых попыток по проверяемым шагам, 0..1. */
  score?: number;
  /** Доля проверяемых шагов, верных с первой попытки, 0..1. */
  firstTry?: number;
  ms?: number;
  /** Слова, посаженные в конце сцены (`intro`). */
  planted?: string[];
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

/** Клетка грядки для отрисовки (I-12, ТЗ §5.5): что растёт и нужен ли полив. Считает src/world/dzialka.ts. */
export interface PlotCellView {
  at: [number, number];
  /** lxId слова; нет — пустая грядка. */
  item?: string;
  stage: 'empty' | 'seed' | 'sprout' | 'bush' | 'jar';
  /** Интервал rec в днях: росток 1–2 маленький, 3–6 большой. */
  interval: number;
  /** «!»: есть карточка к поливу. */
  due: boolean;
  /** Просрочено больше 2 дней. */
  wilted: boolean;
}

/** Грядки одного объекта `plot` карты. */
export interface PlotView {
  plot: string;
  cells: PlotCellView[];
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
  /**
   * Пометки мира из прогресса (I-12): грядки `plot` (стадии, «!», подвявшие) и «!» над объектами `word`
   * с due-словами. Шлёт склейка (src/day.ts) на `world:location` и после изменений прогресса.
   */
  'world:marks': { location: string; plots: PlotView[]; dueItems: string[] };
  /** Дима остановился (ТЗ §5.4): склейка пишет позицию в `local.position` (I-12). */
  'world:position': { location: string; x: number; y: number };
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
  /**
   * Озвучить польскую строку (I-09, ТЗ §7). `id` — слово, шаг или реплика из манифеста (`lx.maly`,
   * `ch01.s03#4`, `dlg.ch01.x#n1`), `text` — сам текст (запасной, если id нет в манифесте). `slow` —
   * медленная версия. По умолчанию новая фраза прерывает текущую; `queue: true` — встать в очередь.
   * `done` вызывается, когда фраза доиграла или прервана.
   */
  'audio:play': { id?: string; text?: string; slow?: boolean; voice?: string; queue?: boolean; who?: string; done?: (via: AudioVia) => void };
  /** Остановить речь и очистить очередь. */
  'audio:stop': Record<string, never>;
  /** Повторная разблокировка из жеста (тост «Нажми, чтобы включить звук»). Слать синхронно из обработчика тапа. */
  'audio:unlock': Record<string, never>;
  /** Что сейчас с озвучкой (I-09): для значков «звучит» и «звука нет». */
  'audio:state': { state: AudioState; via?: AudioVia; text?: string; id?: string };
  /** Intent после роутера (ТЗ §2.7): `to` = мир или оверлей по фокусу (I-03). */
  'input:intent': RoutedIntent;
  /** Сменился последний источник ввода (I-03). */
  'input:source': { source: Source };
  /** Показать или спрятать d-pad; решает роутер по источнику, устройству и настройке (I-03). */
  'input:dpad': { visible: boolean; side: DpadSide };
}
