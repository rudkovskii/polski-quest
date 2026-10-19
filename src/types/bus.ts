// Полный список событий шины. Связь scenes/world ⇄ ui и склейка main.ts идут только через неё.
import type { FarmAct, PlantView } from './farm';
import type { PlotView, PolskaGameId, ZPlot } from './polska';
import type { DpadSide, Dir, MapControls, RoutedIntent, Source } from './input';

/** Чем прозвучала фраза: файл из манифеста, Web Speech pl-PL или никак (показать текст). */
export type AudioVia = 'file' | 'webspeech' | 'none';
/**
 * Состояние озвучки: playing — звучит (`via`); idle — очередь пуста; blocked — iOS отклонил play()
 * после фона, ждём тап (`audio:blocked`); none — фразу озвучить нечем.
 */
export type AudioState = 'idle' | 'playing' | 'blocked' | 'none';

/** Объекты, с которыми можно что-то сделать (`use` в content/maps/*.json). Логику каждого делает F-03. */
export type UseKind = 'desk' | 'board' | 'bin' | 'shelf' | 'bed' | 'plant' | 'radio' | PolskaUse;
/**
 * v2: точки входа в игры о Польше (`map`, `calendar` в доме; `mast`, `seasonBoard` на ферме) и объекты участков Zagroda
 * (`zplot`: яблоня, улей, грядка месяца, место на клумбе; `id` объекта = `sad_<воеводство>`, `hive_<куплет>`, `bed_<месяц>`, `klumba_<n>`).
 */
export type PolskaUse = 'map' | 'calendar' | 'mast' | 'seasonBoard' | 'zplot';

/**
 * КОНТРАКТ ДЛЯ F-03. Игрок нажал A рядом с интерактивным объектом или тапнул по нему (мир сам подошёл).
 * Мир при этом ничего не открывает: слушатель решает, что показать. Событие приходит один раз за действие.
 */
export interface WorldInteract {
  /** id карты: `home` или `farm`. */
  location: string;
  /** Что за объект: desk (Słownik), board (выбор мини-игры), bin (коробка урожая), shelf (банки), bed (кровать), radio (радио с музыкой). */
  use: UseKind | (string & {});
  /** Он же id объекта на карте (у этих пяти совпадает с `use`). */
  id: string;
  /** Ключ объекта в локации: `prop:desk`. */
  key: string;
  /** Подпись для заглушки-пузыря: «Польский · Русский». */
  label: string;
  /** Клетка объекта, с которой взаимодействовали. */
  tile: [number, number];
  via: 'action' | 'tap';
  /** Куда смотрел герой. */
  facing: Dir;
  /** Клетка, на которой стоит герой (откуда игра запущена: сюда он вернётся, `systems/entryPoint.ts`). */
  hero?: [number, number];
}

/** Звуки действий (`systems/platform/sfx.ts`): шаги, полив, урожай, ответ, окна. */
export type SfxName = 'step_grass' | 'step_wood' | 'water' | 'pick' | 'plim' | 'correct' | 'wrong' | 'grow' | 'open' | 'close';

