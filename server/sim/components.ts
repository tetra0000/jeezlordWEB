// Component definitions for the data-oriented entity store. Each component type
// is held in its own Map<EntityId, T> on the World (see world.ts).
import type {
  EntityId,
  EntityKind,
  PlayerId,
  ResourceType,
  Vec2,
  VillagerJob,
} from '../../shared/types.js';

export interface Transform {
  x: number;
  y: number;
}

export interface Health {
  hp: number;
  maxHp: number;
}

export interface Movement {
  speed: number; // px per second
  target: Vec2 | null; // final destination (persisted)
  path: Vec2[]; // pathfound waypoints (in-memory only; recomputed on load)
  pathIndex: number; // -1 = needs a path
  repathCooldown: number; // s until allowed to repath after a failure
  // True when `path` only reaches the closest tile we could (goal unreachable or
  // over the A* budget). On arrival the mover re-plans from there to keep
  // closing the distance, instead of stopping or cutting through walls.
  // In-memory only (like `path`).
  partial?: boolean;
  // Queued future destinations (shift-clicked waypoints). On reaching `target`
  // the next one is popped into `target`. In-memory only — a manual micro queue,
  // not worth persisting; a restart just resumes the current `target`.
  waypoints?: Vec2[];
}

export interface Gatherer {
  state: 'idle' | 'toNode' | 'gathering' | 'toDrop' | 'building';
  carrying: number;
  carryType: ResourceType | null;
  nodeId: EntityId | null;
  buildTargetId?: EntityId | null; // in-memory only: building being assisted
  // The job the player assigned this villager. The jobs system auto-tasks the
  // villager from this (find a node / farm / foundation). Persisted.
  job: VillagerJob;
  // Sim-seconds this villager has gone without any work to do (job unsatisfiable
  // right now). Drives the "idle villagers" warning. In-memory only.
  idleTime: number;
}

export interface Construction {
  buildTime: number; // total seconds
  elapsed: number; // seconds accumulated
  complete: boolean;
}

export interface TrainItem {
  kind: EntityKind;
  timeLeft: number;
  total: number;
}

// A dead unit's body. The entity's kind is 'corpse' and its owner is null
// (neutral — so combat/vision/population all skip it); `team` keeps the original
// owner for client tinting. `age` accrues in sim-seconds until CORPSE_TTL_S.
export interface Corpse {
  unitKind: EntityKind; // the kind that died (which sprite to render)
  team: PlayerId | null; // original owner (colour only)
  age: number; // sim-seconds since death
}

export interface CombatState {
  cooldownLeft: number;
  targetId: EntityId | null;
  commanded: boolean; // explicit attack order (don't auto-drop the target)
  attacking: boolean; // in range of target this tick (drives attack animation)
}

// A player's live state held in memory.
export interface PlayerState {
  id: PlayerId;
  name: string;
  color: number;
  spawnTileX: number;
  spawnTileY: number;
  stockpile: { wood: number; gold: number; food: number; stone: number };
  // Desired villager count per non-builder job (builder is the remainder). The
  // jobs system clamps each to the kingdom's current capacity. Persisted.
  jobDesired: Partial<Record<VillagerJob, number>>;
}
