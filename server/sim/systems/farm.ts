// Farm system: AoE2-style auto-reseed. Farms no longer trickle food — villagers
// harvest them (see gather.ts). This system only handles replanting: when a farm
// is empty, its auto-reseed toggle is on, and the owner can afford the wood, it
// refills to full (spending the wood). Runs regardless of owner online status.
import { FARM_FOOD, FARM_RESEED_COST } from '../../../shared/stats.js';
import type { World } from '../world.js';

export function farmSystem(world: World, dt: number): void {
  void dt;
  const woodCost = FARM_RESEED_COST.wood ?? 0;
  for (const [id, kind] of world.kind) {
    if (kind !== 'farm' || !world.isOperational(id)) continue;
    const owner = world.owner.get(id);
    if (owner == null) continue;
    if ((world.resourceAmount.get(id) ?? 0) > 0.001) continue; // still has food
    if (!(world.farmAuto.get(id) ?? true)) continue; // reseed disabled by owner
    const p = world.players.get(owner);
    if (!p || p.stockpile.wood < woodCost) continue; // can't afford to replant
    p.stockpile.wood -= woodCost;
    world.markPlayerDirty(owner);
    world.resourceAmount.set(id, FARM_FOOD);
    world.markDirty(id);
  }
}
