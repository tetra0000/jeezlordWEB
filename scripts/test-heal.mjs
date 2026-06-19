// In-process test of the healing system (no server needed): units regen in
// their own territory at HEAL_RATE_PER_S, units outside don't, buildings don't,
// and healing clamps at maxHp. Runs against the built dist/ modules.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit, spawnBuilding } from '../dist/server/sim/spawn.js';
import { healSystem } from '../dist/server/sim/systems/heal.js';
import { TILE } from '../dist/shared/constants.js';
import { HEAL_RATE_PER_S } from '../dist/shared/stats.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

const world = new World();
world.players.set(1, { id: 1, name: 't', color: 1, spawnTileX: 50, spawnTileY: 50, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });

// Operational Town Center at (50,50) -> projects territory (radius TERRITORY_MIN_TILES).
const tcId = spawnBuilding(world, 'townCenter', 1, 50, 50, false);

// A unit inside territory, and one far outside it.
const inside = spawnUnit(world, 'infantry', 1, 50 * TILE, 53 * TILE);
const outside = spawnUnit(world, 'infantry', 1, 200 * TILE, 200 * TILE);

world.health.get(inside).hp = 10;   // maxHp 45
world.health.get(outside).hp = 10;
world.health.get(tcId).hp = 500;    // maxHp 1000

check('heal rate is 1 hp/min', Math.abs(HEAL_RATE_PER_S - 1 / 60) < 1e-9, `=${HEAL_RATE_PER_S}`);

healSystem(world, 60); // 60 sim-seconds = +1 hp
check('unit in territory healed ~1hp/min', Math.abs(world.health.get(inside).hp - 11) < 1e-6, `hp=${world.health.get(inside).hp}`);
check('unit outside territory did NOT heal', world.health.get(outside).hp === 10, `hp=${world.health.get(outside).hp}`);
check('building did NOT heal', world.health.get(tcId).hp === 500, `hp=${world.health.get(tcId).hp}`);

// Heal a long time -> clamps at maxHp, never overshoots.
for (let i = 0; i < 120; i++) healSystem(world, 60); // +120 hp worth, capped at 45
check('healing clamps at maxHp', world.health.get(inside).hp === 45, `hp=${world.health.get(inside).hp}`);

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
