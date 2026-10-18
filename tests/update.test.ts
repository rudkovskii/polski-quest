// @vitest-environment happy-dom
// Новая сборка подхватывается при запуске. На титуле — перезагрузка сразу (с защитой от петли), в игре —
// тост «Есть обновление» с кнопкой; перед перезагрузкой прогресс дописывается в базу.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { workboxOptions } from '../tools/lib/pwa';
import { RELOAD_GUARD_MS, updateAction } from '../src/systems/update';
import { lastReloadAt, lastReloadFrom, reloadForUpdate } from '../src/systems/platform/pwa';
import { mountUpdateToast } from '../src/ui/updateToast';
import { testBus } from './helpers';

describe('политика обновления', () => {
  it('нет открытых экранов — тихая перезагрузка; экран открыт — тост; только что перезагружались — тост (без петли)', () => {
    expect(updateAction({ busy: false, lastReloadAt: null, now: 1_000_000 })).toBe('reload');
    expect(updateAction({ busy: true, lastReloadAt: null, now: 1_000_000 })).toBe('toast');
    expect(updateAction({ busy: false, lastReloadAt: 1_000_000 - 5_000, now: 1_000_000 })).toBe('toast');
    expect(updateAction({ busy: false, lastReloadAt: 1_000_000 - RELOAD_GUARD_MS - 1, now: 1_000_000 })).toBe('reload');
  });

  it('P3b: одна ступень — промежуточная сборка после перезагрузки обновляется сразу, петля из той же сборки — тост', () => {
    const base = { busy: false, lastReloadAt: 1_000_000 - 5_000, now: 1_000_000 };
    // перезагрузились из 1132bf0 и получили a2977c5, а на сервере уже новее: без второго тоста
    expect(updateAction({ ...base, lastReloadFrom: '1132bf0', local: 'a2977c5' })).toBe('reload');
    // перезагрузка ничего не дала (сборка та же): защита от петли
    expect(updateAction({ ...base, lastReloadFrom: 'a2977c5', local: 'a2977c5' })).toBe('toast');
    // открыт экран: всегда тост (потом тихая перезагрузка, когда экран закроется)
    expect(updateAction({ ...base, busy: true, lastReloadFrom: '1132bf0', local: 'a2977c5' })).toBe('toast');
  });

  it('перезагрузка: сначала flush прогресса, потом reload; отметка от петли в sessionStorage', async () => {
    const order: string[] = [];
    let saved = false;
    await reloadForUpdate(
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        saved = true;
        order.push('flush');
      },
      { now: 123_456, reload: () => order.push(`reload:${saved}`) },
    );
    expect(order).toEqual(['flush', 'reload:true']);
    expect(lastReloadAt()).toBe(123_456);
    // flush упал — перезагрузка всё равно (данные остаются в базе, повтор при следующем запуске).
    const order2: string[] = [];
    await reloadForUpdate(() => Promise.reject(new Error('idb')), { reload: () => order2.push('reload') }).catch(() => undefined);
    expect(order2).toEqual(['reload']);
    await reloadForUpdate(undefined, { now: 5, from: 'abc1234', reload: () => undefined });
    expect(lastReloadFrom()).toBe('abc1234');
  });

  it('тост «Новая версия · Обновить»: один, кнопка «Обновить» шлёт app:reload', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const bus = testBus();
    const reloads: number[] = [];
    bus.on('app:reload', () => void reloads.push(1));
    const off = mountUpdateToast(root, bus);
    bus.emit('app:update', {});
    bus.emit('app:update', {});
    expect(root.querySelectorAll('[data-update]')).toHaveLength(1);
    expect(root.querySelector('[data-update] span')?.textContent).toContain('Новая версия');
    const b = root.querySelector<HTMLButtonElement>('[data-update] button')!;
    expect(b.textContent).toContain('Обновить');
    b.click();
    expect(reloads).toEqual([1]);
    expect(root.querySelector('[data-update]')).toBeNull();
    off();
    root.remove();
  });

  it('сборка: autoUpdate + skipWaiting/clientsClaim, регистрация из кода (не вставленный registerSW.js)', () => {
    const cfg = readFileSync('vite.config.ts', 'utf8');
    expect(cfg).toMatch(/registerType: 'autoUpdate'/);
    expect(cfg).toMatch(/injectRegister: false/);
    // Опции Workbox вынесены в tools/lib/pwa.ts (тот же конфиг уходит в сборку).
    expect(cfg).toMatch(/workbox: workboxOptions\(\)/);
    expect(workboxOptions()).toMatchObject({ skipWaiting: true, clientsClaim: true });
    // Картины праздников — runtime-кэш, а не precache (jpg нет в globPatterns).
    const opts = workboxOptions();
    expect(opts.globPatterns.join(' ')).not.toMatch(/jpg/);
    const swieta = opts.runtimeCaching.find((r) => r.options.cacheName === 'pq-swieta')!;
    expect(swieta.urlPattern({ url: new URL('https://x/polski-quest/swieta/wigilia.jpg') })).toBe(true);
    expect(swieta.urlPattern({ url: new URL('https://x/polski-quest/audio/a.m4a') })).toBe(false);
    expect(readFileSync('src/main.ts', 'utf8')).toMatch(/registerPwa\(/);
  });
});
