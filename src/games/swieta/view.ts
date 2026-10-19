// Игра «Święta»: DOM заданий в листе движка (`layout: 'full'`). Каждое задание — узкий лист по центру, высота листа подгоняется под содержимое
// (`panel.fit`), чтобы под вопросом не оставалось пустого места. Колесо и карточка знакомства — в `hub.ts`.
import { el } from '../../ui/dom';
import type { GamePanel } from '../../types/polska';
import { atlasIcon, plantIconFrame } from '../../ui/atlasIcon';
import { sayButton, withSay } from '../../ui/sayButton';
import { choice, prompt, tiles } from '../kit';
import { frameIcon, itemIcon, itemWord } from './icons';
import { creditLine, picCss, picFrame } from './pic';
import type { ItemRef, SwTask } from './tasks';

export const css = `
.pq-pg .sw-q { max-width: 640px; margin-left: auto; margin-right: auto; }
.pq-pg .sw-ico { display: inline-block; flex: 0 0 auto; background-repeat: no-repeat; image-rendering: pixelated; }
.pq-pg .sw-ico.emoji { width: 32px; height: 32px; font-size: 28px; line-height: 32px; text-align: center; background: none; }
.pq-pg .sw-clue { display: flex; gap: 10px; margin: 2px 0 10px; }
.pq-pg .sw-clue .sw-card { flex: 1 1 0; }
.pq-pg .sw-clue > .pq-optw { flex: 1 1 0; }
.pq-pg .pq-optw > .sw-card { flex: 1 1 auto; min-width: 0; }
.pq-pg .sw-pack .pq-say { width: 22px; height: 22px; min-width: 22px; top: 1px; right: 1px; font-size: 11px; }
.pq-pg .sw-bigrow > .sw-big { flex: 1 1 auto; min-width: 0; }
.pq-pg .sw-bigrow > .pq-say { margin-top: 10px; }
.pq-pg .sw-big { font-size: 24px; font-weight: 800; margin: 2px 0 10px; padding: 8px 10px; background: #fffaf0; border: 2px dashed var(--pq-wood); border-radius: 8px; overflow-wrap: break-word; }
.pq-pg .sw-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; box-sizing: border-box; min-height: 74px; padding: 4px 4px 5px; color: var(--pq-ink); background: #fffaf0; text-align: center; }
.pq-pg .sw-card .sw-box { height: 34px; display: flex; align-items: center; justify-content: center; }
.pq-pg .sw-card .sw-box .sw-ico { margin: 0 auto; }
.pq-pg .sw-card .sw-pl { font-size: 15px; font-weight: 800; line-height: 1.1; overflow-wrap: anywhere; }
.pq-pg .sw-card .sw-ru { font-size: 11px; font-weight: 600; opacity: .65; line-height: 1.1; }
.pq-pg .sw-clue .sw-card { min-height: 120px; cursor: default; }
.pq-pg .sw-clue .sw-card .sw-box { height: 64px; }
.pq-pg .sw-clue .sw-ico.emoji { width: 48px; height: 48px; font-size: 40px; line-height: 48px; }
.pq-pg .sw-clue .sw-card .sw-pl { font-size: 18px; }
.pq-pg .sw-pack { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 6px; }
.pq-pg .sw-pack .sw-card.sel { background: #cfe6a8; outline: 3px solid var(--pq-leaf); outline-offset: -3px; }
.pq-pg .sw-pack .sw-card.right { background: #8cc66a; }
.pq-pg .sw-pack .sw-card.wrong { background: #e88e7c; }
.pq-pg .sw-pack .sw-card.miss { background: #f2dcae; outline: 3px dashed var(--pq-leaf); outline-offset: -3px; }
.pq-pg .sw-count { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 14px; font-weight: 700; }
.pq-pg .sw-count .sw-ico.emoji { width: 22px; height: 22px; font-size: 18px; line-height: 22px; }
.pq-pg .sw-qpic { width: min(100%, 300px); margin: 0 auto 10px; }
.pq-pg .sw-qpic .sw-frame { margin-bottom: 6px; }
.pq-pg .sw-opts-long { grid-template-columns: 1fr; grid-auto-rows: minmax(48px, auto); }
.pq-pg .sw-opts-long .pq-opt { font-size: 15px; }
@media (max-width: 720px), (max-height: 860px) {
  .pq-pg .sw-clue { margin: 0 0 8px; gap: 8px; }
  .pq-pg .sw-clue .sw-card { min-height: 54px; display: grid; grid-template-columns: 40px minmax(0, 1fr); grid-template-rows: auto auto; align-content: center; column-gap: 6px; text-align: left; justify-items: start; }
  .pq-pg .sw-clue .sw-card .sw-box { height: 40px; width: 40px; grid-row: span 2; align-self: center; }
  .pq-pg .sw-clue .sw-ico.emoji { width: 36px; height: 36px; font-size: 30px; line-height: 36px; }
  .pq-pg .sw-clue .sw-box .sw-ico:not(.emoji) { transform: scale(.75); }
  .pq-pg .sw-clue .sw-card .sw-pl { font-size: 16px; }
  .pq-pg .sw-big { font-size: 19px; margin: 0 0 8px; padding: 5px 8px; }
  .pq-pg .sw-card { min-height: 66px; }
  .pq-pg .sw-pack { grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 4px; }
  .pq-pg .sw-pack .sw-card { min-height: 52px; padding: 1px 2px 2px; gap: 0; }
  .pq-pg .sw-count { margin-bottom: 4px; }
  .pq-pg .sw-pack .sw-card .sw-box { height: 26px; }
  .pq-pg .sw-pack .sw-card .sw-box .sw-ico:not(.emoji) { transform: scale(.8); }
  .pq-pg .sw-pack .sw-card .sw-box .sw-ico.emoji { width: 26px; height: 26px; font-size: 22px; line-height: 26px; }
  .pq-pg .sw-pack .sw-card .sw-pl { font-size: 12px; line-height: 1.05; }
  .pq-pg .sw-pack .sw-card .sw-ru { font-size: 10px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pq-pg .sw-qpic { width: min(100%, 220px); margin-bottom: 8px; }
}
`;

