// Data-driven game balance. This is THE tuning file — the engine is
// pacing-agnostic. Times are in seconds, distances/speeds in pixels, vision in
// tiles. v7 stretches these numbers for multi-day pacing; the global TIME_SCALE
// env (read in the loop) can accelerate the whole sim for testing.
import type { EntityKind, ResourceType, VillagerJob } from './types.js';

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
  // Villager-jobs (v8): how many villagers of each job this building lets the
  // kingdom support (summed across all the player's operational buildings), and
  // the radius (tiles) around it within which those gatherers find their
  // resource. The Town Center is the base camp for every gathering job; the
  // dedicated camps add capacity and open a new gather radius elsewhere. Farms
  // grant 1 farmer each and ARE the workplace (no radius). See systems/jobs.ts.
  jobSlots?: Partial<Record<VillagerJob, number>>;
  gatherRadius?: number; // tiles
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
  townCenter: { hp: 1000, vision: 7, footprint: 3, buildTime: 60, cost: { wood: 275, stone: 100 }, trains: ['villager'], popProvided: 8, accepts: ['wood', 'food', 'gold', 'stone'], gatherRadius: 12, jobSlots: { lumberjack: 2, stonemason: 2, goldminer: 2, forager: 2 } },
  house: { hp: 250, vision: 4, footprint: 2, buildTime: 20, cost: { wood: 30 }, popProvided: 5 },
  // Resource-specific drop-off camps (cheap, place next to the resource). Each
  // also raises the matching job's capacity and opens a gather radius for it.
  mill: { hp: 300, vision: 4, footprint: 2, buildTime: 25, cost: { wood: 80 }, accepts: ['food'], gatherRadius: 9, jobSlots: { forager: 2 } },
  lumbercamp: { hp: 250, vision: 3, footprint: 1, buildTime: 20, cost: { wood: 60 }, accepts: ['wood'], gatherRadius: 9, jobSlots: { lumberjack: 2 } },
  miningcamp: { hp: 250, vision: 3, footprint: 1, buildTime: 20, cost: { wood: 60 }, accepts: ['gold', 'stone'], gatherRadius: 9, jobSlots: { stonemason: 2, goldminer: 2 } },
  farm: { hp: 120, vision: 1, footprint: 2, buildTime: 15, cost: { wood: 60 }, jobSlots: { farmer: 1 } },
  barracks: { hp: 600, vision: 4, footprint: 3, buildTime: 45, cost: { wood: 175 }, trains: ['infantry', 'catapult'] },
  range: { hp: 600, vision: 4, footprint: 3, buildTime: 45, cost: { wood: 175 }, trains: ['archer'] },
  stable: { hp: 600, vision: 4, footprint: 3, buildTime: 50, cost: { wood: 175 }, trains: ['cavalry', 'horse'] },
  tower: { hp: 350, vision: 8, footprint: 1, buildTime: 40, cost: { wood: 50, stone: 125 }, attack: 8, range: 170, attackCooldown: 1.0 },
  wall: { hp: 900, vision: 2, footprint: 1, buildTime: 8, cost: { stone: 25 } },
};

// --- resource nodes --------------------------------------------------------
export const RESOURCE_NODE_STATS: Record<string, ResourceNodeStat> = {
  tree: { resource: 'wood', amount: 1000 }, // ~10x: a tree is a long-term wood store
  gold: { resource: 'gold', amount: 800 },
  stone: { resource: 'stone', amount: 600 },
  berry: { resource: 'food', amount: 200 },
};

// Gathering.
export const GATHER_RATE = 0.85; // resource units / second while harvesting
export const CARRY_CAPACITY = 10; // deposit when carrying reaches this

// Farms (AoE2-style): a villager harvests food from the farm's store and hauls
// it to a food drop-off, depleting the store. When empty, an auto-reseed (if the
// farm's toggle is on and the owner can afford the wood) refills it.
export const FARM_FOOD = 1750; // total food a farm holds when full (~5x)
export const FARM_RESEED_COST: Cost = { wood: 60 }; // wood to replant an empty farm

// --- territory -------------------------------------------------------------
// Each Town Center projects a circular territory (the tribe's buildable zone).
// It starts small and slowly grows; the union of all your TCs' circles is your
// territory. Growth is in SIM-seconds, so TIME_SCALE fast-forwards it.
export const TERRITORY_MIN_TILES = 10;
export const TERRITORY_MAX_TILES = 15;
export const TERRITORY_GROW_TIME_S = 2 * 3600; // seconds to grow MIN -> MAX

// Construction requires a villager: a placed building is a foundation that only
// advances while at least one of the owner's villagers is building it. Build
// time is also stretched a touch (see BUILD_DURATION_SCALE).
export const BUILD_DURATION_SCALE = 1.025; // +2.5% to every building's build time

export function buildTimeOf(kind: EntityKind): number {
  return isBuilding(kind) ? BUILDING_STATS[kind].buildTime * BUILD_DURATION_SCALE : 0;
}

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

// --- villager jobs (v8) -----------------------------------------------------
// The player assigns counts per job; the sim auto-tasks villagers. Non-builder
// jobs (the ones with a capacity the player tunes); "builder" is the implicit
// remainder and is uncapped.
export const NON_BUILDER_JOBS: VillagerJob[] = [
  'farmer', 'forager', 'lumberjack', 'stonemason', 'goldminer',
];
export const ALL_JOBS: VillagerJob[] = ['builder', ...NON_BUILDER_JOBS];

// Each gathering job harvests one resource-node kind within a host building's
// radius (farmers are special-cased — they work a farm building directly).
export const JOB_NODE_KIND: Partial<Record<VillagerJob, EntityKind>> = {
  lumberjack: 'tree',
  stonemason: 'stone',
  goldminer: 'gold',
  forager: 'berry',
};
export const JOB_RESOURCE: Partial<Record<VillagerJob, ResourceType>> = {
  lumberjack: 'wood',
  stonemason: 'stone',
  goldminer: 'gold',
  forager: 'food',
  farmer: 'food',
};

// A villager that can't find work for this many SIM-seconds is "idle for a long
// time" — the client warns the player so they can reassign it. Sim-time, so it
// fast-forwards with TIME_SCALE in tests (1 hr of real pacing).
export const IDLE_WARN_S = 3600;
