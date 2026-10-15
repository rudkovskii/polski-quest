// «Salad Story» (W-02, ../ВОЛЯ.md п. 8, research/12_salad_story.md): стойка заказа с лестницей уровней.
//   • сцена: пиксельный интерьер (стена с доской меню и блюдом дня, стойка, витрина с мисками, касса), кассир за стойкой,
//     облачко над Димой (что заказываем), пузырь кассира с репликой (польский + русская подпись) над текущим шагом;
//   • стойка: уровень, серия зачётных визитов, карточка постоянного клиента (печати), «Spróbowane», «мой салат»;
//     «Zamawiam» — визит уровня, «Spróbuj wyżej» — визит уровнем выше (≥ 90 % засчитывает текущий);
//   • визит: «I jak było?» (если ждёт задание в реале) → шаги визита (src/wola/systems/saladVisit.ts) обычным уроком
//     `wola.salad.<N>` (intro новых слов, повтор `src: 'order'`) → поднос с заказом, «Smacznego!», отметка «Spróbowane»,
//     печать, итог, на уровнях 2, 4, 7, 9 — карточка «Zadanie w realu»; событие `visit` в журнале.
//   • ошибка смешная: гэг по тегу (стакан сока вместо соуса, миска-таз, пакет) + переспрос кассира над правилом и переводом.
import type { VisitOrder } from '../../systems/log';
import { lessonForToday, wolaStepGate } from '../../systems/pace';
import { isSilent } from '../../systems/sound';
import { dayOf } from '../../systems/time';
import { isFamiliar } from '../../systems/words';
import type { Cashier } from '../../types/content';
import { el } from '../../ui/dom';
import { runLesson } from '../../ui/lesson';
import type { Layer } from '../../ui/overlay/host';
import { audioButtons, plBtn, type PlLabel, type PortraitSource } from '../../ui/overlay/kit';
import {
  askJakBylo,
  buildVisit,
  canJump,
  danieDnia,
  levelOf,
  mySalad,
  SALAD_LESSON_PREFIX,
  saladState,
  showRealTask,
  visitPassed,
  visitTpl,
  type BubbleLine,
  type SaladData,
  type SaladState,
  type Visit,
} from '../systems/saladVisit';
import { dayCap, newLeft, planted as plantedOf } from '../systems/wola';
import { boxOf, changed, derived, openPlace, words as wordsN, write, type WolaDeps } from './kit';
import { fitScale, roomEl, spriteEl, T, type PixAtlas, type Room } from './pix';
import { ensureWolaStyle } from './style';

/** Витрина своим пиксель-артом (без логотипа сети): вывеска с миской салата, маркиза, окно, дверь. */
export const SALAD_FRONT: Room = {
  rows: ['SSSSzSS', '<=====>', 'QQdQQQQ'],
  legend: { S: 'w_salad', z: 'w_salad_szyld', '<': 'w_markiza_l', '=': 'w_markiza_m', '>': 'w_markiza_r', Q: 'w_salad_okno', d: 'w_salad_drzwi' },
};

/** Интерьер 9×6: стена с доской меню, кассир за стойкой, витрина и касса на стойке, фасад стойки, пол. */
export const SALAD_ROOM: Room = {
  rows: ['SSTtSSSSS', 'SSSSSSSSS', 'SSSSSSSSS', 'WWWWWWKWW', 'LMMMMMMMR', 'FFFFFFFFF'],
  legend: { S: 'w_ss_sciana', T: 'w_tablica_l', t: 'w_tablica_r', W: 'w_witryna', K: 'w_kasa', L: 'w_lada_l', M: 'w_lada_m', R: 'w_lada_r', F: 'w_ss_podloga' },
};
const ROOM_W = 9;
const ROOM_H = 6;
/** Кассир стоит за стойкой: левый край (в клетках) и верх. */
const CASHIER_AT: [number, number] = [3.5, 1];

