// Валидатор контента (ТЗ §3.13): валидная фикстура проходит, каждая поломка ловится отдельным тестом
// с понятным сообщением. Поломки делаются мутацией копии tests/fixtures/content-mini в памяти;
// несколько сценариев прогоняются через CLI на временной копии фикстуры.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildContent, ContentError, getContent } from '../src/systems/content';
import type {
  Character,
  Dialogue,
  Director,
  ErrorTag,
  Item,
  Lesson,
  Line,
  LocationMap,
  Module,
  Order,
  Phonetics,
  Recipe,
  Secret,
  StepChoice,
  Tuning,
  VocabEntry,
  World,
} from '../src/types/content';
import { generate, TYPES_FILE } from '../tools/gen_types';
import { checkContent, errorsOf, formatIssue, voiceTexts, type CheckInput, type Issue, type IssueCode } from '../tools/lib/content_check';
import { readContentDir, readSchemas, validateDir, vocabIds } from '../tools/lib/content_io';
import { ROOT } from '../tools/lib/files';

const FIXTURE = join(ROOT, 'tests', 'fixtures', 'content-mini');
const schemas = readSchemas();
const base = readContentDir(FIXTURE).files;

type Files = Map<string, unknown>;
const D = 'modules/demo/';
const get = <T>(files: Files, name: string): T => {
  if (!files.has(name)) throw new Error(`в фикстуре нет ${name}`);
  return files.get(name) as T;
};
const fx = {
  world: (f: Files) => get<World>(f, 'world.json'),
  characters: (f: Files) => get<Character[]>(f, 'characters.json'),
  items: (f: Files) => get<Item[]>(f, 'items.json'),
  tuning: (f: Files) => get<Tuning>(f, 'tuning.json'),
  director: (f: Files) => get<Director>(f, 'director.json'),
  lines: (f: Files) => get<Line[]>(f, 'story/lines.json'),
  secrets: (f: Files) => get<Secret[]>(f, 'secrets.json'),
  orders: (f: Files) => get<Order[]>(f, 'orders.json'),
  recipes: (f: Files) => get<Recipe[]>(f, 'recipes.json'),
  phonetics: (f: Files) => get<Phonetics>(f, 'phonetics.json'),
  errorTags: (f: Files) => get<ErrorTag[]>(f, 'errorTags.json'),
  module: (f: Files) => get<Module>(f, `${D}module.json`),
  vocab: (f: Files) => get<VocabEntry[]>(f, `${D}vocab.json`),
  lessons: (f: Files) => get<Lesson[]>(f, `${D}lessons.json`),
  s01: (f: Files) => get<Lesson[]>(f, `${D}lessons.json`)[0]!,
  boss: (f: Files) => get<Lesson[]>(f, `${D}lessons.json`)[1]!,
  dialogue: (f: Files) => get<Dialogue[]>(f, `${D}dialogues.json`)[0]!,
  kawiarnia: (f: Files) => get<LocationMap>(f, `${D}maps/kawiarnia.json`),
  ogrod: (f: Files) => get<LocationMap>(f, `${D}maps/ogrod.json`),
};

/** Глубокая копия фикстуры → мутация → проверка. */
function run(mutate?: (f: Files) => void, extra: Partial<CheckInput> = {}): Issue[] {
  const files: Files = new Map([...base].map(([k, v]) => [k, structuredClone(v)]));
  mutate?.(files);
  return checkContent({ files, schemas, ...extra });
}

const dump = (issues: Issue[]): string => issues.map((i) => formatIssue(i)).join('\n') || '(пусто)';

/** Ожидаем ошибку с кодом и текстом (и, если задан, в нужном файле). */
function expectIssue(issues: Issue[], code: IssueCode, re: RegExp, file?: string, level: Issue['level'] = 'error'): Issue {
  const hit = issues.find((i) => i.level === level && i.code === code && re.test(i.msg) && (!file || i.file === file));
  expect(hit, `ожидалась ${level} ${code} ${String(re)}${file ? ` в ${file}` : ''}, а есть:\n${dump(issues)}`).toBeDefined();
  return hit!;
}

const at = <T>(xs: T[], i: number): T => {
  const x = xs[i];
  if (x === undefined) throw new Error(`нет элемента ${i}`);
  return x;
};

// ───────────────────────── валидный контент ─────────────────────────

describe('валидный контент', () => {
  it('фикстура content-mini проходит без ошибок', () => {
    const issues = run();
    expect(errorsOf(issues), dump(issues)).toEqual([]);
  });

  it('content/ репозитория проходит без ошибок', () => {
    const { issues } = validateDir();
    expect(errorsOf(issues), dump(issues)).toEqual([]);
  });

  it('src/types/content.d.ts совпадает с перегенерацией из схем (npm run gen:types)', async () => {
    expect(readFileSync(TYPES_FILE, 'utf8')).toBe(await generate());
  });
});

// ───────────────────────── п. 1: схемы ─────────────────────────

