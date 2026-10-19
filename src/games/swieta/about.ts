// Игра «Święta»: блок «О празднике · O święcie» — контекст праздника (`about` узла колеса): русский текст с ключевыми польскими словами
// жирным и 2–3 простых польских предложения, у каждого своя 🔊 (`audio:play`). Один компонент на двух экранах: карточка выбранного праздника
// на колесе и карточка «Poznaj święto» / «ℹ Справка». На узком экране блок свёрнут (русский в 2 строки, польские скрыты) с кнопкой
// «Подробнее ▾»; развёрнутое листается внутри блока, колесо и страница не сдвигаются. На просторном экране развёрнут всегда.
import { el } from '../../ui/dom';
import { sayButton, type SayFn } from '../../ui/sayButton';
import type { About } from './wheel';

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

/** Просторный экран: блок развёрнут всегда, кнопки «Подробнее» нет. Тот же порог — в CSS. */
export const ROOMY = '(min-width: 700px) and (min-height: 880px)';

export const ABOUT_CSS = `
.pq-pg .sw-about { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 3px; padding: 5px 8px 6px; background: #fff4d6; border: 2px solid var(--pq-wood-dark); border-radius: 8px; text-align: left; font-size: 13px; line-height: 1.32; }
.pq-pg .sw-about h4 { margin: 0; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .65; font-weight: 800; }
.pq-pg .sw-about .sw-ab-body { display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.pq-pg .sw-about .sw-ab-ru { margin: 0; overflow-wrap: anywhere; }
.pq-pg .sw-about .sw-ab-ru b { font-weight: 800; color: #7a3a14; }
.pq-pg .sw-about .sw-ab-pl { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 4px 0 0; list-style: none; border-top: 2px dashed var(--pq-wood); }
.pq-pg .sw-about .sw-ab-pl li { display: flex; align-items: center; gap: 6px; font-style: italic; font-weight: 700; }
.pq-pg .sw-about .sw-ab-pl li > span { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.pq-pg .sw-about .sw-more { align-self: flex-start; padding: 2px 8px; font: inherit; font-size: 12px; font-weight: 800; color: var(--pq-ink); background: #f2dcae; border: 2px solid var(--pq-wood-dark); border-radius: 5px; cursor: pointer; touch-action: manipulation; }
/* Свёрнуто: русский в 2 строки, польские скрыты. Развёрнуто: листается внутри блока. */
.pq-pg .sw-about:not(.open) .sw-ab-ru { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pq-pg .sw-about:not(.open) .sw-ab-pl { display: none; }
.pq-pg .sw-about.open .sw-ab-body { max-height: min(178px, 25dvh); overflow-y: auto; overscroll-behavior: contain; }
@media ${ROOMY} {
  .pq-pg .sw-about { font-size: 14px; }
  .pq-pg .sw-about .sw-more { display: none; }
  .pq-pg .sw-about:not(.open) .sw-ab-ru { display: block; overflow: visible; }
  .pq-pg .sw-about:not(.open) .sw-ab-pl { display: flex; }
  .pq-pg .sw-about.open .sw-ab-body { max-height: none; overflow: visible; }
}
.pq-pg .sw-about.full { background: #fffaf0; font-size: 14.5px; }
.pq-pg .sw-about.full .sw-ab-body { max-height: none; overflow: visible; }
`;

/** Блок «О празднике»: `compact` — свёрнуто на узком экране с кнопкой «Подробнее ▾» (колесо); иначе всегда целиком (карточка). */
export function aboutBlock(about: About, say: SayFn, compact: boolean, onToggle?: (open: boolean) => void): HTMLElement {
  const ru = el('p', { class: 'sw-ab-ru', lang: 'ru', 'data-about-ru': '' }, ...boldKeys(about.ru, about.key).map((r) => (r.b ? el('b', { lang: 'pl' }, r.t) : r.t)));
  const pl = el(
    'ul',
    { class: 'sw-ab-pl', 'data-about-pl': '' },
    ...about.pl.map((s) => el('li', {}, el('span', { lang: 'pl', 'data-about-sentence': '' }, s), sayButton(s, say, { attrs: { 'data-say-about': '' } }))),
  );
  const box = el('div', { class: `sw-about${compact ? '' : ' open full'}`, 'data-about': '' }, el('h4', {}, 'O święcie · О празднике'), el('div', { class: 'sw-ab-body' }, ru, pl));
  if (compact) {
    const more = el('button', { type: 'button', class: 'sw-more', 'data-about-more': '', 'aria-expanded': 'false', onclick: () => {
      const open = box.classList.toggle('open');
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Свернуть ▴' : 'Подробнее ▾';
      onToggle?.(open);
    } }, 'Подробнее ▾');
    box.append(more);
  }
  return box;
}
