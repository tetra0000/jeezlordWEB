// Routes inbound client messages. Auth messages are allowed pre-bind; all game
// commands require an authenticated session and are re-validated against
// authoritative state (ownership, cost, footprint, population) — never trust
// the client.
import type { ClientMsg } from '../../shared/protocol.js';
import { MAP_PX, MAP_TILES, TILE } from '../../shared/constants.js';
import {
  BUILDING_STATS,
  MARKET_MAX_MULT,
  MARKET_MIN_MULT,
  MARKET_STEP,
  MARKET_TRADABLE,
  MARKET_TRADE_UNIT,
  NON_BUILDER_JOBS,
  PLACE_ANYWHERE_KINDS,
  UNIT_STATS,
  costOf,
  isBuilding,
  isUnit,
  marketBuyTotal,
  marketSellTotal,
  townCenterCost,
} from '../../shared/stats.js';
import type { Cost } from '../../shared/stats.js';
import {
  footprintInTerritory,
  footprintTouchesTerritory,
  type TerritorySource,
} from '../../shared/territory.js';
import type { EntityId, EntityKind, Formation, Stance, Stockpile, Vec2 } from '../../shared/types.js';
import {
  type GameContext,
  type Session,
  handleLogin,
  handleRegister,
  handleResume,
  restartPlayer,
} from './session.js';
import { clearMove, setMoveTarget, queueMoveTarget } from '../sim/systems/movement.js';
import { killEntity } from '../sim/systems/combat.js';
import { spawnBuilding } from '../sim/spawn.js';
import { visibleTileSet } from '../sim/systems/vision.js';
import { World } from '../sim/world.js';

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

// Every OTHER player's territory — you may never build inside it (the rule that
// keeps Town Centers / camps "anywhere outside enemy territory").
function enemyTerritorySources(world: World, playerId: number): TerritorySource[] {
  const out: TerritorySource[] = [];
  for (const [id, owner] of world.owner) {
    if (owner == null || owner === playerId || world.kind.get(id) !== 'townCenter' || !world.isOperational(id)) continue;
    const tf = world.transform.get(id)!;
    out.push({ x: tf.x, y: tf.y, radiusTiles: world.tcRadius.get(id) ?? 0 });
  }
  return out;
}

// Distance (in tiles) from a point to the player's nearest existing Town Center
// (any construction state), used to scale a new TC's cost. Infinity if they have
// none (their first/recovery TC — billed at the base price).
function nearestOwnTcDistTiles(world: World, playerId: number, x: number, y: number): number {
  let best = Infinity;
  for (const [id, owner] of world.owner) {
    if (owner !== playerId || world.kind.get(id) !== 'townCenter') continue;
    const tf = world.transform.get(id)!;
    best = Math.min(best, Math.hypot(tf.x - x, tf.y - y) / TILE);
  }
  return best;
}

// True only if every tile of the footprint is currently visible to the player
// (which implies it has been explored). You may not build on fog — unexplored
// or merely-remembered ground. Admin "reveal" sees the whole map, so it bypasses.
function footprintVisible(world: World, playerId: number, tileX: number, tileY: number, footprint: number): boolean {
  if (world.adminReveal.has(playerId)) return true;
  const vis = visibleTileSet(world, playerId);
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      if (!vis.has((tileY + dy) * MAP_TILES + (tileX + dx))) return false;
    }
  }
  return true;
}

