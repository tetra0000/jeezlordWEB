// Loads the generated placeholder sprite PNGs into Pixi textures, keyed by
// entity kind (plus the grass tile and fx_* effect sprites). Call loadAssets()
// once before rendering. Pixel-art scaling (nearest) keeps the sprites crisp.
import { Assets, Texture } from 'pixi.js';
import type { EntityKind } from '../../../shared/types.js';

const ENTITY_KINDS: EntityKind[] = [
  'villager', 'infantry', 'archer', 'cavalry', 'horse', 'catapult',
  'townCenter', 'house', 'mill', 'lumbercamp', 'miningcamp', 'barracks', 'range', 'stable', 'tower', 'wall', 'farm',
  'tree', 'gold', 'stone', 'berry',
];
const FX = ['chop', 'spark', 'dust', 'leaf', 'slash'];

export const tex: Record<string, Texture> = {};

export async function loadAssets(): Promise<void> {
  const manifest: Record<string, string> = { tile_grass: 'assets/tile_grass.png' };
  for (const k of ENTITY_KINDS) manifest[k] = `assets/${k}.png`;
  for (const f of FX) manifest['fx_' + f] = `assets/fx_${f}.png`;

  const loaded = (await Assets.load(Object.values(manifest))) as Record<string, Texture>;
  for (const [key, url] of Object.entries(manifest)) {
    const t = loaded[url];
    if (t?.source) t.source.scaleMode = 'nearest';
    tex[key] = t;
  }
}
