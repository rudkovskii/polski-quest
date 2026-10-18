// Мини-игра (ФЕРМА.md, решения 9–10): панель вопроса снизу, как диалог Stardew; мир сверху виден, герой бегает сам.
// Поток бесконечный: следующее задание даёт `deps.next`. Выход в любой момент: Esc, B, «Выйти». Тап по карте игру не
// закрывает (это не «мимо оверлея»: мир виден специально). Верно — зелёный и озвучка, дальше само; ошибка — правильный
// ответ, перевод, транскрипция и «Dalej».
import { bus as globalBus, type Bus } from '../systems/bus';
import type { Question } from '../systems/quiz';
import type { BusEvents } from '../types/bus';
import type { GameMode } from '../types/farm';
import { el } from './dom';
import { MODE_NAME } from './glossary';
import { attachKeyboard, type AttachedKeyboard } from './keyboard';
import { THEME_CSS } from './theme';

export interface AnswerResult {
  ok: boolean;
  /** Правильный ответ (как показать). */
  correct: string;
  /** Карточка: польский, русский, транскрипция. */
  pl: string;
  ru: string;
  tr: string;
  /** Пометка мягкого зачёта («без диакритики»). */
  note?: string;
  /** Что осталось растению после ответа («до урожая: ещё 1 день»). */
  progress?: string;
  /** Сколько растений созреет завтра. */
  tomorrow?: number;
}

export interface MinigameDeps {
  bus?: Bus<BusEvents>;
  /** Следующее задание (null — спрашивать нечего). `only` — одно задание по этому растению. */
  next(mode: GameMode, only?: string): Question | null;
  answer(q: Question, given: string | readonly string[]): AnswerResult;
  say(id: string): void;
  /** Мини-игра закрылась. */
  onExit?(): void;
}

export interface Minigame {
  start(mode: GameMode, only?: string): void;
  stop(): void;
  readonly isOpen: boolean;
  readonly mode: GameMode | null;
  readonly question: Question | null;
  root: HTMLElement;
}

const css = `
${THEME_CSS}
.pq-game { position: fixed; left: 0; right: 0; bottom: 0; z-index: 55; display: flex; justify-content: center; pointer-events: none;
  padding: 0 calc(env(safe-area-inset-right) + 8px) calc(env(safe-area-inset-bottom) + 8px) calc(env(safe-area-inset-left) + 8px);
  font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink); }
.pq-game[hidden] { display: none; }
.pq-game-box { pointer-events: auto; width: min(720px, 100%); box-sizing: border-box; background: var(--pq-wood); border: 3px solid var(--pq-ink); border-radius: 12px;
  box-shadow: 0 4px 0 var(--pq-ink), inset 0 0 0 2px var(--pq-wood-dark); padding: 6px 8px 8px; height: clamp(250px, 56dvh, 400px); max-height: calc(100dvh - 24px); display: flex; flex-direction: column; }
.pq-game-head { flex: 0 0 auto; min-height: 38px; flex-wrap: nowrap; display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--pq-cream); padding: 0 2px 6px; font-weight: 700; font-size: 14px; }
.pq-game-head .pq-btn { padding: 6px 10px; font-size: 14px; }
.pq-game-paper { flex: 1 1 auto; min-height: 0; background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 6px; padding: 10px 12px; overflow-y: auto; overflow-x: hidden; transition: background .15s; }
/* Закреплённая полоса действий: «Sprawdź / Dalej» всегда на одном месте и не уходят за край. */
.pq-game-foot { flex: 0 0 auto; display: flex; gap: 8px; align-items: stretch; min-height: 46px; padding-top: 8px; }
.pq-game-foot .pq-btn { flex: 1 1 auto; }
.pq-game-foot .pq-btn.wait { opacity: .5; }
.pq-game-paper.ok { background: #d6efc0; }
.pq-game-paper.bad { background: #f6d7cc; }
.pq-q { font-size: 24px; font-weight: 800; margin: 0 0 4px; overflow-wrap: anywhere; }
.pq-q-hint { font-size: 13px; opacity: .7; margin-bottom: 8px; }
.pq-progress { font-size: 13px; margin: -4px 0 8px; color: #4a6b2a; font-weight: 600; }
.pq-fb .pq-progress { margin: 4px 0 0; }
.pq-rev { font-size: 12px; font-weight: 700; background: var(--pq-cream); color: var(--pq-ink); border-radius: 6px; padding: 1px 6px; }
.pq-soon { margin-left: auto; font-weight: 600; font-size: 13px; opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.pq-rev { white-space: nowrap; flex: 0 0 auto; }
.pq-game-title { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pq-game-head .pq-btn { flex: 0 0 auto; }
.pq-game-title small { font-size: 11px; font-weight: 600; opacity: .7; margin-left: 4px; }
/* Блок вопроса (P3b): высота фиксирована, длинный текст прокручивается, поэтому ряд вариантов и ввод всегда на одном месте. */
.pq-qblock { flex: 0 0 auto; height: 104px; overflow-y: auto; overflow-x: hidden; margin-bottom: 6px; }
.pq-qblock .pq-q { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.pq-qblock .pq-progress { margin: 0; }
/* Ряд вариантов: высота кнопки фиксирована (до 3 строк), длинный ответ переносится внутри кнопки и не двигает остальные. */
.pq-opts { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 74px; gap: 8px; }
.pq-game .pq-opt { display: flex; align-items: center; gap: 4px; box-sizing: border-box; height: 100%; text-align: left; color: var(--pq-ink); background: #fffaf0; font-size: 17px; line-height: 1.15; padding: 8px 10px; overflow: hidden; }
.pq-game .pq-opt .n { flex: 0 0 auto; min-width: 18px; opacity: .5; font-size: 13px; }
.pq-game .pq-opt .t { flex: 1 1 auto; min-width: 0; hyphens: none; word-break: normal; overflow-wrap: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.pq-game .pq-opt.long .t { font-size: 14px; }
.pq-game .pq-opt.xlong .t { font-size: 12px; overflow-wrap: anywhere; }
.pq-game .pq-opt.right { background: #8cc66a; }
.pq-game .pq-opt.wrong { background: #e88e7c; }
.pq-built { min-height: 44px; display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; border: 2px dashed var(--pq-wood); border-radius: 6px; margin-bottom: 8px; background: #fffaf0; }
.pq-pool { display: flex; flex-wrap: wrap; gap: 6px; }
.pq-game .pq-tile { color: var(--pq-ink); background: #f2dcae; font-size: 17px; padding: 8px 10px; }
.pq-game .pq-tile[disabled] { opacity: .25; }
.pq-type { width: 100%; box-sizing: border-box; font-size: 20px; padding: 8px 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #fffaf0; color: var(--pq-ink); }
.pq-fb { margin-top: 8px; font-size: 15px; }
.pq-fb .big { font-size: 20px; font-weight: 800; }
.pq-game .is-focus { outline: 3px solid var(--pq-accent); outline-offset: 1px; }
@media (max-width: 520px) { .pq-q { font-size: 20px; } .pq-qblock { height: 92px; } .pq-opts { grid-auto-rows: 64px; } .pq-game .pq-opt { padding: 6px 7px; font-size: 15px; } .pq-game-paper { padding: 8px; } }
`;

