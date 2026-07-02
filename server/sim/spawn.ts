// Factory helpers that create fully-formed entities (units, buildings, resource
// nodes) with the right components derived from the stat tables. Used by player
// setup, the training system, and world generation.
import { TILE } from '../../shared/constants.js';
import {
  BUILDING_STATS,
  FARM_FOOD,
  RESOURCE_NODE_STATS,
  TERRITORY_MIN_TILES,
  buildTimeOf,
  combatOf,
  isResourceNode,
  maxHpOf,
  speedOf,
} from '../../shared/stats.js';
import type { EntityId, EntityKind, PlayerId } from '../../shared/types.js';
import { randomTownName } from './names.js';
import type { World } from './world.js';

export function spawnUnit(
  world: World,
  kind: EntityKind,
  owner: PlayerId,
  x: number,
  y: number,
): EntityId {
  const hp = maxHpOf(kind);
  const id = world.spawn(kind, owner, x, y, hp, hp);
  world.movement.set(id, {
    speed: speedOf(kind),
    target: null,
    path: [],
    pathIndex: -1,
    repathCooldown: 0,
  });
  if (combatOf(kind)) world.combat.set(id, { cooldownLeft: 0, targetId: null, commanded: false, attacking: false, stance: 'defensive' });
  if (kind === 'villager')
    world.gatherer.set(id, { state: 'idle', carrying: 0, carryType: null, nodeId: null, job: 'builder', idleTime: 0 });
  if (kind === 'caravan')
    world.trader.set(id, { state: 'idle', routeId: null, stopIndex: 0, lastStopId: null });
  return id;
}

export function buildingCenter(tileX: number, tileY: number, footprint: number): { x: number; y: number } {
  return { x: (tileX + footprint / 2) * TILE, y: (tileY + footprint / 2) * TILE };
}

// Apply (sign=+1, on placement/load) or remove (sign=-1, on destruction) a
// building's tile reservations on the World grids. The single source of truth
// for how a building occupies tiles — used by spawnBuilding, killEntity and the
// DB loader so the three stay in lockstep.
//  - A normal building's footprint blocks movement (and thus building too).
//  - A `walkable` building's footprint reserves build space only (units pass).
//  - An `outline` ring around the footprint reserves build-only, walkable tiles
//    (the military courtyard / path).
export function applyBuildingFootprint(
  world: World,
  kind: EntityKind,
  tileX: number,
  tileY: number,
  sign: number,
): void {
  const stat = BUILDING_STATS[kind];
  const f = stat.footprint;
  for (let dy = 0; dy < f; dy++)
    for (let dx = 0; dx < f; dx++) {
      if (stat.walkable) world.addNoBuild(tileX + dx, tileY + dy, sign);
      else world.addBlock(tileX + dx, tileY + dy, sign);
    }
  const o = stat.outline ?? 0;
  for (let dy = -o; dy < f + o; dy++)
    for (let dx = -o; dx < f + o; dx++) {
      if (dx >= 0 && dx < f && dy >= 0 && dy < f) continue; // footprint handled above
      world.addNoBuild(tileX + dx, tileY + dy, sign);
    }
}

export function spawnBuilding(
  world: World,
  kind: EntityKind,
  owner: PlayerId,
  tileX: number,
  tileY: number,
  underConstruction: boolean,
): EntityId {
  const stat = BUILDING_STATS[kind];
  const c = buildingCenter(tileX, tileY, stat.footprint);
  const hp = stat.hp;
  const id = world.spawn(kind, owner, c.x, c.y, hp, hp);
  applyBuildingFootprint(world, kind, tileX, tileY, 1);
  const buildTime = buildTimeOf(kind);
  world.construction.set(id, {
    buildTime,
    elapsed: underConstruction ? 0 : buildTime,
    complete: !underConstruction,
  });
  if (combatOf(kind)) world.combat.set(id, { cooldownLeft: 0, targetId: null, commanded: false, attacking: false, stance: 'defensive' });
  if (stat.trains) world.trainQueue.set(id, []);
  if (kind === 'townCenter') {
    world.tcRadius.set(id, TERRITORY_MIN_TILES);
    // Every Town Center starts named (a random UK town), avoiding names this
    // player already uses; the owner can rename it later.
    const used = new Set<string>();
    for (const [tid, o] of world.owner)
      if (o === owner && world.kind.get(tid) === 'townCenter') {
        const n = world.tcName.get(tid);
        if (n) used.add(n);
      }
    world.tcName.set(id, randomTownName(used));
  }
  if (kind === 'farm') world.resourceAmount.set(id, FARM_FOOD);
  if (kind === 'gate') registerGate(world, id, tileX, tileY);
  return id;
}

// Register a gate's tile in the per-mover passability map (gates have a 1-tile
// footprint). Used by spawnBuilding and the DB loader; killEntity unregisters.
export function registerGate(world: World, id: EntityId, tileX: number, tileY: number): void {
  world.gateTiles.set(world.tileIndex(tileX, tileY), id);
}

// Drop a corpse where a unit died. Neutral (owner = null) so it never blocks
// tiles, fights, gives vision, or counts toward population; `team` keeps the
// dead unit's colour. Decays over CORPSE_TTL_S (see corpse.ts).
export function spawnCorpse(
  world: World,
  unitKind: EntityKind,
  team: PlayerId | null,
  x: number,
  y: number,
  age = 0,
): EntityId {
  const id = world.spawn('corpse', null, x, y, 1, 1);
  world.corpses.set(id, { unitKind, team, age });
  return id;
}

export function spawnResourceNode(
  world: World,
  kind: EntityKind,
  tileX: number,
  tileY: number,
): EntityId {
  if (!isResourceNode(kind)) throw new Error(`not a resource node: ${kind}`);
  const x = tileX * TILE + TILE / 2;
  const y = tileY * TILE + TILE / 2;
  const id = world.spawn(kind, null, x, y, 1, 1);
  world.resourceAmount.set(id, RESOURCE_NODE_STATS[kind].amount);
  world.blockFootprint(tileX, tileY, 1);
  return id;
}
