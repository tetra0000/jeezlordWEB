// Training system: production buildings drain their queue over time and spawn
// the finished unit just outside their footprint. Drains while the owner is
// offline. (Population was reserved at enqueue time in dispatch.)
import { TILE } from '../../../shared/constants.js';
import { BUILDING_STATS } from '../../../shared/stats.js';
import type { World } from '../world.js';
import { spawnUnit } from '../spawn.js';

function spawnPointFor(world: World, buildingId: number): { x: number; y: number } {
  const tf = world.transform.get(buildingId)!;
  const kind = world.kind.get(buildingId)!;
  const f = BUILDING_STATS[kind]?.footprint ?? 1;
  // Just below the footprint, nudged to a tile centre.
  return { x: tf.x, y: tf.y + (f / 2 + 0.7) * TILE };
}

export function trainingSystem(world: World, dt: number): void {
  for (const [id, queue] of world.trainQueue) {
    if (queue.length === 0) continue;
    if (!world.isOperational(id)) continue;
    const owner = world.owner.get(id);
    if (owner == null) continue;

    const front = queue[0];
    front.timeLeft -= dt;
    world.markDirty(id);
    if (front.timeLeft <= 0) {
      queue.shift();
      const p = spawnPointFor(world, id);
      spawnUnit(world, front.kind, owner, p.x, p.y);
    }
  }
}
