// Полный список событий шины. Связь scenes/world ⇄ ui и склейка main.ts идут только через неё.
import type { DpadSide, Dir, MapControls, RoutedIntent, Source } from './input';

/** Чем прозвучала фраза: файл из манифеста, Web Speech pl-PL или никак (показать текст). */
export type AudioVia = 'file' | 'webspeech' | 'none';
/**
 * Состояние озвучки: playing — звучит (`via`); idle — очередь пуста; blocked — iOS отклонил play()
 * после фона, ждём тап (`audio:blocked`); none — фразу озвучить нечем.
 */
export type AudioState = 'idle' | 'playing' | 'blocked' | 'none';

/** Объекты, с которыми можно что-то сделать (`use` в content/maps/*.json). Логику каждого делает F-03. */
export type UseKind = 'desk' | 'board' | 'bin' | 'shelf' | 'bed';

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
  /** Опыт и уровень для HUD (F-03 шлёт; в F-01 «A0» и 0%). */
  'hud:xp': { level: string; ratio: number };
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
