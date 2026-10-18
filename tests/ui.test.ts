// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mountBubble } from '../src/ui/bubble';
import { mountHud } from '../src/ui/hud';
import { mountSettings } from '../src/ui/settings';
import { testBus } from './helpers';

describe('HUD', () => {
  it('уровень «Старт» в углу и кнопка настроек; hud:xp обновляет', () => {
    const root = document.createElement('div');
    const bus = testBus();
    let opened = 0;
    const hud = mountHud(root, { onSettings: () => opened++, bus });
    expect(root.querySelector('[data-xp-level]')?.textContent).toBe('Старт');
    expect(root.querySelector<HTMLElement>('.pq-xp-fill')?.style.width).toBe('0%');
    hud.gear.click();
    expect(opened).toBe(1);
    bus.emit('hud:xp', { level: 'Уровень 2', ratio: 0.5, sub: 2, of: 20, pct: 0.12 });
    expect(root.querySelector('[data-xp-level]')?.textContent).toBe('Уровень 2/20');
    expect(root.querySelector('[data-xp-next]')?.textContent).toBe('до A1: 12%');
    expect(root.querySelector<HTMLElement>('.pq-xp-fill')?.style.width).toBe('50%');
    hud.dispose();
  });

  it('«+N» рядом с полоской и вспышка при новом уровне', () => {
    const root = document.createElement('div');
    const bus = testBus();
    const hud = mountHud(root, { onSettings: () => {}, bus });
    bus.emit('hud:xp', { level: 'A0', ratio: 0.1, xp: 12, gain: 11 });
    expect(root.querySelector('[data-xp-gain]')?.textContent).toBe('+11');
    bus.emit('hud:xp', { level: 'Уровень 2', ratio: 0, sub: 2, of: 20, xp: 5000, gain: 1, up: true });
    expect(root.querySelector('.pq-xp')?.classList.contains('flash')).toBe(true);
    hud.dispose();
  });
});

describe('пузырь-заглушка', () => {
  it('world:interact показывает название объекта и гаснет сам', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const bus = testBus();
    mountBubble(root, bus, 1000);
    const b = root.querySelector<HTMLElement>('[data-bubble]')!;
    expect(b.hidden).toBe(true);
    bus.emit('world:interact', { location: 'home', use: 'desk', id: 'desk', key: 'prop:desk', label: 'Słownik · Словарь', tile: [8, 3], via: 'action', facing: 'up' });
    expect(b.hidden).toBe(false);
    expect(b.textContent).toBe('Słownik · Словарь');
    vi.advanceTimersByTime(1100);
    expect(b.hidden).toBe(true);
    vi.useRealTimers();
  });
});

describe('настройки', () => {
  const make = () => {
    const root = document.createElement('div');
    document.body.append(root);
    const bus = testBus();
    const log: string[] = [];
    let sound = true;
    const input: boolean[] = [];
    bus.on('world:input', ({ enabled }) => input.push(enabled));
    const panel = mountSettings(root, {
      bus,
      getSound: () => sound,
      setSound: (on) => {
        sound = on;
        log.push(`sound:${on}`);
      },
      exportSave: () => {
        log.push('export');
        return 'ferma-test.json';
      },
      importSave: async () => ({ ok: true, message: 'ок' }),
      reset: async () => void log.push('reset'),
    });
    return { root, bus, log, panel, input };
  };

  it('открытие отключает ввод в мир, закрытие и Esc возвращают', () => {
    const { panel, bus, input } = make();
    panel.open();
    expect(panel.isOpen).toBe(true);
    bus.emit('input:intent', { type: 'cancel', to: 'ui', source: 'keyboard' });
    expect(panel.isOpen).toBe(false);
    expect(input).toEqual([false, true]);
  });

  it('звук, экспорт; сброс только со второго нажатия', () => {
    const { root, log, panel } = make();
    panel.open();
    root.querySelector<HTMLButtonElement>('.pq-toggle')!.click();
    root.querySelector<HTMLButtonElement>('[data-export]')!.click();
    expect(root.querySelector('[data-note]')?.textContent).toContain('ferma-test.json');
    const reset = root.querySelector<HTMLButtonElement>('[data-reset]')!;
    reset.click();
    expect(log).not.toContain('reset');
    reset.click();
    expect(log).toEqual(['sound:false', 'export', 'reset']);
  });
});
