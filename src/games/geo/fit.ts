// Geografia: подбор масштаба карты под место на листе и преобразование координат экран ⇄ карта (чистая логика, без DOM).
// Масштаб: от 2 — только целый (пиксели ровные, спрайты кратные), от 1 до 2 — дробный с шагом 1/8 (iPhone: 1,125 вместо 1),
// меньше 1 — как есть (сглаживание), меньше MIN_SCALE карту не рисуем. Дробный масштаб рисуется без сглаживания (`pixelated`).
import { MAP_H, MAP_W, type Pt } from './world';

/** Минимальный масштаб карты: меньше — карту не рисуем (нет места). */
export const MIN_SCALE = 0.55;
/** Шаг дробного масштаба между 1 и 2: 320 × k/8 и 304 × k/8 — целые px, пиксели картинки повторяются по ровной схеме. */
export const FRAC_STEP = 8;

/** Масштаб карты под место: целый от 2, шаг 1/8 между 1 и 2, ниже 1 как есть; не влезает (меньше MIN_SCALE) — 0. */
export function pickScale(maxW: number, maxH: number): number {
  const m = Math.min(maxW / MAP_W, maxH / MAP_H);
  if (!Number.isFinite(m) || m < MIN_SCALE) return 0;
  if (m >= 2) return Math.floor(m);
  if (m >= 1) return Math.floor(m * FRAC_STEP) / FRAC_STEP;
  return m;
}

/** Размер холста для масштаба: ширина целая, `u` — реальных px холста на px картинки (на нём стоит вся геометрия). */
export function canvasSize(scale: number): { cw: number; ch: number; u: number } {
  if (!(scale > 0)) return { cw: 0, ch: 0, u: 1 };
  const cw = Math.max(1, Math.round(MAP_W * scale));
  const u = cw / MAP_W;
  return { cw, ch: Math.max(1, Math.round(MAP_H * u)), u };
}

/** Вид карты: левый верх в px картинки и сколько px холста на px картинки (`u`). Целая карта: x = y = 0, u = cw / MAP_W. */
export interface ViewBox {
  x: number;
  y: number;
  u: number;
}

/** Точка холста (css px от его левого верха) → px картинки. */
export const canvasToMap = (v: ViewBox, sx: number, sy: number): Pt => ({ x: sx / v.u + v.x, y: sy / v.u + v.y });
/** px картинки → точка холста. */
export const mapToCanvas = (v: ViewBox, p: Pt): Pt => ({ x: (p.x - v.x) * v.u, y: (p.y - v.y) * v.u });

/** Что измерено на листе, css px. */
export interface FitInput {
  /** Внутренняя ширина и высота листа (без полей). */
  innerW: number;
  innerH: number;
  /** Высота над картой (прогресс, вопрос) и под ней (плитки сборки). */
  above: number;
  after: number;
  /** Запас под строку результата движка, которая появляется под листом после ответа. */
  reserve: number;
  /** Высота блока заданий под картой (варианты полосой) при этой ширине. */
  belowH: number;
  /** Ширина колонки вариантов справа; 0 — справа не бывает (нет вариантов, узкий экран). */
  sideW: number;
  /** Зазор между картой и блоком заданий. */
  gap: number;
  /** Рамка карты по обеим осям (border 3 + 3). */
  frame: number;
}

export interface FitPlan {
  /** `below` — варианты полосой под картой, `side` — колонкой справа. */
  mode: 'below' | 'side';
  scale: number;
  maxW: number;
  maxH: number;
}

/** Где лучше блок заданий: считаем оба раскладка и берём ту, где карта крупнее; при равенстве — полоса снизу. */
export function planFit(i: FitInput): FitPlan {
  const room = (w: number, h: number): { maxW: number; maxH: number; scale: number } => {
    const maxW = Math.max(0, w - i.frame);
    const maxH = Math.max(0, h - i.frame);
    return { maxW, maxH, scale: pickScale(maxW, maxH) };
  };
  const hBase = i.innerH - i.above - i.after - i.reserve;
  const below: FitPlan = { mode: 'below', ...room(i.innerW, hBase - i.belowH - i.gap) };
  if (i.sideW <= 0) return below;
  const side: FitPlan = { mode: 'side', ...room(i.innerW - i.sideW - i.gap, hBase) };
  return side.scale > below.scale ? side : below;
}
