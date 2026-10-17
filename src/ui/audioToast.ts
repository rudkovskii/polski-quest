// Тост «Нажми, чтобы включить звук»: iOS отклонил play() после возврата из фона.
// Тап шлёт `audio:unlock` синхронно из обработчика (жест сохраняется), аудио повторяет фразу само.
import { bus } from '../systems/bus';
import { el } from './dom';

const css = `
.pq-audio-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 50;
  font: inherit; font-size: 16px; padding: 12px 18px; border: 2px solid #f4f4f4; border-radius: 6px; background: #b13e53; color: #f4f4f4;
  box-shadow: 0 3px 0 #5d275d; cursor: pointer; touch-action: manipulation; }
`;

export function mountAudioToast(root: HTMLElement): () => void {
  root.append(el('style', {}, css));
  let toast: HTMLElement | null = null;
  const hide = (): void => {
    toast?.remove();
    toast = null;
  };
  const offs = [
    bus.on('audio:blocked', () => {
      if (toast) return;
      toast = el(
        'button',
        {
          type: 'button',
          class: 'pq-audio-toast',
          onclick: () => {
            hide();
            bus.emit('audio:unlock', {});
          },
        },
        'Нажми, чтобы включить звук',
      );
      root.append(toast);
    }),
    bus.on('audio:state', ({ state }) => {
      if (state === 'playing') hide();
    }),
  ];
  return () => {
    hide();
    for (const off of offs) off();
  };
}
