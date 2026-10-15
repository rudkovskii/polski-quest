// Obchód działki и экспресс-обход (ТЗ §4.5, §4.8, §5.5), I-12. Полив = одна карточка = один `runLesson`
// в режиме drill (src `obchod` или `express`, без события `lesson`, без resume) в общем слое оверлея:
// карточки идут подряд без сцен, после каждой шина получает `progress:changed` — растение за оверлеем
// перерисовывается («полито»). Раунд: до obchodBatch (15); экспресс: до expressMaxCards (12) или
// expressMaxMin (3) минут. Конец раунда пишет `seg` (water | express | more3), экспресс ещё `session`.
import type { Bus } from '../systems/bus';
import { derive, deriveContent, type Derived } from '../systems/derive';
import { gardenItems, type GardenItem, type PlantStage } from '../systems/garden';
import type { EventDraft, Seg } from '../systems/log';
import { dayState, planRound, retrievalSince } from '../systems/session';
import { parseCardId } from '../systems/srs';
import type { BusEvents } from '../types/bus';
import type { Content } from '../systems/content';
import type { Lesson, Step } from '../types/content';
import { el } from './dom';
import { runLesson, type LessonDeps } from './lesson';
import type { Layer } from './overlay/host';
import { BTN, btn, plBtn, type PlLabel } from './overlay/kit';
import { wordStep } from './play';
import { todoVisible } from './todo';

export interface ObchodDeps extends LessonDeps {
  bus: Bus<BusEvents>;
  /** Активные мс сессии (таймер склейки): после sessionSoftCapMin игра предлагает сон. */
  activeMs?: () => number;
}

export interface ObchodOptions {
  /** day — обход, express — экспресс, phonetic — вечер на звуки (минимальные пары, I-13). */
  mode: 'day' | 'express' | 'phonetic';
  /** Растение, по которому тапнули: его карточка первой. */
  fromItem?: string;
  /** «Ещё 3 минуты» из DaySummary: экспресс с director.more3Min, seg `more3`. */
  more3?: boolean;
  /**
   * Первый день F2 (I-13): полить одну грядку `fromItem` по просьбе Казика — практика без SRS
   * (карточка ещё не due, appendGate ответ не пишет), без `seg` и без итоговой панели.
   */
  practice?: boolean;
  /** Сколько карточек (вечер первого дня — 3 пары). */
  limit?: number;
  /** Wola (W-01): огород удобряют, а не поливают — подписи «Nawóz / удобрено» вместо «Obchód / полито». */
  nawoz?: boolean;
  /** Вечер: пары этого кластера первыми. */
  cluster?: string;
  /**
   * Выбор вечера (P-06, день 6+): Казик спрашивает «рыбалка или табличка?». Рыбалка — пары на звуки (без
   * звука — «какое слово значит …»), табличка — написать знакомые слова с экранной клавиатурой.
   */
  choose?: boolean;
}

export interface ObchodResult {
  /** Карточек показано (ответ дан). */
  answered: number;
  /** Верно с первой попытки. */
  correct: number;
  /** Ответов не было: «всё полито» или отмена до первого ответа. */
  empty: boolean;
  /** Сколько растений ещё ждут полива сегодня (с «!»). */
  left: number;
  /** Ещё раунд: следующий вызов сделает склейка. */
  again?: boolean;
}

/** Шаг полива для карточки: rec — выбор перевода, lis — на слух, pro — набрать по-польски, pair — минимальная пара. */
export function cardStep(card: string, content: Pick<Content, 'vocab'> & Partial<Pick<Content, 'pairs'>>): Step | null {
  const p = parseCardId(card);
  if (!p) return null;
  if (p.type === 'pair') {
    const mp = content.pairs?.get(p.item);
    return mp ? { t: 'minimal_pair', pair: [mp.a, mp.b], play: 'random', cluster: mp.cluster as 'R1', item: mp.id } : null;
  }
  const v = content.vocab.get(p.item)?.value;
  if (!v) return null;
  if (p.type === 'lis') return wordStep(v, 'listen', content);
  if (p.type === 'pro') return wordStep(v, 'type', content);
  return wordStep(v, undefined, content);
}

