// All WebSocket message shapes, shared by client and server so they never drift.
// Discriminated unions on the `t` field. Pure data — no Node/DOM APIs.
import type {
  EntityId,
  EntityKind,
  EntityView,
  JobReport,
  PlayerId,
  Pop,
  ResourceType,
  Shot,
  Stockpile,
  VillagerJob,
} from './types.js';

// Live (global) market price multipliers per tradable commodity, baseline 1.0.
// The client derives the displayed buy/sell prices from these + the shared
// price constants.
export interface MarketState {
  wood: number;
  food: number;
  stone: number;
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface RegisterMsg {
  t: 'register';
  username: string;
  password: string;
}

export interface LoginMsg {
  t: 'login';
  username: string;
  password: string;
}

// Reconnect using a previously issued session token.
export interface ResumeMsg {
  t: 'resume';
  token: string;
}

// Order one or more owned MILITARY units to move to a world position. Villagers
// are no longer hand-controlled (they follow their assigned job) and the server
// ignores them here.
export interface MoveMsg {
  t: 'move';
  unitIds: EntityId[];
  x: number;
  y: number;
  queue?: boolean; // shift-click: append as a waypoint instead of replacing the order
}

// Place a building (server validates cost, free tiles, ownership). Construction
// is then carried out automatically by the kingdom's idle "builder" villagers —
// there is no longer a manual builder assignment.
export interface BuildMsg {
  t: 'build';
  kind: EntityKind;
  tileX: number;
  tileY: number;
}

// Set how many villagers the kingdom should put on a given job. The remainder
// are builders. The server clamps to the job's capacity and reconciles which
// villagers are doing what.
export interface AssignJobMsg {
  t: 'assignJob';
  job: VillagerJob;
  count: number;
}

// Enqueue a unit at a military/production building.
export interface TrainMsg {
  t: 'train';
  buildingId: EntityId;
  unit: EntityKind;
}

// Order units to attack a target entity.
export interface AttackMsg {
  t: 'attack';
  unitIds: EntityId[];
  targetId: EntityId;
}

// Set (or clear, when x/y omitted) a production building's rally point. Units
// trained there walk to it on spawn. Server validates ownership + that the
// building trains.
export interface RallyMsg {
  t: 'rally';
  buildingId: EntityId;
  x?: number;
  y?: number;
}

// Rename an owned town center.
export interface RenameMsg {
  t: 'rename';
  buildingId: EntityId;
  name: string;
}

// Toggle a farm's auto-reseed behaviour.
export interface FarmReseedMsg {
  t: 'farmReseed';
  buildingId: EntityId;
  on: boolean;
}

// Clear orders for military units (stop moving / attacking). Villagers ignore
// this — their job drives them.
export interface StopMsg {
  t: 'stop';
  unitIds: EntityId[];
}

// Delete (destroy) one or more of your OWN units. No resources are refunded.
// Server validates each id is an owned unit (buildings are not deletable here).
export interface DeleteMsg {
  t: 'delete';
  unitIds: EntityId[];
}

// Restart after defeat (0 units left): wipe the player's remaining state and
// re-seed them at a fresh spawn. Server re-validates that they're actually
// defeated before honouring it.
export interface RestartMsg {
  t: 'restart';
}

// Trade at a market: buy a resource with gold, or sell it for gold. `resource`
// is one of the tradable commodities (wood/food/stone — never gold). `amount`
// defaults to MARKET_TRADE_UNIT. Server validates the player owns a market,
// re-prices from the live (global) market, and re-checks affordability.
export interface MarketMsg {
  t: 'market';
  action: 'buy' | 'sell';
  resource: ResourceType;
  amount?: number;
}

// Admin/cheat actions. Only honoured for a player who has enabled admin mode
// (by renaming one of their town centers to "adminmode"). Server re-checks the
// flag before applying — the message alone grants nothing.
export interface AdminMsg {
  t: 'admin';
  action: 'boostResources' | 'revealFog';
}

export type ClientMsg =
  | RegisterMsg
  | LoginMsg
  | ResumeMsg
  | MoveMsg
  | BuildMsg
  | AssignJobMsg
  | TrainMsg
  | AttackMsg
  | RallyMsg
  | RenameMsg
  | FarmReseedMsg
  | StopMsg
  | DeleteMsg
  | RestartMsg
  | MarketMsg
  | AdminMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

// Auth succeeded; carries the session token + who you are.
export interface AuthOkMsg {
  t: 'authOk';
  token: string;
  playerId: PlayerId;
  username: string;
}

// Auth or a command was rejected; `reason` is user-facing.
export interface RejectMsg {
  t: 'reject';
  reason: string;
}

// Sent once after auth: world metadata + your starting stockpile.
export interface InitMsg {
  t: 'init';
  playerId: PlayerId;
  mapTiles: number;
  tile: number;
  stockpile: Stockpile;
  pop: Pop;
  // Static terrain grid, run-length encoded (see shared/terrain.ts). Decodes to
  // mapTiles*mapTiles bytes of terrain codes for client rendering + minimap.
  terrain: number[];
}

// Per-tick world delta. In v0 `enter`/`update`/`leave` cover all entities the
// player may see (vision filtering arrives in v6); the diff structure is final.
export interface DeltaMsg {
  t: 'delta';
  tick: number;
  enter: EntityView[]; // newly visible entities (full state)
  update: EntityView[]; // still-visible entities that changed
  leave: EntityId[]; // entities that left vision or died
  // The subset of `leave` that actually DIED (removed from the world) rather than
  // merely leaving the player's vision — units/buildings only, never resource
  // nodes. Drives death FX and the lingering corpse animation client-side.
  dead?: EntityId[];
  you?: Partial<Stockpile>; // your stockpile changes
  pop?: Pop; // your population used/cap
  jobs?: JobReport; // your villager-jobs summary (sent when it changes)
  market?: MarketState; // global market price multipliers (sent when they change)
  defeated?: boolean; // you have no units left (sent when this flips) — offer restart
  shots?: Shot[]; // ranged projectiles loosed this tick that the player can see (cosmetic)
}

// Admin-mode state for the local player (whether the cheat panel is active, and
// whether full-map reveal is currently on). Sent whenever it changes.
export interface AdminStateMsg {
  t: 'adminState';
  enabled: boolean;
  reveal: boolean;
}

export type ServerMsg = AuthOkMsg | RejectMsg | InitMsg | DeltaMsg | AdminStateMsg;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function encode(msg: ServerMsg | ClientMsg): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.t === 'string') return v as ClientMsg;
  } catch {
    /* fall through */
  }
  return null;
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.t === 'string') return v as ServerMsg;
  } catch {
    /* fall through */
  }
  return null;
}
