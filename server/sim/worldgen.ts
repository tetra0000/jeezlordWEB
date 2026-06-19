// One-time world generation: carves rivers (with sporadic bridges) into the
// static terrain grid, then scatters resource nodes — big dense forests plus
// gold/stone/berry clusters — across the remaining grass. Runs only on a fresh
// world (guarded by a 'seeded' meta flag in main.ts). Terrain is persisted as a
// base64 blob; resources persist as entities.
import { MAP_TILES, TILE, TERRAIN_GRASS, TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_MOUNTAIN, TERRAIN_MUD, TERRAIN_BEACH } from '../../shared/constants.js';
import type { EntityId, EntityKind } from '../../shared/types.js';
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
// `record` (optional) collects every painted tile index — used to remember which
// water tiles belong to a LAKE (so connectivity never bridges them).
function carveDisk(world: World, cx: number, cy: number, r: number, code: number, record?: Set<number>): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) {
        const tx = cx + dx, ty = cy + dy;
        setTerrain(world, tx, ty, code);
        if (record && world.inBounds(tx, ty)) record.add(world.tileIndex(tx, ty));
      }
}

interface Lobe { x: number; y: number; r: number }

// An organic blob outline: a short random walk of overlapping disks. The union
// of the lobes is an irregular, non-circular shape. `elongate` biases the walk
// along one axis so some blobs come out as long sprawls rather than round clumps.
// Used for both forests and mountain massifs so terrain bodies vary in shape.
function blobLobes(cx: number, cy: number, baseR: number, elongate: boolean): Lobe[] {
  const lobes: Lobe[] = [];
  // A handful of lobes — enough to read as irregular, not so many the union
  // balloons in area (which would carpet the map with trees).
  const count = 1 + Math.floor(Math.random() * Math.max(1, Math.floor(baseR / 6)));
  const axis = Math.random() * Math.PI * 2;
  let x = cx, y = cy;
  for (let i = 0; i < count; i++) {
    const r = Math.max(3, Math.round(baseR * (0.4 + Math.random() * 0.4)));
    lobes.push({ x: Math.round(x), y: Math.round(y), r });
    const stepLen = baseR * (0.3 + Math.random() * 0.5);
    const dir = elongate ? axis + (Math.random() - 0.5) * 1.1 : Math.random() * Math.PI * 2;
    x += Math.cos(dir) * stepLen;
    y += Math.sin(dir) * stepLen;
  }
  return lobes;
}

// Signed distance to the nearest lobe edge (<= 0 means inside the blob).
function lobeEdgeDist(lobes: Lobe[], tx: number, ty: number): number {
  let best = Infinity;
  for (const l of lobes) best = Math.min(best, Math.hypot(tx - l.x, ty - l.y) - l.r);
  return best;
}

// Bounding box of a blob's lobes (padded), clamped in-bounds.
function lobeBounds(lobes: Lobe[]): { minX: number; minY: number; maxX: number; maxY: number; spanR: number } {
  let minX = MAP_TILES, minY = MAP_TILES, maxX = 0, maxY = 0, spanR = 0;
  const cx = lobes[0].x, cy = lobes[0].y;
  for (const l of lobes) {
    minX = Math.min(minX, l.x - l.r); maxX = Math.max(maxX, l.x + l.r);
    minY = Math.min(minY, l.y - l.r); maxY = Math.max(maxY, l.y + l.r);
    spanR = Math.max(spanR, Math.hypot(l.x - cx, l.y - cy) + l.r);
  }
  return {
    minX: Math.max(0, minX), minY: Math.max(0, minY),
    maxX: Math.min(MAP_TILES - 1, maxX), maxY: Math.min(MAP_TILES - 1, maxY), spanR,
  };
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
// chokepoints without disconnecting the map. Every water tile is recorded in
// `lakeTiles` so the connectivity passes know never to bridge across it.
function carveLake(world: World, cx: number, cy: number, lakeTiles: Set<number>): void {
  const R = 12 + Math.floor(Math.random() * 9); // main radius 12..20
  carveDisk(world, cx, cy, R, TERRAIN_WATER, lakeTiles);
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
      lakeTiles,
    );
  }
}

