// Combat system: target acquisition (commanded or auto), chasing, attack
// cooldowns, damage, and death. Towers fire but don't move. Runs regardless of
// owner online status, so bases can be raided while the owner is offline.
import { TILE } from '../../../shared/constants.js';
import {
  BUILDING_STATS,
  PROJECTILE_OF,
  combatOf,
  damageMultiplier,
  isBuilding,
  isResourceNode,
  isUnit,
  squadMen,
  visionOf,
} from '../../../shared/stats.js';
import type { EntityId, PlayerId } from '../../../shared/types.js';
import type { World } from '../world.js';
import { clearMove, setMoveTarget } from './movement.js';
import { removeResourceNode } from './gather.js';
import { applyBuildingFootprint, spawnCorpse } from '../spawn.js';

function isEnemyOf(world: World, owner: PlayerId, targetId: EntityId): boolean {
  const to = world.owner.get(targetId);
  if (to == null) return false; // neutral / resource nodes are never auto-attacked
  return to !== owner;
}

// Remove a dead entity, unblocking its footprint if it occupied tiles. A dying
// UNIT leaves a corpse behind (a persistent, neutral, decaying body).
export function killEntity(world: World, id: EntityId): void {
  const kind = world.kind.get(id);
  if (!kind) return;
  if (isResourceNode(kind)) {
    removeResourceNode(world, id);
    return;
  }
  if (isUnit(kind)) {
    const tf = world.transform.get(id)!;
    spawnCorpse(world, kind, world.owner.get(id) ?? null, tf.x, tf.y);
  } else if (isBuilding(kind)) {
    const f = BUILDING_STATS[kind].footprint;
    const tf = world.transform.get(id)!;
    const tileX = Math.round(tf.x / TILE - f / 2);
    const tileY = Math.round(tf.y / TILE - f / 2);
    applyBuildingFootprint(world, kind, tileX, tileY, -1);
  }
  world.remove(id);
}

function acquireTarget(world: World, id: EntityId, owner: PlayerId, range: number): EntityId | null {
  const tf = world.transform.get(id)!;
  let best: EntityId | null = null;
  let bestD = range;
  for (const [other, otherOwner] of world.owner) {
    if (otherOwner == null || otherOwner === owner) continue;
    const otf = world.transform.get(other);
    if (!otf) continue;
    const d = Math.hypot(otf.x - tf.x, otf.y - tf.y);
    if (d <= bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

export function combatSystem(world: World, dt: number): void {
  // Last tick's projectiles have been broadcast; clear before recording this
  // tick's so a shot lives for exactly one delta.
  world.shots.length = 0;
  for (const [id, cs] of world.combat) {
    if (cs.cooldownLeft > 0) cs.cooldownLeft = Math.max(0, cs.cooldownLeft - dt);
    cs.attacking = false;

    const kind = world.kind.get(id);
    const owner = world.owner.get(id);
    if (!kind || owner == null) continue;
    if (!world.isOperational(id)) continue; // building still under construction

    const stat = combatOf(kind);
    if (!stat) continue;
    const tf = world.transform.get(id)!;
    const mobile = world.movement.has(id) && !isBuilding(kind);
    const aggro = Math.max(stat.range + TILE, visionOf(kind) * TILE);

    // Validate / pick a target.
    let targetId = cs.targetId;
    if (targetId != null && (!world.has(targetId) || !isEnemyOf(world, owner, targetId))) {
      targetId = null;
      cs.targetId = null;
      cs.commanded = false;
    }
    if (targetId == null) {
      targetId = acquireTarget(world, id, owner, aggro);
      cs.targetId = targetId;
      cs.commanded = false;
    }
    if (targetId == null) continue;

    const ttf = world.transform.get(targetId)!;
    const d = Math.hypot(ttf.x - tf.x, ttf.y - tf.y);

    // Auto-acquired (non-commanded) targets have a leash.
    if (!cs.commanded && d > aggro * 1.5) {
      cs.targetId = null;
      continue;
    }

    if (d <= stat.range) {
      // In range: stop and attack on cooldown.
      cs.attacking = true;
      if (mobile) {
        const mv = world.movement.get(id)!;
        if (mv.target) clearMove(mv);
      }
      if (cs.cooldownLeft <= 0) {
        const hp = world.health.get(targetId)!;
        // Squads deal damage proportional to men still standing, with class
        // counter bonuses (e.g. spearmen vs cavalry). Buildings hit at 1x.
        const myHp = world.health.get(id)!;
        const mult = damageMultiplier(kind, myHp.hp, myHp.maxHp, world.kind.get(targetId));
        hp.hp -= stat.attack * mult;
        cs.cooldownLeft = stat.attackCooldown;
        world.markDirty(targetId);
        // Visible projectiles for ranged attackers (cosmetic; damage above is
        // instant). An archer squad looses one arrow per man still standing,
        // each jittered a little so the volley reads as a volley.
        const proj = PROJECTILE_OF[kind];
        if (proj) {
          const volley = proj === 'arrow' && isUnit(kind) ? squadMen(kind, myHp.hp, myHp.maxHp) : 1;
          for (let i = 0; i < volley; i++) {
            const jx = volley > 1 ? (Math.random() - 0.5) * 18 : 0;
            const jy = volley > 1 ? (Math.random() - 0.5) * 18 : 0;
            world.shots.push({ kind: proj, x: tf.x + jx, y: tf.y + jy, tx: ttf.x + jx * 0.6, ty: ttf.y + jy * 0.6, from: id, to: targetId });
          }
        }
        if (hp.hp <= 0) {
          killEntity(world, targetId);
          cs.targetId = null;
          cs.commanded = false;
        }
      }
    } else if (mobile) {
      // Chase: repath only when our destination is stale (avoid per-tick repaths).
      const mv = world.movement.get(id)!;
      const stale =
        !mv.target || mv.pathIndex < 0 || Math.hypot(mv.target.x - ttf.x, mv.target.y - ttf.y) > TILE * 1.5;
      if (stale) setMoveTarget(world, id, ttf.x, ttf.y);
    }
  }
}
