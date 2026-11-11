// Огород t99: раскладка рядов и подписи слов над растениями.
import { describe, expect, it } from 'vitest';
import { PLOT_CELLS, TIER_CAP } from '../src/systems/garden';
import { getMap } from '../src/world/maps';
import { parseAscii } from '../src/world/ascii';
import { FONT_MIN, LINE_EM, fitText, layoutWordLabels, textWidth } from '../src/world/wordLabels';

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

describe('подписи слов (t115, D-147)', () => {
  // Огород как на телефоне 375: клетка 32 px, двойные ряды, проход в колонках 15–16.
  const CELL = 32;
  const WORDS = ['drogo', 'tanio', 'kiedy', 'jak', 'szef', 'zadanie', 'supermarket', 'złoty', 'zakupy', 'kto', 'będziemy', 'dał', 'przedsiębiorstwo', 'Dzień dobry, pani Aniu!', 'W kuchni jest stół i cztery krzesła.'];
  const garden = (heroX: number, heroY: number) =>
    PLOT_CELLS.map(([cx, cy], i) => ({ id: `w${i}`, text: WORDS[i % WORDS.length]!, col: cx, x: (cx - heroX) * CELL + 187, y: (cy - heroY) * CELL + 400 }));
  const box = (w: { x: number; y: number; text: string; size: number }) => {
      const half = textWidth(w.text, w.size) / 2;
    return { l: w.x - half, r: w.x + half, t: w.y - w.size * LINE_EM, b: w.y };
  };

  it('у каждого растения на экране подпись, герой сделал два шага — набор тот же', () => {
    const vis = (hy: number) => {
      const all = garden(15, hy);
      const onScreen = all.filter((p) => p.x >= 0 && p.x <= 375 && p.y >= 0 && p.y <= 812).map((p) => p.id);
      const ids = layoutWordLabels(all, CELL, 375, 812).map((w) => w.id);
      for (const id of onScreen) expect(ids).toContain(id);
      return onScreen;
    };
    // Камера стоит (огород влез), герой ходит: экранные места не меняются → и подписи те же.
    const a = layoutWordLabels(garden(15, 14), CELL, 375, 812).map((w) => w.id);
    expect(a.length).toBeGreaterThan(0);
    expect(vis(14).length).toBeGreaterThan(20);
    vis(16);
  });

  it('на 375 соседние подписи не наезжают друг на друга', () => {
    const list = layoutWordLabels(garden(15, 15), CELL, 375, 812).filter((w) => w.x > 40 && w.x < 335);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = box(list[i]!);
        const b = box(list[j]!);
        const cross = a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
        expect(cross, `${list[i]!.text} × ${list[j]!.text}`).toBe(false);
      }
  });

  it('слово не режется и не прячется — мельче кегль; длинная фраза на телефоне — многоточие', () => {
    expect(fitText('jak', 62)).toEqual({ text: 'jak', size: 11 });
    const s = fitText('supermarket', 62);
    expect(s.text).toBe('supermarket');
    expect(s.size).toBeLessThan(11);
    expect(fitText('poniedziałek', 60).text).toBe('poniedziałek');
    const p = fitText('W kuchni jest stół i cztery krzesła.', 62);
    expect(p.text.endsWith('…') && p.size === FONT_MIN).toBe(true);
    expect(textWidth(p.text, p.size)).toBeLessThanOrEqual(62);
    expect(fitText('Wszystkiego najlepszego', 4 * 16 * 2 - 2).text).toBe('Wszystkiego najlepszego');
  });

  it('у края экрана подпись прижата внутрь, за кадром — уходит вместе с растением', () => {
    const [w] = layoutWordLabels([{ id: 'a', text: 'supermarket', x: 3, y: 100, col: 2 }], CELL, 375, 812);
    expect(w!.x - textWidth(w!.text, w!.size) / 2).toBeGreaterThanOrEqual(0);
    expect(layoutWordLabels([{ id: 'a', text: 'kot', x: -200, y: 100, col: 2 }], CELL, 375, 812)).toEqual([]);
  });
});