describe('п. 1: нарушение схемы', () => {
  it('нет обязательного поля', () => {
    const i = expectIssue(run((f) => delete (at(fx.vocab(f), 0) as Partial<VocabEntry>).pos), 'schema', /нет обязательного поля "pos"/);
    expect(i.file).toBe(`${D}vocab.json`);
    expect(i.path).toBe('/0');
  });
  it('лишнее поле', () => {
    expectIssue(run((f) => Object.assign(fx.s01(f), { color: 'red' })), 'schema', /лишнее поле "color"/);
  });
  it('значение не из списка', () => {
    expectIssue(run((f) => Object.assign(fx.s01(f), { kind: 'lecture' })), 'schema', /"lecture" не из списка: scene, repair/);
  });
  it('неизвестный тип шага', () => {
    expectIssue(run((f) => fx.s01(f).steps!.push({ t: 'quiz' } as never)), 'schema', /неизвестный тип "quiz" в поле "t"/);
  });
  it('неизвестный тип объекта карты', () => {
    expectIssue(run((f) => fx.ogrod(f).objects.push({ type: 'tree', at: [1, 1] } as never)), 'schema', /неизвестный тип "tree" в поле "type"/);
  });
  it('неизвестный атом условия и два атома в одном объекте', () => {
    expectIssue(run((f) => (fx.s01(f).skipIf = { weather: 'rain' } as never)), 'schema', /неизвестный атом условия "weather"/);
    expectIssue(run((f) => (fx.s01(f).skipIf = { always: true, daysPlayed: 1 })), 'schema', /ровно один ключ/);
  });
  it('неизвестный эффект (złoty напрямую запрещены)', () => {
    expectIssue(run((f) => fx.s01(f).reward!.push({ zloty: 10 } as never)), 'schema', /неизвестный атом эффекта "zloty"/);
  });
  it('id не по шаблону', () => {
    expectIssue(run((f) => (at(fx.vocab(f), 0).id = 'maly')), 'schema', /"maly" не подходит под шаблон/);
  });
  it('реплика без ru, без pl и без todo (I-11: достаточно pl, plRu — перевод)', () => {
    expectIssue(run((f) => delete at(fx.lines(f), 0).todo), 'schema', /не подходит ни под один из вариантов/);
    expect(errorsOf(run((f) => Object.assign(at(fx.lines(f), 0), { todo: false, pl: 'Ja wysiadam.', plRu: 'Я выхожу.' })))).toEqual([]);
    expect(errorsOf(run((f) => Object.assign(at(fx.lines(f), 0), { todo: false, ru: 'Только по-русски.' })))).toEqual([]);
  });
  it('битый JSON, неизвестный и отсутствующий файл', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pq-json-'));
    try {
      writeFileSync(join(tmp, 'world.json'), '{ "schema": 1, ');
      expect(readContentDir(tmp).issues[0]).toMatchObject({ code: 'json', file: 'world.json' });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    expectIssue(run((f) => f.set('npc.json', [])), 'file', /неизвестный файл контента/);
    expectIssue(run((f) => f.delete('tuning.json')), 'file', /обязательный файл отсутствует/, 'tuning.json');
    expectIssue(run((f) => f.delete(`${D}module.json`)), 'file', /нет module.json/);
  });
  it('строка не в NFC', () => {
    expectIssue(run((f) => (at(fx.vocab(f), 2).pl = 'sto\u0301ł')), 'nfc', /не в NFC/);
  });
  it('при ошибках схемы ссылки не проверяются (без лавины)', () => {
    const issues = run((f) => Object.assign(fx.module(f), { extra: 1 }));
    expect(issues.filter((i) => i.code === 'ref')).toEqual([]);
    expectIssue(issues, 'schema', /ссылки и карты не проверялись/, undefined, 'warn');
  });
});

// ───────────────────────── п. 2: дубли ─────────────────────────

