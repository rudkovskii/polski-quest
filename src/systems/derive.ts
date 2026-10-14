// Производное состояние (ТЗ §3.10): чистая функция checkpoint + events → Derived. Не хранится и не синкается.
// I-04: уроки, боссы, игровые дни. I-05: карточки (intro, rev, imp, порог `pro`, renames), долг,
// статус кластеров и карточки `pair` (§4.3, базово; ремонт и босс — I-11). Экономика — I-18,
// сердца/банки — I-19, метрики — I-38. Результат не зависит от порядка событий во входе.
import type { Tuning, VocabEntry } from '../types/content';
import type { Content } from './content';
import { compareEvents, isSorted, revVerdict, type EventOf, type LogEvent } from './log';
import { getSetting, type AppendOpts, type CardId, type CardState, type CardType, type DayStats, type Progress } from './progress';
import { cardId, fresh, orderEarlyDays, parseCardId, review } from './srs';
import { dayStart, dayStartAfter, daysBetween, dayOf, DEFAULT_DAY_START_HOUR, type Day, type TimeOpts, type Ts } from './time';
import { DEFAULT_TUNING } from './tuning';

export type ClusterStatus = 'green' | 'yellow' | 'red' | 'unknown';

/** Поля tuning, которые читает вывод состояния. */
export type DeriveTuning = Pick<
  Tuning,
  'ladder' | 'efMin' | 'efMax' | 'fuzz' | 'dayStartHour' | 'productionAfterReps' | 'clusters' | 'orders'
>;

/**
 * Срез контента, нужный выводу. Полный контент сворачивается в него через `deriveContent(getContent())`;
 * в тестах можно передать только нужные поля.
 */
export interface DeriveContent {
  /** tuning.dayStartHour, по умолчанию 4. */
  dayStartHour?: number;
  /** Объединённые `module.renames` всех модулей: старый id → новый (§3.12). */
  renames?: Readonly<Record<string, string>>;
  /** Баланс SRS и кластеров; по умолчанию content/tuning.json. */
  tuning?: DeriveTuning;
  /** Типы карточек слова (§3.4). По умолчанию rec, lis, pro. */
  cardsOf?: (item: string) => readonly CardType[];
  /** Кластеры слова или пары (vocab.clusters, pair.cluster): для точности по кластеру (§4.3). */
  clustersOf?: (item: string) => readonly string[];
  /** Кластер → id минимальных пар в порядке phonetics.json. */
  pairsByCluster?: Readonly<Record<string, readonly string[]>>;
  /** Кластер → ремонтный урок (phonetics.clusters[].repairLesson). */
  repairLessons?: Readonly<Record<string, string>>;
}

export interface ResultStat {
  /** Первый момент, когда сдано. */
  passedAt?: Ts;
  /** Лучший score. */
  best: number;
  attempts: number;
}

export interface Derived {
  today: Day;
  /** Начало сегодняшнего игрового дня (04:00). */
  todayStart: Ts;
  /** Уроки с итогом: id → статистика (после renames). */
  lessons: Record<string, ResultStat>;
  /** Сданные уроки (атом условий `lessonDone`). */
  lessonsDone: ReadonlySet<string>;
  /** Боссы: id → статистика (атом `bossPassed` = passedAt есть). */
  bossResults: Record<string, ResultStat>;
  /** Статистика по игровым дням. */
  days: Record<Day, DayStats>;
  /** Засчитанных игровых дней (атом `daysPlayed`). */
  daysPlayed: number;
  lastPlayedDay: Day | null;
  /** Дней с прошлого засчитанного дня до сегодня (атом `daysSinceLast`); null, если не играл. */
  daysSinceLast: number | null;
  /** Секреты, найденные хотя бы раз (атом `found`). */
  found: ReadonlySet<string>;
  /** Карточки после renames: `${item}#${type}` → состояние SRS (§4.1). */
  cards: Record<CardId, CardState>;
  /** |due ≤ now| без фонетики (§4.2). */
  debt: number;
  /** Новых слов, введённых в игровой день (по первому `intro`, §4.2). */
  newItemsByDay: Record<Day, number>;
  /** Карточка `pair` → кластер (для фонетической очереди). */
  pairCluster: Record<CardId, string>;
  clusterStatus: Record<string, ClusterStatus>;
  /** Точность по кластеру в последней диагностике (ok / n), 0..1; «самый красный» кластер первого дня (§5.0 F4–F5). */
  clusterScore: Record<string, number>;
  // ── Заглушки, заполняются в следующих итерациях.
  zloty: number; // I-18
  pierogi: number; // I-18
  hearts: Record<string, number>; // I-19
  jars: Record<string, { matured: boolean; full: boolean }>; // I-19
  metrics: Record<string, number>; // I-38
}