// Returns the set of all lake water tiles (so bridges stay off lakes).
function generateLakes(world: World): Set<number> {
  const lakeTiles = new Set<number>();
  const count = 3 + Math.floor(Math.random() * 3); // 3..5 large lakes
  for (let i = 0; i < count; i++) carveLake(world, randTile(), randTile(), lakeTiles);

  // Keep a lake-free walkable border ring: revert any lake water that spilled
  // into the outer ring back to grass. This guarantees every lake can be walked
  // AROUND (the perimeter is always lake-free), so connectivity never has to
  // bridge a lake to reach an edge-sealed pocket. Rivers (not in lakeTiles) are
  // untouched and still meet the edge.
  const BORDER = 4;
  for (const i of [...lakeTiles]) {
    const x = i % MAP_TILES, y = (i - (i % MAP_TILES)) / MAP_TILES;
    if (x < BORDER || y < BORDER || x >= MAP_TILES - BORDER || y >= MAP_TILES - BORDER) {
      world.terrain[i] = TERRAIN_GRASS;
      lakeTiles.delete(i);
    }
  }
  return lakeTiles;
}

// Beaches: scattered sandy patches where land meets water ("at points"). Each is
// a small blob hugging a shoreline tile (grass/mud adjacent to water). Cosmetic +
// passable. Placed after rivers/lakes (so water exists) but before forests/
// mountains (which only stamp on grass, leaving beaches intact).
function generateBeaches(world: World): void {
  const hasWaterNeighbor = (tx: number, ty: number): boolean => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && world.terrainAt(tx + dx, ty + dy) === TERRAIN_WATER) return true;
    return false;
  };
  // Gather every shoreline tile (grass touching water) up front, then sand a few
  // of them — so we reliably place beaches wherever a shore exists (river banks
  // are mud, so in practice these are lake shores).
  const shore: number[] = [];
  for (let ty = MARGIN; ty < MAP_TILES - MARGIN; ty++)
    for (let tx = MARGIN; tx < MAP_TILES - MARGIN; tx++)
      if (world.terrainAt(tx, ty) === TERRAIN_GRASS && hasWaterNeighbor(tx, ty))
        shore.push(world.tileIndex(tx, ty));
  if (shore.length === 0) return;

  const spots = 10 + Math.floor(Math.random() * 10); // 10..19 beach points
  for (let s = 0; s < spots; s++) {
    const idx = shore[Math.floor(Math.random() * shore.length)];
    const tx = idx % MAP_TILES, ty = Math.floor(idx / MAP_TILES);
    const r = 2 + Math.floor(Math.random() * 3); // 2..4
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const bx = tx + dx, by = ty + dy;
        const t = world.terrainAt(bx, by);
        if (t === TERRAIN_GRASS || t === TERRAIN_MUD) setTerrain(world, bx, by, TERRAIN_BEACH);
      }
  }
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

// Line a river's banks with mud: a thin, ragged band of grass tiles just outside
// the water becomes TERRAIN_MUD (passable, cosmetic). Rivers only — lakes get
// beaches instead. Run while the river's own water is the only water around so we
// don't mud a lake's shore by accident.
function riverMud(world: World, pts: Array<{ x: number; y: number; r: number }>): void {
  for (const p of pts) {
    const rr = p.r + 2;
    for (let dy = -rr; dy <= rr; dy++)
      for (let dx = -rr; dx <= rr; dx++) {
        const dist = Math.hypot(dx, dy);
        if (dist <= p.r || dist > p.r + 1.6) continue; // a 1-2 tile band hugging the bank
        const tx = p.x + dx, ty = p.y + dy;
        if (!world.inBounds(tx, ty)) continue;
        if (world.terrainAt(tx, ty) !== TERRAIN_GRASS) continue;
        if (Math.random() < 0.75) setTerrain(world, tx, ty, TERRAIN_MUD);
      }
  }
}

function generateRivers(world: World): void {
  const riverCount = 2 + Math.floor(Math.random() * 2); // 2..3 rivers
  for (let r = 0; r < riverCount; r++) {
    const pts = carveRiver(world);
    riverMud(world, pts); // muddy banks (rivers only)
    // Sporadic bridges: a few crossings per river, spaced apart, never at the
    // very ends. Jitter the spacing so they don't look regular. (Bridges are
    // placed before lakes exist, so they only ever span river water.)
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

// Stamp a disk of mountains, but only over grass and never on a protected tile.
function stampMountainDisk(world: World, cx: number, cy: number, r: number, protect: Set<number>): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const tx = cx + dx, ty = cy + dy;
      if (!world.inBounds(tx, ty)) continue;
      const i = world.tileIndex(tx, ty);
      if (protect.has(i)) continue;
      if (world.terrain[i] === TERRAIN_GRASS) world.terrain[i] = TERRAIN_MOUNTAIN;
    }
}

