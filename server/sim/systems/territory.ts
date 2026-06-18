// Territory system: each operational town center slowly grows its territory
// radius from TERRITORY_MIN_TILES toward TERRITORY_MAX_TILES over
// TERRITORY_GROW_TIME_S of sim-time. Runs regardless of owner online status, so
// borders keep expanding while the player is away.
import {
  TERRITORY_GROW_TIME_S,
  TERRITORY_MAX_TILES,
  TERRITORY_MIN_TILES,
} from '../../../shared/stats.js';
import type { World } from '../world.js';

const GROW_RATE = (TERRITORY_MAX_TILES - TERRITORY_MIN_TILES) / TERRITORY_GROW_TIME_S; // tiles/s

export function territorySystem(world: World, dt: number): void {
  for (const [id, r] of world.tcRadius) {
    if (r >= TERRITORY_MAX_TILES) continue;
    if (!world.isOperational(id)) continue; // a foundation projects no territory yet
    const next = Math.min(TERRITORY_MAX_TILES, r + GROW_RATE * dt);
    world.tcRadius.set(id, next);
    world.markDirty(id);
  }
}