describe('п. 2: дубль id в своём пространстве', () => {
  const cases: [string, (f: Files) => void, RegExp][] = [
    ['lx', (f) => fx.vocab(f).push(structuredClone(at(fx.vocab(f), 0))), /дубль id lx "lx.maly"/],
    ['lx в другом модуле', (f) => {
      f.set('modules/other/module.json', { ...structuredClone(fx.module(f)), id: 'other', lessons: ['other.a'], boss: undefined, renames: undefined });
      f.set('modules/other/lessons.json', [{ id: 'other.a', kind: 'practice', title: { ru: 'a' }, minutes: 1, steps: [{ t: 'explain', md: 'x' }] }]);
      f.set('modules/other/vocab.json', [structuredClone(at(fx.vocab(f), 3))]);
    }, /дубль id lx "lx.kawa": уже определён в modules\/demo\/vocab.json/],
    ['mp', (f) => fx.phonetics(f).pairs.push(structuredClone(at(fx.phonetics(f).pairs, 0))), /дубль id mp "mp.lata_lata"/],
    ['lesson', (f) => fx.lessons(f).push({ ...structuredClone(fx.boss(f)), id: 'demo.s01' }), /дубль id lesson "demo.s01"/],
    ['dlg', (f) => get<Dialogue[]>(f, `${D}dialogues.json`).push(structuredClone(fx.dialogue(f))), /дубль id dlg "dlg.demo.marek"/],
    ['location', (f) => f.set(`${D}maps/copy.json`, structuredClone(fx.ogrod(f))), /дубль id location "demo.ogrod"/],
    ['character', (f) => fx.characters(f).push(structuredClone(at(fx.characters(f), 1))), /дубль id character "bobr"/],
    ['item', (f) => fx.items(f).push(structuredClone(at(fx.items(f), 0))), /дубль id item "it.bilet"/],
    ['beat (флаг-производитель)', (f) => fx.director(f).beats.push({ ...structuredClone(at(fx.director(f).beats, 1)) , id: 'bobr_meets' }), /дубль id beat .* "bobr_meets"/],
    ['line', (f) => fx.lines(f).push(structuredClone(at(fx.lines(f), 0))), /дубль id line "bobr.meets"/],
    ['secret spot', (f) => fx.kawiarnia(f).objects.push({ type: 'secret', id: 'okno2', at: [1, 1], spot: 'ogrod_okno' }), /дубль id secret spot "ogrod_okno"/],
    ['объект на карте', (f) => fx.ogrod(f).objects.push({ type: 'plot', id: 'grzadki', at: [1, 4], size: [1, 1] }), /дубль id объекта "grzadki"/],
    ['order', (f) => fx.orders(f).push(structuredClone(at(fx.orders(f), 0))), /дубль id order "ord.kawa"/],
    ['recipe', (f) => fx.recipes(f).push(structuredClone(at(fx.recipes(f), 0))), /дубль id recipe "rec.demo"/],
    ['errorTag', (f) => fx.errorTags(f).push(structuredClone(at(fx.errorTags(f), 0))), /дубль id errorTag "ff.stol"/],
  ];
  it.each(cases)('%s', (_name, mutate, re) => {
    expectIssue(run(mutate), 'dup', re);
  });
  it('id урока, диалога и карты привязаны к модулю', () => {
    expectIssue(run((f) => (fx.boss(f).id = 'other.boss')), 'id', /должен начинаться с "demo."/);
    expectIssue(run((f) => (fx.dialogue(f).id = 'dlg.other.marek')), 'id', /должен начинаться с "dlg.demo."/);
    expectIssue(run((f) => (fx.ogrod(f).id = 'demo.sad')), 'id', /должен быть "demo.ogrod"/);
  });
});

// ───────────────────────── п. 3: висячие ссылки ─────────────────────────

describe('п. 3: висячая ссылка', () => {
  const cases: [string, (f: Files) => void, RegExp][] = [
    ['npc', (f) => (fx.s01(f).npc = 'nikt'), /висячая ссылка npc "nikt"/],
    ['npc на карте', (f) => fx.ogrod(f).objects.push({ type: 'npc', id: 'nikt', at: [6, 4] }), /висячая ссылка npc "nikt"/],
    ['who в шаге', (f) => Object.assign(at(fx.s01(f).steps!, 5), { who: 'nikt' }), /висячая ссылка who "nikt"/],
    ['who в диалоге', (f) => (fx.dialogue(f).nodes.a!.who = 'nikt'), /висячая ссылка who "nikt"/],
    ['item (lx)', (f) => (at(fx.s01(f).steps!, 2).item = 'lx.nie_ma'), /висячая ссылка item "lx.nie_ma"/],
    ['item (mp)', (f) => (at(fx.s01(f).steps!, 1).item = 'mp.nie_ma'), /висячая ссылка item "mp.nie_ma"/],
    ['lesson в диалоге', (f) => (fx.dialogue(f).nodes.b!.lesson = 'demo.nie_ma'), /висячая ссылка lesson "demo.nie_ma"/],
    ['lesson в module.lessons', (f) => fx.module(f).lessons.push('demo.nie_ma'), /висячая ссылка lesson "demo.nie_ma"/],
    ['location', (f) => (fx.s01(f).location = 'demo.nie_ma'), /висячая ссылка location "demo.nie_ma"/],
    ['exit.to', (f) => Object.assign(fx.ogrod(f).objects.find((o) => o.type === 'exit')!, { to: 'demo.nie_ma' }), /висячая ссылка exit.to "demo.nie_ma"/],
    ['exit.spawn', (f) => Object.assign(fx.ogrod(f).objects.find((o) => o.type === 'exit')!, { spawn: 'nie_ma' }), /висячая ссылка exit.spawn "nie_ma"/],
    ['startLesson', (f) => (fx.dialogue(f).nodes.c!.do = [{ startLesson: 'demo.nie_ma' }]), /висячая ссылка startLesson "demo.nie_ma"/],
    ['startDialogue', (f) => Object.assign(fx.kawiarnia(f).objects.find((o) => o.type === 'trigger')!, { do: [{ startDialogue: 'dlg.demo.nie_ma' }] }), /висячая ссылка startDialogue "dlg.demo.nie_ma"/],
    ['teleport.to', (f) => (fx.s01(f).reward = [{ teleport: { to: 'demo.nie_ma' } }]), /висячая ссылка teleport.to "demo.nie_ma"/],
    ['teleport.spawn', (f) => (fx.s01(f).reward = [{ teleport: { to: 'demo.ogrod', spawn: 'nie_ma' } }]), /висячая ссылка teleport.spawn "nie_ma"/],
    ['give', (f) => (fx.module(f).onComplete = [{ give: 'it.nie_ma' }]), /висячая ссылка give "it.nie_ma"/],
    ['item в условии', (f) => (fx.module(f).unlock.hard = { item: 'it.nie_ma' }), /висячая ссылка item "it.nie_ma"/],
    ['bossPassed', (f) => (fx.world(f).biomes[0].stages.stamp = { bossPassed: 'demo.nie_ma' }), /висячая ссылка bossPassed "demo.nie_ma"/],
    ['bossPassed не на босса', (f) => (fx.world(f).biomes[0].stages.stamp = { bossPassed: 'demo.s01' }), /не boss/],
    ['lessonDone', (f) => (fx.boss(f).requires = { lessonDone: 'demo.nie_ma' }), /висячая ссылка lessonDone "demo.nie_ma"/],
    ['mastery.module', (f) => (at(fx.orders(f), 0).if = { mastery: { module: 'nie_ma', level: 'seen', min: 0.5 } }), /висячая ссылка mastery.module "nie_ma"/],
    ['stage.biome', (f) => (fx.boss(f).requires = { stage: { biome: 'nie_ma', min: 1 } }), /висячая ссылка stage.biome "nie_ma"/],
    ['found', (f) => (fx.boss(f).requires = { found: 'wojtek' }), /висячая ссылка found "wojtek"/],
    ['remedy', (f) => (at(fx.errorTags(f), 0).remedy = 'demo.nie_ma'), /висячая ссылка remedy "demo.nie_ma"/],
    ['repairLesson', (f) => (at(fx.phonetics(f).clusters, 0).repairLesson = 'demo.nie_ma'), /висячая ссылка repairLesson "demo.nie_ma"/],
    ['модуль в world.biomes[].modules', (f) => fx.world(f).biomes[0].modules!.push('nie_ma'), /висячая ссылка модуль "nie_ma"/],
    ['host биома', (f) => fx.world(f).biomes[0].hosts!.push('wojtek'), /висячая ссылка host "wojtek"/],
    ['world.start.location', (f) => (fx.world(f).start.location = 'demo.nie_ma'), /висячая ссылка location "demo.nie_ma"/],
    ['module.teacher', (f) => (fx.module(f).teacher = 'nikt'), /висячая ссылка teacher "nikt"/],
    ['module.biome', (f) => (fx.module(f).biome = 'nie_ma'), /висячая ссылка biome "nie_ma"/],
    ['renames → несуществующее слово', (f) => (fx.module(f).renames = { 'lx.stary': 'lx.nie_ma' }), /висячая ссылка renames → слово "lx.nie_ma"/],
    ['introduces', (f) => fx.s01(f).introduces!.push('lx.nie_ma'), /висячая ссылка introduces "lx.nie_ma"/],
    ['director target.npc', (f) => (at(fx.director(f).beats, 0).target.npc = 'wojtek'), /висячая ссылка npc "wojtek"/],
    ['director target.object', (f) => (at(fx.director(f).beats, 1).target.object = 'nie_ma'), /висячая ссылка target.object "nie_ma"/],
    ['secret без персонажа kind: secret', (f) => (at(fx.secrets(f), 0).id = 'bobr'), /не kind: secret/],
  ];
  it.each(cases)('%s', (_name, mutate, re) => {
    expectIssue(run(mutate), 'ref', re);
  });
});

