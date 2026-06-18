// All WebSocket message shapes, shared by client and server so they never drift.
// Discriminated unions on the `t` field. Pure data — no Node/DOM APIs.
import type { EntityId, EntityKind, EntityView, PlayerId, Pop, Stockpile } from './types.js';

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

// Order one or more owned units to move to a world position (off-grid target).
export interface MoveMsg {
  t: 'move';
  unitIds: EntityId[];
  x: number;
  y: number;
}

// Send villagers to harvest a resource node.
export interface GatherMsg {
  t: 'gather';
  unitIds: EntityId[];
  nodeId: EntityId;
}

// Place a building (server validates cost, free tiles, ownership).
export interface BuildMsg {
  t: 'build';
  builderIds: EntityId[];
  kind: EntityKind;
  tileX: number;
  tileY: number;
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

// Clear orders (stop moving / gathering / attacking).
export interface StopMsg {
  t: 'stop';
  unitIds: EntityId[];
}

export type ClientMsg =
  | RegisterMsg
  | LoginMsg
  | ResumeMsg
  | MoveMsg
  | GatherMsg
  | BuildMsg
  | TrainMsg
  | AttackMsg
  | StopMsg;

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
}

// Per-tick world delta. In v0 `enter`/`update`/`leave` cover all entities the
// player may see (vision filtering arrives in v6); the diff structure is final.
export interface DeltaMsg {
  t: 'delta';
  tick: number;
  enter: EntityView[]; // newly visible entities (full state)
  update: EntityView[]; // still-visible entities that changed
  leave: EntityId[]; // entities that left vision or died
  you?: Partial<Stockpile>; // your stockpile changes
  pop?: Pop; // your population used/cap
}

export type ServerMsg = AuthOkMsg | RejectMsg | InitMsg | DeltaMsg;

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
