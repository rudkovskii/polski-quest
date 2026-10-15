// Контент короткой версии «Wola» (W-01): общие файлы игры (tuning, персонажи, теги ошибок, фонетика) + словарь
// content/wola/vocab.json и карты content/wola/maps/*.json, собранные как модуль `wola`. Сюжетных файлов нет:
// ни режиссёра, ни реплик, ни уроков глав. Порог «зрелого» слова — 21 день (tuning.jars.thresholds[0]).
import { buildContent, type Content } from '../systems/content';
import type { LocationMap, Module, Tuning, WolaVocab } from '../types/content';
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
export function wolaContentFrom(files: Readonly<Record<string, unknown>>): { content: Content; vocab: WolaVocab } {
  const vocab = files['/content/wola/vocab.json'] as WolaVocab | undefined;
  if (!vocab) throw new Error('Wola: нет content/wola/vocab.json');
  const out: Record<string, unknown> = {};
  for (const name of ['world.json', 'characters.json', 'errorTags.json', 'phonetics.json']) {
    const f = files[`/content/${name}`];
    if (f !== undefined) out[`/content/${name}`] = f;
  }
  const tuning = files['/content/tuning.json'] as Tuning;
  const [, ...rest] = tuning.jars.thresholds;
  out['/content/tuning.json'] = { ...tuning, jars: { ...tuning.jars, thresholds: [RIPE_DAYS, ...rest] } };
  out['/content/modules/wola/module.json'] = WOLA_MODULE;
  out['/content/modules/wola/vocab.json'] = vocab.vocab;
  for (const [path, data] of Object.entries(files)) {
    const m = /^\/content\/wola\/maps\/([^/]+)\.json$/.exec(path);
    if (m) out[`/content/modules/wola/maps/${m[1]}.json`] = data as LocationMap;
  }
  return { content: buildContent(out), vocab };
}

let cached: { content: Content; vocab: WolaVocab } | null = null;

export function wolaContent(): { content: Content; vocab: WolaVocab } {
  if (!cached) {
    const files = import.meta.glob<unknown>(
      ['/content/world.json', '/content/tuning.json', '/content/characters.json', '/content/errorTags.json', '/content/phonetics.json', '/content/wola/**/*.json'],
      { eager: true, import: 'default' },
    );
    cached = wolaContentFrom(files);
  }
  return cached;
}
