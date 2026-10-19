// Мини-игра (ФЕРМА.md, решения 9–10): панель вопроса снизу, как диалог Stardew; мир сверху виден, герой бегает сам.
// Поток идёт раундами по 10 заданий (V11a, `ui/roundSummary.ts`): шапка «3 / 10», после 10-го итог раунда с «Ещё раунд» / «Закончить»,
// число раундов не ограничено. Следующее задание даёт `deps.next`. Выход в любой момент: Esc, B, «Выйти». Тап по карте игру не
// закрывает (это не «мимо оверлея»: мир виден специально). Верно — зелёный и озвучка, дальше само; ошибка — правильный
// ответ, перевод, транскрипция и «Dalej».
import { bus as globalBus, type Bus } from '../systems/bus';
import type { Question, SpellQuestion } from '../systems/quiz';
import type { BusEvents } from '../types/bus';
import type { GameMode, Side } from '../types/farm';
import { el } from './dom';
import { MODE_NAME } from './glossary';
import { Round, renderRoundSummary, roundCss, ROUND_SIZE } from './roundSummary';
import { polishPart, sayButton, sayFocused, SAY_CSS, withSay, type SayFn } from './sayButton';
import { renderSpell, spellFeedback, SPELL_CSS, type SpellView } from './spell';
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
  /** Действие героя по ответу (для итога раунда: полито, выросло, собрано, опыт). */
  act?: { kind: 'water' | 'grow' | 'harvest' | 'miss'; xp: number };
  /** Путь к A1 до и после ответа (позиция в уровнях) и звание после ответа — для строки итога раунда. */
  path?: { from: number; to: number; sub: number; pl: string };
}

export interface MinigameDeps {
  bus?: Bus<BusEvents>;
  /** Следующее задание (null — спрашивать нечего). `only` — одно задание по этому растению; `dir` — сторона игры 5. */
  next(mode: GameMode, only?: string, opts?: { dir?: Side }): Question | null;
  answer(q: Question, given: string | readonly string[]): AnswerResult;
  say(id: string): void;
  /** Мини-игра закрылась. */
  onExit?(): void;
  /** Сенсорный экран (игра 5: польскую печать ведёт экранная клавиатура, системная спрятана). По умолчанию `pointer: coarse`. */
  coarse?: boolean;
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
${roundCss}
${SAY_CSS}
${SPELL_CSS}
.pq-game { position: fixed; left: 0; right: 0; bottom: 0; z-index: 55; display: flex; justify-content: center; pointer-events: none;
  padding: 0 calc(env(safe-area-inset-right) + 8px) calc(env(safe-area-inset-bottom) + 8px) calc(env(safe-area-inset-left) + 8px);
  font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink); hyphens: none; -webkit-hyphens: none; }
