// Мини-игра (ФЕРМА.md, решения 9–10): панель вопроса снизу, как диалог Stardew; мир сверху виден, герой бегает сам.
// Поток бесконечный: следующее задание даёт `deps.next`. Выход в любой момент: Esc, B, «Выйти». Тап по карте игру не
// закрывает (это не «мимо оверлея»: мир виден специально). Верно — зелёный и озвучка, дальше само; ошибка — правильный
// ответ, перевод, транскрипция и «Dalej».
import { bus as globalBus, type Bus } from '../systems/bus';
import type { Question } from '../systems/quiz';
import type { BusEvents } from '../types/bus';
import type { GameMode } from '../types/farm';
import { el } from './dom';
import { attachKeyboard, type AttachedKeyboard } from './keyboard';
import { THEME_CSS } from './theme';

export const MODE_TITLE: Record<GameMode, string> = {
  1: 'Polski → Rosyjski',
  2: 'Rosyjski → Polski',
  3: 'Złóż zdanie po polsku',
  4: 'Złóż zdanie po rosyjsku',
};

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
  box-shadow: 0 4px 0 var(--pq-ink), inset 0 0 0 2px var(--pq-wood-dark); padding: 6px 8px 8px; max-height: 62dvh; display: flex; flex-direction: column; }