// ───────────────────────── п. 4: карты ─────────────────────────

describe('п. 4: ошибка ASCII-карты', () => {
  const cases: [string, (f: Files) => void, RegExp][] = [
    ['строк не size[1]', (f) => fx.ogrod(f).layers.ground.pop(), /строк 5, а size\[1\] = 6/],
    ['длина строки не size[0]', (f) => (fx.ogrod(f).layers.ground[1] = '#ssss.#'), /длина строки 7, а size\[0\] = 8/],
    ['символа нет в легенде', (f) => (fx.ogrod(f).layers.ground[4] = '#..X...#'), /символ\(ы\) "X" нет в легенде/],
    ['defaultGround нет в легенде', (f) => (fx.ogrod(f).defaultGround = '_'), /defaultGround "_" нет в легенде/],
    ['deco: символа нет в легенде', (f) => (fx.kawiarnia(f).layers.deco![2] = '   Q    '), /"Q" нет в легенде/],
    ['объект за границами', (f) => fx.ogrod(f).objects.push({ type: 'plot', id: 'daleko', at: [6, 4], size: [3, 1] }), /за границами карты 8×6/],
    ['спавн за границами', (f) => (fx.ogrod(f).spawns.far = [9, 9]), /спавн "far" \[9, 9\] за границами/],
    ['спавн на непроходимой клетке', (f) => (fx.ogrod(f).spawns.default = [0, 0]), /стоит на непроходимой клетке/],
    ['к NPC не подойти', (f) => fx.ogrod(f).layers.ground.splice(1, 2, '#ssss#.#', '#sss#.##'), /к NPC "bobr" не подойти/],
  ];
  it.each(cases)('%s', (_name, mutate, re) => {
    expectIssue(run(mutate), 'map', re);
  });
  it('несвязная карта = предупреждение, не ошибка', () => {
    const issues = run((f) => (fx.ogrod(f).layers.ground[3] = '########'));
    expectIssue(issues, 'map-connect', /карта несвязна/, `${D}maps/ogrod.json`, 'warn');
    expect(errorsOf(issues).filter((i) => i.code === 'map-connect')).toEqual([]);
  });
});

// ───────────────────────── п. 5: introduces ─────────────────────────

