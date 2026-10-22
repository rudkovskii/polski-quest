// DOM заданий «Hymn i symbole»: выбор, плитки и порядок (через `games/kit.ts`), сборка флага и герба тап-тап. Музыки и нот нет (решение Шэфа 22.10).
// Ввод только кликами по кнопкам (клавиши 1–4 и стрелки ведёт движок через `data-opt` / `data-nav`).
import { el } from '../../ui/dom';
import type { GamePanel } from '../../types/polska';
import { choice, prompt, tiles } from '../kit';
import type { HymnTask } from './tasks';

const css = `
.hy-wrap { display: flex; flex-direction: column; gap: 8px; }
.hy-pic { font-size: 54px; line-height: 1; text-align: center; margin: 2px 0 6px; }
.hy-wrap .pq-q-hint { margin-bottom: 0; }
.hy-flagbox { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.hy-flag { width: 96px; height: 60px; border: 2px solid var(--pq-ink); border-radius: 3px; overflow: hidden; display: flex; flex-direction: column; flex: 0 0 auto; background: #d9d2c0; }
.hy-flag div { flex: 1 1 50%; }
.hy-rows { display: flex; flex-direction: column; gap: 6px; flex: 1 1 200px; min-width: 0; }
.hy-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.hy-row .lbl { flex: 0 0 50px; font-size: 13px; font-weight: 700; }
.hy-pick { display: inline-flex; align-items: center; gap: 5px; color: var(--pq-ink); background: #fffaf0; padding: 5px 8px; font-size: 14px; }
.hy-pick.sel { background: #f2dcae; outline: 3px solid var(--pq-accent); outline-offset: -1px; }
.hy-pick .sw { width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--pq-ink); flex: 0 0 auto; }
.hy-shield { flex: 0 0 auto; }
@media (max-width: 520px), (max-height: 860px) {
  .hy-flagbox { gap: 8px; align-items: flex-start; }
  .hy-flag { width: 72px; height: 45px; }
  .hy-shield { width: 52px; height: 61px; }
  .hy-rows { flex: 1 1 100%; gap: 4px; }
  .hy-row { display: grid; grid-template-columns: 44px repeat(var(--n, 4), minmax(0, 1fr)); gap: 4px; }
  .hy-row .lbl { font-size: 12px; }
  .hy-pick { justify-content: center; gap: 4px; padding: 6px 3px; font-size: 13px; min-width: 0; overflow: hidden; white-space: nowrap; }
  .hy-row[data-n="4"] .hy-pick { flex-direction: column; gap: 2px; padding: 3px 2px; font-size: 12px; }
  .hy-wrap { gap: 6px; }
}
`;

const COLOR: Record<string, string> = {
  biały: '#f6f3ea', białe: '#f6f3ea', czerwony: '#d4213d', czerwone: '#d4213d', niebieski: '#2a5fc0', niebieskie: '#2a5fc0', zielony: '#3a9a4a', czarny: '#252525', złoty: '#e0b020', złota: '#e8b923', brak: 'transparent',
};
const colorOf = (name: string): string => COLOR[name] ?? '#cccccc';

function withCss(host: HTMLElement): void {
  host.append(el('style', { 'data-hymn-css': '' }, css));
}

// ───────────────────────── сборка флага и герба ─────────────────────────

// Выбор части флага/герба — как плитки: тап по польскому слову сразу его произносит (в ряду на 4–5 колонок места под отдельную 🔊 нет).
const rowsOf = (wrap: HTMLElement, defs: { key: string; label: string; options: string[] }[], sel: Record<string, string>, onChange: () => void, say: (t: string) => void): void => {
  const box = el('div', { class: 'hy-rows' });
  for (const d of defs) {
    const row = el('div', { class: 'hy-row', 'data-row': d.key, 'data-n': String(d.options.length), style: `--n:${d.options.length}` }, el('span', { class: 'lbl' }, d.label));
    for (const o of d.options) {
      const b = el(
        'button',
        {
          type: 'button',
          class: 'pq-btn hy-pick',
          'data-nav': '',
          'data-pick': `${d.key}:${o}`,
          'aria-pressed': 'false',
          onclick: () => {
            if (b.disabled) return;
            sel[d.key] = o;
            say(o);
            for (const x of row.querySelectorAll<HTMLElement>('.hy-pick')) {
              x.classList.toggle('sel', x === b);
              x.setAttribute('aria-pressed', String(x === b));
            }
            onChange();
          },
        },
        el('span', { class: 'sw', style: `background:${colorOf(o)}` }),
        o,
      );
      row.append(b);
    }
    box.append(row);
  }
  wrap.append(box);
};

const footFor = (panel: GamePanel, sel: Record<string, string>, keys: string[], reset: () => void): (() => void) => {
  const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', disabled: true, onclick: () => keys.every((k) => sel[k]) && panel.submit({ ...sel }) }, 'Sprawdź · Проверить');
  const clear = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-reset': '', onclick: reset }, 'Сбросить');
  panel.foot.replaceChildren(clear, check);
  return () => {
    check.disabled = !keys.every((k) => sel[k]);
  };
};

