// Client-side world model: the last-known entity views (the authoritative
// target positions) plus interpolated render positions, the local player's
// identity/stockpile, and the current selection. Pure data — render and input
// modules read/write this.
import type { DiploEntry, EntityView, EntityId, JobReport, PlayerId, Pop, Relation, Stockpile, TradeRouteView } from '../../shared/types.js';
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
  // Allocated lazily once mapTiles is known, or restored from localStorage on
  // init so exploration survives reloads (see render/fogStore.ts; scoped per
  // player+world). `exploredVersion` bumps when new tiles are explored so the
  // minimap can rebuild its overlay only on change — and so the save throttle
  // in main.ts knows when there's something new to persist.
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
  // Caravan road wear per tile (tileIndex -> level 1..ROAD_LEVELS), from init +
  // delta increments. `roadsVersion` bumps on change so the road layer only
  // rebuilds sprites when something actually changed.
  readonly roads = new Map<number, number>();
  roadsVersion = 0;
  // True when the server reports we have no units left (offer a restart).
  defeated = false;
  // Diplomacy roster: our relation with every other player (from the delta).
  diplo: DiploEntry[] | null = null;
  // Our trade routes (stops + assigned caravan counts), from the delta. Drives
  // the Trade menu; null until the first delta carrying it arrives.
  routes: TradeRouteView[] | null = null;

  // Relation with an entity owner ('ally' for self, 'neutral' if unknown).
  relationTo(owner: PlayerId | null): Relation {
    if (owner == null) return 'neutral';
    if (owner === this.playerId) return 'ally';
    return this.diplo?.find((d) => d.id === owner)?.relation ?? 'neutral';
  }
  playerName(owner: PlayerId): string | null {
    return this.diplo?.find((d) => d.id === owner)?.name ?? null;
  }

  applyRoads(pairs: Array<[number, number]> | undefined): void {
    if (!pairs || pairs.length === 0) return;
    for (const [tile, lvl] of pairs) this.roads.set(tile, lvl);
    this.roadsVersion++;
  }

  applyDelta(d: DeltaMsg): void {
    if (d.jobs) this.jobs = d.jobs;
    if (d.market) this.market = d.market;
    this.applyRoads(d.roads);
    if (d.defeated !== undefined) this.defeated = d.defeated;
    if (d.diplo) this.diplo = d.diplo;
    if (d.routes) this.routes = d.routes;
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
    this.routes = null;
    this.defeated = false; // a fresh init (incl. restart) clears the defeat state
    this.explored = null;
    this.exploredVersion = 0;
    this.roads.clear();
    this.roadsVersion++;
  }
}