export const ORDER_BTN: PlLabel = { pl: 'Zamawiam', ru: 'заказать' };
export const JUMP_BTN: PlLabel = { pl: 'Spróbuj wyżej', ru: 'попробовать уровень выше' };
export const REAL_OK: PlLabel = { pl: 'Udało się!', ru: 'получилось' };
export const REAL_NO: PlLabel = { pl: 'Nie wyszło', ru: 'не вышло' };
/** «I jak było?» без ответа (W-04): под Enter — она, а не «Udało się»; спросят в следующий раз. */
export const REAL_LATER: PlLabel = { pl: 'Później', ru: 'ещё не был · спросить потом' };

const SIZE_RU: Record<VisitOrder['size'], string> = { normalna: 'обычная', powiekszona: 'увеличенная' };

function dataOf(deps: WolaDeps): SaladData {
  if (!deps.salad) throw new Error('Salad Story: нет content/wola/salad');
  return deps.salad;
}

const tzOpts = (deps: WolaDeps) => ({ dayStartHour: deps.content.tuning.dayStartHour, ...(deps.tz ? { tz: deps.tz } : {}) });

export function stateOf(deps: WolaDeps): SaladState {
  return saladState(deps.store.progress.log.events, dataOf(deps), tzOpts(deps), deps.clock.now());
}

/** Портреты кассиров из атласа Wola для окна реплики. */
export function cashierPortraits(atlas: PixAtlas | null, data: SaladData): PortraitSource | null {
  if (!atlas) return null;
  return (id) => {
    const c = data.cashiers.cashiers.find((x) => x.id === id);
    const r = c ? atlas.sprites.frames[c.sprite] : undefined;
    return r ? { url: atlas.sprites.url, sheet: atlas.sprites.size, rect: [r.x, r.y, r.w, r.h] } : null;
  };
}

/** Облачко заказа: что Дима хочет (русскими словами + миска). */
export function orderText(data: SaladData, o: VisitOrder, deps?: Pick<WolaDeps, 'content'>): string[] {
  const s = data.menu.salads.find((x) => x.id === o.salad);
  const parts: string[] = [];
  if (o.compose?.length) parts.push(`свой салат: ${o.compose.map((w) => deps?.content.vocab.get(w)?.value.pl ?? w).join(', ')}`);
  else parts.push(s ? s.name : o.salad);
  parts.push(SIZE_RU[o.size]);
  const d = data.menu.dressings.find((x) => x.id === o.dressing);
  if (d) parts.push(`${d.pl}${o.osobno ? ', отдельно' : ''}`);
  const b = data.menu.breads.find((x) => x.id === o.bread);
  if (b) parts.push(b.pl);
  const dr = data.menu.drinks.find((x) => x.id === o.drink);
  if (dr) parts.push(dr.pl);
  if (o.place === 'wynos') parts.push('с собой');
  return parts;
}

interface Scene {
  node: HTMLElement;
  think(o: VisitOrder | null): void;
  /** Пузырь кассира; `hideRu` (W-04) — перевод спрятан до ответа («Что это значит?»), `reveal()` его показывает. */
  say(b: BubbleLine | null, hideRu?: boolean): void;
  reveal(): void;
  setCashier(c: Cashier | null): void;
}

