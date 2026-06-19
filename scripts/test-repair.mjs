// In-process test of builder repair (no server): an idle builder is tasked to a
// damaged completed building in territory, repairs it at the expected rate, keeps
// the job while it's damaged, clamps at maxHp, and is released once full.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit, spawnBuilding } from '../dist/server/sim/spawn.js';
import { constructionSystem } from '../dist/server/sim/systems/construction.js';
import { jobsSystem } from '../dist/server/sim/systems/jobs.js';
import { gatherSystem } from '../dist/server/sim/systems/gather.js';
import { TILE } from '../dist/shared/constants.js';
import { REPAIR_TIME_S } from '../dist/shared/stats.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

const world = new World();
world.players.set(1, { id: 1, name: 't', color: 1, spawnTileX: 50, spawnTileY: 50, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
spawnBuilding(world, 'townCenter', 1, 50, 50, false); // operational -> projects territory
const wall = spawnBuilding(world, 'wall', 1, 52, 52, false); // operational, inside territory
const wallHp = world.health.get(wall);
wallHp.hp = 100; // maxHp 900

// A builder villager standing right next to the wall.
const v = spawnUnit(world, 'villager', 1, 51.5 * TILE, 52.5 * TILE);

// 1) Jobs tasks the idle builder to repair the damaged wall.
jobsSystem(world, 1);
const g = world.gatherer.get(v);
check('builder tasked to repair the wall', g.state === 'building' && g.buildTargetId === wall, `state=${g.state} target=${g.buildTargetId} wall=${wall}`);

// 2) With a builder present, the wall regains HP at maxHp/REPAIR_TIME_S per second.
const before = wallHp.hp;
constructionSystem(world, 60);
const expected = before + (wallHp.maxHp / REPAIR_TIME_S) * 60; // buildPower(1) = 1
check('wall repaired at expected rate', Math.abs(wallHp.hp - expected) < 1e-6, `${before} -> ${wallHp.hp.toFixed(1)} (expected ${expected.toFixed(1)})`);

// 2b) The builder keeps repairing (does not go idle just because it's operational).
gatherSystem(world, 1);
check('builder keeps repairing while damaged', world.gatherer.get(v).state === 'building', `state=${world.gatherer.get(v).state}`);

// 3) Repair clamps at maxHp.
for (let i = 0; i < 400; i++) constructionSystem(world, 60);
check('repair clamps at maxHp', wallHp.hp === wallHp.maxHp, `hp=${wallHp.hp}/${wallHp.maxHp}`);

// 4) Once full, jobs releases the builder (idle — no foundation/repair left).
jobsSystem(world, 1);
const g2 = world.gatherer.get(v);
check('builder freed after full repair', g2.state === 'idle', `target=${g2.buildTargetId} state=${g2.state}`);

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
