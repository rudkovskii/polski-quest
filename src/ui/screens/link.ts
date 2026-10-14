// «Сохрани свою ссылку» (ТЗ §5.2): F6 конца первого дня и Settings. Ссылка, «Скопировать»,
// «Поделиться» (Web Share API, если есть), чекбокс «Я сохранил ссылку в Заметки».
// Ссылку собирает склейка из секрета (src/cloud.ts) и передаёт в `ui:link:show`; в лог не пишется.
import { bus } from '../../systems/bus';
import { el } from '../dom';

const css = `
.pq-link { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; background: rgba(26,28,44,.88); }
.pq-link .card { display: flex; flex-direction: column; gap: 14px; width: min(100%, 440px); padding: 20px; border: 3px solid #f4f4f4; border-radius: 8px; background: #29366f; }
.pq-link h2 { margin: 0; font-size: 22px; color: #ffcd75; }
.pq-link input { box-sizing: border-box; width: 100%; font: inherit; font-size: 17px; min-height: 48px; padding: 10px 12px; border: 2px solid #94b0c2; border-radius: 6px; background: #f4f4f4; color: #1a1c2c; -webkit-user-select: text; user-select: text; }
.pq-link .row { display: flex; gap: 10px; flex-wrap: wrap; }
.pq-link button { flex: 1; font: inherit; font-size: 17px; min-height: 48px; padding: 10px 16px; border: 2px solid #f4f4f4; border-radius: 6px; background: #3b5dc9; color: #f4f4f4; cursor: pointer; touch-action: manipulation; }
.pq-link button.done { background: #38b764; color: #1a1c2c; }
.pq-link label { display: flex; align-items: center; gap: 12px; min-height: 44px; font-size: 17px; }
.pq-link input[type=checkbox] { width: 26px; height: 26px; min-height: 0; margin: 0; }
`;

interface ShareNavigator {
  share?: (data: { title?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

async function copyText(text: string, field: HTMLInputElement): Promise<boolean> {
  const nav = navigator as ShareNavigator;
  try {
    if (nav.clipboard) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* нет разрешения: выделим текст ниже */
  }
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

export function mountLink(root: HTMLElement): void {
  root.append(el('style', {}, css));
  let current: HTMLElement | null = null;
  bus.on('ui:link:show', ({ link, saved, onSaved }) => {
    current?.remove();
    const field = el('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Ссылка' });
    field.addEventListener('focus', () => field.select());
    const copyBtn = el('button', { type: 'button' }, 'Скопировать');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(link, field);
      copyBtn.textContent = ok ? 'Скопировано' : 'Выдели и скопируй';
    });
    const nav = navigator as ShareNavigator;
    const shareBtn = nav.share
      ? el('button', {
          type: 'button',
          onclick: () => {
            nav.share?.({ title: 'Pierogi i Przypadki', url: link }).catch(() => undefined); // отмена — не ошибка
          },
        }, 'Поделиться')
      : null;
    const check = el('input', { type: 'checkbox', checked: saved, disabled: saved });
    check.addEventListener('change', () => {
      if (!check.checked) return;
      check.disabled = true; // флаг монотонный (world.flags), снять нельзя
      onSaved();
    });
    const close = (): void => {
      screen.remove();
      if (current === screen) current = null;
    };
    const screen = el(
      'div',
      { class: 'pq-link', role: 'dialog', 'aria-modal': 'true' },
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Сохрани свою ссылку'),
        field,
        el('div', { class: 'row' }, copyBtn, shareBtn),
        el('label', {}, check, 'Я сохранил ссылку в Заметки'),
        el('button', { type: 'button', class: 'done', onclick: close }, 'Готово'),
      ),
    );
    current = screen;
    root.append(screen);
  });
}