/** Отрезки, после которых день засчитан (§4.8: раунд обхода, сцена, экспресс и т.п.; сон без дела — нет). */
const COUNTED_SEGS = new Set(['water', 'remedy', 'scene', 'evening', 'express', 'more3']);

/** День засчитан (§4.8): был итог урока или завершённый отрезок, кроме сна. */
export function isPlayedDay(s: DayStats | undefined): boolean {
  return !!s && (s.lessons > 0 || s.segs.some((g) => COUNTED_SEGS.has(g)));
}

export const WORD_CARDS: readonly CardType[] = ['rec', 'lis', 'pro'];
/** Фразы длиннее этого по умолчанию без `pro` (§3.4). */
export const PHRASE_NO_PRO_LEN = 25;
/** Карточки, которые создаёт `intro` (§4.1); `pro` открывается порогом. */
const INTRO_CARDS: readonly CardType[] = ['rec', 'lis'];

/** Типы карточек слова по §3.4: `srs: false` → нет; `cards` или по умолчанию rec/lis/pro (длинная фраза без pro). */
export function wordCards(v: Pick<VocabEntry, 'srs' | 'cards' | 'pl'>): readonly CardType[] {
  if (!v.srs) return [];
  return v.cards ?? (v.pl.length > PHRASE_NO_PRO_LEN ? ['rec', 'lis'] : WORD_CARDS);
}

/** Свернуть полный контент в то, что читает derive. */
export function deriveContent(c: Content): DeriveContent {
  const pairsByCluster: Record<string, string[]> = {};
  for (const p of c.phonetics.pairs) (pairsByCluster[p.cluster] ??= []).push(p.id);
  const repairLessons: Record<string, string> = {};
  for (const cl of c.phonetics.clusters) if (cl.repairLesson) repairLessons[cl.id] = cl.repairLesson;
  return {
    dayStartHour: c.tuning.dayStartHour,
    renames: Object.fromEntries(c.renames),
    tuning: c.tuning,
    cardsOf: (item) => {
      const v = c.vocab.get(item)?.value;
      return v ? wordCards(v) : WORD_CARDS;
    },
    clustersOf: (item) => {
      const v = c.vocab.get(item)?.value;
      if (v) return v.clusters ?? [];
      const p = c.pairs.get(item);
      return p ? [p.cluster] : [];
    },
    pairsByCluster,
    repairLessons,
  };
}

