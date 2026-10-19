// Движок мини-игр v2 «Игры о Польше» поверх раундов V11a (`ui/roundSummary.ts`): одна оболочка на все четыре игры.
// Игра (`src/games/<id>/`, контракт `PolskaGame` в types/polska.ts) рисует задание в `panel.body` и отдаёт ответ `panel.submit`;
// движок досаживает единицы из `pool`, выбирает единицу и сторону (`polska.pick`), пишет ответ в огород v2, показывает результат,
// считает раунд 10 заданий, итог («Ещё раунд» / «Закончить»), ведёт героя к участку в Zagroda (`polska:focus`).
// Раскладка: `panel` — нижняя панель, мир сверху; `full` — весь экран (карта, календарь), рост виден отложенно (строка в итоге).
import { bus as globalBus, type Bus } from '../systems/bus';
import type { Polska } from '../systems/polska';
import { growthText } from '../systems/xp';
import { PLOT_NAME } from '../systems/zagroda';
import type { BusEvents } from '../types/bus';
import type { GameCtx, GamePanel, GameTask, PolskaGame, PolskaGameId } from '../types/polska';
import { el } from './dom';
import { Round, renderRoundSummary, roundCss, ROUND_SIZE } from './roundSummary';
import { polishPart, sayButton, sayFocused, SAY_CSS } from './sayButton';
import { THEME_CSS } from './theme';

export interface PolskaGameDeps {
  bus?: Bus<BusEvents>;
  games: readonly PolskaGame[];
  polska: Polska;
  now(): number;
  rand?: () => number;
  /** Озвучить польский текст (под выключателем звука; `?mute=1` — только в консоль). */
  say(text: string, slow?: boolean): void;
}

export interface PolskaGameUi {
  start(game: PolskaGameId, only?: string): void;
  /** Закрыть. `go` — «Na pole!»: после игры во весь экран герой сразу идёт в Zagroda (`polska:tour`). */
  stop(go?: boolean): void;
  readonly isOpen: boolean;
  readonly game: PolskaGameId | null;
  readonly task: GameTask | null;
  /** Ответить на текущее задание (для проверок и dev: то же, что `panel.submit`). */
  submit(answer: unknown): void;
  root: HTMLElement;
}

/** Через сколько после ответа «Dalej» начинает нажиматься. Само ничего не листается: следующее задание — только кнопкой (Шэф 19.10). */
export const NEXT_DELAY_MS = 300;
/** Итог раунда: столько мс клавиша действия его не нажимает. */
export const SUMMARY_GUARD_MS = 400;

