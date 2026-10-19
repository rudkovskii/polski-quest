// @vitest-environment happy-dom
// Свои слова («＋ Своё слово»): поиск по русскому словарю (ё/е, формы), ручной ввод, посадка, сохранение и перезагрузка,
// не входят в путь к A1, удаление, озвучка, загрузка файла словаря.
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { A1_IDS, ALL_WORDS, TOPICS, WORDS, WORD_BY_ID, isA1 } from '../src/systems/content';
import { CUSTOM_LIMIT, baseMatches, customId, forgetItem, lookupRu, normRu, normalizeCustom, parseRupl, toWord, type CustomWord, type RuplDb } from '../src/systems/customWords';
import { createFarm } from '../src/systems/farm';
import { newGarden, type GardenSave } from '../src/systems/garden';
import { createRuplLoader } from '../src/systems/platform/rupl';
import { exportSave, importSave, newSave, normalizeSave } from '../src/systems/save';
import { translit } from '../src/systems/translit';
import { mountDictionary } from '../src/ui/dictionary';
import { mountPantry } from '../src/ui/pantry';
import { seeded, testBus } from './helpers';

const T0 = Date.UTC(2026, 9, 18, 9, 0);

/** Мини-словарь в формате rupl.json: леммы и формы. */
const SMALL: RuplDb = {
  d: {
    машина: [['samochód', 'n', 'm'], ['auto', 'n', 'n'], ['maszyna', 'n', 'f']],
    вдохновение: [['wena', 'n', 'f'], ['inspiracja', 'n', 'f']],
    пельмень: [['pielmień', 'n', 'm']],
    елка: [['choinka', 'n', 'f']],
    читать: [['czytać', 'v', 'ipf'], ['odczytywać', 'v', '']],
    дом: [['dom', 'n', 'm']],
  },
  f: { пельмени: 'пельмень', читаю: 'читать' },
};
const REAL: RuplDb = parseRupl(JSON.parse(gunzipSync(readFileSync('public/dict/rupl.json.gz')).toString('utf8')))!;

interface Store {
  garden: GardenSave;
  custom: CustomWord[];
}
function setup(init: Partial<Store> = {}, now = { t: T0 }) {
  const bus = testBus();
  const store: Store = { garden: init.garden ?? newGarden(), custom: init.custom ?? [] };
  const said: string[] = [];
  const farm = createFarm({
    bus,
    load: () => store.garden,
    save: (g) => (store.garden = g),
    now: () => now.t,
    tz: () => 0,
    say: (id) => said.push(id),
    rand: seeded(3),
    customs: { load: () => store.custom, save: (c) => (store.custom = c) },
  });
  return { bus, farm, store, said, now };
}
const solve = (f: ReturnType<typeof setup>['farm'], id: string, ok = true): void => {
  const q = f.next(1, id)!;
  f.answer(q, ok ? q.answer : 'не то');
};

describe('translit.ts: порт совпадает с базой A1', () => {
  it('транскрипция всех слов базы A1 равна tr из words.json', () => {
    const bad = WORDS.filter((w) => translit(w.pl) !== w.tr);
    expect(bad.map((w) => `${w.pl}: ${translit(w.pl)} ≠ ${w.tr}`).slice(0, 5)).toEqual([]);
  });
});