export interface BusEvents {
  /** Мир принимает ввод (оверлей закрыт) или нет (открыт экран F-03: герой встаёт, ввод идёт в оверлей). */
  'world:input': { enabled: boolean };
  /** КОНТРАКТ ДЛЯ F-03: действие с объектом (стол, доска, коробка, полка, кровать). */
  'world:interact': WorldInteract;
  /** Герой шагнул в дверь: карта сменится сама (`to` и имя спавна). */
  'world:exit': { from: string; to: string; spawn: string };
  /** Карта загружена: роутер переключает режим ввода. */
  'world:location': { id: string; controls: MapControls };
  /** Герой остановился: склейка пишет позицию в сохранение. */
  'world:position': { location: string; x: number; y: number; facing: Dir };
  /** Опыт и путь к A1 для HUD (V11c). `level` — название уровня («Уровень 7», «Старт», «A1»); `sub` — номер 0…20 (21 — A1), `of` — уровней всего (20); `ratio` — доля внутри уровня; `pct` — доля пути до A1; `toNext` — очков до следующего уровня (null — A1); `growing` — сколько слов растёт; `xp` — всего очков опыта; `gain` — «+N» за ответ; `up` — новый уровень (вспышка, карточка, звук). */
  'hud:xp': { level: string; ratio: number; sub?: number; of?: number; pct?: number; pos?: number; toNext?: number | null; xp?: number; gain?: number; up?: boolean; growing?: number };
  /** Грядки фермы: растения и вскопанные клетки (шлёт склейка при любом изменении и при входе на ферму). */
  'farm:plants': { plants: PlantView[]; cells: [number, number][] };
  /** Мини-игра открыта (герой бегает сам) или закрыта. `bottom` — высота панели вопроса снизу, CSS px. */
  'farm:auto': { on: boolean; bottom: number };
  /** Текущее задание мини-игры: герой идёт к этой грядке, подпись над ней. */
  'farm:focus': { id: string | null; tile: [number, number] | null; label: string };
  /** Действие героя по ответу (полив, удобрение, урожай, промах): встаёт в очередь автобега. */
  'farm:act': FarmAct;
  /** Всплывающая надпись над точкой мира (экранные CSS px): «+10», подпись растения. */
  'fx:float': { x: number; y: number; text: string; kind: 'xp' | 'miss' | 'info' };
  /** Звук действия мира (шаг героя, плеск, срыв, «плим» в коробке): играет `systems/platform/sfx.ts`, если звук включён. */
  'fx:sfx': { name: SfxName };
  /** Подпись над растением у героя (экранные CSS px); null — спрятать. */
  'fx:label': { text: string; x: number; y: number } | null;
  /** Бобёр (`systems/beaver.ts`): с ним заговорили (тап или A) — пузырь «Bóbr · бобёр» с 🔊 над ним (экранные CSS px). */
  'beaver:talk': { x: number; y: number };
  /** Бобёр поселился на ферме (уровень ≥ 10, один раз): карточка «Bóbr zamieszkał na farmie!», хатка и пруд на карте. */
  'beaver:settled': Record<string, never>;
  /** Герой стоит у объекта, с которым сработает A (над ним рисуется «A»): `x`,`y` — точка над объектом в экранных CSS px; null — отошёл или экран открыт. */
  'fx:near': { use: string; id: string; x: number; y: number } | null;
  /** Первые шаги новичка (`ui/hintsGuide.ts`): к какому объекту вести героя (`desk`, `board`); null — указатель погас. */
  'guide:goal': { use: string | null };
  /** Где на экране герой и цель указателя (CSS px); `via: 'door'` — цель на другой карте, указываем на дверь. null — спрятать. */
  /** Где сейчас стрелка указателя первых шагов (экранные CSS px центра, null — скрыта): тап по ней = тап по её цели. */
  'guide:arrow': { x: number; y: number } | null;
  'fx:guide': { hero: { x: number; y: number }; target: { x: number; y: number }; via: 'object' | 'door' } | null;
  /** Озвучить польскую строку. `id` — запись манифеста, `text` — запасной текст, `slow` — медленно. */
  'audio:play': { id?: string; text?: string; slow?: boolean; voice?: string; queue?: boolean; done?: (via: AudioVia) => void };
  'audio:stop': Record<string, never>;
  /** Повторная разблокировка из жеста (тост «Нажми, чтобы включить звук»). */
  'audio:unlock': Record<string, never>;
  'audio:blocked': Record<string, never>;
  'audio:state': { state: AudioState; via?: AudioVia; text?: string; id?: string };
  /** v2: вид объектов участков Zagroda по прогрессу (шлёт `systems/polska.ts` при любом изменении и при входе в Zagroda); `entries` — кадры точек входа (`map`, `calendar`, `mast`, `seasonBoard`) по прогрессу. */
  'polska:plots': { views: PlotView[]; entries?: Record<string, number> };
  /** v2: шкала «Wiedza o Polsce» для `ui/polskaHud.ts`: уровень 0…10, доля внутри, доля всех единиц, опыт v2; `gain` — «+N», `up` — новый уровень. */
  'polska:scale': { sub: number; of: number; pl: string; ru: string; ratio: number; pct: number; xp: number; gain?: number; up?: boolean };
  /** v2: ответ в игре о Польше (для автобега в Zagroda: полив, рост, урожай у объекта `obj`). `quiet` — тихий урожай (тяжёлые даты: без «плим» и искр). */
  'polska:act': { kind: 'water' | 'grow' | 'harvest' | 'miss'; id: string; label: string; obj: string | null; xp: number; quiet?: boolean };
  /** v2: отложенный обход после игры во весь экран (карта, календарь): при входе в Zagroda герой сам «поливает» подросшие объекты (≤ 5 с, ручной ввод прерывает); `go` — идти туда сейчас («Na pole!»). */
  'polska:tour': { plot: ZPlot; objs: string[]; go?: boolean };
  /** v2: текущее задание игры о Польше: герой бежит к объекту `obj` в Zagroda (null — стоит). */
  'polska:focus': { id: string | null; obj: string | null; label: string };
  /** v2: игра о Польше открыта/закрыта. `layout: panel` — нижняя панель (мир сверху, герой уходит в Zagroda); `full` — весь экран, мир не трогаем. */
  'polska:auto': { on: boolean; game: PolskaGameId | null; layout: 'panel' | 'full'; plot?: ZPlot };
  /** Мини-игра закрыта (или «Wróć» после «Na pole!»): герой и кот возвращаются на клетку, откуда игру запустили, лицом туда же. Сцена гасит экран на 150 мс и ставит героя (карту пересоздаёт, если нужна другая). */
  'world:return': { map: string; x: number; y: number; facing: Dir };
  /** v2: кнопка «Idź» на доске: герой сам идёт к объекту с этим `use` (через двери, если он на другой карте) и открывает его. */
  'world:goto': { use: string };
  /** Intent после роутера: `to` = мир или оверлей по фокусу. */
  'input:intent': RoutedIntent;
  'input:source': { source: Source };
  /** Показать или спрятать d-pad; решает роутер по источнику, устройству и настройке. */
  'input:dpad': { visible: boolean; side: DpadSide };
  /** Новая сборка уже управляет страницей, игрок играет: тост «Новая версия · Обновить». */
  'app:update': Record<string, never>;
  /** Игрок нажал «Обновить»: дописать сохранение и перезагрузиться. */
  'app:reload': Record<string, never>;
}
