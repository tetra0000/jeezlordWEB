// One-time world generation: scatters resource nodes (forests, gold, stone,
// berry patches) across the map. Runs only on a fresh world (guarded by a
// 'seeded' meta flag in main.ts).
import { MAP_TILES } from '../../shared/constants.js';
import type { EntityKind } from '../../shared/types.js';
import type { World } from './world.js';
import { spawnResourceNode } from './spawn.js';

const MARGIN = 8; // keep nodes away from the very edge

function randTile(): number {
  return MARGIN + Math.floor(Math.random() * (MAP_TILES - MARGIN * 2));
}

function placeCluster(world: World, kind: EntityKind, cx: number, cy: number, count: number, spread: number): void {
  for (let i = 0; i < count; i++) {
    const tx = cx + Math.floor((Math.random() - 0.5) * spread * 2);
    const ty = cy + Math.floor((Math.random() - 0.5) * spread * 2);
    if (tx < MARGIN || ty < MARGIN || tx >= MAP_TILES - MARGIN || ty >= MAP_TILES - MARGIN) continue;
    if (world.isBlockedTile(tx, ty)) continue;
    spawnResourceNode(world, kind, tx, ty);
  }
}

export function seedWorld(world: World): void {
  // Forests.
  for (let f = 0; f < 120; f++) placeCluster(world, 'tree', randTile(), randTile(), 8 + Math.floor(Math.random() * 8), 5);
  // Berry patches.
  for (let b = 0; b < 60; b++) placeCluster(world, 'berry', randTile(), randTile(), 3 + Math.floor(Math.random() * 4), 2);
  // Gold deposits.
  for (let g = 0; g < 45; g++) placeCluster(world, 'gold', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);
  // Stone deposits.
  for (let s = 0; s < 45; s++) placeCluster(world, 'stone', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);

  console.log(`[worldgen] seeded ${[...world.entityIds()].length} resource nodes`);
}
