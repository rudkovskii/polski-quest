// @vitest-environment happy-dom
// P-07: диалоги по новым правилам — коробки 2×40, гаснущая подпись по SRS, тап по слову, реплики
// Казика и рассказчика, выбор из двух с первого тапа.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProgress, getSetting, setSetting } from '../src/systems/progress';
import { buildWordIndex, captionHidden, captionMode, formKey, isFamiliar, isLatin, matchWords, tokenize } from '../src/systems/words';
import type { Dialogue, VocabEntry } from '../src/types/content';
import { runDialog, screenChoices, type DialogDeps } from '../src/ui/dialog';
import { BOX_COLS, captionsFor, sentences, splitBoxes, wrapLines } from '../src/ui/dialog/boxes';
import { lineBox, type WordPort } from '../src/ui/dialog/line';
import { createOverlay } from '../src/ui/overlay/host';
import { mountPlay } from '../src/ui/play';
import { setTodoVisible } from '../src/ui/todo';
import { act, fakeAudio, fixture, flush, memStore, testBus } from './overlayKit';

const VOCAB: Pick<VocabEntry, 'id' | 'pl' | 'ru' | 'tr' | 'forms' | 'pos'>[] = [
  { id: 'lx.dzien_dobry', pl: 'Dzień dobry', ru: 'здравствуйте', tr: 'джень до́бры', pos: 'phrase' },
  { id: 'lx.dzien', pl: 'dzień', ru: 'день', tr: 'джень', pos: 'noun' },
  { id: 'lx.kawa', pl: 'kawa', ru: 'кофе', tr: 'ка́ва', pos: 'noun', forms: { gen: 'kawy' } },
  { id: 'lx.maly', pl: 'mały', ru: 'маленький', tr: 'ма́ўы', pos: 'adj', forms: { f: 'mała' } },
  { id: 'lx.prosze', pl: 'proszę', ru: 'пожалуйста', tr: 'про́шэ', pos: 'phrase' },
  { id: 'lx.warszawa', pl: 'Warszawa', ru: 'Варшава', pos: 'name', forms: { acc: 'Warszawę' } },
];
const index = buildWordIndex(VOCAB);
const byId = new Map(VOCAB.map((v) => [v.id, v]));
const port = (known: readonly string[] = []): WordPort => ({
  index,
  vocab: (id) => byId.get(id) as VocabEntry | undefined,
  known: (id) => known.includes(id),
  ignore: (w) => w === 'Hela',
});

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
  setTodoVisible(false);
  vi.useRealTimers();
});

