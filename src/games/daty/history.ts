// Daty: историческая справка к дате (`history` в daty.json: ru 2–3 предложения, pl — одна фраза A1–A2, key — польские слова жирным).
// Показывается дважды: карточкой «Poznaj datę · Знакомство» перед первым вопросом (пока флаг «знакомство принято» не стоит) и блоком
// в отзыве после каждого ответа. Модуль без игрового состояния: чистые функции + сборка DOM.
import { el } from '../../ui/dom';
import { sayButton, type SayFn } from '../../ui/sayButton';
import type { GameCtx, PolskaUnit } from '../../types/polska';
import { leaf } from './view';
import { dateOfUnit, yearOfUnit } from './model';

export interface History {
  ru: string;
  pl: string;
  key: readonly string[];
}

/** Справка единицы: `history` из данных (null — нет или неполная). */
export function historyOf(u: PolskaUnit): History | null {
  const h = u.raw.history;
  if (!h || typeof h !== 'object') return null;
  const { ru, pl, key } = h as Record<string, unknown>;
  if (typeof ru !== 'string' || !ru.trim() || typeof pl !== 'string' || !pl.trim()) return null;
  return { ru, pl, key: Array.isArray(key) ? key.filter((k): k is string => typeof k === 'string' && !!k) : [] };
}

export interface Run {
  t: string;
  /** Ключевое польское слово — жирным. */
  b: boolean;
}

/** Русский текст кусками: слова из `key` (дословно, длинные раньше коротких) помечены жирными. */
export function boldKeys(text: string, keys: readonly string[]): Run[] {
  const list = [...new Set(keys)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length) return [{ t: text, b: false }];
  const re = new RegExp(list.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
  const out: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), b: false });
    out.push({ t: m[0], b: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), b: false });
  return out;
}

/** Игрок ещё не принял знакомство с датой («Rozumiem · Понятно»): флага в сохранении нет, даже если ответы уже были. */
export const isFirst = (ctx: Pick<GameCtx, 'seen'>, id: string): boolean => !ctx.seen(id);

export const HIST_CSS = `
.dt-hist { text-align: left; }
.dt-hist-ru { margin: 0; font-size: 13px; line-height: 1.3; overflow-wrap: break-word; }
.dt-hist-ru b { font-weight: 800; }
.dt-hist-pl { display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 14px; font-weight: 700; font-style: italic; }
.dt-hist-ru .pq-say { vertical-align: middle; margin-left: 3px; margin-right: 2px; }
.pq-pg .fb .dt-hist { margin: 3px 0 2px; padding-top: 3px; border-top: 2px dashed var(--pq-wood); }
.dt-intro-lbl { font-size: 13px; font-weight: 800; letter-spacing: .3px; opacity: .8; margin: 2px 0 0; }
.dt-intro-top { display: flex; align-items: flex-start; gap: 12px; }
.dt-intro-top .dt-leaf { flex: 0 0 auto; margin: 4px 0 6px; }
.dt-intro-ev { flex: 1 1 auto; min-width: 0; padding-top: 6px; }
.dt-intro-ev .pl { font-size: 19px; font-weight: 800; line-height: 1.2; overflow-wrap: break-word; }
.dt-intro-ev .ru { font-size: 14px; opacity: .85; margin-top: 3px; }
.dt-intro .dt-hist { background: #fffaf0; border: 2px solid var(--pq-wood); border-radius: 6px; padding: 8px 10px; margin-bottom: 4px; }
.dt-intro .dt-hist-ru, .dt-intro .dt-hist-pl { font-size: 15px; }
/* После ответа варианты ужимаются, чтобы справка в отзыве влезла без прокрутки (телефон 375×812). */
.pq-pg .dt.dt-done .pq-opts { grid-auto-rows: minmax(38px, auto); }
.pq-pg .dt.dt-done .pq-opt { min-height: 38px; }
@media (max-width: 520px) { .dt-day, .dt-blank { min-height: 33px; } .pq-pg .dt.dt-done .dt-day, .pq-pg .dt.dt-done .dt-blank { min-height: 26px; } }
@media (min-width: 720px) { .pq-pg .fb .dt-hist-ru, .pq-pg .fb .dt-hist-pl { font-size: 15px; } }
`;

/** Блок справки: русский текст, у каждого польского ключа жирным — своя 🔊; польская фраза справки — тоже с 🔊 (звук только по нажатию). */
export function historyBlock(h: History, say: SayFn): HTMLElement {
  const parts: (HTMLElement | string)[] = [];
  for (const r of boldKeys(h.ru, h.key)) {
    if (r.b) parts.push(el('b', { lang: 'pl', 'data-key': '' }, r.t), sayButton(r.t, say, { inline: true, attrs: { 'data-say-key': '' } }));
    else parts.push(r.t);
  }
  const ru = el('p', { class: 'dt-hist-ru', lang: 'ru', 'data-history-ru': '' }, ...parts);
  const pl = el('div', { class: 'dt-hist-pl', 'data-history-pl': '' }, sayButton(h.pl, say, { attrs: { 'data-say-history': '' } }), el('span', { lang: 'pl' }, h.pl));
  return el('div', { class: 'dt-hist', 'data-history': '' }, ru, pl);
}

/** Карточка «Poznaj datę · Знакомство»: лист календаря, название события PL/RU и справка. Кнопку «Rozumiem» ставит игра в подвал. */
export function introCard(doc: Readonly<Record<string, unknown>>, u: PolskaUnit, h: History, say: SayFn): HTMLElement {
  const a = dateOfUnit(u);
  return el(
    'div',
    { class: 'dt-intro', 'data-intro': u.id },
    el('div', { class: 'dt-intro-lbl' }, 'Poznaj datę · Знакомство'),
    el('div', { class: 'dt-intro-top' }, leaf(doc, a, yearOfUnit(u)), el('div', { class: 'dt-intro-ev' }, el('div', { class: 'pl', lang: 'pl', 'data-intro-pl': '' }, u.pl), el('div', { class: 'ru', 'data-intro-ru': '' }, u.ru))),
    historyBlock(h, say),
  );
}
