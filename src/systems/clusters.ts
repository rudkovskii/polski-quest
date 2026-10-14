// Кластеры R1–R10 (ТЗ §4.3, §5.8, I-11): чистые функции поверх шагов урока и `derive().clusterStatus`.
// Статус кластера по журналу считает derive.ts; здесь — то, что нужно уроку и боссу:
//   • кластер шага и подсчёт ответов по кластерам (событие `diag` сцены 1.0, `boss.clusters`);
//   • какой вариант ремонтной сцены играть (green → пропуск, yellow → short, red → полная);
//   • итог босса: взвешенный score по частям, порог красных кластеров, какие части повторить.
import type { Step } from '../types/content';
import type { ClusterStatus } from './derive';

/** Ответы по кластеру: `ok` — сумма score первых попыток (0..1 за шаг), `n` — число шагов. */
export type Tally = Record<string, { ok: number; n: number }>;

/** Кластер шага: `step.cluster`, иначе первый кластер слова или пары из `item`. null — шаг без кластера. */
export function stepCluster(step: Step, clustersOf?: (item: string) => readonly string[]): string | null {
  if (step.cluster) return step.cluster;
  if (step.item && clustersOf) return clustersOf(step.item)[0] ?? null;
  return null;
}

/** Сложить ответы по кластерам. Шаги без кластера пропускаются. */
export function tallyOf(entries: Iterable<{ cluster: string | null; score: number }>): Tally {
  const t: Tally = {};
  for (const { cluster, score } of entries) {
    if (!cluster) continue;
    const x = (t[cluster] ??= { ok: 0, n: 0 });
    x.ok = round3(x.ok + Math.max(0, Math.min(1, score)));
    x.n++;
  }
  return t;
}

export function mergeTally(...ts: readonly (Tally | undefined)[]): Tally {
  const out: Tally = {};
  for (const t of ts)
    for (const [cl, { ok, n }] of Object.entries(t ?? {})) {
      const x = (out[cl] ??= { ok: 0, n: 0 });
      x.ok = round3(x.ok + ok);
      x.n += n;
    }
  return out;
}

/** Точность по кластеру, 0..1 (кластеры без ответов не попадают). */
export function tallyScores(t: Tally): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cl of Object.keys(t).sort()) if (t[cl]!.n > 0) out[cl] = round3(t[cl]!.ok / t[cl]!.n);
  return out;
}

export type RepairVariant = 'locked' | 'skip' | 'short' | 'full';

/**
 * Вариант ремонтной сцены 1.1–1.10 по статусу её кластера (§4.3): до диагностики закрыта, green —
 * пропуск, yellow — короткая версия (`short.steps`), red — полная.
 */
export function repairVariant(status: ClusterStatus | undefined): RepairVariant {
  if (!status || status === 'unknown') return 'locked';
  return status === 'green' ? 'skip' : status === 'yellow' ? 'short' : 'full';
}

/** Индексы шагов варианта: short — `short.steps` (по порядку, без дублей), иначе все. */
export function variantSteps(n: number, variant: RepairVariant, short?: readonly number[]): number[] {
  if (variant === 'skip' || variant === 'locked') return [];
  if (variant === 'short' && short?.length) return [...new Set(short)].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  return [...Array(n).keys()];
}

// ── Босс (§5.8).

export const DEFAULT_BOSS_SCORE = 0.8;
/**
 * Кластер решает судьбу босса, только если по нему ≥ 2 ответов [выбор I-11]: один промах в
 * единственном шаге кластера не должен ронять босс при 95 % в целом. Порог в контенте — `pass.redClusterMin`.
 */
export const BOSS_CLUSTER_MIN_ANSWERS = 2;

export interface BossPartDef {
  id: string;
  weight?: number;
}

export interface BossVerdictInput {
  parts: readonly BossPartDef[];
  /** Часть → score 0..1. Части без результата считаются 0. */
  scores: Readonly<Record<string, number>>;
  /** Часть → ответы по кластерам (у частей, перенесённых из прошлой попытки, может не быть). */
  tallies: Readonly<Record<string, Tally | undefined>>;
  /** Статусы кластеров на момент босса (`derive().clusterStatus`). */
  status: Readonly<Record<string, ClusterStatus>>;
  pass?: { score?: number; redClusterMin?: number };
  minAnswers?: number;
}

export interface BossVerdict {
  /** Σ weight × score(part) / Σ weight. */
  score: number;
  passed: boolean;
  /** Точность по кластерам за попытку (в событие `boss.clusters`). */
  clusters: Record<string, number>;
  /** Красные кластеры ниже `redClusterMin`. */
  redFailed: string[];
  /** Что повторить: части ниже порога и части со шагами проваленного красного кластера. Пусто, если сдан. */
  failedParts: string[];
}

export function bossVerdict(i: BossVerdictInput): BossVerdict {
  const passScore = i.pass?.score ?? DEFAULT_BOSS_SCORE;
  const redMin = i.pass?.redClusterMin;
  const minN = i.minAnswers ?? BOSS_CLUSTER_MIN_ANSWERS;
  let total = 0;
  let wsum = 0;
  for (const p of i.parts) {
    const w = p.weight ?? 1;
    total += w * (i.scores[p.id] ?? 0);
    wsum += w;
  }
  const score = round3(wsum > 0 ? total / wsum : 0);
  const all = mergeTally(...i.parts.map((p) => i.tallies[p.id]));
  const clusters = tallyScores(all);
  const redFailed =
    redMin === undefined
      ? []
      : Object.keys(all)
          .filter((cl) => i.status[cl] === 'red' && all[cl]!.n >= minN && all[cl]!.ok / all[cl]!.n < redMin)
          .sort();
  const passed = score >= passScore && redFailed.length === 0;
  if (passed) return { score, passed, clusters, redFailed, failedParts: [] };
  const failed = i.parts
    .filter((p) => {
      if ((i.scores[p.id] ?? 0) < passScore) return true;
      // Часть со шагами проваленного красного кластера повторяется целиком (тот же критерий у bossPlan по журналу).
      const t = i.tallies[p.id];
      return redFailed.some((cl) => (t?.[cl]?.n ?? 0) > 0);
    })
    .map((p) => p.id);
  return { score, passed, clusters, redFailed, failedParts: failed.length ? failed : i.parts.map((p) => p.id) };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
