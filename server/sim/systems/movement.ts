// Movement system: advance each moving entity along its pathfound waypoints in
// continuous (off-grid) space. The grid is only used for planning; positions
// are floats. Also exposes helpers for other systems to issue/cancel orders.
import { ARRIVE_EPSILON, TILE, TERRAIN_SWAMP } from '../../../shared/constants.js';
import type { Vec2 } from '../../../shared/types.js';
import type { Movement } from '../components.js';
import type { World } from '../world.js';
import { ROAD_SPEED_BONUS, SWAMP_SPEED_MULT, speedOf } from '../../../shared/stats.js';

// Issue a move order: set the final target and flag for repathing.
export function setMoveTarget(world: World, id: number, x: number, y: number): void {
  let mv = world.movement.get(id);
  if (!mv) {
    const kind = world.kind.get(id);
    if (!kind) return;
    mv = { speed: speedOf(kind), target: null, path: [], pathIndex: -1, repathCooldown: 0 };
    world.movement.set(id, mv);
  }
  mv.target = { x, y };
  mv.path = [];
  mv.pathIndex = -1;
  mv.partial = false;
  mv.waypoints = []; // a plain order replaces any shift-queued waypoints
  world.markDirty(id);
}

// Append a shift-queued waypoint. If the unit isn't already moving, it heads
// there immediately (the first queued click behaves like a normal move);
// otherwise it's tacked on after the current target and any earlier waypoints.
export function queueMoveTarget(world: World, id: number, x: number, y: number): void {
  const mv = world.movement.get(id);
  if (!mv || !mv.target) {
    setMoveTarget(world, id, x, y);
    return;
  }
  (mv.waypoints ??= []).push({ x, y });
  world.markDirty(id);
}

export function clearMove(mv: Movement): void {
  mv.target = null;
  mv.path = [];
  mv.pathIndex = -1;
  mv.partial = false;
  mv.waypoints = [];
}

export function ensureMovement(world: World, id: number): Movement {
  let mv = world.movement.get(id);
  if (!mv) {
    const kind = world.kind.get(id);
    mv = { speed: speedOf(kind ?? 'villager'), target: null, path: [], pathIndex: -1, repathCooldown: 0 };
    world.movement.set(id, mv);
  }
  return mv;
}

function dist(a: Vec2, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Ground under a mover shapes its speed: swamp bogs everyone down; a worn-in
// caravan road speeds everyone up (scaled by wear). Checked per tick from the
// mover's current tile — cheap, and it means roads through swamps still help.
export function terrainSpeedMult(world: World, x: number, y: number): number {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (!world.inBounds(tx, ty)) return 1;
  if (world.terrainAt(tx, ty) === TERRAIN_SWAMP) return SWAMP_SPEED_MULT;
  const wear = world.roadWear.get(world.tileIndex(tx, ty)) ?? 0;
  return wear > 0 ? 1 + ROAD_SPEED_BONUS * wear : 1;
}

export function movementSystem(world: World, dt: number): void {
  for (const [id, mv] of world.movement) {
    if (mv.repathCooldown > 0) mv.repathCooldown = Math.max(0, mv.repathCooldown - dt);
    if (!mv.target || mv.pathIndex < 0 || mv.path.length === 0) continue;

    const tf = world.transform.get(id);
    if (!tf) continue;

    let remaining = mv.speed * dt * terrainSpeedMult(world, tf.x, tf.y);
    while (remaining > 0 && mv.pathIndex < mv.path.length) {
      const wp = mv.path[mv.pathIndex];
      const d = dist(wp, tf);
      if (d <= ARRIVE_EPSILON || d <= remaining) {
        tf.x = wp.x;
        tf.y = wp.y;
        remaining -= d;
        mv.pathIndex++;
      } else {
        tf.x += ((wp.x - tf.x) / d) * remaining;
        tf.y += ((wp.y - tf.y) / d) * remaining;
        remaining = 0;
      }
    }

    if (mv.pathIndex >= mv.path.length) {
      if (mv.partial && mv.target && dist(tf, mv.target) > TILE) {
        // That was only a partial path toward an unreachable/over-budget goal.
        // Re-plan from here (pathfinding picks it up next tick) to keep closing
        // the distance; it gives up on its own once no tile gets any closer.
        mv.path = [];
        mv.pathIndex = -1;
        mv.partial = false;
      } else if (mv.waypoints && mv.waypoints.length > 0) {
        // Reached this destination — advance to the next shift-queued waypoint.
        mv.target = mv.waypoints.shift()!;
        mv.path = [];
        mv.pathIndex = -1;
        mv.partial = false;
      } else {
        // Reached the end of the path.
        clearMove(mv);
      }
    }
    world.markDirty(id);
  }
}
