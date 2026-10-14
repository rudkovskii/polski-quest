// LinkSetup (ТЗ §5.2): первый запуск без секрета и без локального мира. Две кнопки, без инструкций:
// «Начать» молча создаёт мир, «У меня есть ссылка» раскрывает поле вставки. Действия выполняет
// склейка (src/cloud.ts) через payload события `ui:start:show`; экран только показывает результат.
import { bus } from '../../systems/bus';
import type { ConnectResult } from '../../types/bus';
import { el } from '../dom';

const css = `
.pq-start { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; box-sizing: border-box; text-align: center; background: rgba(26,28,44,.82); }
.pq-start button { font: inherit; font-size: 18px; min-height: 48px; min-width: 240px; padding: 12px 24px; border: 3px solid #f4f4f4; border-radius: 6px; background: #3b5dc9; color: #f4f4f4; cursor: pointer; box-shadow: 0 4px 0 #29366f; touch-action: manipulation; }
.pq-start button.alt { background: #333c57; box-shadow: 0 4px 0 #1a1c2c; }
.pq-start button:active { transform: translateY(3px); box-shadow: 0 1px 0 #29366f; }
.pq-start button:disabled { opacity: .6; }
.pq-start form { display: none; flex-direction: column; align-items: center; gap: 12px; width: min(100%, 420px); }
.pq-start form.open { display: flex; }
.pq-start input { box-sizing: border-box; width: 100%; font: inherit; font-size: 17px; min-height: 48px; padding: 10px 12px; border: 2px solid #94b0c2; border-radius: 6px; background: #f4f4f4; color: #1a1c2c; -webkit-user-select: text; user-select: text; }
.pq-start .msg { min-height: 1.4em; font-size: 17px; color: #ffcd75; }
.pq-start .link { background: none; border: none; box-shadow: none; min-width: 0; font-size: 17px; color: #94b0c2; text-decoration: underline; }
`;

const MESSAGES: Record<Exclude<ConnectResult, 'ok'>, string> = {
  not_found: 'Такого мира нет. Проверь ссылку',
  invalid: 'Такого мира нет. Проверь ссылку',
  offline: 'Облако недоступно, сольём при сети',
};

/** Пауза, чтобы игрок успел прочитать «облако недоступно» перед входом в игру. */
const OFFLINE_NOTICE_MS = 1500;

export function mountStart(root: HTMLElement): void {
  root.append(el('style', {}, css));
  bus.on('ui:start:show', ({ create, connect }) => {
    const msg = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    const input = el('input', {
      type: 'text',
      name: 'link',
      inputmode: 'url',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      'aria-label': 'Ссылка',
    });
    const connectBtn = el('button', { type: 'submit' }, 'Подключить');
    const close = (): void => screen.remove();
    const startNew = (): void => {
      close();
      create();
    };

    const form = el(
      'form',
      {
        onsubmit: async (ev: Event) => {
          ev.preventDefault();
          connectBtn.disabled = true;
          msg.textContent = '…';
          let res: ConnectResult;
          try {
            res = await connect(input.value);
          } catch {
            res = 'offline';
          }
          connectBtn.disabled = false;
          if (res === 'ok') return close();
          msg.textContent = MESSAGES[res];
          if (res === 'offline') setTimeout(close, OFFLINE_NOTICE_MS);
        },
      },
      input,
      connectBtn,
      msg,
      el('button', { type: 'button', class: 'link', onclick: startNew }, 'Создать новый мир'),
    );

    const screen = el(
      'div',
      { class: 'pq-start' },
      el('button', { type: 'button', onclick: startNew }, 'Начать'),
      el(
        'button',
        {
          type: 'button',
          class: 'alt',
          onclick: () => {
            form.classList.add('open');
            input.focus();
          },
        },
        'У меня есть ссылка',
      ),
      form,
    );
    root.append(screen);
  });
}
