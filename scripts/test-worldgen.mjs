// Exercises worldgen directly (no server): seed several fresh worlds and assert
// the new terrain (mud + beach), the +50% resource bump, full walkable
// connectivity, and that no bridge crosses a lake. Run: node scripts/test-worldgen.mjs
import { World } from '../dist/server/sim/world.js';
import { seedWorld } from '../dist/server/sim/worldgen.js';
import {
  MAP_TILES, TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_MOUNTAIN, TERRAIN_MUD, TERRAIN_BEACH,
  TERRAIN_LONGGRASS, TERRAIN_SWAMP, TERRAIN_ROCKS, TERRAIN_PASS,
} from '../dist/shared/constants.js';

const N = MAP_TILES;
const results = [];
const check = (n, cond, extra = '') => { results.push(cond); if (!cond) console.log(`FAIL: ${n} ${extra}`); };

// All walkable tiles reachable from one seed (4-connected, as the A* sees it).
function fullyConnected(world) {
  const walk = (i) => !world.isBlockedTile(i % N, (i - (i % N)) / N);
  let seed = -1, totalWalk = 0;
  for (let i = 0; i < N * N; i++) if (walk(i)) { totalWalk++; if (seed < 0) seed = i; }
  if (seed < 0) return true;
  const seen = new Uint8Array(N * N);
  const q = [seed]; seen[seed] = 1; let reached = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % N, y = (i - x) / N; reached++;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (seen[ni] || !walk(ni)) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  return reached === totalWalk;
}

// Bridges that sit in a LAKE: label 4-connected water+bridge bodies; a compact,
// large body is a lake (rivers are long + thin -> low bbox fill). Count bridge
// tiles belonging to a lake-like body.
function bridgesOverLakes(world) {
  const t = world.terrain;
  const isWaterish = (i) => t[i] === TERRAIN_WATER || t[i] === TERRAIN_BRIDGE;
  const comp = new Int32Array(N * N).fill(-1);
  const bodies = [];
  for (let s = 0; s < N * N; s++) {
    if (comp[s] !== -1 || !isWaterish(s)) continue;
    const label = bodies.length;
    let area = 0, minX = N, minY = N, maxX = 0, maxY = 0, bridges = 0;
    const q = [s]; comp[s] = label;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, y = (i - x) / N;
      area++; if (t[i] === TERRAIN_BRIDGE) bridges++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (comp[ni] !== -1 || !isWaterish(ni)) continue;
        comp[ni] = label; q.push(ni);
      }
    }
    const bbox = (maxX - minX + 1) * (maxY - minY + 1);
    bodies.push({ area, fill: area / bbox, bridges });
  }
  // Lake-like: large + compact. Count their bridge tiles.
  return bodies.filter((b) => b.area >= 150 && b.fill >= 0.45).reduce((n, b) => n + b.bridges, 0);
}

const SEEDS = 6;
let mudSeeds = 0, beachSeeds = 0, minNodes = Infinity, lakeBridgeTotal = 0, allConnected = true;
let swampSeeds = 0, longgrassSeeds = 0, rocksSeeds = 0, passSeeds = 0;
for (let s = 0; s < SEEDS; s++) {
  const world = new World();
  seedWorld(world);
  let mud = 0, beach = 0, swamp = 0, longgrass = 0, rocks = 0, pass = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] === TERRAIN_MUD) mud++;
    else if (world.terrain[i] === TERRAIN_BEACH) beach++;
    else if (world.terrain[i] === TERRAIN_SWAMP) swamp++;
    else if (world.terrain[i] === TERRAIN_LONGGRASS) longgrass++;
    else if (world.terrain[i] === TERRAIN_ROCKS) rocks++;
    else if (world.terrain[i] === TERRAIN_PASS) pass++;
  }
  const nodes = [...world.entityIds()].length;
  if (mud > 0) mudSeeds++;
  if (beach > 0) beachSeeds++;
  if (swamp > 0) swampSeeds++;
  if (longgrass > 0) longgrassSeeds++;
  if (rocks > 0) rocksSeeds++;
  if (pass > 0) passSeeds++;
  minNodes = Math.min(minNodes, nodes);
  if (!fullyConnected(world)) allConnected = false;
  lakeBridgeTotal += bridgesOverLakes(world);
  console.log(`seed ${s}: ${nodes} nodes, ${mud} mud, ${beach} beach, ${swamp} swamp, ${longgrass} longgrass, ${rocks} rocks, ${pass} pass`);
}

check('mud appears along rivers (every seed)', mudSeeds === SEEDS, `mudSeeds=${mudSeeds}/${SEEDS}`);
check('beaches appear at points (every seed)', beachSeeds === SEEDS, `beachSeeds=${beachSeeds}/${SEEDS}`);
check('swamps appear near water (every seed)', swampSeeds === SEEDS, `swampSeeds=${swampSeeds}/${SEEDS}`);
check('long grass appears (every seed)', longgrassSeeds === SEEDS, `longgrassSeeds=${longgrassSeeds}/${SEEDS}`);
check('rock outcrops appear (every seed)', rocksSeeds === SEEDS, `rocksSeeds=${rocksSeeds}/${SEEDS}`);
check('rocky mountain passes appear (every seed)', passSeeds === SEEDS, `passSeeds=${passSeeds}/${SEEDS}`);
// Sanity floor: the map is well-resourced even on water/mountain-heavy seeds
// (clusters are a clean +50%; multi-lobe woods add the rest).
check('map is well-resourced', minNodes >= 5000, `minNodes=${minNodes}`);
check('every world is fully walkable-connected', allConnected);
check('no bridge crosses a lake', lakeBridgeTotal === 0, `lakeBridgeTiles=${lakeBridgeTotal}`);

const failed = results.filter((c) => !c).length;
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
