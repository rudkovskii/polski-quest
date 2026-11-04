// Огород t99: раскладка рядов и подписи слов над растениями.
import { describe, expect, it } from 'vitest';
import { PLOT_CELLS, TIER_CAP } from '../src/systems/garden';
import { getMap } from '../src/world/maps';
import { parseAscii } from '../src/world/ascii';
import { pickWordLabels } from '../src/world/wordLabels';

describe('огород как в Stardew', () => {
  it('мест не меньше, чем было, старые номера грядок остаются', () => {
    expect(PLOT_CELLS.length).toBeGreaterThanOrEqual(120);
    TIER_CAP.reduce((a, b) => (expect(b).toBeGreaterThanOrEqual(a), b), 0);
  });

  it('у каждого растения рядом свободная дорожка, грядки не на заборе и не под предметами', () => {
    const farm = getMap('farm');
    const parsed = parseAscii(farm);
    const cells = new Set(PLOT_CELLS.map((c) => c.join(',')));
    const taken = new Set(farm.objects.flatMap((o) => (o.type === 'prop' ? Array.from({ length: o.size![0] * o.size![1] }, (_, i) => `${o.at[0] + (i % o.size![0])},${o.at[1] + Math.floor(i / o.size![0])}`) : [])));
    for (const [x, y] of PLOT_CELLS) {
      expect(parsed.deco[y]?.[x] ?? ' ').toBe(' ');
      expect(taken.has(`${x},${y}`), `${x},${y}`).toBe(false);
      expect([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => !cells.has(`${x + dx!},${y + dy!}`)), `${x},${y}`).toBe(true);
    }
  });
});

describe('подписи слов', () => {
  const at = (id: string, x: number, y: number, dist: number, text = id) => ({ id, text, x, y, dist });

  it('рядом не наезжают: ближний к герою остаётся, сосед уходит', () => {
    const r = pickWordLabels([at('zwyciężać', 100, 100, 3), at('przejdziem', 132, 100, 1)], 375, 812);
    expect(r.map((w) => w.id)).toEqual(['przejdziem']);
  });

  it('на широком экране видно все, что влезает', () => {
    const r = pickWordLabels([at('dał', 100, 100, 3), at('kot', 148, 100, 1), at('dom', 100, 148, 2)], 1366, 768);
    expect(r).toHaveLength(3);
  });

  it('длинное режется, за край экрана подпись не уходит, больше 40 не показывает', () => {
    expect(pickWordLabels([at('a', 150, 100, 1, 'Dzień dobry, pani Aniu!')], 375, 812)[0]!.text).toBe('Dzień dobry, pa…');
    expect(pickWordLabels([at('a', 3, 100, 1, 'słowo')], 375, 812)).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => at(`w${i}`, 40 + (i % 10) * 60, 20 + Math.floor(i / 10) * 20, i));
    expect(pickWordLabels(many, 800, 400)).toHaveLength(40);
  });
});
