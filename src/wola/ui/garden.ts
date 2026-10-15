// «Mój ogródek» (W-01, ВОЛЯ.md п. 7): грядки = слова (garden.ts: семя → росток → куст → зрелое), без ходьбы.
// «!» — карточка к повтору (вялое — просрочено), тап или «Nawóz» = раунд повторения (ui/obchod.ts, лестница форматов,
// ввод с экранной клавиатурой), растение растёт. Зрелое (интервал ≥ 21 дня) → «Zbiór» → банка на полку дома.
// «Nawóz» (W-04, план дня) — один раунд на норму дня: до PLAN.fertilizeMax растений, сначала хрупкие; остальные
// «подождут до завтра» без наказания. Норма сделана — «Nawóz» остаётся, но уже по желанию. Дистракторы — той же темы.
import { isFamiliar } from '../../systems/words';
import { el } from '../../ui/dom';
import { runObchod } from '../../ui/obchod';
import { plBtn, type PlLabel } from '../../ui/overlay/kit';
import { wolaCardStep } from '../systems/steps';
import { dayPlan, harvest, PLAN, planText, planted, wolaGarden, type Plant } from '../systems/wola';
import { changed, derived, openPlace, panel, type WolaDeps } from './kit';
import { spriteEl } from './pix';

export const NAWOZ_ALL: PlLabel = { pl: 'Nawóz', ru: 'удобрить всё' };
export const ZBIOR: PlLabel = { pl: 'Zbiór', ru: 'собрать в банки' };

const FRAME: Record<Plant['stage'], string> = { seed: 'plant_seed/0', sprout: 'plant_sprout/0', bush: 'plant_bush/0', jar: 'plant_bush/0' };
const STAGE_RU: Record<Plant['stage'], string> = { seed: 'семечко', sprout: 'росток', bush: 'куст', jar: 'зрелое' };

