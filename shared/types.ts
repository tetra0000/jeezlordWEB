// Shared primitive types. Pure data — no Node/DOM APIs.

export type EntityId = number;
export type PlayerId = number;

export interface Vec2 {
  x: number;
  y: number;
}

// Entity kinds. v0 only uses "villager"; the rest are reserved so the protocol
// and placeholder-render table are stable as later milestones land.
// Military units are SQUADS: one entity represents a small group of soldiers
// (UnitStat.squad figures). The squad shares one hp pool; as it takes damage it
// loses men and deals proportionally less damage. See shared/stats.ts.
export type EntityKind =
  | 'villager'
  | 'militia'
  | 'warrior'
  | 'spearman'
  | 'archer'
  | 'longbowman'
  | 'scoutCavalry'
  | 'knight'
  | 'horseArcher'
  | 'catapult'
  // Trade caravan: a defenceless wagon that shuttles between two markets and
  // earns gold on every delivery home (see server/sim/systems/trade.ts).
  | 'caravan'
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
  | 'market'
  | 'tree'
  | 'gold'
  | 'stone'
  | 'berry'
  // A dead unit's body: a neutral, non-blocking world entity that lingers and
  // fades over CORPSE_TTL_S, then vanishes. Visible to anyone who's there (it's
  // part of the shared world — stumble onto a battlefield of them). Not a unit/
  // building/resource, so the sim systems skip it.
  | 'corpse';

export type ResourceType = 'wood' | 'gold' | 'food' | 'stone';

// Military squad stances (how a squad behaves when enemies appear):
//  - aggressive: auto-engage anything in sight and chase it far.
//  - defensive: auto-engage nearby, but keep a short chase leash (default).
//  - standGround: attack only what comes into weapon range; never move.
//  - noAttack: never auto-attack (explicit attack orders still work).
export type Stance = 'aggressive' | 'defensive' | 'standGround' | 'noAttack';

// Group movement formations (how a multi-squad move order arranges its
// destinations): a wide line abreast, a compact box, or a loose spread.
export type Formation = 'line' | 'box' | 'loose';

// Diplomacy. Every pair of players has a relation; everyone starts NEUTRAL
// (units never auto-engage and cannot be ordered to attack). WAR is declared
// unilaterally and openly; an ALLIANCE needs a proposal + acceptance. Getting
// out of a war back to neutral likewise needs both sides (a peace offer).
export type Relation = 'neutral' | 'ally' | 'war';

// One row of the player's diplomacy roster (their relation with every other
// player in the world). `offer` marks a pending step-up proposal on this pair:
// 'in' = they proposed to you (you can accept), 'out' = you proposed to them.
// At neutral the proposal means alliance; at war it means peace.
export interface DiploEntry {
  id: PlayerId;
  name: string;
  color: number;
  relation: Relation;
  offer?: 'in' | 'out';
}

// A projectile a ranged attacker visibly looses. Purely cosmetic — the sim
// resolves the damage instantly; this just tells the client what to draw flying.
export type ProjectileKind = 'arrow' | 'boulder';

// A single shot fired this tick: the launch (attacker) and impact (target)
// world positions, so the client can fly a visible projectile between them.
// Transient (lives for one delta), never persisted.
export interface Shot {
  kind: ProjectileKind;
  x: number; // launch position (attacker)
  y: number;
  tx: number; // impact position (target)
  ty: number;
}

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
  stance?: Stance; // military squads: current stance (sent to the owner only)
  // Caravans: the active trade route (market entity ids) and the gold earned
  // per delivery. Sent to the owner only.
  trade?: { home: EntityId; target: EntityId; gold: number; foreign: boolean };
  path?: Vec2[]; // units: remaining move waypoints in world px (sent to the owner only)
  // Corpses (kind === 'corpse'): the unit kind that died (which sprite to draw),
  // its team (original owner, for tinting; the corpse entity itself is neutral),
  // and how much it has decayed (1 = fresh, 0 = gone — drives the fade-out).
  corpse?: { kind: EntityKind; team: PlayerId | null; fade: number };
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
