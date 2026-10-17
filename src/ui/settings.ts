// Настройки: звук, экспорт и импорт сохранения файлом, сброс (с автоэкспортом перед стиранием).
// Пока панель открыта, мир не принимает ввод (`world:input`), Esc закрывает.
import { bus as globalBus, type Bus } from '../systems/bus';
import type { BusEvents } from '../types/bus';
import { el } from './dom';
import { THEME_CSS } from './theme';

const css = `
${THEME_CSS}
.pq-modal { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; background: rgba(42, 20, 24, .55); padding: 16px; }
.pq-modal[hidden] { display: none; }
.pq-card { width: min(360px, 100%); background: var(--pq-cream); color: var(--pq-ink); border: 3px solid var(--pq-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--pq-ink);
  padding: 16px; display: flex; flex-direction: column; gap: 10px; font: 16px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.pq-card h2 { margin: 0 0 4px; font-size: 20px; }
.pq-card .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pq-card .note { font-size: 13px; opacity: .75; min-height: 1.3em; }
.pq-card .pq-btn { width: 100%; }
.pq-toggle[aria-pressed=true] { background: #5a8f3e; }
`;

export interface SettingsDeps {
  bus?: Bus<BusEvents>;
  getSound(): boolean;
  setSound(on: boolean): void;
  /** Скачать сохранение файлом (возвращает имя файла). */
  exportSave(): string;
  /** Импорт: текст файла → сообщение для игрока; ok = сохранение принято (страница перезагрузится). */
  importSave(text: string): Promise<{ ok: boolean; message: string }>;
  /** Сброс: автоэкспорт, стирание, перезагрузка. */
  reset(): Promise<void>;
}

export interface SettingsPanel {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export function mountSettings(parent: HTMLElement, deps: SettingsDeps): SettingsPanel {
  const bus = deps.bus ?? globalBus;
  const note = el('div', { class: 'note', 'data-note': '', role: 'status' });
  const sound = el('button', { type: 'button', class: 'pq-btn pq-toggle', 'aria-pressed': String(deps.getSound()) });
  const paintSound = (): void => {
    const on = deps.getSound();
    sound.setAttribute('aria-pressed', String(on));
    sound.textContent = on ? 'Вкл' : 'Выкл';
  };
  sound.onclick = () => {
    deps.setSound(!deps.getSound());
    paintSound();
  };
  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    const r = await deps.importSave(await f.text());
    note.textContent = r.message;
  };
  let armed = false;
  const reset = el('button', { type: 'button', class: 'pq-btn danger', 'data-reset': '' }, 'Сбросить игру');
  reset.onclick = () => {
    if (!armed) {
      armed = true;
      reset.textContent = 'Точно? Сначала скачаю копию';
      note.textContent = 'Файл с сохранением скачается сам, потом всё сотрётся.';
      return;
    }
    reset.disabled = true;
    void deps.reset();
  };
  const closeBtn = el('button', { type: 'button', class: 'pq-btn', onclick: () => api.close() }, 'Закрыть');
  const card = el(
    'div',
    { class: 'pq-card', role: 'dialog', 'aria-label': 'Настройки' },
    el('h2', {}, 'Настройки'),
    el('div', { class: 'row' }, el('span', {}, 'Звук'), sound),
    el('button', { type: 'button', class: 'pq-btn', 'data-export': '', onclick: () => (note.textContent = `Сохранено: ${deps.exportSave()}`) }, 'Экспорт сохранения'),
    el('button', { type: 'button', class: 'pq-btn', 'data-import': '', onclick: () => file.click() }, 'Импорт сохранения'),
    file,
    reset,
    note,
    closeBtn,
  );
  const root = el('div', { class: 'pq-modal', hidden: true, 'data-settings': '' }, el('style', {}, css), card);
  root.addEventListener('click', (e) => {
    if (e.target === root) api.close();
  });
  parent.append(root);
  let open = false;
  const offIntent = bus.on('input:intent', (i) => {
    if (open && i.to === 'ui' && i.type === 'cancel') api.close();
  });
  const api: SettingsPanel = {
    open() {
      if (open) return;
      open = true;
      armed = false;
      reset.textContent = 'Сбросить игру';
      reset.disabled = false;
      note.textContent = '';
      paintSound();
      root.hidden = false;
      bus.emit('world:input', { enabled: false });
    },
    close() {
      if (!open) return;
      open = false;
      root.hidden = true;
      bus.emit('world:input', { enabled: true });
    },
    get isOpen() {
      return open;
    },
    dispose() {
      offIntent();
      root.remove();
    },
  };
  return api;
}
