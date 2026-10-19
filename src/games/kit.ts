// Общий набор для игр v2 (`src/games/<id>/`): выбор из вариантов, сборка из плиток, отвлекающие. Правит ядро v2; игровые агенты
// только пользуются (нужно новое общее — список правок дирижёру). Кнопки с `data-opt` движок нажимает клавишами 1–4,
// `data-nav` — стрелками и A/Enter (ввод только через движок, свои keydown/pointerdown в играх запрещены).
import { el } from '../ui/dom';
import { hasCyrillic, sayButton, spokenText, withSay } from '../ui/sayButton';
import type { GamePanel, PolskaUnit } from '../types/polska';

export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** До `n` отвлекающих из других единиц (сначала того же `type`), без повторов и без правильного ответа. */
export function distractUnits(u: PolskaUnit, all: readonly PolskaUnit[], field: 'pl' | 'ru', rand: () => number, n = 3): string[] {
  const own = u[field].trim().toLowerCase();
  const seen = new Set([own]);
  const out: string[] = [];
  for (const tier of [all.filter((x) => x.type === u.type), all]) {
    for (const x of shuffle(tier, rand)) {
      if (out.length >= n) return out;
      const v = x[field].trim();
      if (x.id === u.id || !v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

/** Слова строки без пунктуации: «Jeszcze Polska nie zginęła,» → [Jeszcze, Polska, nie, zginęła]. */
export const wordsOf = (s: string): string[] => s.replace(/[.,!?;:…«»„”"()]/g, ' ').split(/\s+/).filter(Boolean);

/** Сравнение собранного (регистр и лишние пробелы не важны). */
export const sameTiles = (a: readonly string[], b: readonly string[]): boolean => a.map((x) => x.trim().toLowerCase()).join(' ') === b.map((x) => x.trim().toLowerCase()).join(' ');

/**
 * Блок вопроса: крупная строка и подсказка мелко. Польский вопрос (`lang: 'pl'`) получает кнопку 🔊 справа (`ui/sayButton.ts`);
 * `say` — что произнести, если оно отличается от текста («Powiedz słowami: 3.05» → «Powiedz słowami»); пропуски «___» и «…» становятся паузой.
 */
export function prompt(panel: GamePanel, text: string, hint = '', lang: 'pl' | 'ru' = 'pl', say?: string): HTMLElement {
  const q = el('div', { class: 'pq-q', lang }, text);
  const head = lang === 'pl' && spokenText(say ?? text) ? el('div', { class: 'pq-qrow' }, q, sayButton(say ?? text, panel.say, { main: true })) : q;
  const b = el('div', { class: 'pq-pg-q', 'data-prompt': '' }, head, hint ? el('div', { class: 'pq-q-hint' }, hint) : null);
  panel.body.append(b);
  return b;
}

/**
 * Варианты кнопками (до 4, клавиши 1–4). Нажатие отдаёт строку варианта в `panel.submit`. Польские варианты (`lang: 'pl'`, по умолчанию)
 * получают 🔊 в углу: тап по нему только озвучивает, клавиатура — клавиша G на варианте под рамкой; русские — без кнопки.
 */
export function choice(panel: GamePanel, options: readonly string[], answer?: string, lang: 'pl' | 'ru' = 'pl'): HTMLElement {
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
          b.classList.add(answer === undefined || o === answer ? 'right' : 'wrong');
          if (answer !== undefined) for (const x of grid.querySelectorAll<HTMLElement>('[data-opt]')) if (x.dataset.opt === answer) x.classList.add('right');
          panel.submit(o);
        },
      },
      el('span', { class: 'n' }, `${i + 1}`),
      el('span', { class: 't' }, o),
    );
    grid.append(lang === 'pl' && !hasCyrillic(o) ? withSay(b, o, panel.say) : b);
  });
  panel.body.append(grid);
  return grid;
}

/**
 * Сборка из плиток: набор сверху, плитки снизу, «Сбросить» и «Sprawdź» в подвале. Отдаёт массив плиток в `panel.submit`.
 * Тап по плитке из набора озвучивает её целиком (`panel.say`, новая плитка прерывает прежнюю), если плитки польские (`lang: 'pl'`,
 * по умолчанию); русские плитки молчат. Возврат плитки из собранного ряда — без звука.
 */
export function tiles(panel: GamePanel, pool: readonly string[], lang: 'pl' | 'ru' = 'pl'): HTMLElement {
  let built: number[] = [];
  const row = el('div', { class: 'pq-built', 'data-built': '' });
  const box = el('div', { class: 'pq-pool' });
  const check = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-check': '', disabled: true, onclick: () => built.length && panel.submit(built.map((i) => pool[i]!)) }, 'Sprawdź · Проверить');
  const reset = el('button', { type: 'button', class: 'pq-btn', 'data-nav': '', 'data-reset': '', onclick: () => ((built = []), paint()) }, 'Сбросить');
  const paint = (): void => {
    row.replaceChildren(...built.map((ti, k) => el('button', { type: 'button', class: 'pq-btn pq-tile', 'data-nav': '', onclick: () => ((built = built.filter((_, j) => j !== k)), paint()) }, pool[ti]!)));
    box.replaceChildren(
      ...pool.map((t, i) =>
        el('button', { type: 'button', class: 'pq-btn pq-tile', 'data-nav': '', 'data-opt': t, 'data-tile': t, disabled: built.includes(i), onclick: () => !built.includes(i) && ((built = [...built, i]), paint(), lang === 'pl' && panel.say(t)) }, t),
      ),
    );
    check.disabled = built.length === 0;
  };
  paint();
  const wrap = el('div', { class: 'pq-pg-tiles' }, row, box);
  panel.body.append(wrap);
  panel.foot.replaceChildren(reset, check);
  return wrap;
}
