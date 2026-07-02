// In-process test of squad stances + movement formations (no server needed).
// Stances: noAttack never auto-acquires, standGround holds position and only
// engages at weapon range, defensive keeps a leash, aggressive chases far.
// Formations: a group move spreads destinations into line/box/loose shapes.
// Runs against the built dist/ modules, driving dispatch with a stub session.
import { World } from '../dist/server/sim/world.js';
import { spawnUnit } from '../dist/server/sim/spawn.js';
import { combatSystem } from '../dist/server/sim/systems/combat.js';
import { dispatch } from '../dist/server/net/dispatch.js';
import { TILE } from '../dist/shared/constants.js';

const results = [];
const check = (n, c, x = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'}: ${n} ${x}`); };

function makeWorld() {
  const world = new World();
  for (const pid of [1, 2]) {
    world.players.set(pid, { id: pid, name: `p${pid}`, color: pid, spawnTileX: 10, spawnTileY: 10, stockpile: { wood: 0, gold: 0, food: 0, stone: 0 }, jobDesired: {} });
  }
  return world;
}
const session = (pid) => ({ playerId: pid, rejects: [], reject(r) { this.rejects.push(r); }, send() {} });
const ctx = (world) => ({ world, db: null, loop: null, online: new Map() });

// --- stances -----------------------------------------------------------------
{
  const world = makeWorld();
  const c = ctx(world);
  // An enemy warrior stands ~3 tiles away: inside sight, outside weapon range.
  const mine = spawnUnit(world, 'warrior', 1, 10 * TILE, 10 * TILE);
  spawnUnit(world, 'warrior', 2, 13 * TILE, 10 * TILE);

  dispatch(c, session(1), { t: 'stance', unitIds: [mine], stance: 'noAttack' });
  check('stance intent applied', world.combat.get(mine).stance === 'noAttack');
  combatSystem(world, 0.1);
  check('noAttack never auto-acquires', world.combat.get(mine).targetId === null);

  dispatch(c, session(1), { t: 'stance', unitIds: [mine], stance: 'standGround' });
  combatSystem(world, 0.1);
  check('standGround ignores foes beyond weapon range', world.combat.get(mine).targetId === null);
  check('standGround never chases', world.movement.get(mine).target === null);

  dispatch(c, session(1), { t: 'stance', unitIds: [mine], stance: 'defensive' });
  combatSystem(world, 0.1);
  check('defensive auto-acquires in sight', world.combat.get(mine).targetId !== null);
  check('defensive chases the target', world.movement.get(mine).target !== null);

  // A player can't set stances on someone else's squads.
  dispatch(c, session(2), { t: 'stance', unitIds: [mine], stance: 'aggressive' });
  check('cannot set stance on enemy squads', world.combat.get(mine).stance === 'defensive');
}

// --- aggressive leash is longer than defensive --------------------------------
{
  const world = makeWorld();
  const c = ctx(world);
  const mine = spawnUnit(world, 'warrior', 1, 10 * TILE, 10 * TILE);
  const far = spawnUnit(world, 'warrior', 2, 10 * TILE, 10 * TILE + 24); // in range
  combatSystem(world, 0.1); // acquire (defensive)
  check('acquired adjacent foe', world.combat.get(mine).targetId === far);
  // Teleport the foe out past the defensive leash but inside the aggressive one.
  const sight = Math.max(20 + TILE, 5 * TILE); // warrior: range+TILE vs vision*TILE
  world.transform.get(far).x = 10 * TILE + sight * 2; // 2x sight: > 1.5x, < 3x
  combatSystem(world, 0.1);
  check('defensive leash drops a fleeing target', world.combat.get(mine).targetId === null);
  dispatch(c, session(1), { t: 'stance', unitIds: [mine], stance: 'aggressive' });
  // Re-place the foe adjacent so it re-acquires, then flee to 2x sight again.
  world.transform.get(far).x = 10 * TILE + 24;
  combatSystem(world, 0.1);
  world.transform.get(far).x = 10 * TILE + sight * 2;
  combatSystem(world, 0.1);
  check('aggressive keeps chasing at 2x sight', world.combat.get(mine).targetId === far);
}

// --- formations ---------------------------------------------------------------
{
  const world = makeWorld();
  const c = ctx(world);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(spawnUnit(world, 'militia', 1, (10 + i) * TILE, 10 * TILE));
  const tx = 30 * TILE, ty = 10 * TILE;

  const targetsOf = () => ids.map((id) => world.movement.get(id).target);

  dispatch(c, session(1), { t: 'move', unitIds: ids, x: tx, y: ty }); // no formation
  check('plain move sends everyone to the same point', targetsOf().every((t) => t.x === tx && t.y === ty));

  dispatch(c, session(1), { t: 'move', unitIds: ids, x: tx, y: ty, formation: 'line' });
  {
    const ts = targetsOf();
    const uniq = new Set(ts.map((t) => `${t.x.toFixed(1)},${t.y.toFixed(1)}`));
    check('line formation spreads destinations', uniq.size === 4, `${uniq.size} unique`);
    // Travel is along +x, so a line abreast spreads on the y axis.
    const ys = ts.map((t) => t.y);
    const xs = ts.map((t) => t.x);
    check('line is perpendicular to travel', Math.max(...ys) - Math.min(...ys) > TILE * 3 && Math.max(...xs) - Math.min(...xs) < 1,
      `dy=${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} dx=${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}`);
  }

  dispatch(c, session(1), { t: 'move', unitIds: ids, x: tx, y: ty, formation: 'box' });
  {
    const ts = targetsOf();
    const xs = ts.map((t) => t.x), ys = ts.map((t) => t.y);
    check('box formation forms a 2x2 block', new Set(xs.map((v) => v.toFixed(0))).size === 2 && new Set(ys.map((v) => v.toFixed(0))).size === 2);
  }

  dispatch(c, session(1), { t: 'move', unitIds: ids, x: tx, y: ty, formation: 'loose' });
  {
    const ts = targetsOf();
    const ys = ts.map((t) => t.y);
    check('loose spreads wider than box', Math.max(...ys) - Math.min(...ys) > TILE * 2);
  }
}

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
