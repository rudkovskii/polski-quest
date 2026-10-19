// @vitest-environment happy-dom
// Игра 5 «Собери слово · Ułóż słowo» (19.10): плитки-буквы с ловушками, обе стороны, подсказка, ввод, «сам» (production) для урожая,
// в игре 2 больше нет «напиши сам», вёрстка без прокрутки (слоты держат слово, лист игры 5 выше, результат на месте плиток).
import { describe, expect, it } from 'vitest';
import { WORD_BY_ID, WORDS } from '../src/systems/content';
import { createFarm } from '../src/systems/farm';
import { DAY_MS, newGarden, type GardenSave } from '../src/systems/garden';
import { grade, makeQuestion, type Question, type SpellQuestion } from '../src/systems/quiz';
import { assemble, distractCount, gradeSpell, lettersOf, primaryRu, ruSpellable, spellDiff, spellDistractors, spellTarget } from '../src/systems/spell';
import type { BusEvents } from '../src/types/bus';
import { mountBoard } from '../src/ui/board';
import { MODE_ICON, MODE_NAME } from '../src/ui/glossary';
import { mountMinigame, type AnswerResult } from '../src/ui/minigame';
import { SPELL_CSS } from '../src/ui/spell';
import { seeded, testBus } from './helpers';

const T0 = Date.UTC(2026, 9, 19, 9, 0);
const db = { word: (id: string) => WORD_BY_ID.get(id), phrase: () => undefined, words: WORDS };
const spellQ = (id: string, dir: 'rp' | 'pr' = 'rp', seed = 1): SpellQuestion => makeQuestion(5, id, db, seeded(seed), { dir }) as SpellQuestion;

function setup() {
  let saved: GardenSave = newGarden();
  let now = T0;
  const bus = testBus();
  const farm = createFarm({ bus, load: () => saved, save: (g) => (saved = g), now: () => now, tz: () => 0, say: () => {}, rand: seeded(5) });
  return { farm, bus, saved: () => saved, setNow: (t: number) => (now = t), now: () => now };
}

