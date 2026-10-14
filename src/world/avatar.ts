// Текстура игрока (P-03): лист аватара из слоёв (src/systems/avatar.ts) → CanvasTexture `avatar`
// с кадрами `avatar/0…11` и анимациями `avatar:walk_*`/`avatar:idle_*` как у `dima`. Внешность приходит
// по шине (`avatar:changed`); пока её нет, игрок рисуется спрайтом `dima` из атласа.
import Phaser from 'phaser';
import { bus } from '../systems/bus';
import { avatarKey, composeAvatar, type Appearance } from '../systems/avatar';
import { AVATAR_ART } from '../systems/avatarArt';

export const AVATAR_TEXTURE = 'avatar';
const FALLBACK = 'dima';

interface SpriteMeta {
  size: [number, number];
  anchor: [number, number];
  frames: string[];
  anims: Record<string, string[]>;
}

let current: Appearance | null = null;
/** Менеджеры текстур, где уже есть `avatar` → какой ключ внешности в нём нарисован. */
const drawn = new Map<Phaser.Textures.TextureManager, string>();

bus.on('avatar:changed', ({ appearance }) => {
  current = appearance;
  for (const tm of drawn.keys()) draw(tm, appearance);
});

/** Текущая внешность (dev, тесты). */
export function currentAppearance(): Appearance | null {
  return current;
}

function draw(tm: Phaser.Textures.TextureManager, a: Appearance): Phaser.Textures.CanvasTexture | null {
  const key = avatarKey(a);
  const existing = tm.exists(AVATAR_TEXTURE) ? (tm.get(AVATAR_TEXTURE) as Phaser.Textures.CanvasTexture) : null;
  if (existing && drawn.get(tm) === key) return existing;
  const sheet = composeAvatar(a, AVATAR_ART);
  const tex = existing ?? tm.createCanvas(AVATAR_TEXTURE, sheet.width, sheet.height);
  if (!tex) return null;
  tex.context.clearRect(0, 0, sheet.width, sheet.height);
  tex.context.putImageData(new ImageData(new Uint8ClampedArray(sheet.pixels), sheet.width, sheet.height), 0, 0);
  if (!existing) for (let i = 0; i < sheet.frames; i++) tex.add(`${AVATAR_TEXTURE}/${i}`, 0, i * sheet.frameW, 0, sheet.frameW, sheet.frameH);
  tex.refresh();
  drawn.set(tm, key);
  return tex;
}

/**
 * Id спрайта игрока для Location: `avatar` (текстура и анимации готовы, мета добавлена в `sprites`)
 * или `dima` (внешность ещё не пришла, сборка не удалась). Текстура sprite'а: `avatar` или атлас.
 */
export function playerTextureKey(scene: Phaser.Scene, sprites: Record<string, SpriteMeta>): string {
  const base = sprites[FALLBACK];
  if (!current || !base) return FALLBACK;
  try {
    if (!draw(scene.textures, current)) return FALLBACK;
  } catch (e) {
    console.warn('[avatar] сборка не удалась, рисую dima', e);
    return FALLBACK;
  }
  const frame = (name: string): string => name.replace(`${FALLBACK}/`, `${AVATAR_TEXTURE}/`);
  sprites[AVATAR_TEXTURE] ??= {
    size: base.size,
    anchor: base.anchor,
    frames: base.frames.map(frame),
    anims: Object.fromEntries(Object.entries(base.anims).map(([k, v]) => [k, v.map(frame)])),
  };
  for (const [name, frames] of Object.entries(sprites[AVATAR_TEXTURE].anims)) {
    const key = `${AVATAR_TEXTURE}:${name}`;
    if (scene.anims.exists(key)) continue;
    const walk = name.startsWith('walk');
    scene.anims.create({ key, frames: frames.map((f) => ({ key: AVATAR_TEXTURE, frame: f })), frameRate: walk ? (frames.length > 2 ? 10 : 6) : 1, repeat: -1 });
  }
  return AVATAR_TEXTURE;
}