/** Сцена салатной: интерьер, кассир, витрина, доска, облачко и пузырь. */
function scene(deps: WolaDeps, data: SaladData, k: number, cashier: Cashier | null, danie: string, season?: string): Scene {
  const atlas = deps.atlas;
  const node = el('div', { class: 'wl-scene wl-ss-scene', 'data-k': k, style: `width:${ROOM_W * T * k}px;height:${ROOM_H * T * k}px` });
  node.append(roomEl(atlas, SALAD_ROOM, k));
  const kas = el('div', { class: 'wl-ss-cashier', style: `left:${CASHIER_AT[0] * T * k}px;top:${CASHIER_AT[1] * T * k}px` });
  node.append(kas);
  // Витрина: миски салатов меню (по 2 по сторонам от кассира).
  data.menu.salads.slice(0, 5).forEach((s, i) => {
    const col = [0.1, 1.15, 2.2, 6.95, 7.95][i]!;
    const b = spriteEl(atlas, s.sprite, k, 'wl-spr wl-ss-bowl');
    b.style.left = `${col * T * k}px`;
    b.style.top = `${(3 * T - 2) * k}px`;
    node.append(b);
  });
  node.append(el('div', { class: 'wl-ss-board', style: `left:${2 * T * k}px;top:${T * k * 0.12}px;width:${2 * T * k}px;height:${T * k * 0.8}px;font-size:${Math.max(8, 4 * k)}px` }, el('b', {}, season ?? 'Danie dnia'), el('span', { lang: 'pl' }, danie)));
  const thinkEl = el('div', { class: 'wl-ss-think', hidden: true, 'data-think': true });
  const sayEl = el('div', { class: 'wl-ss-say', hidden: true, 'data-say': true });
  node.append(thinkEl, sayEl);
  const setCashier = (c: Cashier | null): void => {
    kas.replaceChildren(...(c ? [spriteEl(atlas, c.sprite, k)] : []));
    kas.dataset['cashier'] = c?.id ?? '';
  };
  setCashier(cashier);
  return {
    node,
    setCashier,
    think(o) {
      thinkEl.hidden = !o;
      if (!o) return thinkEl.replaceChildren();
      const s = data.menu.salads.find((x) => x.id === o.salad);
      thinkEl.replaceChildren(
        spriteEl(atlas, o.compose?.length ? data.menu.compose.sprite : (s?.sprite ?? data.menu.compose.sprite), Math.max(1, Math.floor(k / 2) + 1)),
        el('span', {}, ...orderText(data, o, deps).flatMap((t, i): (string | HTMLElement)[] => (i ? [' · ', t] : [el('b', { lang: 'pl' }, t)]))),
      );
    },
    say(b, hideRu = false) {
      sayEl.hidden = !b;
      if (!b) return sayEl.replaceChildren();
      sayEl.replaceChildren(el('b', { lang: 'pl' }, b.pl), el('small', { lang: 'ru', 'data-say-ru': true, ...(hideRu ? { hidden: true } : {}) }, b.ru), ...(hideRu ? [el('small', { 'data-say-wait': true }, '…')] : []));
    },
    reveal() {
      sayEl.querySelector<HTMLElement>('[data-say-ru]')?.removeAttribute('hidden');
      sayEl.querySelector('[data-say-wait]')?.remove();
    },
  };
}

/** Визит, который сейчас начнётся (детерминированно: сид = игровой день + номер визита). Тесты знают ответы заранее. */
export function planVisit(deps: WolaDeps, jump = false): Visit {
  const data = dataOf(deps);
  const st = stateOf(deps);
  const now = deps.clock.now();
  const day = dayOf(now, tzOpts(deps));
  const d = derived(deps);
  return buildVisit({
    data,
    vocab: (id) => deps.content.vocab.get(id)?.value,
    state: st,
    tpl: visitTpl(st, jump),
    jump,
    mine: mySalad(deps.store.progress, data.menu),
    planted: plantedOf(d),
    due: Object.entries(d.cards).filter(([, c]) => c.due <= now).map(([id]) => id),
    familiar: (lx) => isFamiliar(d.cards, lx),
    seed: `${day}:${st.visits}`,
    day,
    // План дня (W-04): новые слова салатной — в общем лимите дня (огород).
    newLeft: newLeft(dayCap(deps.store.progress, d, now, deps.content.tuning, deps.tz ? { tz: deps.tz } : {})),
  });
}