describe('игра 5: плитки и ловушки', () => {
  it('польское слово режется на плитки: rz/sz/cz — одной плиткой, пробел и знаки стоят сами', () => {
    expect(spellTarget('rzeka', 'pl').units).toEqual(['rz', 'e', 'k', 'a']);
    expect(spellTarget('szczęście', 'pl').units).toEqual(['sz', 'cz', 'ę', 'ś', 'c', 'i', 'e']);
    const t = spellTarget('Jak się masz?', 'pl');
    expect(t.text).toBe('Jak się masz?');
    expect(t.units.join('')).toBe('jaksięmasz');
    expect(t.layout.filter((c) => c !== null)).toEqual([' ', ' ', '?']);
    expect(assemble(t.layout, t.units)).toBe('jak się masz?');
    expect(spellTarget('что-то', 'ru').layout).toContain('-');
  });

  it('ловушек 2–4 (по длине), сначала польские пары: ą/a, ł/l, ó/o, ż/rz, ś/sz, ć/cz…', () => {
    expect([distractCount(3), distractCount(6), distractCount(12)]).toEqual([2, 3, 4]);
    for (let s = 1; s <= 20; s++) {
      const kot = spellDistractors(['k', 'o', 't'], 'pl', seeded(s));
      expect(kot.length).toBe(2);
      expect(kot).toContain('ó'); // единственная пара к буквам «kot»
      const zaba = spellDistractors(['ż', 'a', 'b', 'a'], 'pl', seeded(s));
      for (const d of zaba) expect(['z', 'rz', 'ź', 'ą', 'k', 'o', 'e', 'i', 'u', 'y', 'l', 'm', 'n', 'p', 'r', 's', 't', 'w']).toContain(d);
      expect(zaba.some((d) => ['z', 'rz', 'ź', 'ą'].includes(d))).toBe(true);
    }
    const szkola = spellDistractors(spellTarget('szkoła', 'pl').units, 'pl', seeded(3));
    expect(szkola.length).toBe(3);
    expect(szkola.every((d) => ['ś', 'ó', 'l', 'u', 'ą', 'o'].includes(d))).toBe(true);
    // Русские ловушки: ё/е, и/й, ш/щ…
    const esho = spellDistractors(['е', 'щ', 'ё'], 'ru', seeded(2));
    expect(esho.some((d) => ['ё', 'е', 'э', 'ш'].includes(d))).toBe(true);
  });

  it('задание RU→PL: русское слово, плитки = буквы ответа + ловушки; PL→RU: польское слово, первое значение перевода', () => {
    const q = spellQ('w.kot');
    expect(q).toMatchObject({ mode: 5, kind: 'spell', dir: 'rp', prompt: WORD_BY_ID.get('w.kot')!.ru, promptLang: 'ru', answer: 'kot', units: ['k', 'o', 't'] });
    expect(q.tiles.length).toBe(5);
    for (const u of q.units) expect(q.tiles).toContain(u);
    const r = spellQ('w.dzien_dobry', 'pr');
    expect(r).toMatchObject({ dir: 'pr', prompt: 'Dzień dobry', promptLang: 'pl', answer: 'здравствуйте' });
    expect(r.accept).toEqual(['здравствуйте', 'добрый день']);
    expect(primaryRu('кот (кошка)')).toBe('кот');
    expect(primaryRu('«ушки» (пельмешки)')).toBe('ушки');
    expect(ruSpellable('e-mail')).toBe(false);
    expect(ruSpellable('в, на (где?)')).toBe(false); // одна буква — нечего собирать
    expect(makeQuestion(5, 'w.mail', db, seeded(1), { dir: 'pr' })).toBeNull();
  });

  it('проверка: плитки — буквы точно (ловушка ą вместо a — ошибка), ввод — мягко; русский ввод: ё = е, любое значение', () => {
    const q = spellQ('w.dzien_dobry');
    expect(grade(q, 'dzień dobry')).toMatchObject({ ok: true, verdict: 'exact' });
    expect(grade(q, 'dzien dobry').ok).toBe(false);
    expect(grade({ ...q, typed: true }, 'dzien dobry')).toMatchObject({ ok: true, verdict: 'diacritics' });
    expect(grade({ ...q, typed: true }, 'Dzień dobry')).toMatchObject({ ok: true, verdict: 'exact' });
    expect(gradeSpell('еще', 'ещё', ['ещё'], 'ru', true).ok).toBe(true);
    expect(gradeSpell('еще', 'ещё', ['ещё'], 'ru', false).ok).toBe(false);
    expect(gradeSpell('добрый день', 'здравствуйте', ['здравствуйте', 'добрый день'], 'ru', true).ok).toBe(true);
    expect(lettersOf('Jak się masz?', 'pl')).toBe('jaksięmasz');
  });

  it('разбор ошибки: в правильном подсвечены буквы, которых не хватило, у игрока зачёркнуты лишние', () => {
    const d = spellDiff('dźień', 'dzień');
    expect(d.correct.filter((c) => c.bad).map((c) => c.ch)).toEqual(['z']);
    expect(d.given.filter((c) => c.bad).map((c) => c.ch)).toEqual(['ź']);
    expect(spellDiff('kot', 'kot').correct.some((c) => c.bad)).toBe(false);
  });
});

