// @vitest-environment happy-dom
// Диалог (I-08, ТЗ §3.6, §5.6) и склейка world:interact → оверлей (ui/play.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dialogue } from '../src/types/content';
import { runDialog, runLines, speechOfLine, type DialogDeps } from '../src/ui/dialog';
import { lineBox, todoText } from '../src/ui/dialog/line';
import { createOverlay } from '../src/ui/overlay/host';
import { setTodoVisible } from '../src/ui/todo';
import { bobrLine } from '../src/ui/obchod';
import { mountPlay, portraitSourceFrom, wordStep } from '../src/ui/play';
import { act, byText, fakeAudio, fixture, flush, memStore, testBus } from './overlayKit';

const content = fixture();
const marek = content.dialogues.get('dlg.demo.marek')!.value;

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  setTodoVisible(true); // dev: заглушки видны; игра (по умолчанию) — отдельный describe ниже
});
afterEach(() => {
  host.remove();
  setTodoVisible(false);
});

function setup(extra: Partial<DialogDeps> = {}) {
  const bus = testBus();
  const input: boolean[] = [];
  bus.on('world:input', ({ enabled }) => input.push(enabled));
  const lessons: string[] = [];
  const audio = fakeAudio();
  const d: DialogDeps = {
    overlay: createOverlay(host, { bus }),
    content,
    audio,
    typeMs: 0,
    reactMs: 0,
    coarse: true,
    runLesson: async (id) => {
      lessons.push(id);
      return { passed: true };
    },
    ...extra,
  };
  return { d, bus, input, lessons, audio };
}

const pl = (): string => host.querySelector('[data-role="pl"]')?.textContent ?? '';
const next = async (): Promise<void> => {
  act(host, 'next').click();
  await flush();
};

describe('runDialog: граф dlg.demo.marek', () => {
  it('неверный выбор → тег ошибки и реакция NPC, назад к узлу; верный → урок узла, эффекты line (todo) и startLesson, end', async () => {
    const { d, input, lessons } = setup({ reactMs: 60 });
    const p = runDialog(marek, d);
    await flush();
    expect(input).toEqual([false]);
    expect(host.querySelector('.pq-line-name')?.textContent).toBe('pan Marek');
    expect(pl()).toBe('Słucham?');
    byText(host, 'Mała kava, proszę.').click();
    await flush();
    expect(host.querySelector('.pq-portrait')?.getAttribute('data-react')).toBe('confused');
    expect(host.querySelector('.pq-emote')?.textContent).toBe('?');
    await new Promise((r) => setTimeout(r, 80));
    expect(pl()).toBe('Słucham?'); // next: "a" — та же реплика снова
    byText(host, 'Mała kawa, proszę.').click();
    await flush();
    expect(host.querySelector('.pq-portrait')?.getAttribute('data-react')).toBe('happy');
    await new Promise((r) => setTimeout(r, 80));
    expect(lessons).toEqual(['demo.s01']);
    // узел c: эффект line → заглушка bobr.after_kawa
    expect(pl()).toBe(todoText('bobr.after_kawa'));
    expect(host.querySelector('.pq-line-name')?.textContent).toBe('Kazimierz Bóbr');
    await next();
    const out = await p;
    expect(lessons).toEqual(['demo.s01', 'demo.boss']);
    expect(out).toMatchObject({ ended: true, cancelled: false, path: ['a', 'a', 'b', 'c'], errorTags: ['R3'] });
    expect(input).toEqual([false, true]);
    expect(host.querySelector('.pq-layer')).toBeNull();
  });

  it('Esc / «B» закрывает диалог (cancelled), мир снова включён', async () => {
    const { d, bus, input } = setup();
    const p = runDialog(marek, d);
    await flush();
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'dpad' });
    const out = await p;
    expect(out).toMatchObject({ cancelled: true, ended: false });
    expect(input).toEqual([false, true]);
  });

  it('урок, прерванный внутри диалога, прерывает и диалог', async () => {
    const { d } = setup({ runLesson: async () => ({ passed: false, cancelled: true }) });
    const p = runDialog(marek, d);
    await flush();
    byText(host, 'Mała kawa, proszę.').click();
    expect((await p).cancelled).toBe(true);
  });

  it('узел без текста = заглушка [todo: dlg.узел]; варианты с ложным if скрыты', async () => {
    const dlg: Dialogue = {
      id: 'dlg.demo.t',
      npc: 'pan_marek',
      start: 'a',
      nodes: {
        a: { who: 'pan_marek', next: 'b' },
        b: {
          who: 'pan_marek',
          pl: 'Dzień dobry!',
          choices: [
            { pl: 'Dzień dobry!', next: 'c', if: { flag: 'nope' } },
            { pl: 'Cześć!', next: 'c', ok: true, react: 'laugh' },
          ],
        },
        c: { who: 'pan_marek', pl: 'No.', end: true },
      },
    };
    const { d } = setup({ cond: (c) => !('flag' in c), reactMs: 60 });
    const p = runDialog(dlg, d);
    await flush();
    expect(pl()).toBe('[todo: dlg.demo.t.a]');
    expect(host.querySelector('[data-role="pl"]')?.classList.contains('todo')).toBe(true);
    await next();
    expect(host.querySelectorAll('[data-choice]')).toHaveLength(1);
    byText(host, 'Cześć!').click();
    await flush();
    expect(host.querySelector('.pq-portrait')?.getAttribute('data-react')).toBe('laugh');
    await new Promise((r) => setTimeout(r, 80));
    expect(pl()).toBe('No.');
    await next();
    expect((await p).path).toEqual(['a', 'b', 'c']);
  });

  it('клавиатура: interact на варианте выбирает, на реплике — «дальше»', async () => {
    const { d, bus } = setup({ coarse: false });
    const p = runDialog(marek, d);
    await flush();
    expect(document.activeElement?.textContent).toContain('Mała kawa, proszę.');
    bus.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    await flush(5);
    // c: заглушка line, кнопка ▼ в фокусе
    expect(pl()).toBe('[todo: bobr.after_kawa]');
    bus.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    expect((await p).ended).toBe(true);
  });
});

