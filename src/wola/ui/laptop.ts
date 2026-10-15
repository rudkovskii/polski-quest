// Ноутбук «Słowniczek» (W-01, ВОЛЯ.md п. 5): «сажусь за комп и добавляю слова в словарь». Экран пиксельного монитора,
// по одной карточке: польское слово печатается (тихий стук клавиш, `sfx:play`), транскрипция кириллицей, перевод,
// пример PL/RU, ▶ (без звука — нет), «Dodaj / Добавить» (Enter) = событие `intro` (слово семечком в огород),
// прогресс 0/5. В конце порции — короткая проверка узнаванием (choice из 4, перемешано) по добавленным словам.
// Тот же поток берёт 5 слов темы с полки «Słownik».
import type { Lesson, Step, VocabEntry } from '../../types/content';
import { isSilent } from '../../systems/sound';
import { el } from '../../ui/dom';
import { runLesson } from '../../ui/lesson';
import type { Layer } from '../../ui/overlay/host';
import { btn, plBtn, type PlLabel } from '../../ui/overlay/kit';
import { CHECK_LESSON } from '../systems/wola';
import { changed, write, words as wordsN, type WolaDeps } from './kit';
import { ensureWolaStyle } from './style';

export interface SlowniczekOptions {
  words: VocabEntry[];
  /** id урока в событии `intro`: `wola.laptop` или `wola.slownik.<тема>`. */
  lesson: string;
  title: PlLabel;
  /** Подсказка на последнем экране (ноутбук: «ещё слова — на полке»). */
  after?: string;
}

export interface SlowniczekResult {
  added: string[];
  /** Проверка узнаванием: верно с первой попытки / всего. Нет — проверки не было (прервали, меньше 2 слов). */
  check?: { right: number; total: number };
}

export const ADD: PlLabel = { pl: 'Dodaj', ru: 'Добавить' };
const CHECK_MIN = 2;

/** Шаги проверки узнаванием: «<pl> — это…», 4 варианта (сначала переводы слов порции, потом той же темы). */
export function checkSteps(added: readonly VocabEntry[], pool: readonly VocabEntry[]): Step[] {
  return added.map((v) => {
    const theme = v.tags?.[0];
    const seen = new Set([v.ru]);
    const wrong: string[] = [];
    const take = (list: readonly VocabEntry[]): void => {
      for (const x of list) {
        if (wrong.length >= 3) return;
        if (seen.has(x.ru)) continue;
        seen.add(x.ru);
        wrong.push(x.ru);
      }
    };
    take(added.filter((x) => x.id !== v.id));
    take(pool.filter((x) => x.tags?.[0] === theme && x.id !== v.id));
    take(pool.filter((x) => x.id !== v.id));
    const options = [v.ru, ...wrong] as [string, string, ...string[]];
    return { t: 'choice', id: `${CHECK_LESSON}#${v.id}`, q: `${v.pl} — это…`, options, answer: 0, item: v.id } as Step;
  });
}

