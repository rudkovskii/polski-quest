// Игра «Miesiące»: путь с нуля (D-41) — экран выбора (`hub`) и карточки знакомства.
// Ступени 1–4 — тройки месяцев по порядку года (styczeń–marzec…październik–grudzień), раунд ступени — `begin(ids, 9)`.
// Ступень 5 «Cały rok» — все 12 вперемешку; раунд начинается с колеса года (расставить все 12, `requestWheel`).
// Замок мягкий, как у уровней карты: ступень открыта, если она первая, в ней уже что-то посажено, её открыли кнопкой (флаг
// `miesiace.level.<n>`) или все месяцы предыдущей дошли до кустика. «Cały rok» — когда знакомы все 12.
// Вступление (что вообще за месяцы) — один раз, флаг `miesiace.intro`; карточка месяца — при первой встрече (`ctx.seen`).
import type { GameCtx, GamePanel, PolskaUnit } from '../../types/polska';
import { el } from '../../ui/dom';
import { sayButton } from '../../ui/sayButton';
import { known, monthsOfQuarter, requestWheel, row, rowsOf, SEASONS } from './tasks';
import { WHEEL_CSS, yearView } from './wheel';

export const INTRO_FLAG = 'miesiace.intro';
export const levelFlag = (n: number): string => `miesiace.level.${n}`;
export const STEP_ROUND = 9;
export const YEAR_ROUND = 10;

export interface Step {
  n: number;
  pl: string;
  ru: string;
  months: number[];
}

export const STEPS: readonly Step[] = [
  { n: 1, pl: 'Styczeń · luty · marzec', ru: 'январь, февраль, март', months: monthsOfQuarter(1) },
  { n: 2, pl: 'Kwiecień · maj · czerwiec', ru: 'апрель, май, июнь', months: monthsOfQuarter(2) },
  { n: 3, pl: 'Lipiec · sierpień · wrzesień', ru: 'июль, август, сентябрь', months: monthsOfQuarter(3) },
  { n: 4, pl: 'Październik · listopad · grudzień', ru: 'октябрь, ноябрь, декабрь', months: monthsOfQuarter(4) },
  { n: 5, pl: 'Cały rok', ru: 'весь год: колесо года и всё вперемешку', months: Array.from({ length: 12 }, (_, i) => i + 1) },
];

export type StepWhy = 'first' | 'started' | 'manual' | 'prev' | 'locked';

export interface StepView {
  step: Step;
  ids: string[];
  met: number;
  bush: number;
  grown: number;
  open: boolean;
  why: StepWhy;
}

const BUSH = new Set(['bush', 'ripe', 'overripe']);

export function stepViews(ctx: Pick<GameCtx, 'units' | 'info' | 'seen' | 'flag'>): StepView[] {
  const byN = new Map<number, PolskaUnit>(ctx.units.filter((u) => u.kind === 'month').map((u) => [row(u).n, u]));
  const met = known(ctx);
  const out: StepView[] = [];
  for (const step of STEPS) {
    const units = step.months.map((n) => byN.get(n)).filter((u): u is PolskaUnit => !!u);
    let bush = 0;
    let grown = 0;
    let started = false;
    for (const u of units) {
      const i = ctx.info(u.id);
      if (i.planted || i.stage !== null || i.harvests > 0 || (i.answers ?? 0) > 0) started = true;
      if (i.harvests > 0 || (i.stage && BUSH.has(i.stage))) bush++;
      if (i.harvests > 0) grown++;
    }
    const prev = out[out.length - 1];
    let why: StepWhy;
    if (step.n === 5) why = met.size >= 12 ? 'prev' : ctx.flag?.(levelFlag(5)) ? 'manual' : 'locked';
    else if (!prev) why = 'first';
    else if (started) why = 'started';
    else if (ctx.flag?.(levelFlag(step.n))) why = 'manual';
    else if (prev.open && prev.bush >= prev.ids.length) why = 'prev';
    else why = 'locked';
    out.push({ step, ids: units.map((u) => u.id), met: step.months.filter((n) => met.has(n)).length, bush, grown, open: why !== 'locked', why });
  }
  return out;
}

/** Рекомендованная ступень: первая открытая тройка, где не всё дошло до кустика; иначе «Cały rok», если открыт; иначе первая открытая. */
export function nextStep(views: readonly StepView[]): StepView | null {
  const open = views.filter((v) => v.open);
  return open.find((v) => v.step.n < 5 && v.bush < v.ids.length) ?? open.find((v) => v.step.n === 5) ?? open[0] ?? null;
}