describe('окно реплики', () => {
  it('перевод скрыт до тапа (translations: tap) и виден сразу при always; ▶ и «медленно» шлют озвучку', () => {
    const audio = fakeAudio();
    const v = lineBox({ speaker: { id: 'pan_marek', name: 'pan Marek' }, pl: 'Słucham?', ru: 'Слушаю?', audio, translations: 'tap', typeMs: 0 });
    host.append(v.node);
    expect(v.node.querySelector('[data-role="ru"]')?.textContent).toBe('');
    act(v.node, 'ru').click();
    expect(v.node.querySelector('[data-role="ru"]')?.textContent).toBe('Слушаю?');
    v.node.querySelector<HTMLButtonElement>('[data-audio="slow"]')!.click();
    expect(audio.played).toEqual([{ text: 'Słucham?', slow: true }]);
    const w = lineBox({ speaker: { id: 'x', name: 'X' }, pl: 'a', ru: 'б', audio, translations: 'always', typeMs: 0 });
    expect(w.node.querySelector('[data-role="ru"]')?.textContent).toBe('б');
  });

  it('строка печатается; skip показывает целиком; нет звука — иконка, текст виден', () => {
    vi.useFakeTimers();
    const v = lineBox({ speaker: { id: 'x', name: 'X' }, pl: 'Dzień dobry', audio: fakeAudio(false), translations: 'tap', typeMs: 30 });
    expect(v.typing).toBe(true);
    expect(v.skip()).toBe(true);
    expect(v.node.querySelector('[data-role="pl"]')?.textContent).toBe('Dzień dobry');
    expect(v.skip()).toBe(false);
    expect(v.node.textContent).toContain('🔇');
    v.dispose();
    vi.useRealTimers();
  });

  it('портрет: кадр атласа с целым масштабом; без портрета — голова спрайта; без атласа — силуэт (P-01)', () => {
    const atlas = { frames: { 'extra_m/0': { frame: { x: 10, y: 20, w: 16, h: 16 } }, 'dima/1': { frame: { x: 19, y: 1, w: 16, h: 32 } } }, meta: { size: { w: 256, h: 128 }, image: 'custom.png' } };
    const sprites = { extra_m: { size: [16, 16] as [number, number], frames: ['extra_m/0'], anims: { idle_down: ['extra_m/0'] } }, dima: { size: [16, 32] as [number, number], frames: ['dima/0'], anims: { idle_down: ['dima/1'] } } };
    const src = portraitSourceFrom(atlas, sprites, '/base/', content);
    expect(src('pan_marek')).toEqual({ url: '/base/atlas/custom.png', sheet: [256, 128], rect: [10, 20, 16, 16] });
    expect(src('dima')?.rect).toEqual([19, 1, 16, 16]);
    expect(src('simba')).toBeNull();
    const v = lineBox({ speaker: { id: 'pan_marek', name: 'pan Marek' }, pl: 'x', audio: fakeAudio(), translations: 'tap', typeMs: 0, portraits: src });
    expect(v.portrait.querySelector<HTMLElement>('.pix')!.style.width).toBe('48px'); // 16 × 3
    const u = lineBox({ speaker: { id: 'pan_marek', name: 'pan Marek' }, pl: 'x', audio: fakeAudio(), translations: 'tap', typeMs: 0 });
    expect(u.portrait.textContent).toBe('');
    expect(u.portrait.dataset.fallback).toBe('silhouette');
    expect(u.portrait.querySelector('.sil .head')).not.toBeNull();
  });

  it('speechOfLine: todo-строка и неизвестный id → заглушка', () => {
    expect(speechOfLine('bobr.after_kawa', content.lines)).toEqual({ who: 'bobr', todo: 'bobr.after_kawa' });
    expect(speechOfLine('nope', content.lines)).toEqual({ who: 'bobr', todo: 'nope' });
  });

  it('speechOfLine (I-11): pl + перевод plRu по тапу + русская речь ru сразу; только ru — одной строкой', () => {
    const lines = new Map([
      ['k.a', { id: 'k.a', who: 'bobr', pl: 'Zator.', plRu: 'Затор.', ru: 'Брёвна сбились.' }],
      ['k.b', { id: 'k.b', who: 'bobr', ru: 'Успеем построить ещё один мост.' }],
      ['k.c', { id: 'k.c', who: 'bobr', pl: 'Ja wysiadam.', plRu: 'Я выхожу.' }],
    ]);
    expect(speechOfLine('k.a', lines)).toEqual({ who: 'bobr', pl: 'Zator.', ru: 'Затор.', rus: 'Брёвна сбились.' });
    expect(speechOfLine('k.b', lines)).toEqual({ who: 'bobr', rus: 'Успеем построить ещё один мост.' });
    expect(speechOfLine('k.c', lines)).toEqual({ who: 'bobr', pl: 'Ja wysiadam.', ru: 'Я выхожу.' });
  });

  it('узлы I-11: line (говорящий из реплики, русская речь видна), todo: true → заглушка, чистый end без who молчит', async () => {
    const lines = new Map(content.lines);
    lines.set('k.a', { id: 'k.a', who: 'bobr', pl: 'Zator.', plRu: 'Затор.', ru: 'Брёвна сбились.' });
    const { d } = setup({ content: { characters: content.characters, lines } });
    const dlg: Dialogue = {
      id: 'dlg.demo.i11',
      npc: 'pan_marek',
      start: 'a',
      nodes: { a: { line: 'k.a', next: 'b' }, b: { who: 'pan_marek', todo: true, next: 'c' }, c: { end: true } },
    };
    const p = runDialog(dlg, d);
    await flush();
    expect(host.querySelector('.pq-line-name')?.textContent).toBe('Kazimierz Bóbr');
    expect(pl()).toBe('Zator.');
    expect(host.querySelector('[data-role="rus"]')?.textContent).toBe('Брёвна сбились.');
    await next();
    expect(pl()).toBe(todoText('dlg.demo.i11.b'));
    await next();
    expect(await p).toMatchObject({ ended: true, path: ['a', 'b', 'c'] });
    expect(host.querySelector('.pq-layer')).toBeNull();
  });

  it('runLines показывает реплики по очереди; отмена → false', async () => {
    const { d, bus } = setup();
    const p = runLines([{ who: 'bobr', todo: 'bobr.meets' }, { who: 'pan_marek', pl: 'Słucham?' }], d);
    await flush();
    expect(pl()).toBe('[todo: bobr.meets]');
    await next();
    expect(pl()).toBe('Słucham?');
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(await p).toBe(false);
  });
});