const css = `
${THEME_CSS}
${roundCss}
${SAY_CSS}
.pq-pg { position: fixed; left: 0; right: 0; bottom: 0; z-index: 55; display: flex; justify-content: center; pointer-events: none;
  padding: 0 calc(env(safe-area-inset-right) + 8px) calc(env(safe-area-inset-bottom) + 8px) calc(env(safe-area-inset-left) + 8px);
  font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink); hyphens: none; }
.pq-pg.full { top: 0; align-items: center; padding-top: calc(env(safe-area-inset-top) + 8px); background: rgba(42, 20, 24, .55); }
.pq-pg[hidden] { display: none; }
.pq-pg .box { pointer-events: auto; width: min(720px, 100%); box-sizing: border-box; background: var(--pq-wood); border: 3px solid var(--pq-ink); border-radius: 12px;
  box-shadow: 0 4px 0 var(--pq-ink), inset 0 0 0 2px var(--pq-wood-dark); padding: 6px 8px 8px; height: clamp(250px, max(58dvh, 100dvh - 260px), 450px); max-height: calc(100dvh - 24px); display: flex; flex-direction: column; }
.pq-pg.full .box { width: min(1200px, 100%); height: 100%; max-height: none; }
.pq-pg .head { flex: 0 0 auto; min-height: 38px; display: flex; align-items: center; gap: 8px; color: var(--pq-cream); padding: 0 2px 6px; font-weight: 700; font-size: 14px; }
.pq-pg .title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pq-pg .title small { font-size: 11px; opacity: .7; margin-left: 4px; }
.pq-pg .roundno { flex: 0 0 auto; font-size: 13px; font-weight: 800; background: var(--pq-wood-dark); border: 1px solid var(--pq-cream); border-radius: 6px; padding: 1px 7px; font-variant-numeric: tabular-nums; }
.pq-pg .roundno[hidden] { display: none; }
.pq-pg .head .pq-btn { flex: 0 0 auto; padding: 6px 10px; font-size: 14px; }
.pq-pg .paper { flex: 1 1 auto; min-height: 0; background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 6px; padding: 10px 12px; overflow-y: auto; overflow-x: hidden; }
.pq-pg .paper.ok { background: #d6efc0; } .pq-pg .paper.bad { background: #f6d7cc; }
.pq-pg .fb { flex: 0 0 auto; margin-top: 6px; padding: 6px 10px; background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 6px; font-size: 15px; }
.pq-pg .fb[hidden] { display: none; }
.pq-pg .fb .big { font-size: 19px; font-weight: 800; overflow-wrap: break-word; }
.pq-pg .fb .lbl { font-size: 13px; font-weight: 600; opacity: .75; margin-right: 4px; }
.pq-pg .fb .sub { opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pq-pg .fb .note { font-size: 13px; opacity: .85; overflow-wrap: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.pq-pg .way2.go { display: block; width: 100%; cursor: pointer; font: inherit; font-weight: 700; color: var(--pq-ink); }
.pq-pg .foot { flex: 0 0 auto; display: flex; gap: 8px; min-height: 46px; padding-top: 8px; }
.pq-pg .foot .pq-btn { flex: 1 1 auto; }
.pq-pg .foot .pq-btn.wait { opacity: .5; }
.pq-pg .foot .pq-btn[data-next] { font-size: 18px; font-weight: 800; padding-top: 12px; padding-bottom: 12px; }
.pq-pg .foot .pq-btn.pq-back { flex: 1.3 1 0; background: #f2d552; white-space: nowrap; padding-left: 6px; padding-right: 6px; }
.pq-pg .pq-progress { font-size: 13px; margin: 0 0 6px; color: #4a6b2a; font-weight: 600; }
.pq-pg .pq-q { font-size: 22px; font-weight: 800; margin: 0 0 4px; overflow-wrap: break-word; }
.pq-pg .pq-q-hint { font-size: 13px; opacity: .7; margin-bottom: 8px; }
.pq-pg .pq-opts { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 64px; gap: 8px; }
.pq-pg .pq-opt { display: flex; align-items: center; gap: 4px; height: 100%; box-sizing: border-box; text-align: left; color: var(--pq-ink); background: #fffaf0; font-size: 16px; line-height: 1.15; padding: 6px 9px; overflow: hidden; }
.pq-pg .pq-opt .n { flex: 0 0 auto; min-width: 16px; opacity: .5; font-size: 13px; }
.pq-pg .pq-opt .t { flex: 1 1 auto; min-width: 0; overflow-wrap: break-word; }
.pq-pg .pq-opt.right { background: #8cc66a; } .pq-pg .pq-opt.wrong { background: #e88e7c; }
.pq-pg .pq-built { min-height: 44px; display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; border: 2px dashed var(--pq-wood); border-radius: 6px; margin-bottom: 8px; background: #fffaf0; }
.pq-pg .pq-pool { display: flex; flex-wrap: wrap; gap: 6px; }
.pq-pg .pq-tile { color: var(--pq-ink); background: #f2dcae; font-size: 17px; padding: 8px 10px; }
.pq-pg .pq-tile[disabled] { opacity: .25; }
.pq-pg .pq-btn[disabled] { opacity: .45; }
.pq-pg.kb .is-focus, .pq-pg :focus-visible { outline: 3px solid var(--pq-accent); outline-offset: 1px; }
.pq-pg .way2 { margin-top: 6px; padding: 6px 8px; text-align: center; background: #fffaf0; border: 2px solid var(--pq-wood-dark); border-radius: 8px; font-size: 15px; font-weight: 700; }
.pq-pg .way2 b { color: #4a6b2a; }
/* Игра во весь экран на телефоне: лист от края до края, карте и календарю каждый пиксель ширины. */
@media (max-width: 520px) {
  .pq-pg.full { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-bottom: env(safe-area-inset-bottom); }
  .pq-pg.full .box { width: 100%; border-left-width: 0; border-right-width: 0; border-radius: 0; padding-left: 0; padding-right: 0; }
  .pq-pg.full .head, .pq-pg.full .foot, .pq-pg.full .fb { margin-left: 8px; margin-right: 8px; }
  .pq-pg.full .paper { border-left-width: 0; border-right-width: 0; border-radius: 0; padding-left: 0; padding-right: 0; }
  .pq-pg.full .paper > :not(.geo):not(.dt) { margin-left: 10px; margin-right: 10px; }
}
@media (max-width: 520px) { .pq-pg .title small, .pq-pg .exit-lbl { display: none; } .pq-pg .pq-q { font-size: 19px; } .pq-pg .pq-opts { grid-auto-rows: 58px; } .pq-pg .paper { padding: 8px; } }
@media (max-width: 520px), (max-height: 860px) { .pq-pg .pq-tile { font-size: 15px; padding: 6px 8px; } .pq-pg .pq-built { min-height: 38px; padding: 4px; gap: 5px; } .pq-pg .pq-pool { gap: 5px; } .pq-pg .pq-progress { margin-bottom: 4px; } .pq-pg .pq-q-hint { margin-bottom: 6px; } .pq-pg .pq-q { font-size: 18px; } }
`;

