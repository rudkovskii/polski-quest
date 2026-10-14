// @vitest-environment happy-dom
// Типы шагов урока (I-08, ТЗ §3.5, §5.7): каждый — верный ответ, неверный (обучающий повтор),
// подсказка (grade ≤ 1 через hinted), отмена (Esc/«B»). Плюс навигация intents и реестр.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Step } from '../src/types/content';
import { RIGHT_LINE, WRONG_LINE } from '../src/ui/exercises/frame';
import { autoOptions, shuffled } from '../src/ui/exercises/options';
import { EXERCISES, mountStep } from '../src/ui/exercises/registry';
import type { ExerciseCtx, StepResult } from '../src/ui/exercises/types';
import { exerciseContent } from '../src/ui/lesson';
import { createOverlay } from '../src/ui/overlay/host';
import { act, byText, fakeAudio, fixture, flush, testBus, type } from './overlayKit';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function setup(step: Step, o: { audio?: boolean; random?: number; repeat?: boolean } = {}) {
  const bus = testBus();
  const overlay = createOverlay(host, { bus });
  const layer = overlay.open();
  const audio = fakeAudio(o.audio ?? true);
  let t = 0;
  const ctx: ExerciseCtx = {
    layer,
    root: layer.el,
    stepId: 'demo.t#0',
    content: exerciseContent(fixture()),
    audio,
    diacritics: 'warn',
    translations: 'tap',
    keyboardMode: 'auto',
    coarse: true,
    now: () => t,
    random: () => o.random ?? 0.2,
    typeMs: 0,
    ...(o.repeat ? { repeat: true } : {}),
  };
  let result: StepResult | null = null;
  const p = mountStep(step, ctx).then((r) => (result = r));
  const root = layer.el;
  return {
    root,
    bus,
    audio,
    p,
    get result() {
      return result;
    },
    tick(ms: number) {
      t += ms;
    },
    opt: (label: string) => byText(root, label),
    fb: () => root.querySelector('.pq-ex-fb') as HTMLElement,
    input: () => root.querySelector('input.pq-answer') as HTMLInputElement,
    cancel: () => bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' }),
    intent: (i: { type: 'interact' } | { type: 'move'; dir: 'up' | 'down' | 'left' | 'right'; held: true }) => bus.emit('input:intent', { ...i, to: 'ui', source: 'keyboard' }),
  };
}

async function done(s: ReturnType<typeof setup>): Promise<StepResult> {
  act(s.root, 'next').click();
  await s.p;
  return s.result!;
}

const choice: Step = { t: 'choice', q: 'stół это…', options: ['стол', 'стул'], answer: 0, item: 'lx.stol', tags: ['ff.stol'], errorTagByOption: { '1': 'ff.stol' } };