/** Строка прогресса растения с большой буквы. */
const progressLine = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Через сколько после проверки «Dalej» начинает нажиматься. */
export const NEXT_DELAY_MS = 300;

export function mountMinigame(parent: HTMLElement, deps: MinigameDeps): Minigame {
  const bus = deps.bus ?? globalBus;
  const title = el('span', { class: 'pq-game-title', 'data-title': '' }, '');
  const rev = el('span', { class: 'pq-rev', 'data-reverse': '', hidden: true, title: 'Задание наоборот: растению нужна другая сторона' }, '↔ наоборот');
  const soon = el('span', { class: 'pq-soon', 'data-soon': '', hidden: true }, '');
  const exitBtn = el('button', { type: 'button', class: 'pq-btn', 'data-exit': '', onclick: () => api.stop() }, 'Выйти ✕');
  const paper = el('div', { class: 'pq-game-paper', 'data-game': '' });
  const foot = el('div', { class: 'pq-game-foot', 'data-foot': '' });
  const box = el('div', { class: 'pq-game-box', role: 'dialog', 'aria-label': 'Мини-игра' }, el('div', { class: 'pq-game-head' }, title, rev, soon, exitBtn), paper, foot);
  const root = el('div', { class: 'pq-game', hidden: true }, el('style', {}, css), box);
  parent.append(root);

  let open = false;
  let mode: GameMode | null = null;
  let only: string | undefined;
  let q: Question | null = null;
  let answered = false;
  let built: number[] = [];
  let kb: AttachedKeyboard | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focusIdx = -1;
  let nextReady = true;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const navs = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-nav]')].filter((n) => !(n as HTMLButtonElement).disabled);
  const setFocus = (i: number): void => {
    const list = navs();
    for (const n of list) n.classList.remove('is-focus');
    if (!list.length) return;
    focusIdx = (i + list.length) % list.length;
    list[focusIdx]!.classList.add('is-focus');
  };
  const reportHeight = (): void => {
    if (!open) return;
    bus.emit('farm:auto', { on: true, bottom: Math.round(box.getBoundingClientRect().height + 12) });
  };

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
    nextReady = true;
  };

  const detachKb = (): void => {
    kb?.detach();
    kb = null;
  };

  const finish = (r: AnswerResult): void => {
    answered = true;
    paper.classList.add(r.ok ? 'ok' : 'bad');
    const fb = el('div', { class: 'pq-fb', 'data-feedback': r.ok ? 'ok' : 'bad' });
    if (r.ok) {
      fb.append(el('div', { class: 'big' }, `✓ ${r.pl}`), el('div', {}, `${r.ru} · ${r.tr}`));
      if (r.note) fb.append(el('div', { class: 'pq-muted' }, r.note));
      if (q) deps.say(q.id);
    } else {
      fb.append(el('div', {}, 'Правильно:'), el('div', { class: 'big' }, r.correct), el('div', {}, `${r.pl} — ${r.ru}`), el('div', { class: 'pq-muted' }, r.tr));
    }
    if (r.progress) fb.append(el('div', { class: 'pq-progress', 'data-progress-after': '' }, `🌱 ${progressLine(r.progress)}`));
    if (r.tomorrow !== undefined) {
      soon.hidden = r.tomorrow < 1;
      soon.textContent = r.tomorrow > 0 ? `🌾 созреет завтра: ${r.tomorrow}` : '';
    }
    // «Dalej» просыпается через 300 мс: двойной тап по «Sprawdź» не пропускает следующее задание.
    nextReady = false;
    const dalej = el('button', { type: 'button', class: 'pq-btn wait', 'data-nav': '', 'data-next': '', onclick: () => nextReady && advance() }, 'Dalej →');
    armTimer = setTimeout(() => {
      armTimer = null;
      nextReady = true;
      dalej.classList.remove('wait');
    }, NEXT_DELAY_MS);
    paper.append(fb);
    for (const b of box.querySelectorAll<HTMLButtonElement>('.pq-opt, .pq-tile, [data-check], [data-reset]')) b.disabled = true;
    foot.replaceChildren(dalej);
    if (typeof fb.scrollIntoView === 'function') fb.scrollIntoView({ block: 'nearest' });
    detachKb();
    const input = paper.querySelector<HTMLInputElement>('.pq-type');
    if (input) input.disabled = true;
    setFocus(navs().indexOf(dalej));
    dalej.focus({ preventScroll: true });
    if (r.ok) timer = setTimeout(advance, 900);
    requestAnimationFrame(reportHeight);
  };

  const submit = (given: string | readonly string[]): void => {
    if (!q || answered) return;
    // Пустой ответ не отправляем: ни ввод, ни пустая сборка не считаются ошибкой.
    if (typeof given === 'string' ? !given.trim() : given.length === 0) return;
    finish(deps.answer(q, given));
  };

  const renderChoice = (qq: Extract<Question, { kind: 'choice' }>): void => {
    const grid = el('div', { class: 'pq-opts' });
    qq.options.forEach((o, i) => {
      // Слово не рвём по слогам: длинное уменьшаем в кегле, посимвольный перенос только для совсем длинных.
      const maxWord = Math.max(...o.split(/\s+/).map((w) => w.length));
      const sizeCls = maxWord > 15 ? ' xlong' : maxWord > 10 ? ' long' : '';
      const b = el('button', { type: 'button', class: `pq-btn pq-opt${sizeCls}`, 'data-nav': '', 'data-opt': o, onclick: () => pick(i) }, el('span', { class: 'n' }, `${i + 1}`), el('span', { class: 't' }, o));
      grid.append(b);
    });
    paper.append(grid);
  };

  const pick = (i: number): void => {
    if (!q || q.kind !== 'choice' || answered) return;
    const o = q.options[i];
    if (o === undefined) return;
    const btns = [...paper.querySelectorAll<HTMLButtonElement>('.pq-opt')];
    btns[i]?.classList.add(o === q.answer ? 'right' : 'wrong');
    btns.find((b) => b.dataset.opt === q!.answer)?.classList.add('right');
    submit(o);
  };

  const renderType = (): void => {
    const input = el('input', { type: 'text', class: 'pq-type', 'data-type': '', placeholder: 'Напиши по-польски', enterkeyhint: 'done' });
    const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', disabled: true, onclick: () => submit(input.value) }, 'Sprawdź · Проверить');
    input.addEventListener('input', () => {
      check.disabled = !input.value.trim();
    });
    paper.append(input);
    foot.replaceChildren(check);
    kb = attachKeyboard(input, { onEnter: () => submit(input.value) });
    setTimeout(() => input.focus({ preventScroll: true }), 30);
  };

  const renderTiles = (qq: Extract<Question, { kind: 'tiles' }>): void => {
    let checkBtn: HTMLButtonElement | null = null;
    const row = el('div', { class: 'pq-built', 'data-built': '' });
    const pool = el('div', { class: 'pq-pool' });
    const paint = (): void => {
      row.replaceChildren(...built.map((ti, k) => el('button', { type: 'button', class: 'pq-btn pq-tile', 'data-nav': '', onclick: () => ((built = built.filter((_, j) => j !== k)), paint()) }, qq.tiles[ti]!)));
      pool.replaceChildren(
        ...qq.tiles.map((t, i) => el('button', { type: 'button', class: 'pq-btn pq-tile', 'data-nav': '', 'data-tile': t, disabled: built.includes(i), onclick: () => addTile(i) }, t)),
      );
      if (checkBtn) checkBtn.disabled = built.length === 0;
      requestAnimationFrame(reportHeight);
    };
    const addTile = (i: number): void => {
      if (answered || built.includes(i)) return;
      built.push(i);
      paint();
    };
    tileAdder = addTile;
    const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', onclick: () => submit(built.map((i) => qq.tiles[i]!)) }, 'Sprawdź · Проверить');
    checkBtn = check;
    const reset = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-reset': '', onclick: () => ((built = []), paint()) }, 'Сбросить');
    paper.append(row, pool);
    foot.replaceChildren(reset, check);
    paint();
  };
  let tileAdder: ((i: number) => void) | null = null;

  const render = (): void => {
    clearTimer();
    detachKb();
    paper.classList.remove('ok', 'bad');
    paper.replaceChildren();
    foot.replaceChildren();
    paper.scrollTop = 0;
    answered = false;
    built = [];
    tileAdder = null;
    focusIdx = -1;
    rev.hidden = true;
    if (!q || !mode) {
      paper.append(el('div', { class: 'pq-q' }, 'Пока нечего поливать'), el('div', { class: 'pq-q-hint' }, mode && mode >= 3 ? 'Посади фразу в словаре дома.' : 'Посади слова в словаре дома.'));
      requestAnimationFrame(reportHeight);
      return;
    }
    rev.hidden = !q.reverse;
    const hint: Record<GameMode, string> = {
      1: 'Выбери перевод',
      2: q.kind === 'type' ? 'Напиши по-польски (кустик: уже без подсказок)' : 'Выбери польское слово',
      3: 'Собери фразу по-польски',
      4: 'Собери фразу по-русски',
    };
    const qb = el('div', { class: q.kind === 'tiles' ? '' : 'pq-qblock', 'data-qblock': '' }, el('div', { class: 'pq-q', lang: q.promptLang, 'data-prompt': '' }, q.prompt), el('div', { class: 'pq-q-hint' }, hint[q.mode]));
    if (q.progress) qb.append(el('div', { class: 'pq-progress', 'data-progress': '' }, `🌱 ${progressLine(q.progress)}`));
    paper.append(qb);
    if (q.kind === 'choice') renderChoice(q);
    else if (q.kind === 'type') renderType();
    else renderTiles(q);
    if (q.kind !== 'type') setFocus(0);
    reportHeight();
    requestAnimationFrame(reportHeight);
  };

  const advance = (): void => {
    clearTimer();
    if (!open || !mode) return;
    if (only && answered) {
      api.stop();
      return;
    }
    q = deps.next(mode, only);
    render();
  };

  const offIntent = bus.on('input:intent', (i) => {
    if (!open || i.to !== 'ui') return;
    switch (i.type) {
      case 'cancel':
        if (i.source !== 'pointer') api.stop();
        return;
      case 'hotkey':
        if (answered) return;
        if (q?.kind === 'choice') pick(i.n - 1);
        else if (q?.kind === 'tiles') tileAdder?.(i.n - 1);
        return;
      case 'move':
        if (!i.held) return;
        setFocus(focusIdx + (i.dir === 'left' || i.dir === 'up' ? -1 : 1));
        return;
      case 'interact': {
        if (answered) {
          if (nextReady) advance();
          return;
        }
        navs()[focusIdx]?.click();
        return;
      }
      default:
        return;
    }
  });
  void offIntent;

  const api: Minigame = {
    root,
    start(m, onlyId) {
      mode = m;
      only = onlyId;
      title.replaceChildren(MODE_NAME[m].ru, el('small', {}, MODE_NAME[m].pl));
      soon.hidden = true;
      soon.textContent = '';
      if (!open) {
        open = true;
        root.hidden = false;
        bus.emit('world:input', { enabled: false });
      }
      q = deps.next(m, onlyId);
      render();
    },
    stop() {
      if (!open) return;
      clearTimer();
      detachKb();
      open = false;
      root.hidden = true;
      q = null;
      mode = null;
      bus.emit('farm:auto', { on: false, bottom: 0 });
      bus.emit('world:input', { enabled: true });
      deps.onExit?.();
    },
    get isOpen() {
      return open;
    },
    get mode() {
      return mode;
    },
    get question() {
      return q;
    },
  };
  return api;
}