/** Локальная дата по часам игры. */
function dateOf(t: number): { y: number; m: number; d: number; weekday: number } {
  const x = new Date(t);
  return { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate(), weekday: x.getDay() };
}

export function mountPolskaGame(parent: HTMLElement, deps: PolskaGameDeps): PolskaGameUi {
  const bus = deps.bus ?? globalBus;
  const rand = deps.rand ?? Math.random;
  const byId = new Map(deps.games.map((g) => [g.id, g]));
  const title = el('span', { class: 'title', 'data-title': '' }, '');
  const roundNo = el('span', { class: 'roundno', 'data-round-no': '', hidden: true }, `1 / ${ROUND_SIZE}`);
  const exitBtn = el('button', { type: 'button', class: 'pq-btn', 'data-exit': '', 'aria-label': 'Выйти', onclick: () => api.stop() }, el('span', { class: 'exit-lbl' }, 'Выйти '), '✕');
  const paper = el('div', { class: 'paper', 'data-game': '' });
  const fb = el('div', { class: 'fb', 'data-feedback': '', hidden: true });
  const foot = el('div', { class: 'foot', 'data-foot': '' });
  const box = el('div', { class: 'box', role: 'dialog', 'aria-label': 'Игра о Польше' }, el('div', { class: 'head' }, title, roundNo, exitBtn), paper, fb, foot);
  const root = el('div', { class: 'pq-pg', hidden: true, 'data-polska-game': '' }, el('style', {}, css), box);
  parent.append(root);

  let open = false;
  let game: PolskaGame | null = null;
  let only: string | undefined;
  /** Игры с экраном выбора (`PolskaGame.hub`): единица текущего раунда, длина раунда и «сейчас идёт экран выбора». */
  let focus: string | undefined;
  let limit = ROUND_SIZE;
  let hubOn = false;
  let task: GameTask | null = null;
  let answered = false;
  let summaryOpen = false;
  /** Когда показан итог (мс, `performance.now`): клавиша действия в первые 400 мс его не нажимает (не промахнуться по «Wróć» на «Dalej»). */
  let summaryAt = 0;
  let nextReady = true;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let focusIdx = -1;
  let kbNav = false;
  const recent: string[] = [];
  const round = new Round();
  let roundN = 1;
  /** Позиция на шкале «Wiedza o Polsce» до первого ответа раунда. */
  let scaleFrom: number | null = null;
  let scaleTo: { pos: number; sub: number; pl: string } | null = null;
  /** Игра во весь экран: объекты Zagroda, которые подросли за открытие (обход после выхода, `polska:tour`). */
  let grownObjs: string[] = [];

  const ctxOf = (g: PolskaGame): GameCtx => ({
    units: deps.polska.units(g.id),
    unit: (id) => deps.polska.unit(id),
    info: (id) => deps.polska.info(id),
    seen: (id) => deps.polska.seen(id),
    markSeen: (id) => deps.polska.markSeen(id),
    doc: deps.polska.content.docs[g.id],
    now: deps.now,
    date: () => dateOf(deps.now()),
    rand,
  });

  const navs = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-nav]')].filter((n) => !(n as HTMLButtonElement).disabled);
  const setFocus = (i: number): void => {
    for (const n of root.querySelectorAll('.is-focus')) n.classList.remove('is-focus');
    const list = navs();
    if (!list.length) return;
    focusIdx = (i + list.length) % list.length;
    if (kbNav) list[focusIdx]!.classList.add('is-focus');
  };
  const paintRound = (): void => {
    roundNo.hidden = !!only || hubOn;
    const shown = summaryOpen ? round.count : Math.min(limit, round.count + (answered ? 0 : 1));
    roundNo.textContent = `${shown} / ${limit}`;
  };
  const reportHeight = (): void => {
    if (!open || !game) return;
    bus.emit('farm:auto', { on: true, bottom: game.layout === 'panel' ? Math.round(box.getBoundingClientRect().height + 12) : 0 });
  };
  const clearTimers = (): void => {
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
    nextReady = true;
  };

  const panel: GamePanel = {
    body: paper,
    foot,
    get layout() {
      return game?.layout ?? 'panel';
    },
    submit: (answer) => api.submit(answer),
    say: (text, slow) => deps.say(text, slow),
    rand,
    root,
    fit: (measure) => {
      if (!open || !game || game.layout !== 'full' || summaryOpen) return;
      box.style.removeProperty('height');
      const cs = getComputedStyle(paper);
      const px = (v: string): number => parseFloat(v) || 0;
      const padX = px(cs.paddingLeft) + px(cs.paddingRight) + 2 * paper.clientLeft;
      const padY = px(cs.paddingTop) + px(cs.paddingBottom);
      const full = box.offsetHeight;
      const fbTaken = fb.hidden ? 0 : fb.offsetHeight + 6;
      if (!full || !paper.offsetWidth) return;
      const inner = paper.clientHeight - padY;
      const want = measure({ w: paper.offsetWidth - padX, h: inner + fbTaken });
      // Всё, кроме содержимого листа: шапка, подвал, рамки, поля.
      const chrome = full - inner - fbTaken;
      const h = Math.ceil(chrome + want);
      if (want > 0 && h < full - 24) box.style.height = `${h}px`;
    },
  };

  const empty = (text: string, hint: string): void => {
    paper.append(el('div', { class: 'pq-q' }, text), el('div', { class: 'pq-q-hint' }, hint));
    bus.emit('polska:focus', { id: null, obj: null, label: '' });
  };

  /** Следующее задание: досадить, выбрать единицу (до 6 попыток, если игра пропускает), отрисовать. */
  const render = (): void => {
    clearTimers();
    paper.classList.remove('ok', 'bad');
    paper.replaceChildren();
    foot.replaceChildren();
    fb.hidden = true;
    fb.replaceChildren();
    answered = false;
    summaryOpen = false;
    task = null;
    focusIdx = -1;
    box.style.removeProperty('height');
    if (!game) return;
    const ctx = ctxOf(game);
    if (!only) deps.polska.autoPlant(game.id, game.pool(ctx));
    const skip = new Set<string>();
    const one = only ?? focus;
    for (let i = 0; i < 6 && !task; i++) {
      const want = deps.polska.pick(game.id, { recent, ...(one ? { only: one } : {}), exclude: skip });
      if (!want) break;
      task = game.nextTask(ctx, want);
      if (!task) skip.add(want.id);
      if (one) break;
    }
    paintRound();
    if (!task) {
      empty('Пока нечего поливать', 'Все единицы этой игры собраны или ждут завтрашнего дня.');
      requestAnimationFrame(reportHeight);
      return;
    }
    recent.push(task.id);
    if (recent.length > 8) recent.shift();
    const inf = deps.polska.info(task.id);
    paper.append(el('div', { class: 'pq-progress', 'data-progress': '' }, `🌱 ${inf.next.charAt(0).toUpperCase()}${inf.next.slice(1)}`));
    game.render(task, panel, ctx);
    const ref = deps.polska.ref(task.id);
    bus.emit('polska:focus', { id: task.id, obj: ref?.obj ?? null, label: deps.polska.unit(task.id)?.pl ?? '' });
    setFocus(0);
    root.classList.toggle('kb', kbNav);
    requestAnimationFrame(reportHeight);
  };

  const advance = (): void => {
    clearTimers();
    if (!open || !game) return;
    if (only && answered) return api.stop();
    if (!only && round.count >= limit) return showSummary();
    render();
  };

  /** Экран выбора перед раундом (игры с `hub`): игра рисует его сама и зовёт `begin`. */
  const showHub = (): void => {
    clearTimers();
    hubOn = true;
    focus = undefined;
    limit = ROUND_SIZE;
    answered = false;
    summaryOpen = false;
    task = null;
    focusIdx = -1;
    paper.classList.remove('ok', 'bad');
    paper.replaceChildren();
    foot.replaceChildren();
    fb.hidden = true;
    fb.replaceChildren();
    box.style.removeProperty('height');
    if (!game?.hub) return;
    const ctx = ctxOf(game);
    deps.polska.autoPlant(game.id, game.pool(ctx));
    paintRound();
    game.hub(panel, ctx, begin);
    setFocus(0);
    root.classList.toggle('kb', kbNav);
    bus.emit('polska:focus', { id: null, obj: null, label: '' });
    requestAnimationFrame(reportHeight);
  };

  /** Раунд из `size` заданий про одну единицу (её досаживаем, если ещё не растёт). */
  const begin = (id: string, size: number): void => {
    if (!open || !game || !hubOn) return;
    deps.polska.plant([id]);
    hubOn = false;
    focus = id;
    limit = Math.max(1, Math.trunc(size));
    if (round.count > 0) roundN++;
    round.reset();
    scaleFrom = scaleTo = null;
    recent.length = 0;
    render();
  };

  const showSummary = (): void => {
    clearTimers();
    summaryOpen = true;
    answered = true;
    task = null;
    box.style.removeProperty('height');
    paper.classList.remove('ok', 'bad');
    fb.hidden = true;
    const card = renderRoundSummary(roundN, round.stats);
    const s = deps.polska.scale();
    const grow = scaleFrom !== null && scaleTo ? growthText(scaleTo.pos - scaleFrom) : '';
    card.append(el('div', { class: 'way2', 'data-round-polska': '' }, `Wiedza o Polsce: ${s.pl} · ${s.sub}/${s.of}`, grow ? ' · ' : '', grow ? el('b', {}, grow) : null));
    // Карта и календарь закрывают мир: рост участка виден отложенно — строка «В саду подросло: N · Na pole!».
    const grew = round.stats.grew + round.stats.harvested;
    if (game && game.layout === 'full' && grew > 0 && grownObjs.length) {
      // «Na pole!»: закрыть игру, герой сам идёт в Zagroda и обходит подросшее.
      card.append(el('button', { type: 'button', class: 'pq-btn way2 go', 'data-nav': '', 'data-round-plot': '', onclick: () => api.stop(true) }, `${PLOT_NAME[game.plot].ru}: подросло ${grew} · `, el('b', {}, 'Na pole! →')));
    } else if (game && game.layout === 'full' && grew > 0) card.append(el('div', { class: 'way2', 'data-round-plot': '' }, `${PLOT_NAME[game.plot].ru}: подросло ${grew}`));
    const line = game?.summaryLine?.(ctxOf(game));
    if (line) {
      const lineSay = polishPart(line);
      card.append(el('div', { class: 'way2 pq-fbrow', 'data-round-line': '' }, el('span', {}, line), lineSay ? sayButton(lineSay, panel.say, { inline: true }) : null));
    }
    paper.replaceChildren(card);
    const more = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-more': '', onclick: () => nextRound() }, game?.hub ? 'К колесу' : 'Ещё раунд');
    // «Wróć»: выйти и мгновенно вернуться к месту, откуда запустил игру (`systems/entryPoint.ts`); в фокусе по умолчанию.
    const end = el('button', { type: 'button', class: 'pq-btn pq-back', 'data-nav': '', 'data-end': '', 'data-back-entry': '', onclick: () => api.stop() }, '↩ Wróć · Назад');
    foot.replaceChildren(end, more);
    summaryAt = performance.now();
    paintRound();
    setFocus(navs().indexOf(end));
    bus.emit('polska:focus', { id: null, obj: null, label: '' });
    requestAnimationFrame(reportHeight);
  };

  const nextRound = (): void => {
    if (!open || !summaryOpen) return;
    if (game?.hub) return showHub();
    round.reset();
    roundN++;
    scaleFrom = scaleTo = null;
    render();
  };

  const offIntent = bus.on('input:intent', (i) => {
    if (!open || i.to !== 'ui') return;
    switch (i.type) {
      case 'cancel':
        if (i.source !== 'pointer') api.stop();
        return;
      case 'hotkey': {
        if (summaryOpen) {
          if (i.n === 1) nextRound();
          else if (i.n === 2) api.stop();
          return;
        }
        if (answered) return;
        const opts = [...paper.querySelectorAll<HTMLButtonElement>('[data-opt]')].filter((b) => !b.disabled);
        opts[i.n - 1]?.click();
        return;
      }
      case 'say':
        sayFocused(root, kbNav ? (navs()[focusIdx] ?? null) : null);
        return;
      case 'move':
        if (!i.held) return;
        kbNav = true;
        root.classList.add('kb');
        setFocus(focusIdx + (i.dir === 'left' || i.dir === 'up' ? -1 : 1));
        return;
      case 'interact':
        if (answered && !summaryOpen) {
          if (nextReady) advance();
          return;
        }
        if (!kbNav) {
          kbNav = true;
          root.classList.add('kb');
          setFocus(Math.max(0, focusIdx));
          return;
        }
        if (summaryOpen && performance.now() - summaryAt < SUMMARY_GUARD_MS) return;
        navs()[focusIdx]?.click();
        return;
      default:
        return;
    }
  });
  void offIntent;

  const api: PolskaGameUi = {
    root,
    start(id, onlyId) {
      const g = byId.get(id);
      if (!g) return;
      const fresh = !open || game?.id !== id;
      game = g;
      only = onlyId;
      if (fresh) {
        round.reset();
        roundN = 1;
        scaleFrom = scaleTo = null;
        recent.length = 0;
        grownObjs = [];
        focus = undefined;
        limit = ROUND_SIZE;
        hubOn = false;
      }
      title.replaceChildren(el('span', {}, g.title.ru), el('small', {}, g.title.pl));
      root.classList.toggle('full', g.layout === 'full');
      kbNav = false;
      root.classList.remove('kb');
      if (!open) {
        open = true;
        root.hidden = false;
        bus.emit('world:input', { enabled: false });
      }
      bus.emit('polska:auto', { on: true, game: g.id, layout: g.layout, plot: g.plot });
      if (g.hub && !onlyId) showHub();
      else render();
    },
    stop(go = false) {
      if (!open) return;
      clearTimers();
      open = false;
      summaryOpen = false;
      root.hidden = true;
      const g = game;
      if (g?.layout === 'full' && grownObjs.length) bus.emit('polska:tour', { plot: g.plot, objs: [...grownObjs], ...(go ? { go: true } : {}) });
      grownObjs = [];
      focus = undefined;
      limit = ROUND_SIZE;
      hubOn = false;
      game = null;
      task = null;
      bus.emit('polska:focus', { id: null, obj: null, label: '' });
      bus.emit('polska:auto', { on: false, game: g?.id ?? null, layout: g?.layout ?? 'panel' });
      bus.emit('farm:auto', { on: false, bottom: 0 });
      bus.emit('world:input', { enabled: true });
    },
    submit(answer) {
      if (!open || !game || !task || answered) return;
      if (answer === undefined || answer === null || (typeof answer === 'string' && !answer.trim()) || (Array.isArray(answer) && answer.length === 0)) return;
      const ctx = ctxOf(game);
      const r = game.check(task, answer, ctx);
      const out = deps.polska.answer({ id: task.id, side: task.side, ...(task.self ? { self: true } : {}) }, r.ok);
      answered = true;
      if (scaleFrom === null) scaleFrom = out.scale.from;
      scaleTo = { pos: out.scale.to, sub: out.scale.sub, pl: out.scale.pl };
      round.add({ ok: r.ok, act: out.act });
      if (game.layout === 'full' && out.obj && (out.act.kind === 'grow' || out.act.kind === 'harvest') && !grownObjs.includes(out.obj)) grownObjs.push(out.obj);
      paintRound();
      paper.classList.add(r.ok ? 'ok' : 'bad');
      const u = deps.polska.unit(task.id);
      // 🔊 у польского ответа: то, что движок и так озвучивает после ответа, можно повторить (у русского — нет, `polishPart`).
      const spoken = polishPart(r.say ?? u?.pl ?? r.correct);
      const bigLine = r.ok ? el('div', { class: 'big' }, `✓ ${u?.pl ?? r.correct}`) : el('div', { class: 'big' }, el('span', { class: 'lbl' }, 'Правильно:'), r.correct);
      fb.replaceChildren(
        spoken ? el('div', { class: 'pq-fbrow' }, bigLine, sayButton(spoken, panel.say, { inline: true })) : bigLine,
        el('div', { class: 'sub' }, [u?.ru, u?.tr].filter(Boolean).join(' · ')),
        el('div', { class: 'pq-progress', 'data-progress-after': '' }, `🌱 ${out.progress.charAt(0).toUpperCase()}${out.progress.slice(1)}`),
      );
      if (r.note) {
        // Польская часть заметки (дата словами, старые слова гимна) читается кнопкой; русский пояснительный текст — нет.
        const noteSay = polishPart(r.note);
        const noteEl = el('div', { class: 'note', 'data-note': '' }, r.note);
        fb.append(noteSay ? el('div', { class: 'pq-fbrow' }, noteEl, sayButton(noteSay, panel.say, { inline: true })) : noteEl);
      }
      fb.dataset.feedback = r.ok ? 'ok' : 'bad';
      fb.hidden = false;
      // Озвучка после ответа (верного и неверного): название или фраза по-польски.
      deps.say(r.say ?? u?.pl ?? r.correct);
      for (const b of paper.querySelectorAll<HTMLButtonElement>('button:not(.pq-say)')) b.disabled = true;
      nextReady = false;
      const dalej = el('button', { type: 'button', class: 'pq-btn wait', 'data-nav': '', 'data-next': '', onclick: () => nextReady && advance() }, 'Dalej · Следующий →');
      armTimer = setTimeout(() => {
        armTimer = null;
        nextReady = true;
        dalej.classList.remove('wait');
      }, NEXT_DELAY_MS);
      foot.replaceChildren(dalej);
      setFocus(navs().indexOf(dalej));
      requestAnimationFrame(reportHeight);
    },
    get isOpen() {
      return open;
    },
    get game() {
      return game?.id ?? null;
    },
    get task() {
      return task;
    },
  };
  return api;
}
