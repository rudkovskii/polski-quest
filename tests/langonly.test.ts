// @vitest-environment happy-dom
// Версия «только язык» (edition.languageOnly) и онбординг (edition.onboarding): фильтры карт и контента, показ карточек, «Как играть».
import { describe, expect, it, vi } from 'vitest';
import farm from '../content/maps/farm.json';
import home from '../content/maps/home.json';
import zagroda from '../content/maps/zagroda.json';
import { extraWords } from '../src/systems/content';
import { V2 } from '../src/systems/v2content';
import type { LocationMap } from '../src/types/map';
import { MODE_NAME } from '../src/ui/glossary';
import { ONBOARDING_HINT, mountOnboarding, onboardingCards, shouldShowOnboarding } from '../src/ui/onboarding';
import { mountSettings } from '../src/ui/settings';
import { buildMaps, languageOnlyMap, routeTo } from '../src/world/maps';
import { testBus } from './helpers';

const ALL = { farm, home, zagroda } as unknown as Record<string, LocationMap>;
const uses = (m: LocationMap) => m.objects.flatMap((o) => (o.type === 'prop' && o.use ? [o.use] : []));
const ids = (m: LocationMap) => m.objects.flatMap((o) => ('id' in o ? [o.id] : []));

describe('languageOnly: карты', () => {
  const maps = buildMaps(ALL, true);

  it('выключено — карты те же, Zagroda на месте', () => {
    expect(buildMaps(ALL, false)).toBe(ALL);
    expect(Object.keys(ALL)).toContain('zagroda');
  });

  it('включено — Zagroda нет, остались дом и ферма', () => {
    expect(Object.keys(maps).sort()).toEqual(['farm', 'home']);
  });

  it('входы в игры v2 и праздничный декор убраны, учебные объекты на месте', () => {
    expect(uses(maps.home!).sort()).toEqual(['bed', 'desk', 'radio', 'shelf']);
    expect(uses(maps.farm!).sort()).toEqual(['bin', 'board']);
    for (const m of Object.values(maps)) {
      expect(m.objects.some((o) => o.type === 'prop' && o.decor)).toBe(false);
      expect(ids(m).some((id) => /choinka|palma|pisanki|znicz|bunting|mast|seasonBoard|calendar|^map$/.test(id))).toBe(false);
    }
    // Было в исходных картах (фильтр что-то да убрал).
    expect(ids(ALL.home!)).toContain('decor_choinka');
    expect(ids(ALL.farm!)).toContain('mast');
  });

  it('нет висящих дверей: каждый выход ведёт на существующую карту и спавн', () => {
    for (const m of Object.values(maps))
      for (const o of m.objects) if (o.type === 'exit') {
        expect(maps[o.to], `${m.id} → ${o.to}`).toBeTruthy();
        expect(maps[o.to]!.spawns[o.spawn], `${m.id}: спавн ${o.spawn}`).toBeTruthy();
      }
    expect(maps.farm!.objects.filter((o) => o.type === 'exit').map((o) => (o as { to: string }).to)).toEqual(['home']);
  });

  it('кот, бобёр (unlock) и спавн сохранены; исходная карта не мутирована', () => {
    expect(ids(maps.home!)).toContain('cat_sleep');
    expect(ids(maps.farm!)).toEqual(expect.arrayContaining(['beaver_lodge', 'beaver_pond', 'garden', 'well']));
    expect(languageOnlyMap(ALL.farm!).objects.length).toBeLessThan(ALL.farm!.objects.length);
    expect(ALL.farm!.objects.some((o) => o.type === 'exit' && o.to === 'zagroda')).toBe(true);
  });

  it('«Идти» к объектам v2 некуда, к столу и доске — есть путь', () => {
    expect(routeTo('farm', 'mast', maps)).toBeNull();
    expect(routeTo('home', 'calendar', maps)).toBeNull();
    expect(routeTo('farm', 'zplot', maps)).toBeNull();
    expect(routeTo('farm', 'desk', maps)?.map).toBe('home');
    expect(routeTo('home', 'board', maps)?.map).toBe('farm');
  });
});

