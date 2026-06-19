// One-time world generation: carves rivers (with sporadic bridges) into the
// static terrain grid, then scatters resource nodes — big dense forests plus
// gold/stone/berry clusters — across the remaining grass. Runs only on a fresh
// world (guarded by a 'seeded' meta flag in main.ts). Terrain is persisted as a
// base64 blob; resources persist as entities.
import { MAP_TILES, TERRAIN_GRASS, TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_MOUNTAIN } from '../../shared/constants.js';
import type { EntityKind } from '../../shared/types.js';
import type { World } from './world.js';
import { spawnResourceNode } from './spawn.js';

const MARGIN = 8; // keep nodes away from the very edge

function randTile(): number {
  return MARGIN + Math.floor(Math.random() * (MAP_TILES - MARGIN * 2));
}

function setTerrain(world: World, tx: number, ty: number, code: number): void {
  if (!world.inBounds(tx, ty)) return;
  world.terrain[world.tileIndex(tx, ty)] = code;
}

// Paint a filled disk of the given terrain code around a centreline point.
// Overlapping disks from consecutive points give a continuous, irregular body.
function carveDisk(world: World, cx: number, cy: number, r: number, code: number): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) setTerrain(world, cx + dx, cy + dy, code);
}

// A river: a strongly-meandering centreline that drifts from one map edge to the
// opposite one, carved as a chain of water disks, and occasionally pooling into a
// wide lake. Returns the centreline points (used to place bridges afterwards).
function carveRiver(world: World): Array<{ x: number; y: number; r: number }> {
  const pts: Array<{ x: number; y: number; r: number }> = [];
  const horizontal = Math.random() < 0.5;
  // Start on one edge, head toward the far edge; the cross-axis wanders.
  let along = 0;
  let cross = MARGIN + Math.random() * (MAP_TILES - MARGIN * 2);
  let crossVel = (Math.random() - 0.5) * 2;
  const baseHalf = 2 + Math.floor(Math.random() * 2); // half-width 2..3
  const step = 1.5;

  while (along < MAP_TILES) {
    // Random walk on the cross axis with stronger momentum so the river snakes
    // noticeably rather than running nearly straight.
    crossVel += (Math.random() - 0.5) * 0.9;
    crossVel = Math.max(-3.0, Math.min(3.0, crossVel));
    cross += crossVel;
    if (cross < MARGIN) { cross = MARGIN; crossVel = Math.abs(crossVel); }
    if (cross > MAP_TILES - MARGIN) { cross = MAP_TILES - MARGIN; crossVel = -Math.abs(crossVel); }

    const x = Math.round(horizontal ? along : cross);
    const y = Math.round(horizontal ? cross : along);
    // Width breathes a little along the course.
    const r = baseHalf + (Math.random() < 0.25 ? 1 : 0);
    carveDisk(world, x, y, r, TERRAIN_WATER);
    pts.push({ x, y, r });
    along += step;
  }
  return pts;
}

// A large lake: a big water disk with a few overlapping lobes for an irregular
// shoreline. Lakes are inland blobs (land routes around them), so they add
// chokepoints without disconnecting the map.
function carveLake(world: World, cx: number, cy: number): void {
  const R = 12 + Math.floor(Math.random() * 9); // main radius 12..20
  carveDisk(world, cx, cy, R, TERRAIN_WATER);
  const lobes = 2 + Math.floor(Math.random() * 3); // 2..4 lobes
  for (let i = 0; i < lobes; i++) {
    const a = Math.random() * Math.PI * 2;
    const off = R * (0.4 + Math.random() * 0.5);
    carveDisk(
      world,
      Math.round(cx + Math.cos(a) * off),
      Math.round(cy + Math.sin(a) * off),
      Math.round(R * (0.5 + Math.random() * 0.3)),
      TERRAIN_WATER,
    );
  }
}

function generateLakes(world: World): void {
  const count = 3 + Math.floor(Math.random() * 3); // 3..5 large lakes
  for (let i = 0; i < count; i++) carveLake(world, randTile(), randTile());
}

// Lay a bridge (passable) across the river at one centreline point: a short
// thick band perpendicular to the river's local direction, wide enough to span
// the full water body and reach grass on both banks.
function buildBridge(world: World, pts: Array<{ x: number; y: number; r: number }>, i: number): void {
  const a = pts[Math.max(0, i - 2)];
  const b = pts[Math.min(pts.length - 1, i + 2)];
  // Tangent (river direction) -> perpendicular (bridge direction).
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  const px = -ty;
  const py = tx;

  const c = pts[i];
  const reach = c.r + 3; // span the water plus a tile of bank on each side
  const halfThick = 1; // bridge is ~3 tiles thick along the river
  for (let d = -reach; d <= reach; d++) {
    for (let w = -halfThick; w <= halfThick; w++) {
      const bx = Math.round(c.x + px * d + tx * w);
      const by = Math.round(c.y + py * d + ty * w);
      // Only convert water (and its immediate banks) — don't stamp grass tiles
      // far from the river as "bridge".
      if (world.terrainAt(bx, by) === TERRAIN_WATER) setTerrain(world, bx, by, TERRAIN_BRIDGE);
    }
  }
}

