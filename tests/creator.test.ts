// @vitest-environment happy-dom
// Fotobudka (P-03): одна кнопка «Gotowe» сохраняет пресет, d-pad/стрелки по строкам и значениям,
// «Losuj» по seed, имя, зеркало без сохранения, openCreator без экрана, паспорт с фото.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appearanceOf, avatarKey, defaultAppearance, hasAppearance, randomAppearance } from '../src/systems/avatar';
import { getContent } from '../src/systems/content';
import { startAvatar } from '../src/avatarGlue';
import { withAvatarPortraits } from '../src/ui/avatar';
import { mountCreator, openCreator } from '../src/ui/creator';
import { createOverlay } from '../src/ui/overlay/host';
import { openPassport, passportModel } from '../src/ui/passport';
import { act, flush, memStore, testBus } from './overlayKit';

const NOW = Date.UTC(2026, 9, 14, 9);
let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => root.remove());

function setup(seed = 5) {
  const bus = testBus();
  const overlay = createOverlay(root, { bus });
  const store = memStore();
  const changed: string[][] = [];
  bus.on('progress:changed', ({ kinds }) => changed.push(kinds));
  const creator = mountCreator({ overlay, store, clock: { now: () => NOW }, bus, seed: () => seed, delay: async () => {}, scale: 2 });
  const intent = (i: { type: 'interact' } | { type: 'cancel' } | { type: 'move'; dir: 'up' | 'down' | 'left' | 'right'; held: true }): void =>
    bus.emit('input:intent', { ...i, to: 'ui', source: 'keyboard' } as never);
  return { bus, overlay, store, creator, changed, intent };
}

const sel = (): string | undefined => root.querySelector<HTMLElement>('.pq-creator .sel')?.dataset.row;
const value = (row: string): string | undefined => root.querySelector<HTMLElement>(`[data-row="${row}"]`)?.dataset.value;

