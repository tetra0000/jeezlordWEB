// Dev tool: generate a fresh world and render its terrain (+resource nodes) to
// a PNG for visual inspection of worldgen (rivers, bridges, mountains, ground
// variety). Usage: node scripts/render-map.mjs [out.png]
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { World } from '../dist/server/sim/world.js';
import { seedWorld } from '../dist/server/sim/worldgen.js';
import { MAP_TILES, TILE } from '../dist/shared/constants.js';

const world = new World();
seedWorld(world);
const N = MAP_TILES;
const png = new PNG({ width: N, height: N });
const COLORS = {
  0: [88, 122, 66],   // grass
  1: [44, 90, 134],   // water
  2: [190, 120, 60],  // bridge (bright so it pops)
  3: [86, 84, 88],    // mountain
  4: [107, 74, 42],   // mud
  5: [217, 200, 154], // beach
  6: [138, 116, 78],  // dirt
  7: [122, 150, 84],  // flowers
  8: [64, 100, 50],   // long grass
  9: [62, 74, 48],    // swamp
  10: [140, 140, 148], // rocks
  11: [112, 106, 100], // mountain pass
};
for (let i = 0; i < N * N; i++) {
  const c = COLORS[world.terrain[i]] ?? [255, 0, 255];
  png.data[i * 4] = c[0]; png.data[i * 4 + 1] = c[1]; png.data[i * 4 + 2] = c[2]; png.data[i * 4 + 3] = 255;
}
// Resource nodes as coloured dots.
const NODE = { tree: [30, 62, 28], gold: [240, 200, 60], stone: [170, 170, 180], berry: [200, 60, 70] };
for (const id of world.entityIds()) {
  const kind = world.kind.get(id);
  const c = NODE[kind];
  if (!c) continue;
  const tf = world.transform.get(id);
  const tx = Math.floor(tf.x / TILE), ty = Math.floor(tf.y / TILE);
  const o = (ty * N + tx) * 4;
  png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2];
}
const out = process.argv[2] ?? 'map.png';
writeFileSync(out, PNG.sync.write(png));
console.log('wrote', out);
