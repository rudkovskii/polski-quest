// Сетка вариантов Geografia (как `kit.choice`, но ответ уходит через `onPick`: у задания «сосед → форма» их две ступени).
// Кнопки с `data-opt` движок жмёт клавишами 1–4, `data-nav` — стрелками и A.
import { el } from '../../ui/dom';
import { withSay, type SayFn } from '../../ui/sayButton';

export function choiceGrid(options: readonly string[], correct: string, onPick: (o: string) => void, say?: SayFn): HTMLElement {
  const grid = el('div', { class: 'pq-opts', 'data-opts': '' });
  options.forEach((o, i) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: 'pq-btn pq-opt',
        'data-nav': '',
        'data-opt': o,
        onclick: () => {
          if (b.disabled) return;
          const ok = o === correct;
          b.classList.add(ok ? 'right' : 'wrong');
          if (!ok) for (const x of grid.querySelectorAll<HTMLElement>('[data-opt]')) if (x.dataset.opt === correct) x.classList.add('right');
          onPick(o);
        },
      },
      el('span', { class: 'n' }, `${i + 1}`),
      el('span', { class: 't' }, o),
    );
    grid.append(say ? withSay(b, o, say) : b);
  });
  return grid;
}
