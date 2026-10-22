// Пароль на входе персональной версии (`edition.json` → `gate`, SHA-256 hex). Пока пароль не введён, игра не грузится.
// Верный пароль запоминается на устройстве (localStorage), второй раз не спрашиваем. Защита от случайного гостя, не от взлома.
import { el } from './dom';
import { THEME_CSS } from './theme';

const GATE_CSS = `
${THEME_CSS}
.pq-gate { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: #2e5b3b; font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.pq-gate form { width: min(320px, 100%); display: flex; flex-direction: column; gap: 10px; padding: 16px; box-sizing: border-box;
  background: var(--pq-wood); border: 3px solid var(--pq-ink); border-radius: 12px; box-shadow: 0 4px 0 var(--pq-ink); color: var(--pq-cream); }
.pq-gate h2 { margin: 0; font-size: 21px; }
.pq-gate input { font: 600 20px/1 inherit; letter-spacing: 2px; text-align: center; padding: 10px; border: 2px solid var(--pq-ink);
  border-radius: 6px; background: var(--pq-cream); color: var(--pq-ink); -webkit-user-select: text; user-select: text; }
.pq-gate .err { min-height: 18px; font-size: 14px; color: #ffd2c4; }
`;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function remembered(key: string, hash: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === hash;
  } catch {
    return false;
  }
}

/** Ждёт верный пароль. `hash` — SHA-256 hex, `id` — чья версия (ключ запоминания). */
export function passGate(root: HTMLElement, id: string, hash: string): Promise<void> {
  const key = `pq-gate:${id}`;
  if (remembered(key, hash)) return Promise.resolve();
  return new Promise((resolve) => {
    const input = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', 'aria-label': 'Пароль', 'data-gate-input': '' });
    const err = el('div', { class: 'err', 'data-gate-err': '' });
    const form = el(
      'form',
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          void sha256(input.value.trim()).then((h) => {
            if (h !== hash) {
              err.textContent = 'Неверный пароль';
              input.select();
              return;
            }
            try {
              globalThis.localStorage?.setItem(key, hash);
            } catch {
              // Приватный режим: спросим снова в следующий раз.
            }
            wrap.remove();
            resolve();
          });
        },
      },
      el('h2', {}, 'Ferma'),
      el('div', {}, 'Введите пароль'),
      input,
      err,
      el('button', { type: 'submit', class: 'pq-btn', 'data-gate-go': '' }, 'Войти'),
    );
    const wrap = el('div', { class: 'pq-gate' }, el('style', {}, GATE_CSS), form);
    root.append(wrap);
    input.focus();
  });
}