export async function runSalad(deps: WolaDeps): Promise<void> {
  ensureWolaStyle(document);
  const data = dataOf(deps);
  const frame = openPlace(deps, 'salad', { pl: 'Salad Story', ru: 'обед: заказ по-польски' });
  const wrap = el('div', { class: 'wl-ss' });
  const top = el('div', { class: 'wl-ss-top' });
  const panel = el('div', { class: 'wl-ss-panel', 'data-panel': 'salad' });
  wrap.append(top, panel);
  frame.stage.replaceChildren(wrap);
  let sc: Scene | null = null;
  let busy = false;

  const paintScene = (cashier: Cashier | null): Scene => {
    const box = boxOf(frame.stage);
    const k = fitScale(ROOM_W, ROOM_H, Math.min(box.w - 8, 720), Math.max(140, box.h * 0.4), 4);
    const st = stateOf(deps);
    const day = dayOf(deps.clock.now(), tzOpts(deps));
    const danie = danieDnia(data, st.level, day);
    const season = st.level >= data.menu.season.from ? data.menu.season.board.pl : undefined;
    sc = scene(deps, data, k, cashier, season ? data.menu.salads.find((s) => s.id === data.menu.season.salad)!.name : danie.name, season);
    top.replaceChildren(sc.node);
    return sc;
  };

  const lobby = (): void => {
    const s = paintScene(data.cashiers.cashiers[0]!);
    s.think(null);
    s.say(null);
    const st = stateOf(deps);
    const tpl = visitTpl(st);
    const lv = levelOf(data, st.level)!;
    const mine = mySalad(deps.store.progress, data.menu);
    const my = data.menu.salads.find((x) => x.id === mine.salad)!;
    const per = data.levels.pass.stampsPerCard;
    const stamps = st.stamps % per;
    const cards = Math.floor(st.stamps / per);
    const go = plBtn({ pl: ORDER_BTN.pl, ru: `${ORDER_BTN.ru} · уровень ${tpl}` }, () => void visit(false), 'primary', { 'data-nav': true, 'data-primary': true, 'data-act': 'order' });
    const jump = canJump(st) ? plBtn({ pl: JUMP_BTN.pl, ru: `уровень ${st.level + 1}: ≥ 90 % засчитает этот` }, () => void visit(true), '', { 'data-nav': true, 'data-act': 'jump' }) : null;
    panel.replaceChildren(
      el(
        'div',
        { class: 'pq-wood wl-ss-card', 'data-lobby': st.level },
        el('h3', {}, el('span', { lang: 'pl' }, `Poziom ${st.level}: ${lv.title.pl}`), el('small', {}, lv.title.ru)),
        el('div', { class: 'goal' }, lv.goal),
        el(
          'div',
          { class: 'stat', 'data-streak': `${st.streak}/${data.levels.pass.streak}` },
          el('span', {}, 'Зачётных визитов подряд'),
          el('b', {}, `${st.streak} из ${data.levels.pass.streak}${st.streak ? ` · дней: ${st.streakDays} из ${data.levels.pass.minDays}` : ''}`),
        ),
        st.level >= st.cap && st.level < 10 ? el('div', { class: 'note' }, `Уровень ${st.level + 1} пока закрыт.`) : null,
        st.fallback ? el('div', { class: 'note', 'data-fallback': true }, `Сегодня визит попроще (уровень ${tpl}): два раза подряд было трудно. Уровень не отнимается.`) : null,
        el(
          'div',
          { class: 'wl-ss-stamps', 'data-stamps': st.stamps, 'aria-label': `печатей ${stamps} из ${per}` },
          el('span', {}, 'Karta stałego klienta'),
          el('span', { class: 'cells' }, ...Array.from({ length: per }, (_, i) => el('i', { class: i < stamps ? 'on' : '' }))),
          cards ? el('small', {}, `Paluch gratis × ${cards}`) : null,
          st.gold ? el('small', { class: 'wl-ss-real-mark', 'data-real-done': st.gold }, `✓ заказано в реале: ${st.gold}`) : null,
        ),
        el(
          'div',
          { class: 'wl-ss-tried', 'data-tried': st.tried.salads.length },
          el('span', {}, `Spróbowane: ${st.tried.salads.filter((x) => data.menu.salads.some((s) => s.id === x)).length} из ${data.menu.salads.length}`),
          el('span', { class: 'bowls' }, ...data.menu.salads.map((m) => {
            const b = spriteEl(deps.atlas, m.sprite, 2);
            if (!st.tried.salads.includes(m.id)) b.classList.add('ghost');
            b.title = m.name;
            return b;
          })),
        ),
        el('div', { class: 'mine', 'data-mine': my.id }, 'Мой салат: ', el('b', { lang: 'pl' }, `${my.name}, ${mine.size === 'normalna' ? 'normalna' : 'powiększona'}`), ' (сменить — ⚙ на улице)'),
        el('div', { class: 'wl-row' }, jump, go),
      ),
    );
    queueMicrotask(() => go.focus({ preventScroll: true }));
  };

  /** «I jak było?»: прошлое задание в реале (W-04: только со следующего игрового дня). Ответ без оценки; Enter — «Później». */
  const jakBylo = (cashier: Cashier): Promise<'ok' | 'no' | 'later' | null> =>
    new Promise((resolve) => {
      const b = { pl: data.cashiers.common['jak_bylo']![0]!.pl, ru: data.cashiers.common['jak_bylo']![0]!.ru };
      sc?.say(b);
      if (!isSilent(deps.store.progress)) deps.audio.play(b.pl, { who: cashier.id });
      const done = (v: 'ok' | 'no' | 'later' | null): void => {
        frame.layer.handle(null);
        resolve(v);
      };
      // Ни один ответ не главный: под фокусом и Enter — «Później» (W-04: Enter ставил «Udało się» без обеда).
      const later = plBtn(REAL_LATER, () => done('later'), '', { 'data-nav': true, 'data-act': 'real-later' });
      const ok = plBtn(REAL_OK, () => done('ok'), '', { 'data-nav': true, 'data-act': 'real-ok' });
      const no = plBtn(REAL_NO, () => done('no'), '', { 'data-nav': true, 'data-act': 'real-no' });
      panel.replaceChildren(
        el('div', { class: 'pq-wood wl-ss-card', 'data-jak-bylo': true }, el('h3', {}, el('span', { lang: 'pl' }, `${cashier.name}: ${b.pl}`), el('small', {}, b.ru)), el('div', { class: 'goal' }, 'Ты заказывал по-польски на настоящей кассе? Без оценки, просто отметка.'), el('div', { class: 'wl-row' }, later, no, ok)),
      );
      frame.layer.handle({ cancel: () => (done(null), true) });
      queueMicrotask(() => later.focus({ preventScroll: true }));
    });

  const visit = async (jump: boolean): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await runVisit(jump);
    } finally {
      busy = false;
      if (!frame.layer.closed) lobby();
    }
  };

  const runVisit = async (jump: boolean): Promise<void> => {
    const st = stateOf(deps);
    const v = planVisit(deps, jump);
    const tpl = v.tpl;
    const s = paintScene(v.cashier);
    let real: 'ok' | 'no' | undefined;
    if (askJakBylo(st, dayOf(deps.clock.now(), tzOpts(deps)))) {
      const r = await jakBylo(v.cashier);
      if (r === null) return;
      if (r !== 'later') real = r;
    }
    s.think(v.order);
    s.say(null);
    const silent = isSilent(deps.store.progress);
    const lesson = lessonForToday(v.lesson, wolaStepGate(silent, (id) => deps.content.vocab.get(id)?.value.tr));
    // Старый незаконченный визит не продолжаем: шаги нового визита другие.
    if (deps.store.local.resume?.lessonId.startsWith(SALAD_LESSON_PREFIX)) {
      const { resume: _r, ...l } = deps.store.local;
      deps.store.setLocal(l);
    }
    const gags: string[] = [];
    const gagOf = (tags: readonly string[]) => data.events.gags.find((g) => tags.includes(g.onTag));
    const fill = (t: string): string => t.replace(/\{([A-Za-z]+)\}/g, (m, key: string) => v.vars[key] ?? m);
    const box = el('div', { class: 'wl-ss-lesson' });
    panel.replaceChildren(box);
    const sub: Layer = {
      el: box,
      handle: (h) => frame.layer.handle(h),
      get closed() {
        return frame.layer.closed;
      },
      close: () => undefined,
    };
    const r = await runLesson(
      lesson,
      {
        ...deps,
        portraits: cashierPortraits(deps.atlas, data),
        picture: (f, k) => (deps.atlas?.sprites.frames[f] ? spriteEl(deps.atlas, f, k) : null),
      },
      {
        layer: sub,
        noSummary: true,
        src: 'order',
        onStep: (step, id) => {
          const b = v.bubbles[id] ?? v.bubbles[step.id ?? ''];
          // «Что это значит?» (listen): перевод в пузыре спрятан до ответа (W-04), иначе он сам и есть ответ.
          s.say(step.t === 'say' ? null : (b ?? null), step.t === 'listen');
          if (b && step.t !== 'listen' && !silent) deps.audio.play(b.pl, { who: v.cashier.id });
        },
        onAnswer: () => s.reveal(),
        errLineFor: (tags) => {
          const g = gagOf(tags);
          return g ? { who: v.cashier.name, pl: fill(g.line.pl), plRu: fill(g.line.ru) } : undefined;
        },
        gagFor: (tags) => {
          const g = gagOf(tags);
          if (!g) return null;
          if (!gags.includes(g.id)) gags.push(g.id);
          if (!g.sprite) return null;
          return el('span', { class: 'wl-ss-gag', 'data-gag': g.id }, spriteEl(deps.atlas, g.sprite, 3), g.title ? el('small', {}, `${g.title.pl} · ${g.title.ru}`) : null);
        },
      },
    );
    s.say(null);
    if (r.cancelled) return;
    const firstTry = r.firstTry ?? 0;
    const task = showRealTask(data, st, tpl, firstTry, r.answers) && v.realTask ? tpl : undefined;
    write(deps, {
      k: 'visit',
      ts: deps.clock.now(),
      level: st.level,
      tpl,
      cashier: v.cashier.id,
      order: v.order,
      score: r.score ?? 0,
      firstTry,
      ms: r.ms ?? 0,
      ...(jump ? { jump: 1 as const } : {}),
      ...(gags.length ? { gags } : {}),
      ...(task ? { task } : {}),
      ...(real ? { real } : {}),
      ...(r.answers !== undefined ? { answers: r.answers } : {}),
    });
    changed(deps, ['cards', 'world']);
    await result(v, st, firstTry, gags, task ? v.realTask : undefined, r.planted ?? [], r.answers);
  };

  /** Итог визита: поднос, «Smacznego!», «Spróbowane», печать, уровень, задание в реале. */
  const result = (v: Visit, before: SaladState, firstTry: number, gags: string[], task: { pl: string; ru: string } | undefined, planted: string[], answers?: number): Promise<void> =>
    new Promise((resolve) => {
      const after = stateOf(deps);
      // Зачёт (W-04): одна ошибка не ломает — 2 из 3, 4 из 5.
      const passed = visitPassed(firstTry, answers, data.levels.pass);
      const wpadki = gags.map((g) => data.events.gags.find((x) => x.id === g)?.title?.ru ?? '').filter(Boolean);
      const pct = Math.round(firstTry * 100);
      const per = data.levels.pass.stampsPerCard;
      const newDish = !before.tried.salads.includes(v.order.salad);
      const dish = data.menu.salads.find((x) => x.id === v.order.salad);
      const up = after.level > before.level;
      const done = (): void => {
        frame.layer.handle(null);
        resolve();
      };
      const ok = plBtn({ pl: 'Gotowe', ru: 'к стойке' }, done, 'primary', { 'data-nav': true, 'data-primary': true, 'data-act': 'done' });
      const silent = isSilent(deps.store.progress);
      const pl = (id: string): string => deps.content.vocab.get(id)?.value.pl ?? id;
      panel.replaceChildren(
        el(
          'div',
          { class: 'pq-wood wl-ss-card wl-ss-result', 'data-result': pct, 'data-passed': passed ? 1 : 0 },
          tray(deps, data, v.order, gags),
          el('div', { class: 'big', lang: 'pl' }, 'Smacznego!', el('small', { lang: 'ru' }, ' Приятного аппетита!')),
          el('div', { class: 'stat', 'data-first-try': pct }, el('span', {}, 'С первого раза'), el('b', {}, `${pct} %${passed ? ' · зачёт' : ''}`)),
          dish ? el('div', { class: 'stat', 'data-sprobowane': v.order.salad }, el('span', {}, 'Spróbowane'), el('b', { lang: 'pl' }, `${newDish ? 'новое: ' : '✓ '}${dish.name}`)) : null,
          passed ? el('div', { class: 'stat', 'data-stamp': after.stamps }, el('span', {}, 'Pieczątka'), el('b', {}, `${after.stamps % per || per} из ${per}${after.stamps % per === 0 ? ' · Paluch gratis!' : ''}`)) : el('div', { class: 'note' }, 'Печать — за визит почти без ошибок: одна ошибка не считается.'),
          up ? el('div', { class: 'up', 'data-level-up': after.level }, `Poziom ${after.level}! Открыт уровень ${after.level}: ${levelOf(data, after.level)?.title.ru ?? ''}.`) : el('div', { class: 'goal', 'data-streak': after.streak }, `Серия на уровне ${after.level}: ${after.streak} из ${data.levels.pass.streak}${after.streak ? `, дней ${after.streakDays} из ${data.levels.pass.minDays}` : ''}.`),
          // «Wpadki:» только с названиями гэгов (W-04: был пустой заголовок).
          wpadki.length ? el('div', { class: 'goal', 'data-wpadki': gags.join(',') }, `Wpadki: ${wpadki.join(', ')}`) : null,
          planted.length ? el('div', { class: 'goal', 'data-planted': planted.join(',') }, '🌱 В огород: ', el('b', { lang: 'pl' }, planted.map(pl).join(', ')), ` (${wordsN(planted.length)})`) : null,
          task ? realCard(task, silent) : null,
          el('div', { class: 'wl-row' }, ok),
        ),
      );
      frame.layer.handle({ cancel: () => (done(), true) });
      queueMicrotask(() => ok.focus({ preventScroll: true }));
    });

  const realCard = (task: { pl: string; ru: string }, silent: boolean): HTMLElement =>
    el(
      'div',
      { class: 'wl-ss-real', 'data-real-task': task.pl },
      el('b', {}, 'Zadanie w realu · задание на сегодняшний обед'),
      el('div', { class: 'phrase', lang: 'pl' }, task.pl),
      el('small', {}, task.ru),
      silent ? null : el('div', { class: 'wl-row' }, ...audioButtons(deps.audio, task.pl)),
      el('small', {}, 'Скажи это вслух два раза и сегодня на кассе. В следующий визит кассир спросит «I jak było?».'),
    );

  lobby();
  const win = frame.layer.el.ownerDocument.defaultView;
  const onResize = (): void => {
    if (!busy) lobby();
  };
  win?.addEventListener('resize', onResize);
  await frame.closed;
  win?.removeEventListener('resize', onResize);
}