const DAY = 86_400_000;
const inDays = (ts: number, todayStart: number): string => {
  const n = Math.max(0, Math.round((ts - todayStart) / DAY));
  return n <= 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`;
};

export async function runGarden(deps: WolaDeps): Promise<void> {
  const frame = openPlace(deps, 'ogrod', { pl: 'Mój ogródek', ru: 'Мой огород' });
  let busy = false;
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
      if (!frame.layer.closed) paint();
    }
  };

  const fertilize = (fromItem?: string): Promise<void> =>
    run(async () => {
      const d = derived(deps);
      const now = deps.clock.now();
      const plan = dayPlan(deps.store.progress, deps.book, d, now, deps.content.tuning, deps.tz);
      // Норма дня (до 15); сделана — ещё раунд по желанию тем же размером.
      const limit = plan.fertilize > 0 ? plan.fertilize : Math.min(plan.debt, PLAN.fertilizeMax);
      if (limit <= 0) return;
      const have = planted(d);
      const pool = deps.book.vocab;
      const known = (id: string): boolean => have.has(id);
      await runObchod(
        { ...deps },
        {
          mode: 'day',
          nawoz: true,
          restTomorrow: true,
          limit,
          ...(fromItem ? { fromItem } : {}),
          stepFor: (card) => wolaCardStep(card, (id) => deps.content.vocab.get(id)?.value, pool, (id) => known(id) || isFamiliar(d.cards, id)),
        },
      );
    });

  const collect = (items: Plant[]): Promise<void> =>
    run(async () => {
      const ripe = items.filter((g) => g.ripe);
      if (!ripe.length) return;
      const pl = ripe.map((g) => deps.content.vocab.get(g.item)?.value.pl ?? g.item);
      const a = await panel(
        deps.overlay,
        ZBIOR,
        [el('div', {}, ripe.length === 1 ? 'Слово дозрело: интервал повтора больше трёх недель.' : `Дозрело слов: ${ripe.length}.`), el('div', { class: 'list', lang: 'pl' }, pl.join(', ')), el('div', {}, 'В банку — и на полку дома. Повторять его всё равно будем, реже.')],
        [
          { act: 'no', label: 'Пусть растёт' },
          { act: 'yes', label: { pl: 'Zbierz', ru: 'собрать' }, primary: true },
        ],
        'no',
        { 'data-panel': 'zbior' },
      );
      if (a !== 'yes') return;
      let p = deps.store.progress;
      const now = deps.clock.now();
      for (const g of ripe) p = harvest(p, g, now);
      if (deps.store.setProgress(p)) changed(deps, ['world']);
    });

  const info = (g: Plant): Promise<void> =>
    run(async () => {
      const v = deps.content.vocab.get(g.item)?.value;
      const d = derived(deps);
      await panel(
        deps.overlay,
        { pl: v?.pl ?? g.item, ru: v?.ru ?? '' },
        [
          el('div', { class: 'stat' }, el('span', {}, 'Сейчас'), el('b', {}, STAGE_RU[g.stage])),
          el('div', { class: 'stat' }, el('span', {}, 'Следующий nawóz'), el('b', {}, inDays(g.nextDue, d.todayStart))),
          v?.tr ? el('div', { class: 'list' }, `[${v.tr}]`) : null,
        ],
        [{ act: 'ok', label: 'OK', primary: true }],
        'ok',
        { 'data-panel': 'roslina' },
      );
    });

  const tap = (g: Plant): void => {
    if (g.dueCard) void fertilize(g.item);
    else if (g.ripe) void collect([g]);
    else void info(g);
  };

  function paint(): void {
    const d = derived(deps);
    const now = deps.clock.now();
    const g = wolaGarden(d, now, deps.content.tuning, deps.store.progress.world.flags);
    const plan = dayPlan(deps.store.progress, deps.book, d, now, deps.content.tuning, deps.tz);
    const beds = g.plants.map((x) => {
      const v = deps.content.vocab.get(x.item)?.value;
      const b = el(
        'button',
        {
          type: 'button',
          class: `wl-plant${x.wilted ? ' wilted' : ''}`,
          'data-nav': true,
          'data-plant': x.item,
          'data-stage': x.ripe ? 'ripe' : x.stage,
          ...(x.dueCard ? { 'data-due': true } : {}),
          'aria-label': `${v?.pl ?? x.item}: ${STAGE_RU[x.stage]}${x.dueCard ? ', пора удобрить' : ''}`,
          onclick: () => tap(x),
        },
        x.dueCard ? el('span', { class: 'mark' }, '!') : x.ripe ? el('span', { class: 'mark ripe' }, '★') : null,
        spriteEl(deps.atlas, FRAME[x.stage], 4),
        el('span', { class: 'w', lang: 'pl' }, v?.pl ?? x.item),
      );
      return b;
    });
    const due = g.due;
    // Норма дня ещё есть — «Nawóz (N)» главная; норма сделана, но растения ждут — «ещё по желанию».
    const norm = plan.fertilize;
    const extra = !norm && due > 0;
    const nawoz = plBtn(
      { pl: `Nawóz (${norm || (extra ? Math.min(due, PLAN.fertilizeMax) : 0)})`, ru: norm ? NAWOZ_ALL.ru : extra ? 'норма сделана · ещё по желанию' : NAWOZ_ALL.ru },
      () => void fertilize(),
      norm ? 'primary' : '',
      { 'data-nav': true, 'data-act': 'nawoz', 'data-norm': String(norm), ...(norm ? { 'data-primary': true } : due ? {} : { disabled: true }) },
    );
    const actions = el(
      'div',
      { class: 'wl-actions' },
      nawoz,
      plBtn({ pl: `Zbiór (${g.ripe})`, ru: ZBIOR.ru }, () => void collect(g.plants), g.ripe && !due ? 'primary' : '', { 'data-nav': true, 'data-act': 'zbior', ...(g.ripe ? {} : { disabled: true }) }),
    );
    frame.stage.replaceChildren(
      el(
        'div',
        { class: 'wl-garden', 'data-plants': g.plants.length, 'data-due': due, 'data-ripe': g.ripe },
        el('p', { class: 'wl-plan', 'data-plan': `${plan.fertilize}/${plan.fresh}` }, planText(plan), plan.debt > plan.fertilize ? el('small', {}, ` · остальные ${plan.debt - plan.fertilize} — завтра, это нормально`) : null),
        g.plants.length
          ? el('p', { class: 'wl-legend' }, `Растений: ${g.plants.length}. «!» — пора удобрить (повторить слово), ★ — созрело, собери в банку.`)
          : el('div', { class: 'empty' }, 'Грядки пустые. Слова сажаются дома: ноутбук «Słowniczek».'),
        el('div', { class: 'wl-beds' }, ...beds),
      ),
    );
    frame.foot.replaceChildren(actions);
  }

  paint();
  queueMicrotask(() => (frame.stage.querySelector<HTMLElement>('[data-due]') ?? frame.stage.querySelector<HTMLElement>('[data-plant]'))?.focus({ preventScroll: true }));
  await frame.closed;
}
