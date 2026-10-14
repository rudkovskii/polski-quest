// Аватар в DOM (P-03): лист из слоёв (src/systems/avatar.ts) → <canvas>, кэш по ключу внешности.
// Кадр в увеличении (превью Fotobudka), фото-голова (паспорт), портрет для диалогов и фон вступления.
// Без canvas (тесты на happy-dom) функции возвращают null, а элементы — пустые рамки.
import { AVATAR_FRONT_FRAME, AVATAR_HEAD, avatarKey, composeAvatar, type Appearance, type AvatarSheet } from '../systems/avatar';
import { AVATAR_ART } from '../systems/avatarArt';
import { el } from './dom';
import type { IntroAtlas } from './intro';
import type { PortraitFrame, PortraitSource } from './overlay/kit';

const sheets = new Map<string, { canvas: HTMLCanvasElement; sheet: AvatarSheet; url: string | null } | null>();
const MAX_CACHE = 24;

function context(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return c.getContext('2d');
  } catch {
    return null;
  }
}

/** Лист 12 кадров (canvas, без масштаба) и его data URL. null — canvas недоступен. */
export function avatarSheet(a: Appearance): { canvas: HTMLCanvasElement; sheet: AvatarSheet; url: string | null } | null {
  const key = avatarKey(a);
  if (sheets.has(key)) return sheets.get(key)!;
  let out: { canvas: HTMLCanvasElement; sheet: AvatarSheet; url: string | null } | null = null;
  const sheet = composeAvatar(a, AVATAR_ART);
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const g = context(canvas);
  if (g && typeof ImageData !== 'undefined') {
    g.putImageData(new ImageData(new Uint8ClampedArray(sheet.pixels), sheet.width, sheet.height), 0, 0);
    let url: string | null = null;
    try {
      url = canvas.toDataURL('image/png');
    } catch {
      url = null;
    }
    out = { canvas, sheet, url };
  }
  if (sheets.size >= MAX_CACHE) sheets.delete(sheets.keys().next().value!);
  sheets.set(key, out);
  return out;
}

/**
 * Кадр аватара целым масштабом: <canvas> w×h CSS-пикселей с пиксельной отрисовкой.
 * `crop` — часть кадра (голова для фото): [x, y, w, h] в пикселях кадра.
 */
export function avatarFrameEl(a: Appearance, frame: number, scale: number, crop?: [number, number, number, number], cls = 'pq-avatar'): HTMLCanvasElement {
  const s = avatarSheet(a);
  const [cx, cy, cw, ch] = crop ?? [0, 0, s?.sheet.frameW ?? 16, s?.sheet.frameH ?? 32];
  const c = el('canvas', { class: cls, width: cw * scale, height: ch * scale, 'data-avatar': avatarKey(a), 'data-frame': frame, 'aria-hidden': 'true' });
  c.style.width = `${cw * scale}px`;
  c.style.height = `${ch * scale}px`;
  c.style.imageRendering = 'pixelated';
  const g = s ? context(c) : null;
  if (s && g) {
    g.imageSmoothingEnabled = false;
    g.drawImage(s.canvas, frame * s.sheet.frameW + cx, cy, cw, ch, 0, 0, cw * scale, ch * scale);
  }
  return c;
}

/** Фото для паспорта: голова лицом к нам. */
export function avatarPhotoEl(a: Appearance, scale = 4): HTMLCanvasElement {
  return avatarFrameEl(a, AVATAR_FRONT_FRAME, scale, [0, AVATAR_HEAD.y, 16, AVATAR_HEAD.h], 'pq-avatar-photo');
}

/** Портрет игрока для окна диалога (формат PortraitSource: кадр в листе по URL). */
export function avatarPortraitFrame(a: Appearance): PortraitFrame | null {
  const s = avatarSheet(a);
  if (!s?.url) return null;
  return { url: s.url, sheet: [s.sheet.width, s.sheet.height], rect: [AVATAR_FRONT_FRAME * s.sheet.frameW, AVATAR_HEAD.y, s.sheet.frameW, AVATAR_HEAD.h] };
}

/** Портреты: для игрока (`dima`) — голова аватара, остальные — из атласа как раньше. */
export function withAvatarPortraits(src: PortraitSource | null, current: () => Appearance | null, playerId = 'dima'): PortraitSource {
  return (charId) => {
    if (charId === playerId) {
      const a = current();
      const f = a ? avatarPortraitFrame(a) : null;
      if (f) return f;
    }
    return src?.(charId) ?? null;
  };
}

/**
 * Атлас вступления (ui/intro.ts) с аватаром вместо `dima`: лист аватара дописывается под атласом,
 * кадры `avatar/<i>`, а `dima` и `dima:<anim>` указывают на них. Без canvas — атлас как есть.
 */
export async function withAvatarAtlas(atlas: Promise<IntroAtlas | null> | IntroAtlas | null, a: Appearance | null): Promise<IntroAtlas | null> {
  const base = await atlas;
  if (!base || !a) return base;
  const s = avatarSheet(a);
  if (!s) return base;
  const img = base.img as HTMLImageElement | HTMLCanvasElement;
  const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const h = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const c = document.createElement('canvas');
  c.width = Math.max(w, s.sheet.width);
  c.height = h + s.sheet.height;
  const g = context(c);
  if (!g) return base;
  g.drawImage(img, 0, 0);
  g.drawImage(s.canvas, 0, h);
  const frames = { ...base.frames };
  for (let i = 0; i < s.sheet.frames; i++) frames[`avatar/${i}`] = { x: i * s.sheet.frameW, y: h, w: s.sheet.frameW, h: s.sheet.frameH };
  const idle: Record<string, string> = { ...base.idle, dima: `avatar/${s.sheet.anims.idle_down?.[0] ?? AVATAR_FRONT_FRAME}` };
  for (const [name, seq] of Object.entries(s.sheet.anims)) idle[`dima:${name}`] = `avatar/${seq[0] ?? AVATAR_FRONT_FRAME}`;
  return { img: c, frames, idle };
}
