// DaySummary «Сон» (ТЗ §5.9), I-12: итог игрового дня из журнала (systems/session.ts → summarizeDay).
// Показывает: полито (только обход и экспресс, включая ранний полив первого дня) и покрытие, что выросло и созрело, посажено, złoty (заглушка до I-18), минуты
// вспоминания (уроки и диагностика целиком + ответы вне уроков), сколько ждёт полива завтра. «Dobranoc» пишет `session {mode: 'day'}` и `seg: sleep`;
// маленькая ссылка «ещё 3 минуты повторений» → экспресс (seg `more3`, пишет обход). Пустой день →
// «Сегодня ещё ничего, полей хоть пару грядок?» и кнопка экспресса. Крючок (реплика следующей сцены) — I-13.
import type { Bus } from '../systems/bus';
import type { Content } from '../systems/content';
import { deriveContent } from '../systems/derive';
import type { EventDraft, LogEvent } from '../systems/log';
import type { AppendResult, Progress } from '../systems/progress';
import { retrievalSince, summarizeDay, type DaySummary } from '../systems/session';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import type { Overlay } from './overlay/host';
import { BTN, btn, plBtn } from './overlay/kit';
import { bobrLine } from './obchod';

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
  /** Своя карточка итога (P-05, день 1): строки вместо счётчиков, крючок на завтра, только «Dobranoc». */
  view?: SummaryView;
}

/** Итог дня карточкой из реплик (СЮЖЕТ_v2 d01.s8): `lines` — строки итога, `hook` — «Jutro: …», `bobr` — реплика сверху (null — без неё). */
export interface SummaryView {
  bobr?: string | null;
  lines: string[];
  hook?: string;
}

export type SummaryOutcome = 'sleep' | 'more3' | 'express' | 'close';

const STAGE_RU = { seed: 'семя', sprout: 'росток', bush: 'куст', jar: 'банка' } as const;

const css = `
.pq-sleep { width: min(100% - 16px, 520px); max-height: calc(100% - 24px); overflow-y: auto; margin: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
.pq-sleep h2 { margin: 0; font-size: 24px; color: #543c52; }
.pq-sleep .stat { display: flex; justify-content: space-between; gap: 12px; font-size: 18px; border-bottom: 2px dotted #c8966b; padding: 4px 0; }
.pq-sleep .list { font-size: 17px; color: #345a52; }
.pq-sleep .empty { font-size: 19px; }
.pq-sleep .row { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
.pq-sleep .more3 { font-size: 16px; text-decoration: underline; min-height: 44px; }
.pq-sleep .remind { font-size: 16px; color: #8f3e56; }
.pq-sleep .card-line { display: flex; flex-direction: column; gap: 2px; font-size: 20px; font-weight: 700; color: #3a2c38; }
.pq-sleep .card-line small { font-size: 15px; font-weight: 400; color: #543c52; }
.pq-sleep .hook { margin-top: 6px; color: #8f3e56; }
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

/** Тело итога (без кнопок): удобно проверять в тестах. */
export function summaryBody(s: DaySummary, content: Pick<Content, 'vocab' | 'lines'>): HTMLElement[] {
  const pl = (id: string): string => content.vocab.get(id)?.value.pl ?? id;
  const out: HTMLElement[] = [];
  const line = bobrLine(content, 'kazik.sleep');
  if (line) out.push(line);
  if (s.empty) {
    out.push(el('div', { class: 'empty', 'data-empty': true }, 'Сегодня ещё ничего, полей хоть пару грядок?'));
    return out;
  }
  out.push(stat('Полито', `${s.watered} из ${s.answered}`, 'watered'));
  out.push(stat('Повторено из нужного', `${s.reviewed} из ${s.wasDue}`, 'coverage'));
  out.push(stat('Выросло', String(s.grew.length), 'grew'));
  if (s.grew.length) out.push(el('div', { class: 'list', lang: 'pl' }, s.grew.map((g) => `${pl(g.item)}: ${STAGE_RU[g.from]} → ${STAGE_RU[g.to]}`).join(', ')));
  out.push(stat('Созрело (в банку)', String(s.matured.length), 'matured'));
  if (s.matured.length) out.push(el('div', { class: 'list', lang: 'pl' }, s.matured.map(pl).join(', ')));
  out.push(stat('Посажено', String(s.planted.length), 'planted'));
  if (s.planted.length) out.push(el('div', { class: 'list', lang: 'pl' }, s.planted.map(pl).join(', ')));
  out.push(stat('Złoty', s.zloty === null ? '—' : `${s.zloty} zł`, 'zloty'));
  // Меньше полуминуты — всё равно «1 мин»: игрок работал, ноль выглядит как «ничего не сделал» (P-01).
  const min = s.retrievalMs > 0 ? Math.max(1, Math.round(s.retrievalMs / 60_000)) : 0;
  out.push(stat('Минуты вспоминания', `${min} мин`, 'retrieval'));
  out.push(stat('Завтра к поливу', String(s.tomorrow), 'tomorrow'));
  return out;
}

/** Тело карточки итога из реплик (день 1). */
export function summaryCard(v: SummaryView, content: Pick<Content, 'vocab' | 'lines'>): HTMLElement[] {
  const out: HTMLElement[] = [];
  const line = v.bobr === null ? null : bobrLine(content, v.bobr ?? 'kazik.sleep');
  if (line) out.push(line);
  const row = (id: string, cls: string): HTMLElement | null => {
    const l = content.lines.get(id);
    if (!l || l.todo) return null;
    return el('div', { class: `card-line ${cls}`.trim(), 'data-line': id }, el('span', { lang: 'pl' }, l.pl ?? l.ru ?? ''), l.pl && l.plRu ? el('small', {}, l.plRu) : null);
  };
  for (const id of v.lines) {
    const r = row(id, '');
    if (r) out.push(r);
  }
  const hook = v.hook ? row(v.hook, 'hook') : null;
  if (hook) out.push(hook);
  return out;
}

/** Открыть итог дня. Возвращает, чем закончился: сон, «ещё 3 минуты», экспресс (пустой день) или закрыт. */
export function runDaySummary(deps: DaySummaryDeps): Promise<SummaryOutcome> {
  ensureStyle(document);
  const { content, store } = deps;
  const clock = deps.clock ?? { now: () => Date.now(), mono: () => performance.now() };
  const now = clock.now();
  const s = summarizeDay(store.progress, deriveContent(content), now, deps.tz);
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
    if (deps.view) {
      // день 1: только «Dobranoc»
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
      el('div', { class: 'pq-wood pq-sleep', 'data-summary': s.day }, el('h2', {}, 'Итог дня'), ...(deps.view ? summaryCard(deps.view, content) : summaryBody(s, content)), remind, el('div', { class: 'row' }, ...actions)),
    );
    layer.handle({ cancel: () => (finish('close'), true) });
    queueMicrotask(() => main.focus({ preventScroll: true }));
  });
}
