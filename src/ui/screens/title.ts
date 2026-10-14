// DOM-часть экрана Title (ТЗ §5.2): кнопка «Нажми, чтобы начать» и версия сборки.
import { bus } from '../../systems/bus';
import { unlockAudio } from '../../systems/platform/audio';
import { el } from '../dom';

const css = `
.pq-title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; text-align: center; }
.pq-title h1 { margin: 0; font-size: 30px; letter-spacing: 1px; color: #ffcd75; text-shadow: 0 3px 0 #b13e53; }
.pq-title button { font: inherit; font-size: 18px; line-height: 1.35; padding: 16px 28px; border: 3px solid #f4f4f4; border-radius: 6px; background: #3b5dc9; color: #f4f4f4; cursor: pointer; box-shadow: 0 4px 0 #29366f; touch-action: manipulation; }
.pq-title button:active { transform: translateY(3px); box-shadow: 0 1px 0 #29366f; }
.pq-title .pl { display: block; font-weight: 700; }
.pq-title .ru { display: block; font-size: 14px; opacity: .85; }
.pq-title .build { position: absolute; bottom: calc(12px + env(safe-area-inset-bottom)); font-size: 11px; opacity: .5; }
`;

export function mountTitle(root: HTMLElement): void {
  root.append(el('style', {}, css));
  bus.on('ui:title:show', ({ build }) => {
    const screen = el(
      'div',
      { class: 'pq-title' },
      el('h1', {}, 'Pierogi i Przypadki'),
      el(
        'button',
        {
          type: 'button',
          onclick: async () => {
            const unlocked = await unlockAudio();
            console.log(unlocked ? 'audio unlocked' : 'audio unlock failed');
            screen.remove();
            bus.emit('title:start', { audioUnlocked: unlocked });
          },
        },
        el('span', { class: 'pl', lang: 'pl' }, 'Dotknij, aby zacząć'),
        el('span', { class: 'ru' }, 'Нажми, чтобы начать'),
      ),
      el('div', { class: 'build' }, `v${build}`),
    );
    root.append(screen);
  });
}