const STAGE_RU: Record<PlantStage, string> = { seed: 'семя', sprout: 'росток', bush: 'куст', jar: 'банка' };
const JAR_PL = { mlody: 'młody', dojrzaly: 'dojrzały', stary: 'stary' } as const;

export function stageLabel(g: Pick<GardenItem, 'stage' | 'jar'>): string {
  return g.stage === 'jar' && g.jar ? `${STAGE_RU.jar} · ${JAR_PL[g.jar]}` : STAGE_RU[g.stage];
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
export const days = (n: number): string => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

/** Реплика бобра из story/lines.json: pl крупно, ru ниже (`todo` → id в dev, в игре — null). */
export function bobrLine(content: Pick<Content, 'lines'>, id: string): HTMLElement | null {
  const l = content.lines.get(id);
  if (!l || (l.todo && !todoVisible())) return null;
  return el(
    'div',
    { class: 'pq-bobr', 'data-line': id },
    el('b', {}, 'Kazik: '),
    l.todo ? el('span', { class: 'todo' }, `[todo: ${id}]`) : el('span', { lang: 'pl' }, l.pl ?? ''),
    l.ru && !l.todo ? el('div', { class: 'ru' }, l.ru) : null,
  );
}

const css = `
.pq-obchod { width: min(100% - 16px, 520px); margin: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
.pq-obchod h2 { margin: 0; font-size: 22px; color: #543c52; }
.pq-obchod h2 .sub { display: block; font-size: 15px; font-weight: 500; }
.pq-obchod .stat { display: flex; justify-content: space-between; gap: 12px; font-size: 18px; border-bottom: 2px dotted #c8966b; padding: 4px 0; }
.pq-obchod .line2 { font-size: 18px; }
.pq-obchod .word { font-size: 26px; font-weight: 700; }
.pq-obchod .ru { color: #543c52; }
.pq-obchod .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.pq-bobr { padding: 8px 10px; border-radius: 6px; background: #fff7ec; border: 2px solid #c8966b; font-size: 17px; }
.pq-bobr .ru { font-size: 16px; color: #543c52; }
.pq-obchod .say { font-size: 19px; font-weight: 700; display: flex; flex-direction: column; gap: 2px; }
.pq-obchod .say .ru { font-size: 15px; font-weight: 400; color: #543c52; }
.pq-bobr .todo { color: #8f3e56; font-family: ui-monospace, Menlo, monospace; }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-obchod-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-obchod-style';
  s.textContent = css;
  doc.head.append(s);
}

/** Панель в слое: заголовок (польский с русской подписью), строки, кнопки. Возвращает выбранное действие. */
function panel<A extends string>(layer: Layer, title: string | PlLabel, body: (HTMLElement | null)[], actions: { act: A; label: string | PlLabel; primary?: boolean }[], cancel: A): Promise<A> {
  return new Promise((resolve) => {
    const done = (a: A): void => {
      layer.handle(null);
      resolve(a);
    };
    const buttons = actions.map((a) => {
      const attrs = { 'data-nav': true, 'data-act': a.act, ...(a.primary ? { 'data-primary': true } : {}) };
      return typeof a.label === 'string' ? btn(a.label, () => done(a.act), a.primary ? 'primary' : '', attrs) : plBtn(a.label, () => done(a.act), a.primary ? 'primary' : '', attrs);
    });
    const h2 = typeof title === 'string' ? el('h2', {}, title) : el('h2', {}, el('span', { lang: 'pl' }, title.pl), el('small', { class: 'sub' }, title.ru));
    const key = typeof title === 'string' ? title : title.pl;
    layer.el.replaceChildren(el('div', { class: 'pq-wood pq-obchod', 'data-panel': key }, h2, ...body, el('div', { class: 'row' }, ...buttons)));
    layer.el.style.justifyContent = 'center';
    layer.handle({ cancel: () => (done(cancel), true) });
    queueMicrotask(() => (buttons.find((b) => b.hasAttribute('data-primary')) ?? buttons[0])?.focus({ preventScroll: true }));
  });
}

const WIECZOR: PlLabel = { pl: 'Wieczór', ru: 'вечер, звуки у реки' };

/** Подписи раунда: полив działki (основная игра) или удобрение огорода (Wola). */
const WORDS = {
  water: { round: { pl: 'Obchód', ru: 'обход грядок' }, step: 'Obchód', stepRu: 'полив', expressRu: 'быстрый полив', did: 'Полито', wait: 'Ещё ждут полива', all: 'Всё полито', tomorrow: 'Завтра к поливу' },
  nawoz: { round: { pl: 'Nawóz', ru: 'удобрить огород' }, step: 'Nawóz', stepRu: 'удобрение', expressRu: 'удобрить всё', did: 'Удобрено', wait: 'Ещё ждут удобрения', all: 'Всё удобрено', tomorrow: 'Завтра к удобрению' },
} as const;

const stat = (label: string, value: string): HTMLElement => el('div', { class: 'stat' }, el('span', {}, label), el('b', {}, value));

/** Тап по растению без полива (P-11): слово и одна короткая строка — «Rośnie. Jutro podlej.», без цифр интервала. */
async function plantInfo(layer: Layer, content: Content, g: GardenItem | undefined, now: number, todayStart: number): Promise<void> {
  if (!g) {
    await panel(layer, 'Пустая грядка', [el('div', { class: 'line2' }, 'Новые слова сажаются в сценах. Здесь вырастет следующее.')], [{ act: 'ok', label: 'OK', primary: true }], 'ok');
    return;
  }
  const v = content.vocab.get(g.item)?.value;
  // Полить завтра (или уже пора): «Jutro podlej.»; позже — «Jeszcze nie pora.»
  const tomorrow = g.nextDue < todayStart + 2 * 86_400_000 || g.nextDue <= now;
  const l = content.lines.get(tomorrow ? 'sys.rosnie' : 'sys.rosnie.later') ?? (tomorrow ? { pl: 'Rośnie. Jutro podlej.', plRu: 'Растёт. Завтра полей.' } : { pl: 'Rośnie. Jeszcze nie pora.', plRu: 'Растёт. Поливать пока рано.' });
  const body = [
    el('div', { class: 'say', 'data-line': tomorrow ? 'sys.rosnie' : 'sys.rosnie.later' }, el('span', { lang: 'pl' }, l?.pl ?? ''), l?.plRu ? el('span', { class: 'ru' }, l.plRu) : null),
  ];
  await panel(layer, { pl: v?.pl ?? g.item, ru: v?.ru ?? '' }, body, [{ act: 'ok', label: 'OK', primary: true }], 'ok');
}

/**
 * Один раунд обхода или экспресса. Свой слой оверлея на весь раунд; карточки — `runLesson` drill в нём.
 * Тап по растению без полива показывает карточку растения и раунд не начинает.
 */
export async function runObchod(deps: ObchodDeps, o: ObchodOptions): Promise<ObchodResult> {
  ensureStyle(document);
  const { content, store, bus } = deps;
  const t = content.tuning;
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  const dc = deriveContent(content);
  const now0 = clock.now();
  const d0 = derive(store.progress, dc, now0, deps.tz);
  const express = o.mode === 'express';
  const evening = o.mode === 'phonetic';
  const plan = planRound(d0, now0, t, {
    mode: o.mode,
    ...(o.fromItem ? { fromItem: o.fromItem } : {}),
    ...(o.more3 ? { minutes: t.director.more3Min } : {}),
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    ...(o.cluster ? { cluster: o.cluster } : {}),
  });
  // Первый вечер (§5.0 F5): пары кластера уже прогнаны сценой — те же пары практикой (ранний ответ SRS не двигает).
  if (evening && !plan.cards.length && o.cluster) {
    plan.cards = content.phonetics.pairs
      .filter((p) => p.cluster === o.cluster)
      .slice(0, o.limit ?? t.phoneticPerDay)
      .map((p) => `${p.id}#pair`);
  }
  const W = o.nawoz ? WORDS.nawoz : WORDS.water;
  const layer = deps.overlay.open('pq-obchod-layer');
  try {
    if (o.practice && o.fromItem) return await practiceOne(deps, layer, o.fromItem);
    if (evening && o.choose) {
      const pick = await panel(layer, WIECZOR, [bobrLine(content, 'd06.kazik.evening.1') ?? bobrLine(content, 'sys.kazik.evening')], [
        { act: 'ryby', label: BTN.fish, primary: true },
        { act: 'tabliczka', label: BTN.sign },
      ], 'ryby');
      if (pick === 'tabliczka') {
        // Табличка: до phoneticPerDay знакомых слов набрать по-польски (карточка pro, если она есть и пора).
        const items = Object.keys(d0.cards).filter((c) => c.endsWith('#rec')).map((c) => parseCardId(c)!.item).slice(0, t.phoneticPerDay);
        plan.cards = items.map((it) => `${it}#pro`);
      }
    }
    if (o.fromItem && !express && !evening) {
      const g = gardenItems(d0, now0, t).find((x) => x.item === o.fromItem);
      if (!g?.dueCard) {
        await plantInfo(layer, content, g, now0, d0.todayStart);
        return { answered: 0, correct: 0, empty: true, left: gardenItems(d0, now0, t).filter((x) => x.dueCard).length };
      }
    }
    if (!plan.cards.length && evening) {
      await panel(layer, WIECZOR, [el('div', { class: 'line2' }, 'Сегодня звуки в порядке.')], [{ act: 'ok', label: 'OK', primary: true }], 'ok');
      return { answered: 0, correct: 0, empty: true, left: 0 };
    }
    if (!plan.cards.length) {
      const tomorrow = summaryTomorrow(d0);
      await panel(layer, W.all, [el('div', { class: 'line2' }, `${W.tomorrow}: ${tomorrow}.`)], [{ act: 'ok', label: 'OK', primary: true }], 'ok');
      return { answered: 0, correct: 0, empty: true, left: 0 };
    }

    const startMono = clock.mono();
    const startTs = clock.now();
    let answered = 0;
    let correct = 0;
    for (let i = 0; i < plan.cards.length; i++) {
      if (express && clock.mono() - startMono >= plan.maxMs) break;
      const card = plan.cards[i]!;
      const step = cardStep(card, content);
      if (!step) continue;
      const lesson: Lesson = {
        id: `${express ? 'express' : evening ? 'wieczor' : 'obchod'}.${card}`,
        kind: 'practice',
        title: { pl: express ? 'Ekspres' : evening ? 'Wieczór' : W.step, ru: `${express ? W.expressRu : evening ? 'вечер, звуки' : W.stepRu} · ${i + 1} из ${plan.cards.length}` },
        minutes: 1,
        steps: [step],
      };
      const r = await runLesson(lesson, { ...deps, overlay: deps.overlay }, { drill: true, noSummary: true, layer, src: express ? 'express' : evening ? 'phonetic' : 'obchod' });
      if (r.cancelled) break;
      answered++;
      if ((r.firstTry ?? 0) >= 1) correct++;
      bus.emit('progress:changed', { kinds: ['cards'] });
    }

    const now1 = clock.now();
    const d1 = derive(store.progress, dc, now1, deps.tz);
    // Ждут полива сегодня = растения с «!» (братья политых слов ждут завтра, их в «ещё раунд» не зовём).
    const left = gardenItems(d1, now1, t).filter((g) => g.dueCard).length;
    if (answered > 0) {
      const seg: Seg = o.more3 ? 'more3' : express ? 'express' : evening || o.choose ? 'evening' : 'water';
      write(deps, { k: 'seg', ts: now1, seg });
      if (express) write(deps, { k: 'session', ts: now1, mode: 'express', ms: Math.round(clock.mono() - startMono), retrievalMs: retrievalSince(store.progress.log.events, startTs) });
      bus.emit('progress:changed', { kinds: ['cards'] });
    }
    if (answered === 0) return { answered, correct, empty: true, left };

    const minutes = Math.max(1, Math.round((clock.mono() - startMono) / 60_000));
    if (evening) {
      await panel(layer, WIECZOR, [stat('Услышано верно', `${correct} из ${answered}`)], [{ act: 'ok', label: BTN.done, primary: true }], 'ok');
      return { answered, correct, empty: false, left };
    }
    if (express) {
      // Мини-итог (§4.5): две строки.
      await panel(
        layer,
        o.more3 ? 'Ещё 3 минуты' : { pl: 'Ekspres', ru: W.expressRu },
        [el('div', { class: 'line2' }, `${W.did} ${correct} из ${answered} за ${minutes} мин.`), el('div', { class: 'line2' }, left ? `${W.wait}: ${left}.` : `${W.all}.`)],
        [{ act: 'ok', label: BTN.done, primary: true }],
        'ok',
      );
      return { answered, correct, empty: false, left };
    }
    const ds = dayState(d1, t);
    // P-10b: спать — только в хатке (один конец дня), обход сон не предлагает.
    const actions: { act: 'more' | 'ok'; label: PlLabel; primary?: boolean }[] = [];
    if (left > 0) actions.push({ act: 'more', label: BTN.round, primary: true });
    actions.push({ act: 'ok', label: BTN.done, primary: left === 0 });
    const act = await panel(
      layer,
      W.round,
      [
        ds.locked ? bobrLine(content, 'sys.kazik.jam') : null,
        stat(W.did, `${correct} из ${answered}`),
        stat(W.wait, String(left)),
        // Ошибка на обходе (СЮЖЕТ_v2 d02.kazik.obchod.err): Казик делает вторую зарубку.
        correct < answered ? bobrLine(content, 'd02.kazik.obchod.err') : null,
      ],
      actions,
      'ok',
    );
    return { answered, correct, empty: false, left, ...(act === 'more' ? { again: true } : {}) };
  } finally {
    layer.close();
  }
}

