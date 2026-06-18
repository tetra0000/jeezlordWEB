// Placeholder palette + per-kind glyphs. All graphics are data-driven here so
// swapping in real art later is a localized change.
import type { EntityKind, PlayerId } from '../../../shared/types.js';

// Distinct, readable owner colours assigned by player id.
const PLAYER_PALETTE = [
  0x4a90d9, // blue
  0xd94a4a, // red
  0x4ad96a, // green
  0xd9c14a, // yellow
  0xb04ad9, // purple
  0xd98a4a, // orange
  0x4ad9d0, // teal
  0xd94a9a, // pink
];

export const NEUTRAL_COLOR = 0x8a8a7a;

export function ownerColor(owner: PlayerId | null): number {
  if (owner == null) return NEUTRAL_COLOR;
  return PLAYER_PALETTE[owner % PLAYER_PALETTE.length];
}

export interface KindStyle {
  shape: 'circle' | 'rect';
  glyph: string;
  size: number; // radius for circle, half-extent for rect (px)
}

export const KIND_STYLE: Record<EntityKind, KindStyle> = {
  villager: { shape: 'circle', glyph: 'V', size: 10 },
  infantry: { shape: 'circle', glyph: 'I', size: 11 },
  archer: { shape: 'circle', glyph: 'A', size: 10 },
  cavalry: { shape: 'circle', glyph: 'C', size: 12 },
  horse: { shape: 'circle', glyph: 'H', size: 13 },
  catapult: { shape: 'circle', glyph: 'K', size: 14 },
  wall: { shape: 'rect', glyph: '', size: 14 },
  tower: { shape: 'rect', glyph: 'T', size: 14 },
  townCenter: { shape: 'rect', glyph: 'TC', size: 46 },
  house: { shape: 'rect', glyph: 'h', size: 15 },
  mill: { shape: 'rect', glyph: 'M', size: 30 },
  lumbercamp: { shape: 'rect', glyph: 'L', size: 14 },
  miningcamp: { shape: 'rect', glyph: 'O', size: 14 },
  barracks: { shape: 'rect', glyph: 'B', size: 30 },
  range: { shape: 'rect', glyph: 'R', size: 30 },
  stable: { shape: 'rect', glyph: 'S', size: 30 },
  farm: { shape: 'rect', glyph: 'f', size: 30 },
  tree: { shape: 'circle', glyph: '', size: 9 },
  gold: { shape: 'circle', glyph: '$', size: 9 },
  stone: { shape: 'circle', glyph: '', size: 9 },
  berry: { shape: 'circle', glyph: '', size: 8 },
};
