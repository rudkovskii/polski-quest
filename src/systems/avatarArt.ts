// Данные для сборки аватара (P-03): слои art/avatar/*.sprite.json и палитра art/palette.json.
// Отдельно от avatar.ts, чтобы модель (ключ, слияние, «Losuj») не тянула за собой пиксели.
import paletteJson from '../../art/palette.json';
import { AVATAR_OPTIONS, type AvatarArt, type SpriteData } from './avatar';

const files = import.meta.glob<SpriteData>('/art/avatar/*.sprite.json', { eager: true, import: 'default' });

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function avatarArtFrom(layerFiles: Record<string, SpriteData>, colors: Record<string, string>): AvatarArt {
  const layers: Record<string, SpriteData> = {};
  for (const d of Object.values(layerFiles)) layers[d.id] = d;
  const palette: AvatarArt['palette'] = {};
  for (const [k, v] of Object.entries(colors)) palette[k] = hexToRgb(v);
  return { options: AVATAR_OPTIONS, palette, layers };
}

export const AVATAR_ART: AvatarArt = avatarArtFrom(files, (paletteJson as { colors: Record<string, string> }).colors);