/** F2: одна грядка без SRS — шаг слова в drill, без seg и итоговой панели. */
async function practiceOne(deps: ObchodDeps, layer: Layer, item: string): Promise<ObchodResult> {
  const v = deps.content.vocab.get(item)?.value;
  if (!v) return { answered: 0, correct: 0, empty: true, left: 0 };
  const lesson: Lesson = { id: `obchod.${item}`, kind: 'practice', title: { pl: 'Obchód', ru: 'полив · 1 из 1' }, minutes: 1, steps: [wordStep(v, undefined, deps.content)] };
  const before = deps.store.progress.log.events.length;
  const r = await runLesson(lesson, deps, { drill: true, noSummary: true, layer, src: 'obchod' });
  if (r.cancelled) return { answered: 0, correct: 0, empty: true, left: 0 };
  // Карточка не due, appendGate `rev` не пишет: полив идёт агрегатом урока (§3.11), его видит итог дня (P-01).
  const revWritten = deps.store.progress.log.events.slice(before).some((e) => e.k === 'rev');
  const ok = (r.firstTry ?? 0) >= 1;
  if (!revWritten) write(deps, { k: 'lesson', ts: deps.clock?.now() ?? Date.now(), lesson: lesson.id, score: r.score ?? (ok ? 1 : 0), firstTry: ok ? 1 : 0, ms: r.ms ?? 0, passed: true, answers: 1 });
  deps.bus.emit('progress:changed', { kinds: ['cards'] });
  return { answered: 1, correct: ok ? 1 : 0, empty: false, left: 0 };
}

function write(deps: ObchodDeps, draft: EventDraft): void {
  const r = deps.store.append(draft);
  if (r.ok) deps.onEvent?.(r.event);
}

function summaryTomorrow(d: Derived): number {
  // due к концу завтрашнего игрового дня: todayStart + 2 суток (без перехода часов — для подписи хватает).
  const end = d.todayStart + 2 * 86_400_000;
  let n = 0;
  for (const [id, c] of Object.entries(d.cards)) if (c.due < end && parseCardId(id)?.type !== 'pair') n++;
  return n;
}

