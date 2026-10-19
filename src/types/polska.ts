// v2 «Игры о Польше» (ФЕРМА_v2.md): единицы контента, состояние единиц и КОНТРАКТ ИГРЫ для папок `src/games/<id>/`.
// Игровые агенты реализуют `PolskaGame` в своей папке; движок раунда, огород, сохранение, мир и доска общие (src/ui/polskaGame.ts,
// src/systems/polska.ts). Подробно — AGENTS.md, раздел «v2: как добавить игру».
import type { Stage } from './farm';

/** Виды единиц v2 (поле `kind` в данных и у растения). */
export type PolskaKind = 'geo' | 'hymn' | 'symbol' | 'date' | 'holiday';
/** Игры v2: папка `src/games/<id>/`. */
export type PolskaGameId = 'geo' | 'hymn' | 'daty' | 'swieta';
/** Точки входа в мире (`use` объекта на карте). */
export type PolskaEntry = 'map' | 'mast' | 'calendar' | 'seasonBoard';
/** Участки в Zagroda, где растут единицы. */
export type ZPlot = 'sad' | 'pasieka' | 'miesiace' | 'klumba';

/** Единица контента v2 (город, строка гимна, факт-символ, дата, праздник) после загрузки `content/v2/*.json`. */
export interface PolskaUnit {
  /** `geo.city.wroclaw`, `hymn.s1.1`, `symbol.godlo`, `date.konstytucja`, `hol.wigilia`. Префикс совпадает с `kind`. */
  id: string;
  kind: PolskaKind;
  /** Подвид из данных: city, river, neighbour, voivodeship, line, build, observance… */
  type: string;
  pl: string;
  ru: string;
  tr: string;
  /** 1 — сажается первым. По умолчанию 1. */
  band: number;
  facts: readonly { pl: string; ru: string }[];
  /** Вся исходная запись из JSON: свои поля игра читает отсюда (forms, region, pos, tiles, day/month, when, stanza…). */
  raw: Readonly<Record<string, unknown>>;
}

/** Состояние единицы для игры и экранов. Сторона A = «узнать», B = «вспомнить»; `self` — «сказать/собрать самому». */
export interface UnitInfo {
  id: string;
  kind: PolskaKind;
  /** null — не посажено или в коллекции (и не перезрело). */
  stage: Stage | null;
  planted: boolean;
  drops: number;
  sides: { A: boolean; B: boolean };
  /** Был верный ответ «сам» за цикл (без него урожая нет). */
  selfOk: boolean;
  days: number;
  harvests: number;
  /** Сколько ответов (верных и нет) уже дано по единице: 0 — игрок её ещё не встречал. Необязательно, чтобы чужие фейки не ломались. */
  answers?: number;
  /** «ещё 1 полив до ростка», «нужно сказать самому»… */
  next: string;
}

/** Что движок просит у игры: единица, сторона и нужен ли режим «сам» (кустик без него не созреет). */
export interface Want {
  id: string;
  side: 'A' | 'B';
  self: boolean;
  stage: Stage;
}

/** Задание игры. Игра расширяет его своими полями (варианты, плитки, точка на карте). `side`/`self` — что реально спрошено. */
export interface GameTask {
  id: string;
  side: 'A' | 'B';
  self?: boolean;
}

/** Результат проверки ответа игрой. */
export interface GameCheck {
  ok: boolean;
  /** Правильный ответ, как показать («Kraków», «trzeciego maja»). */
  correct: string;
  /** Пометка мягкого зачёта. */
  note?: string;
  /** Что озвучить после ответа (польский текст); по умолчанию `unit.pl`. Звук только под выключателем, на проверках `?mute=1`. */
  say?: string;
}

/** Что движок даёт игре на время задания. Игра рисует DOM в `body`, свои кнопки — в `foot`, ответ отдаёт через `submit`. */
export interface GamePanel {
  readonly body: HTMLElement;
  readonly foot: HTMLElement;
  readonly layout: 'panel' | 'full';
  submit(answer: unknown): void;
  say(text: string, slow?: boolean): void;
  rand(): number;
  /** Задержать автопереход после верного ответа хотя бы на `ms` (в игре ещё идёт анимация: флажок, обводка). Звать после `submit`. */
  hold?(ms: number): void;
  /**
   * Только `layout: 'full'`. Подогнать высоту листа под содержимое, чтобы под ним не оставалось пустого места: движок временно даёт листу всю
   * высоту, зовёт `measure` с размером его содержимого (`w`, `h`, css px; `h` — вместе с местом, которое после ответа займёт строка результата)
   * и ставит высоту по возвращённой высоте содержимого (с запасом под строку результата); не меньше нуля — не сжимать. Звать на каждый
   * рисунок задания и при смене размера окна (`panel.root`).
   */
  fit?(measure: (room: { w: number; h: number }) => number): void;
  /** Весь экран игры (`full`): за ним следят на смену размера окна. */
  readonly root?: HTMLElement;
}

