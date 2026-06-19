// Gathering system: villagers walk to a resource node, harvest until full or the
// node depletes, carry back to the nearest owned drop-site building, and repeat.
// Runs regardless of whether the owner is online.
import { TILE } from '../../../shared/constants.js';
import {
  BUILDING_STATS,
  CARRY_CAPACITY,
  GATHER_RATE,
  RESOURCE_NODE_STATS,
  acceptsResource,
  isBuilding,
} from '../../../shared/stats.js';
import type { EntityId, PlayerId, ResourceType } from '../../../shared/types.js';
import type { World } from '../world.js';
import { clearMove, setMoveTarget } from './movement.js';

// A villager must stand within half a tile of the worked tile/building to act on
// it (harvest, deposit, or build). Tighter than before — they have to be right
// up against it, not a tile away.
const WORK_GAP = TILE * 0.5;

// Footprint (in tiles) of anything a villager works at: resource nodes are 1x1,
// buildings come from the stat table.
function footprintOf(world: World, id: EntityId): number {
  const k = world.kind.get(id);
  if (k && isBuilding(k)) return BUILDING_STATS[k].footprint;
  return 1;
}

// True when the villager is right up against the target's footprint. Primary
// test: the distance from the villager to the nearest edge of the footprint box
// is within WORK_GAP (half a tile, plus a small epsilon for float jitter) — this
// is satisfied by standing on an ORTHOGONALLY-adjacent tile, but not a diagonal
// one (which reads as a tile away). Fallback: orthogonal edge-adjacency of tiles,
// for anti-stuck robustness when the villager isn't exactly tile-centred. A
// diagonal/corner position no longer counts (was the "works from a tile away" bug).
const WORK_EPS = 2; // px slack so exact orthogonal adjacency (=WORK_GAP) is robust
export function nearTarget(world: World, vid: EntityId, targetId: EntityId): boolean {
  const tf = world.transform.get(vid);
  const tt = world.transform.get(targetId);
  if (!tf || !tt) return false;
  const k = world.kind.get(targetId);
  const isBld = !!k && isBuilding(k);
  const f = footprintOf(world, targetId);
  const half = (f * TILE) / 2;
  const dx = Math.max(0, Math.abs(tf.x - tt.x) - half);
  const dy = Math.max(0, Math.abs(tf.y - tt.y) - half);
  // Buildings also accept DIAGONAL-corner adjacency (Chebyshev box test): a
  // builder/repairer that can only reach a corner tile of a big footprint — e.g.
  // because the orthogonal tiles are taken by other builders or hemmed in by
  // neighbouring buildings — still counts as "at the site". Without this a
  // corner-stuck builder animates 'build' forever while progress never moves.
  // Resource nodes stay strict (Euclidean) so you can't harvest a diagonal away.
  if (isBld) {
    if (Math.max(dx, dy) <= WORK_GAP + WORK_EPS) return true;
  } else if (Math.hypot(dx, dy) <= WORK_GAP + WORK_EPS) {
    return true;
  }
  // Orthogonal edge-adjacency fallback: the villager's tile must share an edge
  // (not just a corner) with the footprint box.
  const x0 = Math.round(tt.x / TILE - f / 2);
  const y0 = Math.round(tt.y / TILE - f / 2);
  const vx = Math.floor(tf.x / TILE);
  const vy = Math.floor(tf.y / TILE);
  const insideCols = vx >= x0 && vx <= x0 + f - 1;
  const insideRows = vy >= y0 && vy <= y0 + f - 1;
  const edgeLeftRight = (vx === x0 - 1 || vx === x0 + f) && insideRows;
  const edgeTopBottom = (vy === y0 - 1 || vy === y0 + f) && insideCols;
  return edgeLeftRight || edgeTopBottom;
}