describe('склейка world:interact → оверлей (ui/play)', () => {
  function play() {
    const bus = testBus();
    const store = memStore();
    const events: string[] = [];
    const lessonEnd: string[] = [];
    bus.on('ui:lesson:end', ({ lessonId }) => lessonEnd.push(lessonId));
    bus.on('progress:changed', ({ kinds }) => events.push(kinds.join()));
    const pl0 = mountPlay(host, { content, store, bus, audio: fakeAudio(), coarse: true, typeMs: 0 });
    return { bus, store, play: pl0, events, lessonEnd };
  }
  const base = { location: 'demo.kawiarnia', tile: [1, 1] as [number, number], via: 'action' as const };

  it('npc → первый подходящий диалог; пока он открыт, повторные interact игнорируются', async () => {
    const { bus, play: p } = play();
    bus.emit('world:interact', { ...base, kind: 'npc', id: 'pan_marek', key: 'npc:pan_marek' });
    await flush();
    expect(host.querySelector('[data-dialogue="dlg.demo.marek"]')).not.toBeNull();
    expect(p.busy).toBe(true);
    bus.emit('world:interact', { ...base, kind: 'npc', id: 'pan_marek', key: 'npc:pan_marek' });
    await flush();
    expect(host.querySelectorAll('.pq-layer')).toHaveLength(1);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    await flush();
    expect(p.busy).toBe(false);
    p.dispose();
  });

  it('npc без диалога → заглушка [todo: npc.<id>]', async () => {
    const { bus, play: p } = play();
    bus.emit('world:interact', { ...base, kind: 'npc', id: 'bobr', key: 'npc:bobr' });
    await flush();
    expect(pl()).toBe('[todo: npc.bobr]');
    p.dispose();
  });

  it('word → упражнение по слову (по умолчанию выбор перевода), rev не пишется для новой карточки', async () => {
    const { bus, play: p, store } = play();
    bus.emit('world:interact', { ...base, kind: 'word', id: 'tablica', key: 'word:tablica', item: 'lx.kawa' });
    await flush();
    expect(host.querySelector('.pq-ex-head')?.textContent).toContain('kawa — это…');
    byText(host, 'кофе').click();
    act(host, 'next').click();
    await flush();
    expect(host.querySelector('.pq-layer')).toBeNull();
    expect(store.progress.log.events).toEqual([]);
    p.dispose();
  });

  it('wordStep: ex listen/type/dictation/order и выбор по умолчанию', () => {
    const v = content.vocab.get('lx.maly')!.value;
    expect(wordStep(v, 'listen', content)).toMatchObject({ t: 'listen', say: 'mały', options: 'auto:kawiarnia', item: 'lx.maly' });
    expect(wordStep(v, 'type', content)).toMatchObject({ t: 'type', prompt: 'маленький', accept: ['mały'] });
    expect(wordStep(v, 'dictation', content)).toMatchObject({ t: 'dictation', say: 'mały' });
    const c = wordStep(v, undefined, content);
    expect(c.t).toBe('choice');
    if (c.t === 'choice') expect(c.options[c.answer]).toBe('маленький');
    expect(wordStep(v, 'order', content).t).toBe('choice'); // одно слово — нечего собирать
  });

  it('ui:lesson:start → урок, ui:lesson:end и progress:changed после событий', async () => {
    const { bus, play: p, lessonEnd, events, store } = play();
    // Босс закрыт, пока не сдан demo.s01 (requires, I-13).
    store.append({ k: 'lesson', ts: Date.UTC(2026, 9, 1, 9), lesson: 'demo.s01', score: 1, firstTry: 1, ms: 1000, passed: true, answers: 4 });
    bus.emit('ui:lesson:start', { lessonId: 'demo.boss', src: 'npc' });
    await flush();
    act(host, 'start').click(); // экран босса (I-11): вступление с частями
    await flush();
    byText(host, 'ława').click();
    act(host, 'next').click();
    await flush();
    byText(host, 'кофе').click();
    act(host, 'next').click();
    await flush();
    act(host, 'next').click(); // итог
    await flush();
    expect(lessonEnd).toEqual(['demo.boss']);
    expect(events).toContain('cards');
    p.dispose();
  });

  it('ui:dialog:open → диалог; эффект setFlag узла пишет флаг мира', async () => {
    const { bus, play: p, store } = play();
    (content.dialogues as Map<string, { module: string; value: Dialogue }>).set('dlg.demo.flag', {
      module: 'demo',
      value: { id: 'dlg.demo.flag', npc: 'bobr', start: 'a', nodes: { a: { who: 'bobr', pl: 'Tak.', do: [{ setFlag: 'demo.flag' }], end: true } } },
    });
    bus.emit('ui:dialog:open', { dialogueId: 'dlg.demo.flag', npcId: 'bobr' });
    await flush();
    await next();
    expect('demo.flag' in store.progress.world.flags).toBe(true);
    (content.dialogues as Map<string, unknown>).delete('dlg.demo.flag');
    p.dispose();
  });
});