describe('languageOnly: контент', () => {
  it('тема «Święta» только без флага', () => {
    expect(V2.words.length).toBeGreaterThan(0);
    expect(extraWords(false)).toBe(V2.words);
    expect(extraWords(true)).toEqual([]);
  });
});

describe('онбординг', () => {
  it('7 карточек, цель — из edition, игры — реальные названия', () => {
    const cards = onboardingCards('B1');
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(cards.length).toBeLessThanOrEqual(7);
    const text = JSON.stringify(cards);
    expect(cards.at(-1)!.title).toContain('B1');
    expect(text).not.toContain('A1');
    for (const m of [1, 2, 3, 4, 5] as const) expect(text).toContain(MODE_NAME[m].ru);
    for (const w of ['Słownik', 'Spiżarnia', 'Tablica', 'Skrzynka', '10–15 минут']) expect(text).toContain(w);
  });

  it('показ при первом запуске: флаг включён, не показывали, игрок не начинал', () => {
    const base = { enabled: true, hints: [] as string[], planted: 0, answered: 0 };
    expect(shouldShowOnboarding(base)).toBe(true);
    expect(shouldShowOnboarding({ ...base, enabled: false })).toBe(false);
    expect(shouldShowOnboarding({ ...base, hints: [ONBOARDING_HINT] })).toBe(false);
    expect(shouldShowOnboarding({ ...base, planted: 3 })).toBe(false);
    expect(shouldShowOnboarding({ ...base, answered: 1 })).toBe(false);
  });

  function setup() {
    const bus = testBus();
    const root = document.createElement('div');
    document.body.append(root);
    const seen = vi.fn();
    const input: boolean[] = [];
    bus.on('world:input', (p) => input.push(p.enabled));
    const ob = mountOnboarding(root, { bus, level: 'B1', seen });
    const btn = (k: 'back' | 'next') => root.querySelector<HTMLButtonElement>(`[data-ob="${k}"]`)!;
    return { ob, root, seen, input, btn, card: () => root.querySelector<HTMLElement>('[data-card]')!.dataset.card };
  }

  it('Дальше / Назад / Начать: проход по карточкам, закрытие пишет флаг и возвращает ввод', () => {
    const { ob, root, seen, input, btn, card } = setup();
    expect(ob.isOpen).toBe(false);
    ob.open();
    expect(input).toEqual([false]);
    expect(card()).toBe('0');
    expect(btn('back').disabled).toBe(true);
    btn('next').click();
    btn('next').click();
    expect(card()).toBe('2');
    btn('back').click();
    expect(card()).toBe('1');
    const n = onboardingCards('B1').length;
    for (let k = 1; k < n - 1; k++) btn('next').click();
    expect(card()).toBe(String(n - 1));
    expect(btn('next').textContent).toBe('Начать');
    expect(root.textContent).toContain('B1');
    expect(seen).not.toHaveBeenCalled();
    btn('next').click();
    expect(ob.isOpen).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(input).toEqual([false, true]);
    // Повторное открытие начинается с первой карточки.
    ob.open();
    expect(card()).toBe('0');
  });

  it('✕ тоже считается прохождением', () => {
    const { ob, root, seen } = setup();
    ob.open();
    root.querySelector<HTMLElement>('[data-close]')!.click();
    expect(ob.isOpen).toBe(false);
    expect(seen).toHaveBeenCalled();
  });

  it('«Как играть» в настройках: только если передан onHowTo; закрывает настройки и зовёт онбординг', () => {
    const mk = (onHowTo?: () => void) => {
      const bus = testBus();
      const root = document.createElement('div');
      document.body.append(root);
      const s = mountSettings(root, { bus, getSound: () => true, setSound: () => {}, exportSave: () => 'x', importSave: async () => ({ ok: true, message: '' }), reset: async () => {}, ...(onHowTo ? { onHowTo } : {}) });
      return { s, root };
    };
    expect(mk().root.querySelector('[data-howto]')).toBeNull();
    const spy = vi.fn();
    const { s, root } = mk(spy);
    s.open();
    root.querySelector<HTMLElement>('[data-howto]')!.click();
    expect(s.isOpen).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
