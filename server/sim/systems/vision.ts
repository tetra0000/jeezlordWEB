// Vision computation for fog of war. Returns the set of tile indices currently
// visible to a player, as the union of vision circles around the player's owned
// units and operational buildings. snapshot.ts uses this to decide which
// entities a player may see (the anti-cheat boundary).
import { MAP_TILES } from '../../../shared/constants.js';
import { visionOf } from '../../../shared/stats.js';
import type { PlayerId } from '../../../shared/types.js';
import type { World } from '../world.js';

export function visibleTileSet(world: World, playerId: PlayerId): Set<number> {
  const visible = new Set<number>();
  for (const [id, owner] of world.owner) {
    if (owner !== playerId) continue;
    const kind = world.kind.get(id)!;
    // Buildings under construction still reveal their footprint area.
    const r = Math.max(1, visionOf(kind));
    const tf = world.transform.get(id)!;
    const cx = Math.floor(tf.x / 32);
    const cy = Math.floor(tf.y / 32);
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      const ty = cy + dy;
      if (ty < 0 || ty >= MAP_TILES) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = cx + dx;
        if (tx < 0 || tx >= MAP_TILES) continue;
        visible.add(ty * MAP_TILES + tx);
      }
    }
  }
  return visible;
}
