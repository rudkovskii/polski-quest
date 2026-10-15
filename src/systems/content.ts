// Загрузка контента (ТЗ §2.1, §3): все JSON из content/ через import.meta.glob, индекс по id.
// Проверку схемами и ссылками делает валидатор (tools/validate_content.ts): в CI через `npm run check`,
// в dev через vite-плагин из vite.config.ts (оверлей ошибки поверх игры). Здесь только сборка индекса
// и защита от дублей, чтобы рантайм не зависел от ajv.
import type {
  Character,
  Dialogue,
  Director,
  ErrorTag,
  Item,
  Lesson,
  Line,
  LocationMap,
  MinimalPair,
  Module,
  Order,
  Phonetics,
  Recipe,
  Secret,
  Tuning,
  VocabEntry,
  World,
} from '../types/content';

export interface ModuleBundle {
  module: Module;
  vocab: VocabEntry[];
  lessons: Lesson[];
  dialogues: Dialogue[];
  maps: LocationMap[];
}

/** Запись с модулем-владельцем. */
export interface Owned<T> {
  module: string;
  value: T;
}

export interface Content {
  world: World;
  tuning: Tuning;
  director: Director;
  phonetics: Phonetics;
  characters: ReadonlyMap<string, Character>;
  items: ReadonlyMap<string, Item>;
  modules: ReadonlyMap<string, ModuleBundle>;
  vocab: ReadonlyMap<string, Owned<VocabEntry>>;
  pairs: ReadonlyMap<string, MinimalPair>;
  lessons: ReadonlyMap<string, Owned<Lesson>>;
  dialogues: ReadonlyMap<string, Owned<Dialogue>>;
  maps: ReadonlyMap<string, Owned<LocationMap>>;
  lines: ReadonlyMap<string, Line>;
  secrets: ReadonlyMap<string, Secret>;
  orders: ReadonlyMap<string, Order>;
  recipes: ReadonlyMap<string, Recipe>;
  errorTags: ReadonlyMap<string, ErrorTag>;
  /** Старый lxId → новый (объединение module.renames всех модулей, §3.12). */
  renames: ReadonlyMap<string, string>;
}

export class ContentError extends Error {
  override name = 'ContentError';
}

function index<T extends { id: string }>(what: string, list: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of list) {
    if (m.has(x.id)) throw new ContentError(`content: дубль ${what} "${x.id}" (запусти npm run validate)`);
    m.set(x.id, x);
  }
  return m;
}

function owned<T extends { id: string }>(what: string, list: readonly Owned<T>[]): Map<string, Owned<T>> {
  const m = new Map<string, Owned<T>>();
  for (const x of list) {
    if (m.has(x.value.id)) throw new ContentError(`content: дубль ${what} "${x.value.id}" (запусти npm run validate)`);
    m.set(x.value.id, x);
  }
  return m;
}

const EMPTY_DIRECTOR: Director = { schema: 1, beats: [], reveals: [] };
const EMPTY_PHONETICS: Phonetics = { schema: 1, clusters: [], pairs: [] };

/**
 * Собирает индекс из словаря «путь → JSON». Пути как у import.meta.glob: `/content/world.json`,
 * `/content/modules/ch01/maps/metro.json`. Данные считаются уже проверенными валидатором.
 */
export function buildContent(files: Readonly<Record<string, unknown>>, prefix = '/content/'): Content {
  const rel = new Map<string, unknown>();
  for (const [path, data] of Object.entries(files))
    if (path.startsWith(prefix) && !path.startsWith(`${prefix}schema/`)) rel.set(path.slice(prefix.length), data);

  const need = <T>(name: string): T => {
    if (!rel.has(name)) throw new ContentError(`content: нет файла content/${name}`);
    return rel.get(name) as T;
  };
  const opt = <T>(name: string, fallback: T): T => (rel.has(name) ? (rel.get(name) as T) : fallback);

  const bundles = new Map<string, ModuleBundle>();
  const bundle = (id: string): ModuleBundle => {
    let b = bundles.get(id);
    if (!b) {
      b = { module: undefined as unknown as Module, vocab: [], lessons: [], dialogues: [], maps: [] };
      bundles.set(id, b);
    }
    return b;
  };
  for (const [path, data] of rel) {
    const m = /^modules\/([^/]+)\/(?:(module|vocab|lessons|dialogues)\.json|maps\/[^/]+\.json)$/.exec(path);
    if (!m) continue;
    const b = bundle(m[1]!);
    switch (m[2]) {
      case 'module':
        b.module = data as Module;
        break;
      case 'vocab':
        b.vocab = data as VocabEntry[];
        break;
      case 'lessons':
        b.lessons = data as Lesson[];
        break;
      case 'dialogues':
        b.dialogues = data as Dialogue[];
        break;
      default:
        b.maps.push(data as LocationMap);
    }
  }
  for (const [id, b] of bundles)
    if (!(b.module as Module | undefined)) throw new ContentError(`content: у модуля "${id}" нет module.json`);

  const all = [...bundles.entries()];
  const ownedOf = <T>(pick: (b: ModuleBundle) => T[]): Owned<T>[] =>
    all.flatMap(([module, b]) => pick(b).map((value) => ({ module, value })));
  const phonetics = opt<Phonetics>('phonetics.json', EMPTY_PHONETICS);
  const renames = new Map<string, string>();
  for (const [, b] of all) for (const [from, to] of Object.entries(b.module.renames ?? {})) renames.set(from, to);

  return {
    world: need<World>('world.json'),
    tuning: need<Tuning>('tuning.json'),
    director: opt<Director>('director.json', EMPTY_DIRECTOR),
    phonetics,
    characters: index('character', need<Character[]>('characters.json')),
    items: index('item', opt<Item[]>('items.json', [])),
    modules: bundles,
    vocab: owned('lx', ownedOf((b) => b.vocab)),
    pairs: index('mp', phonetics.pairs),
    lessons: owned('lesson', ownedOf((b) => b.lessons)),
    dialogues: owned('dlg', ownedOf((b) => b.dialogues)),
    maps: owned('location', ownedOf((b) => b.maps)),
    lines: index('line', opt<Line[]>('story/lines.json', [])),
    secrets: index('secret', opt<Secret[]>('secrets.json', [])),
    orders: index('order', opt<Order[]>('orders.json', [])),
    recipes: index('recipe', opt<Recipe[]>('recipes.json', [])),
    errorTags: index('errorTag', opt<ErrorTag[]>('errorTags.json', [])),
    renames,
  };
}

let cached: Content | null = null;

/**
 * Подменить контент игры (Wola, W-01: своя сборка `src/wola/content.ts` — словарь Wola и карта хаба). Вызывает
 * склейка до первой сцены: Location и экраны берут контент через `getContent()`.
 */
export function useContent(c: Content): void {
  cached = c;
}

/** Контент игры из content/ (eager-импорт: JSON попадает в бандл, загрузка синхронная). */
export function getContent(): Content {
  if (!cached) {
    // content/wola/ — короткая версия (своя точка входа), в основную игру не попадает.
    const files = import.meta.glob<unknown>(['/content/**/*.json', '!/content/schema/**', '!/content/wola/**'], {
      eager: true,
      import: 'default',
    });
    cached = buildContent(files);
  }
  return cached;
}
