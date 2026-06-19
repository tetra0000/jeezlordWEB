// Corpse decay: ages every corpse and removes it once it has fully faded
// (CORPSE_TTL_S sim-seconds after death). Runs regardless of owner online
// status, like every system, so battlefields clear themselves while players are
// away and TIME_SCALE fast-forwards it in tests. The fade itself is rendered
// client-side from the quantised `corpse.fade` the snapshot derives from `age`.
import { CORPSE_TTL_S } from '../../../shared/stats.js';
import type { EntityId } from '../../../shared/types.js';
import type { World } from '../world.js';

export function corpseSystem(world: World, dt: number): void {
  let expired: EntityId[] | null = null;
  for (const [id, c] of world.corpses) {
    const before = Math.floor((c.age / CORPSE_TTL_S) * 50); // current quantised fade step
    c.age += dt;
    if (c.age >= CORPSE_TTL_S) {
      (expired ??= []).push(id);
      continue;
    }
    // Mark dirty only when the wire-visible fade step changes (~50 updates over a
    // corpse's life), so a field of corpses doesn't dirty a row every tick.
    if (Math.floor((c.age / CORPSE_TTL_S) * 50) !== before) world.markDirty(id);
  }
  if (expired) for (const id of expired) world.remove(id);
}