describe('п. 5: introduces', () => {
  it('больше tuning.maxIntroducesPerLesson', () => {
    expectIssue(
      run((f) => (fx.s01(f).introduces = ['lx.maly', 'lx.slucham', 'lx.stol', 'lx.kawa', 'lx.wyjscie', 'lx.maly'])),
      'introduces',
      /6 слов, больше tuning.maxIntroducesPerLesson = 5/,
    );
    expectIssue(run((f) => (fx.tuning(f).maxIntroducesPerLesson = 2)), 'introduces', /3 слов, больше .* = 2/);
  });
  it('слово не srs: true', () => {
    expectIssue(run((f) => fx.s01(f).introduces!.push('lx.mleko')), 'introduces', /lx.mleko в introduces, но у него не srs: true/);
  });
});

// ───────────────────────── п. 6: озвучка ─────────────────────────

describe('п. 6: озвучка', () => {
  const full = (): { v: 1; entries: Record<string, string> } => {
    const f: Files = new Map([...base].map(([k, v]) => [k, structuredClone(v)]));
    const lessons = (f.get(`modules/demo/lessons.json`) ?? []) as Lesson[];
    const vocab = (f.get(`modules/demo/vocab.json`) ?? []) as VocabEntry[];
    const dialogues = (f.get(`modules/demo/dialogues.json`) ?? []) as Dialogue[];
    const unvoiced = new Set(['dima', 'bobr', 'simba']);
    const entries = Object.fromEntries(voiceTexts(lessons, vocab, dialogues, unvoiced).map((t, i) => [`say:Zosia|normal|${t}`, `${i}.m4a`]));
    return { v: 1, entries };
  };
  it('нет манифеста: предупреждение для ready и draft, не ошибка', () => {
    const issues = run((f) => (fx.module(f).status = 'ready'));
    expectIssue(issues, 'audio', /озвучка не проверена.*модуль ready/, `${D}module.json`, 'warn');
    expect(errorsOf(issues).filter((i) => i.code === 'audio')).toEqual([]);
  });
  it('всё озвучено: ни ошибок, ни предупреждений', () => {
    const m = full();
    expect(Object.keys(m.entries).length).toBeGreaterThan(5);
    expect(run((f) => (fx.module(f).status = 'ready'), { audioManifest: m }).filter((i) => i.code === 'audio')).toEqual([]);
  });
  it('пустой манифест: draft = предупреждение со списком строк', () => {
    const issues = run(undefined, { audioManifest: { v: 1, entries: {} } });
    expectIssue(issues, 'audio', /не озвучено \d+ из \d+ строк \("/, `${D}module.json`, 'warn');
    expect(errorsOf(issues).filter((i) => i.code === 'audio')).toEqual([]);
  });
  it('ready без одной строки = ошибка', () => {
    const m = full();
    const [drop] = Object.keys(m.entries);
    delete m.entries[drop!];
    const issues = run((f) => (fx.module(f).status = 'ready'), { audioManifest: m });
    expectIssue(issues, 'audio', /модуль ready: не озвучено 1 из/, `${D}module.json`);
  });
  it('реплики персонажей без голоса (voice.engine none) не требуют озвучки', () => {
    const texts = voiceTexts(
      [{ id: 'demo.x', steps: [{ t: 'say', who: 'dima', pl: 'Cześć!' }, { t: 'say', who: 'pan_marek', pl: 'Dzień dobry.' }, { t: 'say', who: 'pan_marek', pl: 'Hm.', audio: false }] } as unknown as Lesson],
      [],
      [],
      new Set(['dima']),
    );
    expect(texts).toEqual(['Dzień dobry.']);
  });
});

// ───────────────────────── п. 7: удалённые слова ─────────────────────────

describe('п. 7: удалённый id из vocab.json', () => {
  const prev = vocabIds(base);
  it('удаление без renames = ошибка', () => {
    const issues = run((f) => fx.vocab(f).splice(3, 1), { prevVocab: prev });
    const i = expectIssue(issues, 'vocab-removed', /слово lx.kawa удалено из vocab.json.*module.renames/);
    expect(i.file).toBe(`${D}vocab.json`);
  });
  it('переименование через module.renames = ок', () => {
    const withOld = new Map(prev).set('lx.stary_stol', `${D}vocab.json`);
    expect(run(undefined, { prevVocab: withOld }).filter((i) => i.code === 'vocab-removed')).toEqual([]);
  });
  it('перенос слова в другой модуль = ок (id глобальные)', () => {
    const issues = run((f) => {
      const [moved] = fx.vocab(f).splice(5, 1);
      f.set('modules/other/module.json', { ...structuredClone(fx.module(f)), id: 'other', lessons: ['other.a'], boss: undefined, renames: undefined, onComplete: undefined });
      f.set('modules/other/lessons.json', [{ id: 'other.a', kind: 'practice', title: { ru: 'a' }, minutes: 1, steps: [{ t: 'explain', md: 'x' }] }]);
      f.set('modules/other/vocab.json', [moved]);
    }, { prevVocab: prev });
    expect(errorsOf(issues), dump(issues)).toEqual([]);
  });
});

// ───────────────────────── п. 8: новые ссылки ─────────────────────────

describe('п. 8: ссылки нового контента', () => {
  it('line из director.json нет в story/lines.json', () => {
    expectIssue(run((f) => (at(fx.director(f).beats, 0).line = 'bobr.nie_ma')), 'line', /реплики "bobr.nie_ma" нет в story\/lines.json/, 'director.json');
    expectIssue(run((f) => (fx.director(f).done!.more3Line = 'bobr.nie_ma')), 'line', /"bobr.nie_ma"/, 'director.json');
  });
  it('line из dialogues нет в story/lines.json', () => {
    expectIssue(run((f) => (fx.dialogue(f).nodes.c!.do = [{ line: 'bobr.nie_ma' }])), 'line', /"bobr.nie_ma" нет/, `${D}dialogues.json`);
  });
  it('line из secrets.json нет в story/lines.json', () => {
    expectIssue(run((f) => (at(fx.secrets(f), 0).line = 'simba.nie_ma')), 'line', /"simba.nie_ma" нет/, 'secrets.json');
  });
  it('secrets.spots[].spot нет среди объектов secret', () => {
    expectIssue(run((f) => (at(at(fx.secrets(f), 0).spots, 0).spot = 'pod_lozkiem')), 'secret-spot', /точки "pod_lozkiem" нет среди объектов secret на карте demo.ogrod/);
  });
  it('word.item не существует', () => {
    expectIssue(run((f) => Object.assign(fx.kawiarnia(f).objects.find((o) => o.type === 'word')!, { item: 'lx.nie_ma' })), 'ref', /висячая ссылка word.item "lx.nie_ma"/);
  });
  it('у карты нет controls', () => {
    const i = expectIssue(run((f) => delete (fx.kawiarnia(f) as Partial<LocationMap>).controls), 'schema', /нет обязательного поля "controls"/);
    expect(i.file).toBe(`${D}maps/kawiarnia.json`);
  });
  it('сумма recipes.needs[].count ≠ kitchen.jarsPerRecipe', () => {
    expectIssue(run((f) => (at(at(fx.recipes(f), 0).needs, 0).count = 1)), 'recipe-sum', /сумма needs\[\]\.count = 2, а tuning.kitchen.jarsPerRecipe = 3/);
  });
  it('orders.npc не существует', () => {
    expectIssue(run((f) => (at(fx.orders(f), 0).npc = 'wojtek')), 'ref', /висячая ссылка orders.npc "wojtek"/);
  });
  it('reveal с неизвестным элементом HUD', () => {
    expectIssue(run((f) => (at(fx.director(f).beats, 0).do = [{ reveal: 'shop' as never }])), 'schema', /неизвестный элемент HUD "shop"; допустимо: obchod/);
    expectIssue(run((f) => (at(fx.director(f).reveals, 0).element = 'shop' as never)), 'schema', /неизвестный элемент HUD "shop"/);
  });
});

// ───────────────────────── предупреждения §3.13 ─────────────────────────

describe('предупреждения', () => {
  it('реплики todo: предупреждение; в модуле ready — ошибка', () => {
    expectIssue(run(), 'todo', /9 реплик с todo: true/, 'story/lines.json', 'warn');
    expectIssue(run((f) => (fx.module(f).status = 'ready')), 'todo', /реплика "bobr.after_kawa" ещё todo, а модуль status: ready/);
  });
  it('реплика бита в локации ready-модуля = ошибка', () => {
    expectIssue(run((f) => (fx.module(f).status = 'ready')), 'todo', /"bobr.meets" ещё todo/, 'director.json');
  });
  it('сиротский узел диалога', () => {
    expectIssue(run((f) => (fx.dialogue(f).nodes.z = { who: 'pan_marek', end: true })), 'orphan', /узел "z" недостижим/, undefined, 'warn');
  });
  it('урок вне module.lessons', () => {
    expectIssue(run((f) => (fx.module(f).lessons = ['demo.boss'])), 'orphan', /demo.s01 не перечислен/, undefined, 'warn');
  });
  it('tr пустой = предупреждение, tr нет = ошибка', () => {
    expectIssue(run((f) => (at(fx.vocab(f), 0).tr = '')), 'tr', /пустая транскрипция у lx.maly/, undefined, 'warn');
    expectIssue(run((f) => delete at(fx.vocab(f), 0).tr), 'tr', /нет tr/);
  });
  it('tr не нужен в модуле kind: legacy', () => {
    const issues = run((f) => {
      fx.module(f).kind = 'legacy';
      delete at(fx.vocab(f), 0).tr;
    });
    expect(issues.filter((i) => i.code === 'tr')).toEqual([]);
  });
  it('урок длиннее minutes × 1.5', () => {
    expectIssue(run((f) => (fx.s01(f).minutes = 2)), 'long-lesson', /13 шагов ≈ 4 мин, больше minutes × 1.5 = 3/, undefined, 'warn');
  });
});

// ───────────────────────── шаги и диалоги (§3.5, §3.6) ─────────────────────────

describe('шаги урока', () => {
  const step = <T = object>(f: Files, i: number): T => at(fx.s01(f).steps!, i) as T;
  it('answer вне диапазона', () => {
    expectIssue(run((f) => (step<StepChoice>(f, 7).answer = 2)), 'step', /answer = 2 вне диапазона вариантов \(0…1\)/);
    expectIssue(run((f) => Object.assign(step(f, 12), { answer: 3 })), 'step', /answer = 3 вне диапазона/);
  });
  it('плитки answer нет в tiles', () => {
    expectIssue(run((f) => Object.assign(step(f, 6), { answer: ['Mała', 'kawa', 'dziękuję'] })), 'step', /плитки "dziękuję" из answer нет в tiles/);
  });
  it('в gap не ровно один ___', () => {
    expectIssue(run((f) => Object.assign(step(f, 11), { text: '___ ___, proszę.' })), 'step', /ровно один "___", а их 2/);
  });
  it('errorTagByOption на несуществующий вариант', () => {
    expectIssue(run((f) => (step<StepChoice>(f, 7).errorTagByOption = { '5': 'ff.stol' })), 'step', /варианта 5 нет/);
  });
  it('steps и parts одновременно', () => {
    expectIssue(run((f) => (fx.boss(f).steps = [{ t: 'explain', md: 'x' }])), 'lesson', /ровно одно из steps \/ parts/);
  });
  it('short.steps ссылается на несуществующий шаг', () => {
    expectIssue(run((f) => fx.s01(f).short!.steps.push(40)), 'lesson', /шага 40 нет/);
  });
});

describe('граф диалога', () => {
  it('next на несуществующий узел', () => {
    expectIssue(run((f) => (fx.dialogue(f).nodes.b!.next = 'zz')), 'dialogue', /next "zz": такого узла нет/);
  });
  it('у узла и next, и end', () => {
    expectIssue(run((f) => (fx.dialogue(f).nodes.c!.next = 'a')), 'dialogue', /ровно одно из next \/ choices \/ end \(сейчас 2\)/);
  });
  it('I-11: who обязателен у узла с pl, choices или todo; чистый end и узел line — без who', () => {
    expectIssue(run((f) => delete (fx.dialogue(f).nodes.a as { who?: string }).who), 'dialogue', /у узла "a" с pl, choices или todo нет who/);
    const ok = run((f) => {
      const d = fx.dialogue(f);
      d.nodes.c = { line: 'bobr.after_kawa', next: 'e' };
      d.nodes.e = { end: true };
    });
    expect(errorsOf(ok)).toEqual([]);
  });
  it('I-11: узел line — ссылка на story/lines.json; не вместе с pl', () => {
    expectIssue(run((f) => (fx.dialogue(f).nodes.c = { line: 'bobr.nie_ma', end: true })), 'line', /"bobr.nie_ma" нет/, `${D}dialogues.json`);
    expectIssue(run((f) => (fx.dialogue(f).nodes.c = { who: 'bobr', line: 'bobr.after_kawa', pl: 'Tak.', end: true })), 'dialogue', /line вместе с pl или todo/);
  });
  it('I-11: узел todo — предупреждение, в модуле ready — ошибка; todo и pl вместе — ошибка', () => {
    expectIssue(run((f) => (fx.dialogue(f).nodes.c = { who: 'pan_marek', todo: true, end: true })), 'todo', /1 узлов диалогов с todo: true \(dlg.demo.marek.c\)/, `${D}dialogues.json`, 'warn');
    expectIssue(run((f) => {
      fx.module(f).status = 'ready';
      fx.dialogue(f).nodes.c = { who: 'pan_marek', todo: true, end: true };
    }), 'todo', /узел "c" ещё todo, а модуль status: ready/);
    expectIssue(run((f) => (fx.dialogue(f).nodes.c = { who: 'pan_marek', todo: true, pl: 'Tak.', end: true })), 'dialogue', /и pl, и todo/);
  });
  it('end не достижим из start', () => {
    expectIssue(run((f) => {
      const d = fx.dialogue(f);
      d.nodes.c = { who: 'pan_marek', next: 'a' };
    }), 'dialogue', /не достижим ни один end/);
  });
});

// ───────────────────────── CLI на сломанных копиях ─────────────────────────

describe('CLI tools/validate_content.ts', () => {
  const tmps: string[] = [];
  afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function cli(mutate: ((dir: string) => void) | null, extra: string[] = []): { code: number; out: string } {
    const dir = mkdtempSync(join(tmpdir(), 'pq-content-'));
    tmps.push(dir);
    cpSync(FIXTURE, dir, { recursive: true });
    mutate?.(dir);
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsx'), ['tools/validate_content.ts', '--root', dir, '--quiet', ...extra], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  }
  const edit = (dir: string, rel: string, fn: (j: never) => void): void => {
    const p = join(dir, rel);
    const j = JSON.parse(readFileSync(p, 'utf8')) as never;
    fn(j);
    writeFileSync(p, JSON.stringify(j, null, 2));
  };

  it('валидная копия: exit 0', () => {
    const r = cli(null);
    expect(r.code, r.out).toBe(0);
  });
  it('битая ссылка на id: exit 1, файл:путь: сообщение', () => {
    const r = cli((d) => edit(d, `${D}lessons.json`, (j: Lesson[]) => (j[0]!.npc = 'nikt')));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/modules\/demo\/lessons.json:\/0\/npc: висячая ссылка npc "nikt": нет в characters.json/);
  });
  it('дубль id: exit 1', () => {
    const r = cli((d) => edit(d, 'characters.json', (j: Character[]) => j.push({ ...j[1]! })));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/characters.json:\/4: дубль id character "bobr": уже определён в characters.json:\/1/);
  });
  it('удалённый id слова (сравнение с --prev): exit 1', () => {
    const r = cli((d) => edit(d, `${D}vocab.json`, (j: VocabEntry[]) => j.splice(3, 1)), ['--prev', FIXTURE]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/modules\/demo\/vocab.json:\/: слово lx.kawa удалено из vocab.json/);
  });
  it('карта без controls: exit 1', () => {
    const r = cli((d) => edit(d, `${D}maps/ogrod.json`, (j: Partial<LocationMap>) => delete j.controls));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/modules\/demo\/maps\/ogrod.json:\/: нет обязательного поля "controls"/);
  });
});

