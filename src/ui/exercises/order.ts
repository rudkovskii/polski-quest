// `order` (ТЗ §3.5): собирает фразу из плиток. Тап (или Enter на плитке) переносит плитку между
// запасом и строкой ответа; перетаскивание ставит плитку в нужное место строки или возвращает в запас.
// Лишние плитки (Mały, kawę) — ловушки. Принимается `answer` или любой вариант из `alt`.
import { attachDrag } from '../../input/drag';
import type { StepOrder } from '../../types/content';
import { el } from '../dom';
import { audioButtons } from '../overlay/kit';
import { explainOf, runGraded } from './frame';
import { seedOf, shuffled } from './options';
import type { ExerciseModule } from './types';

interface Tile {
  id: number;
  text: string;
  node: HTMLButtonElement;
}

/**
 * Плитки в запасе по seed (P-01). Если перемешивание случайно начинается с готового ответа
 * (плитки ответа идут первыми по порядку), берём следующий seed: собрать «как лежит» нельзя.
 */
export function tileOrder(tiles: readonly string[], variants: readonly (readonly string[])[], seed: string): { id: number; text: string }[] {
  const all = tiles.map((text, id) => ({ id, text }));
  let out = all;
  for (let k = 0; k < 8; k++) {
    out = shuffled(all, k ? `${seed}:${k}` : seed);
    const head = out.map((t) => t.text);
    if (!variants.some((v) => v.length > 1 && v.every((w, i) => head[i] === w))) break;
  }
  return out;
}