describe('P-01: заглушки todo в игре не видны', () => {
  beforeEach(() => setTodoVisible(false));

  it('узел todo и эффект line на todo-реплику пропускаются, диалог идёт дальше', async () => {
    const { d, lessons } = setup();
    const dlg: Dialogue = {
      id: 'dlg.demo.p01',
      npc: 'pan_marek',
      start: 'a',
      nodes: {
        a: { who: 'pan_marek', todo: true, next: 'b' },
        b: { who: 'pan_marek', pl: 'Słucham?', ru: 'Слушаю?', next: 'c' },
        c: { who: 'bobr', do: [{ line: 'bobr.after_kawa' }, { startLesson: 'demo.boss' }], end: true },
      },
    };
    const p = runDialog(dlg, d);
    await flush();
    expect(pl()).toBe('Słucham?'); // узел a молча пропущен
    expect(host.textContent).not.toContain('[todo');
    await next();
    expect(await p).toMatchObject({ ended: true, path: ['a', 'b', 'c'] });
    expect(lessons).toEqual(['demo.boss']); // line(todo) пропущен, урок запустился
  });

  it('узел только с вариантами (реплика героя «Start») — варианты без заглушки', async () => {
    const { d } = setup();
    const dlg: Dialogue = {
      id: 'dlg.demo.start',
      npc: 'pan_marek',
      start: 's',
      nodes: { s: { who: 'dima', choices: [{ pl: 'Start', ru: 'Начать', next: 'e' }] }, e: { end: true } },
    };
    const p = runDialog(dlg, d);
    await flush();
    expect(host.textContent).not.toContain('[todo');
    host.querySelector<HTMLButtonElement>('[data-choice="0"]')!.click();
    await flush();
    expect(await p).toMatchObject({ ended: true });
    setTodoVisible(true);
    const q = runDialog(dlg, d);
    await flush();
    expect(host.textContent).not.toContain('[todo'); // и в dev это не заглушка
    host.querySelector<HTMLButtonElement>('[data-choice="0"]')!.click();
    await q;
  });

  it('runLines: заглушки пропускаются; только заглушки — окно не открывается', async () => {
    const { d, input } = setup();
    expect(await runLines([{ who: 'bobr', todo: 'bobr.meets' }], d)).toBe(true);
    expect(input).toEqual([]);
    const p = runLines([{ who: 'bobr', todo: 'bobr.meets' }, { who: 'pan_marek', pl: 'Słucham?' }], d);
    await flush();
    expect(pl()).toBe('Słucham?');
    await next();
    expect(await p).toBe(true);
  });

  it('реплика бобра в панелях (bobrLine): todo → null, в dev — [todo: id]', () => {
    expect(bobrLine(content, 'bobr.after_kawa')).toBeNull();
    setTodoVisible(true);
    expect(bobrLine(content, 'bobr.after_kawa')?.textContent).toContain('[todo: bobr.after_kawa]');
  });
});
