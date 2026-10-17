// @vitest-environment happy-dom
// Экранная клавиатура: полоска, QWERTY, «ąę», Alt-сочетания, Shift, фокус.
import { beforeEach, describe, expect, it } from 'vitest';
import { attachKeyboard, type AttachOptions } from '../src/ui/keyboard';

let field: HTMLInputElement;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  field = document.createElement('input');
  field.type = 'text';
  document.body.append(field);
  field.focus();
});

function attach(opts: AttachOptions = {}) {
  return attachKeyboard(field, { coarse: false, touchCapable: false, ...opts });
}

function tap(box: HTMLElement, keyId: string, init: PointerEventInit = {}): PointerEvent {
  const btn = box.querySelector(`[data-key="${keyId}"]`);
  if (!btn) throw new Error(`нет кнопки ${keyId}`);
  const e = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, ...init });
  btn.dispatchEvent(e);
  return e;
}

function keydown(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  field.dispatchEvent(e);
  return e;
}

describe('полоска диакритики', () => {
  it('вставляет ą в позицию курсора', () => {
    const kb = attach();
    field.value = 'mam';
    field.setSelectionRange(1, 1);
    tap(kb.strip, 'ch:ą');
    expect(field.value).toBe('mąam');
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(2);
  });

  it('заменяет выделение', () => {
    const kb = attach();
    field.value = 'dziekuje';
    field.setSelectionRange(7, 8);
    tap(kb.strip, 'ch:ę');
    expect(field.value).toBe('dziekuję');
  });

  it('фокус не теряется: pointerdown гасится, поле остаётся активным', () => {
    const kb = attach();
    const e = tap(kb.strip, 'ch:ż');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it('Shift на полоске → Ą на одно нажатие; физический Shift при тапе тоже', () => {
    const kb = attach();
    tap(kb.strip, 'shift');
    expect(kb.strip.querySelector('[data-key="ch:ą"]')?.textContent).toBe('Ą');
    tap(kb.strip, 'ch:ą');
    tap(kb.strip, 'ch:ą');
    tap(kb.strip, 'ch:ś', { shiftKey: true });
    expect(field.value).toBe('ĄąŚ');
  });

  it('поле получает событие input', () => {
    const kb = attach();
    const seen: string[] = [];
    field.addEventListener('input', () => seen.push(field.value));
    tap(kb.strip, 'ch:ł');
    expect(seen).toEqual(['ł']);
  });

  it('есть все девять букв', () => {
    const kb = attach();
    expect([...kb.strip.querySelectorAll('[data-key^="ch:"]')].map((b) => b.textContent).join('')).toBe('ąćęłńóśźż');
  });
});

describe('QWERTY и «ąę»', () => {
  it('«ąę» действует на одну букву', () => {
    const kb = attach();
    tap(kb.qwerty, 'polish');
    expect(kb.qwerty.querySelector('[data-key="ch:z"]')?.textContent).toBe('ż');
    expect(kb.qwerty.querySelector('[data-key="ch:x"]')?.textContent).toBe('ź');
    tap(kb.qwerty, 'ch:a');
    tap(kb.qwerty, 'ch:a');
    expect(field.value).toBe('ąa');
    expect(kb.state.polish).toBe('off');
  });

  it('двойное нажатие фиксирует, третье снимает', () => {
    let t = 0;
    const kb = attach({ now: () => t });
    tap(kb.qwerty, 'polish');
    t = 200;
    tap(kb.qwerty, 'polish');
    expect(kb.state.polish).toBe('lock');
    for (const c of 'zolc') tap(kb.qwerty, `ch:${c}`);
    tap(kb.qwerty, 'ch:t'); // у t нет польской пары
    t = 2000;
    tap(kb.qwerty, 'polish');
    tap(kb.qwerty, 'ch:o');
    expect(field.value).toBe('żółćto');
    expect(kb.state.polish).toBe('off');
  });

  it('медленное второе нажатие «ąę» выключает режим', () => {
    let t = 0;
    const kb = attach({ now: () => t });
    tap(kb.qwerty, 'polish');
    t = 1000;
    tap(kb.qwerty, 'polish');
    expect(kb.state.polish).toBe('off');
  });

  it('Shift + «ąę» → заглавная польская', () => {
    const kb = attach();
    tap(kb.qwerty, 'shift');
    tap(kb.qwerty, 'polish');
    tap(kb.qwerty, 'ch:l');
    tap(kb.qwerty, 'ch:l');
    expect(field.value).toBe('Łl');
  });

  it('пробел, Backspace, Enter = «Проверить»', () => {
    let checked = 0;
    const kb = attach({ onEnter: () => checked++ });
    field.value = 'tak';
    field.setSelectionRange(3, 3);
    tap(kb.qwerty, 'space');
    tap(kb.qwerty, 'ch:n');
    tap(kb.qwerty, 'backspace');
    tap(kb.qwerty, 'backspace');
    expect(field.value).toBe('tak');
    tap(kb.qwerty, 'enter');
    expect(checked).toBe(1);
  });

  it('Backspace в середине слова стирает символ перед курсором', () => {
    const kb = attach();
    field.value = 'chleeb';
    field.setSelectionRange(4, 4);
    tap(kb.qwerty, 'backspace');
    expect(field.value).toBe('chleb');
    expect(field.selectionStart).toBe(3);
  });

  it('кнопки клавиатуры не забирают фокус и не входят в Tab-порядок', () => {
    const kb = attach();
    tap(kb.qwerty, 'ch:k');
    expect(document.activeElement).toBe(field);
    expect([...kb.qwerty.querySelectorAll('button')].every((b) => b.tabIndex === -1)).toBe(true);
  });
});

describe('физическая клавиатура', () => {
  it('Alt/Option + a c e l n o s z x → ą ć ę ł ń ó ś ż ź', () => {
    attach();
    const e = keydown('KeyA', { altKey: true, key: 'å' });
    expect(e.defaultPrevented).toBe(true);
    for (const code of ['KeyC', 'KeyE', 'KeyL', 'KeyN', 'KeyO', 'KeyS', 'KeyZ', 'KeyX']) keydown(code, { altKey: true });
    expect(field.value).toBe('ąćęłńóśżź');
  });

  it('Alt+Shift → заглавная', () => {
    attach();
    keydown('KeyA', { altKey: true, shiftKey: true });
    keydown('KeyZ', { altKey: true, shiftKey: true });
    expect(field.value).toBe('ĄŻ');
  });

  it('Alt вставляет в позицию курсора; Cmd+Alt и Alt+другая клавиша не трогаются', () => {
    attach();
    field.value = 'gesla';
    field.setSelectionRange(1, 2);
    keydown('KeyE', { altKey: true });
    expect(field.value).toBe('gęsla');
    expect(keydown('KeyA', { altKey: true, metaKey: true }).defaultPrevented).toBe(false);
    expect(keydown('KeyQ', { altKey: true }).defaultPrevented).toBe(false);
    expect(field.value).toBe('gęsla');
  });

  it('физический Enter = «Проверить»', () => {
    let checked = 0;
    attach({ onEnter: () => checked++ });
    const e = keydown('Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(checked).toBe(1);
  });
});

describe('режимы keyboard.mode', () => {
  it('auto: десктоп = полоска + QWERTY, телефон = только полоска', () => {
    expect(attach({ coarse: false }).qwertyVisible).toBe(true);
    document.body.innerHTML = '';
    document.body.append(field);
    const phone = attach({ coarse: true });
    expect(phone.qwertyVisible).toBe(false);
    expect(phone.strip.isConnected).toBe(true);
  });

  it('full включает QWERTY на телефоне, strip выключает на десктопе', () => {
    const kb = attach({ coarse: true, mode: 'full' });
    expect(kb.qwertyVisible).toBe(true);
    kb.setMode('strip');
    expect(kb.qwertyVisible).toBe(false);
  });

  it('iPad: первое физическое нажатие сворачивает QWERTY в полоску; Shift сам по себе — нет', () => {
    const kb = attach({ coarse: false, touchCapable: true });
    expect(kb.qwertyVisible).toBe(true);
    keydown('ShiftLeft');
    expect(kb.qwertyVisible).toBe(true);
    keydown('KeyK');
    expect(kb.qwertyVisible).toBe(false);
  });

  it('Mac: физическая клавиатура QWERTY не прячет', () => {
    const kb = attach({ coarse: false, touchCapable: false });
    keydown('KeyK');
    expect(kb.qwertyVisible).toBe(true);
  });

  it('полоска над полем, QWERTY под полем; detach убирает обе', () => {
    const kb = attach();
    expect(field.previousElementSibling).toBe(kb.strip);
    expect(field.nextElementSibling).toBe(kb.qwerty);
    expect(field.getAttribute('autocorrect')).toBe('off');
    kb.detach();
    expect(kb.strip.isConnected).toBe(false);
    expect(kb.qwerty.isConnected).toBe(false);
    keydown('KeyA', { altKey: true });
    expect(field.value).toBe('');
  });

  it('работает и с textarea', () => {
    const ta = document.createElement('textarea');
    document.body.append(ta);
    ta.focus();
    const kb = attachKeyboard(ta, { coarse: true });
    tap(kb.strip, 'ch:ń');
    expect(ta.value).toBe('ń');
  });
});
