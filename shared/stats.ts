// Data-driven game balance. This is THE tuning file — the engine is
// pacing-agnostic. Times are in seconds, distances/speeds in pixels, vision in
// tiles. v7 stretches these numbers for multi-day pacing; the global TIME_SCALE
// env (read in the loop) can accelerate the whole sim for testing.
import type { EntityKind, ProjectileKind, ResourceType, VillagerJob } from './types.js';

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
  // Tile-occupancy modifiers (see server/sim/world.ts + spawn.applyBuildingFootprint):
  //  - walkable: the footprint reserves build space but does NOT block unit
  //    movement (units path over it) — farms and the resource drop-off camps.
  //  - outline: a ring (this many tiles thick) of walkable, no-build "courtyard"
  //    around the footprint — reserved so you can't build flush against it, but
  //    units may walk it; rendered as a dirt path. Used by military buildings.
  walkable?: boolean;
  outline?: number; // tiles
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
  // Scout: a fast, cheap mounted recon unit — very high vision, very low attack.
  // For exploring/spotting, not fighting. Trained at the stable; every player
  // starts with one (see net/session.ts).
  scout: { hp: 45, speed: 95, vision: 11, attack: 2, range: 20, attackCooldown: 2.0, trainTime: 18, trainedAt: 'stable', cost: { food: 60 }, pop: 1 },
  cavalry: { hp: 80, speed: 70, vision: 5, attack: 9, range: 22, attackCooldown: 1.3, trainTime: 32, trainedAt: 'stable', cost: { food: 70, gold: 30 }, pop: 1 },
  horse: { hp: 110, speed: 95, vision: 6, attack: 11, range: 24, attackCooldown: 1.2, trainTime: 40, trainedAt: 'stable', cost: { food: 80, gold: 50 }, pop: 2 },
  catapult: { hp: 50, speed: 35, vision: 6, attack: 45, range: 220, attackCooldown: 4, trainTime: 80, trainedAt: 'barracks', cost: { wood: 160, gold: 80 }, pop: 3 },
};