export const order: ExerciseModule<StepOrder> = {
  graded: true,
  mount(step, ctx) {
    const line = el('div', { class: 'pq-order-line', 'data-zone': 'line', 'aria-label': 'Ответ' });
    const pool = el('div', { class: 'pq-order-pool', 'data-zone': 'pool', 'aria-label': 'Плитки' });
    const box = el('div', { class: 'pq-ex-body' }, line, pool);
    const variants = [step.answer, ...(step.alt ?? [])];

    const tiles: Tile[] = tileOrder(step.tiles, variants, seedOf(ctx)).map(({ id, text }) => {
      const node = el('button', { type: 'button', class: 'pq-btn pq-tile', 'data-nav': true, 'data-tile': id, lang: 'pl', onclick: () => toggle(id) }, text);
      return { id, text, node };
    });
    pool.append(...tiles.map((t) => t.node));
    const byId = (id: number): Tile => tiles.find((t) => t.id === id)!;
    const inLine = (): Tile[] => [...line.querySelectorAll<HTMLElement>('[data-tile]')].map((n) => byId(Number(n.dataset.tile)));

    /** Вернуть плитки в запас в исходном (перемешанном) порядке. */
    const restorePool = (): void => {
      const lineIds = new Set(inLine().map((t) => t.id));
      pool.replaceChildren(...tiles.filter((t) => !lineIds.has(t.id)).map((t) => t.node));
    };

    function toggle(id: number): void {
      if (run.phase !== 'answer') return;
      const t = byId(id);
      const from = t.node.parentElement === line ? line : pool;
      const idx = [...from.children].indexOf(t.node);
      if (from === line) {
        t.node.remove();
        restorePool();
      } else line.append(t.node);
      // Клавиатура: фокус остаётся в том же ряду на соседней плитке (Enter, Enter, Enter собирает фразу).
      const rest = [...from.querySelectorAll<HTMLElement>('[data-tile]')];
      (rest[Math.min(idx, rest.length - 1)] ?? t.node).focus({ preventScroll: true });
      run.changed();
    }

    const head: (Node | string)[] = [el('span', { class: 'q' }, step.prompt)];
    // Без звука (P-06): вместо ▶ — транскрипция слова шага, если есть.
    if (step.say && !ctx.silent && ctx.audio.has(step.say)) head.push(...audioButtons(ctx.audio, step.say));
    else if (step.say && ctx.silent) {
      const tr = (step.item ? ctx.content?.vocab(step.item)?.tr : undefined);
      if (tr) head.push(el('b', { class: 'tr', 'data-tr': '' }, `[${tr}]`));
    }
    const run = runGraded<string[]>(ctx, {
      kind: 'order',
      head,
      body: box,
      read: () => {
        const words = inLine().map((t) => t.text);
        return words.length ? words : null;
      },
      check: (words) =>
        variants.some((v) => v.length === words.length && v.every((w, i) => w === words[i]))
          ? { verdict: 'exact', score: 1, tags: [] }
          : { verdict: 'wrong', score: 0, tags: [...(step.tags ?? [])] },
      correct: () => step.answer.join(' '),
      sayCorrect: step.say ?? step.answer.join(' '),
      mark: (_w, c) => {
        line.classList.toggle('ok', c.verdict === 'exact');
        for (const t of inLine()) t.node.classList.toggle('bad', c.verdict !== 'exact');
      },
      reset: () => {
        for (const t of tiles) t.node.classList.remove('bad');
        line.replaceChildren();
        restorePool();
      },
      hint: () => {
        // Первая плитка ответа встаёт на место.
        const first = step.answer[0]!;
        const cur = inLine();
        if (cur[0]?.text !== first) {
          const t = tiles.find((x) => x.text === first && x.node.parentElement !== line) ?? cur.find((x) => x.text === first);
          if (t) line.prepend(t.node);
          restorePool();
          run.changed();
        }
        return `Начни с «${first}».`;
      },
      focus: () => (pool.querySelector<HTMLElement>('[data-tile]') ?? line.querySelector<HTMLElement>('[data-tile]'))?.focus({ preventScroll: true }),
      ...explainOf(step),
    });

    // Перетаскивание: призрак под пальцем, вставка по положению в строке.
    let ghost: HTMLElement | null = null;
    const zoneAt = (x: number, y: number): 'line' | 'pool' | null => {
      const doc = box.ownerDocument;
      const hit = doc.elementFromPoint?.(x, y) as HTMLElement | null;
      const z = hit?.closest?.('[data-zone]') as HTMLElement | null;
      return z && box.contains(z) ? (z.dataset.zone as 'line' | 'pool') : null;
    };
    const insertIndex = (x: number, y: number, skip: HTMLElement): number => {
      const items = inLine().filter((t) => t.node !== skip);
      for (let i = 0; i < items.length; i++) {
        const r = items[i]!.node.getBoundingClientRect();
        const rowBelow = y > r.bottom;
        if (!rowBelow && (y < r.top || x < r.left + r.width / 2)) return i;
      }
      return items.length;
    };
    const detach = attachDrag(box, {
      selector: '[data-tile]',
      onStart: ({ item, x, y }) => {
        if (run.phase !== 'answer') return;
        ghost = item.cloneNode(true) as HTMLElement;
        ghost.classList.add('ghost');
        ghost.removeAttribute('data-nav');
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
        box.ownerDocument.body.append(ghost);
        item.classList.add('lifted');
      },
      onMove: ({ x, y }) => {
        if (!ghost) return;
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
        line.classList.toggle('over', zoneAt(x, y) === 'line');
      },
      onDrop: ({ item, x, y }) => {
        const wasDragging = !!ghost;
        ghost?.remove();
        ghost = null;
        item.classList.remove('lifted');
        line.classList.remove('over');
        if (!wasDragging || run.phase !== 'answer') return;
        const zone = zoneAt(x, y);
        if (zone === 'line') {
          const idx = insertIndex(x, y, item);
          const rest = inLine().filter((t) => t.node !== item);
          const ref = rest[idx]?.node ?? null;
          line.insertBefore(item, ref);
          restorePool();
        } else if (zone === 'pool' && item.parentElement === line) {
          item.remove();
          restorePool();
        }
        run.changed();
      },
      onCancel: ({ item }) => {
        ghost?.remove();
        ghost = null;
        item.classList.remove('lifted');
        line.classList.remove('over');
      },
    });
    void run.result.finally(() => {
      detach();
      ghost?.remove();
    });
    return run.result;
  },
};
