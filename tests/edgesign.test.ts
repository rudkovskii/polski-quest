// @vitest-environment happy-dom
// Выход за кадром (27.10, Шэф в Zagroda: «а как мне отсюда выйти?»): табличка двери прижимается к краю экрана со стрелкой к выходу.
import { describe, expect, it } from 'vitest';
import { EDGE_BOTTOM, EDGE_TOP, edgePlace, edgeText, mountFloats } from '../src/ui/float';
import { testBus } from './helpers';

describe('выход за кадром', () => {
  it('стрелка в сторону выхода, на экране — без стрелки', () => {
    expect(edgeText('Ферма', -300, 900, 1000, 700)).toBe('← Ферма');
    expect(edgeText('Загорода', 1300, 200, 1000, 700)).toBe('Загорода →');
    expect(edgeText('Дом', 500, -40, 1000, 700)).toBe('Дом ↑');
    expect(edgeText('Ферма', 500, 900, 1000, 700)).toBe('Ферма ↓');
    expect(edgeText('Дом', 500, 300, 1000, 700)).toBeNull();
  });

  it('прижата к краю и ниже HUD', () => {
    expect(edgePlace(-300, 900, 1000, 700, 80, 20)).toEqual({ x: 46, y: 700 - EDGE_BOTTOM });
    expect(edgePlace(1300, -50, 1000, 700, 80, 20)).toEqual({ x: 954, y: EDGE_TOP + 20 });
  });

  it('DOM: только таблички выходов уходят к краю, остальные — вместе с объектом', () => {
    const root = document.createElement('div');
    const bus = testBus();
    mountFloats(root, bus);
    const vw = window.innerWidth;
    bus.emit('fx:signs', [
      { key: 'exit:0,15', text: 'Ферма', x: -200, y: 400 },
      { key: 'prop:mast', text: 'Символы и гимн', x: -200, y: 400 },
      { key: 'exit:5,1', text: 'Дом', x: vw / 2, y: 300 },
    ]);
    const n = (k: string): HTMLElement => root.querySelector<HTMLElement>(`[data-sign="${k}"]`)!;
    expect(n('exit:0,15').textContent).toBe('← Ферма');
    expect(n('exit:0,15').classList.contains('edge')).toBe(true);
    expect(parseFloat(n('exit:0,15').style.left)).toBeGreaterThan(0);
    expect(n('prop:mast').style.left).toBe('-200px');
    expect(n('exit:5,1').textContent).toBe('Дом');
    // Вышел на экран — стрелка пропала.
    bus.emit('fx:signs', [{ key: 'exit:0,15', text: 'Ферма', x: 100, y: 400 }]);
    expect(n('exit:0,15').textContent).toBe('Ферма');
    expect(n('exit:0,15').classList.contains('edge')).toBe(false);
  });
});
