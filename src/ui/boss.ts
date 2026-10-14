// Экран босса (ТЗ §5.8, I-11): урок с частями `parts`. Части идут по порядку, без подсказок и без
// повтора ошибок в конце; после каждой части результат лежит в `local.resume` (прервать можно между
// частями, хранится 7 дней). Итог: score = Σ weight × score(part) / Σ weight; сдан, если score ≥ pass.score
// (0.8) и каждый красный кластер ≥ pass.redClusterMin (гл. 1: 0.6). Не сдан → событие `boss` с частями,
// и следующая попытка (в пределах 7 дней) играет только проваленные части, сданные берутся из журнала.
// Награды (module.onComplete, reward) применяет склейка (play.ts) по `ui:lesson:end`; здесь — печать на экране итога.
import type { Check } from '../systems/answer';
import { bossVerdict, DEFAULT_BOSS_SCORE, stepCluster, tallyOf, type Tally } from '../systems/clusters';
import type { Content } from '../systems/content';
import { appendGate, derive, deriveContent } from '../systems/derive';
import { gradeFromAnswer, type StepKind } from '../systems/grade';
import type { EventDraft, LogEvent } from '../systems/log';
import { getSetting, type CardId, type LocalState, type Progress } from '../systems/progress';
import type { Lesson, Step } from '../types/content';
import type { LessonResult } from '../types/bus';
import { el } from './dom';
import { mountStep } from './exercises/registry';
import type { ExerciseCtx, StepResult } from './exercises/types';
import { cardsOfStep, exerciseContent, lineSpeech, type LessonDeps, type RunOptions } from './lesson';
import type { IntentHandler, Layer } from './overlay/host';
import { BTN, btn, plBtn, portrait, react, type PlLabel } from './overlay/kit';
import { isSilent } from '../systems/sound';

/** Сколько дней живут результаты частей (resume и прошлая несданная попытка), §5.8. */
export const BOSS_KEEP_DAYS = 7;
const DAY = 86_400_000;

/** Результат части в попытке (в `local.resume.answers`). */
export interface BossPartRecord {
  part: string;
  score: number;
  /** Ответы по кластерам; у частей из прошлой попытки (журнал) пусто. */
  tally: Tally;
  ms: number;
}

export interface BossPlanInput {
  parts: readonly { id: string }[];
  passScore: number;
  /** Босс уже сдан раньше: повторный прогон целиком (тренировка), прошлые части не берём. */
  passedBefore: boolean;
  /** Последнее событие `boss` этого урока. */
  last: { ts: number; parts: Record<string, number>; passed: boolean; clusters?: Record<string, number> } | null;
  /** Красные кластеры, проваленные в прошлой попытке (ниже redClusterMin): части с их шагами повторяются. */
  redFailed?: readonly string[];
  /** Часть → кластеры её шагов. */
  partClusters?: Readonly<Record<string, readonly string[]>>;
  /** Части текущей прерванной попытки из `local.resume`. */
  resume: readonly BossPartRecord[] | null;
  now: number;
}

/** Какие части уже есть и какие играть (§5.8 «повтор только проваленных частей»). */
export function bossPlan(i: BossPlanInput): { kept: Record<string, BossPartRecord>; todo: string[]; retry: boolean } {
  const kept: Record<string, BossPartRecord> = {};
  const ids = new Set(i.parts.map((p) => p.id));
  let retry = false;
  if (!i.passedBefore && i.last && !i.last.passed && i.now - i.last.ts < BOSS_KEEP_DAYS * DAY) {
    retry = true;
    const red = new Set(i.redFailed ?? []);
    for (const [part, score] of Object.entries(i.last.parts))
      if (ids.has(part) && score >= i.passScore && !(i.partClusters?.[part] ?? []).some((cl) => red.has(cl)))
        kept[part] = { part, score, tally: {}, ms: 0 };
  }
  for (const r of i.resume ?? []) if (ids.has(r.part)) kept[r.part] = r;
  const todo = i.parts.map((p) => p.id).filter((id) => !kept[id]);
  // Все части «сданы», а босс нет (так бывает только из-за красного кластера) — играем всё заново.
  if (!todo.length) return { kept: {}, todo: i.parts.map((p) => p.id), retry };
  return { kept, todo, retry };
}

