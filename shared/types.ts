// Shared primitive types. Pure data — no Node/DOM APIs.

export type EntityId = number;
export type PlayerId = number;

export interface Vec2 {
  x: number;
  y: number;
}

// Entity kinds. v0 only uses "villager"; the rest are reserved so the protocol
// and placeholder-render table are stable as later milestones land.
export type EntityKind =
  | 'villager'
  | 'infantry'
  | 'archer'
  | 'scout'
  | 'cavalry'
  | 'horse'
  | 'catapult'
  | 'wall'
  | 'tower'
  | 'townCenter'
  | 'house'
  | 'mill'
  | 'lumbercamp'
  | 'miningcamp'
  | 'barracks'
  | 'range'
  | 'stable'
  | 'farm'
  | 'tree'
  | 'gold'
  | 'stone'
  | 'berry';

export type ResourceType = 'wood' | 'gold' | 'food' | 'stone';

// Villager jobs. Villagers are no longer hand-controlled — the player assigns
// jobs and the sim auto-tasks each villager. "builder" is the default (assists
// any unbuilt foundation inside the kingdom's territory); the rest gather a
// specific resource within a host building's radius (or, for farmers, work a
// single farm). See server/sim/systems/jobs.ts.
export type VillagerJob =
  | 'builder'
  | 'farmer'
  | 'forager'
  | 'lumberjack'
  | 'stonemason'
  | 'goldminer';

export interface Stockpile {
  wood: number;
  gold: number;
  food: number;
  stone: number;
}

// What an entity is currently doing — drives client animation + tooltip.
export type Action =
  | 'idle'
  | 'move'
  | 'attack'
  | 'build'
  | 'gatherWood'
  | 'gatherFood'
  | 'gatherGold'
  | 'gatherStone';

// A snapshot of one entity as seen on the wire.
export interface EntityView {
  id: EntityId;
  kind: EntityKind;
  owner: PlayerId | null; // null = neutral / Gaia
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  build?: number; // construction progress 0..1 (present only while building)
  // Production building training status: front-item progress, queue length, and
  // the ordered kinds in the queue (so the client can show the full queue).
  train?: { pct: number; queued: number; items: EntityKind[] };
  rally?: Vec2; // production building rally point (sent to the owner only)
  action?: Action; // units: current activity (omitted when idle)
  amount?: number; // resource nodes / farms: harvestable amount remaining
  territory?: number; // town centers: current territory radius in tiles
  name?: string; // town centers: player-given name
  farmAuto?: boolean; // farms: auto-reseed toggle (sent to the owner only)
  job?: VillagerJob; // villagers: current job (sent to the owner only)
  path?: Vec2[]; // units: remaining move waypoints in world px (sent to the owner only)
}

export interface Pop {
  used: number;
  cap: number;
}

// Per-player villager-jobs summary (sent to the owner only, in the delta).
// `counts` is how many villagers are on each job right now (builder included);
// `caps` is the capacity for each non-builder job (how many the kingdom can
// support); `idleLong` is how many villagers have had nothing to do for a long
// time (drives the "idle villagers" warning).
export interface JobReport {
  total: number;
  counts: Record<VillagerJob, number>;
  caps: Partial<Record<VillagerJob, number>>;
  idleLong: number;
}