// Spread a group move order into a formation around the clicked point: a wide
// line abreast (perpendicular to the direction of travel), a compact box, or a
// loose spread. Units are slotted by their current sideways position so the
// group doesn't cross over itself. No formation (or a single unit) = everyone
// heads to the same point and the separation system shakes them apart.
const FORMATION_SPACING: Record<Formation, number> = { line: TILE * 1.4, box: TILE * 1.4, loose: TILE * 2.4 };
function formationTargets(world: World, ids: EntityId[], x: number, y: number, formation?: Formation): Vec2[] {
  if (!formation || !(formation in FORMATION_SPACING) || ids.length < 2)
    return ids.map(() => ({ x, y }));
  // Centroid -> travel direction; perpendicular is the formation's width axis.
  let cx = 0, cy = 0;
  for (const id of ids) { const tf = world.transform.get(id)!; cx += tf.x; cy += tf.y; }
  cx /= ids.length; cy /= ids.length;
  const len = Math.hypot(x - cx, y - cy);
  const fx = len > 1 ? (x - cx) / len : 1;
  const fy = len > 1 ? (y - cy) / len : 0;
  const px = -fy, py = fx;
  const sp = FORMATION_SPACING[formation];
  const n = ids.length;
  // Slot units by their sideways projection so left units take left slots.
  const order = [...ids].sort((a, b) => {
    const ta = world.transform.get(a)!, tb = world.transform.get(b)!;
    return (ta.x * px + ta.y * py) - (tb.x * px + tb.y * py);
  });
  const cols = formation === 'line' ? n : Math.ceil(Math.sqrt(n));
  const targets = new Map<EntityId, Vec2>();
  order.forEach((id, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const rowN = Math.min(cols, n - row * cols); // last row may be short — centre it
    const ox = (col - (rowN - 1) / 2) * sp;
    const oy = row * sp;
    targets.set(id, {
      x: clamp(x + px * ox - fx * oy, 0, MAP_PX),
      y: clamp(y + py * ox - fy * oy, 0, MAP_PX),
    });
  });
  return ids.map((id) => targets.get(id)!);
}

function pay(world: World, playerId: number, c: Cost): void {
  const s = world.players.get(playerId)!.stockpile;
  s.wood -= c.wood ?? 0;
  s.gold -= c.gold ?? 0;
  s.food -= c.food ?? 0;
  s.stone -= c.stone ?? 0;
  world.markPlayerDirty(playerId);
}