/** Месяцы открытых троек по порядку года: из них движок сажает (≤ 8 растущих). */
export function openPool(ctx: Pick<GameCtx, 'units' | 'info' | 'seen' | 'flag'>): string[] {
  return stepViews(ctx)
    .filter((v) => v.open && v.step.n < 5)
    .flatMap((v) => v.ids);
}

export const HUB_CSS = `
.pq-pg .ms-hub { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 640px; margin: 0 auto; box-sizing: border-box; padding: 2px 10px 8px; }
.pq-pg.full .paper > .ms-hub.ms-hub, .pq-pg.full .paper > .ms-card.ms-card { margin-left: auto; margin-right: auto; }
.pq-pg .ms-hub .pq-q { margin-bottom: 0; }
.pq-pg .ms-go { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; padding: 10px 14px; font-size: 18px; }
.pq-pg .ms-go small { font-size: 13px; font-weight: 600; opacity: .8; }
.pq-pg .ms-st { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 2px 10px; padding: 7px 10px; background: #fffaf0;
  border: 2px solid var(--pq-wood-dark); border-radius: 8px; }
.pq-pg .ms-st.next { border-color: var(--pq-accent); box-shadow: 0 0 0 2px var(--pq-accent); }
.pq-pg .ms-st.locked { background: #efe6d0; }
.pq-pg .ms-st-n { display: grid; place-items: center; width: 28px; height: 28px; border: 2px solid var(--pq-ink); border-radius: 50%; font-weight: 800; background: #f2dcae; }
.pq-pg .ms-st.open .ms-st-n { background: #b8d86a; }
.pq-pg .ms-st-nm { min-width: 0; line-height: 1.15; }
.pq-pg .ms-st-nm b { font-size: 16px; font-weight: 800; }
.pq-pg .ms-st-nm small { display: block; font-size: 12px; opacity: .75; }
.pq-pg .ms-st .pq-btn { margin: 0; padding: 6px 10px; font-size: 14px; white-space: nowrap; }
.pq-pg .ms-card { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 560px; margin: 0 auto; padding: 4px 10px 8px; box-sizing: border-box; }
.pq-pg .ms-card-lbl { font-size: 13px; font-weight: 700; opacity: .7; }
.pq-pg .ms-card-top { display: flex; align-items: center; gap: 12px; }
.pq-pg .ms-card-ico { font-size: 44px; line-height: 1; }
.pq-pg .ms-card-nm { display: flex; align-items: center; gap: 8px; font-size: 30px; font-weight: 800; }
.pq-pg .ms-card-tr { font-size: 14px; opacity: .7; }
.pq-pg .ms-card-ru { font-size: 18px; font-weight: 700; }
.pq-pg .ms-card p { margin: 0; font-size: 16px; line-height: 1.35; }
.pq-pg .ms-card .ms-chip { display: inline-block; padding: 2px 8px; border: 2px solid var(--pq-ink); border-radius: 12px; font-size: 13px; font-weight: 700; margin-right: 4px; }
.pq-pg .ms-chip.zima { background: #dce9f6; } .pq-pg .ms-chip.wiosna { background: #e2f1c6; } .pq-pg .ms-chip.lato { background: #fbe6a0; } .pq-pg .ms-chip.jesien { background: #f5cfa8; }
@media (max-width: 519px) { .pq-pg .ms-hub { gap: 6px; } .pq-pg .ms-go { font-size: 16px; padding: 8px 12px; } .pq-pg .ms-card-nm { font-size: 26px; } .pq-pg .ms-card p { font-size: 15px; } }
`;

/** Вступление один раз: чем польские месяцы отличаются от наших и как пойдём. */
function introBlock(onGo: () => void): HTMLElement {
  return el(
    'div',
    { class: 'ms-card', 'data-ms-intro': '' },
    el('div', { class: 'ms-card-lbl', lang: 'pl' }, 'Miesiące · Месяцы'),
    el('p', {}, 'Польские месяцы почти не похожи на наши: они названы по природе. ', el('b', { lang: 'pl' }, 'kwiecień'), ' — от kwiat «цветок», ', el('b', { lang: 'pl' }, 'lipiec'), ' — от lipa «липа», ', el('b', { lang: 'pl' }, 'listopad'), ' — «листья падают».'),
    el('p', {}, 'Как наши звучат только ', el('b', { lang: 'pl' }, 'marzec'), ' и ', el('b', { lang: 'pl' }, 'maj'), '. Пишутся все с маленькой буквы.'),
    el('p', {}, 'Учим по три месяца, по порядку года. У каждого — откуда имя: так запоминается быстрее. В конце расставишь все 12 на колесе года.'),
    el('button', { type: 'button', class: 'pq-btn ms-go', 'data-nav': '', 'data-ms-start': '', onclick: onGo }, el('span', { lang: 'pl' }, 'Zaczynamy · Начинаем →')),
  );
}

