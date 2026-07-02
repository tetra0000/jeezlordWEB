// Trade routes + caravans. A route is an owned, ordered loop of market STOPS
// (2..TRADE_ROUTE_MAX_STOPS); assigned caravans cycle through the stops and are
// paid gold on arrival at each FOREIGN stop (a market owned by another player),
// scaled by the leg they just travelled. Own stops pay nothing — you cannot
// trade with yourself, and a route with no foreign stop is rejected/dissolved.
// Runs regardless of owner online status, like every system — trade routes keep
// earning while you sleep.
//
// Route resilience: every tick each route drops stops that died or whose owner
// is now at war with the route's owner; a route left with fewer than 2 stops or
// no foreign stop is dissolved and its caravans go idle where they stand.
//
// Caravans also wear the ground they travel into ROADS (World.roadWear), and
// their pathfinding prefers worn tiles (see findPath) — so routes converge onto
// shared roads and reinforce them into highways.
import { TILE } from '../../../shared/constants.js';
import { ROAD_LEVELS, ROAD_WEAR_PER_S, TRADE_ROUTE_MAX_STOPS, caravanGold } from '../../../shared/stats.js';
import type { EntityId, PlayerId } from '../../../shared/types.js';
import type { TradeRoute, Trader } from '../components.js';
import type { World } from '../world.js';
import { clearMove, setMoveTarget } from './movement.js';

// A caravan has "arrived" at a market when it stands within two tiles of its
// centre. Markets are 2x2 and block their footprint, so the closest walkable
// tile centre is ~1.58 tiles out — the radius must cover that, or a caravan
// jostled by station traffic (separation) can bounce against the stall forever
// without ever registering the arrival.
const ARRIVE_DIST = TILE * 2;

function isLiveMarket(world: World, id: EntityId | null | undefined): boolean {
  return id != null && world.kind.get(id) === 'market' && world.isOperational(id);
}