describe('поиск по словарю', () => {
  it('нормализация: регистр, ё→е, ударение, пробелы', () => {
    expect(normRu('  ЁЛКА ')).toBe('елка');
    expect(normRu('Ма́шина')).toBe('машина');
    expect(normRu('ёж  и   еж')).toBe('еж и еж');
    // й не разваливается на и + бреве
    expect(normRu('Край')).toBe('край');
  });

  it('лемма: варианты по порядку, часть речи, род, транскрипция', () => {
    const h = lookupRu(SMALL, 'Машина')!;
    expect(h.lemma).toBe('машина');
    expect(h.viaForm).toBe(false);
    expect(h.variants.map((v) => v.pl)).toEqual(['samochód', 'auto', 'maszyna']);
    expect(h.variants[0]).toMatchObject({ pos: 'noun', gender: 'm', tr: translit('samochód') });
    const v = lookupRu(SMALL, 'читать')!.variants;
    expect(v[0]).toMatchObject({ pos: 'verb', aspect: 'ipf' });
    expect(v[1]!.aspect).toBeUndefined();
  });

  it('формы через алиасы: пельмени → пельмень, читаю → читать', () => {
    const h = lookupRu(SMALL, 'пельмени')!;
    expect(h).toMatchObject({ lemma: 'пельмень', viaForm: true, query: 'пельмени' });
    expect(h.variants[0]!.pl).toBe('pielmień');
    expect(lookupRu(SMALL, 'Читаю')!.lemma).toBe('читать');
  });

  it('ё и е: «ёлка» находит ключ «елка», в обе стороны', () => {
    expect(lookupRu(SMALL, 'ёлка')!.variants[0]!.pl).toBe('choinka');
    expect(lookupRu(SMALL, 'елка')!.variants[0]!.pl).toBe('choinka');
    expect(lookupRu(REAL, 'ёж')?.variants[0]?.pl ?? lookupRu(REAL, 'еж')?.variants[0]?.pl).toBe('jeż');
  });

  it('нет в словаре, пустой запрос и служебные слова JS → null', () => {
    expect(lookupRu(SMALL, 'абракадабра')).toBeNull();
    expect(lookupRu(SMALL, '   ')).toBeNull();
    for (const w of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(lookupRu(SMALL, w)).toBeNull();
  });

  it('настоящий словарь: «машина», «вдохновение», «пельмени»', () => {
    expect(lookupRu(REAL, 'машина')!.variants[0]!.pl).toBe('samochód');
    expect(lookupRu(REAL, 'вдохновение')!.variants.map((v) => v.pl)).toContain('inspiracja');
    const p = lookupRu(REAL, 'пельмени')!;
    expect(p.viaForm).toBe(true);
    expect(p.variants.map((v) => v.pl)).toContain('pielmień');
    expect(lookupRu(REAL, 'книги')!.lemma).toBe('книга');
  });

  it('слово уже есть в базе A1: по русскому переводу (и части через ;), с леммой', () => {
    expect(baseMatches(WORDS, 'дом').map((w) => w.id)).toContain('w.dom');
    expect(baseMatches(WORDS, 'Машина').map((w) => w.id)).toContain('w.samochod');
    expect(baseMatches(WORDS, 'здравствуйте').map((w) => w.id)).toContain('w.dzien_dobry');
    expect(baseMatches(WORDS, 'пельмень')).toEqual([]);
  });
});

describe('раздел Save.custom', () => {
  it('старое сохранение (v3 без custom) читается как пустой список, остальное цело', () => {
    const old = JSON.parse(JSON.stringify(newSave(5))) as Record<string, unknown>;
    delete old.custom;
    old.v = 3;
    const s = normalizeSave(old)!;
    expect(s.custom).toEqual([]);
    expect(s.garden).toEqual(newGarden());
    expect(normalizeSave({ v: 2, created: 1 })!.custom).toEqual([]);
  });

  it('экспорт и импорт сохраняют свои слова, мусор отбрасывается', () => {
    const c: CustomWord = { id: customId('samochód', 'машина'), pl: 'samochód', ru: 'машина', pos: 'noun', gender: 'm', ex: { pl: 'Mam samochód.', ru: 'У меня есть машина.' }, added: 7 };
    const save = { ...newSave(1), custom: [c] };
    const r = importSave(exportSave(save));
    expect(r.ok && r.save.custom).toEqual([c]);
    const dirty = normalizeCustom([c, c, null, 5, { id: 'w.kot', pl: 'x', ru: 'y' }, { id: 'w.custom.a', pl: '', ru: 'y' }, { id: 'w.custom.b', pl: 'x', ru: 'y', pos: 'жук', gender: 'q', added: 'x' }]);
    expect(dirty.map((x) => x.id)).toEqual([c.id, 'w.custom.b']);
    expect(dirty[1]).toMatchObject({ pos: 'noun', added: 0 });
    expect(dirty[1]!.gender).toBeUndefined();
    expect(normalizeCustom(Array.from({ length: CUSTOM_LIMIT + 20 }, (_, i) => ({ id: `w.custom.${i}`, pl: 'a', ru: 'b' }))).length).toBe(CUSTOM_LIMIT);
  });

  it('id: w.custom.<хеш>, одна пара даёт один id, ё/е и регистр не важны; занятый хеш другой парой — с числом', () => {
    const a = customId('Samochód', 'Ёлка');
    expect(a).toMatch(/^w\.custom\.[0-9a-z]+$/);
    expect(customId('samochód', 'елка')).toBe(a);
    expect(customId('auto', 'елка')).not.toBe(a);
    expect(customId('x', 'y', [{ id: customId('x', 'y'), pl: 'q', ru: 'w' }])).toBe(`${customId('x', 'y')}_1`);
  });
});

describe('ферма: свои слова', () => {
  it('добавить: слово в словаре, тема «Moje słowa» в конце, транскрипция сама, дубль не плодится', () => {
    const { farm, store } = setup();
    expect(TOPICS.some((t) => t.id === 'moje')).toBe(false);
    const r = farm.custom!.add({ pl: 'pielmień', ru: 'пельмень', pos: 'noun', gender: 'm' });
    expect(r).toMatchObject({ ok: true, existed: false });
    const id = (r as { id: string }).id;
    expect(id.startsWith('w.custom.')).toBe(true);
    const w = farm.word(id)!;
    expect(w).toMatchObject({ pl: 'pielmień', ru: 'пельмень', tr: translit('pielmień'), topic: 'moje', pos: 'noun', gender: 'm' });
    expect(farm.words).toContain(w);
    expect(TOPICS[TOPICS.length - 1]!.id).toBe('moje');
    expect(farm.topics).toBe(TOPICS);
    expect(store.custom.map((c) => c.id)).toEqual([id]);
    expect(farm.custom!.add({ pl: 'Pielmień', ru: 'пельмень' })).toEqual({ ok: true, id, existed: true });
    expect(store.custom).toHaveLength(1);
    expect(farm.custom!.add({ pl: ' ', ru: 'x' })).toEqual({ ok: false, reason: 'empty' });
    expect(farm.custom!.add({ pl: 'x', ru: '' })).toEqual({ ok: false, reason: 'empty' });
  });

  it('новые слова первыми; пример необязателен; правка меняет польское и перевод, id остаётся', () => {
    const { farm, store } = setup();
    const a = (farm.custom!.add({ pl: 'jeden', ru: 'один' }) as { id: string }).id;
    const b = (farm.custom!.add({ pl: 'dwa', ru: 'два', ex: { pl: 'Mam dwa koty.', ru: 'У меня два кота.' } }) as { id: string }).id;
    expect(farm.custom!.list().map((w) => w.id)).toEqual([b, a]);
    expect(farm.word(a)!.ex).toBeNull();
    expect(farm.word(b)!.ex).toEqual({ pl: 'Mam dwa koty.', ru: 'У меня два кота.' });
    expect(farm.custom!.update(a, { pl: 'jedna', ru: 'одна', ex: { pl: 'Jedna kawa.' } })).toBe(true);
    expect(farm.word(a)).toMatchObject({ id: a, pl: 'jedna', ru: 'одна', tr: translit('jedna'), ex: { pl: 'Jedna kawa.', ru: '' } });
    expect(store.custom.find((c) => c.id === a)).toMatchObject({ pl: 'jedna', ru: 'одна' });
    expect(farm.custom!.update(b, { ex: null })).toBe(true);
    expect(farm.word(b)!.ex).toBeNull();
    expect(farm.custom!.update(a, { pl: '' })).toBe(false);
    expect(farm.custom!.update('w.custom.net', { pl: 'x' })).toBe(false);
    expect(farm.word(a)!.pl).toBe('jedna');
  });

  it('посадка и рост как у обычных слов: задания, ответы, свои слова не входят в A1', () => {
    const { farm, store } = setup();
    const id = (farm.custom!.add({ pl: 'pielmień', ru: 'пельмень' }) as { id: string }).id;
    expect(isA1(id)).toBe(false);
    expect(A1_IDS.has(id)).toBe(false);
    expect(farm.info(id).status).toBe('new');
    const path0 = JSON.stringify(farm.stats().path);
    const base0 = JSON.stringify(farm.stats().base);
    expect(farm.plant([id])).toMatchObject({ planted: 1 });
    expect(farm.info(id).status).toBe('growing');
    expect(farm.plants().map((p) => p.id)).toEqual([id]);
    expect(farm.plants()[0]!.label).toBe('pielmień');
    // Единственное растение: задание про него, четыре варианта, верный ответ засчитывается и даёт опыт.
    const q = farm.next(1)!;
    expect(q.id).toBe(id);
    expect(q.kind === 'choice' && q.options).toHaveLength(4);
    const out = farm.answer(q, q.answer);
    expect(out.ok).toBe(true);
    expect(farm.state.xp).toBeGreaterThan(0);
    const q2 = farm.next(2, id)!;
    expect(q2.kind === 'choice' && q2.options).toContain('pielmień');
    // Путь к A1 не сдвинулся ни на очко: он считается только по базе.
    expect(JSON.stringify(farm.stats().path)).toBe(path0);
    expect(JSON.stringify(farm.stats().base)).toBe(base0);
    expect(store.garden.planted.map((p) => p.id)).toEqual([id]);
  });

  it('выращенное своё слово лежит в банке «Moje słowa» (Spiżarnia)', () => {
    const now = { t: T0 };
    const { farm } = setup({}, now);
    const id = (farm.custom!.add({ pl: 'pielmień', ru: 'пельмень' }) as { id: string }).id;
    farm.plant([id]);
    for (let day = 0; day < 4; day++) {
      now.t = T0 + day * 86_400_000;
      // Игра 5 — слово собрано само (нужно для урожая слова).
      for (const mode of [1, 5, 1, 2] as const) {
        const q = farm.next(mode, id)!;
        farm.answer(q, q.answer);
      }
    }
    expect(farm.info(id).status).toBe('grown');
    expect(farm.pantry()).toEqual([{ topic: 'moje', ids: [id] }]);
    const root = document.createElement('div');
    mountPantry(root, farm).open();
    const jar = root.querySelector('[data-jar="moje"]')!;
    expect(jar.textContent).toContain('Moje słowa');
    expect(jar.textContent).toContain('1 / 1');
  });

  it('сохранение и перезагрузка: слова, посадка и рост на месте, содержимое то же', () => {
    const a = setup();
    const id = (a.farm.custom!.add({ pl: 'inspiracja', ru: 'вдохновение', pos: 'noun', gender: 'f', ex: { pl: 'Szukam inspiracji.', ru: 'Ищу вдохновение.' } }) as { id: string }).id;
    a.farm.plant([id]);
    solve(a.farm, id);
    const saved = JSON.parse(JSON.stringify(a.store)) as Store;
    // «Перезагрузка»: новая ферма из того, что лежит в сохранении.
    const b = setup(saved);
    expect(b.farm.word(id)).toEqual(a.farm.word(id));
    expect(b.farm.info(id)).toMatchObject({ status: 'growing' });
    expect(b.farm.plants().map((p) => p.id)).toEqual([id]);
    expect(b.farm.state.xp).toBe(a.farm.state.xp);
    expect(TOPICS[TOPICS.length - 1]!.id).toBe('moje');
    // Через экспорт файлом тоже.
    const file = importSave(exportSave({ ...newSave(1), garden: saved.garden, custom: saved.custom }));
    expect(file.ok && file.save.custom).toEqual(saved.custom);
  });

  it('ферма без своих слов не оставляет следа: тема убрана, слово исчезло из словаря', () => {
    const a = setup();
    const id = (a.farm.custom!.add({ pl: 'dwa', ru: 'два' }) as { id: string }).id;
    expect(WORD_BY_ID.has(id)).toBe(true);
    const n = ALL_WORDS.length;
    setup();
    expect(WORD_BY_ID.has(id)).toBe(false);
    expect(ALL_WORDS.length).toBe(n - 1);
    expect(TOPICS.some((t) => t.id === 'moje')).toBe(false);
  });

  it('удалить нерастущее: без следов; растущее: вместе с посадкой, ответами и грядкой; соседи целы', () => {
    const { farm, store } = setup();
    const a = (farm.custom!.add({ pl: 'jeden', ru: 'один' }) as { id: string }).id;
    const b = (farm.custom!.add({ pl: 'dwa', ru: 'два' }) as { id: string }).id;
    expect(farm.custom!.remove(a)).toBe(true);
    expect(farm.word(a)).toBeUndefined();
    expect(store.custom.map((c) => c.id)).toEqual([b]);
    expect(farm.custom!.remove(a)).toBe(false);
    farm.plant([b, WORDS[0]!.id]);
    solve(farm, b);
    solve(farm, WORDS[0]!.id);
    expect(farm.info(b).slot).not.toBeNull();
    expect(farm.custom!.remove(b)).toBe(true);
    expect(farm.word(b)).toBeUndefined();
    expect(TOPICS.some((t) => t.id === 'moje')).toBe(false);
    expect(store.custom).toEqual([]);
    expect(store.garden.planted.map((p) => p.id)).toEqual([WORDS[0]!.id]);
    expect(store.garden.log.every((e) => e.id === WORDS[0]!.id)).toBe(true);
    expect(Object.keys(store.garden.slots)).toEqual([WORDS[0]!.id]);
    expect(farm.plants().map((p) => p.id)).toEqual([WORDS[0]!.id]);
    expect(farm.next(1)!.id).toBe(WORDS[0]!.id);
  });

  it('следы своих слов без записи в Save.custom (битый импорт) убираются из огорода', () => {
    const g = forgetItem(newGarden(), 'x');
    const broken: GardenSave = { ...g, planted: [{ t: T0, id: 'w.custom.zzz' }, { t: T0, id: WORDS[0]!.id }], log: [], slots: { 'w.custom.zzz': 0, [WORDS[0]!.id]: 1 } };
    const { farm } = setup({ garden: broken });
    expect(farm.garden.planted.map((p) => p.id)).toEqual([WORDS[0]!.id]);
    expect(farm.plants().map((p) => p.id)).toEqual([WORDS[0]!.id]);
  });

  it('озвучка: say отдаёт id своего слова, текст берётся у слова (Web Speech pl-PL, файла нет)', () => {
    const { farm, said } = setup();
    const id = (farm.custom!.add({ pl: 'pielmień', ru: 'пельмень' }) as { id: string }).id;
    farm.say(id);
    expect(said).toEqual([id]);
    expect(farm.word(said[0]!)!.pl).toBe('pielmień');
  });
});

// ───────────── экран ─────────────

function screen(init: Partial<Store> = {}, db: RuplDb | null = SMALL) {
  const s = setup(init);
  const root = document.createElement('div');
  document.body.append(root);
  const loadDict = vi.fn(async () => db);
  const dict = mountDictionary(root, s.farm, s.bus, undefined, { loadDict });
  dict.open();
  const $ = <T extends Element = HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const $$ = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const submit = (form: Element): void => void form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const fill = (el: HTMLInputElement, v: string): void => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const find = async (q: string): Promise<void> => {
    fill($<HTMLInputElement>('[data-cw-input]'), q);
    submit($('[data-cw-ask]'));
    await flush();
  };
  const openAdd = (): void => $('[data-tab="add"]').click();
  return { ...s, root, dict, loadDict, $, $$, flush, submit, fill, find, openAdd };
}

describe('экран «＋ Своё слово»', () => {
  it('вкладка есть, поле ввода по-русски, список слов уходит и возвращается', () => {
    const t = screen();
    expect(t.$('[data-tab="add"]')).toBeTruthy();
    expect(t.$('[data-custom]').hidden).toBe(true);
    t.openAdd();
    expect(t.$('[data-custom]').hidden).toBe(false);
    expect(t.$('[data-cols]').hidden).toBe(true);
    expect(t.$('[data-search]').hidden).toBe(true);
    expect(t.$('[data-cw-input]').getAttribute('lang')).toBe('ru');
    t.$('[data-tab="words"]').click();
    expect(t.$('[data-custom]').hidden).toBe(true);
    expect(t.$('[data-cols]').hidden).toBe(false);
    expect(t.$$('.dict-row').length).toBeGreaterThan(0);
  });

  it('без api.custom вкладки нет (чужие фейки ферм не ломаются)', () => {
    const { farm } = setup();
    const { custom: _c, ...rest } = farm;
    const root = document.createElement('div');
    mountDictionary(root, { ...rest, custom: undefined } as never, testBus()).open();
    expect(root.querySelector('[data-tab="add"]')).toBeNull();
  });

  it('«вдохновение»: варианты с частью речи, родом и транскрипцией; тап → форма; правка польского; посадить', async () => {
    const t = screen();
    t.openAdd();
    await t.find('Вдохновение');
    const vars = t.$$('[data-cw-variant]');
    expect(vars.map((v) => v.getAttribute('data-cw-variant'))).toEqual(['wena', 'inspiracja']);
    expect(vars[1]!.textContent).toContain('inspiracja');
    expect(vars[1]!.textContent).toContain(translit('inspiracja'));
    expect(vars[1]!.textContent).toContain('сущ.');
    expect(vars[1]!.textContent).toContain('ж. р.');
    // У каждого польского варианта и у слова базы есть 🔊 рядом (внутри кнопки варианта её нет: кнопка в кнопке недопустима).
    expect(t.$$('.cw-varrow > .pq-say')).toHaveLength(2);
    expect(vars[1]!.querySelector('.pq-say')).toBeNull();
    const heard: (string | undefined)[] = [];
    t.bus.on('audio:play', (p) => heard.push(p.text));
    t.$$('.cw-varrow > .pq-say')[1]!.click();
    expect(heard).toEqual(['inspiracja']);
    expect(t.$('[data-cw-variants]').textContent).not.toContain('🔊');
    expect(t.loadDict).toHaveBeenCalledTimes(1);
    vars[1]!.click();
    const pl = t.$<HTMLInputElement>('[data-cw-pl]');
    expect(pl.value).toBe('inspiracja');
    expect(t.$<HTMLInputElement>('[data-cw-ru]').value).toBe('вдохновение');
    expect(t.$('[data-cw-tr]').textContent).toBe(translit('inspiracja'));
    // Поправить руками: транскрипция пересчитывается сразу.
    t.fill(pl, 'natchnienie');
    expect(t.$('[data-cw-tr]').textContent).toBe(translit('natchnienie'));
    t.fill(t.$<HTMLInputElement>('[data-cw-expl]'), 'Szukam natchnienia.');
    t.submit(t.$('[data-cw-form]'));
    const c = t.store.custom;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ pl: 'natchnienie', ru: 'вдохновение', pos: 'noun', gender: 'f', ex: { pl: 'Szukam natchnienia.', ru: '' } });
    expect(t.farm.info(c[0]!.id).status).toBe('growing');
    expect(t.$('[data-cw-done]').textContent).toBe('natchnienie');
    expect(t.$<HTMLInputElement>('[data-cw-input]').value).toBe('');
  });

  it('форма слова: «пельмени» → «пельмень», перевод дан для леммы', async () => {
    const t = screen();
    t.openAdd();
    await t.find('пельмени');
    expect(t.$('[data-cw-variants]').textContent).toContain('pielmień');
    expect(t.$('[data-cw-out]').textContent).toContain('форма слова «пельмень»');
    t.$$('[data-cw-variant]')[0]!.click();
    expect(t.$<HTMLInputElement>('[data-cw-ru]').value).toBe('пельмень');
    expect(t.$('[data-cw-form]').textContent).toContain('форма слова');
    t.submit(t.$('[data-cw-form]'));
    expect(t.store.custom[0]).toMatchObject({ pl: 'pielmień', ru: 'пельмень' });
  });

  it('нет в словаре → польское вводит сам, транскрипция генерируется, слово растёт', async () => {
    const t = screen();
    t.openAdd();
    await t.find('абракадабра');
    expect(t.$$('[data-cw-variant]')).toHaveLength(0);
    expect(t.$('.cw-msg.warn').textContent).toContain('нет «абракадабра»');
    expect(t.$<HTMLInputElement>('[data-cw-ru]').value).toBe('абракадабра');
    // Пустое польское не принимается.
    t.submit(t.$('[data-cw-form]'));
    expect(t.$('[data-cw-err]').textContent).toContain('польское');
    expect(t.store.custom).toHaveLength(0);
    t.fill(t.$<HTMLInputElement>('[data-cw-pl]'), 'abrakadabra');
    expect(t.$('[data-cw-tr]').textContent).toBe(translit('abrakadabra'));
    t.submit(t.$('[data-cw-form]'));
    expect(t.store.custom[0]).toMatchObject({ pl: 'abrakadabra', ru: 'абракадабра', pos: 'noun' });
    expect(t.farm.info(t.store.custom[0]!.id).status).toBe('growing');
  });

  it('словарь не загрузился (офлайн) → сказать об этом и дать ввести слово самому', async () => {
    const t = screen({}, null);
    t.openAdd();
    await t.find('машина');
    expect(t.$('.cw-msg.warn').textContent).toContain('не загрузился');
    expect(t.$('[data-cw-form]')).toBeTruthy();
  });

  it('слово уже есть в базе: «Это слово уже есть в базе» и посадка слова базы', async () => {
    const t = screen();
    t.openAdd();
    await t.find('машина');
    expect(t.$('[data-cw-out]').textContent).toContain('уже есть в базе');
    const row = t.$('[data-cw-base="w.samochod"]');
    expect(row.textContent).toContain('samochód');
    // Варианты для своего слова остаются рядом.
    expect(t.$$('[data-cw-variant]').length).toBe(3);
    t.$('[data-cw-plant-base="w.samochod"]').click();
    expect(t.farm.info('w.samochod').status).toBe('growing');
    expect(t.store.custom).toHaveLength(0);
    expect(t.$('[data-cw-done]').textContent).toBe('samochód');
    // Второй раз: уже растёт, кнопки посадки нет.
    await t.find('Машина');
    expect(t.$('[data-cw-base="w.samochod"]').textContent).toContain('растёт');
    expect(t.root.querySelector('[data-cw-plant-base]')).toBeNull();
  });

  it('«Только в словарь»: сохраняет, не сажает; слово видно в теме «Moje słowa»', async () => {
    const t = screen();
    t.openAdd();
    await t.find('пельмени');
    t.$$('[data-cw-variant]')[0]!.click();
    t.$('[data-cw-store]').click();
    const id = t.store.custom[0]!.id;
    expect(t.farm.info(id).status).toBe('new');
    t.$('[data-tab="words"]').click();
    const chip = t.$('[data-topic="moje"]');
    expect(chip.textContent).toContain('Moje słowa');
    chip.click();
    expect(t.$$('.dict-row').map((r) => r.getAttribute('data-id'))).toEqual([id]);
    t.$('.dict-row').click();
    expect(t.$('[data-pl]').textContent).toBe('pielmień');
    expect(t.$('[data-plant]')).toBeTruthy();
  });

  it('правка своего слова: карточка → «Изменить» → сохранить', async () => {
    const t = screen();
    const id = (t.farm.custom!.add({ pl: 'pielmen', ru: 'пельмень' }) as { id: string }).id;
    t.$('[data-tab="words"]').click();
    t.$('[data-topic="moje"]').click();
    t.$('.dict-row').click();
    t.$('[data-edit]').click();
    expect(t.$('[data-custom]').hidden).toBe(false);
    expect(t.$<HTMLInputElement>('[data-cw-pl]').value).toBe('pielmen');
    t.fill(t.$<HTMLInputElement>('[data-cw-pl]'), 'pielmień');
    t.submit(t.$('[data-cw-form]'));
    expect(t.farm.word(id)!.pl).toBe('pielmień');
    expect(t.$('[data-custom]').hidden).toBe(true);
    expect(t.$('[data-pl]').textContent).toBe('pielmień');
    // Отмена правки возвращает к списку.
    t.$('[data-edit]').click();
    t.$('[data-cw-cancel]').click();
    expect(t.$('[data-custom]').hidden).toBe(true);
    expect(t.$$('.dict-row').length).toBe(1);
  });

  it('удалить: не выращенное — без вопросов; растёт — с подтверждением; «Оставить» отменяет', () => {
    const t = screen();
    const a = (t.farm.custom!.add({ pl: 'jeden', ru: 'один' }) as { id: string }).id;
    const b = (t.farm.custom!.add({ pl: 'dwa', ru: 'два' }) as { id: string }).id;
    t.$('[data-tab="words"]').click();
    t.$('[data-topic="moje"]').click();
    // b — новое слово сверху.
    expect(t.$$('.dict-row').map((r) => r.getAttribute('data-id'))).toEqual([b, a]);
    t.$$('.dict-row')[1]!.click();
    t.$('[data-del]').click();
    expect(t.root.querySelector('[data-confirm-del]')).toBeNull();
    expect(t.farm.word(a)).toBeUndefined();
    expect(t.$$('.dict-row').map((r) => r.getAttribute('data-id'))).toEqual([b]);
    // Растущее: спрашивает.
    t.farm.plant([b]);
    solve(t.farm, b);
    t.$('.dict-row').click();
    t.$('[data-del]').click();
    expect(t.$('[data-confirm-del]').textContent).toContain('уже растёт');
    expect(t.farm.word(b)).toBeDefined();
    t.$('[data-del-no]').click();
    expect(t.root.querySelector('[data-confirm-del]')).toBeNull();
    expect(t.farm.word(b)).toBeDefined();
    t.$('[data-del]').click();
    t.$('[data-del-yes]').click();
    expect(t.farm.word(b)).toBeUndefined();
    expect(t.store.custom).toEqual([]);
    expect(t.store.garden.log).toEqual([]);
    // Тема «Moje słowa» исчезла вместе с последним словом.
    expect(t.root.querySelector('[data-topic="moje"]')).toBeNull();
  });

  it('не входит в путь к A1: HUD-уровень и очки не меняются от своих слов', async () => {
    const t = screen();
    const before = JSON.stringify(t.farm.stats().path);
    t.openAdd();
    await t.find('пельмени');
    t.$$('[data-cw-variant]')[0]!.click();
    t.submit(t.$('[data-cw-form]'));
    const id = t.store.custom[0]!.id;
    for (let i = 0; i < 6; i++) solve(t.farm, id);
    expect(t.farm.stats().xp).toBeGreaterThan(0);
    expect(JSON.stringify(t.farm.stats().path)).toBe(before);
    expect(t.farm.stats().base.words).toBe(WORDS.length);
  });
});

