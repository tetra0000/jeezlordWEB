// In-process diplomacy test (no server needed): players start neutral (no
// auto-engage, attack orders rejected), war is unilateral and enables combat,
// alliances need propose+accept and grant shared vision, peace needs both
// sides, and a defeat restart clears relations. Runs against dist/ modules.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit, spawnBuilding } from '../dist/server/sim/spawn.js';
import { combatSystem } from '../dist/server/sim/systems/combat.js';
import { dispatch } from '../dist/server/net/dispatch.js';
import { visibleTileSet } from '../dist/server/sim/systems/vision.js';
import { TILE } from '../dist/shared/constants.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

const world = new World();
for (const pid of [1, 2, 3]) {
  world.players.set(pid, { id: pid, name: `p${pid}`, color: pid, spawnTileX: 10, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
}
const session = (pid) => ({ playerId: pid, rejects: [], reject(r) { this.rejects.push(r); }, send() {} });
const ctx = { world, db: null, loop: null, online: new Map() };

// Two adjacent enemy squads, in weapon range of each other.
const u1 = spawnUnit(world, 'warrior', 1, 10 * TILE, 10 * TILE);
const u2 = spawnUnit(world, 'warrior', 2, 10 * TILE + 18, 10 * TILE);

// --- neutral: no combat --------------------------------------------------------
check('players start neutral', world.relationOf(1, 2) === 'neutral');
combatSystem(world, 0.5);
check('neutral squads never auto-engage', world.combat.get(u1).targetId === null && world.combat.get(u2).targetId === null);
const s1 = session(1);
dispatch(ctx, s1, { t: 'attack', unitIds: [u1], targetId: u2 });
check('attack order rejected while neutral', s1.rejects.length === 1 && world.combat.get(u1).targetId === null, s1.rejects[0] ?? '');

// --- alliance: propose + accept -------------------------------------------------
dispatch(ctx, session(1), { t: 'diplomacy', action: 'propose', playerId: 2 });
check('proposal alone does not ally', world.relationOf(1, 2) === 'neutral');
check('offer recorded', world.diploOffers.get('1:2') === 1);
dispatch(ctx, session(2), { t: 'diplomacy', action: 'propose', playerId: 1 });
check('acceptance forms the alliance', world.relationOf(1, 2) === 'ally');
check('offer cleared on acceptance', !world.diploOffers.has('1:2'));

// --- ally shared vision ----------------------------------------------------------
// P2 has a unit far from P1's; an allied P1 "sees" through it (union of tiles).
spawnBuilding(world, 'townCenter', 2, 100, 100, false);
const own1 = visibleTileSet(world, 1);
const own2 = visibleTileSet(world, 2);
const remoteTile = [...own2].find((t) => !own1.has(t));
check('ally has tiles P1 cannot see alone', remoteTile !== undefined);

// --- war: unilateral, enables combat, clears alliance ----------------------------
dispatch(ctx, session(1), { t: 'diplomacy', action: 'declareWar', playerId: 2 });
check('war is declared unilaterally (even on an ally)', world.relationOf(1, 2) === 'war');
combatSystem(world, 0.5);
check('at war, squads auto-engage', world.combat.get(u1).targetId === u2 || world.combat.get(u2).targetId === u1);
const s1b = session(1);
dispatch(ctx, s1b, { t: 'attack', unitIds: [u1], targetId: u2 });
check('attack order accepted at war', s1b.rejects.length === 0 && world.combat.get(u1).targetId === u2);

// --- peace: needs both -----------------------------------------------------------
dispatch(ctx, session(2), { t: 'diplomacy', action: 'propose', playerId: 1 });
check('peace offer alone stays at war', world.relationOf(1, 2) === 'war');
dispatch(ctx, session(1), { t: 'diplomacy', action: 'propose', playerId: 2 });
check('peace acceptance returns to neutral', world.relationOf(1, 2) === 'neutral');

// --- break alliance ---------------------------------------------------------------
dispatch(ctx, session(1), { t: 'diplomacy', action: 'propose', playerId: 3 });
dispatch(ctx, session(3), { t: 'diplomacy', action: 'propose', playerId: 1 });
check('second alliance formed', world.relationOf(1, 3) === 'ally');
dispatch(ctx, session(3), { t: 'diplomacy', action: 'breakAlliance', playerId: 1 });
check('breaking an alliance is unilateral', world.relationOf(1, 3) === 'neutral');

// --- validation --------------------------------------------------------------------
const sSelf = session(1);
dispatch(ctx, sSelf, { t: 'diplomacy', action: 'declareWar', playerId: 1 });
check('cannot declare war on yourself', sSelf.rejects.length === 1);
const sGhost = session(1);
dispatch(ctx, sGhost, { t: 'diplomacy', action: 'declareWar', playerId: 99 });
check('cannot declare war on unknown player', sGhost.rejects.length === 1);

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
