// Verifies the worldgen connectivity guarantee: after seedWorld, every walkable
// tile (per the sim's isBlockedTile) is reachable from every other — i.e. the
// 4-connected walkable graph is a single component. Runs a few fresh seeds.
import { World } from '../dist/server/sim/world.js';
import { seedWorld } from '../dist/server/sim/worldgen.js';
import { MAP_TILES } from '../dist/shared/constants.js';

const N = MAP_TILES;
const NEIGH = [[0, -1], [0, 1], [-1, 0], [1, 0]];
let failures = 0;

for (let trial = 0; trial < 8; trial++) {
  const world = new World();
  seedWorld(world);

  const walkable = (x, y) => !world.isBlockedTile(x, y);
  const seen = new Uint8Array(N * N);
  let walkableTotal = 0;
  let firstSeed = -1;
  for (let i = 0; i < N * N; i++) {
    if (walkable(i % N, (i - (i % N)) / N)) {
      walkableTotal++;
      if (firstSeed < 0) firstSeed = i;
    }
  }

  // Flood from the first walkable tile.
  const q = [firstSeed];
  seen[firstSeed] = 1;
  let reached = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % N, y = (i - x) / N;
    reached++;
    for (const [dx, dy] of NEIGH) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if (seen[ni] || !walkable(nx, ny)) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }

  const ok = reached === walkableTotal;
  if (!ok) failures++;
  console.log(
    `trial ${trial}: ${ok ? 'OK' : 'FAIL'} — ${reached}/${walkableTotal} walkable tiles reachable` +
      (ok ? '' : ` (${walkableTotal - reached} stranded)`),
  );
}

console.log(failures === 0 ? '\nALL CONNECTED ✓' : `\n${failures} trial(s) had stranded tiles ✗`);
process.exit(failures === 0 ? 0 : 1);
