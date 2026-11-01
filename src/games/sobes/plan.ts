// «Связка» — механика заучивания готовых текстов (D-88, ТЗ `бобер/ТЗ-связки.md`, прототип `бобер/прототип-связки.html`).
// 2–3 вопроса читаются вместе (карточки на экране выбора), потом вспоминаются вперемешку лесенкой из трёх ступеней:
// «собери» (A) → «что дальше» (B) → «скажи вслух» (сам). Один и тот же вопрос два раза подряд не идёт; ошибка — повтор не раньше
// чем через два задания, один раз. «Повторить» — вечер без опоры: сразу «скажи вслух» без сути, узнавание только тому, что не собралось.
// Чистая логика без DOM: очередь отдаёт задания движку (`PolskaGame.queue`), движок пишет ответы в огород как обычно.
import type { GameCtx, GameQueue, PolskaUnit } from '../../types/polska';
import { shuffle } from '../kit';
import { chunksOf, makeStep, type SobesKind, type SobesTask } from './tasks';

/** Ответ из стольких кусков и длиннее — «длинный»: в связке из двух, собирается двумя окнами, два стыка. */
export const LONG = 6;
/** Сумма кусков связки из трёх вопросов. */
export const MAXC = 11;

/** Похожие вопросы новыми в одну связку не ставим — путаются; вместе они встречаются только в повторе (список ведёт Методолог). */
export const KIN: readonly (readonly string[])[] = [
  ['ans.119', 'ans.121'],
  ['ans.90', 'ans.92', 'ans.94'],
  ['ans.12', 'ans.104'],
  ['ans.1', 'ans.2', 'ans.190'],
  ['ans.191', 'ans.77'],
];
export const kin = (a: string, b: string): boolean => KIN.some((g) => g.includes(a) && g.includes(b));

const len = (ctx: GameCtx, id: string): number => {
  const u = ctx.unit(id);
  return u ? chunksOf(u).length : 0;
};

/**
 * Связка из кандидатов по порядку: 3 вопроса, пока сумма кусков ≤ MAXC; с длинным ответом — 2. `avoidKin` — не ставить похожие вместе.
 * Из одного вопроса связки не бывает: к одиночному добирается знакомый (`known`), потом любой из `rest`.
 */
export function fitBundle(ctx: GameCtx, ids: readonly string[], opts: { avoidKin?: boolean; known?: readonly string[]; rest?: readonly string[] } = {}): string[] {
  const out: string[] = [];
  let sum = 0;
  for (const id of ids) {
    const n = len(ctx, id);
    if (n < 2) continue;
    const cap = out.some((x) => len(ctx, x) >= LONG) || n >= LONG ? 2 : 3;
    if (out.length >= cap) continue;
    if (opts.avoidKin && out.some((x) => kin(x, id))) continue;
    if (out.length && sum + n > MAXC && !(n >= LONG && out.length === 1)) continue;
    out.push(id);
    sum += n;
    if (out.length >= 3) break;
  }
  if (out.length === 1) {
    const one = out[0]!;
    const ok = (id: string): boolean => id !== one && !kin(id, one) && len(ctx, id) >= 2;
    const fits = (xs: readonly string[]): string[] =>
      xs.filter(ok).filter((id) => len(ctx, one) + len(ctx, id) <= MAXC + 2).sort((a, b) => len(ctx, a) - len(ctx, b));
    const add = fits(opts.known ?? [])[0] ?? fits(opts.rest ?? [])[0] ?? (opts.rest ?? []).find(ok);
    if (add) out.push(add);
  }
  return out;
}

/** Что откроет следующая связка: режим и вопросы. Ставит экран выбора перед `begin`, читает `queue`. */
export type BundleMode = 'new' | 'review';
let pending: BundleMode = 'new';
export const setMode = (m: BundleMode): void => {
  pending = m;
};
export const modeNow = (): BundleMode => pending;

interface Step {
  id: string;
  kind: SobesKind;
  part?: 0 | 1;
  bare?: boolean;
  retry?: boolean;
}

/** Ход по ступеням лесенки; ступень → очередь шагов. */
export class Ladder implements GameQueue<SobesTask> {
  readonly ids: readonly string[];
  readonly mode: BundleMode;
  private stages: Step[][];
  private si = 0;
  private queue: Step[] = [];
  private lastId: string | null = null;
  private started = false;
  plan = 0;
  extra = 0;
  done = 0;
  /** Последняя самооценка «скажи вслух» по вопросу. */
  readonly grades = new Map<string, 'said' | 'hint' | 'no'>();

  constructor(
    private readonly ctx: GameCtx,
    ids: readonly string[],
    mode: BundleMode,
    /** Кого читали первым: с него начинается лесенка (последний прочитанный ещё в короткой памяти). */
    private readonly first: string | null = ids[0] ?? null,
  ) {
    this.ids = ids;
    this.mode = mode;
    const long = (id: string): boolean => len(ctx, id) >= LONG;
    const expand = (xs: readonly string[], kind: SobesKind): Step[] => xs.flatMap((id) => (long(id) ? [{ id, kind, part: 0 as const }, { id, kind, part: 1 as const }] : [{ id, kind }]));
    this.stages =
      mode === 'review'
        ? [ids.map((id) => ({ id, kind: 'say' as const, bare: true })), [], []]
        : [expand(ids.filter((id) => len(ctx, id) >= 3), 'order'), expand(ids, 'next'), ids.map((id) => ({ id, kind: 'say' as const }))];
    this.plan = this.stages.reduce((a, s) => a + s.length, 0);
  }