function card(it: ItemRef, tag: 'button' | 'div' = 'button', scale = 2): HTMLElement {
  return el(tag, { class: 'pq-btn sw-card', 'data-item': it.id, ...(tag === 'button' ? { type: 'button', 'data-nav': '' } : {}) }, el('span', { class: 'sw-box' }, itemIcon(it.id, scale)), el('span', { class: 'sw-pl' }, it.pl), el('span', { class: 'sw-ru' }, it.ru));
}

function renderPack(task: SwTask, panel: GamePanel): void {
  prompt(panel, task.q, task.hint);
  const sel = new Set<string>();
  const label = task.packKind === 'table' ? 'Na stole' : task.packKind === 'bag' ? 'W torbie' : 'W koszyku';
  const icon = el('span', { class: 'sw-ib' });
  const num = el('span', { 'data-count': '' }, '0');
  const strip = el('div', { class: 'sw-count' }, icon, label, ': ', num);
  const paintStrip = (): void => {
    icon.replaceChildren((task.packKind === 'table' ? atlasIcon(plantIconFrame('plate') ?? '', 1, 'sw-ico') : null) ?? frameIcon(sel.size ? 'w2_basket/1' : 'w2_basket/0', 1));
    num.textContent = String(sel.size);
  };
  const grid = el('div', { class: 'sw-pack', 'data-pack': '' });
  const done = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', disabled: true }, 'Gotowe · Готово');
  for (const it of task.items ?? []) {
    const c = card(it);
    const cell = withSay(c, it.pl, panel.say);
    c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', () => {
      if (sel.has(it.id)) sel.delete(it.id);
      else sel.add(it.id);
      c.classList.toggle('sel', sel.has(it.id));
      c.setAttribute('aria-pressed', String(sel.has(it.id)));
      done.disabled = sel.size === 0;
      paintStrip();
    });
    grid.append(cell);
  }
  done.addEventListener('click', () => {
    if (!sel.size) return;
    const want = new Set(task.expect);
    for (const c of grid.querySelectorAll<HTMLElement>('[data-item]')) {
      const id = c.dataset.item!;
      c.classList.remove('sel');
      if (sel.has(id)) c.classList.add(want.has(id) ? 'right' : 'wrong');
      else if (want.has(id)) c.classList.add('miss');
    }
    panel.submit([...sel]);
  });
  paintStrip();
  panel.body.append(strip, grid);
  panel.foot.replaceChildren(done);
}

