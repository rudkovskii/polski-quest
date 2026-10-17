// Полный список событий шины. Связь scenes/world ⇄ ui и склейка main.ts идут только через неё.
import type { FarmAct, PlantView } from './farm';
import type { DpadSide, Dir, MapControls, RoutedIntent, Source } from './input';

/** Чем прозвучала фраза: файл из манифеста, Web Speech pl-PL или никак (показать текст). */
export type AudioVia = 'file' | 'webspeech' | 'none';
/**
 * Состояние озвучки: playing — звучит (`via`); idle — очередь пуста; blocked — iOS отклонил play()
 * после фона, ждём тап (`audio:blocked`); none — фразу озвучить нечем.
 */
export type AudioState = 'idle' | 'playing' | 'blocked' | 'none';

/** Объекты, с которыми можно что-то сделать (`use` в content/maps/*.json). Логику каждого делает F-03. */
export type UseKind = 'desk' | 'board' | 'bin' | 'shelf' | 'bed' | 'plant';

/**
 * КОНТРАКТ ДЛЯ F-03. Игрок нажал A рядом с интерактивным объектом или тапнул по нему (мир сам подошёл).
 * Мир при этом ничего не открывает: слушатель решает, что показать. Событие приходит один раз за действие.
 */
export interface WorldInteract {
  /** id карты: `home` или `farm`. */
  location: string;
  /** Что за объект: desk (Słownik), board (выбор мини-игры), bin (коробка урожая), shelf (банки), bed (кровать). */
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
}

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
  /** Опыт и уровень для HUD. `ratio` — доля пути внутри подуровня A0.x; `next` — следующий подуровень и сколько слов до него (null — A1); `xp` — всего очков; `gain` — сколько пришло сейчас («+N»); `up` — новый уровень (вспышка). */
  'hud:xp': { level: string; ratio: number; xp?: number; gain?: number; up?: boolean; next?: { level: string; words: number } | null };
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
  /** Подпись над растением у героя (экранные CSS px); null — спрятать. */
  'fx:label': { text: string; x: number; y: number } | null;
  /** Герой стоит у объекта, с которым сработает A (над ним рисуется «A»): `x`,`y` — точка над объектом в экранных CSS px; null — отошёл или экран открыт. */
  'fx:near': { use: string; id: string; x: number; y: number } | null;
  /** Первые шаги новичка (`ui/hintsGuide.ts`): к какому объекту вести героя (`desk`, `board`); null — указатель погас. */
  'guide:goal': { use: string | null };
  /** Где на экране герой и цель указателя (CSS px); `via: 'door'` — цель на другой карте, указываем на дверь. null — спрятать. */
  'fx:guide': { hero: { x: number; y: number }; target: { x: number; y: number }; via: 'object' | 'door' } | null;
  /** Озвучить польскую строку. `id` — запись манифеста, `text` — запасной текст, `slow` — медленно. */
  'audio:play': { id?: string; text?: string; slow?: boolean; voice?: string; queue?: boolean; done?: (via: AudioVia) => void };
  'audio:stop': Record<string, never>;
  /** Повторная разблокировка из жеста (тост «Нажми, чтобы включить звук»). */
  'audio:unlock': Record<string, never>;
  'audio:blocked': Record<string, never>;
  'audio:state': { state: AudioState; via?: AudioVia; text?: string; id?: string };
  /** Intent после роутера: `to` = мир или оверлей по фокусу. */
  'input:intent': RoutedIntent;
  'input:source': { source: Source };
  /** Показать или спрятать d-pad; решает роутер по источнику, устройству и настройке. */
  'input:dpad': { visible: boolean; side: DpadSide };
  /** Новая сборка уже управляет страницей, игрок играет: тост «Есть обновление». */
  'app:update': Record<string, never>;
  /** Игрок нажал «Обновить»: дописать сохранение и перезагрузиться. */
  'app:reload': Record<string, never>;
}
