// DaySummary «Сон» (ТЗ §5.9), I-12: итог игрового дня из журнала (systems/session.ts → summarizeDay).
// P-10b: один итог на день, одни цифры, каждый день (включая день 1) — в хатке Казика перед ночью. Строки:
// полито (растений, как на кнопке Obchód), выросло (вид на грядке), посажено, «Умею» дня, минуты в заданиях
// (уроки и диагностика целиком + ответы вне уроков), всего в игре (активное время сессий), завтра к поливу
// (растений). «Повторено из нужного» и złoty убраны: первое спорило с кнопкой Obchód, второе — заглушка.
// «Dobranoc» пишет `session {mode: 'day'}` и `seg: sleep`; «ещё 3 минуты» → экспресс (день 7+).
import type { Bus } from '../systems/bus';
import type { Content } from '../systems/content';
import { derive, deriveContent } from '../systems/derive';
import { dayLines, isOpen, lineFor, paceCtxOf } from '../systems/pace';
import { getSetting } from '../systems/progress';
import type { EventDraft, LogEvent } from '../systems/log';
import type { AppendResult, Progress } from '../systems/progress';
import { retrievalSince, summarizeDay, type DaySummary } from '../systems/session';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import type { Overlay } from './overlay/host';
import { BTN, btn, plBtn } from './overlay/kit';
import { bobrLine } from './obchod';
import { isSilent } from '../systems/sound';

/** Флаг мира «Я сохранил ссылку» (тот же, что LINK_SAVED_FLAG в src/cloud.ts; ui не импортирует склейку). */
export const LINK_SAVED = 'link.saved';

export interface DaySummaryDeps {
  overlay: Overlay;
  content: Content;
  store: { readonly progress: Progress; append(draft: EventDraft): AppendResult };
  bus: Bus<BusEvents>;
  clock?: { now(): number; mono(): number };
  tz?: string;
  /** Активные мс с прошлого события `session` (таймер склейки). */
  activeMs?: () => number;
  /** Начало текущей сессии (ts): `retrievalMs` = Σ rev.ms с него. */
  sessionStart?: () => number;
  /** Сессия записана: склейка обнуляет таймер. */
  onSession?: () => void;
  /** У мира есть приватная ссылка (секрет): тогда напоминаем сохранить её, пока чекбокс не отмечен. */
  hasLink?: () => boolean;
  onEvent?(e: LogEvent): void;
}

export type SummaryOutcome = 'sleep' | 'more3' | 'express' | 'close';

const STAGE_RU = { seed: 'семя', sprout: 'росток', sprout_big: 'крепкий росток', bush: 'куст', jar: 'банка' } as const;