export function derive(p: Progress, content: DeriveContent, now: Ts, tz?: string): Derived {
  const t = content.tuning ?? DEFAULT_TUNING;
  const opts: TimeOpts = { dayStartHour: content.dayStartHour ?? content.tuning?.dayStartHour ?? DEFAULT_DAY_START_HOUR, tz };
  const ren = content.renames ?? {};
  const rename = (id: string): string => ren[id] ?? id;
  const renameCard = (id: CardId): CardId => {
    const c = parseCardId(id);
    return c ? cardId(rename(c.item), c.type) : id;
  };
  const cardsOf = content.cardsOf ?? (() => WORD_CARDS);
  const clustersOf = content.clustersOf ?? (() => []);
  const pairsByCluster = content.pairsByCluster ?? {};
  const repairLessons = content.repairLessons ?? {};
  const repairCluster = new Map(Object.entries(repairLessons).map(([cl, lesson]) => [rename(lesson), cl]));
  const cp = p.log.checkpoint;

  const lessons: Record<string, ResultStat> = {};
  const bosses: Record<string, ResultStat> = {};
  const days: Record<Day, DayStats> = {};
  const found = new Set<string>();
  const cards: Record<CardId, CardState> = {};
  const newItemsByDay: Record<Day, number> = {};
  const pairCluster: Record<CardId, string> = {};
  // Кластеры (§4.3): последняя диагностика, сданный ремонт после неё, точность по дням после неё.
  let lastDiag: EventOf<'diag'> | null = null;
  let lastDiagTs = -Infinity;
  const repairPassedAt: Record<string, Ts> = {};
  let clusterDays: Record<string, Record<Day, { ok: number; n: number }>> = {};

  if (cp) {
    for (const [id, s] of Object.entries(cp.lessons)) mergeStat(lessons, rename(id), s.best, s.passedAt, 0);
    for (const [id, s] of Object.entries(cp.bosses)) mergeStat(bosses, rename(id), s.best, s.passedAt, 0);
    for (const [d, s] of Object.entries(cp.days)) days[d] = { segs: [...s.segs], revs: s.revs, lessons: s.lessons };
    for (const id of Object.keys(cp.cards).sort()) {
      const nid = renameCard(id);
      if (!cards[nid]) cards[nid] = { ...cp.cards[id]! };
    }
    for (const id of Object.keys(cards)) {
      const c = parseCardId(id);
      if (c?.type === 'rec') openProduction(c.item, cp.asOf);
    }
  }

  // Карточки зависят от порядка: идём по (ts, id), даже если вход перемешан.
  const events = isSorted(p.log.events) ? p.log.events : [...p.log.events].sort(compareEvents);
  for (const e of events) applyEvent(e);

  function dayStats(ts: Ts): DayStats {
    const d = dayOf(ts, opts);
    return (days[d] ??= { segs: [], revs: 0, lessons: 0 });
  }

  /** Порог продукции (§4.1): `pro` появляется, когда rec.reps ≥ productionAfterReps. due — следующий игровой день. */
  function openProduction(item: string, ts: Ts): void {
    const rec = cards[cardId(item, 'rec')];
    const pro = cardId(item, 'pro');
    if (!rec || cards[pro] || rec.reps < t.productionAfterReps || !cardsOf(item).includes('pro')) return;
    cards[pro] = { ...fresh(ts), due: dayStartAfter(ts, 1, opts) };
  }

  function applyRev(e: Extract<LogEvent, { k: 'rev' }>): void {
    const id = renameCard(e.card);
    const c = parseCardId(id);
    if (c) {
      const day = dayOf(e.ts, opts);
      for (const cl of clustersOf(c.item)) {
        const tally = ((clusterDays[cl] ??= {})[day] ??= { ok: 0, n: 0 });
        tally.n++;
        if (e.g >= 2) tally.ok++;
      }
    }
    const card = cards[id];
    if (!card || e.ts <= card.lastReviewAt) return; // нет карточки или опоздавшее событие (§3.12)
    // Тот же фильтр, что у append: ранний ответ SRS не двигает. Нужен при слиянии двух устройств,
    // когда обе ответили по одной due-карточке офлайн: второй ответ уже ранний.
    const verdict = revVerdict({ due: card.due, now: e.ts, src: e.src, earlyDays: orderEarlyDays(card, t.orders.earlyDays), opts });
    if (verdict !== 'ok') return;
    cards[id] = review(card, e.g, e.ts, t, id, opts);
    if (c?.type === 'rec') openProduction(c.item, e.ts);
  }

  function applyIntro(e: Extract<LogEvent, { k: 'intro' }>): void {
    const item = rename(e.item);
    const types = cardsOf(item).filter((x) => INTRO_CARDS.includes(x));
    let created = false;
    for (const type of types) {
      const id = cardId(item, type);
      if (cards[id]) continue; // слово уже введено (сцена пройдена на другом устройстве)
      const ok = e.ok.includes(type);
      cards[id] = { ...fresh(e.ts), due: dayStartAfter(e.ts, 1, opts), ...(ok ? { reps: 1, interval: 1, maxInterval: 1, lastGrade: 2 as const } : {}) };
      created = true;
    }
    if (created) {
      const d = dayOf(e.ts, opts);
      newItemsByDay[d] = (newItemsByDay[d] ?? 0) + 1;
    }
    openProduction(item, e.ts);
  }

  function applyImp(e: Extract<LogEvent, { k: 'imp' }>): void {
    const id = renameCard(e.card);
    if (cards[id]) return; // игра уже знает карточку: её история важнее импорта
    const s = e.state;
    cards[id] = { ...fresh(e.ts), reps: s.reps, interval: s.interval, ef: s.ef, due: s.due, maxInterval: s.interval, lastGrade: s.reps > 0 ? 2 : 0 };
    const c = parseCardId(id);
    if (c?.type === 'rec') openProduction(c.item, e.ts);
  }

  function applyDiag(e: EventOf<'diag'>): void {
    lastDiag = e;
    lastDiagTs = e.ts;
    clusterDays = {}; // закрытие кластера считается после последней диагностики
    for (const [cl, r] of Object.entries(e.results)) {
      const s = statusOf(r);
      if (s !== 'red' && s !== 'yellow') continue;
      for (const mp of (pairsByCluster[cl] ?? []).slice(0, t.clusters.pairsPerCluster)) {
        const id = cardId(mp, 'pair');
        if (!cards[id]) cards[id] = fresh(e.ts);
      }
    }
  }

  function statusOf(r: { ok: number; n: number } | undefined): ClusterStatus {
    if (!r || r.n <= 0) return 'unknown';
    const score = r.ok / r.n;
    return score >= t.clusters.green ? 'green' : score >= t.clusters.yellow ? 'yellow' : 'red';
  }

  function applyEvent(e: LogEvent): void {
    switch (e.k) {
      case 'lesson': {
        const id = rename(e.lesson);
        mergeStat(lessons, id, e.score, e.passed ? e.ts : undefined, 1);
        dayStats(e.ts).lessons++;
        const cl = repairCluster.get(id);
        if (cl && e.passed) repairPassedAt[cl] = e.ts;
        break;
      }
      case 'boss':
        mergeStat(bosses, rename(e.lesson), e.score, e.passed ? e.ts : undefined, 1);
        dayStats(e.ts).lessons++;
        break;
      case 'rev':
        dayStats(e.ts).revs++;
        applyRev(e);
        break;
      case 'intro':
        applyIntro(e);
        break;
      case 'imp':
        applyImp(e);
        break;
      case 'diag':
        applyDiag(e);
        break;
      case 'seg': {
        const s = dayStats(e.ts);
        if (!s.segs.includes(e.seg)) s.segs.push(e.seg);
        break;
      }
      case 'found':
        found.add(e.secret);
        break;
      default:
        break; // остальные виды учитываются в следующих итерациях
    }
  }

  // Порядок отрезков внутри дня зависит от порядка событий: нормализуем для детерминизма.
  for (const s of Object.values(days)) s.segs.sort();

  const played = Object.entries(days)
    .filter(([, s]) => isPlayedDay(s))
    .map(([d]) => d)
    .sort();
  const today = dayOf(now, opts);
  const last = played.length ? played[played.length - 1]! : null;

  // Статус кластеров (§4.3).
  const clusterStatus: Record<string, ClusterStatus> = {};
  const diag = lastDiag as EventOf<'diag'> | null;
  const clusterScore: Record<string, number> = {};
  for (const [cl, r] of Object.entries(diag?.results ?? {})) if (r.n > 0) clusterScore[cl] = Math.round((r.ok / r.n) * 1000) / 1000;
  const allClusters = new Set([...Object.keys(pairsByCluster), ...Object.keys(repairLessons), ...Object.keys(diag?.results ?? {})]);
  for (const cl of [...allClusters].sort()) {
    let s = statusOf(diag?.results[cl]);
    if (s === 'red' && (repairPassedAt[cl] ?? -Infinity) > lastDiagTs) s = 'yellow';
    // Диагностику прервали до пункта кластера (P-06): его проверяет ремонтная сцена; сдал — как после красного.
    if (s === 'unknown' && diag && (repairPassedAt[cl] ?? -Infinity) > lastDiagTs) s = 'yellow';
    if (s === 'red' || s === 'yellow') {
      const good = Object.values(clusterDays[cl] ?? {}).filter(
        (x) => x.n >= t.clusters.closeMinAnswers && x.ok / x.n >= t.clusters.closeScore,
      ).length;
      if (good >= t.clusters.closeDays) s = 'green';
    }
    clusterStatus[cl] = s;
  }

  // Без звука (P-06, СЮЖЕТ_v2 §7): карточки «на слух» не просрочиваются и не идут в полив, пока звук выключен.
  // Без звука (P-10b): карточки «на слух» остаются и в полив идут чтением (транскрипция → написание), см. ui/obchod.ts.

  let debt = 0;
  for (const [id, c] of Object.entries(cards)) {
    const parsed = parseCardId(id);
    if (parsed?.type === 'pair') {
      const cl = clustersOf(parsed.item)[0] ?? Object.keys(pairsByCluster).find((k) => pairsByCluster[k]!.includes(parsed.item));
      if (cl) pairCluster[id] = cl;
    } else if (c.due <= now) debt++;
  }

  return {
    today,
    todayStart: dayStart(now, opts),
    lessons,
    lessonsDone: new Set(Object.entries(lessons).filter(([, s]) => s.passedAt !== undefined).map(([id]) => id)),
    bossResults: bosses,
    days,
    daysPlayed: played.length,
    lastPlayedDay: last,
    daysSinceLast: last ? daysBetween(last, today) : null,
    found,
    cards,
    debt,
    newItemsByDay,
    pairCluster,
    clusterStatus,
    clusterScore,
    zloty: 0,
    pierogi: 0,
    hearts: {},
    jars: {},
    metrics: {},
  };
}

/**
 * Фильтр ранних ответов для `append` (§3.11, §4.1): due карточки из Derived, исключение заказов
 * для зрелых слов (§4.13). `append(p, dev, draft, appendGate(derived, tuning, tz))`.
 */
export function appendGate(d: Pick<Derived, 'cards'>, t: Pick<Tuning, 'orders' | 'dayStartHour'>, tz?: string): AppendOpts {
  return {
    dueOf: (c) => d.cards[c]?.due,
    earlyDaysOf: (c) => orderEarlyDays(d.cards[c], t.orders.earlyDays),
    time: { dayStartHour: t.dayStartHour, tz },
  };
}

function mergeStat(map: Record<string, ResultStat>, id: string, score: number, passedAt: Ts | undefined, attempts: number): void {
  const cur = (map[id] ??= { best: score, attempts: 0 });
  cur.best = Math.max(cur.best, score);
  cur.attempts += attempts;
  if (passedAt !== undefined && (cur.passedAt === undefined || passedAt < cur.passedAt)) cur.passedAt = passedAt;
}