describe('реестр', () => {
  it('все 12 типов шагов ТЗ §3.5 зарегистрированы, проверяемые помечены', () => {
    expect(Object.keys(EXERCISES).sort()).toEqual(['choice', 'dictation', 'explain', 'gap', 'listen', 'match', 'minimal_pair', 'order', 'say', 'shadow', 'stress', 'type']);
    expect(Object.entries(EXERCISES).filter(([, m]) => !m.graded).map(([k]) => k).sort()).toEqual(['explain', 'say', 'shadow']);
  });

  it('перемешивание детерминировано по seed', () => {
    expect(shuffled([1, 2, 3, 4, 5], 'a')).toEqual(shuffled([1, 2, 3, 4, 5], 'a'));
    expect(shuffled([1, 2, 3, 4, 5], 'a').sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('choice', () => {
  it('верно: «Dobrze!», «Дальше», первая попытка exact со временем ответа', async () => {
    const s = setup(choice);
    s.tick(1200);
    s.opt('стол').click();
    expect(s.fb().textContent).toContain(RIGHT_LINE);
    const r = await done(s);
    expect(r).toMatchObject({ status: 'done', graded: true, attempts: 1, first: { verdict: 'exact', score: 1, ms: 1200, hinted: false } });
  });

  it('неверно: «Prawie. Jeszcze raz.», верный подсвечен, тег из errorTagByOption; повтор не в SRS', async () => {
    const s = setup(choice);
    s.opt('стул').click();
    expect(s.fb().textContent).toContain(WRONG_LINE);
    expect(s.fb().textContent).toContain('стол');
    expect(s.opt('стул').disabled).toBe(true);
    expect(s.opt('стол').classList.contains('show')).toBe(true);
    expect(s.fb().textContent).not.toMatch(/неправильно/i);
    s.opt('стол').click();
    const r = await done(s);
    expect(r.attempts).toBe(2);
    expect(r.first).toMatchObject({ verdict: 'wrong', score: 0, tags: ['ff.stol'] });
  });

  it('подсказка до ответа → hinted (grade ≤ 1)', async () => {
    const s = setup({ ...choice, options: ['стол', 'стул', 'стал'] });
    act(s.root, 'hint').click();
    expect(s.fb().textContent).toContain('лишний');
    expect(s.root.querySelectorAll('[data-opt]:disabled').length).toBe(1);
    s.opt('стол').click();
    expect((await done(s)).first?.hinted).toBe(true);
  });

  it('подсказка из контента (`hint`) показывается как есть', async () => {
    const s = setup({ ...choice, hint: 'стул по-польски krzesło' });
    act(s.root, 'hint').click();
    expect(s.fb().textContent).toContain('krzesło');
  });

  it('отмена (Esc / «B») до ответа → status cancel', async () => {
    const s = setup(choice);
    s.cancel();
    await s.p;
    expect(s.result).toMatchObject({ status: 'cancel', attempts: 0 });
    expect(s.result!.first).toBeUndefined();
  });

  it('клавиатура: стрелка двигает выбор, interact (Enter/«A») выбирает, второй interact = «Дальше»', async () => {
    const s = setup(choice);
    await flush();
    s.intent({ type: 'move', dir: 'down', held: true });
    expect(document.activeElement?.textContent).toBe('стол');
    s.intent({ type: 'move', dir: 'down', held: true });
    expect(document.activeElement?.textContent).toBe('стул');
    s.intent({ type: 'move', dir: 'up', held: true });
    s.intent({ type: 'interact' });
    expect(s.fb().textContent).toContain(RIGHT_LINE);
    expect(document.activeElement?.textContent).toBe('Дальше');
    s.intent({ type: 'interact' });
    await s.p;
    expect(s.result?.status).toBe('done');
  });

  it('после двух ошибок можно пропустить', async () => {
    const s = setup({ ...choice, options: ['стол', 'стул', 'стал'] });
    s.opt('стул').click();
    expect(s.root.querySelector<HTMLElement>('[data-act="skip"]')!.hidden).toBe(true);
    s.opt('стал').click();
    act(s.root, 'skip').click();
    await s.p;
    expect(s.result).toMatchObject({ status: 'done', attempts: 2, first: { verdict: 'wrong' } });
  });

  it('повтор в конце урока — без подсказки', () => {
    const s = setup(choice, { repeat: true });
    expect(s.root.querySelector('[data-act="hint"]')).toBeNull();
  });
});

describe('listen', () => {
  const step: Step = { t: 'listen', say: 'mała kawa', options: ['mała kawa', 'mala kawa', 'mała kava'], answer: 0, item: 'lx.maly' };

  it('фраза звучит сразу; верно', async () => {
    const s = setup(step);
    expect(s.audio.played[0]).toEqual({ text: 'mała kawa' });
    s.opt('mała kawa').click();
    expect((await done(s)).first?.verdict).toBe('exact');
  });

  it('неверно → повтор фразы, транскрипция и ▶ в панели', async () => {
    const s = setup(step);
    s.opt('mala kawa').click();
    expect(s.fb().textContent).toContain(WRONG_LINE);
    expect(s.fb().textContent).toContain('[ма́ўы]');
    expect(s.audio.played.length).toBe(2);
    s.opt('mała kawa').click();
    expect((await done(s)).attempts).toBe(2);
  });

  it('переслушать ▶ не штрафует; подсказка — медленно и минус вариант', async () => {
    const s = setup(step);
    s.root.querySelector<HTMLButtonElement>('[data-audio="play"]')!.click();
    act(s.root, 'hint').click();
    expect(s.audio.played.at(-1)).toEqual({ text: 'mała kawa', slow: true });
    s.opt('mała kawa').click();
    expect((await done(s)).first).toMatchObject({ verdict: 'exact', hinted: true });
  });

  it('нет звука → текстовый аналог, noAudio (lis не пишется)', async () => {
    const s = setup(step, { audio: false });
    expect(s.audio.played).toEqual([]);
    expect(s.root.textContent).toContain('звука нет');
    expect(s.root.querySelector('.pq-ex-head')!.textContent).toContain('mała kawa');
    s.opt('mała kawa').click();
    expect((await done(s)).noAudio).toBe(true);
  });

  it('auto:<tag> — дистракторы из vocab детерминированно, верный = say', () => {
    const a = autoOptions({ t: 'listen', say: 'kawa', options: 'auto:kawiarnia', answer: 0, item: 'lx.kawa' }, 'demo.s01#3', exerciseContent(fixture()));
    expect(a.options).toHaveLength(3);
    expect(a.options[a.answer]).toBe('kawa');
    expect(new Set(a.options).size).toBe(3);
    expect(autoOptions({ t: 'listen', say: 'kawa', options: 'auto:kawiarnia', answer: 0 }, 'demo.s01#3', exerciseContent(fixture())).options).toEqual(
      autoOptions({ t: 'listen', say: 'kawa', options: 'auto:kawiarnia', answer: 0 }, 'demo.s01#3', exerciseContent(fixture())).options,
    );
  });

  it('отмена', async () => {
    const s = setup(step);
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });
});

describe('minimal_pair', () => {
  const step: Step = { t: 'minimal_pair', pair: ['łata', 'lata'], play: 'random', cluster: 'R3', item: 'mp.lata_lata' };

  it('play random < 0.5 → звучит pair[0]; верно', async () => {
    const s = setup(step, { random: 0.2 });
    expect(s.audio.played).toEqual([{ text: 'łata' }]);
    s.opt('łata').click();
    expect((await done(s)).first?.verdict).toBe('exact');
  });

  it('неверно → тег кластера, звук ещё раз', async () => {
    const s = setup(step, { random: 0.7 });
    expect(s.audio.played).toEqual([{ text: 'lata' }]);
    s.opt('łata').click();
    expect(s.fb().textContent).toContain(WRONG_LINE);
    s.opt('lata').click();
    const r = await done(s);
    expect(r.first?.tags).toEqual(['R3']);
    expect(s.audio.played.length).toBe(2);
  });

  it('same_diff: два слова, «Одинаковые / Разные»; подсказка медленно', async () => {
    const s = setup({ ...step, play: 1, mode: 'same_diff' } as Step);
    expect(s.audio.played.map((x) => x.text)).toEqual(['łata', 'lata']);
    act(s.root, 'hint').click();
    expect(s.audio.played.slice(-2).every((x) => x.slow)).toBe(true);
    s.opt('Разные').click();
    expect((await done(s)).first).toMatchObject({ verdict: 'exact', hinted: true });
  });

  it('нет звука → noAudio; отмена', async () => {
    const s = setup(step, { audio: false });
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });
});

describe('stress', () => {
  const step: Step = { t: 'stress', word: 'telefon', syllables: ['te', 'le', 'fon'], answer: 1 };
  it('верно / неверно (тег R1) / подсказка / отмена', async () => {
    let s = setup(step);
    s.opt('le').click();
    expect((await done(s)).first?.verdict).toBe('exact');

    s = setup(step);
    s.opt('fon').click();
    expect(s.fb().textContent).toContain('te·LE·fon');
    s.opt('le').click();
    expect((await done(s)).first?.tags).toEqual(['R1']);

    s = setup(step);
    act(s.root, 'hint').click();
    expect(s.fb().textContent).toContain('предпоследнем');
    s.opt('le').click();
    expect((await done(s)).first?.hinted).toBe(true);

    s = setup(step);
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });
});

describe('type', () => {
  const step: Step = { t: 'type', prompt: 'Маленький кофе, пожалуйста.', accept: ['Mała kawa, proszę.'], item: 'lx.maly' };

  it('экранная клавиатура подключена: полоска диакритики над полем', () => {
    const s = setup(step);
    expect(s.root.querySelector('.pq-kb-strip')?.textContent).toContain('ą');
    expect(s.input().getAttribute('lang')).toBe('pl');
    expect(s.input().getAttribute('autocapitalize')).toBe('off');
  });

  it('«Проверить» неактивна без ответа; верно; Enter в поле = «Проверить», второй Enter = «Дальше»', async () => {
    const s = setup(step);
    expect(act(s.root, 'check').disabled).toBe(true);
    type(s.input(), 'mała kawa proszę');
    expect(act(s.root, 'check').disabled).toBe(false);
    s.input().dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
    expect(s.fb().textContent).toContain(RIGHT_LINE);
    s.input().dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
    await s.p;
    expect(s.result).toMatchObject({ status: 'done', first: { verdict: 'exact' } });
  });

  it('без диакритики (warn) — засчитано частично, показан правильный', async () => {
    const s = setup(step);
    type(s.input(), 'Mala kawa, prosze');
    act(s.root, 'check').click();
    expect(s.fb().className).toContain('part');
    expect(s.fb().textContent).toContain('Mała kawa, proszę.');
    expect((await done(s)).first).toMatchObject({ verdict: 'diacritics', score: 0.75 });
  });

  it('неверно → «Ещё раз» очищает поле; верно со второй попытки', async () => {
    const s = setup(step);
    type(s.input(), 'duża kawa');
    act(s.root, 'check').click();
    expect(s.fb().textContent).toContain(WRONG_LINE);
    act(s.root, 'retry').click();
    expect(s.input().value).toBe('');
    type(s.input(), 'Mała kawa, proszę');
    act(s.root, 'check').click();
    const r = await done(s);
    expect(r).toMatchObject({ attempts: 2, first: { verdict: 'wrong' } });
  });

  it('подсказка: первая буква и длина; отмена', async () => {
    let s = setup(step);
    act(s.root, 'hint').click();
    expect(s.fb().textContent).toContain('M _ _ _');
    type(s.input(), 'Mała kawa, proszę.');
    act(s.root, 'check').click();
    expect((await done(s)).first?.hinted).toBe(true);
    s = setup(step);
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });
});

describe('dictation', () => {
  const step: Step = { t: 'dictation', say: 'stół', accept: ['stół'], item: 'lx.stol', slowFirst: true };
  it('slowFirst: первый раз медленно; верно; неверно (ortho → частично); подсказка; отмена', async () => {
    let s = setup(step);
    expect(s.audio.played[0]).toEqual({ text: 'stół', slow: true });
    expect(s.root.querySelector('.pq-kb-strip')).not.toBeNull();
    type(s.input(), 'stół');
    act(s.root, 'check').click();
    expect((await done(s)).first?.verdict).toBe('exact');

    s = setup(step);
    type(s.input(), 'stuł');
    act(s.root, 'check').click();
    expect((await done(s)).first).toMatchObject({ verdict: 'ortho', score: 0.5 });

    s = setup(step);
    type(s.input(), 'krzesło');
    act(s.root, 'check').click();
    expect(s.fb().textContent).toContain(WRONG_LINE);
    act(s.root, 'retry').click();
    expect(s.audio.played.length).toBe(2); // повтор фразы перед новой попыткой

    s = setup(step);
    act(s.root, 'hint').click();
    expect(s.audio.played.at(-1)).toEqual({ text: 'stół', slow: true });
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });

  it('нет звука → переписать текст, noAudio', async () => {
    const s = setup(step, { audio: false });
    type(s.input(), 'stół');
    act(s.root, 'check').click();
    expect((await done(s)).noAudio).toBe(true);
  });
});

describe('gap', () => {
  const withOpts: Step = { t: 'gap', text: 'Mała ___, proszę.', answer: 'kawa', options: ['kawa', 'kava'] };
  const typed: Step = { t: 'gap', text: 'Mała ___, proszę.', answer: 'kawa' };

  it('варианты: верно заполняет пропуск; неверно; подсказка; отмена', async () => {
    let s = setup(withOpts);
    expect(s.root.querySelector('.pq-gap')?.textContent).toContain('Mała');
    s.opt('kawa').click();
    expect(s.root.querySelector('.slot')?.textContent).toBe('kawa');
    expect((await done(s)).first?.verdict).toBe('exact');

    s = setup(withOpts);
    s.opt('kava').click();
    expect(s.fb().textContent).toContain(WRONG_LINE);
    s.opt('kawa').click();
    expect((await done(s)).attempts).toBe(2);

    s = setup(withOpts);
    act(s.root, 'hint').click();
    expect(s.fb().textContent).toContain('«k»');
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });

  it('ввод с клавиатурой: поле пишет в пропуск', async () => {
    const s = setup(typed);
    expect(s.root.querySelector('.pq-kb-strip')).not.toBeNull();
    type(s.input(), 'kawa');
    expect(s.root.querySelector('.slot')?.textContent).toBe('kawa');
    act(s.root, 'check').click();
    expect((await done(s)).first?.verdict).toBe('exact');
  });
});

describe('order', () => {
  const step: Step = { t: 'order', prompt: 'Маленький кофе, пожалуйста.', tiles: ['Mała', 'kawa', 'proszę', 'Mały', 'kawę'], answer: ['Mała', 'kawa', 'proszę'], item: 'lx.maly' };
  const tile = (root: HTMLElement, text: string): HTMLButtonElement => [...root.querySelectorAll<HTMLButtonElement>('[data-tile]')].find((b) => b.textContent === text)!;
  const line = (root: HTMLElement): string[] => [...root.querySelectorAll('.pq-order-line [data-tile]')].map((b) => b.textContent!);

  it('тап переносит плитку в строку и обратно; верно', async () => {
    const s = setup(step);
    for (const w of ['Mała', 'kawa', 'Mały']) tile(s.root, w).click();
    expect(line(s.root)).toEqual(['Mała', 'kawa', 'Mały']);
    tile(s.root, 'Mały').click();
    tile(s.root, 'proszę').click();
    expect(line(s.root)).toEqual(['Mała', 'kawa', 'proszę']);
    act(s.root, 'check').click();
    expect((await done(s)).first?.verdict).toBe('exact');
  });

  it('неверно (ловушка Mały) → «Ещё раз» возвращает плитки; подсказка ставит первую', async () => {
    const s = setup(step);
    for (const w of ['Mały', 'kawa', 'proszę']) tile(s.root, w).click();
    act(s.root, 'check').click();
    expect(s.fb().textContent).toContain('Mała kawa proszę');
    act(s.root, 'retry').click();
    expect(line(s.root)).toEqual([]);
    act(s.root, 'hint').click();
    expect(line(s.root)).toEqual(['Mała']);
    for (const w of ['kawa', 'proszę']) tile(s.root, w).click();
    act(s.root, 'check').click();
    expect((await done(s)).attempts).toBe(2);
  });

  it('`alt` принимается; отмена', async () => {
    let s = setup({ ...step, alt: [['proszę', 'Mała', 'kawa']] });
    for (const w of ['proszę', 'Mała', 'kawa']) tile(s.root, w).click();
    act(s.root, 'check').click();
    expect((await done(s)).first?.verdict).toBe('exact');
    s = setup(step);
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });
});

describe('match', () => {
  const step: Step = { t: 'match', pairs: [['mały', 'маленький'], ['stół', 'стол'], ['słucham', 'слушаю']], items: ['lx.maly', 'lx.stol', 'lx.slucham'] };
  it('все пары верно → exact, parts ok; ошибка пары → эта пара не с первого раза', async () => {
    let s = setup(step);
    for (const [pl, ru] of step.t === 'match' ? step.pairs : []) {
      s.opt(pl).click();
      s.opt(ru).click();
    }
    let r = await done(s);
    expect(r.first?.verdict).toBe('exact');
    expect(r.parts?.every((p) => p.ok)).toBe(true);

    s = setup(step);
    s.opt('stół').click();
    s.opt('слушаю').click(); // промах
    expect(s.opt('stół').disabled).toBe(false);
    s.opt('стол').click(); // перевод первым — тоже можно
    s.opt('stół').click();
    s.opt('mały').click();
    s.opt('маленький').click();
    s.opt('słucham').click();
    s.opt('слушаю').click();
    expect(s.fb().textContent).toContain('Prawie.');
    expect(s.fb().textContent).not.toContain('Jeszcze raz');
    r = await done(s);
    expect(r.parts).toEqual([
      { item: 'lx.maly', ok: true },
      { item: 'lx.stol', ok: false },
      { item: 'lx.slucham', ok: true },
    ]);
  });

  it('подсказка подсвечивает пару; отмена', async () => {
    const s = setup(step);
    act(s.root, 'hint').click();
    expect(s.root.querySelectorAll('.pq-match .show').length).toBe(2);
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });
});

describe('say, explain, shadow (без проверки)', () => {
  it('say: имя, польская строка, перевод по тапу (это и есть «подсказка»), «Дальше»', async () => {
    const s = setup({ t: 'say', who: 'pan_marek', pl: 'Słucham?', ru: 'Слушаю?' });
    expect(s.root.textContent).toContain('pan Marek');
    expect(s.root.querySelector('[data-role="pl"]')?.textContent).toBe('Słucham?');
    expect(s.root.querySelector('[data-role="ru"]')?.textContent).toBe('');
    act(s.root, 'ru').click();
    expect(s.root.querySelector('[data-role="ru"]')?.textContent).toBe('Слушаю?');
    expect(s.audio.played[0]?.text).toBe('Słucham?');
    const r = await done(s);
    expect(r).toMatchObject({ status: 'done', graded: false });
  });

  it('say: отмена', async () => {
    const s = setup({ t: 'say', who: 'pan_marek', pl: 'Słucham?' });
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });

  it('explain: жирный из **…**, таблица; отмена', async () => {
    let s = setup({ t: 'explain', md: '**ł** = [ў]', table: [['ł', 'w']] });
    expect(s.root.querySelector('.pq-md b')?.textContent).toBe('ł');
    expect(s.root.querySelectorAll('td').length).toBe(2);
    expect((await done(s)).graded).toBe(false);
    s = setup({ t: 'explain', md: 'x' });
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });

  it('shadow: «Повторил» нужно нажать repeat раз, каждый раз фраза звучит снова; отмена', async () => {
    let s = setup({ t: 'shadow', pl: 'Mała kawa, proszę.', repeat: 2, slow: true });
    expect(s.audio.played).toEqual([{ text: 'Mała kawa, proszę.', slow: true }]);
    act(s.root, 'next').click();
    expect(s.result).toBeNull();
    expect(act(s.root, 'next').textContent).toBe('Повторил (1/2)');
    expect(s.audio.played.length).toBe(2);
    act(s.root, 'next').click();
    await s.p;
    expect(s.result).toMatchObject({ status: 'done', graded: false });
    s = setup({ t: 'shadow', pl: 'x', repeat: 1 });
    s.cancel();
    await s.p;
    expect(s.result?.status).toBe('cancel');
  });
});