  /** Номер ступени (0–2) текущего задания. */
  get stage(): number {
    return this.si;
  }

  private openStage(first: boolean): boolean {
    if (!first) this.si++;
    while (this.si < 3 && !this.stages[this.si]!.length) this.si++;
    if (this.si >= 3) return false;
    const q = shuffle(this.stages[this.si]!, this.ctx.rand);
    if (first && this.first) {
      const i = q.findIndex((t) => t.id === this.first);
      if (i > 0) q.unshift(q.splice(i, 1)[0]!);
    } else if (q.length > 1 && q[0]!.id === this.lastId) q.push(q.shift()!);
    // Две части длинного ответа не подряд, если есть чем разбавить.
    for (let i = 1; i < q.length; i++) {
      if (q[i]!.id !== q[i - 1]!.id) continue;
      const j = q.findIndex((t, x) => x > i && t.id !== q[i]!.id);
      if (j > 0) [q[i], q[j]] = [q[j]!, q[i]!];
    }
    this.queue = q;
    return true;
  }

  next(): SobesTask | null {
    for (let guard = 0; guard < 20; guard++) {
      if (!this.started) {
        this.started = true;
        if (!this.openStage(true)) return null;
      } else if (!this.queue.length && !this.openStage(false)) return null;
      let i = 0;
      if (this.queue.length > 1 && this.queue[0]!.id === this.lastId) i = Math.max(0, this.queue.findIndex((t) => t.id !== this.lastId));
      const s = this.queue.splice(i, 1)[0]!;
      const t = makeStep(this.ctx, s.id, s.kind, { part: s.part, bare: s.bare, retry: s.retry, bundle: this.ids });
      if (!t) continue;
      this.lastId = s.id;
      return t;
    }
    return null;
  }

  /** Повтор не раньше чем через два задания: если в ступени их меньше — в начало следующей (после двух её заданий). */
  private retry(t: SobesTask): void {
    if (t.retry) return;
    this.extra++;
    const r: Step = { id: t.id, kind: t.kind, retry: true, ...(t.part !== undefined ? { part: t.part } : {}) };
    if (this.queue.length >= 2 || this.si >= 2) this.queue.push(r);
    else {
      const nx = this.stages[this.si + 1]!;
      nx.splice(Math.min(2, nx.length), 0, r);
    }
  }

  answered(t: SobesTask, ok: boolean, answer: unknown): void {
    this.done++;
    if (t.kind === 'say') {
      const g = String(answer) as 'said' | 'hint' | 'no';
      this.grades.set(t.id, g);
      if (g !== 'no') return;
      // Повтор без опоры не собрался: образец, потом «что дальше» и «скажи» с сутью — по этому вопросу.
      if (t.bare) {
        this.stages[1]!.push({ id: t.id, kind: 'next' });
        this.stages[2]!.push({ id: t.id, kind: 'say' });
        this.extra += 2;
      } else this.retry(t);
      return;
    }
    if (!ok) this.retry(t);
  }

  counter(): string {
    const n = Math.min(this.done + 1, this.plan + this.extra);
    return `${n} / ${this.plan}${this.extra ? ` · +${this.extra}` : ''}`;
  }
}

/** Новые (ещё не читанные) по порядку пула, похожие не вместе. */
export function newBundle(ctx: GameCtx, pool: readonly string[]): string[] {
  // «Новый» = ещё не читан карточкой (`seen`): экран выбора досаживает пул сам, посадка — не знакомство.
  const fresh = pool.filter((id) => !ctx.seen(id));
  const known = pool.filter((id) => ctx.seen(id));
  return fitBundle(ctx, fresh, { avoidKin: true, known, rest: fresh });
}

/** Кому пора повторить: читанные, посаженные и не собранные (или перезревшие); вперёд те, кто ни разу не был сказан сам, потом меньше дней. */
export function dueIds(ctx: GameCtx, pool: readonly string[]): string[] {
  return pool
    .filter((id) => {
      const i = ctx.info(id);
      return ctx.seen(id) && i.planted && (i.harvests === 0 || i.stage === 'overripe');
    })
    .sort((a, b) => {
      const x = ctx.info(a);
      const y = ctx.info(b);
      return Number(x.selfOk) - Number(y.selfOk) || x.days - y.days;
    });
}

export const reviewBundle = (ctx: GameCtx, pool: readonly string[]): string[] => {
  const due = dueIds(ctx, pool);
  return fitBundle(ctx, due, { known: due, rest: pool });
};

/** Перед повтором карточкой открываются те, кто ещё ни разу не был сказан сам. */
export const reviewReads = (ctx: GameCtx, ids: readonly string[]): string[] => ids.filter((id) => !ctx.info(id).selfOk);

export type { PolskaUnit };
