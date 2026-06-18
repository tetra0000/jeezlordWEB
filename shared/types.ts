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
  train?: { pct: number; queued: number }; // military building training status
  action?: Action; // units: current activity (omitted when idle)
  amount?: number; // resource nodes: harvestable amount remaining
}

export interface Pop {
  used: number;
  cap: number;
}
