// DOM заданий «Hymn i symbole»: выбор, плитки и порядок (через `games/kit.ts`), караоке с нотной дорожкой, сборка флага и герба тап-тап.
// Ввод только кликами по кнопкам (клавиши 1–4 и стрелки ведёт движок через `data-opt` / `data-nav`).
import { el } from '../../ui/dom';
import type { GamePanel } from '../../types/polska';
import { sayButton, withSay } from '../../ui/sayButton';
import { choice, prompt, tiles } from '../kit';
import { melodyContext, melodyWarm, playNotes, soundAllowed, type Note, type PlayHandle } from './melody';
import type { HymnTask } from './tasks';

const css = `
.hy-wrap { display: flex; flex-direction: column; gap: 8px; }
.hy-pic { font-size: 54px; line-height: 1; text-align: center; margin: 2px 0 6px; }
.hy-strip { display: flex; gap: 8px; height: 58px; padding: 3px 5px; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 6px; }
.hy-seg { position: relative; display: flex; gap: 3px; flex: var(--b) 1 0; min-width: 0; }
.hy-seg + .hy-seg { border-left: 2px solid var(--pq-wood-dark); padding-left: 8px; }
.hy-seg .cap { position: absolute; left: 0; top: -1px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 700; opacity: .7; z-index: 1; }
.hy-seg + .hy-seg .cap { left: 8px; }
.hy-n { position: relative; min-width: 7px; flex: var(--d) 1 0; }
.hy-n i { position: absolute; left: 0; right: 0; height: 9px; border-radius: 5px; background: #9b7a45; bottom: calc(14px + var(--y) * 26px); }
.hy-n b { position: absolute; left: 0; right: 0; bottom: 0; text-align: center; font-size: 10px; font-weight: 600; opacity: .6; overflow: hidden; }
.hy-n.rest i { background: transparent; border: 1px dashed #b9a57a; height: 5px; bottom: 26px; }
.hy-n.on i { background: #d4552e; } .hy-n.done i { background: #6b8f3c; }
.hy-n.wait i { background: #d4552e; animation: hyblink 1.2s ease-in-out infinite; }
@keyframes hyblink { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .hy-n.wait i { animation: none; } }
.hy-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.hy-bar .pq-btn { padding: 5px 9px; font-size: 13px; }
.hy-wrap .pq-opts.three { grid-template-columns: repeat(3, 1fr); grid-auto-rows: 52px; }
.hy-wrap .pq-opts.three .pq-opt { font-size: 15px; padding: 4px 6px; }
/* Три узкие колонки: 🔊 в верхнем углу, слово прижато вниз и занимает всю ширину (иначе «Jeszcze» рвётся). */
.hy-wrap .pq-opts.three .pq-opt.has-say { align-items: flex-end; padding: 4px 6px 5px; }
.hy-wrap .pq-opts.three .pq-optw > .pq-say { width: 24px; height: 24px; min-width: 24px; top: 2px; right: 2px; }
.hy-wrap .pq-q-hint { margin-bottom: 0; }
.hy-quiet { font-size: 12px; opacity: .7; }
.hy-slots { display: flex; flex-wrap: wrap; gap: 6px; min-height: 40px; padding: 4px 6px; border: 2px dashed var(--pq-wood); border-radius: 6px; background: #fffaf0; align-items: center; }
.hy-slot { padding: 4px 9px; border-radius: 6px; background: #8cc66a; font-size: 18px; font-weight: 700; }
.hy-slot.cur { background: transparent; border: 2px dashed var(--pq-accent); min-width: 54px; text-align: center; opacity: .8; }
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
  .hy-strip { height: 50px; }
  .hy-wrap { gap: 6px; }
  .hy-bar { flex-wrap: nowrap; gap: 6px; }
  .hy-bar .pq-btn { flex: 0 0 auto; padding: 4px 8px; }
  .hy-bar .hy-quiet { flex: 1 1 auto; min-width: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hy-wrap .pq-opts.three { grid-auto-rows: 46px; }
  .hy-slots { min-height: 34px; }
  .hy-slot { font-size: 16px; padding: 3px 8px; }
}
`;

const COLOR: Record<string, string> = {
  biały: '#f6f3ea', białe: '#f6f3ea', czerwony: '#d4213d', czerwone: '#d4213d', niebieski: '#2a5fc0', niebieskie: '#2a5fc0', zielony: '#3a9a4a', czarny: '#252525', złoty: '#e0b020', złota: '#e8b923', brak: 'transparent',
};
const colorOf = (name: string): string => COLOR[name] ?? '#cccccc';

let active: PlayHandle | null = null;

/** Остановить звук и подсветку (смена задания, ответ, закрытие). */
export function stopMelody(): void {
  active?.stop();
  active = null;
}

function withCss(host: HTMLElement): void {
  host.append(el('style', { 'data-hymn-css': '' }, css));
}

/** Нотная дорожка строки: ширина ∝ длительности, высота ∝ высоте, внизу название ноты; подсветка идёт за мелодией. */
function strip(notes: readonly Note[], caption: string, label = caption): { root: HTMLElement; mark(i: number): void; done(upTo: number): void; reset(): void; wait(on: boolean): void } {
  const els = notes.map((n) => {
    const y = n.midi === null ? 0 : Math.max(0, Math.min(1, (n.midi - 64) / 13));
    const e = el('span', { class: `hy-n${n.hz ? '' : ' rest'}`, style: `--d:${n.d};--y:${y.toFixed(2)}`, 'data-note': n.p, title: n.p }, el('i'), el('b', {}, n.label));
    return e;
  });
  const root = el('div', { class: 'hy-seg', style: `--b:${notes.reduce((a, n) => a + n.d, 0)}`, 'data-strip': caption }, el('span', { class: 'cap' }, label), ...els);
  return {
    root,
    mark(i) {
      els.forEach((e, k) => {
        e.classList.toggle('on', k === i);
        e.classList.toggle('done', k < i);
        e.classList.remove('wait');
      });
    },
    done(upTo) {
      els.forEach((e, k) => e.classList.toggle('done', k < upTo));
    },
    reset() {
      for (const e of els) e.classList.remove('on', 'done', 'wait');
    },
    wait(on) {
      els[0]?.classList.toggle('wait', on);
    },
  };
}

