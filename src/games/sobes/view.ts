// DOM «Sobes»: карточка знакомства с ответом, сборка кусков по порядку, «что дальше», «скажи вслух — сверь», список вопросов (экран выбора).
// Ввод только кнопками (клавиши 1–4 и стрелки ведёт движок через `data-opt` / `data-nav`). Ошибочную сборку не показываем: после ответа
// движок выводит правильный ответ целиком (METODIKA: письменно показанная ошибка становится образцом).
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import type { GameCtx, GamePanel, PolskaUnit } from '../../types/polska';
import { choice, prompt, tiles } from '../kit';
import { chunksOf, sednoOf, type SelfGrade, type SobesTask } from './tasks';

export const SOBES_CSS = `
.sb-wrap { display: flex; flex-direction: column; gap: 6px; }
.sb-ru { font-size: 13px; opacity: .8; }
.sb-sedno { display: flex; flex-wrap: wrap; gap: 4px; }
.sb-sedno span { font-size: 12px; background: #fffaf0; border: 1px solid #e2d6b8; border-radius: 10px; padding: 1px 7px; }
.sb-given { font-size: 15px; line-height: 1.3; padding: 4px 6px; border-left: 3px solid var(--pq-accent); background: #fdf1d4; border-radius: 4px; }
.sb-given:empty { display: none; }
.sb-lines { display: flex; flex-direction: column; gap: 3px; }
.sb-line { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 6px; background: #fffaf0; border: 1px solid #e2d6b8; }
.sb-line .pl { flex: 1 1 auto; min-width: 0; font-size: 16px; font-weight: 800; line-height: 1.25; }
.sb-var { font-size: 13px; opacity: .8; }
.sb-hub { display: flex; flex-direction: column; gap: 5px; }
.sb-hub .top { font-size: 13px; opacity: .8; }
.pq-pg .pq-btn.sb-q { color: var(--pq-ink); background: #fffaf0; text-align: left; padding: 5px 8px; display: flex; align-items: center; gap: 8px; }
.sb-q .t { flex: 1 1 auto; min-width: 0; } .sb-q .t b { display: block; font-size: 14px; } .sb-q .t small { display: block; font-size: 12px; opacity: .75; font-weight: 400; }
.sb-q .dot { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: #cbbf9f; }
.sb-q .dot.grow { background: #7fb04a; } .sb-q .dot.done { background: #e0b020; }
@media (max-width: 520px), (max-height: 860px) { .sb-line .pl { font-size: 14px; } .sb-given { font-size: 14px; } }
/* Телефон: опорой остаётся последний кусок перед заданием («… i trwało 63 dni.»), русская суть вопроса — только в карточке и «скажи вслух». */
@media (max-width: 520px) {
  .sb-given .head { display: none; } .sb-given .tail::before { content: '… '; }
  .pq-pg-q .sb-ru.task { display: none; }
  .pq-pg .sb-tiles .pq-tile { font-size: 13px; padding: 4px 7px; }
}
`;

const css = (): HTMLElement => el('style', { 'data-sobes-css': '' }, SOBES_CSS);

const sednoRow = (items: readonly string[]): HTMLElement => el('div', { class: 'sb-sedno', lang: 'ru' }, ...items.map((s) => el('span', {}, s)));

/** Ответ по кускам, у каждого 🔊. */
export function answerLines(chunks: readonly string[], say: (t: string) => void): HTMLElement {
  return el('div', { class: 'sb-lines', 'data-answer': '' }, ...chunks.map((c) => el('div', { class: 'sb-line' }, el('span', { class: 'pl', lang: 'pl' }, c), sayButton(c, say))));
}

/** Знакомство: вопрос, суть по-русски, ответ по кускам с 🔊. Оценки нет. */
export function answerCard(u: PolskaUnit, say: (t: string) => void): HTMLElement {
  return el(
    'div',
    { class: 'sb-wrap', 'data-answer-card': u.id },
    css(),
    el('div', { class: 'pq-qrow' }, el('div', { class: 'pq-q', lang: 'pl' }, u.pl), sayButton(u.pl, say, { main: true })),
    el('div', { class: 'sb-ru' }, `${u.ru} — сначала прочитай и послушай`),
    sednoRow(sednoOf(u)),
    answerLines(chunksOf(u), say),
  );
}

