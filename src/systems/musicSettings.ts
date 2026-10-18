// Музыка (V11b): список треков, настройки и интерфейс плеера. Чистые данные и функции, без браузера.
// Сам плеер (HTMLAudio) — `platform/music.ts`; экраны — `ui/radio.ts`, `ui/radioHud.ts`, `ui/settings.ts`.

export interface Track {
  /** Имя файла без расширения: `public/music/<id>.m4a`. */
  id: string;
  /** Название по-польски и по-русски (мелко). */
  pl: string;
  ru: string;
}

/** Плейлист. Источники, авторы и лицензии — `CREDITS.md`. */
export const TRACKS: readonly Track[] = [
  { id: 'poranek', pl: 'Poranek', ru: 'Утро' },
  { id: 'farma', pl: 'Na farmie', ru: 'На ферме' },
  { id: 'dzien', pl: 'Dzień', ru: 'День' },
  { id: 'laki', pl: 'Łąki', ru: 'Луга' },
  { id: 'wieczor', pl: 'Wieczór', ru: 'Вечер' },
  { id: 'deszcz', pl: 'Deszcz', ru: 'Дождь' },
];

export type MusicRepeat = 'all' | 'one';

export interface MusicSettings {
  /** Музыка включена. По умолчанию выключена. */
  on: boolean;
  /** Громкость музыки, 0–100 %. */
  volume: number;
  /** Текущий трек (`Track.id`). */
  track: string;
  /** По кругу (весь плейлист) или один трек. */
  repeat: MusicRepeat;
  /** Играть по всей ферме (и в мини-играх); выкл — только в доме. */
  everywhere: boolean;
}

export const MUSIC_VOLUME_DEFAULT = 50;
export const MUSIC_DEFAULT: MusicSettings = { on: false, volume: MUSIC_VOLUME_DEFAULT, track: TRACKS[0]!.id, repeat: 'all', everywhere: true };

export const trackById = (id: string): Track => TRACKS.find((t) => t.id === id) ?? TRACKS[0]!;

/** Сосед по кругу: `dir` = 1 вперёд, -1 назад. */
export function stepTrack(id: string, dir: 1 | -1): string {
  const i = Math.max(0, TRACKS.findIndex((t) => t.id === id));
  return TRACKS[(i + dir + TRACKS.length) % TRACKS.length]!.id;
}

/** Привести прочитанное к настройкам: мусор заменяется значениями по умолчанию, неизвестный трек — первым. */
export function normalizeMusic(raw: unknown): MusicSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const vol = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(100, Math.max(0, Math.round(r.volume))) : MUSIC_VOLUME_DEFAULT;
  return {
    on: r.on === true,
    volume: vol,
    track: typeof r.track === 'string' && TRACKS.some((t) => t.id === r.track) ? r.track : MUSIC_DEFAULT.track,
    repeat: r.repeat === 'one' ? 'one' : 'all',
    everywhere: r.everywhere !== false,
  };
}

/** Что видят экраны. */
export interface MusicView extends MusicSettings {
  /** Играет ли звук прямо сейчас (включено, не `?mute=1`, вкладка видна, место подходит, браузер не заблокировал). */
  playing: boolean;
  /** `?mute=1`: переключатели работают, но аудио не создаётся. */
  muted: boolean;
}

/** Управление музыкой для экранов (реализует `platform/music.ts`). */
export interface MusicControl {
  view(): MusicView;
  setOn(on: boolean): void;
  toggle(): void;
  /** Выбрать трек; `play` — заодно включить музыку. */
  select(id: string, play?: boolean): void;
  next(): void;
  prev(): void;
  setVolume(v: number): void;
  setRepeat(r: MusicRepeat): void;
  setEverywhere(on: boolean): void;
  /** Подписка на любое изменение; возвращает отписку. */
  onChange(fn: (v: MusicView) => void): () => void;
}