/** Контекст игры: её единицы, состояние, часы (реальная дата для «сегодня» и сезона). */
export interface GameCtx {
  /** Единицы игры (по её `kinds`), в порядке данных. */
  readonly units: readonly PolskaUnit[];
  unit(id: string): PolskaUnit | undefined;
  info(id: string): UnitInfo;
  /** Знакомство с единицей принято («Понятно») — флаг в сохранении, не зависит от числа ответов. Нет флага → покажи карточку первым делом. */
  seen(id: string): boolean;
  /** Отметить знакомство принятым: звать только по кнопке «Понятно», не при открытии карточки. */
  markSeen(id: string): void;
  /** Исходный документ игры целиком (`content/v2/<файл>.json`): справочники (months, ordinals, rivers, melody…). */
  readonly doc: Readonly<Record<string, unknown>>;
  now(): number;
  /** Локальная дата (часы игры с `?now=`): для календаря и сезона. */
  date(): { y: number; m: number; d: number; weekday: number };
  rand(): number;
}

/**
 * КОНТРАКТ ИГРЫ v2. Папка `src/games/<id>/index.ts` экспортирует `game: PolskaGame`.
 * Движок: сажает из `pool`, выбирает единицу и сторону (`Want`), просит `nextTask`, вызывает `render`, по `panel.submit` — `check`,
 * пишет ответ в огород, считает раунд (10), показывает итог, ведёт героя к участку в Zagroda.
 */
export interface PolskaGame<T extends GameTask = GameTask> {
  id: PolskaGameId;
  title: { pl: string; ru: string };
  /** Одна строка «как играть» для доски. */
  desc: string;
  entry: PolskaEntry;
  plot: ZPlot;
  kinds: readonly PolskaKind[];
  /** `panel` — нижняя панель (мир сверху, автобег); `full` — весь экран (карта, календарь), рост виден отложенно. */
  layout: 'panel' | 'full';
  /** id единиц, которые можно сажать сейчас, в порядке посадки (полосы, куплеты). Движок сажает из начала, держа ≤ 8 растущих. */
  pool(ctx: GameCtx): readonly string[];
  /** Задание по просьбе движка. Нужен `self` — дай задание «сам» (без него кустик не созреет). null — пропустить единицу. */
  nextTask(ctx: GameCtx, want: Want): T | null;
  render(task: T, panel: GamePanel, ctx: GameCtx): void;
  check(task: T, answer: unknown, ctx: GameCtx): GameCheck;
  /** Строка в итоге раунда («Najbliższe święto: Wigilia za 3 dni»); null — без строки. */
  summaryLine?(ctx: GameCtx): string | null;
  /**
   * Экран выбора до раунда (колесо праздников, `layout: 'full'`). Игра рисует его в `panel.body`/`panel.foot` и зовёт `begin(id, size)`:
   * движок досаживает единицу и ведёт раунд из `size` заданий про неё одну (`nextTask` получает `want.id` = `id`). После итога раунда
   * «К колесу» возвращает на этот экран. Без `hub` раунд начинается сразу и идёт по 10 заданий из разных единиц.
   */
  hub?(panel: GamePanel, ctx: GameCtx, begin: (id: string, size: number) => void): void;
}

/** Вид объекта на участке Zagroda по прогрессу (для сцены). */
export interface PlotView {
  /** id объекта на карте `zagroda` (`sad_mazowieckie`, `hive_s1`, `bed_5`, `klumba_3`). */
  obj: string;
  plot: ZPlot;
  /** Единиц, приписанных к объекту. */
  units: number;
  planted: number;
  grown: number;
  /** grown / units, 0…1. */
  pct: number;
  /** Самая продвинутая стадия среди растущих (null — ничего не растёт). */
  best: Stage | null;
  /** Группа объекта (`voi:mazowieckie`, `stanza:s1`, `month:5`, `season:zima`): по ней сцена выбирает вид (цвет цветка по сезону). */
  group: string;
}
