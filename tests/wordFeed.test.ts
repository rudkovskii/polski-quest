// Лента своих слов: запись применяется один раз, пустое сохранение не трогается, правка и удаление, битый файл, транскрипция.
import { describe, expect, it } from 'vitest';
import { normalizeCustom, type CustomWord } from '../src/systems/customWords';
import { createFarm } from '../src/systems/farm';
import { newGarden, type GardenSave } from '../src/systems/garden';
import { applyFeed, feedHint, feedLine, parseFeed, type FeedEntry } from '../src/systems/wordFeed';
import { testBus } from './helpers';

const T0 = Date.UTC(2026, 10, 4, 12, 0);
const ADD: FeedEntry = {
  id: 'a',
  add: [
    { pl: 'przejdziem', ru: 'перейдём', tr: 'пше́йджем', pos: 'verb' },
    { pl: 'złożył Pan', ru: 'вы подали', tr: 'зўо́жыў пан', pos: 'verb' },
  ],
};

function setup() {
  const store: { garden: GardenSave; custom: CustomWord[]; hints: string[] } = { garden: newGarden(), custom: [], hints: [] };
  const open = () => createFarm({
    bus: testBus(),
    load: () => store.garden,
    save: (g) => (store.garden = g),
    now: () => T0,
    tz: () => 0,
    say: () => {},
    customs: { load: () => store.custom, save: (c) => (store.custom = c) },
  });
  const run = (farm: ReturnType<typeof open>, entries: readonly FeedEntry[]) => {
    const api = farm.custom!;
    return applyFeed(entries, {
      started: farm.garden.planted.length > 0,
      seen: (h) => store.hints.includes(h),
      mark: (h) => store.hints.push(h),
      find: (pl) => api.list().find((w) => w.pl === pl)?.id ?? null,
      add: (w) => {
        const r = api.add(w);
        return r.ok ? r.id : null;
      },
      plant: (ids) => {
        const r = farm.plant(ids);
        return r.planted + r.bag;
      },
      update: (id, patch) => api.update(id, patch),
      remove: (id) => api.remove(id),
    });
  };
  const started = () => {
    const farm = open();
    farm.plant(['w.dzien_dobry']);
    return farm;
  };
  return { store, open, run, started };
}

describe('лента своих слов', () => {
  it('сажает слова с транскрипцией Шэфа', () => {
    const { store, run, started } = setup();
    const farm = started();
    expect(run(farm, [ADD]).planted).toBe(2);
    expect(store.custom.every((c) => store.garden.planted.some((p) => p.id === c.id))).toBe(true);
    expect(farm.custom!.list().find((w) => w.pl === 'przejdziem')?.tr).toBe('пше́йджем');
    expect(store.hints).toContain(feedHint('a'));
  });

  it('второй запуск ничего не делает, слово, убранное в игре, не возвращается', () => {
    const { store, open, run, started } = setup();
    run(started(), [ADD]);
    const again = open();
    again.custom!.remove(again.custom!.list()[0]!.id);
    expect(run(open(), [ADD])).toEqual({ planted: 0, edited: 0, removed: 0 });
    expect(store.custom).toHaveLength(1);
  });

  it('пустое сохранение не трогает, запись ждёт первой посадки', () => {
    const { store, open, run } = setup();
    expect(run(open(), [ADD]).planted).toBe(0);
    expect(store.custom).toHaveLength(0);
    expect(store.hints).toHaveLength(0);
  });

  it('правит и убирает по польскому написанию, чужое слово пропускает', () => {
    const { store, run, started } = setup();
    const farm = started();
    run(farm, [ADD]);
    const r = run(farm, [{ id: 'b', edit: [{ pl: 'przejdziem', set: { ru: 'мы перейдём' } }, { pl: 'нет такого', set: { ru: 'x' } }], remove: ['złożył Pan', 'нет такого'] }]);
    expect(r).toEqual({ planted: 0, edited: 1, removed: 1 });
    expect(store.custom.map((c) => c.ru)).toEqual(['мы перейдём']);
    expect(store.garden.planted.some((p) => p.id.startsWith('w.custom.'))).toBe(true);
    expect(store.custom[0]!.tr).toBe('пше́йджем');
  });

  it('транскрипция переживает сохранение и уходит при правке польского', () => {
    const { store, run, started } = setup();
    const farm = started();
    run(farm, [ADD]);
    expect(normalizeCustom(store.custom).find((c) => c.pl === 'przejdziem')?.tr).toBe('пше́йджем');
    const api = farm.custom!;
    const w = api.list().find((x) => x.pl === 'przejdziem')!;
    api.update(w.id, { pl: 'przejdziemy' });
    expect(store.custom.find((c) => c.id === w.id)?.tr).toBeUndefined();
  });

  it('битый файл не роняет игру', () => {
    expect(parseFeed(null)).toEqual([]);
    expect(parseFeed({ a: 1 })).toEqual([]);
    expect(parseFeed([null, { id: '' }, { id: 'x', add: [{ pl: 'ok', ru: 'да' }, { pl: 1 }], edit: 'нет' }, { id: 'x' }])).toEqual([
      { id: 'x', add: [{ pl: 'ok', ru: 'да' }], edit: [], remove: [] },
    ]);
  });

  it('строка для игрока', () => {
    expect(feedLine({ planted: 0, edited: 0, removed: 0 })).toBeNull();
    expect(feedLine({ planted: 10, edited: 0, removed: 1 })).toBe('Мои слова: посажено 10, убрано 1. Они в словаре, в «Moje słowa».');
  });
});