// Clear a straight walkable band (mountain -> grass) through a point, so a
// massif/ridge is never a solid wall.
function punchPass(world: World, cx: number, cy: number, ang: number, reach: number, halfThick: number): void {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const px = -dy, py = dx;
  for (let d = -reach; d <= reach; d++)
    for (let w = -halfThick; w <= halfThick; w++) {
      const bx = Math.round(cx + dx * d + px * w);
      const by = Math.round(cy + dy * d + py * w);
      if (world.terrainAt(bx, by) === TERRAIN_MOUNTAIN) setTerrain(world, bx, by, TERRAIN_GRASS);
    }
}

// A mountain MASSIF: an irregular blob of mountains (not a line), with a pass or
// two punched through so it stays traversable. The wider variety of mountain
// shapes (ridges + massifs) is part of v10's terrain-variety pass.
function carveMountainMassif(world: World, protect: Set<number>): void {
  const cx = randTile(), cy = randTile();
  const baseR = 7 + Math.floor(Math.random() * 9); // 7..15
  const lobes = blobLobes(cx, cy, baseR, Math.random() < 0.3);
  for (const l of lobes) stampMountainDisk(world, l.x, l.y, l.r, protect);
  const passes = 1 + Math.floor(Math.random() * 2); // 1..2 passes
  for (let p = 0; p < passes; p++) punchPass(world, cx, cy, Math.random() * Math.PI * 2, baseR + 4, 1);
}

function generateMountains(world: World, protect: Set<number>): void {
  const ranges = 2 + Math.floor(Math.random() * 2); // 2..3 bodies
  for (let r = 0; r < ranges; r++) {
    if (Math.random() < 0.5) carveMountainRange(world, protect);
    else carveMountainMassif(world, protect);
  }
  // An occasional extra massif for variety.
  if (Math.random() < 0.6) carveMountainMassif(world, protect);
}

