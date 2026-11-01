// DOM «Sobes»: карточка знакомства с ответом, сборка кусков по порядку, «что дальше», «скажи вслух — сверь», список вопросов (экран выбора).
// Ввод только кнопками (клавиши 1–4 и стрелки ведёт движок через `data-opt` / `data-nav`). Ошибочную сборку не показываем: после ответа
// движок выводит правильный ответ целиком (METODIKA: письменно показанная ошибка становится образцом).
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import type { GameCtx, GamePanel, PolskaUnit } from '../../types/polska';
import { choice, prompt, tiles } from '../kit';
import { dueIds, newBundle, reviewBundle, reviewReads, setMode, fitBundle, type BundleMode } from './plan';
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
.pq-pg .pq-btn.sb-q.sel { background: #f6e3a6; }
.sb-q .chk { flex: 0 0 auto; width: 20px; height: 20px; border: 2px solid var(--pq-ink); border-radius: 5px; display: grid; place-items: center; font-weight: 800; font-size: 13px; }
.sb-acts { display: flex; gap: 6px; } .sb-acts .pq-btn { flex: 1 1 0; }
.sb-sticky { position: sticky; bottom: -10px; display: flex; flex-direction: column; gap: 3px; padding: 6px 0 4px; background: var(--pq-cream); }
.sb-step { font-size: 12px; font-weight: 700; opacity: .7; letter-spacing: .03em; }
.sb-crit { font-size: 12px; opacity: .8; }
/* Куски длиннее слов: ряд вариантов растёт по тексту, а не режет его. */
.pq-pg .pq-opts.sb-opts { grid-auto-rows: minmax(52px, auto); }
.pq-pg .sb-opts .pq-opt { font-size: 15px; height: auto; min-height: 52px; }
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
  const step = (n: number, t: string): string => (task.inBundle ? `Ступень ${n}${task.retry ? ' · ещё раз' : ''} · ${t}` : t);
  const head = prompt(panel, task.prompt, task.kind === 'order' ? step(1, 'Собери ответ: поставь куски по порядку') : step(2, 'Co dalej? · Что дальше в ответе?'));
  head.append(el('div', { class: 'sb-ru task' }, task.ru));
  const g = task.given;
  panel.body.append(
    el('div', { class: 'sb-given', lang: 'pl', 'data-given': '' }, ...(g.length ? [el('span', { class: 'head' }, `${g.slice(0, -1).join(' ')} `), el('span', { class: 'tail' }, `${g[g.length - 1]} …`)] : [])),
  );
  if (task.kind === 'order') tiles(panel, task.options).classList.add('sb-tiles');
  else choice(panel, task.options, task.answer as string).classList.add('sb-opts');
}

/** «Скажи вслух — сверь»: вопрос и суть, «Показать», эталон с 🔊 и самооценка. */
function renderSay(task: SobesTask, panel: GamePanel): void {
  const hint = task.bare ? 'Powiedz na głos · Скажи ответ вслух без подсказки, потом сверь' : 'Powiedz na głos · Скажи ответ вслух, потом сверь';
  const head = prompt(panel, task.prompt, task.inBundle ? `Ступень ${task.bare ? 1 : 3}${task.retry ? ' · ещё раз' : ''} · ${hint}` : hint);
  // Повтор без опоры: суть по-русски не показываем.
  if (!task.bare) {
    head.append(el('div', { class: 'sb-ru' }, task.ru));
    panel.body.append(sednoRow(task.sedno));
  }
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
        panel.body.append(
          answerLines(task.chunks, panel.say),
          task.variant ? el('div', { class: 'sb-var', lang: 'pl' }, `Тоже верно: ${task.variant}`) : '',
          el('div', { class: 'sb-crit', 'data-crit': '' }, '«Сказал» — факты, порядок и опорные куски на месте, около 80%. Окончания не в счёт.'),
        );
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
  // Экран выбора досаживает пул сам: «не начат» — пока не читан карточкой.
  if (!ctx.seen(id)) return 'new';
  if (i.harvests > 0) return 'done';
  return i.stage !== null ? 'grow' : 'new';
};

type Begin = (id: string | readonly string[], size: number) => void;

/**
 * Экран выбора (D-88): «Новая связка» (следующие нечитанные по порядку дриля, похожие не вместе), «Повторить» (кому пора), список вопросов —
 * тап отмечает до трёх, внизу прилипает «Учить выбранные». Без номеров вопросов (правило занятий ПМЖ). Выбранная связка сначала читается
 * карточками здесь же, потом `begin(ids)` — движок ведёт лесенку игры (`plan.ts`).
 */
