// Client-side world model: the last-known entity views (the authoritative
// target positions) plus interpolated render positions, the local player's
// identity/stockpile, and the current selection. Pure data — render and input
// modules read/write this.
import type { EntityView, EntityId, JobReport, PlayerId, Pop, Stockpile } from '../../shared/types.js';
import type { DeltaMsg, MarketState } from '../../shared/protocol.js';
import { TILE } from '../../shared/constants.js';
import { BUILDING_STATS, isBuilding } from '../../shared/stats.js';
import { KIND_STYLE } from './render/colors.js';

export interface ClientEntity {
  view: EntityView; // authoritative state (target position lives here)
  rx: number; // interpolated render x
  ry: number; // interpolated render y
}

export class ClientState {
  playerId: PlayerId = -1;
  mapTiles = 0;
  tile = 32;
  terrain: Uint8Array | null = null; // static terrain grid (mapTiles²), from init
  stockpile: Stockpile = { wood: 0, gold: 0, food: 0, stone: 0 };
  pop: Pop = { used: 0, cap: 0 };

  readonly entities = new Map<EntityId, ClientEntity>();
  readonly selection = new Set<EntityId>();

  // Fog-of-war "explored" memory: 1 per tile that has ever been in own vision.
  // Allocated lazily once mapTiles is known; in-memory only (resets on reload),
  // matching the server's discovered-resources set. `exploredVersion` bumps when
  // new tiles are explored so the minimap can rebuild its overlay only on change.
  explored: Uint8Array | null = null;
  exploredVersion = 0;

  // Admin mode (cheat panel) state, driven by server `adminState` messages.
  adminEnabled = false;
  adminReveal = false;

  // Villager-jobs summary (counts/caps/idle), from the delta. Drives the
  // villager panel; null until the first delta carrying it arrives.
  jobs: JobReport | null = null;

  // Global market price multipliers (from the delta); drives the market panel.
  market: MarketState | null = null;
  // True when the server reports we have no units left (offer a restart).
  defeated = false;

  applyDelta(d: DeltaMsg): void {
    if (d.jobs) this.jobs = d.jobs;
    if (d.market) this.market = d.market;
    if (d.defeated !== undefined) this.defeated = d.defeated;
    for (const v of d.enter) {
      this.entities.set(v.id, { view: v, rx: v.x, ry: v.y });
    }
    for (const v of d.update) {
      const e = this.entities.get(v.id);
      if (e) e.view = v;
      else this.entities.set(v.id, { view: v, rx: v.x, ry: v.y });
    }
    for (const id of d.leave) {
      this.entities.delete(id);
      this.selection.delete(id);
    }
  }

  isOwn(id: EntityId): boolean {
    return this.entities.get(id)?.view.owner === this.playerId;
  }

  // Topmost entity whose shape contains the world point (smallest hit wins).
  entityAt(wx: number, wy: number): ClientEntity | null {
    let best: ClientEntity | null = null;
    let bestHalf = Infinity;
    for (const e of this.entities.values()) {
      const kind = e.view.kind;
      if (kind === 'corpse') continue; // corpses are scenery — not hoverable/selectable
      const half = isBuilding(kind)
        ? (BUILDING_STATS[kind].footprint * TILE) / 2
        : KIND_STYLE[kind].size + 3;
      // Cheap bounding-box reject first: skips the hypot for the vast majority
      // of entities (matters under admin reveal, where every node is in state).
      const dx = wx - e.view.x;
      const dy = wy - e.view.y;
      if (Math.abs(dx) > half || Math.abs(dy) > half) continue;
      const within = isBuilding(kind) ? true : dx * dx + dy * dy <= half * half;
      if (within && half < bestHalf) {
        best = e;
        bestHalf = half;
      }
    }
    return best;
  }

  reset(): void {
    this.entities.clear();
    this.selection.clear();
    this.jobs = null;
    this.defeated = false; // a fresh init (incl. restart) clears the defeat state
    this.explored = null;
    this.exploredVersion = 0;
  }
}