describe('коробки: до 2 строк по 40 знаков', () => {
  it('перенос по словам: строки ≤ 40, слово длиннее строки режется', () => {
    const lines = wrapLines('Ten kawałek się chwieje, więc podbijemy go jak pal przy moście nad Wisłą.');
    expect(lines.every((l) => l.length <= BOX_COLS)).toBe(true);
    expect(lines.join(' ')).toBe('Ten kawałek się chwieje, więc podbijemy go jak pal przy moście nad Wisłą.');
    expect(wrapLines('x'.repeat(45))).toEqual(['x'.repeat(40), 'xxxxx']);
  });

  it('короткая реплика — одна коробка; длинная режется по предложениям, каждая ≤ 2 строк', () => {
    expect(splitBoxes('Dzień dobry!')).toEqual([{ text: 'Dzień dobry!', sentEnd: 1 }]);
    const ru = 'Первая печать. Кривая, но наша. Это паспорт гостя. Печать ставит тот, с кем ты поговорил. Главная тут Прага.';
    const boxes = splitBoxes(ru);
    expect(boxes.length).toBe(2);
    for (const b of boxes) expect(wrapLines(b.text).length).toBeLessThanOrEqual(2);
    expect(boxes.map((b) => b.text).join(' ')).toBe(ru);
    // Коробка кончается на конце предложения.
    expect(boxes[0]!.text).toMatch(/[.!?]$/);
  });

  it('одно предложение длиннее коробки режется по словам, текст не теряется', () => {
    const s = 'Ten bardzo długi kawałek tekstu nie mieści się w jednej małej skrzynce dialogu i musi zostać podzielony na kilka części';
    const boxes = splitBoxes(s);
    expect(boxes.length).toBeGreaterThan(1);
    for (const b of boxes) expect(wrapLines(b.text).length).toBeLessThanOrEqual(2);
    expect(boxes.map((b) => b.text).join(' ')).toBe(s);
  });

  it('подпись: столько же предложений — делится по коробкам, иначе целиком под последней', () => {
    const pl = 'Pan bierze? Za darmo. To też za darmo, proszę pana bardzo. I pieczątka na pierwszej stronie. Gratis.';
    const boxes = splitBoxes(pl);
    expect(boxes.length).toBe(2);
    const caps = captionsFor(boxes, pl, 'Берёте? Даром. Это тоже даром, пожалуйста. И печать на первой странице. Бесплатно.');
    expect(caps.join(' ')).toBe('Берёте? Даром. Это тоже даром, пожалуйста. И печать на первой странице. Бесплатно.');
    expect(caps.every(Boolean)).toBe(true);
    const odd = captionsFor(boxes, pl, 'Берёте даром, и печать бесплатно.');
    expect(odd).toEqual([undefined, 'Берёте даром, и печать бесплатно.']);
    expect(sentences('Bóbr... bóbr... Nic się nie rymuje.')).toEqual(['Bóbr...', 'bóbr...', 'Nic się nie rymuje.']);
  });
});

describe('слова строки и правило гаснущей подписи', () => {
  it('разбор: фраза «Dzień dobry» целиком, формы из forms, имя, слова вне словаря без id', () => {
    expect(tokenize('Dzień dobry!').filter((t) => t.word).map((t) => t.text)).toEqual(['Dzień', 'dobry']);
    expect(formKey('Dzień dobry!')).toBe('dzień dobry');
    const spans = matchWords('Dzień dobry! Mała kawa, proszę. Jestem z Warszawy.', index);
    expect(spans.map((s) => [s.text, s.lx])).toEqual([
      ['Dzień dobry', 'lx.dzien_dobry'],
      ['Mała', 'lx.maly'],
      ['kawa', 'lx.kawa'],
      ['proszę', 'lx.prosze'],
      ['Jestem', undefined],
      ['z', undefined],
      ['Warszawy', undefined],
    ]);
    // Фраза только через пробел: «dzień.» отдельно.
    expect(matchWords('Dzień. Dobry.', index).map((s) => s.lx)).toEqual(['lx.dzien', undefined]);
  });

  it('разметка words: форма {pl, lx} и id слова; у Казика — только латиница', () => {
    const spans = matchWords('Jestem z Warszawy.', index, { refs: [{ pl: 'Warszawy', lx: 'lx.warszawa' }] });
    expect(spans.find((s) => s.text === 'Warszawy')).toMatchObject({ lx: 'lx.warszawa', marked: true });
    const kazik = matchWords('Скажи ей «Dzień dobry»: здравствуйте.', index, { only: isLatin });
    expect(kazik.map((s) => [s.text, s.lx])).toEqual([['Dzień dobry', 'lx.dzien_dobry']]);
    expect(isLatin('kawa')).toBe(true);
    expect(isLatin('кофе')).toBe(false);
  });

  it('знакомо: карточка rec с интервалом ≥ 3 дней; имена знакомы без карточек', () => {
    const card = (interval: number) => ({ reps: 2, interval, ef: 2.5, due: 0, lapses: 0, lastReviewAt: 0, lastGrade: 3 as const, maxInterval: interval, createdAt: 0 });
    expect(isFamiliar({ 'lx.kawa#rec': card(3) }, 'lx.kawa')).toBe(true);
    expect(isFamiliar({ 'lx.kawa#rec': card(1) }, 'lx.kawa')).toBe(false);
    expect(isFamiliar({ 'lx.kawa#lis': card(7) }, 'lx.kawa')).toBe(false);
    expect(isFamiliar({}, 'lx.warszawa', { pos: 'name' })).toBe(true);
  });

  it('подпись: always — видна, never — скрыта, auto — скрыта только если все значимые слова знакомы', () => {
    const spans = matchWords('Mała kawa, proszę.', index);
    const all = ['lx.maly', 'lx.kawa', 'lx.prosze'];
    expect(captionHidden('auto', spans, (x) => all.includes(x))).toBe(true);
    expect(captionHidden('auto', spans, (x) => x !== 'lx.prosze')).toBe(false);
    expect(captionHidden('always', spans, () => true)).toBe(false);
    expect(captionHidden('never', spans, () => false)).toBe(true);
    // Слово вне словаря держит подпись; имя — нет.
    const withUnknown = matchWords('Mała kawa, pani.', index);
    expect(captionHidden('auto', withUnknown, () => true)).toBe(false);
    const withName = matchWords('Mała kawa, Hela.', index);
    expect(captionHidden('auto', withName, () => true, { ignore: (w) => w === 'Hela' })).toBe(true);
    // Разметка words: значимы только размеченные.
    expect(captionHidden('auto', withUnknown, (x) => x === 'lx.kawa', { refs: ['lx.kawa'] })).toBe(true);
  });

  it('настройка: tap (до P-07) читается как «по ситуации», по умолчанию — по ситуации', () => {
    const p = newProgress(Date.UTC(2026, 9, 1), 'w');
    expect(getSetting(p, 'translations')).toBe('auto');
    const legacy = { ...p, settings: { translations: { value: 'tap', at: 1 } } } as unknown as typeof p;
    expect(getSetting(legacy, 'translations')).toBe('auto');
    expect(getSetting(setSetting(p, 'translations', 'never', 2), 'translations')).toBe('never');
    expect(captionMode('tap')).toBe('auto');
  });
});

