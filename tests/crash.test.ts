// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { guardStart } from '../src/ui/crash';

describe('экран «Что-то сломалось» (t26)', () => {
  it('ошибка при запуске: экран с «Перезагрузить» и «Скачать сохранение», экспорт отдаёт файл', async () => {
    document.body.innerHTML = '';
    const download = vi.fn();
    const reload = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await guardStart(() => Promise.reject(new Error('сцена не создалась')), {
      saveText: () => Promise.resolve('{"save":1}'),
      fileName: () => 'ferma.json',
      download,
      reload,
    });
    expect(ok).toBe(false);
    const screen = document.querySelector('.pq-crash');
    expect(screen?.textContent).toContain('Что-то сломалось');
    expect(screen?.textContent).toContain('сцена не создалась');
    document.querySelector<HTMLButtonElement>('[data-crash-export]')!.click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith('ferma.json', '{"save":1}'));
    document.querySelector<HTMLButtonElement>('[data-crash-reload]')!.click();
    expect(reload).toHaveBeenCalled();
  });

  it('удачный запуск экрана не показывает; отклонённый промис после запуска — только в консоль', async () => {
    document.body.innerHTML = '';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const opts = { saveText: () => Promise.resolve(null), fileName: () => 'f.json', download: vi.fn(), reload: vi.fn() };
    expect(await guardStart(() => Promise.resolve(), opts)).toBe(true);
    window.dispatchEvent(new Event('unhandledrejection'));
    expect(document.querySelector('.pq-crash')).toBeNull();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('упало в кадре'), message: 'упало в кадре' }));
    expect(document.querySelector('.pq-crash')?.textContent).toContain('упало в кадре');
  });
});
