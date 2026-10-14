// Варианты ответа (choice, listen, gap, minimal_pair, stress) и детерминированное перемешивание.
// P-01: варианты всех упражнений показываются перемешанными по seed = id шага + игровой день
// (`ExerciseCtx.seed`): на двух устройствах в один день одинаково, назавтра иначе, повтор ошибки в
// конце урока — в другом порядке. Порядок слогов в `stress` не трогаем: это слово.
import { fnv1a } from '../../systems/hash';
import type { StepListen, VocabEntry } from '../../types/content';
import { el } from '../dom';
import type { ExerciseContent, ExerciseCtx } from './types';

/** Перемешивание по seed (id шага): на двух устройствах и в тестах одинаково. */
export function shuffled<T>(list: readonly T[], seed: string): T[] {
  const out = list.slice();
  let h = fnv1a(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Seed перемешивания вариантов шага: `ctx.seed` (id шага + день), без него — id шага. */
export function seedOf(ctx: Pick<ExerciseCtx, 'stepId' | 'seed'>): string {
  return ctx.seed ?? ctx.stepId;
}

/**
 * Перемешать варианты с известным верным (`answer` — индекс в исходном списке). `orig[i]` — исходный
 * индекс i-го показанного варианта (для `errorTagByOption`).
 */
export function shuffleOptions<T>(list: readonly T[], answer: number, seed: string): { options: T[]; answer: number; orig: number[] } {
  const orig = shuffled([...list.keys()], seed);
  return { options: orig.map((i) => list[i]!), answer: orig.indexOf(answer), orig };
}

export interface OptionList {
  box: HTMLElement;
  buttons: HTMLButtonElement[];
  /** Последний выбранный индекс. */
  picked: number | null;
  markWrong(i: number): void;
  markRight(i: number, reveal?: boolean): void;
  disable(i: number): void;
  focusFirst(): void;
}

export function optionList(labels: readonly string[], onPick: (i: number) => void, opts: { row?: boolean; cls?: string; lang?: string } = {}): OptionList {
  const list: OptionList = {
    box: el('div', { class: `pq-opts${opts.row ? ' row' : ''}`, role: 'group' }),
    buttons: [],
    picked: null,
    markWrong(i) {
      const b = list.buttons[i];
      if (!b) return;
      b.classList.add('bad');
      b.disabled = true;
    },
    markRight(i, reveal = false) {
      list.buttons[i]?.classList.add(reveal ? 'show' : 'ok');
    },
    disable(i) {
      const b = list.buttons[i];
      if (b) b.disabled = true;
    },
    focusFirst() {
      list.buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
    },
  };
  labels.forEach((label, i) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: `pq-btn ${opts.cls ?? ''}`.trim(),
        'data-nav': true,
        'data-opt': i,
        lang: opts.lang,
        onclick: () => {
          list.picked = i;
          onPick(i);
        },
      },
      label,
    );
    list.buttons.push(b);
    list.box.append(b);
  });
  return list;
}

/**
 * `options: "auto:<tag>"` (ТЗ §3.5): верный ответ = `say` (или pl слова `item`), дистракторы из vocab
 * с этим тегом и тем же `pos`, затем с тегом, затем любые; детерминированно по id шага. Возвращает
 * варианты и индекс верного.
 */
export function autoOptions(step: StepListen, stepId: string, content: ExerciseContent | undefined, n = 3, seed = stepId): { options: string[]; answer: number } {
  const correct = step.say;
  if (typeof step.options !== 'string') {
    const s = shuffleOptions(step.options, step.answer, seed);
    return { options: s.options, answer: s.answer };
  }
  const tag = step.options.replace(/^auto:/, '');
  const item = step.item ? content?.vocab(step.item) : undefined;
  const all = content?.allVocab() ?? [];
  const norm = (s: string): string => s.trim().toLowerCase();
  const pool = (pred: (v: VocabEntry) => boolean): string[] =>
    shuffled(
      all.filter((v) => pred(v) && norm(v.pl) !== norm(correct)).map((v) => v.pl),
      `${stepId}:${tag}`,
    );
  const picked: string[] = [];
  const add = (xs: string[]): void => {
    for (const x of xs) if (picked.length < n - 1 && !picked.some((p) => norm(p) === norm(x))) picked.push(x);
  };
  add(pool((v) => (v.tags ?? []).includes(tag) && (!item || v.pos === item.pos)));
  add(pool((v) => (v.tags ?? []).includes(tag)));
  add(pool((v) => !item || v.pos === item.pos));
  add(pool(() => true));
  // Дистракторы стабильны по id шага, порядок показа — по seed (день).
  const options = shuffled([correct, ...picked], `${seed}:opts`);
  return { options, answer: options.indexOf(correct) };
}
