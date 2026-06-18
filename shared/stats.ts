// Data-driven game balance. This is THE tuning file — the engine is
// pacing-agnostic. Times are in seconds, distances/speeds in pixels, vision in
// tiles. v7 stretches these numbers for multi-day pacing; the global TIME_SCALE
// env (read in the loop) can accelerate the whole sim for testing.
import type { EntityKind, ResourceType } from './types.js';

export type Cost = Partial<{ wood: number; gold: number; food: number; stone: number }>;

export interface UnitStat {
  hp: number;
  speed: number; // px/s
  vision: number; // tiles
  attack: number;
  range: number; // px (melee ~ 1 tile)
  attackCooldown: number; // s between attacks
  trainTime: number; // s
  trainedAt: EntityKind; // building that trains it
  cost: Cost;
  pop: number; // population it consumes
}

export interface BuildingStat {
  hp: number;
  vision: number; // tiles
  footprint: number; // square footprint in tiles (footprint x footprint)
  buildTime: number; // s
  cost: Cost;
  trains?: EntityKind[]; // units this building can train
  popProvided?: number; // adds to population cap
  accepts?: ResourceType[]; // resource types villagers may deposit here
  attack?: number; // towers fire
  range?: number;
  attackCooldown?: number;
}

export interface ResourceNodeStat {
  resource: ResourceType;
  amount: number; // total harvestable
}

export const BASE_POP_CAP = 0;

// --- units -----------------------------------------------------------------
export const UNIT_STATS: Record<string, UnitStat> = {
  villager: { hp: 25, speed: 55, vision: 4, attack: 3, range: 20, attackCooldown: 1.5, trainTime: 20, trainedAt: 'townCenter', cost: { food: 50 }, pop: 1 },
  infantry: { hp: 45, speed: 60, vision: 5, attack: 6, range: 20, attackCooldown: 1.2, trainTime: 24, trainedAt: 'barracks', cost: { food: 60, gold: 20 }, pop: 1 },
  archer: { hp: 30, speed: 60, vision: 6, attack: 5, range: 130, attackCooldown: 1.5, trainTime: 26, trainedAt: 'range', cost: { wood: 40, gold: 30 }, pop: 1 },
  cavalry: { hp: 80, speed: 70, vision: 5, attack: 9, range: 22, attackCooldown: 1.3, trainTime: 32, trainedAt: 'stable', cost: { food: 70, gold: 30 }, pop: 1 },
  horse: { hp: 110, speed: 95, vision: 6, attack: 11, range: 24, attackCooldown: 1.2, trainTime: 40, trainedAt: 'stable', cost: { food: 80, gold: 50 }, pop: 2 },
  catapult: { hp: 50, speed: 35, vision: 6, attack: 45, range: 220, attackCooldown: 4, trainTime: 80, trainedAt: 'barracks', cost: { wood: 160, gold: 80 }, pop: 3 },
};

// --- buildings -------------------------------------------------------------
export const BUILDING_STATS: Record<string, BuildingStat> = {
  // Town Center: trains villagers, big vision, accepts every resource. You start
  // with one; rebuildable (expensive) so losing it to a raid isn't fatal.
  townCenter: { hp: 1000, vision: 7, footprint: 3, buildTime: 60, cost: { wood: 275, stone: 100 }, trains: ['villager'], popProvided: 8, accepts: ['wood', 'food', 'gold', 'stone'] },
  house: { hp: 250, vision: 4, footprint: 2, buildTime: 20, cost: { wood: 30 }, popProvided: 5 },
  // Resource-specific drop-off camps (cheap, place next to the resource).
  mill: { hp: 300, vision: 4, footprint: 2, buildTime: 25, cost: { wood: 80 }, accepts: ['food'] },
  lumbercamp: { hp: 250, vision: 3, footprint: 1, buildTime: 20, cost: { wood: 60 }, accepts: ['wood'] },
  miningcamp: { hp: 250, vision: 3, footprint: 1, buildTime: 20, cost: { wood: 60 }, accepts: ['gold', 'stone'] },
  farm: { hp: 120, vision: 1, footprint: 2, buildTime: 15, cost: { wood: 60 } },
  barracks: { hp: 600, vision: 4, footprint: 3, buildTime: 45, cost: { wood: 175 }, trains: ['infantry', 'catapult'] },
  range: { hp: 600, vision: 4, footprint: 3, buildTime: 45, cost: { wood: 175 }, trains: ['archer'] },
  stable: { hp: 600, vision: 4, footprint: 3, buildTime: 50, cost: { wood: 175 }, trains: ['cavalry', 'horse'] },
  tower: { hp: 350, vision: 8, footprint: 1, buildTime: 40, cost: { wood: 50, stone: 125 }, attack: 8, range: 170, attackCooldown: 1.0 },
  wall: { hp: 900, vision: 2, footprint: 1, buildTime: 8, cost: { stone: 25 } },
};

