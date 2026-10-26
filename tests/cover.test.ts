// t30: кроны и крыши, которые закрывают героя, сцена делает полупрозрачными.
import { describe, expect, it } from 'vitest';
import { coveringKeys } from '../src/world/cover';

describe('что заслоняет героя (t30)', () => {
  const hero = { x0: 10, y0: 300, x1: 22, y1: 332, depth: 10 + 332 };
  it('крона ниже героя (нарисована поверх) и перекрывает его — заслоняет; позади героя или в стороне — нет', () => {
    const props = [
      { key: 'front', x0: 0, y0: 290, x1: 32, y1: 352, depth: 10 + 352 },
      { key: 'behind', x0: 0, y0: 260, x1: 32, y1: 320, depth: 10 + 320 },
      { key: 'aside', x0: 40, y0: 290, x1: 72, y1: 352, depth: 10 + 352 },
      { key: 'edge', x0: 21, y0: 290, x1: 50, y1: 352, depth: 10 + 352 },
    ];
    expect([...coveringKeys(props, hero)]).toEqual(['front']);
  });
});
