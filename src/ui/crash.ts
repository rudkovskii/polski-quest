// Экран «Что-то сломалось» вместо пустого экрана (t26): ошибка при запуске или падение игры. Две кнопки — перезагрузить и скачать сохранение,
// чтобы прогресс не зависел от того, починится ли игра. Экран рисуется голым DOM в <body>: оверлей и сцена к этому моменту могут не существовать.
import { el } from './dom';

const css = `
.pq-crash { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
  background: #1a1c2c; color: #f4f4f4; font: 18px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; pointer-events: auto; }
.pq-crash-box { width: min(100%, 440px); display: flex; flex-direction: column; gap: 14px; }
.pq-crash h1 { margin: 0; font-size: 26px; }
.pq-crash p { margin: 0; }
.pq-crash button { font: inherit; font-weight: 800; min-height: 52px; padding: 8px 16px; border: 2px solid #f4f4f4; border-radius: 8px; cursor: pointer; }
.pq-crash [data-crash-reload] { background: #f2d552; color: #1a1c2c; border-color: #1a1c2c; }
.pq-crash [data-crash-export] { background: #29366f; color: #f4f4f4; }
.pq-crash-err { font: 13px/1.3 ui-monospace, Menlo, monospace; color: #94b0c2; word-break: break-word; max-height: 30vh; overflow: auto; user-select: text; -webkit-user-select: text; }
`;

export interface CrashOptions {
  /** Текст файла сохранения или null, если сохранения нет. */
  saveText: () => Promise<string | null>;
  fileName: () => string;
  download: (name: string, text: string) => void;
  reload: () => void;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === 'string' ? error : 'неизвестная ошибка';
}

/** Показать экран (повторные вызовы ничего не делают). */
export function showCrash(error: unknown, opts: CrashOptions, root: HTMLElement = document.body): HTMLElement {
  const old = root.querySelector<HTMLElement>('.pq-crash');
  if (old) return old;
  const status = el('p', { 'data-crash-status': '' });
  const exportBtn = el('button', {
    type: 'button',
    'data-crash-export': '',
    onclick: () => {
      void opts.saveText().then(
        (text) => {
          if (text === null) status.textContent = 'Сохранения на этом устройстве нет.';
          else {
            opts.download(opts.fileName(), text);
            status.textContent = 'Файл сохранения скачан.';
          }
        },
        () => {
          status.textContent = 'Сохранение прочитать не удалось.';
        },
      );
    },
  }, 'Скачать сохранение');
  const box = el('div', { class: 'pq-crash-box' },
    el('h1', {}, 'Что-то сломалось'),
    el('p', {}, 'Игра не смогла продолжить. Прогресс лежит на этом устройстве: скачайте сохранение на всякий случай и перезагрузите страницу.'),
    el('button', { type: 'button', 'data-crash-reload': '', onclick: () => opts.reload() }, 'Перезагрузить'),
    exportBtn,
    status,
    el('p', { class: 'pq-crash-err' }, describe(error)),
  );
  const screen = el('div', { class: 'pq-crash', role: 'alert' }, el('style', {}, css), box);
  root.append(screen);
  return screen;
}

/**
 * Запуск под присмотром: ошибка или отклонённый промис до конца `run` — экран; после запуска экран показывают только ошибки
 * (`error`), а отклонённые промисы пишутся в консоль: это обычно оборванная загрузка звука, игра при этом живёт.
 */
export async function guardStart(run: () => Promise<void>, opts: CrashOptions, win: Window = window): Promise<boolean> {
  let started = false;
  const root = win.document.body;
  const onError = (e: ErrorEvent): void => {
    console.error('ошибка игры', e.error ?? e.message);
    showCrash(e.error ?? e.message, opts, root);
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    console.error('необработанный промис', e.reason);
    if (!started) showCrash(e.reason, opts, root);
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  try {
    await run();
    return true;
  } catch (err) {
    console.error('игра не запустилась', err);
    showCrash(err, opts, root);
    return false;
  } finally {
    started = true;
  }
}