describe('Fotobudka', () => {
  it('Gotowe одной кнопкой: пресет «Дима» записан в settings.avatar, экран закрыт', async () => {
    const { store, creator, changed } = setup();
    const done = creator.open('new');
    await flush();
    expect(root.querySelector('[data-screen="creator"]')).not.toBeNull();
    expect([...root.querySelectorAll('[data-row]')].map((n) => (n as HTMLElement).dataset.row)).toEqual(['skin', 'hair', 'hairColor', 'beard', 'glasses', 'top', 'topColor', 'name', 'actions']);
    expect(root.textContent).toContain('Włosy');
    expect(root.textContent).toContain('Волосы');
    act(root, 'gotowe').click();
    expect(await done).toEqual(defaultAppearance());
    expect(store.progress.settings.avatar).toEqual({ value: defaultAppearance(), at: NOW });
    expect(changed).toEqual([['settings']]);
    expect(root.querySelector('[data-screen="creator"]')).toBeNull();
  });

  it('стрелки: вверх/вниз — строка, влево/вправо — значение, A — готово', async () => {
    const { store, creator, intent } = setup();
    const done = creator.open('new');
    await flush();
    expect(sel()).toBe('skin');
    intent({ type: 'move', dir: 'down', held: true });
    expect(sel()).toBe('hair');
    intent({ type: 'move', dir: 'right', held: true });
    expect(value('hair')).toBe('buzz');
    intent({ type: 'move', dir: 'down', held: true });
    intent({ type: 'move', dir: 'down', held: true });
    intent({ type: 'move', dir: 'left', held: true });
    expect(value('beard')).toBe('short');
    for (let i = 0; i < 3; i++) intent({ type: 'move', dir: 'down', held: true });
    intent({ type: 'move', dir: 'right', held: true });
    expect(value('topColor')).toBe('red');
    intent({ type: 'interact' });
    const a = await done;
    expect(a).toEqual({ ...defaultAppearance(), hair: 'buzz', beard: 'short', topColor: 'red' });
    expect(appearanceOf(store.progress)).toEqual(a);
  });

  it('тапы по ‹ ›, Losuj по seed, имя через поле', async () => {
    const { store, creator } = setup(11);
    const done = creator.open('new');
    await flush();
    root.querySelector<HTMLButtonElement>('[data-row="glasses"] [data-act="next"]')!.click();
    expect(value('glasses')).toBe('round');
    expect(sel()).toBe('glasses');
    act(root, 'losuj').click();
    expect(value('skin')).toBe(randomAppearance(11).skin);
    act(root, 'name').click();
    const input = root.querySelector<HTMLInputElement>('[data-role="name-input"]')!;
    input.value = ' Łukasz ';
    act(root, 'name-ok').click();
    expect(root.querySelector('[data-role="owner-name"]')).toBeNull();
    act(root, 'gotowe').click();
    expect(await done).toEqual(randomAppearance(11, 'Łukasz'));
    expect(appearanceOf(store.progress).name).toBe('Łukasz');
  });

  it('зеркало: отмена не пишет, без изменений не пишет', async () => {
    const { store, creator, intent } = setup();
    const p0 = store.progress;
    const m = creator.open('mirror');
    await flush();
    expect(root.querySelector('[data-mode="mirror"]')).not.toBeNull();
    intent({ type: 'cancel' });
    expect(await m).toBeNull();
    expect(store.progress).toBe(p0);
    const m2 = creator.open('mirror');
    await flush();
    act(root, 'gotowe').click();
    await m2;
    expect(hasAppearance(store.progress)).toBe(false);
  });

  it('openCreator: через шину к экрану; без экрана сразу null', async () => {
    const { bus, store } = setup();
    expect(await openCreator({ mode: 'new' }, testBus())).toBeNull();
    const p = openCreator({ mode: 'new' }, bus);
    await flush();
    act(root, 'gotowe').click();
    expect(await p).toEqual(defaultAppearance());
    expect(hasAppearance(store.progress)).toBe(true);
  });

  it('паспорт: фото и имя владельца на первой странице', async () => {
    const content = getContent();
    const { store, creator } = setup(3);
    const done = creator.open('new');
    await flush();
    act(root, 'losuj').click();
    act(root, 'gotowe').click();
    await done;
    const model = passportModel(content, store.progress, { bossResults: {}, lessonsDone: new Set() });
    expect(model.owner).toEqual({ appearance: randomAppearance(3), name: 'Dima', fromBooth: true });
    const overlay = createOverlay(root, { bus: testBus() });
    void openPassport(overlay, model);
    const owner = root.querySelector<HTMLElement>('[data-page="owner"]')!;
    expect(owner.dataset.booth).toBe('true');
    expect(owner.querySelector('canvas')?.dataset.avatar).toBe(avatarKey(randomAppearance(3)));
    expect(owner.querySelector('[data-role="owner-name"]')?.textContent).toBe('Dima');
  });

  it('склейка: avatar:changed при старте и после выбора; портрет игрока не ломает чужие', async () => {
    const { bus, store, creator } = setup(9);
    const seen: string[] = [];
    bus.on('avatar:changed', ({ key }) => seen.push(key));
    const glue = startAvatar(Promise.resolve(store), bus);
    await flush();
    expect(seen).toEqual([avatarKey(defaultAppearance())]);
    const done = creator.open('new');
    await flush();
    act(root, 'losuj').click();
    act(root, 'gotowe').click();
    await done;
    await flush();
    expect(seen).toEqual([avatarKey(defaultAppearance()), avatarKey(randomAppearance(9))]);
    expect(glue.current()).toEqual(randomAppearance(9));
    const other = { url: 'x.png', sheet: [1, 1] as [number, number], rect: [0, 0, 1, 1] as [number, number, number, number] };
    const src = withAvatarPortraits(() => other, glue.current);
    expect(src('kazik')).toBe(other);
    expect(src('dima')).not.toBeUndefined();
  });
});
