// attachKeyboard(field, opts): один хелпер подключает экранную клавиатуру к любому
// <input>/<textarea> оверлея. Полоска над полем, QWERTY под полем, физическая
// клавиатура работает параллельно, Alt/Option + a c e l n o s z x → ą ć ę ł ń ó ś ż ź.
// Прямой keydown здесь разрешён (AGENTS.md): это поле ввода, а не мир.
import { ALT_CODES, upper } from './chars';
import { deleteBackward, insertText, type TextField } from './edit';
import { charFor, paint, type KbState, type KeyId } from './keys';
import { createQwerty } from './qwerty';
import { createStrip } from './strip';
import { ensureKeyboardStyle } from './style';

/** Настройка `keyboard.mode`: auto по устройству, strip = только полоска, full = полоска + QWERTY. */
export type KeyboardMode = 'auto' | 'strip' | 'full';

export interface AttachOptions {
  mode?: KeyboardMode;
  /** Enter (экранный или физический) = «Проверить». */
  onEnter?: () => void;
  /** `pointer: coarse` (телефон, планшет). По умолчанию из matchMedia. */
  coarse?: boolean;
  /** Сенсорный экран (iPad, iPhone): первое физическое нажатие сворачивает QWERTY в полоску. */
  touchCapable?: boolean;
  /** Окно двойного нажатия «ąę» для фиксации, мс. */
  doubleTapMs?: number;
  /** Часы для теста двойного нажатия. */
  now?: () => number;
}

export interface AttachedKeyboard {
  strip: HTMLElement;
  qwerty: HTMLElement;
  readonly state: Readonly<KbState>;
  readonly qwertyVisible: boolean;
  setMode(mode: KeyboardMode): void;
  detach(): void;
}

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|CapsLock|Fn)/;

function mediaMatches(q: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(q).matches;
}

export function attachKeyboard(field: TextField, opts: AttachOptions = {}): AttachedKeyboard {
  ensureKeyboardStyle(field.ownerDocument);
  const coarse = opts.coarse ?? mediaMatches('(pointer: coarse)');
  const touchCapable = opts.touchCapable ?? (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  const doubleTapMs = opts.doubleTapMs ?? 400;
  const now = opts.now ?? (() => performance.now());

  let mode: KeyboardMode = opts.mode ?? 'auto';
  /** QWERTY свёрнута первым физическим нажатием (iPad с внешней клавиатурой). */
  let collapsed = false;
  let lastPolishTap = -Infinity;
  const state: KbState = { shift: false, polish: 'off' };

  // Поле для польских ответов: без автозамены и автозаглавных iOS.
  const defaults: Record<string, string> = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', lang: 'pl' };
  for (const [k, v] of Object.entries(defaults)) if (!field.hasAttribute(k)) field.setAttribute(k, v);
  field.classList.add('pq-kb-field');

  const strip = createStrip();
  const qwerty = createQwerty();
  field.before(strip);
  field.after(qwerty);

  const wantsQwerty = (): boolean => !collapsed && (mode === 'full' || (mode === 'auto' && !coarse));
  const layout = (): void => {
    qwerty.hidden = !wantsQwerty();
  };
  const repaint = (): void => {
    paint(strip, state);
    paint(qwerty, state);
  };

  const press = (id: KeyId, physicalShift: boolean): void => {
    if (field.ownerDocument.activeElement !== field) field.focus({ preventScroll: true });
    if (id.startsWith('ch:')) {
      insertText(field, charFor(id.slice(3), state, physicalShift));
      state.shift = false;
      if (state.polish === 'once') state.polish = 'off';
    } else if (id === 'shift') {
      state.shift = !state.shift;
    } else if (id === 'polish') {
      const t = now();
      if (state.polish === 'off') state.polish = 'once';
      else if (state.polish === 'once' && t - lastPolishTap <= doubleTapMs) state.polish = 'lock';
      else state.polish = 'off';
      lastPolishTap = t;
    } else if (id === 'backspace') {
      deleteBackward(field);
    } else if (id === 'space') {
      insertText(field, ' ');
    } else if (id === 'enter') {
      opts.onEnter?.();
    }
    repaint();
  };

  // Буквы полоски уже польские: «ąę» на них не действует, только Shift.
  const pressStrip = (id: KeyId, physicalShift: boolean): void => {
    if (!id.startsWith('ch:')) return press(id, physicalShift);
    if (field.ownerDocument.activeElement !== field) field.focus({ preventScroll: true });
    const ch = id.slice(3);
    insertText(field, state.shift || physicalShift ? upper(ch) : ch);
    state.shift = false;
    repaint();
  };

  /** pointerdown + preventDefault: фокус и курсор остаются в поле, iOS не прячет клавиатуру. */
  const bindContainer = (box: HTMLElement, handler: (id: KeyId, shift: boolean) => void): (() => void) => {
    const keyOf = (e: Event): KeyId | null => {
      const btn = (e.target as Element | null)?.closest?.('[data-key]') as HTMLElement | null;
      return btn && box.contains(btn) ? ((btn.dataset.key ?? null) as KeyId | null) : null;
    };
    const onDown = (e: Event): void => {
      const id = keyOf(e);
      e.preventDefault(); // и по фону контейнера: фокус не уходит из поля
      if (id) handler(id, (e as PointerEvent).shiftKey);
    };
    // Нажатие без указателя (VoiceOver, клавиатура): click с detail = 0.
    const onClick = (e: Event): void => {
      const id = keyOf(e);
      if (id && (e as MouseEvent).detail === 0) handler(id, false);
    };
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('mousedown', preventDefault);
    box.addEventListener('click', onClick);
    return () => {
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('mousedown', preventDefault);
      box.removeEventListener('click', onClick);
    };
  };
  const unbindStrip = bindContainer(strip, pressStrip);
  const unbindQwerty = bindContainer(qwerty, press);

  const onKeyDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (e.isComposing) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const pl = ALT_CODES[e.code];
      if (pl) {
        e.preventDefault();
        insertText(field, e.shiftKey ? upper(pl) : pl);
        return;
      }
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && opts.onEnter && !e.shiftKey) {
      e.preventDefault();
      opts.onEnter();
      return;
    }
    // iPad: pointer: coarse/fine врёт с внешней клавиатурой, первое физическое нажатие решает.
    if (mode === 'auto' && touchCapable && !collapsed && !MODIFIER_CODES.test(e.code) && wantsQwerty()) {
      collapsed = true;
      layout();
    }
  };
  field.addEventListener('keydown', onKeyDown);

  layout();
  repaint();

  return {
    strip,
    qwerty,
    get state() {
      return state;
    },
    get qwertyVisible() {
      return !qwerty.hidden;
    },
    setMode(m) {
      mode = m;
      collapsed = false;
      layout();
    },
    detach() {
      field.removeEventListener('keydown', onKeyDown);
      unbindStrip();
      unbindQwerty();
      strip.remove();
      qwerty.remove();
      field.classList.remove('pq-kb-field');
    },
  };
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