export function renderTask(task: SobesTask, panel: GamePanel): void {
  panel.body.append(css());
  if (task.kind === 'say') return renderSay(task, panel);
  const head = prompt(panel, task.prompt, task.kind === 'order' ? 'Собери ответ: поставь куски по порядку' : 'Co dalej? · Что дальше в ответе?');
  head.append(el('div', { class: 'sb-ru task' }, task.ru));
  const g = task.given;
  panel.body.append(
    el('div', { class: 'sb-given', lang: 'pl', 'data-given': '' }, ...(g.length ? [el('span', { class: 'head' }, `${g.slice(0, -1).join(' ')} `), el('span', { class: 'tail' }, `${g[g.length - 1]} …`)] : [])),
  );
  if (task.kind === 'order') tiles(panel, task.options).classList.add('sb-tiles');
  else choice(panel, task.options, task.answer as string);
}

/** «Скажи вслух — сверь»: вопрос и суть, «Показать», эталон с 🔊 и самооценка. */
function renderSay(task: SobesTask, panel: GamePanel): void {
  const head = prompt(panel, task.prompt, 'Powiedz na głos · Скажи ответ вслух, потом сверь');
  head.append(el('div', { class: 'sb-ru' }, task.ru));
  panel.body.append(sednoRow(task.sedno));
  const grade = (g: SelfGrade, label: string, n: number): HTMLElement =>
    el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-opt': g, 'data-grade': g, onclick: () => panel.submit(g) }, el('span', { class: 'n' }, `${n}`), ` ${label}`);
  const show = el(
    'button',
    {
      type: 'button',
      class: 'pq-btn',
      'data-nav': '',
      'data-show': '',
      onclick: () => {
        panel.body.append(answerLines(task.chunks, panel.say), task.variant ? el('div', { class: 'sb-var', lang: 'pl' }, `Тоже верно: ${task.variant}`) : '');
        panel.foot.replaceChildren(grade('said', 'Сказал', 1), grade('hint', 'С подсказкой', 2), grade('no', 'Не собралось', 3));
        (panel.foot.querySelector('[data-grade]') as HTMLElement | null)?.focus();
      },
    },
    'Pokaż · Показать ответ',
  );
  panel.foot.replaceChildren(show);
}

const stateOf = (ctx: GameCtx, id: string): 'new' | 'grow' | 'done' => {
  const i = ctx.info(id);
  if (i.harvests > 0) return 'done';
  return i.stage !== null ? 'grow' : 'new';
};

/** Экран выбора: вопросы, которые сейчас учатся в дриле (без номеров — правило занятий ПМЖ: номера вопросов не называть). Тап — раунд по одному вопросу, «Dalej» — раунд по всем вперемешку. */
export function renderHub(panel: GamePanel, ctx: GameCtx, pool: readonly string[], begin: (id: string | readonly string[], size: number) => void): void {
  const list = el('div', { class: 'sb-hub', 'data-sobes-hub': '' }, css(), el('div', { class: 'top' }, `Вопросы, которые сейчас учишь на занятиях (${pool.length}). Выбери один или играй вперемешку.`));
  for (const id of pool) {
    const u = ctx.unit(id);
    if (!u) continue;
    const st = stateOf(ctx, id);
    list.append(
      el(
        'button',
        { type: 'button', class: 'pq-btn sb-q', 'data-nav': '', 'data-question': id, onclick: () => begin(id, 4) },
        el('span', { class: `dot ${st === 'new' ? '' : st}`.trim(), title: st === 'done' ? 'выучен' : st === 'grow' ? 'учится' : 'ещё не начат' }),
        el('span', { class: 't' }, el('b', { lang: 'pl' }, u.pl), el('small', {}, u.ru)),
      ),
    );
  }
  panel.body.append(list);
  panel.foot.replaceChildren(el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-sobes-go': '', onclick: () => begin(pool, 10) }, 'Dalej · Играть вперемешку →'));
}

