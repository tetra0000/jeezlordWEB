// Soft unit separation (boids-style): nudges overlapping units apart a little
// each tick so a stack of units reads as a CROWD, not a single sprite. It does
// NOT pathfind or fight the movement system — it's a gentle positional relax on
// top of wherever movement/combat already put each unit, so flows still work and
// idle armies fan out around their rally point.
//
// Cheap by construction: units are bucketed into a coarse spatial hash (cell =
// interaction range) so each unit only tests the handful of others in its own
// and adjacent cells, with a hard neighbour cap to bound dense blobs. Units are
// never added to the tile blocker grid, so this is the only thing keeping them
// from co-locating.
import { MAP_PX, TILE } from '../../../shared/constants.js';
import { isUnit } from '../../../shared/stats.js';
import type { EntityId } from '../../../shared/types.js';
import type { World } from '../world.js';

const RADIUS = TILE * 0.34; // a unit's personal-space radius (~11px)
const MIN_SEP = RADIUS * 2; // desired centre-to-centre spacing
const CELL = MIN_SEP; // spatial-hash cell size = interaction range
const MAX_PUSH = TILE * 0.5; // clamp per-tick displacement (stops blow-ups)
const MAX_NEIGHBORS = 24; // bound work per unit inside huge crowds
const MAX_UNSTICK_R = 30; // tiles to search outward for a free tile when caged

// Nearest walkable tile to (tx,ty), spiralling out by Chebyshev rings. Returns
// the tile itself if it's already free, or null if nothing free within range.
function nearestFreeTile(world: World, tx: number, ty: number): { tx: number; ty: number } | null {
  if (!world.isBlockedTile(tx, ty)) return { tx, ty };
  for (let r = 1; r <= MAX_UNSTICK_R; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring edge only
        const nx = tx + dx;
        const ny = ty + dy;
        if (!world.isBlockedTile(nx, ny)) return { tx: nx, ty: ny };
      }
    }
  }
  return null;
}

// Eject any unit caught INSIDE a dynamic blocker (e.g. a building foundation
// placed on top of it — placement only checks tiles are unbuilt, not unit-free)
// to the nearest free tile. Without this the unit is caged: pathfinding and
// separation both refuse blocked destinations, so it can never leave on its own.
// Only dynamic blockers (world.blocked: buildings/walls/resource nodes) count —
// NOT terrain — and walkable buildings (farms/camps) don't block, so units may
// still stand on those.
function unstick(world: World): void {
  for (const [id, k] of world.kind) {
    if (!isUnit(k)) continue;
    const tf = world.transform.get(id);
    if (!tf) continue;
    const tx = Math.floor(tf.x / TILE);
    const ty = Math.floor(tf.y / TILE);
    if (!world.inBounds(tx, ty)) continue;
    if (world.blocked[world.tileIndex(tx, ty)] === 0) continue; // not caged
    const free = nearestFreeTile(world, tx, ty);
    if (!free) continue;
    tf.x = (free.tx + 0.5) * TILE;
    tf.y = (free.ty + 0.5) * TILE;
    // Drop any stale path (its waypoints start from the old, caged spot) so the
    // mover re-plans from the new position; keep its target/order intact.
    const mv = world.movement.get(id);
    if (mv) {
      mv.path = [];
      mv.pathIndex = -1;
      mv.partial = false;
    }
    world.markDirty(id);
  }
}

export function separationSystem(world: World): void {
  unstick(world); // first free anyone caged inside a building, then ease crowds apart
  const cells = Math.ceil(MAP_PX / CELL);
  const buckets = new Map<number, EntityId[]>();
  for (const [id, k] of world.kind) {
    if (!isUnit(k)) continue;
    const tf = world.transform.get(id);
    if (!tf) continue;
    const key = Math.floor(tf.y / CELL) * cells + Math.floor(tf.x / CELL);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(id);
  }

  for (const [id, k] of world.kind) {
    if (!isUnit(k)) continue;
    const tf = world.transform.get(id);
    if (!tf) continue;
    // Anchored workers (harvesting a node / building at a site) stay put so the
    // nudge can't drift them out of work range — but they're still in the buckets
    // above, so others ease away from them.
    const wg = world.gatherer.get(id);
    if (wg && (wg.state === 'gathering' || wg.state === 'building')) continue;
    const cx = Math.floor(tf.x / CELL);
    const cy = Math.floor(tf.y / CELL);
    let pushX = 0;
    let pushY = 0;
    let n = 0;
    for (let gy = cy - 1; gy <= cy + 1 && n < MAX_NEIGHBORS; gy++) {
      for (let gx = cx - 1; gx <= cx + 1 && n < MAX_NEIGHBORS; gx++) {
        const b = buckets.get(gy * cells + gx);
        if (!b) continue;
        for (const oid of b) {
          if (oid === id) continue;
          const otf = world.transform.get(oid);
          if (!otf) continue;
          let ddx = tf.x - otf.x;
          let ddy = tf.y - otf.y;
          let d = Math.hypot(ddx, ddy);
          if (d >= MIN_SEP) continue;
          if (d < 0.001) {
            // Exactly co-located: break the tie deterministically by id so the
            // result is stable (no Math.random in the sim hot path).
            ddx = ((id % 7) - 3) || 1;
            ddy = ((id % 5) - 2) || 1;
            d = Math.hypot(ddx, ddy);
          }
          const w = ((MIN_SEP - d) / d) * 0.5; // each unit takes half the overlap
          pushX += ddx * w;
          pushY += ddy * w;
          if (++n >= MAX_NEIGHBORS) break;
        }
      }
    }
    if (pushX === 0 && pushY === 0) continue;
    const pl = Math.hypot(pushX, pushY);
    if (pl > MAX_PUSH) {
      pushX = (pushX / pl) * MAX_PUSH;
      pushY = (pushY / pl) * MAX_PUSH;
    }
    const nx = Math.min(MAP_PX - 1, Math.max(0, tf.x + pushX));
    const ny = Math.min(MAP_PX - 1, Math.max(0, tf.y + pushY));
    // Never shove a unit into an impassable tile (wall/water/solid building);
    // take the full move if clear, else slide along whichever axis stays free.
    if (!world.isBlockedTile(Math.floor(nx / TILE), Math.floor(ny / TILE))) {
      tf.x = nx;
      tf.y = ny;
      world.markDirty(id);
    } else if (!world.isBlockedTile(Math.floor(nx / TILE), Math.floor(tf.y / TILE))) {
      tf.x = nx;
      world.markDirty(id);
    } else if (!world.isBlockedTile(Math.floor(tf.x / TILE), Math.floor(ny / TILE))) {
      tf.y = ny;
      world.markDirty(id);
    }
  }
}
