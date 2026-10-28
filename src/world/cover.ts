// t30: что заслоняет героя. У края карты кроны деревьев (prop выше по глубине) целиком закрывали героя — такие спрайты сцена делает
// полупрозрачными, как листва в Stardew. Чистая функция: прямоугольники в пикселях мира, глубина как у сцены (10 + низ спрайта).

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CoverCandidate extends Box {
  key: string;
  depth: number;
}

/** Прозрачность заслоняющей кроны. */
export const COVER_ALPHA = 0.45;

/** Ключи спрайтов, которые нарисованы поверх героя и перекрывают его прямоугольник хотя бы на `minPx` по обеим осям. */
export function coveringKeys(props: Iterable<CoverCandidate>, hero: Box & { depth: number }, minPx = 3): Set<string> {
  const out = new Set<string>();
  for (const p of props) {
    if (p.depth <= hero.depth) continue;
    const w = Math.min(p.x1, hero.x1) - Math.max(p.x0, hero.x0);
    const h = Math.min(p.y1, hero.y1) - Math.max(p.y0, hero.y0);
    if (w >= minPx && h >= minPx) out.add(p.key);
  }
  return out;
}