export function nearestOwnMarket(world: World, pid: PlayerId, x: number, y: number, excludeId?: EntityId): EntityId | null {
  let best: EntityId | null = null;
  let bestD = Infinity;
  for (const [id, owner] of world.owner) {
    if (owner !== pid || id === excludeId) continue;
    if (!isLiveMarket(world, id)) continue;
    const tf = world.transform.get(id)!;
    const d = Math.hypot(tf.x - x, tf.y - y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// Take a caravan off its route (manual order, dead route, route deleted).
export function stopTrading(world: World, id: EntityId, tr: Trader, clearMovement = true): void {
  if (tr.state === 'idle' && tr.routeId == null) return;
  tr.state = 'idle';
  tr.routeId = null;
  tr.stopIndex = 0;
  tr.lastStopId = null;
  if (clearMovement) {
    const mv = world.movement.get(id);
    if (mv) clearMove(mv);
  }
  world.markDirty(id);
}

// Wear the ground under a working caravan into road. Wear accrues per
// sim-second, caps at 1, and emits a quantised road event when its wire level
// ticks up (the snapshot layer forwards those to every client).
function wearRoad(world: World, tf: { x: number; y: number }, dt: number): void {
  const tx = Math.floor(tf.x / TILE);
  const ty = Math.floor(tf.y / TILE);
  if (!world.inBounds(tx, ty)) return;
  const i = world.tileIndex(tx, ty);
  const before = world.roadWear.get(i) ?? 0;
  if (before >= 1) return;
  const after = Math.min(1, before + ROAD_WEAR_PER_S * dt);
  world.roadWear.set(i, after);
  world.dirtyRoads.add(i);
  const lvlBefore = Math.round(before * ROAD_LEVELS);
  const lvlAfter = Math.round(after * ROAD_LEVELS);
  if (lvlAfter > lvlBefore) world.roadEvents.push([i, lvlAfter]);
}

// Whether this stop may stay on this owner's route: a live market whose owner
// isn't at war with the route owner.
function stopValid(world: World, owner: PlayerId, stop: EntityId): boolean {
  if (!isLiveMarket(world, stop)) return false;
  const so = world.owner.get(stop);
  return so == null || so === owner || world.relationOf(owner, so) !== 'war';
}

function routeHasForeignStop(world: World, route: TradeRoute): boolean {
  return route.stops.some((s) => world.owner.get(s) !== route.owner);
}

// Drop dead/at-war stops from every route; dissolve routes that no longer have
// 2+ stops and a foreign stop. Returns the set of dissolved route ids so the
// caravan pass can idle their caravans.
function reconcileRoutes(world: World): void {
  const dead: number[] = [];
  for (const route of world.tradeRoutes.values()) {
    const kept = route.stops.filter((s) => stopValid(world, route.owner, s));
    if (kept.length !== route.stops.length) {
      route.stops = kept;
      world.routesDirty = true;
    }
    if (kept.length < 2 || !routeHasForeignStop(world, route)) dead.push(route.id);
  }
  for (const id of dead) {
    world.tradeRoutes.delete(id);
    world.routesDirty = true;
  }
}

export function tradeSystem(world: World, dt: number): void {
  // Last tick's road events have been broadcast; this tick starts fresh.
  world.roadEvents.length = 0;
  reconcileRoutes(world);

  for (const [id, tr] of world.trader) {
    if (tr.routeId == null) continue;
    const owner = world.owner.get(id);
    const tf = world.transform.get(id);
    if (owner == null || !tf) continue;

    const route = world.tradeRoutes.get(tr.routeId);
    if (!route || route.owner !== owner) { stopTrading(world, id, tr); continue; }
    wearRoad(world, tf, dt);

    // Stops may have been dropped since we set course — clamp and retarget.
    if (tr.stopIndex >= route.stops.length) tr.stopIndex = 0;
    const destId = route.stops[tr.stopIndex];
    const dest = world.transform.get(destId)!;
    const d = Math.hypot(dest.x - tf.x, dest.y - tf.y);

    if (d <= ARRIVE_DIST) {
      // Arrived. A FOREIGN stop pays for the leg just travelled (measured stop
      // to stop; the first leg after assignment has no departure stop and pays
      // nothing).
      if (world.owner.get(destId) !== owner && tr.lastStopId != null) {
        const from = world.transform.get(tr.lastStopId);
        if (from) {
          const legTiles = Math.hypot(dest.x - from.x, dest.y - from.y) / TILE;
          const p = world.players.get(owner);
          if (p) {
            p.stockpile.gold += caravanGold(legTiles);
            world.markPlayerDirty(owner);
          }
        }
      }
      tr.lastStopId = destId;
      tr.stopIndex = (tr.stopIndex + 1) % route.stops.length;
      const next = world.transform.get(route.stops[tr.stopIndex])!;
      setMoveTarget(world, id, next.x, next.y);
      world.markDirty(id);
    } else {
      // En route: make sure a move order exists (it's lost on server restart —
      // paths are in-memory) and tracks the destination.
      const mv = world.movement.get(id);
      if (mv && !mv.target) setMoveTarget(world, id, dest.x, dest.y);
    }
  }
}

// --- route management (called from dispatch) ---------------------------------

// Validate + create a route. Returns the route or an error string for the toast.
export function createTradeRoute(world: World, owner: PlayerId, stops: EntityId[]): TradeRoute | string {
  if (!Array.isArray(stops) || stops.length < 2) return 'a route needs at least 2 market stops';
  if (stops.length > TRADE_ROUTE_MAX_STOPS) return `a route may have at most ${TRADE_ROUTE_MAX_STOPS} stops`;
  const discovered = world.discoveredMarkets.get(owner);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (!isLiveMarket(world, s)) return 'every stop must be a working market';
    if (s === stops[(i + 1) % stops.length]) return 'the same market cannot appear twice in a row';
    const so = world.owner.get(s);
    if (so !== owner && !discovered?.has(s)) return 'you can only route to markets you have discovered';
    if (so != null && so !== owner && world.relationOf(owner, so) === 'war')
      return 'you cannot trade with a player you are at war with';
  }
  if (!stops.some((s) => world.owner.get(s) !== owner))
    return 'you cannot trade with yourself — a route needs another player’s market';
  const route: TradeRoute = { id: world.nextRouteId++, owner, stops: [...stops] };
  world.tradeRoutes.set(route.id, route);
  world.routesDirty = true;
  return route;
}

// Delete an owned route; its caravans go idle where they stand.
export function deleteTradeRoute(world: World, owner: PlayerId, routeId: number): string | null {
  const route = world.tradeRoutes.get(routeId);
  if (!route || route.owner !== owner) return 'no such route';
  world.tradeRoutes.delete(routeId);
  world.routesDirty = true;
  for (const [id, tr] of world.trader) if (tr.routeId === routeId) stopTrading(world, id, tr);
  return null;
}

// Put a caravan on a route: it heads for the nearest stop and cycles from there.
export function assignCaravanToRoute(world: World, caravanId: EntityId, routeId: number): string | null {
  const owner = world.owner.get(caravanId);
  if (owner == null || world.kind.get(caravanId) !== 'caravan') return 'not your caravan';
  const route = world.tradeRoutes.get(routeId);
  if (!route || route.owner !== owner) return 'no such route';
  const tf = world.transform.get(caravanId);
  if (!tf) return 'caravan is gone';

  let tr = world.trader.get(caravanId);
  if (!tr) {
    tr = { state: 'idle', routeId: null, stopIndex: 0, lastStopId: null };
    world.trader.set(caravanId, tr);
  }
  // Join at the nearest stop (no payout for the joining leg — lastStopId null).
  let best = 0;
  let bestD = Infinity;
  route.stops.forEach((s, i) => {
    const st = world.transform.get(s);
    if (!st) return;
    const d = Math.hypot(st.x - tf.x, st.y - tf.y);
    if (d < bestD) { bestD = d; best = i; }
  });
  tr.routeId = route.id;
  tr.stopIndex = best;
  tr.lastStopId = null;
  tr.state = 'enroute';
  const dest = world.transform.get(route.stops[best])!;
  setMoveTarget(world, caravanId, dest.x, dest.y);
  world.markDirty(caravanId);
  return null;
}

// Quick route (right-click a market with caravans selected): reuse an existing
// two-stop route [nearest own market -> target], creating it if needed, and
// assign the caravan. The target must be another player's market.
export function quickTradeRoute(world: World, caravanId: EntityId, marketId: EntityId): string | null {
  const owner = world.owner.get(caravanId);
  if (owner == null || world.kind.get(caravanId) !== 'caravan') return 'not your caravan';
  if (!isLiveMarket(world, marketId)) return 'that is not a working market';
  if (world.owner.get(marketId) === owner)
    return 'you cannot trade with yourself — pick another player’s market';
  const tf = world.transform.get(caravanId);
  if (!tf) return 'caravan is gone';
  const home = nearestOwnMarket(world, owner, tf.x, tf.y);
  if (home == null) return 'you need a market of your own first';

  let route: TradeRoute | undefined;
  for (const r of world.tradeRoutes.values()) {
    if (r.owner === owner && r.stops.length === 2 && r.stops[0] === home && r.stops[1] === marketId) {
      route = r;
      break;
    }
  }
  if (!route) {
    const created = createTradeRoute(world, owner, [home, marketId]);
    if (typeof created === 'string') return created;
    route = created;
  }
  return assignCaravanToRoute(world, caravanId, route.id);
}
