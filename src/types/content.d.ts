/* eslint-disable */
// Сгенерировано tools/gen_types.ts из content/schema/*.schema.json. Не править руками:
// поменяй схему и запусти `npm run gen:types`.

export type Id = string;
export type ModuleId = string;
export type CharId = string;
export type ItemId = string;
export type Cluster = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10';
export type HudElement = 'obchod' | 'pierogi' | 'zloty' | 'passport' | 'map' | 'jars' | 'orders' | 'kitchen' | 'diary';
/**
 * content/characters.json: игрок, NPC, компаньон bobr, кот simba (kind: secret), ТЗ §3.2.
 */
export type Characters = Character[];
/**
 * content/items.json: только уникальные предметы (билет, ключ), расходников нет (ТЗ §3.8).
 */
export type Items = Item[];
export type LineId = string;
export type DlgId = string;
/**
 * Список эффектов (ТЗ §3.9). Эффектов «дать złoty / сердце / карточку» нет и не будет.
 */
export type Effects = Effect[];
/**
 * content/story/lines.json: реплики бобра, сюжета, кота (ТЗ §3.8). Текст переносится из ../СЮЖЕТ.md, не сочиняется. todo: true = реплики ещё нет (ru можно не указывать).
 */
export type Lines = Line[];
/**
 * content/secrets.json: кот Симба и другие секреты (ТЗ §3.8). Точки spot объявляются объектами secret в картах. Награда только эффектами, не złoty.
 */
export type Secrets = Secret[];
export type Pos =
  'noun' | 'verb' | 'adj' | 'adv' | 'num' | 'pron' | 'prep' | 'conj' | 'part' | 'phrase' | 'name' | 'sign' | 'letter';
/**
 * @minItems 2
 * @maxItems 2
 */
export type Xy = [number, number];
/**
 * content/orders.json: шаблоны заказов NPC (этап 3, ТЗ §4.13).
 */
export type Orders = Order[];
/**
 * content/recipes.json: рецепты кухни из банок (этап 3, ТЗ §4.13). Сумма needs[].count = tuning.kitchen.jarsPerRecipe.
 */
export type Recipes = Recipe[];
export type MpId = string;
export type ErrorTagId = string;
/**
 * content/errorTags.json: теги ошибок → сцена-лекарство (ТЗ §3.8, §4.4). Префиксы R1..R10, orth.*, gr.*, ff.*, ph.*.
 */
export type ErrorTags = ErrorTag[];
export type LxId = string;
/**
 * content/modules/<id>/vocab.json (ТЗ §3.4). Id глобальные и стабильные: удалять нельзя, только module.renames.
 */
export type Vocab = VocabEntry[];
/**
 * Шаг урока (ТЗ §3.5), дискриминатор t. Новый тип = ветка здесь + файл в src/ui/exercises/ + тест.
 */
export type Step =
  | StepSay
  | StepExplain
  | StepShadow
  | StepListen
  | StepChoice
  | StepOrder
  | StepType
  | StepDictation
  | StepMatch
  | StepGap
  | StepMinimalPair
  | StepStress;
/**
 * content/modules/<id>/lessons.json (ТЗ §3.5). Ровно одно из steps / parts (проверяет валидатор).
 */
export type Lessons = Lesson[];
/**
 * content/modules/<id>/dialogues.json (ТЗ §3.6). У узла ровно одно из next / choices / end (проверяет валидатор).
 */
export type Dialogues = Dialogue[];
export type MapObject = MapNpc | MapExit | MapTrigger | MapPlot | MapSign | MapBoard | MapWord | MapSecret;

/**
 * Тип каждого файла контента (ключ = вид файла).
 */
export interface ContentFiles {
  world: World;
  characters: Characters;
  items: Items;
  tuning: Tuning;
  director: Director;
  lines: Lines;
  secrets: Secrets;
  orders: Orders;
  recipes: Recipes;
  phonetics: Phonetics;
  errorTags: ErrorTags;
  module: Module;
  vocab: Vocab;
  lessons: Lessons;
  dialogues: Dialogues;
  map: LocationMap;
  step: Step;
  condition: Condition;
  effects: Effects;
}
/**
 * content/world.json: биомы, стадии открытия, старт (ТЗ §3.1).
 */
