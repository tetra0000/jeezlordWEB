// Loads the generated sprite PNGs into Pixi textures, keyed by entity kind
// (plus tiles, fx_* effects, team_* owner-colour overlays, icon_* overhead
// badges and decor_* environment props). Call loadAssets() once before
// rendering. Pixel-art scaling (nearest) keeps the sprites crisp.
import { Assets, Texture } from 'pixi.js';
import type { EntityKind } from '../../../shared/types.js';

const ENTITY_KINDS: EntityKind[] = [
  'villager', 'militia', 'warrior', 'spearman', 'archer', 'longbowman',
  'scoutCavalry', 'knight', 'horseArcher', 'catapult', 'caravan',
  'townCenter', 'house', 'mill', 'lumbercamp', 'miningcamp', 'market', 'barracks', 'range', 'stable', 'tower', 'wall', 'gate', 'farm',
  'tree', 'gold', 'stone', 'berry',
];
// Kinds with a team-colour overlay (flags / tabards / trim, tinted by owner).
// One `team_<kind>.png` per entry — mostly-transparent white shapes.
const TEAM_KINDS: EntityKind[] = [
  'villager', 'militia', 'warrior', 'spearman', 'archer', 'longbowman',
  'scoutCavalry', 'knight', 'horseArcher', 'catapult', 'caravan',
  'townCenter', 'house', 'mill', 'lumbercamp', 'miningcamp', 'market', 'barracks', 'range', 'stable', 'tower', 'wall', 'gate', 'farm',
];
// Overhead badges: one per unit kind + one per villager job.
const ICON_KINDS = [
  'villager', 'militia', 'warrior', 'spearman', 'archer', 'longbowman',
  'scoutCavalry', 'knight', 'horseArcher', 'catapult', 'caravan',
];
const ICON_JOBS = ['builder', 'farmer', 'forager', 'lumberjack', 'stonemason', 'goldminer'];
const FX = ['chop', 'spark', 'dust', 'leaf', 'slash'];
const DECOR = ['rock', 'tuft', 'shroom', 'stump', 'bush'];

export const tex: Record<string, Texture> = {};

export async function loadAssets(): Promise<void> {
  const manifest: Record<string, string> = {
    tile_grass: 'assets/tile_grass.png',
    tile_water: 'assets/tile_water.png',
    tile_bridge: 'assets/tile_bridge.png',
    tile_mountain: 'assets/tile_mountain.png',
    tile_mud: 'assets/tile_mud.png',
    tile_beach: 'assets/tile_beach.png',
    tile_dirt: 'assets/tile_dirt.png',
    tile_flowers: 'assets/tile_flowers.png',
    tile_forestground: 'assets/tile_forestground.png',
    tile_path: 'assets/tile_path.png',
    tile_road: 'assets/tile_road.png',
    gate_open: 'assets/gate_open.png',
  };
  for (const k of ENTITY_KINDS) manifest[k] = `assets/${k}.png`;
  for (const k of TEAM_KINDS) manifest['team_' + k] = `assets/team_${k}.png`;
  for (const k of ICON_KINDS) manifest['icon_' + k] = `assets/icon_${k}.png`;
  for (const j of ICON_JOBS) manifest['icon_job_' + j] = `assets/icon_job_${j}.png`;
  for (const f of FX) manifest['fx_' + f] = `assets/fx_${f}.png`;
  for (const d of DECOR) manifest['decor_' + d] = `assets/decor_${d}.png`;

  const loaded = (await Assets.load(Object.values(manifest))) as Record<string, Texture>;
  for (const [key, url] of Object.entries(manifest)) {
    const t = loaded[url];
    if (t?.source) t.source.scaleMode = 'nearest';
    tex[key] = t;
  }
}
