// In-process trade-route test (no server needed): route creation validates
// (2..8 stops, no self-trading, no war partners, discovery required), caravans
// cycle the stops and are paid on FOREIGN arrivals only, war dissolves routes,
// quick-routes reuse existing ones, and caravan pathfinding prefers worn roads.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit, spawnBuilding } from '../dist/server/sim/spawn.js';
import {
  tradeSystem, createTradeRoute, deleteTradeRoute, assignCaravanToRoute, quickTradeRoute,
} from '../dist/server/sim/systems/trade.js';
import { findPath } from '../dist/server/sim/systems/pathfinding.js';
import { dispatch } from '../dist/server/net/dispatch.js';
import { TILE } from '../dist/shared/constants.js';
import { TRADE_ROUTE_MAX_STOPS, caravanGold } from '../dist/shared/stats.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

const world = new World();
for (const pid of [1, 2]) {
  world.players.set(pid, { id: pid, name: `p${pid}`, color: pid, spawnTileX: 10, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
}
const session = (pid) => ({ playerId: pid, rejects: [], reject(r) { this.rejects.push(r); }, send() {} });
const ctx = { world, db: null, loop: null, online: new Map() };

// P1: two own markets. P2: two foreign markets. All "discovered" by P1 (the
// snapshot normally records that as their vision touches them).
const D = 100; // leg length in tiles
const home = spawnBuilding(world, 'market', 1, 10, 10, false);
const ownFar = spawnBuilding(world, 'market', 1, 10 + D, 10, false);
const foreign = spawnBuilding(world, 'market', 2, 10, 10 + D, false);
const foreign2 = spawnBuilding(world, 'market', 2, 10 + D, 10 + D, false);
world.discoveredMarkets.set(1, new Set([foreign]));

const cv = spawnUnit(world, 'caravan', 1, 11 * TILE, 12 * TILE);
check('caravan has no combat component (defenceless)', !world.combat.has(cv));

// --- route creation validation --------------------------------------------------
check('route needs at least 2 stops', typeof createTradeRoute(world, 1, [home]) === 'string');
check('route caps at TRADE_ROUTE_MAX_STOPS', typeof createTradeRoute(world, 1, Array(TRADE_ROUTE_MAX_STOPS + 1).fill(home)) === 'string',
  `max=${TRADE_ROUTE_MAX_STOPS}`);
check('all-own route is rejected (no trading with yourself)',
  typeof createTradeRoute(world, 1, [home, ownFar]) === 'string');
check('undiscovered foreign market is rejected',
  typeof createTradeRoute(world, 1, [home, foreign2]) === 'string');
world.setRelation(1, 2, 'war');
check('at-war partner is rejected', typeof createTradeRoute(world, 1, [home, foreign]) === 'string');
world.setRelation(1, 2, 'neutral');
const route = createTradeRoute(world, 1, [home, foreign]);
check('valid 2-stop foreign route is created', typeof route === 'object' && route.stops.length === 2);

// --- assignment + circuit payouts ------------------------------------------------
check('caravan assigned to the route', assignCaravanToRoute(world, cv, route.id) === null);
const tr = world.trader.get(cv);
check('caravan joins at the nearest stop (home)', route.stops[tr.stopIndex] === home);

const gold0 = world.players.get(1).stockpile.gold;
tradeSystem(world, 0.1); // already standing at home -> arrive, no pay (own stop)
check('arriving at an OWN stop pays nothing', world.players.get(1).stockpile.gold === gold0);
check('caravan heads for the next stop', route.stops[world.trader.get(cv).stopIndex] === foreign);

const fTf = world.transform.get(foreign);
world.transform.get(cv).x = fTf.x; world.transform.get(cv).y = fTf.y;
tradeSystem(world, 0.1); // arrive at the foreign stop -> paid for the leg
const earned = world.players.get(1).stockpile.gold - gold0;
check('arriving at a FOREIGN stop pays for the leg', earned === caravanGold(D), `earned=${earned} expected=${caravanGold(D)}`);
check('caravan loops back toward home', route.stops[world.trader.get(cv).stopIndex] === home);
const hTf = world.transform.get(home);
world.transform.get(cv).x = hTf.x; world.transform.get(cv).y = hTf.y;
tradeSystem(world, 0.1); // home again: own stop, no pay
check('own stop still pays nothing on the loop', world.players.get(1).stockpile.gold - gold0 === earned);
check('circuit gold estimate matches one loop', world.routeCircuitGold(route) === earned);

// --- war dissolves the route -------------------------------------------------------
world.setRelation(1, 2, 'war');
tradeSystem(world, 0.1);
check('war drops the foreign stop and dissolves the route', !world.tradeRoutes.has(route.id));
check('its caravan goes idle', world.trader.get(cv).routeId === null);
world.setRelation(1, 2, 'neutral');

// --- quick routes (right-click a market) --------------------------------------------
check('quick route to an OWN market is rejected', quickTradeRoute(world, cv, ownFar) !== null);
check('quick route to a foreign market works', quickTradeRoute(world, cv, foreign) === null);
const routeCount = world.tradeRoutes.size;
const cv2 = spawnUnit(world, 'caravan', 1, 11 * TILE, 12 * TILE);
check('a second quick route to the same market reuses it', quickTradeRoute(world, cv2, foreign) === null && world.tradeRoutes.size === routeCount);

// --- delete -----------------------------------------------------------------------
const quick = [...world.tradeRoutes.values()].find((r) => r.owner === 1);
check('stranger cannot delete the route', deleteTradeRoute(world, 2, quick.id) !== null);
check('owner deletes the route', deleteTradeRoute(world, 1, quick.id) === null);
check('deleted route idles its caravans', world.trader.get(cv).routeId === null && world.trader.get(cv2).routeId === null);

// --- dispatch validation --------------------------------------------------------------
const s = session(1);
dispatch(ctx, s, { t: 'trade', caravanIds: [cv], marketId: home + 99999 });
check('trade intent rejects a non-market target', s.rejects.length === 1);
dispatch(ctx, s, { t: 'tradeRoute', action: 'create', stops: [home, foreign], caravanIds: [cv] });
check('tradeRoute create assigns the sent caravans', world.trader.get(cv).routeId != null);
const rid = world.trader.get(cv).routeId;
dispatch(ctx, s, { t: 'tradeRoute', action: 'assign', caravanIds: [cv] }); // no routeId = unassign
check('tradeRoute assign without a route unassigns', world.trader.get(cv).routeId === null);
dispatch(ctx, session(2), { t: 'tradeRoute', action: 'delete', routeId: rid });
check('stranger cannot delete via dispatch', world.tradeRoutes.has(rid));
dispatch(ctx, s, { t: 'tradeRoute', action: 'delete', routeId: rid });
check('owner deletes via dispatch', !world.tradeRoutes.has(rid));

// --- caravans prefer worn roads -------------------------------------------------------
// Direct diagonal (50,50)->(70,70) vs a fully-worn L-shaped road via (70,50).
// Road cost: 40 orthogonal steps * 0.55 < 20 diagonal steps, so a caravan takes
// the road; a militia (no road preference) cuts the diagonal.
for (let x = 50; x <= 70; x++) world.roadWear.set(world.tileIndex(x, 50), 1);
for (let y = 50; y <= 70; y++) world.roadWear.set(world.tileIndex(70, y), 1);
const roadCv = spawnUnit(world, 'caravan', 1, 50.5 * TILE, 50.5 * TILE);
const roadMil = spawnUnit(world, 'militia', 1, 50.5 * TILE, 50.5 * TILE);
const viaCorner = (moverId) => {
  const r = findPath(world, 50.5 * TILE, 50.5 * TILE, 70.5 * TILE, 70.5 * TILE, moverId);
  if (!r) return false;
  return r.path.some((p) => Math.hypot(p.x / TILE - 70.5, p.y / TILE - 50.5) < 3);
};
check('caravan pathing follows the worn road (via the corner)', viaCorner(roadCv));
check('non-caravan still cuts the diagonal', !viaCorner(roadMil));

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