/** Поднос итога: миска заказа (гэг «таз» — огромная), соус в стаканчике или стакан сока, палочка, напиток, пакет. */
export function tray(deps: Pick<WolaDeps, 'atlas'>, data: SaladData, o: VisitOrder, gags: readonly string[]): HTMLElement {
  const k = 3;
  const t = el('div', { class: 'wl-ss-tray', 'data-tray': o.salad, style: `width:${48 * k}px;height:${40 * k}px` });
  const put = (frame: string, x: number, y: number, kk = k, attr?: string): void => {
    const s = spriteEl(deps.atlas, frame, kk, 'wl-spr wl-ss-item');
    s.style.left = `${x * k}px`;
    s.style.top = `${y * k}px`;
    if (attr) s.dataset['item'] = attr;
    t.append(s);
  };
  const taca = spriteEl(deps.atlas, 'wola.taca/0', k, 'wl-spr wl-ss-item');
  taca.style.left = '0';
  taca.style.top = `${24 * k}px`;
  t.append(taca);
  const s = data.menu.salads.find((x) => x.id === o.salad);
  const bowl = o.compose?.length ? data.menu.compose.sprite : (s?.sprite ?? data.menu.compose.sprite);
  const xxl = gags.includes('gag.miska_xxl');
  if (xxl) put('wola.gag/0', 6, -2, k, 'xxl');
  else put(bowl, 14, 14, k + 1, 'bowl');
  if (gags.includes('gag.sok_sos')) put('wola.salatka/16', 2, 14, k, 'sok');
  else if (o.osobno) put('wola.salatka/18', 2, 18, k, 'sos');
  const b = data.menu.breads.find((x) => x.id === o.bread);
  if (b) put(b.sprite, 34, 18, k, 'paluch');
  const dr = data.menu.drinks.find((x) => x.id === o.drink);
  if (dr) put(dr.sprite, 34, 10, k, 'drink');
  if (gags.includes('gag.na_wynos')) put('wola.gag/1', 44, 4, 2, 'torba');
  // Две миски (W-04, «Coś jeszcze? — Tak, poproszę»): вторая такая же рядом.
  if (gags.includes('gag.dwie_miski') && !xxl) put(bowl, 26, 6, k, 'bowl2');
  return t;
}
