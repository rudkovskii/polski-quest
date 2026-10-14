// Производное состояние (ТЗ §3.10): чистая функция checkpoint + events → Derived. Не хранится и не синкается.
// Каркас I-04: уроки, боссы, игровые дни. Карточки и `pro` — I-05, экономика — I-18, сердца/банки — I-19,
// кластеры — I-11, метрики — I-38. Результат не зависит от порядка событий во входе.
import type { LogEvent } from './log';
import type { CardId, CardState, DayStats, Progress } from './progress';
import { daysBetween, dayOf, DEFAULT_DAY_START_HOUR, type Day, type TimeOpts, type Ts } from './time';

/**
 * Срез контента, нужный выводу. Полный тип контента появится в I-02 (`src/types/content.d.ts`);
 * здесь только поля, которые derive уже читает.
 */
export interface DeriveContent {
  /** tuning.dayStartHour, по умолчанию 4. */
  dayStartHour?: number;
  /** Объединённые `module.renames` всех модулей: старый id → новый (§3.12). */
  renames?: Readonly<Record<string, string>>;
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
  // ── Заглушки, заполняются в следующих итерациях.
  cards: Record<CardId, CardState>; // I-05
  debt: number; // I-05
  clusterStatus: Record<string, 'green' | 'yellow' | 'red' | 'unknown'>; // I-11
  zloty: number; // I-18
  pierogi: number; // I-18
  hearts: Record<string, number>; // I-19
  jars: Record<string, { matured: boolean; full: boolean }>; // I-19
  metrics: Record<string, number>; // I-38
}

/** Отрезки, после которых день засчитан (§4.8: раунд обхода, сцена, экспресс и т.п.; сон без дела — нет). */
const COUNTED_SEGS = new Set(['water', 'remedy', 'scene', 'evening', 'express', 'more3']);

export function derive(p: Progress, content: DeriveContent, now: Ts, tz?: string): Derived {
  const opts: TimeOpts = { dayStartHour: content.dayStartHour ?? DEFAULT_DAY_START_HOUR, tz };
  const ren = content.renames ?? {};
  const rename = (id: string): string => ren[id] ?? id;
  const cp = p.log.checkpoint;

  const lessons: Record<string, ResultStat> = {};
  const bosses: Record<string, ResultStat> = {};
  const days: Record<Day, DayStats> = {};
  const found = new Set<string>();

  if (cp) {
    for (const [id, s] of Object.entries(cp.lessons)) mergeStat(lessons, rename(id), s.best, s.passedAt, 0);
    for (const [id, s] of Object.entries(cp.bosses)) mergeStat(bosses, rename(id), s.best, s.passedAt, 0);
    for (const [d, s] of Object.entries(cp.days)) days[d] = { segs: [...s.segs], revs: s.revs, lessons: s.lessons };
  }

  for (const e of p.log.events) applyEvent(e);

  function dayStats(ts: Ts): DayStats {
    const d = dayOf(ts, opts);
    return (days[d] ??= { segs: [], revs: 0, lessons: 0 });
  }

  function applyEvent(e: LogEvent): void {
    switch (e.k) {
      case 'lesson':
        mergeStat(lessons, rename(e.lesson), e.score, e.passed ? e.ts : undefined, 1);
        dayStats(e.ts).lessons++;
        break;
      case 'boss':
        mergeStat(bosses, rename(e.lesson), e.score, e.passed ? e.ts : undefined, 1);
        dayStats(e.ts).lessons++;
        break;
      case 'rev':
        dayStats(e.ts).revs++;
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
    .filter(([, s]) => s.lessons > 0 || s.segs.some((g) => COUNTED_SEGS.has(g)))
    .map(([d]) => d)
    .sort();
  const today = dayOf(now, opts);
  const last = played.length ? played[played.length - 1]! : null;

  return {
    today,
    lessons,
    lessonsDone: new Set(Object.entries(lessons).filter(([, s]) => s.passedAt !== undefined).map(([id]) => id)),
    bossResults: bosses,
    days,
    daysPlayed: played.length,
    lastPlayedDay: last,
    daysSinceLast: last ? daysBetween(last, today) : null,
    found,
    cards: {},
    debt: 0,
    clusterStatus: {},
    zloty: 0,
    pierogi: 0,
    hearts: {},
    jars: {},
    metrics: {},
  };
}

function mergeStat(map: Record<string, ResultStat>, id: string, score: number, passedAt: Ts | undefined, attempts: number): void {
  const cur = (map[id] ??= { best: score, attempts: 0 });
  cur.best = Math.max(cur.best, score);
  cur.attempts += attempts;
  if (passedAt !== undefined && (cur.passedAt === undefined || passedAt < cur.passedAt)) cur.passedAt = passedAt;
}