describe('игра 5 в модели роста: ответ «сам» (production)', () => {
  const grow = (s: ReturnType<typeof setup>, id: string): void => {
    // День 1: росток (2 полива с польского) и куст (выбор по-польски в игре 2), дни 2–3 — игра 1.
    for (const m of [1, 1, 2] as const) {
      const q = s.farm.next(m, id)!;
      s.farm.answer(q, q.answer);
    }
    for (const d of [1, 2]) {
      s.setNow(T0 + d * DAY_MS);
      const q = s.farm.next(1, id)!;
      s.farm.answer(q, q.answer);
    }
  };

  it('без игры 5 слово не созревает и говорит, что осталось; собранное само — урожай, в журнале `prod`', () => {
    const s = setup();
    s.farm.plant(['w.kot']);
    grow(s, 'w.kot');
    expect(s.farm.info('w.kot')).toMatchObject({ stage: 'bush', days: 3, prod: false, next: 'Осталось: собери слово в игре «Собери слово» — и урожай' });
    expect(s.farm.reviewMode('w.kot')).toBe(5);
    expect(s.farm.counts().spell).toBe(1);
    expect(s.farm.ripeSoon().today).toBe(0);
    const q = s.farm.next(5)!;
    expect(q).toMatchObject({ kind: 'spell', dir: 'rp', id: 'w.kot' });
    const r = s.farm.answer(q, q.answer);
    expect(r.act.kind).toBe('harvest');
    expect(s.saved().log.at(-1)).toMatchObject({ mode: 5, side: 'rp', ok: true, prod: true });
  });

  it('подсказка «первая буква» и ввод с ошибкой в буквах — засчитано, но не «сам»; PL→RU — сторона pr, не «сам»', () => {
    const s = setup();
    s.farm.plant(['w.kot', 'w.dzien_dobry']);
    grow(s, 'w.kot');
    const q = s.farm.next(5, 'w.kot') as SpellQuestion;
    const hinted = s.farm.answer({ ...q, hinted: true }, 'kot');
    expect(hinted).toMatchObject({ ok: true, act: { kind: 'water' }, note: 'Засчитано с подсказкой (не как «сам»)' });
    expect(s.saved().log.at(-1)!.prod).toBeUndefined();
    expect(s.farm.info('w.kot').stage).toBe('bush');
    const t = s.farm.next(5, 'w.dzien_dobry') as SpellQuestion;
    const typed = s.farm.answer({ ...t, typed: true }, 'dzien dobry');
    expect(typed).toMatchObject({ ok: true, note: 'Засчитано (не как «сам»), но проверь польские буквы' });
    expect(s.saved().log.at(-1)!.prod).toBeUndefined();
    const p = s.farm.next(5, 'w.dzien_dobry', { dir: 'pr' }) as SpellQuestion;
    expect(p).toMatchObject({ dir: 'pr', promptLang: 'pl' });
    s.farm.answer(p, p.answer);
    expect(s.saved().log.at(-1)).toMatchObject({ mode: 5, side: 'pr', ok: true });
    expect(s.saved().log.at(-1)!.prod).toBeUndefined();
    // Точный ввод без подсказки — «сам».
    const e = s.farm.next(5, 'w.kot') as SpellQuestion;
    expect(s.farm.answer({ ...e, typed: true }, 'kot').act.kind).toBe('harvest');
  });

  it('очередь игры 5: сначала кусты, которым для урожая не хватает только сборки; с «↔ наоборот» — по-русски', () => {
    const s = setup();
    const ids = WORDS.filter((w) => w.topic === WORDS[0]!.topic).slice(0, 5).map((w) => w.id);
    s.farm.plant(ids);
    grow(s, ids[3]!);
    // Новый заход (очередь «не повторять подряд» пуста): ферма из того же сохранения.
    let g = s.saved();
    const f = createFarm({ bus: testBus(), load: () => g, save: (x) => (g = x), now: () => T0 + 2 * DAY_MS + 60_000, tz: () => 0, say: () => {}, rand: seeded(5) });
    expect(f.next(5)!.id).toBe(ids[3]);
    const pr = f.next(5, undefined, { dir: 'pr' })!;
    expect(pr).toMatchObject({ kind: 'spell', dir: 'pr' });
  });

  it('игра 2 — только выбор, даже у кустика и перезревшего («напиши сам» ушло в игру 5)', () => {
    const s = setup();
    s.farm.plant(['w.kot']);
    grow(s, 'w.kot');
    for (let i = 0; i < 3; i++) expect(s.farm.next(2, 'w.kot')!.kind).toBe('choice');
    expect(s.farm.next(2)!.kind).toBe('choice');
  });
});