export async function runSlowniczek(deps: WolaDeps, o: SlowniczekOptions): Promise<SlowniczekResult> {
  ensureWolaStyle(document);
  const layer = deps.overlay.open('wl-laptop-layer');
  layer.el.style.justifyContent = 'center';
  const total = o.words.length;
  const bar = el('div', { class: 'wl-bar8', 'data-progress': '0' });
  const paintBar = (n: number): void => {
    bar.dataset['progress'] = String(n);
    bar.replaceChildren(...o.words.map((_, i) => el('i', { class: i < n ? 'on' : '' })), el('span', {}, `${n}/${total}`));
  };
  const screen = el('div', { class: 'wl-screen', 'data-screen': 'slowniczek' });
  const body = el('div', {});
  let cancel: (() => void) | null = null;
  const x = btn('✕', () => cancel?.(), 'icon ghost', { 'aria-label': 'Закрыть ноутбук', 'data-act': 'close' });
  screen.append(el('div', { class: 'head' }, el('b', { lang: 'pl' }, o.title.pl, el('small', {}, o.title.ru)), bar, x), body);
  layer.el.replaceChildren(el('div', { class: 'wl-laptop', 'data-laptop': o.lesson }, screen, el('div', { class: 'base' })));
  paintBar(0);

  const added: string[] = [];
  const silent = (): boolean => isSilent(deps.store.progress);
  const typeMs = deps.typeMs ?? 45;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopTyping = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  try {
    for (let i = 0; i < total; i++) {
      const v = o.words[i]!;
      const ok = await card(v, i);
      if (!ok) return { added };
      write(deps, { k: 'intro', ts: deps.clock.now(), item: v.id, lesson: o.lesson, ok: [] });
      added.push(v.id);
      paintBar(added.length);
      changed(deps);
    }
    let check: SlowniczekResult['check'];
    if (added.length >= CHECK_MIN) check = await runCheck();
    await finish(check);
    return check ? { added, check } : { added };
  } finally {
    stopTyping();
    layer.close();
  }

  /** Одна карточка. true — «Dodaj», false — закрыли. */
  function card(v: VocabEntry, i: number): Promise<boolean> {
    return new Promise((resolve) => {
      const word = el('div', { class: 'word', lang: 'pl', 'data-word': v.id });
      const caret = el('i', { class: 'caret' });
      const rest = el(
        'div',
        { class: 'rest', hidden: true },
        v.tr ? el('div', { class: 'tr', 'data-tr': true }, `[${v.tr}]`) : null,
        el('div', { class: 'tl', lang: 'ru', 'data-ru': true }, v.ru),
        v.ex ? el('div', { class: 'ex' }, el('div', { class: 'pl', lang: 'pl' }, v.ex.pl), el('div', { class: 'exru' }, v.ex.ru)) : null,
      );
      const theme = deps.book.theme.get(v.tags?.[0] ?? '');
      const play = (): void => deps.audio.play(v.pl, { id: v.id });
      const listen = silent() ? null : btn('▶', play, 'icon', { 'aria-label': 'Послушать', 'data-nav': true, 'data-audio': 'play' });
      const add = plBtn(ADD, () => done(true), 'primary', { 'data-nav': true, 'data-primary': true, 'data-act': 'add' });
      const done = (r: boolean): void => {
        stopTyping();
        layer.handle(null);
        resolve(r);
      };
      cancel = () => done(false);
      body.replaceChildren(
        el(
          'div',
          { class: 'wl-card', 'data-card': i },
          theme ? el('div', { class: 'theme' }, `${theme.pl} · ${theme.ru}`) : null,
          word,
          rest,
          el('div', { class: 'wl-row' }, listen, el('span', { class: 'grow' }), add),
        ),
      );
      layer.handle({ cancel: () => (done(false), true) });
      queueMicrotask(() => add.focus({ preventScroll: true }));
      // Печать слова: буква за буквой со стуком клавиш, потом перевод и пример.
      const letters = [...v.pl];
      let n = 0;
      const reveal = (): void => {
        word.replaceChildren(v.pl);
        rest.hidden = false;
        if (!silent()) play();
      };
      if (typeMs <= 0) return reveal();
      word.replaceChildren(caret);
      const tick = (): void => {
        n++;
        word.replaceChildren(letters.slice(0, n).join(''), caret);
        if (letters[n - 1]?.trim()) deps.bus.emit('sfx:play', { kind: 'key' });
        if (n >= letters.length) {
          timer = null;
          reveal();
          return;
        }
        timer = setTimeout(tick, typeMs);
      };
      timer = setTimeout(tick, typeMs);
    });
  }

  /** Проверка узнаванием в экране ноутбука: урок `wola.sprawdzian` (ранние ответы SRS не двигают, минуты идут в итог). */
  async function runCheck(): Promise<{ right: number; total: number } | undefined> {
    const list = added.map((id) => deps.content.vocab.get(id)?.value).filter((v): v is VocabEntry => !!v);
    const steps = checkSteps(list, deps.book.vocab);
    const lesson: Lesson = { id: CHECK_LESSON, kind: 'practice', title: { pl: 'Sprawdzian', ru: 'узнаёшь новые слова?' }, minutes: 1, steps: steps as [Step, ...Step[]] };
    // Старый незаконченный прогон проверки не продолжаем: слова в нём другие.
    if (deps.store.local.resume?.lessonId === CHECK_LESSON) {
      const { resume: _r, ...l } = deps.store.local;
      deps.store.setLocal(l);
    }
    const sub: Layer = {
      el: body,
      handle: (h) => layer.handle(h),
      get closed() {
        return layer.closed;
      },
      close: () => layer.close(),
    };
    cancel = null;
    const r = await runLesson(lesson, { ...deps }, { layer: sub, noSummary: true });
    if (r.cancelled) return undefined;
    changed(deps);
    return { right: Math.round((r.firstTry ?? 0) * steps.length), total: steps.length };
  }

  function finish(check: SlowniczekResult['check']): Promise<void> {
    return new Promise((resolve) => {
      const ok = plBtn({ pl: 'Gotowe', ru: 'Готово' }, () => end(), 'primary', { 'data-nav': true, 'data-primary': true, 'data-act': 'done' });
      const end = (): void => {
        layer.handle(null);
        resolve();
      };
      cancel = end;
      const names = added.map((id) => deps.content.vocab.get(id)?.value.pl ?? id).join(', ');
      body.replaceChildren(
        el(
          'div',
          { class: 'wl-card', 'data-done': added.length },
          el('div', { class: 'word', lang: 'pl' }, 'Gotowe!'),
          el('div', { class: 'msg' }, 'В словаре ', el('b', {}, wordsN(added.length)), ': ', el('span', { lang: 'pl' }, names), '.'),
          el('div', { class: 'msg' }, 'Они уже семечками в огороде. Завтра — первое удобрение.'),
          check ? el('div', { class: 'msg', 'data-check': `${check.right}/${check.total}` }, `Проверка: узнал ${check.right} из ${check.total}.`) : null,
          o.after ? el('div', { class: 'msg' }, o.after) : null,
          el('div', { class: 'wl-row' }, ok),
        ),
      );
      layer.handle({ cancel: () => (end(), true) });
      queueMicrotask(() => ok.focus({ preventScroll: true }));
    });
  }
}

/** Экран ноутбука, когда порция на сегодня сделана или слова кончились. */
export function laptopRest(deps: WolaDeps, text: (HTMLElement | string)[]): Promise<void> {
  ensureWolaStyle(document);
  const layer = deps.overlay.open('wl-laptop-layer');
  layer.el.style.justifyContent = 'center';
  return new Promise((resolve) => {
    const close = (): void => {
      layer.close();
      resolve();
    };
    const ok = btn('OK', close, 'primary', { 'data-nav': true, 'data-primary': true, 'data-act': 'close' });
    const screen = el(
      'div',
      { class: 'wl-screen', 'data-screen': 'slowniczek-rest' },
      el('div', { class: 'head' }, el('b', { lang: 'pl' }, 'Słowniczek', el('small', {}, 'мой словарь'))),
      el('div', { class: 'wl-card' }, ...text.map((t) => (typeof t === 'string' ? el('div', { class: 'msg' }, t) : t)), el('div', { class: 'wl-row' }, ok)),
    );
    layer.el.replaceChildren(el('div', { class: 'wl-laptop' }, screen, el('div', { class: 'base' })));
    layer.handle({ cancel: () => (close(), true) });
    queueMicrotask(() => ok.focus({ preventScroll: true }));
  });
}
