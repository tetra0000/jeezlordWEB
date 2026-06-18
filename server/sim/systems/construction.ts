// Construction system: under-construction buildings auto-progress over their
// build time (so progress continues while the owner is offline). On completion
// the building becomes operational (gains vision, drop-site, training, towers).
import type { World } from '../world.js';

export function constructionSystem(world: World, dt: number): void {
  for (const [id, c] of world.construction) {
    if (c.complete) continue;
    c.elapsed += dt;
    world.markDirty(id);
    if (c.elapsed >= c.buildTime) {
      c.complete = true;
      // Full HP on completion (it was placed at full HP; this is a safety net).
      const hp = world.health.get(id);
      if (hp) hp.hp = hp.maxHp;
    }
  }
}
