// In-process trade-caravan test (no server needed): routes validate (need an
// own market; own-market routes need distance; no trading at war), a caravan
// shuttles home->target->home and deposits gold on returning home, and a
// foreign route pays exactly +50% over an own route of the same length.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit, spawnBuilding } from '../dist/server/sim/spawn.js';
import { tradeSystem, assignTradeRoute } from '../dist/server/sim/systems/trade.js';
import { dispatch } from '../dist/server/net/dispatch.js';
import { TILE } from '../dist/shared/constants.js';
import { CARAVAN_FOREIGN_BONUS, CARAVAN_MIN_OWN_TRADE_TILES, caravanGold } from '../dist/shared/stats.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

const world = new World();
for (const pid of [1, 2]) {
  world.players.set(pid, { id: pid, name: `p${pid}`, color: pid, spawnTileX: 10, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
}
const session = (pid) => ({ playerId: pid, rejects: [], reject(r) { this.rejects.push(r); }, send() {} });
const ctx = { world, db: null, loop: null, online: new Map() };

// P1: home market at (10,10) + a near own market (too close) + a far own market.
// P2: a market at the same distance as P1's far one (for the bonus comparison).
const home = spawnBuilding(world, 'market', 1, 10, 10, false);
const nearOwn = spawnBuilding(world, 'market', 1, 20, 10, false); // 10 tiles: too close
const D = 100; // route length in tiles
const farOwn = spawnBuilding(world, 'market', 1, 10 + D, 10, false);
const foreign = spawnBuilding(world, 'market', 2, 10, 10 + D, false);

const cv = spawnUnit(world, 'caravan', 1, 11 * TILE, 12 * TILE);
check('caravan has no combat component (defenceless)', !world.combat.has(cv));

// --- validation ---------------------------------------------------------------
check('own market too close is rejected', assignTradeRoute(world, cv, nearOwn) !== null,
  `min=${CARAVAN_MIN_OWN_TRADE_TILES}`);
check('own market far away is accepted', assignTradeRoute(world, cv, farOwn) === null);
check('foreign market is accepted', assignTradeRoute(world, cv, foreign) === null);

// At war: no trading.
world.setRelation(1, 2, 'war');
check('cannot route to an at-war market', assignTradeRoute(world, cv, foreign) !== null);
world.setRelation(1, 2, 'neutral');

// --- shuttle + payout ----------------------------------------------------------
// Foreign route: teleport the caravan to each end and let tradeSystem see the
// arrivals (movement isn't run here — we only test the trade logic).
check('route re-assigned after peace', assignTradeRoute(world, cv, foreign) === null);
const gold0 = world.players.get(1).stockpile.gold;
const fTf = world.transform.get(foreign);
const hTf = world.transform.get(home);
world.transform.get(cv).x = fTf.x; world.transform.get(cv).y = fTf.y;
tradeSystem(world, 0.1); // arrive at target -> homebound
check('caravan turns around at the target', world.trader.get(cv).state === 'homebound');
check('no gold paid at the target end', world.players.get(1).stockpile.gold === gold0);
world.transform.get(cv).x = hTf.x; world.transform.get(cv).y = hTf.y;
tradeSystem(world, 0.1); // arrive home -> deposit + outbound
const earnedForeign = world.players.get(1).stockpile.gold - gold0;
check('gold deposited on arriving home', earnedForeign > 0, `+${earnedForeign}`);
check('caravan heads out again (loops)', world.trader.get(cv).state === 'outbound');

// Own-market route of the same length: earns exactly 1/1.5 of the foreign run.
check('own route assigned', assignTradeRoute(world, cv, farOwn) === null);
const gold1 = world.players.get(1).stockpile.gold;
const oTf = world.transform.get(farOwn);
world.transform.get(cv).x = oTf.x; world.transform.get(cv).y = oTf.y;
tradeSystem(world, 0.1);
world.transform.get(cv).x = hTf.x; world.transform.get(cv).y = hTf.y;
tradeSystem(world, 0.1);
const earnedOwn = world.players.get(1).stockpile.gold - gold1;
check('foreign trade pays +50% over own trade', earnedForeign === Math.round(earnedOwn * CARAVAN_FOREIGN_BONUS),
  `foreign=${earnedForeign} own=${earnedOwn}`);
check('payout matches caravanGold()', earnedOwn === caravanGold(D, false) && earnedForeign === caravanGold(D, true));

// --- war cuts a live route -------------------------------------------------------
check('foreign route re-assigned', assignTradeRoute(world, cv, foreign) === null);
world.setRelation(1, 2, 'war');
tradeSystem(world, 0.1);
check('declaring war cancels the trade route', world.trader.get(cv).state === 'idle');
world.setRelation(1, 2, 'neutral');

// --- dispatch validation -----------------------------------------------------------
const s = session(1);
dispatch(ctx, s, { t: 'trade', caravanIds: [cv], marketId: home + 99999 });
check('trade intent rejects a non-market target', s.rejects.length === 1);

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
