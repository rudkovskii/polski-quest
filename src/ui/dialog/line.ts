// Окно реплики (ТЗ §5.6): деревянная рамка, портрет, имя на табличке, польская строка печатается
// (тап или Enter — показать целиком), перевод скрыт до тапа (настройка `translations`), ▶ и «медленно».
// Нужен диалогу и шагу `say`. Реплика-заглушка (`todo`) показывается как `[todo: id]`.
import { el } from '../dom';
import { audioButtons, btn, portrait, type AudioPort, type PortraitSource, type Speaker } from '../overlay/kit';

export interface LineOpts {
  speaker: Speaker;
  pl?: string;
  ru?: string;
  /** Реплика ещё не написана: показываем id заглушки. */
  todo?: string;
  audio: AudioPort;
  portraits?: PortraitSource | null;
  translations: 'tap' | 'always';
  /** Мс на букву при печати; 0 — сразу целиком (тесты, reduced motion). */
  typeMs?: number;
  /** Озвучить сразу при показе. */
  autoplay?: boolean;
}

export interface LineView {
  node: HTMLElement;
  portrait: HTMLElement;
  /** Строка ещё печатается. */
  readonly typing: boolean;
  /** Допечатать сразу. true — строка печаталась (нажатие ушло на это). */
  skip(): boolean;
  /** Показать перевод. */
  revealRu(): void;
  dispose(): void;
}

export function todoText(id: string): string {
  return `[todo: ${id}]`;
}

export function lineBox(o: LineOpts): LineView {
  const pic = portrait(o.speaker, o.portraits);
  const plText = o.todo ? todoText(o.todo) : (o.pl ?? '');
  const pl = el('div', { class: `pq-line-pl${o.todo ? ' todo' : ''}`, lang: o.todo ? undefined : 'pl', 'data-role': 'pl' });
  const hasRu = !!o.ru && !o.todo;
  const ru = el('div', { class: 'pq-line-ru', lang: 'ru', 'data-role': 'ru' });
  const showRu = (): void => {
    ru.textContent = o.ru ?? '';
    ru.classList.remove('hidden-ru');
    ruBtn?.remove();
  };
  const ruBtn = hasRu && o.translations === 'tap' ? btn('перевод', () => showRu(), 'icon ghost', { 'data-nav': true, 'data-act': 'ru' }) : null;
  if (hasRu && o.translations === 'always') showRu();
  const canPlay = !!o.pl && !o.todo && o.audio.has(o.pl);
  const tools = el('div', { class: 'pq-line-tools' }, ...(canPlay ? audioButtons(o.audio, o.pl!, o.speaker.id) : []), ruBtn, !canPlay && o.pl && !o.todo ? el('span', { class: 'pq-noaudio' }, '🔇') : null);
  const node = el(
    'div',
    { class: 'pq-wood pq-line' },
    el('div', { class: 'pq-line-who' }, pic, el('div', { class: 'pq-line-name' }, o.speaker.name)),
    el('div', { class: 'pq-line-text' }, pl, ru, tools),
  );

  let shown = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const chars = [...plText];
  const typeMs = o.typeMs ?? 28;
  const render = (): void => {
    pl.textContent = chars.slice(0, shown).join('');
  };
  const tick = (): void => {
    shown = Math.min(chars.length, shown + 1);
    render();
    timer = shown < chars.length ? setTimeout(tick, typeMs) : null;
  };
  if (typeMs <= 0) {
    shown = chars.length;
    render();
  } else tick();
  // Тап по строке = показать целиком.
  pl.addEventListener('click', () => view.skip());
  if (canPlay && o.autoplay) o.audio.play(o.pl!, { who: o.speaker.id });

  const view: LineView = {
    node,
    portrait: pic,
    get typing() {
      return shown < chars.length;
    },
    skip() {
      if (shown >= chars.length) return false;
      if (timer) clearTimeout(timer);
      timer = null;
      shown = chars.length;
      render();
      return true;
    },
    revealRu: showRu,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
  return view;
}