function renderFlag(task: HymnTask, panel: GamePanel): void {
  const sel: Record<string, string> = {};
  const top = el('div');
  const bottom = el('div');
  const flag = el('div', { class: 'hy-flag', 'data-flag': '', role: 'img', 'aria-label': 'Flaga' }, top, bottom);
  const wrap = el('div', { class: 'hy-wrap' });
  withCss(wrap);
  prompt(panel, task.prompt, task.hint ?? '');
  panel.body.append(wrap);
  const box = el('div', { class: 'hy-flagbox' }, flag);
  wrap.append(box);
  const refresh = footFor(panel, sel, ['top', 'bottom'], () => {
    for (const k of Object.keys(sel)) delete sel[k];
    for (const x of wrap.querySelectorAll<HTMLElement>('.hy-pick')) {
      x.classList.remove('sel');
      x.setAttribute('aria-pressed', 'false');
    }
    paint();
  });
  const paint = (): void => {
    top.style.background = sel.top ? colorOf(sel.top) : '';
    bottom.style.background = sel.bottom ? colorOf(sel.bottom) : '';
    refresh();
  };
  rowsOf(box, [{ key: 'top', label: 'Góra', options: task.parts?.top ?? [] }, { key: 'bottom', label: 'Dół', options: task.parts?.bottom ?? [] }], sel, paint, panel.say);
}

const shield = (s: Record<string, string>): string => {
  const field = s.field ? colorOf(s.field) : '#d9d2c0';
  const eagle = s.eagle ? colorOf(s.eagle) : 'none';
  const crown = s.crown === 'złota' ? colorOf('złota') : 'none';
  return `<svg class="hy-shield" viewBox="0 0 60 70" width="66" height="77" role="img" aria-label="Godło" data-shield="${s.field ?? ''}|${s.eagle ?? ''}|${s.crown ?? ''}">
<path d="M4 4h52v34c0 16-14 24-26 28C18 62 4 54 4 38z" fill="${field}" stroke="#2a1418" stroke-width="2"/>
<g fill="${eagle}" stroke="#2a1418" stroke-width="1.2" stroke-linejoin="round">
<path d="M30 24 L36 31 L50 25 L45 39 L36 43 L30 57 L24 43 L15 39 L10 25 L24 31z"/>
<circle cx="30" cy="24" r="5"/>
<path d="M34 23 l6 2 l-6 2z" fill="#e0b020"/></g>
<path d="M23 16 l1.5 -8 l5.5 4 l5.5 -4 l1.5 8z" fill="${crown}" stroke="${crown === 'none' ? 'none' : '#2a1418'}" stroke-width="1"/>
</svg>`;
};

function renderGodlo(task: HymnTask, panel: GamePanel): void {
  const sel: Record<string, string> = {};
  const wrap = el('div', { class: 'hy-wrap' });
  withCss(wrap);
  prompt(panel, task.prompt, task.hint ?? '');
  panel.body.append(wrap);
  const box = el('div', { class: 'hy-flagbox' });
  const holder = el('span', { class: 'hy-shield-box', 'data-godlo': '' });
  box.append(holder);
  wrap.append(box);
  const paint = (): void => {
    holder.innerHTML = shield(sel);
    refresh();
  };
  const refresh = footFor(panel, sel, ['field', 'eagle', 'crown'], () => {
    for (const k of Object.keys(sel)) delete sel[k];
    for (const x of wrap.querySelectorAll<HTMLElement>('.hy-pick')) {
      x.classList.remove('sel');
      x.setAttribute('aria-pressed', 'false');
    }
    paint();
  });
  const p = task.parts ?? {};
  rowsOf(box, [{ key: 'field', label: 'Pole', options: p.field ?? [] }, { key: 'eagle', label: 'Orzeł', options: p.eagle ?? [] }, { key: 'crown', label: 'Korona', options: p.crown ?? [] }], sel, paint, panel.say);
  paint();
}

// ───────────────────────── вход ─────────────────────────

export function renderTask(task: HymnTask, panel: GamePanel): void {
  switch (task.mode) {
    case 'choice': {
      const q = prompt(panel, task.prompt, task.hint ?? '', task.lang);
      if (task.pic) q.before(el('div', { class: 'hy-pic', 'aria-hidden': 'true', 'data-pic': '' }, task.pic));
      // Варианты польские, кроме перевода строки («mean»): русские без 🔊.
      choice(panel, task.options, task.answer as string, task.kind === 'mean' ? 'ru' : 'pl');
      return;
    }
    case 'tiles':
    case 'order': {
      const q = prompt(panel, task.prompt, task.hint ?? '', task.lang);
      // Короткий польский заголовок задания над строкой-опорой: сразу видно, что делать.
      if (task.title) q.prepend(el('div', { class: 'hy-title', 'data-title': '', lang: 'pl', style: 'font-weight:700;font-size:15px;margin-bottom:2px' }, task.title));
      tiles(panel, task.options);
      return;
    }
    case 'flag':
      renderFlag(task, panel);
      return;
    case 'godlo':
      renderGodlo(task, panel);
      return;
  }
}
