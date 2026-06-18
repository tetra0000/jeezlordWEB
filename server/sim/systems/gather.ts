// Gathering system: villagers walk to a resource node, harvest until full or the
// node depletes, carry back to the nearest owned drop-site building, and repeat.
// Runs regardless of whether the owner is online.
import { TILE } from '../../../shared/constants.js';
import {
  CARRY_CAPACITY,
  GATHER_RATE,
  RESOURCE_NODE_STATS,
  acceptsResource,
} from '../../../shared/stats.js';
import type { EntityId, PlayerId, ResourceType } from '../../../shared/types.js';
import type { World } from '../world.js';
import { clearMove, setMoveTarget } from './movement.js';

// Villagers must stand right beside the resource tile to harvest: covers an
// orthogonally-adjacent tile (~32px centre-to-centre) and a diagonal one (~45px,
// for trees only reachable at a corner) but not a full tile away.
const GATHER_RANGE = TILE * 1.5;
const DEPOSIT_RANGE = TILE * 3.0;
const BUILD_RANGE = TILE * 3.0;

function near(world: World, id: EntityId, x: number, y: number, range: number): boolean {
  const tf = world.transform.get(id);
  if (!tf) return false;
  return Math.hypot(tf.x - x, tf.y - y) <= range;
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
        // Construction auto-progresses; once done/gone the villager goes idle.
        const bId = g.buildTargetId;
        if (bId == null || !world.has(bId) || world.isOperational(bId)) {
          g.state = 'idle';
          g.buildTargetId = null;
          const mv = world.movement.get(id);
          if (mv) clearMove(mv);
          world.markDirty(id);
          break;
        }
        const b = world.transform.get(bId)!;
        if (near(world, id, b.x, b.y, BUILD_RANGE)) {
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
        const node = world.transform.get(g.nodeId)!;
        if (near(world, id, node.x, node.y, GATHER_RANGE)) {
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
        g.carryType = RESOURCE_NODE_STATS[nodeKind].resource;
        const amount = world.resourceAmount.get(g.nodeId) ?? 0;
        const take = Math.min(GATHER_RATE * dt, CARRY_CAPACITY - g.carrying, amount);
        g.carrying += take;
        world.resourceAmount.set(g.nodeId, amount - take);
        world.markDirty(g.nodeId);
        world.markDirty(id);

        if (amount - take <= 0.001) {
          removeResourceNode(world, g.nodeId);
          g.nodeId = null;
        }
        if (g.carrying >= CARRY_CAPACITY - 0.001 || g.nodeId == null) {
          const drop = g.carryType ? nearestDropSite(world, owner, g.carryType, tf.x, tf.y) : null;
          if (drop != null && g.carrying > 0) {
            g.state = 'toDrop';
            const d = world.transform.get(drop)!;
            setMoveTarget(world, id, d.x, d.y);
          } else if (g.nodeId == null) {
            g.state = 'idle';
          }
        }
        break;
      }

      case 'toDrop': {
        const drop = g.carryType ? nearestDropSite(world, owner, g.carryType, tf.x, tf.y) : null;
        if (drop == null) {
          break; // nowhere to deposit this resource type; hold
        }
        const d = world.transform.get(drop)!;
        if (near(world, id, d.x, d.y, DEPOSIT_RANGE)) {
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
