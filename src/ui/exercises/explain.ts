// `explain` (ТЗ §3.5): короткое правило (≤ 400 знаков) и необязательная таблица. SRS не трогает.
import type { StepExplain } from '../../types/content';
import { el } from '../dom';
import { mdInline } from '../overlay/kit';
import { runPlain } from './frame';
import type { ExerciseModule } from './types';

export const explain: ExerciseModule<StepExplain> = {
  graded: false,
  mount(step, ctx) {
    const body = el('div', { class: 'pq-md' }, mdInline(step.md));
    if (step.table?.length) {
      body.append(el('table', {}, ...step.table.map((row) => el('tr', {}, ...row.map((c) => el('td', { lang: 'pl' }, c))))));
    }
    return runPlain(ctx, [], body).result;
  },
};