describe('загрузка файла словаря', () => {
  const json = JSON.stringify(SMALL);
  it('gzip распаковывается, повторный вызов не ходит в сеть', async () => {
    const fetcher = vi.fn(async () => new Response(gzipSync(json)));
    const load = createRuplLoader({ url: '/dict/rupl.json.gz', fetch: fetcher as unknown as typeof fetch });
    const db = await load();
    expect(db && lookupRu(db, 'машина')!.variants[0]!.pl).toBe('samochód');
    expect(await load()).toBe(db);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('если сервер сам распаковал файл — это обычный JSON, тоже читается', async () => {
    const load = createRuplLoader({ url: 'x', fetch: (async () => new Response(json)) as unknown as typeof fetch });
    expect((await load())?.d.дом?.[0]?.[0]).toBe('dom');
  });

  it('ошибка сети или битый файл → null, следующая попытка пробует снова', async () => {
    let n = 0;
    const load = createRuplLoader({
      url: 'x',
      fetch: (async () => {
        n++;
        if (n === 1) throw new Error('offline');
        if (n === 2) return new Response('nope', { status: 404 });
        if (n === 3) return new Response('{"d":1}');
        return new Response(gzipSync(json));
      }) as unknown as typeof fetch,
    });
    expect(await load()).toBeNull();
    expect(await load()).toBeNull();
    expect(await load()).toBeNull();
    expect(await load()).not.toBeNull();
  });
});

describe('toWord', () => {
  it('слово словаря из записи: тема moje, вне базы', () => {
    const w = toWord({ id: 'w.custom.a', pl: 'dom', ru: 'дом', pos: 'noun', added: 1 }, 2);
    expect(w).toMatchObject({ topic: 'moje', tr: 'дом', order: 2, ex: null, forms: {} });
  });
});