// ───────────────────────── src/systems/content.ts ─────────────────────────

describe('src/systems/content.ts', () => {
  const asGlob = (files: Files): Record<string, unknown> =>
    Object.fromEntries([...files].map(([k, v]) => [`/content/${k}`, structuredClone(v)]));

  it('строит индекс по id из фикстуры', () => {
    const c = buildContent(asGlob(base));
    expect(c.world.start.location).toBe('demo.ogrod');
    expect(c.characters.get('simba')?.kind).toBe('secret');
    expect(c.vocab.get('lx.kawa')?.module).toBe('demo');
    expect(c.lessons.get('demo.boss')?.value.parts).toHaveLength(2);
    expect(c.maps.get('demo.kawiarnia')?.value.controls).toBe('walk');
    expect(c.modules.get('demo')?.maps.map((m) => m.id).sort()).toEqual(['demo.kawiarnia', 'demo.ogrod']);
    expect(c.lines.get('bobr.meets')?.todo).toBe(true);
    expect(c.renames.get('lx.stary_stol')).toBe('lx.stol');
    expect(c.tuning.kitchen.jarsPerRecipe).toBe(3);
  });
  it('дубль id и отсутствие обязательного файла — понятная ошибка', () => {
    const files = new Map(base);
    files.set('characters.json', [...fx.characters(base), at(fx.characters(base), 0)]);
    expect(() => buildContent(asGlob(files))).toThrow(ContentError);
    expect(() => buildContent(asGlob(files))).toThrow(/дубль character "dima"/);
    const noWorld = new Map(base);
    noWorld.delete('world.json');
    expect(() => buildContent(asGlob(noWorld))).toThrow(/нет файла content\/world.json/);
  });
  it('getContent() грузит content/ через import.meta.glob', () => {
    const c = getContent();
    expect(c.world.biomes.map((b) => b.id)).toContain('praga');
    expect(c.modules.has('ch01')).toBe(true);
    expect(c.characters.get('bobr')?.kind).toBe('companion');
    expect(c.characters.has('wojtek')).toBe(false);
    expect(c.maps.get('ch01.metro')?.value.objects.some((o) => o.type === 'word')).toBe(true);
  });
});