function generateRivers(world: World): void {
  const riverCount = 2 + Math.floor(Math.random() * 2); // 2..3 rivers
  for (let r = 0; r < riverCount; r++) {
    const pts = carveRiver(world);
    // Sporadic bridges: a few crossings per river, spaced apart, never at the
    // very ends. Jitter the spacing so they don't look regular.
    const crossings = 2 + Math.floor(Math.random() * 3); // 2..4 bridges
    for (let c = 0; c < crossings; c++) {
      const frac = (c + 0.5 + (Math.random() - 0.5) * 0.4) / crossings;
      const i = Math.floor(frac * pts.length);
      if (i > 4 && i < pts.length - 4) buildBridge(world, pts, i);
    }
  }
}

// Tiles within `radius` (Chebyshev) of any bridge tile. Forests and mountains
// avoid these so a bridge's banks stay open — otherwise a crossing can be walled
// off on both sides, making the bridge useless.
function bridgeClearance(world: World, radius: number): Set<number> {
  const clear = new Set<number>();
  const N = MAP_TILES;
  for (let ty = 0; ty < N; ty++)
    for (let tx = 0; tx < N; tx++) {
      if (world.terrain[ty * N + tx] !== TERRAIN_BRIDGE) continue;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N) clear.add(ny * N + nx);
        }
    }
  return clear;
}

// A mountain range: a wandering ridge centreline carved as a chain of mountain
// disks (impassable), then a couple of walkable passes punched through it so a
// range never fully walls off the map. Ranges are partial (don't span edge to
// edge) — the connectivity pass guarantees overall reachability. Tiles in
// `protect` (bridge banks) never become mountain.
function carveMountainRange(world: World, protect: Set<number>): void {
  const horizontal = Math.random() < 0.5;
  // A partial ridge: start somewhere inland and run for a fraction of the map.
  const length = Math.floor(MAP_TILES * (0.3 + Math.random() * 0.4)); // 30%..70%
  let along = MARGIN + Math.floor(Math.random() * (MAP_TILES - MARGIN * 2 - length));
  const end = along + length;
  let cross = MARGIN + Math.random() * (MAP_TILES - MARGIN * 2);
  let crossVel = (Math.random() - 0.5) * 2;
  const baseHalf = 2 + Math.floor(Math.random() * 3); // half-width 2..4
  const step = 1.5;
  const pts: Array<{ x: number; y: number; r: number }> = [];

  while (along < end) {
    crossVel += (Math.random() - 0.5) * 0.7;
    crossVel = Math.max(-2.5, Math.min(2.5, crossVel));
    cross += crossVel;
    if (cross < MARGIN) { cross = MARGIN; crossVel = Math.abs(crossVel); }
    if (cross > MAP_TILES - MARGIN) { cross = MAP_TILES - MARGIN; crossVel = -Math.abs(crossVel); }

    const x = Math.round(horizontal ? along : cross);
    const y = Math.round(horizontal ? cross : along);
    const r = baseHalf + (Math.random() < 0.3 ? 1 : 0);
    // Only stamp mountains over grass — never overwrite rivers/bridges or the
    // protected banks around bridge crossings.
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (!world.inBounds(tx, ty)) continue;
        if (protect.has(world.tileIndex(tx, ty))) continue;
        if (world.terrain[world.tileIndex(tx, ty)] === TERRAIN_GRASS) setTerrain(world, tx, ty, TERRAIN_MOUNTAIN);
      }
    pts.push({ x, y, r });
    along += step;
  }

  // Punch 2..3 walkable passes: a perpendicular band cleared back to grass.
  const passes = 2 + Math.floor(Math.random() * 2);
  for (let p = 0; p < passes; p++) {
    const frac = (p + 0.5 + (Math.random() - 0.5) * 0.4) / passes;
    const i = Math.floor(frac * pts.length);
    if (i <= 2 || i >= pts.length - 2) continue;
    const a = pts[Math.max(0, i - 2)];
    const b = pts[Math.min(pts.length - 1, i + 2)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const px = -ty;
    const py = tx;
    const c = pts[i];
    const reach = c.r + 3;
    const halfThick = 1; // ~3-tile-wide pass
    for (let d = -reach; d <= reach; d++)
      for (let w = -halfThick; w <= halfThick; w++) {
        const bx = Math.round(c.x + px * d + tx * w);
        const by = Math.round(c.y + py * d + ty * w);
        if (world.terrainAt(bx, by) === TERRAIN_MOUNTAIN) setTerrain(world, bx, by, TERRAIN_GRASS);
      }
  }
}