/** Последнее событие `boss` урока в журнале. */
export function lastBoss(p: Progress, lessonId: string): BossPlanInput['last'] {
  let best: BossPlanInput['last'] = null;
  for (const e of p.log.events)
    if (e.k === 'boss' && e.lesson === lessonId && (!best || e.ts >= best.ts))
      best = { ts: e.ts, parts: e.parts, passed: e.passed, ...(e.clusters ? { clusters: e.clusters } : {}) };
  return best;
}

/** Печать биома и предметы, которые даёт первая сдача (module.onComplete + reward), для экрана итога. */
export function bossRewards(content: Content, lesson: Lesson): { stamp: string | null; items: string[] } {
  const mod = content.modules.get(content.lessons.get(lesson.id)?.module ?? '')?.module;
  const effects = [...(lesson.reward ?? []), ...(mod?.boss === lesson.id ? (mod.onComplete ?? []) : [])];
  const items = effects.flatMap((e) => (e.give ? [content.items.get(e.give)?.title.pl ?? e.give] : []));
  const biome = mod?.boss === lesson.id ? content.world.biomes.find((b) => b.id === mod.biome) : undefined;
  return { stamp: biome?.stamp ? biome.title.pl : null, items };
}

const css = `
.pq-boss-parts { display: flex; gap: 6px; padding: 0 12px 6px; flex-wrap: wrap; }
.pq-boss-part { font-size: 14px; font-weight: 700; padding: 2px 8px; border-radius: 4px; border: 2px solid #91522c; background: #d2b37d; color: #3b3643; }
.pq-boss-part.cur { background: #e89b2f; }
.pq-boss-part.ok { background: #74a334; }
.pq-boss-part.bad { background: #ef9597; }
.pq-boss-list { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; padding: 0; list-style: none; }
.pq-boss-list li { display: flex; justify-content: space-between; gap: 8px; font-size: 18px; border-bottom: 2px dotted #c8966b; padding: 4px 0; }
.pq-boss-note { font-size: 17px; color: #543c52; }
.pq-stamp { align-self: center; margin: 6px 0; padding: 10px 22px; border: 5px double #8f3e56; border-radius: 50%; color: #8f3e56; font-size: 26px;
  font-weight: 800; letter-spacing: .08em; transform: rotate(-8deg); animation: pq-stamp .5s ease-out; }
@keyframes pq-stamp { 0% { transform: scale(2.2) rotate(-20deg); opacity: 0 } 70% { transform: scale(.92) rotate(-6deg); opacity: 1 } 100% { transform: scale(1) rotate(-8deg) } }
@media (prefers-reduced-motion: reduce) { .pq-stamp { animation: none; } }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-boss-style')) return;
  doc.head.append(el('style', { id: 'pq-boss-style' }, css));
}

const pct = (x: number): string => `${Math.round(x * 100)} %`;

/** Пройти босса. Отмена (Esc, ×) между частями или посреди части: сданные части лежат в `local.resume`. */
export async function runBoss(lesson: Lesson, deps: LessonDeps, opts: RunOptions = {}): Promise<LessonResult> {
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  const { content, store } = deps;
  const tuning = content.tuning;
  const parts = lesson.parts ?? [];
  const passScore = lesson.pass?.score ?? DEFAULT_BOSS_SCORE;
  const now0 = clock.now();
  const derived = derive(store.progress, deriveContent(content), now0, deps.tz);
  const gate = appendGate(derived, tuning, deps.tz);
  const passedBefore = derived.bossResults[lesson.id]?.passedAt !== undefined;

  const saved = store.local.resume;
  const resumed = saved && saved.lessonId === lesson.id && now0 - saved.startedAt < BOSS_KEEP_DAYS * DAY ? saved : null;
  const clustersOf = (item: string): readonly string[] => content.vocab.get(item)?.value.clusters ?? (content.pairs.get(item) ? [content.pairs.get(item)!.cluster] : []);
  const partClusters = Object.fromEntries(
    parts.map((p) => [p.id, [...new Set(p.steps.map((s) => stepCluster(s, clustersOf)).filter((c): c is string => !!c))]]),
  );
  const last = lastBoss(store.progress, lesson.id);
  const redMin = lesson.pass?.redClusterMin;
  const redFailedLast =
    redMin === undefined ? [] : Object.entries(last?.clusters ?? {}).filter(([cl, sc]) => derived.clusterStatus[cl] === 'red' && sc < redMin).map(([cl]) => cl);
  const plan = bossPlan({
    parts,
    passScore,
    passedBefore,
    last,
    redFailed: redFailedLast,
    partClusters,
    resume: resumed ? (resumed.answers as BossPartRecord[]).filter((r) => r && typeof r.part === 'string') : null,
    now: now0,
  });
  const startedAt = resumed?.startedAt ?? now0;
  const done: Record<string, BossPartRecord> = { ...plan.kept };
  const titleOf = (id: string): string => parts.find((p) => p.id === id)?.title ?? id;

  const record = (draft: EventDraft, gated = false): LogEvent | null => {
    const r = store.append(draft, gated ? gate : undefined);
    if (!r.ok) return null;
    deps.onEvent?.(r.event);
    return r.event;
  };
  const saveResume = (): void => {
    store.setLocal({ ...store.local, resume: { lessonId: lesson.id, stepIndex: Object.keys(done).length, startedAt, answers: Object.values(done) } });
  };
  const clearResume = (): void => {
    if (store.local.resume?.lessonId !== lesson.id) return;
    const { resume: _r, ...rest } = store.local;
    store.setLocal(rest as LocalState);
  };

  // ── Хром: шапка как у урока, полоска частей, точки шагов части.
  const layer = opts.layer ?? deps.overlay.open('pq-lesson-layer');
  ensureStyle(layer.el.ownerDocument);
  const exContent = exerciseContent(content);
  const npc = lesson.npc ? exContent.speaker(lesson.npc) : null;
  const pic = npc ? portrait(npc, deps.portraits, 40) : null;
  const partsBar = el('div', { class: 'pq-boss-parts', 'aria-hidden': 'true' });
  const dots = el('div', { class: 'pq-dots', 'aria-hidden': 'true' });
  const main = el('div', { class: 'pq-lesson-main' });
  let handler: IntentHandler | null = null;
  const closeBtn = btn('✕', () => handler?.cancel?.(), 'icon ghost', { 'aria-label': 'Прервать босса', 'data-act': 'close' });
  layer.el.replaceChildren(
    el(
      'div',
      { class: 'pq-lesson pq-boss', 'data-lesson': lesson.id, 'data-boss': lesson.id },
      el('div', { class: 'pq-wood' }, el('div', { class: 'pq-lesson-top' }, pic, el('div', { class: 'title' }, lesson.title.pl ? `${lesson.title.pl} · ${lesson.title.ru}` : lesson.title.ru), closeBtn), partsBar, dots, main),
    ),
  );
  const stepLayer: Layer = {
    el: layer.el,
    handle(h) {
      handler = h;
      layer.handle(h);
    },
    get closed() {
      return layer.closed;
    },
    close: () => layer.close(),
  };
  const close = (): void => {
    if (!opts.layer) layer.close();
    else layer.handle(null);
  };
  const paintParts = (cur: string | null, failed: readonly string[] = []): void => {
    partsBar.replaceChildren(
      ...parts.map((p, k) => {
        const cls = ['pq-boss-part', p.id === cur ? 'cur' : '', failed.includes(p.id) ? 'bad' : done[p.id] && p.id !== cur ? 'ok' : ''].filter(Boolean).join(' ');
        return el('span', { class: cls, 'data-part': p.id }, String(k + 1));
      }),
    );
  };

  const settings = {
    diacritics: getSetting(store.progress, 'diacritics'),
    translations: getSetting(store.progress, 'translations'),
    keyboardMode: getSetting(store.progress, 'keyboard.mode'),
    silent: isSilent(store.progress),
  };
  // P-06: реакция контролёра на ошибку («Proszę powtórzyć?», без звука — «Proszę przeczytać.»).
  const errLine = lineSpeech(content, lesson.errLine, settings.silent);
  const revDone = new Set<CardId>();
  const writeRevs = (step: Step, res: StepResult): void => {
    if (!res.first) return;
    const list = cardsOfStep(step, { ...(res.noAudio ? { noAudio: 1 as const } : {}), ...(res.parts ? { parts: res.parts } : {}) });
    for (const { card, part: pi } of list) {
      const state = derived.cards[card];
      if (!state || revDone.has(card)) continue;
      const partOk = pi === undefined ? null : (res.parts?.[pi]?.ok ?? false);
      const check: Pick<Check, 'verdict' | 'score'> = partOk === null ? (res.first as Pick<Check, 'verdict' | 'score'>) : partOk ? { verdict: 'exact', score: 1 } : { verdict: 'wrong', score: 0 };
      const ms = pi === undefined ? res.first.ms : Math.round(res.first.ms / Math.max(1, list.length));
      const g = gradeFromAnswer({ kind: step.t as StepKind, check, ms, interval: state.interval, attempt: 1, hinted: res.first.hinted }, tuning);
      if (g === null) continue;
      const tags = g === 0 || check.score < 1 ? res.first.tags : [];
      if (record({ k: 'rev', ts: clock.now(), card, g, ms, src: 'boss', ...(tags.length ? { tags } : {}) }, true)) revDone.add(card);
    }
  };

  /** Одна часть: шаги по порядку, без подсказок. null — прервали. */
  const runPart = async (partId: string): Promise<BossPartRecord | null> => {
    const p = parts.find((x) => x.id === partId)!;
    const scores: { cluster: string | null; score: number }[] = [];
    const marks: ('ok' | 'bad' | 'done')[] = [];
    let ms = 0;
    for (let i = 0; i < p.steps.length; i++) {
      const step = p.steps[i]!;
      dots.replaceChildren(...p.steps.map((_, k) => el('span', { class: `pq-dot ${k === i ? 'cur' : (marks[k] ?? '')}`.trim() })));
      main.scrollTop = 0;
      const stepId = step.id ?? `${lesson.id}#${p.id}.${i}`;
      const ctx: ExerciseCtx = {
        layer: stepLayer,
        root: main,
        stepId,
        seed: `${stepId}@${derived.today}`,
        content: exContent,
        audio: deps.audio,
        portraits: deps.portraits ?? null,
        diacritics: settings.diacritics,
        translations: settings.translations,
        keyboardMode: settings.keyboardMode,
        now: () => clock.mono(),
        random: deps.random ?? Math.random,
        react: (k) => react(pic, k),
        // Босс без подсказок (§5.8): тот же флаг, что у повтора ошибки в уроке.
        repeat: true,
        ...(settings.silent ? { silent: true } : {}),
        ...(errLine ? { errLine } : {}),
        ...(deps.coarse !== undefined ? { coarse: deps.coarse } : {}),
        ...(deps.typeMs !== undefined ? { typeMs: deps.typeMs } : {}),
      };
      const res = await mountStep(step, ctx);
      if (res.status === 'cancel' && !(res.first && res.graded)) return null;
      ms += res.ms;
      if (res.graded && res.first) {
        const ok = res.first.verdict !== 'wrong' && res.first.score > 0;
        scores.push({ cluster: stepCluster(step, clustersOf), score: res.first.score });
        marks[i] = ok ? 'ok' : 'bad';
        writeRevs(step, res);
      } else marks[i] = 'done';
      if (res.status === 'cancel') return null;
    }
    const score = scores.length ? scores.reduce((s, x) => s + x.score, 0) / scores.length : 1;
    return { part: p.id, score: Math.round(score * 1000) / 1000, tally: tallyOf(scores), ms };
  };

  // ── Вступление: части, веса, что осталось.
  paintParts(null);
  const go = await screen(main, stepLayer, dots, {
    head: plan.retry ? 'Попробуй снова только части:' : `Частей: ${parts.length}. Без подсказок. Сдача — от ${pct(passScore)}.`,
    rows: parts.map((p) => [p.title ?? p.id, done[p.id] ? `✓ ${pct(done[p.id]!.score)}` : plan.retry ? '↻' : `${pct((p.weight ?? 1) / parts.reduce((s, x) => s + (x.weight ?? 1), 0))}`]),
    note: plan.retry ? plan.todo.map(titleOf).join(', ') : null,
    action: plan.retry || Object.keys(done).length ? BTN.more : BTN.start,
    act: 'start',
    cancellable: true,
  });
  if (!go) {
    close();
    return { passed: false, cancelled: true };
  }

  for (const id of plan.todo) {
    paintParts(id);
    const r = await runPart(id);
    if (!r) {
      close();
      return { passed: false, cancelled: true };
    }
    done[id] = r;
    saveResume();
  }

  const scores = Object.fromEntries(parts.map((p) => [p.id, done[p.id]?.score ?? 0]));
  const v = bossVerdict({
    parts,
    scores,
    tallies: Object.fromEntries(parts.map((p) => [p.id, done[p.id]?.tally])),
    status: derived.clusterStatus,
    ...(lesson.pass ? { pass: lesson.pass } : {}),
  });
  const ms = Object.values(done).reduce((s, r) => s + r.ms, 0);
  record({
    k: 'boss',
    ts: clock.now(),
    lesson: lesson.id,
    score: v.score,
    parts: scores,
    ...(Object.keys(v.clusters).length ? { clusters: v.clusters } : {}),
    passed: v.passed,
    ms,
  });
  clearResume();

  if (!opts.noSummary) {
    paintParts(null, v.failedParts);
    dots.replaceChildren();
    const rewards = v.passed && !passedBefore ? bossRewards(content, lesson) : { stamp: null, items: [] };
    const phon = Object.fromEntries(content.phonetics.clusters.map((c) => [c.id, c.title]));
    await screen(main, stepLayer, dots, {
      big: v.passed ? 'Zdane!' : 'Prawie.',
      summary: lesson.id,
      head: v.passed
        ? `Итог: ${pct(v.score)}`
        : v.score >= passScore
          ? `Итог: ${pct(v.score)}, но красный звук ниже ${pct(lesson.pass?.redClusterMin ?? 0)}. Попробуй снова только части:`
          : `Итог: ${pct(v.score)}, нужно ${pct(passScore)}. Попробуй снова только части:`,
      rows: parts.map((p) => [p.title ?? p.id, `${v.failedParts.includes(p.id) ? '↻' : '✓'} ${pct(scores[p.id] ?? 0)}`]),
      note: v.passed
        ? null
        : [
            `${v.failedParts.map(titleOf).join(', ')}.`,
            v.redFailed.length
              ? `Звуки ниже ${pct(lesson.pass?.redClusterMin ?? 0)}: ${v.redFailed.map((c) => `${c} (${phon[c] ?? c})`).join('; ')} — они уходят в фонетическую колоду.`
              : '',
          ]
            .filter(Boolean)
            .join(' '),
      stamp: rewards.stamp,
      items: rewards.items,
      action: BTN.next,
      act: 'next',
      cancellable: false,
    });
  }
  close();
  return { passed: v.passed, score: v.score, ms, planted: [] };
}

