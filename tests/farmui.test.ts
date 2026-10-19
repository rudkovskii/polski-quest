// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Phrase, Topic, Word } from '../src/types/content';
import type { FarmApi, FarmStats, ItemInfo, ItemStatus } from '../src/types/farm';
import { mountDictionary } from '../src/ui/dictionary';
import { mountPantry } from '../src/ui/pantry';
import { createTips } from '../src/ui/glossary';
import { mountPlantCard } from '../src/ui/plantCard';
import { mountSummary } from '../src/ui/summary';
import { BASE, THRESHOLDS, pathOf } from '../src/systems/xp';
import { testBus } from './helpers';

const w = (id: string, pl: string, ru: string, topic: string, extra: Partial<Word> = {}): Word => ({
  id: `w.${id}`, pl, ru, tr: `[${id}]`, pos: 'noun', forms: {}, topic, freq: 1, band: 1, order: 1, ff: null, ex: null, ...extra,
});
const ph = (id: string, pl: string, ru: string, words: string[], topic: string): Phrase => ({
  id: `p.${id}`, pl, ru, tr: `[${id}]`, words, tiles_pl: [], tiles_ru: [], distract_pl: [], distract_ru: [], topic, level: 1,
});

function fakeApi(over: Partial<FarmStats> = {}) {
  const words = [
    w('kot', 'kot', 'кот', 'zwierzeta', { gender: 'm', ex: { pl: 'Mam kota.', ru: 'У меня есть кот.' } }),
    w('zolw', 'żółw', 'черепаха', 'zwierzeta'),
    w('pies', 'pies', 'собака', 'zwierzeta'),
    w('chleb', 'chleb', 'хлеб', 'jedzenie'),
    w('ser', 'ser', 'сыр', 'jedzenie', { ff: { ru: 'сэр', note: 'сыр' } }),
    w('woda', 'woda', 'вода', 'jedzenie'),
  ];
  const phrases = [ph('mam_kota', 'Mam kota.', 'У меня есть кот.', ['w.kot'], 'zwierzeta'), ph('jem_chleb', 'Jem chleb.', 'Я ем хлеб.', ['w.chleb'], 'jedzenie')];
  const topics: Topic[] = [
    { id: 'zwierzeta', pl: 'Zwierzęta', ru: 'Животные' },
    { id: 'jedzenie', pl: 'Jedzenie', ru: 'Еда' },
  ];
  const status = new Map<string, ItemStatus>([['w.kot', 'growing'], ['w.chleb', 'grown']]);
  const stage = new Map<string, ItemInfo['stage']>([['w.kot', 'sprout'], ['p.jem_chleb', null]]);
  const listeners = new Set<() => void>();
  const plant = vi.fn((ids: readonly string[]) => {
    let planted = 0;
    for (const id of ids) {
      if ((status.get(id) ?? 'new') === 'new') {
        status.set(id, 'growing');
        stage.set(id, 'seed');
        planted++;
      }
    }
    for (const f of listeners) f();
    return { planted, bag: 0, skipped: ids.length - planted };
  });
  const say = vi.fn();
  const info = (id: string): ItemInfo => ({
    id, kind: id.startsWith('p.') ? 'phrase' : 'word', status: status.get(id) ?? 'new', stage: stage.get(id) ?? null, drops: 2,
    sides: { pr: true, rp: false }, days: 1, next: 'ещё 1 верный', harvests: 0, dueAt: null, slot: null,
  });
  const api: FarmApi = {
    words, phrases, topics,
    word: (id) => words.find((x) => x.id === id),
    phrase: (id) => phrases.find((x) => x.id === id),
    info,
    // Фраза «Mam kota.» заблокирована: кот ещё не куст.
    missingWords: (id) => (id === 'p.mam_kota' ? ['w.kot'] : []),
    plant,
    stats: () => ({ xp: 120, level: 'Уровень 3', ratio: 0.4, path: pathOf({ grown: 40, partial: 2.5 }), base: BASE, thresholds: THRESHOLDS, sessionGain: 0.4, grownToday: 3, grownTotal: 17, grownWords: 12, grownPhrases: 5, growing: 4, bag: 1, answersToday: 25, ...over }),
    pantry: () => [{ topic: 'jedzenie', ids: ['w.chleb'] }],
    say,
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  return { api, plant, say, status };
}

const setup = () => {
  const root = document.createElement('div');
  document.body.append(root);
  const bus = testBus();
  const input: boolean[] = [];
  bus.on('world:input', ({ enabled }) => input.push(enabled));
  return { root, bus, input };
};
const esc = (bus: ReturnType<typeof testBus>) => bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.dict-row')].map((r) => r.getAttribute('data-id'));
const type = (root: HTMLElement, text: string) => {
  const input = root.querySelector<HTMLInputElement>('[data-search]')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

describe('Słownik', () => {
  it('открытие отключает мир, Esc закрывает и возвращает ввод', () => {
    const { root, bus, input } = setup();
    const d = mountDictionary(root, fakeApi().api, bus);
    d.open();
    expect(d.isOpen).toBe(true);
    expect(rows(root)).toHaveLength(6);
    esc(bus);
    expect(d.isOpen).toBe(false);
    expect(input).toEqual([false, true]);
  });

  it('поиск без диакритики и регистра: «ZOLW» находит «żółw», русский тоже', () => {
    const { root, bus } = setup();
    mountDictionary(root, fakeApi().api, bus).open();
    type(root, 'ZOLW');
    expect(rows(root)).toEqual(['w.zolw']);
    type(root, 'сыр');
    expect(rows(root)).toEqual(['w.ser']);
  });

  it('P3b: поиск идёт по всем темам, активный чип темы не режет выдачу; выбор темы сбрасывает поиск', () => {
    const { root, bus } = setup();
    mountDictionary(root, fakeApi().api, bus).open();
    root.querySelector<HTMLElement>('[data-topic="zwierzeta"]')!.click();
    expect(rows(root)).toEqual(['w.kot', 'w.zolw', 'w.pies']);
    type(root, 'chleb');
    expect(rows(root)).toEqual(['w.chleb']);
    expect(root.querySelector('[data-scope]')?.textContent).toBe('Поиск по всем темам');
    expect(root.querySelector('.dict-topic.on')?.getAttribute('data-topic')).toBe('');
    root.querySelector<HTMLElement>('[data-topic="jedzenie"]')!.click();
    expect(root.querySelector<HTMLInputElement>('[data-search]')!.value).toBe('');
    expect(rows(root)).toEqual(['w.chleb', 'w.ser', 'w.woda']);
  });

  it('P3b: пустая карточка не показывается; шапка (вкладки и поиск) закреплена сверху', () => {
    const { root, bus } = setup();
    mountDictionary(root, fakeApi().api, bus).open();
    const card = root.querySelector<HTMLElement>('[data-card]')!;
    expect(card.parentElement!.hidden).toBe(true);
    expect(card.textContent).toBe('');
    expect(root.textContent).not.toContain('Выбери слово из списка');
    root.querySelector<HTMLElement>('[data-id="w.pies"]')!.click();
    expect(card.parentElement!.hidden).toBe(false);
    const head = root.querySelector('.dict-head')!;
    expect(head.querySelector('[data-search]')).not.toBeNull();
    expect(head.querySelector('[data-tab="words"]')).not.toBeNull();
    expect([...root.querySelectorAll('style')].map((x) => x.textContent).join('')).toMatch(/\.dict-head\s*\{[^}]*position: sticky/);
  });

  it('кнопка «Посадить» сажает выбранное слово и пишет результат', () => {
    const { root, bus } = setup();
    const { api, plant } = fakeApi();
    mountDictionary(root, api, bus).open();
    root.querySelector<HTMLElement>('[data-id="w.pies"]')!.click();
    expect(root.querySelector('[data-card] [data-pl]')?.textContent).toBe('pies');
    root.querySelector<HTMLButtonElement>('[data-plant]')!.click();
    expect(plant).toHaveBeenCalledWith(['w.pies']);
    expect(root.querySelector('[data-note]')?.textContent).toBe('Посажено на грядку');
    expect(root.querySelector('[data-plant]')).toBeNull();
  });

  it('карточка слова: род, пример, ложный друг; ▶ и «медленно» озвучивают', () => {
    const { root, bus } = setup();
    const { api, say } = fakeApi();
    mountDictionary(root, api, bus).open();
    root.querySelector<HTMLElement>('[data-id="w.ser"]')!.click();
    expect(root.querySelector('.ff')?.textContent).toBe('Не путать: похоже на «сэр», а значит: сыр');
    root.querySelector<HTMLElement>('[data-id="w.kot"]')!.click();
    expect(root.querySelector('[data-card]')?.textContent).toContain('м. р.');
    expect(root.querySelector('[data-card]')?.textContent).toContain('Mam kota.');
    root.querySelector<HTMLButtonElement>('[data-say]')!.click();
    root.querySelector<HTMLButtonElement>('[data-say-slow]')!.click();
    expect(say.mock.calls).toEqual([['w.kot'], ['w.kot', true]]);
  });

  it('пример в карточке слова озвучивается кнопкой 🔊 (audio:play с текстом примера), русская строка без неё', () => {
    const { root, bus } = setup();
    const { api } = fakeApi();
    const played: (string | undefined)[] = [];
    bus.on('audio:play', (p) => played.push(p.text));
    mountDictionary(root, api, bus).open();
    root.querySelector<HTMLElement>('[data-id="w.kot"]')!.click();
    expect(root.querySelectorAll('.dict-card .ex .pq-say')).toHaveLength(1);
    root.querySelector<HTMLElement>('.dict-card .ex .pq-say')!.click();
    expect(played).toEqual(['Mam kota.']);
    expect(root.querySelector('.dict-card .ex .ru .pq-say')).toBeNull();
  });

  it('заблокированная фраза: замок, недостающие слова, кнопка неактивна', () => {
    const { root, bus } = setup();
    mountDictionary(root, fakeApi().api, bus).open();
    root.querySelector<HTMLElement>('[data-tab="phrases"]')!.click();
    expect(rows(root)).toEqual(['p.mam_kota', 'p.jem_chleb']);
    expect(root.querySelector('[data-id="p.mam_kota"] .st')?.textContent).toBe('🔒');
    root.querySelector<HTMLElement>('[data-id="p.mam_kota"]')!.click();
    expect(root.querySelector('[data-lock]')?.textContent).toContain('Откроется, когда эти слова подрастут до ростка');
    expect(root.querySelector('[data-lock]')?.textContent).toContain('kot — кот');
    expect(root.querySelector<HTMLButtonElement>('[data-plant]')!.disabled).toBe(true);
  });

  it('«Посадить всю тему» сажает только новые (и доступные), в «Все» кнопки нет', () => {
    const { root, bus } = setup();
    const { api, plant } = fakeApi();
    mountDictionary(root, api, bus).open();
    const bulk = root.querySelector<HTMLButtonElement>('[data-bulk]')!;
    expect(bulk.hidden).toBe(true);
    root.querySelector<HTMLElement>('[data-topic="zwierzeta"]')!.click();
    expect(bulk.hidden).toBe(false);
    expect(bulk.textContent).toBe('Посадить всю тему (2)'); // kot уже растёт
    bulk.click();
    expect(plant).toHaveBeenCalledWith(['w.zolw', 'w.pies']);
    root.querySelector<HTMLElement>('[data-tab="phrases"]')!.click();
    root.querySelector<HTMLElement>('[data-topic="zwierzeta"]')!.click();
    expect(root.querySelector<HTMLButtonElement>('[data-bulk]')!.hidden).toBe(true); // единственная фраза темы закрыта
  });

  it('после «Посадить всю тему» тема остаётся выбранной и подсвечена, подпись стадии русская', () => {
    const { root, bus } = setup();
    mountDictionary(root, fakeApi().api, bus).open();
    const chip = (t: string) => root.querySelector(`[data-topic="${t}"]`)!;
    expect(chip('').classList.contains('on')).toBe(true);
    chip('zwierzeta').dispatchEvent(new Event('click'));
    expect(chip('zwierzeta').classList.contains('on')).toBe(true);
    expect(chip('').classList.contains('on')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-bulk]')!.click();
    expect(chip('zwierzeta').classList.contains('on')).toBe(true);
    expect(rows(root).every((id) => ['w.kot', 'w.zolw', 'w.pies'].includes(id ?? ''))).toBe(true);
    root.querySelector<HTMLElement>('[data-id="w.kot"]')!.click();
    expect(root.querySelector('[data-status]')?.textContent).toContain('росток');
    expect(root.querySelector('[data-status] [data-icon="icon_sprout"]')).not.toBeNull();
    expect([...root.querySelectorAll('[data-legend] [data-stage]')].map((e) => e.textContent)).toEqual(['семечко', 'росток', 'кустик', 'урожай', 'перезрело — повтори']);
  });

  it('пояснение «Банка = выученное слово» показывается один раз, после закрытия экрана — больше нет', () => {
    const { root, bus } = setup();
    const seen: string[] = [];
    const tips = createTips({ seen: (id) => seen.includes(id), mark: (id) => seen.push(id) });
    const sum = mountSummary(root, fakeApi().api, bus, tips);
    sum.openBed();
    expect(root.querySelector('[data-tip="jar"]')?.textContent).toContain('Банка = выученное слово');
    expect(root.querySelector('[data-tip="bag"]')?.textContent).toContain('Мешок = семена, которым не хватило грядки');
    sum.close();
    expect(seen).toEqual(['tip:jar', 'tip:bag']);
    sum.openBed();
    expect(root.querySelector('[data-tip]')).toBeNull();
  });

  it('стрелки и Enter через шину: ход по [data-nav] и нажатие', () => {
    const { root, bus } = setup();
    mountDictionary(root, fakeApi().api, bus).open();
    const focus = () => root.querySelector('.is-focus')?.getAttribute('data-nav');
    expect(focus()).toBe('row:w.kot');
    bus.emit('input:intent', { type: 'move', dir: 'down', held: true, to: 'ui', source: 'keyboard' });
    expect(focus()).toBe('row:w.zolw');
    bus.emit('input:intent', { type: 'interact', to: 'ui', source: 'keyboard' });
    expect(root.querySelector('[data-card] [data-pl]')?.textContent).toBe('żółw');
    bus.emit('input:intent', { type: 'move', dir: 'right', held: true, to: 'ui', source: 'keyboard' });
    expect(focus()).toBe('say');
  });
});

describe('Spiżarnia', () => {
  it('банка открывает список слов темы', () => {
    const { root, bus } = setup();
    const p = mountPantry(root, fakeApi().api, bus);
    p.open();
    expect(root.querySelector('[data-sum]')?.textContent).toBe('Собрано: 1 слов, 0 фраз');
    root.querySelector<HTMLElement>('[data-jar="jedzenie"]')!.click();
    expect(root.querySelector('[data-jar-list]')?.textContent).toContain('chleb');
    expect(root.querySelector('[data-jar-list]')?.textContent).toContain('хлеб');
  });
});

describe('Spiżarnia: Esc и B', () => {
  it('в списке банки Esc/B возвращает к полке, на полке закрывает панель', () => {
    const { root, bus } = setup();
    const p = mountPantry(root, fakeApi().api, bus);
    p.open();
    const cancel = (): void => bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    root.querySelector<HTMLElement>('[data-jar="jedzenie"]')!.click();
    expect(root.querySelector('[data-jar-list]')).not.toBeNull();
    cancel();
    expect(p.isOpen).toBe(true);
    expect(root.querySelector('[data-jar-list]')).toBeNull();
    expect(root.querySelector('[data-jar="jedzenie"]')).not.toBeNull();
    cancel();
    expect(p.isOpen).toBe(false);
  });
});

describe('коробка, кровать и карточка растения', () => {
  it('кровать показывает уровень и опыт; коробка — только урожай; открытие одной панели закрывает другую', () => {
    const { root, bus, input } = setup();
    const s = mountSummary(root, fakeApi().api, bus);
    const d = mountDictionary(root, fakeApi().api, bus);
    s.openBin();
    expect(root.textContent).toContain('Skrzynka');
    expect(root.textContent).toContain('носит фермер сам');
    s.openBed();
    expect(root.querySelector('[data-level]')?.textContent).toContain('Уровень 3/20');
    expect(root.querySelector('[data-session-gain]')?.textContent).toBe('+0,4 уровня за сессию');
    expect(root.textContent).not.toMatch(/до завтра|лимит|приходи завтра/);
    d.open();
    expect(s.isOpen).toBe(false);
    expect(d.isOpen).toBe(true);
    d.close();
    expect(input.at(-1)).toBe(true);
  });

  it('карточка растения: стадия, капли, «Повторить сейчас» закрывает и зовёт onReview', () => {
    const { root, bus } = setup();
    const onReview = vi.fn();
    const c = mountPlantCard(root, fakeApi().api, { onReview }, bus);
    c.open('w.kot');
    expect(root.textContent).toContain('росток');
    expect(root.textContent).toContain('💧×2');
    expect(root.textContent).toContain('1 из 3');
    root.querySelector<HTMLButtonElement>('[data-review]')!.click();
    expect(c.isOpen).toBe(false);
    expect(onReview).toHaveBeenCalledWith('w.kot');
  });
});

describe('значки стадий в словаре', () => {
  it('семя, росток, куст, урожай, перезревшее и мешок — разные значки; кадры совпадают с атласом', async () => {
    const { iconKeyOf, ICON_FRAMES, ATLAS_SIZE } = await import('../src/ui/stageIcon');
    const base = { kind: 'word' as const };
    const keys = [
      iconKeyOf({ ...base, status: 'growing', stage: 'seed' }),
      iconKeyOf({ ...base, status: 'growing', stage: 'sprout' }),
      iconKeyOf({ ...base, status: 'growing', stage: 'bush' }),
      iconKeyOf({ ...base, status: 'grown', stage: null }),
      iconKeyOf({ ...base, status: 'growing', stage: 'overripe' }),
    ];
    expect(new Set(keys).size).toBe(5);
    expect(iconKeyOf({ ...base, status: 'new', stage: null })).toBeNull();
    const atlas = (await import('../public/atlas/custom.json')).default as unknown as {
      frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
      meta: { size: { w: number; h: number } };
    };
    // background-size строится от размера атласа: устаревшая высота растягивает значки.
    expect(ATLAS_SIZE).toEqual(atlas.meta.size);
    for (const [k, [x, y]] of Object.entries(ICON_FRAMES)) expect(atlas.frames[`${k}/0`]!.frame).toMatchObject({ x, y, w: 16, h: 16 });
  });
  it('в списке у слов на разных стадиях разные значки', () => {
    const { root, bus } = setup();
    const { api } = fakeApi();
    mountDictionary(root, api, bus).open();
    const ico = (id: string) => root.querySelector(`[data-id="${id}"] [data-icon]`)?.getAttribute('data-icon') ?? null;
    expect(ico('w.kot')).toBe('icon_sprout');
    expect(ico('w.chleb')).toBe('icon_ripe');
    expect(ico('w.pies')).toBeNull();
  });
});