/** Экран ещё на месте: не перерисован заданием и не закрыт (иначе прогон мелодии обрывается). */
const alive = (host: HTMLElement) => (): boolean => host.isConnected && !host.closest('[hidden]');

// ───────────────────────── караоке ─────────────────────────

function renderKaraoke(task: HymnTask, panel: GamePanel): void {
  const steps = task.steps ?? [];
  const notes = task.notes ?? [];
  const bpm = task.bpm ?? 116;
  const wrap = el('div', { class: 'hy-wrap', 'data-karaoke': '' });
  withCss(wrap);
  panel.body.append(wrap);
  const ok = alive(wrap);
  // Строка перед пропетой («… Jeszcze Polska nie zginęła») польская: с 🔊 рядом («Początek hymnu» тоже).
  wrap.append(el('div', { class: 'pq-pg-q', 'data-prompt': '' }, el('div', { class: 'pq-qrow' }, el('div', { class: 'pq-q', lang: 'pl' }, task.prompt), sayButton(task.prompt, panel.say, { main: true })), el('div', { class: 'pq-q-hint' }, task.hint ?? '')));

  const main = strip(notes, 'Ten wers');
  const before = task.ctxNotes ? strip(task.ctxNotes, 'Poprzedni wers', task.ctxText ? `♪ ${task.ctxText}` : 'Poprzedni wers') : null;
  wrap.append(el('div', { class: 'hy-strip' }, ...(before ? [before.root] : []), main.root));

  const run = (s: ReturnType<typeof strip>, ns: readonly Note[], then?: () => void): void => {
    stopMelody();
    before?.reset();
    main.reset();
    s.wait(false);
    active = playNotes(ns, bpm, melodyContext(), {
      alive: ok,
      onNote: (i) => s.mark(i),
      onEnd: () => {
        s.reset();
        then?.();
      },
    });
  };
  const bar = el('div', { class: 'hy-bar' });
  if (before && task.ctxNotes) {
    bar.append(
      el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-play-ctx': '', onclick: () => run(before, task.ctxNotes!, () => main.wait(true)) }, '▶ Poprzedni'),
    );
  }
  bar.append(el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-play-line': '', onclick: () => run(main, notes) }, '♪ Ten wers'));
  if (!soundAllowed()) bar.append(el('span', { class: 'hy-quiet', 'data-quiet': '' }, 'без звука · смотри ноты'));
  wrap.append(bar);

  const slots = el('div', { class: 'hy-slots', 'data-slots': '' });
  const grid = el('div', { class: 'pq-opts three', 'data-opts': '' });
  wrap.append(slots, grid);
  const picked: string[] = [];
  const paint = (): void => {
    slots.replaceChildren(...picked.map((w) => el('span', { class: 'hy-slot' }, w)), el('span', { class: 'hy-slot cur' }, '…'));
    main.done(Math.floor((picked.length / Math.max(1, steps.length)) * notes.length));
    const step = steps[picked.length]!;
    grid.replaceChildren(
      ...step.options.map((o, i) => {
        const b = el(
          'button',
          {
            type: 'button',
            class: 'pq-btn pq-opt',
            'data-nav': '',
            'data-opt': o,
            onclick: () => {
              if (b.disabled) return;
              if (o === step.word) {
                picked.push(o);
                b.classList.add('right');
                if (picked.length === steps.length) {
                  stopMelody();
                  panel.submit([...picked]);
                } else {
                  panel.say(o);
                  paint();
                }
              } else {
                b.classList.add('wrong');
                stopMelody();
                panel.submit([...picked, o]);
              }
            },
          },
          el('span', { class: 'n' }, `${i + 1}`),
          el('span', { class: 't' }, o),
        );
        return withSay(b, o, panel.say);
      }),
    );
  };
  paint();
  // Контекст звучит сам, только если жест уже был (контекст разбужен) и звук разрешён; иначе ждёт тапа.
  if (before && task.ctxNotes && melodyWarm()) run(before, task.ctxNotes, () => main.wait(true));
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
  stopMelody();
  switch (task.mode) {
    case 'choice': {
      const q = prompt(panel, task.prompt, task.hint ?? '', task.lang);
      if (task.pic) q.before(el('div', { class: 'hy-pic', 'aria-hidden': 'true', 'data-pic': '' }, task.pic));
      // Варианты польские, кроме перевода строки («mean»): русские без 🔊.
      choice(panel, task.options, task.answer as string, task.kind === 'mean' ? 'ru' : 'pl');
      return;
    }
    case 'tiles':
    case 'order':
      prompt(panel, task.prompt, task.hint ?? '', task.lang, task.kind === 'order-lines' ? 'Kolejność' : undefined);
      tiles(panel, task.options);
      return;
    case 'karaoke':
      renderKaraoke(task, panel);
      return;
    case 'flag':
      renderFlag(task, panel);
      return;
    case 'godlo':
      renderGodlo(task, panel);
      return;
  }
}
