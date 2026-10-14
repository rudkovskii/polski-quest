// @vitest-environment happy-dom
// Экраны I-06: LinkSetup («Начать» / «У меня есть ссылка»), «Сохрани свою ссылку», точка синка.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../src/systems/bus';
import { mountLink } from '../src/ui/screens/link';
import { mountStart } from '../src/ui/screens/start';
import { mountSyncDot, syncColor } from '../src/ui/syncDot';
import { dpadLabelsOn, mountDpad } from '../src/ui/dpad';

let root: HTMLElement;
beforeEach(() => {
  bus.clear();
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  root.remove();
  vi.useRealTimers();
});

const buttons = (): HTMLButtonElement[] => [...root.querySelectorAll('button')];
const byText = (t: string): HTMLButtonElement => buttons().find((b) => b.textContent === t)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LinkSetup', () => {
  it('две кнопки, без текста-инструкции; «Начать» вызывает create и закрывает экран', () => {
    mountStart(root);
    const create = vi.fn();
    bus.emit('ui:start:show', { create, connect: vi.fn() });
    const screen = root.querySelector('.pq-start')!;
    expect([...screen.children].filter((c) => c.tagName === 'BUTTON').map((b) => b.textContent)).toEqual(['Начать', 'У меня есть ссылка']);
    expect(screen.querySelector('p')).toBeNull();
    byText('Начать').click();
    expect(create).toHaveBeenCalledOnce();
    expect(root.querySelector('.pq-start')).toBeNull();
  });

  it('«У меня есть ссылка» → поле; «Подключить» отдаёт ввод и показывает «Такого мира нет»', async () => {
    mountStart(root);
    const connect = vi.fn().mockResolvedValueOnce('not_found').mockResolvedValueOnce('ok');
    bus.emit('ui:start:show', { create: vi.fn(), connect });
    byText('У меня есть ссылка').click();
    const form = root.querySelector('form')!;
    expect(form.classList.contains('open')).toBe(true);
    const input = form.querySelector('input')!;
    input.value = 'whatever';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(connect).toHaveBeenCalledWith('whatever');
    expect(form.querySelector('.msg')!.textContent).toBe('Такого мира нет. Проверь ссылку');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(root.querySelector('.pq-start')).toBeNull();
  });

  it('офлайн: сообщение, затем экран закрывается сам', async () => {
    mountStart(root);
    bus.emit('ui:start:show', { create: vi.fn(), connect: vi.fn().mockResolvedValue('offline') });
    const form = root.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(form.querySelector('.msg')!.textContent).toBe('Облако недоступно, сольём при сети');
    await new Promise((r) => setTimeout(r, 1600));
    expect(root.querySelector('.pq-start')).toBeNull();
  });
});

describe('«Сохрани свою ссылку»', () => {
  const LINK = 'https://example.test/polski-quest/#k=' + 'b'.repeat(10); // не настоящий секрет

  it('показывает ссылку, копирует, чекбокс вызывает onSaved один раз', async () => {
    mountLink(root);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onSaved = vi.fn();
    bus.emit('ui:link:show', { link: LINK, saved: false, onSaved });
    expect(root.querySelector<HTMLInputElement>('.pq-link input[type=text]')!.value).toBe(LINK);
    byText('Скопировать').click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(byText('Скопировано')).toBeTruthy();
    const box = root.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(box.disabled).toBe(true);
    byText('Готово').click();
    expect(root.querySelector('.pq-link')).toBeNull();
  });

  it('«Поделиться» только если есть Web Share API', () => {
    mountLink(root);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    bus.emit('ui:link:show', { link: LINK, saved: true, onSaved: vi.fn() });
    expect(buttons().map((b) => b.textContent)).not.toContain('Поделиться');
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    bus.emit('ui:link:show', { link: LINK, saved: true, onSaved: vi.fn() });
    expect(root.querySelectorAll('.pq-link')).toHaveLength(1);
    byText('Поделиться').click();
    expect(share).toHaveBeenCalledWith({ title: 'Pierogi i Przypadki', url: LINK });
  });
});

describe('точка синка', () => {
  it('цвета по ТЗ §5: зелёная ok, жёлтая pending, серая offline, красная error/old_client', () => {
    expect(syncColor('ok')).toBe('green');
    expect(syncColor('pending')).toBe('yellow');
    expect(syncColor('syncing')).toBe('yellow');
    expect(syncColor('conflict', 'retry')).toBe('yellow');
    expect(syncColor('conflict', 'different_worlds')).toBe('red');
    expect(syncColor('offline')).toBe('grey');
    expect(syncColor('no_secret')).toBe('grey');
    expect(syncColor('error', 'apply_sql')).toBe('red');
    expect(syncColor('old_client')).toBe('red');
  });

  it('тап открывает экран ссылки через шину', () => {
    mountSyncDot(root);
    const opened = vi.fn();
    bus.on('ui:screen:open', opened);
    bus.emit('sync:status', { state: 'ok', at: Date.UTC(2026, 9, 15, 6, 5) });
    const btn = root.querySelector<HTMLButtonElement>('.pq-sync')!;
    expect(btn.getAttribute('aria-label')).toMatch(/^Сохранено в облаке \d\d:\d\d$/);
    btn.click();
    expect(opened).toHaveBeenCalledWith({ screen: 'link' });
  });

  it('P-01: пока открыт модальный слой (урок, диалог), точки нет — крестик урока свободен', () => {
    mountSyncDot(root);
    const btn = root.querySelector<HTMLButtonElement>('.pq-sync')!;
    expect(btn.hidden).toBe(false);
    bus.emit('world:input', { enabled: false });
    expect(btn.hidden).toBe(true);
    bus.emit('world:input', { enabled: true });
    expect(btn.hidden).toBe(false);
    expect(btn.getAttribute('aria-label')).not.toMatch(/синк/i);
  });
});

describe('P-01: подписи «A · действие», «B · назад» на d-pad', () => {
  it('первые дни (до третьего Dobranoc) подписи есть, потом нет', () => {
    const sleep = (ts: number) => ({ id: `d.${ts}`, ts, k: 'seg' as const, seg: 'sleep' as const });
    expect(dpadLabelsOn([])).toBe(true);
    expect(dpadLabelsOn([sleep(1), sleep(2)])).toBe(true);
    expect(dpadLabelsOn([sleep(1), sleep(2), sleep(3)])).toBe(false);
    let on = true;
    const view = mountDpad(root, bus, { labels: () => on });
    expect(view.a.textContent).toContain('A · действие');
    expect(view.b.textContent).toContain('B · назад');
    bus.emit('input:dpad', { visible: true, side: 'left' });
    expect(view.root.hasAttribute('data-labels')).toBe(true);
    on = false;
    bus.emit('input:dpad', { visible: true, side: 'left' });
    expect(view.root.hasAttribute('data-labels')).toBe(false);
    view.dispose();
  });
});
