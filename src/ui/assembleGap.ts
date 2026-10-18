// Игры 3 и 4 с одной-двумя фразами на грядках (F5b): фраза, на которую только что ответили, отдыхает несколько заданий,
// а чтобы не крутить её по кругу, панель говорит «Фраз на грядках мало» и предлагает посадить ещё (ближайшую фразу) или выйти.
// Карточка лежит поверх панели мини-игры (там в это время «Пока нечего поливать»), без лимитов и таймеров.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import type { GameMode, PhraseHint } from '../types/farm';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-gap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 56; display: flex; justify-content: center; pointer-events: none;
  padding: 0 calc(env(safe-area-inset-right) + 8px) calc(env(safe-area-inset-bottom) + 8px) calc(env(safe-area-inset-left) + 8px);
  font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--pq-ink); hyphens: none; -webkit-hyphens: none; }
.pq-gap[hidden] { display: none; }
.pq-gap-box { pointer-events: auto; width: min(720px, 100%); box-sizing: border-box; background: var(--pq-wood); border: 3px solid var(--pq-ink); border-radius: 12px;
  box-shadow: 0 4px 0 var(--pq-ink), inset 0 0 0 2px var(--pq-wood-dark); padding: 6px 8px 8px; height: clamp(250px, 56dvh, 400px); max-height: calc(100dvh - 24px); display: flex; flex-direction: column; gap: 8px; }
.pq-gap-paper { flex: 1 1 auto; min-height: 0; overflow-y: auto; background: var(--pq-cream); border: 2px solid var(--pq-ink); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.pq-gap-title { font-size: 22px; font-weight: 800; }
.pq-gap-muted { font-size: 14px; opacity: .75; }
.pq-gap-foot { flex: 0 0 auto; display: flex; gap: 8px; }
.pq-gap-foot .pq-btn { flex: 1 1 auto; }
`;

export interface AssembleGapDeps {
  bus?: Bus<BusEvents>;
  /** `farm.gap`: не null — все фразы сборки на паузе; `hint` — ближайшая фраза, которую можно посадить. */
  gap(mode: GameMode): { hint: PhraseHint | null } | null;
  /** Посадить (id слов или фразы с кнопки). */
  plant(ids: readonly string[]): void;
  /** Начать игру `mode` заново (после посадки). */
  restart(mode: GameMode): void;
  /** Закрыть мини-игру. */
  exit(): void;
}

export interface AssembleGap {
  /** Игра `mode` не дала задания: если причина — пауза фраз, показать карточку. true — показана. */
  check(mode: GameMode): boolean;
  hide(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export function mountAssembleGap(parent: HTMLElement, d: AssembleGapDeps): AssembleGap {
  const bus = d.bus ?? globalBus;
  const paper = el('div', { class: 'pq-gap-paper' });
  const foot = el('div', { class: 'pq-gap-foot' });
  const root = el('div', { class: 'pq-gap', hidden: true, 'data-gap': '' }, el('style', {}, css), el('div', { class: 'pq-gap-box' }, paper, foot));
  parent.append(root);

  const hide = (): void => {
    root.hidden = true;
  };
  const render = (mode: GameMode, hint: PhraseHint | null): void => {
    paper.replaceChildren(el('div', { class: 'pq-gap-title' }, 'Фраз на грядках мало'));
    const btns: HTMLElement[] = [];
    if (hint && hint.toPlant.length) {
      const what = hint.ready ? `«${hint.pl}»` : hint.need.join(', ');
      paper.append(
        el('div', { 'data-gap-text': '' }, hint.ready ? `Посади ещё фраз: «${hint.pl}»` : `Посади ещё фраз: «${hint.pl}» (сначала слова: ${hint.need.join(', ')})`),
        el('div', { class: 'pq-gap-muted' }, hint.ru),
      );
      const ids = hint.toPlant;
      btns.push(
        el(
          'button',
          {
            type: 'button',
            class: 'pq-btn',
            'data-gap-plant': '',
            onclick: () => {
              d.plant(ids);
              hide();
              d.restart(mode);
            },
          },
          hint.ready ? `Посадить ${what}` : `Посадить слова: ${what}`,
        ),
      );
    } else if (hint) {
      paper.append(el('div', { 'data-gap-text': '' }, `Слова фразы «${hint.pl}» ещё растут: поотвечай в играх 1 и 2, и сборка пополнится.`));
    } else paper.append(el('div', { 'data-gap-text': '' }, 'Все фразы для сборки уже посажены.'));
    paper.append(el('div', { class: 'pq-gap-muted' }, 'Ту же фразу подряд не повторяем: она вернётся после нескольких ответов в других играх.'));
    btns.push(el('button', { type: 'button', class: 'pq-btn', 'data-gap-exit': '', onclick: () => (hide(), d.exit()) }, 'Выйти'));
    foot.replaceChildren(...btns);
    root.hidden = false;
    btns[0]?.focus({ preventScroll: true });
  };

  // Мини-игра закрылась (Esc, «Выйти»): карточка уходит вместе с ней.
  const off = bus.on('world:input', ({ enabled }) => {
    if (enabled) hide();
  });
  return {
    check(mode) {
      const g = d.gap(mode);
      if (!g) return false;
      render(mode, g.hint);
      return true;
    },
    hide,
    get isOpen() {
      return !root.hidden;
    },
    dispose() {
      off();
      root.remove();
    },
  };
}
