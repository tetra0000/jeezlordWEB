// Routes inbound client messages. Auth messages are allowed pre-bind; all game
// commands require an authenticated session and are re-validated against
// authoritative state (ownership, cost, footprint, population) — never trust
// the client.
import type { ClientMsg } from '../../shared/protocol.js';
import { MAP_PX, TILE } from '../../shared/constants.js';
import {
  BUILDING_STATS,
  UNIT_STATS,
  costOf,
  isBuilding,
  isResourceNode,
  isUnit,
} from '../../shared/stats.js';
import type { Cost } from '../../shared/stats.js';
import type { EntityKind, Stockpile } from '../../shared/types.js';
import {
  type GameContext,
  type Session,
  handleLogin,
  handleRegister,
  handleResume,
} from './session.js';
import { clearMove, setMoveTarget } from '../sim/systems/movement.js';
import { spawnBuilding } from '../sim/spawn.js';
import type { World } from '../sim/world.js';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function canAfford(s: Stockpile, c: Cost): boolean {
  return (
    s.wood >= (c.wood ?? 0) &&
    s.gold >= (c.gold ?? 0) &&
    s.food >= (c.food ?? 0) &&
    s.stone >= (c.stone ?? 0)
  );
}
function pay(world: World, playerId: number, c: Cost): void {
  const s = world.players.get(playerId)!.stockpile;
  s.wood -= c.wood ?? 0;
  s.gold -= c.gold ?? 0;
  s.food -= c.food ?? 0;
  s.stone -= c.stone ?? 0;
  world.markPlayerDirty(playerId);
}

export function dispatch(ctx: GameContext, session: Session, msg: ClientMsg): void {
  const world = ctx.world;
  switch (msg.t) {
    case 'register':
      return handleRegister(ctx, session, msg.username, msg.password);
    case 'login':
      return handleLogin(ctx, session, msg.username, msg.password);
    case 'resume':
      return handleResume(ctx, session, msg.token);
  }

  const playerId = session.playerId;
  if (playerId == null) {
    session.reject('not authenticated');
    return;
  }

  switch (msg.t) {
    case 'move': {
      const tx = clamp(msg.x, 0, MAP_PX);
      const ty = clamp(msg.y, 0, MAP_PX);
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        if (!world.movement.has(id)) continue;
        // Manual move cancels gather/attack intent.
        const g = world.gatherer.get(id);
        if (g) {
          g.state = 'idle';
          g.nodeId = null;
        }
        const cs = world.combat.get(id);
        if (cs) {
          cs.targetId = null;
          cs.commanded = false;
        }
        setMoveTarget(world, id, tx, ty);
      }
      return;
    }

    case 'gather': {
      const nodeId = msg.nodeId;
      const nodeKind = world.kind.get(nodeId);
      if (!nodeKind || !isResourceNode(nodeKind)) return;
      const node = world.transform.get(nodeId)!;
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        const g = world.gatherer.get(id);
        if (!g) continue; // only villagers gather
        g.state = 'toNode';
        g.nodeId = nodeId;
        const cs = world.combat.get(id);
        if (cs) cs.targetId = null;
        setMoveTarget(world, id, node.x, node.y);
      }
      return;
    }

    case 'build': {
      const kind = msg.kind as EntityKind;
      if (!isBuilding(kind)) return session.reject('not a building');
      const stat = BUILDING_STATS[kind];
      const { tileX, tileY } = msg;
      if (tileX < 0 || tileY < 0 || tileX + stat.footprint > MAP_PX / TILE || tileY + stat.footprint > MAP_PX / TILE)
        return session.reject('out of bounds');
      if (!world.footprintFree(tileX, tileY, stat.footprint))
        return session.reject('space is occupied');
      const s = world.players.get(playerId)!.stockpile;
      if (!canAfford(s, stat.cost)) return session.reject('not enough resources');
      pay(world, playerId, stat.cost);
      const buildingId = spawnBuilding(world, kind, playerId, tileX, tileY, true);
      // Send builders to walk to the site (construction auto-progresses).
      const c = world.transform.get(buildingId)!;
      for (const id of msg.builderIds) {
        if (world.owner.get(id) !== playerId || !world.gatherer.has(id)) continue;
        const g = world.gatherer.get(id)!;
        g.state = 'building';
        g.nodeId = null;
        g.buildTargetId = buildingId;
        setMoveTarget(world, id, c.x, c.y + stat.footprint * TILE);
      }
      return;
    }

    case 'train': {
      const buildingId = msg.buildingId;
      const unit = msg.unit as EntityKind;
      if (world.owner.get(buildingId) !== playerId) return;
      const bKind = world.kind.get(buildingId);
      if (!bKind || !isBuilding(bKind)) return;
      if (!world.isOperational(buildingId)) return session.reject('building not finished');
      if (!BUILDING_STATS[bKind].trains?.includes(unit)) return session.reject('cannot train that here');
      if (!isUnit(unit)) return;
      const s = world.players.get(playerId)!.stockpile;
      if (!canAfford(s, costOf(unit))) return session.reject('not enough resources');
      if (world.popUsed(playerId) + UNIT_STATS[unit].pop > world.popCap(playerId))
        return session.reject('need more houses (population)');
      pay(world, playerId, costOf(unit));
      let q = world.trainQueue.get(buildingId);
      if (!q) {
        q = [];
        world.trainQueue.set(buildingId, q);
      }
      const t = UNIT_STATS[unit].trainTime;
      q.push({ kind: unit, timeLeft: t, total: t });
      world.markDirty(buildingId);
      return;
    }

    case 'attack': {
      const targetId = msg.targetId;
      const targetOwner = world.owner.get(targetId);
      if (targetOwner == null || targetOwner === playerId) return; // only enemies
      const ttf = world.transform.get(targetId);
      if (!ttf) return;
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        const cs = world.combat.get(id);
        if (!cs) continue; // non-combatant
        cs.targetId = targetId;
        cs.commanded = true;
        const g = world.gatherer.get(id);
        if (g) {
          g.state = 'idle';
          g.nodeId = null;
        }
        setMoveTarget(world, id, ttf.x, ttf.y);
      }
      return;
    }

    case 'stop': {
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        const mv = world.movement.get(id);
        if (mv) clearMove(mv);
        const g = world.gatherer.get(id);
        if (g) {
          g.state = 'idle';
          g.nodeId = null;
        }
        const cs = world.combat.get(id);
        if (cs) {
          cs.targetId = null;
          cs.commanded = false;
        }
      }
      return;
    }
  }
}
