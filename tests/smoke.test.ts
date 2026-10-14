import { describe, expect, it } from 'vitest';
import { bus, createBus } from '../src/systems/bus';

describe('bus', () => {
  it('emit доходит до on с типизированным payload', () => {
    const b = createBus<{ ping: { n: number } }>();
    const got: number[] = [];
    b.on('ping', ({ n }) => got.push(n));
    b.emit('ping', { n: 1 });
    b.emit('ping', { n: 2 });
    expect(got).toEqual([1, 2]);
  });

  it('off и возвращённая функция отписывают', () => {
    const b = createBus<{ ping: { n: number } }>();
    const got: number[] = [];
    const fn = ({ n }: { n: number }) => got.push(n);
    const off = b.on('ping', fn);
    b.emit('ping', { n: 1 });
    off();
    b.emit('ping', { n: 2 });
    b.on('ping', fn);
    b.off('ping', fn);
    b.emit('ping', { n: 3 });
    expect(got).toEqual([1]);
  });

  it('once срабатывает один раз', () => {
    const b = createBus<{ tick: Record<string, never> }>();
    let count = 0;
    b.once('tick', () => count++);
    b.emit('tick', {});
    b.emit('tick', {});
    expect(count).toBe(1);
  });

  it('глобальная шина знает события из types/bus', () => {
    const seen: boolean[] = [];
    const off = bus.on('world:input', ({ enabled }) => seen.push(enabled));
    bus.emit('world:input', { enabled: false });
    off();
    expect(seen).toEqual([false]);
  });
});