// Guarantee no inaccessible land: flood-fill the passable terrain (grass/bridge)
// from a seed near the map centre, then connect every unreached passable
// component back to the main region by carving a short corridor (water->bridge,
// mountain->grass) toward the seed. Run after rivers+mountains, before resources
// (resource/building blockers don't exist yet). Returns connectors carved.
function ensureConnectivity(world: World, lakeTiles: Set<number>): number {
  const N = MAP_TILES;
  const passable = (i: number): boolean => {
    const t = world.terrain[i];
    return t === TERRAIN_GRASS || t === TERRAIN_BRIDGE || t === TERRAIN_MUD || t === TERRAIN_BEACH;
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
          // Never bridge a lake — only river water. (The robust pass2 routes
          // around lakes; here we just refuse to lay a lake bridge.)
          if (world.terrain[i] === TERRAIN_WATER && !lakeTiles.has(i)) world.terrain[i] = TERRAIN_BRIDGE;
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

// Final, runtime-accurate connectivity guarantee: after EVERY blocker exists
// (terrain + resource nodes), make sure no walkable tile is unreachable from the
// rest of the walkable map. `ensureConnectivity` above only sees terrain; trees
// and gold/stone/berry nodes also block their tile, so two adjacent forests (or a
// forest hugging a river/mountain) can seal off a pocket of grass. Here a tile is
// "walkable" exactly as the sim sees it (`isBlockedTile`: not water/mountain and
// no dynamic blocker). We label the 4-connected walkable components, take the
// largest as the mainland, and carve a 1-wide corridor from every other component
// to the nearest mainland tile — converting impassable terrain and deleting any
// resource node in the way. 4-connectivity is the right model: the A* forbids
// corner-cutting, so an orthogonal path is the conservative reachability test.
// Returns the number of corridors carved.
function ensureWalkableConnectivity(world: World, lakeTiles: Set<number>): number {
  const N = MAP_TILES;
  const total = N * N;
  const NEIGH = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const; // opposite of k is k^1
  const walkable = (tx: number, ty: number): boolean => !world.isBlockedTile(tx, ty);

  // Tile -> resource-node entity (the only dynamic blockers at world spawn: no
  // players/buildings exist yet). Lets a corridor delete a node in its path.
  const nodeAt = new Map<number, EntityId>();
  for (const id of world.entityIds()) {
    if (!world.resourceAmount.has(id)) continue;
    const tf = world.transform.get(id);
    if (!tf) continue;
    nodeAt.set(world.tileIndex(Math.floor(tf.x / TILE), Math.floor(tf.y / TILE)), id);
  }

  // Label 4-connected walkable components; track sizes to find the mainland.
  const comp = new Int32Array(total).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < total; s++) {
    if (comp[s] !== -1 || !walkable(s % N, (s - (s % N)) / N)) continue;
    const label = sizes.length;
    let size = 0;
    const q = [s];
    comp[s] = label;
    for (let head = 0; head < q.length; head++) {
      const i = q[head];
      const x = i % N;
      const y = (i - x) / N;
      size++;
      for (const [dx, dy] of NEIGH) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (comp[ni] !== -1 || !walkable(nx, ny)) continue;
        comp[ni] = label;
        q.push(ni);
      }
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return 0; // already fully connected (or no land at all)

  let main = 0;
  for (let l = 1; l < sizes.length; l++) if (sizes[l] > sizes[main]) main = l;

  // Multi-source BFS from the mainland giving every tile the next orthogonal step
  // toward the nearest mainland tile. Built twice: once routing AROUND lakes
  // (preferred — so corridors never bridge a lake), and once allowing lakes
  // (fallback for the rare pocket that lakes fully enclose, where leaving it
  // unreachable would be worse than one lake crossing).
  const ARRIVED = 9;
  const gradient = (avoidLakes: boolean): Int8Array => {
    const stepDir = new Int8Array(total).fill(-1);
    const bq: number[] = [];
    for (let i = 0; i < total; i++) if (comp[i] === main) { stepDir[i] = ARRIVED; bq.push(i); }
    for (let head = 0; head < bq.length; head++) {
      const cur = bq[head];
      const cx = cur % N;
      const cy = (cur - cx) / N;
      for (let k = 0; k < 4; k++) {
        const nx = cx + NEIGH[k][0], ny = cy + NEIGH[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (stepDir[ni] !== -1) continue;
        if (avoidLakes && lakeTiles.has(ni)) continue; // don't route through (or bridge) lakes
        stepDir[ni] = (k ^ 1) as number; // from ni, move opposite of how we got here
        bq.push(ni);
      }
    }
    return stepDir;
  };
  const stepLand = gradient(true);
  const stepAny = gradient(false);

  const clearTile = (tx: number, ty: number): void => {
    if (!world.inBounds(tx, ty)) return;
    const i = world.tileIndex(tx, ty);
    const t = world.terrain[i];
    // Bridge any water in the corridor's path. Normal corridors follow the
    // lake-avoiding gradient so they only ever cross rivers; only the rare
    // fallback (a pocket lakes fully enclose) bridges a lake — far better than
    // leaving land unreachable.
    if (t === TERRAIN_WATER) world.terrain[i] = TERRAIN_BRIDGE;
    else if (t === TERRAIN_MOUNTAIN) world.terrain[i] = TERRAIN_GRASS;
    const node = nodeAt.get(i);
    if (node !== undefined) {
      world.unblockFootprint(tx, ty, 1);
      world.remove(node);
      nodeAt.delete(i);
    }
  };

  // Carve one corridor per non-mainland component, following the lake-avoiding
  // gradient when it reaches the component, else the lake-allowing fallback.
  let connectors = 0;
  const handled = new Set<number>([main]);
  for (let i = 0; i < total; i++) {
    const l = comp[i];
    if (l < 0 || handled.has(l)) continue;
    handled.add(l);
    const stepDir = stepLand[i] !== -1 ? stepLand : stepAny;
    let p = i;
    let guard = total;
    while (guard-- > 0) {
      clearTile(p % N, (p - (p % N)) / N);
      if (comp[p] === main) break; // reached the mainland
      const sd = stepDir[p];
      if (sd < 0 || sd === ARRIVED) break;
      p += NEIGH[sd][1] * N + NEIGH[sd][0];
    }
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

// A forest of irregular SHAPE and varied SIZE: trees fill the union of an
// organic blob of lobes (so woods come out as ragged clumps, long sprawls, or
// sparse groves — not uniform circles), with winding clearings carved first so
// units can thread through. Only grass tiles get a tree. `baseR` sets the size.
function placeForest(world: World, cx: number, cy: number, baseR: number, protect: Set<number>): void {
  const lobes = blobLobes(cx, cy, baseR, Math.random() < 0.4); // 40% are elongated
  const { minX, minY, maxX, maxY, spanR } = lobeBounds(lobes);

  const cleared = new Set<number>();
  // Bigger woods get more carved paths so units can still thread through them
  // (trees block movement; the trails are the navigable gaps).
  const trails = Math.max(1, Math.floor(spanR / 9));
  for (let t = 0; t < trails; t++) carveForestTrail(world, cx, cy, spanR, cleared);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const edge = lobeEdgeDist(lobes, tx, ty);
      if (edge > 0) continue; // outside the blob
      // Soft, ragged rim: thin out toward the boundary of the union.
      if (edge > -2 && Math.random() < 0.5) continue;
      if (!world.inBounds(tx, ty)) continue;
      if (world.terrainAt(tx, ty) !== TERRAIN_GRASS) continue; // keep water/mud/beach/bridge clear
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

// A varied forest size: mostly small/medium groves with a few big woods, so the
// map mixes thickets and sprawling forests rather than one uniform size.
function forestSize(): number {
  const roll = Math.random();
  if (roll < 0.45) return 5 + Math.floor(Math.random() * 7);   // grove: 5..11
  if (roll < 0.8) return 12 + Math.floor(Math.random() * 9);   // wood: 12..20
  return 21 + Math.floor(Math.random() * 12);                  // great forest: 21..32
}

export function seedWorld(world: World): void {
  // Terrain first (rivers + muddy banks, then 3-5 large lakes, then beaches at
  // shoreline points, then mountain ranges/massifs), then guarantee all land is
  // reachable; resources fill the dry land after.
  generateRivers(world);
  const lakeTiles = generateLakes(world);
  generateBeaches(world);
  // Keep bridge banks clear so a crossing can't be walled off on both sides.
  generateMountains(world, bridgeClearance(world, 3));
  const connectors = ensureConnectivity(world, lakeTiles);

  // Open a 3-tile buffer around EVERY bridge (river crossings + connectivity
  // corridors): clear any mountains off the banks so a crossing can't be walled,
  // and reuse the same set to keep forests off the banks below.
  const bridgeClear = bridgeClearance(world, 3);
  for (const idx of bridgeClear) if (world.terrain[idx] === TERRAIN_MOUNTAIN) world.terrain[idx] = TERRAIN_GRASS;

  // Forests: irregular shapes, varied sizes. Fewer placements than before, but
  // each multi-lobe wood covers more ground, so total wood lands ~+50% (more
  // resources generally) — matching the +50% berry/gold/stone bump below.
  for (let f = 0; f < 40; f++) placeForest(world, randTile(), randTile(), forestSize(), bridgeClear);
  // Berry patches.
  for (let b = 0; b < 135; b++) placeCluster(world, 'berry', randTile(), randTile(), 3 + Math.floor(Math.random() * 4), 2);
  // Gold deposits.
  for (let g = 0; g < 102; g++) placeCluster(world, 'gold', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);
  // Stone deposits.
  for (let s = 0; s < 102; s++) placeCluster(world, 'stone', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);

  // Resources are blockers too, so forests/clusters can seal off pockets of grass
  // that the terrain-only pass above couldn't see. Re-check connectivity against
  // the real walkability and open a corridor out of every isolated pocket
  // (routing around lakes, so no corridor ever bridges a lake).
  const pockets = ensureWalkableConnectivity(world, lakeTiles);

  let water = 0, bridge = 0, mountain = 0, mud = 0, beach = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    const t = world.terrain[i];
    if (t === TERRAIN_WATER) water++;
    else if (t === TERRAIN_BRIDGE) bridge++;
    else if (t === TERRAIN_MOUNTAIN) mountain++;
    else if (t === TERRAIN_MUD) mud++;
    else if (t === TERRAIN_BEACH) beach++;
  }
  console.log(
    `[worldgen] seeded ${[...world.entityIds()].length} resource nodes, ` +
      `${water} water + ${bridge} bridge + ${mountain} mountain + ${mud} mud + ${beach} beach tiles, ` +
      `${connectors} terrain + ${pockets} walkable corridor(s) carved`,
  );
}
