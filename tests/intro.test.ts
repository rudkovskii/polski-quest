// @vitest-environment happy-dom
// Вступление F1 (I-13, ТЗ §5.0, СЮЖЕТ §2): карточки-сцены, две плитки «Dzień dobry» / «Do widzenia»,
// неверно → «Do widzenia? Dopiero przyszedłeś.» и снова плитки, верно → печать №1, журнал intro + lesson.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getContent } from '../src/systems/content';
import { createOverlay } from '../src/ui/overlay/host';
import { INTRO_LESSON, runIntro } from '../src/ui/intro';
import { act, fakeAudio, flush, memStore, testBus } from './overlayKit';

const content = getContent();
let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => root.remove());

describe('runIntro', () => {
  it('карточки по СЮЖЕТ §2, ошибка с репликой Казика, печать и журнал', async () => {
    const bus = testBus();
    const overlay = createOverlay(root, { bus });
    const store = memStore();
    let stamped = 0;
    const audio = fakeAudio();
    const run = runIntro({ overlay, content, store, audio, atlas: null, random: () => 0.1, onStamp: () => stamped++, clock: { now: () => Date.UTC(2026, 9, 14, 8), mono: () => 0 } });
    const lines: string[] = [];
    const seen = (): void => {
      for (const n of root.querySelectorAll<HTMLElement>('[data-line]')) if (!lines.includes(n.dataset.line!)) lines.push(n.dataset.line!);
    };
    for (let i = 0; i < 4; i++) {
      await flush();
      seen();
      act(root, 'next').click();
    }
    await flush();
    seen();
    act(root, 'wrong').click(); // «Do widzenia»
    await flush();
    seen();
    expect(lines).toContain('intro.kazik.dopiero');
    act(root, 'next').click();
    await flush();
    act(root, 'right').click(); // «Dzień dobry»
    await flush();
    seen();
    expect(stamped).toBe(1);
    expect(root.querySelector('[data-stamp]')).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      act(root, 'next').click();
      await flush();
      seen();
    }
    await run;
    expect(lines).toEqual([
      'intro.caption.oct',
      'intro.kazik.kloda',
      'intro.caption.bobr',
      'intro.hela.za_darmo',
      'intro.passport.k',
      'intro.caption.empty',
      'intro.kazik.dzien_dobry',
      'intro.kazik.dopiero',
      'intro.kazik.gosc_mowi',
      'kazik.shadow.first',
      'intro.kazik.po_rusku',
      'intro.simba.miau',
      'intro.caption.pokazalo',
    ]);
    const ev = store.progress.log.events.map((e) => `${e.k}:${'lesson' in e ? e.lesson : ''}`);
    expect(ev).toEqual([`intro:${INTRO_LESSON}`, `lesson:${INTRO_LESSON}`]);
    const intro = store.progress.log.events[0]!;
    expect(intro.k === 'intro' && intro.ok).toEqual([]); // первая попытка была неверной
    expect(audio.played.map((p) => p.text)).toContain('Dzień dobry');
    expect(root.querySelector('.pq-intro')).toBeNull();
  });
});