function generateMountains(world: World, protect: Set<number>): void {
  const ranges = 2 + Math.floor(Math.random() * 2); // 2..3 ranges
  for (let r = 0; r < ranges; r++) carveMountainRange(world, protect);
}

// Guarantee no inaccessible land: flood-fill the passable terrain (grass/bridge)
// from a seed near the map centre, then connect every unreached passable
// component back to the main region by carving a short corridor (water->bridge,
// mountain->grass) toward the seed. Run after rivers+mountains, before resources
// (resource/building blockers don't exist yet). Returns connectors carved.
function ensureConnectivity(world: World): number {
  const N = MAP_TILES;
  const passable = (i: number): boolean => {
    const t = world.terrain[i];
    return t === TERRAIN_GRASS || t === TERRAIN_BRIDGE;
  };
  const visited = new Uint8Array(N * N);
  const NEIGH = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

  // Seed: nearest passable tile to the map centre.
  const cc = Math.floor(N / 2);
  let seed = -1;
  for (let r = 0; r < N && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cc + dx, ty = cc + dy;
        if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
        const i = ty * N + tx;
        if (passable(i)) { seed = i; break; }
      }
  }
  if (seed < 0) return 0;

  const flood = (start: number): void => {
    const q = [start];
    visited[start] = 1;
    for (let head = 0; head < q.length; head++) {
      const i = q[head];
      const x = i % N;
      const y = (i - x) / N;
      for (const [dx, dy] of NEIGH) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (visited[ni] || !passable(ni)) continue;
        visited[ni] = 1;
        q.push(ni);
      }
    }
  };

  // Carve a 3-wide corridor from a tile toward the seed, stopping as soon as it
  // reaches the already-connected (visited) region.
  const carveCorridor = (fromIdx: number): void => {
    let x = fromIdx % N;
    let y = (fromIdx - (fromIdx % N)) / N;
    const sx = seed % N;
    const sy = (seed - (seed % N)) / N;
    let guard = N * 2;
    while (guard-- > 0) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!world.inBounds(x + dx, y + dy)) continue;
          const i = world.tileIndex(x + dx, y + dy);
          if (world.terrain[i] === TERRAIN_WATER) world.terrain[i] = TERRAIN_BRIDGE;
          else if (world.terrain[i] === TERRAIN_MOUNTAIN) world.terrain[i] = TERRAIN_GRASS;
        }
      // Reached the connected region (after moving at least one tile)?
      if ((x !== fromIdx % N || y !== (fromIdx - (fromIdx % N)) / N) && visited[y * N + x]) break;
      if (x === sx && y === sy) break;
      const ddx = sx - x, ddy = sy - y;
      if (Math.abs(ddx) >= Math.abs(ddy)) x += Math.sign(ddx);
      else y += Math.sign(ddy);
    }
  };

  flood(seed);

  let connectors = 0;
  for (let i = 0; i < N * N; i++) {
    if (visited[i] || !passable(i)) continue;
    // A new disconnected component: link it to the main region, then absorb it.
    carveCorridor(i);
    flood(i);
    connectors++;
  }
  return connectors;
}

// Carve a winding clearing through a forest blob: a noisy line that crosses the
// disk roughly through the centre, with a band ~3-4 tiles wide kept tree-free so
// units can path through the wood instead of having to chop a tunnel. Returns the
// set of cleared tile indices (so placeForest can skip them).
function carveForestTrail(world: World, cx: number, cy: number, radius: number, cleared: Set<number>): void {
  // Enter from a random point on the rim and head across to the far side, with
  // mild wander so the trail meanders.
  const angle = Math.random() * Math.PI * 2;
  let x = cx - Math.cos(angle) * radius;
  let y = cy - Math.sin(angle) * radius;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  const half = 1.5 + Math.random() * 0.6; // band half-width -> ~3-4 tiles wide
  const steps = Math.ceil(radius * 2.4);
  for (let s = 0; s < steps; s++) {
    // Wander the heading a little, renormalise.
    const turn = (Math.random() - 0.5) * 0.5;
    const nx = dx * Math.cos(turn) - dy * Math.sin(turn);
    const ny = dx * Math.sin(turn) + dy * Math.cos(turn);
    dx = nx;
    dy = ny;
    x += dx;
    y += dy;
    const r = Math.ceil(half);
    for (let oy = -r; oy <= r; oy++)
      for (let ox = -r; ox <= r; ox++) {
        if (ox * ox + oy * oy > half * half) continue;
        const tx = Math.round(x) + ox;
        const ty = Math.round(y) + oy;
        if (world.inBounds(tx, ty)) cleared.add(world.tileIndex(tx, ty));
      }
  }
}