// Nearest owned, operational building that accepts the given resource type.
function nearestDropSite(
  world: World,
  playerId: PlayerId,
  resource: ResourceType,
  x: number,
  y: number,
): EntityId | null {
  let best: EntityId | null = null;
  let bestD = Infinity;
  for (const [id, owner] of world.owner) {
    if (owner !== playerId) continue;
    const k = world.kind.get(id)!;
    if (!acceptsResource(k, resource) || !world.isOperational(id)) continue;
    const tf = world.transform.get(id)!;
    const d = Math.hypot(tf.x - x, tf.y - y);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function removeResourceNode(world: World, id: EntityId): void {
  const tf = world.transform.get(id);
  if (tf) {
    const tx = Math.floor(tf.x / TILE);
    const ty = Math.floor(tf.y / TILE);
    if (world.isBlockedTile(tx, ty)) world.unblockFootprint(tx, ty, 1);
  }
  world.remove(id);
}

export function gatherSystem(world: World, dt: number): void {
  for (const [id, g] of world.gatherer) {
    const owner = world.owner.get(id);
    if (owner == null) continue;
    const tf = world.transform.get(id);
    if (!tf) continue;

    switch (g.state) {
      case 'idle':
        break;

      case 'building': {
        // Walk to the assisted building and stand there (animates as 'build').
        // Construction (foundation) or repair (completed building below max HP)
        // auto-progresses; once it's gone or fully built+repaired, go idle.
        const bId = g.buildTargetId;
        let done = bId == null || !world.has(bId);
        if (!done && world.isOperational(bId!)) {
          const h = world.health.get(bId!);
          done = !h || h.hp >= h.maxHp; // operational and at full HP — nothing to do
        }
        if (done) {
          g.state = 'idle';
          g.buildTargetId = null;
          const mv = world.movement.get(id);
          if (mv) clearMove(mv);
          world.markDirty(id);
          break;
        }
        if (nearTarget(world, id, bId!)) {
          const mv = world.movement.get(id);
          if (mv && mv.target) clearMove(mv);
        }
        break;
      }

      case 'toNode': {
        if (g.nodeId == null || !world.has(g.nodeId)) {
          g.state = g.carrying > 0 ? 'toDrop' : 'idle';
          break;
        }
        if (nearTarget(world, id, g.nodeId)) {
          g.state = 'gathering';
          const mv = world.movement.get(id);
          if (mv) clearMove(mv);
        }
        break;
      }

      case 'gathering': {
        if (g.nodeId == null || !world.has(g.nodeId)) {
          g.state = g.carrying > 0 ? 'toDrop' : 'idle';
          break;
        }
        const nodeKind = world.kind.get(g.nodeId)!;
        // Farms are owned buildings, not resource nodes, but villagers harvest
        // food from them the same way (then they reseed instead of vanishing).
        const isFarm = nodeKind === 'farm';
        g.carryType = isFarm ? 'food' : RESOURCE_NODE_STATS[nodeKind].resource;
        const amount = world.resourceAmount.get(g.nodeId) ?? 0;
        const take = Math.min(GATHER_RATE * dt, CARRY_CAPACITY - g.carrying, Math.max(0, amount));
        g.carrying += take;
        world.resourceAmount.set(g.nodeId, amount - take);
        world.markDirty(g.nodeId);
        world.markDirty(id);

        const depleted = amount - take <= 0.001;
        if (depleted && !isFarm) {
          removeResourceNode(world, g.nodeId); // a tree/mine/bush is consumed
          g.nodeId = null;
        }
        // A depleted farm persists (the farmSystem reseeds it); the villager
        // hauls what it has, then either returns or waits for the reseed.
        const sourceEmpty = isFarm && depleted;

        if (g.carrying >= CARRY_CAPACITY - 0.001 || g.nodeId == null || sourceEmpty) {
          const drop = g.carryType ? nearestDropSite(world, owner, g.carryType, tf.x, tf.y) : null;
          if (drop != null && g.carrying > 0) {
            g.state = 'toDrop';
            const d = world.transform.get(drop)!;
            setMoveTarget(world, id, d.x, d.y);
          } else if (g.nodeId == null) {
            g.state = 'idle';
          } else if (sourceEmpty && g.carrying === 0) {
            // Empty-handed at an empty farm: give up unless it will auto-reseed.
            if (!(world.farmAuto.get(g.nodeId) ?? true)) {
              g.state = 'idle';
              g.nodeId = null;
              const mv = world.movement.get(id);
              if (mv) clearMove(mv);
            }
            // else: keep standing here, waiting for the reseed.
          }
        }
        break;
      }

      case 'toDrop': {
        const drop = g.carryType ? nearestDropSite(world, owner, g.carryType, tf.x, tf.y) : null;
        if (drop == null) {
          break; // nowhere to deposit this resource type; hold
        }
        if (nearTarget(world, id, drop)) {
          const p = world.players.get(owner);
          if (p && g.carryType) {
            p.stockpile[g.carryType] += Math.round(g.carrying);
            world.markPlayerDirty(owner);
          }
          g.carrying = 0;
          const mv = world.movement.get(id);
          if (mv) clearMove(mv);
          if (g.nodeId != null && world.has(g.nodeId)) {
            g.state = 'toNode';
            const node = world.transform.get(g.nodeId)!;
            setMoveTarget(world, id, node.x, node.y);
          } else {
            g.state = 'idle';
          }
          world.markDirty(id);
        }
        break;
      }
    }
  }
}