describe('окно реплики P-07', () => {
  const sp = { id: 'pani_hela', name: 'pani Hela' };

  it('подпись под польской строкой; знакомые слова — подпись скрыта, «?» показывает', () => {
    const fresh = lineBox({ speaker: sp, pl: 'Mała kawa, proszę.', ru: 'Маленький кофе, пожалуйста.', audio: fakeAudio(), translations: 'auto', typeMs: 0, words: port() });
    expect(fresh.node.querySelector('[data-role="ru"]')?.textContent).toBe('Маленький кофе, пожалуйста.');
    expect(fresh.captionHidden).toBe(false);
    const learned = lineBox({ speaker: sp, pl: 'Mała kawa, proszę.', ru: 'Маленький кофе, пожалуйста.', audio: fakeAudio(), translations: 'auto', typeMs: 0, words: port(['lx.maly', 'lx.kawa', 'lx.prosze']) });
    expect(learned.captionHidden).toBe(true);
    expect(learned.node.querySelector('[data-role="ru"]')?.textContent).toBe('');
    expect(learned.node.querySelectorAll('.pq-w.known')).toHaveLength(3);
    act(learned.node, 'ru').click();
    expect(learned.node.querySelector('[data-role="ru"]')?.textContent).toBe('Маленький кофе, пожалуйста.');
    expect(learned.node.querySelector<HTMLElement>('[data-act="ru"]')?.hidden).toBe(true);
  });

  it('тап по слову: перевод и транскрипция из vocab; слова нет в словаре — перевод всей строки; тап мимо закрывает', () => {
    const v = lineBox({ speaker: sp, pl: 'Mała kawa, pani.', ru: 'Маленький кофе, пани.', audio: fakeAudio(), translations: 'auto', typeMs: 0, words: port() });
    host.append(v.node);
    const advanced: number[] = [];
    v.node.addEventListener('click', () => advanced.push(1));
    const word = (t: string) => [...v.node.querySelectorAll<HTMLElement>('.pq-w')].find((w) => w.textContent === t)!;
    word('kawa').click();
    const pop = v.node.querySelector<HTMLElement>('.pq-wpop')!;
    expect(pop.hidden).toBe(false);
    expect(pop.textContent).toContain('kawa');
    expect(pop.textContent).toContain('кофе');
    expect(pop.textContent).toContain('[ка́ва]');
    word('pani').click();
    expect(pop.textContent).toContain('Вся фраза: Маленький кофе, пани.');
    // Тап мимо слова при открытой всплывашке только закрывает её, коробку не листает.
    (v.node.querySelector('[data-role="ru"]') as HTMLElement).click();
    expect(pop.hidden).toBe(true);
    expect(advanced).toEqual([]);
    expect(v.advance()).toBe(false);
  });

  it('Казик: польская коробка с подписью, потом русская речь коробками; вкрапления подсвечены и тапаются', () => {
    const v = lineBox({
      speaker: { id: 'bobr', name: 'Kazimierz Bóbr' },
      pl: 'No proszę. Gość mówi!',
      ru: 'Ну надо же. Гость говорит!',
      rus: 'Вон ящик. Скажи ей «Dzień dobry»: здравствуйте. Первая печать. Кривая, но наша. Это паспорт гостя.',
      style: 'kazik',
      audio: fakeAudio(),
      translations: 'auto',
      typeMs: 0,
      words: port(),
    });
    host.append(v.node);
    expect(v.node.classList.contains('kazik')).toBe(true);
    expect(v.pages).toBe(3);
    expect(v.node.querySelector('[data-role="pl"]')?.textContent).toBe('No proszę. Gość mówi!');
    expect(v.node.querySelector('.pq-line-page')?.textContent).toBe('1/3');
    expect(v.advance()).toBe(true);
    const rus = v.node.querySelector<HTMLElement>('[data-role="rus"]')!;
    expect(rus.hidden).toBe(false);
    const ins = rus.querySelector<HTMLElement>('.pq-w')!;
    expect(ins.textContent).toBe('Dzień dobry');
    ins.click();
    expect(v.node.querySelector('.pq-wpop')?.textContent).toContain('здравствуйте');
    expect(v.advance()).toBe(true); // закрыть всплывашку
    expect(v.advance()).toBe(true); // третья коробка
    expect(v.atEnd).toBe(true);
    expect(v.advance()).toBe(false);
  });

  it('рассказчик: без портрета и имени; печать по буквам, тап дописывает, второй тап листает', () => {
    vi.useFakeTimers();
    const n = lineBox({ speaker: { id: 'narrator', name: 'Narrator' }, rus: 'Бобр. В Варшаве бывает.', style: 'narrator', audio: fakeAudio(), translations: 'auto' });
    expect(n.node.querySelector('.pq-line-who')).toBeNull();
    expect(n.node.dataset.style).toBe('narrator');
    expect(n.typing).toBe(true);
    expect(n.advance()).toBe(true); // дописать
    expect(n.node.querySelector('[data-role="rus"]')?.textContent).toBe('Бобр. В Варшаве бывает.');
    expect(n.advance()).toBe(false); // коробка одна: дальше — следующая реплика
    n.dispose();
  });
});