export interface World {
  schema: 1;
  start: {
    location: Id;
    spawn: string;
  };
  maps: {
    poland: string;
    warszawa: string;
  };
  /**
   * @minItems 1
   */
  biomes: [Biome, ...Biome[]];
}
export interface Biome {
  id: Id;
  layer: 'warszawa' | 'region' | 'secret';
  title: Text2;
  /**
   * @minItems 4
   * @maxItems 4
   */
  mapRegion: [number, number, number, number];
  locations: Id[];
  border?: Id;
  modules?: ModuleId[];
  hosts?: CharId[];
  gate?: Text2;
  stamp?: string;
  stages: {
    visible: Condition;
    preview: Condition;
    stamp: Condition;
  };
}
export interface Text2 {
  pl: string;
  ru: string;
}
/**
 * Условие = объект ровно с одним ключом-атомом (ТЗ §3.9).
 */
export interface Condition {
  always?: true;
  /**
   * @minItems 1
   */
  all?: [Condition, ...Condition[]];
  /**
   * @minItems 1
   */
  any?: [Condition, ...Condition[]];
  not?: Condition;
  flag?: Id;
  item?: ItemId;
  lessonDone?: Id;
  bossPassed?: Id;
  mastery?: {
    module: ModuleId;
    level: 'seen' | 'mastered';
    min: number;
  };
  cards?: {
    minInterval: number;
    min: number;
  };
  cluster?: {
    id: Cluster;
    status: 'green' | 'yellow' | 'red' | 'unknown';
  };
  daysPlayed?: number;
  dateWindow?: {
    from: string;
    to: string;
  };
  /**
   * @minItems 1
   */
  weekday?: [number, ...number[]];
  stage?: {
    biome: Id;
    min: number;
  };
  found?: CharId;
  jars?: {
    min: number;
    module?: ModuleId;
    full?: boolean;
  };
  hud?: HudElement;
  daysSinceLast?: number;
  stepDone?: 'water' | 'scene' | 'evening' | 'sleep';
}
export interface Character {
  id: CharId;
  name: string;
  kind: 'player' | 'teacher' | 'host' | 'companion' | 'extra' | 'secret';
  years?: string;
  status?: 'ok' | 'living' | 'sensitive';
  addressAs: 'ty' | 'pan' | 'pani' | 'panstwo' | 'none';
  voice: {
    engine: 'say' | 'piper' | 'none';
    id: string;
    rate?: number;
  };
  sprite: string;
  portrait: string;
  traits?: string;
  hearts?: boolean;
}
export interface Item {
  id: ItemId;
  title: Text2;
  icon: string;
}
/**
 * content/tuning.json: все числа баланса (ТЗ §4.11). Правка баланса без кода; новое число = поле здесь и в tuning.json.
 */
export interface Tuning {
  schema: 1;
  dayStartHour: number;
  /**
   * @minItems 1
   */
  ladder: [number, ...number[]];
  efMin: number;
  efMax: number;
  fuzz: number;
  newItemsPerDay: number;
  maxIntroducesPerLesson: number;
  productionAfterReps: number;
  obchodBatch: number;
  debtLockThreshold: number;
  phoneticPerDay: number;
  springAfterDays: number;
  expressMaxCards: number;
  expressMaxMin: number;
  sessionTargetMin: number;
  sessionSoftCapMin: number;
  resumeHours: number;
  remedy: {
    errors: number;
    windowDays: number;
    cooldownDays: number;
  };
  clusters: {
    green: number;
    yellow: number;
    closeScore: number;
    closeDays: number;
    closeMinAnswers: number;
    pairsPerCluster: number;
  };
  zloty: {
    review: number;
    newItem: number;
    sceneFirst: number;
    express: number;
    orderBase: number;
    orderPerCard: number;
    orderMax: number;
    bossFirst: number;
    dailyCap: number;
    hint: number;
  };
  pierogi: {
    daily: number;
    carryMax: number;
  };
  hearts: {
    base: number;
    perScene: number;
    perOrder: number;
    max: number;
    overdueGraceDays: number;
    floor: number;
  };
  jars: {
    /**
     * @minItems 3
     */
    thresholds: [number, number, number, ...number[]];
  };
  grade3FastMs: {
    choice: number;
    input: number;
  };
  director: {
    easyWins: number;
    more3Min: number;
    firstDayRepairIfActiveMinLt: number;
  };
  orders: {
    perDay: number;
    itemsMin: number;
    itemsMax: number;
    earlyDays: number;
    deliveryBonus: number;
    stepLimitFactor: number;
  };
  kitchen: {
    dailyMax: number;
    jarsPerRecipe: number;
    bonusItems: number;
  };
  market: {
    enabled: boolean;
    zlPerJar: number;
    dailyMax: number;
  };
  minigames: {
    /**
     * @minItems 2
     * @maxItems 2
     */
    fishBiteDelayMs: [number, number];
    fishWindowMs: number;
    /**
     * @minItems 1
     */
    mineFloors: [number, ...number[]];
  };
}
/**
 * content/director.json: сюжетные биты и раскрытие HUD для режиссёра (ТЗ §4.12). Реплики (line) ссылаются на story/lines.json.
 */
