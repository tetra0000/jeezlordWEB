// Factory helpers that create fully-formed entities (units, buildings, resource
// nodes) with the right components derived from the stat tables. Used by player
// setup, the training system, and world generation.
import { TILE } from '../../shared/constants.js';
import {
  BUILDING_STATS,
  FARM_FOOD,
  RESOURCE_NODE_STATS,
  combatOf,
  isResourceNode,
  maxHpOf,
  speedOf,
} from '../../shared/stats.js';
import type { EntityId, EntityKind, PlayerId } from '../../shared/types.js';
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
  if (combatOf(kind)) world.combat.set(id, { cooldownLeft: 0, targetId: null, commanded: false, attacking: false });
  if (kind === 'villager')
    world.gatherer.set(id, { state: 'idle', carrying: 0, carryType: null, nodeId: null });
  return id;
}

export function buildingCenter(tileX: number, tileY: number, footprint: number): { x: number; y: number } {
  return { x: (tileX + footprint / 2) * TILE, y: (tileY + footprint / 2) * TILE };
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
  world.blockFootprint(tileX, tileY, stat.footprint);
  world.construction.set(id, {
    buildTime: stat.buildTime,
    elapsed: underConstruction ? 0 : stat.buildTime,
    complete: !underConstruction,
  });
  if (combatOf(kind)) world.combat.set(id, { cooldownLeft: 0, targetId: null, commanded: false, attacking: false });
  if (stat.trains) world.trainQueue.set(id, []);
  if (kind === 'farm') world.resourceAmount.set(id, FARM_FOOD);
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