/** Экран выбора (`PolskaGame.hub`). */
export function renderHub(panel: GamePanel, ctx: GameCtx, begin: (ids: readonly string[], size: number) => void): void {
  const draw = (): void => {
    panel.body.replaceChildren();
    panel.foot.replaceChildren();
    const style = el('style', {}, HUB_CSS + WHEEL_CSS);
    if (ctx.flag && !ctx.flag(INTRO_FLAG)) {
      panel.body.append(style, introBlock(() => (ctx.setFlag?.(INTRO_FLAG), draw())));
      return;
    }
    const views = stepViews(ctx);
    const next = nextStep(views);
    const go = (v: StepView): void => {
      if (v.step.n === 5) requestWheel();
      begin(v.ids, v.step.n === 5 ? YEAR_ROUND : STEP_ROUND);
    };
    const root = el('div', { class: 'ms-hub', 'data-hub': '', 'data-ms-hub': '' }, style);
    root.append(el('div', { class: 'pq-q', lang: 'pl' }, 'Rok · Год'), yearView(rowsOf(ctx), known(ctx), ctx.date().m));
    if (next)
      root.append(
        el(
          'button',
          { type: 'button', class: 'pq-btn ms-go', 'data-nav': '', 'data-step-go': String(next.step.n), onclick: () => go(next) },
          el('span', {}, `▶ Dalej: `, el('span', { lang: 'pl' }, next.step.pl)),
          el('small', {}, next.step.ru),
        ),
      );
    for (const v of views) {
      const n = v.ids.length;
      const state = v.open ? 'open' : 'locked';
      const line =
        v.why === 'locked'
          ? v.step.n === 5
            ? `Откроется, когда знакомы все 12 (сейчас ${known(ctx).size})`
            : `Откроется, когда месяцы ступени ${v.step.n - 1} дойдут до кустика`
          : `знакомо ${v.met} из ${n} · кустиков ${v.bush} · собрано ${v.grown}`;
      const btn = v.open
        ? el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-step-play': String(v.step.n), onclick: () => go(v) }, '▶ Graj')
        : el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-step-open': String(v.step.n), onclick: () => (ctx.setFlag?.(levelFlag(v.step.n)), draw()) }, 'Otwórz teraz');
      root.append(
        el(
          'div',
          { class: `ms-st ${state}${v === next ? ' next' : ''}`, 'data-step': String(v.step.n), 'data-state': state },
          el('span', { class: 'ms-st-n' }, String(v.step.n)),
          el('div', { class: 'ms-st-nm' }, el('b', { lang: 'pl' }, v.step.pl), el('small', {}, line)),
          btn,
        ),
      );
    }
    panel.body.append(root);
  };
  draw();
}

/** Карточка знакомства с месяцем: имя, 🔊, номер и время года, откуда имя, форма в дате. Флаг ставит кнопка «Понятно» (в `index.ts`). */
export function monthCard(u: PolskaUnit, say: (t: string) => void): HTMLElement {
  const r = row(u);
  return el(
    'div',
    { class: 'ms-card', 'data-intro': u.id },
    el('div', { class: 'ms-card-lbl', lang: 'pl' }, 'Poznaj miesiąc · Знакомство'),
    el(
      'div',
      { class: 'ms-card-top' },
      r.icon ? el('span', { class: 'ms-card-ico', 'aria-hidden': 'true' }, r.icon) : null,
      el(
        'div',
        {},
        el('div', { class: 'ms-card-nm' }, el('span', { lang: 'pl', 'data-intro-pl': '' }, r.nom), sayButton(r.nom, say)),
        r.nom_tr ? el('div', { class: 'ms-card-tr' }, `[${r.nom_tr}]`) : null,
        el('div', { class: 'ms-card-ru', 'data-intro-ru': '' }, `= ${r.nom_ru}`),
      ),
    ),
    el('div', {}, el('span', { class: 'ms-chip' }, `${r.n}-й месяц`), el('span', { class: `ms-chip ${r.season}`, lang: 'pl' }, `${SEASONS[r.season].pl} · ${SEASONS[r.season].ru}`)),
    r.why_ru ? el('p', { 'data-intro-why': '' }, r.why_ru) : null,
    el('p', {}, 'В дате: ', el('b', { lang: 'pl' }, `3 ${r.gen}`), ` — 3 ${r.gen_ru}`),
  );
}