describe('P-01: объяснение ошибки и бит первого дня', () => {
  it('errorTags.hint и step.why необязательны; длиннее 140 знаков — ошибка схемы', () => {
    expect(errorsOf(run((f) => {
      at(fx.errorTags(f), 0).hint = 'stół = стол, krzesło = стул.';
      (at(fx.s01(f).steps!, 7) as StepChoice).why = 'ó читается как [у].';
    }))).toEqual([]);
    expectIssue(run((f) => ((at(fx.s01(f).steps!, 7) as StepChoice).why = 'x'.repeat(141))), 'schema', /141|длинн|140/);
    expectIssue(run((f) => (at(fx.errorTags(f), 0).hint = '')), 'schema', /.+/);
  });

  it('без --release заглушки первого дня — одно предупреждение; с --release — ошибка на каждую', () => {
    // В фикстуре: ремонтная сцена R3 = demo.s01, её запускает dlg.demo.marek, а там line bobr.after_kawa (todo).
    expectIssue(run(), 'todo', /первый день: \d+ заглушек todo .*PQ_RELEASE=1/, 'story/lines.json', 'warn');
    const rel = run(undefined, { release: true });
    expectIssue(rel, 'todo', /первый день: реплика "bobr\.after_kawa" ещё todo, а сборка release/, 'story/lines.json');
    expectIssue(rel, 'todo', /первый день: нет реплики "intro\.caption\.oct"/, 'director.json');
    // Реплика написана — ошибки по ней нет.
    const fixed = run((f) => Object.assign(fx.lines(f).find((l) => l.id === 'bobr.after_kawa')!, { todo: false, pl: 'Dobra kawa.', plRu: 'Хороший кофе.' }), { release: true });
    expect(fixed.some((i) => i.level === 'error' && /bobr\.after_kawa/.test(i.msg))).toBe(false);
  });

  it('реальный контент: все реплики первого дня есть в story/lines.json (release ловит только todo)', () => {
    const { issues } = validateDir({ release: true, base: 'HEAD' });
    const first = issues.filter((i) => i.level === 'error' && /первый день/.test(i.msg));
    expect(first.filter((i) => /нет реплики/.test(i.msg))).toEqual([]);
    expect(first.every((i) => i.code === 'todo')).toBe(true);
  });
});