/* P4a (B4): ни заголовок, ни слова в панели не рвутся по слогам. */
.pq-game * { hyphens: none; -webkit-hyphens: none; }
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
.pq-game-foot .pq-btn[data-next] { font-size: 18px; font-weight: 800; padding-top: 12px; padding-bottom: 12px; }
.pq-game-foot .pq-btn.pq-back { flex: 1.3 1 0; background: #f2d552; white-space: nowrap; padding-left: 6px; padding-right: 6px; }
.pq-game-paper.ok { background: #d6efc0; }
.pq-game-paper.bad { background: #f6d7cc; }
.pq-q { font-size: 24px; font-weight: 800; margin: 0 0 4px; overflow-wrap: break-word; }
.pq-q-hint { font-size: 13px; opacity: .7; margin-bottom: 8px; }
.pq-progress { font-size: 13px; margin: -4px 0 8px; color: #4a6b2a; font-weight: 600; }
.pq-fb .pq-progress { margin: 4px 0 0; }
.pq-rev { font-size: 12px; font-weight: 700; background: var(--pq-cream); color: var(--pq-ink); border-radius: 6px; padding: 1px 6px; }
.pq-roundno { flex: 0 0 auto; font-size: 13px; font-weight: 800; background: var(--pq-wood-dark); border: 1px solid var(--pq-cream); border-radius: 6px; padding: 1px 7px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pq-roundno[hidden] { display: none; }
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
.pq-game .pq-opt.long .t { font-size: 15px; }
.pq-game .pq-opt.xlong .t { font-size: 13px; }
.pq-game .pq-opt.xxlong .t { font-size: 11px; overflow-wrap: anywhere; }
.pq-game .pq-opt.right { background: #8cc66a; }
.pq-game .pq-opt.wrong { background: #e88e7c; }
.pq-built { min-height: 44px; display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; border: 2px dashed var(--pq-wood); border-radius: 6px; margin-bottom: 8px; background: #fffaf0; }
.pq-pool { display: flex; flex-wrap: wrap; gap: 6px; }
.pq-game .pq-tile { color: var(--pq-ink); background: #f2dcae; font-size: 17px; padding: 8px 10px; }
.pq-game .pq-tile[disabled] { opacity: .25; }
.pq-dir { flex: 0 0 auto; font-size: 13px !important; padding: 5px 8px !important; }
.pq-dir[aria-pressed='true'] { background: #f2d552; color: var(--pq-ink); }
.pq-dir[hidden] { display: none; }
.pq-type { width: 100%; box-sizing: border-box; font-size: 20px; padding: 8px 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #fffaf0; color: var(--pq-ink); }
.pq-fb { margin-top: 8px; font-size: 15px; }
.pq-fb .big { font-size: 20px; font-weight: 800; }
.pq-game.kb .is-focus, .pq-game :focus-visible { outline: 3px solid var(--pq-accent); outline-offset: 1px; }
/* F5a: после ответа лист не прокручивается, результат стоит на месте вопроса (в блоке той же высоты). */
.pq-game-paper.fit { overflow: hidden; }
.pq-qblock .pq-fb, .pq-pool .pq-fb { margin: 0; width: 100%; }
.pq-fb .big { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: break-word; line-height: 1.15; }
.pq-fb .big .lbl { font-size: 13px; font-weight: 600; opacity: .75; margin-right: 4px; }
.pq-fb .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pq-qblock .pq-fb .pq-progress { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pq-fb .tmr { display: none; font-size: 13px; font-weight: 600; color: #4a6b2a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pq-game-title .short { display: none; }
@media (max-width: 520px) {
  /* Узко: шапка в одну строку. Приоритет метке «наоборот», название сокращено, «созреет завтра» уходит в блок результата, «Выйти» — крестик. */
  .pq-game-title .full, .pq-game-title small { display: none; }
  .pq-game-title .short { display: inline; }
  .pq-soon { display: none; }
  .pq-fb .tmr { display: block; }
  .pq-exit-lbl { display: none; }
  .pq-game-head .pq-btn.pq-exit { min-width: 40px; }
  .pq-fb .big { font-size: 17px; }
  .pq-fb { font-size: 14px; } .pq-q { font-size: 20px; } .pq-qblock { height: 92px; } .pq-opts { grid-auto-rows: 64px; } .pq-game .pq-opt { padding: 6px 7px; font-size: 15px; } .pq-game-paper { padding: 8px; }
  .pq-game .pq-opt .n { min-width: 12px; }
  .pq-game .pq-opt.long .t { font-size: 14px; } .pq-game .pq-opt.xlong .t { font-size: 12px; } .pq-game .pq-opt.xxlong .t { font-size: 10.5px; }
}
`;

/**
 * Кегль варианта по самому длинному слову (B4: «присаживайтесь» рвалось как «присаживайтес/ь» в двухколонной сетке на iPhone):
 * 9–11 букв — `long`, 12–15 — `xlong`, длиннее — `xxlong` (только там посимвольный перенос).
 */
export function optSizeClass(text: string): '' | ' long' | ' xlong' | ' xxlong' {
  const maxWord = Math.max(...text.split(/\s+/).map((w) => w.length));
  return maxWord > 15 ? ' xxlong' : maxWord > 11 ? ' xlong' : maxWord > 8 ? ' long' : '';
}

/** Короткие названия игр для узкой шапки (F5a): название сокращается, метка «наоборот» остаётся. */
export const MODE_SHORT: Record<GameMode, string> = { 1: 'Слово → перевод', 2: 'Перевод → слово', 3: 'Фраза по-польски', 4: 'Фраза по-русски', 5: 'Собери слово' };

/** Строка прогресса растения с большой буквы. */
const progressLine = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Через сколько после проверки «Dalej» начинает нажиматься. */
export const NEXT_DELAY_MS = 300;

export function mountMinigame(parent: HTMLElement, deps: MinigameDeps): Minigame {
  const bus = deps.bus ?? globalBus;
  /** Озвучка кнопками 🔊 (`ui/sayButton.ts`): тот же `audio:play`, что у плиток; под выключателем звука, на `?mute=1` — консоль. */
  const say: SayFn = (text, slow) => bus.emit('audio:play', { text, ...(slow ? { slow: true } : {}) });
  const title = el('span', { class: 'pq-game-title', 'data-title': '' }, '');
  const rev = el('span', { class: 'pq-rev', 'data-reverse': '', hidden: true, title: 'Задание наоборот: растению нужна другая сторона' }, '↔ наоборот');
  const roundNo = el('span', { class: 'pq-roundno', 'data-round-no': '', title: 'Задание в раунде', hidden: true }, `1 / ${ROUND_SIZE}`);
  const soon = el('span', { class: 'pq-soon', 'data-soon': '', hidden: true }, '');
  // Игра 5: «↔ наоборот» — собирать по-русски (польское слово показано и звучит); нажатый — сторона pr до выхода.
  const dirBtn = el('button', { type: 'button', class: 'pq-btn pq-dir', 'data-dir': '', hidden: true, 'aria-pressed': 'false', title: 'Собирать наоборот: польское слово → русское', onclick: () => toggleDir() }, '↔ наоборот');
  const exitBtn = el('button', { type: 'button', class: 'pq-btn', 'data-exit': '', 'aria-label': 'Выйти', onclick: () => api.stop() }, el('span', { class: 'pq-exit-lbl' }, 'Выйти '), '✕');
  exitBtn.classList.add('pq-exit');
  const paper = el('div', { class: 'pq-game-paper', 'data-game': '' });
  const foot = el('div', { class: 'pq-game-foot', 'data-foot': '' });
  const box = el('div', { class: 'pq-game-box', role: 'dialog', 'aria-label': 'Мини-игра' }, el('div', { class: 'pq-game-head' }, title, roundNo, rev, soon, dirBtn, exitBtn), paper, foot);
  const root = el('div', { class: 'pq-game', hidden: true }, el('style', {}, css), box);
  parent.append(root);

  let open = false;
  let mode: GameMode | null = null;
  let only: string | undefined;
  let q: Question | null = null;
  let answered = false;
  let built: number[] = [];
  /** Игра 5: экран задания, сторона сборки, режим ввода (запоминаются до выхода). */
  let spell: SpellView | null = null;
  let dir: Side = 'rp';
  let typing = false;
  let lastGiven = '';
  const coarse = deps.coarse ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  let focusIdx = -1;
  /** Рамка выбора нужна только тому, кто ходит стрелками; на тапе и до первой стрелки ничего не обведено (F5a). */
  let kbNav = false;
  let nextReady = true;
  /** Раунд: счёт ответов и итог. Раундов за заход сколько угодно. */
  const round = new Round();
  let roundN = 1;
  let summaryOpen = false;
  let summaryAt = 0;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const navs = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-nav]')].filter((n) => !(n as HTMLButtonElement).disabled);
  const setFocus = (i: number): void => {
    // Снимаем рамку со всех, в том числе с уже отключённых вариантов (иначе она оставалась на «1» после ответа).
    for (const n of root.querySelectorAll('.is-focus')) n.classList.remove('is-focus');
    const list = navs();
    if (!list.length) return;
    focusIdx = (i + list.length) % list.length;
    if (kbNav) list[focusIdx]!.classList.add('is-focus');
  };
  /**
   * Стрелки ходят по сетке вариантов 2×2 (`.pq-opts`, 2 колонки): вверх/вниз — через строку, влево/вправо — соседний.
   * Вне сетки (кнопки снизу, итог раунда) — по порядку, как раньше. Первое нажатие без фокуса ставит на первый вариант.
   */
  const OPT_COLS = 2;
  const moveTarget = (dir: 'up' | 'down' | 'left' | 'right'): number => {
    const list = navs();
    if (focusIdx < 0 || focusIdx >= list.length) return 0;
    const back = dir === 'left' || dir === 'up';
    const cur = list[focusIdx]!;
    const grid = cur.closest('.pq-opts');
    if (!grid) return focusIdx + (back ? -1 : 1);
    const cells = list.filter((n) => n.closest('.pq-opts') === grid);
    const k = cells.indexOf(cur);
    const col = k % OPT_COLS;
    let t = k;
    if (dir === 'left') t = col > 0 ? k - 1 : k;
    else if (dir === 'right') t = col < OPT_COLS - 1 && k + 1 < cells.length ? k + 1 : k;
    else if (dir === 'up') t = k - OPT_COLS >= 0 ? k - OPT_COLS : k;
    else t = k + OPT_COLS < cells.length ? k + OPT_COLS : k;
    // Вниз из нижнего ряда сетки — к кнопкам под ней («Выйти», «Dalej»), вверх из них — обратно в сетку.
    if (t === k && dir === 'down') {
      const after = list.findIndex((n, j) => j > list.indexOf(cells[cells.length - 1]!) && !n.closest('.pq-opts'));
      if (after >= 0) return after;
    }
    return list.indexOf(cells[t]!);
  };
  /** «3 / 10»: номер текущего задания; после ответа остаётся тем же. В одиночном повторе растения счётчика нет. */
  const paintRound = (): void => {
    roundNo.hidden = !!only;
    const shown = summaryOpen ? round.count : Math.min(ROUND_SIZE, round.count + (answered ? 0 : 1));
    roundNo.textContent = `${shown} / ${ROUND_SIZE}`;
  };
  const reportHeight = (): void => {
    if (!open) return;
    bus.emit('farm:auto', { on: true, bottom: Math.round(box.getBoundingClientRect().height + 12) });
  };

  const clearTimer = (): void => {
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
    nextReady = true;
  };

  const detachKb = (): void => {
    spell?.detach();
    spell = null;
  };
  const nextQ = (m: GameMode): Question | null => (m === 5 ? deps.next(m, only, { dir }) : deps.next(m, only));

  /** Строка отзыва с 🔊 справа: польское слово или фраза ответа (`r.pl`) всегда по-польски. */
  const fbRow = (line: HTMLElement, pl: string): HTMLElement => (polishPart(pl) ? el('div', { class: 'pq-fbrow' }, line, sayButton(pl, say, { inline: true })) : line);

  const finish = (r: AnswerResult): void => {
    answered = true;
    round.add(r);
    paintRound();
    paper.classList.add(r.ok ? 'ok' : 'bad');
    const fb = el('div', { class: 'pq-fb', 'data-feedback': r.ok ? 'ok' : 'bad' });
    if (r.ok) {
      fb.append(fbRow(el('div', { class: 'big' }, `✓ ${r.pl}`), r.pl), el('div', { class: 'sub' }, `${r.ru} · ${r.tr}`));
      if (r.note) fb.append(el('div', { class: 'pq-muted sub', 'data-note': '' }, r.note));
      if (q) deps.say(q.id);
    } else if (q?.kind === 'spell') {
      // Игра 5: правильное с подсвеченными буквами и собранное с зачёркнутыми; польское слово звучит и после ошибки.
      const [right, mine] = spellFeedback(lastGiven, r.correct);
      fb.append(fbRow(right!, r.pl), mine!, el('div', { class: 'sub' }, `${r.pl} — ${r.ru} · ${r.tr}`));
      deps.say(q.id);
    } else {
      fb.append(fbRow(el('div', { class: 'big' }, el('span', { class: 'lbl' }, 'Правильно:'), r.correct), r.pl), el('div', { class: 'sub' }, `${r.pl} — ${r.ru} · ${r.tr}`));
    }
    if (r.progress) fb.append(el('div', { class: 'pq-progress', 'data-progress-after': '' }, `🌱 ${progressLine(r.progress)}`));
    if (r.tomorrow !== undefined) {
      soon.hidden = r.tomorrow < 1;
      soon.textContent = r.tomorrow > 0 ? `🌾 созреет завтра: ${r.tomorrow}` : '';
      if (r.tomorrow > 0) fb.append(el('div', { class: 'tmr', 'data-tomorrow': '' }, `🌾 Созреет завтра: ${r.tomorrow}`));
    }
    // «Dalej» просыпается через 300 мс: двойной тап по «Sprawdź» не пропускает следующее задание.
    nextReady = false;
    const dalej = el('button', { type: 'button', class: 'pq-btn wait', 'data-nav': '', 'data-next': '', onclick: () => nextReady && advance() }, 'Dalej · Следующий →');
    armTimer = setTimeout(() => {
      armTimer = null;
      nextReady = true;
      dalej.classList.remove('wait');
    }, NEXT_DELAY_MS);
    // F5a: результат встаёт на место вопроса (у сборки — на место набора плиток); блок той же высоты, лист не растёт и не прокручивается.
    const host = paper.querySelector<HTMLElement>('[data-fbhost]') ?? paper.querySelector<HTMLElement>('.pq-qblock') ?? paper.querySelector<HTMLElement>('.pq-pool');
    if (host) {
      host.replaceChildren(fb);
      host.scrollTop = 0;
      paper.classList.add('fit');
    } else paper.append(fb);
    for (const b of box.querySelectorAll<HTMLButtonElement>('.pq-opt, .pq-tile, [data-check], [data-reset], [data-hint], [data-typemode]')) b.disabled = true;
    foot.replaceChildren(dalej);
    detachKb();
    const input = paper.querySelector<HTMLInputElement>('.pq-type');
    if (input) input.disabled = true;
    setFocus(navs().indexOf(dalej));
    dalej.focus({ preventScroll: true });
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
      const sizeCls = optSizeClass(o);
      const b = el('button', { type: 'button', class: `pq-btn pq-opt${sizeCls}`, 'data-nav': '', 'data-opt': o, onclick: () => pick(i) }, el('span', { class: 'n' }, `${i + 1}`), el('span', { class: 't' }, o));
      // Польские варианты (игра 2: вопрос по-русски) — с 🔊 в углу; русские (игра 1) без.
      grid.append(qq.promptLang === 'ru' ? withSay(b, o, say) : b);
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
    // Польский вариант озвучиваем при выборе; верный голосит `finish` (слово целиком), поэтому дважды не говорим.
    if (q.promptLang === 'ru' && o !== q.answer) bus.emit('audio:play', { text: o });
    submit(o);
  };

  const renderSpellQ = (qq: SpellQuestion): void => {
    spell = renderSpell(qq, {
      paper,
      foot,
      coarse,
      typing,
      onTyping: (on) => (typing = on),
      relayout: () => requestAnimationFrame(reportHeight),
      submit: (sq, given) => {
        if (!q || answered || !given.trim()) return;
        lastGiven = given;
        // Задание с пометками экрана (подсказка, ввод) уходит ферме: «сам» решает она.
        q = { ...sq, ...(q.progress ? { progress: q.progress } : {}), ...(q.reverse ? { reverse: true } : {}) };
        finish(deps.answer(q, given));
      },
    });
  };

  /** «↔ наоборот» в игре 5: другая сторона сборки; неотвеченное задание пересобирается в новую сторону. */
  const toggleDir = (): void => {
    if (mode !== 5) return;
    dir = dir === 'rp' ? 'pr' : 'rp';
    paintDir();
    if (open && !answered && !summaryOpen) {
      q = nextQ(5);
      render();
    }
  };
  const paintDir = (): void => {
    dirBtn.hidden = mode !== 5;
    dirBtn.setAttribute('aria-pressed', dir === 'pr' ? 'true' : 'false');
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
      // Польская плитка звучит при тапе (новая прерывает прежнюю); русские плитки (игра 4) молчат.
      if (qq.mode !== 4) bus.emit('audio:play', { text: qq.tiles[i]! });
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
    paper.classList.remove('ok', 'bad', 'fit');
    paper.replaceChildren();
    foot.replaceChildren();
    paper.scrollTop = 0;
    answered = false;
    summaryOpen = false;
    built = [];
    tileAdder = null;
    focusIdx = -1;
    rev.hidden = true;
    paintRound();
    box.classList.toggle('spell', mode === 5);
    if (!q || !mode) {
      box.classList.remove('typing');
      paper.append(
        el('div', { class: 'pq-q' }, 'Пока нечего поливать'),
        el('div', { class: 'pq-q-hint' }, mode === 3 || mode === 4 ? 'Посади фразу в словаре дома.' : mode === 5 && dir === 'pr' ? 'Посади слова в словаре дома или собери по-польски (сними «↔ наоборот»).' : 'Посади слова в словаре дома.'),
      );
      requestAnimationFrame(reportHeight);
      return;
    }
    // Игра 5: сторону показывают кнопка «↔ наоборот» и подсказка под вопросом, отдельная метка не нужна.
    rev.hidden = !q.reverse || q.kind === 'spell';
    const hint: Record<GameMode, string> = {
      1: 'Выбери перевод',
      2: 'Выбери польское слово',
      3: 'Собери фразу по-польски',
      4: 'Собери фразу по-русски',
      5: q.kind === 'spell' && q.dir === 'pr' ? 'Собери перевод по-русски из букв' : 'Собери слово по-польски из букв',
    };
    const qText = el('div', { class: 'pq-q', lang: q.promptLang, 'data-prompt': '' }, q.prompt);
    // Польский вопрос (игры 1 и 4, игра 5 наоборот) — с 🔊 рядом; русский (игры 2, 3, 5) — без.
    const qHead = q.promptLang === 'pl' ? el('div', { class: 'pq-qrow' }, qText, sayButton(q.prompt, say, { main: true })) : qText;
    const qb = el('div', { class: q.kind === 'tiles' ? '' : q.kind === 'spell' ? 'pq-spell-q' : 'pq-qblock', 'data-qblock': '' }, qHead, el('div', { class: 'pq-q-hint' }, hint[q.mode]));
    if (q.progress) qb.append(el('div', { class: 'pq-progress', 'data-progress': '' }, `🌱 ${progressLine(q.progress)}`));
    paper.append(qb);
    if (q.kind === 'choice') renderChoice(q);
    else if (q.kind === 'spell') {
      renderSpellQ(q);
      // PL→RU: польское слово показано и сразу звучит (буквы-плитки молчат).
      if (q.dir === 'pr') bus.emit('audio:play', { text: q.prompt });
    } else renderTiles(q);
    if (q.kind !== 'spell' || !typing) setFocus(0);
    root.classList.toggle('kb', kbNav);
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
    // 10 ответов в раунде: вместо следующего задания итог (одиночный повтор растения раундов не знает).
    if (!only && round.done) {
      showSummary();
      return;
    }
    q = nextQ(mode);
    // Поливать больше нечего, а ответы в раунде уже были: итог раунда вместо пустого «Пока нечего поливать» со счётчиком «10 / 10».
    if (!q && !only && round.count > 0) {
      showSummary('Сегодня в этой игре больше нечего поливать · посади ещё слов в словаре дома');
      return;
    }
    render();
  };

  const showSummary = (note?: string): void => {
    clearTimer();
    detachKb();
    summaryOpen = true;
    answered = true;
    q = null;
    paper.classList.remove('ok', 'bad');
    const card = renderRoundSummary(roundN, round.stats);
    if (note) card.append(el('div', { class: 'pq-sum-note', 'data-sum-note': '', style: 'margin-top:8px;font-size:14px;font-weight:600;text-align:center' }, note));
    paper.replaceChildren(card);
    paper.scrollTop = 0;
    rev.hidden = true;
    const more = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-more': '', onclick: () => nextRound() }, 'Ещё раунд');
    // «Wróć»: выйти и мгновенно вернуться к месту, откуда запустил игру (`systems/entryPoint.ts`); в фокусе по умолчанию.
    const end = el('button', { type: 'button', class: 'pq-btn pq-back', 'data-nav': '', 'data-end': '', 'data-back-entry': '', onclick: () => api.stop() }, '↩ Wróć · Назад');
    foot.replaceChildren(end, more);
    summaryAt = performance.now();
    paintRound();
    setFocus(0);
    end.focus({ preventScroll: true });
    requestAnimationFrame(reportHeight);
  };

  const nextRound = (): void => {
    if (!open || !mode || !summaryOpen) return;
    round.reset();
    roundN++;
    summaryOpen = false;
    q = nextQ(mode);
    render();
  };

  const offIntent = bus.on('input:intent', (i) => {
    if (!open || i.to !== 'ui') return;
    switch (i.type) {
      case 'cancel':
        if (i.source !== 'pointer') api.stop();
        return;
      case 'hotkey':
        if (summaryOpen) {
          if (i.n === 1) nextRound();
          else if (i.n === 2) api.stop();
          return;
        }
        if (answered) return;
        if (q?.kind === 'choice') pick(i.n - 1);
        else if (q?.kind === 'tiles') tileAdder?.(i.n - 1);
        else if (q?.kind === 'spell') spell?.hotkey(i.n);
        return;
      case 'say':
        sayFocused(root, kbNav ? (navs()[focusIdx] ?? null) : null);
        return;
      case 'move':
        if (!i.held) return;
        {
          // Первое нажатие стрелки только показывает рамку там, где фокус (обычно первый вариант), а не сдвигает её.
          const first = !kbNav;
          kbNav = true;
          root.classList.add('kb');
          setFocus(first && focusIdx >= 0 ? focusIdx : moveTarget(i.dir));
        }
        return;
      case 'interact': {
        if (summaryOpen) {
          // Первые 400 мс после итога клавиша действия его не нажимает: не промахнуться по «Wróć» на «Dalej».
          if (performance.now() - summaryAt >= 400) navs()[focusIdx]?.click();
          return;
        }
        if (answered) {
          if (nextReady) advance();
          return;
        }
        // Рамки ещё нет: первое нажатие её показывает, а не отвечает за игрока на «1» (F5a).
        if (!kbNav) {
          kbNav = true;
          root.classList.add('kb');
          setFocus(Math.max(0, focusIdx));
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
      // Раунд начинается при открытии; перезапуск из карточки «Фраз мало» (панель уже открыта) его не сбрасывает.
      if (!open) {
        round.reset();
        roundN = 1;
        summaryOpen = false;
      }
      title.replaceChildren(el('span', { class: 'full' }, MODE_NAME[m].ru), el('small', {}, MODE_NAME[m].pl), el('span', { class: 'short' }, MODE_SHORT[m]));
      // Игра 5 «Повторить» открывает по-польски (ответ «сам» нужен для урожая); с доски — сторона прошлого захода.
      if (onlyId) dir = 'rp';
      paintDir();
      kbNav = false;
      root.classList.remove('kb');
      soon.hidden = true;
      soon.textContent = '';
      if (!open) {
        open = true;
        root.hidden = false;
        bus.emit('world:input', { enabled: false });
      }
      q = nextQ(m);
      render();
    },
    stop() {
      if (!open) return;
      clearTimer();
      detachKb();
      box.classList.remove('spell', 'typing');
      dirBtn.hidden = true;
      typing = false;
      summaryOpen = false;
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