// --- buildings -------------------------------------------------------------
export const BUILDING_STATS: Record<string, BuildingStat> = {
  // Town Center: trains villagers, big vision, accepts every resource. You start
  // with one; rebuildable (expensive) so losing it to a raid isn't fatal.
  townCenter: { hp: 1000, vision: 7, footprint: 3, buildTime: 60, cost: { wood: 275, stone: 100 }, trains: ['villager'], popProvided: 8, accepts: ['wood', 'food', 'gold', 'stone'], gatherRadius: 12, jobSlots: { lumberjack: 2, stonemason: 2, goldminer: 2, forager: 2 }, outline: 1 },
  house: { hp: 250, vision: 4, footprint: 2, buildTime: 20, cost: { wood: 30 }, popProvided: 5 },
  // Resource-specific drop-off camps (cheap, place next to the resource). Each
  // also raises the matching job's capacity and opens a gather radius for it.
  mill: { hp: 300, vision: 4, footprint: 2, buildTime: 25, cost: { wood: 80 }, accepts: ['food'], gatherRadius: 9, jobSlots: { forager: 2 } },
  lumbercamp: { hp: 250, vision: 3, footprint: 1, buildTime: 20, cost: { wood: 60 }, accepts: ['wood'], gatherRadius: 15, jobSlots: { lumberjack: 2 }, walkable: true },
  miningcamp: { hp: 250, vision: 3, footprint: 1, buildTime: 20, cost: { wood: 60 }, accepts: ['gold', 'stone'], gatherRadius: 15, jobSlots: { stonemason: 2, goldminer: 2 }, walkable: true },
  farm: { hp: 120, vision: 1, footprint: 2, buildTime: 15, cost: { wood: 60 }, jobSlots: { farmer: 1 }, walkable: true },
  // Market: trade resources for gold (and back) at fluctuating prices. Not a
  // resource drop-off; its UI panel (shown when selected) is the trade desk.
  market: { hp: 500, vision: 4, footprint: 2, buildTime: 35, cost: { wood: 120, stone: 40 } },
  barracks: { hp: 600, vision: 4, footprint: 3, buildTime: 45, cost: { wood: 175 }, trains: ['infantry', 'catapult'], outline: 1 },
  range: { hp: 600, vision: 4, footprint: 3, buildTime: 45, cost: { wood: 175 }, trains: ['archer'], outline: 1 },
  stable: { hp: 600, vision: 4, footprint: 3, buildTime: 50, cost: { wood: 175 }, trains: ['scout', 'cavalry', 'horse'], outline: 1 },
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
export const TERRITORY_MIN_TILES = 15; // starting border radius (+50% over the old 10)
export const TERRITORY_MAX_TILES = 22.5; // max border radius it grows to (+50% over the old 15)
export const TERRITORY_GROW_TIME_S = 2 * 3600; // seconds to grow MIN -> MAX

// Town Centers, Lumber Camps and Mining Camps may be placed ANYWHERE outside
// enemy territory (you don't need your own territory there). Every other
// building must sit fully inside your own territory. Shared so the server check
// and the client placement ghost agree.
export const PLACE_ANYWHERE_KINDS: EntityKind[] = ['townCenter', 'lumbercamp', 'miningcamp'];

// Town Center cost scales with distance from your nearest existing Town Center:
// within TC_FREE_RADIUS_TILES it costs the base price; beyond that the cost grows
// linearly (TC_COST_GROWTH_PER_TILE of the base per extra tile), so expanding far
// from your heartland is progressively expensive. See townCenterCost().
export const TC_FREE_RADIUS_TILES = 50;
export const TC_COST_GROWTH_PER_TILE = 0.02; // +2% of the base cost per tile past the free radius

// The cost of a Town Center placed `distTiles` from the nearest existing one (use
// 0 / your first TC for the base price). Costs are rounded to whole resources.
export function townCenterCost(distTiles: number): Cost {
  const base = BUILDING_STATS.townCenter.cost;
  // No existing TC (distTiles = Infinity) ⇒ your first/recovery TC at base price.
  const over = isFinite(distTiles) ? Math.max(0, distTiles - TC_FREE_RADIUS_TILES) : 0;
  const mult = 1 + over * TC_COST_GROWTH_PER_TILE;
  const scale = (v?: number): number | undefined => (v == null ? undefined : Math.round(v * mult));
  return { wood: scale(base.wood), stone: scale(base.stone), gold: scale(base.gold), food: scale(base.food) };
}

// When a unit dies it leaves a corpse — a neutral world entity that lingers and
// slowly fades, then vanishes after this many SIM-seconds (so it decays while
// the owner is offline and TIME_SCALE fast-forwards it in tests). Persistent and
// visible to everyone in vision: a battlefield stays littered for a while.
export const CORPSE_TTL_S = 15 * 60; // 15 minutes

// Units slowly regenerate health while standing in their own territory. A
// deliberate, slow recovery to match the multi-day pacing — 1 hp per minute.
// SIM-seconds, so TIME_SCALE fast-forwards it in tests.
export const HEAL_RATE_PER_S = 1 / 60;

// Construction requires a villager: a placed building is a foundation that only
// advances while at least one of the owner's villagers is building it. Build
// time is also stretched a touch (see BUILD_DURATION_SCALE).
export const BUILD_DURATION_SCALE = 1.025; // +2.5% to every building's build time

export function buildTimeOf(kind: EntityKind): number {
  return isBuilding(kind) ? BUILDING_STATS[kind].buildTime * BUILD_DURATION_SCALE : 0;
}

// Builders also repair damaged, completed buildings/walls inside their territory.
// One builder restores a full health bar in REPAIR_TIME_S sim-seconds (scaled by
// maxHp, so every building repairs in the same time); more builders are faster
// with the same diminishing returns as construction. Sim-seconds → TIME_SCALE
// fast-forwards it.
export const REPAIR_TIME_S = 180;

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

// Ranged attackers loose a visible projectile when they fire (cosmetic only —
// damage is still applied instantly by the combat system). Melee units (absent
// here) deal damage with no flying object. Archers/towers shoot arrows; the
// catapult lobs a boulder.
export const PROJECTILE_OF: Partial<Record<EntityKind, ProjectileKind>> = {
  archer: 'arrow',
  tower: 'arrow',
  catapult: 'boulder',
};

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

// --- market / trading -------------------------------------------------------
// The market trades wood/food/stone for gold and back. Gold is the currency, so
// it is never itself traded. Prices are a GLOBAL, shared economy: each commodity
// carries a price multiplier (baseline 1.0). Selling pushes a commodity's price
// down (more supply), buying pushes it up; the multiplier then drifts back to
// 1.0 over ~an hour. There's a buy/sell spread, so the market is a gold sink.
export const MARKET_TRADABLE: ResourceType[] = ['wood', 'food', 'stone'];
export const MARKET_TRADE_UNIT = 100; // resources moved per trade click

// Baseline gold per 1 unit of each commodity (at price multiplier 1.0).
export const MARKET_BASE_PRICE: Record<ResourceType, number> = {
  wood: 0.4, food: 0.4, stone: 0.5, gold: 0, // gold never trades
};
export const MARKET_SPREAD = 0.3; // buy costs ×(1+spread), sell pays ×(1-spread)
export const MARKET_MIN_MULT = 0.3; // price floor / ceiling (how far trades can move it)
export const MARKET_MAX_MULT = 3.0;
// How far one MARKET_TRADE_UNIT trade nudges the multiplier (scaled by amount).
export const MARKET_STEP = 0.03;
// Mean reversion toward 1.0, in multiplier-units per SIM-second. 1/3600 means a
// full deviation of 1.0 unwinds in an hour (smaller deviations sooner) — "prices
// return to baseline after an hour". Sim-time, so TIME_SCALE fast-forwards it.
export const MARKET_REVERT_RATE = 1 / 3600;

// Gold you receive for selling `amount` of `resource` at multiplier `mult`.
export function marketSellTotal(resource: ResourceType, mult: number, amount: number): number {
  return Math.floor(MARKET_BASE_PRICE[resource] * mult * (1 - MARKET_SPREAD) * amount);
}
// Gold it costs to buy `amount` of `resource` at multiplier `mult`.
export function marketBuyTotal(resource: ResourceType, mult: number, amount: number): number {
  return Math.ceil(MARKET_BASE_PRICE[resource] * mult * (1 + MARKET_SPREAD) * amount);
}

// A villager that can't find work for this many SIM-seconds is "idle for a long
// time" — the client warns the player so they can reassign it. Sim-time, so it
// fast-forwards with TIME_SCALE in tests (1 hr of real pacing).
export const IDLE_WARN_S = 3600;