describe('диалог P-07: листание и выбор', () => {
  function deps(extra: Partial<DialogDeps> = {}) {
    const bus = testBus();
    const d: DialogDeps = { overlay: createOverlay(host, { bus }), content: fixture(), audio: fakeAudio(), typeMs: 0, reactMs: 0, coarse: true, words: port(), ...extra };
    return { d, bus };
  }

  it('первый тап по варианту выбирает, даже пока реплика печатается (баг «Start со второго тапа»)', async () => {
    const dlg: Dialogue = {
      id: 'dlg.demo.start',
      npc: 'pan_marek',
      start: 'a',
      nodes: { a: { who: 'pan_marek', pl: 'Cześć! Sprawdzimy, jak słyszysz Warszawę.', ru: 'Привет! Проверим, как ты слышишь Варшаву.', choices: [{ pl: 'Słucham!', ru: 'Слушаю!', next: 'b' }] }, b: { end: true } },
    };
    const { d } = deps({ typeMs: 30 });
    const p = runDialog(dlg, d);
    await flush();
    const box = host.querySelector('.pq-line') as HTMLElement;
    expect(host.querySelector('[data-role="pl"]')?.textContent?.length).toBeLessThan(10); // ещё печатается
    host.querySelector<HTMLButtonElement>('[data-choice="0"]')!.click();
    const out = await p;
    expect(out).toMatchObject({ ended: true, path: ['a', 'b'] });
    expect(box.isConnected).toBe(false);
  });

  it('длинная реплика листается коробками: тап, A/Enter (interact); варианты — на последней коробке', async () => {
    const dlg: Dialogue = {
      id: 'dlg.demo.long',
      npc: 'pan_marek',
      start: 'a',
      nodes: {
        a: {
          who: 'pan_marek',
          pl: 'Pan bierze? Za darmo. To też za darmo, proszę pana bardzo. I pieczątka na pierwszej stronie. Gratis.',
          ru: 'Берёте? Даром. Это тоже даром, пожалуйста. И печать на первой странице. Бесплатно.',
          choices: [
            { pl: 'Dziękuję!', ru: 'Спасибо!', next: 'b' },
            { pl: 'Nie, dziękuję.', ru: 'Нет, спасибо.', next: 'b' },
          ],
        },
        b: { end: true },
      },
    };
    const { d, bus } = deps();
    const p = runDialog(dlg, d);
    await flush();
    const choices = host.querySelector<HTMLElement>('.pq-dlg-choices')!;
    expect(choices.hidden).toBe(true);
    expect(host.querySelector('.pq-line-page')?.textContent).toBe('1/2');
    // Тап по коробке листает.
    (host.querySelector('.pq-line') as HTMLElement).click();
    expect(host.querySelector('.pq-line-page')?.textContent).toBe('2/2');
    expect(choices.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('[data-act="next"]')!.hidden).toBe(true);
    // Перевод варианта по «?», вариант не выбирается.
    const q = host.querySelector<HTMLButtonElement>('[data-act="choice-ru"]')!;
    const forIdx = q.dataset.for!;
    q.click();
    expect(host.querySelector(`[data-choice="${forIdx}"] .ru`)?.hasAttribute('hidden')).toBe(false);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect((await p).cancelled).toBe(true);

    // Клавиатура: Enter (interact) листает так же.
    const { d: d2, bus: bus2 } = deps({ coarse: false });
    const p2 = runDialog(dlg, d2);
    await flush();
    bus2.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    expect(host.querySelector('.pq-line-page')?.textContent).toBe('2/2');
    await flush();
    expect((document.activeElement as HTMLElement | null)?.dataset.choice).toBeDefined();
    bus2.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    expect((await p2).ended).toBe(true);
  });

  it('на экране не больше 2 вариантов; верный остаётся всегда; выбор с проверкой перемешан', () => {
    const list = [
      { c: { ok: false }, i: 0 },
      { c: { ok: false }, i: 1 },
      { c: { ok: false }, i: 2 },
      { c: { ok: true }, i: 3 },
    ];
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const out = screenChoices(list, seed);
      expect(out).toHaveLength(2);
      expect(out.some((x) => x.c.ok)).toBe(true);
    }
    // Вкусовой выбор (нет ok:false) — порядок контента.
    const taste = [{ c: {}, i: 0 }, { c: {}, i: 1 }, { c: {}, i: 2 }];
    expect(screenChoices(taste, 'x').map((x) => x.i)).toEqual([0, 1]);
    // Перемешивание по seed: при разных днях верный не всегда первый.
    const two = [{ c: { ok: true }, i: 0 }, { c: { ok: false }, i: 1 }];
    const firsts = new Set(['1', '2', '3', '4', '5', '6', '7', '8'].map((s) => screenChoices(two, `dlg#a:${s}`)[0]!.i));
    expect(firsts.size).toBe(2);
  });

  it('склейка: выученные слова (rec ≥ 3 дней) гасят подпись в диалоге', async () => {
    const content = fixture();
    const store = memStore();
    const t0 = Date.UTC(2026, 9, 1, 10);
    for (const item of ['lx.maly', 'lx.kawa']) {
      store.append({ k: 'intro', ts: t0, item, lesson: 'demo.s01', ok: ['rec', 'lis'] });
      store.append({ k: 'rev', ts: t0 + 86_400_000 + 3_600_000, card: `${item}#rec`, g: 3, ms: 1000, src: 'scene' });
    }
    const bus = testBus();
    const play = mountPlay(host, { content, store, bus, audio: fakeAudio(), coarse: true, typeMs: 0, clock: { now: () => t0 + 10 * 86_400_000, mono: () => 0 } });
    (content.dialogues as Map<string, { module: string; value: Dialogue }>).set('dlg.demo.p07', {
      module: 'demo',
      value: { id: 'dlg.demo.p07', npc: 'pan_marek', start: 'a', nodes: { a: { who: 'pan_marek', pl: 'Mała kawa?', ru: 'Маленький кофе?', words: [{ pl: 'Mała', lx: 'lx.maly' }, 'lx.kawa'], next: 'b' }, b: { who: 'pan_marek', pl: 'Kawa, stół?', ru: 'Кофе, стол?', end: true } } },
    });
    const p = play.openDialog('dlg.demo.p07');
    await flush();
    expect(host.querySelector('[data-role="ru"]')?.textContent).toBe('');
    expect(host.querySelector<HTMLElement>('[data-act="ru"]')?.hidden).toBe(false);
    act(host, 'next').click();
    await flush();
    // stół ещё не выучен — подпись видна.
    expect(host.querySelector('[data-role="ru"]')?.textContent).toBe('Кофе, стол?');
    act(host, 'next').click();
    await p;
    (content.dialogues as Map<string, unknown>).delete('dlg.demo.p07');
    play.dispose();
  });
});