export interface Director {
  schema: 1;
  beats: Beat[];
  reveals: Reveal[];
  spring?: {
    line: LineId;
  };
  done?: {
    line: LineId;
    more3Line?: LineId;
  };
}
export interface Beat {
  /**
   * Флаг показа: beat.<id>
   */
  id: string;
  slot: 'start' | 'afterWater' | 'afterScene' | 'beforeSleep';
  once?: boolean;
  if: Condition;
  target: Target;
  line?: LineId;
  do?: Effects;
}
/**
 * Куда ведёт режиссёр (ТЗ §4.12).
 */
export interface Target {
  location: Id;
  object?: string;
  npc?: CharId;
  plot?: string;
  screen?: string;
}
export interface Effect {
  setFlag?: Id;
  give?: ItemId;
  startLesson?: Id;
  startDialogue?: DlgId;
  teleport?: {
    to: Id;
    spawn?: string;
  };
  open?: 'summary' | 'passport' | 'obchod' | 'express' | 'settings';
  challenge?: Id;
  toast?: Text2;
  line?: LineId;
  reveal?: HudElement;
}
export interface Reveal {
  element: HudElement;
  if: Condition;
  line?: LineId;
}
export interface Line {
  id: LineId;
  who: CharId;
  ru?: string;
  pl?: string;
  todo?: boolean;
}
export interface Secret {
  id: CharId;
  /**
   * @minItems 1
   */
  spots: [SecretSpot, ...SecretSpot[]];
  move: 'daily' | 'never';
  onFound: Effects;
  line?: LineId;
}
export interface SecretSpot {
  spot: string;
  location: Id;
  if?: Condition;
}
export interface Order {
  id: string;
  npc: CharId;
  frame: Text2;
  need: {
    count: number;
    tags?: string[];
    pos?: Pos[];
  };
  build?: 'words' | 'phrase';
  phrase?: {
    tiles?: string[];
    answer?: string[];
  };
  delivery?: {
    location?: Id;
    at?: Xy;
  };
  if?: Condition;
}
export interface Recipe {
  id: string;
  title: Text2;
  /**
   * @minItems 1
   */
  needs: [
    {
      count: number;
      tags?: string[];
      pos?: Pos[];
    },
    ...{
      count: number;
      tags?: string[];
      pos?: Pos[];
    }[]
  ];
  gives: {
    pierog: 1;
  };
  line?: LineId;
}
/**
 * content/phonetics.json: кластеры R1–R10, минимальные пары (ТЗ §3.8, §4.3). Пороги статусов в tuning.clusters.
 */
export interface Phonetics {
  schema: 1;
  clusters: PhoneticCluster[];
  pairs: MinimalPair[];
}
export interface PhoneticCluster {
  id: Cluster;
  title: string;
  repairLesson?: Id;
}
export interface MinimalPair {
  id: MpId;
  a: string;
  b: string;
  cluster: Cluster;
  /**
   * @minItems 2
   * @maxItems 2
   */
  ru?: [string, string];
}
export interface ErrorTag {
  id: ErrorTagId;
  ru: string;
  remedy?: Id;
  cluster?: Cluster;
}
/**
 * content/modules/<id>/module.json (ТЗ §3.3).
 */
