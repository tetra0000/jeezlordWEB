// Farm system: each operational farm trickles food into its owner's stockpile
// and depletes its stored amount; when exhausted the farm is removed (must be
// rebuilt). Runs regardless of owner online status.
import { FARM_RATE } from '../../../shared/stats.js';
import type { World } from '../world.js';
import { killEntity } from './combat.js';

export function farmSystem(world: World, dt: number): void {
  for (const [id, kind] of world.kind) {
    if (kind !== 'farm') continue;
    if (!world.isOperational(id)) continue;
    const owner = world.owner.get(id);
    if (owner == null) continue;
    const amount = world.resourceAmount.get(id) ?? 0;
    if (amount <= 0) {
      killEntity(world, id);
      continue;
    }
    const take = Math.min(FARM_RATE * dt, amount);
    world.resourceAmount.set(id, amount - take);
    const p = world.players.get(owner);
    if (p) {
      p.stockpile.food += take;
      world.markPlayerDirty(owner);
    }
    world.markDirty(id);
  }
}
