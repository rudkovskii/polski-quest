// Ядро валидатора контента (ТЗ §3.13). Чистая функция: файлы и схемы приходят параметром,
// без чтения диска и git. Используют tools/validate_content.ts (CLI), vite-плагин (оверлей в dev)
// и tests/content.test.ts.
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type {
  Biome,
  Character,
  Condition,
  Dialogue,
  Director,
  Effect,
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
  Step,
  Tuning,
  VocabEntry,
  World,
} from '../../src/types/content';
import { FIRST_DAY_LINES } from '../../src/systems/director';
import { buildWordIndex, matchWords, refIds, type WordIndex } from '../../src/systems/words';

// ───────────────────────────── типы ─────────────────────────────

export type Level = 'error' | 'warn';
export type IssueCode =
  | 'json' // файл не парсится
  | 'file' // неизвестный или отсутствующий файл
  | 'schema' // §3.13 п. 1
  | 'nfc' // строка не в NFC (§3.0)
  | 'dup' // п. 2
  | 'id' // id не по правилам модуля (урок <module>.*, диалог dlg.<module>.*, карта <module>.<name>)
  | 'ref' // п. 3, а также word.item, orders.npc (п. 8)
  | 'map' // п. 4
  | 'map-connect' // несвязная карта (предупреждение)
  | 'introduces' // п. 5
  | 'audio' // п. 6
  | 'vocab-removed' // п. 7
  | 'line' // п. 8: реплики нет в story/lines.json
  | 'todo' // реплика с todo: true
  | 'secret-spot' // п. 8: точки нет среди объектов secret
  | 'recipe-sum' // п. 8: сумма needs ≠ kitchen.jarsPerRecipe
  | 'step' // шаг урока (§3.5)
  | 'lesson' // урок целиком
  | 'dialogue' // граф диалога (§3.6)
  | 'orphan' // сиротский узел / урок вне module.lessons (предупреждение)
  | 'tr' // транскрипция
  | 'long-lesson' // урок длиннее minutes × 1.5 (предупреждение)
  | 'words'; // разметка words реплики (P-07): id слова есть в vocab, слово стоит в строке

export interface Issue {
  level: Level;
  code: IssueCode;
  /** Путь файла относительно корня контента, например `modules/ch01/vocab.json`. */
  file: string;
  /** JSON Pointer внутри файла, например `/3/steps/2/answer`; `` = весь файл. */
  path: string;
  msg: string;
}

export interface CheckInput {
  /** Путь относительно корня контента → разобранный JSON. Схемы (`schema/`) сюда не входят. */
  files: ReadonlyMap<string, unknown>;
  /** Имя файла схемы (`world.schema.json`) → схема. */
  schemas: ReadonlyMap<string, object>;
  /** Слова предыдущей версии (п. 7): lxId → файл, где оно было. `null` = сравнивать не с чем. */
  prevVocab?: ReadonlyMap<string, string> | null;
  /** `public/audio/manifest.json` (п. 6, пишет tools/build_audio.py). Нет файла = предупреждение «не проверена». */
  audioManifest?: unknown;
  /**
   * Сборка для людей (`--release`, `PQ_RELEASE=1 npm run build`, P-01): реплика-заглушка (`todo`) в бите
   * первого дня — ошибка. Без флага — одно предупреждение со списком.
   */
  release?: boolean;
}

export type SchemaName =
  | 'world'
  | 'characters'
  | 'items'
  | 'tuning'
  | 'director'
  | 'lines'
  | 'secrets'
  | 'orders'
  | 'recipes'
  | 'phonetics'
  | 'errorTags'
  | 'module'
  | 'vocab'
  | 'lessons'
  | 'dialogues'
  | 'map';

/** Глобальные файлы контента → схема (ТЗ §2.3, §3.8). */
export const GLOBAL_FILES: Readonly<Record<string, SchemaName>> = {
  'world.json': 'world',
  'characters.json': 'characters',
  'items.json': 'items',
  'tuning.json': 'tuning',
  'director.json': 'director',
  'story/lines.json': 'lines',
  'secrets.json': 'secrets',
  'orders.json': 'orders',
  'recipes.json': 'recipes',
  'phonetics.json': 'phonetics',
  'errorTags.json': 'errorTags',
};
const REQUIRED_FILES = ['world.json', 'characters.json', 'tuning.json'];

export interface FileKind {
  schema: SchemaName;
  module?: string;
  /** Имя карты (`maps/<name>.json`). */
  name?: string;
}

export function classify(rel: string): FileKind | null {
  const g = GLOBAL_FILES[rel];
  if (g) return { schema: g };
  const m = /^modules\/([^/]+)\/(module|vocab|lessons|dialogues)\.json$/.exec(rel);
  if (m) return { schema: m[2] as SchemaName, module: m[1] };
  const mp = /^modules\/([^/]+)\/maps\/([^/]+)\.json$/.exec(rel);
  if (mp) return { schema: 'map', module: mp[1], name: mp[2] };
  return null;
}

export function formatIssue(i: Issue, prefix = ''): string {
  const where = `${prefix}${i.file}:${i.path || '/'}`;
  return i.level === 'error' ? `${where}: ${i.msg}` : `${where}: предупреждение: ${i.msg}`;
}

// ───────────────────────────── схемы (п. 1) ─────────────────────────────

const ajvCache = new WeakMap<ReadonlyMap<string, object>, Ajv2020>();

function ajvFor(schemas: ReadonlyMap<string, object>): Ajv2020 {
  let ajv = ajvCache.get(schemas);
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, verbose: true, discriminator: true, strict: true, strictRequired: false, strictTypes: false });
  addFormats(ajv);
  for (const [name, s] of schemas) ajv.addSchema(s, name);
  ajvCache.set(schemas, ajv);
  return ajv;
}

function validatorFor(schemas: ReadonlyMap<string, object>, name: SchemaName): ValidateFunction {
  const v = ajvFor(schemas).getSchema(`${name}.schema.json`);
  if (!v) throw new Error(`нет схемы content/schema/${name}.schema.json`);
  return v;
}