describe('игра 5: экран', () => {
  function mk(q: SpellQuestion | null, opts: { ok?: boolean } = {}) {
    const root = document.createElement('div');
    document.body.append(root);
    const bus = testBus();
    const audio: BusEvents['audio:play'][] = [];
    bus.on('audio:play', (a) => audio.push(a));
    const sent: { q: Question; given: string }[] = [];
    const said: string[] = [];
    const nexts: (string | undefined)[] = [];
    const g = mountMinigame(root, {
      bus,
      coarse: false,
      next: (_m, _only, o) => (nexts.push(o?.dir), o?.dir === 'pr' ? spellQ('w.kot', 'pr') : q),
      answer: (qq, given): AnswerResult => {
        sent.push({ q: qq, given: String(given) });
        return { ok: opts.ok ?? true, correct: (qq as SpellQuestion).answer, pl: 'kot', ru: 'кот', tr: 'кот', progress: 'до урожая: ещё 2 дня' };
      },
      say: (id) => said.push(id),
    });
    return { root, bus, g, audio, sent, said, nexts };
  }
  const letters = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('[data-letter]')];
  const tap = (root: HTMLElement, ch: string): void => letters(root).find((b) => b.dataset.letter === ch && !b.disabled)!.click();

  it('на доске пятая игра: значок, русское и польское название, подсказка «ждут сборки»', () => {
    expect(MODE_NAME[5]).toEqual({ ru: 'Собери слово', pl: 'Ułóż słowo' });
    const root = document.createElement('div');
    const b = mountBoard(root, { counts: () => ({ words: 4, phrases: 0, assemble: 0, spell: 2 }), onPick: () => {} });
    b.open();
    const btn = root.querySelector<HTMLButtonElement>('[data-mode="5"]')!;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain(`${MODE_ICON[5]} 5. Собери слово`);
    expect(btn.textContent).toContain('Ułóż słowo');
    expect(btn.querySelector('[data-spell-wait]')?.textContent).toBe('🌾 Ждут сборки для урожая: 2');
  });

  it('тап по букве ставит её в слот, тап по слоту возвращает; «Сбросить»; плитки не озвучиваются; «Sprawdź» — когда слоты заполнены', () => {
    const q = { ...spellQ('w.kot'), tiles: ['t', 'ó', 'k', 'o', 'l'] };
    const v = mk(q);
    v.g.start(5);
    expect(v.root.querySelector('.pq-game-box')!.classList.contains('spell')).toBe(true);
    expect(v.root.querySelectorAll('[data-slot]').length).toBe(3);
    const check = v.root.querySelector<HTMLButtonElement>('[data-check]')!;
    tap(v.root, 'k');
    tap(v.root, 'ó');
    expect(v.root.querySelector('[data-slot="1"]')!.textContent).toBe('ó');
    expect(check.disabled).toBe(true);
    v.root.querySelector<HTMLButtonElement>('[data-slot="1"]')!.click();
    expect(v.root.querySelector('[data-slot="1"]')!.textContent).toBe('');
    tap(v.root, 'o');
    tap(v.root, 't');
    expect(check.disabled).toBe(false);
    v.root.querySelector<HTMLButtonElement>('[data-reset]')!.click();
    expect(letters(v.root).every((b) => !b.disabled)).toBe(true);
    expect(v.audio).toEqual([]);
    // Клавиши 1–9: n-я свободная плитка.
    v.bus.emit('input:intent', { type: 'hotkey', n: 3, to: 'ui', source: 'keyboard' });
    expect(v.root.querySelector('[data-slot="0"]')!.textContent).toBe('k');
    tap(v.root, 'o');
    tap(v.root, 't');
    check.click();
    expect(v.sent).toEqual([{ q: expect.objectContaining({ id: 'w.kot', kind: 'spell' }), given: 'kot' }]);
    expect((v.sent[0]!.q as SpellQuestion).hinted).toBeUndefined();
    // После ответа: результат на месте плиток, лист не прокручивается, польское слово звучит.
    expect(v.root.querySelector('[data-fbhost] [data-feedback="ok"]')).not.toBeNull();
    expect(v.root.querySelector('.pq-game-paper')!.classList.contains('fit')).toBe(true);
    expect(v.said).toEqual(['w.kot']);
  });

  it('«💡 Первая буква» запирает первую плитку, ответ уходит с `hinted`', () => {
    const v = mk({ ...spellQ('w.kot'), tiles: ['t', 'ó', 'k', 'o', 'l'] });
    v.g.start(5);
    v.root.querySelector<HTMLButtonElement>('[data-hint]')!.click();
    expect(v.root.querySelector('[data-slot="0"]')!.textContent).toBe('k');
    expect(v.root.querySelector<HTMLButtonElement>('[data-slot="0"]')!.disabled).toBe(true);
    expect(v.root.querySelector('[data-hintline]')!.textContent).toContain('не как «сам»');
    v.root.querySelector<HTMLButtonElement>('[data-reset]')!.click();
    expect(v.root.querySelector('[data-slot="0"]')!.textContent).toBe('k');
    tap(v.root, 'o');
    tap(v.root, 't');
    v.root.querySelector<HTMLButtonElement>('[data-check]')!.click();
    expect(v.sent[0]).toMatchObject({ q: { hinted: true }, given: 'kot' });
  });

  it('неверно: правильное слово с подсвеченными буквами и собранное с зачёркнутыми; слово звучит и после ошибки', () => {
    const v = mk({ ...spellQ('w.kot'), tiles: ['t', 'ó', 'k', 'o', 'l'] }, { ok: false });
    v.g.start(5);
    tap(v.root, 'k');
    tap(v.root, 'ó');
    tap(v.root, 't');
    v.root.querySelector<HTMLButtonElement>('[data-check]')!.click();
    expect(v.root.querySelector('[data-feedback="bad"]')).not.toBeNull();
    expect(v.root.querySelector('[data-diff="fix"] .fix')!.textContent).toBe('o');
    expect(v.root.querySelector('[data-diff="bad"] .bad')!.textContent).toBe('ó');
    expect(v.said).toEqual(['w.kot']);
  });

  it('«⌨ Напечатать»: поле и польская экранная клавиатура в листе; русская сторона — системная клавиатура (форма)', () => {
    const v = mk(spellQ('w.kot'));
    v.g.start(5);
    v.root.querySelector<HTMLButtonElement>('[data-typemode]')!.click();
    expect(v.root.querySelector('.pq-game-box')!.classList.contains('typing')).toBe(true);
    const input = v.root.querySelector<HTMLInputElement>('[data-type]')!;
    expect(input.lang).toBe('pl');
    expect(v.root.querySelector('.pq-kb-strip')).not.toBeNull();
    expect(v.root.querySelector<HTMLElement>('.pq-kb-qwerty')!.hidden).toBe(false);
    // Вопрос остаётся над полем (не обрезан): блок вопроса — первый в листе.
    expect(v.root.querySelector('.pq-game-paper')!.firstElementChild!.matches('[data-qblock]')).toBe(true);
    input.value = 'kot';
    input.dispatchEvent(new Event('input'));
    v.root.querySelector<HTMLButtonElement>('[data-check]')!.click();
    expect(v.sent[0]).toMatchObject({ q: { typed: true }, given: 'kot' });
    // Следующее задание — снова ввод (режим запомнен до выхода), «↔ наоборот» → русская сторона без экранной клавиатуры.
    v.g.stop();
    v.g.start(5);
    v.root.querySelector<HTMLButtonElement>('[data-typemode]')!.click();
    v.root.querySelector<HTMLButtonElement>('[data-dir]')!.click();
    expect(v.nexts.at(-1)).toBe('pr');
    expect(v.root.querySelector<HTMLInputElement>('[data-type]')!.lang).toBe('ru');
    expect(v.root.querySelector('[data-typeform]')).not.toBeNull();
    expect(v.root.querySelector('.pq-kb-qwerty')).toBeNull();
    expect(v.root.querySelector('.pq-game-box')!.classList.contains('typing')).toBe(false);
  });

  it('«↔ наоборот»: польское слово с 🔊 и сразу звучит, собирается русское; метки «наоборот» в шапке нет', () => {
    const v = mk(spellQ('w.kot'));
    v.g.start(5);
    const dir = v.root.querySelector<HTMLButtonElement>('[data-dir]')!;
    expect(dir.hidden).toBe(false);
    dir.click();
    expect(dir.getAttribute('aria-pressed')).toBe('true');
    expect(v.root.querySelector('[data-prompt]')!.textContent).toBe('kot');
    expect(v.root.querySelector('.pq-say')).not.toBeNull();
    expect(v.root.querySelector('.pq-q-hint')!.textContent).toBe('Собери перевод по-русски из букв');
    expect(v.audio).toEqual([{ text: 'kot' }]);
    expect(letters(v.root).every((b) => b.lang === 'ru')).toBe(true);
    expect(v.root.querySelector<HTMLElement>('[data-reverse]')!.hidden).toBe(true);
    // В других играх кнопки нет.
    v.g.stop();
    v.g.start(1);
    expect(dir.hidden).toBe(true);
  });

  it('вёрстка: лист игры 5 выше обычного, при вводе — почти во весь экран; на низком экране всё мельче', () => {
    expect(SPELL_CSS).toMatch(/\.pq-game-box\.spell \{ height: clamp\(250px, calc\(100dvh - 110px\), 470px\); \}/);
    expect(SPELL_CSS).toMatch(/\.pq-game-box\.spell\.typing \{ height: min\(calc\(100dvh - 16px\), 500px\); \}/);
    expect(SPELL_CSS).toMatch(/@media \(max-height: 520px\)/);
    // Слоты одного слова держатся вместе: «Dzień dobry» — две группы.
    const v = mk(spellQ('w.dzien_dobry'));
    v.g.start(5);
    const groups = v.root.querySelectorAll('[data-slots] .pq-sw');
    expect([...groups].map((s) => s.querySelectorAll('[data-slot]').length)).toEqual([5, 5]);
  });
});
