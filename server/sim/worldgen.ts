// One-time world generation: carves rivers (with sporadic bridges) into the
// static terrain grid, then scatters resource nodes — big dense forests plus
// gold/stone/berry clusters — across the remaining grass. Runs only on a fresh
// world (guarded by a 'seeded' meta flag in main.ts). Terrain is persisted as a
// base64 blob; resources persist as entities.
import { MAP_TILES, TERRAIN_GRASS, TERRAIN_WATER, TERRAIN_BRIDGE } from '../../shared/constants.js';
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

// Paint a filled disk of water around a centreline point. Overlapping disks from
// consecutive points give the river a continuous, slightly irregular body.
function carveWaterDisk(world: World, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) setTerrain(world, cx + dx, cy + dy, TERRAIN_WATER);
}

// A river: a noisy centreline that drifts from one map edge to the opposite one,
// carved as a chain of water disks. Returns the centreline points (used to place
// bridges across it afterwards).
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
    // Random walk on the cross axis with mild momentum, kept on-map.
    crossVel += (Math.random() - 0.5) * 0.6;
    crossVel = Math.max(-2.2, Math.min(2.2, crossVel));
    cross += crossVel;
    if (cross < MARGIN) { cross = MARGIN; crossVel = Math.abs(crossVel); }
    if (cross > MAP_TILES - MARGIN) { cross = MAP_TILES - MARGIN; crossVel = -Math.abs(crossVel); }

    const x = Math.round(horizontal ? along : cross);
    const y = Math.round(horizontal ? cross : along);
    // Width breathes a little along the course.
    const r = baseHalf + (Math.random() < 0.25 ? 1 : 0);
    carveWaterDisk(world, x, y, r);
    pts.push({ x, y, r });
    along += step;
  }
  return pts;
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
function placeForest(world: World, cx: number, cy: number, radius: number): void {
  const cleared = new Set<number>();
  const trails = radius >= 16 ? 2 : 1; // wider woods get a second path
  for (let t = 0; t < trails; t++) carveForestTrail(world, cx, cy, radius, cleared);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      // Soft, slightly ragged edge: thin out toward the rim.
      if (dist > radius - 2 && Math.random() < 0.5) continue;
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < MARGIN || ty < MARGIN || tx >= MAP_TILES - MARGIN || ty >= MAP_TILES - MARGIN) continue;
      if (world.terrainAt(tx, ty) !== TERRAIN_GRASS) continue; // keep rivers/bridges clear
      if (world.isBlockedTile(tx, ty)) continue;
      if (cleared.has(world.tileIndex(tx, ty))) continue; // leave the path open
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
  // Rivers first — resources then fill the dry land around them.
  generateRivers(world);

  // Big dense forests: fewer but much larger blobs, each with a path carved through.
  for (let f = 0; f < 32; f++) placeForest(world, randTile(), randTile(), 10 + Math.floor(Math.random() * 13));
  // Berry patches.
  for (let b = 0; b < 60; b++) placeCluster(world, 'berry', randTile(), randTile(), 3 + Math.floor(Math.random() * 4), 2);
  // Gold deposits.
  for (let g = 0; g < 45; g++) placeCluster(world, 'gold', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);
  // Stone deposits.
  for (let s = 0; s < 45; s++) placeCluster(world, 'stone', randTile(), randTile(), 2 + Math.floor(Math.random() * 3), 2);

  let water = 0;
  let bridge = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    if (world.terrain[i] === TERRAIN_WATER) water++;
    else if (world.terrain[i] === TERRAIN_BRIDGE) bridge++;
  }
  console.log(
    `[worldgen] seeded ${[...world.entityIds()].length} resource nodes, ${water} water + ${bridge} bridge tiles`,
  );
}