function decodePointer(p: string): string[] {
  return p === '' ? [] : p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function at(data: unknown, pointer: string): unknown {
  let cur: unknown = data;
  for (const k of decodePointer(pointer)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const show = (v: unknown): string => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

function ajvMessage(e: ErrorObject, data: unknown): string {
  const v = at(data, e.instancePath);
  const p = e.params as Record<string, unknown>;
  const owner = (e.parentSchema as { title?: string } | undefined)?.title;
  const atomOf = owner === 'Condition' ? 'условия' : owner === 'Effect' ? 'эффекта' : null;
  switch (e.keyword) {
    case 'required':
      return `нет обязательного поля "${String(p.missingProperty)}"`;
    case 'additionalProperties':
      return atomOf
        ? `неизвестный атом ${atomOf} "${String(p.additionalProperty)}"`
        : `лишнее поле "${String(p.additionalProperty)}"`;
    case 'minProperties':
    case 'maxProperties':
      return atomOf ? `объект ${atomOf} должен содержать ровно один ключ` : `число полей: ${e.message ?? ''}`;
    case 'enum': {
      const allowed = (p.allowedValues as unknown[]).map(String).join(', ');
      if (e.schemaPath.includes('$defs/hud')) return `неизвестный элемент HUD ${show(v)}; допустимо: ${allowed}`;
      return `значение ${show(v)} не из списка: ${allowed}`;
    }
    case 'const':
      return `должно быть ${show(p.allowedValue)}, а не ${show(v)}`;
    case 'pattern':
      return `${show(v)} не подходит под шаблон ${String(p.pattern)}`;
    case 'type':
      return `ожидался тип ${String(p.type)}, а не ${show(v)}`;
    case 'discriminator':
      return p.error === 'mapping'
        ? `неизвестный тип ${show(p.tagValue)} в поле "${String(p.tag)}"`
        : `нет поля-дискриминатора "${String(p.tag)}"`;
    case 'anyOf':
      return `значение ${show(v)} не подходит ни под один из вариантов`;
    case 'minItems':
      return `элементов меньше ${String(p.limit)}`;
    case 'maxItems':
      return `элементов больше ${String(p.limit)}`;
    case 'minLength':
      return p.limit === 1 ? 'пустая строка' : `строка короче ${String(p.limit)}`;
    case 'maxLength':
      return `строка длиннее ${String(p.limit)}`;
    case 'minimum':
    case 'maximum':
      return `число ${show(v)} вне диапазона (${e.keyword === 'minimum' ? '≥' : '≤'} ${String(p.limit)})`;
    case 'uniqueItems':
      return `повтор элементов (${String(p.i)} и ${String(p.j)})`;
    case 'propertyNames':
      return `недопустимое имя ключа ${show(p.propertyName)}`;
    default:
      return `${e.keyword}: ${e.message ?? ''}`;
  }
}

function schemaIssues(file: string, errors: ErrorObject[], data: unknown): Issue[] {
  // anyOf порождает ошибки всех веток: оставляем одну строку на путь.
  const anyOfPaths = errors.filter((e) => e.keyword === 'anyOf').map((e) => e.instancePath);
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const e of errors) {
    if (e.keyword === 'if') continue; // дублирует ошибку из then
    if (e.keyword !== 'anyOf' && anyOfPaths.some((p) => e.instancePath === p || e.instancePath.startsWith(`${p}/`)))
      continue;
    if (e.keyword === 'propertyNames') continue; // ajv выдаёт его вместе с конкретной ошибкой имени
    const path = e.instancePath;
    const msg = ajvMessage(e, data);
    const key = `${path} ${msg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ level: 'error', code: 'schema', file, path, msg });
  }
  return out;
}

// ───────────────────────────── контекст проверки ─────────────────────────────

interface Def<T> {
  file: string;
  path: string;
  value: T;
  module?: string;
}

interface MapInfo {
  map: LocationMap;
  module: string;
  file: string;
  /** passable[y][x]; пусто, если сетка битая. */
  passable: boolean[][];
  objectIds: Set<string>;
  plots: Set<string>;
  /** Имя точки (spot) объектов secret. */
  spots: Set<string>;
}

type Where = { file: string; path: string };

class Ctx {
  issues: Issue[] = [];
  characters = new Map<string, Def<Character>>();
  items = new Map<string, Def<Item>>();
  modules = new Map<string, Def<Module>>();
  vocab = new Map<string, Def<VocabEntry>>();
  pairs = new Map<string, Def<MinimalPair>>();
  lessons = new Map<string, Def<Lesson>>();
  dialogues = new Map<string, Def<Dialogue>>();
  maps = new Map<string, Def<MapInfo>>();
  biomes = new Map<string, Def<Biome>>();
  lines = new Map<string, Def<Line>>();
  beats = new Map<string, Def<unknown>>();
  secrets = new Map<string, Def<Secret>>();
  orders = new Map<string, Def<Order>>();
  recipes = new Map<string, Def<Recipe>>();
  errorTags = new Map<string, Def<ErrorTag>>();
  clusters = new Map<string, Def<unknown>>();
  /** Точка secret → где объявлена (глобально уникальна). */
  spots = new Map<string, Def<{ location: string }>>();
  tuning: Tuning | null = null;
  /** Ссылки на реплики: проверяются после сбора lines. `strict` = todo здесь ошибка. */
  lineRefs: { id: string; w: Where; strict: boolean }[] = [];

  err(code: IssueCode, w: Where, msg: string): void {
    this.issues.push({ level: 'error', code, file: w.file, path: w.path, msg });
  }
  warn(code: IssueCode, w: Where, msg: string): void {
    this.issues.push({ level: 'warn', code, file: w.file, path: w.path, msg });
  }

  define<T>(reg: Map<string, Def<T>>, ns: string, id: string, def: Def<T>): void {
    const prev = reg.get(id);
    if (prev) {
      this.err('dup', def, `дубль id ${ns} "${id}": уже определён в ${prev.file}:${prev.path || '/'}`);
      return;
    }
    reg.set(id, def);
  }

  /** Висячая ссылка: `field "id"` не найден в `where`. */
  ref(reg: Map<string, unknown>, id: string | undefined, w: Where, field: string, where: string): boolean {
    if (id === undefined) return true;
    if (reg.has(id)) return true;
    this.err('ref', w, `висячая ссылка ${field} "${id}": нет в ${where}`);
    return false;
  }

  line(id: string | undefined, w: Where, strict = false): void {
    if (id !== undefined) this.lineRefs.push({ id, w, strict });
  }
}

const sub = (w: Where, ...keys: (string | number)[]): Where => ({
  file: w.file,
  path: `${w.path}/${keys.map((k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`,
});

const WHERE = {
  characters: 'characters.json',
  items: 'items.json',
  vocab: 'vocab.json модулей',
  pairs: 'phonetics.json (pairs)',
  lessons: 'lessons.json модулей',
  dialogues: 'dialogues.json модулей',
  maps: 'maps/*.json модулей',
  modules: 'modules/*/module.json',
  biomes: 'world.json (biomes)',
  lines: 'story/lines.json',
  secrets: 'secrets.json',
} as const;

// ───────────────────────────── условия и эффекты ─────────────────────────────

function walkCond(ctx: Ctx, c: Condition | undefined, w: Where): void {
  if (!c) return;
  if (c.all) c.all.forEach((x, i) => walkCond(ctx, x, sub(w, 'all', i)));
  if (c.any) c.any.forEach((x, i) => walkCond(ctx, x, sub(w, 'any', i)));
  if (c.not) walkCond(ctx, c.not, sub(w, 'not'));
  ctx.ref(ctx.items, c.item, sub(w, 'item'), 'item', WHERE.items);
  ctx.ref(ctx.lessons, c.lessonDone, sub(w, 'lessonDone'), 'lessonDone', WHERE.lessons);
  if (c.bossPassed !== undefined && ctx.ref(ctx.lessons, c.bossPassed, sub(w, 'bossPassed'), 'bossPassed', WHERE.lessons)) {
    const l = ctx.lessons.get(c.bossPassed);
    if (l && l.value.kind !== 'boss')
      ctx.err('ref', sub(w, 'bossPassed'), `bossPassed "${c.bossPassed}" ссылается на урок kind: ${l.value.kind}, а не boss`);
  }
  if (c.mastery) ctx.ref(ctx.modules, c.mastery.module, sub(w, 'mastery', 'module'), 'mastery.module', WHERE.modules);
  if (c.jars?.module) ctx.ref(ctx.modules, c.jars.module, sub(w, 'jars', 'module'), 'jars.module', WHERE.modules);
  if (c.stage) ctx.ref(ctx.biomes, c.stage.biome, sub(w, 'stage', 'biome'), 'stage.biome', WHERE.biomes);
  ctx.ref(ctx.secrets, c.found, sub(w, 'found'), 'found', WHERE.secrets);
}

function walkEffects(ctx: Ctx, effs: Effect[] | undefined, w: Where, strictLines = false): void {
  effs?.forEach((e, i) => {
    const ew = sub(w, i);
    ctx.ref(ctx.items, e.give, sub(ew, 'give'), 'give', WHERE.items);
    ctx.ref(ctx.lessons, e.startLesson, sub(ew, 'startLesson'), 'startLesson', WHERE.lessons);
    ctx.ref(ctx.dialogues, e.startDialogue, sub(ew, 'startDialogue'), 'startDialogue', WHERE.dialogues);
    if (e.teleport) {
      const tw = sub(ew, 'teleport');
      if (ctx.ref(ctx.maps, e.teleport.to, sub(tw, 'to'), 'teleport.to', WHERE.maps) && e.teleport.spawn !== undefined) {
        const m = ctx.maps.get(e.teleport.to)?.value.map;
        if (m && !(e.teleport.spawn in m.spawns))
          ctx.err('ref', sub(tw, 'spawn'), `висячая ссылка teleport.spawn "${e.teleport.spawn}": нет в spawns карты ${e.teleport.to}`);
      }
    }
    if (e.line !== undefined) ctx.line(e.line, sub(ew, 'line'), strictLines);
  });
}

// ───────────────────────────── шаги уроков (§3.5) ─────────────────────────────

function multisetSubset(part: string[], whole: string[]): string | null {
  const pool = new Map<string, number>();
  for (const t of whole) pool.set(t, (pool.get(t) ?? 0) + 1);
  for (const t of part) {
    const n = pool.get(t) ?? 0;
    if (n === 0) return t;
    pool.set(t, n - 1);
  }
  return null;
}

function checkStep(ctx: Ctx, s: Step, w: Where, vocabTags: Set<string>): void {
  if (s.item !== undefined) {
    if (s.item.startsWith('lx.')) ctx.ref(ctx.vocab, s.item, sub(w, 'item'), 'item', WHERE.vocab);
    else ctx.ref(ctx.pairs, s.item, sub(w, 'item'), 'item', WHERE.pairs);
  }
  const range = (answer: number, n: number, field = 'answer'): void => {
    if (answer >= n) ctx.err('step', sub(w, field), `${field} = ${answer} вне диапазона вариантов (0…${n - 1})`);
  };
  switch (s.t) {
    case 'say':
      ctx.ref(ctx.characters, s.who, sub(w, 'who'), 'who', WHERE.characters);
      break;
    case 'listen':
      if (Array.isArray(s.options)) range(s.answer, s.options.length);
      else {
        const tag = s.options.slice('auto:'.length);
        if (!vocabTags.has(tag)) ctx.warn('step', sub(w, 'options'), `"auto:${tag}": нет слов с тегом "${tag}" для дистракторов`);
      }
      break;
    case 'choice':
      range(s.answer, s.options.length);
      for (const k of Object.keys(s.errorTagByOption ?? {}))
        if (Number(k) >= s.options.length)
          ctx.err('step', sub(w, 'errorTagByOption', k), `errorTagByOption: варианта ${k} нет (вариантов ${s.options.length})`);
      break;
    case 'order': {
      const miss = multisetSubset(s.answer, s.tiles);
      if (miss !== null) ctx.err('step', sub(w, 'answer'), `плитки "${miss}" из answer нет в tiles`);
      s.alt?.forEach((a, i) => {
        const m = multisetSubset(a, s.tiles);
        if (m !== null) ctx.err('step', sub(w, 'alt', i), `плитки "${m}" из alt нет в tiles`);
      });
      break;
    }
    case 'gap': {
      const n = s.text.split('___').length - 1;
      if (n !== 1) ctx.err('step', sub(w, 'text'), `в gap.text должен быть ровно один "___", а их ${n}`);
      if (s.options && !s.options.includes(s.answer))
        ctx.err('step', sub(w, 'answer'), `answer "${s.answer}" нет среди options`);
      break;
    }
    case 'stress':
      range(s.answer, s.syllables.length);
      if (s.syllables.join('').toLowerCase() !== s.word.toLowerCase())
        ctx.warn('step', sub(w, 'syllables'), `слоги "${s.syllables.join('·')}" не складываются в "${s.word}"`);
      break;
    case 'match':
      s.items?.forEach((id, i) => ctx.ref(ctx.vocab, id, sub(w, 'items', i), 'item', WHERE.vocab));
      if (s.items && s.items.length !== s.pairs.length)
        ctx.err('step', sub(w, 'items'), `items (${s.items.length}) не совпадает по длине с pairs (${s.pairs.length})`);
      break;
    case 'minimal_pair':
      if (s.pair[0] === s.pair[1]) ctx.err('step', sub(w, 'pair'), 'в минимальной паре одинаковые строки');
      break;
    default:
      break;
  }
}

function lessonSteps(l: Lesson): { step: Step; path: (string | number)[] }[] {
  if (l.steps) return l.steps.map((step, i) => ({ step, path: ['steps', i] }));
  return (l.parts ?? []).flatMap((p, pi) => p.steps.map((step, i) => ({ step, path: ['parts', pi, 'steps', i] })));
}

// ───────────────────────────── карты (§3.7) ─────────────────────────────

const chars = (s: string): string[] => Array.from(s);

function analyzeMap(ctx: Ctx, m: LocationMap, w: Where): boolean[][] {
  const [W, H] = m.size;
  let ok = true;
  const legendHas = (ch: string): boolean => Object.hasOwn(m.legend, ch);
  if (!legendHas(m.defaultGround)) {
    ctx.err('map', sub(w, 'defaultGround'), `defaultGround "${m.defaultGround}" нет в легенде`);
  }
  const checkLayer = (name: 'ground' | 'deco', rows: string[], blank: boolean): void => {
    if (rows.length !== H) {
      ctx.err('map', sub(w, 'layers', name), `строк ${rows.length}, а size[1] = ${H}`);
      ok = false;
    }
    rows.forEach((row, y) => {
      const cs = chars(row);
      if (cs.length !== W) {
        ctx.err('map', sub(w, 'layers', name, y), `длина строки ${cs.length}, а size[0] = ${W}`);
        ok = false;
      }
      const bad = [...new Set(cs.filter((c) => !(blank && c === ' ') && !legendHas(c)))];
      if (bad.length) {
        ctx.err('map', sub(w, 'layers', name, y), `символ(ы) ${bad.map((c) => `"${c}"`).join(', ')} нет в легенде`);
        ok = false;
      }
    });
  };
  checkLayer('ground', m.layers.ground, false);
  if (m.layers.deco) checkLayer('deco', m.layers.deco, true);
  if (!ok) return [];
  const solid = (c: string | undefined): boolean => c !== undefined && c !== ' ' && m.legend[c]?.solid === true;
  const grid: boolean[][] = [];
  for (let y = 0; y < H; y++) {
    const g = chars(m.layers.ground[y] ?? '');
    const d = m.layers.deco ? chars(m.layers.deco[y] ?? '') : [];
    const row: boolean[] = [];
    for (let x = 0; x < W; x++) row.push(!solid(g[x]) && !solid(d[x]));
    grid.push(row);
  }
  return grid;
}

function inBounds(m: LocationMap, [x, y]: number[], size: number[] = [1, 1]): boolean {
  const [W, H] = m.size;
  const [sw = 1, sh = 1] = size;
  return x !== undefined && y !== undefined && x + sw <= W && y + sh <= H;
}

const passableAt = (grid: boolean[][], [x, y]: number[]): boolean =>
  x !== undefined && y !== undefined && grid[y]?.[x] === true;

function checkMapObjects(ctx: Ctx, info: MapInfo, w: Where, strictLines: boolean): void {
  const m = info.map;
  const grid = info.passable;
  for (const [name, xy] of Object.entries(m.spawns)) {
    const sw = sub(w, 'spawns', name);
    if (!inBounds(m, xy)) ctx.err('map', sw, `спавн "${name}" [${xy.join(', ')}] за границами карты ${m.size.join('×')}`);
    else if (grid.length && !passableAt(grid, xy)) ctx.err('map', sw, `спавн "${name}" [${xy.join(', ')}] стоит на непроходимой клетке`);
  }
  m.objects.forEach((o, i) => {
    const ow = sub(w, 'objects', i);
    const size = 'size' in o && o.size ? o.size : [1, 1];
    if (!inBounds(m, o.at, size)) {
      ctx.err('map', sub(ow, 'at'), `объект ${o.type} [${o.at.join(', ')}] за границами карты ${m.size.join('×')}`);
      return;
    }
    if ('if' in o) walkCond(ctx, o.if, sub(ow, 'if'));
    switch (o.type) {
      case 'npc': {
        ctx.ref(ctx.characters, o.id, sub(ow, 'id'), 'npc', WHERE.characters);
        const [x, y] = o.at as [number, number];
        const near = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        if (grid.length && !near.some((c) => passableAt(grid, c)))
          ctx.err('map', sub(ow, 'at'), `к NPC "${o.id}" не подойти: все соседние клетки непроходимы`);
        break;
      }
      case 'exit': {
        if (o.to === 'worldmap') break;
        if (ctx.ref(ctx.maps, o.to, sub(ow, 'to'), 'exit.to', `${WHERE.maps} (или "worldmap")`) && o.spawn !== undefined) {
          const target = ctx.maps.get(o.to)?.value.map;
          if (target && !(o.spawn in target.spawns))
            ctx.err('ref', sub(ow, 'spawn'), `висячая ссылка exit.spawn "${o.spawn}": нет в spawns карты ${o.to}`);
        }
        break;
      }
      case 'trigger':
        walkEffects(ctx, o.do, sub(ow, 'do'), strictLines);
        break;
      case 'sign':
        ctx.ref(ctx.vocab, o.item, sub(ow, 'item'), 'sign.item', WHERE.vocab);
        break;
      case 'word':
        ctx.ref(ctx.vocab, o.item, sub(ow, 'item'), 'word.item', WHERE.vocab);
        break;
      default:
        break;
    }
  });
  // Связность (предупреждение): всё проходимое достижимо из spawns.default.
  const start = m.spawns.default;
  if (grid.length && start && passableAt(grid, start)) {
    const [W, H] = m.size;
    const seen = grid.map((r) => r.map(() => false));
    const q: [number, number][] = [[start[0] as number, start[1] as number]];
    seen[start[1] as number]![start[0] as number] = true;
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny]![nx] || !grid[ny]![nx]) continue;
        seen[ny]![nx] = true;
        q.push([nx, ny]);
      }
    }
    const lost: string[] = [];
    grid.forEach((r, y) => r.forEach((p, x) => p && !seen[y]![x] && lost.push(`[${x}, ${y}]`)));
    if (lost.length)
      ctx.warn('map-connect', sub(w, 'layers', 'ground'), `карта несвязна: из spawns.default не дойти до ${lost.length} клеток (${lost.slice(0, 5).join(' ')}${lost.length > 5 ? ' …' : ''})`);
  }
}

// ───────────────────────────── NFC ─────────────────────────────

function walkNfc(ctx: Ctx, v: unknown, w: Where): void {
  if (typeof v === 'string') {
    if (v !== v.normalize('NFC')) ctx.err('nfc', w, `строка ${show(v)} не в NFC (ТЗ §3.0)`);
  } else if (Array.isArray(v)) v.forEach((x, i) => walkNfc(ctx, x, sub(w, i)));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (k !== k.normalize('NFC')) ctx.err('nfc', sub(w, k), `ключ ${show(k)} не в NFC`);
      walkNfc(ctx, x, sub(w, k));
    }
}

// ───────────────────────────── главная функция ─────────────────────────────

const SECONDS_PER_STEP = 20;

/** Тексты модуля, которые должны быть озвучены (п. 6). Используется и I-09 для манифеста. */
/**
 * Строки, которые должны быть озвучены (ТЗ §7.1 п. 1). `unvoiced` — персонажи с `voice.engine: "none"`
 * (Дима и др.): их реплики не озвучиваются. Полный список с голосами и медленными версиями — tools/build_audio.py.
 */
export function voiceTexts(lessons: Lesson[], vocab: VocabEntry[], dialogues: Dialogue[], unvoiced: ReadonlySet<string> = new Set()): string[] {
  const out = new Set<string>();
  for (const v of vocab) out.add(v.pl);
  for (const l of lessons)
    for (const { step: s } of lessonSteps(l)) {
      if (s.t === 'say' && s.audio !== false && !unvoiced.has(s.who)) out.add(s.pl);
      if (s.t === 'shadow') out.add(s.pl);
      if ((s.t === 'listen' || s.t === 'dictation') && s.say) out.add(s.say);
      if ((s.t === 'order' || s.t === 'type' || s.t === 'gap') && s.say) out.add(s.say);
      if (s.t === 'minimal_pair') s.pair.forEach((p) => out.add(p));
      if (s.t === 'stress') out.add(s.word);
    }
  for (const d of dialogues) for (const n of Object.values(d.nodes)) if (n.pl && !unvoiced.has(n.who ?? '')) out.add(n.pl);
  return [...out].map((t) => t.normalize('NFC').trim());
}

export function checkContent(input: CheckInput): Issue[] {
  const ctx = new Ctx();
  const { files, schemas } = input;

  // 1. Классификация и схемы.
  const typed = new Map<string, { kind: FileKind; data: unknown }>();
  for (const [file, data] of files) {
    const kind = classify(file);
    if (!kind) {
      ctx.err('file', { file, path: '' }, 'неизвестный файл контента (ожидаются файлы из ТЗ §2.3)');
      continue;
    }
    const v = validatorFor(schemas, kind.schema);
    if (!v(data)) {
      ctx.issues.push(...schemaIssues(file, v.errors ?? [], data));
      continue;
    }
    walkNfc(ctx, data, { file, path: '' });
    typed.set(file, { kind, data });
  }
  for (const f of REQUIRED_FILES)
    if (!files.has(f)) ctx.err('file', { file: f, path: '' }, 'обязательный файл отсутствует');
  const moduleDirs = new Set([...files.keys()].map((f) => /^modules\/([^/]+)\//.exec(f)?.[1]).filter((x): x is string => !!x));
  for (const d of moduleDirs)
    if (!files.has(`modules/${d}/module.json`))
      ctx.err('file', { file: `modules/${d}/module.json`, path: '' }, `у модуля "${d}" нет module.json`);

  if (ctx.issues.some((i) => i.level === 'error')) {
    ctx.issues.push({
      level: 'warn',
      code: 'schema',
      file: '*',
      path: '',
      msg: 'ссылки и карты не проверялись: сначала исправь ошибки схем и файлов',
    });
    return ctx.issues;
  }

  const get = <T>(name: string): T | undefined => typed.get(name)?.data as T | undefined;
  const byKind = <T>(schema: SchemaName): { file: string; kind: FileKind; data: T }[] =>
    [...typed].filter(([, t]) => t.kind.schema === schema).map(([file, t]) => ({ file, kind: t.kind, data: t.data as T }));

  const world = get<World>('world.json')!;
  ctx.tuning = get<Tuning>('tuning.json') ?? null;

  // 2. Регистры и дубли (п. 2).
  (get<Character[]>('characters.json') ?? []).forEach((c, i) =>
    ctx.define(ctx.characters, 'character', c.id, { file: 'characters.json', path: `/${i}`, value: c }),
  );
  (get<Item[]>('items.json') ?? []).forEach((it, i) =>
    ctx.define(ctx.items, 'item', it.id, { file: 'items.json', path: `/${i}`, value: it }),
  );
  world.biomes.forEach((b, i) => ctx.define(ctx.biomes, 'biome', b.id, { file: 'world.json', path: `/biomes/${i}`, value: b }));
  const moduleStatus = new Map<string, Module['status']>();
  for (const { file, kind, data } of byKind<Module>('module')) {
    const w = { file, path: '' };
    if (data.id !== kind.module) ctx.err('id', sub(w, 'id'), `id модуля "${data.id}" не совпадает с папкой "${kind.module}"`);
    ctx.define(ctx.modules, 'module', data.id, { file, path: '', value: data, module: kind.module });
    moduleStatus.set(kind.module!, data.status);
  }
  const isReady = (mod: string | undefined): boolean => mod !== undefined && moduleStatus.get(mod) === 'ready';
  const vocabTags = new Set<string>();
  for (const { file, kind, data } of byKind<VocabEntry[]>('vocab'))
    data.forEach((v, i) => {
      ctx.define(ctx.vocab, 'lx', v.id, { file, path: `/${i}`, value: v, module: kind.module });
      v.tags?.forEach((t) => vocabTags.add(t));
    });
  for (const { file, kind, data } of byKind<Lesson[]>('lessons'))
    data.forEach((l, i) => {
      const w = { file, path: `/${i}` };
      if (!l.id.startsWith(`${kind.module}.`)) ctx.err('id', sub(w, 'id'), `id урока "${l.id}" должен начинаться с "${kind.module}."`);
      ctx.define(ctx.lessons, 'lesson', l.id, { ...w, value: l, module: kind.module });
    });
  for (const { file, kind, data } of byKind<Dialogue[]>('dialogues'))
    data.forEach((d, i) => {
      const w = { file, path: `/${i}` };
      if (!d.id.startsWith(`dlg.${kind.module}.`)) ctx.err('id', sub(w, 'id'), `id диалога "${d.id}" должен начинаться с "dlg.${kind.module}."`);
      ctx.define(ctx.dialogues, 'dlg', d.id, { ...w, value: d, module: kind.module });
    });
  for (const { file, kind, data } of byKind<LocationMap>('map')) {
    const w = { file, path: '' };
    const want = `${kind.module}.${kind.name}`;
    if (data.id !== want) ctx.err('id', sub(w, 'id'), `id карты "${data.id}" должен быть "${want}" (по пути файла)`);
    const info: MapInfo = {
      map: data,
      module: kind.module!,
      file,
      passable: analyzeMap(ctx, data, w),
      objectIds: new Set(),
      plots: new Set(),
      spots: new Set(),
    };
    data.objects.forEach((o, i) => {
      if (!('id' in o) || o.type === 'npc') return;
      if (info.objectIds.has(o.id)) ctx.err('dup', sub(w, 'objects', i, 'id'), `дубль id объекта "${o.id}" на карте ${data.id}`);
      info.objectIds.add(o.id);
      if (o.type === 'plot') info.plots.add(o.id);
      if (o.type === 'secret') {
        const spot = o.spot ?? o.id;
        info.spots.add(spot);
        ctx.define(ctx.spots, 'secret spot', spot, { file, path: `/objects/${i}`, value: { location: data.id } });
      }
    });
    ctx.define(ctx.maps, 'location', data.id, { file, path: '', value: info, module: kind.module });
  }
  const phon = get<Phonetics>('phonetics.json');
  phon?.clusters.forEach((c, i) => ctx.define(ctx.clusters, 'cluster', c.id, { file: 'phonetics.json', path: `/clusters/${i}`, value: c }));
  phon?.pairs.forEach((p, i) => ctx.define(ctx.pairs, 'mp', p.id, { file: 'phonetics.json', path: `/pairs/${i}`, value: p }));
  (get<ErrorTag[]>('errorTags.json') ?? []).forEach((t, i) =>
    ctx.define(ctx.errorTags, 'errorTag', t.id, { file: 'errorTags.json', path: `/${i}`, value: t }),
  );
  (get<Line[]>('story/lines.json') ?? []).forEach((l, i) =>
    ctx.define(ctx.lines, 'line', l.id, { file: 'story/lines.json', path: `/${i}`, value: l }),
  );
  const director = get<Director>('director.json');
  director?.beats.forEach((b, i) => ctx.define(ctx.beats, 'beat (флаг beat.<id>)', b.id, { file: 'director.json', path: `/beats/${i}`, value: b }));
  (get<Secret[]>('secrets.json') ?? []).forEach((s, i) =>
    ctx.define(ctx.secrets, 'secret', s.id, { file: 'secrets.json', path: `/${i}`, value: s }),
  );
  (get<Order[]>('orders.json') ?? []).forEach((o, i) => ctx.define(ctx.orders, 'order', o.id, { file: 'orders.json', path: `/${i}`, value: o }));
  (get<Recipe[]>('recipes.json') ?? []).forEach((r, i) =>
    ctx.define(ctx.recipes, 'recipe', r.id, { file: 'recipes.json', path: `/${i}`, value: r }),
  );

  // 3. Ссылки и правила по файлам.
  // world.json
  {
    const w = { file: 'world.json', path: '' };
    if (ctx.ref(ctx.maps, world.start.location, sub(w, 'start', 'location'), 'location', WHERE.maps)) {
      const m = ctx.maps.get(world.start.location)!.value.map;
      if (!(world.start.spawn in m.spawns))
        ctx.err('ref', sub(w, 'start', 'spawn'), `висячая ссылка start.spawn "${world.start.spawn}": нет в spawns карты ${m.id}`);
    }
    world.biomes.forEach((b, i) => {
      const bw = sub(w, 'biomes', i);
      b.locations.forEach((l, j) => ctx.ref(ctx.maps, l, sub(bw, 'locations', j), 'location', WHERE.maps));
      ctx.ref(ctx.maps, b.border, sub(bw, 'border'), 'location', WHERE.maps);
      b.modules?.forEach((m, j) => ctx.ref(ctx.modules, m, sub(bw, 'modules', j), 'модуль', WHERE.modules));
      b.hosts?.forEach((h, j) => ctx.ref(ctx.characters, h, sub(bw, 'hosts', j), 'host', WHERE.characters));
      walkCond(ctx, b.stages.visible, sub(bw, 'stages', 'visible'));
      walkCond(ctx, b.stages.preview, sub(bw, 'stages', 'preview'));
      walkCond(ctx, b.stages.stamp, sub(bw, 'stages', 'stamp'));
    });
  }

  // module.json
  const renamed = new Map<string, string>();
  for (const [id, def] of ctx.modules) {
    const m = def.value;
    const w = { file: def.file, path: '' };
    ctx.ref(ctx.characters, m.teacher, sub(w, 'teacher'), 'teacher', WHERE.characters);
    ctx.ref(ctx.biomes, m.biome, sub(w, 'biome'), 'biome', WHERE.biomes);
    walkCond(ctx, m.unlock.hard, sub(w, 'unlock', 'hard'));
    m.unlock.soft?.forEach((s, i) => walkCond(ctx, s.if, sub(w, 'unlock', 'soft', i, 'if')));
    m.lessons.forEach((l, i) => {
      const lw = sub(w, 'lessons', i);
      if (!ctx.ref(ctx.lessons, l, lw, 'lesson', WHERE.lessons)) return;
      const owner = ctx.lessons.get(l)!.module;
      if (owner !== id) ctx.err('ref', lw, `урок "${l}" определён в модуле "${owner}", а не "${id}"`);
    });
    if (m.boss !== undefined && ctx.ref(ctx.lessons, m.boss, sub(w, 'boss'), 'lesson', WHERE.lessons)) {
      if (!m.lessons.includes(m.boss)) ctx.err('ref', sub(w, 'boss'), `boss "${m.boss}" нет в module.lessons`);
      if (ctx.lessons.get(m.boss)!.value.kind !== 'boss') ctx.err('ref', sub(w, 'boss'), `урок "${m.boss}" не kind: boss`);
    }
    walkEffects(ctx, m.onComplete, sub(w, 'onComplete'), m.status === 'ready');
    for (const [from, to] of Object.entries(m.renames ?? {})) {
      ctx.ref(ctx.vocab, to, sub(w, 'renames', from), 'renames → слово', WHERE.vocab);
      renamed.set(from, to);
    }
  }

  // vocab.json
  for (const [, def] of ctx.vocab) {
    const v = def.value;
    const mod = def.module ? ctx.modules.get(def.module)?.value : undefined;
    if (mod?.kind === 'legacy') continue;
    if (v.tr === undefined) ctx.err('tr', def, `у слова ${v.id} нет tr (обязателен вне модулей kind: legacy, ТЗ §3.4)`);
    else if (v.tr.trim() === '') ctx.warn('tr', sub(def, 'tr'), `пустая транскрипция у ${v.id}`);
  }

  // lessons.json
  const maxIntro = ctx.tuning?.maxIntroducesPerLesson ?? 5;
  for (const [id, def] of ctx.lessons) {
    const l = def.value;
    const w = { file: def.file, path: def.path };
    const strict = isReady(def.module);
    if ((l.steps === undefined) === (l.parts === undefined))
      ctx.err('lesson', w, `у урока ${id} должно быть ровно одно из steps / parts`);
    if (def.module && !ctx.modules.get(def.module)?.value.lessons.includes(id))
      ctx.warn('orphan', sub(w, 'id'), `урок ${id} не перечислен в modules/${def.module}/module.json → lessons`);
    ctx.ref(ctx.characters, l.npc, sub(w, 'npc'), 'npc', WHERE.characters);
    ctx.ref(ctx.maps, l.location, sub(w, 'location'), 'location', WHERE.maps);
    l.warmup?.fromModules?.forEach((m, i) => ctx.ref(ctx.modules, m, sub(w, 'warmup', 'fromModules', i), 'модуль', WHERE.modules));
    walkCond(ctx, l.requires, sub(w, 'requires'));
    walkCond(ctx, l.skipIf, sub(w, 'skipIf'));
    walkEffects(ctx, l.reward, sub(w, 'reward'), strict);
    const intro = l.introduces ?? [];
    if (intro.length > maxIntro)
      ctx.err('introduces', sub(w, 'introduces'), `introduces: ${intro.length} слов, больше tuning.maxIntroducesPerLesson = ${maxIntro}`);
    intro.forEach((x, i) => {
      if (!ctx.ref(ctx.vocab, x, sub(w, 'introduces', i), 'introduces', WHERE.vocab)) return;
      if (ctx.vocab.get(x)!.value.srs !== true)
        ctx.err('introduces', sub(w, 'introduces', i), `слово ${x} в introduces, но у него не srs: true`);
    });
    const steps = lessonSteps(l);
    if (l.short) {
      walkCond(ctx, l.short.if, sub(w, 'short', 'if'));
      const n = l.steps?.length ?? 0;
      l.short.steps.forEach((k, i) => {
        if (k >= n) ctx.err('lesson', sub(w, 'short', 'steps', i), `short.steps: шага ${k} нет (шагов ${n})`);
      });
    }
    for (const { step, path } of steps) checkStep(ctx, step, sub(w, ...path), vocabTags);
    const estimate = steps.length * SECONDS_PER_STEP;
    if (estimate > l.minutes * 60 * 1.5)
      ctx.warn('long-lesson', sub(w, 'minutes'), `урок ${id}: ${steps.length} шагов ≈ ${Math.round(estimate / 60)} мин, больше minutes × 1.5 = ${l.minutes * 1.5}`);
  }

  // dialogues.json
  const todoNodes: { id: string; file: string }[] = [];
  for (const [id, def] of ctx.dialogues) {
    const d = def.value;
    const w = { file: def.file, path: def.path };
    const strict = isReady(def.module);
    ctx.ref(ctx.characters, d.npc, sub(w, 'npc'), 'npc', WHERE.characters);
    walkCond(ctx, d.if, sub(w, 'if'));
    const nodes = d.nodes;
    if (!Object.hasOwn(nodes, d.start)) ctx.err('dialogue', sub(w, 'start'), `start "${d.start}": такого узла нет`);
    const ends = new Set<string>();
    for (const [key, n] of Object.entries(nodes)) {
      const nw = sub(w, 'nodes', key);
      ctx.ref(ctx.characters, n.who, sub(nw, 'who'), 'who', WHERE.characters);
      // I-11: who обязателен там, где кто-то говорит; узел line берёт говорящего из реплики; чистый end — без who.
      if (n.who === undefined && (n.pl !== undefined || n.choices !== undefined || n.todo === true))
        ctx.err('dialogue', nw, `у узла "${key}" с pl, choices или todo нет who`);
      if (n.line !== undefined) {
        if (n.pl !== undefined || n.todo === true) ctx.err('dialogue', nw, `у узла "${key}" line вместе с pl или todo: оставь одно`);
        ctx.line(n.line, sub(nw, 'line'), strict);
      }
      if (n.todo === true && n.pl !== undefined) ctx.err('dialogue', nw, `у узла "${key}" и pl, и todo: реплика или есть, или нет`);
      if (n.todo === true) {
        if (strict) ctx.err('todo', nw, `узел "${key}" ещё todo, а модуль status: ready`);
        else todoNodes.push({ id: `${id}.${key}`, file: def.file });
      }
      const kinds = [n.next !== undefined, n.choices !== undefined, n.end === true].filter(Boolean).length;
      if (kinds !== 1) ctx.err('dialogue', nw, `у узла "${key}" должно быть ровно одно из next / choices / end (сейчас ${kinds})`);
      if (n.lesson !== undefined) {
        ctx.ref(ctx.lessons, n.lesson, sub(nw, 'lesson'), 'lesson', WHERE.lessons);
        if (n.next === undefined) ctx.err('dialogue', nw, `узел "${key}" с lesson должен иметь next (куда идти после урока)`);
      }
      walkEffects(ctx, n.do, sub(nw, 'do'), strict);
      if (n.next !== undefined && !Object.hasOwn(nodes, n.next))
        ctx.err('dialogue', sub(nw, 'next'), `next "${n.next}": такого узла нет`);
      n.choices?.forEach((c, i) => {
        const cw = sub(nw, 'choices', i);
        if (!Object.hasOwn(nodes, c.next)) ctx.err('dialogue', sub(cw, 'next'), `next "${c.next}": такого узла нет`);
        walkCond(ctx, c.if, sub(cw, 'if'));
        walkEffects(ctx, c.do, sub(cw, 'do'), strict);
      });
      if (n.end === true) ends.add(key);
    }
    if (Object.hasOwn(nodes, d.start)) {
      const seen = new Set<string>([d.start]);
      const q = [d.start];
      while (q.length) {
        const n = nodes[q.shift()!]!;
        for (const nx of [n.next, ...(n.choices ?? []).map((c) => c.next)])
          if (nx !== undefined && Object.hasOwn(nodes, nx) && !seen.has(nx)) {
            seen.add(nx);
            q.push(nx);
          }
      }
      if (![...seen].some((k) => ends.has(k))) ctx.err('dialogue', sub(w, 'start'), `диалог ${id}: из start "${d.start}" не достижим ни один end`);
      for (const k of Object.keys(nodes))
        if (!seen.has(k)) ctx.warn('orphan', sub(w, 'nodes', k), `узел "${k}" недостижим из start`);
    }
  }

  if (todoNodes.length)
    ctx.warn('todo', { file: todoNodes[0]!.file, path: '' }, `${todoNodes.length} узлов диалогов с todo: true (${todoNodes.slice(0, 6).map((x) => x.id).join(', ')}${todoNodes.length > 6 ? ', …' : ''})`);

  // maps
  for (const [, def] of ctx.maps) checkMapObjects(ctx, def.value, { file: def.file, path: '' }, isReady(def.module));

  // phonetics.json, errorTags.json
  phon?.clusters.forEach((c, i) =>
    ctx.ref(ctx.lessons, c.repairLesson, { file: 'phonetics.json', path: `/clusters/${i}/repairLesson` }, 'repairLesson', WHERE.lessons),
  );
  (get<ErrorTag[]>('errorTags.json') ?? []).forEach((t, i) =>
    ctx.ref(ctx.lessons, t.remedy, { file: 'errorTags.json', path: `/${i}/remedy` }, 'remedy', WHERE.lessons),
  );

  // story/lines.json
  for (const [, def] of ctx.lines) ctx.ref(ctx.characters, def.value.who, sub(def, 'who'), 'who', WHERE.characters);

  // director.json
  if (director) {
    const w = { file: 'director.json', path: '' };
    director.beats.forEach((b, i) => {
      const bw = sub(w, 'beats', i);
      walkCond(ctx, b.if, sub(bw, 'if'));
      const tw = sub(bw, 'target');
      let strict = false;
      if (ctx.ref(ctx.maps, b.target.location, sub(tw, 'location'), 'location', WHERE.maps)) {
        const info = ctx.maps.get(b.target.location)!.value;
        strict = isReady(info.module);
        if (b.target.object !== undefined && !info.objectIds.has(b.target.object))
          ctx.err('ref', sub(tw, 'object'), `висячая ссылка target.object "${b.target.object}": нет среди объектов карты ${info.map.id}`);
        if (b.target.plot !== undefined && !info.plots.has(b.target.plot))
          ctx.err('ref', sub(tw, 'plot'), `висячая ссылка target.plot "${b.target.plot}": нет среди грядок карты ${info.map.id}`);
      }
      ctx.ref(ctx.characters, b.target.npc, sub(tw, 'npc'), 'npc', WHERE.characters);
      ctx.line(b.line, sub(bw, 'line'), strict);
      walkEffects(ctx, b.do, sub(bw, 'do'), strict);
    });
    director.reveals.forEach((r, i) => {
      walkCond(ctx, r.if, sub(w, 'reveals', i, 'if'));
      ctx.line(r.line, sub(w, 'reveals', i, 'line'));
    });
    ctx.line(director.spring?.line, sub(w, 'spring', 'line'));
    ctx.line(director.done?.line, sub(w, 'done', 'line'));
    ctx.line(director.done?.more3Line, sub(w, 'done', 'more3Line'));
  }

  // secrets.json
  for (const [id, def] of ctx.secrets) {
    const s = def.value;
    const w = { file: def.file, path: def.path };
    const ch = ctx.characters.get(id);
    if (!ch) ctx.err('ref', sub(w, 'id'), `висячая ссылка secret "${id}": нет в ${WHERE.characters}`);
    else if (ch.value.kind !== 'secret') ctx.err('ref', sub(w, 'id'), `персонаж "${id}" не kind: secret`);
    s.spots.forEach((sp, i) => {
      const sw = sub(w, 'spots', i);
      walkCond(ctx, sp.if, sub(sw, 'if'));
      if (!ctx.ref(ctx.maps, sp.location, sub(sw, 'location'), 'location', WHERE.maps)) return;
      const info = ctx.maps.get(sp.location)!.value;
      if (!info.spots.has(sp.spot))
        ctx.err('secret-spot', sub(sw, 'spot'), `точки "${sp.spot}" нет среди объектов secret на карте ${sp.location}`);
    });
    walkEffects(ctx, s.onFound, sub(w, 'onFound'));
    ctx.line(s.line, sub(w, 'line'));
  }

  // orders.json
  for (const [, def] of ctx.orders) {
    const o = def.value;
    const w = { file: def.file, path: def.path };
    ctx.ref(ctx.characters, o.npc, sub(w, 'npc'), 'orders.npc', WHERE.characters);
    walkCond(ctx, o.if, sub(w, 'if'));
    if (o.delivery?.location !== undefined)
      ctx.ref(ctx.maps, o.delivery.location, sub(w, 'delivery', 'location'), 'location', WHERE.maps);
    if (o.phrase?.answer && o.phrase.tiles) {
      const miss = multisetSubset(o.phrase.answer, o.phrase.tiles);
      if (miss !== null) ctx.err('step', sub(w, 'phrase', 'answer'), `плитки "${miss}" из phrase.answer нет в phrase.tiles`);
    }
    if (o.build === 'phrase' && !o.phrase) ctx.err('step', sub(w, 'phrase'), 'build: phrase требует phrase.tiles и phrase.answer');
  }

  // recipes.json
  const perRecipe = ctx.tuning?.kitchen.jarsPerRecipe ?? 3;
  for (const [id, def] of ctx.recipes) {
    const r = def.value;
    const sum = r.needs.reduce((a, n) => a + n.count, 0);
    if (sum !== perRecipe)
      ctx.err('recipe-sum', sub(def, 'needs'), `рецепт ${id}: сумма needs[].count = ${sum}, а tuning.kitchen.jarsPerRecipe = ${perRecipe}`);
    ctx.line(r.line, sub(def, 'line'));
  }

  checkWords(ctx);

  // Реплики (п. 8) и todo.
  for (const r of ctx.lineRefs) {
    const l = ctx.lines.get(r.id);
    if (!l) {
      ctx.err('line', r.w, `реплики "${r.id}" нет в story/lines.json (перенеси из ../СЮЖЕТ.md или поставь заглушку с todo: true)`);
      continue;
    }
    if (l.value.todo && r.strict) ctx.err('todo', r.w, `реплика "${r.id}" ещё todo, а модуль status: ready`);
  }
  const todo = [...ctx.lines.values()].filter((l) => l.value.todo);
  if (todo.length)
    ctx.warn('todo', { file: 'story/lines.json', path: '' }, `${todo.length} реплик с todo: true (${todo.slice(0, 6).map((l) => l.value.id).join(', ')}${todo.length > 6 ? ', …' : ''})`);

  // Бит первого дня (P-01): реплики вступления и переходов, диалоги диагностики и ремонтных сцен.
  const firstDay = firstDayTodos(ctx, director);
  if (firstDay.length) {
    const ids = firstDay.map((x) => x.id);
    if (input.release) for (const x of firstDay) ctx.err('todo', x.w, `первый день: ${x.why} "${x.id}" ещё todo, а сборка release`);
    else ctx.warn('todo', { file: 'story/lines.json', path: '' }, `первый день: ${ids.length} заглушек todo (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}); сборка с PQ_RELEASE=1 упадёт`);
  }

  // п. 6: озвучка. Есть ли для строки запись в манифесте (любым голосом); файлы и голоса сверяет
  // `npm run audio:check`. ready без озвучки = ошибка, draft = одно предупреждение на модуль.
  const unvoiced = new Set([...ctx.characters].filter(([, c]) => c.value.voice.engine === 'none').map(([cid]) => cid));
  const manifest = input.audioManifest;
  const voiced = new Set<string>();
  const entries = manifest && typeof manifest === 'object' ? (manifest as { entries?: unknown }).entries : undefined;
  if (entries && typeof entries === 'object')
    for (const key of Object.keys(entries)) voiced.add(key.split('|').slice(2).join('|'));
  for (const [id, def] of ctx.modules) {
    const texts = voiceTexts(
      [...ctx.lessons.values()].filter((l) => l.module === id).map((l) => l.value),
      [...ctx.vocab.values()].filter((v) => v.module === id).map((v) => v.value),
      [...ctx.dialogues.values()].filter((d) => d.module === id).map((d) => d.value),
      unvoiced,
    );
    const w = { file: def.file, path: '/status' };
    const status = def.value.status;
    if (manifest === undefined || manifest === null) {
      ctx.warn('audio', w, `озвучка не проверена: нет public/audio/manifest.json (${texts.length} строк, модуль ${status}); запусти npm run audio`);
      continue;
    }
    const missing = texts.filter((t) => !voiced.has(t));
    if (!missing.length) continue;
    const list = `${missing.slice(0, 5).map((t) => `"${t}"`).join(', ')}${missing.length > 5 ? ', …' : ''}`;
    const msg = `не озвучено ${missing.length} из ${texts.length} строк (${list}): npm run audio на Mac`;
    if (status === 'ready') ctx.err('audio', w, `модуль ready: ${msg}`);
    else ctx.warn('audio', w, msg);
  }

  // п. 7: удалённые id слов.
  if (input.prevVocab) {
    for (const [id, prevFile] of input.prevVocab) {
      if (ctx.vocab.has(id) || renamed.has(id)) continue;
      ctx.err('vocab-removed', { file: prevFile, path: '' }, `слово ${id} удалено из vocab.json: id удалять нельзя, переименование только через module.renames { "${id}": "lx.новый" }`);
    }
  }

  return ctx.issues;
}

export const errorsOf = (issues: Issue[]): Issue[] => issues.filter((i) => i.level === 'error');

/**
 * Заглушки бита первого дня (§5.0 F1–F6): реплики FIRST_DAY_LINES и `director.done`, а в диалогах, которые
 * запускают диагностику (`kind: diag`) или ремонтную сцену кластера (`phonetics.clusters[].repairLesson`), —
 * узлы `todo: true` и ссылки на todo-реплики (узел `line`, эффекты `line` узла и вариантов).
 */
/** Слова варианта и реплики (P-07): `words` ссылается на vocab, форма стоит в строке; ≤ 2 варианта; NPC без русской речи. */
function checkWords(ctx: Ctx): void {
  let index: WordIndex | null = null;
  const idx = (): WordIndex => (index ??= buildWordIndex([...ctx.vocab.values()].map((d) => d.value)));
  const words = (refs: Line['words'], texts: (string | undefined)[], w: Where): void => {
    if (!refs) return;
    const text = texts.filter(Boolean).join(' \n ');
    refs.forEach((r, i) => {
      const lx = refIds([r])[0]!;
      const rw = sub(w, 'words', i);
      if (!ctx.ref(ctx.vocab, lx, typeof r === 'string' ? rw : sub(rw, 'lx'), 'words', WHERE.vocab)) return;
      const hit = matchWords(text, idx(), { refs: [r] }).some((s) => s.lx === lx && s.marked);
      if (!hit) ctx.warn('words', rw, `слово ${typeof r === 'string' ? lx : `«${r.pl}»`} не найдено в строке «${text.replace(/ \n /g, ' / ')}»${typeof r === 'string' ? ' (форма не из pl/forms: запиши {"pl": "<как в строке>", "lx": "' + lx + '"})' : ''}`);
    });
  };
  for (const [, def] of ctx.dialogues) {
    const w = { file: def.file, path: def.path };
    for (const [key, n] of Object.entries(def.value.nodes)) {
      const nw = sub(w, 'nodes', key);
      words(n.words, [n.pl], nw);
      n.choices?.forEach((c, i) => words(c.words, [c.pl], sub(nw, 'choices', i)));
      if ((n.choices?.length ?? 0) > 2)
        ctx.warn('dialogue', sub(nw, 'choices'), `у узла "${key}" ${n.choices!.length} варианта: на экране только 2 (research/05 §6б п. 8), остальные не покажутся`);
      // Польские NPC по-русски не говорят (ПОЛИРОВКА §2.7): ru узла — перевод pl, без pl это русская речь.
      const kind = n.who ? ctx.characters.get(n.who)?.value.kind : undefined;
      if (n.ru && !n.pl && n.who && n.who !== 'narrator' && kind !== 'companion')
        ctx.warn('dialogue', sub(nw, 'ru'), `${n.who} говорит по-русски без pl: польские NPC говорят только по-польски с подписью`);
    }
  }
  for (const [, def] of ctx.lines) {
    const l = def.value;
    words(l.words, [l.pl, l.ru], def);
    const kind = ctx.characters.get(l.who)?.value.kind;
    if (l.ru && l.who !== 'narrator' && kind !== 'companion' && kind !== 'player')
      ctx.warn('line', sub(def, 'ru'), `${l.who} говорит по-русски (ru): польские NPC говорят только по-польски, перевод — в plRu`);
  }
}

function firstDayTodos(ctx: Ctx, director: Director | undefined): { id: string; why: string; w: Where }[] {
  const out: { id: string; why: string; w: Where }[] = [];
  const seen = new Set<string>();
  const line = (id: string | undefined, w: Where): void => {
    if (id === undefined || seen.has(id)) return;
    const l = ctx.lines.get(id);
    if (l && !l.value.todo) return;
    seen.add(id);
    out.push({ id, why: l ? 'реплика' : 'нет реплики', w: l ? { file: l.file, path: l.path } : w });
  };
  const dw = { file: 'director.json', path: '' };
  for (const id of FIRST_DAY_LINES) line(id, dw);
  line(director?.done?.line, sub(dw, 'done', 'line'));
  line(director?.done?.more3Line, sub(dw, 'done', 'more3Line'));

  const lessons = new Set<string>();
  for (const [id, l] of ctx.lessons) if (l.value.kind === 'diag') lessons.add(id);
  for (const [, c] of ctx.clusters) {
    const r = (c.value as { repairLesson?: string }).repairLesson;
    if (r) lessons.add(r);
  }
  const effLines = (effs: Effect[] | undefined, w: Where): void => (effs ?? []).forEach((e, i) => line(e.line, sub(w, i, 'line')));
  const starts = (effs: Effect[] | undefined): boolean => (effs ?? []).some((e) => e.startLesson !== undefined && lessons.has(e.startLesson));
  for (const [id, def] of ctx.dialogues) {
    const nodes = Object.entries(def.value.nodes);
    if (!nodes.some(([, n]) => (n.lesson !== undefined && lessons.has(n.lesson)) || starts(n.do) || (n.choices ?? []).some((c) => starts(c.do)))) continue;
    for (const [key, n] of nodes) {
      const nw = sub(def, 'nodes', key);
      if (n.todo === true && !seen.has(`${id}.${key}`)) {
        seen.add(`${id}.${key}`);
        out.push({ id: `${id}.${key}`, why: 'узел диалога', w: nw });
      }
      line(n.line, sub(nw, 'line'));
      effLines(n.do, sub(nw, 'do'));
      (n.choices ?? []).forEach((c, i) => effLines(c.do, sub(nw, 'choices', i, 'do')));
    }
  }
  return out;
}
