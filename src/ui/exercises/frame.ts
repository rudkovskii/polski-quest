// Рамка шага (ТЗ §5.7): задание, тело, «Подсказка», «Проверить»/«Дальше», панель обратной связи.
// Цикл попыток общий для всех типов: первая попытка идёт в SRS, после ошибки — правильный ответ,
// строка правила и перевод (P-01: `why` шага → `errorTags[tag].hint`/`ru` → перевод с транскрипцией),
// потом «Prawie. Jeszcze raz.» для почти верного (диакритика, орфография, одна буква) или «Jeszcze raz.»
// для неверного (P-07, СЮЖЕТ_v2 §4 sys.*: «Prawie» только когда правда почти) и обучающий повтор.
// Модули типов дают только тело, чтение ответа и проверку.
import type { Check } from '../../systems/answer';
import type { StepKind } from '../../systems/grade';
import { el } from '../dom';
import { attachKeyboard, type AttachedKeyboard } from '../keyboard';
import { BTN as L, btn, plBtn, type PlLabel } from '../overlay/kit';
import { navItems } from '../overlay/nav';
import type { ExerciseCtx, FirstTry, StepResult } from './types';

/** Реплика при неверном ответе (`sys.jeszcze`): никто не говорит «неправильно» (СЮЖЕТ §1, правило 3). */
export const WRONG_LINE = 'Jeszcze raz.';
/** Реплика при почти верном незачтённом ответе (`sys.kazik.prawie`, P-07). */
export const NEAR_LINE = 'Prawie. Jeszcze raz.';
export const RIGHT_LINE = 'Dobrze!';
/** Русские подписи реплик отклика (ПОЛИРОВКА §2.10: польское слово + мелкая подпись). */
const VERDICT_RU: Record<string, string> = { [WRONG_LINE]: 'Ещё раз.', [NEAR_LINE]: 'Почти. Ещё раз.', 'Prawie.': 'Почти.', [RIGHT_LINE]: 'Хорошо!', 'Pip!': 'Пип!', 'Hyk!': 'Ик!' };
/** После стольких неверных попыток появляется «Пропустить», чтобы шаг не держал вечно. */
export const SKIP_AFTER = 2;

export type CheckLike = Pick<Check, 'verdict' | 'score' | 'tags'> & { best?: string };

export interface GradedSpec<A> {
  kind: StepKind;
  /** Задание: строка или узлы (вопрос, кнопки ▶). */
  head: (Node | string)[];
  body: HTMLElement;
  /** Текущий ответ; null — нечего проверять («Проверить» неактивна). */
  read(): A | null;
  check(a: A): CheckLike;
  /** Правильный ответ для панели обратной связи. */
  correct(): string;
  /** Транскрипция правильного ответа (vocab.tr). */
  tr?: string;
  /** Озвучить правильный ответ на панели. */
  sayCorrect?: string;
  /** Выбор вариантов: проверка сразу по выбору, без кнопки «Проверить». */
  instant?: boolean;
  /** Ошибки исправляются по ходу (match): после итога не повторяем, сразу «Дальше». */
  noRetry?: boolean;
  /** Подсветить верное и неверное после проверки. */
  mark?(a: A, c: CheckLike, first: boolean): void;
  /** Подготовить повторную попытку. */
  reset?(): void;
  /** Авто-подсказка; вернуть текст для панели или null. */
  hint?(): string | null;
  /** Поле ввода: экранная клавиатура, Enter = «Проверить»/«Дальше». */
  input?: HTMLInputElement;
  focus?(): void;
  /** match: результат по парам. */
  parts?(): { item?: string; ok: boolean }[];
  noAudio?: boolean;
  /** Подсказка из контента (`step.hint`). */
  stepHint?: string;
  /** Объяснение ошибки одной строкой из контента (`step.why`, P-01). */
  why?: string;
  /** Слово шага (`step.item`): перевод и транскрипция под ответом после ошибки. */
  item?: string;
  /** Кластер шага: его правило из errorTags, если у ошибки нет своего тега. */
  cluster?: string;
  /** Польское слово, перевод которого показать после ошибки (по умолчанию — правильный ответ). */
  word?: string;
}

