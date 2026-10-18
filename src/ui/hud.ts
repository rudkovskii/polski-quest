// HUD: полоска опыта-заглушка «A0» в левом углу и кнопка настроек в правом. Опыт приходит событием `hud:xp` (F-03).
import { bus as globalBus, type Bus } from '../systems/bus';
import { goalText, type DayGoal } from '../systems/daygoal';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-hud { position: fixed; left: 0; right: 0; top: 0; pointer-events: none; z-index: 30;
  padding: calc(env(safe-area-inset-top) + 8px) calc(env(safe-area-inset-right) + 10px) 0 calc(env(safe-area-inset-left) + 10px);
  display: flex; justify-content: space-between; align-items: flex-start; }
.pq-hud > * { pointer-events: auto; }
.pq-xp { display: flex; align-items: center; gap: 8px; padding: 5px 10px 5px 6px; background: var(--pq-wood-dark); border: 2px solid var(--pq-ink); border-radius: 8px;
  box-shadow: 0 3px 0 var(--pq-ink); color: var(--pq-cream); font: 700 15px/1 -apple-system, BlinkMacSystemFont, sans-serif; }
.pq-xp-lvl { min-width: 30px; text-align: center; padding: 4px 6px; background: var(--pq-accent); color: var(--pq-ink); border-radius: 4px; }
.pq-xp-col { display: flex; flex-direction: column; gap: 3px; }
.pq-xp-next { font: 600 11px/1 -apple-system, BlinkMacSystemFont, sans-serif; opacity: .85; white-space: nowrap; }
.pq-xp-next:empty { display: none; }
.pq-xp-bar { position: relative; width: 84px; height: 10px; background: #2a1418; border-radius: 3px; overflow: hidden; }
.pq-xp-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--pq-leaf); box-shadow: inset 0 2px 0 rgba(255,255,255,.35); }
.pq-xp { position: relative; }
.pq-xp-gain { position: absolute; left: 100%; top: 4px; margin-left: 6px; color: #f2d552; font: 800 15px/1 -apple-system, sans-serif; text-shadow: 0 2px 0 var(--pq-ink);
  pointer-events: none; animation: pq-gain 1s ease-out forwards; white-space: nowrap; }
