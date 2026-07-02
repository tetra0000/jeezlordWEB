// In-process gates + roads + line-order test (no server needed):
//  - gate passability per mode (locked / trade / open) and per mover
//    (owner, ally, enemy, foreign caravan), incl. pathing through a wall line;
//  - the gate intent validates ownership + mode;
//  - caravans on a route wear the ground into road (events + wear map);
//  - a line move order spreads units along the dragged segment.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit, spawnBuilding } from '../dist/server/sim/spawn.js';
import { findPath } from '../dist/server/sim/systems/pathfinding.js';
import { tradeSystem, assignTradeRoute } from '../dist/server/sim/systems/trade.js';
import { dispatch } from '../dist/server/net/dispatch.js';
import { TILE } from '../dist/shared/constants.js';
import { ROAD_LEVELS } from '../dist/shared/stats.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

const world = new World();
for (const pid of [1, 2, 3]) {
  world.players.set(pid, { id: pid, name: `p${pid}`, color: pid, spawnTileX: 10, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
}
const session = (pid) => ({ playerId: pid, rejects: [], reject(r) { this.rejects.push(r); }, send() {} });
const ctx = { world, db: null, loop: null, online: new Map() };

// --- gate passability -----------------------------------------------------------
// A wall line across x=10..20 at y=10 with a gate at (15,10). Units path from
// (15,7) to (15,13): the only opening is the gate.
for (let x = 10; x <= 20; x++) {
  if (x === 15) continue;
  spawnBuilding(world, 'wall', 1, x, 10, false);
}
const gate = spawnBuilding(world, 'gate', 1, 15, 10, false);
check('gate tile is registered', world.gateTiles.get(world.tileIndex(15, 10)) === gate);
check('gate tile is occupied ground for building', !world.canBuildTile(15, 10));

const own = spawnUnit(world, 'militia', 1, 15.5 * TILE, 7.5 * TILE);
const ally = spawnUnit(world, 'militia', 2, 15.5 * TILE, 7.5 * TILE);
const enemy = spawnUnit(world, 'militia', 3, 15.5 * TILE, 7.5 * TILE);
const foreignCaravan = spawnUnit(world, 'caravan', 2, 15.5 * TILE, 7.5 * TILE);
world.setRelation(1, 2, 'ally');
world.setRelation(1, 3, 'war');

// The gate tile's per-mover passability (the primitive pathfinding consults).
const passes = (moverId) => !world.isBlockedTileFor(15, 10, moverId);

// Default mode is 'trade': owner + ally + caravan pass, enemy does not.
check('trade mode: owner passes', passes(own));
check('trade mode: ally passes', passes(ally));
check('trade mode: allied caravan passes', passes(foreignCaravan));
check('trade mode: enemy blocked', !passes(enemy));

world.gateMode.set(gate, 'locked');
check('locked mode: even the owner is blocked', !passes(own));
check('locked mode: caravan blocked', !passes(foreignCaravan));

world.gateMode.set(gate, 'open');
check('open mode: enemy passes', passes(enemy));

// Neutral (non-ally, non-war) caravan passes in trade mode; a WAR caravan not.
world.gateMode.set(gate, 'trade');
world.setRelation(1, 2, 'neutral');
check('trade mode: neutral caravan passes', passes(foreignCaravan));
check('trade mode: neutral non-caravan blocked', !passes(ally));
world.setRelation(1, 2, 'war');
check('trade mode: at-war caravan blocked', !passes(foreignCaravan));
world.setRelation(1, 2, 'neutral');
world.setRelation(1, 3, 'neutral');

// Pathfinding integration: a mover the gate admits paths straight through the
// wall (~6 tiles); a shut-out mover has to walk around the wall's end (much
// longer). Measure total path length from just above to just below the gate.
const pathLen = (moverId) => {
  const r = findPath(world, 15.5 * TILE, 7.5 * TILE, 15.5 * TILE, 13.5 * TILE, moverId);
  if (!r || r.path.length === 0) return Infinity;
  let len = 0, px = 15.5 * TILE, py = 7.5 * TILE;
  for (const p of r.path) { len += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y; }
  return len / TILE; // tiles
};
check('A* routes the owner straight through the gate', pathLen(own) < 8, `len=${pathLen(own).toFixed(1)}`);
world.gateMode.set(gate, 'locked');
check('A* detours a locked-out mover around the wall', pathLen(own) > 12, `len=${pathLen(own).toFixed(1)}`);
world.gateMode.set(gate, 'trade');

// --- gate intent -----------------------------------------------------------------
const s2 = session(2);
dispatch(ctx, s2, { t: 'gate', buildingId: gate, mode: 'open' });
check('gate intent ignores a non-owner', (world.gateMode.get(gate) ?? 'trade') === 'trade');
const s1 = session(1);
dispatch(ctx, s1, { t: 'gate', buildingId: gate, mode: 'bogus' });
check('gate intent rejects a bogus mode', (world.gateMode.get(gate) ?? 'trade') === 'trade');
dispatch(ctx, s1, { t: 'gate', buildingId: gate, mode: 'locked' });
check('owner sets the gate mode', world.gateMode.get(gate) === 'locked');
check('gate mode is on the wire view', world.view(gate).gate === 'locked');

// --- caravan road wear -------------------------------------------------------------
const mkA = spawnBuilding(world, 'market', 1, 100, 100, false);
const mkB = spawnBuilding(world, 'market', 2, 200, 100, false);
const cv = spawnUnit(world, 'caravan', 1, 101 * TILE, 102 * TILE);
check('route assigned', assignTradeRoute(world, cv, mkB) === null);
const cvTile = world.tileIndex(101, 102);
for (let i = 0; i < 50; i++) tradeSystem(world, 1); // 50 sim-seconds standing on one tile
const wear = world.roadWear.get(cvTile) ?? 0;
check('working caravan wears its tile into road', wear > 0.3, `wear=${wear.toFixed(2)}`);
check('worn tile flagged for the DB flush', world.dirtyRoads.has(cvTile));
world.roadEvents.length = 0;
tradeSystem(world, 3600); // enough to max the tile in one tick
check('wear caps at 1', (world.roadWear.get(cvTile) ?? 0) <= 1);
check('capping emits the top road level', world.roadEvents.some(([t, l]) => t === cvTile && l === ROAD_LEVELS));
const idleCv = spawnUnit(world, 'caravan', 1, 110 * TILE, 110 * TILE);
tradeSystem(world, 100);
check('idle caravan wears nothing', !world.roadWear.has(world.tileIndex(110, 110)));
void idleCv;

// --- line move orders ---------------------------------------------------------------
const squads = [];
for (let i = 0; i < 5; i++) squads.push(spawnUnit(world, 'militia', 1, (300 + i) * TILE, 300 * TILE));
dispatch(ctx, session(1), {
  t: 'move', unitIds: squads,
  x: 320 * TILE, y: 300 * TILE,
  lineTo: { x: 320 * TILE, y: 320 * TILE },
});
const targets = squads.map((id) => world.movement.get(id).target);
check('line order gives every unit a target', targets.every((t) => t != null));
const ys = targets.map((t) => Math.round(t.y / TILE)).sort((a, b) => a - b);
check('targets spread along the dragged segment', ys[0] === 300 && ys[4] === 320, `ys=${ys}`);
const xs = new Set(targets.map((t) => Math.round(t.x / TILE)));
check('targets sit on the line (same x)', xs.size === 1 && xs.has(320));
const uniqueY = new Set(ys);
check('no two units share a slot', uniqueY.size === 5);

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
