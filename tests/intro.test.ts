// @vitest-environment happy-dom
// Карточки дня 1 (P-05, СЮЖЕТ_v2 d01): подпись рассказчика с табло, плитки у лотка Хели (ошибка → реакция Хели,
// правило, перевод, «Jeszcze raz.»), крупный план паспорта с фото игрока и записью K., печать №1, ночь.
// Атлас картинок ждёт `onload` с потолком, а не `img.decode()` (висел в скрытой вкладке, P-03).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getContent } from '../src/systems/content';
import { defaultAppearance } from '../src/systems/avatar';
import { createOverlay } from '../src/ui/overlay/host';
import { imageReady, INTRO_LESSON, runCaption, runNight, runPassport, runTiles } from '../src/ui/intro';
import { act, fakeAudio, flush, memStore, testBus } from './overlayKit';

const content = getContent();
let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => root.remove());

const lines = (): string[] => [...root.querySelectorAll<HTMLElement>('[data-line]')].map((n) => n.dataset.line!);
const clock = { now: () => Date.UTC(2026, 9, 14, 8), mono: () => 0 };

describe('карточки дня 1', () => {
  it('подпись рассказчика: тёмный экран, табло WARSZAWA WSCHODNIA, одна строка', async () => {
    const overlay = createOverlay(root, { bus: testBus() });
    const run = runCaption({ overlay, content, audio: fakeAudio(), clock });
    await flush();
    expect(lines()).toEqual(['d01.narr.card.1']);
    expect(root.querySelector('.board')?.textContent).toBe('WARSZAWA WSCHODNIA');
    act(root, 'next').click();
    await run;
    expect(root.querySelector('.pq-intro')).toBeNull();
  });

  it('плитки у лотка: «Do widzenia» → Хеля, правило, перевод, «Jeszcze raz.»; «Dzień dobry» → журнал intro + lesson', async () => {
    const overlay = createOverlay(root, { bus: testBus() });
    const store = memStore();
    const audio = fakeAudio();
    const run = runTiles({ overlay, content, store, audio, random: () => 0.1, clock });
    await flush();
    expect(root.querySelector('.art')).toBeNull(); // мир виден: коробка внизу без картинки
    expect(root.querySelectorAll('[data-tile]').length).toBe(2);
    expect(lines()).toEqual(['d01.hela.bazar.1']); // «Tak?» над плитками
    act(root, 'wrong').click();
    await flush();
    expect(lines()).toEqual(['d01.hela.bazar.err.1', 'd01.rule.dzien_dobry', 'd01.rule.dzien_dobry.tr']);
    expect(root.querySelector('[data-again]')?.textContent).toBe('Jeszcze raz.');
    act(root, 'right').click();
    const r = await run;
    expect(r).toEqual({ firstTry: false, attempts: 2 });
    const ev = store.progress.log.events.map((e) => `${e.k}:${'lesson' in e ? e.lesson : ''}`);
    expect(ev).toEqual([`intro:${INTRO_LESSON}`, `lesson:${INTRO_LESSON}`]);
    const intro = store.progress.log.events[0]!;
    expect(intro.k === 'intro' && intro.ok).toEqual([]);
    expect(root.querySelector('.pq-intro')).toBeNull();
  });

  it('паспорт: фото из Fotobudka в рамке, запись K., подпись; ▼ → печать BAZAR RÓŻYCKIEGO и реплика Хели', async () => {
    const overlay = createOverlay(root, { bus: testBus() });
    let stamped = 0;
    const audio = fakeAudio();
    const run = runPassport({ overlay, content, audio, clock, appearance: defaultAppearance(), onStamp: () => stamped++ });
    await flush();
    expect(lines()).toEqual(['d01.passport.note', 'd01.narr.passport.1']);
    expect(root.querySelector('[data-photo] canvas')).not.toBeNull();
    expect(root.querySelector('[data-note]')?.textContent).toBe('Dla następnego gościa. - K.');
    expect(root.querySelector('[data-stamp]')).toBeNull();
    act(root, 'next').click();
    await flush();
    expect(stamped).toBe(1);
    expect(root.querySelector('[data-stamp]')?.textContent).toBe('BAZARRÓŻYCKIEGO');
    expect(lines()).toEqual(['d01.hela.bazar.5']);
    expect(audio.played.map((p) => p.text)).toContain('I pieczątka. Gratis.');
    act(root, 'next').click();
    await run;
  });

  it('ночь: «miau» и Казик в темноте, «Dobranoc», «Do jutra»', async () => {
    const overlay = createOverlay(root, { bus: testBus() });
    const run = runNight({ overlay, content, audio: fakeAudio(), clock, atlas: null, starsMs: 0 });
    await flush();
    expect(lines()).toEqual(['d01.simba.night', 'd01.kazik.hut.3']);
    act(root, 'next').click();
    await flush();
    expect(lines()).toEqual(['d01.ui.dobranoc']);
    act(root, 'next').click();
    await flush();
    expect(root.querySelector('[data-title="do-jutra"]')?.textContent).toContain('Do jutra');
    act(root, 'next').click();
    await run;
    expect(root.querySelector('.pq-intro')).toBeNull();
  });
});

describe('атлас вступления: картинка без img.decode()', () => {
  it('скрытая вкладка (onload не приходит) → через потолок false, а не вечное ожидание', async () => {
    vi.useFakeTimers();
    try {
      const img = document.createElement('img');
      const p = imageReady(img, 50);
      vi.advanceTimersByTime(60);
      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it('onload → true, onerror → false', async () => {
    const a = document.createElement('img');
    const pa = imageReady(a, 10_000);
    a.onload?.(new Event('load'));
    expect(await pa).toBe(true);
    const b = document.createElement('img');
    const pb = imageReady(b, 10_000);
    b.onerror?.(new Event('error'));
    expect(await pb).toBe(false);
  });
});