interface ScreenOpts {
  big?: string;
  summary?: string;
  head: string;
  rows: [string, string][];
  note: string | null;
  stamp?: string | null;
  items?: string[];
  action: PlLabel;
  act: string;
  /** Esc/× = отказ (false); иначе Esc = кнопка. */
  cancellable: boolean;
}

/** Экран-карточка босса: вступление или итог. true — нажали кнопку. */
function screen(main: HTMLElement, layer: Layer, dots: HTMLElement, o: ScreenOpts): Promise<boolean> {
  dots.replaceChildren();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: boolean): void => {
      if (settled) return;
      settled = true;
      layer.handle(null);
      resolve(v);
    };
    const go = plBtn(o.action, () => finish(true), 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': o.act });
    main.replaceChildren(
      el(
        'div',
        { class: 'pq-summary', ...(o.summary ? { 'data-summary': o.summary } : { 'data-boss-intro': true }) },
        o.big ? el('div', { class: 'pq-big' }, o.big) : null,
        o.stamp ? el('div', { class: 'pq-stamp', 'data-stamp': o.stamp }, o.stamp.toUpperCase()) : null,
        el('div', { class: 'pq-boss-note' }, o.head),
        el('ul', { class: 'pq-boss-list' }, ...o.rows.map(([a, b]) => el('li', {}, el('span', {}, a), el('b', {}, b)))),
        o.note ? el('div', { class: 'pq-boss-note', 'data-role': 'retry' }, o.note) : null,
        o.items?.length ? el('div', { class: 'planted', 'data-role': 'reward' }, '🎫 ', el('b', { lang: 'pl' }, o.items.join(', '))) : null,
        el('div', { class: 'pq-ex-actions' }, el('span', { class: 'grow' }), go),
      ),
    );
    layer.handle({
      cancel: () => {
        finish(!o.cancellable);
        return true;
      },
    });
    queueMicrotask(() => go.focus({ preventScroll: true }));
  });
}
