// In-process test of the squad military model (no server needed): squads lose
// men (and damage output) as their hp pool drops, spearmen counter cavalry,
// archer squads volley one arrow per surviving man, and the roster trains at
// the right buildings. Runs against the built dist/ modules.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit } from '../dist/server/sim/spawn.js';
import { combatSystem } from '../dist/server/sim/systems/combat.js';
import { TILE } from '../dist/shared/constants.js';
import {
  BUILDING_STATS,
  UNIT_STATS,
  damageMultiplier,
  maxHpOf,
  squadMen,
} from '../dist/shared/stats.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

// --- static roster checks ----------------------------------------------------
const ROSTER = ['militia', 'warrior', 'spearman', 'archer', 'longbowman', 'scoutCavalry', 'knight', 'horseArcher'];
check('all 8 squad kinds exist', ROSTER.every((k) => UNIT_STATS[k]), ROSTER.filter((k) => !UNIT_STATS[k]).join(','));
check('barracks trains militia/warrior/spearman', ['militia', 'warrior', 'spearman'].every((k) => BUILDING_STATS.barracks.trains.includes(k)));
check('range trains archer/longbowman', ['archer', 'longbowman'].every((k) => BUILDING_STATS.range.trains.includes(k)));
check('stable trains scoutCavalry/knight/horseArcher', ['scoutCavalry', 'knight', 'horseArcher'].every((k) => BUILDING_STATS.stable.trains.includes(k)));
check('longbowman outranges archer', UNIT_STATS.longbowman.range > UNIT_STATS.archer.range);

// --- squad men / damage scaling ----------------------------------------------
const wMax = maxHpOf('warrior');
check('full warrior squad has 4 men', squadMen('warrior', wMax, wMax) === 4);
check('half-hp warrior squad has 2 men', squadMen('warrior', wMax / 2, wMax) === 2);
check('near-dead squad keeps 1 man', squadMen('warrior', 1, wMax) === 1);
check('full squad deals full damage', damageMultiplier('warrior', wMax, wMax, 'militia') === 1);
check('half squad deals half damage', damageMultiplier('warrior', wMax / 2, wMax, 'militia') === 0.5);
check('spearman deals 5x vs knight', damageMultiplier('spearman', maxHpOf('spearman'), maxHpOf('spearman'), 'knight') === 5);
check('spearman deals 1x vs warrior', damageMultiplier('spearman', maxHpOf('spearman'), maxHpOf('spearman'), 'warrior') === 1);

// --- live combat: spearmen beat knights of similar cost -----------------------
{
  const world = new World();
  world.players.set(1, { id: 1, name: 'a', color: 1, spawnTileX: 10, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
  world.players.set(2, { id: 2, name: 'b', color: 2, spawnTileX: 12, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
  world.setRelation(1, 2, 'war'); // diplomacy: combat only happens at war
  // Spawn inside melee range (the bare combatSystem loop runs no movement).
  const spear = spawnUnit(world, 'spearman', 1, 10 * TILE, 10 * TILE);
  const knight = spawnUnit(world, 'knight', 2, 10 * TILE + 18, 10 * TILE);
  let guard = 20000;
  while (world.has(spear) && world.has(knight) && guard-- > 0) combatSystem(world, 0.5);
  check('spearmen kill knights in a straight fight', world.has(spear) && !world.has(knight),
    `spear=${world.has(spear)} knight=${world.has(knight)}`);
}

// --- archer volley: one arrow per surviving man --------------------------------
{
  const world = new World();
  world.players.set(1, { id: 1, name: 'a', color: 1, spawnTileX: 10, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
  world.players.set(2, { id: 2, name: 'b', color: 2, spawnTileX: 12, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
  world.setRelation(1, 2, 'war'); // diplomacy: combat only happens at war
  const archer = spawnUnit(world, 'archer', 1, 10 * TILE, 10 * TILE);
  const target = spawnUnit(world, 'warrior', 2, 12 * TILE, 10 * TILE);
  world.health.get(target).hp = 100000; // keep it alive; we only care about shots
  world.health.get(target).maxHp = 100000;
  combatSystem(world, 0.01); // acquire + first volley (cooldown starts at 0)
  const arrows = world.shots.filter((s) => s.kind === 'arrow' && s.from === archer).length;
  check('full archer squad volleys 4 arrows', arrows === 4, `arrows=${arrows}`);
  // Cut the squad to half strength -> 2 arrows next volley.
  world.health.get(archer).hp = maxHpOf('archer') / 2;
  const cs = world.combat.get(archer);
  cs.cooldownLeft = 0;
  combatSystem(world, 0.01);
  const arrows2 = world.shots.filter((s) => s.kind === 'arrow' && s.from === archer).length;
  check('half archer squad volleys 2 arrows', arrows2 === 2, `arrows=${arrows2}`);
}

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
