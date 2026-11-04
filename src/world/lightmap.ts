// Карта света в пикселях мира: окружающий свет плюс точечные источники, ступенями и с точечным растром, чтобы свет выглядел пиксельным.
// Чистая: на выходе RGBA, сцена кладёт его в canvas. Сцена умножает мир на эту картинку одним спрайтом, без шейдеров и лишних проходов.
import type { Rgb } from '../systems/daylight';

export interface PointLight {
  x: number;
  y: number;
  r: number;
  color: Rgb;
  power: number;
}

/** Ступеней яркости на канал: меньше — грубее ореол. */
export const LIGHT_STEPS = 20;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Порог растра в точке, 0–1. */
export const bayer = (x: number, y: number): number => (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

export const stepOf = (v: number): number => Math.round(v * LIGHT_STEPS) / LIGHT_STEPS;

/** Спад света: плотная середина, мягкий край. */
export const falloff = (d: number, r: number): number => {
  const t = 1 - d / r;
  return t <= 0 ? 0 : t * t * (3 - 2 * t);
};

export function bakeLightmap(w: number, h: number, ambient: Rgb, lights: readonly PointLight[]): Uint8ClampedArray {
  const sum = new Float32Array(w * h * 3);
  for (const l of lights) {
    const x0 = Math.max(0, Math.floor(l.x - l.r));
    const x1 = Math.min(w - 1, Math.ceil(l.x + l.r));
    const y0 = Math.max(0, Math.floor(l.y - l.r));
    const y1 = Math.min(h - 1, Math.ceil(l.y + l.r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const f = falloff(Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y), l.r) * l.power;
        if (f <= 0) continue;
        const i = (y * w + x) * 3;
        sum[i] = sum[i]! + f * l.color[0];
        sum[i + 1] = sum[i + 1]! + f * l.color[1];
        sum[i + 2] = sum[i + 2]! + f * l.color[2];
      }
    }
  }
  // Ровный окружающий свет на ступень: иначе растр лёг бы сеткой на весь экран. Растр — только на ореолах.
  const base = [stepOf(ambient[0]), stepOf(ambient[1]), stepOf(ambient[2])];
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = bayer(x, y);
      const i = y * w;
      for (let c = 0; c < 3; c++) {
        const s = sum[(i + x) * 3 + c]!;
        const lit = s > 0 ? Math.floor(s * LIGHT_STEPS + b) / LIGHT_STEPS : 0;
        out[(i + x) * 4 + c] = Math.min(1, base[c]! + lit) * 255;
      }
      out[(i + x) * 4 + 3] = 255;
    }
  }
  return out;
}

/** Виньетка в пикселях мира: альфа края 0–`strength`, тёмный тон `color`, те же ступени с растром. */
export function bakeVignette(w: number, h: number, strength: number, color: Rgb): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const steps = 6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2);
      const dy = (y + 0.5 - h / 2) / (h / 2);
      const d = Math.max(0, Math.hypot(dx * 0.92, dy * 0.92) - 0.62) / 0.68;
      const v = Math.min(1, d * d * (3 - 2 * Math.min(1, d))) * strength;
      const a = Math.floor(v * steps * 2 + bayer(x, y)) / (steps * 2);
      const i = (y * w + x) * 4;
      out[i] = color[0] * 255;
      out[i + 1] = color[1] * 255;
      out[i + 2] = color[2] * 255;
      out[i + 3] = a * 255;
    }
  }
  return out;
}