@keyframes pq-gain { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-18px); } }
.pq-xp.flash { animation: pq-flash 1.6s ease-out; }
@keyframes pq-flash { 0%, 30%, 60% { background: #f2d552; color: var(--pq-ink); transform: scale(1.12); } 15%, 45%, 100% { background: var(--pq-wood-dark); transform: scale(1); } }
.pq-left { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.pq-goal { max-width: calc(100vw - 80px); padding: 5px 9px; background: var(--pq-wood-dark); border: 2px solid var(--pq-ink); border-radius: 8px; box-shadow: 0 3px 0 var(--pq-ink);
  color: var(--pq-cream); font: 700 12px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; text-align: left; touch-action: manipulation; }
.pq-goal[hidden] { display: none; }
.pq-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
/* Индикатор сохранения (V11a): галочка в углу на секунду после записи; сбой записи — тост с повтором. */
.pq-saved { min-width: 22px; height: 22px; padding: 0 5px; box-sizing: border-box; border-radius: 11px; background: var(--pq-wood-dark); border: 2px solid var(--pq-ink); color: #9be07a;
  font: 800 13px/18px -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; pointer-events: none; opacity: 0; transition: opacity .25s; }
.pq-saved.on { opacity: .95; }
.pq-toast { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top) + 64px); z-index: 85; max-width: min(92vw, 420px); box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--pq-wood-dark); color: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 8px; box-shadow: 0 3px 0 var(--pq-ink); font: 700 14px/1.25 -apple-system, BlinkMacSystemFont, sans-serif; }
.pq-toast.err { background: #8a2f2a; }
.pq-toast[hidden] { display: none; }
.pq-toast button { font: inherit; font-weight: 800; padding: 6px 10px; border: 2px solid var(--pq-ink); border-radius: 6px; background: #f2d552; color: var(--pq-ink); cursor: pointer; white-space: nowrap; }
.pq-gear { width: 44px; height: 44px; padding: 0; font-size: 22px; line-height: 40px; text-align: center; }
`;

/** «1 слово», «2 слова», «5 слов». */
export function wordsRu(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'слов';
  if (b === 1) return 'слово';
  if (b >= 2 && b <= 4) return 'слова';
  return 'слов';
}

export interface Hud {
  root: HTMLElement;
  gear: HTMLButtonElement;
  setXp(level: string, ratio: number, next?: { level: string; words: number } | null, growing?: number): void;
  /** Галочка «сохранено» на 1 с. */
  flashSaved(): void;
  /** Сбой записи: тост «Не сохранилось, повторяю» (true) или убрать (false). */
  setSaveError(on: boolean): void;
  /** Короткий тост с кнопкой (напоминание о копии); сам гаснет через `ms`. */
  toast(text: string, action?: { label: string; run(): void }, ms?: number): void;
  dispose(): void;
}

export interface HudOptions {
  onSettings(): void;
  bus?: Bus<BusEvents>;
  /** Цель дня («Сегодня: полито N · созреет завтра M»); нет — плашки нет. Читается заново на каждый `hud:xp` и при возврате на вкладку. */
  goal?: () => DayGoal | null;
  /** Тап по плашке цели (открыть итог дня). */
  onGoal?: () => void;
}

/** Сколько горит галочка «сохранено», мс. */
export const SAVED_FLASH_MS = 1000;
export const SAVE_ERROR_TEXT = 'Не сохранилось, повторяю';

export function mountHud(parent: HTMLElement, o: HudOptions): Hud {
  const bus = o.bus ?? globalBus;
  const lvl = el('span', { class: 'pq-xp-lvl', 'data-xp-level': '' }, 'A0');
  const fill = el('span', { class: 'pq-xp-fill', style: 'width: 0%' });
  const bar = el('span', { class: 'pq-xp-bar', role: 'progressbar', 'aria-label': 'Опыт', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, fill);
  const nextEl = el('span', { class: 'pq-xp-next', 'data-xp-next': '' });
  const xp = el('div', { class: 'pq-xp' }, lvl, el('span', { class: 'pq-xp-col' }, bar, nextEl));
  const gear = el('button', { type: 'button', class: 'pq-btn pq-gear', 'aria-label': 'Настройки', onclick: () => o.onSettings() }, '⚙');
  const goalEl = el('button', { type: 'button', class: 'pq-goal', 'data-goal': '', hidden: true, onclick: () => o.onGoal?.() });
  const saved = el('span', { class: 'pq-saved', 'data-saved': '', 'aria-hidden': 'true' }, '✓');
  const root = el('div', { class: 'pq-hud' }, el('style', {}, css), el('div', { class: 'pq-left' }, xp, goalEl), el('div', { class: 'pq-right' }, gear, saved));
  parent.append(root);
  const toastEl = el('div', { class: 'pq-toast', role: 'status', 'data-toast': '', hidden: true });
  parent.append(toastEl);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let errOn = false;
  const hideToast = (): void => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    toastEl.hidden = true;
    toastEl.classList.remove('err');
    toastEl.replaceChildren();
  };
  const paintGoal = (): void => {
    const g = o.goal?.() ?? null;
    goalEl.hidden = !g;
    if (g) goalEl.textContent = goalText(g);
  };
  paintGoal();
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') paintGoal();
  };
  document.addEventListener('visibilitychange', onVisible);
  const setXp = (level: string, ratio: number, next?: { level: string; words: number } | null, growing = 0): void => {
    const r = Math.max(0, Math.min(1, ratio));
    lvl.textContent = level;
    // Подсказка у полоски: сколько слов вырастить до следующего подуровня (нет поля — молчим, null — A1 достигнут).
    if (next === undefined) nextEl.textContent = '';
    // «до A0.1: 25 слов · уже растут 11»: полоска идёт по частичному зачёту, а число слов — по выращенным; без второй части два дня «не двигается» (F5b).
    else nextEl.textContent = next ? `до ${next.level}: ${next.words} ${wordsRu(next.words)}${growing > 0 ? ` · уже растут ${growing}` : ''}` : 'A1 достигнут';
    bar.setAttribute('aria-valuetext', nextEl.textContent || `${Math.round(r * 100)}%`);
    fill.style.width = `${Math.round(r * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  };
  const off = bus.on('hud:xp', ({ level, ratio, gain, up, next, growing }) => {
    setXp(level, ratio, next, growing);
    paintGoal();
    if (gain && gain > 0) {
      const g = el('span', { class: 'pq-xp-gain', 'data-xp-gain': '' }, `+${gain}`);
      xp.append(g);
      setTimeout(() => g.remove(), 1000);
    }
    if (up) {
      xp.classList.remove('flash');
      void xp.offsetWidth;
      xp.classList.add('flash');
      xp.title = `Новый уровень: ${level}`;
    }
  });
  return {
    root,
    gear,
    setXp,
    flashSaved() {
      // Пока горит ошибка, галочку не зажигаем: она означала бы обратное.
      if (errOn) return;
      saved.classList.add('on');
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => saved.classList.remove('on'), SAVED_FLASH_MS);
    },
    setSaveError(on) {
      if (on === errOn) return;
      errOn = on;
      if (on) {
        hideToast();
        saved.classList.remove('on');
        toastEl.classList.add('err');
        toastEl.replaceChildren(el('span', {}, SAVE_ERROR_TEXT));
        toastEl.hidden = false;
      } else hideToast();
    },
    toast(text, action, ms = 12_000) {
      if (errOn) return;
      hideToast();
      toastEl.append(el('span', {}, text));
      if (action) {
        toastEl.append(
          el('button', { type: 'button', onclick: () => (hideToast(), action.run()) }, action.label),
          el('button', { type: 'button', 'aria-label': 'Закрыть', onclick: () => hideToast() }, '✕'),
        );
      }
      toastEl.hidden = false;
      toastTimer = setTimeout(hideToast, ms);
    },
    dispose() {
      off();
      if (savedTimer) clearTimeout(savedTimer);
      if (toastTimer) clearTimeout(toastTimer);
      toastEl.remove();
      document.removeEventListener('visibilitychange', onVisible);
      root.remove();
    },
  };
}