.pq-game-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--pq-cream); padding: 0 2px 6px; font-weight: 700; font-size: 14px; }
.pq-game-head .pq-btn { padding: 6px 10px; font-size: 14px; }
.pq-game-paper { background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 6px; padding: 10px 12px; overflow-y: auto; transition: background .15s; }
.pq-game-paper.ok { background: #d6efc0; }
.pq-game-paper.bad { background: #f6d7cc; }
.pq-q { font-size: 24px; font-weight: 800; margin: 0 0 4px; overflow-wrap: anywhere; }
.pq-q-hint { font-size: 13px; opacity: .7; margin-bottom: 8px; }
.pq-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pq-game .pq-opt { text-align: left; color: var(--pq-ink); background: #fffaf0; font-size: 17px; line-height: 1.2; padding: 10px; min-height: 48px; overflow-wrap: anywhere; }
.pq-game .pq-opt .n { display: inline-block; min-width: 18px; opacity: .5; font-size: 13px; }
.pq-game .pq-opt.right { background: #8cc66a; }
.pq-game .pq-opt.wrong { background: #e88e7c; }
.pq-built { min-height: 44px; display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; border: 2px dashed var(--pq-wood); border-radius: 6px; margin-bottom: 8px; background: #fffaf0; }
.pq-pool { display: flex; flex-wrap: wrap; gap: 6px; }
.pq-game .pq-tile { color: var(--pq-ink); background: #f2dcae; font-size: 17px; padding: 8px 10px; }
.pq-game .pq-tile[disabled] { opacity: .25; }
.pq-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.pq-row .pq-btn { flex: 1 1 auto; }
.pq-type { width: 100%; box-sizing: border-box; font-size: 20px; padding: 8px 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #fffaf0; color: var(--pq-ink); }
.pq-fb { margin-top: 8px; font-size: 15px; }
.pq-fb .big { font-size: 20px; font-weight: 800; }
.pq-game .is-focus { outline: 3px solid var(--pq-accent); outline-offset: 1px; }
@media (max-width: 520px) { .pq-q { font-size: 20px; } .pq-game .pq-opt { min-height: 40px; padding: 7px; font-size: 15px; } .pq-game-paper { padding: 8px; } }
`;

export function mountMinigame(parent: HTMLElement, deps: MinigameDeps): Minigame {
  const bus = deps.bus ?? globalBus;
  const title = el('span', {}, '');
  const exitBtn = el('button', { type: 'button', class: 'pq-btn', 'data-exit': '', onclick: () => api.stop() }, 'Выйти ✕');
  const paper = el('div', { class: 'pq-game-paper', 'data-game': '' });
  const box = el('div', { class: 'pq-game-box', role: 'dialog', 'aria-label': 'Мини-игра' }, el('div', { class: 'pq-game-head' }, title, exitBtn), paper);
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
    const dalej = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-next': '', onclick: () => advance() }, 'Dalej →');
    fb.append(el('div', { class: 'pq-row' }, dalej));
    paper.append(fb);
    for (const b of paper.querySelectorAll<HTMLButtonElement>('.pq-opt, .pq-tile, [data-check], [data-reset]')) b.disabled = true;
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
    finish(deps.answer(q, given));
  };

  const renderChoice = (qq: Extract<Question, { kind: 'choice' }>): void => {
    const grid = el('div', { class: 'pq-opts' });
    qq.options.forEach((o, i) => {
      const b = el('button', { type: 'button', class: 'pq-btn pq-opt', 'data-nav': '', 'data-opt': o, onclick: () => pick(i) }, el('span', { class: 'n' }, `${i + 1}`), ` ${o}`);
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
    const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', onclick: () => submit(input.value) }, 'Sprawdź · Проверить');
    paper.append(input, el('div', { class: 'pq-row' }, check));
    kb = attachKeyboard(input, { onEnter: () => submit(input.value) });
    setTimeout(() => input.focus({ preventScroll: true }), 30);
  };

  const renderTiles = (qq: Extract<Question, { kind: 'tiles' }>): void => {
    const row = el('div', { class: 'pq-built', 'data-built': '' });
    const pool = el('div', { class: 'pq-pool' });
    const paint = (): void => {
      row.replaceChildren(...built.map((ti, k) => el('button', { type: 'button', class: 'pq-btn pq-tile', 'data-nav': '', onclick: () => ((built = built.filter((_, j) => j !== k)), paint()) }, qq.tiles[ti]!)));
      pool.replaceChildren(
        ...qq.tiles.map((t, i) => el('button', { type: 'button', class: 'pq-btn pq-tile', 'data-nav': '', 'data-tile': t, disabled: built.includes(i), onclick: () => addTile(i) }, t)),
      );
      requestAnimationFrame(reportHeight);
    };
    const addTile = (i: number): void => {
      if (answered || built.includes(i)) return;
      built.push(i);
      paint();
    };
    tileAdder = addTile;
    const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', onclick: () => submit(built.map((i) => qq.tiles[i]!)) }, 'Sprawdź · Проверить');
    const reset = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-reset': '', onclick: () => ((built = []), paint()) }, 'Сбросить');
    paper.append(row, pool, el('div', { class: 'pq-row' }, reset, check));
    paint();
  };
  let tileAdder: ((i: number) => void) | null = null;

  const render = (): void => {
    clearTimer();
    detachKb();
    paper.classList.remove('ok', 'bad');
    paper.replaceChildren();
    answered = false;
    built = [];
    tileAdder = null;
    focusIdx = -1;
    if (!q || !mode) {
      paper.append(el('div', { class: 'pq-q' }, 'Пока нечего поливать'), el('div', { class: 'pq-q-hint' }, mode && mode >= 3 ? 'Посади фразу в словаре дома.' : 'Посади слова в словаре дома.'));
      requestAnimationFrame(reportHeight);
      return;
    }
    const hint: Record<GameMode, string> = {
      1: 'Выбери перевод',
      2: q.kind === 'type' ? 'Напиши по-польски (куст: уже без подсказок)' : 'Выбери польское слово',
      3: 'Собери фразу по-польски',
      4: 'Собери фразу по-русски',
    };
    paper.append(el('div', { class: 'pq-q', lang: q.promptLang, 'data-prompt': '' }, q.prompt), el('div', { class: 'pq-q-hint' }, hint[mode]));
    if (q.kind === 'choice') renderChoice(q);
    else if (q.kind === 'type') renderType();
    else renderTiles(q);
    if (q.kind !== 'type') setFocus(0);
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
          advance();
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
      title.textContent = MODE_TITLE[m];
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