function refund(world: World, playerId: number, c: Cost): void {
  const s = world.players.get(playerId)!.stockpile;
  s.wood += c.wood ?? 0;
  s.gold += c.gold ?? 0;
  s.food += c.food ?? 0;
  s.stone += c.stone ?? 0;
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
      // Validate first, then spread the survivors into the requested formation.
      const movers: EntityId[] = [];
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        if (!world.movement.has(id)) continue;
        // Villagers are not hand-controlled — they follow their assigned job.
        if (world.gatherer.has(id)) continue;
        movers.push(id);
      }
      const targets = formationTargets(world, movers, tx, ty, msg.formation);
      movers.forEach((id, i) => {
        const cs = world.combat.get(id);
        if (cs) {
          cs.targetId = null;
          cs.commanded = false;
        }
        if (msg.queue) queueMoveTarget(world, id, targets[i].x, targets[i].y);
        else setMoveTarget(world, id, targets[i].x, targets[i].y);
      });
      return;
    }

    case 'stance': {
      const st = msg.stance as Stance;
      if (!['aggressive', 'defensive', 'standGround', 'noAttack'].includes(st)) return;
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        if (world.gatherer.has(id)) continue; // villagers have no stance
        if (!world.movement.has(id)) continue; // buildings always fire at will
        const cs = world.combat.get(id);
        if (!cs || cs.stance === st) continue;
        cs.stance = st;
        // Drop any auto-acquired target so the new stance takes effect at once
        // (an explicit attack order is kept — the player asked for that fight).
        if (!cs.commanded) cs.targetId = null;
        world.markDirty(id);
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
      // Buildings with a courtyard (military buildings + the Town Center) reserve
      // a walkable path ring around them; that ring may not overlap a wall, other
      // building, resource node, or impassable terrain — so you can't place flush
      // against a blocker.
      if ((stat.outline ?? 0) > 0 && !world.outlineClear(tileX, tileY, stat.footprint, stat.outline!))
        return session.reject('needs clear space around it');
      if (!footprintVisible(world, playerId, tileX, tileY, stat.footprint))
        return session.reject('cannot build on unexplored land');
      // Placement rules:
      //  - You may NEVER build inside another player's territory.
      //  - Town Centers, Lumber Camps and Mining Camps may go anywhere else (no
      //    own territory required) — this is how you expand into new ground.
      //  - Every other building must sit fully inside your own territory.
      const enemy = enemyTerritorySources(world, playerId);
      if (footprintTouchesTerritory(enemy, tileX, tileY, stat.footprint))
        return session.reject('cannot build inside enemy territory');
      if (!PLACE_ANYWHERE_KINDS.includes(kind)) {
        const sources = territorySources(world, playerId);
        if (sources.length === 0)
          return session.reject('build a town center first');
        if (!footprintInTerritory(sources, tileX, tileY, stat.footprint))
          return session.reject('must build inside your territory');
      }
      // Town Centers cost more the further they sit from your nearest existing
      // one (flat within TC_FREE_RADIUS_TILES, then growing); other buildings
      // use their fixed stat cost.
      const cost = kind === 'townCenter'
        ? townCenterCost(nearestOwnTcDistTiles(world, playerId, (tileX + stat.footprint / 2) * TILE, (tileY + stat.footprint / 2) * TILE))
        : stat.cost;
      const s = world.players.get(playerId)!.stockpile;
      if (!canAfford(s, cost)) return session.reject('not enough resources');
      pay(world, playerId, cost);
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
      if (targetOwner == null || targetOwner === playerId) return; // only other players
      // Diplomacy: you can only attack players you are at war with. War must be
      // declared openly first (in the diplomacy menu) — no sneak attacks.
      if (world.relationOf(playerId, targetOwner) !== 'war')
        return session.reject('you are not at war — declare war in the diplomacy menu first');
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

    case 'diplomacy': {
      const other = msg.playerId;
      if (other === playerId || !world.players.has(other)) return session.reject('unknown player');
      const rel = world.relationOf(playerId, other);
      const key = World.pairKey(playerId, other);
      switch (msg.action) {
        case 'declareWar': {
          if (rel === 'war') return;
          world.setRelation(playerId, other, 'war');
          break;
        }
        case 'propose': {
          // Step the relation up one notch: neutral -> ally, war -> neutral.
          if (rel === 'ally') return; // nothing above ally
          const proposer = world.diploOffers.get(key);
          if (proposer != null && proposer !== playerId) {
            // The other side already proposed — this accepts.
            world.setRelation(playerId, other, rel === 'war' ? 'neutral' : 'ally');
          } else if (proposer == null) {
            world.diploOffers.set(key, playerId);
            world.diploDirty = true;
          }
          break;
        }
        case 'breakAlliance': {
          if (rel !== 'ally') return;
          world.setRelation(playerId, other, 'neutral');
          break;
        }
      }
      return;
    }

    case 'restart': {
      // Only a defeated player (no units, none training) may restart.
      if (world.isAlive(playerId)) return session.reject('you still have units');
      restartPlayer(ctx, session, playerId);
      return;
    }

    case 'market': {
      const resource = msg.resource;
      if (!MARKET_TRADABLE.includes(resource)) return session.reject('that resource is not traded');
      // Trading needs an operational market building.
      let hasMarket = false;
      for (const [id, owner] of world.owner) {
        if (owner === playerId && world.kind.get(id) === 'market' && world.isOperational(id)) { hasMarket = true; break; }
      }
      if (!hasMarket) return session.reject('build a market first');
      const amount = clamp(Math.floor(msg.amount ?? MARKET_TRADE_UNIT), 1, 1000);
      const res = resource as 'wood' | 'food' | 'stone';
      const mult = world.market[res];
      const s = world.players.get(playerId)!.stockpile;
      if (msg.action === 'sell') {
        if (s[res] < amount) return session.reject('not enough to sell');
        s[res] -= amount;
        s.gold += marketSellTotal(resource, mult, amount);
        // Selling adds supply → the price drifts down (clamped to the floor).
        world.market[res] = Math.max(MARKET_MIN_MULT, mult - MARKET_STEP * (amount / MARKET_TRADE_UNIT));
      } else {
        const cost = marketBuyTotal(resource, mult, amount);
        if (s.gold < cost) return session.reject('not enough gold');
        s.gold -= cost;
        s[res] += amount;
        // Buying adds demand → the price drifts up (clamped to the ceiling).
        world.market[res] = Math.min(MARKET_MAX_MULT, mult + MARKET_STEP * (amount / MARKET_TRADE_UNIT));
      }
      world.markPlayerDirty(playerId);
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

    case 'delete': {
      // Destroy your own units or buildings. Only entities you own and only
      // units/buildings (never resource nodes) — re-validated here; never trust
      // the client. A still-under-construction building is a "blueprint": it is
      // refunded in full (you can cancel a misplaced foundation for free).
      // Completed buildings are NOT refunded (the client confirms those).
      for (const id of msg.unitIds) {
        if (world.owner.get(id) !== playerId) continue;
        const k = world.kind.get(id);
        if (!k || (!isUnit(k) && !isBuilding(k))) continue;
        if (isBuilding(k) && !world.isOperational(id))
          refund(world, playerId, BUILDING_STATS[k].cost);
        killEntity(world, id);
      }
      return;
    }
  }
}