export function renderHub(panel: GamePanel, ctx: GameCtx, pool: readonly string[], begin: Begin, sel: string[] = []): void {
  panel.body.replaceChildren();
  panel.foot.replaceChildren();
  const fresh = newBundle(ctx, pool);
  const due = dueIds(ctx, pool);
  const redraw = (): void => renderHub(panel, ctx, pool, begin, sel);
  const list = el('div', { class: 'sb-hub', 'data-sobes-hub': '' });
  for (const id of pool) {
    const u = ctx.unit(id);
    if (!u) continue;
    const st = stateOf(ctx, id);
    const on = sel.includes(id);
    list.append(
      el(
        'button',
        {
          type: 'button',
          class: `pq-btn sb-q${on ? ' sel' : ''}`,
          'data-nav': '',
          'data-question': id,
          'aria-pressed': String(on),
          onclick: () => {
            const at = list.closest('.paper')?.scrollTop ?? 0;
            if (on) sel.splice(sel.indexOf(id), 1);
            else if (sel.length < 3) sel.push(id);
            redraw();
            const paper = panel.body.closest('.paper') ?? panel.body;
            paper.scrollTop = at;
          },
        },
        el('span', { class: 'chk' }, on ? '✓' : ''),
        el('span', { class: 't' }, el('b', { lang: 'pl' }, u.pl), el('small', {}, u.ru)),
        el('span', { class: `dot ${st === 'new' ? '' : st}`.trim(), title: st === 'done' ? 'выучен' : st === 'grow' ? 'учится' : 'ещё не начат' }),
      ),
    );
  }
  const go = (ids: string[], mode: BundleMode): void => {
    sel.length = 0;
    readBundle(panel, ctx, ids, mode, mode === 'review' ? reviewReads(ctx, ids) : ids, begin, () => renderHub(panel, ctx, pool, begin));
  };
  panel.body.append(
    css(),
    el(
      'div',
      { class: 'sb-hub' },
      el('div', { class: 'top' }, 'Связка — 2–3 вопроса: сначала читаешь все, потом отвечаешь вперемешку. Новое лучше входит понемногу: одна новая связка, позже — «Повторить».'),
      el(
        'div',
        { class: 'sb-acts' },
        el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-sobes-new': '', disabled: fresh.length < 2, onclick: () => go(fresh, 'new') }, fresh.length >= 2 ? `Новая связка (${fresh.length})` : 'Новых нет'),
        el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-sobes-review': '', disabled: !due.length, onclick: () => go(reviewBundle(ctx, pool), 'review') }, `Повторить (${due.length})`),
      ),
      list,
    ),
  );
  if (sel.length) {
    const known = pool.filter((id) => ctx.seen(id));
    const ids = fitBundle(ctx, sel, { known, rest: pool });
    const note = ids.some((id) => !sel.includes(id)) ? 'Один вопрос — мало: добавлен ещё один знакомый.' : ids.length < sel.length ? 'Длинный ответ идёт в связке из двух — третий отложен.' : '';
    panel.body.append(
      el(
        'div',
        { class: 'sb-sticky' },
        note ? el('div', { class: 'sb-crit' }, note) : null,
        el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-sobes-sel': '', onclick: () => go(ids, 'new') }, `Учить выбранные (${ids.length}) →`),
      ),
    );
  }
}

/** Фаза «Читаем»: карточки связки подряд, вперёд и назад свободно; «Готов отвечать» — лесенка. Карточка ставит знакомство (`seen`). */
export function readBundle(panel: GamePanel, ctx: GameCtx, ids: readonly string[], mode: BundleMode, reads: readonly string[], begin: Begin, back: () => void, i = 0): void {
  const start = (): void => {
    setMode(mode);
    begin(ids, ids.length * 3);
  };
  if (!reads.length) return start();
  const u = ctx.unit(reads[i]!);
  if (!u) return start();
  ctx.markSeen(u.id);
  panel.body.replaceChildren();
  const card = answerCard(u, panel.say);
  const kicker = el('div', { class: 'sb-step', 'data-read-step': '' }, mode === 'review' ? 'Ещё ни разу не сказан сам — прочитай' : `Читаем · ${i + 1} из ${reads.length} · потом отвечаешь на все вперемешку`);
  card.prepend(kicker);
  card.append(el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-listen': '', onclick: () => panel.say(chunksOf(u).join(' ')) }, '🔊 Слушать весь ответ'));
  panel.body.append(card);
  const last = i === reads.length - 1;
  panel.foot.replaceChildren(
    i > 0
      ? el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-read-back': '', onclick: () => readBundle(panel, ctx, ids, mode, reads, begin, back, i - 1) }, '← Назад')
      : el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-read-back': '', onclick: back }, '← К вопросам'),
    el(
      'button',
      { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-read-next': '', onclick: () => (last ? start() : readBundle(panel, ctx, ids, mode, reads, begin, back, i + 1)) },
      last ? 'Готов отвечать →' : 'Dalej · Дальше →',
    ),
  );
}