const css = `
.pq-sleep { width: min(100% - 16px, 520px); max-height: calc(100% - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); margin: auto; padding: 18px;
  display: flex; flex-direction: column; gap: 10px; }
/* P-12: итог прокручивается, «Dobranoc» прибита к низу окна (на iPhone уезжала под край). */
.pq-sleep .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; padding-right: 8px; scrollbar-gutter: stable; }
.pq-sleep > .row { flex: none; padding-top: 6px; border-top: 2px solid #d3865f; }
.pq-sleep h2 { margin: 0; font-size: 24px; color: #543c52; }
.pq-sleep .stat { display: flex; justify-content: space-between; gap: 12px; font-size: 18px; border-bottom: 2px dotted #c8966b; padding: 4px 0; }
.pq-sleep .list { font-size: 17px; color: #345a52; }
.pq-sleep .empty { font-size: 19px; }
.pq-sleep .row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.pq-sleep .more3 { font-size: 16px; text-decoration: underline; min-height: 44px; }
.pq-sleep .remind { font-size: 16px; color: #543c52; }
.pq-sleep .card-line { display: flex; flex-direction: column; gap: 2px; font-size: 20px; font-weight: 700; color: #3a2c38; }
.pq-sleep .card-line small { font-size: 15px; font-weight: 400; color: #543c52; }
.pq-sleep .card-line.hook { margin-top: 6px; color: #8f3e56; }
.pq-sleep .hook { font-size: 19px; color: #345a52; }
.pq-sleep .hook .ru { font-size: 16px; }
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById('pq-sleep-style')) return;
  const s = doc.createElement('style');
  s.id = 'pq-sleep-style';
  s.textContent = css;
  doc.head.append(s);
}

const stat = (label: string, value: string, key: string): HTMLElement =>
  el('div', { class: 'stat', 'data-stat': key }, el('span', {}, label), el('b', {}, value));

/** Реплики итога по игровому дню (P-06): сон дня (`director.days[].sleep`, иначе sys.kazik.sleep; `[]` — без реплики), «Умею» дня и крючок на завтра. */
export interface SummaryLines {
  sleep?: readonly string[];
  /** «Umiem: …» дня (P-10b: день 1 — здороваться, день 3 — написать «proszę»). */
  umiem?: readonly string[];
  hook?: string;
}

/** Минуты для итога: меньше полуминуты — всё равно «1 мин», если что-то было (ноль выглядит как «ничего не сделал», P-01). */
export const summaryMin = (ms: number): number => (ms > 0 ? Math.max(1, Math.round(ms / 60_000)) : 0);

/** Строка реплики итога: польская строка и русская подпись под ней. */
function cardLine(content: Pick<Content, 'lines'>, id: string, cls: string): HTMLElement | null {
  const l = content.lines.get(id);
  if (!l || l.todo || (!l.pl && !l.ru)) return null;
  return el('div', { class: `card-line ${cls}`.trim(), 'data-line': id }, el('span', { lang: 'pl' }, l.pl ?? l.ru ?? ''), l.pl && l.plRu ? el('small', {}, l.plRu) : null);
}

/**
 * Тело итога (без кнопок): удобно проверять в тестах. `activeMs` — всё активное время игрового дня (сессии дня +
 * текущий таймер); нет — строки «Всего в игре» нет.
 */
export function summaryBody(s: DaySummary, content: Pick<Content, 'vocab' | 'lines'>, lines: SummaryLines = {}, activeMs?: number): HTMLElement[] {
  const pl = (id: string): string => content.vocab.get(id)?.value.pl ?? id;
  const out: HTMLElement[] = [];
  for (const id of lines.sleep ?? ['sys.kazik.sleep']) {
    const line = bobrLine(content, id);
    if (line) out.push(line);
  }
  if (s.empty) {
    out.push(el('div', { class: 'empty', 'data-empty': true }, 'Сегодня ещё ничего, полей хоть пару грядок?'));
  } else {
    out.push(stat('Полито', String(s.plants), 'watered'));
    out.push(stat('Выросло', String(s.grew.length), 'grew'));
    // P-12: компактно — слова по переходу: «cześć, dziękuję: росток → крепкий росток».
    if (s.grew.length) {
      const groups = new Map<string, string[]>();
      for (const g of s.grew) {
        const k = `${STAGE_RU[g.from]} → ${STAGE_RU[g.to]}`;
        groups.set(k, [...(groups.get(k) ?? []), pl(g.item)]);
      }
      out.push(el('div', { class: 'list', lang: 'pl' }, [...groups].map(([k, w]) => `${w.join(', ')}: ${k}`).join('; ')));
    }
    if (s.matured.length) {
      out.push(stat('Созрело (в банку)', String(s.matured.length), 'matured'));
      out.push(el('div', { class: 'list', lang: 'pl' }, s.matured.map(pl).join(', ')));
    }
    out.push(stat('Посажено', String(s.planted.length), 'planted'));
    if (s.planted.length) out.push(el('div', { class: 'list', lang: 'pl' }, s.planted.map(pl).join(', ')));
    for (const id of lines.umiem ?? []) {
      const r = cardLine(content, id, 'umiem');
      if (r) out.push(r);
    }
    // Время в заданиях — то, что считает ТЗ («минуты вспоминания»: уроки, диагностика, обход, вечер); рядом всё время
    // в игре, чтобы 3 минуты заданий не выглядели враньём при 12 минутах вечера (P-10b).
    out.push(stat('Минуты в заданиях', `${summaryMin(s.retrievalMs)} мин`, 'retrieval'));
    if (activeMs !== undefined) out.push(stat('Всего в игре', `${summaryMin(Math.max(activeMs, s.retrievalMs))} мин`, 'active'));
    out.push(stat('Завтра к поливу', String(s.tomorrowPlants), 'tomorrow'));
  }
  // Крючок на завтра (ПОЛИРОВКА §2 р. 8): «Jutro: list.» и т.п. — последней строкой, перед сном.
  const hook = lines.hook ? cardLine(content, lines.hook, 'hook') : null;
  if (hook) {
    hook.dataset['hook'] = lines.hook!;
    out.push(hook);
  }
  return out;
}

/** Активное время игрового дня: сессии `day` с начала дня + текущий таймер склейки. */
export function activeToday(events: readonly LogEvent[], since: number, current: number): number {
  let ms = current;
  for (const e of events) if (e.k === 'session' && e.mode === 'day' && e.ts >= since) ms += e.ms;
  return ms;
}

/** Открыть итог дня. Возвращает, чем закончился: сон, «ещё 3 минуты», экспресс (пустой день) или закрыт. */
export function runDaySummary(deps: DaySummaryDeps): Promise<SummaryOutcome> {
  ensureStyle(document);
  const { content, store } = deps;
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  const now = clock.now();
  const s = summarizeDay(store.progress, deriveContent(content), now, deps.tz);
  const pace = paceCtxOf(content, derive(store.progress, deriveContent(content), now, deps.tz), store.progress.world.flags, deps.tz);
  const dl = dayLines(content.director.days, pace.day);
  const silent = isSilent(store.progress);
  const lines: SummaryLines = {
    ...(dl?.sleep ? { sleep: dl.sleep.map((id) => lineFor(id, silent, content.lines)) } : {}),
    ...(dl?.umiem ? { umiem: dl.umiem } : {}),
    ...(dl?.hook ? { hook: dl.hook } : {}),
  };
  const d = derive(store.progress, deriveContent(content), now, deps.tz);
  const active = deps.activeMs ? activeToday(store.progress.log.events, d.todayStart, deps.activeMs()) : undefined;
  // «Ещё 3 минуты» — экспресс, система дня 7 (P-06): раньше в итоге только сон.
  const express = isOpen('express', pace);
  const layer = deps.overlay.open('pq-sleep-layer');
  layer.el.style.justifyContent = 'center';

  return new Promise((resolve) => {
    const finish = (o: SummaryOutcome): void => {
      layer.close();
      resolve(o);
    };
    const write = (draft: EventDraft): void => {
      const r = store.append(draft);
      if (r.ok) deps.onEvent?.(r.event);
    };
    const dobranoc = (): void => {
      const ts = clock.now();
      const since = deps.sessionStart?.() ?? 0;
      write({ k: 'session', ts, mode: 'day', ms: Math.round(deps.activeMs?.() ?? 0), retrievalMs: retrievalSince(store.progress.log.events, since) });
      write({ k: 'seg', ts, seg: 'sleep' });
      deps.onSession?.();
      deps.bus.emit('progress:changed', { kinds: ['cards'] });
      finish('sleep');
    };
    const main = plBtn(BTN.dobranoc, dobranoc, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'sleep' });
    const actions: HTMLElement[] = [];
    if (!express) {
      // до дня 7 экспресса нет (P-06): только «Dobranoc»
    } else if (s.empty) actions.push(plBtn(BTN.express, () => finish('express'), '', { 'data-nav': true, 'data-act': 'express' }));
    else actions.push(btn('ещё 3 минуты повторений', () => finish('more3'), 'ghost more3', { 'data-nav': true, 'data-act': 'more3' }));
    actions.push(main);

    const remind =
      deps.hasLink?.() && !(LINK_SAVED in store.progress.world.flags)
        ? el(
            'div',
            { class: 'remind', 'data-remind': 'link' },
            'Ссылка на твой мир ещё не сохранена. ',
            btn('Сохранить ссылку', () => {
              finish('close');
              deps.bus.emit('ui:screen:open', { screen: 'link' });
            }, 'ghost', { 'data-nav': true, 'data-act': 'link' }),
          )
        : null;

    layer.el.replaceChildren(
      el(
        'div',
        { class: 'pq-wood pq-sleep', 'data-summary': s.day },
        el('h2', {}, 'Итог дня'),
        el('div', { class: 'body' }, ...summaryBody(s, content, lines, active), remind),
        el('div', { class: 'row' }, ...actions),
      ),
    );
    layer.handle({ cancel: () => (finish('close'), true) });
    queueMicrotask(() => main.focus({ preventScroll: true }));
  });
}