/** Запас под строку результата, которая появляется после ответа (название, перевод, прогресс, заметка до 3 строк). */
const FB_RESERVE = 128;
/** Самая высокая раскладка раунда: лист не прыгает от задания к заданию. */
let tallest = 0;
export const resetSheet = (): void => {
  tallest = 0;
};

/** Узкий лист по ширине содержимого и высота по самому высокому заданию раунда. */
export function fitSheet(panel: GamePanel, outer: HTMLElement): void {
  const box = panel.root?.querySelector<HTMLElement>('.box') ?? null;
  if (box) box.style.width = 'min(720px, 100%)';
  const fit = (): void => {
    if (!outer.isConnected || !panel.fit) return;
    panel.fit(() => {
      let h = 0;
      for (const k of Array.from(panel.body.children)) {
        const r = (k as HTMLElement).getBoundingClientRect().height;
        if (!r) continue;
        const cs = getComputedStyle(k);
        h += r + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      }
      tallest = Math.max(tallest, Math.ceil(h) + FB_RESERVE);
      return tallest;
    });
  };
  fit();
  const watched = panel.root ?? panel.body;
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = watched.clientWidth;
    let lastH = watched.clientHeight;
    const ro = new ResizeObserver(() => {
      if (!outer.isConnected) return ro.disconnect();
      if (Math.abs(watched.clientWidth - lastW) < 2 && Math.abs(watched.clientHeight - lastH) < 2) return;
      lastW = watched.clientWidth;
      lastH = watched.clientHeight;
      fit();
    });
    ro.observe(watched);
  }
}

/** Рисует задание в `panel.body`. */
export function renderTask(task: SwTask, panel: GamePanel): void {
  const q = el('div', { class: 'sw-q', 'data-q': '' });
  panel.body.append(el('style', {}, css + picCss), q);
  const sub: GamePanel = { ...panel, body: q, foot: panel.foot, submit: (a) => panel.submit(a), say: (t, s) => panel.say(t, s) };
  switch (task.kind) {
    case 'what': {
      prompt(sub, task.q, task.hint, task.qLang);
      if (task.pic) {
        const fig = el('div', { class: 'sw-qpic', 'data-qpic': '' }, picFrame(task.pic.img, ''));
        if (task.pic.credit) fig.append(creditLine(task.pic.credit));
        q.append(fig);
      }
      if (task.clue?.length) q.append(el('div', { class: 'sw-clue', 'data-clue': '' }, ...task.clue.map((id) => withSay(card(itemWord(id), 'div', 3), itemWord(id).pl, panel.say))));
      if (task.big) q.append(el('div', { class: 'pq-qrow sw-bigrow' }, el('div', { class: 'sw-big', 'data-big': '', lang: 'pl' }, task.big), sayButton(task.big, panel.say)));
      choice(sub, task.options ?? [], task.answer);
      break;
    }
    case 'custom': {
      prompt(sub, task.q, task.hint, task.qLang);
      choice(sub, task.options ?? [], task.answer).classList.add('sw-opts-long');
      break;
    }
    case 'when':
    case 'shops':
      prompt(sub, task.q, task.hint, task.qLang);
      choice(sub, task.options ?? [], task.answer);
      break;
    case 'pack':
      renderPack(task, sub);
      break;
    case 'wish':
      prompt(sub, task.q, task.hint, task.qLang);
      tiles(sub, task.tiles ?? []);
      break;
  }
  fitSheet(panel, q);
}