// A dense forest blob: trees fill a rough disk so the clump reads as an
// (almost) impassable wood, but one or two winding clearings are carved through
// it first so units can weave between the trees. Only grass tiles get a tree.
function placeForest(world: World, cx: number, cy: number, radius: number, protect: Set<number>): void {
  const cleared = new Set<number>();
  // Bigger woods get more carved paths so units can still thread through them
  // (trees block movement; the trails are the navigable gaps).
  const trails = Math.max(2, Math.floor(radius / 10));
  for (let t = 0; t < trails; t++) carveForestTrail(world, cx, cy, radius, cleared);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      // Soft, slightly ragged edge: thin out toward the rim.
      if (dist > radius - 2 && Math.random() < 0.5) continue;
      const tx = cx + dx;
      const ty = cy + dy;
      // Forests run right up to the map edge (only clamped to in-bounds).
      if (!world.inBounds(tx, ty)) continue;
      if (world.terrainAt(tx, ty) !== TERRAIN_GRASS) continue; // keep rivers/bridges clear
      if (world.isBlockedTile(tx, ty)) continue;
      const idx = world.tileIndex(tx, ty);
      if (cleared.has(idx)) continue; // leave the path open
      if (protect.has(idx)) continue; // keep bridge banks clear
      spawnResourceNode(world, 'tree', tx, ty);
    }
  }
}

function placeCluster(world: World, kind: EntityKind, cx: number, cy: number, count: number, spread: number): void {
  for (let i = 0; i < count; i++) {
    const tx = cx + Math.floor((Math.random() - 0.5) * spread * 2);
    const ty = cy + Math.floor((Math.random() - 0.5) * spread * 2);
    if (tx < MARGIN || ty < MARGIN || tx >= MAP_TILES - MARGIN || ty >= MAP_TILES - MARGIN) continue;
    if (world.terrainAt(tx, ty) !== TERRAIN_GRASS) continue; // never on water/bridges
    if (world.isBlockedTile(tx, ty)) continue;
    spawnResourceNode(world, kind, tx, ty);
  }
}

export function seedWorld(world: World): void {
  // Terrain first (rivers, then 3-5 large lakes, then mountain ranges), then
  // guarantee that all land is reachable; resources fill the dry land after.
  generateRivers(world);
  generateLakes(world);
  // Keep bridge banks clear so a crossing can't be walled off on both sides.
  generateMountains(world, bridgeClearance(world, 3));
  const connectors = ensureConnectivity(world);

  // Open a 3-tile buffer around EVERY bridge (river crossings + connectivity
  // corridors): clear any mountains off the banks so a crossing can't be walled,
  // and reuse the same set to keep forests off the banks below.
  const bridgeClear = bridgeClearance(world, 3);
  for (const idx of bridgeClear) if (world.terrain[idx] === TERRAIN_MOUNTAIN) world.terrain[idx] = TERRAIN_GRASS;

  // Big dense forests: large blobs (~50% bigger than before, radius 15..33),
  // each with several paths carved through. Resource density is ~50% higher too.
  for (let f = 0; f < 48; f++) placeForest(world, randTile(), randTile(), 15 + Math.floor(Math.random() * 19), bridgeClear);
  // Berry patches.
  for (let b = 0; b < 90; b++) placeCluster(world, 'berry', randTile(), randTile(), 3 + Math.floor(Math.random() * 4), 2);
  // Gold deposits.
  for (let g = 0; g < 68; g++) placeCluster(world, 'gold', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);
  // Stone deposits.
  for (let s = 0; s < 68; s++) placeCluster(world, 'stone', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);

  let water = 0;
  let bridge = 0;
  let mountain = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    const t = world.terrain[i];
    if (t === TERRAIN_WATER) water++;
    else if (t === TERRAIN_BRIDGE) bridge++;
    else if (t === TERRAIN_MOUNTAIN) mountain++;
  }
  console.log(
    `[worldgen] seeded ${[...world.entityIds()].length} resource nodes, ` +
      `${water} water + ${bridge} bridge + ${mountain} mountain tiles, ` +
      `${connectors} connectivity corridor(s) carved`,
  );
}