// --- resource nodes --------------------------------------------------------
export const RESOURCE_NODE_STATS: Record<string, ResourceNodeStat> = {
  tree: { resource: 'wood', amount: 100 },
  gold: { resource: 'gold', amount: 800 },
  stone: { resource: 'stone', amount: 600 },
  berry: { resource: 'food', amount: 200 },
};

// Gathering.
export const GATHER_RATE = 0.85; // resource units / second while harvesting
export const CARRY_CAPACITY = 10; // deposit when carrying reaches this

// Farms: a renewable but finite food source that trickles food to the owner
// while operational, then must be rebuilt (replanted). Keeps long games from
// starving once berry bushes deplete, without trivialising the economy.
export const FARM_FOOD = 350; // total food a farm yields before exhausting
export const FARM_RATE = 0.6; // food / second while operational

// Construction auto-progresses once placed (so it continues while the owner is
// offline). Builders walk to the site for flavour but aren't required.
export const CONSTRUCTION_AUTOBUILD = true;

// --- helpers ---------------------------------------------------------------
export const UNIT_KINDS = Object.keys(UNIT_STATS) as EntityKind[];
export const BUILDING_KINDS = Object.keys(BUILDING_STATS) as EntityKind[];
export const RESOURCE_KINDS = Object.keys(RESOURCE_NODE_STATS) as EntityKind[];

export function isUnit(kind: EntityKind): boolean {
  return kind in UNIT_STATS;
}
export function isBuilding(kind: EntityKind): boolean {
  return kind in BUILDING_STATS;
}
export function isResourceNode(kind: EntityKind): boolean {
  return kind in RESOURCE_NODE_STATS;
}

// Whether a building accepts deposits of a given resource type.
export function acceptsResource(kind: EntityKind, resource: ResourceType): boolean {
  return isBuilding(kind) && (BUILDING_STATS[kind].accepts?.includes(resource) ?? false);
}

export function maxHpOf(kind: EntityKind): number {
  if (isUnit(kind)) return UNIT_STATS[kind].hp;
  if (isBuilding(kind)) return BUILDING_STATS[kind].hp;
  return 1;
}
export function visionOf(kind: EntityKind): number {
  if (isUnit(kind)) return UNIT_STATS[kind].vision;
  if (isBuilding(kind)) return BUILDING_STATS[kind].vision;
  return 0;
}
// Global divisor on movement speed. >1 = slower units (travel takes longer),
// matching the slow-combat feel — this is a deliberate, multi-day-paced game,
// not fast micro. Tune here, alongside COMBAT_DURATION_SCALE.
export const MOVE_DURATION_SCALE = 5;

export function speedOf(kind: EntityKind): number {
  return isUnit(kind) ? UNIT_STATS[kind].speed / MOVE_DURATION_SCALE : 0;
}

export interface CombatStat {
  attack: number;
  range: number;
  attackCooldown: number;
}

// Global multiplier on every attack cooldown. >1 = slower combat (longer
// time-to-kill). This game favours slow, deliberate battles over fast micro, so
// units swing 5x slower than their base cadence. Tune here, not per-unit.
export const COMBAT_DURATION_SCALE = 5;

export function combatOf(kind: EntityKind): CombatStat | null {
  if (isUnit(kind)) {
    const u = UNIT_STATS[kind];
    return { attack: u.attack, range: u.range, attackCooldown: u.attackCooldown * COMBAT_DURATION_SCALE };
  }
  if (isBuilding(kind)) {
    const b = BUILDING_STATS[kind];
    if (b.attack != null)
      return { attack: b.attack, range: b.range ?? 0, attackCooldown: (b.attackCooldown ?? 1) * COMBAT_DURATION_SCALE };
  }
  return null;
}

export function costOf(kind: EntityKind): Cost {
  if (isUnit(kind)) return UNIT_STATS[kind].cost;
  if (isBuilding(kind)) return BUILDING_STATS[kind].cost;
  return {};
}