/** Поля шага для объяснения ошибки (P-01). */
export function explainOf(step: { why?: string; item?: string; cluster?: string; hint?: string }): Pick<GradedSpec<unknown>, 'why' | 'item' | 'cluster' | 'stepHint'> {
  return {
    ...(step.why ? { why: step.why } : {}),
    ...(step.item ? { item: step.item } : {}),
    ...(step.cluster ? { cluster: step.cluster } : {}),
    ...(step.hint ? { stepHint: step.hint } : {}),
  };
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/[.!?,…]/g, '');

/** Строка правила после ошибки: `why` шага, иначе правило тега ошибки или кластера (`hint`, иначе `ru`). */
export function ruleLine(ctx: Pick<ExerciseCtx, 'content'>, spec: Pick<GradedSpec<unknown>, 'why' | 'cluster'>, tags: readonly string[]): string | null {
  if (spec.why) return spec.why;
  for (const t of [...tags, ...(spec.cluster ? [spec.cluster] : [])]) {
    const e = ctx.content?.errorTag?.(t);
    if (e) return e.hint ?? e.ru;
  }
  return null;
}

/** Перевод правильного ответа: «ząb — зуб [зомп]» (слово шага или слово словаря с тем же написанием). */
export function glossLine(ctx: Pick<ExerciseCtx, 'content'>, spec: Pick<GradedSpec<unknown>, 'item' | 'word' | 'tr'>, correct: string): string | null {
  const c = ctx.content;
  if (!c) return null;
  const word = spec.word ?? correct;
  let v = spec.item ? c.vocab(spec.item) : undefined;
  if (!v || (norm(v.pl) !== norm(word) && norm(v.ru) !== norm(word))) v = c.allVocab().find((x) => norm(x.pl) === norm(word)) ?? v;
  if (!v?.ru) return null;
  return `${v.pl} — ${v.ru}${v.tr && !spec.tr ? ` [${v.tr}]` : ''}`;
}

export interface GradedRun {
  result: Promise<StepResult>;
  /** Проверить текущий ответ (выбор варианта, конец сборки). */
  submit(): void;
  /** Ответ изменился: пересчитать доступность «Проверить». */
  changed(): void;
  /** «Не слышу» (P-12): шаг закрыт без оценки, как задание без звука — не идёт ни в счёт урока, ни в карту звуков. */
  skipNoAudio(): void;
  readonly phase: 'answer' | 'feedback' | 'done';
}

function isRight(c: CheckLike): boolean {
  return c.verdict !== 'wrong' && c.score > 0;
}

/** Почти верно (P-07): диакритика, орфография (rz/ż, ó/u), одна буква. «Prawie» — только тогда. */
export function isNear(c: Pick<CheckLike, 'verdict'>): boolean {
  return c.verdict === 'diacritics' || c.verdict === 'ortho' || c.verdict === 'typo';
}

export function verdictText(c: CheckLike): { cls: 'ok' | 'part' | 'bad'; text: string } {
  if (!isRight(c)) return { cls: 'bad', text: isNear(c) ? NEAR_LINE : WRONG_LINE };
  if (c.verdict === 'exact' || c.score >= 1) return { cls: 'ok', text: RIGHT_LINE };
  if (c.verdict === 'diacritics') return { cls: 'part', text: 'Засчитано, но смотри на диакритику:' };
  if (c.verdict === 'ortho') return { cls: 'part', text: 'Почти: звучит так же, пишется иначе:' };
  return { cls: 'part', text: 'Засчитано, одна буква мимо:' };
}

