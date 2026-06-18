// Routes inbound client messages. Auth messages are allowed pre-bind; all game
// commands require an authenticated session and are re-validated against
// authoritative state (ownership, cost, footprint, population) — never trust
// the client.
import type { ClientMsg } from '../../shared/protocol.js';
import { MAP_PX, TILE } from '../../shared/constants.js';
import {
  BUILDING_STATS,
  NON_BUILDER_JOBS,
  UNIT_STATS,
  costOf,
  isBuilding,
  isUnit,
} from '../../shared/stats.js';
import type { Cost } from '../../shared/stats.js';
import {
  footprintInTerritory,
  footprintTouchesTerritory,
  type TerritorySource,
} from '../../shared/territory.js';
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

// How much each "boost resources" admin click adds to every stockpile.
const ADMIN_RESOURCE_BOOST = 10_000;

// Tell a player's client about its current admin-mode state so the cheat panel
// can show/hide and the fog overlay can clear when reveal is on.
function sendAdminState(world: World, session: Session, playerId: number): void {
  session.send({
    t: 'adminState',
    enabled: world.admin.has(playerId),
    reveal: world.adminReveal.has(playerId),
  });
}

function canAfford(s: Stockpile, c: Cost): boolean {
  return (
    s.wood >= (c.wood ?? 0) &&
    s.gold >= (c.gold ?? 0) &&
    s.food >= (c.food ?? 0) &&
    s.stone >= (c.stone ?? 0)
  );
}
// The player's territory: a circle around each of their operational town
// centers. Used to validate building placement.
function territorySources(world: World, playerId: number): TerritorySource[] {
  const out: TerritorySource[] = [];
  for (const [id, owner] of world.owner) {
    if (owner !== playerId || world.kind.get(id) !== 'townCenter' || !world.isOperational(id)) continue;
    const tf = world.transform.get(id)!;
    out.push({ x: tf.x, y: tf.y, radiusTiles: world.tcRadius.get(id) ?? 0 });
  }
  return out;
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
        // Villagers are not hand-controlled — they follow their assigned job.
        if (world.gatherer.has(id)) continue;
        const cs = world.combat.get(id);
        if (cs) {
          cs.targetId = null;
          cs.commanded = false;
        }
        setMoveTarget(world, id, tx, ty);
      }
      return;
    }

    case 'assignJob': {
      const p = world.players.get(playerId);
      if (!p) return;
      const job = msg.job;
      if (job === 'builder' || !NON_BUILDER_JOBS.includes(job)) return; // builder is the remainder
      const count = Math.max(0, Math.min(999, Math.floor(msg.count)));
      p.jobDesired[job] = count;
      world.markPlayerDirty(playerId);
      // The jobs system reconciles assignments to the new target next tick.
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
      // Territory rule: you may only build inside your tribe's territory. Town
      // centers are the exception — they only need to TOUCH it (so you can push
      // the frontier outward). With no territory at all (lost every TC), only a
      // new town center is allowed, anywhere, to recover.
      const sources = territorySources(world, playerId);
      if (sources.length > 0) {
        const ok = kind === 'townCenter'
          ? footprintTouchesTerritory(sources, tileX, tileY, stat.footprint)
          : footprintInTerritory(sources, tileX, tileY, stat.footprint);
        if (!ok)
          return session.reject(
            kind === 'townCenter'
              ? 'town centers must touch your territory'
              : 'must build inside your territory',
          );
      } else if (kind !== 'townCenter') {
        return session.reject('build a town center first');
      }
      const s = world.players.get(playerId)!.stockpile;
      if (!canAfford(s, stat.cost)) return session.reject('not enough resources');
      pay(world, playerId, stat.cost);
      // The foundation is placed; the kingdom's idle "builder" villagers will be
      // auto-tasked to it by the jobs system (no manual builder assignment).
      spawnBuilding(world, kind, playerId, tileX, tileY, true);
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
        // Villagers are job-driven, never hand-commanded (incl. attack).
        if (world.gatherer.has(id)) continue;
        const cs = world.combat.get(id);
        if (!cs) continue; // non-combatant
        cs.targetId = targetId;
        cs.commanded = true;
        setMoveTarget(world, id, ttf.x, ttf.y);
      }
      return;
    }

    case 'rally': {
      const buildingId = msg.buildingId;
      if (world.owner.get(buildingId) !== playerId) return;
      const bKind = world.kind.get(buildingId);
      if (!bKind || !isBuilding(bKind) || !BUILDING_STATS[bKind].trains) return;
      if (msg.x == null || msg.y == null) {
        world.rally.delete(buildingId);
      } else {
        world.rally.set(buildingId, { x: clamp(msg.x, 0, MAP_PX), y: clamp(msg.y, 0, MAP_PX) });
      }
      world.markDirty(buildingId);
      return;
    }

    case 'rename': {
      const id = msg.buildingId;
      if (world.owner.get(id) !== playerId || world.kind.get(id) !== 'townCenter') return;
      const name = (msg.name ?? '').replace(/[<>]/g, '').trim().slice(0, 24);
      // Secret admin toggle: naming a town center "adminmode" flips admin mode
      // for the owner instead of actually renaming the building.
      if (name.toLowerCase() === 'adminmode') {
        if (world.admin.has(playerId)) {
          world.admin.delete(playerId);
          world.adminReveal.delete(playerId);
        } else {
          world.admin.add(playerId);
        }
        sendAdminState(world, session, playerId);
        return;
      }
      if (name) world.tcName.set(id, name);
      else world.tcName.delete(id);
      world.markDirty(id);
      return;
    }

    case 'farmReseed': {
      const id = msg.buildingId;
      if (world.owner.get(id) !== playerId || world.kind.get(id) !== 'farm') return;
      world.farmAuto.set(id, !!msg.on);
      world.markDirty(id);
      return;
    }

    case 'admin': {
      // Re-check the authoritative flag — the client can't grant itself admin.
      if (!world.admin.has(playerId)) return session.reject('admin mode not enabled');
      switch (msg.action) {
        case 'boostResources': {
          const s = world.players.get(playerId)!.stockpile;
          s.wood += ADMIN_RESOURCE_BOOST;
          s.gold += ADMIN_RESOURCE_BOOST;
          s.food += ADMIN_RESOURCE_BOOST;
          s.stone += ADMIN_RESOURCE_BOOST;
          world.markPlayerDirty(playerId);
          break;
        }
        case 'revealFog': {
          if (world.adminReveal.has(playerId)) world.adminReveal.delete(playerId);
          else world.adminReveal.add(playerId);
          sendAdminState(world, session, playerId);
          break;
        }
      }
      return;
    }

    case 'stop': {
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        // Villagers ignore stop — their job drives them.
        if (world.gatherer.has(id)) continue;
        const mv = world.movement.get(id);
        if (mv) clearMove(mv);
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