export interface Module {
  schema: 1;
  id: ModuleId;
  kind: 'chapter' | 'side' | 'phonetics' | 'legacy' | 'seasonal' | 'remedy' | 'mine';
  status: 'draft' | 'ready';
  order?: number;
  title: Text2;
  biome?: Id;
  teacher?: CharId;
  cefr?: 'A0' | 'A1' | 'A2';
  canDo?: {
    id: string;
    ru: string;
  }[];
  unlock: {
    hard: Condition;
    soft?: {
      if: Condition;
      hint: string;
    }[];
  };
  /**
   * @minItems 1
   */
  lessons: [Id, ...Id[]];
  boss?: Id;
  grammar?: {
    id: string;
    title: string;
    ru: string;
    table?: string[][];
    errorTags?: string[];
  }[];
  phonetics?: {
    clusters?: Cluster[];
  };
  srs?: {
    newPerDay?: number;
  };
  dateWindow?: {
    from: string;
    to: string;
  };
  /**
   * Переименование слов: старый lxId → новый lxId (ТЗ §3.0, §3.12).
   */
  renames?: {
    [k: string]: LxId;
  };
  onComplete?: Effects;
}
export interface VocabEntry {
  id: LxId;
  pl: string;
  ru: string;
  tr?: string;
  pos: Pos;
  srs: boolean;
  cards?: ('rec' | 'lis' | 'pro')[];
  gender?: 'm' | 'f' | 'n' | 'mp' | 'nmp';
  forms?: {
    [k: string]: string;
  };
  ex?: Text2;
  ff?: {
    ru: string;
    means: string;
  };
  clusters?: Cluster[];
  tags?: string[];
  voice?: string;
  legacy?: {
    day?: number;
    trainerId?: string;
  };
}
export interface Lesson {
  id: Id;
  kind: 'scene' | 'repair' | 'signs' | 'diag' | 'boss' | 'remedy' | 'practice';
  title: {
    pl?: string;
    ru: string;
  };
  minutes: number;
  npc?: CharId;
  location?: Id;
  /**
   * @maxItems 8
   */
  introduces?: LxId[];
  warmup?: {
    fromModules?: ModuleId[];
    count?: number;
  };
  requires?: Condition;
  skipIf?: Condition;
  short?: {
    if: Condition;
    steps: number[];
  };
  /**
   * @minItems 1
   */
  steps?: [Step, ...Step[]];
  /**
   * @minItems 1
   */
  parts?: [LessonPart, ...LessonPart[]];
  pass?: {
    score?: number;
    firstTry?: number;
    redClusterMin?: number;
    maxErrorsByTag?: {
      [k: string]: number;
    };
  };
  reviewShare?: number;
  reward?: Effects;
}
/**
 * Реплика NPC
 */