describe('долгое нажатие на вариант (src/input/press.ts)', () => {
  it('держать ≥ 450 мс — перевод варианта, click после этого вариант не выбирает; короткий тап выбирает', async () => {
    vi.useFakeTimers();
    const dlg: Dialogue = {
      id: 'dlg.demo.press',
      npc: 'pan_marek',
      start: 'a',
      nodes: { a: { who: 'pan_marek', pl: 'Tak?', ru: 'Да?', choices: [{ pl: 'Dzień dobry!', ru: 'Здравствуйте!', next: 'b' }] }, b: { end: true } },
    };
    const bus = testBus();
    const d: DialogDeps = { overlay: createOverlay(host, { bus }), content: fixture(), audio: fakeAudio(), typeMs: 0, reactMs: 0, coarse: true };
    let done = false;
    const p = runDialog(dlg, d).then((o) => ((done = true), o));
    await vi.advanceTimersByTimeAsync(0);
    const b = host.querySelector<HTMLButtonElement>('[data-choice="0"]')!;
    const ev = (type: string) => new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    b.dispatchEvent(ev('pointerdown'));
    await vi.advanceTimersByTimeAsync(500);
    expect(b.querySelector('.ru')?.hasAttribute('hidden')).toBe(false);
    b.dispatchEvent(ev('pointerup'));
    b.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    // Короткий тап.
    b.dispatchEvent(ev('pointerdown'));
    await vi.advanceTimersByTimeAsync(100);
    b.dispatchEvent(ev('pointerup'));
    b.click();
    expect((await p).ended).toBe(true);
  });
});
