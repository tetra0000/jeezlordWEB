// Construction system: a placed building is a foundation that only advances
// while at least one of the owner's villagers is assigned to build it AND is
// standing at the site. More builders finish faster, with diminishing returns
// (AoE2-style) so swarms help but don't trivialise big builds. If every builder
// leaves, progress pauses (no decay). Completion makes the building operational
// (gains vision, drop-site, training, towers, territory).
//
// The same builder presence also REPAIRS completed buildings/walls that are
// below max HP (jobs.ts tasks idle builders to damaged buildings in territory).
import { REPAIR_TIME_S } from '../../../shared/stats.js';
import type { EntityId } from '../../../shared/types.js';
import type { World } from '../world.js';
import { nearTarget } from './gather.js';

// Effective build speed for n present builders. n^0.75: 1->1, 2->1.68, 3->2.28,
// 4->2.83 — each extra villager adds less than the last.
function buildPower(n: number): number {
  return Math.pow(n, 0.75);
}

export function constructionSystem(world: World, dt: number): void {
  // Tally builders present at each site in a single pass over gatherers.
  const builders = new Map<EntityId, number>();
  for (const [vid, g] of world.gatherer) {
    if (g.state !== 'building' || g.buildTargetId == null) continue;
    if (!world.has(g.buildTargetId)) continue;
    if (nearTarget(world, vid, g.buildTargetId))
      builders.set(g.buildTargetId, (builders.get(g.buildTargetId) ?? 0) + 1);
  }

  // Only sites with a builder present advance (construct) or get repaired; with
  // none, progress simply pauses (no decay).
  for (const [id, n] of builders) {
    const c = world.construction.get(id);
    if (c && !c.complete) {
      // Construction: advance toward completion.
      c.elapsed += dt * buildPower(n);
      world.markDirty(id);
      if (c.elapsed >= c.buildTime) {
        c.complete = true;
        const hp = world.health.get(id);
        if (hp) hp.hp = hp.maxHp;
      }
    } else {
      // Repair: a completed building/wall below max HP regains health.
      const hp = world.health.get(id);
      if (hp && hp.hp < hp.maxHp) {
        hp.hp = Math.min(hp.maxHp, hp.hp + (hp.maxHp / REPAIR_TIME_S) * buildPower(n) * dt);
        world.markDirty(id);
      }
    }
  }
}