/** Каркас шага: голова, тело, панель, ряд кнопок. */
export function frame(ctx: ExerciseCtx, head: (Node | string)[], body: HTMLElement): {
  root: HTMLElement;
  fb: HTMLElement;
  actions: HTMLElement;
} {
  const fb = el('div', { class: 'pq-ex-fb', hidden: true, role: 'status', 'aria-live': 'polite' });
  const actions = el('div', { class: 'pq-ex-actions' });
  const root = el(
    'div',
    { class: 'pq-ex' },
    head.length ? el('div', { class: 'pq-ex-head' }, ...head) : null,
    el('div', { class: 'pq-ex-body' }, body),
    fb,
    actions,
  );
  ctx.root.replaceChildren(root);
  return { root, fb, actions };
}

export function runGraded<A>(ctx: ExerciseCtx, spec: GradedSpec<A>): GradedRun {
  const t0 = ctx.now();
  const { root, fb, actions } = frame(ctx, spec.head, spec.body);
  let phase: GradedRun['phase'] = 'answer';
  let attempts = 0;
  let wrongs = 0;
  let hinted = false;
  let first: FirstTry | undefined;
  let kb: AttachedKeyboard | null = null;
  let resolve!: (r: StepResult) => void;
  const result = new Promise<StepResult>((r) => (resolve = r));

  const hintText = (): string | null => spec.stepHint ?? spec.hint?.() ?? null;
  const canHint = !ctx.repeat && (spec.stepHint !== undefined || spec.hint !== undefined);
  const hintBtn = canHint ? plBtn(L.hint, () => showHint(), 'ghost', { 'data-nav': true, 'data-act': 'hint' }) : null;
  const checkBtn = plBtn(L.check, () => submit(), 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'check' });
  const nextBtn = plBtn(L.next, () => finish(), 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'next', hidden: true });
  const retryBtn = plBtn(L.retry, () => retry(), 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'retry', hidden: true });
  const skipBtn = plBtn(L.skip, () => finish(), 'ghost', { 'data-nav': true, 'data-act': 'skip', hidden: true });
  // P-12: после ошибки с правильным ответом и правилом «Dalej» видна всегда. У ввода текстом рядом с «Ещё раз».
  const laterBtn = plBtn(L.next, () => finish(), 'ghost', { 'data-nav': true, 'data-act': 'later', hidden: true });
  actions.append(...[hintBtn, el('span', { class: 'grow' }), skipBtn, laterBtn, spec.instant ? null : checkBtn, retryBtn, nextBtn].filter((x): x is HTMLElement => !!x));

  if (spec.input) {
    kb = attachKeyboard(spec.input, {
      mode: ctx.keyboardMode,
      ...(ctx.coarse !== undefined ? { coarse: ctx.coarse } : {}),
      onEnter: () => {
        if (phase === 'answer') submit();
        else if (!nextBtn.hidden) finish();
        else if (!retryBtn.hidden) retry();
      },
    });
    spec.input.addEventListener('input', () => changed());
  }

  const show = (b: HTMLElement, on: boolean): void => {
    b.hidden = !on;
  };

  function changed(): void {
    checkBtn.disabled = phase !== 'answer' || spec.read() === null;
  }

  function feedback(cls: string, parts: (Node | string | null)[]): void {
    fb.className = `pq-ex-fb ${cls}`;
    fb.replaceChildren(...parts.filter((x): x is Node | string => x !== null));
    fb.hidden = false;
  }

  function showHint(): void {
    if (phase !== 'answer') return;
    const t = hintText();
    if (attempts === 0) hinted = true;
    const line = el('span', { class: 'pq-hint' }, '💡 ', t ?? 'Послушай ещё раз');
    // После ошибки панель с правильным ответом остаётся, подсказка дописывается под неё.
    if (attempts > 0 && !fb.hidden) fb.append(line);
    else feedback('', [line]);
    if (hintBtn) hintBtn.disabled = true;
    spec.focus?.();
  }

  function focusPrimary(): void {
    const p = [retryBtn, nextBtn].find((b) => !b.hidden);
    if (spec.input && phase !== 'done' && (p === undefined || p === retryBtn)) return;
    p?.focus({ preventScroll: true });
  }

  function submit(): void {
    // Выбор после ошибки (P-12): тап по подсвеченному верному варианту — то же, что «Dalej».
    if (phase === 'feedback' && spec.instant && !nextBtn.hidden) {
      finish();
      return;
    }
    if (phase !== 'answer') return;
    const a = spec.read();
    if (a === null) return;
    attempts++;
    const c = spec.check(a);
    const isFirst = attempts === 1;
    if (isFirst) first = { verdict: c.verdict, score: c.score, tags: [...c.tags], ms: Math.max(0, Math.round(ctx.now() - t0)), hinted };
    spec.mark?.(a, c, isFirst);
    const v = verdictText(c);
    const right = isRight(c);
    // Ошибки уже исправлены по ходу (match): «ещё раз» не нужен; «Prawie.» — если половина пар верна.
    if (!right && spec.noRetry) v.text = c.score > 0 || isNear(c) ? 'Prawie.' : '';
    // Свои отклики (P-06: турникет «Pip!» / «Hyk!»); одна попытка — без «ещё раз».
    if (ctx.verdicts) v.text = right ? ctx.verdicts.ok : ctx.verdicts.bad;
    else if (!right && ctx.oneShot) v.text = '';
    const verdictEl = v.text ? el('span', { class: 'verdict', lang: 'pl' }, v.text, VERDICT_RU[v.text] ? el('small', { class: 'ru', lang: 'ru' }, ` ${VERDICT_RU[v.text]}`) : null) : null;
    const showAnswer = !right || v.cls === 'part';
    const ans = spec.correct();
    const answerParts = [
      showAnswer && ans ? el('span', { class: 'answer' }, right ? '' : 'Правильно: ', el('b', {}, ans)) : null,
      showAnswer && spec.tr ? el('span', { class: 'tr' }, `[${spec.tr}]`) : null,
      // Без звука (P-10b) ▶ нет: кнопка, которая молчит, выглядит как пропущенное задание.
      showAnswer && spec.sayCorrect && !ctx.silent ? btn('▶', () => ctx.audio.play(spec.sayCorrect!), 'icon', { 'aria-label': 'Послушать ответ', 'data-nav': true, 'data-audio': 'answer' }) : null,
    ];
    if (right) feedback(v.cls, [verdictEl, ...answerParts]);
    else {
      // Ошибка объясняет (P-01): ответ, правило одной строкой, перевод — и только потом «Prawie. Jeszcze raz.».
      const rule = ruleLine(ctx, spec, c.tags);
      const gloss = ans ? glossLine(ctx, spec, ans) : null;
      // Реакция мира (P-06, СЮЖЕТ_v2 §1 п. 10): реплика NPC сцены на первую ошибку шага.
      const react = ctx.errLine && isFirst ? el('span', { class: 'react', 'data-fb': 'react' }, el('b', {}, `${ctx.errLine.who}: `), el('span', { lang: 'pl' }, ctx.errLine.pl), ctx.errLine.plRu ? el('small', { class: 'ru', lang: 'ru' }, ` ${ctx.errLine.plRu}`) : null) : null;
      feedback(v.cls, [
        react,
        ...answerParts,
        rule ? el('span', { class: 'rule', 'data-fb': 'rule' }, '💡 ', rule) : null,
        gloss ? el('span', { class: 'gloss', 'data-fb': 'gloss', lang: 'ru' }, gloss) : null,
        verdictEl,
      ]);
    }
    if (hintBtn) hintBtn.hidden = true;
    if (right || spec.noRetry || ctx.oneShot) {
      phase = 'feedback';
      ctx.react?.(right ? 'happy' : 'confused');
      show(nextBtn, true);
      show(retryBtn, false);
      show(skipBtn, false);
      checkBtn.hidden = true;
    } else {
      wrongs++;
      ctx.react?.('confused');
      phase = 'feedback';
      checkBtn.hidden = true;
      if (spec.instant) {
        // Выбор (P-12): неверный погашен, верный подсвечен, ниже правило — и «Dalej». Раньше кнопки не было и игрок
        // ждал, пока догадается тапнуть зелёный вариант. Повтор шага — в конце урока (planOf).
        show(nextBtn, true);
        show(skipBtn, false);
      } else {
        // Ввод: «Ещё раз» (обучающий повтор) и рядом «Dalej».
        show(retryBtn, true);
        show(laterBtn, true);
        show(skipBtn, false);
      }
    }
    changed();
    focusPrimary();
  }

  function retry(): void {
    if (phase !== 'feedback' || retryBtn.hidden) return;
    phase = 'answer';
    show(retryBtn, false);
    show(laterBtn, false);
    show(skipBtn, wrongs >= SKIP_AFTER);
    checkBtn.hidden = false;
    spec.reset?.();
    if (hintBtn) {
      hintBtn.hidden = false;
      hintBtn.disabled = false;
    }
    // Панель с правильным ответом остаётся: повтор обучающий, ответ можно подсмотреть.
    changed();
    spec.focus?.();
  }

  function finish(): void {
    if (phase === 'done') return;
    if (phase === 'answer' && skipBtn.hidden) return;
    phase = 'done';
    cleanup();
    const r: StepResult = { status: 'done', graded: true, attempts, ms: Math.round(ctx.now() - t0) };
    if (first) r.first = first;
    const parts = spec.parts?.();
    if (parts) r.parts = parts;
    if (spec.noAudio) r.noAudio = true;
    resolve(r);
  }

  function cancel(): void {
    if (phase === 'done') return;
    phase = 'done';
    cleanup();
    const r: StepResult = { status: 'cancel', graded: true, attempts, ms: Math.round(ctx.now() - t0) };
    if (first) r.first = first;
    resolve(r);
  }

  function cleanup(): void {
    kb?.detach();
    kb = null;
    ctx.layer.handle(null);
  }

  ctx.layer.handle({
    cancel: () => {
      cancel();
      return true;
    },
    interact: () => {
      // Фокус в поле: Enter ловит само поле (onEnter); «A» на d-pad сюда не доходит.
      return false;
    },
  });

  changed();
  // Автофокус только с клавиатурой (Mac, iPad с клавиатурой): на телефоне фокус не нужен и тянет экран.
  queueMicrotask(() => {
    if (phase !== 'answer' || ctx.coarse) return;
    if (spec.focus) spec.focus();
    else navItems(root)[0]?.focus({ preventScroll: true });
  });

  function skipNoAudio(): void {
    if (phase === 'done') return;
    phase = 'done';
    cleanup();
    resolve({ status: 'done', graded: false, attempts, noAudio: true, ms: Math.round(ctx.now() - t0) });
  }

  return {
    result,
    submit,
    changed,
    skipNoAudio,
    get phase() {
      return phase;
    },
  };
}