export interface StepSay {
  t: 'say';
  who: CharId;
  pl: string;
  ru?: string;
  audio?: boolean;
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Правило, ≤400 знаков
 */
export interface StepExplain {
  t: 'explain';
  md: string;
  table?: string[][];
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Слушает и повторяет вслух
 */
export interface StepShadow {
  t: 'shadow';
  pl: string;
  ru?: string;
  repeat: number;
  slow?: boolean;
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Слышит фразу, выбирает вариант
 */
export interface StepListen {
  t: 'listen';
  say: string;
  options: [string, string] | [string, string, string] | [string, string, string, string] | string;
  answer: number;
  show?: 'text' | 'sign';
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Выбор варианта
 */
export interface StepChoice {
  t: 'choice';
  q: string;
  /**
   * @minItems 2
   * @maxItems 4
   */
  options: [string, string] | [string, string, string] | [string, string, string, string];
  answer: number;
  dir?: 'pl-ru' | 'ru-pl';
  errorTagByOption?: {
    [k: string]: ErrorTagId;
  };
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Собирает фразу из плиток
 */
export interface StepOrder {
  t: 'order';
  prompt: string;
  say?: string;
  /**
   * @minItems 2
   */
  tiles: [string, string, ...string[]];
  /**
   * @minItems 1
   */
  answer: [string, ...string[]];
  alt?: [string, ...string[]][];
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Печатает ответ
 */
export interface StepType {
  t: 'type';
  prompt: string;
  say?: string;
  /**
   * @minItems 1
   */
  accept: [string, ...string[]];
  lenient?: {
    diacritics?: 'ok' | 'warn' | 'fail';
    ortho?: boolean;
    typo?: boolean;
  };
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Слышит, печатает
 */
export interface StepDictation {
  t: 'dictation';
  say: string;
  /**
   * @minItems 1
   */
  accept?: [string, ...string[]];
  slowFirst?: boolean;
  lenient?: {
    diacritics?: 'ok' | 'warn' | 'fail';
    ortho?: boolean;
    typo?: boolean;
  };
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Соединяет пары pl↔ru
 */
export interface StepMatch {
  t: 'match';
  /**
   * @minItems 3
   * @maxItems 6
   */
  pairs: [[string, string], [string, string], [string, string], ...[string, string][]];
  items?: LxId[];
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Заполняет пропуск ___
 */
export interface StepGap {
  t: 'gap';
  text: string;
  answer: string;
  /**
   * @minItems 2
   * @maxItems 4
   */
  options?: [string, string] | [string, string, string] | [string, string, string, string];
  /**
   * @minItems 1
   */
  accept?: [string, ...string[]];
  say?: string;
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
/**
 * Слышит одно из пары, выбирает
 */
export interface StepMinimalPair {
  t: 'minimal_pair';
  /**
   * @minItems 2
   * @maxItems 2
   */
  pair: [string, string];
  play: 0 | 1 | 'random';
  mode?: 'which' | 'same_diff';
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster: Cluster;
  hint?: string;
}
/**
 * Тапает ударный слог
 */
export interface StepStress {
  t: 'stress';
  word: string;
  /**
   * @minItems 1
   */
  syllables: [string, ...string[]];
  answer: number;
  say?: boolean;
  /**
   * По умолчанию <lessonId>#<index>
   */
  id?: string;
  /**
   * lxId или mpId, которое проверяет шаг
   */
  item?: string;
  tags?: ErrorTagId[];
  cluster?: Cluster;
  hint?: string;
}
export interface LessonPart {
  id: string;
  title?: string;
  weight?: number;
  /**
   * @minItems 1
   */
  steps: [Step, ...Step[]];
}
export interface Dialogue {
  id: DlgId;
  npc: CharId;
  register?: 'ty' | 'pan' | 'pani' | 'panstwo';
  start: string;
  if?: Condition;
  nodes: {
    [k: string]: DialogueNode;
  };
}
export interface DialogueNode {
  who: CharId;
  pl?: string;
  ru?: string;
  next?: string;
  end?: true;
  lesson?: Id;
  do?: Effects;
  /**
   * @minItems 1
   */
  choices?: [DialogueChoice, ...DialogueChoice[]];
}
export interface DialogueChoice {
  pl: string;
  ru?: string;
  ok?: boolean;
  next: string;
  errorTag?: ErrorTagId;
  react?: 'confused' | 'happy' | 'laugh' | 'cold';
  if?: Condition;
  do?: Effects;
}
/**
 * content/modules/<id>/maps/<name>.json: ASCII-локация (ТЗ §3.7). controls обязателен: walk = прямое управление, tap = только тап.
 */
export interface LocationMap {
  schema?: 1;
  id: Id;
  title: Text2;
  tileset: 'ninja16' | 'kenney16' | 'custom16';
  controls: 'walk' | 'tap';
  size: Xy;
  legend: {
    [k: string]: LegendEntry;
  };
  defaultGround: string;
  layers: {
    ground: string[];
    deco?: string[];
  };
  spawns: {
    [k: string]: Xy;
  };
  music?: string;
  objects: MapObject[];
}
export interface LegendEntry {
  tile: string;
  solid?: boolean;
  layer?: 'ground' | 'deco';
  auto?: boolean;
}
export interface MapNpc {
  type: 'npc';
  id: CharId;
  at: Xy;
  facing?: 'up' | 'down' | 'left' | 'right';
  if?: Condition;
}
export interface MapExit {
  type: 'exit';
  at: Xy;
  /**
   * id локации или "worldmap"
   */
  to: string;
  spawn?: string;
  if?: Condition;
}
export interface MapTrigger {
  type: 'trigger';
  id: string;
  at: Xy;
  size?: Xy;
  on: 'enter' | 'tap';
  if?: Condition;
  do: Effects;
  once?: boolean;
}
export interface MapPlot {
  type: 'plot';
  id: string;
  at: Xy;
  size: Xy;
}
export interface MapSign {
  type: 'sign';
  at: Xy;
  pl: string;
  ru?: string;
  item?: LxId;
}
export interface MapBoard {
  type: 'board';
  at: Xy;
  board: 'orders' | 'kitchen' | 'spizarnia' | 'market';
}
export interface MapWord {
  type: 'word';
  id: string;
  at: Xy;
  item: LxId;
  ex?: 'listen' | 'choice' | 'type' | 'dictation' | 'order';
  sprite?: string;
  if?: Condition;
}
export interface MapSecret {
  type: 'secret';
  id: string;
  at: Xy;
  /**
   * Имя точки для secrets.json; по умолчанию = id
   */
  spot?: string;
}
