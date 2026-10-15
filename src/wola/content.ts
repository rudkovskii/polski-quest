// Контент короткой версии «Wola» (W-01): общие файлы игры (tuning, персонажи, теги ошибок, фонетика) + словарь
// content/wola/vocab.json и карты content/wola/maps/*.json, собранные как модуль `wola`. Сюжетных файлов нет:
// ни режиссёра, ни реплик, ни уроков глав. Порог «зрелого» слова — 21 день (tuning.jars.thresholds[0]).
// Salad Story (W-02): content/wola/salad/{menu,cashiers,levels,events}.json; кассиры становятся персонажами
// (имя в окне реплики, голос Zosia, обращение pan).
import { buildContent, type Content } from '../systems/content';
import type { Character, LocationMap, Module, SaladCashiers, SaladEvents, SaladLevels, SaladMenu, Tuning, WolaVocab } from '../types/content';
import type { SaladData } from './systems/saladVisit';
import { RIPE_DAYS } from './systems/wola';

const WOLA_MODULE = {
  schema: 1,
  id: 'wola',
  kind: 'side',
  status: 'ready',
  title: { pl: 'Wola', ru: 'Воля' },
  unlock: { hard: { always: true } },
  lessons: [],
} as unknown as Module;

/** Сборка из словаря «путь → JSON» (пути как у import.meta.glob). Тесты подают файлы с диска. */
export type WolaContent = { content: Content; vocab: WolaVocab; salad: SaladData };

/** Кассир Salad Story как персонаж: имя в окне реплики, голос Zosia, без сердец. */
export function cashierCharacter(c: SaladCashiers['cashiers'][number]): Character {
  return { id: c.id, name: c.name, kind: 'extra', addressAs: 'pan', voice: { engine: 'say', id: 'Zosia' }, sprite: c.sprite, portrait: c.sprite, hearts: false };
}

export function wolaContentFrom(files: Readonly<Record<string, unknown>>): WolaContent {
  const vocab = files['/content/wola/vocab.json'] as WolaVocab | undefined;
  if (!vocab) throw new Error('Wola: нет content/wola/vocab.json');
  const salad: SaladData = {
    menu: files['/content/wola/salad/menu.json'] as SaladMenu,
    cashiers: files['/content/wola/salad/cashiers.json'] as SaladCashiers,
    levels: files['/content/wola/salad/levels.json'] as SaladLevels,
    events: files['/content/wola/salad/events.json'] as SaladEvents,
  };
  if (!salad.menu || !salad.cashiers || !salad.levels || !salad.events) throw new Error('Wola: нет content/wola/salad/*.json');
  const out: Record<string, unknown> = {};
  for (const name of ['world.json', 'characters.json', 'errorTags.json', 'phonetics.json']) {
    const f = files[`/content/${name}`];
    if (f !== undefined) out[`/content/${name}`] = f;
  }
  out['/content/characters.json'] = [...((out['/content/characters.json'] as Character[] | undefined) ?? []), ...salad.cashiers.cashiers.map(cashierCharacter)];
  const tuning = files['/content/tuning.json'] as Tuning;
  const [, ...rest] = tuning.jars.thresholds;
  out['/content/tuning.json'] = { ...tuning, jars: { ...tuning.jars, thresholds: [RIPE_DAYS, ...rest] } };
  out['/content/modules/wola/module.json'] = WOLA_MODULE;
  out['/content/modules/wola/vocab.json'] = vocab.vocab;
  for (const [path, data] of Object.entries(files)) {
    const m = /^\/content\/wola\/maps\/([^/]+)\.json$/.exec(path);
    if (m) out[`/content/modules/wola/maps/${m[1]}.json`] = data as LocationMap;
  }
  return { content: buildContent(out), vocab, salad };
}

let cached: WolaContent | null = null;

export function wolaContent(): WolaContent {
  if (!cached) {
    const files = import.meta.glob<unknown>(
      ['/content/world.json', '/content/tuning.json', '/content/characters.json', '/content/errorTags.json', '/content/phonetics.json', '/content/wola/**/*.json'],
      { eager: true, import: 'default' },
    );
    cached = wolaContentFrom(files);
  }
  return cached;
}