/** Шаг без проверки (say, explain, shadow): тело и «Дальше». */
export function runPlain(
  ctx: ExerciseCtx,
  head: (Node | string)[],
  body: HTMLElement,
  opts: { label?: PlLabel; onNext?: () => boolean } = {},
): { result: Promise<StepResult>; next: HTMLButtonElement } {
  const t0 = ctx.now();
  const { actions } = frame(ctx, head, body);
  let done = false;
  let resolve!: (r: StepResult) => void;
  const result = new Promise<StepResult>((r) => (resolve = r));
  const end = (status: 'done' | 'cancel'): void => {
    if (done) return;
    done = true;
    ctx.layer.handle(null);
    resolve({ status, graded: false, attempts: 0, ms: Math.round(ctx.now() - t0) });
  };
  const next = plBtn(opts.label ?? L.next, () => {
    if (opts.onNext && !opts.onNext()) return;
    end('done');
  }, 'primary', { 'data-primary': true, 'data-nav': true, 'data-act': 'next' });
  actions.append(el('span', { class: 'grow' }), next);
  ctx.layer.handle({
    cancel: () => {
      end('cancel');
      return true;
    },
  });
  queueMicrotask(() => {
    if (!done && !ctx.coarse) next.focus({ preventScroll: true });
  });
  return { result, next };
}
