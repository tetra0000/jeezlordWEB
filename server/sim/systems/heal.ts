// Healing system: units slowly regenerate health while inside their own
// territory (the union of their operational town centers' tile-discs — the same
// zone used for building placement). Slow by design (HEAL_RATE_PER_S, ~1 hp/min)
// to fit the multi-day pacing. Runs regardless of owner online status, so an
// army left in friendly territory recovers while the player is away. Buildings
// and resource nodes don't regenerate (units only).
import { TILE } from '../../../shared/constants.js';
import { HEAL_RATE_PER_S, isUnit } from '../../../shared/stats.js';
import { tileInTerritory, type TerritorySource } from '../../../shared/territory.js';
import type { PlayerId } from '../../../shared/types.js';
import type { World } from '../world.js';

export function healSystem(world: World, dt: number): void {
  const heal = HEAL_RATE_PER_S * dt;
  if (heal <= 0) return;

  // Each player's territory (operational TCs), computed lazily and cached for the
  // tick so we only scan owners once per player that actually has a hurt unit.
  const sourcesByPlayer = new Map<PlayerId, TerritorySource[]>();
  const sourcesFor = (pid: PlayerId): TerritorySource[] => {
    let s = sourcesByPlayer.get(pid);
    if (s) return s;
    s = [];
    for (const [id, owner] of world.owner) {
      if (owner !== pid || world.kind.get(id) !== 'townCenter' || !world.isOperational(id)) continue;
      const tf = world.transform.get(id)!;
      s.push({ x: tf.x, y: tf.y, radiusTiles: world.tcRadius.get(id) ?? 0 });
    }
    sourcesByPlayer.set(pid, s);
    return s;
  };

  for (const [id, h] of world.health) {
    if (h.hp >= h.maxHp) continue; // full health (skips every resource node cheaply)
    const owner = world.owner.get(id);
    if (owner == null) continue;
    const kind = world.kind.get(id);
    if (!kind || !isUnit(kind)) continue; // units only — buildings don't regen
    const src = sourcesFor(owner);
    if (src.length === 0) continue;
    const tf = world.transform.get(id)!;
    const tx = Math.floor(tf.x / TILE);
    const ty = Math.floor(tf.y / TILE);
    if (!tileInTerritory(src, tx, ty)) continue;
    h.hp = Math.min(h.maxHp, h.hp + heal);
    world.markDirty(id);
  }
}
